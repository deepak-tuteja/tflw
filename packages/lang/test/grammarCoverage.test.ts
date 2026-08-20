// M78 (cluster C13, `V4-08` ≡ `A2-OS-01`) — the guard behind GRAMMAR.md's own currency rule.
//
// GRAMMAR.md states: "every milestone that changes the grammar updates this file alongside
// SPEC.md, required going forward". Nothing enforced it. The whole workload grammar (M29-M53)
// shipped without a single production here, and the file stayed silent about it for seven
// milestones while `packages/docs-site/grammar.md` @included it as the public /grammar reference —
// the same class of defect M62's guard closed for the docs site, still open for the grammar.
//
// This test closes it mechanically. Every keyword the parser recognizes — the literal it passes to
// `isKw`/`expectKw`/`matchKw` — must appear somewhere in GRAMMAR.md. It is a coverage floor, not a
// correctness proof: it cannot tell a right production from a wrong one, only a *written* one from
// a missing one. That is precisely the failure mode that actually occurred.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { REFUSED_SPELLINGS } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const parserSource = readFileSync(join(here, '../src/parser.ts'), 'utf8');
const grammar = readFileSync(join(here, '../GRAMMAR.md'), 'utf8');

/** Every keyword literal the parser tests a token against. */
function parserKeywords(): string[] {
  const found = new Set<string>();
  // `M147b` — the refused words moved out of inline `isKw` calls and into `REFUSED_WORDS`, so the
  // regex below no longer reaches them. Read from the table instead of narrowing the corpus in
  // silence: `tests` dropping out of this set is exactly how `EXEMPT` would have gone stale while
  // the honesty test below kept passing.
  for (const word of REFUSED_SPELLINGS) found.add(word);
  // `this.isKw(tok, 'ramp')`, `this.expectKw('users')`, `this.matchKw('for')`
  for (const m of parserSource.matchAll(/\b(?:isKw\([^,]+,\s*|expectKw\(|matchKw\()'([a-z][a-z0-9]*)'/g)) {
    found.add(m[1]!);
  }
  return [...found].sort();
}

/** Keywords deliberately absent from GRAMMAR.md, each with the reason it is not a gap. */
const EXEMPT = new Map<string, string>([
  // Removed keywords the parser still recognizes only to emit a "renamed/removed" diagnostic.
  // Documenting them as productions would re-assert a grammar that no longer exists (D103). Their
  // errors are covered by SPEC §17's TF033 entry instead.
  ['scenario', 'removed in D103 — recognized only to raise TF033 naming `test`'],
  // `M147b` widened the corpus: `think` and `uncheck` were matched by dedicated `case` arms rather
  // than `isKw`, so the regex above never reached them and this list never had to account for them.
  // `REFUSED_WORDS` names all four, so all four are now asked the question — and the answer for
  // these two is the same as `scenario`'s, which is why the widening cost two lines and no thought.
  ['think', 'FS-05 — renamed to `pause`; recognized only to raise the migration diagnostic'],
  ['uncheck', 'FS-04 — renamed to `untick`; same'],
  // Not grammar at all: `tests` exists solely so a top-level `tests "…"` typo can say
  // "did you mean `test`?". There is nothing to write a production for.
  ['tests', 'not a construct — only a did-you-mean hint for a mistyped `test`'],
]);

test('every parser keyword appears in GRAMMAR.md', () => {
  const missing = parserKeywords().filter((kw) => !EXEMPT.has(kw) && !grammar.includes(`'${kw}'`));
  assert.deepEqual(
    missing,
    [],
    `GRAMMAR.md has no production mentioning: ${missing.map((k) => `\`${k}\``).join(', ')}.\n` +
      'Add the production (or, if the keyword is removed/renamed and only survives to raise a\n' +
      'diagnostic, add it to EXEMPT above with the reason). See M78 / V4-08.',
  );
});

test('the exemption list stays honest — every exempt keyword is still a real parser keyword', () => {
  const live = new Set(parserKeywords());
  const stale = [...EXEMPT.keys()].filter((kw) => !live.has(kw));
  assert.deepEqual(stale, [], `EXEMPT names keywords the parser no longer recognizes: ${stale.join(', ')} — drop them`);
});

test('GRAMMAR.md documents the workload grammar the load arc shipped', () => {
  // The specific regression: V4-08 measured `grep -ci` in GRAMMAR.md vs parser.ts and found
  // ramp 0/15, spike 0/15, threshold 0/25, workload 0/60. Pin the constructs by name so a future
  // rewrite that drops the section fails loudly rather than quietly passing the generic check
  // above on an incidental mention elsewhere.
  for (const production of ['RampWorkload', 'HoldWorkload', 'StepWorkload', 'SpikeWorkload', 'IterationsWorkload', 'ThresholdDecl', 'PauseStmt', 'CleanupDecl', 'ExcludeDecl']) {
    assert.ok(grammar.includes(`${production} `) || grammar.includes(`${production}:`), `GRAMMAR.md has no \`${production}\` production`);
  }
});
