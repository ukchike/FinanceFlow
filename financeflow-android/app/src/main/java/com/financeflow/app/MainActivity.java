package com.financeflow.app;

import android.app.AlertDialog;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.TextUtils;
import android.util.Base64;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Rect;
import android.view.HapticFeedbackConstants;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.JsPromptResult;
import android.widget.EditText;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends AppCompatActivity {

    private WebView webView;
    private static final String CHANNEL_ID = "financeflow_alerts";
    private int notifId = 1;

    // ── Lock-on-resume ──
    // Without this, the PIN/biometric lock only ever ran once at cold start (a single JS line
    // at the bottom of index.html), so backgrounding the app with Home and reopening it from
    // the app switcher skipped the lock screen entirely — anyone with the phone unlocked could
    // reopen FinanceFlow straight to the transaction list. onPause/onResume close that gap.
    //
    // suppressNextLock guards the false positives: the file chooser, the SAF save dialog, the
    // notification-listener/battery/app-details settings screens and external links (About)
    // all launch a separate Activity, which pauses MainActivity exactly like leaving the app
    // does. Every call site that launches one of those sets this flag first so returning from
    // them doesn't re-trigger the lock.
    private boolean suppressNextLock = false;
    private boolean awaitingLockCheck = false;

    // ── Quick Settings tile / home-screen widget "+ Add" button ──
    // Both launch MainActivity with this intent extra; JS's handleShortcutAction() is invoked
    // once the page has actually finished loading (immediately if it already had, via
    // dispatchPendingShortcut() below — otherwise queued until onPageFinished fires).
    public static final String EXTRA_SHORTCUT_ACTION = "shortcut_action";
    private boolean pageLoaded = false;
    private String pendingShortcutAction;

    // Web <input type=file> support (CSV/JSON upload, Google Drive included via document providers)
    private ValueCallback<Uri[]> filePathCallback;
    private ActivityResultLauncher<Intent> fileChooserLauncher;

    // Native "Save As" (SAF) support for backups — lets the user pick Drive, Downloads, etc.
    private ActivityResultLauncher<Intent> createDocumentLauncher;
    private String pendingSaveContent;
    private String pendingSaveCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        applySecureRecents(getSharedPreferences(UX_PREFS, MODE_PRIVATE).getBoolean(KEY_SECURE_RECENTS, true));
        setContentView(R.layout.activity_main);

        createNotificationChannel();
        requestNotificationPermissionInternal();
        registerLaunchers();

        webView = findViewById(R.id.webview);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Follow the phone's font-size setting (accessibility), capped so layouts don't break.
        float fontScale = getResources().getConfiguration().fontScale;
        settings.setTextZoom(Math.max(85, Math.min(130, Math.round(fontScale * 100))));

        webView.addJavascriptInterface(new AndroidBridge(), "Android");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // Only the bundled app may access the native JavaScript bridge.
                if ("file:///android_asset/index.html".equals(url)) return false;
                Uri uri = Uri.parse(url);
                if ("https".equalsIgnoreCase(uri.getScheme()) || "http".equalsIgnoreCase(uri.getScheme())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                }
                return true;
            }
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                pageLoaded = true;
                dispatchPendingShortcut();
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsPrompt(WebView view, String url, String message,
                                      String defaultValue, JsPromptResult result) {
                EditText input = new EditText(MainActivity.this);
                input.setSingleLine(true);
                if (message.contains("current app PIN")) input.setInputType(android.text.InputType.TYPE_CLASS_NUMBER | android.text.InputType.TYPE_NUMBER_VARIATION_PASSWORD);
                else if (message.toLowerCase().contains("password")) input.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
                input.setText(defaultValue);
                new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message).setView(input)
                    .setPositiveButton(android.R.string.ok,
                        (d, w) -> result.confirm(input.getText().toString().trim()))
                    .setNegativeButton(android.R.string.cancel, (d, w) -> result.cancel())
                    .setOnCancelListener(d -> result.cancel()).show();
                return true;
            }
            // The base WebChromeClient silently swallows JS alert()/confirm() dialogs —
            // without these overrides, every validation alert and delete confirmation in
            // the app does nothing when tapped.
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                    .setOnCancelListener(d -> result.confirm())
                    .setCancelable(false)
                    .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                    .setNegativeButton(android.R.string.cancel, (d, w) -> result.cancel())
                    .setOnCancelListener(d -> result.cancel())
                    .setCancelable(true)
                    .show();
                return true;
            }

            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                              FileChooserParams params) {
                filePathCallback = callback;
                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("*/*");
                // params.getAcceptTypes() returns the <input accept> attribute's tokens
                // verbatim, which for our inputs are file extensions like ".json", not MIME
                // types. Passing an extension string as EXTRA_MIME_TYPES isn't a valid MIME
                // pattern, and Samsung's "My Files" picker (and some others) then filters
                // every tab - Recent, Internal storage, cloud - down to "No files" instead of
                // ignoring the bad hint. Only forward tokens that actually look like MIME
                // types (contain a "/"); extension-only accepts fall back to the unfiltered
                // "*/*" already set above, and the page itself validates the chosen file.
                String[] acceptTypes = params.getAcceptTypes();
                if (acceptTypes != null) {
                    java.util.ArrayList<String> mimeTypes = new java.util.ArrayList<>();
                    for (String type : acceptTypes) {
                        if (!TextUtils.isEmpty(type) && type.contains("/")) {
                            mimeTypes.add(type);
                        }
                    }
                    if (!mimeTypes.isEmpty()) {
                        intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes.toArray(new String[0]));
                    }
                }
                try {
                    suppressNextLock = true;
                    fileChooserLauncher.launch(Intent.createChooser(intent, "Select File"));
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });
        webView.loadUrl("file:///android_asset/index.html");
        handleIntentExtras(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntentExtras(intent);
    }

    private void handleIntentExtras(Intent intent) {
        if (intent == null) return;
        String action = intent.getStringExtra(EXTRA_SHORTCUT_ACTION);
        if (action != null) {
            pendingShortcutAction = action;
            dispatchPendingShortcut();
        }
    }

    private void dispatchPendingShortcut() {
        if (pendingShortcutAction != null && pageLoaded && webView != null) {
            String js = "if(typeof handleShortcutAction==='function')handleShortcutAction('"
                + pendingShortcutAction.replace("'", "") + "');";
            webView.evaluateJavascript(js, null);
            pendingShortcutAction = null;
        }
    }

    private void registerLaunchers() {
        fileChooserLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(), result -> {
                if (filePathCallback == null) return;
                Uri[] results = null;
                if (result.getResultCode() == RESULT_OK && result.getData() != null
                        && result.getData().getData() != null) {
                    results = new Uri[]{result.getData().getData()};
                }
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            });

        createDocumentLauncher = registerForActivityResult(
            new ActivityResultContracts.StartActivityForResult(), result -> {
                boolean success = false;
                if (result.getResultCode() == RESULT_OK && result.getData() != null
                        && result.getData().getData() != null && pendingSaveContent != null) {
                    Uri uri = result.getData().getData();
                    try (OutputStream os = getContentResolver().openOutputStream(uri)) {
                        if (os != null) {
                            os.write(pendingSaveContent.getBytes(StandardCharsets.UTF_8));
                            success = true;
                        }
                    } catch (IOException e) {
                        success = false;
                    }
                }
                pendingSaveContent = null;
                final boolean ok = success;
                final String cb = pendingSaveCallback;
                pendingSaveCallback = null;
                if (cb != null) {
                    webView.evaluateJavascript("window['" + cb + "'](" + ok + ")", null);
                }
            });
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Budget Alerts", NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("FinanceFlow budget and spending alerts");
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    private void requestNotificationPermissionInternal() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                    new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, 1);
            }
        }
    }

    private SecureStore secureStore;
    private synchronized SecureStore secureStore(){if(secureStore==null)secureStore=new SecureStore(MainActivity.this);return secureStore;}
    private static final java.util.regex.Pattern JS_CALLBACK = java.util.regex.Pattern.compile("^[A-Za-z_$][A-Za-z0-9_$]{0,60}$");

    private void jsCallback(String cb, String json) {
        if (cb == null || !JS_CALLBACK.matcher(cb).matches()) return;
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript("if(typeof " + cb + "==='function')" + cb + "(" + JSONObject.quote(json) + ")", null);
        });
    }

    private final LanServer.Host lanHost = new LanServer.Host() {
        @Override
        public String eval(String js, long timeoutMs) {
            final java.util.concurrent.CountDownLatch done = new java.util.concurrent.CountDownLatch(1);
            final String[] result = {null};
            runOnUiThread(() -> {
                if (webView == null || !pageLoaded) { done.countDown(); return; }
                webView.evaluateJavascript(js, v -> { result[0] = v; done.countDown(); });
            });
            try { done.await(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS); } catch (InterruptedException ignored) {}
            return result[0];
        }

        @Override
        public String asset(String name) {
            try (java.io.InputStream in = getAssets().open(name)) {
                java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                return out.toString("UTF-8");
            } catch (Exception e) {
                return "<p>Desktop editor page missing.</p>";
            }
        }
    };

    @Override
    protected void onDestroy() {
        LanServer.stop();
        super.onDestroy();
    }

    private class AndroidBridge {
        @JavascriptInterface
        public String getAppVersion() {
            return BuildConfig.VERSION_NAME + " · " + (ClaudeAssistant.AVAILABLE ? "Full" : "Standard");
        }

        @JavascriptInterface
        public boolean aiAvailable() { return ClaudeAssistant.AVAILABLE; }

        @JavascriptInterface
        public void aiAsk(String apiKey, String contextJson, String historyJson, String callback) {
            Thread t = new Thread(() -> jsCallback(callback, ClaudeAssistant.ask(apiKey, contextJson, historyJson)), "ff-ai");
            t.start();
        }

        @JavascriptInterface
        public boolean lanAvailable() { return LanServer.AVAILABLE; }

        @JavascriptInterface
        public String lanStart() { return LanServer.start(lanHost); }

        @JavascriptInterface
        public void lanStop() { LanServer.stop(); }

        @JavascriptInterface
        public String lanStatus() { return LanServer.status(); }

        // On-device text recognition (ML Kit, bundled model). Lines are regrouped into visual rows
        // (left to right) so "Amount ..... N5,000" on a receipt stays one row for the JS parser.
        @JavascriptInterface
        public void ocrImage(String base64, String callback) {
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
                if (bmp == null) { jsCallback(callback, "{\"ok\":false,\"error\":\"Couldn't read that image\"}"); return; }
                TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
                    .process(InputImage.fromBitmap(bmp, 0))
                    .addOnSuccessListener(text -> jsCallback(callback, ocrJson(text)))
                    .addOnFailureListener(e -> jsCallback(callback, "{\"ok\":false,\"error\":" + JSONObject.quote("Text recognition failed: " + e.getMessage()) + "}"));
            } catch (Exception e) {
                jsCallback(callback, "{\"ok\":false,\"error\":\"Couldn't read that image\"}");
            }
        }

        @JavascriptInterface public void decodeStatement(String extension,String encoded,String password,int token){
            new Thread(()->{JSONObject result=new JSONObject();try{byte[] data=Base64.decode(encoded,Base64.DEFAULT);if(data.length>4*1024*1024)throw new IllegalArgumentException("File exceeds 4 MB");
                result=extension.equals("xlsx")?StatementDocumentReader.xlsx(data):extension.equals("pdf")?StatementDocumentReader.pdf(MainActivity.this,data,password):new JSONObject().put("error","Use CSV, XLSX or a text-based PDF");
            }catch(Exception e){try{result.put("error",e.getMessage()==null?"Statement extraction failed":e.getMessage());}catch(Exception ignored){}}
            final String json=result.toString();runOnUiThread(()->webView.evaluateJavascript("window.onStatementDecoded("+token+","+JSONObject.quote(json)+")",null));},"statement-extraction").start();
        }

        @JavascriptInterface public boolean supportsSecureStorage(){return Build.VERSION.SDK_INT>=23;}
        @JavascriptInterface public String getSecureItem(String key){return secureStore().get(key);}
        @JavascriptInterface public boolean setSecureItem(String key,String value){return secureStore().set(key,value);}
        @JavascriptInterface public boolean removeSecureItem(String key){return secureStore().remove(key);}
        @JavascriptInterface public String secureKeys(){return secureStore().keys();}


        @JavascriptInterface
        public boolean hasBiometric() {
            BiometricManager bm = BiometricManager.from(MainActivity.this);
            int result = bm.canAuthenticate(
                BiometricManager.Authenticators.BIOMETRIC_WEAK |
                BiometricManager.Authenticators.DEVICE_CREDENTIAL);
            return result == BiometricManager.BIOMETRIC_SUCCESS;
        }

        @JavascriptInterface
        public void authenticate(final String callbackFn) {
            if (!"onAuthResult".equals(callbackFn)) return;
            BiometricManager bm = BiometricManager.from(MainActivity.this);
            int canAuth = bm.canAuthenticate(
                BiometricManager.Authenticators.BIOMETRIC_WEAK |
                BiometricManager.Authenticators.DEVICE_CREDENTIAL);

            if (canAuth != BiometricManager.BIOMETRIC_SUCCESS) {
                // Unavailable authentication must never count as a successful unlock.
                runOnUiThread(() ->
                    webView.evaluateJavascript("window['" + callbackFn + "'](false)", null));
                return;
            }

            BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock FinanceFlow")
                .setSubtitle("Verify your identity to access your finances")
                .setAllowedAuthenticators(
                    BiometricManager.Authenticators.BIOMETRIC_WEAK |
                    BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                .build();

            runOnUiThread(() -> {
                BiometricPrompt prompt = new BiometricPrompt(MainActivity.this,
                    ContextCompat.getMainExecutor(MainActivity.this),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(
                                @NonNull BiometricPrompt.AuthenticationResult result) {
                            webView.evaluateJavascript(
                                "window['" + callbackFn + "'](true)", null);
                        }

                        @Override
                        public void onAuthenticationError(int errorCode,
                                @NonNull CharSequence errString) {
                            webView.evaluateJavascript(
                                "window['" + callbackFn + "'](false)", null);
                        }

                        @Override
                        public void onAuthenticationFailed() {
                            // prompt stays open for retry — do nothing
                        }
                    });
                prompt.authenticate(promptInfo);
            });
        }

        @JavascriptInterface
        public void showNotification(final String title, final String body) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                    ContextCompat.checkSelfPermission(MainActivity.this,
                        android.Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                return;
            }
            NotificationCompat.Builder builder =
                new NotificationCompat.Builder(MainActivity.this, CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .setAutoCancel(true);
            NotificationManagerCompat.from(MainActivity.this)
                .notify(notifId++, builder.build());
        }

        @JavascriptInterface
        public boolean hasNotificationPermission() {
            return NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled();
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(MainActivity.this::requestNotificationPermissionInternal);
        }

        // Opens the system "Save As" dialog (Storage Access Framework) so the user can
        // pick any destination the device exposes — device storage, Downloads, or a
        // cloud provider such as Google Drive if that app is installed. No storage
        // permission is required since writes go through the returned content Uri.
        @JavascriptInterface
        public void saveFile(final String filename, final String content,
                              final String mimeType, final String callbackFn) {
            pendingSaveContent = content;
            pendingSaveCallback = callbackFn;
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(!TextUtils.isEmpty(mimeType) ? mimeType : "application/octet-stream");
            intent.putExtra(Intent.EXTRA_TITLE, filename);
            runOnUiThread(() -> {
                try {
                    suppressNextLock = true;
                    createDocumentLauncher.launch(intent);
                } catch (Exception e) {
                    pendingSaveContent = null;
                    pendingSaveCallback = null;
                    webView.evaluateJavascript("window['" + callbackFn + "'](false)", null);
                }
            });
        }

        // ── Bank alert auto-detection (NotificationListenerService) ──

        @JavascriptInterface
        public boolean hasNotificationListenerAccess() {
            return NotificationManagerCompat.getEnabledListenerPackages(MainActivity.this)
                .contains(getPackageName());
        }

        @JavascriptInterface
        public void openNotificationListenerSettings() {
            runOnUiThread(() -> {
                try {
                    suppressNextLock = true;
                    startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));
                } catch (Exception ignored) {
                }
            });
        }

        // Writes a base64 PNG (drawn on-device with <canvas>, no screenshot capture involved) to
        // the cache dir and hands it to the system share sheet via a content:// Uri from
        // FileProvider — never a raw file:// path, which most share targets now reject outright.
        @JavascriptInterface
        public void shareImage(final String base64Png, final String title) {
            runOnUiThread(() -> {
                try {
                    File dir = new File(getCacheDir(), "images");
                    if (!dir.exists()) dir.mkdirs();
                    File imgFile = new File(dir, "summary_" + System.currentTimeMillis() + ".png");
                    byte[] bytes = Base64.decode(base64Png, Base64.DEFAULT);
                    try (FileOutputStream fos = new FileOutputStream(imgFile)) {
                        fos.write(bytes);
                    }
                    Uri uri = FileProvider.getUriForFile(MainActivity.this,
                        getPackageName() + ".fileprovider", imgFile);
                    Intent shareIntent = new Intent(Intent.ACTION_SEND);
                    shareIntent.setType("image/png");
                    shareIntent.putExtra(Intent.EXTRA_STREAM, uri);
                    shareIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    suppressNextLock = true;
                    startActivity(Intent.createChooser(shareIntent,
                        TextUtils.isEmpty(title) ? "Share" : title));
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public String getSystemAccent(String mode) {
            if (Build.VERSION.SDK_INT < 31) return "";
            try {
                int id = "light".equals(mode) ? android.R.color.system_accent1_600 : android.R.color.system_accent1_300;
                int c = getResources().getColor(id, getTheme());
                return String.format("#%06X", 0xFFFFFF & c);
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void haptic(String kind) {
            runOnUiThread(() -> {
                if (webView == null) return;
                int type = "heavy".equals(kind) ? HapticFeedbackConstants.LONG_PRESS
                    : (Build.VERSION.SDK_INT >= 30 && "success".equals(kind)) ? HapticFeedbackConstants.CONFIRM
                    : (Build.VERSION.SDK_INT >= 23 ? HapticFeedbackConstants.CONTEXT_CLICK : HapticFeedbackConstants.VIRTUAL_KEY);
                webView.performHapticFeedback(type);
            });
        }

        @JavascriptInterface
        public void setSecureRecents(boolean secure) {
            getSharedPreferences(UX_PREFS, MODE_PRIVATE).edit().putBoolean(KEY_SECURE_RECENTS, secure).apply();
            runOnUiThread(() -> applySecureRecents(secure));
        }

        @JavascriptInterface
        public void shareText(String text) {
            if (TextUtils.isEmpty(text)) return;
            runOnUiThread(() -> {
                try {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("text/plain");
                    send.putExtra(Intent.EXTRA_TEXT, text);
                    suppressNextLock = true;
                    startActivity(Intent.createChooser(send, "Share"));
                } catch (Exception ignored) {
                }
            });
        }

        // Hands off to the system browser via an intent — this does NOT need the app's own
        // INTERNET permission (the browser app does its own networking, not this WebView).
        @JavascriptInterface
        public void openExternalLink(String url) {
            String scheme = Uri.parse(url).getScheme();
            if (!"https".equalsIgnoreCase(scheme) && !"http".equalsIgnoreCase(scheme)) return;
            runOnUiThread(() -> {
                try {
                    suppressNextLock = true;
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public void setBankAlertsEnabled(boolean enabled) {
            getSharedPreferences(BankAlertListenerService.PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean(BankAlertListenerService.KEY_ENABLED, enabled).apply();
        }

        @JavascriptInterface
        public String getPendingBankAlerts() {
            try{return BankAlertStore.get(MainActivity.this,BankAlertListenerService.KEY_PENDING,"[]");}catch(Exception e){return "[]";}
        }

        @JavascriptInterface
        public void clearBankAlert(String id) {
            synchronized (BankAlertListenerService.LOCK) {
                SharedPreferences prefs = getSharedPreferences(BankAlertListenerService.PREFS, Context.MODE_PRIVATE);
                try {
                    JSONArray pending = new JSONArray(BankAlertStore.get(MainActivity.this,BankAlertListenerService.KEY_PENDING,"[]"));
                    JSONArray kept = new JSONArray();
                    for (int i = 0; i < pending.length(); i++) {
                        JSONObject entry = pending.getJSONObject(i);
                        if (!entry.optString("id").equals(id)) kept.put(entry);
                    }
                    BankAlertStore.put(MainActivity.this,kept.toString(),null);
                } catch (Exception ignored) {
                }
            }
        }

        @JavascriptInterface
        public String getIgnoredBankSources() {
            java.util.Set<String> ignored = getSharedPreferences(BankAlertListenerService.PREFS, Context.MODE_PRIVATE)
                .getStringSet(BankAlertListenerService.KEY_IGNORED, java.util.Collections.emptySet());
            return new JSONArray(new java.util.ArrayList<>(ignored)).toString();
        }

        @JavascriptInterface
        public void setBankSourceIgnored(String pkg, boolean ignored) {
            if (pkg == null || pkg.isEmpty()) return;
            synchronized (BankAlertListenerService.LOCK) {
                SharedPreferences prefs = getSharedPreferences(BankAlertListenerService.PREFS, Context.MODE_PRIVATE);
                java.util.Set<String> sources = new java.util.HashSet<>(prefs.getStringSet(
                    BankAlertListenerService.KEY_IGNORED, java.util.Collections.emptySet()));
                if (ignored) sources.add(pkg); else sources.remove(pkg);
                SharedPreferences.Editor edit = prefs.edit().putStringSet(BankAlertListenerService.KEY_IGNORED, sources);
                if (ignored) {
                    try {
                        JSONArray pending = new JSONArray(BankAlertStore.get(MainActivity.this,BankAlertListenerService.KEY_PENDING,"[]"));
                        JSONArray kept = new JSONArray();
                        for (int i=0; i<pending.length(); i++) {
                            JSONObject entry=pending.getJSONObject(i);
                            if (!pkg.equals(entry.optString("packageName"))) kept.put(entry);
                        }
                        BankAlertStore.put(MainActivity.this,kept.toString(),null);
                    } catch (Exception e) { return; }
                }
                edit.apply();
            }
        }

        @JavascriptInterface
        public String getFlavor() {
            return BuildConfig.FLAVOR;
        }

        @JavascriptInterface
        public void scheduleReminders() {
            getSharedPreferences(ReminderReceiver.PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean(ReminderReceiver.KEY_ENABLED, true).apply();
            ReminderReceiver.scheduleAll(MainActivity.this);
        }

        @JavascriptInterface
        public void cancelReminders() {
            getSharedPreferences(ReminderReceiver.PREFS, Context.MODE_PRIVATE)
                .edit().putBoolean(ReminderReceiver.KEY_ENABLED, false).apply();
            ReminderReceiver.cancelAll(MainActivity.this);
        }

        @JavascriptInterface
        public void syncUpcomingBills(String json) {
            getSharedPreferences(ReminderReceiver.PREFS, Context.MODE_PRIVATE)
                .edit().putString(ReminderReceiver.KEY_UPCOMING_BILLS, json).apply();
        }

        // Pushes a balance/budget summary to the home-screen widget's SharedPreferences and
        // asks it to redraw. Called from JS on every save() — see syncWidgetData() in
        // index.html — so the widget is only ever stale by "since I last had the app open",
        // never further, but genuinely can't be live: it can't run the WebView in the background.
        @JavascriptInterface
        public void syncWidgetData(String json) {
            try {
                JSONObject o = new JSONObject(json);
                getSharedPreferences(BalanceWidgetProvider.PREFS, Context.MODE_PRIVATE).edit()
                    .putString(BalanceWidgetProvider.KEY_BALANCE, o.optString("balance", "—"))
                    .putString(BalanceWidgetProvider.KEY_BUDGET, o.optString("budget", ""))
                    .putString(BalanceWidgetProvider.KEY_INCOME, o.optString("income", "In —"))
                    .putString(BalanceWidgetProvider.KEY_EXPENSE, o.optString("expense", "Out —"))
                    .apply();
            } catch (Exception ignored) {
            }
            BalanceWidgetProvider.updateAll(MainActivity.this);
        }

        /** Fires a reminder immediately so the user can confirm notifications actually arrive. */
        @JavascriptInterface
        public void testReminder() {
            ReminderReceiver.postNotification(MainActivity.this, 9009, "Test reminder",
                "Reminders are working. You'll get these at 6am and 6pm daily.");
        }

        /**
         * Diagnostics for the Reminders screen: whether notifications are allowed, whether the
         * OEM battery optimiser is likely to kill our alarms, when the next one is due, and
         * when one last actually fired.
         */
        @JavascriptInterface
        public String reminderStatus() {
            JSONObject o = new JSONObject();
            try {
                o.put("notifications", NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled());
                boolean unrestricted = true;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                    if (pm != null) unrestricted = pm.isIgnoringBatteryOptimizations(getPackageName());
                }
                o.put("batteryUnrestricted", unrestricted);
                o.put("nextMorning", ReminderReceiver.nextFireTime(false));
                o.put("nextEvening", ReminderReceiver.nextFireTime(true));
                o.put("lastFired", getSharedPreferences(ReminderReceiver.PREFS, Context.MODE_PRIVATE)
                    .getLong(ReminderReceiver.KEY_LAST_FIRED, 0));
            } catch (Exception ignored) {
            }
            return o.toString();
        }

        /**
         * Opens the system battery-optimisation list so the user can mark FinanceFlow as
         * unrestricted. Uses the settings-list intent rather than the direct-request one so no
         * extra (Play-Protect-flagged) permission has to be declared.
         */
        @JavascriptInterface
        public void openBatterySettings() {
            runOnUiThread(() -> {
                try {
                    suppressNextLock = true;
                    startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                } catch (Exception e) {
                    try {
                        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                        i.setData(Uri.parse("package:" + getPackageName()));
                        suppressNextLock = true;
                        startActivity(i);
                    } catch (Exception ignored) {
                    }
                }
            });
        }

        /** Opens this app's system notification settings (per-channel mute lives here). */
        @JavascriptInterface
        public void openNotificationSettings() {
            runOnUiThread(() -> {
                try {
                    Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                    i.putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName());
                    suppressNextLock = true;
                    startActivity(i);
                } catch (Exception e) {
                    try {
                        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                        i.setData(Uri.parse("package:" + getPackageName()));
                        suppressNextLock = true;
                        startActivity(i);
                    } catch (Exception ignored) {
                    }
                }
            });
        }
    }

    @Override
    public void onBackPressed() {
        // The UI is a single page, so WebView history is always empty and the old
        // canGoBack() check exited the app on every press. handleBackButton() in index.html
        // closes the top-most dialog/screen instead and returns "true" when it handled it.
        if (webView == null || !pageLoaded) {
            moveTaskToBack(true);
            return;
        }
        webView.evaluateJavascript(
            "(function(){try{return typeof handleBackButton==='function'&&handleBackButton()===true;}catch(e){return false;}})()",
            value -> {
                if (!"true".equals(value)) moveTaskToBack(true);
            });
    }

    private static String ocrJson(Text text) {
        try {
            java.util.List<Text.Line> lines = new java.util.ArrayList<>();
            for (Text.TextBlock b : text.getTextBlocks()) lines.addAll(b.getLines());
            java.util.Collections.sort(lines, (a, b) -> Integer.compare(top(a), top(b)));
            JSONArray rows = new JSONArray();
            java.util.List<Text.Line> row = new java.util.ArrayList<>();
            int rowMid = Integer.MIN_VALUE, rowH = 0;
            for (Text.Line l : lines) {
                Rect r = l.getBoundingBox();
                int mid = r == null ? 0 : r.centerY(), h = r == null ? 20 : r.height();
                if (!row.isEmpty() && Math.abs(mid - rowMid) > Math.max(rowH, h) * 0.6) { rows.put(joinRow(row)); row.clear(); }
                if (row.isEmpty()) { rowMid = mid; rowH = h; }
                row.add(l);
            }
            if (!row.isEmpty()) rows.put(joinRow(row));
            return new JSONObject().put("ok", true).put("text", text.getText()).put("rows", rows).toString();
        } catch (Exception e) {
            return "{\"ok\":false,\"error\":\"Couldn't read the text\"}";
        }
    }

    private static int top(Text.Line l) { Rect r = l.getBoundingBox(); return r == null ? 0 : r.centerY(); }

    private static String joinRow(java.util.List<Text.Line> row) {
        java.util.Collections.sort(row, (a, b) -> {
            Rect ra = a.getBoundingBox(), rb = b.getBoundingBox();
            return Integer.compare(ra == null ? 0 : ra.left, rb == null ? 0 : rb.left);
        });
        StringBuilder sb = new StringBuilder();
        for (Text.Line l : row) { if (sb.length() > 0) sb.append("  "); sb.append(l.getText()); }
        return sb.toString();
    }

    private static final String UX_PREFS = "ux_prefs";
    private static final String KEY_SECURE_RECENTS = "secure_recents";

    // Android 13+: blank only the recent-apps preview, so the user can still take screenshots.
    // Older versions have no such API, so FLAG_SECURE is the only way to hide the preview.
    private void applySecureRecents(boolean secure) {
        if (Build.VERSION.SDK_INT >= 33) {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            setRecentsScreenshotEnabled(!secure);
        } else if (secure) {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        } else {
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (suppressNextLock) {
            // We're the ones navigating away (file picker, SAF save, a settings screen, an
            // external link) — don't count this as "left the app".
            suppressNextLock = false;
        } else {
            awaitingLockCheck = true;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (awaitingLockCheck) {
            awaitingLockCheck = false;
            // relock() is a JS function in index.html; it decides whether to actually show the
            // lock screen (only if a PIN or biometric lock is configured) and re-triggers
            // biometric auth. Guarded with typeof in case this fires before the page finishes
            // its first load.
            webView.evaluateJavascript("if(typeof relock==='function')relock();", null);
        }
        if (pageLoaded) {
            webView.evaluateJavascript("if(typeof onAppResume==='function')onAppResume();", null);
        }
    }
}
