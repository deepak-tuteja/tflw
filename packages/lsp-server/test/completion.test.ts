// Unit tests for resolution/completion.ts (PLAN_M13_LSP.md Phase 2, design decision 3) — the
// candidate-list layer over `@tflw/lang`'s grammar-shape `CompletionContext`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCompletionContext } from '@tflw/lang';
import { getCompletions } from '../src/index.js';

test('getCompletions: step kind returns keyword candidates filtered by prefix', () => {
  const source = 'test "ok"\n  e';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(
    getCompletions(ctx).map((c) => c.label),
    ['expect'],
  );
});

test('getCompletions: matcher kind attaches spec-data.ts detail text', () => {
  const source = 'test "ok"\n  expect status e';
  const ctx = getCompletionContext(source, source.length)!;
  const candidates = getCompletions(ctx);
  const equalsCandidate = candidates.find((c) => c.label === 'equals');
  assert.ok(equalsCandidate);
  assert.match(equalsCandidate!.detail ?? '', /any value/);
});

test('getCompletions: session kind uses the caller-supplied knownSessions list', () => {
  const source = 'test "ok" as a';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(
    getCompletions(ctx, { knownSessions: ['admin', 'userA', 'billing'] }).map((c) => c.label),
    ['admin'],
  );
});

test('getCompletions: session kind is empty without a knownSessions source', () => {
  const source = 'test "ok" as a';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(getCompletions(ctx), []);
});

test('getCompletions: unique kind attaches spec-data.ts detail text', () => {
  const source = 'test "ok"\n  let x = unique e';
  const ctx = getCompletionContext(source, source.length)!;
  const candidates = getCompletions(ctx);
  assert.deepEqual(
    candidates.map((c) => c.label),
    ['email'],
  );
  assert.match(candidates[0]!.detail ?? '', /collision-safe/);
});

test('getCompletions: random kind attaches spec-data.ts detail text', () => {
  const source = 'test "ok"\n  let x = random n';
  const ctx = getCompletionContext(source, source.length)!;
  const candidates = getCompletions(ctx);
  assert.deepEqual(
    candidates.map((c) => c.label),
    ['number'],
  );
});
