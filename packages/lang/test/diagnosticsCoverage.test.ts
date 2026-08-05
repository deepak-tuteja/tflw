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
// cannot tell a right explanation from a wrong one, only a *written* one from a missing one. That
// is the failure mode that actually occurs: nobody writes a wrong §17 row, they forget to write one.
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
