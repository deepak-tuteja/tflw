// M116 (`PLAN_M97_CHECKER_CONTRACT.md`, D150) — `TF053`: `capture` against a subject that can be
// asserted about but not bound to a name. Closes `M97a-11`, `M97a-12`, `M97a-13` and `M97a-14`.
//
// **Four rows, one code.** They were filed as four because the runtime throws from five sites, but
// every one says the same sentence: *this subject supports `expect`/`check`, not `capture`*.
//
// **The trap this file exists to hold down.** `SUBJECT_KINDS` maps `StatusSubject` to `'value'`, so
// a kind-only rule looks complete and is not: `capture status of request to "/x" as n` is *also*
// rejected by the runtime, because `of request to "…"` is not a subject type at all — it is an `of`
// field on four otherwise ordinary value subjects (`ast.ts:582/635/643/651`). A rule that tested
// kind alone would pass it, and nothing else in the suite would notice. The first group below is
// entirely about that.
//
// Every test states its negative control (`M92d`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource, checkCapturableSubjects, checkSessionBody, Codes } from '../src/index.js';

const codes = (body: string): string[] => {
  const source = `test "t"\n${body}`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${source}`);
  return checkCapturableSubjects(program).map((d) => d.code);
};

const messages = (body: string): string[] => {
  const { program } = parseSource(`test "t"\n${body}`);
  return checkCapturableSubjects(program).map((d) => d.message);
};

// ---------------------------------------------------------------------------
// `of request to "…"` — the half a kind-only rule would miss.
// ---------------------------------------------------------------------------

test('`capture <value> of request to "…"` is `TF053`, though its subject kind is `value`', () => {
  // THE test in this file. `status`/`header`/`body`/`body text` are all `'value'` subjects; the
  // `of` modifier is what makes them uncapturable. Control: delete the `of` check from
  // `uncapturableSubject` and all four of these go silent while every other test still passes.
  for (const subject of ['status', 'header "X-Req"', 'body', 'body text']) {
    assert.deepEqual(codes(`  api GET /health\n  capture ${subject} of request to "/health" as x\n`), [Codes.SUBJECT_NOT_CAPTURABLE], `subject: ${subject}`);
  }
});

test('the same value subjects *without* `of` are capturable', () => {
  // The other side of the same coin, and the false positive the `of` check could easily cause.
  for (const subject of ['status', 'header "X-Req"', 'body', 'body text', 'duration', 'body.id']) {
    assert.deepEqual(codes(`  api GET /health\n  capture ${subject} as x\n`), [], `subject: ${subject}`);
  }
});

test('a bare `request to "…"` subject is `TF053`', () => {
  assert.deepEqual(codes('  api GET /health\n  capture request to "/health" as x\n'), [Codes.SUBJECT_NOT_CAPTURABLE]);
});

// ---------------------------------------------------------------------------
// The three kind-based rows: `page`, `request`, a UI locator.
// ---------------------------------------------------------------------------

test('`capture page` is `TF053` (`M97a-12`)', () => {
  assert.deepEqual(codes('  open "/x"\n  capture page as x\n'), [Codes.SUBJECT_NOT_CAPTURABLE]);
});

test('`capture request` is `TF053` (`M97a-13`)', () => {
  assert.deepEqual(codes('  api GET /health\n  capture request as x\n'), [Codes.SUBJECT_NOT_CAPTURABLE]);
});

test('`capture <locator>` is `TF053` (`M97a-14`)', () => {
  for (const locator of ['button "Buy"', 'field "Email"', 'list "Cart"', 'css "#total"']) {
    assert.deepEqual(codes(`  open "/x"\n  capture ${locator} as x\n`), [Codes.SUBJECT_NOT_CAPTURABLE], `locator: ${locator}`);
  }
});

// ---------------------------------------------------------------------------
// Soundness: `expect`/`check` against every one of these stays legal.
// ---------------------------------------------------------------------------

test('`expect` against each uncapturable subject is untouched', () => {
  // The rule is about `capture`, and only `capture`. If this ever goes red, `TF053` has started
  // rejecting the operation each of these subjects exists for — the `A4-05` shape.
  // Control: widen the pass from `CaptureStmt` to every statement and all five of these fail.
  assert.deepEqual(codes('  open "/x"\n  expect page has no critical a11y violations\n'), []);
  assert.deepEqual(codes('  api GET /health\n  expect request connects\n'), []);
  assert.deepEqual(codes('  open "/x"\n  expect button "Buy" is visible\n'), []);
  assert.deepEqual(codes('  open "/x"\n  expect request to "/api/cart" was made\n'), []);
  assert.deepEqual(codes('  open "/x"\n  expect status of request to "/api/cart" equals 200\n'), []);
});

test('`check` against them is untouched too', () => {
  assert.deepEqual(codes('  api GET /health\n  check request connects\n'), []);
  assert.deepEqual(codes('  open "/x"\n  check button "Buy" is visible\n'), []);
});

// ---------------------------------------------------------------------------
// Reach and message.
// ---------------------------------------------------------------------------

test('a capture nested inside a block is reached', () => {
  // Control: iterate `test.body` only and this goes silent while the flat cases still pass.
  assert.deepEqual(codes('  open "/x"\n  within list "Cart items"\n    capture page as p\n'), [Codes.SUBJECT_NOT_CAPTURABLE]);
});

test('hooks and actions are walked', () => {
  const source = 'before\n  api GET /warm\n  capture request as r\n\ntest "t"\n  expect status equals 200\n';
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], 'fixture did not parse');
  assert.deepEqual(checkCapturableSubjects(program).map((d) => d.code), [Codes.SUBJECT_NOT_CAPTURABLE]);
});

test('the message names what the subject *does* support', () => {
  // "not capturable" alone leaves the reader nowhere to go; each hint carries the operation the
  // runtime's own throw names. Control: drop `UNCAPTURABLE_HINTS` and these assertions fail.
  const [page] = messages('  open "/x"\n  capture page as x\n');
  assert.match(page!, /`page`/);
  const [request] = messages('  api GET /health\n  capture request as x\n');
  assert.match(request!, /`request`/);
  const [network] = messages('  api GET /health\n  capture request to "/health" as x\n');
  assert.match(network!, /request to/);
});

test('a `session` body gets this pass (D152)', () => {
  // A session's whole purpose is capturing a token, so this is the pass its subject exercises most.
  const config = 'env local default\n  api "http://x"\n\nsession s\n  api GET /health\n  capture request as r\n';
  const parsed = parseConfigSource(config);
  assert.deepEqual(parsed.diagnostics, [], 'fixture did not parse');
  assert.ok(checkSessionBody(parsed.config.sessions, []).map((d) => d.code).includes(Codes.SUBJECT_NOT_CAPTURABLE));
  // Control: the shape a session actually wants stays silent.
  const good = parseConfigSource('env local default\n  api "http://x"\n\nsession s\n  api GET /health\n  capture body.token as tok\n');
  assert.deepEqual(checkSessionBody(good.config.sessions, []), []);
});
