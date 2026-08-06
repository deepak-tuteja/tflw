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

  checkProgram: { verdict: 'n/a', reason: 'the composition of the per-file passes, not a pass — `checkSessionBody` is its config-side counterpart' },
  checkSessionBody: { verdict: 'n/a', reason: 'this list itself' },
  checkSessionServices: { verdict: 'n/a', reason: 'subsumed: `checkSessionBody` folds it in so callers have one entry point' },
  validateConfig: { verdict: 'n/a', reason: 'validates config *declarations* (which key in which block), not step bodies' },
  checkAllowHostsCoversBaseUrls: { verdict: 'n/a', reason: 'reasons about an env\'s own base URLs against its `allow hosts` — a whole-env property, not a step one' },

  checkDataTables: { verdict: 'n/a', reason: 'walks `program.tests` for `with each` columns; a session has no tests and no table' },
  checkSessions: { verdict: 'n/a', reason: 'validates that a `test … as <name>` names a declared session — about tests referencing sessions, the opposite direction' },
  checkActionDecls: { verdict: 'n/a', reason: 'walks `program.actions`; the config dialect declares none (see `checkCalls` above)' },
  checkWorkloadTests: { verdict: 'n/a', reason: 'reasons about `workload`/`threshold` on a `test`; a session has neither' },
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
  return checkSessionBody(parsed.config.sessions, ['billing']).map((d) => d.code);
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
