// The Run tab as a tree by verdict — `M257` `B` (`D1409`).
//
// **WHAT THE READER CAME FOR IS WHAT FAILED.** The report used to be drawn by file, in declaration
// order, every test open: **8 982 px** for seventeen passing tests (plan §0), with the one red test
// wherever its file happened to sort. `D1409` turns it into a tree whose first group is `failed`,
// open, and whose passing tests are one folded row with a count — so a run with one failure is
// read by looking at the top of the pane, and a run with none is read by its headline.
//
// Pure, so the grouping and the headline can be held by a unit test; `RunView.tsx` draws them.

import type { ReportEntry, RunReport } from './contract';
import type { LiveTest } from './live';

/** The tree's groups, in the order they are drawn. `running` exists only while a run is live. */
export const TREE_GROUPS = ['running', 'failed', 'inconclusive', 'skipped', 'passed'] as const;
export type TreeGroup = (typeof TREE_GROUPS)[number];

/** Which groups are open at rest: what a reader came to read, and nothing they did not. */
export const OPEN_AT_REST: ReadonlySet<TreeGroup> = new Set<TreeGroup>(['running', 'failed', 'inconclusive']);

export interface TreeItem {
  /** Unique within one run — a `with each` expands to several tests of one name in one file. */
  readonly key: string;
  readonly file: string;
  readonly name: string;
  readonly group: TreeGroup;
  /** The finished entry; `null` while the test is still running. */
  readonly entry: ReportEntry | null;
  /** The steps so far, for a test still running. */
  readonly live: LiveTest | null;
}

/**
 * **Which group a finished test belongs to.**
 *
 * `skipped` and `passed`/`failed` are the test's own verdict — the same split `results.json`'s
 * counts make (`cli.ts`'s `mergeReports`: skipped, then `ok` less skipped, then the rest).
 *
 * **`inconclusive` is a workload test in a run that cannot vouch for its numbers** — a saturated
 * generator (`R11`) or a run cut short (`R5`). The runtime has no per-test *inconclusive*: the flag
 * is the run's, because a saturated generator invalidates every workload number it measured,
 * whichever way that test's thresholds came out. So such a test is neither *passed* nor *failed*
 * here, whatever its own `ok` says, which is exactly what `R11` asks of CI (*read `inconclusive`
 * first*). A functional test in the same run is unaffected: its assertions did not read the
 * generator.
 */
export function groupOf(entry: ReportEntry, runInconclusive: boolean): TreeGroup {
  if (entry.kind === 'functional' && entry.skipped !== undefined) return 'skipped';
  if (entry.kind === 'workload' && runInconclusive) return 'inconclusive';
  return entry.ok ? 'passed' : 'failed';
}

/** A run that cannot vouch for its workload numbers (`RunReport.inconclusive` / `aborted`). */
export function runInconclusive(report: Pick<RunReport, 'inconclusive' | 'aborted'>): boolean {
  return report.inconclusive === true || report.aborted === true;
}

/** Every test of a finished report, grouped, each group in the report's own order. */
export function treeOfReport(report: RunReport): readonly TreeItem[] {
  const inconclusive = runInconclusive(report);
  const seen = new Map<string, number>();
  return report.tests.map((entry) => {
    const file = entry.file ?? '';
    const base = `${file}\u0000${entry.name}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { key: `${base}\u0000${n}`, file, name: entry.name, group: groupOf(entry, inconclusive), entry, live: null };
  });
}

/**
 * Every test of a run in flight. A passing file hook is work, not a test (`live.ts`'s
 * `liveCounts`), so it is left out once it ends; a failing one is in the report and stays.
 */
export function treeOfLive(tests: readonly LiveTest[]): readonly TreeItem[] {
  const seen = new Map<string, number>();
  const out: TreeItem[] = [];
  for (const t of tests) {
    if (t.hook !== undefined && t.result !== null && t.result.ok) continue;
    const file = t.file ?? '';
    const base = `${file}\u0000${t.name}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({
      key: `${base}\u0000${n}`,
      file,
      name: t.name,
      group: t.result === null ? 'running' : groupOf(t.result, false),
      entry: t.result,
      live: t,
    });
  }
  return out;
}

/** The items of each group, in `TREE_GROUPS` order; an empty group is absent. */
export function grouped(items: readonly TreeItem[]): readonly (readonly [TreeGroup, readonly TreeItem[]])[] {
  return TREE_GROUPS.map((g) => [g, items.filter((i) => i.group === g)] as const).filter(([, list]) => list.length > 0);
}

/**
 * **The test a report opens on** — the first failing one, else the first inconclusive, else none.
 * A run that passed is read by its headline; opening one of seventeen green tests would be the
 * page choosing something to show rather than the run having something to say.
 */
export function openingItem(items: readonly TreeItem[]): TreeItem | null {
  return items.find((i) => i.group === 'failed') ?? items.find((i) => i.group === 'inconclusive') ?? null;
}

/** The headline's verdict word — the one word in capitals, and the only verdict in the line. */
export type VerdictWord = 'FAILED' | 'PASSED' | 'INCONCLUSIVE' | 'CANCELLED' | 'RUNNING' | 'NOTHING RAN';

export interface Headline {
  readonly word: VerdictWord;
  /** The count the word leads with (`1 FAILED`, `17 PASSED`), or `null` for a word that has none. */
  readonly count: number | null;
  /** The other groups, each `n word` with n ≥ 1 — a zero is not a fact about this run worth a word. */
  readonly counts: readonly string[];
  readonly tone: 'ok' | 'fail' | 'warn' | 'running';
}

/**
 * **One verdict** (`D1409`). The line used to read `FAIL · 17 tests · 17 passed · 0 failed · … ·
 * inconclusive` — three verdicts, two of them contradicting the first (plan §0, §7). Now the word is
 * chosen once, in this order: a cancelled run says so (F8's lesson — a partial report's counts are
 * not the run's verdict); any failed test; a run that cannot vouch for its numbers; otherwise it
 * passed. Every other group is a count, and a count of zero is not drawn.
 */
export function headlineOf(items: readonly TreeItem[], run: { readonly cancelled: boolean; readonly inconclusive: boolean; readonly running: boolean }): Headline {
  const n = (g: TreeGroup): number => items.filter((i) => i.group === g).length;
  const counts = (except: TreeGroup): string[] =>
    (['running', 'failed', 'inconclusive', 'skipped', 'passed'] as const)
      .filter((g) => g !== except && n(g) > 0)
      .map((g) => `${n(g)} ${g}`);
  if (run.running) return { word: 'RUNNING', count: null, counts: counts('running'), tone: 'running' };
  if (run.cancelled) return { word: 'CANCELLED', count: null, counts: counts('running'), tone: 'warn' };
  if (n('failed') > 0) return { word: 'FAILED', count: n('failed'), counts: counts('failed'), tone: 'fail' };
  if (run.inconclusive || n('inconclusive') > 0) return { word: 'INCONCLUSIVE', count: null, counts: counts('running'), tone: 'warn' };
  if (items.length === 0) return { word: 'NOTHING RAN', count: null, counts: [], tone: 'warn' };
  return { word: 'PASSED', count: n('passed'), counts: counts('passed'), tone: 'ok' };
}

/** Every word a headline could use as a verdict, in any case. */
const VERDICTS = /\b(pass(?:ed)?|fail(?:ed)?|inconclusive|cancell?ed|running|skipped)\b/gi;

/**
 * **How many verdicts a headline's text asserts** — the gate over the rendered line (`M257`'s
 * *exactly one*). A verdict word counts unless it is a group's count (`16 passed`, `1
 * inconclusive`): a number of one or more before it makes it a tally, not a verdict. `0 failed`
 * is a verdict wearing a count — a line that says it is ever wrong about zero things has said
 * something about the run — and a bare `inconclusive` after a `FAIL` is a second verdict. The old
 * line (§0) therefore counts three.
 */
export function verdictsIn(text: string): number {
  let found = 0;
  for (const m of text.matchAll(VERDICTS)) {
    const before = text.slice(0, m.index).trimEnd();
    const count = /(\d+)$/.exec(before);
    const tally = count !== null && Number(count[1]) > 0 && m[1] === m[1]!.toLowerCase();
    if (!tally) found += 1;
  }
  return found;
}
