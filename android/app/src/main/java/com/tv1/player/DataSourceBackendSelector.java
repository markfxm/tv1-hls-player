package com.tv1.player;

public final class DataSourceBackendSelector {
    private DataSourceBackendSelector() {
    }

    public static DataSourceBackend resolve(String override, boolean debugBuild) {
        if (!debugBuild) {
            return DataSourceBackend.DEFAULT;
        }
        if (override == null) {
            return DataSourceBackend.DEFAULT;
        }

        String normalized = override.trim();
        if (normalized.isEmpty()) {
            return DataSourceBackend.DEFAULT;
        }
        if ("okhttp".equalsIgnoreCase(normalized)) {
            return DataSourceBackend.OKHTTP;
        }
        return DataSourceBackend.DEFAULT;
    }
}
