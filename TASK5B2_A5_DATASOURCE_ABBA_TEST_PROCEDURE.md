# TASK5B2 Egreat A5 DataSource ABBA Test Procedure

## Scope and fixed inputs

This procedure is for device data collection only. It does not select an OkHttp winner and does not change playback configuration.

- Code/CI APK baseline SHA: `a742ed6fb7e8dc834fc16f7e587c880f34665043`
- Use one downloaded debug APK for all four runs. Record its `APK_SHA256` and keep the same hash for A1/B1/B2/A2; if a different APK is installed, restart the entire ABBA sequence.
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

Run from the repository root in PowerShell after downloading the CI artifact `tv1-task5b2-a5-debug-apk` and extracting `app-debug.apk`. The expected local path is shown below.

```powershell
$adb = 'E:\AI\高清电影播放器\platform-tools-latest-windows\platform-tools\adb.exe'
$serial = '192.168.1.190:5555'
$apk = '.\android\app\build\outputs\apk\debug\app-debug.apk'

Get-FileHash $apk -Algorithm SHA256
# Record the displayed hash as APK_SHA256 in the test notes.

& $adb connect $serial
& $adb -s $serial get-state
& $adb -s $serial install -r $apk
```

Confirm that installation succeeds before beginning A1. Install the same APK once; do not reinstall between runs. The recorded `APK_SHA256` must be identical for A1, B1, B2, and A2. If the APK or hash changes, discard the partial sequence and restart from A1.

## Capture one run

Use two PowerShell windows for each run. Replace `$run` and `$backend` exactly as shown in the run table. Start the capture in Window A before launching the app so `SESSION_START` cannot be missed.

Window A — start and keep the continuous logcat capture running:

```powershell
$adb = 'E:\AI\高清电影播放器\platform-tools-latest-windows\platform-tools\adb.exe'
$serial = '192.168.1.190:5555'
$run = 'A1'
$backend = 'default'

& $adb -s $serial shell am force-stop com.tv1.player
& $adb -s $serial logcat -c
# Leave this pipeline running continuously for at least 10 minutes. Do not press
# Ctrl+C at the ten-minute point; close the playback session first.
& $adb -s $serial logcat -v time |
    Tee-Object -FilePath ".\a5_task5b2_${run}_full.log" |
    Select-String 'A5-DIAG|A5-DATASOURCE|A5-NET'
```

Window B — launch the run, close the session normally, and validate the summary:

```powershell
$adb = 'E:\AI\高清电影播放器\platform-tools-latest-windows\platform-tools\adb.exe'
$serial = '192.168.1.190:5555'
$run = 'A1'
$backend = 'default'

& $adb -s $serial shell am start -n com.tv1.player/.MainActivity --es tv1.datasource $backend

# Let the target source play continuously for at least 10 minutes.
# At the ten-minute point, do not press Ctrl+C. Use the normal fullscreen exit
# flow: press Back as required by the existing two-step confirmation, then
# confirm 退出程序. Wait 2–3 seconds for lifecycle cleanup to log the summary.

$fullLog = ".\a5_task5b2_${run}_full.log"
$startLine = Select-String -Path $fullLog -Pattern 'A5-DIAG.*SESSION_START' |
    Select-Object -Last 1
$session = ''
if ($startLine) {
    $session = [regex]::Match($startLine.Line, 'session=([^\s]+)').Groups[1].Value
}
$summaryLine = Select-String -Path $fullLog -Pattern 'A5-DIAG.*SESSION_SUMMARY' |
    Where-Object { $_.Line -match "session=$([regex]::Escape($session))(\s|$)" } |
    Select-Object -Last 1
$backendLine = Select-String -Path $fullLog -Pattern "A5-DATASOURCE.*backend=$backend" |
    Select-Object -Last 1
$nodeLine = Select-String -Path $fullLog -Pattern 'nodeId=052d52487bab' |
    Select-Object -Last 1
if (-not $startLine -or [string]::IsNullOrWhiteSpace($session) -or -not $summaryLine -or -not $backendLine -or -not $nodeLine) {
    throw 'INVALID_RUN_INCOMPLETE_SESSION'
}
Write-Output "Validated SESSION_SUMMARY for session=$session"
```

Only after Window B validates the same-session `SESSION_SUMMARY`, return to Window A and press Ctrl+C. Then, in Window B, extract the diagnostic log:

```powershell
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

## Closing a run and confirming the summary

After the source has played for at least 10 minutes, do not use Ctrl+C or the next run's `force-stop` to end the current session. Use the app's normal fullscreen exit flow: press Back as required by the existing two-step exit confirmation, then confirm `退出程序`. This calls the existing Activity lifecycle cleanup; `onPause()`/`onDestroy()` call `PlaybackDiagnostics.detach()`, which cancels the snapshot runnable and calls `stopSession()`. A node/channel transition also calls `stopSession()` before starting the next session, but it must not be used as a substitute for closing the current run.

Wait 2–3 seconds after the normal exit, then run the validation block above. Confirm that the log contains `SESSION_START` and a `SESSION_SUMMARY` carrying the same `session=` value, plus the expected backend and `nodeId=052d52487bab`. Only then press Ctrl+C and extract the diagnostic log. If the summary is missing, do not begin the next run: mark the run `INVALID_RUN_INCOMPLETE_SESSION` and repeat that run.

After Ctrl+C, wait 30–60 seconds before beginning the next run. This interval is only between runs; each A1/B1/B2/A2 run itself uses one uninterrupted 10-minute logcat capture. `force-stop` is allowed only before the next run to clear app state, never as the mechanism for producing the previous run's summary. Do not change the source or device state between runs.

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
