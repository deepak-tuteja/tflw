// A test's past, drawn beside its verdict — `M249` `B` (`D1362`).
//
// The kept runs are read by the server (`GET /api/history`, the reporter's `history.ts`) and joined
// here by the same key `--failed` replays by: the file and the declared name. Nothing is drawn for a
// test with no run before this one, so a first run looks exactly as it did before history existed.
//
// **Dots, oldest on the left.** Read left to right they are what happened, in order, and the newest
// sits beside the verdict it continues. A skip is a hollow dot rather than a gap, because a skipped
// run is a run the test was in.
//
// **The pill says *flaky across runs*, and the badge beside it already said *flaky*.** The two are
// different claims: the badge (`TestResult.flaky`) means a `retry` attempt failed inside this run;
// the pill means the verdict flipped between two kept runs of the same source. Calling both *flaky*
// would make the second look like a duplicate of the first.

import type { HistoryView } from './contract';

type TestPast = HistoryView['tests'][number];
type ThresholdPast = HistoryView['thresholds'][number];

export function testPast(history: HistoryView | null | undefined, file: string | undefined, name: string): TestPast | null {
  return history?.tests.find((t) => t.file === (file ?? '') && t.name === name) ?? null;
}

export function thresholdPast(history: HistoryView | null | undefined, file: string | undefined, test: string, threshold: string): ThresholdPast | null {
  return history?.thresholds.find((t) => t.file === (file ?? '') && t.test === test && t.threshold === threshold) ?? null;
}

export function HistoryDots({ past }: { past: TestPast | null }) {
  if (!past || past.verdicts.length < 2) return null;
  const oldestFirst = [...past.verdicts].reverse();
  const tip = `${past.failures} of the last ${past.verdicts.length} kept runs failed${past.flaky ? ' — the verdict changed with no change to the file' : ''}`;
  return (
    <span className="history" data-history={oldestFirst.join(',')} data-tip={tip} aria-label={tip}>
      {oldestFirst.map((v, i) => (
        <span key={i} className={`hdot ${v}`} />
      ))}
      {past.flaky ? (
        <span className="badge warn" data-history-flaky>
          flaky across runs
        </span>
      ) : null}
    </span>
  );
}

/** One threshold's last values as a sparkline, oldest on the left; a run that measured nothing
 * (`null`) is a break in the line, not a zero. */
export function Sparkline({ past }: { past: ThresholdPast | null }) {
  if (!past || past.values.length < 2) return null;
  const values = [...past.values].reverse();
  const measured = values.filter((v): v is number => v !== null);
  if (measured.length === 0) return null;
  const lo = Math.min(...measured);
  const hi = Math.max(...measured);
  const w = 60;
  const h = 14;
  const x = (i: number): number => (values.length === 1 ? w / 2 : (i / (values.length - 1)) * w);
  const y = (v: number): number => (hi === lo ? h / 2 : h - ((v - lo) / (hi - lo)) * h);
  const segments: string[] = [];
  let current = '';
  values.forEach((v, i) => {
    if (v === null) {
      if (current) segments.push(current);
      current = '';
      return;
    }
    current += `${current ? ' L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
  });
  if (current) segments.push(current);
  return (
    <svg className="sparkline" width={w} height={h} viewBox={`0 -1 ${w} ${h + 2}`} data-sparkline={values.map((v) => (v === null ? '' : String(v))).join(',')} aria-label={`the last ${values.length} kept runs`}>
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth="1.2" />
      ))}
    </svg>
  );
}
