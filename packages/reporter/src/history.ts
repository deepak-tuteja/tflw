// History, read from the kept runs on demand (`M249` `B`, `D1362`).
//
// `report/runs/<id>/results.json` is the only record there is — nothing is added to `results.json`
// for history's sake and nothing is stored beside the runs. Reading N small JSON files when someone
// asks is cheaper than maintaining an index that can disagree with them.
//
// **A test's identity is its file and its declared name**, the pair `--failed` already replays by.
// A renamed test starts a new history; that is the honest reading of a rename, not a loss.
//
// **Flaky** is the one judgement here, and it is deliberately narrow: the verdict changed between
// two consecutive kept runs **whose `sourceHash` for that test is equal**. A verdict that changed
// because the file changed is a change, not a flake. A run without a hash (kept before `M249`, or a
// report written by hand) can never be half of a flaky pair — the word is withheld, never guessed.
// A skip is not a verdict: `pass → skip → fail` is not a flip, and a skipped run is left out of the
// comparison rather than breaking the chain.

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ReportEntry, RunReport } from '@tflw/runtime';
import { RUNS_DIR, listKeptRuns } from './runs.js';

export type Verdict = 'pass' | 'fail' | 'skip';

export interface RunVerdict {
  /** The kept run's id (`runs/<id>`). */
  readonly run: string;
  readonly verdict: Verdict;
  readonly sourceHash?: string;
}

export interface TestHistory {
  readonly file: string;
  readonly name: string;
  /** Newest first, at most `limit`, one per kept run that contained this test. */
  readonly runs: readonly RunVerdict[];
  /** How many of `runs` failed. */
  readonly failures: number;
  readonly flaky: boolean;
}

export interface ThresholdHistory {
  readonly file: string;
  readonly test: string;
  /** `p95 duration < 300`, the threshold's own label, comparator and target. */
  readonly threshold: string;
  /** Newest first; `null` where the run measured nothing (`D-M89-1`). */
  readonly values: readonly (number | null)[];
}

export interface History {
  /** Kept runs read, newest first — how many runs `failures` and `values` are out of. */
  readonly runs: readonly string[];
  readonly tests: ReadonlyMap<string, TestHistory>;
  readonly thresholds: readonly ThresholdHistory[];
}

/** The key a test is joined by across runs. */
export function testKey(file: string | undefined, name: string): string {
  return `${file ?? ''}\u0000${name}`;
}

function verdictOf(entry: ReportEntry): Verdict {
  if (entry.kind === 'functional' && entry.skipped !== undefined) return 'skip';
  return entry.ok ? 'pass' : 'fail';
}

/** `true` when two consecutive non-skip verdicts differ and both runs saw the same source. */
export function isFlaky(runs: readonly RunVerdict[]): boolean {
  const judged = runs.filter((r) => r.verdict !== 'skip');
  for (let i = 0; i + 1 < judged.length; i++) {
    const a = judged[i]!;
    const b = judged[i + 1]!;
    if (a.verdict !== b.verdict && a.sourceHash !== undefined && a.sourceHash === b.sourceHash) return true;
  }
  return false;
}

/** Read the newest `limit` kept runs under `reportDir`. A run whose `results.json` cannot be read
 * is skipped, not fatal: history is a convenience and a half-written run must not break a summary. */
export async function readHistory(reportDir: string, opts: { readonly limit: number }): Promise<History> {
  const ids = (await listKeptRuns(reportDir)).slice(0, Math.max(0, opts.limit));
  const reports: { id: string; report: RunReport }[] = [];
  for (const id of ids) {
    try {
      reports.push({ id, report: JSON.parse(await readFile(join(resolve(reportDir), RUNS_DIR, id, 'results.json'), 'utf8')) as RunReport });
    } catch {
      // unreadable: left out
    }
  }
  const runsByTest = new Map<string, { file: string; name: string; runs: RunVerdict[] }>();
  const thresholds = new Map<string, ThresholdHistory & { values: (number | null)[] }>();
  for (const { id, report } of reports) {
    for (const entry of report.tests ?? []) {
      const key = testKey(entry.file, entry.name);
      const slot = runsByTest.get(key) ?? { file: entry.file ?? '', name: entry.name, runs: [] };
      slot.runs.push({ run: id, verdict: verdictOf(entry), ...(entry.sourceHash ? { sourceHash: entry.sourceHash } : {}) });
      runsByTest.set(key, slot);
      if (entry.kind === 'workload') {
        for (const t of entry.thresholds) {
          const label = `${t.label} ${t.op === 'lessThan' ? '<' : '>'} ${t.target}`;
          const tkey = `${key}\u0000${label}`;
          const th = thresholds.get(tkey) ?? { file: entry.file ?? '', test: entry.name, threshold: label, values: [] };
          th.values.push(t.actual);
          thresholds.set(tkey, th);
        }
      }
    }
  }
  const tests = new Map<string, TestHistory>();
  for (const [key, { file, name, runs }] of runsByTest) {
    tests.set(key, { file, name, runs, failures: runs.filter((r) => r.verdict === 'fail').length, flaky: isFlaky(runs) });
  }
  return { runs: reports.map((r) => r.id), tests, thresholds: [...thresholds.values()] };
}

/** The summary's clause for a failing test: `— failed in 3 of its last 10 kept runs`, `, flaky`
 * when it is. Out of the runs that contained the test, not all kept runs: a `--tag` run that left it
 * out is not a run it passed. Empty until the test has a run before this one, so a first run reads
 * as it always did. */
export function historyClause(history: History, file: string | undefined, name: string): string {
  const h = history.tests.get(testKey(file, name));
  if (!h || h.runs.length < 2) return '';
  return ` — failed in ${h.failures} of its last ${h.runs.length} kept runs${h.flaky ? ', flaky' : ''}`;
}
