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

// -- M4a: browser-arc (M3a-M3e) step/subject/matcher keywords, previously missing from these ------
// independent-copy wordlists entirely (only API-dialect vocab was ever added here).

test('getCompletions: step kind includes browser-arc step keywords (M3a-M3d)', () => {
  const source = 'test "ok"\n  cl';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(getCompletions(ctx).map((c) => c.label), ['click', 'close']);
});

// M28 (PLAN_LOG_LSP.md): `log` (M27) had never caught this independent-copy wordlist up either.
test('getCompletions: step kind includes `log` (M27/M28) — `lo` prefix matches only `log`', () => {
  const source = 'test "ok"\n  lo';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(getCompletions(ctx).map((c) => c.label), ['log']);
});

test('getCompletions: subject kind includes UI locator + page subjects (M3a, M3e)', () => {
  const source = 'test "ok"\n  expect pa';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(getCompletions(ctx).map((c) => c.label), ['page']);
});

test('getCompletions: matcher kind includes `has no [<severity>] a11y violations` (M3e)', () => {
  const source = 'test "ok"\n  expect page h';
  const ctx = getCompletionContext(source, source.length)!;
  const labels = getCompletions(ctx).map((c) => c.label);
  assert.ok(labels.includes('has no a11y violations'));
  for (const sev of ['minor', 'moderate', 'serious', 'critical']) {
    assert.ok(labels.includes(`has no ${sev} a11y violations`), `missing severity floor: ${sev}`);
  }
});

test('getCompletions: matcher kind includes `matches file` (gap #17), `matches snapshot` (M4b), and `was made` (M3d)', () => {
  const fileSource = 'test "ok"\n  expect body bytes m';
  const fileCtx = getCompletionContext(fileSource, fileSource.length)!;
  assert.deepEqual(
    getCompletions(fileCtx).map((c) => c.label),
    ['matches', 'matches subset', 'matches schema', 'matches file', 'matches snapshot'],
  );

  const madeSource = 'test "ok"\n  expect request to "/x" w';
  const madeCtx = getCompletionContext(madeSource, madeSource.length)!;
  assert.deepEqual(getCompletions(madeCtx).map((c) => c.label), ['was made']);
});

test('getCompletions: transform kind after `hex`/`url` too, matching on `decode`', () => {
  const source = 'test "ok"\n  let x = hex d';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(
    getCompletions(ctx).map((c) => c.label),
    ['decode'],
  );
});

// -- M4b: visual regression (`matches snapshot`) ------------------------------------------------

test('getCompletions: matcher kind includes `matches snapshot` once `matches` is fully typed (trailing space)', () => {
  const source = 'test "ok"\n  expect page matches ';
  const ctx = getCompletionContext(source, source.length)!;
  assert.deepEqual(ctx, { kind: 'matcher', prefix: 'matches' });
  const candidates = getCompletions(ctx);
  assert.deepEqual(
    candidates.map((c) => c.label),
    ['matches', 'matches subset', 'matches schema', 'matches file', 'matches snapshot'],
  );
  const snapshotCandidate = candidates.find((c) => c.label === 'matches snapshot');
  assert.match(snapshotCandidate?.detail ?? '', /page.*UI locators/);
});
