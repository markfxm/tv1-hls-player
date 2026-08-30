# TASK5B1 Egreat A5 Buffer Profile Implementation Report

## Verdict

GREEN — A5 BUFFER TREATMENT READY FOR DEVICE A/B

This is a code, regression-test, and Android-CI verdict. It does not mean that A5 stutter is fixed. Treatment B still requires a controlled Egreat A5 run using the same source and conditions as TASK5A Test A.

## Baseline

- `BASELINE_HEAD=441e318d02a374df2f7776be9f8d6c36dccb7134`
- Branch: `main`
- Baseline `DefaultLoadControl`: `15000 / 50000 / 1000 / 1000`
- No `targetBufferBytes` or `prioritizeTimeOverSizeThresholds` configuration was present.
- The only pre-existing untracked files were `TV1_source.zip` and `TV1_channels.m3u`; neither was changed or staged.
- TASK5A logs and any user files were not touched.

## Production change

`android/app/src/main/java/com/tv1/player/MainActivity.java` now uses:

```java
.setBufferDurationsMs(20000, 60000, 5000, 5000)
```

Only the four time-based `DefaultLoadControl` durations changed:

| Parameter | Baseline A | Treatment B | Meaning |
| --- | ---: | ---: | --- |
| `minBufferMs` | 15000 | 20000 | Build a larger forward buffer before normal steady-state loading. |
| `maxBufferMs` | 50000 | 60000 | Allow a larger stability margin. |
| `bufferForPlaybackMs` | 1000 | 5000 | Accumulate more content before initial playback starts. |
| `bufferForPlaybackAfterRebufferMs` | 1000 | 5000 | Accumulate more content after a rebuffer before resuming. |

The primary experimental variable is the last parameter: recovery waits for approximately 5 seconds of playback buffer instead of 1 second. This may increase channel-switch and recovery startup latency, but is intended to reduce rapid buffer-exhaustion oscillation.

No byte-based buffering setting was added. No DataSource, HTTP policy, HLS source factory, decoder selection, renderer, tunneling, track selection, audio path, playback speed, Surface, display mode, or Task4 recovery policy was changed.

## Files changed

- `android/app/src/main/java/com/tv1/player/MainActivity.java`
  - Changed only the four buffer-duration arguments.
- `scripts/test_android_a5_buffer_profile.mjs`
  - Added focused static checks for the exact Treatment B values and sensitive-setting exclusions.
- `scripts/test_android_media3_stability.mjs`
  - Removed the obsolete fixed assertion for the Baseline A values while retaining the existing LoadControl and Task4 checks.
- `package.json`
  - Added the focused buffer-profile test to `npm test`.

The existing `.github/workflows/android-build.yml` was not modified. TASK5A `PlaybackDiagnostics` source and sampling logic were not modified; diagnostics remain enabled for debug builds.

## Static test coverage

The focused test verifies:

- `setBufferDurationsMs(20000, 60000, 5000, 5000)` is present;
- `targetBufferBytes` and `prioritizeTimeOverSizeThresholds` were not added;
- no new `OkHttpDataSource`, `MediaCodecSelector`, tunneling, decoder-fallback, `TextureView`, playback-speed, or `AudioProcessor` configuration was added.

The test was observed failing before the production edit with:

```text
Error: TASK5B1 treatment must use setBufferDurationsMs(20000, 60000, 5000, 5000).
```

It passed after the four values were changed. This static check does not replace Android compilation or device testing.

## Regression verification

- `npm test`: PASS, exit code `0`
  - Existing Web, Task1, Task2, Task3, Task4, and TASK5A diagnostics checks passed.
  - New Android A5 buffer treatment check passed.
- `npm run build`: PASS, exit code `0`
  - Vite production build completed successfully.
  - The existing large-chunk warning remains non-fatal.

## Android CI verification

- Workflow: [Android build](https://github.com/markfxm/tv1-hls-player/actions/runs/33288013930)
- Job: [assemble-debug](https://github.com/markfxm/tv1-hls-player/actions/runs/33288013930/job/99194548353)
- Commit SHA: `d4f50f3e2e794d20ee2432887e2911edacbd9e22`
- Runner OS: `ubuntu-24.04`
- Actual Java: OpenJDK `17.0.20.1`
- Gradle: `8.9`
- Android SDK: `platforms;android-35` revision `2`
- Android Build-Tools: `34.0.0`
- AGP: `8.7.3`
- Media3: `1.8.0`
- Command: `gradle --no-daemon --stacktrace :app:assembleDebug`
- Result: `:app:assembleDebug` PASS; log contains `BUILD SUCCESSFUL in 25s`
- Job duration: approximately 1m37s
- APK artifact: not uploaded by the existing workflow

The run also reported existing GitHub Actions runtime deprecation annotations for `actions/checkout@v4`, `actions/setup-java@v4`, and forced Node.js 24 execution. These did not affect the build and were outside TASK5B1 scope.

## TASK5A diagnostics preservation

Treatment B continues to use the existing `[A5-DIAG]` output, including:

`SNAPSHOT`, `BANDWIDTH`, `BUFFERING_START`, `BUFFERING_END`, `DROPPED_FRAMES`, `FRAME_PROCESSING`, `AUDIO_UNDERRUN`, and `PLAYER_ERROR`.

The diagnostics definitions, sampling interval, lifecycle handling, and metric calculations were not changed. The implementation stage does not include real A5 measurements.

## Device A/B gate

Install the Treatment B debug APK on the same Egreat A5 and replay the exact severe-stutter H.264 source used for TASK5A Test A. Keep the same node, network, display mode, and test duration, and avoid remote-control interaction. Run for 10 minutes and collect:

```text
a5_task5b1_full.log
a5_task5b1_diag.log
```

Use the commands in [TASK5A_A5_DIAGNOSTIC_TEST_PROCEDURE.md](TASK5A_A5_DIAGNOSTIC_TEST_PROCEDURE.md), replacing the output filenames with the names above. Compare Baseline A and Treatment B for buffering count and duration, minimum/median/average/maximum buffer, dropped frames, audio underruns, bandwidth, player errors, and time to first frame.

The following outcome labels are reserved for the real-device result report:

- `STRONG_IMPROVEMENT`
- `PARTIAL_IMPROVEMENT`
- `NO_MATERIAL_IMPROVEMENT`
- `INVALID_TEST`

No `TASK5B1_A5_BUFFER_AB_RESULT.md` is produced until those measurements exist.

## Known risks and next gate

- Treatment B may add roughly 3–5 seconds to initial startup or recovery.
- A source whose sustained input bitrate is below playback consumption may still drain from 60 seconds to zero; larger buffers can delay, but cannot prove resolution of, that problem.
- This CI result verifies compilation only, not HiSilicon decoder behavior or long-duration playback.
- Audio symptoms remain diagnostic-only and are not addressed by this task.

Next gate: complete the controlled Egreat A5 Treatment B run and provide the full `[A5-DIAG]` logs. Do not begin TASK5B2 or change DataSource/HTTP behavior based on this implementation result alone.

## Commit

- Implementation commit: `d4f50f3` — `perf(android): tune A5 playback buffer profile`
- Report commit: the documentation commit that adds this report.
