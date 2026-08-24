// The bare-citation gate, run against prose whose defects are known (`M152b`, `D691`).
//
// Every case here is a real line from the corpus, or a minimal reconstruction of one, because the
// gate's whole difficulty is telling four things apart that share the same characters: a citation,
// a quotation of a citation, an address, and somebody else's numbering. A synthetic fixture would
// have exercised none of that — the shapes that fool it are the ones that actually occur.
//
// The two easiest ways to be accidentally green are pinned first: `clean()` asserts the gate stays
// quiet on prose with no bare citation (a gate that always complains proves nothing), and each
// exemption is tested in a *pair* — the exempt form and the near-identical non-exempt form — so an
// exemption that swallowed the real defect too would fail here rather than pass silently.

import test from 'node:test';
import assert from 'node:assert/strict';
import { findBare } from './verify-citations.mjs';

/** One file's worth of prose, as the gate takes it. */
const scan = (text, path = 'SPEC.md') => findBare([{ path, text }]);
const phrases = (text, path) => scan(text, path).map((f) => f.phrase);

test('a clean file produces nothing', () => {
  assert.deepEqual(phrases('Frozen additive-only since the first release (`P#45`), see `D122`.'), []);
});

test('the old spelling is caught in each of its forms', () => {
  assert.deepEqual(phrases('per decision 45, decisions 74-83, Decision 7 and design decision 12'),
    ['decision 45', 'decisions 74', 'Decision 7', 'design decision 12']);
});

test('a phrase carrying several targets is one finding, not four', () => {
  // `CHANGELOG.md:100` — `decisions 93–96, 103`. One sentence, read once, rewritten once. Counting
  // it four times would make the gate's output an argument about arithmetic instead of a worklist.
  assert.equal(scan('in one pass, in file declaration order (decisions 93–96, 103).').length, 1);
});

test('a citation that names its own record is exempt, and one that names a nearby file is not', () => {
  // The pair that matters. `D692` measured this classifier three ways and got 90, 96 and 104,
  // because a character window trusts any filename near the citation — including
  // `DECISIONS.md:561`'s `packages/cli/README.md` (installed-package view, per decision 49)`,
  // where the file named has nothing to do with the sequence cited. So the test is not "is a
  // filename close by" but "is the file named a design record".
  assert.deepEqual(phrases('see `PLAN_ENTERPRISE.md` decisions 1-3 for the cluster'), []);
  assert.deepEqual(phrases('**Static-checker scope (M2.65, PLAN decision 57):** the checker'), []);
  assert.deepEqual(phrases('`packages/cli/README.md` (installed-package view, per decision 49)'),
    ['decision 49']);
});

test('a product fence is exempt and an EBNF comment is not', () => {
  // `D691` clause 2 first read *fence contents*, which exempts ten real defects — eight of them
  // `GRAMMAR.md` EBNF comments, which are authored prose addressed to a reader rather than a
  // quotation of tflw's own output. The generator learned this first; its note on
  // `PRODUCT_FENCE_INFO` records that a blanket fence exclusion would have dropped 99 citations
  // silently, in the milestone whose subject is citations nobody can follow.
  assert.deepEqual(phrases('```console\n# emitted by tflw (decision 94)\n```'), []);
  assert.deepEqual(phrases("```\n'body' 'text'   # raw response body (§5.3, decision 51)\n```"),
    ['decision 51']);
});

test('a `<script setup>` block is exempt', () => {
  // `packages/docs-site/editor.md:7`. Never rendered, addressed to a maintainer — the same reason
  // `§6` keeps source comments out of the milestone entirely.
  assert.deepEqual(phrases('<script setup>\n// not staged: genuinely live (decision 107).\n</script>'), []);
  assert.deepEqual(phrases('<script setup>\n</script>\n\nGenuinely live (decision 107).'),
    ['decision 107']);
});

test('a link target is exempt — the exemption two of this milestone\'s gates need', () => {
  // `D691` clause 4. `M152d`'s prohibition would flag this fragment; `M152c`'s anchor gate requires
  // it to resolve. The fragment wins: it is an address, and no reader reads it as a citation.
  assert.deepEqual(phrases('[the spec](../SPEC.md#45-load-testing-decision-16-d122)'), []);
  assert.deepEqual(phrases('The spec covers it (decision 16).'), ['decision 16']);
});

test('a quotation of the notation is exempt, and a use of it is not', () => {
  // The preamble's own glossary row teaches the spelling this gate objects to. Flagging it would be
  // the gate objecting to its own documentation; rewriting it would delete the glossary.
  assert.deepEqual(phrases('| `decision 43`, `#43` | `P#43` — the founding list |', 'DECISIONS.md'), []);
  assert.deepEqual(phrases('The gate re-scoped it (decision 43).', 'DECISIONS.md'), ['decision 43']);
});

test('the founding list in its oldest spelling is caught', () => {
  assert.deepEqual(phrases('**Stability promise at publish (amends #38).** The shipped API'), ['#38']);
});

test('another namespace\'s `#n` is not', () => {
  // Four numberings share the shape. A rewrite of any of these would make a true sentence false.
  assert.deepEqual(phrases('closes `TFLW-GAPS.md` gap #9'), []);
  assert.deepEqual(phrases('That is OWASP API #1 — broken object-level authorization'), []);
  assert.deepEqual(phrases('needs the UTS #39 confusables table'), []);
});

test('an enumeration inherits the namespace its first member establishes', () => {
  // Only the first member of `PRs #12–#18` and `gaps #5 and #6` carries the keyword.
  assert.deepEqual(phrases('`0fea867` merged PRs #12–#18. The next CI run'), []);
  assert.deepEqual(phrases('closes TFLW-GAPS.md gaps #5 and #6. `expect body matches schema`'), []);
});

test('a paragraph establishes a number\'s namespace once', () => {
  // `DECISIONS.md:5336`/`:5339` — `pushed as tflw PR #97` three lines above `merged before #97`.
  assert.deepEqual(phrases('`M147e` pushed as tflw PR #97 and went red.\nIt landed on `main`, merged before #97.'), []);
  // …and the establishment does not leak past the paragraph break.
  assert.deepEqual(phrases('`M147e` pushed as tflw PR #97.\n\nThe gate re-scoped it (amends #97).'), ['#97']);
});

test('the report names a file, a line and the sentence it was read from', () => {
  // A worklist a person can work from without re-deriving the search (`D686`: provenance names
  // files). A count alone would make the gate a scoreboard rather than an instrument.
  const [f] = scan('gated on the pen-test arc plus one final acceptance pass (decision 112).', 'CHANGELOG.md');
  assert.equal(f.file, 'CHANGELOG.md');
  assert.equal(f.line, 1);
  assert.equal(f.phrase, 'decision 112');
  assert.match(f.excerpt, /final acceptance pass \(decision 112\)/);
});

test('a citation whose sentence wraps is read with the line above it', () => {
  // These records are hard-wrapped near 100 columns, so the word that says which sequence a
  // citation belongs to lands on the previous line often enough to matter. Reading only the
  // current line makes a wrap look bare and asks for a rewrite that would be wrong.
  assert.deepEqual(phrases('closes `TFLW-GAPS.md` gaps\n#6 and #5 — the fixed cadence'), []);
  assert.deepEqual(phrases('expressible without a workaround (PLAN\ndecision 95, closes gap #4)'), []);
  // …and the tail does not launder a citation the sentence above has nothing to do with.
  assert.deepEqual(phrases('The arc is described in PLAN.md.\n\nThe gate re-scoped it (decision 43).'),
    ['decision 43']);
});

test('the wrapped tail does not flip code-span parity', () => {
  // The bug this pins was live for one commit and it was SILENT: the tail is sliced at a fixed
  // width, so a slice landing inside a code span leaves an odd number of backticks in front of the
  // citation, and the inline-code exemption then swallowed two real citations. Nothing reported
  // them — the gate simply went green early. Code spans cannot cross a line, so the exemption reads
  // the current line and never the joined one.
  const wrapped = 'optional, dynamic-imported at first `unclosed-by-the-slice\n' +
    '  browser step, installed via `tflw install-browsers` (decision 44 unchanged).';
  assert.deepEqual(phrases(wrapped), ['decision 44']);
});

test('`enterprise decision N` names its sequence', () => {
  // The idiom the records have used since `PLAN_ENTERPRISE.md` was written — and the one place
  // where saying *which* list is doing all the work, since four of the eleven citations at or below
  // 22 mean that list and the founding item of the same number is about something else entirely.
  assert.deepEqual(phrases('Per-`env` `cert` (enterprise decision 3b) lands here'), []);
  assert.deepEqual(phrases('Per-`env` `cert` (decision 3b) lands here'), ['decision 3b']);
});

test('a citation broken BY the wrap is still a citation', () => {
  // The inverse of the case above, and the one that hid longest: the phrase itself straddles the
  // line break. Ten exist in the corpus and matching line by line saw none of them — including
  // `P#82`'s, which sits one line under the sentence that cites `P#36` correctly, so the entry
  // carried both the repaired spelling and the unrepaired one.
  assert.deepEqual(phrases('scaffolds secrets hygiene (restores P#36).** Decision\n    36 promised `.env.example`'),
    ['Decision 36']);
  // The line below reports its own matches, so the pair is not counted twice.
  assert.equal(scan('a run honours decision\n    80 here, and decision 81 there.').length, 2);
});
