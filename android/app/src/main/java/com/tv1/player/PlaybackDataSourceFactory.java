package com.tv1.player;

import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.okhttp.OkHttpDataSource;

import okhttp3.OkHttpClient;

public final class PlaybackDataSourceFactory {
    private PlaybackDataSourceFactory() {
    }

    public static DataSource.Factory create(
            DataSourceBackend backend,
            TransferDiagnostics diagnostics) {
        switch (backend) {
            case OKHTTP:
                OkHttpDataSource.Factory okHttpFactory =
                        new OkHttpDataSource.Factory(new OkHttpClient.Builder().build());
                okHttpFactory.setTransferListener(diagnostics);
                return new InstrumentedDataSourceFactory(okHttpFactory, diagnostics);
            case DEFAULT:
            default:
                DefaultHttpDataSource.Factory defaultFactory = new DefaultHttpDataSource.Factory();
                defaultFactory.setTransferListener(diagnostics);
                return new InstrumentedDataSourceFactory(defaultFactory, diagnostics);
        }
    }
}
