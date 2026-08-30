import { readFileSync } from "node:fs";
import { join } from "node:path";

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readRequired(pathParts, missingMessage) {
  const fullPath = join(process.cwd(), ...pathParts);
  try {
    return readFileSync(fullPath, "utf8");
  } catch (error) {
    throw new Error(missingMessage);
  }
}

const transferDiagnosticsSource = readRequired(
  ["android", "app", "src", "main", "java", "com", "tv1", "player", "TransferDiagnostics.java"],
  "Missing TransferDiagnostics source."
);
const instrumentedDataSourceSource = readRequired(
  ["android", "app", "src", "main", "java", "com", "tv1", "player", "InstrumentedDataSource.java"],
  "Missing InstrumentedDataSource source."
);
const instrumentedDataSourceFactorySource = readRequired(
  ["android", "app", "src", "main", "java", "com", "tv1", "player", "InstrumentedDataSourceFactory.java"],
  "Missing InstrumentedDataSourceFactory source."
);
const playbackDataSourceFactorySource = readRequired(
  ["android", "app", "src", "main", "java", "com", "tv1", "player", "PlaybackDataSourceFactory.java"],
  "Missing PlaybackDataSourceFactory source."
);
const mainActivitySource = readRequired(
  ["android", "app", "src", "main", "java", "com", "tv1", "player", "MainActivity.java"],
  "Missing MainActivity source."
);
const playbackDiagnosticsRuntimeSource = readRequired(
  ["android", "app", "src", "main", "java", "com", "tv1", "player", "PlaybackDiagnostics.java"],
  "Missing PlaybackDiagnostics source."
);
const transferDiagnosticsTestSource = readRequired(
  ["android", "app", "src", "test", "java", "com", "tv1", "player", "TransferDiagnosticsTest.java"],
  "Missing TransferDiagnosticsTest source."
);

if (!/public\s+final\s+class\s+TransferDiagnostics\s+implements\s+TransferListener/.test(transferDiagnosticsSource)) {
  throw new Error("TransferDiagnostics must be a final TransferListener.");
}

for (const signature of [
  /TransferDiagnostics\s*\(\s*String\s+backend\s*,\s*EventSink\s+sink\s*\)/,
  /void\s+beginBeforeOpen\s*\(\s*DataSource\s+source\s*,\s*DataSpec\s+dataSpec\s*\)/,
  /void\s+finishFromWrapper\s*\(\s*DataSource\s+source\s*\)/,
  /void\s+failFromWrapper\s*\(\s*DataSource\s+source\s*,\s*DataSpec\s+dataSpec\s*,\s*IOException\s+error\s*\)/,
  /int\s+getActiveTransferCount\s*\(\s*\)/
]) {
  if (!signature.test(transferDiagnosticsSource)) {
    throw new Error("TransferDiagnostics is missing a required Task 2 method signature.");
  }
}

if (!transferDiagnosticsSource.includes("AtomicLong")) {
  throw new Error("TransferDiagnostics must use AtomicLong for monotonic transfer ids.");
}

if (!transferDiagnosticsSource.includes("IdentityHashMap")) {
  throw new Error("TransferDiagnostics must keep state in an identity-keyed map.");
}

if (!transferDiagnosticsSource.includes("[A5-NET]")) {
  throw new Error("TransferDiagnostics must use the [A5-NET] log prefix.");
}

for (const token of [
  "TRANSFER_START",
  "TRANSFER_END",
  "TRANSFER_ERROR",
  "\"backend\"",
  "\"transferId\"",
  "\"node\"",
  "\"bytes\"",
  "\"durationMs\"",
  "\"slowTransfer5s\"",
  "\"verySlowTransfer15s\"",
  "\"throughput\""
]) {
  if (!transferDiagnosticsSource.includes(token)) {
    throw new Error(`TransferDiagnostics must include ${token} in the transfer contract.`);
  }
}

const beginBeforeOpenIndex = instrumentedDataSourceSource.indexOf("diagnostics.beginBeforeOpen(delegate, dataSpec)");
const delegateOpenIndex = instrumentedDataSourceSource.indexOf("delegate.open(dataSpec)");
if (beginBeforeOpenIndex < 0 || delegateOpenIndex < 0 || beginBeforeOpenIndex > delegateOpenIndex) {
  throw new Error("InstrumentedDataSource.open must call beginBeforeOpen(delegate, dataSpec) before delegate.open(dataSpec).");
}

if (instrumentedDataSourceSource.includes("diagnostics.beginBeforeOpen(this, dataSpec)")) {
  throw new Error("InstrumentedDataSource must not pass the wrapper identity to beginBeforeOpen.");
}

for (const snippet of [
  "diagnostics.failFromWrapper(delegate, dataSpec, error)",
  "diagnostics.failFromWrapper(delegate, currentDataSpec, error)",
  "diagnostics.finishFromWrapper(delegate)"
]) {
  if (!instrumentedDataSourceSource.includes(snippet)) {
    throw new Error(`InstrumentedDataSource is missing required wrapper handling: ${snippet}`);
  }
}

if (!/public\s+final\s+class\s+InstrumentedDataSourceFactory\s+implements\s+DataSource\.Factory/.test(instrumentedDataSourceFactorySource)) {
  throw new Error("InstrumentedDataSourceFactory must implement DataSource.Factory.");
}

if (!instrumentedDataSourceFactorySource.includes("return new InstrumentedDataSource(delegate.createDataSource(), diagnostics);")) {
  throw new Error("InstrumentedDataSourceFactory must wrap each raw delegate with InstrumentedDataSource.");
}

if (!/public\s+final\s+class\s+PlaybackDataSourceFactory/.test(playbackDataSourceFactorySource)) {
  throw new Error("PlaybackDataSourceFactory must be a final class.");
}

if (!/public\s+static\s+DataSource\.Factory\s+create\s*\(\s*DataSourceBackend\s+backend\s*,\s*TransferDiagnostics\s+diagnostics\s*\)/.test(playbackDataSourceFactorySource)) {
  throw new Error("PlaybackDataSourceFactory must expose the Task 3 create(backend, diagnostics) contract.");
}

if (!playbackDataSourceFactorySource.includes("new DefaultHttpDataSource.Factory()")) {
  throw new Error("PlaybackDataSourceFactory must create the DEFAULT raw factory with new DefaultHttpDataSource.Factory().");
}

if (!playbackDataSourceFactorySource.includes("new OkHttpDataSource.Factory(new OkHttpClient.Builder().build())")) {
  throw new Error("PlaybackDataSourceFactory must create the OKHTTP raw factory with a plain OkHttpClient.Builder().build().");
}

for (const token of [
  ".setUserAgent(",
  ".setConnectTimeoutMs(",
  ".setReadTimeoutMs(",
  ".setAllowCrossProtocolRedirects(",
  ".setCrossProtocolRedirectsForceOriginal(",
  ".setKeepPostFor302Redirects(",
  ".setDefaultRequestProperties(",
  ".setContentTypePredicate(",
  ".setCacheControl("
]) {
  if (playbackDataSourceFactorySource.includes(token)) {
    throw new Error(`PlaybackDataSourceFactory must not add custom HTTP configuration via ${token}`);
  }
}

for (const snippet of [
  "defaultFactory.setTransferListener(diagnostics);",
  "return new InstrumentedDataSourceFactory(defaultFactory, diagnostics);",
  "okHttpFactory.setTransferListener(diagnostics);",
  "return new InstrumentedDataSourceFactory(okHttpFactory, diagnostics);"
]) {
  if (!playbackDataSourceFactorySource.includes(snippet)) {
    throw new Error(`PlaybackDataSourceFactory is missing required shared wiring: ${snippet}`);
  }
}

const defaultListenerIndex = playbackDataSourceFactorySource.indexOf("defaultFactory.setTransferListener(diagnostics);");
const defaultWrapIndex = playbackDataSourceFactorySource.indexOf("return new InstrumentedDataSourceFactory(defaultFactory, diagnostics);");
if (defaultListenerIndex < 0 || defaultWrapIndex < 0 || defaultListenerIndex > defaultWrapIndex) {
  throw new Error("PlaybackDataSourceFactory must attach diagnostics to the DEFAULT raw factory before wrapping it.");
}

const okHttpListenerIndex = playbackDataSourceFactorySource.indexOf("okHttpFactory.setTransferListener(diagnostics);");
const okHttpWrapIndex = playbackDataSourceFactorySource.indexOf("return new InstrumentedDataSourceFactory(okHttpFactory, diagnostics);");
if (okHttpListenerIndex < 0 || okHttpWrapIndex < 0 || okHttpListenerIndex > okHttpWrapIndex) {
  throw new Error("PlaybackDataSourceFactory must attach diagnostics to the OKHTTP raw factory before wrapping it.");
}

for (const testName of [
  "normalTransferEmitsStartAndEndOnce",
  "openExceptionBeforeListenerStartEmitsStartAndErrorOnce",
  "listenerTransferStartReusesExistingRawDelegateState",
  "readExceptionEmitsErrorAndSuppressesLaterEnd",
  "closeExceptionEmitsErrorAndSuppressesLaterEnd",
  "activeStateTracksConcurrentRawDelegatesSeparately",
  "wrapperIdentityDoesNotCreateOrphanState"
]) {
  if (!transferDiagnosticsTestSource.includes(testName)) {
    throw new Error(`TransferDiagnosticsTest must cover ${testName}.`);
  }
}

const datasourceExtraRead = mainActivitySource.match(
  /String\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*getIntent\s*\(\s*\)\s*==\s*null\s*\?\s*null\s*:\s*getIntent\s*\(\s*\)\s*\.\s*getStringExtra\s*\(\s*(DATASOURCE_OVERRIDE_EXTRA|"tv1\.datasource")\s*\)\s*;/s
);
if (!datasourceExtraRead) {
  throw new Error('MainActivity must read the "tv1.datasource" debug intent extra into a local value.');
}

const datasourceOverrideVariable = datasourceExtraRead[1];
const selectorResolvePattern = new RegExp(
  `dataSourceBackend\\s*=\\s*DataSourceBackendSelector\\.resolve\\s*\\(\\s*${escapeRegex(datasourceOverrideVariable)}\\s*,\\s*BuildConfig\\.DEBUG\\s*\\)\\s*;`
);
if (!selectorResolvePattern.test(mainActivitySource)) {
  throw new Error(
    `MainActivity must pass ${datasourceOverrideVariable} from the tv1.datasource extra into DataSourceBackendSelector.resolve(${datasourceOverrideVariable}, BuildConfig.DEBUG).`
  );
}

const transferDiagnosticsCreations = mainActivitySource.match(/new\s+TransferDiagnostics\s*\(/g) ?? [];
if (transferDiagnosticsCreations.length !== 1) {
  throw new Error("MainActivity must create exactly one shared TransferDiagnostics instance.");
}

if (!mainActivitySource.includes("PlaybackDataSourceFactory.create(")) {
  throw new Error("MainActivity must build the shared HLS datasource through PlaybackDataSourceFactory.create.");
}

if (mainActivitySource.includes("new DefaultHttpDataSource.Factory()")) {
  throw new Error("MainActivity must not keep a raw DefaultHttpDataSource.Factory in the HLS branch.");
}

if (!/playbackDiagnostics\.startSession\s*\(\s*node\.url\s*,/s.test(mainActivitySource)) {
  throw new Error("MainActivity must start diagnostics sessions with the additive datasource backend identity.");
}

if (!mainActivitySource.includes("[A5-DATASOURCE] backend=")) {
  throw new Error("MainActivity must log the selected datasource backend once per session.");
}

if (!/public\s+void\s+startSession\s*\(\s*String\s+url\s*,\s*String\s+dataSourceBackend\s*\)/.test(playbackDiagnosticsRuntimeSource)) {
  throw new Error("PlaybackDiagnostics must expose startSession(String url, String dataSourceBackend).");
}

if (!/public\s+void\s+startSession\s*\(\s*String\s+url\s*\)/.test(playbackDiagnosticsRuntimeSource)) {
  throw new Error("PlaybackDiagnostics must preserve the startSession(String url) overload.");
}

if (!/startSession\s*\(\s*url\s*,\s*(DataSourceBackend\.DEFAULT\.name\(\)|"DEFAULT")\s*\)\s*;/.test(playbackDiagnosticsRuntimeSource)) {
  throw new Error("PlaybackDiagnostics.startSession(String url) must delegate to the DEFAULT backend overload.");
}

const backendIdentityMentions = playbackDiagnosticsRuntimeSource.match(/dataSourceBackend=/g) ?? [];
if (backendIdentityMentions.length !== 2) {
  throw new Error("PlaybackDiagnostics must add dataSourceBackend only to SESSION_START and SESSION_SUMMARY.");
}

console.log("Android datasource ABBA transfer contract tests passed.");
