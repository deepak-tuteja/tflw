// `M249` `A`/`B` (`D1362`): every run kept under `report/runs/<id>/`, and history read back from them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunReport, TestResult } from '@tflw/runtime';
import { keepRun, listKeptRuns, runIdFor } from '../src/runs.js';
import { historyClause, isFlaky, readHistory, testKey } from '../src/history.js';
import { renderCliSummary } from '../src/cli-summary.js';

const t = (name: string, ok: boolean, sourceHash?: string, extra: Partial<TestResult> = {}): TestResult => ({
  kind: 'functional', name, ok, durationMs: 1, steps: [], file: 'a.tflw', ...(sourceHash ? { sourceHash } : {}), ...extra,
});
const report = (startedAt: string, tests: TestResult[]): RunReport =>
  ({ ok: tests.every((x) => x.ok), env: 'local', startedAt, durationMs: 1, total: tests.length, passed: tests.filter((x) => x.ok).length, failed: tests.filter((x) => !x.ok).length, tests, seed: 1, now: startedAt, insecure: false }) as RunReport;

/** Write `report/` as a run would, then keep it. */
async function runOnce(dir: string, r: RunReport, keep = 50): Promise<void> {
  await writeFile(join(dir, 'results.json'), JSON.stringify(r));
  await writeFile(join(dir, 'report.html'), '<html>');
  await keepRun(dir, { startedAt: r.startedAt, keep });
}

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'tflw-runs-'));
}

test('a kept run holds what the run wrote and nothing a user put in report/', async () => {
  const dir = await scratch();
  try {
    await writeFile(join(dir, 'results.json'), '{}');
    await writeFile(join(dir, 'junit.xml'), '<x/>');
    await mkdir(join(dir, 'assets', 'traces'), { recursive: true });
    await writeFile(join(dir, 'assets', 'traces', 't.zip'), 'PK');
    await writeFile(join(dir, 'notes.md'), 'mine');
    const kept = await keepRun(dir, { startedAt: '2026-09-29T10:00:00.123Z', keep: 5 });
    assert.equal(kept?.id, '2026-09-29T10-00-00-123Z');
    assert.deepEqual((await readdir(join(dir, 'runs', kept!.id))).sort(), ['assets', 'junit.xml', 'results.json']);
    // A second run in the same millisecond is its own directory, not an overwrite.
    const again = await keepRun(dir, { startedAt: '2026-09-29T10:00:00.123Z', keep: 5 });
    assert.equal(again?.id, '2026-09-29T10-00-00-123Z-2');
    // The page's server names its run up front; that name is used as given.
    assert.equal((await keepRun(dir, { startedAt: 'x', keep: 5, id: 'from-the-page' }))?.id, 'from-the-page');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('keep N prunes the oldest beyond N, and keep 0 keeps nothing and prunes nothing', async () => {
  const dir = await scratch();
  try {
    for (const s of ['01', '02', '03', '04']) await runOnce(dir, report(`2026-09-29T10:00:${s}.000Z`, [t('x', true)]), 2);
    assert.deepEqual(await listKeptRuns(dir), [runIdFor('2026-09-29T10:00:04.000Z'), runIdFor('2026-09-29T10:00:03.000Z')]);
    assert.equal(await keepRun(dir, { startedAt: '2026-09-29T10:00:05.000Z', keep: 0 }), null);
    assert.equal((await listKeptRuns(dir)).length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('flaky is a flip on the same source; a flip across a source change is a change, and a skip is not a verdict', () => {
  const r = (verdict: 'pass' | 'fail' | 'skip', sourceHash?: string) => ({ run: 'x', verdict, ...(sourceHash ? { sourceHash } : {}) });
  assert.equal(isFlaky([r('fail', 'h1'), r('pass', 'h1')]), true);
  assert.equal(isFlaky([r('fail', 'h2'), r('pass', 'h1')]), false, 'the file changed between the two runs');
  assert.equal(isFlaky([r('fail'), r('pass')]), false, 'no hash on either side — withheld, never guessed');
  assert.equal(isFlaky([r('fail', 'h1'), r('skip', 'h1'), r('pass', 'h1')]), true, 'a skip between them does not break the pair');
  assert.equal(isFlaky([r('pass', 'h1'), r('pass', 'h1'), r('fail', 'h2')]), false);
});

test('history joins kept runs by file and name, newest first, bounded by the limit', async () => {
  const dir = await scratch();
  try {
    await runOnce(dir, report('2026-09-29T10:00:01.000Z', [t('login', true, 'h1'), t('cart', true, 'h1')]));
    await runOnce(dir, report('2026-09-29T10:00:02.000Z', [t('login', false, 'h1'), t('cart', true, 'h1')]));
    await runOnce(dir, report('2026-09-29T10:00:03.000Z', [t('login', true, 'h1'), t('cart', false, 'h2')]));
    const h = await readHistory(dir, { limit: 10 });
    assert.equal(h.runs.length, 3);
    const login = h.tests.get(testKey('a.tflw', 'login'))!;
    assert.deepEqual(login.runs.map((r) => r.verdict), ['pass', 'fail', 'pass']);
    assert.equal(login.failures, 1);
    assert.equal(login.flaky, true);
    assert.equal(h.tests.get(testKey('a.tflw', 'cart'))!.flaky, false, 'cart failed when its file changed');
    // Bounded: the newest two only.
    const two = await readHistory(dir, { limit: 2 });
    assert.deepEqual(two.tests.get(testKey('a.tflw', 'login'))!.runs.map((r) => r.verdict), ['pass', 'fail']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the summary\'s failure line carries the history clause, and a first run reads as it always did', async () => {
  const dir = await scratch();
  try {
    await runOnce(dir, report('2026-09-29T10:00:01.000Z', [t('login', true, 'h1')]));
    const failing = report('2026-09-29T10:00:02.000Z', [t('login', false, 'h1')]);
    await runOnce(dir, failing);
    const h = await readHistory(dir, { limit: 10 });
    assert.equal(historyClause(h, 'a.tflw', 'login'), ' — failed in 1 of its last 2 kept runs, flaky');
    assert.match(renderCliSummary(failing, false, h), /✗ login \(1 ms\) — failed in 1 of its last 2 kept runs, flaky/);
    assert.doesNotMatch(renderCliSummary(failing, false), /kept runs/, 'no history handed in, no clause');
    const first = await readHistory(await scratch(), { limit: 10 });
    assert.equal(historyClause(first, 'a.tflw', 'login'), '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a workload threshold\'s past values come back newest first, null kept as null', async () => {
  const dir = await scratch();
  try {
    const w = (actual: number | null) =>
      ({ kind: 'workload', name: 'load', ok: true, file: 'a.tflw', thresholds: [{ label: 'p95 duration', op: 'lessThan', target: 300, actual, ok: true }] }) as unknown as TestResult;
    await runOnce(dir, report('2026-09-29T10:00:01.000Z', [w(120)]));
    await runOnce(dir, report('2026-09-29T10:00:02.000Z', [w(null)]));
    await runOnce(dir, report('2026-09-29T10:00:03.000Z', [w(140)]));
    const h = await readHistory(dir, { limit: 10 });
    assert.deepEqual(h.thresholds, [{ file: 'a.tflw', test: 'load', threshold: 'p95 duration < 300', values: [140, null, 120] }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// `M249` `C` (`D1369`) — `mergeRuns`, the fields a merge of finished runs has to get right.
test('merge: findings are deduplicated by fingerprint, counts are re-derived, and an aborted input is not ok', async () => {
  const { mergeRuns } = await import('../src/merge.js');
  const finding = (fingerprint: string) => ({ scan: 'security', rule: 'sec/x', severity: 'serious', description: 'd', detail: 'x', endpoint: 'GET /a', fingerprint });
  const a = { ...report('2026-09-29T10:00:00.000Z', [t('one', true)]), findings: [finding('f1'), finding('f2')] } as RunReport;
  const b = { ...report('2026-09-29T10:00:05.000Z', [t('two', true)]), env: 'staging', findings: [finding('f2')], aborted: true } as RunReport;
  const m = mergeRuns([{ dir: 'a', report: a }, { dir: 'b', report: b }]);
  assert.deepEqual((m.findings ?? []).map((f) => f.fingerprint), ['f1', 'f2']);
  assert.deepEqual([m.total, m.passed, m.failed], [2, 2, 0]);
  assert.equal(m.ok, false, 'nothing failed, and an aborted input still means the merged run never reached a verdict');
  assert.equal(m.env, 'local, staging');
  assert.equal(m.startedAt, '2026-09-29T10:00:00.000Z');
  assert.equal(m.durationMs, 5001, 'from the earliest start to the latest end');
  assert.deepEqual(m.mergedFrom, ['a', 'b']);
});
