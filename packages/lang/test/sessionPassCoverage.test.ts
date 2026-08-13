// M97b (`PLAN_M97_CHECKER_CONTRACT.md`, D142) — `A4-04`: a `session` body is a body of steps, and
// was getting exactly one of the checker's passes.
//
// D142's own framing, and the reason this file exists at all: *the missing call is the symptom;
// "nobody was ever forced to ask" is the defect.* `checkSessionBody` fixes what is missing today.
// This test is what makes tomorrow's tenth pass fail the build until someone answers the same
// question for sessions — the third instance of a shape already load-bearing in this repo, after
// `diagnosticsCoverage.test.ts` (M86, `Codes`↔`DIAGNOSTICS`) and `conformance.test.ts` (M97a,
// runtime rules↔checker).
//
// Two halves, and both are needed:
//
//  1. **Total.** Every exported `check*` in `checker.ts` is classified — applied to sessions, or
//     N/A with a recorded reason. Scanned from source, so adding a pass and forgetting sessions is
//     a build failure rather than a silence.
//  2. **Non-vacuous.** Every pass marked "applies" is proved to actually fire through
//     `checkSessionBody`, against a real `tflw.config` fixture. A manifest row claiming coverage
//     that nothing exercises is the failure mode `M92d` named: a passing test of nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseConfigSource, checkSessionBody, Codes } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const CHECKER_SRC = join(here, '../src/checker.ts');

interface PassVerdict {
  /** `applies`: composed into `checkSessionBody`. `n/a`: cannot apply, for the stated reason. */
  readonly verdict: 'applies' | 'n/a';
  readonly reason: string;
  /** For `applies`: a `session` body that must produce `code`, proving the wiring is real. */
  readonly fixture?: string;
  readonly code?: string;
}

/**
 * Every exported pass in `checker.ts`, triaged against a `session` body. Ordered as D142 triaged
 * them: the five that apply, then the composition/config entry points, then the four that cannot.
 */
const PASSES: Readonly<Record<string, PassVerdict>> = {
  checkServices: {
    verdict: 'applies',
    reason: 'the one pass sessions already had, via `checkSessionServices` (decision 66)',
    fixture: '  api billin GET /health\n',
    code: Codes.UNKNOWN_SERVICE,
  },
  checkUnknownVariables: {
    verdict: 'applies',
    reason: '`A4-04`\'s own repro — a session body binds with `let`/`capture` and reads them back',
    fixture: '  api GET /health\n  expect body.x equals {nope}\n',
    code: Codes.UNKNOWN_VARIABLE,
  },
  checkRequestAssertions: {
    verdict: 'applies',
    reason: 'a session runs `api` steps followed by `expect`s, so both halves of the rule apply',
    fixture: '  api GET /health\n  expect request connects\n  expect status equals 200\n',
    code: Codes.REQUEST_ASSERTION_INVALID,
  },
  checkResponseScopes: {
    verdict: 'applies',
    reason: '`runSession` is one `execSteps` frame, so `TF039` applies exactly as it does to a hook',
    fixture: '  expect status equals 200\n  api GET /health\n',
    code: Codes.NO_RESPONSE_YET,
  },
  checkMatcherSubjects: {
    verdict: 'applies',
    reason: 'added by this same milestone — and it is precisely the pass that would have shipped with sessions out of scope had this test not existed',
    fixture: '  api GET /health\n  expect status is visible\n',
    code: Codes.MATCHER_SUBJECT_MISMATCH,
  },
  checkValueSubjects: {
    verdict: 'applies',
    reason: 'a session captures and then asserts on what it captured, so `TF041` applies there exactly as in a test — this row was very nearly filed "n/a" on the assumption that sessions do not use value subjects, which is what writing the reason down catches',
    fixture: '  api GET /health\n  capture body.id as id\n  expect {id} is visible\n',
    code: Codes.VALUE_SUBJECT_INVALID,
  },
  checkCalls: {
    verdict: 'applies',
    reason: 'inverted: `tflw.config` declares no `action`s, so a call here can never resolve — not "unknown" but impossible, and the hint says so',
    fixture: '  api GET /health\n  get thing()\n',
    code: Codes.UNKNOWN_CALL,
  },

  checkBaseUrls: {
    verdict: 'applies',
    reason:
      'M116/D148. The most load-bearing of the three: an api step with no `<service>` prefix is the dominant shape in a `session` body (a login almost always goes to the default service), and a session that cannot resolve its base URL takes down every test that names it. The fixture exercises the **`web`** half rather than that one, and the reason is structural, not a preference: the shared config below has to declare `api` for every other row here to be about what it says it is, so the `api` half cannot fire against it. `baseUrls.test.ts` covers the api half directly, in a session, against an env that declares none',
    fixture: '  open "/login"\n',
    code: Codes.NO_BASE_URL_FOR_STEP,
  },
  checkSnapshotMasks: {
    verdict: 'applies',
    reason:
      'M116/D149. Reachable rather than load-bearing: a session body is a body of steps and `ExpectStmt` is one of them, so a stray `mask` parses there exactly as it does in a test. Wired because a pass that is wired costs nothing to keep wired, and the alternative is an "n/a" that quietly becomes wrong the first time someone snapshots inside a session',
    fixture: '  api GET /health\n  expect status equals 200 mask field "Email"\n',
    code: Codes.MASK_WITHOUT_SNAPSHOT,
  },
  checkCapturableSubjects: {
    verdict: 'applies',
    reason: 'M116/D150. A session body\'s entire purpose is to `capture` a token out of a login response, so this is the pass whose subject a session exercises most heavily',
    fixture: '  api GET /health\n  capture request as r\n',
    code: Codes.SUBJECT_NOT_CAPTURABLE,
  },

  checkLiteralOperands: {
    verdict: 'applies',
    reason:
      'M124/D232. A session body binds with `let` and asserts with `expect` like any other body, so every one of `TF054`\'s seven sites is reachable there — and the login `expect` that guards a session is a plausible place for a hand-written regex. Needs nothing from the caller, so unlike its M124 sibling it is wired unconditionally',
    fixture: '  let bad = random number 5 to 1\n  api GET /health\n',
    code: Codes.INVALID_LITERAL_OPERAND,
  },
  checkHoldWindows: {
    verdict: 'applies',
    reason:
      'M124/D236. Reachable rather than load-bearing, like `checkSnapshotMasks`: a session that logs in through the browser may well wait for a redirect to settle before capturing the token. Gated on `envTimeouts`, so the fixture below only fires because this test passes one — which is the assertion worth having, since a forgotten argument here would leave the pass wired and silent',
    fixture: '  open "/login"\n  wait until button "Hidden" is hidden for 60s\n',
    code: Codes.HOLD_EXCEEDS_WAIT_TIMEOUT,
  },

  checkAbsoluteUrls: {
    verdict: 'applies',
    reason:
      'M125b1/D245. Load-bearing rather than merely reachable, and a session is arguably the *most* likely body to hold one: it exists to log in, and the identity provider a suite authenticates against is very often a different host from the app under test — which is the case an absolute URL is for. Both consequences apply unchanged there: a session step fixed to one host does not move with `--env`, and the runtime refuses it with no `allow hosts` declared, from the same guard, since `runSession` issues real requests through the same client. Wired with the caller\'s `envAllowHosts`, and the fixture below fires `TF057` rather than `TF058` precisely because this test passes none — the absence selects the other rule instead of silencing the pass, which is the one way this option differs from `envTimeouts` above',
    fixture: '  api GET https://idp.example.com/token\n',
    code: Codes.ABSOLUTE_URL_NOT_PORTABLE,
  },

  checkProgram: { verdict: 'n/a', reason: 'the composition of the per-file passes, not a pass — `checkSessionBody` is its config-side counterpart' },
  checkSessionBody: { verdict: 'n/a', reason: 'this list itself' },
  checkSessionServices: { verdict: 'n/a', reason: 'subsumed: `checkSessionBody` folds it in so callers have one entry point' },
  validateConfig: { verdict: 'n/a', reason: 'validates config *declarations* (which key in which block), not step bodies' },
  checkAllowHostsCoversBaseUrls: { verdict: 'n/a', reason: 'reasons about an env\'s own base URLs against its `allow hosts` — a whole-env property, not a step one' },
  checkAuthorizedTargets: {
    verdict: 'n/a',
    reason:
      'walks `expect`/`check` steps for the two scan matchers (M128b `TF060`, widened by M130b/D315 to `hasNoAuthzViolations`). A `session` body cannot contain either: SPEC §3.3 limits it to `api`/`header`/`capture`/`let`, and a session establishes credentials rather than asserting about the response it got. If that ever widens, this verdict is what has to change first',
  },
  checkAuthzAssertions: {
    verdict: 'n/a',
    reason:
      'M130b/D315/D328/D329. Same door as `checkAuthorizedTargets` directly above, and a second one behind it: SPEC §3.3 admits no `expect` into a session body at all, so the matcher this pass walks for cannot appear there — and even if it could, every rule the pass carries is about a frame a session is not. `TF063` asks which principal a body belongs to, and a session *is* a principal rather than something that runs as one; `TF062` asks whether the step named a credential its owning session did not supply, which in a session body is the ordinary case and not a defect, since establishing that credential is the body\'s entire job. So this is a genuine n/a, not a deferral: the two halves would have to mean different things there, which is exactly the shape D142 exists to make somebody say out loud',
  },

  checkDataTables: {
    verdict: 'n/a',
    reason:
      'walks `program.tests` for `with each` columns; a session has no tests and no table. M124 added `TF056` (the file-backed form\'s extension) to this same pass and the verdict is unchanged for the identical reason — `with each` is a modifier on a `test`, and `tflw.config` declares none',
  },
  checkSessions: { verdict: 'n/a', reason: 'validates that a `test … as <name>` names a declared session — about tests referencing sessions, the opposite direction' },
  checkActionDecls: { verdict: 'n/a', reason: 'walks `program.actions`; the config dialect declares none (see `checkCalls` above)' },
  checkActionCycles: {
    verdict: 'n/a',
    reason:
      'M97d/D141. Both halves of the pass are unreachable from a session: it walks `program.actions`, which the config dialect never declares, and its edges are calls, which a session body can never make at all — `runSession` builds an empty registry by construction, so `checkCalls` inverted (`unknown call` is *always* right there) is the rule that applies, and it already does. A cycle needs two frames; a session body cannot get to one',
  },
  checkWorkloadTests: { verdict: 'n/a', reason: 'reasons about `workload`/`threshold` on a `test`; a session has neither' },
  checkReferencedFiles: {
    verdict: 'n/a',
    reason:
      'M97c/D144, amended by `M97c-03`. Syntactically a session body *can* name a file (`api POST /auth/login body from "./creds.json"`), so this row was written expecting "applies". The original reason was that no single answer existed to check *against*: `runSession` ran the shared body under the `TestCtx` of whichever **test file** triggered it, so one `tflw.config` line resolved to a different absolute path per test file. That was filed as its own row rather than swallowed here — and it has since been fixed, so that reason is retired: a session body\'s paths now resolve against the config\'s own directory, deterministically. The second reason is retired too: "`collectFileReferences` walks a `Program` and sessions live in a `ConfigFile`, so `M97c-01` and this land together or not at all" was true until M116/D151 built `collectConfigFileReferences`, and they did land together — a session body\'s `body from "./creds.json"` and a `cert "…"` are found by the same walk. What keeps the row "n/a" now is the only thing left, and it is the same shape as `missingFiles` on the program side: the `stat` is the **caller\'s**, never the pure pass\'s, so a session\'s file references are reported by `loadAndValidate`, not by `checkSessionBody`. `configFileReferences.test.ts` is where that coverage lives',
  },
};

/** Exported `check*` functions, read off the source so the list cannot go stale silently. */
function exportedPasses(): string[] {
  const src = readFileSync(CHECKER_SRC, 'utf8');
  return [...src.matchAll(/^export function (check\w+|validateConfig)\(/gm)].map((m) => m[1]!).sort();
}

const config = (sessionBody: string): string =>
  `env local default\n  api "http://localhost:4001"\n  api billing "http://localhost:4002"\n\nsession s\n${sessionBody}`;

const runSession = (sessionBody: string): string[] => {
  const parsed = parseConfigSource(config(sessionBody));
  assert.deepEqual(parsed.diagnostics, [], `fixture did not parse:\n${config(sessionBody)}`);
  // M116/D152 — the env the fixture config above actually describes: it declares a default `api`
  // and no `web`. Stating it truthfully rather than passing `{api: true, web: true}` is what lets
  // `checkBaseUrls`' row prove itself here at all.
  // M124/D236 — and stated truthfully for the same reason: 30s is the documented default, so
  // `checkHoldWindows`' row is proved against the budget a real `local` env would have.
  return checkSessionBody(parsed.config.sessions, ['billing'], { envName: 'local', api: true, web: false }, { envName: 'local', wait: 30_000 }).map((d) => d.code);
};

test('the source scan finds passes at all', () => {
  // Without this, a broken regex makes every assertion below a vacuous pass over an empty list —
  // the exact failure this file is built to prevent.
  assert.ok(exportedPasses().length > 10, `expected many exported passes, found ${exportedPasses().length}`);
});

test('every exported checker pass is classified for `session` bodies (D142)', () => {
  // Control: delete any row from PASSES and this names the function.
  const unclassified = exportedPasses().filter((name) => !(name in PASSES));
  assert.deepEqual(
    unclassified,
    [],
    'a new checker pass exists and nobody has said whether a `session` body gets it. Add a row to PASSES: either wire it into `checkSessionBody` (verdict "applies", with a fixture proving it fires) or record why it cannot apply',
  );
});

test('`PASSES` describes no pass that has been deleted', () => {
  // The other direction, same reason `conformance.test.ts` asserts its counts exactly: a row for a
  // pass that no longer exists reads as coverage.
  const known = new Set(exportedPasses());
  const stale = Object.keys(PASSES).filter((name) => !known.has(name));
  assert.deepEqual(stale, [], 'these PASSES rows name functions `checker.ts` no longer exports');
});

test('every pass marked "applies" actually fires through `checkSessionBody`', () => {
  // The half that makes the manifest mean something. A row can claim coverage; only this proves it.
  // Control: drop any one of the six calls from `checkSessionBody` and its row fails here by name.
  const failures: string[] = [];
  for (const [name, p] of Object.entries(PASSES)) {
    if (p.verdict !== 'applies') continue;
    assert.ok(p.fixture && p.code, `${name} claims to apply but carries no fixture — add one`);
    const got = runSession(p.fixture!);
    if (!got.includes(p.code!)) failures.push(`${name}: expected ${p.code} from its fixture, got [${got.join(', ')}]`);
  }
  assert.deepEqual(failures, []);
});

test('every "n/a" verdict records a reason', () => {
  const silent = Object.entries(PASSES)
    .filter(([, p]) => p.verdict === 'n/a' && !p.reason)
    .map(([name]) => name);
  assert.deepEqual(silent, [], 'an unexplained N/A is a verdict with no reasoning — the next reader re-derives it, or disagrees silently');
});

test('a well-formed `session` body still passes clean', () => {
  // The soundness half. Six new passes over config is six new chances to reject something valid,
  // and every test above only proves errors *are* reported.
  // Control: give `checkSessionBody` a synthetic `TestDecl` wrapper — the approach D142 rejected —
  // and `checkWorkloadTests`/`checkDataTables` start reasoning about a test that does not exist.
  assert.deepEqual(
    runSession('  api billing POST /auth/login body { u: "a" }\n  capture body.token as tok\n  expect status equals 200\n  header "Authorization" is "Bearer {tok}"\n'),
    [],
  );
});
