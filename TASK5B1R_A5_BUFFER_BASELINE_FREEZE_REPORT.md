# TASK5B1R A5 Buffer Baseline Freeze Report

## Verdict

GREEN — A5 BUFFER BASELINE RESTORED AND FROZEN

This verdict confirms that the rejected Treatment B profile has been rolled back and that the known clean pre-treatment baseline is protected by a focused test. It does not claim that the severe A5 stutter is solved.

## Preflight

- `BRANCH=main`
- `STARTING_HEAD=26641a0003399e66bacd08b6287f2468844ec526`
- Starting worktree: only the known untracked `TV1_source.zip` and `TV1_channels.m3u`.
- `git diff --check`: PASS before implementation.
- Expected TASK5B1 history was present: `d4f50f3 perf(android): tune A5 playback buffer profile` and its follow-up documentation commit.
- The untracked user files remained untouched, unstaged, and uncommitted.
- `TASK5B1_A5_BUFFER_AB_RESULT.md` did not exist, so no historical A/B result report was fabricated.

## Reason

The real TASK5B1 device A/B result is:

`NO_MATERIAL_IMPROVEMENT — REGRESSION OBSERVED`

Treatment B used the same recorded node identity:

```text
nodeId=052d52487bab
urlHost=43.152.224.209
```

Observed Treatment B data:

| Metric | Treatment B |
| --- | ---: |
| Session duration | 630743 ms |
| `BUFFERING_START` count | 115 |
| `rebufferCount` | 114 |
| `totalRebufferDurationMs` | 450761 |
| `longestRebufferMs` | 17298 |
| `bufferMinMs` | 0 |
| `bufferAvgMs` | 733 |
| `bufferMaxMs` | 3729 |
| Diagnostic hint | `BUFFER_STARVATION` |
| Low observed media input samples | 106072 bps, 630950 bps |

Baseline A recorded 26 `BUFFERING_START` events. Treatment B recorded 115 and was visibly worse. Treatment B did not solve media-ingest starvation.

## Rollback

Before rollback, the production profile was:

```text
20000 / 60000 / 5000 / 5000
```

After rollback, it is:

```text
15000 / 50000 / 1000 / 1000
```

The production change was limited to the four `DefaultLoadControl` time arguments in `MainActivity.java`.

## Baseline freeze test

The former treatment test was renamed from:

```text
scripts/test_android_a5_buffer_profile.mjs
```

to:

```text
scripts/test_android_a5_buffer_baseline.mjs
```

It now asserts the exact baseline:

```text
setBufferDurationsMs(15000, 50000, 1000, 1000)
```

It retains only focused checks that no byte-based buffering or sensitive ingest/decoder/tunneling/audio configuration was added. `package.json` runs this baseline freeze test as part of `npm test`.

## Baseline versus Treatment summary

| Profile | `minBufferMs` | `maxBufferMs` | `bufferForPlaybackMs` | `bufferForPlaybackAfterRebufferMs` | Device outcome |
| --- | ---: | ---: | ---: | ---: | --- |
| Baseline A | 15000 | 50000 | 1000 | 1000 | Known clean pre-treatment baseline |
| Treatment B | 20000 | 60000 | 5000 | 5000 | `REGRESSION OBSERVED` |

The buffer-treatment experiment is rejected. Increasing time-based LoadControl thresholds did not solve the observed A5 playback starvation. This rollback does not prove that Baseline A solves the severe stutter; it only restores a known clean experimental baseline for the next investigation.

The source throughput differed between physical runs, so this report does not conclude that larger buffers intrinsically caused every regression. The device evidence still strongly indicates media-ingest starvation rather than HiSilicon H.264 decoder overload. The next investigation must isolate the ingest path.

## Frozen areas

The following areas are `UNCHANGED` in TASK5B1R:

- DataSource, HttpDataSource, DefaultHttpDataSource, OkHttpDataSource, Cronet, and HLS source factory;
- HTTP headers, timeout, retry policy, connection reuse, and redirects;
- MediaCodecSelector, DefaultRenderersFactory, decoder fallback, and codec priority;
- SurfaceView/TextureView, tunneling, frame-rate matching, display refresh rate, HDMI mode, and video scaling;
- DefaultAudioSink, AudioTrack, AAC decoder selection, audio processor, passthrough, audio buffer, and timestamp handling;
- Task4 Media3 recovery and `DefaultLoadErrorHandlingPolicy`;
- TASK5A `PlaybackDiagnostics`, `[A5-DIAG]` sampling, heuristics, and logging interval;
- Web `src/`, including Task1 HLS Recovery, Task2 node failover, and Task3 LiveBufferManager.

The existing TASK5B1 implementation report remains unchanged. No real-device log was added to the repository.

## Audio known issue

The TASK5B1 Treatment full log recorded:

- `DefaultAudioSink: Spurious audio timestamp (system clock mismatch)`;
- `MediaCodecAudioRenderer: Audio sink error`;
- `AudioSink$UnexpectedDiscontinuityException`.

This remains a separate A5 audio timestamp compatibility issue. TASK5B1R does not attempt to fix AAC, AudioTrack, audio buffering, passthrough, or timestamp handling.

## Tests

- `npm test`: PASS, exit code `0`.
- `npm run build`: PASS, exit code `0`.
- `git diff --check`: PASS.
- Baseline freeze static test: PASS.
- Existing Task1–Task4 and TASK5A diagnostics static tests: PASS.

## Android CI

- Run: [Android build 33290882742](https://github.com/markfxm/tv1-hls-player/actions/runs/33290882742)
- Job: [assemble-debug 99202180832](https://github.com/markfxm/tv1-hls-player/actions/runs/33290882742/job/99202180832)
- Commit SHA: `6237c562163733f8ed780d11d2e8b3c55fafdcf3`
- Runner: `ubuntu-24.04`
- Actual Java: OpenJDK `17.0.20.1`
- Gradle: `8.9`
- Android SDK: `platforms;android-35` revision `2`
- Android Build-Tools: `34.0.0`
- AGP: `8.7.3`
- Media3: `1.8.0`
- Command: `gradle --no-daemon --stacktrace :app:assembleDebug`
- Result: `:app:assembleDebug` PASS; log contains `BUILD SUCCESSFUL in 16s`.
- APK artifact: not uploaded by the existing workflow.

The CI run also contains existing GitHub Actions runtime deprecation annotations for checkout/setup-java; they did not affect compilation and were outside TASK5B1R scope.

## Git history

- Treatment implementation retained: `d4f50f3 perf(android): tune A5 playback buffer profile`
- Treatment report retained: `26641a0 docs(android): document A5 buffer profile treatment`
- Rollback implementation: `6237c56 revert(android): restore A5 buffer baseline`
- Rollback report: separate documentation commit adding this file.
- No reset, rebase, force push, history rewrite, or user-file cleanup was used.

## Remaining known issues

1. The severe A5 source remains affected by media-ingest starvation.
2. Audio timestamp discontinuity and audio sink errors remain separate follow-up issues.
3. Frame rate remains unknown from the supplied result summary.
4. Treatment B startup/rebuffer trade-off is no longer the active production profile.
5. TASK5B2 has not started.

## Next gate

READY_FOR_TASK5B2_DATASOURCE_AB

The next task requires explicit approval. Do not add OkHttp, modify DataSource, change timeouts or headers, or alter decoder/audio behavior as part of TASK5B1R.
