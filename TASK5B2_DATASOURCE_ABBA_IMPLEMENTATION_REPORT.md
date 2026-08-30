# TASK5B2 DataSource ABBA Implementation Report

## Verdict

**TASK5B2_BACKEND_PERSISTENCE_FIX_READY_FOR_A5_SMOKE_TEST**

This is a code-and-CI verdict for the narrowly scoped backend-persistence fix. Formal A1→B1→B2→A2 is not authorized until the short real-A5 target-node smoke test passes. This report does not prove that OkHttp wins, does not analyze an ABBA run, and does not start TASK5B3.

## Baseline and verification identity

- Implementation branch: `codex/task5b2-datasource-abba`
- Code baseline built by CI: `b8f9bc84dc923dcc0e39ca0ab999d2ac0a46f9ca`
- CI run: [33314788094](https://github.com/markfxm/tv1-hls-player/actions/runs/33314788094)
- CI job: `assemble-debug` (the run completed successfully)
- CI result: `:app:assembleDebug` exit 0; `BUILD SUCCESSFUL in 46s`
- Artifact: `tv1-task5b2-a5-debug-apk`, available from the run's Artifacts section; GitHub artifact ID `9733103343`, archive size `5408979` bytes, extracted `app-debug.apk` size `5715731` bytes
- Downloaded artifact SHA256: `2170F999D3C6A5A831180DCAB4A1C41033A5C72CDD54B06E902A0BB1EB5C3FD7`
- Superseded APK SHA256, prohibited for further testing: `6564AEFAEEF4A26898FD9CC9F6538F19505BF82CF8C0FC6A40BFD97DFBCDD005`
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
- `scripts/test_android_datasource_backend_persistence.mjs`
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

### Root-cause audit

- `ROOT_CAUSE=` `DataSourceBackendSelector.resolve(...)` was correctly called once in `MainActivity.initPlayer()`. The required node `052d52487bab` is the packaged `H264-FLV` node, so `isHlsUrl(node.url)` returned false. The old non-HLS branch then hard-coded the diagnostics identity to `DEFAULT` and called `player.setMediaItem(mediaItem)`, bypassing the Activity-selected `DataSource.Factory`. The observed drift was caused by this source-type branch, not by a second selector call.
- `BACKEND_RESOLUTION_CALL_SITES=` one call in `MainActivity.initPlayer()`, reading `tv1.datasource` and storing it as the Activity-scoped `selectedDataSourceBackend`; no call exists in channel selection, node selection, automatic failover, or session startup.
- `HLS_FACTORY_CREATION_CALL_SITES=` `MainActivity.playActiveNode()` constructs `HlsMediaSource.Factory(hlsDataSourceFactory)` for HLS and preserves `DefaultLoadErrorHandlingPolicy`. The same Activity-selected factory now constructs `ProgressiveMediaSource.Factory(hlsDataSourceFactory)` for FLV/progressive sources.
- `SOURCE_SWITCH_PATH=` channel button / `selectChannel(...)`, node button, fullscreen channel switch, or `tryNextNode()` → `playActiveNode(...)` → stop old diagnostics session → read the same `selectedDataSourceBackend` → log/start the new diagnostics session → create HLS or progressive media source with the same selected factory.

### Backend selector and factory boundary

`DataSourceBackendSelector` accepts the debug `tv1.datasource` extra. Debug `okhttp` selects OKHTTP; missing, default, or unknown values select DEFAULT. Release builds always resolve DEFAULT. `MainActivity` resolves this exactly once and does not globally cache it across Activity recreation. The existing HLS path still constructs `HlsMediaSource.Factory` with the selected `DataSource.Factory` and retains `DefaultLoadErrorHandlingPolicy`; FLV/progressive playback now uses `ProgressiveMediaSource.Factory` with that same selected factory.

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
- Focused backend persistence test: PASS after verified RED failures for non-HLS DEFAULT fallback and multiple assignment
- Local Android unit test: not executable; `gradle` is not installed
- Local Android debug/release commands: exit 1 with `'gradle' is not recognized`; recorded as `LOCAL_ANDROID_TOOLCHAIN_UNAVAILABLE`
- Android CI `:app:assembleDebug`: PASS, exit 0, `BUILD SUCCESSFUL`
- Android CI workflow: post-build `actions/upload-artifact@v4` step succeeded; existing assemble step and build inputs were unchanged
- APK artifact: downloadable as `tv1-task5b2-a5-debug-apk`; the downloaded APK hash above is the identity to record and reuse for every ABBA run

## Known limitations

- The real A5 pre-device smoke test exposed the superseded APK's backend drift; no smoke test has yet been run with the new APK.
- No A1→B1→B2→A2 verdict exists; synthetic fixtures are test-only.
- The CI workflow compiles and publishes debug only; it does not perform device compatibility testing.
- Local Android unit/release verification remains unavailable until a JDK/Gradle/SDK environment is provided.
- Device behavior, startup latency, decoder load, audio underrun behavior, and network conditions still require the exact procedure on the target A5.

## Next gate

Download the fixed `tv1-task5b2-a5-debug-apk` artifact and verify SHA256 `2170F999D3C6A5A831180DCAB4A1C41033A5C72CDD54B06E902A0BB1EB5C3FD7`. Install it on the Egreat A5 and perform only the short `tv1.datasource=okhttp` target-node smoke test in `TASK5B2_A5_DATASOURCE_ABBA_TEST_PROCEDURE.md`. Formal ABBA remains stopped until logs prove `[A5-DATASOURCE] backend=OKHTTP` and `SESSION_START dataSourceBackend=OKHTTP nodeId=052d52487bab` for the target source. Do not begin TASK5B3, change production defaults, or infer a winner.
