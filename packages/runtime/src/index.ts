// @tflw/runtime — public API. Interprets a parsed Program over the fetch binding, emitting the
// event stream the reporter consumes. M3a adds the Playwright-backed browser step driver.

export * from './types.js';
export { MIN_REDACTABLE_LENGTH, Redactor, redactEvent, redactReport } from './redact.js';
export { RuntimeError } from './eval.js';
export { ConfigError, selectEnv, resolveConfig, missingRequiredEnv, type EnvSelection } from './resolve.js';
export { runProgram, makeUniqueSeq, countTestCases, findSessionUsages, SessionCache, type RunOptions, type RunOutput } from './interpreter.js';
export { runLoadShard, mergeLoadShardReports, spliceLoadReportIntoRunReport, type LoadOptions } from './interpreter.js';
// M89b (D-M89-5) — the CLI's pre-run `scenario "…" — <description>` line formats *this* value
// through the reporter's one `describeWorkload`, instead of switching over the AST itself.
export { workloadOf } from './interpreter.js';
export { resolveImportedActions, resolveMissingFiles, type ReadText, type PathExists } from './imports.js';
export { mergeSelfDiagnosis } from './selfDiagnosis.js';
export { shutdownMtlsWorker } from './mtlsWorker.js';
export { resolveRunSeed, resolveRunClock } from './seed.js';
export { BrowserManager, SUPPORTED_BROWSER_ENGINES, type BrowserEngine, type BrowserManagerOptions } from './browser.js';
export { startPickSession, wirePickSession, type PickedLocator, type PickLocatorKind, type PickSessionHandle } from './browser.js';
export type { SnapshotDiffAsset } from './snapshot.js';
