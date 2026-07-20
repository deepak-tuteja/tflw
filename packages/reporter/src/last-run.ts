// report/.last-run.json — records the previous run's failing tests, consumed by `tflw run
// --failed` (PLAN decision 111, M17). A test that failed on an earlier `retry` attempt but
// ultimately passed (flagged `flaky`) is never in this list — `TestResult.ok` is already the
// final, post-retry verdict, the same one `--bail` trips on.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { RunReport } from '@tflw/runtime';

export interface LastRunFailure {
  readonly file: string;
  readonly test: string;
}

export interface LastRun {
  readonly failed: readonly LastRunFailure[];
}

export function renderLastRun(report: RunReport): LastRun {
  return { failed: report.tests.filter((t) => !t.ok).map((t) => ({ file: t.file ?? '', test: t.name })) };
}

/** Always overwrites — every run (including one already filtered by `--failed`) records exactly
 * what it actually found, so repeated `--failed` invocations narrow further as tests get fixed. */
export async function writeLastRun(report: RunReport, dir: string): Promise<string> {
  const outDir = resolve(dir);
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, '.last-run.json');
  await writeFile(path, JSON.stringify(renderLastRun(report), null, 2) + '\n', 'utf8');
  return path;
}

/** `null` when no state file exists yet (first-ever run) — `--failed` treats that the same as a
 * prior run with zero failures: fall back to running the full suite. */
export async function readLastRun(dir: string): Promise<LastRun | null> {
  try {
    const text = await readFile(join(resolve(dir), '.last-run.json'), 'utf8');
    return JSON.parse(text) as LastRun;
  } catch {
    return null;
  }
}
