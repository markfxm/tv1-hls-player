import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const PRODUCTION_SOURCE_ROOTS = [
  ["android", "app", "src", "main", "java"],
  ["src"]
];
const SOURCE_EXTENSIONS = new Set([".java", ".js", ".ts", ".vue"]);
const OKHTTP_DATASOURCE_ALLOWED_FILE = join(
  "android",
  "app",
  "src",
  "main",
  "java",
  "com",
  "tv1",
  "player",
  "PlaybackDataSourceFactory.java"
);

function readRequired(pathParts, missingMessage) {
  try {
    return readFileSync(join(process.cwd(), ...pathParts), "utf8");
  } catch (error) {
    throw new Error(missingMessage);
  }
}

function hasSourceExtension(path) {
  return [...SOURCE_EXTENSIONS].some((extension) => path.endsWith(extension));
}

function collectSourceFiles(pathParts) {
  const root = join(process.cwd(), ...pathParts);
  const files = [];
  const visit = (path) => {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const child of readdirSync(path)) {
        visit(join(path, child));
      }
      return;
    }
    if (stat.isFile() && hasSourceExtension(path)) {
      files.push(path);
    }
  };
  visit(root);
  return files;
}

const productionSourceFiles = PRODUCTION_SOURCE_ROOTS.flatMap(collectSourceFiles).map((path) => ({
  path,
  relativePath: relative(process.cwd(), path),
  source: readFileSync(path, "utf8")
}));

const mainActivitySource = readRequired(
  ["android", "app", "src", "main", "java", "com", "tv1", "player", "MainActivity.java"],
  "Missing MainActivity source."
);
const playbackDiagnosticsSource = readRequired(
  ["android", "app", "src", "main", "java", "com", "tv1", "player", "PlaybackDiagnostics.java"],
  "Missing PlaybackDiagnostics source."
);
const analyzerSource = readRequired(
  ["scripts", "analyze_a5_datasource_abba.mjs"],
  "Missing Task 5 ABBA analyzer."
);

const bufferCalls = productionSourceFiles.flatMap((file) =>
  [...file.source.matchAll(/setBufferDurationsMs\s*\(([^)]*)\)/g)].map((match) => ({
    relativePath: file.relativePath,
    call: match[0],
    args: match[1].replace(/\s+/g, " ").trim()
  }))
);
for (const bufferCall of bufferCalls) {
  if (/\b(?:20000|60000|5000)\b/.test(bufferCall.args)) {
    throw new Error(`Production playback scope must not add Treatment B buffer values in ${bufferCall.relativePath}: ${bufferCall.call}`);
  }
}

if (bufferCalls.length !== 1 || bufferCalls[0].args !== "15000, 50000, 1000, 1000") {
  throw new Error("Production playback scope must keep exactly one baseline buffer call: setBufferDurationsMs(15000, 50000, 1000, 1000).");
}

for (const forbiddenPattern of [
  "targetBufferBytes",
  "prioritizeTimeOverSizeThresholds",
  "setEnableDecoderFallback",
  "decoder-fallback",
  "TextureView",
  "setPlaybackSpeed",
  "AudioProcessor",
  "MediaCodecSelector",
  "setTunnelingEnabled"
]) {
  const mention = productionSourceFiles.find((file) => file.source.includes(forbiddenPattern));
  if (mention) {
    throw new Error(`Task 4 must not introduce forbidden playback configuration ${forbiddenPattern} in ${mention.relativePath}.`);
  }
}

const disallowedOkHttpMention = productionSourceFiles.find(
  (file) => file.relativePath !== OKHTTP_DATASOURCE_ALLOWED_FILE && file.source.includes("OkHttpDataSource")
);
if (disallowedOkHttpMention) {
  throw new Error(`Task 4 must not introduce OkHttpDataSource outside PlaybackDataSourceFactory: ${disallowedOkHttpMention.relativePath}.`);
}

if (!mainActivitySource.includes("PlaybackDataSourceFactory.create(")) {
  throw new Error("Task 4 must use PlaybackDataSourceFactory.create for the HLS datasource path.");
}

if (mainActivitySource.includes("new DefaultHttpDataSource.Factory()")) {
  throw new Error("Task 4 must replace the raw DefaultHttpDataSource.Factory argument in MainActivity.");
}

if (!/new\s+HlsMediaSource\.Factory\s*\([\s\S]*?\)\s*\.setLoadErrorHandlingPolicy\s*\(\s*new\s+DefaultLoadErrorHandlingPolicy\s*\(\s*\)\s*\)/.test(mainActivitySource)) {
  throw new Error("Task 4 must keep DefaultLoadErrorHandlingPolicy attached to HlsMediaSource.Factory.");
}

const backendIdentityMentions = playbackDiagnosticsSource.match(/dataSourceBackend=/g) ?? [];
if (backendIdentityMentions.length !== 2) {
  throw new Error("Task 4 must add datasource backend identity only to session start and summary logs.");
}

if (!playbackDiagnosticsSource.includes("SNAPSHOT_INTERVAL_MS = 5000L")) {
  throw new Error("Task 4 must preserve the diagnostics snapshot cadence.");
}

for (const analyzerContract of [
  "export function parseRun(",
  "export function analyzeAbba(",
  "export function formatResultMarkdown(",
  "MIN_LONG_SESSION_MS = 540000",
  "MATERIAL_EFFECT = 0.3",
  "STRONG_EFFECT = 0.5",
  "INVALID_RUN_INCOMPLETE_SESSION",
  "NEUTRAL_ZERO_REBUFFER",
  "REGRESSION_FROM_ZERO",
  "absoluteDeltaRebufferRatio",
  "pooledImprovement",
  "VIDEO_CODEC_ERROR",
  "AUDIO_CODEC_ERROR",
  "PLAYER_ERROR",
  "OKHTTP_STRONG_WIN",
  "OKHTTP_PARTIAL_WIN",
  "OKHTTP_REGRESSION",
  "INCONCLUSIVE_TEMPORAL_VARIABILITY",
  "NO_MATERIAL_DIFFERENCE",
  "INVALID_ABBA"
]) {
  if (!analyzerSource.includes(analyzerContract)) {
    throw new Error(`Task 5 analyzer contract is missing ${analyzerContract}.`);
  }
}

if (!analyzerSource.includes('"a1", "DEFAULT"')
  || !analyzerSource.includes('"b1", "OKHTTP"')
  || !analyzerSource.includes('"b2", "OKHTTP"')
  || !analyzerSource.includes('"a2", "DEFAULT"')
  || !analyzerSource.includes('"output"')) {
  throw new Error("Task 5 analyzer CLI must require A1/B1/B2/A2 and an output path.");
}

for (const forbiddenArtifact of [
  "TASK5B2_A5_DATASOURCE_ABBA_RESULT.md",
  "a1_diag.log",
  "b1_diag.log",
  "b2_diag.log",
  "a2_diag.log"
]) {
  if (existsSync(join(process.cwd(), forbiddenArtifact))) {
    throw new Error(`Real ABBA result/log artifact must not be committed during implementation: ${forbiddenArtifact}`);
  }
}

console.log("Android datasource Task 4 scope tests passed.");
