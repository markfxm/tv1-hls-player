import { readFileSync } from "node:fs";
import { join } from "node:path";

const mainActivity = readFileSync(
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

const expectedTreatment = "setBufferDurationsMs(20000, 60000, 5000, 5000)";
if (!mainActivity.includes(expectedTreatment)) {
  throw new Error(
    "TASK5B1 treatment must use setBufferDurationsMs(20000, 60000, 5000, 5000)."
  );
}

const forbiddenPatterns = [
  "targetBufferBytes",
  "prioritizeTimeOverSizeThresholds",
  "OkHttpDataSource",
  "MediaCodecSelector",
  "setTunnelingEnabled",
  "setEnableDecoderFallback",
  "TextureView",
  "setPlaybackSpeed",
  "AudioProcessor"
];

for (const pattern of forbiddenPatterns) {
  if (mainActivity.includes(pattern)) {
    throw new Error(`TASK5B1 must not add or change sensitive playback setting: ${pattern}`);
  }
}

console.log("Android A5 buffer treatment profile tests passed.");
