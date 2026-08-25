import assert from "node:assert/strict";
import { createHlsRecoveryController, PlayerState } from "../../src/player/hlsRecovery.ts";
import { NodeManager } from "../../src/player/nodeManager.ts";

const nodeA = { url: "https://example.test/a.m3u8", priority: 0 };
const nodeB = { url: "https://example.test/b.m3u8", priority: 1 };
const error = { fatal: true, type: "networkError", details: "fragLoadError" };

function createRecoveryHarness() {
  const queuedCallbacks: Array<() => void> = [];
  const counts = { startLoad: 0, recoverMediaError: 0 };
  const actions = {
    startLoad: () => {
      counts.startLoad += 1;
    },
    recoverMediaError: () => {
      counts.recoverMediaError += 1;
    }
  };
  const recovery = createHlsRecoveryController({
    schedule: (callback: () => void) => {
      queuedCallbacks.push(callback);
      return queuedCallbacks.length;
    },
    cancel: () => {}
  });

  return {
    recovery,
    actions,
    counts,
    runNextRetry() {
      queuedCallbacks.shift()?.();
    },
    runDelayedCallbacks() {
      while (queuedCallbacks.length) {
        queuedCallbacks.shift()?.();
      }
    }
  };
}

{
  const manager = new NodeManager([nodeA, nodeB]);
  const nodeARecovery = createRecoveryHarness();

  for (let retry = 0; retry < 3; retry += 1) {
    const result = nodeARecovery.recovery.handleError(error, nodeARecovery.actions);
    assert.equal(result.recovered, true);
    nodeARecovery.runNextRetry();
  }

  const exhausted = nodeARecovery.recovery.handleError(error, nodeARecovery.actions);
  assert.equal(exhausted.exhausted, true);

  manager.markFailure();
  assert.equal(manager.getNextNode()?.url, nodeB.url);
}

{
  const manager = new NodeManager([nodeA, nodeB]);
  manager.markFailure();
  manager.getNextNode();
  const nodeBRecovery = createRecoveryHarness();

  nodeBRecovery.recovery.markPlaying();
  manager.markSuccess(80);

  assert.equal(nodeBRecovery.recovery.getState(), PlayerState.PLAYING);
  assert.equal(manager.getHealth(nodeB.url)?.successCount, 1);
}

{
  const manager = new NodeManager([nodeA, nodeB]);
  const nodeARecovery = createRecoveryHarness();
  nodeARecovery.recovery.handleError(error, nodeARecovery.actions);

  manager.markFailure();
  assert.equal(manager.getNextNode()?.url, nodeB.url);

  const nodeBRecovery = createRecoveryHarness();
  nodeBRecovery.recovery.markPlaying();
  manager.markSuccess(60);

  nodeARecovery.recovery.destroy();
  nodeARecovery.runDelayedCallbacks();
  const staleResult = nodeARecovery.recovery.handleError(error, nodeARecovery.actions);

  assert.equal(staleResult.recovered, false);
  assert.equal(nodeARecovery.counts.startLoad, 0);
  assert.equal(manager.getCurrentNode()?.url, nodeB.url);
  assert.equal(manager.getHealth(nodeB.url)?.failCount, 0);
  assert.equal(nodeBRecovery.recovery.getState(), PlayerState.PLAYING);
}

console.log("HLS failover integration tests passed.");
