import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  analyzeAbba,
  formatResultMarkdown,
  parseRun
} from "./analyze_a5_datasource_abba.mjs";

const root = process.cwd();
const fixtureRoot = join(root, "tests", "fixtures", "a5_datasource_abba");
const nodeId = "052d52487bab";

function fixture(name) {
  return readFileSync(join(fixtureRoot, name), "utf8");
}

function parseFixture(name, backend) {
  return parseRun(fixture(name), backend, nodeId);
}

function validRuns() {
  return [
    parseFixture("a1_default.log", "DEFAULT"),
    parseFixture("b1_okhttp.log", "OKHTTP"),
    parseFixture("b2_okhttp.log", "OKHTTP"),
    parseFixture("a2_default.log", "DEFAULT")
  ];
}

function cloneRuns() {
  return structuredClone(validRuns());
}

function setPairTotals(runs, a1, b1, b2, a2) {
  runs[0].totalRebufferDurationMs = a1;
  runs[1].totalRebufferDurationMs = b1;
  runs[2].totalRebufferDurationMs = b2;
  runs[3].totalRebufferDurationMs = a2;
  for (const run of runs) {
    run.rebufferRatio = run.totalRebufferDurationMs / run.wallDurationMs;
  }
}

function realShapeRun({ backend, sessionId, durationMs, totalRebufferDurationMs }) {
  const navSession = `${sessionId}-nav`;
  return [
    `[A5-DATASOURCE] backend=${backend}`,
    `[A5-DIAG] SESSION_START session=${navSession} timestamp=100000 dataSourceBackend=${backend} nodeId=608d5b661eca urlHost=69.30.245.50 urlHash=608d5b661eca`,
    `[A5-DIAG] DISPLAY session=${navSession} timestamp=100000 resolution=1920x1080 refreshRate=60.000`,
    `[A5-DIAG] IS_PLAYING session=${navSession} timestamp=102000 playing=true`,
    `[A5-DIAG] SNAPSHOT session=${navSession} timestamp=103000 totalBufferedDurationMs=99999 droppedTotal=99 display=1920x1080@60.000`,
    `[A5-DIAG] BANDWIDTH session=${navSession} timestamp=104000 estimatebps=99999999`,
    `[A5-DIAG] PLAYER_ERROR session=${navSession} timestamp=105000 error=PRE_TARGET_ONLY`,
    `[A5-NET] TRANSFER_START {throughput=0, slowTransfer5s=false, verySlowTransfer15s=false, transferId=1, tag=[A5-NET], durationMs=0, backend=${backend}, node=69.30.245.50/live/cctv1.m3u8, bytes=0}`,
    `[A5-DIAG] SESSION_SUMMARY session=${navSession} timestamp=110000 durationMs=10000 dataSourceBackend=${backend} displayResolution=1920x1080 displayRefreshRate=60.000 rebufferCount=0 totalRebufferDurationMs=0 longestRebufferMs=0 bufferMinMs=99999 bufferAvgMs=99999 bufferMaxMs=99999 droppedFramesTotal=99 droppedFramesPerMinute=594 audioUnderrunCount=0`,
    `[A5-DIAG] SESSION_START session=${sessionId} timestamp=200000 dataSourceBackend=${backend} nodeId=${nodeId} urlHost=43.152.224.209 urlHash=${nodeId}`,
    `[A5-DIAG] DISPLAY session=${sessionId} timestamp=200000 resolution=1920x1080 refreshRate=60.000`,
    `[A5-DIAG] IS_PLAYING session=${sessionId} timestamp=203000 playing=true`,
    `[A5-DIAG] SNAPSHOT session=${sessionId} timestamp=205000 totalBufferedDurationMs=320 droppedTotal=0 display=1920x1080@60.000`,
    `[A5-DIAG] BANDWIDTH session=${sessionId} timestamp=206000 estimatebps=500000`,
    `[A5-NET] TRANSFER_START {throughput=0, slowTransfer5s=false, verySlowTransfer15s=false, transferId=11, tag=[A5-NET], durationMs=0, backend=${backend}, node=43.152.224.209/qctv.fengshows.cn/live/0701phk72.flv, bytes=0}`,
    `[A5-DIAG] SESSION_SUMMARY session=${sessionId} timestamp=${200000 + durationMs} durationMs=${durationMs} dataSourceBackend=${backend} videoMime=video/avc resolution=1280x720 displayResolution=1920x1080 displayRefreshRate=60.000 droppedFramesTotal=0 droppedFramesPerMinute=0 audioUnderrunCount=0 rebufferCount=50 totalRebufferDurationMs=${totalRebufferDurationMs} longestRebufferMs=30000 bufferMinMs=300 bufferAvgMs=600 bufferMaxMs=900`,
    `[A5-NET] TRANSFER_END {throughput=1000, slowTransfer5s=true, verySlowTransfer15s=true, transferId=1, tag=[A5-NET], durationMs=600000, backend=${backend}, node=69.30.245.50/live/cctv1.m3u8, bytes=600000}`,
    `[A5-NET] TRANSFER_END {throughput=8920, slowTransfer5s=true, verySlowTransfer15s=true, transferId=11, tag=[A5-NET], durationMs=344401, backend=${backend}, node=43.152.224.209/qctv.fengshows.cn/live/0701phk72.flv, bytes=3072306}`
  ].join("\n");
}

const parsed = validRuns();
for (const run of parsed) {
  assert.equal(run.valid, true, `${run.sourceName} should be valid`);
  assert.equal(run.wallDurationMs, 600000);
  assert.equal(run.sessionStartPresent, true);
  assert.equal(run.sessionSummaryPresent, true);
  assert.equal(run.displayResolution, "1920x1080");
  assert.equal(run.displayRefreshRate, 60);
}

assert.equal(parseRun(fixture("a1_default.log"), "OKHTTP", nodeId).valid, false);
assert.equal(parseRun(fixture("a1_default.log"), "DEFAULT", "other-node").valid, false);
const conflictingBackend = parseRun(
  fixture("a1_default.log").replace(/(SESSION_SUMMARY[^\n]*dataSourceBackend=)DEFAULT/, "$1OKHTTP"),
  "DEFAULT",
  nodeId
);
assert.equal(conflictingBackend.valid, false);
assert.ok(conflictingBackend.validityFailures.includes("BACKEND_IDENTITY_CONFLICT"));
assert.equal(
  parseRun(fixture("a1_default.log").replace("resolution=1920x1080", "resolution=3840x2160"), "DEFAULT", nodeId).valid,
  false
);
assert.equal(
  parseRun(fixture("a1_default.log").replace("durationMs=600000", "durationMs=540000"), "DEFAULT", nodeId).valid,
  true
);
const missingSummary = parseRun(
  fixture("a1_default.log").replace(/^.*SESSION_SUMMARY.*$/m, ""),
  "DEFAULT",
  nodeId
);
assert.equal(missingSummary.valid, false);
assert.ok(missingSummary.validityFailures.includes("INVALID_RUN_INCOMPLETE_SESSION"));

const realDefaultShape = parseRun(realShapeRun({
  backend: "DEFAULT",
  sessionId: "target-default",
  durationMs: 685409,
  totalRebufferDurationMs: 625401
}), "DEFAULT", nodeId);
assert.equal(realDefaultShape.valid, true);
assert.equal(realDefaultShape.sessionId, "target-default");
assert.equal(realDefaultShape.nodeId, nodeId);
assert.equal(realDefaultShape.bufferMaxMs, 320, "pre-target snapshots must not leak");
assert.equal(realDefaultShape.bandwidthAverageBps, 500000, "pre-target bandwidth must not leak");
assert.equal(realDefaultShape.playerErrorCount, 0, "pre-target errors must not leak");
assert.equal(realDefaultShape.startupLatencyMs, 3000);
assert.equal(realDefaultShape.transfers.length, 1, "only the target-host transfer should be associated");
assert.deepEqual(realDefaultShape.transfers[0], {
  event: "TRANSFER_END",
  backend: "DEFAULT",
  transferId: 11,
  node: "43.152.224.209/qctv.fengshows.cn/live/0701phk72.flv",
  bytes: 3072306,
  durationMs: 344401,
  throughputBps: 8920,
  slowTransfer5s: true,
  verySlowTransfer15s: true
});

const realOkHttpShape = parseRun(realShapeRun({
  backend: "OKHTTP",
  sessionId: "target-okhttp",
  durationMs: 633117,
  totalRebufferDurationMs: 586495
}), "OKHTTP", nodeId);
assert.equal(realOkHttpShape.valid, true);
assert.equal(realOkHttpShape.transfers[0].backend, "OKHTTP");
assert.equal(realOkHttpShape.transfers[0].transferId, 11);
assert.equal(realOkHttpShape.transfers[0].bytes, 3072306);
assert.equal(realOkHttpShape.transfers[0].durationMs, 344401);
assert.equal(realOkHttpShape.transfers[0].throughputBps, 8920);
assert.ok(!Object.values(realOkHttpShape.transfers[0]).some((value) =>
  typeof value === "string" && value.endsWith(",")));

const ambiguousTargetLog = realShapeRun({
  backend: "DEFAULT",
  sessionId: "target-one",
  durationMs: 600000,
  totalRebufferDurationMs: 100000
}) + [
  "",
  `[A5-DIAG] SESSION_START session=target-two timestamp=900000 dataSourceBackend=DEFAULT nodeId=${nodeId} urlHost=43.152.224.209 urlHash=${nodeId}`,
  "[A5-DIAG] SESSION_SUMMARY session=target-two timestamp=1500000 durationMs=600000 dataSourceBackend=DEFAULT displayResolution=1920x1080 displayRefreshRate=60.000 rebufferCount=1 totalRebufferDurationMs=100000 longestRebufferMs=100000 bufferMinMs=0 bufferAvgMs=500 bufferMaxMs=1000 droppedFramesTotal=0 droppedFramesPerMinute=0 audioUnderrunCount=0"
].join("\n");
const ambiguousTarget = parseRun(ambiguousTargetLog, "DEFAULT", nodeId);
assert.equal(ambiguousTarget.valid, false);
assert.ok(ambiguousTarget.validityFailures.includes("AMBIGUOUS_TARGET_SESSION"));

const realShapeRuns = [
  parseRun(realShapeRun({ backend: "DEFAULT", sessionId: "real-a1", durationMs: 685409, totalRebufferDurationMs: 625401 }), "DEFAULT", nodeId),
  parseRun(realShapeRun({ backend: "OKHTTP", sessionId: "real-b1", durationMs: 633117, totalRebufferDurationMs: 586495 }), "OKHTTP", nodeId),
  parseRun(realShapeRun({ backend: "OKHTTP", sessionId: "real-b2", durationMs: 621106, totalRebufferDurationMs: 567946 }), "OKHTTP", nodeId),
  parseRun(realShapeRun({ backend: "DEFAULT", sessionId: "real-a2", durationMs: 635978, totalRebufferDurationMs: 571983 }), "DEFAULT", nodeId)
];
const realShapeResult = analyzeAbba(realShapeRuns);
assert.equal(realShapeResult.verdict, "NO_MATERIAL_DIFFERENCE");
assert.ok(Math.abs(realShapeResult.pairs[0].effect - (-0.0152466668)) < 0.00001);
assert.ok(Math.abs(realShapeResult.pairs[1].effect - (-0.0167197)) < 0.00001);
assert.ok(Math.abs(realShapeResult.pooled.A - 0.906157) < 0.00001);
assert.ok(Math.abs(realShapeResult.pooled.B - 0.920443) < 0.00001);
assert.ok(Math.abs(realShapeResult.pooled.pooledImprovement - (-0.015765)) < 0.00001);

const baselineResult = analyzeAbba(parsed);
assert.equal(baselineResult.verdict, "OKHTTP_STRONG_WIN");
assert.equal(baselineResult.safety.pass, true);
assert.equal(baselineResult.networkSupportPass, true);
assert.equal(baselineResult.pairs[0].pairResult, "IMPROVEMENT");
assert.equal(baselineResult.pairs[1].pairResult, "IMPROVEMENT");
assert.ok(Math.abs(baselineResult.pooled.A - 0.15) < 1e-12);
assert.ok(Math.abs(baselineResult.pooled.B - (50000 / 1200000)) < 1e-12);
assert.ok(Math.abs(baselineResult.pooled.pooledImprovement - (13 / 18)) < 1e-12);
assert.ok(Math.abs(baselineResult.pooled.absoluteDeltaPooledRebufferRatio - (-130000 / 1200000)) < 1e-12);
assert.ok(!/NaN|Infinity/.test(formatResultMarkdown(baselineResult)));

const zeroNeutralRuns = cloneRuns();
setPairTotals(zeroNeutralRuns, 0, 0, 20000, 80000);
const zeroNeutral = analyzeAbba(zeroNeutralRuns);
assert.equal(zeroNeutral.pairs[0].relativeImprovement, null);
assert.equal(zeroNeutral.pairs[0].relativeImprovementLabel, "N/A");
assert.equal(zeroNeutral.pairs[0].pairResult, "NEUTRAL_ZERO_REBUFFER");
assert.equal(zeroNeutral.pairs[0].absoluteDeltaRebufferRatio, 0);
assert.ok(!/NaN|Infinity/.test(formatResultMarkdown(zeroNeutral)));

const zeroRegressionRuns = cloneRuns();
setPairTotals(zeroRegressionRuns, 0, 10000, 20000, 80000);
const zeroRegression = analyzeAbba(zeroRegressionRuns);
assert.equal(zeroRegression.pairs[0].relativeImprovement, null);
assert.equal(zeroRegression.pairs[0].pairResult, "REGRESSION_FROM_ZERO");
assert.equal(zeroRegression.pairs[0].absoluteDeltaRebufferRatio, 10000 / 600000);

const partialRuns = cloneRuns();
setPairTotals(partialRuns, 100000, 70000, 70000, 100000);
assert.equal(analyzeAbba(partialRuns).verdict, "OKHTTP_PARTIAL_WIN");
assert.ok(Math.abs(analyzeAbba(partialRuns).pooled.pooledImprovement - 0.3) < 1e-12);

const strongBoundaryRuns = cloneRuns();
setPairTotals(strongBoundaryRuns, 100000, 50000, 50000, 100000);
assert.equal(analyzeAbba(strongBoundaryRuns).verdict, "OKHTTP_STRONG_WIN");

const unequalWallDurationRuns = cloneRuns();
unequalWallDurationRuns[0].wallDurationMs = 600000;
unequalWallDurationRuns[1].wallDurationMs = 540000;
unequalWallDurationRuns[2].wallDurationMs = 540000;
unequalWallDurationRuns[3].wallDurationMs = 600000;
setPairTotals(unequalWallDurationRuns, 100000, 50000, 50000, 100000);
assert.ok(unequalWallDurationRuns[1].wallDurationMs >= 540000);
assert.ok(unequalWallDurationRuns[0].wallDurationMs !== unequalWallDurationRuns[1].wallDurationMs);
assert.equal(analyzeAbba(unequalWallDurationRuns).verdict, "OKHTTP_PARTIAL_WIN");
assert.ok(analyzeAbba(unequalWallDurationRuns).pairs.every((pair) => pair.effect < 0.5));

const regressionRuns = cloneRuns();
setPairTotals(regressionRuns, 100000, 130000, 130000, 100000);
assert.equal(analyzeAbba(regressionRuns).verdict, "OKHTTP_REGRESSION");

const conflictRuns = cloneRuns();
setPairTotals(conflictRuns, 100000, 60000, 140000, 100000);
assert.equal(analyzeAbba(conflictRuns).verdict, "INCONCLUSIVE_TEMPORAL_VARIABILITY");

const noDifferenceRuns = cloneRuns();
setPairTotals(noDifferenceRuns, 100000, 100000, 100000, 100000);
assert.equal(analyzeAbba(noDifferenceRuns).verdict, "NO_MATERIAL_DIFFERENCE");

const decoderErrorRuns = cloneRuns();
decoderErrorRuns[1].videoCodecErrorCount = 1;
const decoderErrorResult = analyzeAbba(decoderErrorRuns);
assert.equal(decoderErrorResult.safety.decoderError, true);
assert.equal(decoderErrorResult.safety.pass, false);

const fatalErrorRuns = cloneRuns();
fatalErrorRuns[1].playerErrorCount = 1;
const fatalErrorResult = analyzeAbba(fatalErrorRuns);
assert.equal(fatalErrorResult.safety.fatalPlayerError, true);
assert.equal(fatalErrorResult.safety.pass, false);

const audioRegressionRuns = cloneRuns();
audioRegressionRuns[1].audioUnderrunCount = audioRegressionRuns[0].audioUnderrunCount + 2;
audioRegressionRuns[2].audioUnderrunCount = audioRegressionRuns[3].audioUnderrunCount + 2;
const audioRegressionResult = analyzeAbba(audioRegressionRuns);
assert.equal(audioRegressionResult.safety.audioSafetyRegression, true);
assert.equal(audioRegressionResult.safety.pass, false);

const droppedRegressionRuns = cloneRuns();
droppedRegressionRuns[1].droppedFramesTotal = droppedRegressionRuns[0].droppedFramesTotal + 20;
droppedRegressionRuns[2].droppedFramesTotal = droppedRegressionRuns[3].droppedFramesTotal + 20;
for (const run of droppedRegressionRuns) {
  run.droppedFramesPerMinute = (run.droppedFramesTotal * 60000) / run.wallDurationMs;
}
const droppedRegressionResult = analyzeAbba(droppedRegressionRuns);
assert.equal(droppedRegressionResult.safety.droppedFrameSafetyRegression, true);
assert.equal(droppedRegressionResult.safety.pass, false);

const decoderEventRun = parseRun(
  fixture("b1_okhttp.log") + "\n[A5-DIAG] VIDEO_CODEC_ERROR session=b1 timestamp=1600000 decoder=OMX.hisi.video.decoder.avc exceptionClass=x causeClass=none\n",
  "OKHTTP",
  nodeId
);
assert.equal(decoderEventRun.videoCodecErrorCount, 1);
assert.equal(decoderEventRun.decoderError, true);
const fatalEventRun = parseRun(
  fixture("b1_okhttp.log") + "\n[A5-DIAG] PLAYER_ERROR session=b1 timestamp=1600000 error=ERROR_CODE_IO_NETWORK_CONNECTION_FAILED\n",
  "OKHTTP",
  nodeId
);
assert.equal(fatalEventRun.playerErrorCount, 1);
assert.equal(fatalEventRun.fatalPlayerError, true);

const invalidResult = analyzeAbba([
  ...validRuns().slice(0, 3),
  parseRun(fixture("a2_default.log").replace(/^.*SESSION_SUMMARY.*$/m, ""), "DEFAULT", nodeId)
]);
assert.equal(invalidResult.verdict, "INVALID_ABBA");
assert.ok(invalidResult.validityFailures.some((failure) => failure.includes("INVALID_RUN_INCOMPLETE_SESSION")));

console.log("A5 DataSource ABBA analyzer tests passed.");
