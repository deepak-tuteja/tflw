// M86 — the guard behind SPEC §17's own completeness, and the tflw half of a claim that had
// already drifted downstream.
//
// `Codes` (diagnostic.ts) is the source of truth for the code *constants*; `DIAGNOSTICS`
// (spec-data.ts) is the source of truth for what each one *means* — it generates SPEC §17's table,
// the docs-site diagnostic-codes reference, and the LSP's hover text. Nothing tied the two
// together. `gen-spec-tables.test.ts` tests the renderer against fixture rows on purpose ("stable
// against future spec-data.ts content edits"), which is the right call for a renderer and leaves
// the real manifest unchecked: a new code could ship with a checker rule, a message and a test, and
// simply never appear in the table every reader is pointed at.
//
// It is a coverage floor, not a correctness proof — exactly like `grammarCoverage.test.ts`. It
// cannot tell a right explanation from a wrong one, only a *written* one from a missing one.
//
// **The sentence that used to end this paragraph was wrong.** It read: "That is the failure mode
// that actually occurs: nobody writes a wrong §17 row, they forget to write one." Two rows in the
// launch review say otherwise, both verified against the shipped binary at M110 and both wrong at
// the time this comment was written. `V4-04`: `TF022`'s row named four config directives for the
// five days after M58 shipped a fifth, so the manifest denied a directive the parser accepted.
// `V4-05`: `TF027`'s row described a rule broader than `checkDataTables` implements, and its
// worked example — a `{col}` typo in a test *body* — produces `TF030`, a different code, when run.
// A wrong row is worse than a missing one: a missing row sends a reader to the source, a wrong row
// sends them away confident.
//
// M110 closed each at its cause rather than by editing text. `TF022`'s list is now interpolated
// from `CONFIG_DIRECTIVES`, the same array the parser builds its message from, so that pair cannot
// disagree again. `TF027`'s row was narrowed to what the pass does. **The general case is
// `diagnosticExamples.test.ts`, shipped in M110b** (`M110-01`): every row's `example` is now
// generated from probes that are executed, so a worked example producing a different code than its
// heading is a red suite rather than four confidently wrong rendered surfaces. It found four rows
// wrong on its first run, including `TF003` — the row documenting indentation — describing a shape
// that emits `TF011`.
//
// **This test is still worth having, and is still only a floor.** It answers "is every code
// written down?"; the examples test answers "is what is written down true of the code it sits
// under?". Neither subsumes the other: a row can be present and wrong, or right and missing.
//
// The same completeness claim is made a second time in the *consumer* repo — testFlow-tests'
// `scripts/verify-check-diagnostics.mjs` prints "All N assigned TF0xx diagnostic codes dogfooded",
// where N was its own fixture count rather than tflw's code count. It had been wrong since the
// first code added after M49. That script now derives the expected list from the shipped bundle's
// own `DIAGNOSTICS` manifest — which is only a trustworthy list because of this test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Codes, DIAGNOSTICS } from '../src/index.js';

test('every code in `Codes` has a SPEC §17 `DIAGNOSTICS` row', () => {
  const documented = new Set(DIAGNOSTICS.map((d) => d.code));
  const missing = Object.entries(Codes)
    .filter(([, code]) => !documented.has(code))
    .map(([name, code]) => `${code} (Codes.${name})`);
  assert.deepEqual(
    missing,
    [],
    'these codes can be emitted but are explained nowhere — add a row to DIAGNOSTICS in spec-data.ts, which generates SPEC §17, the docs-site reference and LSP hover',
  );
});

test('every `DIAGNOSTICS` row explains a code that `Codes` actually assigns', () => {
  const assigned = new Set<string>(Object.values(Codes));
  const orphans = DIAGNOSTICS.map((d) => d.code).filter((code) => !assigned.has(code));
  assert.deepEqual(
    orphans,
    [],
    'these rows document a code nothing can emit — a reserved or removed code left in the table reads as a shipped diagnostic',
  );
});

test('no code is assigned to two names, and no code is explained twice', () => {
  const values = Object.values(Codes);
  assert.equal(new Set(values).size, values.length, `duplicate value in Codes: ${values.filter((c, i) => values.indexOf(c) !== i).join(', ')}`);

  const rows = DIAGNOSTICS.map((d) => d.code);
  assert.equal(new Set(rows).size, rows.length, `duplicate row in DIAGNOSTICS: ${rows.filter((c, i) => rows.indexOf(c) !== i).join(', ')}`);
});

test('`DIAGNOSTICS` is in ascending code order — it is rendered as a lookup table', () => {
  const rows = DIAGNOSTICS.map((d) => d.code);
  assert.deepEqual(rows, [...rows].sort(), 'a reader scans SPEC §17 for a code they were just shown; keep the manifest sorted');
});
