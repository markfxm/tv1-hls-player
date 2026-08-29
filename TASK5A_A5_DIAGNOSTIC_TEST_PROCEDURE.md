# TASK5A Egreat A5 真机诊断测试步骤

本测试只采集播放诊断日志，不修改播放器参数、解码器选择、显示模式、播放速度或节点切换策略。请使用当前 TASK5A debug APK，并确保 A5 已打开 ADB。

## 1. 连接与准备

在 Windows PowerShell 中执行：

```powershell
$adb = 'E:\AI\高清电影播放器\platform-tools-latest-windows\platform-tools\adb.exe'
$serial = '192.168.1.190:5555'

& $adb connect $serial
& $adb -s $serial get-state
& $adb -s $serial shell pm path com.tv1.player
```

确认 `get-state` 返回 `device`，并确认当前安装的是 TASK5A debug APK。

## 2. 日志采集方式

推荐先保存完整 logcat，测试结束后再提取诊断行：

```powershell
& $adb -s $serial logcat -c
& $adb -s $serial logcat > a5_playback_full.log
```

保持该命令运行，在机顶盒上完成测试。测试结束后回到终端按 `Ctrl+C`，再执行：

```powershell
findstr "A5-DIAG" a5_playback_full.log > a5_diag.log
```

只查看实时诊断时可以使用：

```powershell
& $adb -s $serial logcat -c
& $adb -s $serial logcat | findstr "A5-DIAG"
```

不需要安装额外 Android 分析工具。请保留 `a5_playback_full.log` 和 `a5_diag.log`，不要只截取单行截图。

## Test A — 明显卡顿的 H.264 高清频道

1. 清空 logcat。
2. 启动 TV1，选择一个已知会持续卡顿的 H.264 高清节点。
3. 连续播放 10 分钟，尽量不操作遥控器、不切换频道或节点。
4. 记录卡顿发生的大致时间点，以及对应的 `session=`。
5. 停止日志采集并保存完整 `[A5-DIAG]` 输出。

重点保留：

- `DECODER`
- `VIDEO_FORMAT`
- `DISPLAY`
- `SNAPSHOT`
- `DROPPED_FRAMES`
- `FRAME_PROCESSING`
- `AUDIO_UNDERRUN`
- `BUFFERING_START` / `BUFFERING_END`
- `SESSION_SUMMARY`

## Test B — 已知流畅的普通频道 baseline

1. 重新清空 logcat。
2. 选择一个已知播放流畅的普通频道和节点。
3. 连续播放 5 分钟，尽量不操作遥控器。
4. 保存完整日志和提取后的诊断日志。

该结果用于与 Test A 对比 dropped frames、renderer processing offset、audio underrun、rebuffer 和 buffer duration。

## Test C — H.265 对比测试（如果存在 H.265 频道）

1. 重新清空 logcat。
2. 选择一个 H.265 频道或节点。
3. 连续播放 5 分钟，尽量不操作遥控器。
4. 保存完整日志和提取后的诊断日志。

重点确认 `VIDEO_FORMAT` 中的 mime / codec / resolution / fps，以及 `DECODER` 中的 videoDecoder 和 decoder classification。

## 3. 回传日志时请一并说明

- Test A / B / C 使用的频道名称和节点标签；
- 卡顿开始的大致时间；
- 是否发生黑屏、声音中断或自动切换节点；
- 机顶盒当时的 HDMI 输出模式（如果系统设置页可见）；
- 每个测试对应的 `session=`。

TASK5A 只根据真实 A5 `[A5-DIAG]` 日志做诊断。采集完成前，不根据静态测试或编译结果判断卡顿根因。
