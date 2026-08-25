import assert from "node:assert/strict";
import { calculateNodeFlyoutPosition } from "../src/nodeFlyoutPosition.js";

const style = calculateNodeFlyoutPosition({
  toggleRect: {
    top: 180,
    bottom: 222,
    left: 452,
  },
  listRect: {
    top: 196,
    bottom: 794,
  },
  viewportWidth: 1041,
  viewportHeight: 892,
});

assert.equal(style.top, "196px", "flyout top should not move above the channel list");
assert.equal(style.right, "599px", "flyout should stay horizontally anchored beside the toggle button");
assert.equal(style.maxHeight, "678px", "flyout height should use remaining viewport space");

const offscreenStyle = calculateNodeFlyoutPosition({
  toggleRect: {
    top: 40,
    bottom: 82,
    left: 452,
  },
  listRect: {
    top: 196,
    bottom: 794,
  },
  viewportWidth: 1041,
  viewportHeight: 892,
});

assert.equal(offscreenStyle, null, "flyout should close when the anchor button has scrolled out of view");

const bottomStyle = calculateNodeFlyoutPosition({
  toggleRect: {
    top: 720,
    bottom: 762,
    left: 452,
  },
  listRect: {
    top: 196,
    bottom: 794,
  },
  viewportWidth: 1041,
  viewportHeight: 892,
});

assert.equal(bottomStyle.maxHeight, "154px", "flyout height should use remaining viewport space, not channel list space");
