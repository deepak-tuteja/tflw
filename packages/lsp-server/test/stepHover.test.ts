// M125e / `FU-24` — hovering a step keyword teaches, and a `use`d JS helper stops calling itself a
// plain `action`.
//
// The step-keyword branch resolves from text rather than from the AST (D280): a step keyword *is*
// the first word of a line, whereas it is not a node — `click`/`double click`/`right click` are one
// `ClickStmt` discriminated by a field. So the tests that matter here are the ones that pin where
// the branch must NOT fire, since a textual rule is the kind that over-matches quietly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource, collectSymbols, collectConfigSymbols } from '@tflw/lang';
import { getHover } from '../src/index.js';

function hoverAt(source: string, needle: string, plus = 1) {
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  return getHover(program, table, source.indexOf(needle) + plus, [], source);
}

test('the four keywords the row names all hover, where all four returned null', () => {
  const source = `test "ok"\n  let x = 1\n  api GET /health\n  expect status equals 200\n  check status equals 200\n`;
  for (const [keyword, expected] of [
    ['api', /issue one HTTP request/],
    ['expect', /hard assertion/],
    ['check', /soft twin/],
    ['let', /bind a value/],
  ] as const) {
    const result = hoverAt(source, `  ${keyword}`, 2);
    assert.ok(result, `\`${keyword}\` still hovers null`);
    assert.match(result!.contents, expected);
    assert.match(result!.contents, /Example: /);
  }
});

test('the hovered span covers the keyword, not the whole step', () => {
  const source = `test "ok"\n  api GET /health\n`;
  const result = hoverAt(source, '  api', 2);
  assert.ok(result);
  // `line`/`column`, not `offset` — `toLspRange` reads the 1-based pair and ignores the offset, so a
  // span carrying only an offset would highlight the first character of the file.
  assert.deepEqual(result!.span.start, { line: 2, column: 3, offset: source.indexOf('api') });
  assert.deepEqual(result!.span.end, { line: 2, column: 6, offset: source.indexOf('api') + 3 });
});

test('a workload directive hovers even though it is not a `Step` production', () => {
  const source = `test "load"\n  hold 20 rps for 2m\n  api GET /health\n  threshold error rate is less than 1%\n`;
  assert.match(hoverAt(source, '  hold', 2)!.contents, /flat target/);
  assert.match(hoverAt(source, '  threshold', 2)!.contents, /pass\/fail rule/);
});

test('a matcher still wins over the keyword on the same line', () => {
  // Ordering: the step-keyword branch runs last, so nothing that already had an answer loses it.
  const source = `test "ok"\n  api GET /health\n  expect status equals 200\n`;
  assert.match(hoverAt(source, 'equals')!.contents, /Applies to/);
});

test('the character after the keyword is not part of it', () => {
  const source = `test "ok"\n  api GET /health\n`;
  // Offset of the space following `api` — an editor is already showing whatever comes next there.
  assert.equal(hoverAt(source, '  api', 5), null);
});

test('a word that merely starts a line is not a keyword', () => {
  const source = `test "ok"\n  api GET /health\n  capture body.id as orderId\n`;
  assert.equal(hoverAt(source, 'test', 1), null);
});

test('a keyword spelt inside a string is not hovered', () => {
  // The whole risk of resolving textually. `log "…"` puts arbitrary prose at the start of a
  // continuation-free line, and a body literal can put `api` anywhere.
  const source = `test "ok"\n  log "api is down"\n`;
  assert.equal(hoverAt(source, 'api is down', 0), null);
});

test('an object key spelt like a keyword is not hovered', () => {
  const source = `test "ok"\n  api POST /notes body {\n    log: "hello"\n  }\n`;
  assert.equal(hoverAt(source, '    log', 4), null);
});

test('a retired spelling teaches nothing, because the manifest never held it', () => {
  const source = `test "ok"\n  think 200ms\n`;
  assert.equal(hoverAt(source, '  think', 2), null);
});

test('without the document text the branch is simply off', () => {
  // `getHover`'s `text` parameter defaults to `''` so every existing caller and test keeps compiling;
  // this pins that the default disables the branch rather than crashing inside it.
  const source = `test "ok"\n  api GET /health\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  assert.equal(getHover(program, table, source.indexOf('api') + 1), null);
});

// --- the kind that nothing ever produced (D279) --------------------------------------------------

test('a call into a `use`d helper hovers as an imported action', () => {
  const source = `use "./helpers.ts"\n\ntest "ok"\n  sign("abc")\n`;
  const result = hoverAt(source, 'sign("abc")', 1);
  assert.ok(result);
  assert.equal(result!.contents, '**sign**: imported action');
});

test('a call to an action declared in this file is still a plain action', () => {
  const source = `use "./helpers.ts"\n\naction sign(x)\n  give {x}\n\ntest "ok"\n  sign("abc")\n`;
  const result = hoverAt(source, 'sign("abc")', 1);
  assert.ok(result);
  assert.equal(result!.contents, '**sign**: action');
});

test('with no imports at all, an unresolved call stays an action', () => {
  // The rule is "not defined here, in a file that imports from elsewhere". A file that imports
  // nothing has nowhere for the name to have come from, so nothing is claimed about it.
  const source = `test "ok"\n  sign("abc")\n`;
  const result = hoverAt(source, 'sign("abc")', 1);
  assert.ok(result);
  assert.equal(result!.contents, '**sign**: action');
});

test('the label is a label — the ref itself is still kind `action` (D279a)', () => {
  // THE regression test for this milestone, and it asserts about `collectSymbols`, not about hover.
  //
  // The first implementation wrote `importedAction` into `SymbolRef.kind`, which is where the fact
  // is cheapest to compute and is the wrong place to keep it: `SymbolKind` is the identity two
  // other features match on. `definition.ts` reads `'action'` to decide a call needs cross-file
  // resolution and `findCrossFileRenameEdits` matches `(kind, name)` workspace-wide, so both
  // silently stopped seeing imported calls — go-to-definition returned null on the very calls the
  // new label was describing. Neither is a type error; both halves are valid `SymbolKind`s.
  //
  // Hovering as "imported action" while remaining kind `'action'` is the whole invariant, so both
  // halves are asserted in one test — separated, either could be satisfied while the other regressed.
  const source = `use "./helpers.ts"\n\ntest "ok"\n  sign("abc")\n`;
  const { program } = parseSource(source);
  const table = collectSymbols(program, source);
  const ref = table.refs.find((r) => r.name === 'sign');
  assert.ok(ref, 'no ref collected for the call');
  assert.equal(ref!.kind, 'action');
  assert.equal(hoverAt(source, 'sign("abc")', 1)!.contents, '**sign**: imported action');
});

test('a config buffer asks for no `imports` it does not have', () => {
  // `getHover` serves `tflw.config` too (decision A), whose root is a `ConfigFile` — no `imports`,
  // no `uses`. The guard tests the type tag first so this answers rather than throws.
  const source = `session admin\n  api POST /login\n`;
  const { config } = parseConfigSource(source);
  const table = collectConfigSymbols(config, source);
  const at = source.indexOf('admin') + 1;
  assert.doesNotThrow(() => getHover(config, table, at, [], source));
});
