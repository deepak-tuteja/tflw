// M97c (`PLAN_M97_CHECKER_CONTRACT.md`, D144) — `A4-07`: `TF043`, a path literal naming a file
// that is not there.
//
// SPEC §4.3 has claimed since M2.5 that "the checker verifies the file exists"; it never did. The
// review row concluded it *could not*, on the grounds that the checker does no I/O — and that was
// the wrong conclusion from a true premise. The no-I/O invariant belongs to the `@tflw/lang`
// **package**, so the docs-site editor demo can run the checker in a browser; the `tflw check`
// **command** has read files from disk since M87, when `resolveImportedActions` landed. This pass
// is shaped to keep both true: `@tflw/lang` is handed the *answers* (`ProgramCheckOptions
// .missingFiles`), and `@tflw/runtime` does the `stat`ing.
//
// Measured on the built CLI before this existed: a file whose `import` named nothing printed
// `no problems found` at exit 0, and `tflw run` on it printed `✗ t.tflw (crashed) (0 ms)` — the
// whole console output, `--verbose` included, with the real message reaching only
// `report/results.json`.
//
// Every test states its negative control (`M92d` — a negative control that cannot fail is a
// passing test of nothing).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSource, checkProgram, checkReferencedFiles, collectFileReferences, fileReferenceDrift, Codes } from '../src/index.js';

const parsed = (source: string) => {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse: ${source}`);
  return program;
};

/** One example of every syntax that names a file, in one file. */
const ALL_SEVEN = `import "./imported.tflw"
use "./helper.ts"

with each from "./rows.csv"
test "table {role}"
  api GET /health
  expect status equals 200

test "the rest"
  api POST /x body from "./payload.json"
  api POST /y upload "./avatar.png" as "file"
  expect body bytes matches file "./golden.bin"
  drop file "./dropped.png" onto css "#zone"
`;

// ---- collection ---------------------------------------------------------------------------

test('collectFileReferences: finds every syntax that names a file', () => {
  const refs = collectFileReferences(parsed(ALL_SEVEN));
  assert.deepEqual(
    refs.map((r) => [r.syntax, r.path.value]).sort(),
    [
      ['body from', './payload.json'],
      ['drop file', './dropped.png'],
      ['import', './imported.tflw'],
      ['matches file', './golden.bin'],
      ['upload', './avatar.png'],
      ['use', './helper.ts'],
      ['with each from', './rows.csv'],
    ].sort(),
  );
  // Control: the count is asserted too, so a walk that returned a path twice (the object graph is
  // reachable by more than one route from `Program`) fails here rather than double-reporting.
  assert.equal(refs.length, 7);
});

test('collectFileReferences: exactly `import` and `use` are the ones the checker opens itself', () => {
  // D147's whole severity split reduces to this partition, so it is asserted as a partition rather
  // than by spot-checking two rows: every syntax appears on exactly one side, and neither side is
  // empty. A row added to FILE_BEARING_NODES without thinking about `neededBy` lands in whichever
  // list is wrong and fails here by name.
  const byTier = (tier: 'check' | 'run') =>
    collectFileReferences(parsed(ALL_SEVEN))
      .filter((r) => r.neededBy === tier)
      .map((r) => r.syntax)
      .sort();
  assert.deepEqual(byTier('check'), ['import', 'use']);
  assert.deepEqual(byTier('run'), ['body from', 'drop file', 'matches file', 'upload', 'with each from']);
});

test('collectFileReferences: reaches a path nested inside a block-bearing step', () => {
  // The reason the walk is structural rather than a hand-rolled per-statement switch: `symbols.ts`
  // and `checker.ts` both have a `walkSteps` that must name every block kind to descend into it,
  // and a path it had not been taught about would be skipped in silence.
  const refs = collectFileReferences(
    parsed(`test "t"
  open "/app"
  within css "#panel"
    drop file "./nested.png" onto css "#zone"
`),
  );
  assert.deepEqual(
    refs.map((r) => r.path.value),
    ['./nested.png'],
  );
});

test('collectFileReferences: an interpolated path is not a statically-known one', () => {
  // Control: the same fixture with `{name}` removed must yield exactly one reference — otherwise
  // this test would pass against a collector that found nothing at all.
  const interpolated = collectFileReferences(parsed(`test "t"\n  api POST /x upload "./fixtures/{name}.png" as "f"\n`));
  assert.deepEqual(interpolated, []);

  const literal = collectFileReferences(parsed(`test "t"\n  api POST /x upload "./fixtures/a.png" as "f"\n`));
  assert.deepEqual(
    literal.map((r) => r.path.value),
    ['./fixtures/a.png'],
  );
});

// ---- the pass -----------------------------------------------------------------------------

test('checkReferencedFiles: reports TF043 for exactly the paths the caller reported missing', () => {
  const program = parsed(ALL_SEVEN);
  const diags = checkReferencedFiles(program, { missingFiles: new Set(['./rows.csv', './golden.bin']) });
  assert.deepEqual(
    diags.map((d) => d.code),
    [Codes.MISSING_FILE, Codes.MISSING_FILE],
  );
  assert.match(diags[0]!.message, /`with each from` names a file that does not exist: "\.\/rows\.csv"/);
  assert.match(diags[1]!.message, /`matches file` names a file that does not exist: "\.\/golden\.bin"/);
});

test('checkReferencedFiles: a file only a step opens is a warning, so the suite still runs (D147)', () => {
  const program = parsed(ALL_SEVEN);
  // The regression this milestone exists for. M97c reported all seven at `'error'`, and
  // `loadAndValidate` returns EXIT_USAGE on any error-severity diagnostic — so a suite whose
  // earlier step *creates* the file it later reads became unrunnable with no override. That is
  // D137 clause 1's failure mode, found by clause 1's own declared evidence (testFlow-tests'
  // corpus) on the first CI run after the M97/M98 stack landed.
  const stepTier = checkReferencedFiles(program, { missingFiles: new Set(['./golden.bin', './rows.csv', './payload.json', './avatar.png', './dropped.png']) });
  assert.equal(stepTier.length, 5);
  assert.deepEqual([...new Set(stepTier.map((d) => d.severity))], ['warning']);
  // The message is unchanged — only the severity and the hint move. A user who could act on this
  // before can still act on it; what they can no longer do is be blocked by it.
  assert.match(stepTier[0]!.message, /`with each from` names a file that does not exist/);
  assert.match(stepTier[0]!.hint!, /a warning, not an error, because this file is opened during the run/);

  const checkTier = checkReferencedFiles(program, { missingFiles: new Set(['./imported.tflw', './helper.ts']) });
  assert.deepEqual(
    checkTier.map((d) => d.severity),
    ['error', 'error'],
  );
  // Control: both halves are run against the *same* program and the same pass, so "warning" above
  // cannot be a pass that lost its severity field or stopped firing — these two are the proof that
  // it still emits, still at error, for the tier that kept it.
  assert.match(checkTier[0]!.hint!, /not the directory `tflw` runs in$/);
});

test('checkReferencedFiles: undefined skips the pass, an empty set asserts everything was found', () => {
  const program = parsed(ALL_SEVEN);
  // The docs-site editor demo's case: a browser has no filesystem, so the question cannot be asked.
  assert.deepEqual(checkReferencedFiles(program, {}), []);
  assert.deepEqual(checkReferencedFiles(program, { missingFiles: new Set() }), []);
  // Control: with a non-empty set the same program does report, so the two above are the option
  // being honoured rather than a pass that never fires.
  assert.equal(checkReferencedFiles(program, { missingFiles: new Set(['./helper.ts']) }).length, 1);
});

test('checkProgram composes the pass, sorted into source order with everything else', () => {
  const program = parsed(ALL_SEVEN);
  const diags = checkProgram(program, { missingFiles: new Set(['./golden.bin', './imported.tflw']) });
  assert.deepEqual(
    diags.map((d) => d.code),
    [Codes.MISSING_FILE, Codes.MISSING_FILE],
  );
  // `import` is line 1, `matches file` is line 11 — the set was given in the other order, so this
  // asserts `byPosition` and not the caller's iteration order (`A4-14`, M97b).
  assert.match(diags[0]!.message, /\.\/imported\.tflw/);
  assert.match(diags[1]!.message, /\.\/golden\.bin/);
});

// ---- the drift guard ----------------------------------------------------------------------

test('fileReferenceDrift: ast.ts declares no path-bearing node the table has not got', () => {
  const astSource = readFileSync(fileURLToPath(new URL('../src/ast.ts', import.meta.url)), 'utf8');
  assert.deepEqual(
    fileReferenceDrift(astSource),
    [],
    'a node in ast.ts carries a `path`/`filePath` StringLit and is missing from FILE_BEARING_NODES — ' +
      'add it there (and give it a `syntax` label), or this pass silently ignores that syntax.',
  );
});

test('fileReferenceDrift: negative control — an unlisted path-bearing node is reported', () => {
  // The guard above is worthless if it cannot fail. Three of four controls written during M92 could
  // not, so this feeds it a node it has never heard of and requires it to say so by name.
  const invented = `export interface SideloadStmt extends Node {
  readonly type: 'SideloadStmt';
  readonly filePath: StringLit;
}
`;
  assert.deepEqual(fileReferenceDrift(invented), ['SideloadStmt']);
});
