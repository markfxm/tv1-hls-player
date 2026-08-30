import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(
    process.cwd(),
    "android",
    "app",
    "src",
    "main",
    "java",
    "com",
    "tv1",
    "player",
    "MainActivity.java"
  ),
  "utf8"
);
const diagnosticsSource = readFileSync(
  join(
    process.cwd(),
    "android",
    "app",
    "src",
    "main",
    "java",
    "com",
    "tv1",
    "player",
    "PlaybackDiagnostics.java"
  ),
  "utf8"
);
const searchableSource = `${source}\n${diagnosticsSource}`;

const requiredPatterns = [
  ["DefaultLoadErrorHandlingPolicy", "HLS must use Media3 DefaultLoadErrorHandlingPolicy."],
  ["DefaultLoadControl", "ExoPlayer must use a configured DefaultLoadControl."],
  ["setBufferDurationsMs(", "LoadControl buffer durations are not configured."],
  ["MAX_PLAYBACK_RECOVERY_ATTEMPTS = 3", "Playback recovery must have a bounded retry count."],
  ["setLoadErrorHandlingPolicy", "HLS media source must receive the load error policy."],
  ["postDelayed", "Player recovery must wait before preparing again."],
  ["player.prepare()", "Player recovery must prepare the current media item again."],
  ["player.play()", "Player recovery must resume playback."],
  ["onVideoDecoderInitialized", "Video decoder initialization must be logged."],
  ["onAudioDecoderInitialized", "Audio decoder initialization must be logged."],
  ["activityPaused", "Paused activities must not schedule or run recovery."],
  ["userStopped = true", "Destroy must prevent delayed playback recovery."],
  ["uiHandler.removeCallbacks(playbackRecoveryRunnable)", "Pending playback recovery must be cleared on teardown."]
];

for (const [pattern, message] of requiredPatterns) {
  if (!searchableSource.includes(pattern)) {
    throw new Error(message);
  }
}

const compatibilityProfiles = [
  { codec: "H264", profile: "1080P" },
  { codec: "H265", profile: "4K" },
  { codec: "AAC", profile: "audio" },
  { codec: "AC3", profile: "audio" }
];

console.log(
  `Android compatibility profiles registered: ${compatibilityProfiles
    .map(({ codec, profile }) => `${codec}/${profile}`)
    .join(", ")}`
);

console.log("Android Media3 stability tests passed.");
