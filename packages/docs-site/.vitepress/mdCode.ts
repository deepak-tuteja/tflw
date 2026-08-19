// The docs-site's one markdown-inline-code → `<code>` helper, shared by every reference page that
// renders a `spec-data.ts` manifest into a plain HTML table.
//
// ## Why it is a module and not a line in each page
//
// It lived as **four byte-identical copies** — `reference/cli.md`, `generators.md`, `matchers.md`,
// `diagnostics.md` — until `M144b` (`M110b-02`). That was not a hypothetical cost: `M110b-01` was
// one bug that had to be fixed four times, and three of those four were fixing something that had
// not yet gone wrong on that page. Nothing held the copies in step, so the next divergence would
// have been silent.
//
// ## Both markdown fences, and the doubled one first
//
// A cell whose code span contains a backtick of its own is fenced ``like this``, which markdown
// reads as one span with literal inner backticks. The single-fence-only regex this replaced read it
// as *two* spans starting one character in, so ``did you mean `expect`?`` rendered as
// "<code> did you mean </code>expect<code>? </code>" with a stray backtick either side. That was
// already wrong on 13 of the 41 diagnostics rows before `M110b`, which generated the cells from
// probes and took it to 35 — a pre-existing bug found only because something downstream started
// leaning on it harder. The alternation order is load-bearing: `` `` `` must be tried before `` ` ``.
//
// ## What still is not covered
//
// **Nothing renders these pages in a test.** `M110b-02` filed that gap alongside the duplication;
// extracting the helper closes the duplication half only, and the renderer test is tracked as
// `M144-03`. What this module buys is that the next fix is one edit instead of four — not that a
// wrong edit would be caught.
export const code = (s: string): string =>
  s.replace(/``\s?([\s\S]+?)\s?``|`([^`]+)`/g, (_, doubled, single) => `<code>${doubled ?? single}</code>`);
