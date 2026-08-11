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
  /** `FU-23`/D250 — the filters this run was narrowed by, as the user typed them, or absent for a
   * full run. The defect was never that a filtered run overwrites the record; it is that `--failed`
   * then replays it while describing itself as "the last run", with no way to know the difference.
   * One field is what turns a silent redefinition into a stated one. */
  readonly filter?: string;
}

/** `undefined` for a full run — so `renderLastRun` omits the key entirely and an unfiltered record
 * stays byte-identical to what every version before this one wrote. */
export function describeRunFilter(f: { readonly tags?: readonly string[]; readonly only?: string; readonly failed?: boolean }): string | undefined {
  const parts: string[] = [];
  if (f.tags?.length) parts.push(`--tag ${f.tags.join(',')}`);
  if (f.only) parts.push(`--only ${f.only}`);
  if (f.failed) parts.push('--failed');
  return parts.length > 0 ? parts.join(' ') : undefined;
}

export function renderLastRun(report: RunReport, filter?: string): LastRun {
  const failed = report.tests.filter((t) => !t.ok).map((t) => ({ file: t.file ?? '', test: t.name }));
  return filter === undefined ? { failed } : { failed, filter };
}

/** Always overwrites — every run (including one already filtered by `--failed`) records exactly
 * what it actually found, so repeated `--failed` invocations narrow further as tests get fixed. */
export async function writeLastRun(report: RunReport, dir: string, filter?: string): Promise<string> {
  const outDir = resolve(dir);
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, '.last-run.json');
  await writeFile(path, JSON.stringify(renderLastRun(report, filter), null, 2) + '\n', 'utf8');
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
