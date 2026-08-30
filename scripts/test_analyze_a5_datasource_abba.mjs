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
  fixture("a1_default.log").replace("[A5-DATASOURCE] backend=DEFAULT", "[A5-DATASOURCE] backend=OKHTTP"),
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
