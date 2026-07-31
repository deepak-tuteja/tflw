// @tflw/runtime — public API. Interprets a parsed Program over the fetch binding, emitting the
// event stream the reporter consumes. M3a adds the Playwright-backed browser step driver.

export * from './types.js';
export { Redactor, redactReport } from './redact.js';
export { RuntimeError } from './eval.js';
export { ConfigError, selectEnv, resolveConfig, missingRequiredEnv, type EnvSelection } from './resolve.js';
export { runProgram, makeUniqueSeq, countTestCases, findSessionUsages, SessionCache, type RunOptions, type RunOutput } from './interpreter.js';
export { runLoad, runLoadShard, mergeLoadShardReports, type LoadOptions } from './interpreter.js';
export { mergeSelfDiagnosis } from './selfDiagnosis.js';
export { resolveRunSeed, resolveRunClock } from './seed.js';
export { BrowserManager, SUPPORTED_BROWSER_ENGINES, type BrowserEngine, type BrowserManagerOptions } from './browser.js';
export { startPickSession, wirePickSession, type PickedLocator, type PickLocatorKind, type PickSessionHandle } from './browser.js';
export type { SnapshotDiffAsset } from './snapshot.js';
