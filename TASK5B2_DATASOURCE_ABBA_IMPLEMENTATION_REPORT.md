# TASK5B2 DataSource ABBA Implementation Report

## Verdict

**GREEN — DATASOURCE ABBA HARNESS READY FOR DEVICE TEST**

This is a code-and-CI readiness verdict. It does not prove that OkHttp wins, does not analyze real A5 logs, and does not start TASK5B3.

## Baseline and verification identity

- Implementation branch: `codex/task5b2-datasource-abba`
- Code baseline built by CI: `a742ed6fb7e8dc834fc16f7e587c880f34665043`
- Artifact workflow commit: `e133a18f185b6da660db1939fb2bd65fa3d01ead`
- CI run: [33302140213](https://github.com/markfxm/tv1-hls-player/actions/runs/33302140213)
- CI job: `assemble-debug` (the run completed successfully)
- CI result: `:app:assembleDebug` exit 0; `BUILD SUCCESSFUL in 49s`
- Artifact: `tv1-task5b2-a5-debug-apk`, available from the run's Artifacts section; GitHub artifact ID `9729295022`, archive size `5408883` bytes, extracted `app-debug.apk` size `5715651` bytes
- Downloaded artifact SHA256: `6564AEFAEEF4A26898FD9CC9F6538F19505BF82CF8C0FC6A40BFD97DFBCDD005`
- CI OS: `ubuntu-24.04`, Linux amd64 runner
- JDK: Temurin OpenJDK `17.0.20.1`
- Gradle: `8.9`
- Android SDK: Platform/API `35`; Build Tools `34.0.0`
- Android Gradle Plugin: `8.7.3`
- Media3: `1.8.0`
- Android configuration: `compileSdk 35`, `targetSdk 35`, `minSdk 23`

## Modified files

Task5B2 implementation and test checkpoints contain:

- `android/app/build.gradle`
- `android/app/src/main/java/com/tv1/player/DataSourceBackend.java`
- `android/app/src/main/java/com/tv1/player/DataSourceBackendSelector.java`
- `android/app/src/main/java/com/tv1/player/TransferDiagnostics.java`
- `android/app/src/main/java/com/tv1/player/InstrumentedDataSource.java`
- `android/app/src/main/java/com/tv1/player/InstrumentedDataSourceFactory.java`
- `android/app/src/main/java/com/tv1/player/PlaybackDataSourceFactory.java`
- `android/app/src/main/java/com/tv1/player/MainActivity.java`
- `android/app/src/main/java/com/tv1/player/PlaybackDiagnostics.java`
- `android/app/src/test/java/com/tv1/player/DataSourceBackendSelectorTest.java`
- `android/app/src/test/java/com/tv1/player/TransferDiagnosticsTest.java`
- `scripts/test_android_datasource_abba.mjs`
- `scripts/test_android_datasource_scope.mjs`
- `scripts/test_android_playback_codec_errors.mjs`
- `scripts/test_android_playback_diagnostics.mjs`
- `scripts/analyze_a5_datasource_abba.mjs`
- `scripts/test_analyze_a5_datasource_abba.mjs`
- `tests/fixtures/a5_datasource_abba/*.log` (synthetic fixtures only)
- `package.json`
- `.github/workflows/android-build.yml` (post-build APK artifact upload only)
- `TASK5B2_A5_DATASOURCE_ABBA_TEST_PROCEDURE.md`
- `TASK5B2_DATASOURCE_ABBA_IMPLEMENTATION_REPORT.md`

`TV1_source.zip` and `TV1_channels.m3u` were not added or modified.

## Architecture

### Backend selector and factory boundary

`DataSourceBackendSelector` accepts the debug `tv1.datasource` extra. Debug `okhttp` selects OKHTTP; missing, default, or unknown values select DEFAULT. Release builds always resolve DEFAULT. The existing HLS path still constructs `HlsMediaSource.Factory` with the selected `DataSource.Factory` and retains `DefaultLoadErrorHandlingPolicy`.

The DEFAULT raw factory is `DefaultHttpDataSource.Factory`. The OKHTTP raw factory is `OkHttpDataSource.Factory` with the exact Media3 dependency `media3-datasource-okhttp:1.8.0`. No custom HTTP timeout, cache, request header, or DataSource behavior was introduced.

### Transfer lifecycle and identity

One shared `TransferDiagnostics` listener instruments both raw factories before `InstrumentedDataSourceFactory` wraps them. Transfer state is keyed by the raw delegate `DataSource` identity. Before `delegate.open(dataSpec)`, the wrapper allocates a process-local monotonic `transferId`, creates state, and emits exactly one `TRANSFER_START`. A normal path emits exactly one `TRANSFER_END`; open/read/close errors emit exactly one `TRANSFER_ERROR`. Terminal state is cleaned up and late callbacks cannot emit another terminal event or an END after ERROR. Concurrent raw delegates cannot collide.

Transfer logs contain backend, transfer ID, node, byte count, duration, slow-transfer flags, and throughput. URL credentials, query authentication, headers, and full URLs are not logged.

### Diagnostics integration

The existing TASK5A `PlaybackDiagnostics` listener is reused. It receives the additive `dataSourceBackend` identity in session start/summary and now observes Media3 `onVideoCodecError` / `onAudioCodecError` as `VIDEO_CODEC_ERROR` / `AUDIO_CODEC_ERROR` without changing existing Task5A event names, metrics, hints, or five-second snapshot cadence. `PLAYER_ERROR` remains the only fatal-player signal. No crash subsystem was added; an incomplete long session is invalidated by the ABBA validity gate.

## Analyzer contracts

`parseRun`, `analyzeAbba`, and `formatResultMarkdown` are exported from `scripts/analyze_a5_datasource_abba.mjs`. The CLI accepts A1/B1/B2/A2 paths and an output path. It validates backend, node, display, session markers, and `durationMs >= 540000` before performance verdict evaluation.

For each pair:

```text
absoluteDeltaRebufferRatio = B_rebufferRatio - A_rebufferRatio
relativeImprovement = (A_rebufferRatio - B_rebufferRatio) / A_rebufferRatio, when A > 0
A = 0, B = 0 → N/A + NEUTRAL_ZERO_REBUFFER
A = 0, B > 0 → N/A + REGRESSION_FROM_ZERO
```

Pooled improvement is time-weighted:

```text
A_pooled = (A1.totalRebufferDurationMs + A2.totalRebufferDurationMs)
           / (A1.wallDurationMs + A2.wallDurationMs)
B_pooled = (B1.totalRebufferDurationMs + B2.totalRebufferDurationMs)
           / (B1.wallDurationMs + B2.wallDurationMs)
pooledImprovement = (A_pooled - B_pooled) / A_pooled, when A_pooled > 0
```

No epsilon, NaN, Infinity, or simple average of pair effects is used. Safety uses only approved signals: decoder error is codec-error event count; fatal player error is `PLAYER_ERROR`; audio/dropped-frame safety fails only on consistent pairwise worsening plus a pooled material increase of 30%. Network support requires at least two of three improving directions in both pairs: very-slow transfers decrease, slow transfers decrease, and throughput P10 increases.

Verdict precedence is frozen as:

1. `INVALID_ABBA`
2. `OKHTTP_STRONG_WIN` — both pair effects at least 50%, safety PASS, network support PASS
3. `OKHTTP_PARTIAL_WIN` — both effects positive, pooled improvement at least 30%, not strong
4. `OKHTTP_REGRESSION` — both effects at most -30%
5. `INCONCLUSIVE_TEMPORAL_VARIABILITY` — conflicting directions with at least one material effect
6. `NO_MATERIAL_DIFFERENCE`

Only the analyzer may emit these verdicts.

## Safety Signal Resolution

- `VIDEO_CODEC_ERROR`: RESOLVED via `AnalyticsListener.onVideoCodecError`
- `AUDIO_CODEC_ERROR`: RESOLVED via `AnalyticsListener.onAudioCodecError`
- `FATAL_PLAYER_ERROR`: RESOLVED via `AnalyticsListener.onPlayerError` / `PLAYER_ERROR`
- `APP_CRASH`: `VALIDITY_GATED` — no new crash subsystem added
- `TASK5A_EXISTING_METRICS`: UNCHANGED

## Frozen areas

This implementation does not change Web HLS recovery, NodeManager, LiveBufferManager, buffer durations, DataSource transport configuration, decoder selection/fallback, audio strategy, Surface type, tunneling, track selection, playback speed, display mode, HDMI mode, or automatic frame-rate switching. It does not adopt OkHttp as the production default.

## Test and build results

- `npm test`: PASS
- `npm run build`: PASS; existing Vite chunk-size warnings only
- `git diff --check`: PASS
- Local Android unit test: not executable; `gradle` is not installed
- Local Android debug/release commands: exit 1 with `'gradle' is not recognized`; recorded as `LOCAL_ANDROID_TOOLCHAIN_UNAVAILABLE`
- Android CI `:app:assembleDebug`: PASS, exit 0, `BUILD SUCCESSFUL`
- Android CI workflow: post-build `actions/upload-artifact@v4` step succeeded; existing assemble step and build inputs were unchanged
- APK artifact: downloadable as `tv1-task5b2-a5-debug-apk`; the downloaded APK hash above is the identity to record and reuse for every ABBA run

## Known limitations

- No real Egreat A5 logs have been collected in this implementation stage.
- No A1→B1→B2→A2 verdict exists; synthetic fixtures are test-only.
- The CI workflow compiles and publishes debug only; it does not perform device compatibility testing.
- Local Android unit/release verification remains unavailable until a JDK/Gradle/SDK environment is provided.
- Device behavior, startup latency, decoder load, audio underrun behavior, and network conditions still require the exact procedure on the target A5.

## Next gate

Download the fixed `tv1-task5b2-a5-debug-apk` artifact, verify and record its SHA256, install it once on the Egreat A5, and execute the procedure in `TASK5B2_A5_DATASOURCE_ABBA_TEST_PROCEDURE.md` using the same TASK5A Test A source. Preserve all four full/filtered logs and confirm a same-session `SESSION_SUMMARY` before advancing each run, then run the analyzer. Do not begin TASK5B3, change production defaults, or infer a winner before analyzer output and review.
