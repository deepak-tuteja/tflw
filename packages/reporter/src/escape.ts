// The one HTML escape used by everything that writes report.html (M63, review finding A13-02).
// `html.ts` and `load-charts.ts` each carried a byte-identical private copy; the risk in that
// isn't today's behaviour, it's the day one copy gains a character class and the other doesn't —
// and the two of them interleave in the same document, `load-charts.ts`'s SVG being inlined into
// `html.ts`'s page. A gap in either is a gap in the whole file.
//
// Deliberately *not* shared with `junit.ts`'s same-named function: that one escapes for XML 1.0,
// which is a different target — it strips control characters the spec forbids outright and leaves
// `'` alone (legal in XML attribute values quoted with `"`). Merging them would mean one of the
// two silently doing the other's job. Separate targets, separate functions, one implementation
// each.

/** Escapes the five characters that can break out of HTML text or an attribute value. Applied at
 * every interpolation of report-derived text — a response body, a test name, a failure message. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
