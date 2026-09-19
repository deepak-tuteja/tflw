// `M213` `S2` — joining a run's verdicts to the file on screen (`D1093`, `D1099`, `D1108`).
//
// **EVERY TEST HERE IS ABOUT THE SAME ONE-LINE MISTAKE**, which `D1093` names and this module is
// built to refuse: a line number is the most fragile join key there is, and the failure it
// produces is not a blank row but a *wrong* row — a ✓ beside an assertion the run never evaluated,
// in exactly the place a ✓ belongs. So the claims below are mostly negative ones: what the join
// must decline to show, and why declining is the correct answer rather than a missing feature.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { indexFromReport, indexFromSend } from '../src/ran.ts';
import type { RunReport, StepResult } from '../src/contract.ts';

const step = (over: Partial<StepResult> & Pick<StepResult, 'kind' | 'source' | 'line'>): StepResult => ({
  ok: true,
  durationMs: 3,
  ...over,
});

const report = (steps: readonly StepResult[], file = 'tests/checkout.tflw'): RunReport =>
  ({
    ok: true,
    env: 'local',
    startedAt: '2026-09-19T10:00:00.000Z',
    durationMs: 10,
    total: 1,
    passed: 1,
    failed: 0,
    seed: 1,
    now: '2026-09-19T10:00:00.000Z',
    insecure: false,
    tests: [{ kind: 'functional', name: 't', ok: true, durationMs: 10, file, steps }],
  }) as RunReport;

const BUFFER = [
  'test "checkout"',
  '  api GET /health',
  '  expect status equals 200',
  '  api POST /orders',
  '  expect status equals 201',
  '',
].join('\n');

test('a request and the statements under it are one group, keyed by the file’s own lines', () => {
  const index = indexFromReport(
    report([
      step({ kind: 'api', source: 'api GET /health', line: 2, response: { status: 200, bodyText: '{}' } as never }),
      step({ kind: 'expect', source: 'expect status equals 200', line: 3, detail: 'status = 200' }),
      step({ kind: 'api', source: 'api POST /orders', line: 4, response: { status: 201, bodyText: '{}' } as never }),
      step({ kind: 'expect', source: 'expect status equals 201', line: 5, detail: 'status = 201' }),
    ]),
    'tests/checkout.tflw',
    BUFFER,
  );
  assert.deepEqual([...index.keys()], [2, 4]);
  assert.equal(index.get(2)!.response!.status, 200);
  assert.equal(index.get(2)!.steps.get(3)!.detail, 'status = 200');
  assert.equal(index.get(4)!.steps.get(5)!.detail, 'status = 201');
  assert.equal(index.get(2)!.scope, 'run');
  assert.equal(index.get(2)!.at, '2026-09-19T10:00:00.000Z');
});

test('THE CLAIM: a line that has been retyped keeps its number and loses its verdict', () => {
  const edited = BUFFER.replace('expect status equals 200', 'expect status equals 204');
  const index = indexFromReport(
    report([
      step({ kind: 'api', source: 'api GET /health', line: 2, response: { status: 200, bodyText: '{}' } as never }),
      step({ kind: 'expect', source: 'expect status equals 200', line: 3, detail: 'status = 200' }),
    ]),
    'tests/checkout.tflw',
    edited,
  );
  assert.equal(index.get(2)!.steps.size, 0, 'the assertion was typed into — a ✓ there would be about bytes nobody has');
  assert.ok(index.has(2), 'and the request itself is untouched, so its response is still evidence about it');
});

test('THE CLAIM: a request inserted above shifts every line, and no verdict moves down with it', () => {
  const shifted = BUFFER.replace('  api GET /health', '  api GET /warmup\n  api GET /health');
  const index = indexFromReport(
    report([
      step({ kind: 'api', source: 'api GET /health', line: 2, response: { status: 200, bodyText: '{}' } as never }),
      step({ kind: 'expect', source: 'expect status equals 200', line: 3, detail: 'status = 200' }),
    ]),
    'tests/checkout.tflw',
    shifted,
  );
  // Line 2 now reads `api GET /warmup`. Keyed on the number alone, the 200 would appear beside a
  // request that has never been run — plausibly, because a request is where a status belongs.
  assert.equal(index.size, 0);
});

test('the response survives an assertion being added under it — which is what tick-to-verify does', () => {
  const ticked = BUFFER.replace('  expect status equals 200', '  expect status equals 200\n  expect body.ok equals true');
  const index = indexFromReport(
    report([
      step({ kind: 'api', source: 'api GET /health', line: 2, response: { status: 200, bodyText: '{"ok":true}' } as never }),
      step({ kind: 'expect', source: 'expect status equals 200', line: 3, detail: 'status = 200' }),
    ]),
    'tests/checkout.tflw',
    ticked,
  );
  assert.equal(index.get(2)!.response!.bodyText, '{"ok":true}', 'the request’s own line did not move');
  assert.equal(index.get(2)!.steps.get(3)!.ok, true, 'nor did the assertion above the insertion');
  assert.equal(index.get(2)!.steps.has(4), false, 'and the new line has never run, so it carries nothing');
});

test('a report about another file answers for nothing here', () => {
  const index = indexFromReport(
    report([step({ kind: 'api', source: 'api GET /health', line: 2 })], 'tests/other.tflw'),
    'tests/checkout.tflw',
    BUFFER,
  );
  assert.equal(index.size, 0);
});

test('a `./` in front of a path is not a different file', () => {
  const index = indexFromReport(
    report([step({ kind: 'api', source: 'api GET /health', line: 2 })], './tests/checkout.tflw'),
    'tests/checkout.tflw',
    BUFFER,
  );
  assert.equal(index.size, 1);
});

test('a suffix match cannot let a short name claim a long one’s verdicts', () => {
  const index = indexFromReport(
    report([step({ kind: 'api', source: 'api GET /health', line: 2 })], 'tests/out.tflw'),
    'tests/checkout.tflw',
    BUFFER,
  );
  assert.equal(index.size, 0, '`out.tflw` is a suffix of `checkout.tflw` as text and not as a path');
});

test('a send maps the scratch’s positional steps back onto this file’s lines', () => {
  const ran = indexFromSend({
    steps: [
      step({ kind: 'api', source: 'api GET /health', line: 99 }),
      step({ kind: 'api', source: 'api POST /orders', line: 101, response: { status: 201, bodyText: '{}' } as never }),
      step({ kind: 'expect', source: 'expect status equals 201', line: 102, detail: 'status = 201' }),
    ],
    requestLine: 4,
    attachedLines: [5],
    bufferText: BUFFER,
    startedAt: '2026-09-19T11:00:00.000Z',
  });
  assert.ok(ran !== null);
  assert.equal(ran.scope, 'send');
  assert.equal(ran.line, 4, 'the scratch ran it on line 101 and this file has it on line 4');
  assert.equal(ran.response!.status, 201);
  assert.equal(ran.steps.get(5)!.detail, 'status = 201');
});

test('a send is subject to the same text check — a row edited mid-run gets no mark', () => {
  const edited = BUFFER.replace('expect status equals 201', 'expect status equals 202');
  const ran = indexFromSend({
    steps: [
      step({ kind: 'api', source: 'api POST /orders', line: 101, response: { status: 201, bodyText: '{}' } as never }),
      step({ kind: 'expect', source: 'expect status equals 201', line: 102 }),
    ],
    requestLine: 4,
    attachedLines: [5],
    bufferText: edited,
    startedAt: '2026-09-19T11:00:00.000Z',
  });
  assert.equal(ran!.steps.size, 0);
});

test('a run with no api step in it is not a send result at all', () => {
  assert.equal(
    indexFromSend({
      steps: [step({ kind: 'expect', source: 'expect status equals 200', line: 3 })],
      requestLine: 4,
      attachedLines: [],
      bufferText: BUFFER,
      startedAt: '2026-09-19T11:00:00.000Z',
    }),
    null,
  );
});

test('the report’s own duration reaches the row — `StepResult` has carried it all along', () => {
  const index = indexFromReport(
    report([
      step({ kind: 'api', source: 'api GET /health', line: 2 }),
      step({ kind: 'expect', source: 'expect status equals 200', line: 3, durationMs: 417 }),
    ]),
    'tests/checkout.tflw',
    BUFFER,
  );
  assert.equal(index.get(2)!.steps.get(3)!.durationMs, 417);
});
