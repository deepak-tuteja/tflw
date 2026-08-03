// The one "which file did this test come from" rule, shared by every artifact that groups by it
// (M65, FS-09 / review finding A13-01). `html.ts` grouped by `test.file` from the day the field
// existed; `junit.ts` imported the same `RunReport` and dropped it, wrapping every test from every
// file in a single `<testsuite name="tflw">`. That is the D24b vertical drift in miniature — two
// consumers of one object disagreeing about what it says — so the rule now lives in one place and
// both read it from here.
//
// Contrast `escape.ts`, which is deliberately *not* shared with `junit.ts`: escaping for HTML and
// escaping for XML 1.0 are different targets that merely look alike. Grouping by file is the same
// question with the same answer in both artifacts, which is exactly when sharing is right.

import type { ReportEntry } from '@tflw/runtime';

/** What a test with no `file` groups under. `TestResult.file` is optional — the interpreter never
 * sets it (one file per `runProgram` call, so it has no reason to know its own path) and the CLI
 * stamps it afterwards, which means every hand-built report and unit-test fixture legitimately
 * arrives without one. Those still need a group; they get this one. */
export const UNGROUPED = '(no file)';

/** The file a report entry came from, or the shared placeholder for one with none. */
export function fileOf(entry: ReportEntry): string {
  return entry.file ?? UNGROUPED;
}

/** Group by file, preserving each file's first-appearance order — already the CLI's per-file run
 * order via `mergeReports`, so no separate sort is needed; a `Map` iterates insertion order. */
export function groupByFile<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const g = groups.get(k);
    if (g) g.push(item);
    else groups.set(k, [item]);
  }
  return groups;
}
