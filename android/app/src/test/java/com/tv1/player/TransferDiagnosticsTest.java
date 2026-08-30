package com.tv1.player;

import android.net.Uri;

import androidx.media3.datasource.DataSource;
import androidx.media3.datasource.DataSpec;
import androidx.media3.datasource.TransferListener;

import org.junit.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

public class TransferDiagnosticsTest {

    @Test
    public void normalTransferEmitsStartAndEndOnce() throws Exception {
        CapturingEventSink sink = new CapturingEventSink();
        TransferDiagnostics diagnostics = new TransferDiagnostics("DEFAULT", sink);
        FakeDataSource rawDelegate = new FakeDataSource();
        rawDelegate.addTransferListener(diagnostics);
        InstrumentedDataSource wrapper = new InstrumentedDataSource(rawDelegate, diagnostics);
        DataSpec dataSpec = dataSpec("https://user:pass@example.com/live/index.m3u8?token=secret");

        wrapper.open(dataSpec);
        rawDelegate.notifyTransferStart(dataSpec);
        rawDelegate.notifyBytesTransferred(dataSpec, 7);
        rawDelegate.notifyBytesTransferred(dataSpec, 5);
        rawDelegate.notifyTransferEnd(dataSpec);
        wrapper.close();

        assertEquals(2, sink.events.size());
        assertEquals("TRANSFER_START", sink.events.get(0).event);
        assertEquals("TRANSFER_END", sink.events.get(1).event);
        assertEquals(sink.events.get(0).fields.get("transferId"), sink.events.get(1).fields.get("transferId"));
        assertEquals("12", sink.events.get(1).fields.get("bytes"));
        assertEquals("DEFAULT", sink.events.get(1).fields.get("backend"));
        assertEquals("example.com/live/index.m3u8", sink.events.get(1).fields.get("node"));
        assertFalse(sink.events.get(1).fields.get("node").contains("token"));
        assertFalse(sink.events.get(1).fields.get("node").contains("user:pass"));
        assertEquals(0, diagnostics.getActiveTransferCount());
    }

    @Test
    public void openExceptionBeforeListenerStartEmitsStartAndErrorOnce() throws Exception {
        CapturingEventSink sink = new CapturingEventSink();
        TransferDiagnostics diagnostics = new TransferDiagnostics("DEFAULT", sink);
        FakeDataSource rawDelegate = new FakeDataSource();
        rawDelegate.addTransferListener(diagnostics);
        rawDelegate.openException = new IOException("open failed");
        InstrumentedDataSource wrapper = new InstrumentedDataSource(rawDelegate, diagnostics);
        DataSpec dataSpec = dataSpec("https://example.com/live/index.m3u8");

        try {
            wrapper.open(dataSpec);
            fail("Expected open to throw");
        } catch (IOException expected) {
            assertEquals("open failed", expected.getMessage());
        }

        assertEquals(2, sink.events.size());
        assertEquals("TRANSFER_START", sink.events.get(0).event);
        assertEquals("TRANSFER_ERROR", sink.events.get(1).event);
        assertEquals(sink.events.get(0).fields.get("transferId"), sink.events.get(1).fields.get("transferId"));
        assertEquals(0, diagnostics.getActiveTransferCount());
    }

    @Test
    public void listenerTransferStartReusesExistingRawDelegateState() {
        CapturingEventSink sink = new CapturingEventSink();
        TransferDiagnostics diagnostics = new TransferDiagnostics("OKHTTP", sink);
        FakeDataSource rawDelegate = new FakeDataSource();
        rawDelegate.addTransferListener(diagnostics);
        DataSpec dataSpec = dataSpec("https://example.com/live/index.m3u8");

        diagnostics.beginBeforeOpen(rawDelegate, dataSpec);
        long transferId = diagnostics.getTransferIdForTest(rawDelegate);

        rawDelegate.notifyTransferStart(dataSpec);

        assertEquals(1, sink.events.size());
        assertEquals("TRANSFER_START", sink.events.get(0).event);
        assertEquals(1, diagnostics.getActiveTransferCount());
        assertEquals(transferId, diagnostics.getTransferIdForTest(rawDelegate));
    }

    @Test
    public void readExceptionEmitsErrorAndSuppressesLaterEnd() throws Exception {
        CapturingEventSink sink = new CapturingEventSink();
        TransferDiagnostics diagnostics = new TransferDiagnostics("DEFAULT", sink);
        FakeDataSource rawDelegate = new FakeDataSource();
        rawDelegate.addTransferListener(diagnostics);
        rawDelegate.readException = new IOException("read failed");
        InstrumentedDataSource wrapper = new InstrumentedDataSource(rawDelegate, diagnostics);
        DataSpec dataSpec = dataSpec("https://example.com/live/index.m3u8");

        wrapper.open(dataSpec);
        rawDelegate.notifyTransferStart(dataSpec);

        try {
            wrapper.read(new byte[8], 0, 8);
            fail("Expected read to throw");
        } catch (IOException expected) {
            assertEquals("read failed", expected.getMessage());
        }

        rawDelegate.notifyTransferEnd(dataSpec);
        wrapper.close();

        assertEquals(2, sink.events.size());
        assertEquals("TRANSFER_START", sink.events.get(0).event);
        assertEquals("TRANSFER_ERROR", sink.events.get(1).event);
        assertEquals(0, diagnostics.getActiveTransferCount());
    }

    @Test
    public void closeExceptionEmitsErrorAndSuppressesLaterEnd() throws Exception {
        CapturingEventSink sink = new CapturingEventSink();
        TransferDiagnostics diagnostics = new TransferDiagnostics("DEFAULT", sink);
        FakeDataSource rawDelegate = new FakeDataSource();
        rawDelegate.addTransferListener(diagnostics);
        rawDelegate.closeException = new IOException("close failed");
        InstrumentedDataSource wrapper = new InstrumentedDataSource(rawDelegate, diagnostics);
        DataSpec dataSpec = dataSpec("https://example.com/live/index.m3u8");

        wrapper.open(dataSpec);
        rawDelegate.notifyTransferStart(dataSpec);

        try {
            wrapper.close();
            fail("Expected close to throw");
        } catch (IOException expected) {
            assertEquals("close failed", expected.getMessage());
        }

        rawDelegate.notifyTransferEnd(dataSpec);

        assertEquals(2, sink.events.size());
        assertEquals("TRANSFER_START", sink.events.get(0).event);
        assertEquals("TRANSFER_ERROR", sink.events.get(1).event);
        assertEquals(0, diagnostics.getActiveTransferCount());
    }

    @Test
    public void activeStateTracksConcurrentRawDelegatesSeparately() throws Exception {
        CapturingEventSink sink = new CapturingEventSink();
        TransferDiagnostics diagnostics = new TransferDiagnostics("DEFAULT", sink);
        FakeDataSource firstRawDelegate = new FakeDataSource();
        FakeDataSource secondRawDelegate = new FakeDataSource();
        firstRawDelegate.addTransferListener(diagnostics);
        secondRawDelegate.addTransferListener(diagnostics);
        InstrumentedDataSource firstWrapper = new InstrumentedDataSource(firstRawDelegate, diagnostics);
        InstrumentedDataSource secondWrapper = new InstrumentedDataSource(secondRawDelegate, diagnostics);
        DataSpec firstDataSpec = dataSpec("https://alpha.example.com/live/a.m3u8");
        DataSpec secondDataSpec = dataSpec("https://beta.example.com/live/b.m3u8");

        firstWrapper.open(firstDataSpec);
        secondWrapper.open(secondDataSpec);
        firstRawDelegate.notifyTransferStart(firstDataSpec);
        secondRawDelegate.notifyTransferStart(secondDataSpec);
        firstRawDelegate.notifyBytesTransferred(firstDataSpec, 3);
        secondRawDelegate.notifyBytesTransferred(secondDataSpec, 8);

        assertEquals(2, diagnostics.getActiveTransferCount());
        assertNotEquals(
                diagnostics.getTransferIdForTest(firstRawDelegate),
                diagnostics.getTransferIdForTest(secondRawDelegate));

        firstRawDelegate.notifyTransferEnd(firstDataSpec);
        secondRawDelegate.notifyTransferEnd(secondDataSpec);
        firstWrapper.close();
        secondWrapper.close();

        assertEquals(4, sink.events.size());
        assertEquals("3", sink.events.get(2).fields.get("bytes"));
        assertEquals("8", sink.events.get(3).fields.get("bytes"));
        assertEquals(0, diagnostics.getActiveTransferCount());
    }

    @Test
    public void wrapperIdentityDoesNotCreateOrphanState() throws Exception {
        CapturingEventSink sink = new CapturingEventSink();
        TransferDiagnostics diagnostics = new TransferDiagnostics("DEFAULT", sink);
        FakeDataSource rawDelegate = new FakeDataSource();
        rawDelegate.addTransferListener(diagnostics);
        InstrumentedDataSource wrapper = new InstrumentedDataSource(rawDelegate, diagnostics);
        DataSpec dataSpec = dataSpec("https://example.com/live/index.m3u8");

        wrapper.open(dataSpec);

        assertTrue(diagnostics.hasActiveTransferForTest(rawDelegate));
        assertFalse(diagnostics.hasActiveTransferForTest(wrapper));
        assertEquals(1, diagnostics.getActiveTransferCount());

        rawDelegate.notifyTransferEnd(dataSpec);
        wrapper.close();

        assertEquals(0, diagnostics.getActiveTransferCount());
    }

    private static DataSpec dataSpec(String url) {
        return new DataSpec(Uri.parse(url));
    }

    private static final class CapturingEventSink implements EventSink {
        final List<EventRecord> events = new ArrayList<>();

        @Override
        public void log(String event, Map<String, String> fields) {
            events.add(new EventRecord(event, new HashMap<>(fields)));
        }
    }

    private static final class EventRecord {
        final String event;
        final Map<String, String> fields;

        EventRecord(String event, Map<String, String> fields) {
            this.event = event;
            this.fields = fields;
        }
    }

    private static final class FakeDataSource implements DataSource {
        private final List<TransferListener> listeners = new ArrayList<>();
        private IOException openException;
        private IOException readException;
        private IOException closeException;
        private Uri uri;

        @Override
        public void addTransferListener(TransferListener transferListener) {
            listeners.add(transferListener);
        }

        @Override
        public long open(DataSpec dataSpec) throws IOException {
            uri = dataSpec.uri;
            if (openException != null) {
                throw openException;
            }
            return 1L;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (readException != null) {
                throw readException;
            }
            return -1;
        }

        @Override
        public Uri getUri() {
            return uri;
        }

        @Override
        public Map<String, List<String>> getResponseHeaders() {
            return new HashMap<>();
        }

        @Override
        public void close() throws IOException {
            if (closeException != null) {
                throw closeException;
            }
        }

        void notifyTransferStart(DataSpec dataSpec) {
            for (TransferListener listener : listeners) {
                listener.onTransferStart(this, dataSpec, true);
            }
        }

        void notifyBytesTransferred(DataSpec dataSpec, int bytesTransferred) {
            for (TransferListener listener : listeners) {
                listener.onBytesTransferred(this, dataSpec, true, bytesTransferred);
            }
        }

        void notifyTransferEnd(DataSpec dataSpec) {
            for (TransferListener listener : listeners) {
                listener.onTransferEnd(this, dataSpec, true);
            }
        }
    }
}
