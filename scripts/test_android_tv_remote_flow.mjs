import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(__dirname, "..", "android", "app", "src", "main", "java", "com", "tv1", "player", "MainActivity.java"),
  "utf8"
);

const requiredSnippets = [
  ["playActiveNode(boolean keepFullscreen)", "Playback should accept a fullscreen intent."],
  ["switchChannelFromFullscreen(-1)", "Fullscreen up key should switch to the previous channel."],
  ["switchChannelFromFullscreen(1)", "Fullscreen down key should switch to the next channel."],
  ["KeyEvent.KEYCODE_DPAD_UP", "Remote up key should be handled."],
  ["KeyEvent.KEYCODE_DPAD_DOWN", "Remote down key should be handled."],
  ["showExitConfirmDialog()", "Double-back flow should show an exit confirmation dialog."],
  ["finishAndRemoveTask()", "Confirming exit should remove the Android task."],
  ["hideControlsRunnable", "Control hiding should use a named runnable."],
  ["resetPendingExitRunnable", "Back-exit timeout should use a named runnable."],
  ["scheduleHideControls()", "Channel/node selection should auto-hide controls after playback starts."],
  ["uiHandler.postDelayed(hideControlsRunnable, 2500)", "Auto-hide should hide controls after a short delay."],
  ["uiHandler.removeCallbacks(hideControlsRunnable)", "Control hiding should only remove its own runnable."],
  ["uiHandler.removeCallbacks(resetPendingExitRunnable)", "Back-exit timeout should only remove its own runnable."],
  ["isHlsUrl(node.url)", "Only HLS URLs should force the HLS MIME type."],
  ["private boolean isHlsUrl(String url)", "Android playback should allow HTTP transport streams to be sniffed."],
];

for (const [snippet, message] of requiredSnippets) {
  if (!source.includes(snippet)) {
    throw new Error(message);
  }
}

if (source.includes("uiHandler.removeCallbacksAndMessages(null)")) {
  throw new Error("MainActivity should not clear unrelated Handler callbacks globally.");
}

if (source.includes("if (!isFlvUrl(node.url))")) {
  throw new Error("MainActivity should not force every non-FLV URL through the HLS parser.");
}
