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
import type { LogLevel, RunReport } from '@tflw/runtime';
import { resolveReportAssets } from './assets.js';
import { renderReportHtml } from './html.js';
import { renderJunitXml } from './junit.js';

export { renderReportHtml } from './html.js';
export { renderCliSummary } from './cli-summary.js';
// M89b (D-M89-5) — exported for the CLI's pre-run `scenario "…" — <description>` line, which is
// the same string this renders into the summary and `report.html` because it is the same call.
export { describeWorkload } from './workload-format.js';
export { renderJunitXml } from './junit.js';
export { writeLastRun, readLastRun, renderLastRun, describeRunFilter, type LastRun, type LastRunFailure } from './last-run.js';
export { writeEventsNdjson } from './events-ndjson.js';
export { resolveReportAssets, DEFAULT_INLINE_BUDGET_BYTES, type ReportAssetFile, type ResolvedReportAssets } from './assets.js';

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

/** Write results.json into `dir` (created if needed) — the exact same redacted `RunReport` that
 * already feeds report.html, always written alongside it (no flag, PLAN decision 111/M17), so CI
 * can read a run's outcome from a file instead of scraping stdout. */
export async function writeResultsJson(report: RunReport, dir: string): Promise<string> {
  const outDir = resolve(dir);
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, 'results.json');
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return path;
}
