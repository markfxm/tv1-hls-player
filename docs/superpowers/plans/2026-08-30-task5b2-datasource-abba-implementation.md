# TASK5B2 DataSource ABBA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-debug-APK controlled DEFAULT-vs-OKHTTP DataSource ABBA harness for Egreat A5 without changing the production release backend.

**Architecture:** Keep the current HLS playback path and Task1–Task4 behavior intact. Add only a small debug-gated backend selector, a shared DataSource factory boundary, one shared transfer instrumentation layer, a deterministic ABBA analyzer, and an exact device-test procedure. Release builds always use the current Media3 DEFAULT backend.

**Tech Stack:** Android Java, Media3 1.8.0, `media3-datasource-okhttp:1.8.0`, OkHttp, Node.js test/analyzer scripts, GitHub Actions, JUnit 4 local JVM tests.

**Spec:** `docs/superpowers/specs/2026-08-30-task5b2-datasource-abba-design.md`

## Global Constraints

- Run the repository preflight before implementation and record `git status`, branch, HEAD, and the last five commits. Preserve the known untracked `TV1_source.zip` and `TV1_channels.m3u`; never stage, modify, delete, or include them.
- Use the current HLS construction and `DefaultHttpDataSource.Factory` as the DEFAULT baseline. If the baseline has drifted to another backend, stop with `DATASOURCE_BASELINE_DRIFT` and do not begin implementation.
- The exact experiment order is A1 → B1 → B2 → A2. A1/A2 use DEFAULT; B1/B2 use OKHTTP. The same debug APK, source node `052d52487bab`, display mode `1920x1080@60`, network, and test protocol are required for all four runs.
- The debug-only Intent extra is `tv1.datasource`. Missing, `default`, and unknown values resolve to DEFAULT. Only debug `okhttp` resolves to OKHTTP. Release builds resolve every value to DEFAULT.
- Add exactly `androidx.media3:media3-datasource-okhttp:1.8.0`. Construct OKHTTP with plain `new OkHttpClient.Builder().build()`; do not add custom timeouts, DNS, proxy, cache, interceptor, retry, connection-pool, or HTTP strategy behavior.
- Preserve these scope locks and assert them in tests/review: `BUFFER_UNCHANGED` (`15000 / 50000 / 1000 / 1000`), `LOAD_ERROR_POLICY_UNCHANGED`, `DECODER_UNCHANGED`, `AUDIO_UNCHANGED`, `SURFACE_UNCHANGED`, `TUNNELING_UNCHANGED`, `DISPLAY_MODE_UNCHANGED`, `FRAME_RATE_LOGIC_UNCHANGED`, `TASK4_RECOVERY_UNCHANGED`, `WEB_SRC_UNCHANGED`, `TASK1_UNCHANGED`, `TASK2_UNCHANGED`, `TASK3_UNCHANGED`.
- Do not modify `PlaybackDiagnostics` metric definitions, snapshot cadence, or observation-only behavior. Only add the backend identity to the existing session identity/log fields.
- Do not make the production default OkHttp. Do not start TASK5B3. Do not create a real-device result report until all four real logs exist and pass analyzer validity checks.
- Every implementation step starts with a failing focused test or contract check, then makes the smallest production change required to pass it, followed by the exact verification command named in that step.

## Repository Baseline and File Map

The implementation starts from `0ff8803fff845f9bbe0b20d32d5851b772591016` on `main`. The current Android app is under `android/app`; the HLS source construction is in `android/app/src/main/java/com/tv1/player/MainActivity.java`, and the existing Media3 version is 1.8.0. The current HLS path creates `DefaultHttpDataSource.Factory` and keeps `DefaultLoadErrorHandlingPolicy`. The current Android workflow is `.github/workflows/android-build.yml`, using JDK 17, Gradle 8.9, and Android API 35. Existing Web and Android static tests are wired from `package.json`.

Planned new source files:

- `android/app/src/main/java/com/tv1/player/DataSourceBackend.java`
- `android/app/src/main/java/com/tv1/player/DataSourceBackendSelector.java`
- `android/app/src/main/java/com/tv1/player/TransferDiagnostics.java`
- `android/app/src/main/java/com/tv1/player/InstrumentedDataSource.java`
- `android/app/src/main/java/com/tv1/player/InstrumentedDataSourceFactory.java`
- `android/app/src/main/java/com/tv1/player/PlaybackDataSourceFactory.java`
- `scripts/test_android_datasource_selector.mjs`
- `scripts/test_android_datasource_abba.mjs`
- `scripts/test_android_datasource_scope.mjs`
- `android/app/src/test/java/com/tv1/player/DataSourceBackendSelectorTest.java`
- `android/app/src/test/java/com/tv1/player/TransferDiagnosticsTest.java`
- `scripts/analyze_a5_datasource_abba.mjs`
- `scripts/test_analyze_a5_datasource_abba.mjs`
- `TASK5B2_A5_DATASOURCE_ABBA_TEST_PROCEDURE.md`
- `TASK5B2_DATASOURCE_ABBA_IMPLEMENTATION_REPORT.md`

The plan modifies only the listed Java/Node/test/document files, `android/app/build.gradle`, `MainActivity.java`, and `package.json`. It does not modify the Web player, Task1–Task4 logic, the existing workflow, or real-device logs.

## Task 1 — Freeze the selector contract and dependency

**Files:**

- Create `android/app/src/main/java/com/tv1/player/DataSourceBackend.java`.
- Create `android/app/src/main/java/com/tv1/player/DataSourceBackendSelector.java`.
- Modify `android/app/build.gradle`.
- Create `scripts/test_android_datasource_selector.mjs`.
- Create `android/app/src/test/java/com/tv1/player/DataSourceBackendSelectorTest.java`.
- Add the JUnit 4 local-test dependency to `android/app/build.gradle` only if the module does not already declare it: `testImplementation "junit:junit:4.13.2"`.

**Contract:**

```java
public enum DataSourceBackend {
    DEFAULT,
    OKHTTP
}

public final class DataSourceBackendSelector {
    public static DataSourceBackend resolve(String override, boolean debugBuild);
}
```

`resolve` returns `DEFAULT` for `null`, empty, `default`, unknown values, and every value when `debugBuild` is false. It returns `OKHTTP` only for case-insensitive `okhttp` when `debugBuild` is true. It has no Android dependency and no mutable state so the release rule is directly unit-testable.

**TDD sequence:**

1. Write `DataSourceBackendSelectorTest` for missing/default/unknown/debug-OkHttp/release-OkHttp cases and make the Node contract script assert the enum, selector signature, exact Media3 OkHttp dependency, and absence of a second dependency version.
2. Run `node scripts/test_android_datasource_selector.mjs`; expected RED is a missing selector source or missing exact dependency.
3. Add the enum, pure selector, exact dependency, and JUnit dependency if needed.
4. Run `node scripts/test_android_datasource_selector.mjs` and `gradle --no-daemon --stacktrace :app:testDebugUnitTest`; expected PASS includes all selector cases and the release fallback.

**Checkpoint:** No commit is made for this individual task. This task is included in the first implementation checkpoint after Tasks 2–4.

## Task 2 — Implement exactly-once transfer instrumentation

**Files:**

- Create `android/app/src/main/java/com/tv1/player/TransferDiagnostics.java`.
- Create `android/app/src/main/java/com/tv1/player/InstrumentedDataSource.java`.
- Create `android/app/src/main/java/com/tv1/player/InstrumentedDataSourceFactory.java`.
- Create `android/app/src/test/java/com/tv1/player/TransferDiagnosticsTest.java`.
- Extend `scripts/test_android_datasource_abba.mjs` with the transfer contract checks.

**Interfaces and state model:**

```java
public final class TransferDiagnostics implements TransferListener {
    public TransferDiagnostics(String backend, EventSink sink);
    public void beginBeforeOpen(DataSource source, DataSpec dataSpec);
    public void finishFromWrapper(DataSource source);
    public void failFromWrapper(DataSource source, DataSpec dataSpec, IOException error);
    public int getActiveTransferCount();
}

public interface EventSink {
    void log(String event, Map<String, String> fields);
}

public final class InstrumentedDataSource implements DataSource {
    public InstrumentedDataSource(DataSource delegate, TransferDiagnostics diagnostics);
}

public final class InstrumentedDataSourceFactory implements DataSource.Factory {
    public InstrumentedDataSourceFactory(DataSource.Factory delegate, TransferDiagnostics diagnostics);
}
```

The concrete visibility may be package-private for test-only state access, but the constructor/method behavior above must remain available to the factory and tests. `TransferDiagnostics` owns an `AtomicLong` process-local monotonic `transferId` and a synchronized identity-keyed map from each `DataSource` instance to its active transfer state. State includes backend, transfer ID, URI host/path-safe identity, byte count, start time, and terminal flag. Identity keys are object identity, not URL equality.

The wrapper performs `beginBeforeOpen` before calling `delegate.open(dataSpec)`, so `TRANSFER_START` exists even if open throws before the delegate listener callback. Delegate `TransferListener.onTransferStart` only enriches the existing state; it never emits START. `onBytesTransferred` updates byte count and throughput fields without per-read log spam. `onTransferEnd` requests normal terminal completion. Wrapper `close()` completes normal END only when no terminal event has occurred. Open/read/close exceptions call `failFromWrapper` and rethrow the original exception. Terminal transition is atomic/idempotent: each transfer emits exactly one `TRANSFER_END` or `TRANSFER_ERROR`, never both, then removes identity-map state. A later listener or close callback after ERROR is ignored.

Transfer logs use `[A5-NET]` and include `backend`, `transferId`, safe node identity, accumulated bytes, duration, and the transfer metrics needed by the analyzer (`slowTransfer5s`, `verySlowTransfer15s`, throughput). Full authenticated URLs are never logged.

**TDD sequence:**

1. Write fake delegate/listener tests for: normal START→END once; open exception before listener start START→ERROR once; listener `onTransferStart` does not duplicate START; read exception START→ERROR; close exception START→ERROR; ERROR never later emits END; active state is empty after every terminal; and two concurrent DataSource identities keep separate byte/terminal state.
2. Run `gradle --no-daemon --stacktrace :app:testDebugUnitTest`; expected RED is absent classes or failed exactly-once assertions.
3. Add the identity-map state machine and wrappers with no production playback calls, no retry, no seek, no buffering changes, and no asynchronous logging requirement.
4. Run the same command and `node scripts/test_android_datasource_abba.mjs`; expected PASS is one START plus one terminal for every fake transfer, correct bytes, no duplicate terminal, and zero active state.

**Checkpoint:** Included in the first implementation commit after Tasks 1–4:

```text
feat(android): add datasource ABBA experiment harness
```

## Task 3 — Add the shared backend factory boundary

**Files:**

- Create `android/app/src/main/java/com/tv1/player/PlaybackDataSourceFactory.java`.
- Extend `scripts/test_android_datasource_abba.mjs`.
- Extend `android/app/src/test/java/com/tv1/player/TransferDiagnosticsTest.java` only if a factory-level identity test is needed.

**Interface and behavior:**

```java
public final class PlaybackDataSourceFactory {
    public static DataSource.Factory create(
            DataSourceBackend backend,
            TransferDiagnostics diagnostics);
}
```

For `DEFAULT`, create `new DefaultHttpDataSource.Factory()` with no new settings. For `OKHTTP`, create `new OkHttpDataSource.Factory(new OkHttpClient.Builder().build())` with no custom settings. Both raw factories are wrapped by the same `InstrumentedDataSourceFactory` and receive the same `TransferDiagnostics` instance. This boundary does not alter `HlsMediaSource`, `DataSource`, HTTP policy, cache behavior, retries, or load error handling.

**TDD sequence:**

1. Extend the static contract test to require both factory types, the exact plain OkHttp client construction, one shared instrumentation wrapper, and no custom HTTP configuration tokens.
2. Run `node scripts/test_android_datasource_abba.mjs`; expected RED is the missing provider or missing shared wrapper.
3. Add the provider and compile-time imports.
4. Run `node scripts/test_android_datasource_abba.mjs` and `gradle --no-daemon --stacktrace :app:testDebugUnitTest`; expected PASS confirms distinct DEFAULT/OKHTTP factories, exact dependency version, and shared transfer instrumentation.

**Checkpoint:** Included in the first implementation commit.

## Task 4 — Wire the debug selector into the existing HLS path

**Files:**

- Modify `android/app/src/main/java/com/tv1/player/MainActivity.java`.
- Modify `android/app/src/main/java/com/tv1/player/PlaybackDiagnostics.java` additively.
- Extend `scripts/test_android_datasource_abba.mjs`.
- Create or extend `scripts/test_android_datasource_scope.mjs`.

**TDD sequence:**

1. Before changing Java, make the integration contract test fail unless MainActivity reads `tv1.datasource` through `BuildConfig.DEBUG`, resolves through `DataSourceBackendSelector`, creates one `TransferDiagnostics`, passes the selected backend through `PlaybackDataSourceFactory.create`, logs `[A5-DATASOURCE] backend=DEFAULT|OKHTTP`, and includes `dataSourceBackend` in `SESSION_START` and `SESSION_SUMMARY`.
2. Run `node scripts/test_android_datasource_abba.mjs` and `node scripts/test_android_datasource_scope.mjs`; expected RED is absent wiring.
3. In the existing HLS branch, replace only the raw `new DefaultHttpDataSource.Factory()` argument with the selected shared factory. Keep `new DefaultLoadErrorHandlingPolicy()` and every surrounding HLS recovery/state/failover call unchanged. Keep non-HLS source construction unchanged.
4. Create one diagnostics instance for the player lifetime, attach it through the existing diagnostics/listener lifecycle, log the backend once per session, and pass the backend into an additive `PlaybackDiagnostics.startSession(String url, String dataSourceBackend)` overload. Preserve the existing `startSession(String url)` overload by delegating to DEFAULT if current callers require it. Do not add another competing listener set.
5. Ensure channel/node switch calls the existing session stop path before starting the new session; the new identity is additive and does not alter playback control or recovery timers.
6. Run `node scripts/test_android_datasource_abba.mjs`, `node scripts/test_android_datasource_scope.mjs`, and `gradle --no-daemon --stacktrace :app:testDebugUnitTest`; expected PASS confirms debug selection, release fallback in the pure selector, one shared instrumentation path, session identity, and unchanged Task1–Task5A contracts.

The scope test must assert the current baseline buffer call remains `setBufferDurationsMs(15000, 50000, 1000, 1000)`, no Treatment B values were added, no byte-based buffering settings were added, and no new `OkHttpDataSource`, `MediaCodecSelector`, `setTunnelingEnabled`, decoder-fallback, `TextureView`, `setPlaybackSpeed`, or `AudioProcessor` configuration was introduced outside the explicitly permitted factory/dependency locations. It must also assert that the existing `DefaultLoadErrorHandlingPolicy` remains attached to `HlsMediaSource.Factory`.

**Checkpoint:** After Tasks 1–4 pass, inspect the staged file list and commit only the harness/dependency/wiring files:

```text
feat(android): add datasource ABBA experiment harness
```

## Task 5 — Build the deterministic ABBA analyzer

**Files:**

- Create `scripts/analyze_a5_datasource_abba.mjs`.
- Create `scripts/test_analyze_a5_datasource_abba.mjs`.
- Create synthetic fixtures under `tests/fixtures/a5_datasource_abba/` for valid A1/B1/B2/A2 runs and invalid/zero-baseline/threshold cases. These are test fixtures only, never real device logs.
- Modify `package.json` to run the analyzer test.

**Exports and CLI:**

```javascript
export function parseRun(text, expectedBackend, expectedNode)
export function analyzeAbba(runs)
export function formatResultMarkdown(result)
```

The CLI requires all four input paths and an output path:

```text
node scripts/analyze_a5_datasource_abba.mjs --a1 a1_diag.log --b1 b1_diag.log --b2 b2_diag.log --a2 a2_diag.log --output TASK5B2_A5_DATASOURCE_ABBA_RESULT.md
```

Parse `[A5-DATASOURCE]`, `[A5-DIAG] SESSION_START`, `[A5-DIAG] SESSION_SUMMARY`, `[A5-DIAG] SNAPSHOT`, `[A5-DIAG] BANDWIDTH`, and `[A5-NET] TRANSFER_END|TRANSFER_ERROR` fields. Use safe unknown handling for missing/`unknown`/unset values. Require each run to be at least nine minutes and near the ten-minute protocol, the expected backend, node `052d52487bab`, display `1920x1080@60`, and both `SESSION_START` and `SESSION_SUMMARY`. Missing summary returns `INVALID_RUN_INCOMPLETE_SESSION`; any validity failure produces overall `INVALID_ABBA` before performance verdict evaluation.

The per-run object must include wall duration, buffering count/duration/longest/min/median/average/max, dropped frames and per-minute rate, audio underruns, bandwidth min/median/average, player/decoder errors, startup latency, transfer slow counts, transfer throughput P10, session identity, backend, node, display, and summary presence. Preserve the distinction between callback interval dropped frames and session total dropped frames.

Implement the exact zero-safe contracts:

- `absoluteDeltaRebufferRatio = B_rebufferRatio - A_rebufferRatio` for every pair.
- If `A_rebufferRatio > 0`, `relativeImprovement = (A_rebufferRatio - B_rebufferRatio) / A_rebufferRatio`.
- If `A_rebufferRatio == 0 && B_rebufferRatio == 0`, `relativeImprovement = N/A` and `pairResult = NEUTRAL_ZERO_REBUFFER`.
- If `A_rebufferRatio == 0 && B_rebufferRatio > 0`, `relativeImprovement = N/A` and `pairResult = REGRESSION_FROM_ZERO`.
- Never use epsilon and never serialize NaN or Infinity.

Implement the exact time-weighted pooled contract:

```text
A_pooled = (A1.totalRebufferDurationMs + A2.totalRebufferDurationMs)
           / (A1.wallDurationMs + A2.wallDurationMs)
B_pooled = (B1.totalRebufferDurationMs + B2.totalRebufferDurationMs)
           / (B1.wallDurationMs + B2.wallDurationMs)
```

When `A_pooled > 0`, `pooledImprovement = (A_pooled - B_pooled) / A_pooled`; when `A_pooled == 0`, it is `N/A`. Always report finite `absoluteDeltaPooledRebufferRatio = B_pooled - A_pooled`. Do not average pair effects and do not use epsilon.

Implement `SAFETY_PASS` exactly as specified: no app crash, no decoder error, and no fatal player error. Audio safety fails only when B1 audio underruns exceed A1, B2 exceed A2, and the pooled B audio-underrun rate is at least 30% above pooled A, with the zero-baseline rule applied without Infinity. Dropped-frame safety uses the same pairwise and pooled 30% rule. Use the same-unit time-weighted rates; `A=0,B=0` is no regression, and `A=0,B>0` is a positive absolute regression.

Implement `NETWORK_SUPPORT_PASS`: in both pairs, at least two of these three directions improve consistently: `verySlowTransfer15sCount` decreases, `slowTransfer5sCount` decreases, `throughputP10Bps` increases. Do not introduce a composite score.

Implement frozen verdict precedence and thresholds, in this order:

1. `INVALID_ABBA`
2. `OKHTTP_STRONG_WIN`: pair1 and pair2 effects are each at least 50%, safety PASS, and network support PASS.
3. `OKHTTP_PARTIAL_WIN`: both pair effects are positive, the exact pooled improvement is at least 30%, and the strong condition is false.
4. `OKHTTP_REGRESSION`: both pair effects are at most -30%.
5. `INCONCLUSIVE_TEMPORAL_VARIABILITY`: pair directions conflict and at least one absolute effect is at least 30%.
6. `NO_MATERIAL_DIFFERENCE` otherwise.

Zero-rebuffer pair results remain their special labels and are not forced into percentages. The result Markdown must show all raw metrics, formulas, pair classifications, pooled values, safety/network gates, validity failures, and the final verdict.

**TDD sequence:**

1. Write synthetic tests for valid ABBA parsing, wrong backend/node/display, missing summary, short run, exact pooled calculation, zero baseline A/B, 30% and 50% boundaries, safety regression, network support, precedence, and finite output.
2. Run `node scripts/test_analyze_a5_datasource_abba.mjs`; expected RED is the missing analyzer or failed contract assertions.
3. Add the parser, metric reducers, zero-safe formulas, safety/network gates, precedence evaluator, formatter, and CLI argument validation.
4. Run `node scripts/test_analyze_a5_datasource_abba.mjs`; expected PASS includes every frozen verdict and no NaN/Infinity in serialized output.

**Checkpoint:** After analyzer tests pass, commit only analyzer/tests/fixtures/package-script changes:

```text
test(android): add datasource ABBA analyzer
```

## Task 6 — Add scope-lock and regression coverage to the repository test entrypoint

**Files:**

- Finalize `scripts/test_android_datasource_scope.mjs`.
- Finalize `scripts/test_android_datasource_abba.mjs`.
- Modify `package.json` only to include these focused scripts and the analyzer test in `npm test`.

The static checks must verify:

- selector and release fallback contract;
- exact OkHttp dependency version;
- distinct DEFAULT/OKHTTP factory construction;
- shared `TransferDiagnostics` instrumentation;
- START-before-open and exactly-once terminal semantics in Java source/tests;
- `[A5-DATASOURCE]` identity and additive `dataSourceBackend` session fields;
- unchanged HLS recovery/error policy and baseline buffer values;
- no Task5B1 treatment values or forbidden decoder/audio/surface/tunneling/display/network changes;
- no Web source changes;
- analyzer CLI/formulas/thresholds/validity labels;
- no result report or real logs are added.

**Verification sequence:**

1. Run `npm test`; expected RED before the scripts/wiring are complete and PASS after all existing tests plus the new focused checks run.
2. Run `npm run build`; expected PASS with the Web build unchanged.
3. Run `git diff --check`; expected PASS.
4. Inspect `git diff --name-only` and confirm only planned files are changed; specifically confirm `TV1_source.zip` and `TV1_channels.m3u` remain untracked and untouched.

No snapshot test may compare an entire source file. Assertions must target exact contracts and forbidden additions so unrelated formatting does not make the test brittle.

## Task 7 — Add device procedure, implementation report, and compile verification

**Files:**

- Create `TASK5B2_A5_DATASOURCE_ABBA_TEST_PROCEDURE.md`.
- Create `TASK5B2_DATASOURCE_ABBA_IMPLEMENTATION_REPORT.md`.
- Do not create `TASK5B2_A5_DATASOURCE_ABBA_RESULT.md` in this implementation stage.

The procedure must document:

- the fixed APK SHA and source node `052d52487bab` requirement;
- the exact Egreat A5 ADB path `E:\AI\高清电影播放器\platform-tools-latest-windows\platform-tools\adb.exe`, serial `192.168.1.190:5555`, and launcher `com.tv1.player/.MainActivity`;
- install once, force-stop before every run, and launch each backend with `--es tv1.datasource default` or `--es tv1.datasource okhttp`;
- A1 → B1 → B2 → A2, ten minutes per run, 30–60 second capture interval, same source/network/display, no reboot, no channel switch, no remote interaction;
- logcat collection and filters for `A5-DIAG|A5-DATASOURCE|A5-NET`, including Windows PowerShell commands that save full and filtered logs;
- required `SESSION_START`, `SESSION_SUMMARY`, backend/node/display identity, and invalidation conditions;
- the primary metric table, startup-latency comparison, subjective observations as secondary evidence, and the analyzer command;
- the rule that only the analyzer can assign `STRONG_IMPROVEMENT`, `PARTIAL_IMPROVEMENT`, `NO_MATERIAL_IMPROVEMENT`, or `INVALID_TEST` to the real A/B result, and that no winner is inferred from one run.

The implementation report must use the code-stage verdict:

```text
GREEN — DATASOURCE ABBA HARNESS READY FOR DEVICE TEST
```

It must include baseline HEAD, modified files, architecture, selector/release behavior, exact transfer lifecycle, URL privacy, diagnostics integration, analyzer formulas/thresholds/precedence, frozen areas, test results, CI result, ADB procedure, artifact note, known limitations, and next gate. It must explicitly state that this verdict does not prove OkHttp wins and does not start TASK5B3.

**Final verification sequence:**

1. Run `npm test`, `npm run build`, and `git diff --check`.
2. From `android`, run `gradle --no-daemon --stacktrace :app:testDebugUnitTest`.
3. Run `gradle --no-daemon --stacktrace :app:assembleDebug` and record the real exit code and `BUILD SUCCESSFUL` output.
4. Run `gradle --no-daemon --stacktrace :app:assembleRelease`. If release signing prevents packaging while compilation is otherwise reached, record exactly `RELEASE_COMPILE_BLOCKED_BY_SIGNING`; do not remove or bypass signing configuration.
5. Push the implementation branch only after local checks and inspect the existing `.github/workflows/android-build.yml` run. Confirm the actual `:app:assembleDebug` job succeeds before writing the compile result in the report. Do not modify the workflow unless the actual run exposes a workflow defect.
6. Stage only the planned implementation/report files, verify `git diff --cached --name-only`, and make the documentation checkpoint commit:

```text
docs(android): add datasource ABBA device procedure
```

The final code-stage stop condition is device-test readiness. Do not run the four-round experiment, install the APK, analyze real logs, change production defaults, or begin TASK5B3 in this implementation cycle.

## Commit Checkpoints

The implementation uses three reviewable commits, while each task above remains independently testable:

1. `feat(android): add datasource ABBA experiment harness` — Tasks 1–4: selector, exact dependency, transfer state machine, shared factories, HLS wiring, additive session identity, and scope checks.
2. `test(android): add datasource ABBA analyzer` — Tasks 5–6: parser, formulas, safety/network gates, frozen verdict precedence, synthetic fixtures, and npm test integration.
3. `docs(android): add datasource ABBA device procedure` — Task 7: exact ADB/device procedure, implementation report, final verification record, and no real-run result.

At every checkpoint, stage explicit paths only, confirm the two known untracked files are not staged, run the relevant tests, and inspect `git diff --check`.

## Self-Review Checklist Before Implementation Begins

- [ ] The current baseline is still direct `DefaultHttpDataSource.Factory`; otherwise stop with `DATASOURCE_BASELINE_DRIFT`.
- [ ] The selector has a pure release fallback and no production-default OkHttp path.
- [ ] The HLS factory preserves `DefaultLoadErrorHandlingPolicy` and Task1–Task4 behavior.
- [ ] Transfer START is emitted before `delegate.open()`, listener START only enriches state, and every terminal path is exactly once with cleanup.
- [ ] Both backends share transfer instrumentation and emit safe node identity without authenticated query strings.
- [ ] TASK5A diagnostics remain observation-only with unchanged metric definitions and snapshot interval.
- [ ] Analyzer uses time-weighted pooled ratios, zero-safe arithmetic, 30%/50% thresholds, exact safety/network gates, and frozen precedence.
- [ ] `SESSION_START` and `SESSION_SUMMARY` are mandatory for a valid long run.
- [ ] Static tests are focused contract tests rather than whole-file snapshots.
- [ ] `npm test`, `npm run build`, Android unit tests, and real CI `assembleDebug` are required before the code-stage verdict.
- [ ] No real-device result, OkHttp production adoption, buffer/decoder/audio/surface/tunneling/display change, or TASK5B3 work is included.

**Next gate:** `WAITING_FOR_IMPLEMENTATION_APPROVAL`
