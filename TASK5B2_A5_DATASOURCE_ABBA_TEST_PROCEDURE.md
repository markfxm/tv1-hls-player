# TASK5B2 Egreat A5 DataSource ABBA Test Procedure

## Scope and fixed inputs

This procedure is for device data collection only. It does not select an OkHttp winner and does not change playback configuration.

- Code/CI APK baseline SHA: `a742ed6fb7e8dc834fc16f7e587c880f34665043`
- Required source node: `052d52487bab`
- Device: Egreat A5, serial `192.168.1.190:5555`
- Launcher: `com.tv1.player/.MainActivity`
- ADB: `E:\AI\高清电影播放器\platform-tools-latest-windows\platform-tools\adb.exe`
- Use exactly the same severe-stutter Test A source URL used during TASK5A. Do not substitute a URL, node, playlist, or channel.
- Keep the same A5, LAN/Wi-Fi path, HDMI mode, display, and application build throughout all four runs.

The four runs are strictly ordered:

```text
A1 (DEFAULT) → B1 (OKHTTP) → B2 (OKHTTP) → A2 (DEFAULT)
```

Each run requires **10 minutes continuous logcat capture**. The **30–60 seconds** interval is only between runs. Do not reboot the A5, switch channels, change the network, change the display mode, or operate the remote during a run.

Only `scripts/analyze_a5_datasource_abba.mjs` may assign an ABBA verdict. Device procedure notes and subjective observation must not assign a winner; no winner is inferred from one run.

## Install once

Run from the repository root in PowerShell after obtaining the debug APK. The current CI workflow does not upload APK artifacts; the expected local path after a local Android build is shown below.

```powershell
$adb = 'E:\AI\高清电影播放器\platform-tools-latest-windows\platform-tools\adb.exe'
$serial = '192.168.1.190:5555'
$apk = '.\android\app\build\outputs\apk\debug\app-debug.apk'

& $adb connect $serial
& $adb -s $serial get-state
& $adb -s $serial install -r $apk
```

Confirm that installation succeeds before beginning A1. Install the same APK once; do not reinstall between runs.

## Capture one run

Use a separate PowerShell window for each run. Replace `$run` and `$backend` exactly as shown in the run table.

```powershell
$adb = 'E:\AI\高清电影播放器\platform-tools-latest-windows\platform-tools\adb.exe'
$serial = '192.168.1.190:5555'
$run = 'A1'
$backend = 'default'

& $adb -s $serial shell am force-stop com.tv1.player
& $adb -s $serial logcat -c
& $adb -s $serial shell am start -n com.tv1.player/.MainActivity --es tv1.datasource $backend

# Keep this pipeline running continuously for 10 minutes, then press Ctrl+C.
& $adb -s $serial logcat -v time |
    Tee-Object -FilePath ".\a5_task5b2_${run}_full.log" |
    Select-String 'A5-DIAG|A5-DATASOURCE|A5-NET'

Select-String -Path ".\a5_task5b2_${run}_full.log" -Pattern 'A5-DIAG|A5-DATASOURCE|A5-NET' |
    ForEach-Object { $_.Line } |
    Set-Content -Encoding utf8 ".\a5_task5b2_${run}_diag.log"
```

Run table:

| Run | `tv1.datasource` | Log files |
| --- | --- | --- |
| A1 | `default` | `a5_task5b2_A1_full.log`, `a5_task5b2_A1_diag.log` |
| B1 | `okhttp` | `a5_task5b2_B1_full.log`, `a5_task5b2_B1_diag.log` |
| B2 | `okhttp` | `a5_task5b2_B2_full.log`, `a5_task5b2_B2_diag.log` |
| A2 | `default` | `a5_task5b2_A2_full.log`, `a5_task5b2_A2_diag.log` |

After each ten-minute capture, stop the pipeline with Ctrl+C, wait 30–60 seconds, and begin the next run. Do not change the source or device state between runs.

## Required log evidence

Each diagnostic file must contain, for the same session:

- `[A5-DIAG] SESSION_START`
- `[A5-DIAG] SESSION_SUMMARY`
- `[A5-DATASOURCE] backend=...`
- `nodeId=052d52487bab`
- `displayResolution=1920x1080 displayRefreshRate=60`
- a duration of at least `540000` ms in `SESSION_SUMMARY`
- `SNAPSHOT`, `BUFFERING_START`/`BUFFERING_END`, `BANDWIDTH`, and `[A5-NET] TRANSFER_END`/`TRANSFER_ERROR` where emitted

The run is invalid if the session is shorter than 540000 ms, either session marker is missing, the backend is wrong, the node changes, display mode drifts, a process/app crash is observed, or the logs are mixed between sessions. A missing summary is reported as `INVALID_RUN_INCOMPLETE_SESSION` by the analyzer.

Do not edit, truncate, merge, or hand-correct device logs. Preserve the original full logs for review.

## Analyze after A2

Only after all four valid captures are complete, run:

```powershell
node scripts/analyze_a5_datasource_abba.mjs `
  --a1 .\a5_task5b2_A1_diag.log `
  --b1 .\a5_task5b2_B1_diag.log `
  --b2 .\a5_task5b2_B2_diag.log `
  --a2 .\a5_task5b2_A2_diag.log `
  --output .\TASK5B2_A5_DATASOURCE_ABBA_RESULT.md
```

The analyzer compares the following primary metrics:

| Metric | A1 | B1 | B2 | A2 |
| --- | ---: | ---: | ---: | ---: |
| Wall duration |  |  |  |  |
| `BUFFERING` count |  |  |  |  |
| Total rebuffer duration |  |  |  |  |
| Longest rebuffer |  |  |  |  |
| Buffer minimum / P10 / median / average / maximum |  |  |  |  |
| Dropped frames / frames per minute |  |  |  |  |
| Audio underruns |  |  |  |  |
| Bandwidth min / median / average |  |  |  |  |
| Transfer slow >5s / very slow >15s |  |  |  |  |
| Transfer throughput P10 |  |  |  |  |
| Player errors / codec errors |  |  |  |  |
| Time to first frame |  |  |  |  |

Record subjective stutter, startup delay, and audio symptoms separately as secondary observations. They cannot override analyzer output.

The valid analyzer verdict labels are only:

```text
OKHTTP_STRONG_WIN
OKHTTP_PARTIAL_WIN
NO_MATERIAL_DIFFERENCE
INCONCLUSIVE_TEMPORAL_VARIABILITY
OKHTTP_REGRESSION
INVALID_ABBA
```

Do not begin TASK5B3 or change production defaults based on a single run or subjective impression.
