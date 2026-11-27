package com.financeflow.app;

import com.anthropic.client.AnthropicClient;
import com.anthropic.client.okhttp.AnthropicOkHttpClient;
import com.anthropic.core.JsonValue;
import com.anthropic.errors.AnthropicIoException;
import com.anthropic.errors.AnthropicServiceException;
import com.anthropic.errors.BadRequestException;
import com.anthropic.errors.PermissionDeniedException;
import com.anthropic.errors.RateLimitException;
import com.anthropic.errors.UnauthorizedException;
import com.anthropic.models.messages.ContentBlock;
import com.anthropic.models.messages.JsonOutputFormat;
import com.anthropic.models.messages.Message;
import com.anthropic.models.messages.MessageCreateParams;
import com.anthropic.models.messages.OutputConfig;
import com.anthropic.models.messages.StopReason;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Duration;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;

/** Optional bring-your-own-key assistant. Full build only; blocking, so call off the UI thread. */
public final class ClaudeAssistant {
    public static final boolean AVAILABLE = true;
    static final String MODEL = "claude-opus-5-5";

    private static final String INSTRUCTIONS =
        "You are the money assistant inside FinanceFlow, a personal finance app used mostly in Nigeria. "
        + "Answer questions using only the finance data provided below; it is the user's own records, exported from their phone. "
        + "Give exact figures from the data with the currency symbol, keep answers short and practical, and say plainly when the data "
        + "doesn't contain what is needed. Reply in the language the user writes in (including Nigerian Pidgin, Yoruba, Hausa or Igbo). "
        + "You cannot change anything yourself. When the user asks to recategorize transactions, or when a clear miscategorization "
        + "is relevant to their question, put the suggested changes in `proposals`: use only transaction ids present in the data and "
        + "category/subcategory names from the provided category list; the app shows them to the user to confirm. "
        + "Otherwise leave `proposals` empty. Never ask for passwords, PINs, card numbers or bank logins.";

    private ClaudeAssistant() {}

    /**
     * @param historyJson JSON array of {role:"user"|"assistant", text} turns, ending with the user's question
     * @return JSON {ok:true, answer, proposals:[{tx_id,category,subcategory,reason}]} or {ok:false, error}
     */
    public static String ask(String apiKey, String contextJson, String historyJson) {
        JSONObject out = new JSONObject();
        try {
            AnthropicClient client = AnthropicOkHttpClient.builder()
                .apiKey(apiKey)
                .timeout(Duration.ofSeconds(120))
                .maxRetries(2)
                .build();

            MessageCreateParams.Builder params = MessageCreateParams.builder()
                .model(MODEL)
                .maxTokens(16000L)
                .system(INSTRUCTIONS + "\n\nFINANCE DATA (JSON):\n" + contextJson)
                .outputConfig(OutputConfig.builder()
                    .effort(OutputConfig.Effort.MEDIUM)
                    .format(JsonOutputFormat.builder().schema(replySchema()).build())
                    .build())
                // Server-side refusal fallbacks (opt-in beta) so a refused request is retried on a suitable model.
                .putAdditionalHeader("anthropic-beta", "server-side-fallback-2026-07-01")
                .putAdditionalBodyProperty("fallbacks", JsonValue.from("default"));

            JSONArray history = new JSONArray(historyJson);
            for (int i = 0; i < history.length(); i++) {
                JSONObject turn = history.getJSONObject(i);
                String text = turn.optString("text", "");
                if (text.isEmpty()) continue;
                if ("assistant".equals(turn.optString("role"))) params.addAssistantMessage(text);
                else params.addUserMessage(text);
            }

            Message response = client.messages().create(params.build());
            StopReason stop = response.stopReason().orElse(null);
            if (StopReason.REFUSAL.equals(stop)) {
                return out.put("ok", false).put("error", "Claude declined to answer that request.").toString();
            }
            StringBuilder text = new StringBuilder();
            for (ContentBlock block : response.content()) {
                block.text().ifPresent(t -> text.append(t.text()));
            }
            if (StopReason.MAX_TOKENS.equals(stop) || text.length() == 0) {
                return out.put("ok", false).put("error", "The answer was cut off. Try a narrower question.").toString();
            }
            JSONObject reply = new JSONObject(text.toString());
            return out.put("ok", true)
                .put("answer", reply.optString("answer", ""))
                .put("proposals", reply.optJSONArray("proposals") != null ? reply.optJSONArray("proposals") : new JSONArray())
                .toString();
        } catch (UnauthorizedException e) {
            return error(out, "Your API key was rejected. Check it in AI assistant settings.");
        } catch (PermissionDeniedException e) {
            return error(out, "This API key doesn't have access to " + MODEL + ".");
        } catch (RateLimitException e) {
            return error(out, "Rate limited by the Claude API. Wait a moment and try again.");
        } catch (BadRequestException e) {
            return error(out, "The request was rejected: " + e.getMessage());
        } catch (AnthropicServiceException e) {
            return error(out, "Claude API error (" + e.statusCode() + "). Try again shortly.");
        } catch (AnthropicIoException e) {
            return error(out, "Couldn't reach the Claude API. Check your internet connection.");
        } catch (Exception e) {
            return error(out, "Something went wrong: " + e.getMessage());
        }
    }

    private static String error(JSONObject out, String message) {
        try { return out.put("ok", false).put("error", message).toString(); }
        catch (Exception e) { return "{\"ok\":false,\"error\":\"error\"}"; }
    }

    private static JsonOutputFormat.Schema replySchema() {
        Map<String, Object> str = new HashMap<>();
        str.put("type", "string");
        Map<String, Object> proposalProps = new HashMap<>();
        proposalProps.put("tx_id", str);
        proposalProps.put("category", str);
        proposalProps.put("subcategory", str);
        proposalProps.put("reason", str);
        Map<String, Object> proposal = new HashMap<>();
        proposal.put("type", "object");
        proposal.put("properties", proposalProps);
        proposal.put("required", Arrays.asList("tx_id", "category", "subcategory", "reason"));
        proposal.put("additionalProperties", false);
        Map<String, Object> proposals = new HashMap<>();
        proposals.put("type", "array");
        proposals.put("items", proposal);
        Map<String, Object> props = new HashMap<>();
        props.put("answer", str);
        props.put("proposals", proposals);
        return JsonOutputFormat.Schema.builder()
            .putAdditionalProperty("type", JsonValue.from("object"))
            .putAdditionalProperty("properties", JsonValue.from(props))
            .putAdditionalProperty("required", JsonValue.from(Arrays.asList("answer", "proposals")))
            .putAdditionalProperty("additionalProperties", JsonValue.from(false))
            .build();
    }
}
