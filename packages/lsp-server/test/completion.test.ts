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

test('getCompletions: subject kind includes `request` (decision 18)', () => {
  const source = 'test "ok"\n  expect r';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(
    getCompletions(ctx).map((c) => c.label),
    ['request'],
  );
});

test('getCompletions: matcher kind includes `connects`/`fails` with their own spec-data.ts detail text, not the state-word one (decision 18)', () => {
  const source = 'test "ok"\n  expect request c';
  const ctx = getCompletionContext(source, source.length)!;
  const candidates = getCompletions(ctx);
  const connectsCandidate = candidates.find((c) => c.label === 'connects');
  assert.ok(connectsCandidate);
  assert.match(connectsCandidate!.detail ?? '', /`request`/);

  const failsSource = 'test "ok"\n  expect request f';
  const failsCtx = getCompletionContext(failsSource, failsSource.length)!;
  const failsCandidate = getCompletions(failsCtx).find((c) => c.label === 'fails');
  assert.ok(failsCandidate);
  assert.match(failsCandidate!.detail ?? '', /`request`/);
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

test('getCompletions: transform kind attaches spec-data.ts detail text (decision 22/M18)', () => {
  const source = 'test "ok"\n  let x = base64 e';
  const ctx = getCompletionContext(source, source.length)!;
  const candidates = getCompletions(ctx);
  assert.deepEqual(
    candidates.map((c) => c.label),
    ['encode'],
  );
  assert.match(candidates[0]!.detail ?? '', /decision 98/);
});

test('getCompletions: transform kind after `hex`/`url` too, matching on `decode`', () => {
  const source = 'test "ok"\n  let x = hex d';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(
    getCompletions(ctx).map((c) => c.label),
    ['decode'],
  );
});
