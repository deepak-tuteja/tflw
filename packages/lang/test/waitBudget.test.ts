// M147d (`A3-10`, D627, D640) — a per-step wait budget, and the two quantities the row conflated.
//
// `A3-10` reads: *`wait until <locator>` cannot take a per-step timeout; the api form can.* Both
// halves are true as observations. `wait until api GET /jobs timeout 30s` parses; `wait until button
// "Go" is enabled timeout 30s` is `TF010` with M84's hint pointing at `tflw.config`. Under D627's
// rider the narrower side should gain what the wider one has.
//
// **Measuring what the wider side actually has falsified that.** On the api form `timeout` is
// `ApiRequestSpec.timeoutMs` — how long *one poll's HTTP request* may take — and decision 67 then
// clamps even that to whatever is left of the wait deadline. It cannot extend the wait by a
// millisecond. Two tests already in `wait-until-api.test.ts` say so from both directions: *a hanging
// single poll fails close to the wait deadline, not the full request timeout* and *an author's OWN
// shorter `timeout` on the poll still reports as a request timeout*. This file adds the third,
// which is the one an author who filed `A3-10` would have written: the whole step still gives up at
// `timeout wait`, with `timeout 30s` on the line.
//
// So the quantity the row's author wanted — how long this `wait until` may poll — was
// un-overridable on **both** forms. The asymmetry was in the spelling, not in the capability, and
// copying the bare spelling across would have made one word mean the request budget on one sibling
// and the step budget on the other inside a single statement. D640 widens the real gap instead, on
// both forms at once, under a spelling that names the config key it overrides.
//
// Two consequences the row does not name, both found by building it:
//
//  1. **`TF055` would have gone false-positive on the new grammar's very first use.** It compares a
//     `for <duration>` hold against `timeout wait` read from the resolved env, so `for 60s timeout
//     wait 2m` — a perfectly satisfiable program — was reported as impossible against the env's 30s
//     default. Widening the second operand was not optional.
//  2. **`TF055`'s reach grew with it.** With an in-file budget both operands are in the file, so the
//     check no longer needs a resolved env and now fires for an editor that has none. Its *tier*
//     deliberately did not move — see `checkHoldWindows` for the condition on revisiting that.
//
// **What did not change is asserted as hard as what did.** A bare `timeout` on a locator wait is
// still `TF010`; only its hint changed, to name the clause that now exists. `wait until api …
// timeout 30s` still means exactly what it meant. A plain `api` step still has no wait budget.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, checkHoldWindows, Codes, type EnvTimeouts } from '../src/index.js';
import type { WaitUntilApiStmt, WaitUntilUiStmt } from '../src/ast.js';

const WAIT_30S: EnvTimeouts = { envName: 'local', wait: 30_000 };

/** Diagnostic codes from parsing a step body. */
const stepCodes = (body: string): string[] => parseSource(`test "t"\n${body}`).diagnostics.map((d) => d.code);

/** The first diagnostic's message and hint, joined — for the sentences that had to move or stay. */
const said = (body: string): string => {
  const d = parseSource(`test "t"\n${body}`).diagnostics[0];
  return d ? `${d.message} | ${d.hint ?? ''}` : '';
};

/** The first step of a fixture that must parse cleanly. */
const firstStep = (body: string): Record<string, unknown> => {
  const { program, diagnostics } = parseSource(`test "t"\n${body}`);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${body}`);
  return program.tests[0]!.body[0] as unknown as Record<string, unknown>;
};

/** `TF055` over one body, with or without a resolved env. */
const holdDiags = (body: string, env: EnvTimeouts | undefined) => {
  const { program, diagnostics } = parseSource(`test "t"\n${body}`);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${body}`);
  return checkHoldWindows(program, env ? { envTimeouts: env } : {});
};

test('the locator form parses its own budget into `waitMs`', () => {
  const { program, diagnostics } = parseSource('test "t"\n  open "/x"\n  wait until button "Go" is enabled timeout wait 2m\n');
  assert.deepEqual(diagnostics, []);
  const step = program.tests[0]!.body[1] as unknown as WaitUntilUiStmt;
  assert.equal(step.type, 'WaitUntilUiStmt');
  assert.equal(step.waitMs, 120_000);
  assert.equal(step.holdMs, null);
});

test('the api form parses its own budget into `waitMs`, leaving the request timeout alone', () => {
  const step = firstStep('  wait until api GET /jobs timeout wait 5m\n    expect status equals 200\n') as unknown as WaitUntilApiStmt;
  assert.equal(step.type, 'WaitUntilApiStmt');
  assert.equal(step.waitMs, 300_000);
  assert.equal(step.request.timeoutMs, null, 'a wait budget must not be mistaken for a request timeout');
});

// The heart of the slice: the two quantities the row read as one, written on the same line and
// landing in different fields. If `timeout` had simply been copied across, this program could not
// exist — there would be one clause and it would have to mean one thing.
test('a poll can state both budgets at once, and they land in different fields', () => {
  const step = firstStep('  wait until api GET /jobs timeout 5s timeout wait 5m\n    expect status equals 200\n') as unknown as WaitUntilApiStmt;
  assert.equal(step.request.timeoutMs, 5_000, 'no single poll may hang past 5s');
  assert.equal(step.waitMs, 300_000, 'the whole step gives up after five minutes');
});

test('`for` and `timeout wait` compose on the locator form', () => {
  const { program, diagnostics } = parseSource('test "t"\n  open "/x"\n  wait until text "E" is hidden for 10s timeout wait 2m\n');
  assert.deepEqual(diagnostics, []);
  const step = program.tests[0]!.body[1] as unknown as WaitUntilUiStmt;
  assert.equal(step.holdMs, 10_000);
  assert.equal(step.waitMs, 120_000);
});

// NEGATIVE — the clause order is fixed, and the refusal is the ordinary end-of-step one rather than
// something bespoke. Worth pinning: a grammar that silently accepted either order would make the
// two clauses look interchangeable, which they are not.
test('`timeout wait` comes after `for`, not before it', () => {
  assert.deepEqual(
    stepCodes('  open "/x"\n  wait until text "E" is hidden timeout wait 2m for 10s\n'),
    [Codes.UNEXPECTED_TOKEN],
  );
});

// The budget is last on the line, which on the api form means after `without redirects` too. Both
// orders are pinned because `parseApiRequestLine` stops at the two-token clause without consuming
// it, so the request line's own remaining clauses have to come first or they are never reached.
test('on the api form the budget goes after the request line’s own clauses', () => {
  const step = firstStep(
    '  wait until api GET /jobs timeout 5s without redirects timeout wait 5m\n    expect status equals 200\n',
  ) as unknown as WaitUntilApiStmt;
  assert.equal(step.request.timeoutMs, 5_000);
  assert.equal(step.request.followRedirects, false);
  assert.equal(step.waitMs, 300_000);

  // The other order is refused rather than silently reordered.
  assert.deepEqual(
    stepCodes('  wait until api GET /jobs timeout wait 5m without redirects\n    expect status equals 200\n'),
    [Codes.UNEXPECTED_TOKEN],
  );
});

// NEGATIVE — the row's own program. Still refused, because a bare `timeout` still means a request
// timeout and a locator wait still has no request. Only the teaching moved.
test('a bare `timeout` on the locator form is still refused, and now names the clause that does exist', () => {
  assert.deepEqual(stepCodes('  open "/x"\n  wait until button "Go" is enabled timeout 30s\n'), [Codes.UNEXPECTED_TOKEN]);
  assert.equal(
    said('  open "/x"\n  wait until button "Go" is enabled timeout 30s\n'),
    'unexpected `timeout` at end of step | a per-step `timeout` bounds one HTTP request, so it is only accepted on `api` requests — on a `wait until` write `timeout wait <duration>` to set the poll budget of that one step, and to give browser steps more time set `timeout browser` in `tflw.config` (`timeout api`, `timeout step`, `timeout wait` and `timeout expect` are the other four)',
  );
});

// NEGATIVE — a plain `api` step has no poll budget, so the clause is refused there. Before D640 this
// said ``expected a duration … found `wait` `` from inside `parseDuration`, which described the
// parser's position rather than the mistake; it now reaches `endLine`'s table like every other
// wrong-suffix mistake M84 collected.
test('a plain `api` step has no wait budget', () => {
  assert.deepEqual(stepCodes('  api GET /x timeout wait 5m\n  expect status equals 200\n'), [Codes.UNEXPECTED_TOKEN]);
  assert.equal(
    said('  api GET /x timeout wait 5m\n  expect status equals 200\n'),
    'unexpected `timeout` at end of step | `timeout wait <duration>` sets the poll budget of one `wait until` step — no other step has one. To bound a single request write `timeout <duration>`; to change the whole run set `timeout wait` in `tflw.config`',
  );
});

// NEGATIVE — the control the row called clean, unchanged in both fields.
test('`wait until api … timeout 30s` still parses, and still means the request timeout', () => {
  const step = firstStep('  wait until api GET /jobs timeout 30s\n    expect status equals 200\n') as unknown as WaitUntilApiStmt;
  assert.equal(step.request.timeoutMs, 30_000);
  assert.equal(step.waitMs, null, 'it never set the wait budget, which is the whole finding');
});

// NEGATIVE — the adjacency rule reaches the new site, because it lives inside `parseDuration` and
// the new clause calls it. `valueTermination.test.ts` owns the systematic version of this claim.
test('the new clause inherits the duration adjacency rule', () => {
  assert.deepEqual(stepCodes('  open "/x"\n  wait until button "Go" is enabled timeout wait 250ms\n'), []);
  assert.deepEqual(
    stepCodes('  open "/x"\n  wait until button "Go" is enabled timeout wait 250 ms\n'),
    [Codes.UNKNOWN_DURATION_UNIT],
  );
});

// ---- TF055's second operand (consequence 1) --------------------------------------------------

test('`TF055` reads the budget the step wrote, not the env default', () => {
  // Would have been a false positive the moment the grammar shipped: 60s against the env's 30s.
  assert.deepEqual(holdDiags('  open "/x"\n  wait until text "E" is hidden for 60s timeout wait 2m\n', WAIT_30S), []);
});

test('`TF055` still fires when the budget the step wrote is the one that cannot fit', () => {
  const diags = holdDiags('  open "/x"\n  wait until text "E" is hidden for 60s timeout wait 30s\n', WAIT_30S);
  assert.deepEqual(diags.map((d) => d.code), [Codes.HOLD_EXCEEDS_WAIT_TIMEOUT]);
  // The sentence must not name an env that had no say in it.
  assert.match(diags[0]!.message, /bounded by `timeout wait 30000ms` on this step$/);
  assert.doesNotMatch(diags[0]!.message, /in env/);
  assert.match(diags[0]!.hint ?? '', /raise this step's `timeout wait`/);
});

test('the env-derived sentence is unchanged, and still names the env', () => {
  const diags = holdDiags('  open "/x"\n  wait until text "E" is hidden for 60s\n', WAIT_30S);
  assert.deepEqual(diags.map((d) => d.code), [Codes.HOLD_EXCEEDS_WAIT_TIMEOUT]);
  assert.match(diags[0]!.message, /bounded by `timeout wait` \(30000ms in env "local"\)$/);
  assert.match(diags[0]!.hint ?? '', /raise `timeout wait` in `tflw\.config`/);
});

// ---- TF055's reach (consequence 2) ------------------------------------------------------------

test('with no resolved env, the in-file budget is still checked and the env-derived one is still not', () => {
  // Both halves matter. The second is `ProgramCheckOptions`' `undefined`-is-not-zero doctrine and
  // must survive the widening; the first is what the widening buys — an editor with no config can
  // now diagnose a program whose two operands were both written down in front of it.
  assert.deepEqual(
    holdDiags('  open "/x"\n  wait until text "E" is hidden for 60s timeout wait 30s\n', undefined).map((d) => d.code),
    [Codes.HOLD_EXCEEDS_WAIT_TIMEOUT],
  );
  assert.deepEqual(holdDiags('  open "/x"\n  wait until text "E" is hidden for 60s\n', undefined), []);
});

test('`TF055` is still a warning in both forms (D147, and the condition on revisiting it)', () => {
  // The in-file form settles D147's premise — both operands are in the file, so the checker is no
  // longer predicting — and the tier still did not move. Pinned so that a later change to it is a
  // deliberate act against a red test rather than a quiet one.
  const inFile = holdDiags('  open "/x"\n  wait until text "E" is hidden for 60s timeout wait 30s\n', undefined);
  const fromEnv = holdDiags('  open "/x"\n  wait until text "E" is hidden for 60s\n', WAIT_30S);
  assert.deepEqual([...inFile, ...fromEnv].map((d) => d.severity), ['warning', 'warning']);
});
