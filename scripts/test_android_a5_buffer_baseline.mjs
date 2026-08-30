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

const expectedBaseline = "setBufferDurationsMs(15000, 50000, 1000, 1000)";
if (!mainActivity.includes(expectedBaseline)) {
  throw new Error(
    "A5 buffer baseline must use setBufferDurationsMs(15000, 50000, 1000, 1000)."
  );
}

const forbiddenPatterns = [
  "targetBufferBytes",
  "prioritizeTimeOverSizeThresholds",
  "OkHttpDataSource",
  "MediaCodecSelector",
  "setTunnelingEnabled",
  "AudioProcessor"
];

for (const pattern of forbiddenPatterns) {
  if (mainActivity.includes(pattern)) {
    throw new Error(`A5 baseline freeze must not add or change sensitive playback setting: ${pattern}`);
  }
}

console.log("Android A5 buffer baseline freeze tests passed.");
