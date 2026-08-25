import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(__dirname, "..", "android", "app", "src", "main", "java", "com", "tv1", "player", "MainActivity.java"),
  "utf8"
);

if (source.includes("nodeToggleButtons")) {
  throw new Error("Channel rows should not use a separate node toggle button list.");
}

if (!source.includes("KeyEvent.KEYCODE_DPAD_LEFT") || !source.includes("expandNodePanelAndFocusFirstNode(index)")) {
  throw new Error("Focused channel buttons should open their node list with the remote left key.");
}

if (!source.includes("private void expandNodePanelAndFocusFirstNode(int channelIndex)")) {
  throw new Error("Expected a dedicated helper that expands a channel node list and moves focus.");
}

if (!source.includes("firstNodeButton.requestFocus()")) {
  throw new Error("Opening a node list should move focus to the first node button.");
}
