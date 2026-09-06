/**
 * The `ReportEntry` member a case is about, asserted and narrowed in one step (`M173c`, `D902`).
 *
 * `ReportEntry` is `TestResult | WorkloadTestResult | CrawlResult`, and `src` has carried the
 * discipline for it the whole time — `exhaustiveEntry`, `stepBearing`, and a whole
 * `packages/reporter/src/entry-kind.ts` whose job is narrowing an entry before reading it. The tests
 * bypassed it 324 times, because `tsx` strips types without checking them and nothing read these
 * files (`M155-01`).
 *
 * WHY NOT `stepBearing`, WHICH ALREADY EXISTS. Measured before choosing: the 324 are `steps` 161,
 * `error` 139, `attempts` 11, `trace` 7, `flaky` 6. `StepBearing` carries `steps`, `attempts?` and
 * `trace?` and **not** `error` — deliberately, since it is "what a caller of `stepBearing` actually
 * wants". So reusing it reaches 179 of 324 and the other 145 need a second mechanism anyway. The
 * slogan "one discipline across `src` and `test`" was never available at this corpus.
 *
 * Widening `StepBearing` to carry `error` would have made it ~318 and is refused: that type exists
 * to stop callers narrowing twice, and reshaping a shipped `src` type so test files can read a field
 * is the wrong way round. `error` is on `TestResult` and on `CrawlResult` both — it is not missing
 * from the union, only from a projection built for another purpose.
 *
 * So this is a sibling of `entry-kind.ts` rather than the same code, and the two can drift. What
 * limits the drift is that both derive from the same union: a fourth member breaks `stepBearing`'s
 * `default` arm at compile time, and `Extract<>` simply stops matching.
 *
 * It says more than the reads it replaces. `report.tests[0]!.steps` asserted nothing about which
 * kind of entry it expected; `asEntry(report.tests[0]!, 'functional').steps` says it, and fails with
 * the kind it actually got rather than with `undefined`.
 */
import assert from 'node:assert/strict';
import type { ReportEntry } from '../../src/types.js';

export function asEntry<K extends ReportEntry['kind']>(entry: ReportEntry | undefined, kind: K): Extract<ReportEntry, { kind: K }> {
  assert.ok(entry, `expected a ${kind} entry, got none — the report has no entry at that index`);
  assert.equal(entry.kind, kind, `expected a ${kind} entry, got ${entry.kind}`);
  return entry as Extract<ReportEntry, { kind: K }>;
}

/** The single entry a one-test report must have, narrowed. The commonest shape in this suite. */
export function onlyEntry<K extends ReportEntry['kind']>(entries: readonly ReportEntry[], kind: K): Extract<ReportEntry, { kind: K }> {
  assert.equal(entries.length, 1, `expected exactly one entry, got ${entries.length}`);
  return asEntry(entries[0], kind);
}
