# TV1-HLS-STABILITY-TASK1 完成报告

## 任务范围

实现 HLS 播放自动恢复机制，不改变 UI，不引入新的播放器框架，不实现后续节点切换、Buffer 管理或 Android Media3 策略。

## 修改文件

- `src/App.vue`
  - 在现有 Hls.js 实例生命周期中接入恢复状态机。
  - 播放成功或收到 `playing` 事件时进入 `PLAYING`。
  - HLS 错误交给恢复控制器处理；重试耗尽后沿用原有原生回退/失败逻辑。
  - 销毁 HLS 实例时同步取消恢复定时器。
- `src/player/retryPolicy.ts`
  - 新增 `RetryPolicy` 接口。
  - 默认最多重试 3 次，延迟为 1000ms、3000ms、5000ms。
- `src/player/playerLogger.ts`
  - 新增统一 `[HLS]` 日志格式，包含 state、error、retry、timestamp。
- `src/player/hlsRecovery.ts`
  - 新增 `IDLE`、`PLAYING`、`RECOVERING`、`FAILED` 状态机。
  - 分类处理 network、manifest、media、buffer stalled 错误。
  - network/fragment/manifest/buffer stalled 使用 `startLoad()`；media error 使用 `recoverMediaError()`。
  - manifest 重试耗尽时提供 `onManifestFailure` 回调接口，为 Task 2 保留接入点。
  - 防止无限 reload、重复排队以及 destroy 后继续 retry。
- `tests/player/hlsRecovery.test.ts`
  - 覆盖 fragment load error、media error、buffer stalled、连续失败超过上限、destroy 后禁止 retry、RetryPolicy 延迟和日志格式。
- `package.json`
  - 将新增测试加入 `npm test`。

## 测试结果

- `node --experimental-strip-types tests/player/hlsRecovery.test.ts`：通过。
- 独立运行现有测试：通过。
- `npm run build`：通过。
  - Vite 报告原项目已有的 chunk 大小警告，但未出现编译错误。
- `npm test`：被现有测试前置依赖阻断。
  - `scripts/verify_cctv_hd_nodes.mjs` 读取仓库外的 `E:\workspace\cctv.txt`。
  - 当前文件不存在，错误为 `ENOENT`；本任务未修改该无关测试及外部数据依赖。

## Commit

最终 commit hash 以交付时的 `git rev-parse HEAD` 结果为准。

## 已知风险

- 自动恢复依赖 Hls.js 的 `type/details` 错误字段；未识别的 fatal 错误会直接进入失败处理。
- 连续 3 次恢复仍失败后会进入 `FAILED`，并沿用当前原生回退逻辑；本 Task 不自动切换节点。
- 新增 `.ts` 测试使用 Node 的 `--experimental-strip-types` 运行，要求测试环境支持该 Node 参数。
- Android Media3 播放链路未在本 Task 修改，留给 Task 4。
