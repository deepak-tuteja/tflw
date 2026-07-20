// Shared client-side analysis for the Editor page's live demo widgets (decision 107). Every
// widget needs the same starting point — parse + symbol table + diagnostics — so it's computed
// once here rather than repeated per widget. Pure, no I/O: same `@tflw/lang` surface
// `playground/Playground.vue` already proves bundles fine for the browser.
import { parseSource, collectSymbols, checkUnknownVariables } from '@tflw/lang';

export function analyze(source) {
  const parsed = parseSource(source);
  const symbols = collectSymbols(parsed.program, source);
  const diagnostics = [...parsed.diagnostics, ...checkUnknownVariables(parsed.program)];
  return { program: parsed.program, symbols, diagnostics };
}

/**
 * Turn `source` + a list of `{ start, end, ...meta }` 0-based offset ranges (non-overlapping, not
 * necessarily contiguous or sorted) into an ordered array of `{ text, range? }` chunks a template
 * can `v-for` over as `<span>`s — plain-text gaps between ranges come back with no `range`.
 */
export function splitAtSpans(source, ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const chunks = [];
  let pos = 0;
  for (const range of sorted) {
    if (range.start > pos) chunks.push({ text: source.slice(pos, range.start) });
    chunks.push({ text: source.slice(range.start, range.end), range });
    pos = range.end;
  }
  if (pos < source.length) chunks.push({ text: source.slice(pos) });
  return chunks;
}
