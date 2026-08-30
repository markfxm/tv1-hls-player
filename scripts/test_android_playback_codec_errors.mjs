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

if (!existsSync(diagnosticsPath)) {
  throw new Error("PlaybackDiagnostics.java must exist.");
}

const diagnostics = readFileSync(diagnosticsPath, "utf8");

const callbackBody = (methodName) => {
  const match = diagnostics.match(
    new RegExp(`public void ${methodName}\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n        \\}`, "m")
  );
  if (!match) {
    throw new Error(`${methodName} callback must exist.`);
  }
  return match[1];
};

const videoBody = callbackBody("onVideoCodecError");
const audioBody = callbackBody("onAudioCodecError");

for (const [body, event, decoder] of [
  [videoBody, "VIDEO_CODEC_ERROR", "videoDecoder"],
  [audioBody, "AUDIO_CODEC_ERROR", "audioDecoder"]
]) {
  if ((body.match(/logLine\(/g) ?? []).length !== 1) {
    throw new Error(`${event} must emit exactly one diagnostic event.`);
  }
  for (const field of ["exceptionClass=", "causeClass=", `decoder=" + valueOrUnknown(${decoder})`]) {
    if (!body.includes(field)) {
      throw new Error(`${event} must include ${field}.`);
    }
  }
  if (body.includes("getMessage") || body.includes("getStackTrace") || body.includes("url") || body.includes("header")) {
    throw new Error(`${event} must not expose message, stack, URL, or headers.`);
  }
}

if (!/exception\s*==\s*null\s*\?\s*"unknown"\s*:\s*exception\.getClass\(\)\.getName\(\)/.test(diagnostics)) {
  throw new Error("Codec errors must null-safely classify the exception.");
}
if (!/exception\s*==\s*null\s*\|\|\s*exception\.getCause\(\)\s*==\s*null\s*\?\s*"none"/.test(diagnostics)) {
  throw new Error("Codec errors must report a null cause as none.");
}
if ((diagnostics.match(/new AnalyticsListener\s*\(\)/g) ?? []).length !== 1) {
  throw new Error("PlaybackDiagnostics must keep one AnalyticsListener.");
}
if (diagnostics.includes("FATAL_ERROR") || diagnostics.includes("DECODER_ERROR")) {
  throw new Error("Codec observation must not invent fatal or decoder error semantics.");
}
if (!diagnostics.includes('logLine("PLAYER_ERROR", "error=" + errorCode);')) {
  throw new Error("PLAYER_ERROR event and fields must remain unchanged.");
}
for (const unchanged of [
  "SNAPSHOT_INTERVAL_MS = 5000L",
  "getTotalBufferedDuration()",
  "getCurrentLiveOffset()",
  "droppedFramesTotal += droppedFramesInterval",
  'logLine(\n                "SESSION_SUMMARY"'
]) {
  if (!diagnostics.includes(unchanged)) {
    throw new Error(`Existing diagnostics contract must remain present: ${unchanged}`);
  }
}

console.log("Android playback codec error diagnostics static tests passed.");
