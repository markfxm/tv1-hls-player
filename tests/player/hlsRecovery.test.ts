import assert from "node:assert/strict";
import { createHlsRecoveryController, PlayerState } from "../../src/player/hlsRecovery.ts";
import { createPlayerLogger } from "../../src/player/playerLogger.ts";
import { createRetryPolicy } from "../../src/player/retryPolicy.ts";

function createHarness() {
  let scheduledCallback: (() => void) | null = null;
  let scheduledDelay = -1;
  let cancelled = false;
  const actions: string[] = [];
  const logs: unknown[] = [];
  const controller = createHlsRecoveryController({
    policy: createRetryPolicy(),
    logger: { log: (entry: unknown) => logs.push(entry) },
    schedule: (callback: () => void, delay: number) => {
      scheduledCallback = callback;
      scheduledDelay = delay;
      return 1;
    },
    cancel: () => {
      cancelled = true;
    }
  });

  return {
    controller,
    actions,
    logs,
    runScheduled() {
      scheduledCallback?.();
    },
    get scheduledDelay() {
      return scheduledDelay;
    },
    get cancelled() {
      return cancelled;
    },
    actionHandlers: {
      startLoad: () => actions.push("startLoad"),
      recoverMediaError: () => actions.push("recoverMediaError")
    }
  };
}

{
  const harness = createHarness();
  harness.controller.handleError(
    { fatal: false, type: "networkError", details: "fragLoadError" },
    harness.actionHandlers
  );
  assert.equal(harness.controller.getState(), PlayerState.RECOVERING);
  assert.equal(harness.scheduledDelay, 1000);
  harness.runScheduled();
  assert.deepEqual(harness.actions, ["startLoad"]);
}

{
  const harness = createHarness();
  harness.controller.handleError(
    { fatal: true, type: "mediaError", details: "mediaError" },
    harness.actionHandlers
  );
  harness.runScheduled();
  assert.deepEqual(harness.actions, ["recoverMediaError"]);
}

{
  const harness = createHarness();
  harness.controller.handleError(
    { fatal: false, type: "mediaError", details: "bufferStalledError" },
    harness.actionHandlers
  );
  harness.runScheduled();
  assert.deepEqual(harness.actions, ["startLoad"]);
}

{
  const harness = createHarness();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    harness.controller.handleError(
      { fatal: true, type: "networkError", details: "manifestLoadError" },
      harness.actionHandlers
    );
    harness.runScheduled();
  }
  assert.equal(harness.controller.getState(), PlayerState.RECOVERING);
  assert.equal(harness.logs.length, 3);
  harness.controller.handleError(
    { fatal: true, type: "networkError", details: "manifestLoadError" },
    harness.actionHandlers
  );
  assert.equal(harness.controller.getState(), PlayerState.FAILED);
  assert.equal(harness.actions.length, 3);
}

{
  const harness = createHarness();
  harness.controller.handleError(
    { fatal: true, type: "networkError", details: "fragLoadError" },
    harness.actionHandlers
  );
  harness.controller.destroy();
  harness.runScheduled();
  assert.equal(harness.cancelled, true);
  assert.deepEqual(harness.actions, []);
  assert.equal(harness.controller.getState(), PlayerState.IDLE);
}

assert.deepEqual(
  [1, 2, 3].map((attempt) => createRetryPolicy().retryDelay(attempt)),
  [1000, 3000, 5000]
);

{
  const messages: string[] = [];
  createPlayerLogger((message) => messages.push(message)).log({
    state: PlayerState.RECOVERING,
    error: "fragLoadError",
    retry: 1,
    timestamp: "2026-08-25T00:00:00.000Z"
  });
  assert.match(messages[0], /^\[HLS\] state: RECOVERING error: fragLoadError retry: 1 timestamp:/);
}

console.log("HLS recovery state machine tests passed.");
