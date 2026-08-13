// `--allow-public-target <origin>` — D21 §3.2(3)'s affirmation, and the one control in this
// language that a `tflw.config` is deliberately unable to satisfy (M131a,
// `PLAN_M131_SAFETY_COMPLETION.md` D340–D345).
//
// Two codes, two mistakes. `TF065`: the flag is missing. `TF066`: a flag is there and names the
// wrong thing. They are tested apart because they fail apart, and because the second is the one
// that stops a bare boolean's failure mode — a flag parked in CI that quietly covers whichever host
// somebody last edited into the config.
//
// The widening of `TF060` (D343) is tested here rather than beside the older `TF060` cases on
// purpose: it exists *because* of this milestone's gate. A service origin was ungated by both the
// declaration and the affirmation, and closing one hole while leaving the other open would have
// been a control with a documented way around it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, checkAuthorizedTargets, checkPublicTargets, type EnvAuthorizedTargets, type ProgramCheckOptions } from '../src/index.js';

const STAGING: EnvAuthorizedTargets = {
  envName: 'staging',
  targets: [{ target: 'https://staging.example.com', reason: 'we own it and the security team said yes' }],
  apiBaseUrl: 'https://staging.example.com/v1',
  services: [],
};

/** A file with one owned authorization assertion — the only scan that originates traffic (D341). */
const AUTHZ = ['test "t" as shopper', '  api GET /orders/1', '  expect response has no authorization violations'];
/** The Tier 1 scan, which inspects a response the suite already asked for. */
const SECURITY = ['test "t"', '  api GET /orders/1', '  expect response has no security violations'];

function publicCodes(opts: ProgramCheckOptions, lines: string[]): string[] {
  const { program } = parseSource(lines.join('\n') + '\n');
  return checkPublicTargets(program, opts).map((d) => d.code);
}

function firstPublicDiag(opts: ProgramCheckOptions, lines: string[]) {
  const { program } = parseSource(lines.join('\n') + '\n');
  return checkPublicTargets(program, opts)[0];
}

function targetCodes(declared: EnvAuthorizedTargets, lines: string[]): string[] {
  const { program } = parseSource(lines.join('\n') + '\n');
  return checkAuthorizedTargets(program, { envAuthorizedTargets: declared }).map((d) => d.code);
}

// --- TF065: the flag is required, and only for the scan that sends ----------

test('TF065: an authorization scan against a public origin with no flag is an error', () => {
  assert.deepEqual(publicCodes({ envAuthorizedTargets: STAGING }, AUTHZ), ['TF065']);
});

test('TF065: the same scan with a matching flag is clean', () => {
  assert.deepEqual(publicCodes({ envAuthorizedTargets: STAGING, allowPublicTargets: ['https://staging.example.com'] }, AUTHZ), []);
});

test('TF065: a declared `authorized target` is not enough on its own — that is the whole point', () => {
  // `STAGING` already declares the origin. If the declaration satisfied this gate, D21 §3.2(3)
  // would be a restatement of §3.2(2) and a committed config could still send CI at the internet.
  assert.ok(publicCodes({ envAuthorizedTargets: STAGING }, AUTHZ).includes('TF065'));
});

test('TF065 does not fire on a security scan — the flag follows the packet, not the matcher (D341)', () => {
  assert.deepEqual(publicCodes({ envAuthorizedTargets: STAGING }, SECURITY), []);
});

test('TF065 does not fire on a private origin, however the address is written', () => {
  for (const base of ['http://localhost:4001/v1', 'http://127.0.0.1:4001', 'http://10.1.2.3', 'http://[::1]:8443', 'http://api.localhost']) {
    const env = { ...STAGING, apiBaseUrl: base, targets: [{ target: base, reason: 'local fixture' }] };
    assert.deepEqual(publicCodes({ envAuthorizedTargets: env }, AUTHZ), [], base);
  }
});

test('TF065 is skipped entirely when no config was resolved — the editor-demo rule', () => {
  assert.deepEqual(publicCodes({}, AUTHZ), []);
  assert.deepEqual(publicCodes({ allowPublicTargets: ['https://staging.example.com'] }, AUTHZ), []);
});

test('TF065: matching is by origin, so a different port is a different affirmation', () => {
  const opts = { envAuthorizedTargets: STAGING, allowPublicTargets: ['https://staging.example.com:8443'] };
  // Both fire, and correctly: nothing affirms the origin actually scanned (`TF065`), and the flag
  // that was passed names a listener this run never talks to (`TF066`).
  assert.deepEqual(publicCodes(opts, AUTHZ).sort(), ['TF065', 'TF066']);
});

test('TF065: one diagnostic per assertion, so every offending line is named', () => {
  const two = ['test "t" as shopper', '  api GET /orders/1', '  expect response has no authorization violations', '  api GET /orders/2', '  expect response has no authorization violations'];
  assert.deepEqual(publicCodes({ envAuthorizedTargets: STAGING }, two), ['TF065', 'TF065']);
});

test('TF065 names the flag to type, verbatim', () => {
  const d = firstPublicDiag({ envAuthorizedTargets: STAGING }, AUTHZ);
  assert.ok(d!.message.includes('--allow-public-target https://staging.example.com'), d!.message);
});

test("TF065's hint states D341's asymmetry, so the error explains itself", () => {
  const d = firstPublicDiag({ envAuthorizedTargets: STAGING }, AUTHZ);
  assert.ok(d!.hint!.includes('originates requests your suite did not write'), d!.hint);
});

// --- TF065 over service origins (D343's other half) -------------------------

test('TF065: a declared service on a public host needs its own affirmation', () => {
  const env: EnvAuthorizedTargets = {
    ...STAGING,
    apiBaseUrl: 'http://localhost:4001',
    targets: [
      { target: 'http://localhost:4001', reason: 'local fixture' },
      { target: 'https://billing.example.com', reason: 'partner staging, approved' },
    ],
    services: [{ name: 'billing', url: 'https://billing.example.com' }],
  };
  // The default base is loopback and needs nothing; the service is on the internet and does.
  const d = firstPublicDiag({ envAuthorizedTargets: env }, AUTHZ);
  assert.equal(d!.code, 'TF065');
  assert.ok(d!.message.includes('service `@billing`'), d!.message);
  assert.deepEqual(publicCodes({ envAuthorizedTargets: env, allowPublicTargets: ['https://billing.example.com'] }, AUTHZ), []);
});

test('an interpolated or unparseable origin is skipped, not guessed at', () => {
  const env = { ...STAGING, apiBaseUrl: 'https://{API_HOST}/v1', targets: [] };
  assert.deepEqual(publicCodes({ envAuthorizedTargets: env }, AUTHZ), []);
});

test('TF066 stays silent when the pass can name no origin at all — not "no match"', () => {
  // The first cut of `checkPublicTargets` got this backwards, and in the direction a checker is not
  // allowed to be wrong in: with the base URL unresolvable the scannable list is *empty*, so
  // `!scannable.some(...)` was trivially true and a **correct** invocation was refused with "matches
  // nothing this run would scan". Nothing to compare against is "not decidable here", never "no
  // match" — the narrowness rule `checkAllowHostsCoversBaseUrls` states one function away.
  const env = { ...STAGING, apiBaseUrl: 'https://{API_HOST}/v1' };
  assert.deepEqual(publicCodes({ envAuthorizedTargets: env, allowPublicTargets: ['https://staging.example.com'] }, AUTHZ), []);
});

test('...but an affirmation with no declaration under it is still TF066, however little else is known', () => {
  // The other clause is decidable from `targets` alone, so it is deliberately not guarded: the flag
  // is additive on top of the declaration, and an affirmation for an origin the config never named
  // is D340's error whatever the base URL turned out to be.
  const env = { ...STAGING, apiBaseUrl: 'https://{API_HOST}/v1', targets: [] };
  assert.deepEqual(publicCodes({ envAuthorizedTargets: env, allowPublicTargets: ['https://staging.example.com'] }, AUTHZ), ['TF066']);
});

// --- TF066: the flag names the wrong thing ----------------------------------

test('TF066: a flag naming an origin this run never scans is an error, not a no-op', () => {
  const opts = { envAuthorizedTargets: STAGING, allowPublicTargets: ['https://staging.example.com', 'https://typo.example.com'] };
  assert.deepEqual(publicCodes(opts, AUTHZ), ['TF066']);
});

test('TF066: a flag naming an origin no `authorized target` declares — the flag is additive, never a way round', () => {
  const env: EnvAuthorizedTargets = {
    ...STAGING,
    targets: [{ target: 'https://staging.example.com', reason: 'we own it' }],
    services: [{ name: 'partner', url: 'https://partner.example.com' }],
  };
  // `partner` is scanned, so the flag names something real — but nothing declares it, so the
  // affirmation has no declaration underneath it. `TF060` says the other half of this.
  const codes = publicCodes({ envAuthorizedTargets: env, allowPublicTargets: ['https://staging.example.com', 'https://partner.example.com'] }, AUTHZ);
  assert.ok(codes.includes('TF066'), codes.join(', '));
});

test('TF066: a value that is not an absolute URL has no origin to match', () => {
  const opts = { envAuthorizedTargets: STAGING, allowPublicTargets: ['https://staging.example.com', 'staging.example.com'] };
  const codes = publicCodes(opts, AUTHZ);
  assert.deepEqual(codes, ['TF066']);
  const d = firstPublicDiag(opts, AUTHZ);
  assert.ok(d!.message.includes('not an absolute URL'), d!.message);
});

test('TF066: the hint says the flag repeats rather than taking a list', () => {
  const { program } = parseSource(AUTHZ.join('\n') + '\n');
  const opts = { envAuthorizedTargets: STAGING, allowPublicTargets: ['https://staging.example.com', 'https://typo.example.com'] };
  const d = checkPublicTargets(program, opts).find((x) => x.code === 'TF066')!;
  assert.ok(d.hint!.includes('repeat the flag'), d.hint);
});

// --- TF060's widening (D343) ------------------------------------------------

test('TF060: a service origin no declaration names is now refused', () => {
  const env: EnvAuthorizedTargets = {
    envName: 'local',
    targets: [{ target: 'http://localhost:4001', reason: 'local fixture' }],
    apiBaseUrl: 'http://localhost:4001',
    services: [{ name: 'billing', url: 'http://localhost:4002' }],
  };
  // Before D343 this was clean, and a scan against `@billing` was gated by nothing whatsoever.
  assert.deepEqual(targetCodes(env, SECURITY), ['TF060']);
});

test('TF060: declaring every scannable origin clears it', () => {
  const env: EnvAuthorizedTargets = {
    envName: 'local',
    targets: [
      { target: 'http://localhost:4001', reason: 'local fixture' },
      { target: 'http://localhost:4002', reason: 'local billing fixture' },
    ],
    apiBaseUrl: 'http://localhost:4001',
    services: [{ name: 'billing', url: 'http://localhost:4002' }],
  };
  assert.deepEqual(targetCodes(env, SECURITY), []);
});

test('TF060: the message names which origin is undeclared, and the hint spells out every line to add', () => {
  const env: EnvAuthorizedTargets = {
    envName: 'local',
    targets: [],
    apiBaseUrl: 'http://localhost:4001',
    services: [{ name: 'billing', url: 'http://localhost:4002' }],
  };
  const { program } = parseSource(SECURITY.join('\n') + '\n');
  const d = checkAuthorizedTargets(program, { envAuthorizedTargets: env })[0]!;
  assert.ok(d.message.includes('the default `api` base'), d.message);
  assert.ok(d.message.includes('service `@billing`'), d.message);
  assert.ok(d.hint!.includes('authorized target "http://localhost:4002"'), d.hint);
});

test('TF060: a service with an interpolated URL is skipped, like the base URL always was', () => {
  const env: EnvAuthorizedTargets = {
    envName: 'local',
    targets: [{ target: 'http://localhost:4001', reason: 'local fixture' }],
    apiBaseUrl: 'http://localhost:4001',
    services: [{ name: 'billing', url: 'http://{BILLING_HOST}:4002' }],
  };
  assert.deepEqual(targetCodes(env, SECURITY), []);
});
