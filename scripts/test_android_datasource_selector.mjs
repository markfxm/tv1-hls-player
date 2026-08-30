import { readFileSync } from "node:fs";
import { join } from "node:path";

const appBuildGradle = readFileSync(join(process.cwd(), "android", "app", "build.gradle"), "utf8");
const enumSourcePath = join(
  process.cwd(),
  "android",
  "app",
  "src",
  "main",
  "java",
  "com",
  "tv1",
  "player",
  "DataSourceBackend.java"
);
const selectorSourcePath = join(
  process.cwd(),
  "android",
  "app",
  "src",
  "main",
  "java",
  "com",
  "tv1",
  "player",
  "DataSourceBackendSelector.java"
);

let enumSource = "";
let selectorSource = "";

try {
  enumSource = readFileSync(enumSourcePath, "utf8");
} catch (error) {
  throw new Error("Missing DataSourceBackend enum source.");
}

try {
  selectorSource = readFileSync(selectorSourcePath, "utf8");
} catch (error) {
  throw new Error("Missing DataSourceBackendSelector source.");
}

if (!/public\s+enum\s+DataSourceBackend\s*\{\s*DEFAULT\s*,\s*OKHTTP\s*\}/s.test(enumSource)) {
  throw new Error("DataSourceBackend must declare DEFAULT and OKHTTP in that order.");
}

if (!/public\s+final\s+class\s+DataSourceBackendSelector\s*\{/s.test(selectorSource)) {
  throw new Error("DataSourceBackendSelector must be final.");
}

if (!/public\s+static\s+DataSourceBackend\s+resolve\(String\s+override,\s*boolean\s+debugBuild\)\s*\{/s.test(selectorSource)) {
  throw new Error("DataSourceBackendSelector must declare the resolve contract.");
}

if (/import\s+android\./.test(selectorSource) || /android\./.test(selectorSource)) {
  throw new Error("DataSourceBackendSelector must not depend on Android.");
}

if (!appBuildGradle.includes('implementation "androidx.media3:media3-datasource-okhttp:1.8.0"')) {
  throw new Error("android/app/build.gradle must declare the exact Media3 OkHttp dependency.");
}

const okhttpDependencyMatches = appBuildGradle.match(/androidx\.media3:media3-datasource-okhttp:/g) ?? [];
if (okhttpDependencyMatches.length !== 1) {
  throw new Error("android/app/build.gradle must declare exactly one Media3 OkHttp dependency line.");
}

if (appBuildGradle.includes('androidx.media3:media3-datasource-okhttp:') && !appBuildGradle.includes('androidx.media3:media3-datasource-okhttp:1.8.0')) {
  throw new Error("android/app/build.gradle must not declare a second Media3 OkHttp version.");
}

console.log("Android datasource selector contract tests passed.");
