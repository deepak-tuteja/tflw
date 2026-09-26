// What the page can undo about a clause (`M216` `D`, `D1131`-`D1133`).
//
// **The hole this closes was total and it was exactly one level up from where the page was fine.**
// Measured on the live page: **13 clauses can be added and 0 can be removed**, while rows — whole
// declarations, whole requests, whole statements — have carried a `✕` with a refusal since
// `D1117`. Four of the thirteen were the worst of it: `headers`, `body`, `with each` and
// `thresholds` let you delete their contents one at a time and never the clause itself, so a
// `headers` clause could be emptied to nothing and still be there.
//
// ── THE ONE RULE, AND WHY IT IS ONE RULE ───────────────────────────────────────────────────────
//
// **A clause with a per-part `✕` refuses while it has parts, and its last part takes the clause
// with it. A clause with no per-part control is removed from the menu directly.**
//
// The first half is the rule chosen in the grilling — *refuse while it has content, empty it
// first* — and the second half is what that rule needs to be true. `TableEditor` disabled its row
// remove at `rows.length === 1`, so `with each` could never reach empty and, under the first half
// alone, could therefore never be removed at all. The plan wrote the repair as *removing the last
// part removes the clause*; building it found the same deadlock one step over, on every clause
// that has **no** per-part control: refusing `tags` while it holds a tag leaves the only removal
// gesture in the product refusing, with nowhere else for the removal to live.
//
// So the condition is *has somewhere else to do it*, and both halves fall out of it. That is also
// why there is no thirteen-row table defining "empty" per clause anywhere here: `parts` returns a
// count or `null`, and `null` means *this clause is a value, not a container*.
//
// ── WHAT REFUSES, AND WHY REFUSING IS NOT HIDING (`D1133`) ─────────────────────────────────────
//
// `TF033`: a workload-bearing test must carry a threshold. So removing `thresholds` from a test
// that has a `workload` is refused **and says which rule refused it** — `D1117`'s machinery one
// level up from the rows it was built for. A disabled control that does not say why is the pattern
// this round exists to remove; it is pressed, it answers, and the answer is a sentence.
//
// **`workload` USED TO REFUSE HERE AND NO LONGER DOES** — `M224` `B` (`D1205`). The sentence it
// said was *"a workload is the LOAD door's to shape — including removing it. The link on this row
// opens it there."*, and it was true about `D1042` and false about the product: the door it sent
// you to listed all three of `examples/storefront/tests/load.tflw`'s tests as *(already a workload
// test)* with the arming checkbox disabled, and the `+ workload` menu entry drew a row with zero
// controls. A door-granted panel failed in both directions at once, which is `D1044`'s argument by
// demonstration. A workload is a value, not a container, so it has no per-part `✕` and the menu is
// where its removal lives — the second half of the one rule above, unchanged.
import type { HeaderEdit, RequestEdit } from './parts';
import type { OutlineTest } from './outline';

/**
 * How many separately-removable parts a clause has, or `null` when it has none.
 *
 * `null` is the interesting value: it means the clause is a **value** rather than a container, so
 * there is no `✕` anywhere else in the page that could empty it and the menu is the only place its
 * removal can live.
 */
export function bandParts(key: string, v: HeaderEdit, test: OutlineTest): number | null {
  if (key === 'table') return v.tableKind === 'inline' ? v.rows.length : null;
  if (key === 'thresholds') return test.thresholds.length;
  return null;
}

export function requestParts(key: string, v: RequestEdit): number | null {
  if (key === 'headers') return v.headers.length;
  if (key === 'body') return v.bodyKind === 'form' ? v.formFields.length : null;
  return null;
}

/** The sentence a refused removal says, or `null` when it goes through. */
export function bandRefusal(key: string, v: HeaderEdit, test: OutlineTest): string | null {
  // `TF033`. The check is *does this test carry a workload*, not *is this the last threshold*,
  // because a workload-bearing test with no thresholds is the state the rule forbids however it
  // is arrived at.
  if (key === 'thresholds' && test.workload !== null) {
    return 'TF033 — a test that carries a `workload` must carry a threshold, so this one cannot be the last thing removed. Take the workload off first — the row above.';
  }
  const parts = bandParts(key, v, test);
  if (parts !== null && parts > 0) {
    return `empty it first — ${parts} ${key === 'table' ? (parts === 1 ? 'row' : 'rows') : parts === 1 ? 'threshold' : 'thresholds'} still here, and removing the last one takes the clause with it.`;
  }
  return null;
}

export function requestRefusal(key: string, v: RequestEdit): string | null {
  const parts = requestParts(key, v);
  if (parts !== null && parts > 0) {
    return `empty it first — ${parts} ${key === 'headers' ? (parts === 1 ? 'header' : 'headers') : parts === 1 ? 'field' : 'fields'} still here, and removing the last one takes the clause with it.`;
  }
  return null;
}

/**
 * The edit that leaves the clause unwritten.
 *
 * **Empty is the language's own default, never a sentinel.** `retry` goes to `0` because that is
 * what a test with no retry line says (`M141` retracted a census that read `retry 0` as a retry in
 * use), and `redirects` goes to `true` because following them is what happens when nothing is
 * written. A clause is absent from the file when its value is the default, which is why removal
 * here is a patch and not a splice.
 */
export function bandWithout(key: string): Partial<HeaderEdit> {
  switch (key) {
    case 'tags': return { tags: '' };
    case 'sessions': return { sessions: '' };
    case 'retry': return { retry: '0', parallel: false };
    // `D1327` — unskipping is emptying the reason; a blank reason writes no `skip` at all.
    case 'skip': return { skip: '' };
    case 'table': return { tableKind: 'none', tablePath: '', rows: [], columns: [] };
    default: return {};
  }
}

export function requestWithout(key: string): Partial<RequestEdit> {
  switch (key) {
    case 'service': return { service: '' };
    case 'label': return { label: '' };
    case 'timeout': return { timeout: '' };
    case 'redirects': return { redirects: true };
    case 'retryAfter': return { retryAfter: '' };
    case 'headers': return { headers: [] };
    case 'body': return { bodyKind: 'none', bodyText: '', formFields: [] };
    default: return {};
  }
}
