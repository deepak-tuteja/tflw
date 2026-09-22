// `M213` `S2` — joining a run's verdicts to the file on screen (`D1093`, `D1099`, `D1108`).
//
// **EVERY TEST HERE IS ABOUT THE SAME ONE-LINE MISTAKE**, which `D1093` names and this module is
// built to refuse: a line number is the most fragile join key there is, and the failure it
// produces is not a blank row but a *wrong* row — a ✓ beside an assertion the run never evaluated,
// in exactly the place a ✓ belongs. So the claims below are mostly negative ones: what the join
// must decline to show, and why declining is the correct answer rather than a missing feature.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { groupFor, indexFromReport, indexFromSend } from '../src/ran.ts';
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

test('a send brings back the response and no verdict at all — `M215` `A1`', () => {
  const index = indexFromSend({
    steps: [
      step({ kind: 'api', source: 'api GET /health', line: 99 }),
      step({ kind: 'api', source: 'api POST /orders', line: 101, response: { status: 201, bodyText: '{}' } as never }),
      // A capture is what follows a request in a scratch now; an `expect` cannot, because
      // `withoutAssertions` took every one of them out before the file was written.
      step({ kind: 'capture', source: 'capture body.total as total', line: 102, detail: 'total = 2550' }),
    ],
    lines: new Map([[101, 4]]),
    bufferText: BUFFER,
    startedAt: '2026-09-19T11:00:00.000Z',
  });
  const ran = index.get(4);
  assert.ok(ran !== undefined);
  assert.equal(ran.scope, 'send');
  assert.equal(ran.line, 4, 'the scratch ran it on line 101 and this file has it on line 4');
  assert.equal(ran.response!.status, 201);
  assert.equal(ran.steps.size, 0, 'a send grades nothing — a verdict comes from a run');
});

// ── `M225` `A` — a send indexes every request it issued (`D1216`) ─────────────────────────────
//
// GATE 2 of `PLAN_M225_SEND_AND_COMPOSER.md` §5, and the mutation that reddens it is *index only
// the last step* — which is precisely what this function did before this round, so the negative
// control is the shipped behaviour of the previous milestone.

test('a two-request send writes an entry per request, not one — `M225` gate 2', () => {
  const index = indexFromSend({
    steps: [
      step({ kind: 'api', source: 'api GET /products', line: 99, response: { status: 200, bodyText: '"first"' } as never }),
      step({ kind: 'api', source: 'api GET /health', line: 101, response: { status: 204, bodyText: '"last"' } as never }),
    ],
    lines: new Map([[99, 2], [101, 4]]),
    bufferText: BUFFER,
    startedAt: '2026-09-19T11:00:00.000Z',
  });
  assert.equal(index.size, 2);
  assert.equal(index.get(2)!.response!.bodyText, '"first"');
  assert.equal(index.get(2)!.response!.status, 200);
  assert.equal(index.get(4)!.response!.bodyText, '"last"');
  assert.equal(index.get(4)!.response!.status, 204);
});

// **A hook's request is in the same step list and must not claim a row.** `before each` runs
// inside the test's own steps (`interpreter.ts`'s `runTestAttemptBody`) and `after each` runs
// after them, which is why the join is by the scratch's own line rather than by position from
// either end — the plan said *position from the first* and the runtime says that cannot work.
test('a step the scratch printed outside the kept test is skipped, not attributed', () => {
  const index = indexFromSend({
    steps: [
      step({ kind: 'api', source: 'api POST /login', line: 12, response: { status: 200, bodyText: '"hook"' } as never }),
      step({ kind: 'api', source: 'api GET /products', line: 99, response: { status: 200, bodyText: '"mine"' } as never }),
    ],
    lines: new Map([[99, 2]]),
    bufferText: BUFFER,
    startedAt: '2026-09-19T11:00:00.000Z',
  });
  assert.equal(index.size, 1, 'the hook ran and is not a row in this file');
  assert.equal(index.get(2)!.response!.bodyText, '"mine"');
});

test('a run with no api step in it indexes nothing', () => {
  assert.equal(
    indexFromSend({
      steps: [step({ kind: 'expect', source: 'expect status equals 200', line: 3 })],
      lines: new Map([[99, 4]]),
      bufferText: BUFFER,
      startedAt: '2026-09-19T11:00:00.000Z',
    }).size,
    0,
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

/* ── `M232` — a verdict group is the thing the assertions under it read (`M220-02`, `D1270`) ────
 *
 * The defect was not that browser verdicts grouped badly. Nothing opened a group in a browser test
 * at all, so `open === null` skipped every step and the map came back **empty by construction** —
 * the pane drew no marks beside assertions whose status chip said they had run.
 */

const BROWSER_BUFFER = [
  'test "checkout"',
  '  open "/cart"',
  '  expect text "Cart" is visible',
  '  click button "Checkout"',
  '  expect text "Payment" is visible',
  '  screenshot "paying"',
  '  expect text "Total" is visible',
  '',
].join('\n');

test('`M232` `A`: every action opens a group, and a browser test’s assertions finally draw marks (`D1270`)', () => {
  const index = indexFromReport(
    report([
      step({ kind: 'open', source: 'open "/cart"', line: 2 }),
      step({ kind: 'expect', source: 'expect text "Cart" is visible', line: 3, detail: 'visible' }),
      step({ kind: 'click', source: 'click button "Checkout"', line: 4 }),
      step({ kind: 'expect', source: 'expect text "Payment" is visible', line: 5, detail: 'visible' }),
      step({ kind: 'screenshot', source: 'screenshot "paying"', line: 6 }),
      step({ kind: 'expect', source: 'expect text "Total" is visible', line: 7, detail: 'visible' }),
    ]),
    'tests/checkout.tflw',
    BROWSER_BUFFER,
  );

  /* **Two groups, not three.** `screenshot` changes nothing a later assertion reads, so opening one
     on it would cut the click's group in half and strand line 7's mark under a step that did not
     produce what it read. That is the whole of why `OPENS_GROUP` is a named set rather than
     *anything that is not an `expect`*. */
  assert.deepEqual([...index.keys()], [2, 4], `an action opens a group and a screenshot does not:\n${JSON.stringify([...index.keys()])}`);
  assert.equal(index.get(2)!.steps.get(3)!.detail, 'visible', 'the assertion under `open` reads the page it left');
  /* Lines 5, 6 and 7 — every step under the click, which is the shape a request's group has always
     had: a `capture` sits in one the same way this `screenshot` does. What `OPENS_GROUP` decides is
     what starts a group, never what a group is allowed to hold. */
  assert.deepEqual([...index.get(4)!.steps.keys()], [5, 6, 7], 'the click keeps everything that reads the page IT left');

  /* **A browser group has no response**, which is the truth about it rather than a gap: `Ran.response`
     has always been `| null`, and `indexFromSend` already produced groups empty in the other
     direction. */
  assert.equal(index.get(2)!.response, null);
  assert.equal(index.get(4)!.response, null);
});

test('`M232` `B`: editing one action drops only the marks under that action (`D1270`)', () => {
  /* `stillReads` invalidates identically for an action and for a request, which is the half of
     `D1270` that says *the API door's own rule, stated once instead of twice*. Retype the click and
     its group goes; the `open` above it is untouched. */
  const edited = BROWSER_BUFFER.replace('click button "Checkout"', 'click button "Pay now"');
  const index = indexFromReport(
    report([
      step({ kind: 'open', source: 'open "/cart"', line: 2 }),
      step({ kind: 'expect', source: 'expect text "Cart" is visible', line: 3, detail: 'visible' }),
      step({ kind: 'click', source: 'click button "Checkout"', line: 4 }),
      step({ kind: 'expect', source: 'expect text "Payment" is visible', line: 5, detail: 'visible' }),
    ]),
    'tests/checkout.tflw',
    edited,
  );
  assert.deepEqual([...index.keys()], [2], 'the edited action loses its group; the one above it does not');
  assert.equal(index.get(2)!.steps.get(3)!.detail, 'visible');
});

test('the control: the API grouping is byte-for-byte what it was', () => {
  /* Every assertion in `A` is about marks appearing. An implementation that opened a group on
     **every** step would satisfy them and destroy the API door, so the original claim is re-made
     here against the same buffer: two groups, each holding its own assertion, each with a
     response. */
  const index = indexFromReport(
    report([
      step({ kind: 'api', source: 'api GET /health', line: 2, response: { status: 200, bodyText: '{}' } as never }),
      step({ kind: 'capture', source: 'capture body.id as id', line: 3, detail: 'id = 1 (captured)' }),
      step({ kind: 'expect', source: 'expect status equals 200', line: 4, detail: 'status = 200' }),
    ]),
    'tests/checkout.tflw',
    'test "checkout"\n  api GET /health\n  capture body.id as id\n  expect status equals 200\n',
  );
  assert.deepEqual([...index.keys()], [2], 'a `capture` is inside the request’s group, never a group of its own');
  assert.deepEqual([...index.get(2)!.steps.keys()], [3, 4]);
  assert.equal(index.get(2)!.response!.status, 200);
});

test('`M232` `C`: a statement with no request above it finds the action’s group, bounded to its own declaration (`D1270`)', () => {
  /**
   * **The half `indexFromReport` alone does not fix.** `ComposePane` found a statement's verdicts
   * by asking which **request** it is attached to — the right question on the API door and
   * unanswerable on every other one, so a browser test's assertion got `null` and drew no mark.
   * Populating the index and never reading it would have closed `M220-02` on paper.
   */
  const index = indexFromReport(
    report([
      step({ kind: 'open', source: 'open "/cart"', line: 2 }),
      step({ kind: 'expect', source: 'expect text "Cart" is visible', line: 3, detail: 'visible' }),
      step({ kind: 'click', source: 'click button "Checkout"', line: 4 }),
      step({ kind: 'expect', source: 'expect text "Payment" is visible', line: 5, detail: 'visible' }),
      step({ kind: 'screenshot', source: 'screenshot "paying"', line: 6 }),
      step({ kind: 'expect', source: 'expect text "Total" is visible', line: 7, detail: 'visible' }),
    ]),
    'tests/checkout.tflw',
    BROWSER_BUFFER,
  );

  assert.equal(groupFor(index, 1, 3)!.line, 2, 'the assertion under `open` reads the page `open` left');
  assert.equal(groupFor(index, 1, 5)!.line, 4, 'and the one under the click reads the page the CLICK left');
  assert.equal(groupFor(index, 1, 7)!.line, 4, 'a `screenshot` between them opens nothing, so line 7 still belongs to the click');
  assert.equal(groupFor(index, 1, 2)!.line, 2, 'an action is in its own group — it is what the group is about');

  /**
   * **Bounded to the declaration, and this is the assertion that matters.** Without `declLine` a
   * statement in a test with no action above it attaches to the last action of the *previous*
   * declaration — a mark in exactly the place a mark belongs, about something else, which is the
   * failure `D1093` exists to refuse.
   */
  assert.equal(groupFor(index, 4, 7)!.line, 4, 'a declaration starting AT a group keeps it — the bound is inclusive');
  assert.equal(groupFor(index, 5, 7), null, 'a declaration starting below every group gets nothing, not the group above it');
  assert.equal(groupFor(index, 1, 1), null, 'and nothing is found above the first action');
});
