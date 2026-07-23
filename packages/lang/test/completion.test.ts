// Unit tests for completion.ts / parser.ts's completion mode (PLAN_M13_LSP.md Phase 1): one case
// per instrumented production (`getCompletionContext` truncates at the cursor and re-lexes, so
// each source string below is written to end exactly at the simulated cursor position — no
// trailing text, no explicit offset argument needed beyond `source.length`), plus a negative case.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCompletionContext } from '../src/index.js';

function ctxAt(source: string) {
  return getCompletionContext(source, source.length);
}

test('getCompletionContext: step position (start of a new step line)', () => {
  const ctx = ctxAt('test "ok"\n  e');
  assert.deepEqual(ctx, { kind: 'step', prefix: 'e' });
});

test('getCompletionContext: step position, later step in an already-open block', () => {
  const ctx = ctxAt('test "ok"\n  api GET /health\n  l');
  assert.deepEqual(ctx, { kind: 'step', prefix: 'l' });
});

test('getCompletionContext: subject position (after `expect`)', () => {
  const ctx = ctxAt('test "ok"\n  expect s');
  assert.deepEqual(ctx, { kind: 'subject', prefix: 's' });
});

test('getCompletionContext: subject position (after `check`, the soft form)', () => {
  const ctx = ctxAt('test "ok"\n  check s');
  assert.deepEqual(ctx, { kind: 'subject', prefix: 's' });
});

test('getCompletionContext: matcher position (after a resolved subject)', () => {
  const ctx = ctxAt('test "ok"\n  expect status e');
  assert.deepEqual(ctx, { kind: 'matcher', prefix: 'e' });
});

test('getCompletionContext: matcher position after `not`', () => {
  const ctx = ctxAt('test "ok"\n  expect status not e');
  assert.deepEqual(ctx, { kind: 'matcher', prefix: 'e' });
});

test('getCompletionContext: session position (after `as`)', () => {
  const ctx = ctxAt('test "ok" as a');
  assert.deepEqual(ctx, { kind: 'session', prefix: 'a' });
});

test('getCompletionContext: session position, second name after a comma', () => {
  const ctx = ctxAt('test "ok" as admin, u');
  assert.deepEqual(ctx, { kind: 'session', prefix: 'u' });
});

test('getCompletionContext: unique-generator sub-kind position', () => {
  const ctx = ctxAt('test "ok"\n  let x = unique e');
  assert.deepEqual(ctx, { kind: 'unique', prefix: 'e' });
});

test('getCompletionContext: random-generator sub-kind position', () => {
  const ctx = ctxAt('test "ok"\n  let x = random n');
  assert.deepEqual(ctx, { kind: 'random', prefix: 'n' });
});

test('getCompletionContext: transform sub-kind position (decision 22/M18)', () => {
  const ctx = ctxAt('test "ok"\n  let x = base64 e');
  assert.deepEqual(ctx, { kind: 'transform', prefix: 'e' });
});

test('getCompletionContext: transform sub-kind position after `hex`/`url` too', () => {
  assert.deepEqual(ctxAt('test "ok"\n  let x = hex d'), { kind: 'transform', prefix: 'd' });
  assert.deepEqual(ctxAt('test "ok"\n  let x = url e'), { kind: 'transform', prefix: 'e' });
});

test('getCompletionContext: null when the cursor sits right after an already-complete statement', () => {
  const ctx = ctxAt('test "ok"\n  api GET /health\n  expect status equals 200');
  assert.equal(ctx, null);
});

test('getCompletionContext: null on a fully valid, fully closed document', () => {
  const ctx = ctxAt('test "ok"\n  api GET /health\n  expect status equals 200\n');
  assert.equal(ctx, null);
});
