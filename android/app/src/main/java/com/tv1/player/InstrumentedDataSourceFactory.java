package com.tv1.player;

import androidx.media3.datasource.DataSource;

public final class InstrumentedDataSourceFactory implements DataSource.Factory {
    private final DataSource.Factory delegate;
    private final TransferDiagnostics diagnostics;

    public InstrumentedDataSourceFactory(DataSource.Factory delegate, TransferDiagnostics diagnostics) {
        this.delegate = delegate;
        this.diagnostics = diagnostics;
    }

    @Override
    public DataSource createDataSource() {
        return new InstrumentedDataSource(delegate.createDataSource(), diagnostics);
    }
}
