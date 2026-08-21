// `renderMatcherTable`/`renderGeneratorTable` are pure functions of small arrays, so this tests
// them against fixture entries instead of the real ~13-row manifest — fast, and stable against
// future spec-data.ts content edits (same reasoning gen-docs.test.ts already uses for
// `parseSpecToTopics`).

import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
// @ts-expect-error — plain .mjs script, no type declarations
import { renderMatcherTable, renderGeneratorTable, renderDiagnosticsTable, regenerate } from '../scripts/gen-spec-tables.mjs';

test('renderMatcherTable emits a header row, separator, and one row per entry in order', () => {
  const table = renderMatcherTable([
    { id: 'equals', syntax: '`equals`', appliesTo: 'any value', example: '`expect status equals 201`', status: 'shipped' },
    { id: 'contains', syntax: '`contains`', appliesTo: 'strings, arrays', example: '`expect body.msg contains "x"`', status: 'shipped' },
  ]);
  const lines = table.split('\n');
  assert.equal(lines[0], '| Matcher | Applies to | Example |');
  assert.equal(lines[1], '|---|---|---|');
  assert.equal(lines[2], '| `equals` | any value | `expect status equals 201` |');
  assert.equal(lines[3], '| `contains` | strings, arrays | `expect body.msg contains "x"` |');
  assert.equal(lines.length, 4);
});

test('renderMatcherTable renders an empty array as just the header + separator', () => {
  const table = renderMatcherTable([]);
  assert.equal(table, '| Matcher | Applies to | Example |\n|---|---|---|');
});

test('renderGeneratorTable emits a header row, separator, and one row per entry including family', () => {
  const table = renderGeneratorTable([
    { id: 'unique-email', family: 'unique', syntax: '`unique email`', notes: 'collision-safe', example: '`unique email`' },
    { id: 'random-uuid', family: 'random', syntax: '`random uuid`', notes: 'collisions allowed', example: '`random uuid`' },
  ]);
  const lines = table.split('\n');
  assert.equal(lines[0], '| Family | Generator | Notes | Example |');
  assert.equal(lines[1], '|---|---|---|---|');
  assert.equal(lines[2], '| unique | `unique email` | collision-safe | `unique email` |');
  assert.equal(lines[3], '| random | `random uuid` | collisions allowed | `random uuid` |');
});

test('renderDiagnosticsTable emits a header row, separator, and one row per entry with the code backtick-wrapped', () => {
  const table = renderDiagnosticsTable([
    { code: 'TF001', meaning: 'Lexer: a character that cannot begin any token.', example: '`let y = $oops` → `unexpected character "$"`' },
    { code: 'TF031', meaning: 'Checker: a `request` assertion combined with a response-based one.', example: '`expect request connects` + `expect status equals 200`' },
  ]);
  const lines = table.split('\n');
  assert.equal(lines[0], '| Code | Meaning | Example |');
  assert.equal(lines[1], '|---|---|---|');
  assert.equal(lines[2], '| `TF001` | Lexer: a character that cannot begin any token. | `let y = $oops` → `unexpected character "$"` |');
  assert.equal(lines[3], '| `TF031` | Checker: a `request` assertion combined with a response-based one. | `expect request connects` + `expect status equals 200` |');
});

test('renderDiagnosticsTable renders an empty array as just the header + separator', () => {
  const table = renderDiagnosticsTable([]);
  assert.equal(table, '| Code | Meaning | Example |\n|---|---|---|');
});

// ---------------------------------------------------------------------------
// `M147e` / `M147-10` — SPEC.md's generated regions are what the manifest produces.
//
// **Generating a file is not the same as keeping it generated.** `docs:gen` rewrote SPEC.md on every
// developer machine and then left the result in the working tree for someone to commit or not, and
// for six milestones nothing compared the committed output against its source. Measured at `M147e`:
// `main`'s §17 table had 63 rows where the manifest produced 65, and it had drifted in *both*
// directions — `TF074` and `TF023`'s D638 rewording never reached the output, while `TF042`'s D641
// sentence and `TF055`'s D640 sentence had been written into the generated block **by hand** and
// would have vanished on the next legitimate run. All fifteen CI checks on the PR that shipped them
// were green.
//
// The assertion lives here, in the suite, rather than in a new CI job: `CONTRIBUTING.md` holds the
// gate set to `ci.yml`, and this adds an assertion without adding a gate. `pretest` runs
// `docs:check` so the same comparison also guards a bare `npm test`, and `packages/cli`'s hooks
// chain the *check* rather than the generator — otherwise `typecheck` would repair the drift before
// `test` could see it, in the same CI job, and the gate would be vacuous.
// ---------------------------------------------------------------------------

test('M147-10: SPEC.md is what `spec-data.ts` renders, not a file someone edited inside the markers', () => {
  const specPath = fileURLToPath(new URL('../../../SPEC.md', import.meta.url));
  const committed = readFileSync(specPath, 'utf8');
  const want = regenerate(committed);
  if (want === committed) return;
  const a = committed.split('\n');
  const b = want.split('\n');
  const i = a.findIndex((l, n) => l !== b[n]);
  assert.fail(
    `SPEC.md's generated regions differ from the manifest at line ${i + 1}.\n` +
      `  committed: ${JSON.stringify((a[i] ?? '').slice(0, 160))}\n` +
      `  generated: ${JSON.stringify((b[i] ?? '').slice(0, 160))}\n` +
      `  Run \`npm run docs:gen -w @tflw/lang\` and commit the result. If the change you want is prose,\n` +
      `  it belongs in packages/lang/src/spec-data.ts, which is what renders it.`,
  );
});

test('M147-10: the check is one a change can be watched tripping', () => {
  // `SUITE_TIMEOUT_MS`'s rule, applied here: a comparison nobody has seen fail is a claim. Rather
  // than mutate the real file, the round trip is exercised against a fixture — regenerating an
  // already-generated document is a no-op, and regenerating a tampered one is not.
  const specPath = fileURLToPath(new URL('../../../SPEC.md', import.meta.url));
  const good = regenerate(readFileSync(specPath, 'utf8'));
  assert.equal(regenerate(good), good, 'regeneration must be idempotent, or the check can never settle');

  // One character inside a generated row, which is what a hand edit looks like.
  const tampered = good.replace('| `TF001` |', '| `TF001`  |');
  assert.notEqual(tampered, good, 'the fixture edit must actually change the text');
  assert.equal(regenerate(tampered), good, 'a hand edit inside the markers must be overwritten, which is what makes it detectable');
  assert.notEqual(regenerate(tampered), tampered, 'and the check must therefore report it');
});
