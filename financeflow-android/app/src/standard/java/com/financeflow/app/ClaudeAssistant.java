package com.financeflow.app;

/** The standard build ships without the AI assistant (no SDK, no network permission). */
public final class ClaudeAssistant {
    public static final boolean AVAILABLE = false;

    private ClaudeAssistant() {}

    public static String ask(String apiKey, String contextJson, String historyJson) {
        return "{\"ok\":false,\"error\":\"The AI assistant is only in the Full build.\"}";
    }
}
