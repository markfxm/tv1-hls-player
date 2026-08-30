package com.tv1.player;

import android.net.Uri;

import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;

import java.io.IOException;
import java.util.List;
import java.util.Map;

public final class InstrumentedDataSource implements DataSource {
    private final DataSource delegate;
    private final TransferDiagnostics diagnostics;
    private DataSpec currentDataSpec;

    public InstrumentedDataSource(DataSource delegate, TransferDiagnostics diagnostics) {
        this.delegate = delegate;
        this.diagnostics = diagnostics;
    }

    @Override
    public void addTransferListener(androidx.media3.datasource.TransferListener transferListener) {
        delegate.addTransferListener(transferListener);
    }

    @Override
    public long open(DataSpec dataSpec) throws IOException {
        currentDataSpec = dataSpec;
        diagnostics.beginBeforeOpen(delegate, dataSpec);
        try {
            return delegate.open(dataSpec);
        } catch (IOException error) {
            diagnostics.failFromWrapper(delegate, dataSpec, error);
            throw error;
        }
    }

    @Override
    public int read(byte[] buffer, int offset, int length) throws IOException {
        try {
            return delegate.read(buffer, offset, length);
        } catch (IOException error) {
            diagnostics.failFromWrapper(delegate, currentDataSpec, error);
            throw error;
        }
    }

    @Override
    public Uri getUri() {
        return delegate.getUri();
    }

    @Override
    public Map<String, List<String>> getResponseHeaders() {
        return delegate.getResponseHeaders();
    }

    @Override
    public void close() throws IOException {
        try {
            delegate.close();
        } catch (IOException error) {
            diagnostics.failFromWrapper(delegate, currentDataSpec, error);
            throw error;
        }
        diagnostics.finishFromWrapper(delegate);
        currentDataSpec = null;
    }
}
