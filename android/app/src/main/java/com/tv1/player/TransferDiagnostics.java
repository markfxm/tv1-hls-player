package com.tv1.player;

import android.net.Uri;

import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.TransferListener;

import java.io.IOException;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

public final class TransferDiagnostics implements TransferListener {
    private final String backend;
    private final EventSink sink;
    private final AtomicLong nextTransferId = new AtomicLong(1L);
    private final IdentityHashMap<DataSource, TransferState> activeTransfers = new IdentityHashMap<>();

    public TransferDiagnostics(String backend, EventSink sink) {
        this.backend = backend;
        this.sink = sink;
    }

    public synchronized void beginBeforeOpen(DataSource source, DataSpec dataSpec) {
        TransferState existingState = activeTransfers.get(source);
        if (existingState != null && !existingState.terminal) {
            return;
        }

        TransferState state = new TransferState(backend, nextTransferId.getAndIncrement(), dataSpec, nowMs());
        activeTransfers.put(source, state);
        log("TRANSFER_START", state, null);
    }

    public synchronized void finishFromWrapper(DataSource source) {
        finish(source);
    }

    public synchronized void failFromWrapper(DataSource source, DataSpec dataSpec, IOException error) {
        TransferState state = activeTransfers.get(source);
        if (state == null || state.terminal) {
            return;
        }
        if (dataSpec != null) {
            state.node = safeNode(dataSpec);
        }
        state.terminal = true;
        log("TRANSFER_ERROR", state, error);
        activeTransfers.remove(source);
    }

    public synchronized int getActiveTransferCount() {
        return activeTransfers.size();
    }

    synchronized long getTransferIdForTest(DataSource source) {
        TransferState state = activeTransfers.get(source);
        return state == null ? -1L : state.transferId;
    }

    synchronized boolean hasActiveTransferForTest(DataSource source) {
        return activeTransfers.containsKey(source);
    }

    @Override
    public synchronized void onTransferInitializing(DataSource source, DataSpec dataSpec, boolean isNetwork) {
    }

    @Override
    public synchronized void onTransferStart(DataSource source, DataSpec dataSpec, boolean isNetwork) {
        TransferState state = activeTransfers.get(source);
        if (state == null || state.terminal) {
            return;
        }
        state.node = safeNode(dataSpec);
    }

    @Override
    public synchronized void onBytesTransferred(
            DataSource source,
            DataSpec dataSpec,
            boolean isNetwork,
            int bytesTransferred) {
        TransferState state = activeTransfers.get(source);
        if (state == null || state.terminal || bytesTransferred <= 0) {
            return;
        }
        state.bytes = saturatedAdd(state.bytes, bytesTransferred);
    }

    @Override
    public synchronized void onTransferEnd(DataSource source, DataSpec dataSpec, boolean isNetwork) {
        finish(source);
    }

    private void finish(DataSource source) {
        TransferState state = activeTransfers.get(source);
        if (state == null || state.terminal) {
            return;
        }
        state.terminal = true;
        log("TRANSFER_END", state, null);
        activeTransfers.remove(source);
    }

    private void log(String event, TransferState state, IOException error) {
        if (sink == null) {
            return;
        }

        Map<String, String> fields = new HashMap<>();
        long durationMs = Math.max(0L, nowMs() - state.startMs);
        fields.put("tag", "[A5-NET]");
        fields.put("backend", state.backend);
        fields.put("transferId", Long.toString(state.transferId));
        fields.put("node", state.node);
        fields.put("bytes", Long.toString(state.bytes));
        fields.put("durationMs", Long.toString(durationMs));
        fields.put("slowTransfer5s", Boolean.toString(durationMs >= 5000L));
        fields.put("verySlowTransfer15s", Boolean.toString(durationMs >= 15000L));
        fields.put("throughput", throughputBytesPerSecond(state.bytes, durationMs));
        if (error != null) {
            fields.put("error", error.getClass().getSimpleName());
            if (error.getMessage() != null) {
                fields.put("message", error.getMessage());
            }
        }
        sink.log(event, fields);
    }

    private static String throughputBytesPerSecond(long bytes, long durationMs) {
        if (durationMs <= 0L || bytes <= 0L) {
            return "0";
        }
        return Long.toString((bytes * 1000L) / durationMs);
    }

    private static long saturatedAdd(long value, int increment) {
        long result = value + increment;
        if (result < value) {
            return Long.MAX_VALUE;
        }
        return result;
    }

    private static long nowMs() {
        return System.currentTimeMillis();
    }

    private static String safeNode(DataSpec dataSpec) {
        if (dataSpec == null || dataSpec.uri == null) {
            return "";
        }

        Uri uri = dataSpec.uri;
        String host = uri.getHost();
        String path = uri.getPath();
        if (host == null) {
            host = "";
        }
        if (path == null) {
            path = "";
        }
        if (host.isEmpty()) {
            return path;
        }
        return host + path;
    }

    private static final class TransferState {
        final String backend;
        final long transferId;
        final long startMs;
        String node;
        long bytes;
        boolean terminal;

        TransferState(String backend, long transferId, DataSpec dataSpec, long startMs) {
            this.backend = backend;
            this.transferId = transferId;
            this.startMs = startMs;
            this.node = safeNode(dataSpec);
        }
    }
}

interface EventSink {
    void log(String event, Map<String, String> fields);
}
