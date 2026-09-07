// M2: `wait until api` re-issues the request until its nested expects pass or wait times out
// (P#15, SPEC §5.5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';
import { asEntry } from './__helpers__/entry.js';

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
  assert.match(asEntry(report.tests[0], 'functional').steps[0]!.detail ?? '', /passed after 3 attempts/);

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
  assert.match(asEntry(report.tests[0], 'functional').steps[0]!.detail ?? '', /timed out after 500ms/);

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
  const detail = asEntry(report.tests[0], 'functional').steps[0]!.detail ?? '';
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
  // `M173d3` — the second branch of this chain read `StepResult.error`, which does not exist:
  // `error` is on `AttemptResult`, not on a step. So the fallback has always evaluated to
  // `undefined` and the expression was `detail ?? ''` wearing a third option. Removed rather than
  // repointed — if `detail` were ever absent the empty string fails the match below, which is the
  // right outcome and is what was already happening.
  const step = asEntry(report.tests[0], 'functional').steps[0]!;
  const detail = step.detail ?? '';
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
  assert.match(asEntry(report.tests[0], 'functional').steps[0]!.detail ?? '', /timed out after 500ms/);
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
  const detail = asEntry(report.tests[0], 'functional').steps[0]!.detail ?? '';
  assert.match(detail, /timed out after 300ms/);
  assert.doesNotMatch(detail, /5000ms/);

  await server.close();
});


// ---- M182a (`D936`/`D937`, `M181-01`): a transient is a poll that did not satisfy -------------

/** The speculative line is written straight to stderr (`D269`/`D937`), so observing it means owning
 * the stream for the duration of the run. Sibling of the helper in `browser-diagnosis.test.ts`. */
async function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; stderr: string }> {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  (process.stderr as { write: unknown }).write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
  try {
    const result = await fn();
    return { result, stderr: chunks.join('') };
  } finally {
    (process.stderr as { write: unknown }).write = original;
  }
}

test('M182a: a poll whose body is the wrong SHAPE is a poll that did not satisfy, and the wait goes on (D936)', async () => {
  // `M181-01`, measured on the build box 2026-09-07. The subject of a poll's condition changes with
  // the response: a `200` body is the array being waited for, a `401` problem+json body is an
  // object, and `count()` throws on the second. Uncaught, that one transient ended a 5s wait 742ms
  // early and reported a subject type — so the step could not survive a token expiring, a 503, or
  // any other momentary non-answer, which is precisely what a wait exists to sit through.
  let calls = 0;
  const server = await startFixtureServer({
    '/poll': (_req, res) => {
      calls++;
      if (calls < 3) return json(res, 401, { type: 'about:blank', title: 'Unauthorized', status: 401 });
      json(res, 200, [{ id: 1 }, { id: 2 }]);
    },
  });

  const source = `test "outlives a transient"
  wait until api GET /poll
    expect body has count 2
`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);
  const { report } = await runProgram(program, testConfig(server.baseUrl, { wait: 5000 }), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const detail = asEntry(report.tests[0], 'functional').steps[0]!.detail ?? '';
  // Not merely green: green *after waiting*. A wait satisfied by its first poll is an assertion
  // spelled like a wait, which is the other half of what `M181-01` measured.
  assert.match(detail, /passed after 3 attempts/);
  assert.equal(calls, 3);

  await server.close();
});

test('M182a: a body that is never the right shape fails through the TIMEOUT exit, carrying the matcher text (D936)', async () => {
  // The control on the line above, and the part that keeps the author informed. `D936` does not
  // swallow the matcher's complaint — it relocates it behind the `timed out after …` prefix, which
  // is the only observable that says which of this function's exits ran. Before, the detail was the
  // bare matcher text with no prefix, naming the shape and neither the budget nor the attempts.
  const server = await startFixtureServer({
    '/poll': (_req, res) => json(res, 401, { type: 'about:blank', title: 'Unauthorized', status: 401 }),
  });

  const source = `test "never the right shape"
  wait until api GET /poll
    expect body has count 2
`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, []);
  const { report } = await runProgram(program, testConfig(server.baseUrl, { wait: 500 }), { source });

  assert.equal(report.ok, false);
  const detail = asEntry(report.tests[0], 'functional').steps[0]!.detail ?? '';
  assert.match(detail, /^timed out after 500ms \(\d+ attempts?\)/);
  assert.match(detail, /`has count` expects an array \(or string, or `body bytes`\) subject, got object/);

  await server.close();
});

test('M182a: the cost `D936` buys — a wait under this repository’s own 5s budget stays silent (D937)', async () => {
  // The measured consequence the plan required this test to carry. `M125c`'s guard is
  // `budget > 3000 * 2`, and `testFlow-tests` sets `defaults: timeout wait 5s` — `5000 > 6000` is
  // false, so the dogfood suite's own waits emit nothing. Asserting the absence of the line under a
  // budget that CAN produce one would be the real assertion; asserting it under 5s without saying
  // why would be `M141`, an instrument pointed away from its corpus. It is pointed here on purpose.
  const server = await startFixtureServer({
    '/poll': (_req, res) => json(res, 200, { status: 'pending' }),
  });

  const source = `test "quiet under a short budget"
  wait until api GET /poll
    expect body.status equals "shipped"
`;
  const { program } = parseSource(source);
  const { result, stderr } = await captureStderr(() => runProgram(program, testConfig(server.baseUrl, { wait: 5000 }), { source }));

  assert.equal(result.report.ok, false);
  assert.doesNotMatch(stderr, /⏳ tflw:/);

  await server.close();
});

test('M182a: a budget with room to spare says so at 3s, once, and keeps polling to its own deadline (D937)', async () => {
  // `M125c`'s line, on `M125c`'s threshold, for the API form. The three things it must name are the
  // three the locator line names: what is being waited on, why the last poll did not satisfy, and
  // how much longer this will go on. The `once` assertion is the one that matters most — a line per
  // poll at `WAIT_POLL_INTERVAL_MS` would be twelve of them.
  const server = await startFixtureServer({
    '/poll': (_req, res) => json(res, 200, { status: 'pending' }),
  });

  const source = `test "speaks, then carries on"
  wait until api GET /poll
    expect body.status equals "shipped"
`;
  const { program } = parseSource(source);
  const startedAt = performance.now();
  const { result, stderr } = await captureStderr(() => runProgram(program, testConfig(server.baseUrl, { wait: 7000 }), { source }));
  const elapsed = performance.now() - startedAt;

  assert.equal(result.report.ok, false);
  assert.match(stderr, /⏳ tflw: `GET .*\/poll` has not satisfied its condition after 3s/);
  assert.match(stderr, /expected body\.status to equal "shipped", but got "pending"/);
  assert.match(stderr, /still waiting, up to 7s/);
  assert.equal(stderr.match(/⏳ tflw:/g)?.length, 1, 'once per step, not once per poll');
  // The deadline does not move. A progress line that quietly became a shorter timeout would turn a
  // slow service's green suite red — `D248`'s own non-negotiable, restated on this form.
  assert.ok(elapsed >= 7000, `the wait must still run its full budget, took ${elapsed}ms`);

  await server.close();
});
