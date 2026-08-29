package com.tv1.player;

import android.content.Context;
import android.media.MediaCodecInfo;
import android.media.MediaCodecList;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Display;
import android.view.WindowManager;

import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.exoplayer.DecoderReuseEvaluation;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.analytics.AnalyticsListener;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Observation-only diagnostics for playback sessions on Egreat A5.
 *
 * This class deliberately has no playback-control API calls. It only reads
 * player, decoder, format, display, and timing information and writes
 * bounded diagnostic output to logcat.
 */
public final class PlaybackDiagnostics {
    private static final String TAG = "A5-DIAG";
    private static final String LOG_PREFIX = "[A5-DIAG]";
    private static final boolean ENABLE_PLAYBACK_DIAGNOSTICS = BuildConfig.DEBUG;
    private static final long SNAPSHOT_INTERVAL_MS = 5000L;
    private static final long BUFFER_STARVATION_THRESHOLD_MS = 250L;

    private final Context applicationContext;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable snapshotRunnable = new Runnable() {
        @Override
        public void run() {
            if (!sessionActive || player == null || !attached) {
                return;
            }
            logSnapshot();
            if (sessionActive && player != null && attached) {
                handler.postDelayed(snapshotRunnable, SNAPSHOT_INTERVAL_MS);
            }
        }
    };

    private final AnalyticsListener analyticsListener = new AnalyticsListener() {
        @Override
        public void onPlaybackStateChanged(AnalyticsListener.EventTime eventTime, int playbackState) {
            handlePlaybackStateChanged(playbackState);
        }

        @Override
        public void onIsPlayingChanged(AnalyticsListener.EventTime eventTime, boolean isPlaying) {
            if (!isSessionLogging()) {
                return;
            }
            lastIsPlaying = isPlaying;
            if (isPlaying) {
                hasStartedPlayback = true;
            }
            logLine("IS_PLAYING", "playing=" + isPlaying);
        }

        @Override
        public void onIsLoadingChanged(AnalyticsListener.EventTime eventTime, boolean isLoading) {
            if (!isSessionLogging()) {
                return;
            }
            lastIsLoading = isLoading;
            logLine("IS_LOADING", "loading=" + isLoading);
        }

        @Override
        public void onPlayerError(AnalyticsListener.EventTime eventTime, PlaybackException error) {
            if (!isSessionLogging()) {
                return;
            }
            String errorCode = error == null ? "unknown" : error.getErrorCodeName();
            logLine("PLAYER_ERROR", "error=" + errorCode);
        }

        @Override
        public void onBandwidthEstimate(
                AnalyticsListener.EventTime eventTime,
                int totalLoadTimeMs,
                long totalBytesLoaded,
                long bitrateEstimate) {
            if (!isSessionLogging()) {
                return;
            }
            estimatedBitrate = knownLong(bitrateEstimate);
            bytesTransferred = knownLong(totalBytesLoaded);
            bandwidthElapsedMs = knownLong(totalLoadTimeMs);
            logLine(
                    "BANDWIDTH",
                    "estimatebps=" + formatLong(estimatedBitrate)
                            + " bytesTransferred=" + formatLong(bytesTransferred)
                            + " elapsedMs=" + formatLong(bandwidthElapsedMs));
        }

        @Override
        public void onAudioDecoderInitialized(
                AnalyticsListener.EventTime eventTime,
                String decoderName,
                long initializedTimestampMs,
                long initializationDurationMs) {
            if (!isSessionLogging()) {
                return;
            }
            audioDecoder = valueOrUnknown(decoderName);
            audioDecoderInitMs = knownLong(initializationDurationMs);
            audioDecoderInfo = inspectDecoder(decoderName);
            logDecoder();
        }

        @Override
        public void onAudioDecoderReleased(
                AnalyticsListener.EventTime eventTime,
                String decoderName) {
            if (isSessionLogging()) {
                logLine("DECODER_RELEASED", "audioDecoder=" + valueOrUnknown(decoderName));
            }
        }

        @Override
        public void onAudioInputFormatChanged(
                AnalyticsListener.EventTime eventTime,
                Format format,
                DecoderReuseEvaluation decoderReuseEvaluation) {
            if (!isSessionLogging() || format == null) {
                return;
            }
            audioMime = valueOrUnknown(format.sampleMimeType);
            audioCodec = valueOrUnknown(format.codecs);
            audioChannels = knownInt(format.channelCount);
            audioSampleRate = knownInt(format.sampleRate);
            audioBitrate = knownInt(format.bitrate);
            logLine(
                    "AUDIO_FORMAT",
                    "mime=" + audioMime
                            + " codecs=" + audioCodec
                            + " channels=" + formatInt(audioChannels)
                            + " sampleRate=" + formatInt(audioSampleRate)
                            + " bitrate=" + formatInt(audioBitrate));
        }

        @Override
        public void onAudioUnderrun(
                AnalyticsListener.EventTime eventTime,
                int bufferSize,
                long bufferSizeMs,
                long elapsedSinceLastFeedMs) {
            if (!isSessionLogging()) {
                return;
            }
            audioUnderrunCount += 1;
            logLine(
                    "AUDIO_UNDERRUN",
                            "count=" + audioUnderrunCount
                            + " bufferSize=" + knownInt(bufferSize)
                            + " bufferSizeMs=" + formatLong(knownLong(bufferSizeMs))
                            + " elapsedSinceLastFeedMs=" + formatLong(knownLong(elapsedSinceLastFeedMs)));
        }

        @Override
        public void onVideoDecoderInitialized(
                AnalyticsListener.EventTime eventTime,
                String decoderName,
                long initializedTimestampMs,
                long initializationDurationMs) {
            if (!isSessionLogging()) {
                return;
            }
            videoDecoder = valueOrUnknown(decoderName);
            videoDecoderInitMs = knownLong(initializationDurationMs);
            videoDecoderInfo = inspectDecoder(decoderName);
            logDecoder();
        }

        @Override
        public void onVideoDecoderReleased(
                AnalyticsListener.EventTime eventTime,
                String decoderName) {
            if (isSessionLogging()) {
                logLine("DECODER_RELEASED", "videoDecoder=" + valueOrUnknown(decoderName));
            }
        }

        @Override
        public void onVideoInputFormatChanged(
                AnalyticsListener.EventTime eventTime,
                Format format,
                DecoderReuseEvaluation decoderReuseEvaluation) {
            if (!isSessionLogging() || format == null) {
                return;
            }
            videoMime = valueOrUnknown(format.sampleMimeType);
            videoCodec = valueOrUnknown(format.codecs);
            videoWidth = knownInt(format.width);
            videoHeight = knownInt(format.height);
            videoFrameRate = knownFloat(format.frameRate);
            videoBitrate = knownInt(format.bitrate);
            videoAverageBitrate = knownInt(format.averageBitrate);
            videoPeakBitrate = knownInt(format.peakBitrate);
            videoPixelRatio = knownFloat(format.pixelWidthHeightRatio);
            logLine(
                    "VIDEO_FORMAT",
                    "mime=" + videoMime
                            + " codec=" + videoCodec
                            + " resolution=" + formatResolution(videoWidth, videoHeight)
                            + " fps=" + formatFloat(videoFrameRate)
                            + " bitrate=" + formatInt(videoBitrate)
                            + " averageBitrate=" + formatInt(videoAverageBitrate)
                            + " peakBitrate=" + formatInt(videoPeakBitrate)
                            + " pixelWidthHeightRatio=" + formatFloat(videoPixelRatio)
                            + " frameRateRelation=" + frameRateRelation()
                            + " frameRateMismatch=" + frameRateMismatch());
        }

        @Override
        public void onDroppedVideoFrames(
                AnalyticsListener.EventTime eventTime,
                int droppedFrames,
                long elapsedMs) {
            if (!isSessionLogging()) {
                return;
            }
            droppedFramesInterval = Math.max(0, droppedFrames);
            droppedFramesTotal += droppedFramesInterval;
            droppedFrameCallbacks += 1;
            logLine(
                    "DROPPED_FRAMES",
                    "intervalDropped=" + droppedFramesInterval
                            + " elapsedMs=" + formatLong(knownLong(elapsedMs))
                            + " totalDropped=" + droppedFramesTotal);
        }

        @Override
        public void onVideoFrameProcessingOffset(
                AnalyticsListener.EventTime eventTime,
                long totalProcessingOffsetUs,
                int frameCount) {
            if (!isSessionLogging()) {
                return;
            }
            if (frameCount > 0) {
                frameProcessingOffsetTotalUs += totalProcessingOffsetUs;
                frameProcessingSamples += frameCount;
            }
            logLine(
                    "FRAME_PROCESSING",
                    "frameProcessingOffsetAvgUs=" + formatLong(frameProcessingOffsetAverageUs())
                            + " frameProcessingSamples=" + frameProcessingSamples);
        }
    };

    private ExoPlayer player;
    private boolean attached;
    private boolean sessionActive;
    private long sessionSequence;
    private long sessionStartMs;
    private String sessionId = "unknown";
    private String nodeId = "unknown";
    private String urlHost = "unknown";
    private String urlHash = "unknown";

    private String videoDecoder = "unknown";
    private long videoDecoderInitMs = C.TIME_UNSET;
    private DecoderInfo videoDecoderInfo = DecoderInfo.unknown();
    private String audioDecoder = "unknown";
    private long audioDecoderInitMs = C.TIME_UNSET;
    private DecoderInfo audioDecoderInfo = DecoderInfo.unknown();

    private String videoMime = "unknown";
    private String videoCodec = "unknown";
    private int videoWidth = Format.NO_VALUE;
    private int videoHeight = Format.NO_VALUE;
    private float videoFrameRate = Float.NaN;
    private int videoBitrate = Format.NO_VALUE;
    private int videoAverageBitrate = Format.NO_VALUE;
    private int videoPeakBitrate = Format.NO_VALUE;
    private float videoPixelRatio = Float.NaN;

    private String audioMime = "unknown";
    private String audioCodec = "unknown";
    private int audioChannels = Format.NO_VALUE;
    private int audioSampleRate = Format.NO_VALUE;
    private int audioBitrate = Format.NO_VALUE;

    private int displayWidth = Format.NO_VALUE;
    private int displayHeight = Format.NO_VALUE;
    private float displayRefreshRate = Float.NaN;
    private String supportedModes = "unknown";

    private int lastPlaybackState = Player.STATE_IDLE;
    private boolean lastIsPlaying;
    private boolean lastIsLoading;
    private boolean hasStartedPlayback;
    private long bufferingStartMs = C.TIME_UNSET;
    private int rebufferCount;
    private long totalRebufferDurationMs;
    private long longestRebufferMs;
    private boolean bufferStarvationObserved;

    private long droppedFramesInterval;
    private long droppedFramesTotal;
    private long droppedFrameCallbacks;
    private long frameProcessingOffsetTotalUs;
    private long frameProcessingSamples;
    private long audioUnderrunCount;

    private long estimatedBitrate = C.TIME_UNSET;
    private long bytesTransferred = C.TIME_UNSET;
    private long bandwidthElapsedMs = C.TIME_UNSET;

    private long lastBufferedDurationMs = C.TIME_UNSET;
    private long bufferSampleCount;
    private long bufferTotalMs;
    private long bufferMinMs = Long.MAX_VALUE;
    private long bufferMaxMs = Long.MIN_VALUE;
    private long liveOffsetSampleCount;
    private long liveOffsetTotalMs;
    private long liveOffsetMaxMs = Long.MIN_VALUE;

    public PlaybackDiagnostics(Context context) {
        applicationContext = context == null ? null : context.getApplicationContext();
    }

    public void attach(ExoPlayer player) {
        if (player == null) {
            return;
        }
        if (this.player == player && attached) {
            return;
        }
        detach();
        this.player = player;
        this.player.addAnalyticsListener(analyticsListener);
        attached = true;
    }

    public void detach() {
        handler.removeCallbacks(snapshotRunnable);
        if (player != null && attached) {
            player.removeAnalyticsListener(analyticsListener);
        }
        attached = false;
        stopSession();
        player = null;
    }

    public void startSession(String url) {
        stopSession();
        if (!ENABLE_PLAYBACK_DIAGNOSTICS) {
            return;
        }
        sessionSequence += 1;
        sessionStartMs = System.currentTimeMillis();
        sessionId = createSessionId(sessionStartMs, sessionSequence);
        sessionActive = true;
        resetMetrics();
        setNodeIdentity(url);
        readDisplayMode();
        if (player != null) {
            lastPlaybackState = player.getPlaybackState();
            lastIsPlaying = player.isPlaying();
            lastIsLoading = player.isLoading();
        }
        logLine(
                "SESSION_START",
                "nodeId=" + nodeId + " urlHost=" + urlHost + " urlHash=" + urlHash);
        logDisplay();
        handler.removeCallbacks(snapshotRunnable);
        handler.postDelayed(snapshotRunnable, SNAPSHOT_INTERVAL_MS);
    }

    public void stopSession() {
        handler.removeCallbacks(snapshotRunnable);
        if (!sessionActive) {
            return;
        }
        if (lastPlaybackState == Player.STATE_BUFFERING && bufferingStartMs != C.TIME_UNSET) {
            finishBufferingInterval(System.currentTimeMillis());
        }
        logSessionSummary();
        sessionActive = false;
    }

    public void logSnapshot() {
        if (!isSessionLogging() || player == null) {
            return;
        }
        long bufferedPositionMs = player.getBufferedPosition();
        long bufferedDurationMs = player.getTotalBufferedDuration();
        long liveOffsetMs = player.getCurrentLiveOffset();
        observeBuffer(bufferedDurationMs, liveOffsetMs);
        logLine(
                "SNAPSHOT",
                "playbackState=" + stateName(player.getPlaybackState())
                        + " playing=" + player.isPlaying()
                        + " loading=" + player.isLoading()
                        + " playWhenReady=" + player.getPlayWhenReady()
                        + " positionMs=" + formatLong(knownLong(player.getCurrentPosition()))
                        + " bufferedPositionMs=" + formatLong(knownLong(bufferedPositionMs))
                        + " totalBufferedDurationMs=" + formatLong(knownLong(bufferedDurationMs))
                        + " currentLiveOffsetMs=" + formatLong(knownLong(liveOffsetMs))
                        + " droppedTotal=" + droppedFramesTotal
                        + " audioUnderruns=" + audioUnderrunCount
                        + " videoDecoder=" + videoDecoder
                        + " video=" + formatResolution(videoWidth, videoHeight) + "@" + formatFloat(videoFrameRate)
                        + " display=" + formatResolution(displayWidth, displayHeight) + "@" + formatFloat(displayRefreshRate)
                        + " frameRateRelation=" + frameRateRelation()
                        + " frameRateMismatch=" + frameRateMismatch());
    }

    private void handlePlaybackStateChanged(int playbackState) {
        if (!isSessionLogging()) {
            return;
        }
        int previousState = lastPlaybackState;
        lastPlaybackState = playbackState;
        if (previousState != playbackState) {
            logLine("STATE", stateName(previousState) + " -> " + stateName(playbackState));
        }
        if (playbackState == Player.STATE_READY) {
            hasStartedPlayback = true;
        }
        if (playbackState == Player.STATE_BUFFERING && previousState != Player.STATE_BUFFERING) {
            bufferingStartMs = System.currentTimeMillis();
            if (hasStartedPlayback) {
                rebufferCount += 1;
            }
            if (player != null && isNearBufferEmpty(player.getTotalBufferedDuration())) {
                bufferStarvationObserved = true;
            }
            logLine("BUFFERING_START", "bufferedDurationMs=" + formatLong(currentBufferedDuration()));
        } else if (previousState == Player.STATE_BUFFERING && playbackState != Player.STATE_BUFFERING) {
            finishBufferingInterval(System.currentTimeMillis());
            logLine("BUFFERING_END", "state=" + stateName(playbackState));
        }
    }

    private void finishBufferingInterval(long endMs) {
        if (bufferingStartMs == C.TIME_UNSET) {
            return;
        }
        long durationMs = Math.max(0L, endMs - bufferingStartMs);
        if (hasStartedPlayback) {
            totalRebufferDurationMs += durationMs;
            longestRebufferMs = Math.max(longestRebufferMs, durationMs);
        }
        bufferingStartMs = C.TIME_UNSET;
    }

    private void observeBuffer(long bufferedDurationMs, long liveOffsetMs) {
        lastBufferedDurationMs = knownLong(bufferedDurationMs);
        if (isKnownNonNegative(bufferedDurationMs)) {
            bufferSampleCount += 1;
            bufferTotalMs += bufferedDurationMs;
            bufferMinMs = Math.min(bufferMinMs, bufferedDurationMs);
            bufferMaxMs = Math.max(bufferMaxMs, bufferedDurationMs);
            if (lastPlaybackState == Player.STATE_BUFFERING && isNearBufferEmpty(bufferedDurationMs)) {
                bufferStarvationObserved = true;
            }
        }
        if (isKnownNonNegative(liveOffsetMs)) {
            liveOffsetSampleCount += 1;
            liveOffsetTotalMs += liveOffsetMs;
            liveOffsetMaxMs = Math.max(liveOffsetMaxMs, liveOffsetMs);
        }
    }

    private void logDecoder() {
        logLine(
                "DECODER",
                "videoDecoder=" + videoDecoder
                        + " audioDecoder=" + audioDecoder
                        + " videoDecoderInitMs=" + formatLong(videoDecoderInitMs)
                        + " audioDecoderInitMs=" + formatLong(audioDecoderInitMs)
                        + " videoHardwareAccelerated=" + videoDecoderInfo.hardwareAccelerated
                        + " videoSoftwareOnly=" + videoDecoderInfo.softwareOnly
                        + " videoVendor=" + videoDecoderInfo.vendor
                        + " audioHardwareAccelerated=" + audioDecoderInfo.hardwareAccelerated
                        + " audioSoftwareOnly=" + audioDecoderInfo.softwareOnly
                        + " audioVendor=" + audioDecoderInfo.vendor
                        + " videoDecoderClassification=" + videoDecoderInfo.classification
                        + " audioDecoderClassification=" + audioDecoderInfo.classification);
    }

    private void readDisplayMode() {
        displayWidth = Format.NO_VALUE;
        displayHeight = Format.NO_VALUE;
        displayRefreshRate = Float.NaN;
        supportedModes = "unknown";
        if (applicationContext == null) {
            return;
        }
        WindowManager windowManager = (WindowManager) applicationContext.getSystemService(Context.WINDOW_SERVICE);
        if (windowManager == null) {
            return;
        }
        Display display = windowManager.getDefaultDisplay();
        if (display == null) {
            return;
        }
        Display.Mode mode = display.getMode();
        if (mode != null) {
            displayWidth = mode.getPhysicalWidth();
            displayHeight = mode.getPhysicalHeight();
            displayRefreshRate = mode.getRefreshRate();
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Display.Mode[] modes = display.getSupportedModes();
            if (modes != null && modes.length > 0) {
                List<String> values = new ArrayList<>();
                for (Display.Mode supportedMode : modes) {
                    values.add(
                            supportedMode.getPhysicalWidth()
                                    + "x" + supportedMode.getPhysicalHeight()
                                    + "@" + String.format(Locale.US, "%.3f", supportedMode.getRefreshRate()));
                }
                supportedModes = join(values, ",");
            }
        }
    }

    private void logDisplay() {
        logLine(
                "DISPLAY",
                "resolution=" + formatResolution(displayWidth, displayHeight)
                        + " refreshRate=" + formatFloat(displayRefreshRate)
                        + " supportedModes=" + supportedModes);
    }

    private void logSessionSummary() {
        long durationMs = Math.max(0L, System.currentTimeMillis() - sessionStartMs);
        logLine(
                "SESSION_SUMMARY",
                "durationMs=" + durationMs
                        + " videoMime=" + videoMime
                        + " resolution=" + formatResolution(videoWidth, videoHeight)
                        + " fps=" + formatFloat(videoFrameRate)
                        + " videoBitrate=" + formatInt(videoBitrate)
                        + " videoAverageBitrate=" + formatInt(videoAverageBitrate)
                        + " videoPeakBitrate=" + formatInt(videoPeakBitrate)
                        + " videoPixelWidthHeightRatio=" + formatFloat(videoPixelRatio)
                        + " audioMime=" + audioMime
                        + " audioCodec=" + audioCodec
                        + " audioChannels=" + formatInt(audioChannels)
                        + " audioSampleRate=" + formatInt(audioSampleRate)
                        + " audioBitrate=" + formatInt(audioBitrate)
                        + " videoCodec=" + videoCodec
                        + " videoDecoder=" + videoDecoder
                        + " videoDecoderInitMs=" + formatLong(videoDecoderInitMs)
                        + " audioDecoder=" + audioDecoder
                        + " audioDecoderInitMs=" + formatLong(audioDecoderInitMs)
                        + " decoderClassification=video:" + videoDecoderInfo.classification
                        + ",audio:" + audioDecoderInfo.classification
                        + " displayResolution=" + formatResolution(displayWidth, displayHeight)
                        + " displayRefreshRate=" + formatFloat(displayRefreshRate)
                        + " frameRateRelation=" + frameRateRelation()
                        + " frameRateMismatch=" + frameRateMismatch()
                        + " droppedFramesTotal=" + droppedFramesTotal
                        + " droppedFramesPerMinute=" + droppedFramesPerMinute(durationMs)
                        + " frameProcessingOffsetAvgUs=" + formatLong(frameProcessingOffsetAverageUs())
                        + " frameProcessingSamples=" + frameProcessingSamples
                        + " audioUnderrunCount=" + audioUnderrunCount
                        + " rebufferCount=" + rebufferCount
                        + " totalRebufferDurationMs=" + totalRebufferDurationMs
                        + " longestRebufferMs=" + longestRebufferMs
                        + " bufferMinMs=" + bufferMin()
                        + " bufferAvgMs=" + bufferAverage()
                        + " bufferMaxMs=" + bufferMax()
                        + " liveOffsetAvgMs=" + liveOffsetAverage()
                        + " liveOffsetMaxMs=" + liveOffsetMax()
                        + " estimatedBitrate=" + formatLong(estimatedBitrate)
                        + " bytesTransferred=" + formatLong(bytesTransferred)
                        + " bandwidthElapsedMs=" + formatLong(bandwidthElapsedMs)
                        + " diagnosticHints=" + diagnosticHint());
    }

    private String diagnosticHint() {
        List<String> signals = new ArrayList<>();
        if (bufferStarvationObserved) {
            signals.add("BUFFER_STARVATION");
        }
        if (droppedFramesTotal >= 10
                && droppedFrameCallbacks >= 2
                && bufferSampleCount >= 2
                && bufferAverageValue() >= 5000L) {
            signals.add("DECODER_RENDER_PRESSURE");
        }
        if ("LIKELY_MISMATCH".equals(frameRateRelation())) {
            signals.add("FRAME_RATE_MISMATCH");
        }
        if (audioUnderrunCount > 0) {
            signals.add("AUDIO_UNDERRUN");
        }
        if (signals.isEmpty()) {
            return "NO_OBVIOUS_SIGNAL";
        }
        if (signals.size() > 1) {
            return "MULTIPLE_SIGNALS(" + join(signals, "+") + ")";
        }
        return signals.get(0);
    }

    private DecoderInfo inspectDecoder(String decoderName) {
        String classification = classifyDecoder(decoderName);
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || decoderName == null) {
            return new DecoderInfo("unknown", "unknown", "unknown", classification);
        }
        try {
            MediaCodecInfo codecInfo = null;
            MediaCodecInfo[] codecInfos = new MediaCodecList(MediaCodecList.ALL_CODECS).getCodecInfos();
            for (MediaCodecInfo candidate : codecInfos) {
                if (decoderName.equals(candidate.getName())) {
                    codecInfo = candidate;
                    break;
                }
            }
            if (codecInfo == null) {
                return new DecoderInfo("unknown", "unknown", "unknown", classification);
            }
            return new DecoderInfo(
                    String.valueOf(codecInfo.isHardwareAccelerated()),
                    String.valueOf(codecInfo.isSoftwareOnly()),
                    String.valueOf(codecInfo.isVendor()),
                    classification);
        } catch (RuntimeException error) {
            return new DecoderInfo("unknown", "unknown", "unknown", classification);
        }
    }

    private String classifyDecoder(String decoderName) {
        if (decoderName == null) {
            return "UNKNOWN";
        }
        String lowerName = decoderName.toLowerCase(Locale.US);
        if (lowerName.contains("omx.hisi.")
                || lowerName.contains("omx.hisilicon")
                || lowerName.contains("c2.hisi")
                || lowerName.contains("c2.hisilicon")) {
            return "HISILICON_LIKELY";
        }
        if (lowerName.contains("omx.google") || lowerName.contains("c2.android")) {
            return "SOFTWARE_LIKELY";
        }
        return "UNKNOWN";
    }

    private String frameRateRelation() {
        if (!isKnownPositive(videoFrameRate) || !isKnownPositive(displayRefreshRate)) {
            return "UNKNOWN";
        }
        if ((isNear(videoFrameRate, 25.0f) && isNear(displayRefreshRate, 50.0f))
                || (isNear(videoFrameRate, 50.0f) && isNear(displayRefreshRate, 50.0f))
                || (isNear(videoFrameRate, 30.0f) && isNear(displayRefreshRate, 60.0f))
                || (isNear(videoFrameRate, 60.0f) && isNear(displayRefreshRate, 60.0f))
                || (isNear(videoFrameRate, 24.0f) && isNear(displayRefreshRate, 24.0f))) {
            return "LIKELY_MATCHED";
        }
        if ((isNear(videoFrameRate, 50.0f) && isNear(displayRefreshRate, 60.0f))
                || (isNear(videoFrameRate, 25.0f) && isNear(displayRefreshRate, 60.0f))
                || (isNear(videoFrameRate, 24.0f) && isNear(displayRefreshRate, 60.0f))) {
            return "LIKELY_MISMATCH";
        }
        float refreshRatio = displayRefreshRate / videoFrameRate;
        if (Math.abs(refreshRatio - Math.round(refreshRatio)) < 0.03f) {
            return "LIKELY_MATCHED";
        }
        return "UNKNOWN";
    }

    private String frameRateMismatch() {
        String relation = frameRateRelation();
        if ("LIKELY_MISMATCH".equals(relation)) {
            return "true";
        }
        if ("LIKELY_MATCHED".equals(relation)) {
            return "false";
        }
        return "unknown";
    }

    private void setNodeIdentity(String url) {
        String safeUrl = url == null ? "" : url;
        Uri uri = Uri.parse(safeUrl);
        urlHost = valueOrUnknown(uri.getHost());
        urlHash = hashUrl(safeUrl);
        nodeId = urlHash;
    }

    private void resetMetrics() {
        videoDecoder = "unknown";
        videoDecoderInitMs = C.TIME_UNSET;
        videoDecoderInfo = DecoderInfo.unknown();
        audioDecoder = "unknown";
        audioDecoderInitMs = C.TIME_UNSET;
        audioDecoderInfo = DecoderInfo.unknown();
        videoMime = "unknown";
        videoCodec = "unknown";
        videoWidth = Format.NO_VALUE;
        videoHeight = Format.NO_VALUE;
        videoFrameRate = Float.NaN;
        videoBitrate = Format.NO_VALUE;
        videoAverageBitrate = Format.NO_VALUE;
        videoPeakBitrate = Format.NO_VALUE;
        videoPixelRatio = Float.NaN;
        audioMime = "unknown";
        audioCodec = "unknown";
        audioChannels = Format.NO_VALUE;
        audioSampleRate = Format.NO_VALUE;
        audioBitrate = Format.NO_VALUE;
        lastPlaybackState = Player.STATE_IDLE;
        lastIsPlaying = false;
        lastIsLoading = false;
        hasStartedPlayback = false;
        bufferingStartMs = C.TIME_UNSET;
        rebufferCount = 0;
        totalRebufferDurationMs = 0L;
        longestRebufferMs = 0L;
        bufferStarvationObserved = false;
        droppedFramesInterval = 0L;
        droppedFramesTotal = 0L;
        droppedFrameCallbacks = 0L;
        frameProcessingOffsetTotalUs = 0L;
        frameProcessingSamples = 0L;
        audioUnderrunCount = 0L;
        estimatedBitrate = C.TIME_UNSET;
        bytesTransferred = C.TIME_UNSET;
        bandwidthElapsedMs = C.TIME_UNSET;
        lastBufferedDurationMs = C.TIME_UNSET;
        bufferSampleCount = 0L;
        bufferTotalMs = 0L;
        bufferMinMs = Long.MAX_VALUE;
        bufferMaxMs = Long.MIN_VALUE;
        liveOffsetSampleCount = 0L;
        liveOffsetTotalMs = 0L;
        liveOffsetMaxMs = Long.MIN_VALUE;
    }

    private boolean isSessionLogging() {
        return ENABLE_PLAYBACK_DIAGNOSTICS && sessionActive && attached;
    }

    private void logLine(String type, String details) {
        if (!ENABLE_PLAYBACK_DIAGNOSTICS) {
            return;
        }
        Log.i(
                TAG,
                LOG_PREFIX
                        + " " + type
                        + " session=" + sessionId
                        + " timestamp=" + System.currentTimeMillis()
                        + (details == null || details.isEmpty() ? "" : " " + details));
    }

    private long currentBufferedDuration() {
        if (player == null) {
            return C.TIME_UNSET;
        }
        return player.getTotalBufferedDuration();
    }

    private boolean isNearBufferEmpty(long value) {
        return isKnownNonNegative(value) && value <= BUFFER_STARVATION_THRESHOLD_MS;
    }

    private long frameProcessingOffsetAverageUs() {
        if (frameProcessingSamples <= 0) {
            return C.TIME_UNSET;
        }
        return frameProcessingOffsetTotalUs / frameProcessingSamples;
    }

    private String droppedFramesPerMinute(long durationMs) {
        if (durationMs <= 0) {
            return "unknown";
        }
        return String.valueOf((droppedFramesTotal * 60000L) / durationMs);
    }

    private String bufferMin() {
        return bufferSampleCount == 0 ? "unknown" : String.valueOf(bufferMinMs);
    }

    private String bufferAverage() {
        return bufferSampleCount == 0 ? "unknown" : String.valueOf(bufferAverageValue());
    }

    private long bufferAverageValue() {
        return bufferSampleCount == 0 ? C.TIME_UNSET : bufferTotalMs / bufferSampleCount;
    }

    private String bufferMax() {
        return bufferSampleCount == 0 ? "unknown" : String.valueOf(bufferMaxMs);
    }

    private String liveOffsetAverage() {
        return liveOffsetSampleCount == 0 ? "unknown" : String.valueOf(liveOffsetTotalMs / liveOffsetSampleCount);
    }

    private String liveOffsetMax() {
        return liveOffsetSampleCount == 0 ? "unknown" : String.valueOf(liveOffsetMaxMs);
    }

    private String stateName(int state) {
        switch (state) {
            case Player.STATE_IDLE:
                return "IDLE";
            case Player.STATE_BUFFERING:
                return "BUFFERING";
            case Player.STATE_READY:
                return "READY";
            case Player.STATE_ENDED:
                return "ENDED";
            default:
                return "UNKNOWN";
        }
    }

    private String createSessionId(long timestampMs, long sequence) {
        String date = new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date(timestampMs));
        return "a5-" + date + "-" + String.format(Locale.US, "%03d", sequence % 1000L);
    }

    private String hashUrl(String url) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(url.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (int i = 0; i < 6 && i < bytes.length; i++) {
                result.append(String.format(Locale.US, "%02x", bytes[i] & 0xff));
            }
            return result.toString();
        } catch (NoSuchAlgorithmException error) {
            return Integer.toHexString(url.hashCode());
        }
    }

    private static boolean isKnownNonNegative(long value) {
        return value != C.TIME_UNSET && value >= 0L;
    }

    private static long knownLong(long value) {
        return isKnownNonNegative(value) ? value : C.TIME_UNSET;
    }

    private static int knownInt(int value) {
        return value == Format.NO_VALUE || value < 0 ? Format.NO_VALUE : value;
    }

    private static float knownFloat(float value) {
        return Float.isNaN(value) || value <= 0.0f ? Float.NaN : value;
    }

    private static boolean isKnownPositive(float value) {
        return !Float.isNaN(value) && value > 0.0f;
    }

    private static boolean isNear(float first, float second) {
        return Math.abs(first - second) <= 0.5f;
    }

    private static String valueOrUnknown(String value) {
        return value == null || value.trim().isEmpty() ? "unknown" : value;
    }

    private static String formatLong(long value) {
        return value == C.TIME_UNSET ? "unknown" : String.valueOf(value);
    }

    private static String formatInt(int value) {
        return value == Format.NO_VALUE ? "unknown" : String.valueOf(value);
    }

    private static String formatFloat(float value) {
        return isKnownPositive(value) ? String.format(Locale.US, "%.3f", value) : "unknown";
    }

    private static String formatResolution(int width, int height) {
        return width == Format.NO_VALUE || height == Format.NO_VALUE
                ? "unknown"
                : width + "x" + height;
    }

    private static String join(List<String> values, String separator) {
        StringBuilder result = new StringBuilder();
        for (int i = 0; i < values.size(); i++) {
            if (i > 0) {
                result.append(separator);
            }
            result.append(values.get(i));
        }
        return result.toString();
    }

    private static final class DecoderInfo {
        final String hardwareAccelerated;
        final String softwareOnly;
        final String vendor;
        final String classification;

        DecoderInfo(String hardwareAccelerated, String softwareOnly, String vendor, String classification) {
            this.hardwareAccelerated = hardwareAccelerated;
            this.softwareOnly = softwareOnly;
            this.vendor = vendor;
            this.classification = classification;
        }

        static DecoderInfo unknown() {
            return new DecoderInfo("unknown", "unknown", "unknown", "UNKNOWN");
        }
    }
}
