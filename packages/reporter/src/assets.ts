// Resolves a `RunReport`'s screenshot/trace assets into what actually gets written to disk vs.
// stays inlined in `report.html` (M3c, D12: "report/ = report.html + assets/. Base64 inlining
// retained only under a configurable byte budget, so API-only runs stay single-file"). Pure — no
// I/O here; `writeReport` (index.ts) is the one place that actually writes `files` to disk.
//
// Screenshots under `inlineBudgetBytes` stay out of `hrefs` entirely — `renderReportHtml` treats
// "not in the map" as "inline it as a data: URI" (html.ts), so a suite with no screenshots (or
// only small ones) never gets an `assets/` directory at all, keeping today's single-file UX intact
// for API-only runs. Playwright traces are always external (never inlined — they're multi-hundred-
// KB binary zips, not meaningfully embeddable) and a run that captured none writes no `assets/`
// either.
//
// Assets are keyed by content hash (sha1 of the base64), not position in the report — two byte-
// identical screenshots (e.g. the same "still on the login page" failure shot from two different
// failing steps) dedupe into one file for free, and `renderReportHtml` never needs to coordinate
// IDs with this module beyond hashing the same bytes the same way.

import { createHash } from 'node:crypto';
import type { RunReport, StepResult } from '@tflw/runtime';
import { stepBearing } from './entry-kind.js';

/** Screenshots (PNG) larger than this inline as a plain `data:` URI in `report.html`; at/above it
 * they're written to `assets/screenshots/<hash>.png` and linked by relative path instead. Traces
 * are always written externally regardless of size (see module doc). */
export const DEFAULT_INLINE_BUDGET_BYTES = 300 * 1024;

export interface ReportAssetFile {
  /** Relative to the report directory, e.g. `assets/screenshots/ab12…f0.png`. */
  readonly relPath: string;
  readonly base64: string;
}

export interface ResolvedReportAssets {
  /** content-hash → href, for every asset that did *not* stay inlined. `renderReportHtml` looks an
   * asset's base64 up here (by the same hash) to decide inline-vs-linked; a screenshot missing from
   * this map is rendered as a `data:` URI directly instead. */
  readonly hrefs: ReadonlyMap<string, string>;
  readonly files: readonly ReportAssetFile[];
}

function assetHash(base64: string): string {
  return createHash('sha1').update(base64).digest('hex').slice(0, 16);
}

function byteLength(base64: string): number {
  // Exact decoded size without materializing the buffer twice — same formula `Buffer.from(...).length`
  // would give, computed straight from the base64 string's own length/padding.
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function resolveReportAssets(report: RunReport, inlineBudgetBytes: number = DEFAULT_INLINE_BUDGET_BYTES): ResolvedReportAssets {
  const hrefs = new Map<string, string>();
  const files: ReportAssetFile[] = [];
  const seen = new Set<string>(); // dedupe by hash — identical bytes write once

  const addScreenshot = (base64: string): void => {
    if (byteLength(base64) < inlineBudgetBytes) return; // stays inline — html.ts embeds it directly
    const hash = assetHash(base64);
    if (seen.has(hash)) return;
    seen.add(hash);
    const relPath = `assets/screenshots/${hash}.png`;
    hrefs.set(hash, relPath);
    files.push({ relPath, base64 });
  };

  const addTrace = (base64: string): void => {
    const hash = assetHash(base64);
    if (seen.has(hash)) return;
    seen.add(hash);
    const relPath = `assets/traces/${hash}.zip`;
    hrefs.set(hash, relPath);
    files.push({ relPath, base64 });
  };

  // A `matches snapshot` step's baseline/actual/diff (M4b, D15) are each just another PNG — reused
  // through the exact same `addScreenshot` inline-budget/dedup logic, not a parallel asset kind.
  const addSnapshotStep = (step: StepResult): void => {
    if (!step.snapshotDiff) return;
    if (step.snapshotDiff.baseline) addScreenshot(step.snapshotDiff.baseline);
    addScreenshot(step.snapshotDiff.actual);
    if (step.snapshotDiff.diff) addScreenshot(step.snapshotDiff.diff);
  };

  // M56 (Phase 3) — a workload entry has no steps/trace/attempts at all (D24a: a load iteration's
  // body runs silently) — nothing here to walk for it, same as a `TestResult` that never captured
  // a screenshot/trace to begin with.
  for (const entry of report.tests) {
    const test = stepBearing(entry);
    if (!test) continue;
    for (const step of test.steps) {
      if (step.screenshot) addScreenshot(step.screenshot.base64);
      addSnapshotStep(step);
    }
    if (test.trace) addTrace(test.trace.base64);
    for (const attempt of test.attempts ?? []) {
      for (const step of attempt.steps) {
        if (step.screenshot) addScreenshot(step.screenshot.base64);
        addSnapshotStep(step);
      }
      if (attempt.trace) addTrace(attempt.trace.base64);
    }
  }

  return { hrefs, files };
}

/** Shared by `html.ts` and `resolveReportAssets` so both hash the same bytes the same way. */
export { assetHash };
