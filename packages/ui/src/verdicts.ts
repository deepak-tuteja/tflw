// The verdict index — `M255` `A` (`D1404`).
//
// ONE MODULE, READ BY EVERY SURFACE THAT DRAWS A VERDICT. The explorer's dots, the `failed` chip, the
// Run tab's dot and the head line all ask this, so no two of them can disagree about whether a test
// failed. `D1404` names the steps column and the Run tree as readers too; those are rebuilt by
// `M256`/`M257`, and read it from then.
//
// **EACH TEST'S NEWEST VERDICT, NOT THE NEWEST RUN'S** (plan §8.3 #11). The plan said *from the newest
// run directory*, and the build found why that cannot be the rule: every run the page starts is
// kept, a Send and a play included, and those run a scratch copy under the scratch's own name. Keyed
// on the newest run, one Send would turn every dot in the project to *not run*. So a test's verdict
// is the one from the newest kept run **that contained it** — `M249`'s history, which already joins
// the kept runs by test — and the run it came from is carried, so a surface can say how old it is.
//
// **A TEST IS ITS FILE AND ITS DECLARED NAME** — history's key, and the pair `--failed` replays by.
// A renamed test has no verdict until it runs under its new name (`§6` prediction 2). That is the
// honest reading of a rename, and the explorer says *not run yet* rather than guessing it is the old
// one: the old name's verdict is about a declaration that no longer exists.
//
// **A SKIP IS NOT A VERDICT ON THE TEST**, and a file's roll-up leaves it out, the way `history.ts`'s
// flaky rule leaves it out of a flip.

import type { HistoryView, ProjectFile, ProjectView, ReportDir } from './contract';

/** A test's newest verdict, or that it has none in the kept runs. */
export type TestVerdict = 'pass' | 'fail' | 'skip' | 'not-run';

export interface TestMark {
  readonly verdict: TestVerdict;
  /** The kept run the verdict came from; `null` for `not-run`. */
  readonly run: string | null;
  readonly flaky: boolean;
}

/** A file's tests, rolled up: `fail` if any failed; else `pass` if any passed; else `skip` if any
 *  skipped; else `not-run`. The counts are what the roll-up's tip reads out. */
export interface FileMark {
  readonly verdict: TestVerdict;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly notRun: number;
}

/** The newest run the page can see, for the head line and the Run tab's dot. */
export interface NewestRun {
  readonly id: string;
  /** `results.json`'s mtime, as the run list reads it; `''` when the directory has none. */
  readonly at: string;
  /** `fail` when a test failed; `inconclusive` when the run is not ok and nothing failed (a
   *  saturated generator, an abort — `RunReport.ok`'s own meaning, `M114`); else `pass`. */
  readonly verdict: 'pass' | 'fail' | 'inconclusive';
  readonly failed: number;
  readonly total: number;
}

export interface VerdictIndex {
  test(file: string, name: string): TestMark;
  file(f: ProjectFile): FileMark;
  /** Every test and crawl of the project whose newest verdict is `fail`, as `file\0name`. */
  readonly failed: ReadonlySet<string>;
  readonly newest: NewestRun | null;
}

const NOT_RUN: TestMark = { verdict: 'not-run', run: null, flaky: false };

/** A run's cwd is the project root, and a path may still carry a `./` — `ran.ts`'s `sameFile` reason. */
const norm = (path: string): string => path.replace(/^\.\//, '');

export function markKey(file: string, name: string): string {
  return `${norm(file)}\u0000${name}`;
}

export function verdictIndex(project: ProjectView | null, history: HistoryView | null, reports: readonly ReportDir[]): VerdictIndex {
  const marks = new Map<string, TestMark>();
  for (const t of history?.tests ?? []) {
    const v = t.verdicts[0];
    if (v === undefined) continue;
    marks.set(markKey(t.file, t.name), { verdict: v, run: t.last === '' ? null : t.last, flaky: t.flaky });
  }
  const test = (file: string, name: string): TestMark => marks.get(markKey(file, name)) ?? NOT_RUN;

  const failed = new Set<string>();
  for (const f of project?.files ?? []) {
    for (const t of [...f.tests, ...f.crawls]) if (test(f.path, t.name).verdict === 'fail') failed.add(markKey(f.path, t.name));
  }

  const file = (f: ProjectFile): FileMark => {
    let passed = 0;
    let fails = 0;
    let skipped = 0;
    let notRun = 0;
    for (const t of [...f.tests, ...f.crawls]) {
      const v = test(f.path, t.name).verdict;
      if (v === 'pass') passed += 1;
      else if (v === 'fail') fails += 1;
      else if (v === 'skip') skipped += 1;
      else notRun += 1;
    }
    const verdict: TestVerdict = fails > 0 ? 'fail' : passed > 0 ? 'pass' : skipped > 0 ? 'skip' : 'not-run';
    return { verdict, passed, failed: fails, skipped, notRun };
  };

  let newest: NewestRun | null = null;
  const id = history?.runs[0];
  if (id !== undefined) {
    const entry = reports.find((r) => r.id === id);
    const s = entry?.summary ?? null;
    newest = {
      id,
      at: entry?.at ?? '',
      verdict: s === null ? 'inconclusive' : s.failed > 0 ? 'fail' : s.ok ? 'pass' : 'inconclusive',
      failed: s?.failed ?? 0,
      total: s?.total ?? 0,
    };
  }

  return { test, file, failed, newest };
}

/** `just now`, `5 min ago`, `3 h ago`, `7d ago` — the head line's age, coarse on purpose: it says
 *  whether the dots are this morning's or last week's, and nothing finer is a decision. */
export function ageOf(at: string, now: number = Date.now()): string {
  const t = Date.parse(at);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

/** The words a dot says, for its tip and its accessible name. */
export const VERDICT_WORDS: Readonly<Record<TestVerdict, string>> = {
  pass: 'passed',
  fail: 'failed',
  skip: 'skipped',
  'not-run': 'not run yet',
};
