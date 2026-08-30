import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const diagnosticsPath = join(
  root,
  "android",
  "app",
  "src",
  "main",
  "java",
  "com",
  "tv1",
  "player",
  "PlaybackDiagnostics.java"
);
const mainActivityPath = join(
  root,
  "android",
  "app",
  "src",
  "main",
  "java",
  "com",
  "tv1",
  "player",
  "MainActivity.java"
);

if (!existsSync(diagnosticsPath)) {
  throw new Error("PlaybackDiagnostics.java must exist.");
}

const diagnostics = readFileSync(diagnosticsPath, "utf8");
const mainActivity = readFileSync(mainActivityPath, "utf8");

const requiredDiagnosticsPatterns = [
  ["void attach(ExoPlayer player)", "Diagnostics must expose attach(ExoPlayer)."],
  ["void detach()", "Diagnostics must expose detach()."],
  ["void startSession(String url)", "Diagnostics must expose startSession(String)."],
  ["void stopSession()", "Diagnostics must expose stopSession()."],
  ["void logSnapshot()", "Diagnostics must expose logSnapshot()."],
  ["addAnalyticsListener", "Diagnostics must use the existing Media3 AnalyticsListener surface."],
  ["onVideoDecoderInitialized", "Video decoder initialization must be logged."],
  ["onAudioDecoderInitialized", "Audio decoder initialization must be logged."],
  ["onVideoDecoderReleased", "Video decoder release must be logged."],
  ["onAudioDecoderReleased", "Audio decoder release must be logged."],
  ["onVideoInputFormatChanged", "Video input format changes must be logged."],
  ["onAudioInputFormatChanged", "Audio input format changes must be logged."],
  ["onPlaybackStateChanged", "Playback state changes must be logged."],
  ["onIsPlayingChanged", "Playing state changes must be logged."],
  ["onIsLoadingChanged", "Loading state changes must be logged."],
  ["BUFFERING_START", "Buffering start must be logged."],
  ["BUFFERING_END", "Buffering end must be logged."],
  ["onDroppedVideoFrames", "Dropped video frames must be logged."],
  ["onVideoFrameProcessingOffset", "Video frame processing offset must be logged."],
  ["onAudioUnderrun", "Audio underruns must be logged."],
  ["onBandwidthEstimate", "Bandwidth estimates must be logged."],
  ["MediaCodecList", "Decoder capability inspection must use MediaCodecList."],
  ["isHardwareAccelerated", "Hardware acceleration capability must be recorded."],
  ["isSoftwareOnly", "Software-only capability must be recorded."],
  ["isVendor", "Vendor capability must be recorded."],
  ["getMode()", "Display mode must be observed."],
  ["getPhysicalWidth", "Display width must be recorded."],
  ["getPhysicalHeight", "Display height must be recorded."],
  ["getRefreshRate", "Display refresh rate must be recorded."],
  ["getTotalBufferedDuration", "Total buffered duration must be recorded."],
  ["getCurrentLiveOffset", "Current live offset must be recorded."],
  ["totalBufferedDurationMs=", "Snapshot must identify total buffered duration."],
  ["currentLiveOffsetMs=", "Snapshot must identify current live offset."],
  ["SNAPSHOT_INTERVAL_MS = 5000L", "Snapshots must not run more often than every 5 seconds."],
  ["postDelayed(snapshotRunnable, SNAPSHOT_INTERVAL_MS)", "Snapshots must be scheduled periodically."],
  ["removeCallbacks(snapshotRunnable)", "Snapshot callbacks must be cancelled."],
  ["session=", "Diagnostic logs must identify the session."],
  ["timestamp=", "Diagnostic logs must include timestamps."],
  ["urlHost=", "URL logging must use a host field."],
  ["urlHash=", "URL logging must use a hash instead of credentials."],
  ["HISILICON_LIKELY", "HiSilicon decoder names must be classified heuristically."],
  ["SOFTWARE_LIKELY", "Software decoder names must be classified heuristically."],
  ["BuildConfig.DEBUG", "Diagnostics must be enabled by default only for debug builds."],
  ["rebufferCount", "Rebuffer count must be summarized."],
  ["droppedFramesPerMinute", "Dropped frames per minute must be summarized."],
  ["frameRateRelation", "Frame-rate relation must be summarized."],
  ["frameRateMismatch=", "Frame-rate mismatch must be explicitly recorded."],
  ["SESSION_SUMMARY", "Session summary must be logged."],
  ["diagnosticHints=", "Session summary must emit conservative diagnostic hints."]
];

for (const [pattern, message] of requiredDiagnosticsPatterns) {
  if (!diagnostics.includes(pattern)) {
    throw new Error(message);
  }
}

const requiredMainActivityPatterns = [
  ["PlaybackDiagnostics", "MainActivity must integrate PlaybackDiagnostics."],
  ["playbackDiagnostics.attach(player)", "Diagnostics must attach to the player once."],
  ["playbackDiagnostics.stopSession()", "Activity teardown must stop diagnostics."],
  ["playbackDiagnostics.detach()", "Activity lifecycle must detach diagnostics."]
];

for (const [pattern, message] of requiredMainActivityPatterns) {
  if (!mainActivity.includes(pattern)) {
    throw new Error(message);
  }
}

if (!/playbackDiagnostics\.startSession\s*\(\s*node\.url\s*(,\s*[^)]+)?\)/.test(mainActivity)) {
  throw new Error("Each node playback must start a diagnostic session.");
}

if (mainActivity.includes("addAnalyticsListener")) {
  throw new Error("MainActivity must not register a competing AnalyticsListener.");
}

const forbiddenPlaybackControlPatterns = [
  "seekTo(",
  "player.pause(",
  "player.play(",
  "player.prepare(",
  "setMediaSource(",
  "setMediaItem(",
  "setLoadControl(",
  "setBufferDurationsMs(",
  "setTrackSelectionParameters(",
  "setVideoSurface(",
  "setSurfaceView(",
  "setTextureView(",
  "setTunnelingEnabled(",
  "setPlaybackSpeed("
];

for (const pattern of forbiddenPlaybackControlPatterns) {
  if (diagnostics.includes(pattern)) {
    throw new Error(`PlaybackDiagnostics must not control playback or configure rendering: ${pattern}`);
  }
}

console.log("Android playback diagnostics static tests passed.");
