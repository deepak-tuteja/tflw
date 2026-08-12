// `authorized target "<url>" reason "<text>"` — D21's declaration layer and the gate on every
// security assertion (M128b, PLAN_M128_PENTEST_TIER1.md D291, SPEC §3.10/§9.10).
//
// Two codes, two tiers of question. `TF061` asks whether the declaration is *sayable* (config
// alone). `TF060` asks whether a given assertion is *covered* by one (config × AST). They are
// tested separately because they fail separately: a wildcard declaration is rejected whether or not
// anything scans, and a missing declaration is rejected whether or not any declaration is malformed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigSource, parseSource, checkAuthorizedTargets, checkRequestAssertions, checkResponseScopes, type EnvAuthorizedTargets } from '../src/index.js';

// `parseConfigSource` already folds `validateConfig` into its diagnostics — calling it again here
// would report every config rule twice, which is how the first cut of these tests "found" a
// duplicate `TF061` that the checker never emitted.
function configCodes(...lines: string[]): string[] {
  return parseConfigSource(lines.join('\n') + '\n').diagnostics.map((d) => d.code);
}

function firstDiag(lines: string[]) {
  return parseConfigSource(lines.join('\n') + '\n').diagnostics[0];
}

const LOCAL: EnvAuthorizedTargets = {
  envName: 'secureLocal',
  targets: [{ target: 'https://localhost:8443', reason: 'self-hosted test fixture' }],
  apiBaseUrl: 'https://localhost:8443/v1',
};

function scanCodes(opts: EnvAuthorizedTargets | undefined, ...steps: string[]): string[] {
  const src = ['test "t"', ...steps.map((s) => `  ${s}`)].join('\n') + '\n';
  const { program } = parseSource(src);
  return checkAuthorizedTargets(program, opts ? { envAuthorizedTargets: opts } : {}).map((d) => d.code);
}

// --- the declaration parses -------------------------------------------------

test('a well-formed declaration is accepted in `defaults`', () => {
  assert.deepEqual(configCodes('defaults', '  authorized target "https://localhost:8443" reason "self-hosted test fixture"'), []);
});

test('and in an `env` block — it accumulates across both, like `allow hosts`', () => {
  assert.deepEqual(configCodes('env staging', '  api "https://stg.example.com"', '  authorized target "https://stg.example.com" reason "we own it"'), []);
});

test('`reason` is required, not optional', () => {
  // Making it optional would be one character of grammar and would turn the declaration into a
  // checkbox — which is the thing D21 exists instead of.
  const codes = configCodes('defaults', '  authorized target "https://localhost:8443"');
  assert.ok(codes.length > 0, 'a declaration with no reason must not parse');
});

// --- TF061: what cannot be said ---------------------------------------------

test('TF061: a wildcard target is rejected', () => {
  assert.deepEqual(configCodes('defaults', '  authorized target "https://*.example.com" reason "staging"'), ['TF061']);
});

test('TF061: the wildcard hint points at `allow hosts` as the one that does take patterns', () => {
  const d = firstDiag(['defaults', '  authorized target "https://*.example.com" reason "staging"']);
  assert.match(d!.hint!, /allow hosts/);
});

test('TF061: a bare hostname with no scheme is rejected', () => {
  // It reads like a declaration and authorizes nothing, because TF060 compares origins.
  assert.deepEqual(configCodes('defaults', '  authorized target "staging.example.com" reason "staging"'), ['TF061']);
});

test('TF061 is an error, not a warning', () => {
  assert.equal(firstDiag(['defaults', '  authorized target "https://*.x.com" reason "r"'])!.severity, 'error');
});

test('TF061 fires on a declaration inside an `env` block too, not only `defaults`', () => {
  assert.deepEqual(configCodes('env staging', '  authorized target "https://*.example.com" reason "staging"'), ['TF061']);
});

// --- TF060: what a security assertion needs behind it ------------------------

test('TF060: a security assertion with a matching declaration is clean', () => {
  assert.deepEqual(scanCodes(LOCAL, 'api GET /orders', 'expect response has no security violations'), []);
});

test('TF060: the same assertion with no declaration at all is an error', () => {
  assert.deepEqual(scanCodes({ ...LOCAL, targets: [] }, 'api GET /orders', 'expect response has no security violations'), ['TF060']);
});

test('TF060: a declaration for a different origin does not cover this one', () => {
  const other = { ...LOCAL, targets: [{ target: 'https://staging.example.com', reason: 'r' }] };
  assert.deepEqual(scanCodes(other, 'api GET /orders', 'expect response has no security violations'), ['TF060']);
});

test('TF060: matching is by origin — a different port is a different target', () => {
  // A declaration for the plain host does not authorize scanning a second listener on 8443, which
  // may well belong to a different team.
  const wrongPort = { ...LOCAL, targets: [{ target: 'https://localhost', reason: 'r' }] };
  assert.deepEqual(scanCodes(wrongPort, 'api GET /orders', 'expect response has no security violations'), ['TF060']);
});

test('TF060: matching is by origin — a different scheme is a different target', () => {
  const wrongScheme = { ...LOCAL, targets: [{ target: 'http://localhost:8443', reason: 'r' }] };
  assert.deepEqual(scanCodes(wrongScheme, 'api GET /orders', 'expect response has no security violations'), ['TF060']);
});

test('TF060: a path on the declaration is ignored — origins have no path', () => {
  const withPath = { ...LOCAL, targets: [{ target: 'https://localhost:8443/v1/orders', reason: 'r' }] };
  assert.deepEqual(scanCodes(withPath, 'api GET /orders', 'expect response has no security violations'), []);
});

test('TF060: loopback gets no exemption', () => {
  // D21 layer 3 treats private addresses as lower-risk, and exempting them here was considered and
  // rejected: it would exempt exactly the target this arc is tested against.
  const loopback = { envName: 'local', targets: [], apiBaseUrl: 'http://127.0.0.1:4001/v1' };
  assert.deepEqual(scanCodes(loopback, 'api GET /orders', 'expect response has no security violations'), ['TF060']);
});

test('TF060: one diagnostic per assertion, so every offending line is named', () => {
  const codes = scanCodes({ ...LOCAL, targets: [] }, 'api GET /a', 'expect response has no security violations', 'api GET /b', 'check response has no critical security violations');
  assert.deepEqual(codes, ['TF060', 'TF060']);
});

test('TF060 says nothing about a file with no security assertion in it', () => {
  assert.deepEqual(scanCodes({ ...LOCAL, targets: [] }, 'api GET /orders', 'expect status equals 200'), []);
});

test('TF060 does not fire on an a11y assertion — the other scan needs no declaration', () => {
  assert.deepEqual(scanCodes({ ...LOCAL, targets: [] }, 'open "/checkout"', 'expect page has no a11y violations'), []);
});

// --- the `undefined`-vs-empty doctrine --------------------------------------

test('no resolved config skips the pass entirely, rather than reporting every assertion', () => {
  // The docs-site editor demo runs in a browser where no `tflw.config` can exist even in principle.
  // Collapsing this into the empty case would light up every security example on the site.
  assert.deepEqual(scanCodes(undefined, 'api GET /orders', 'expect response has no security violations'), []);
});

test('an env with no `api` base URL is skipped, not failed', () => {
  assert.deepEqual(scanCodes({ envName: 'x', targets: [], apiBaseUrl: null }, 'api GET /o', 'expect response has no security violations'), []);
});

test('an unparseable base URL is skipped rather than guessed at', () => {
  assert.deepEqual(scanCodes({ envName: 'x', targets: [], apiBaseUrl: '{API_HOST}/v1' }, 'api GET /o', 'expect response has no security violations'), []);
});

// --- the hint earns its place -----------------------------------------------

test('with no declarations, the hint spells out the line to write', () => {
  const src = 'test "t"\n  api GET /orders\n  expect response has no security violations\n';
  const { program } = parseSource(src);
  const [d] = checkAuthorizedTargets(program, { envAuthorizedTargets: { ...LOCAL, targets: [] } });
  assert.match(d!.hint!, /authorized target "https:\/\/localhost:8443" reason/);
});

test('with the wrong declarations, the hint names what is actually authorized', () => {
  const src = 'test "t"\n  api GET /orders\n  expect response has no security violations\n';
  const { program } = parseSource(src);
  const [d] = checkAuthorizedTargets(program, { envAuthorizedTargets: { ...LOCAL, targets: [{ target: 'https://elsewhere.example', reason: 'r' }] } });
  assert.match(d!.hint!, /"https:\/\/elsewhere\.example"/);
});

// --- how `response` composes with the rules that predate it ------------------
//
// Not about `authorized target`, but M128b's other lang-side obligation: a new subject inherits
// every existing subject rule by default, and "by default" is exactly the kind of claim that is
// true until it isn't. Both of these pass because `ResponseSubject` was *not* added to an exclusion
// list — so a future exclusion added carelessly fails here rather than shipping.

test('TF031: a scan cannot be combined with `expect request fails` on the same step', () => {
  // If the connection failed there is no response to scan, so the pair is incoherent — the same
  // reason `status`/`header`/`body` are rejected alongside it.
  const src = 'test "t"\n  api GET /a\n  expect request fails\n  expect response has no security violations\n';
  const { program } = parseSource(src);
  assert.ok(checkRequestAssertions(program).some((d) => d.code === 'TF031'));
});

test('TF039: a scan with no `api` step above it is the ordinary no-response error', () => {
  // Not D285 — that is a run-time verdict about a response that did arrive. This is the static one.
  const src = 'test "t"\n  expect response has no security violations\n';
  const { program } = parseSource(src);
  assert.ok(checkResponseScopes(program).some((d) => d.code === 'TF039'));
});
