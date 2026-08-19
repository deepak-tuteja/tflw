// M144a (`V4-16`) — the diagnostics reference must stay *generated*, not *enumerated*.
//
// ## What this replaces, and why
//
// `PLAN_M144_DOC_HONESTY.md` specified a coverage guard here: every `TF0xx` code in `spec-data.ts`
// appears on `reference/diagnostics.md`. Measured before it was written, that guard is **already
// built and would have been a second copy of it**:
//
//   · `diagnosticsCoverage.test.ts` (`M86`) holds `Codes` ↔ `DIAGNOSTICS` two-way — every code that
//     can be emitted has a row, and every row explains a code that is actually assigned.
//   · `conformance.test.ts` holds the 42 `checkerCode:` literals to `Codes`, so nothing emits a
//     code off-manifest.
//   · And the page **enumerates no codes at all** — its `<tbody>` is a `v-for` over `DIAGNOSTICS`.
//     A coverage check would have compared the manifest against a rendering of itself.
//
// So the page's claim — *"Every stable `TF0xx` code tflw can print"* — is true, and the chain that
// makes it true has exactly one unguarded link left: **that the page keeps deriving its table.**
// The day someone pastes a static table in (to add a column, to drop the `<script setup>`, to make
// the page render without the workspace), `M86`'s conformance stops reaching the reader and the
// page's claim becomes a promise about a snapshot. Nothing anywhere would say so.
//
// That is the one link this file guards. It is deliberately not a coverage check.
//
// ## `RF0xx` is absent from that page on purpose
//
// `V4-16` was filed asking for the `RF0xx` refactor ids to be documented there as a second stable
// namespace. They are not one. `reuse.ts:64`: stable *within one scan*, sorted by first occurrence
// (path, line), not a content hash — so adding a file that sorts earlier renames every id after it.
// `RF001` is a **position, not an identity**, meant to be typed into `tflw refactor apply RF001` in
// the seconds after the scan that printed it. Tabulating it would make the page newly false in a
// subtler way than the omission it was filed for, so the page says so in one sentence instead
// (`M144b`), and this file asserts nothing about it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DIAGNOSTICS } from '@tflw/lang';

const PAGE = fileURLToPath(new URL('../reference/diagnostics.md', import.meta.url));
const source = readFileSync(PAGE, 'utf8');

test('the diagnostics reference sources its table from the DIAGNOSTICS manifest', () => {
  assert.match(
    source,
    /import\s*\{[^}]*\bDIAGNOSTICS\b[^}]*\}\s*from\s*['"][^'"]*spec-data(\.ts)?['"]/,
    'reference/diagnostics.md no longer imports DIAGNOSTICS from spec-data.ts — if the table is now authored by hand, `diagnosticsCoverage.test.ts` no longer reaches this page and its "every stable code" claim is a promise about a snapshot',
  );
  assert.match(
    source,
    /v-for\s*=\s*"[^"]*\bin\s+DIAGNOSTICS\b/,
    'the table body no longer iterates DIAGNOSTICS — the page may still import it while rendering something else',
  );
});

test('the page enumerates no diagnostic code of its own', () => {
  // The prose deliberately writes the *shape* `TF0xx`, never a real code. A concrete `TF043` in
  // this file means a row, an example or a cross-reference has been hand-written, and a hand-written
  // one is what goes stale — `V4-04` and `V4-05` are both rows about exactly that, each wrong for
  // days while the generated surfaces beside them were right.
  const literals = [...source.matchAll(/TF\d{3}/g)].map((m) => {
    const line = source.slice(0, m.index).split('\n').length;
    return `${m[0]} at reference/diagnostics.md:${line}`;
  });
  assert.deepEqual(
    literals,
    [],
    'a concrete diagnostic code is written into the page:\n  ' +
      literals.join('\n  ') +
      '\n\nPut it in DIAGNOSTICS (spec-data.ts) instead — that manifest generates this page, SPEC §17 and LSP hover together, and is the only one of the four that anything checks.',
  );
});

test('the manifest this page renders is non-trivial', () => {
  // A guard on the guard: both assertions above hold just as well over an empty manifest, and the
  // page would then render a table with no rows under a heading promising every code. `DIAGNOSTICS`
  // sits at 60 (TF069 is a withdrawal, `D456`, not a gap in coverage); the floor is deliberately
  // far below that so ordinary additions and the occasional withdrawal never touch this line.
  assert.ok(DIAGNOSTICS.length > 40, `DIAGNOSTICS holds only ${DIAGNOSTICS.length} rows — too few for this page's claim to mean anything`);
  assert.ok(
    DIAGNOSTICS.every((d) => /^TF\d{3}$/.test(d.code) && d.meaning && d.example),
    'a DIAGNOSTICS row is missing a code, a meaning or an example — this page renders all three columns unconditionally, so a hole here renders as a blank cell',
  );
});
