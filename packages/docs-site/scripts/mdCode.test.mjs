// `M144-03` — the four generated reference pages build their tables through one helper, and until
// now nothing asserted what any cell of them renders to.
//
// ## Why this file and not a render test
//
// The row named the cheapest honest shape itself: unit-test `code()` directly. `vitepress build`
// already SSRs every page, so an import error or a syntax error is caught; `diagnostics-page.test.mjs`
// already catches the diagnostics table ceasing to *derive* itself. The one unguarded link is what
// the helper turns a manifest string into — a pure function of a string, which needs no renderer.
//
// The stakes are on record: `M110b-01` was wrong on 13 of 41 diagnostics rows and was found by a
// human reading output, not by a check. So the cases here are not invented. Two reconstruct that
// bug's exact shape, and the last one runs the **live manifest** through the helper, which is the
// only case that grows as the manifest does.
//
// ## What the live-manifest case found
//
// `M147-12`, immediately: every consumer is `<td v-html="code(…)"/>`, and 78 manifest values carry
// a `<`. `--env <name>` became `<code>--env <name></code>`, the browser opened an element nobody
// closed, and the argument rendered as nothing. That is the entire CLI reference page's content
// shape. The escaping assertions below are the ones that would have caught it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { code } from '../.vitepress/mdCode.ts';
import { DIAGNOSTICS, MATCHERS, GENERATORS, CLI_FLAGS } from '@tflw/lang';

// ---- 1. the two fences -------------------------------------------------------------------------

test('a single-fenced span becomes one <code>', () => {
  assert.equal(code('use `expect` here'), 'use <code>expect</code> here');
});

test('a doubled fence keeps its inner backticks in ONE span (`M110b-01`)', () => {
  // The bug verbatim. A single-fence-only regex read this as two spans starting one character in
  // and produced `<code> did you mean </code>expect<code>? </code>` with a stray backtick either
  // side — wrong on 13 of 41 rows before anybody noticed.
  assert.equal(code('``did you mean `expect`?``'), '<code>did you mean `expect`?</code>');
});

test('the alternation order is load-bearing, and this is the control that says so', () => {
  // If `` ` `` were tried before `` `` ``, this would split into two spans. Asserting the doubled
  // case alone would not catch that: it would still produce *a* span, just the wrong one.
  const out = code('``a `b` c``');
  assert.equal(out.match(/<code>/g).length, 1, out);
});

test('several spans in one cell are all wrapped, and the text between them survives', () => {
  assert.equal(code('`a` then `b`'), '<code>a</code> then <code>b</code>');
});

test('a cell with no span is returned unchanged', () => {
  assert.equal(code('no code here'), 'no code here');
});

// ---- 2. the output is innerHTML (`M147-12`) -----------------------------------------------------

test('a placeholder is escaped, not emitted as a tag', () => {
  // The failure this closes: `<name>` opened an unknown element and the reader saw `--env `.
  assert.equal(code('`--env <name>`'), '<code>--env &lt;name&gt;</code>');
});

test('escaping happens before the fence pass, so the <code> tags themselves stay real', () => {
  const out = code('`a < b`');
  assert.ok(out.startsWith('<code>') && out.endsWith('</code>'), out);
  assert.equal(out, '<code>a &lt; b</code>');
});

test('an ampersand is escaped first, so an escape is never double-escaped', () => {
  // Order matters: `<` → `&lt;` after `&` → `&amp;`, or the `&` of `&lt;` gets escaped in turn and
  // the reader sees the literal text `&lt;`.
  assert.equal(code('a & b'), 'a &amp; b');
  assert.equal(code('a &lt; b'), 'a &amp;lt; b');
});

test('text outside a span is escaped too — v-html does not care where the < came from', () => {
  assert.equal(code('see <url> below'), 'see &lt;url&gt; below');
});

// ---- 3. the live manifest ----------------------------------------------------------------------

/** Every string the four reference pages actually pass to `code()`, with where it came from. Only
 *  these — `STEP_KEYWORDS` carries placeholders too, but no generated reference page renders it
 *  through this helper, and a case over values nothing passes in would be its own kind of vacuous. */
const rendered = [
  ...DIAGNOSTICS.flatMap((d) => [
    [`DIAGNOSTICS ${d.code} meaning`, d.meaning],
    [`DIAGNOSTICS ${d.code} example`, d.example],
  ]),
  ...MATCHERS.flatMap((m) => [
    [`MATCHERS ${m.id} syntax`, m.syntax],
    [`MATCHERS ${m.id} appliesTo`, m.appliesTo],
    [`MATCHERS ${m.id} example`, m.example],
  ]),
  ...GENERATORS.flatMap((g) => [
    [`GENERATORS ${g.id} syntax`, g.syntax],
    [`GENERATORS ${g.id} notes`, g.notes],
    [`GENERATORS ${g.id} example`, g.example],
  ]),
  ...CLI_FLAGS.flatMap((f) => [
    [`CLI_FLAGS ${f.flag} flag`, f.flag],
    [`CLI_FLAGS ${f.flag} effect`, f.effect],
  ]),
].filter(([, v]) => typeof v === 'string');

test('the manifest is actually being read — this case is worthless against an empty list', () => {
  // Rename a field or a manifest export and the flatMaps above yield nothing; every assertion below
  // would then pass over zero values. `M141`'s Order-1 subject, so it is asserted, not assumed.
  assert.ok(rendered.length > 200, `only ${rendered.length} manifest values reached the helper`);
});

test('no manifest value carries markup or an entity of its own', () => {
  // The premise escaping rests on. If a cell ever legitimately wanted a `<br>` this would fail
  // here rather than silently render the tag as text three pages away.
  for (const [where, v] of rendered) {
    assert.doesNotMatch(v, /<\/?(?:a|b|i|br|code|em|strong|span|p|div)\b/i, `${where}: ${v}`);
    assert.doesNotMatch(v, /&(?:[a-z]+|#\d+);/i, `${where}: ${v}`);
  }
});

test('every rendered manifest value survives the helper with balanced tags and no raw <', () => {
  // The one case that grows with the manifest. It is what would have caught both `M110b-01` (a
  // stray backtick escaping its span) and `M147-12` (a placeholder escaping as a tag).
  for (const [where, v] of rendered) {
    const out = code(v);
    const opens = (out.match(/<code>/g) ?? []).length;
    const closes = (out.match(/<\/code>/g) ?? []).length;
    assert.equal(opens, closes, `${where}: unbalanced <code> in ${out}`);
    // Strip the tags this helper is allowed to emit; nothing angular may remain, inside a span or
    // outside one, since escaping runs before the fence pass.
    const bare = out.replaceAll('<code>', '').replaceAll('</code>', '');
    assert.doesNotMatch(bare, /[<>]/, `${where}: unescaped angle bracket in ${out}`);
    // Backticks are checked only OUTSIDE a span. A doubled fence keeps its inner backticks on
    // purpose — that is what it is for, and the unit case above pins it — so a blanket "no backtick
    // survives" would contradict this file's own second test. It did: `TF001`'s meaning carries
    // ``unexpected `e3` at end of step``, correctly rendered, and the first draft of this line
    // failed on it. What a *stray* backtick means is a fence that lost its partner, which can only
    // show up in the text between spans.
    const betweenSpans = out.replace(/<code>[\s\S]*?<\/code>/g, '');
    assert.doesNotMatch(betweenSpans, /`/, `${where}: a fence lost its partner in ${out}`);
  }
});

test('the placeholders are still legible after escaping, not merely absent', () => {
  // A fix that deleted the angle brackets would pass every assertion above. This is the one that
  // says the reader can still see what to type.
  const envFlag = CLI_FLAGS.find((f) => f.flag.includes('--env'));
  assert.ok(envFlag, 'the CLI manifest no longer has an --env flag; re-point this case');
  assert.match(code(envFlag.flag), /&lt;name&gt;/);
});
