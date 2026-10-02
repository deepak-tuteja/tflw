// `M265` — `scripts/pin-run.mjs`, the walkthrough shots' pinned clock. The shoot itself checks
// that both themes were served identical run data; these hold what "pinned" means, without a
// browser: the clock is fixed, everything else about the run is the run's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — a plain `.mjs` build script, with no declaration file.
import { PINNED_HTTP_DATE, PINNED_SEED, PINNED_START, PINNED_STEP_MS, pinEventStream, pinJsonBody, pinRun } from '../scripts/pin-run.mjs';

test('timestamps, the seed, the date header and a request\'s timing are pinned wherever they sit, and a duration the test states is not', () => {
  const pinned = pinRun({
    startedAt: '2026-10-02T08:11:25.825Z',
    seed: 1477404549,
    note: 'started 2026-10-02T10:11:25+02:00 on port 4720',
    detail: 'POST http://127.0.0.1:4720/orders → 201 (9.6ms)',
    source: 'expect duration is less than 500ms',
    headers: { date: 'Fri, 02 Oct 2026 08:11:25 GMT', location: '/orders/1' },
  });
  assert.deepEqual(pinned, {
    startedAt: PINNED_START,
    seed: PINNED_SEED,
    note: `started ${PINNED_START} on port 4720`,
    detail: `POST http://127.0.0.1:4720/orders → 201 (${PINNED_STEP_MS}ms)`,
    source: 'expect duration is less than 500ms',
    headers: { date: PINNED_HTTP_DATE, location: '/orders/1' },
  });
});

test('a measured duration is pinned, a parent reads its children\'s sum, and configuration is left alone', () => {
  const pinned = pinRun({
    durationMs: 16,
    tests: [{ durationMs: 15, timeoutMs: 30000, steps: [{ durationMs: 11, response: { status: 201, ms: 9.9 } }, { durationMs: 0 }] }],
  });
  assert.equal(pinned.tests[0].steps[0].durationMs, PINNED_STEP_MS);
  assert.equal(pinned.tests[0].steps[0].response.ms, PINNED_STEP_MS);
  assert.equal(pinned.tests[0].steps[0].response.status, 201);
  assert.equal(pinned.tests[0].durationMs, 2 * PINNED_STEP_MS);
  assert.equal(pinned.durationMs, 2 * PINNED_STEP_MS);
  assert.equal(pinned.tests[0].timeoutMs, 30000);
});

test('two runs that differ only in their clock pin to the same bytes', () => {
  const run = (at: string, ms: number) => JSON.stringify({ startedAt: at, verdict: 'fail', message: 'expected status to equal 200, but got 202', durationMs: ms, steps: [{ durationMs: ms }] });
  assert.equal(pinJsonBody(run('2026-10-02T08:00:00.001Z', 12)), pinJsonBody(run('2026-10-03T19:45:10.999Z', 40)));
  assert.notEqual(pinJsonBody(run('2026-10-02T08:00:00.001Z', 12)), pinJsonBody(run('2026-10-02T08:00:00.001Z', 12).replace('but got 202', 'but got 204')));
});

test('an event stream is pinned line by line, and its framing and non-JSON lines are kept', () => {
  const stream = 'data: {"at":"2026-10-02T08:00:00.001Z","durationMs":7}\n\ndata: plain noise\n\nevent: end\ndata: {"status":"failed","exitCode":1}\n\n';
  assert.equal(
    pinEventStream(stream),
    `data: {"at":"${PINNED_START}","durationMs":${PINNED_STEP_MS}}\n\ndata: plain noise\n\nevent: end\ndata: {"status":"failed","exitCode":1}\n\n`,
  );
});
