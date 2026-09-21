// @tflw/reporter — pure consumer of the run report. renderReportHtml + renderCliSummary +
// renderJunitXml are pure; writeReport/writeJunitXml are the only I/O (write into the report dir).
//
// M56 (Phase 3, D121) removed the separate `load-html.ts`/`load-junit.ts` and their
// `writeLoadReport`/`writeLoadJunitXml`/`writeLoadResultsJson` writers — a workload test's result
// now lives inline in `RunReport.tests` (D116/D117), rendered by `renderReportHtml`/`renderJunitXml`
// like any other entry, and captured by `writeResultsJson`'s existing `results.json` — no more
// separate `load-report.html`/`load-junit.xml`/`load-results.json` artifacts.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { exhaustiveEntry, type LogLevel, type ReportEntry, type RunReport, type TraceAsset } from '@tflw/runtime';
import { resolveReportAssets, traceRelPath } from './assets.js';
import { renderReportHtml } from './html.js';
import { renderJunitXml } from './junit.js';

export { renderReportHtml } from './html.js';
export { renderCliSummary } from './cli-summary.js';
// M89b (D-M89-5) — exported for the CLI's pre-run `scenario "…" — <description>` line, which is
// the same string this renders into the summary and `report.html` because it is the same call.
export { describeWorkload } from './workload-format.js';
// `M192` U4 — the page gate grades the workload view against these, the same calls the page makes.
export { formatThresholdActual, formatThresholdTarget } from './threshold-format.js';
export { renderJunitXml } from './junit.js';
export { writeLastRun, readLastRun, renderLastRun, describeRunFilter, type LastRun, type LastRunFailure } from './last-run.js';
export { writeEventsNdjson } from './events-ndjson.js';
// M130b (D332) — the runnable `.tflw` per authorization finding. An emitter, not an evidence dump:
// an evidence file can never be wrong, which is what makes it worth less than a file that goes red
// until the bug is fixed and green afterwards.
// M137d (D473/D474) — one sink, two directories, a template per originating scan.
export { writeRepros, renderRepro, renderAuthzRepro, renderInputRepro, reproFileName, reproDirFor, AUTHZ_REPRO_DIR, INPUT_REPRO_DIR } from './repro.js';
// M134b (D376/D389) — the security findings block, its tally, and `M128-01`'s rule census.
export { renderFindings, renderScanCoverage, findingsSummaryLine, sortFindings } from './findings.js';
// M135a (D402/D406/D408) — R7's remediation KB and D406's severity table. Exported because they are
// the inputs `M135b`'s SARIF exporter maps onto `rule.help` and `rule.properties`, and because
// `testFlow-tests` asserts the emitted document against them rather than against a copy.
export { REMEDIATION_KB, remediationFor, type KbEntry, type KbRef } from './kb.js';
export { SARIF_SEVERITY, sarifSeverityOf, type SarifLevel, type SarifSeverity } from './sarif-severity.js';
// M135b (D403/D404) — R8's document, re-attached to `run` because the mode it was written for will
// never exist. `writeSarif` writes nothing at all when the run did not scan, which is D404: an empty
// `results` array tells GitHub every existing alert is fixed.
export { buildSarifLog, writeSarif, runScanned, sarifUri, SARIF_FILE, SARIF_SCHEMA_URL, type SarifOptions } from './sarif.js';
// `M137a`/`M136c-01` — exported so `packages/cli/scripts/bundle.mjs` can write it into the shipped
// package as `dist/artifact-contract.json`, which is what `testFlow-tests` reads across the repo
// boundary. Nothing inside this monorepo needs it from here; the emitter imports it directly.
export { ARTIFACT_CONTRACT, type ArtifactContract } from './artifact-contract.js';
export { RUN_OWNED_CONDITIONAL_MEMBERS, clearRunOwnedMembers } from './report-dir.js';
export { resolveReportAssets, traceRelPath, DEFAULT_INLINE_BUDGET_BYTES, type ReportAssetFile, type ResolvedReportAssets } from './assets.js';

/** Write report.html into `dir` (created if needed), plus any `assets/` files (M3c, D12) it links
 * to — a screenshot over the inline budget, or a Playwright trace archive (always external).
 * Returns the absolute path written to report.html. A run with none of those writes no `assets/`
 * directory at all, keeping today's single-file UX for an API-only (or UI-but-all-green) run. */
export async function writeReport(report: RunReport, dir: string, logLevelThreshold: LogLevel = 'debug'): Promise<string> {
  const outDir = resolve(dir);
  await mkdir(outDir, { recursive: true });
  const { hrefs, files } = resolveReportAssets(report);
  for (const file of files) {
    const filePath = join(outDir, file.relPath);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, Buffer.from(file.base64, 'base64'));
  }
  const path = join(outDir, 'report.html');
  await writeFile(path, renderReportHtml(report, hrefs, logLevelThreshold), 'utf8');
  return path;
}

/** Write junit.xml into `dir` (created if needed), alongside report.html. Returns the absolute
 * path written (SPEC §13, P#23). */
export async function writeJunitXml(report: RunReport, dir: string): Promise<string> {
  const outDir = resolve(dir);
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, 'junit.xml');
  await writeFile(path, renderJunitXml(report), 'utf8');
  return path;
}

/**
 * Write results.json into `dir` (created if needed) — the same redacted `RunReport` that already
 * feeds report.html, always written alongside it (no flag, PLAN decision 111/M17), so CI can read
 * a run's outcome from a file instead of scraping stdout.
 *
 * **With one substitution: a trace is written as its `path`, never as its bytes** (`M220` `B`,
 * `D1171`). `writeReport` has already written `assets/traces/<hash>.zip` from those bytes — that
 * is what `TraceAsset`'s own docstring has said since M3c — so the base64 here was a second copy
 * of a file this same directory already holds. Measured at 668 KB per six-action session against
 * a 501 KB archive, in a repository whose `M205-07` is a 55–61 MB report; and `D1170` has just
 * made a *kept* trace the ordinary outcome of pressing ▶ rather than the mark of a failure.
 *
 * **`writeReport` must run first, and the ordering is `cli.ts`'s to keep** — it does, and has
 * since M17. This function does not write the archive and must not: one writer, and a path here
 * that named a file nobody wrote would be worse than the duplicate it replaces. `traceRelPath` is
 * shared with the writer for exactly that reason.
 */
export async function writeResultsJson(report: RunReport, dir: string): Promise<string> {
  const outDir = resolve(dir);
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, 'results.json');
  await writeFile(path, JSON.stringify(withTracePaths(report), null, 2) + '\n', 'utf8');
  return path;
}

/**
 * `RunReport` → the same report with every `trace` reduced to the archive's relative path.
 *
 * Pure, and **exhaustive by construction**: the `switch` below is the shape `entry-kind.ts`'s
 * header argues for — when `ReportEntry` gains a kind, `exhaustiveEntry` stops compiling and
 * somebody decides whether the new kind carries a trace, instead of an `!== 'functional'` test
 * continuing to compile and quietly answering *no*. `stepBearing` itself is not the instrument
 * here because that function answers *does this have a timeline to walk*, and this one has to
 * **rebuild** the entry it was given; a read-only view cannot be reassembled.
 */
function withTracePaths(report: RunReport): RunReport {
  return { ...report, tests: report.tests.map(retraceEntry) };
}

/** A trace as `results.json` carries it: the path, and never the bytes (`D1171`). A trace that
 *  already has no bytes — a report read back off disk and written out again — is returned
 *  untouched rather than losing its path to an undefined hash. */
const movedTrace = (t: TraceAsset): TraceAsset => (t.base64 === undefined ? t : { path: traceRelPath(t.base64) });

function retraceEntry(entry: ReportEntry): ReportEntry {
  switch (entry.kind) {
    case 'workload':
      // `D24a` — a load iteration's body executes silently. No steps, no attempts, no trace.
      return entry;
    case 'crawl':
      // **A crawl has no `trace` field at all**, and `StepBearing`'s own docstring says why: a
      // crawl opens no browser, and `TraceAsset` is a Playwright archive. Written out rather than
      // folded into the arm above because the two are true for different reasons — one kind has
      // no timeline, this one has a timeline and no browser behind it.
      return entry;
    case 'functional': {
      // **Both places a trace hangs**, and the same two `assets.ts` walks: a test's own, and one
      // per earlier attempt of a retried test.
      const attempts = entry.attempts?.map((a) => (a.trace ? { ...a, trace: movedTrace(a.trace) } : a));
      const withAttempts = attempts ? { ...entry, attempts } : entry;
      return withAttempts.trace ? { ...withAttempts, trace: movedTrace(withAttempts.trace) } : withAttempts;
    }
    default:
      return exhaustiveEntry(entry);
  }
}
