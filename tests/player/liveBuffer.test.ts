import assert from "node:assert/strict";
import { LiveBufferManager } from "../../src/player/liveBufferManager.ts";

function createVideo(currentTime: number, liveEdge: number) {
  return {
    currentTime,
    seekable: {
      length: 1,
      end: () => liveEdge
    }
  };
}

{
  const video = createVideo(100, 110);
  const manager = new LiveBufferManager(video, { isLive: true });

  assert.equal(manager.getLatency(), 10);
  assert.equal(manager.isBehindLiveEdge(), false);
  assert.equal(manager.shouldTriggerRecovery(), false);
}

{
  const video = createVideo(10, 111);
  const manager = new LiveBufferManager(video, { isLive: true });

  assert.equal(manager.getLatency(), 101);
  assert.equal(manager.isBehindLiveEdge(), true);
  assert.equal(manager.shouldTriggerRecovery(), true);
}

{
  const video = createVideo(10, 111);
  const manager = new LiveBufferManager(video, { isLive: true });

  manager.jumpToLive();

  assert.equal(video.currentTime, 111);
}

{
  const video = createVideo(10, 111);
  const manager = new LiveBufferManager(video, { isLive: false });

  assert.equal(manager.getLatency(), 101);
  assert.equal(manager.isBehindLiveEdge(), false);
  assert.equal(manager.shouldTriggerRecovery(), false);
  manager.jumpToLive();
  assert.equal(video.currentTime, 10);
}

console.log("Live buffer tests passed.");
