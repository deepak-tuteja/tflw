// @tflw/reporter — pure consumer of the run report. renderReportHtml + renderCliSummary +
// renderJunitXml are pure; writeReport/writeJunitXml are the only I/O (write into the report dir).

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { LoadReport, LogLevel, RunReport } from '@tflw/runtime';
import { resolveReportAssets } from './assets.js';
import { renderReportHtml } from './html.js';
import { renderJunitXml } from './junit.js';
import { renderLoadReportHtml } from './load-html.js';
import { renderLoadJunitXml } from './load-junit.js';

export { renderReportHtml } from './html.js';
export { renderCliSummary } from './cli-summary.js';
export { renderJunitXml } from './junit.js';
export { renderLoadReportHtml } from './load-html.js';
export { renderLoadJunitXml } from './load-junit.js';
export { writeLastRun, readLastRun, renderLastRun, type LastRun, type LastRunFailure } from './last-run.js';
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

/** M32 (R2) — write `load-report.html` into `dir` (created if needed). Returns the absolute path
 * written. */
export async function writeLoadReport(report: LoadReport, dir: string): Promise<string> {
  const outDir = resolve(dir);
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, 'load-report.html');
  await writeFile(path, renderLoadReportHtml(report), 'utf8');
  return path;
}

/** M32 (R2) — write `load-junit.xml` into `dir` (created if needed) — mode-prefixed rather than
 * R2's literal `junit.xml`, see `load-junit.ts`'s header comment for why. */
export async function writeLoadJunitXml(report: LoadReport, dir: string): Promise<string> {
  const outDir = resolve(dir);
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, 'load-junit.xml');
  await writeFile(path, renderLoadJunitXml(report), 'utf8');
  return path;
}

/** M32 (R2) — write `load-results.json` into `dir` (created if needed) — the exact same `LoadReport`
 * that feeds `load-report.html`, so CI can read a load run's outcome from a file. Renamed from the
 * M29-era `load-metrics.json` now that this is the full R1-R6/R11 report design, not a stub. */
export async function writeLoadResultsJson(report: LoadReport, dir: string): Promise<string> {
  const outDir = resolve(dir);
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, 'load-results.json');
  await writeFile(path, JSON.stringify(report, null, 2) + '\n', 'utf8');
  return path;
}
