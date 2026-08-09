// M116 (`PLAN_M97_CHECKER_CONTRACT.md`, D149) — `TF052`: `mask <locator>` outside `matches
// snapshot`. Closes `M97a-05`.
//
// The smallest of the three rules and the one with the least room to be wrong: both operands sit in
// one `ExpectStmt`, so there is no cross-statement reasoning to get subtly out of step with the
// runtime. What it still has to get right is the *permissive* half — a mask alongside a real
// snapshot must stay silent, or the rule breaks the one feature it exists to protect.
//
// Every test states its negative control (`M92d`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource, checkSnapshotMasks, checkSessionBody, Codes } from '../src/index.js';

const codes = (body: string): string[] => {
  const source = `test "t"\n${body}`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${source}`);
  return checkSnapshotMasks(program).map((d) => d.code);
};

test('a mask on a non-snapshot matcher is `TF052`', () => {
  // Control: the `matches snapshot` test below runs the same mask and must be silent.
  assert.deepEqual(codes('  api GET /health\n  expect status equals 200 mask field "Email"\n'), [Codes.MASK_WITHOUT_SNAPSHOT]);
});

test('a mask alongside `matches snapshot` is silent', () => {
  // The permissive half. If this ever goes red, the rule has broken snapshot masking itself —
  // which is the only reason `mask` exists.
  assert.deepEqual(codes('  open "/x"\n  expect page matches snapshot "home" mask field "Email"\n'), []);
});

test('an expect with no mask at all is silent, whatever the matcher', () => {
  assert.deepEqual(codes('  api GET /health\n  expect status equals 200\n'), []);
  assert.deepEqual(codes('  open "/x"\n  expect page matches snapshot "home"\n'), []);
});

test('every stray mask is reported, not just the first', () => {
  // One diagnostic per mask, because each one is a separate thing the author wrote and expected to
  // do something. Reporting only the first would leave a second caret un-drawn on a re-check.
  // Control: report once per `ExpectStmt` instead and this returns one code.
  assert.deepEqual(codes('  open "/x"\n  expect page is visible mask field "Email" mask field "Card"\n'), [
    Codes.MASK_WITHOUT_SNAPSHOT,
    Codes.MASK_WITHOUT_SNAPSHOT,
  ]);
});

test('the diagnostic points at the mask, not at the whole statement', () => {
  // The span is the useful half: `expect …` can be a long line, and the thing to delete is the
  // mask. Control: swap `mask.span` for the `ExpectStmt`'s and the start column moves to 3.
  const { program } = parseSource('test "t"\n  open "/x"\n  expect page is visible mask field "Email"\n');
  const [diag] = checkSnapshotMasks(program);
  assert.equal(diag!.span.start.line, 3);
  assert.ok(diag!.span.start.column > 20, `expected the caret on the mask, got column ${diag!.span.start.column}`);
});

test('a mask inside a `wait until api` block is reached', () => {
  // `forEachExpect` descends into `wait until api`'s nested expects, and a walker that did not
  // would miss this in silence.
  assert.deepEqual(codes('  wait until api GET /health\n    expect status equals 200 mask field "Email"\n'), [Codes.MASK_WITHOUT_SNAPSHOT]);
});

test('a `session` body gets this pass (D152)', () => {
  const config = 'env local default\n  api "http://x"\n\nsession s\n  api GET /health\n  expect status equals 200 mask field "Email"\n';
  const parsed = parseConfigSource(config);
  assert.deepEqual(parsed.diagnostics, [], 'fixture did not parse');
  assert.ok(checkSessionBody(parsed.config.sessions, []).map((d) => d.code).includes(Codes.MASK_WITHOUT_SNAPSHOT));
});
