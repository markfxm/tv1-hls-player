# TASK5A Egreat A5 Playback Diagnostics Report

## Verdict

GREEN — A5 PLAYBACK DIAGNOSTICS READY FOR DEVICE TEST

This verdict means the observation-only diagnostics are implemented, tested, and compile-verified. It does not mean that the A5 stutter root cause has been confirmed; that requires real `[A5-DIAG]` logs from the device.

## Baseline and commits

- Baseline HEAD before TASK5A: `9f3144bcc0e80d469827336becc4d5209de9932d`
- Implementation commit: `3af45c215b97dd0b7bd0d6f92db90a9033444837`
- Commit message: `feat(android): add A5 playback diagnostics`
- Branch: `main`
- `TV1_source.zip`: not added or modified
- `TV1_channels.m3u`: not added or modified

## Modified files

- `android/app/src/main/java/com/tv1/player/PlaybackDiagnostics.java`
- `android/app/src/main/java/com/tv1/player/MainActivity.java`
- `android/app/build.gradle`
- `scripts/test_android_playback_diagnostics.mjs`
- `scripts/test_android_media3_stability.mjs`
- `package.json`
- `TASK5A_A5_DIAGNOSTIC_TEST_PROCEDURE.md`

The only Android build-file change enables generated `BuildConfig` so debug-only diagnostics can compile. Task1 HLS recovery, Task2 node failover, Task3 live buffer logic, and Task4 playback recovery parameters remain unchanged. The existing decoder-only AnalyticsListener was moved into the single diagnostics listener instead of registering a competing listener.

## Diagnostic architecture

`PlaybackDiagnostics` is an observation-only module with:

```java
void attach(ExoPlayer player)
void detach()
void startSession(String url)
void stopSession()
void logSnapshot()
```

It uses one `AnalyticsListener`, a main-thread `Handler`, and a 5-second snapshot interval. It does not call seek, pause, play, prepare, track selection, decoder selection, load-control configuration, surface configuration, tunneling configuration, or display-mode APIs that change state.

Each node playback creates a new session ID such as `a5-20260829-210501-001`. The log records `urlHost`, a short SHA-256 `urlHash`, and `nodeId`; the complete URL and query credentials are not written to logcat. Node/channel changes stop the old session before starting the new one.

## Runtime metrics collected

The module records:

- Video/audio decoder name, initialization duration, release events, and decoder classification;
- API 29+ `isHardwareAccelerated`, `isSoftwareOnly`, and `isVendor` values;
- Video MIME, codec string, resolution, FPS, bitrate, average bitrate, peak bitrate, and pixel ratio;
- Audio MIME, codec string, channel count, sample rate, and bitrate;
- Display physical resolution, current refresh rate, and supported modes;
- Dropped-frame interval count, session total, and dropped frames per minute;
- Video frame-processing offset average and sample count, guarded against `frameCount == 0`;
- Audio underrun count, buffer size, buffer duration, and elapsed time since last feed;
- Bandwidth estimate, transferred bytes, and elapsed load time when Media3 supplies them;
- Playback state, playing/loading flags, play-when-ready, current position, buffered position, total buffered duration, and current live offset;
- Buffer minimum/average/maximum, live-offset average/maximum, rebuffer count, total rebuffer duration, and longest rebuffer duration.

Media3 `1.8.0` does not expose `onVideoCodecError` or `onAudioCodecError` on `AnalyticsListener`; those callbacks were not fabricated. The available `onPlayerError` callback is logged as `PLAYER_ERROR`.

## Log format

Every diagnostic line is emitted through one formatter and contains `[A5-DIAG]`, `session=`, and `timestamp=`. Representative records are:

```text
[A5-DIAG] DECODER session=a5-... timestamp=... videoDecoder=OMX.hisi.video.decoder.avc audioDecoder=OMX.hisi.audio.decoder.aac
[A5-DIAG] VIDEO_FORMAT session=a5-... timestamp=... mime=video/avc codec=avc1.640028 resolution=1920x1080 fps=50.000
[A5-DIAG] SNAPSHOT session=a5-... timestamp=... playbackState=READY playing=true loading=false totalBufferedDurationMs=27744 currentLiveOffsetMs=11432
[A5-DIAG] SESSION_SUMMARY session=a5-... timestamp=... droppedFramesTotal=23 audioUnderrunCount=0 diagnosticHints=NO_OBVIOUS_SIGNAL
```

Snapshots are scheduled every 5000 ms and are cancelled on session stop, detach, pause, node switch, and destroy. No per-frame log is generated.

## Decoder classification rules

- On API `< 29`, `hardwareAccelerated`, `softwareOnly`, and `vendor` are logged as `unknown`.
- On API `>= 29`, the values are read from `MediaCodecInfo`; an unavailable codec entry or query failure remains `unknown`.
- Names containing `OMX.hisi.`, `OMX.hisilicon`, `c2.hisi`, or `c2.hisilicon` are classified as `HISILICON_LIKELY`.
- Names containing `OMX.google`, `c2.android` are classified as `SOFTWARE_LIKELY`.
- Other names are `UNKNOWN`.

The name-based classification is a heuristic and is not reported as proof of hardware acceleration.

## Frame-rate relation rules

The module reports `LIKELY_MATCHED` for the explicitly recognized pairs 25→50, 50→50, 30→60, 60→60, and 24→24. It reports `LIKELY_MISMATCH` for 50→60, 25→60, and 24→60. Other integer refresh multiples may be classified as `LIKELY_MATCHED`; otherwise the relation is `UNKNOWN`. `frameRateMismatch` is `true`, `false`, or `unknown` accordingly.

No display mode is changed and no automatic frame-rate switching is performed.

## Buffer and rebuffer diagnosis

`BUFFERING_START` and `BUFFERING_END` are tracked without changing playback. A conservative `BUFFER_STARVATION` signal requires buffering with total buffered duration at or below 250 ms. `DECODER_RENDER_PRESSURE` requires at least two dropped-frame callbacks, at least ten dropped frames, at least two buffer samples, and an average buffer of at least 5000 ms. `AUDIO_UNDERRUN` requires a real `onAudioUnderrun` callback. Multiple simultaneous signals are reported as `MULTIPLE_SIGNALS`; otherwise the summary emits one signal or `NO_OBVIOUS_SIGNAL`.

These are diagnostic hints only. The module never emits `ROOT_CAUSE_CONFIRMED` and never changes player behavior based on them.

## Lifecycle and unchanged playback strategy

- `MainActivity.initPlayer()` creates and attaches one `PlaybackDiagnostics` instance.
- `playActiveNode()` stops the previous session and starts a new session for the selected node.
- `onPause()` detaches diagnostics and cancels its snapshot runnable; existing Task4 recovery reset and player pause behavior remain intact.
- `onResume()` reattaches the same player listener without preparing or playing anything.
- `onDestroy()` detaches diagnostics before releasing the player.
- `PlaybackDiagnostics` retains only application context, not the Activity, and removes its AnalyticsListener before release.
- No LoadControl, HLS error policy, decoder selection, tunneling, track selection, playback speed, Surface type, display mode, or UI behavior was changed.

Static audit results:

- Surface: `PlayerView` remains configured as before; no `setSurfaceView` / `setTextureView` change was added. The current default is `SURFACE_VIEW`.
- Tunneling: no `DefaultTrackSelector` or tunneling enablement is configured in this project; diagnostic status is `unknown` rather than inferred or enabled.

## Tests and builds

Local verification:

- `npm test`: PASS, exit code `0`
- `npm run build`: PASS, exit code `0`
- Local Android `:app:assembleDebug`: PASS, exit code `0`
- Local APK: `android/app/build/outputs/apk/debug/app-debug.apk`

GitHub Actions verification:

- Run: [Android build #33263093638](https://github.com/markfxm/tv1-hls-player/actions/runs/33263093638)
- Job: [assemble-debug #99128287664](https://github.com/markfxm/tv1-hls-player/actions/runs/33263093638/job/99128287664)
- Head SHA: `3af45c215b97dd0b7bd0d6f92db90a9033444837`
- Runner: `ubuntu-24.04`
- Actual JDK: Temurin `17.0.20+1`; Gradle reported JVM `17.0.20.1`
- Actual Gradle: `8.9`
- Android SDK: `platforms;android-35` revision `2`; Build-Tools `34.0.0`
- AGP: `8.7.3`
- Media3: `1.8.0`
- Command: `gradle --no-daemon --stacktrace :app:assembleDebug`
- Result: PASS; log contains `> Task :app:assembleDebug` and `BUILD SUCCESSFUL in 20s`
- APK artifact: `APK artifact upload not configured`; Actions artifact API returned `total_count: 0`

The CI log also contains the existing annotation warning for `Scope.LIBRARY_GROUP` and deprecation annotations for the current GitHub Actions runtime; neither caused a build failure.

## Exact A5 test procedure

Follow [TASK5A_A5_DIAGNOSTIC_TEST_PROCEDURE.md](TASK5A_A5_DIAGNOSTIC_TEST_PROCEDURE.md):

- Test A: a known stuttering H.264 HD channel for 10 minutes;
- Test B: a known smooth ordinary channel for 5 minutes as baseline;
- Test C: an H.265 channel for 5 minutes if available;
- Save both the full logcat and the extracted `A5-DIAG` log for each session.

Windows collection commands:

```powershell
$adb = 'E:\AI\高清电影播放器\platform-tools-latest-windows\platform-tools\adb.exe'
$serial = '192.168.1.190:5555'
& $adb -s $serial logcat -c
& $adb -s $serial logcat > a5_playback_full.log
# After the test, press Ctrl+C.
findstr "A5-DIAG" a5_playback_full.log > a5_diag.log
```

## Known limitations and next gate

- No real A5 diagnostic session was run as part of TASK5A; therefore the actual decoder, dropped-frame level, audio underrun state, buffer starvation state, display refresh rate, and stutter category remain unconfirmed.
- Compile verification is not a physical Android TV / HiSilicon compatibility test.
- The debug APK is compiled with diagnostics enabled; release builds use `BuildConfig.DEBUG` to avoid high-frequency diagnostic output.
- The current workflow does not retain an APK artifact.

Next gate: run the three A5 procedures and provide the complete `[A5-DIAG]` logs. Only then decide whether a separate TASK5B optimization is justified. Do not change LoadControl, MediaCodec selection, tunneling, Surface type, display mode, frame rate, or playback speed based on this report alone.
