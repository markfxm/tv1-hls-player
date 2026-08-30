import { readFileSync } from "node:fs";
import { join } from "node:path";

const mainActivityPath = join(
  process.cwd(),
  "android",
  "app",
  "src",
  "main",
  "java",
  "com",
  "tv1",
  "player",
  "MainActivity.java"
);
const mainActivity = readFileSync(mainActivityPath, "utf8");

const resolveCalls = mainActivity.match(/DataSourceBackendSelector\.resolve\s*\(/g) ?? [];
if (resolveCalls.length !== 1) {
  throw new Error("The Activity must resolve tv1.datasource exactly once per lifetime.");
}

const selectedBackendAssignments = mainActivity.match(/selectedDataSourceBackend\s*=/g) ?? [];
if (selectedBackendAssignments.length !== 1) {
  throw new Error("The Activity-selected backend must be assigned exactly once per lifetime.");
}

const playActiveNode = mainActivity.match(
  /private\s+void\s+playActiveNode\s*\(\s*boolean\s+keepFullscreen\s*\)\s*\{([\s\S]*?)\n\s*private\s+boolean\s+isFlvUrl/
);
if (!playActiveNode) {
  throw new Error("Unable to inspect the playActiveNode source-switch path.");
}

const sourceSwitchBody = playActiveNode[1];
if (/DataSourceBackend\.DEFAULT\.name\s*\(\s*\)/.test(sourceSwitchBody)) {
  throw new Error("Source switching must not fall back to DEFAULT for a non-HLS target node.");
}

const selectedFactory = mainActivity.match(
  /DataSource\.Factory\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/
);
if (!selectedFactory) {
  throw new Error("The Activity must retain one selected DataSource factory.");
}

const factoryName = selectedFactory[1];
const escapedFactoryName = factoryName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hlsFactoryUse = new RegExp(
  `new\\s+HlsMediaSource\\.Factory\\s*\\(\\s*${escapedFactoryName}\\s*\\)`
);
const progressiveFactoryUse = new RegExp(
  `new\\s+ProgressiveMediaSource\\.Factory\\s*\\(\\s*${escapedFactoryName}\\s*\\)`
);

if (!hlsFactoryUse.test(sourceSwitchBody)) {
  throw new Error("HLS source creation must use the Activity-selected DataSource factory.");
}
if (!progressiveFactoryUse.test(sourceSwitchBody)) {
  throw new Error("FLV/progressive source creation must use the same Activity-selected DataSource factory.");
}

if (!/String\s+sessionDataSourceBackend\s*=\s*selectedDataSourceBackend\.name\s*\(\s*\)\s*;/.test(sourceSwitchBody)) {
  throw new Error("Every new diagnostics session must retain the Activity-selected backend.");
}

if (!mainActivity.includes("DATASOURCE_BACKEND_DRIFT")) {
  throw new Error("The focused harness must expose a backend drift diagnostic assertion.");
}

if (!/private\s+void\s+selectChannel[\s\S]*?playActiveNode\s*\(/.test(mainActivity)) {
  throw new Error("Channel selection must continue through the shared source-switch path.");
}
if (!/private\s+boolean\s+tryNextNode[\s\S]*?playActiveNode\s*\(/.test(mainActivity)) {
  throw new Error("Automatic node failover must continue through the shared source-switch path.");
}

console.log("Android datasource backend persistence regression tests passed.");
