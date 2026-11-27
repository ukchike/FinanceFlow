package com.financeflow.app;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Wi-Fi desktop editor: a tiny HTTP server on the local network. A laptop on the same Wi-Fi opens
 * http://phone-ip:8765, enters the 6-digit PIN shown in the app, and edits records; every read and
 * write goes through the WebView (lanSnapshot / lanApply in money-tools.js), so the app stays the
 * single source of truth. Full build only (needs the INTERNET permission).
 */
public final class LanServer {
    public static final boolean AVAILABLE = true;
    static final int PORT = 8765;
    private static final long IDLE_MS = 30 * 60 * 1000L;
    private static final int MAX_BODY = 20 * 1024 * 1024;

    public interface Host {
        /** Runs JS in the WebView and returns its JSON-encoded result, or null on timeout. */
        String eval(String js, long timeoutMs);
        String asset(String name);
    }

    private static ServerSocket server;
    private static volatile String pin;
    private static volatile int failures;
    private static volatile long lastActive;

    private LanServer() {}

    public static synchronized String start(Host host) {
        if (server != null && !server.isClosed()) return status();
        try {
            ServerSocket s = new ServerSocket();
            s.setReuseAddress(true);
            s.bind(new InetSocketAddress(PORT));
            server = s;
            pin = String.format(Locale.US, "%06d", new SecureRandom().nextInt(1000000));
            failures = 0;
            lastActive = System.currentTimeMillis();
            Thread accept = new Thread(() -> acceptLoop(s, host), "ff-lan");
            accept.setDaemon(true);
            accept.start();
            Thread watchdog = new Thread(() -> {
                while (!s.isClosed()) {
                    try { Thread.sleep(60000); } catch (InterruptedException e) { return; }
                    if (System.currentTimeMillis() - lastActive > IDLE_MS) stop();
                }
            }, "ff-lan-idle");
            watchdog.setDaemon(true);
            watchdog.start();
        } catch (Exception e) {
            server = null;
            return "{\"running\":false,\"error\":" + JSONObject.quote("Couldn't start: " + e.getMessage()) + "}";
        }
        return status();
    }

    public static synchronized void stop() {
        try { if (server != null) server.close(); } catch (Exception ignored) {}
        server = null;
        pin = null;
    }

    public static synchronized String status() {
        try {
            JSONObject o = new JSONObject();
            boolean running = server != null && !server.isClosed();
            o.put("running", running);
            if (running) {
                String ip = localIp();
                o.put("url", ip == null ? "" : "http://" + ip + ":" + PORT);
                o.put("pin", pin);
                o.put("wifi", ip != null);
            }
            return o.toString();
        } catch (Exception e) {
            return "{\"running\":false}";
        }
    }

    private static void acceptLoop(ServerSocket s, Host host) {
        while (!s.isClosed()) {
            try {
                Socket c = s.accept();
                c.setSoTimeout(30000);
                Thread t = new Thread(() -> handle(c, host), "ff-lan-conn");
                t.setDaemon(true);
                t.start();
            } catch (Exception e) {
                if (s.isClosed()) return;
            }
        }
    }

    private static void handle(Socket c, Host host) {
        try (Socket sock = c) {
            InputStream in = new BufferedInputStream(sock.getInputStream());
            String requestLine = readLine(in);
            if (requestLine == null) return;
            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            String method = parts[0], path = parts[1];
            Map<String, String> headers = new HashMap<>();
            String line;
            while ((line = readLine(in)) != null && !line.isEmpty()) {
                int i = line.indexOf(':');
                if (i > 0) headers.put(line.substring(0, i).trim().toLowerCase(Locale.US), line.substring(i + 1).trim());
            }
            int len = 0;
            try { len = Integer.parseInt(headers.getOrDefault("content-length", "0")); } catch (NumberFormatException ignored) {}
            if (len > MAX_BODY) { respond(sock, 413, "text/plain", "Too large"); return; }
            byte[] body = new byte[len];
            int read = 0;
            while (read < len) { int n = in.read(body, read, len - read); if (n < 0) break; read += n; }
            lastActive = System.currentTimeMillis();

            if ("GET".equals(method) && ("/".equals(path) || path.startsWith("/?"))) {
                respond(sock, 200, "text/html; charset=utf-8", host.asset("desktop.html"));
                return;
            }
            if (!path.startsWith("/api/")) { respond(sock, 404, "text/plain", "Not found"); return; }
            if (failures >= 5) { respond(sock, 423, "application/json", "{\"error\":\"Locked after too many wrong PINs. Restart the editor on your phone.\"}"); return; }
            String given = headers.getOrDefault("x-ff-pin", "");
            String expected = pin;
            if (expected == null || !MessageDigest.isEqual(given.getBytes(StandardCharsets.UTF_8), expected.getBytes(StandardCharsets.UTF_8))) {
                failures++;
                respond(sock, 401, "application/json", "{\"error\":\"Wrong PIN\"}");
                return;
            }
            String js;
            if ("GET".equals(method) && "/api/data".equals(path)) js = "lanSnapshot()";
            else if ("POST".equals(method) && "/api/apply".equals(path))
                js = "lanApply(" + JSONObject.quote(new String(body, 0, read, StandardCharsets.UTF_8)) + ")";
            else { respond(sock, 404, "application/json", "{\"error\":\"Not found\"}"); return; }
            String result = host.eval(js, 15000);
            if (result == null || "null".equals(result)) { respond(sock, 503, "application/json", "{\"error\":\"Open FinanceFlow on the phone and try again.\"}"); return; }
            // evaluateJavascript returns the JS string JSON-encoded; unwrap it.
            String json = new org.json.JSONArray("[" + result + "]").getString(0);
            respond(sock, 200, "application/json; charset=utf-8", json);
        } catch (Exception ignored) {
        }
    }

    private static String readLine(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int ch;
        while ((ch = in.read()) != -1) {
            if (ch == '\n') break;
            if (ch != '\r') b.write(ch);
            if (b.size() > 16384) break;
        }
        if (ch == -1 && b.size() == 0) return null;
        return b.toString("UTF-8");
    }

    private static void respond(Socket s, int code, String type, String body) throws java.io.IOException {
        byte[] bytes = (body == null ? "" : body).getBytes(StandardCharsets.UTF_8);
        String reason = code == 200 ? "OK" : code == 401 ? "Unauthorized" : code == 404 ? "Not Found" : "Error";
        String head = "HTTP/1.1 " + code + " " + reason + "\r\nContent-Type: " + type + "\r\nContent-Length: " + bytes.length
            + "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nConnection: close\r\n\r\n";
        OutputStream out = s.getOutputStream();
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(bytes);
        out.flush();
    }

    private static String localIp() {
        try {
            String fallback = null;
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses())) {
                    if (!(a instanceof Inet4Address) || !a.isSiteLocalAddress()) continue;
                    String name = ni.getName().toLowerCase(Locale.US);
                    if (name.startsWith("wlan") || name.startsWith("ap") || name.startsWith("swlan")) return a.getHostAddress();
                    if (fallback == null) fallback = a.getHostAddress();
                }
            }
            return fallback;
        } catch (Exception e) {
            return null;
        }
    }
}
