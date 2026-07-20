// PLAN decision 111 (M17): report/.last-run.json records a run's failing tests so `tflw run
// --failed` can replay just them. renderLastRun is pure; writeLastRun/readLastRun do real I/O
// against a temp dir, same pattern as the built-CLI e2e tests elsewhere in the monorepo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunReport } from '@tflw/runtime';
import { renderLastRun, writeLastRun, readLastRun } from '../src/last-run.js';

const report: RunReport = {
  ok: false,
  env: 'local',
  startedAt: '2026-07-20T00:00:00.000Z',
  durationMs: 100,
  total: 3,
  passed: 2,
  failed: 1,
  seed: 1,
  now: '2026-07-20T00:00:00.000Z',
  insecure: false,
  tests: [
    { name: 'health check', ok: true, durationMs: 12, steps: [], file: 'a.tflw' },
    { name: 'eventually works', ok: true, durationMs: 45, steps: [], flaky: true, file: 'a.tflw' },
    { name: 'broken thing', ok: false, durationMs: 8, steps: [], error: 'boom', file: 'b.tflw' },
  ],
};

test('renderLastRun only lists tests whose final verdict is failing — a flaky pass is not a failure', () => {
  const lastRun = renderLastRun(report);
  assert.deepEqual(lastRun.failed, [{ file: 'b.tflw', test: 'broken thing' }]);
});

test('renderLastRun on an all-passing report yields an empty failed list', () => {
  const passing: RunReport = { ...report, ok: true, failed: 0, tests: report.tests.filter((t) => t.ok) };
  assert.deepEqual(renderLastRun(passing).failed, []);
});

test('writeLastRun then readLastRun round-trips through a real file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-last-run-'));
  try {
    await writeLastRun(report, dir);
    const back = await readLastRun(dir);
    assert.deepEqual(back, { failed: [{ file: 'b.tflw', test: 'broken thing' }] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readLastRun returns null when no state file exists yet', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-last-run-none-'));
  try {
    assert.equal(await readLastRun(dir), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('writeLastRun overwrites — a later, all-passing run empties a previously non-empty state file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-last-run-overwrite-'));
  try {
    await writeLastRun(report, dir);
    const passing: RunReport = { ...report, ok: true, failed: 0, tests: report.tests.filter((t) => t.ok) };
    await writeLastRun(passing, dir);
    assert.deepEqual(await readLastRun(dir), { failed: [] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
