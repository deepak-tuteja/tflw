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

import { exhaustiveEntry, type ReportEntry, type TestResult } from '@tflw/runtime';

/**
 * The entry's own step timeline, or `null` for a kind that has none.
 *
 * A workload entry has no steps at all, by `D24a`: a load iteration's body executes silently and only
 * aggregate metrics are kept, so there is nothing to walk and nothing to redact — not an omission.
 */
export function stepBearing(entry: ReportEntry): TestResult | null {
  switch (entry.kind) {
    case 'functional':
      return entry;
    case 'workload':
      return null;
    default:
      return exhaustiveEntry(entry);
  }
}
