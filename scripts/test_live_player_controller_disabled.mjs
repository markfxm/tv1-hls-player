import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(__dirname, "..", "android", "app", "src", "main", "java", "com", "tv1", "player", "MainActivity.java"),
  "utf8"
);

if (!source.includes("playerView.setUseController(false);")) {
  throw new Error("Live TV PlayerView should disable Media3 playback controls.");
}

if (source.includes("playerView.setUseController(true);")) {
  throw new Error("Live TV PlayerView must not enable Media3 playback controls.");
}
