// The one "does this report entry have a step timeline?" rule (`M137c`, `D462`).
//
// Two consumers ask it — `assets.ts` walks steps and attempts to collect screenshots and snapshots,
// `html.ts`'s `anyStep` asks whether any step in the run matches a predicate — and both used to ask
// it as `if (entry.kind !== 'functional') continue/return false`. That is right today and silently
// wrong the moment `ReportEntry` gains a third member: a new kind that *does* carry steps would be
// skipped by both, and the symptom is an asset that never gets packaged or a `report.html` section
// that never renders, on a **passing** run. Same drift `group-by-file.ts`'s header describes — two
// consumers of one object disagreeing about what it says — so the rule lives in one place.
//
// The point of routing both through here is that the decision has exactly one home. When a third
// kind is declared, `stepBearing` stops compiling and one edit decides the answer for both callers,
// instead of two `!== 'functional'` tests continuing to compile and quietly answering "no".

import { exhaustiveEntry, type AttemptResult, type ReportEntry, type StepResult, type TraceAsset } from '@tflw/runtime';

/** What a caller of `stepBearing` actually wants — a timeline, and the earlier attempts of one where
 *  there were any. Narrower than `TestResult` since `M137c`, and the narrowing is what let the crawl
 *  arm below be a one-line answer: a crawl carries steps and has no `attempts`, because it is not
 *  retryable (`retry` is a `test` clause, and re-running a whole surface is not what it means). */
export interface StepBearing {
  readonly steps: readonly StepResult[];
  readonly attempts?: readonly AttemptResult[];
  /** Optional, and a crawl simply has none — `TraceAsset` is a Playwright archive, and a crawl opens
   *  no browser. Declared here anyway because `assets.ts` reads it off whatever this returns, and the
   *  alternative is that caller narrowing the kind a second time, which is the duplication this file
   *  exists to remove. */
  readonly trace?: TraceAsset;
}

/**
 * The entry's own step timeline, or `null` for a kind that has none.
 *
 * A workload entry has no steps at all, by `D24a`: a load iteration's body executes silently and only
 * aggregate metrics are kept, so there is nothing to walk and nothing to redact — not an omission.
 *
 * `M137c` is this file's reason for existing, arriving: the `crawl` kind carries a real timeline — the
 * sessions it established, a `seed` line per seed, then an `api` step and its assertions per route it
 * reached — so both callers must walk it. Under the two `!== 'functional'` tests this file replaced,
 * they would both have silently answered *no*, and the symptoms would have been a `report.html`
 * section that never renders and an asset that never gets packaged, on a **passing** run.
 */
export function stepBearing(entry: ReportEntry): StepBearing | null {
  switch (entry.kind) {
    case 'functional':
      return entry;
    case 'crawl':
      return entry;
    case 'workload':
      return null;
    default:
      return exhaustiveEntry(entry);
  }
}
