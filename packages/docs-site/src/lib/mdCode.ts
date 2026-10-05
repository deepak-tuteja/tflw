// The docs-site's one inline-markdown → HTML helper, shared by every reference page that renders a
// `spec-data.ts` manifest, and by the page title.
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
// ## The output is HTML, so the input has to be escaped
//
// `M147f` (`M147-12`), found by writing `M144-03`'s test. Every consumer was
// `<td v-html="code(…)"/>` on VitePress, and splices the same HTML string into the page now — so any
// `<` in a manifest string is markup, not text. **78 values across all four pages carry one**, and they are not decoration: they are the placeholders that say what the
// reader is supposed to type. `--env <name>` reached the page as `<code>--env <name></code>`, the
// browser opened a `<name>` element nobody closed, and the flag's argument rendered as nothing at
// all. The whole CLI reference is `--flag <arg>` rows.
//
// Escaping happens **before** the fence pass, never after, so the only markup in the result is the
// `<code>` this function emits. Backticks are untouched by escaping, so the alternation below reads
// exactly the same string it always did. No manifest value contains an intentional tag or entity —
// checked, and asserted in `mdCode.test.mjs` so that stays true.
const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ## Strong and emphasis too (`M270`, `D-M270-7`)
//
// The manifests write `**strong**` (50 values) and `*emphasis*` (12) as well as code, and until
// `M270` this function rendered code alone, so 101 raw `**` reached the diagnostics and CLI pages.
// Those three constructs are the whole of the markdown the manifests use, measured; a gate in
// `mdCode.test.mjs` fails on anything else markdown-like that survives, so a fourth construct is a
// decision rather than a leak.
//
// Code spans are set aside first and put back last. Strong regularly wraps code
// (``**`import` and `use` are an error**``), and a star inside a code span is the language's, not
// emphasis. A star is only a delimiter where CommonMark would read it as one: the opening star is
// followed by a non-space and the closing one preceded by one, so `3 * 4` stays literal.
//
// ## What still is not covered
//
// `M110b-02` filed the no-renderer-test gap alongside the duplication and `M144-03` tracked it.
// `M144-03` is closed by unit-testing this function directly, over the doubled-fence and
// inner-backtick cases and over every live manifest value — which is where the risk actually is and
// needs no renderer.
const HELD = '\uE000';
export const inline = (s: string): string => {
  const spans: string[] = [];
  const held = escapeHtml(s).replace(/``\s?([\s\S]+?)\s?``|`([^`]+)`/g, (_, doubled, single) => {
    spans.push(`<code>${doubled ?? single}</code>`);
    return `${HELD}${spans.length - 1}${HELD}`;
  });
  return held
    .replace(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<![\w*])\*(?=[^\s*])([^*]+?)(?<=[^\s*])\*(?![\w*])/g, '<em>$1</em>')
    .replace(new RegExp(`${HELD}(\\d+)${HELD}`, 'g'), (_, i) => spans[Number(i)]);
};
