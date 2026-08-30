import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MATERIAL_EFFECT = 0.3;
export const STRONG_EFFECT = 0.5;
export const MIN_LONG_SESSION_MS = 540000;
export const DEFAULT_NODE = "052d52487bab";

const UNKNOWN_VALUES = new Set(["", "unknown", "unset", "n/a", "na", "null"]);

function finiteNumber(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const text = String(value).trim();
  if (UNKNOWN_VALUES.has(text.toLowerCase())) {
    return null;
  }
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function finiteNonNegative(value) {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function parseFields(line) {
  const fields = {};
  const braceStart = line.indexOf("{");
  const braceEnd = line.lastIndexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) {
    for (const part of line.slice(braceStart + 1, braceEnd).split(/,\s*/)) {
      const separator = part.indexOf("=");
      if (separator <= 0) {
        continue;
      }
      const key = part.slice(0, separator).trim();
      const value = part.slice(separator + 1).trim();
      if (/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) {
        fields[key] = value;
      }
    }
    return fields;
  }
  const fieldPattern = /([A-Za-z][A-Za-z0-9_]*)=([^\s]+)/g;
  let match;
  while ((match = fieldPattern.exec(line)) !== null) {
    fields[match[1]] = match[2];
  }
  return fields;
}

function eventRecords(text) {
  const records = [];
  const eventPattern = /\[(A5-DIAG|A5-NET)\]\s+([A-Z_]+)/g;
  let match;
  while ((match = eventPattern.exec(text)) !== null) {
    const lineEnd = text.indexOf("\n", match.index);
    const line = text.slice(match.index, lineEnd < 0 ? text.length : lineEnd);
    const fields = parseFields(line);
    records.push({
      tag: match[1],
      event: match[2],
      line,
      fields,
      timestamp: finiteNumber(fields.timestamp),
      index: match.index
    });
  }
  return records;
}

function firstKnown(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "unknown") {
      return value;
    }
  }
  return null;
}

function median(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentile(values, fraction) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)));
  return sorted[index];
}

function stats(values) {
  const known = values.map(finiteNumber).filter((value) => value !== null);
  if (known.length === 0) {
    return { min: null, p10: null, median: null, average: null, max: null, count: 0 };
  }
  return {
    min: Math.min(...known),
    p10: percentile(known, 0.1),
    median: median(known),
    average: known.reduce((sum, value) => sum + value, 0) / known.length,
    max: Math.max(...known),
    count: known.length
  };
}

function timestampOf(record) {
  return record.timestamp;
}

function resolutionParts(value) {
  if (!value || value === "unknown") {
    return null;
  }
  const match = String(value).match(/^(\d+)x(\d+)$/);
  return match ? { width: Number(match[1]), height: Number(match[2]), text: value } : null;
}

function displayFromRecord(record) {
  const embeddedDisplay = record.fields.display?.match(/^(\d+x\d+)@([0-9.]+)$/);
  return {
    resolution: record.fields.resolution ?? record.fields.displayResolution ?? embeddedDisplay?.[1] ?? null,
    refreshRate: finiteNumber(record.fields.refreshRate ?? record.fields.displayRefreshRate ?? embeddedDisplay?.[2])
  };
}

function knownDisplayValues(records) {
  return records
    .map(displayFromRecord)
    .concat(
      records
        .filter((record) => record.event === "SNAPSHOT")
        .map((record) => displayFromRecord(record))
    )
    .filter((display) => display.resolution || display.refreshRate !== null);
}

function booleanValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function transferNodeMatchesHost(node, urlHost) {
  if (!node || !urlHost || node === "unknown" || urlHost === "unknown") {
    return false;
  }
  const normalizedNode = String(node).toLowerCase();
  const normalizedHost = String(urlHost).toLowerCase();
  return normalizedNode === normalizedHost || normalizedNode.startsWith(`${normalizedHost}/`);
}

function transferMetrics(records, sessionStart, sessionSummary, targetHost, expectedBackend) {
  const associatedTransfers = new Map();
  const transfers = [];
  for (const record of records) {
    if (record.tag !== "A5-NET") {
      continue;
    }
    const transferId = finiteNumber(record.fields.transferId);
    if (record.event === "TRANSFER_START") {
      const startsInsideTargetSession = sessionStart
        && record.index > sessionStart.index
        && (!sessionSummary || record.index < sessionSummary.index);
      if (transferId !== null
        && startsInsideTargetSession
        && normalizeBackend(record.fields.backend) === normalizeBackend(expectedBackend)
        && transferNodeMatchesHost(record.fields.node, targetHost)) {
        associatedTransfers.set(transferId, true);
      }
      continue;
    }
    if (!["TRANSFER_END", "TRANSFER_ERROR"].includes(record.event)
      || transferId === null
      || !associatedTransfers.has(transferId)) {
      continue;
    }
    associatedTransfers.delete(transferId);
    transfers.push({
      event: record.event,
      backend: record.fields.backend ?? "unknown",
      transferId,
      node: record.fields.node ?? "unknown",
      bytes: finiteNonNegative(record.fields.bytes),
      durationMs: finiteNonNegative(record.fields.durationMs),
      throughputBps: finiteNonNegative(record.fields.throughput),
      slowTransfer5s: booleanValue(record.fields.slowTransfer5s),
      verySlowTransfer15s: booleanValue(record.fields.verySlowTransfer15s)
    });
  }
  const durations = transfers.map((transfer) => transfer.durationMs).filter((value) => value !== null);
  const throughputs = transfers.map((transfer) => transfer.throughputBps).filter((value) => value !== null);
  const durationStats = stats(durations);
  const throughputStats = stats(throughputs);
  return {
    transfers,
    transferCount: transfers.length,
    transferBytes: transfers.reduce((sum, transfer) => sum + (transfer.bytes ?? 0), 0),
    transferDurationMinMs: durationStats.min,
    transferDurationMedianMs: durationStats.median,
    transferDurationP90Ms: percentile(durations, 0.9),
    transferDurationP95Ms: percentile(durations, 0.95),
    transferDurationLongestMs: durationStats.max,
    throughputMinBps: throughputStats.min,
    throughputP05Bps: percentile(throughputs, 0.05),
    throughputP10Bps: throughputStats.p10,
    throughputMedianBps: throughputStats.median,
    throughputAverageBps: throughputStats.average,
    slowTransfer5sCount: transfers.filter((transfer) =>
      transfer.slowTransfer5s ?? (transfer.durationMs !== null && transfer.durationMs >= 5000)).length,
    verySlowTransfer15sCount: transfers.filter((transfer) =>
      transfer.verySlowTransfer15s ?? (transfer.durationMs !== null && transfer.durationMs >= 15000)).length
  };
}

function safeRatio(numerator, denominator) {
  if (numerator === null || denominator === null || denominator <= 0) {
    return null;
  }
  const ratio = numerator / denominator;
  return Number.isFinite(ratio) ? ratio : null;
}

function readSummaryNumber(summary, field) {
  return summary ? finiteNumber(summary.fields[field]) : null;
}

function normalizeBackend(value) {
  return value && value !== "unknown" ? String(value).trim().toUpperCase() : null;
}

export function parseRun(text, expectedBackend, expectedNode = DEFAULT_NODE) {
  const source = String(text ?? "");
  const records = eventRecords(source);
  const diagnostics = records.filter((record) => record.tag === "A5-DIAG");
  const normalizedExpectedBackend = normalizeBackend(expectedBackend);
  const matchingStarts = diagnostics.filter((record) =>
    record.event === "SESSION_START"
      && normalizeBackend(record.fields.dataSourceBackend) === normalizedExpectedBackend
      && record.fields.nodeId === expectedNode);
  const targetCandidates = matchingStarts.map((start) => {
    const summary = diagnostics.find((record) =>
      record.event === "SESSION_SUMMARY"
        && record.index > start.index
        && record.fields.session === start.fields.session) ?? null;
    return { start, summary, durationMs: readSummaryNumber(summary, "durationMs") };
  });
  const longTargetCandidates = targetCandidates.filter((candidate) =>
    candidate.durationMs !== null && candidate.durationMs >= MIN_LONG_SESSION_MS);
  const selectedCandidate = longTargetCandidates[0] ?? targetCandidates[0] ?? null;
  const sessionStart = selectedCandidate?.start ?? null;
  const sessionSummary = selectedCandidate?.summary ?? null;
  const targetSessionId = sessionStart?.fields.session ?? null;
  const scopedDiagnostics = targetSessionId
    ? diagnostics.filter((record) => record.fields.session === targetSessionId)
    : [];
  const displayRecords = scopedDiagnostics.filter((record) => record.event === "DISPLAY");
  const snapshotRecords = scopedDiagnostics.filter((record) => record.event === "SNAPSHOT");
  const bufferingStarts = scopedDiagnostics.filter((record) => record.event === "BUFFERING_START");
  const bufferingEnds = scopedDiagnostics.filter((record) => record.event === "BUFFERING_END");
  const playingRecords = scopedDiagnostics.filter((record) => record.event === "IS_PLAYING");
  const bandwidthRecords = scopedDiagnostics.filter((record) => record.event === "BANDWIDTH");
  const droppedRecords = scopedDiagnostics.filter((record) => record.event === "DROPPED_FRAMES");

  const startFields = sessionStart?.fields ?? {};
  const summaryFields = sessionSummary?.fields ?? {};
  const backendCandidates = [
    normalizeBackend(startFields.dataSourceBackend),
    normalizeBackend(summaryFields.dataSourceBackend)
  ].filter((value) => value !== null);
  const backend = firstKnown(...[summaryFields.dataSourceBackend, startFields.dataSourceBackend].map(normalizeBackend));
  const backendConflict = new Set(backendCandidates).size > 1;
  const sessionId = firstKnown(summaryFields.session, startFields.session);
  const nodeId = firstKnown(startFields.nodeId, startFields.urlHash);
  const wallDurationMs = readSummaryNumber(sessionSummary, "durationMs");
  const displayResolution = firstKnown(summaryFields.displayResolution, displayRecords[0]?.fields.resolution);
  const displayRefreshRate = firstKnown(
    finiteNumber(summaryFields.displayRefreshRate),
    finiteNumber(displayRecords[0]?.fields.refreshRate)
  );
  const observedDisplays = knownDisplayValues(displayRecords.concat(snapshotRecords));
  const expectedDisplayResolution = "1920x1080";
  const expectedDisplayRefreshRate = 60;
  const displayDrift = observedDisplays.some((display) =>
    (display.resolution && display.resolution !== expectedDisplayResolution)
      || (display.refreshRate !== null && Math.abs(display.refreshRate - expectedDisplayRefreshRate) > 0.5)
  );

  const snapshotBuffers = snapshotRecords
    .map((record) => finiteNonNegative(record.fields.totalBufferedDurationMs ?? record.fields.bufferedDurationMs))
    .filter((value) => value !== null);
  const summaryBufferValues = [
    finiteNonNegative(summaryFields.bufferMinMs),
    finiteNonNegative(summaryFields.bufferAvgMs),
    finiteNonNegative(summaryFields.bufferMaxMs)
  ].filter((value) => value !== null);
  const bufferValues = snapshotBuffers.length > 0 ? snapshotBuffers : summaryBufferValues;
  const bufferStats = stats(bufferValues);
  const snapshotLiveOffsets = snapshotRecords
    .map((record) => finiteNonNegative(record.fields.currentLiveOffsetMs ?? record.fields.liveOffsetMs))
    .filter((value) => value !== null);
  const liveOffsetValues = snapshotLiveOffsets.length > 0 ? snapshotLiveOffsets : [
    finiteNonNegative(summaryFields.liveOffsetAvgMs),
    finiteNonNegative(summaryFields.liveOffsetMaxMs)
  ].filter((value) => value !== null);
  const liveOffsetStats = stats(liveOffsetValues);

  const fallbackRebufferDurations = [];
  let openBufferingTimestamp = null;
  for (const record of scopedDiagnostics) {
    if (record.event === "BUFFERING_START") {
      openBufferingTimestamp = timestampOf(record);
    } else if (record.event === "BUFFERING_END" && openBufferingTimestamp !== null && record.timestamp !== null) {
      fallbackRebufferDurations.push(Math.max(0, record.timestamp - openBufferingTimestamp));
      openBufferingTimestamp = null;
    }
  }
  const totalRebufferDurationMs = firstKnown(
    readSummaryNumber(sessionSummary, "totalRebufferDurationMs"),
    fallbackRebufferDurations.reduce((sum, value) => sum + value, 0)
  );
  const longestRebufferMs = firstKnown(
    readSummaryNumber(sessionSummary, "longestRebufferMs"),
    fallbackRebufferDurations.length > 0 ? Math.max(...fallbackRebufferDurations) : null
  );
  const rebufferCount = firstKnown(
    readSummaryNumber(sessionSummary, "rebufferCount"),
    bufferingStarts.length
  );
  const droppedTotals = droppedRecords
    .map((record) => finiteNonNegative(record.fields.total ?? record.fields.totalDropped ?? record.fields.droppedTotal))
    .filter((value) => value !== null);
  const snapshotDroppedTotals = snapshotRecords
    .map((record) => finiteNonNegative(record.fields.droppedTotal))
    .filter((value) => value !== null);
  const droppedFramesTotal = firstKnown(
    readSummaryNumber(sessionSummary, "droppedFramesTotal"),
    droppedTotals.length > 0 ? Math.max(...droppedTotals) : snapshotDroppedTotals.length > 0 ? Math.max(...snapshotDroppedTotals) : 0
  );
  const droppedFramesPerMinute = firstKnown(
    readSummaryNumber(sessionSummary, "droppedFramesPerMinute"),
    safeRatio(droppedFramesTotal, wallDurationMs) === null ? null : safeRatio(droppedFramesTotal, wallDurationMs) * 60000
  );
  const audioUnderrunCount = firstKnown(readSummaryNumber(sessionSummary, "audioUnderrunCount"),
    scopedDiagnostics.filter((record) => record.event === "AUDIO_UNDERRUN").length);
  const playerErrorCount = scopedDiagnostics.filter((record) => record.event === "PLAYER_ERROR").length;
  const videoCodecErrorCount = scopedDiagnostics.filter((record) => record.event === "VIDEO_CODEC_ERROR").length;
  const audioCodecErrorCount = scopedDiagnostics.filter((record) => record.event === "AUDIO_CODEC_ERROR").length;
  const firstPlaying = playingRecords.find((record) => record.fields.playing === "true" && record.timestamp !== null);
  const sessionStartTimestamp = sessionStart?.timestamp ?? null;
  const startupLatencyMs = sessionStartTimestamp !== null && firstPlaying
    ? Math.max(0, firstPlaying.timestamp - sessionStartTimestamp)
    : null;
  const bandwidthStats = stats(
    bandwidthRecords.map((record) => finiteNumber(record.fields.estimatebps)).filter((value) => value !== null)
  );
  const transfer = transferMetrics(
    records,
    sessionStart,
    sessionSummary,
    startFields.urlHost,
    normalizedExpectedBackend
  );
  const videoMime = firstKnown(summaryFields.videoMime);
  const resolution = firstKnown(summaryFields.resolution);
  const fps = finiteNumber(summaryFields.fps);
  const videoBitrate = finiteNumber(summaryFields.videoBitrate);
  const audioMime = firstKnown(summaryFields.audioMime);
  const decoderClassification = firstKnown(summaryFields.decoderClassification);
  const appCrashObserved = /^\s*\[ABBA-INVALID\].*\bAPP_CRASH\b/m.test(source);

  const validityFailures = [];
  if (matchingStarts.length === 0) validityFailures.push("MISSING_TARGET_SESSION");
  if (longTargetCandidates.length > 1) validityFailures.push("AMBIGUOUS_TARGET_SESSION");
  if (!sessionStart) validityFailures.push("MISSING_SESSION_START");
  if (!sessionSummary) validityFailures.push("INVALID_RUN_INCOMPLETE_SESSION");
  if (!sessionId) validityFailures.push("MISSING_SESSION_ID");
  if (wallDurationMs === null) validityFailures.push("MISSING_DURATION");
  else if (wallDurationMs < MIN_LONG_SESSION_MS) validityFailures.push("DURATION_BELOW_540000");
  if (normalizedExpectedBackend !== backend) validityFailures.push("BACKEND_MISMATCH");
  if (backendConflict) validityFailures.push("BACKEND_IDENTITY_CONFLICT");
  if (nodeId !== expectedNode) validityFailures.push("NODE_MISMATCH");
  if (!displayResolution || displayRefreshRate === null) validityFailures.push("DISPLAY_UNKNOWN");
  else if (displayResolution !== expectedDisplayResolution
    || Math.abs(displayRefreshRate - expectedDisplayRefreshRate) > 0.5
    || displayDrift) validityFailures.push("DISPLAY_DRIFT");
  if (appCrashObserved) validityFailures.push("APP_CRASH_OBSERVED");

  return {
    sourceName: "unknown",
    valid: validityFailures.length === 0,
    validityFailures,
    sessionStartPresent: Boolean(sessionStart),
    sessionSummaryPresent: Boolean(sessionSummary),
    sessionId: sessionId ?? "unknown",
    backend: backend ?? "unknown",
    expectedBackend: normalizedExpectedBackend,
    nodeId: nodeId ?? "unknown",
    expectedNode,
    wallDurationMs,
    durationMs: wallDurationMs,
    displayResolution: displayResolution ?? "unknown",
    displayRefreshRate,
    appCrashObserved,
    videoMime: videoMime ?? "unknown",
    resolution: resolution ?? "unknown",
    fps,
    videoBitrate,
    audioMime: audioMime ?? "unknown",
    decoderClassification: decoderClassification ?? "unknown",
    startupLatencyMs,
    rebufferCount,
    totalRebufferDurationMs,
    longestRebufferMs,
    bufferMinMs: bufferStats.min,
    bufferP10Ms: bufferStats.p10,
    bufferMedianMs: bufferStats.median,
    bufferAvgMs: bufferStats.average,
    bufferMaxMs: bufferStats.max,
    liveOffsetAvgMs: liveOffsetStats.average,
    liveOffsetMaxMs: liveOffsetStats.max,
    droppedFramesTotal,
    droppedFramesPerMinute,
    audioUnderrunCount,
    playerErrorCount,
    videoCodecErrorCount,
    audioCodecErrorCount,
    decoderError: videoCodecErrorCount > 0 || audioCodecErrorCount > 0,
    fatalPlayerError: playerErrorCount > 0,
    bandwidthMinBps: bandwidthStats.min,
    bandwidthMedianBps: bandwidthStats.median,
    bandwidthAverageBps: bandwidthStats.average,
    ...transfer,
    rebufferRatio: safeRatio(totalRebufferDurationMs, wallDurationMs)
  };
}

function pairResult(effect) {
  if (effect === null) return "UNAVAILABLE";
  if (effect > 0) return "IMPROVEMENT";
  if (effect < 0) return "REGRESSION";
  return "NEUTRAL";
}

function makePair(label, a, b) {
  const aRatio = a.rebufferRatio;
  const bRatio = b.rebufferRatio;
  const absoluteDeltaRebufferRatio = aRatio !== null && bRatio !== null ? bRatio - aRatio : null;
  let relativeImprovement = null;
  let specialResult = null;
  if (aRatio !== null && bRatio !== null) {
    if (aRatio > 0) {
      relativeImprovement = (aRatio - bRatio) / aRatio;
    } else if (bRatio === 0) {
      specialResult = "NEUTRAL_ZERO_REBUFFER";
    } else {
      specialResult = "REGRESSION_FROM_ZERO";
    }
  }
  const numericResult = pairResult(relativeImprovement);
  return {
    label,
    aSession: a.sessionId,
    bSession: b.sessionId,
    A_rebufferRatio: aRatio,
    B_rebufferRatio: bRatio,
    A_totalRebufferDurationMs: a.totalRebufferDurationMs,
    B_totalRebufferDurationMs: b.totalRebufferDurationMs,
    absoluteDeltaRebufferRatio,
    relativeImprovement,
    relativeImprovementLabel: relativeImprovement === null ? "N/A" : relativeImprovement,
    pairResult: specialResult ?? numericResult,
    effect: relativeImprovement,
    A: a,
    B: b
  };
}

function effectAtLeast(pair, threshold) {
  if (pair.effect === null) return false;
  const aWall = pair.A.wallDurationMs;
  const bWall = pair.B.wallDurationMs;
  const aTotal = pair.A_totalRebufferDurationMs;
  const bTotal = pair.B_totalRebufferDurationMs;
  const crossDifference = aTotal * bWall - bTotal * aWall;
  const crossBase = aTotal * bWall;
  if (threshold >= 0) return crossDifference >= threshold * crossBase;
  return -crossDifference >= (-threshold) * crossBase;
}

function effectPositive(pair) {
  return pair.effect !== null
    && pair.A_totalRebufferDurationMs * pair.B.wallDurationMs
      > pair.B_totalRebufferDurationMs * pair.A.wallDurationMs;
}

function pooledImprovementAtLeast(pooled, threshold) {
  if (pooled.pooledImprovement === null) return false;
  const aTotal = pooled.A_totalRebufferDurationMs;
  const bTotal = pooled.B_totalRebufferDurationMs;
  const crossDifference = aTotal * pooled.durationB - bTotal * pooled.durationA;
  const crossBase = aTotal * pooled.durationB;
  return crossDifference >= threshold * crossBase;
}

function rateComparison(aRate, bRate) {
  const absoluteDeltaRate = bRate - aRate;
  if (aRate > 0) {
    const relativeIncrease = absoluteDeltaRate / aRate;
    return {
      A: aRate,
      B: bRate,
      absoluteDeltaRate,
      relativeIncrease,
      zeroBaseline: false,
      materialIncrease: relativeIncrease >= MATERIAL_EFFECT
    };
  }
  if (bRate === 0) {
    return {
      A: aRate,
      B: bRate,
      absoluteDeltaRate,
      relativeIncrease: null,
      zeroBaseline: false,
      materialIncrease: false
    };
  }
  return {
    A: aRate,
    B: bRate,
    absoluteDeltaRate,
    relativeIncrease: null,
    zeroBaseline: true,
    materialIncrease: true
  };
}

function pooledRate(runs, field) {
  const duration = runs[0].wallDurationMs + runs[1].wallDurationMs;
  const numerator = runs[0][field] + runs[1][field];
  return safeRatio(numerator, duration);
}

function safetyRateRegression(aRuns, bRuns, field, pairField) {
  const aRate = pooledRate(aRuns, field);
  const bRate = pooledRate(bRuns, field);
  const comparison = rateComparison(aRate, bRate);
  return {
    ...comparison,
    pairwiseIncrease:
      bRuns[0][pairField] > aRuns[0][pairField]
      && bRuns[1][pairField] > aRuns[1][pairField],
    regression: comparison.materialIncrease
      && bRuns[0][pairField] > aRuns[0][pairField]
      && bRuns[1][pairField] > aRuns[1][pairField]
  };
}

function networkDirection(a, b) {
  const directions = {
    verySlowTransfer15sCount: a.verySlowTransfer15sCount > b.verySlowTransfer15sCount,
    slowTransfer5sCount: a.slowTransfer5sCount > b.slowTransfer5sCount,
    throughputP10Bps: a.throughputP10Bps !== null
      && b.throughputP10Bps !== null
      && b.throughputP10Bps > a.throughputP10Bps
  };
  return { ...directions, improvingSignals: Object.values(directions).filter(Boolean).length };
}

function safePooledRebuffer(runs) {
  const totalDuration = runs[0].wallDurationMs + runs[1].wallDurationMs;
  const ratio = safeRatio(
    runs[0].totalRebufferDurationMs + runs[1].totalRebufferDurationMs,
    totalDuration
  );
  return ratio;
}

export function analyzeAbba(runs) {
  const normalizedRuns = Array.isArray(runs) ? runs : [];
  const validityFailures = normalizedRuns.flatMap((run, index) =>
    (run.validityFailures ?? []).map((failure) => `run${index + 1}:${failure}`)
  );
  if (normalizedRuns.length !== 4) {
    validityFailures.push("EXPECTED_FOUR_RUNS");
  }
  if (validityFailures.length > 0) {
    return {
      verdict: "INVALID_ABBA",
      validityFailures,
      runs: normalizedRuns,
      pairs: [],
      safety: null,
      networkSupportPass: false,
      pooled: null
    };
  }

  const a1 = normalizedRuns[0];
  const b1 = normalizedRuns[1];
  const b2 = normalizedRuns[2];
  const a2 = normalizedRuns[3];
  const pairs = [makePair("pair1", a1, b1), makePair("pair2", a2, b2)];
  const pooledARuns = [a1, a2];
  const pooledBRuns = [b1, b2];
  const pooledA = safePooledRebuffer(pooledARuns);
  const pooledB = safePooledRebuffer(pooledBRuns);
  const pooledImprovement = pooledA > 0 ? (pooledA - pooledB) / pooledA : null;
  const pooled = {
    A: pooledA,
    B: pooledB,
    A_totalRebufferDurationMs: a1.totalRebufferDurationMs + a2.totalRebufferDurationMs,
    B_totalRebufferDurationMs: b1.totalRebufferDurationMs + b2.totalRebufferDurationMs,
    pooledImprovement,
    pooledImprovementLabel: pooledImprovement === null ? "N/A" : pooledImprovement,
    absoluteDeltaPooledRebufferRatio: pooledA !== null && pooledB !== null ? pooledB - pooledA : null,
    durationA: a1.wallDurationMs + a2.wallDurationMs,
    durationB: b1.wallDurationMs + b2.wallDurationMs
  };

  const audioSafety = safetyRateRegression(
    pooledARuns,
    pooledBRuns,
    "audioUnderrunCount",
    "audioUnderrunCount"
  );
  const droppedSafety = safetyRateRegression(
    pooledARuns,
    pooledBRuns,
    "droppedFramesTotal",
    "droppedFramesPerMinute"
  );
  const safety = {
    appCrashObserved: false,
    decoderError: normalizedRuns.some((run) => run.videoCodecErrorCount > 0 || run.audioCodecErrorCount > 0),
    videoCodecErrorCount: normalizedRuns.reduce((sum, run) => sum + run.videoCodecErrorCount, 0),
    audioCodecErrorCount: normalizedRuns.reduce((sum, run) => sum + run.audioCodecErrorCount, 0),
    fatalPlayerError: normalizedRuns.some((run) => run.playerErrorCount > 0),
    playerErrorCount: normalizedRuns.reduce((sum, run) => sum + run.playerErrorCount, 0),
    audioSafetyRegression: audioSafety.regression,
    droppedFrameSafetyRegression: droppedSafety.regression,
    audio: audioSafety,
    droppedFrames: droppedSafety
  };
  safety.pass = !safety.decoderError
    && !safety.fatalPlayerError
    && !safety.audioSafetyRegression
    && !safety.droppedFrameSafetyRegression;

  const networkPairs = [networkDirection(a1, b1), networkDirection(a2, b2)];
  const networkSupportPass = networkPairs.every((pair) => pair.improvingSignals >= 2);
  const numericEffects = pairs.every((pair) => typeof pair.effect === "number" && Number.isFinite(pair.effect));
  const strong = numericEffects
    && effectAtLeast(pairs[0], STRONG_EFFECT)
    && effectAtLeast(pairs[1], STRONG_EFFECT)
    && safety.pass
    && networkSupportPass;
  const partial = numericEffects
    && effectPositive(pairs[0])
    && effectPositive(pairs[1])
    && pooledImprovementAtLeast(pooled, MATERIAL_EFFECT)
    && !strong;
  const regression = numericEffects
    && effectAtLeast(pairs[0], -MATERIAL_EFFECT)
    && effectAtLeast(pairs[1], -MATERIAL_EFFECT);
  const conflictingDirections = numericEffects
    && ((pairs[0].effect > 0 && pairs[1].effect < 0) || (pairs[0].effect < 0 && pairs[1].effect > 0));
  const inconclusive = conflictingDirections
    && (effectAtLeast(pairs[0], MATERIAL_EFFECT)
      || effectAtLeast(pairs[1], MATERIAL_EFFECT)
      || effectAtLeast(pairs[0], -MATERIAL_EFFECT)
      || effectAtLeast(pairs[1], -MATERIAL_EFFECT));
  let verdict = "NO_MATERIAL_DIFFERENCE";
  if (strong) verdict = "OKHTTP_STRONG_WIN";
  else if (partial) verdict = "OKHTTP_PARTIAL_WIN";
  else if (regression) verdict = "OKHTTP_REGRESSION";
  else if (inconclusive) verdict = "INCONCLUSIVE_TEMPORAL_VARIABILITY";

  return {
    verdict,
    validityFailures: [],
    runs: normalizedRuns,
    pairs,
    pooled,
    safety,
    networkPairs,
    networkSupportPass,
    thresholds: { MATERIAL_EFFECT, STRONG_EFFECT }
  };
}

function jsonSafe(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonSafe(item)]));
  }
  return value;
}

export function formatResultMarkdown(result) {
  const safeResult = jsonSafe(result);
  const lines = [
    "# TASK5B2 A5 DataSource ABBA Result",
    "",
    `## Verdict\n\n${safeResult.verdict}`,
    "",
    "## Frozen Contracts",
    "",
    `- MATERIAL_EFFECT: ${MATERIAL_EFFECT * 100}%`,
    `- STRONG_EFFECT: ${STRONG_EFFECT * 100}%`,
    "- Pair order: A1 vs B1, A2 vs B2",
    "- absoluteDeltaRebufferRatio = B_rebufferRatio - A_rebufferRatio",
    "- A_pooled = (A1.totalRebufferDurationMs + A2.totalRebufferDurationMs) / (A1.wallDurationMs + A2.wallDurationMs)",
    "- B_pooled = (B1.totalRebufferDurationMs + B2.totalRebufferDurationMs) / (B1.wallDurationMs + B2.wallDurationMs)",
    "- pooledImprovement = (A_pooled - B_pooled) / A_pooled when A_pooled > 0; otherwise N/A",
    "- pooledImprovement: time-weighted rebuffer ratio, never the mean of pair effects",
    "- A=0,B=0: N/A + NEUTRAL_ZERO_REBUFFER; A=0,B>0: N/A + REGRESSION_FROM_ZERO",
    "- decoderError: VIDEO_CODEC_ERROR or AUDIO_CODEC_ERROR only",
    "- fatalPlayerError: PLAYER_ERROR only",
    "",
    "## Raw Parsed Metrics",
    "",
    "```json",
    JSON.stringify(safeResult.runs ?? [], null, 2),
    "```",
    "",
    "## Pair Results",
    "",
    "```json",
    JSON.stringify(safeResult.pairs ?? [], null, 2),
    "```",
    "",
    "## Pooled Result",
    "",
    "```json",
    JSON.stringify(safeResult.pooled, null, 2),
    "```",
    "",
    "## Safety and Network Gates",
    "",
    "```json",
    JSON.stringify({ safety: safeResult.safety, networkPairs: safeResult.networkPairs, networkSupportPass: safeResult.networkSupportPass }, null, 2),
    "```",
    "",
    "## Validity Failures",
    "",
    JSON.stringify(safeResult.validityFailures ?? []),
    ""
  ];
  return lines.join("\n");
}

function cliArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("--") && argv[index + 1] && !argv[index + 1].startsWith("--")) {
      values[argv[index].slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return values;
}

async function main() {
  const args = cliArguments(process.argv.slice(2));
  const required = ["a1", "b1", "b2", "a2", "output"];
  const missing = required.filter((key) => !args[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required arguments: ${missing.join(", ")}`);
  }
  const definitions = [
    ["a1", "DEFAULT"],
    ["b1", "OKHTTP"],
    ["b2", "OKHTTP"],
    ["a2", "DEFAULT"]
  ];
  const runs = definitions.map(([key, backend]) => {
    const file = resolve(args[key]);
    const run = parseRun(readFileSync(file, "utf8"), backend, DEFAULT_NODE);
    run.sourceName = basename(file);
    return run;
  });
  writeFileSync(resolve(args.output), formatResultMarkdown(analyzeAbba(runs)), "utf8");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
