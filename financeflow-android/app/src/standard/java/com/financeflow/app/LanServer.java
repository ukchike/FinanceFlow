package com.financeflow.app;

/** The standard build has no network permission, so no Wi-Fi editor. */
public final class LanServer {
    public static final boolean AVAILABLE = false;

    public interface Host {
        String eval(String js, long timeoutMs);
        String asset(String name);
    }

    private LanServer() {}

    public static String start(Host host) { return "{\"running\":false,\"error\":\"The Wi-Fi editor is only in the Full build.\"}"; }
    public static void stop() {}
    public static String status() { return "{\"running\":false}"; }
}
