// M2: `wait until api` re-issues the request until its nested expects pass or wait times out
// (P#15, SPEC §5.5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource } from '@tflw/lang';
import { runProgram, SessionCache } from '../src/interpreter.js';
import { resolveConfig, selectEnv } from '../src/resolve.js';
import type { ResolvedConfig } from '../src/types.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { speculativeSpeakAt, SPECULATIVE_DIAGNOSIS_MS } from '../src/browser.js';
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

test('M182a: the cost `D936` buys — a budget of 5s or less can never produce a progress line (D937)', () => {
  // The measured consequence `D937` had to carry, asserted at the boundary rather than by running a
  // wait for five real seconds and watching nothing happen.
  //
  // `testFlow-tests` sets `defaults: timeout wait 5s`, and the guard is `budget > 2 x 3000`, so
  // `5000 > 6000` is false and the dogfood suite's own waits emit nothing — verified in that corpus
  // at 0 lines across three runs (`M182d`), which is where that claim belongs. What belongs HERE is
  // the rule that makes it true, and a rule about two numbers is tested as a function of two
  // numbers: exactly, on both sides, and at the point where it changes its mind.
  //
  // The end-to-end version of this cost the mutation sweep five seconds times every runtime
  // mutation — see `scripts/mutate.mjs` and `ci.yml`'s re-shard log. It also asserted an ABSENCE,
  // which is the weaker of the two shapes: this one pins the value.
  const t = 1000;
  assert.equal(speculativeSpeakAt(t, 5000), undefined, "this repository's own 5s budget stays silent");
  assert.equal(speculativeSpeakAt(t, SPECULATIVE_DIAGNOSIS_MS * 2), undefined, 'exactly 2x is silent — the guard is >, not >=');
  assert.equal(speculativeSpeakAt(t, SPECULATIVE_DIAGNOSIS_MS * 2 + 1), t + SPECULATIVE_DIAGNOSIS_MS, 'one millisecond past 2x speaks');
  assert.equal(speculativeSpeakAt(t, 7000), t + SPECULATIVE_DIAGNOSIS_MS, 'and it speaks AT the threshold, not at the budget');
  // The browser wait (`M125c`) and this one now read the same function, so this is one rule tested
  // once rather than the same expression written twice and compared by nobody (`D489`).
  assert.equal(speculativeSpeakAt(0, 30_000), SPECULATIVE_DIAGNOSIS_MS, "tflw's own 30s default speaks at 3s");
});

// `M187a` (`M181-02`, `D961`–`D964`): a poll is a request, and a `401` on it re-establishes the
// test's opted-in sessions on the same terms as an `api` step's (`P#99a`). Until this round the
// poll loop was the one request site in the runtime that received a `401` and consulted nothing —
// a session's login runs once per run and is cached (P#42), so a wait late in a long suite met a
// dead credential on its FIRST poll and sent it unchanged to the deadline.
//
// The fixture expires a token by REQUEST COUNT, not by the clock: a token serves `uses` resource
// requests and the next one is a `401`. That is the only way "two expiries inside one wait" is a
// deterministic count of logins rather than a race with a timer — and it is what makes `armed`
// (`D962`) testable at all: refresh on a `401`, disarm, re-arm on the first poll that is not a
// `401`, so the bound is once per EXPIRY and not once per wait.

function sessionWaitConfig(baseUrl: string, waitMs: number): ResolvedConfig {
  const configSource =
    `defaults\n  timeout wait ${waitMs}ms\n\n` +
    `env test default\n  api "${baseUrl}"\n\n` +
    `session admin\n  api POST /auth/login body { user: "a", pass: "b" }\n  capture body.token as token\n  header "Authorization" is "Bearer {token}"\n`;
  const parsed = parseConfigSource(configSource);
  assert.deepEqual(parsed.diagnostics, [], JSON.stringify(parsed.diagnostics));
  return resolveConfig(parsed.config, selectEnv(parsed.config, {}));
}

/** Tokens that die after `uses` resource requests each; `login` may be told to start failing. */
function countingAuth(uses: number, failLoginsFrom = Infinity) {
  let logins = 0;
  const remaining = new Map<string, number>();
  return {
    logins: () => logins,
    login: (_req: IncomingMessage, res: ServerResponse) => {
      logins++;
      if (logins >= failLoginsFrom) { json(res, 500, { error: 'auth is down' }); return; }
      const tok = `tok-${logins}`;
      remaining.set(tok, uses);
      json(res, 200, { token: tok });
    },
    /** Spend one use of the presented token; `false` is a `401`. */
    spend: (auth: string | undefined): boolean => {
      const tok = (auth ?? '').replace(/^Bearer /, '');
      const left = remaining.get(tok) ?? 0;
      if (left <= 0) return false;
      remaining.set(tok, left - 1);
      return true;
    },
  };
}

const refreshSteps = (steps: readonly { kind: string; detail?: string }[]) =>
  steps.filter((s) => s.kind === 'header' && (s.detail ?? '').includes('re-establish'));

test('M187a: a wait whose FIRST poll meets a dead cached session re-establishes it and polls on (D961, D964)', async () => {
  // One use per token: the `api` step spends the establishing token, so the wait's first poll is
  // the `401` — the shape a long suite produces in its last minutes.
  const auth = countingAuth(1);
  let served = 0;
  const server = await startFixtureServer({
    '/auth/login': auth.login,
    '/jobs/1': (req, res) => {
      if (!auth.spend(req.headers['authorization'])) { json(res, 401, { error: 'expired' }); return; }
      served++;
      json(res, 200, { status: 'done' });
    },
  });
  const source = `test "old session" as admin\n  api GET /jobs/1\n  expect status equals 200\n  wait until api GET /jobs/1\n    expect body.status equals "done"\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, sessionWaitConfig(server.baseUrl, 3000), { source, sessionCache: new SessionCache() });
  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(auth.logins(), 2, 'establish once, one re-login inside the wait');
  assert.equal(served, 2, 'the api step and the wait\'s second poll');
  const steps = asEntry(report.tests[0], 'functional').steps;
  const waitStep = steps.find((s) => s.kind === 'wait');
  assert.ok(waitStep && waitStep.ok, JSON.stringify(steps, null, 2));
  assert.match(waitStep.detail ?? '', /^passed after 2 attempts/);
  // `D964` — the re-establish is the wait's own evidence, and it precedes the wait's result.
  const refreshed = refreshSteps(steps);
  assert.equal(refreshed.length, 1, JSON.stringify(steps, null, 2));
  assert.ok(steps.indexOf(refreshed[0]!) < steps.indexOf(waitStep), 'the refresh row is reported before the wait it happened inside');
  await server.close();
});

test('M187a: two expiries inside one wait are two re-logins — the bound is per expiry, not per wait (D962)', async () => {
  // Each token serves two resource requests. Establish → tok-1: the api step + poll 1. Poll 2 is a
  // 401 → tok-2: polls 2', 3. Poll 4 is a 401 → tok-3: poll 4', which is the fifth served request
  // and the one that satisfies. Once-per-wait would have died at poll 4 with the budget unspent.
  const auth = countingAuth(2);
  let served = 0;
  const server = await startFixtureServer({
    '/auth/login': auth.login,
    '/jobs/1': (req, res) => {
      if (!auth.spend(req.headers['authorization'])) { json(res, 401, { error: 'expired' }); return; }
      served++;
      json(res, 200, { status: served >= 5 ? 'done' : 'running' });
    },
  });
  const source = `test "long wait" as admin\n  api GET /jobs/1\n  expect status equals 200\n  wait until api GET /jobs/1\n    expect body.status equals "done"\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, sessionWaitConfig(server.baseUrl, 5000), { source, sessionCache: new SessionCache() });
  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(auth.logins(), 3, 'establish once, then one re-login per expiry');
  const steps = asEntry(report.tests[0], 'functional').steps;
  assert.equal(refreshSteps(steps).length, 2);
  assert.match(steps.find((s) => s.kind === 'wait')!.detail ?? '', /^passed after 6 attempts/);
  await server.close();
});

test('M187a: a credential that stays 401 after a successful re-login is refreshed once, then the wait times out saying so (D962, D963)', async () => {
  const auth = countingAuth(1);
  const server = await startFixtureServer({
    '/auth/login': auth.login,
    // The account itself lost access — re-auth mints a fresh token and it is refused too.
    '/jobs/1': (_req, res) => json(res, 401, { error: 'forbidden' }),
  });
  const source = `test "revoked" as admin\n  wait until api GET /jobs/1\n    expect status equals 200\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, sessionWaitConfig(server.baseUrl, 800), { source, sessionCache: new SessionCache() });
  assert.equal(report.ok, false);
  assert.equal(auth.logins(), 2, 'establish once, ONE re-login, then no more — the wait never re-armed');
  const steps = asEntry(report.tests[0], 'functional').steps;
  assert.equal(refreshSteps(steps).length, 1);
  const detail = steps.find((s) => s.kind === 'wait')!.detail ?? '';
  // `D963` — the one failing exit is still the timeout, and its line now names the credential.
  assert.match(detail, /^timed out after 800ms \(\d+ attempts\): last poll 401 after 1 session refresh; /);
  await server.close();
});

test('M187a: a re-login that itself fails does not end the wait, and an anonymous wait is untouched (D963, D961)', async () => {
  // The establishing login (the first) succeeds and every later one answers 500: the api step
  // spends the token, the wait's first poll is a 401, and the re-login it triggers fails.
  const auth = countingAuth(1, 2);
  const server = await startFixtureServer({
    '/auth/login': auth.login,
    '/jobs/1': (req, res) => {
      if (!auth.spend(req.headers['authorization'])) { json(res, 401, { error: 'expired' }); return; }
      json(res, 200, { status: 'done' });
    },
  });
  const source = `test "auth down" as admin\n  api GET /jobs/1\n  expect status equals 200\n  wait until api GET /jobs/1\n    expect body.status equals "done"\n`;
  const { program } = parseSource(source);
  const config = sessionWaitConfig(server.baseUrl, 800);
  const { report } = await runProgram(program, config, { source, sessionCache: new SessionCache() });
  assert.equal(report.ok, false);
  assert.equal(auth.logins(), 2, 'one failed re-login attempt, not a loop of them');
  const steps = asEntry(report.tests[0], 'functional').steps;
  const failedRefresh = steps.find((s) => s.kind === 'header' && (s.detail ?? '').includes('failed'));
  assert.ok(failedRefresh, JSON.stringify(steps, null, 2));
  assert.match(steps.find((s) => s.kind === 'wait')!.detail ?? '', /^timed out after 800ms/);

  // Anonymous control: no `as admin`, so `ctx.sessionNames` is empty and nothing here runs — the
  // 401 is an unsatisfied poll exactly as before this round, with no refresh text in the message.
  const anon = `test "anon"\n  wait until api GET /jobs/1\n    expect status equals 200\n`;
  const before = auth.logins();
  const { report: anonReport } = await runProgram(parseSource(anon).program, config, { source: anon, sessionCache: new SessionCache() });
  assert.equal(anonReport.ok, false);
  assert.equal(auth.logins(), before, 'an anonymous wait never logs in');
  const anonSteps = asEntry(anonReport.tests[0], 'functional').steps;
  assert.equal(refreshSteps(anonSteps).length, 0);
  assert.doesNotMatch(anonSteps.find((s) => s.kind === 'wait')!.detail ?? '', /session refresh/);
  await server.close();
});
