// M2: `wait until api` re-issues the request until its nested expects pass or wait times out
// (P#15, SPEC §5.5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('polls until the nested expects pass, then continues the test', async () => {
  let calls = 0;
  const server = await startFixtureServer({
    '/poll': (_req, res) => {
      calls++;
      json(res, 200, { status: calls >= 3 ? 'shipped' : 'pending' });
    },
  });

  const source = `test "waits for shipment"
  wait until api GET /poll
    expect body.status equals "shipped"
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  assert.ok(calls >= 3);
  assert.match(report.tests[0]!.steps[0]!.detail ?? '', /passed after 3 attempts/);

  await server.close();
});

test('times out and fails the test when the condition never holds', async () => {
  const server = await startFixtureServer({
    '/poll': (_req, res) => json(res, 200, { status: 'pending' }),
  });

  const source = `test "never ships"
  wait until api GET /poll
    expect body.status equals "shipped"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl, { wait: 500 }), { source });

  assert.equal(report.ok, false);
  // `M115-02`, closed by M143b. This assertion used to be load-sensitive: under CPU contention the
  // poll's own request timeout — clamped by decision 67 to what was left of the 500ms budget — fired
  // before the wait deadline and the detail read `request timed out after 195.9ms` instead. Which
  // deadline "won" depended on how busy the machine was, so the failure arrived as a spurious red on
  // a contended box, and `mutate.mjs` treats a red baseline as fatal to a twenty-minute sweep. It is
  // deterministic now because the clamp's own firing is reported as what it is, below.
  assert.match(report.tests[0]!.steps[0]!.detail ?? '', /timed out after 500ms/);

  await server.close();
});

test('carries its own `header` lines on every poll (gap #4)', async () => {
  let calls = 0;
  const server = await startFixtureServer({
    '/poll': (_req, res) => {
      calls++;
      json(res, 200, { status: calls >= 3 ? 'shipped' : 'pending' });
    },
  });

  const source = `test "polls with an auth header"
  let token = "secret-123"
  wait until api GET /poll
    header "Authorization" is "Bearer {token}"
    expect body.status equals "shipped"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  assert.ok(calls >= 3);
  const received = server.received.get('/poll')!;
  assert.equal(received.length, calls);
  for (const req of received) assert.equal(req.headers['authorization'], 'Bearer secret-123');

  await server.close();
});

test('a hanging single poll fails close to the wait deadline, not the full request timeout (decision 67)', async () => {
  const server = await startFixtureServer({
    '/poll': (_req, res) => {
      setTimeout(() => json(res, 200, { status: 'shipped' }), 5000);
    },
  });

  const source = `test "endpoint hangs"
  wait until api GET /poll
    expect body.status equals "shipped"
`;
  const { program } = parseSource(source);
  const config = testConfig(server.baseUrl, { wait: 300, api: 30000 });

  const startedAt = performance.now();
  const { report } = await runProgram(program, config, { source });
  const elapsed = performance.now() - startedAt;

  assert.equal(report.ok, false);
  // Bounded well under the 30s step timeout — proves the poll's own request timeout was clamped to
  // the remaining wait budget instead of the much larger `timeouts.step` default.
  assert.ok(elapsed < 3000, `expected to fail quickly, took ${elapsed}ms`);

  await server.close();
});

test('a poll aborted by decision 67’s own clamp reports the WAIT deadline, not the clamped value (M115-02)', async () => {
  // The clamp shortens each poll's request timeout to what is left of the wait budget. When that
  // shortened timeout is what fires, the deadline that actually expired is the wait one — so
  // reporting the abort verbatim named a millisecond figure the author never wrote, about a clock
  // they were not watching. Reproduced on demand rather than waited for: poll 1 answers instantly
  // and leaves a sliver of budget, poll 2 hangs, and the sliver is what aborts it.
  let calls = 0;
  const server = await startFixtureServer({
    '/poll': (_req, res) => {
      calls++;
      if (calls === 1) return json(res, 200, { status: 'pending' });
      setTimeout(() => json(res, 200, { status: 'pending' }), 5000);
    },
  });

  const source = `test "never ships"
  wait until api GET /poll
    expect body.status equals "shipped"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl, { wait: 500 }), { source });

  assert.equal(report.ok, false);
  const detail = report.tests[0]!.steps[0]!.detail ?? '';
  // 500 is the number in the config. The value the clamp computed is not a number anybody chose.
  assert.match(detail, /^timed out after 500ms \(2 attempts\)/);
  assert.doesNotMatch(detail, /request timed out after/);
  // The last completed poll's own failure is still what the detail explains — the re-attribution
  // changes which deadline is named, not what the author is told about their assertion.
  assert.match(detail, /expected body\.status to equal "shipped", but got "pending"/);

  await server.close();
});

test('an author’s OWN shorter `timeout` on the poll still reports as a request timeout', async () => {
  // The control for the test above, and the reason it checks `clampedByWait` rather than simply
  // swallowing every timeout: a `timeout` written on the request means what it says. Only the
  // clamp's own firing is re-attributed, because only the clamp is a deadline the author did not
  // choose. Without this, M143b would have silently converted a real, deliberate request timeout
  // into a wait timeout and reported a budget that had not expired.
  const server = await startFixtureServer({
    '/poll': (_req, res) => {
      setTimeout(() => json(res, 200, { status: 'shipped' }), 5000);
    },
  });

  const source = `test "slow endpoint"
  wait until api GET /poll timeout 100ms
    expect body.status equals "shipped"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl, { wait: 5000 }), { source });

  assert.equal(report.ok, false);
  const detail = report.tests[0]!.steps[0]!.detail ?? report.tests[0]!.steps[0]!.error ?? '';
  assert.match(detail, /request timed out after 100ms/);

  await server.close();
});

// ---- M147d (`A3-10`, D640): the two budgets, and the one the row mistook for the other ---------

test('M147d: `timeout 30s` on the poll does not lengthen the wait by a millisecond', async () => {
  // The program `A3-10`'s author would have written, and the reason the row's asymmetry is not one.
  // `wait until api … timeout 30s` parses — that is the acceptance the row observed — but `timeout`
  // here is `ApiRequestSpec.timeoutMs`, one poll's request budget, which decision 67 then clamps to
  // whatever is left of the wait deadline. The step still gives up at `timeout wait`. So the
  // capability the locator form was said to be missing did not exist on this form either.
  const server = await startFixtureServer({
    '/poll': (_req, res) => json(res, 200, { status: 'pending' }),
  });

  const source = `test "never ships"
  wait until api GET /poll timeout 30s
    expect body.status equals "shipped"
`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);
  const started = performance.now();
  const { report } = await runProgram(program, testConfig(server.baseUrl, { wait: 500 }), { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.steps[0]!.detail ?? '', /timed out after 500ms/);
  // Not merely the message: had `timeout 30s` set the wait budget, this would have taken 30 seconds.
  assert.ok(performance.now() - started < 10_000, 'the 30s request timeout must not have become the step budget');

  await server.close();
});

test('M147d: `timeout wait` on the poll is the one that does, overriding the env for this step', async () => {
  // The widening, in the lengthening direction: the env allows 200ms, the endpoint settles on the
  // third call, and only the step's own 5s budget gets the poll loop there. Without `waitMs` reaching
  // the deadline this fails on the env's 200ms.
  let calls = 0;
  const server = await startFixtureServer({
    '/poll': (_req, res) => {
      calls++;
      json(res, 200, { status: calls >= 3 ? 'shipped' : 'pending' });
    },
  });

  const source = `test "waits longer than the env allows"
  wait until api GET /poll timeout wait 5s
    expect body.status equals "shipped"
`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);
  const { report } = await runProgram(program, testConfig(server.baseUrl, { wait: 200 }), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  assert.ok(calls >= 3);

  await server.close();
});

test('M147d: the timeout report quotes the budget that actually expired', async () => {
  // The shortening direction, and the assertion that pins *which* number reaches the reader: the env
  // says 5s, the step says 300ms, and a report naming 5000ms would describe a deadline that had not
  // passed.
  const server = await startFixtureServer({
    '/poll': (_req, res) => json(res, 200, { status: 'pending' }),
  });

  const source = `test "gives up early on purpose"
  wait until api GET /poll timeout wait 300ms
    expect body.status equals "shipped"
`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);
  const { report } = await runProgram(program, testConfig(server.baseUrl, { wait: 5000 }), { source });

  assert.equal(report.ok, false);
  const detail = report.tests[0]!.steps[0]!.detail ?? '';
  assert.match(detail, /timed out after 300ms/);
  assert.doesNotMatch(detail, /5000ms/);

  await server.close();
});
