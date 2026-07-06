// @tflw/reporter — pure consumer of the run report. renderReportHtml + renderCliSummary +
// renderJunitXml are pure; writeReport/writeJunitXml are the only I/O (write into the report dir).

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RunReport } from '@tflw/runtime';
import { renderReportHtml } from './html.js';
import { renderJunitXml } from './junit.js';

export { renderReportHtml } from './html.js';
export { renderCliSummary } from './cli-summary.js';
export { renderJunitXml } from './junit.js';

/** Write report.html into `dir` (created if needed). Returns the absolute path written. */
export async function writeReport(report: RunReport, dir: string): Promise<string> {
  const outDir = resolve(dir);
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, 'report.html');
  await writeFile(path, renderReportHtml(report), 'utf8');
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
