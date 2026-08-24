// Unit tests for hover.ts (PLAN_M13_LSP.md Phase 2, decision 17.7).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, collectSymbols, checkUnknownVariables } from '@tflw/lang';
import { getHover } from '../src/index.js';

test('getHover: a matcher keyword surfaces its spec-data.ts entry', () => {
  const source = `test "ok"\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const result = getHover(program, table, source.indexOf('equals') + 1);
  assert.ok(result);
  assert.match(result!.contents, /equals/);
  assert.match(result!.contents, /any value/);
});

test('getHover: a generator expression surfaces its spec-data.ts entry', () => {
  const source = `test "ok"\n  let x = unique email\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const result = getHover(program, table, source.indexOf('unique email') + 2);
  assert.ok(result);
  assert.match(result!.contents, /unique email/);
});

test('getHover: a base64/hex/url transform expression surfaces its spec-data.ts entry (decision 22/M18)', () => {
  const source = `test "ok"\n  let creds = base64 encode("{email}:{pw}")\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const result = getHover(program, table, source.indexOf('base64 encode') + 2);
  assert.ok(result);
  assert.match(result!.contents, /base64 encode/);
  assert.match(result!.contents, /not a fresh-value generator \(M18\)/);
});

test('getHover: a variable ref shows its symbol kind', () => {
  const source = `test "ok"\n  let orderId = unique("ord")\n  api GET /orders/{orderId}\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const offset = source.indexOf('{orderId}') + 2;
  const result = getHover(program, table, offset);
  const ref = table.refs.find((r) => r.name === 'orderId')!;
  assert.deepEqual(result, { contents: '**orderId**: variable', span: ref.span });
});

// M33 (perf-arc LSP/VS Code catch-up, D24b): confirms hover.ts itself needs no code change for
// load-testing (its `MATCHER_SPEC_ID`/`GENERATOR_SPEC_ID`/`SYMBOL_KIND_LABEL` tables are unaffected
// — no new Matcher/generator/SymbolKind shipped with load testing) — the gap was entirely upstream
// in `findNodeAtOffset` (never reaching a workload-bearing decl at all) and `symbols.ts` (never
// walking its body), both fixed earlier in this milestone. This is the end-to-end proof those
// fixes actually compose through hover, the same way M4a's audit found hover.ts already exhaustive.
// M50 (D93-D95) later collapsed `scenario` into a workload-bearing `test`; this test still exists
// to prove the same thing about that unified path.
test('getHover (M33/M50): a variable ref inside a workload-bearing test body shows its symbol kind, exactly like inside a functional test', () => {
  const source = `test "checkout burst"\n  ramp to 10 users over 30s\n  let orderId = unique("ord")\n  api GET /orders/{orderId}\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const offset = source.indexOf('{orderId}') + 2;
  const result = getHover(program, table, offset);
  const ref = table.refs.find((r) => r.name === 'orderId')!;
  assert.deepEqual(result, { contents: '**orderId**: variable', span: ref.span });
});

test('getHover: an action param def shows its symbol kind', () => {
  const source = `action create order(name)\n  give name\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const def = table.defs.find((d) => d.kind === 'param')!;
  const result = getHover(program, table, def.span.start.offset + 1);
  assert.deepEqual(result, { contents: '**name**: action parameter', span: def.span });
});

test('getHover: `connects`/`fails` matchers surface their own spec-data.ts entries, not the visible/hidden state-word one (decision 18)', () => {
  const source = `test "ok"\n  api GET /health\n  expect request connects\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const result = getHover(program, table, source.indexOf('connects') + 1);
  assert.ok(result);
  assert.match(result!.contents, /`connects`/);
  assert.match(result!.contents, /`request`/);

  const failsSource = `test "ok"\n  api GET /health\n  expect request fails matching "certificate"\n`;
  const { program: failsProgram } = parseSource(failsSource);
  const failsTable = collectSymbols(failsProgram, failsSource);
  const failsResult = getHover(failsProgram, failsTable, failsSource.indexOf('fails') + 1);
  assert.ok(failsResult);
  assert.match(failsResult!.contents, /`fails`/);
});

test('getHover: an active TF032 diagnostic (malformed `upload … type "…"`) shows its canonical DIAGNOSTICS meaning/example (decision 22/M19)', () => {
  const source = `test "bad"\n  api POST /uploads upload "./img.png" as "avatar" type "imagepng"\n`;
  const { program, diagnostics: parseDiags } = parseSource(source);
  const diagnostics = [...parseDiags, ...checkUnknownVariables(program)];
  const table = collectSymbols(program, source);
  const diag = diagnostics.find((d) => d.code === 'TF032')!;
  assert.ok(diag, 'expected a TF032 invalid-content-type diagnostic in this fixture');
  const result = getHover(program, table, diag.span.start.offset + 1, diagnostics);
  assert.ok(result);
  assert.match(result!.contents, /error\[TF032\]/);
  assert.match(result!.contents, /invalid content type "imagepng"/);
  assert.match(result!.contents, /type\/subtype/);
});

test('getHover: an active diagnostic at the offset shows its live message + hint plus the canonical DIAGNOSTICS meaning/example (decision 20.6), taking priority over an overlapping matcher hover', () => {
  const source = `test "ok"\n  api GET /health\n  expect status eq 200\n`;
  const { program, diagnostics } = parseSource(source);
  const table = collectSymbols(program, source);
  const diag = diagnostics.find((d) => d.code === 'TF014')!;
  assert.ok(diag, 'expected a TF014 unrecognised-matcher diagnostic in this fixture');
  const result = getHover(program, table, diag.span.start.offset + 1, diagnostics);
  assert.ok(result);
  assert.match(result!.contents, /error\[TF014\]/);
  assert.match(result!.contents, /unknown matcher `eq`/);
  // OBS-04 (B1): the fallback line names the value matchers, the comparison forms and the states —
  // it used to omit `equals` and every state word, which is what made it unhelpful here. Asserted
  // by the words it must contain rather than by its exact prose: M61 rebuilt the line from the
  // parser's own vocabulary constants, and `parser.test.ts`'s own coverage of it is the place that
  // pins the wording. Here the point is only that the live hint reaches hover intact.
  assert.match(result!.contents, /expected a value matcher \(equals, /);
  for (const word of ['contains', 'has', 'greater than', 'less than', 'visible', 'checked']) {
    assert.ok(result!.contents.includes(word), `hover must carry the whole fallback vocabulary, missing \`${word}\``);
  }
  assert.match(result!.contents, /unrecognised matcher/);
  assert.match(result!.contents, /Example:/);
});

test('getHover: no diagnostics list falls through to normal matcher/symbol hover unchanged', () => {
  const source = `test "ok"\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const result = getHover(program, table, source.indexOf('equals') + 1);
  assert.ok(result);
  assert.match(result!.contents, /any value/);
});

test('getHover: null when nothing is at the offset', () => {
  const source = `test "ok"\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  assert.equal(getHover(program, table, source.indexOf('api')), null);
});
