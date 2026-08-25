import assert from "node:assert/strict";
import { NodeManager, parseStreamNodes } from "../../src/player/nodeManager.ts";

const nodes = [
  { url: "https://example.test/a.m3u8", priority: 0 },
  { url: "https://example.test/b.m3u8", priority: 1 },
  { url: "https://example.test/c.m3u8", priority: 2 }
];

assert.deepEqual(parseStreamNodes([{ url: nodes[0].url }, { url: nodes[1].url }]), [
  { url: nodes[0].url, priority: 0 },
  { url: nodes[1].url, priority: 1 }
]);

{
  const manager = new NodeManager(nodes);
  manager.markFailure();
  assert.equal(manager.getNextNode()?.url, nodes[1].url);
}

{
  const manager = new NodeManager(nodes);
  manager.markFailure();
  manager.getNextNode();
  manager.markSuccess(120);
  assert.deepEqual(manager.getHealth(nodes[1].url), {
    url: nodes[1].url,
    successCount: 1,
    failCount: 0,
    lastFailTime: 0,
    latency: 120
  });
}

{
  const manager = new NodeManager(nodes);
  manager.markFailure();
  manager.getNextNode();
  manager.markFailure();
  manager.getNextNode();
  manager.markFailure();
  assert.equal(manager.getNextNode(), NodeManager.FAILED);
}

{
  const manager = new NodeManager(nodes);
  manager.selectNode(nodes[2].url);
  assert.equal(manager.getCurrentNode()?.url, nodes[2].url);
  manager.markFailure();
  assert.equal(manager.getNextNode()?.url, nodes[0].url);
}

console.log("Node manager tests passed.");
