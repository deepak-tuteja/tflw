// M125b1 (`FU-18`, D245/D246) — the runtime half of "an absolute URL is the address".
//
// **The `open` case is the reason this file exists, and it is worth being precise about what the
// defect was, because it is the shape a test is least likely to catch.** `resolveWebUrl` used to be
// unconditionally `` `${webBaseUrl}${ensureLeadingSlash(path)}` ``, so
// `open "https://example.com/x"` against a configured `web` base navigated to
// `http://localhost:5173/https://example.com/x`. On any SPA with a catch-all route **that page
// loads** — so nothing threw, the step passed, and the run failed later on an assertion about
// content, attributing the failure to the wrong step entirely. `M125a` reproduced exactly that: 5.5
// seconds, a page served, a failure on the following text assertion. A wrong target that produces a
// *plausible* failure is worse than one that crashes, and no assertion anywhere in the suite is
// positioned to notice it.
//
// Which is why the tests below assert on the composed URL directly rather than on the outcome of a
// navigation. The outcome was green.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { resolveWebUrl, requireAllowHostsForAbsolute, resolveBaseUrl, runProgram } from '../src/interpreter.js';
import { AllowHostsError } from '../src/allowHosts.js';
import { RuntimeError } from '../src/eval.js';
import { startFixtureServer, testConfig, json } from './support.js';

const WEB = (webBaseUrl: string | null, allowHosts: string[] | null = ['example.com', 'localhost']) => ({
  ...testConfig('http://localhost:4001'),
  webBaseUrl,
  allowHosts,
});

// ---------------------------------------------------------------------------
// `open` — the silent-wrong-target half
// ---------------------------------------------------------------------------

test('an absolute `open` target is returned as written, not concatenated', () => {
  assert.equal(
    resolveWebUrl('https://example.com/x', WEB('http://localhost:5173')),
    'https://example.com/x',
  );
});

test('THE REGRESSION — the base URL is nowhere in the result', () => {
  // Stated as its own assertion because "equals the input" above could be satisfied by an
  // implementation that also, separately, navigated somewhere else. This is the literal string the
  // browser was opening: `http://localhost:5173/https://example.com/x`.
  const url = resolveWebUrl('https://example.com/x', WEB('http://localhost:5173'));
  assert.equal(url.includes('localhost:5173'), false, 'the `web` base was prepended to an absolute URL');
  assert.equal(url.startsWith('https://example.com'), true);
});

test('an absolute `open` needs no `web` base at all', () => {
  // The originally-filed half of the row: with no `web` configured, `open "https://…"` answered
  // "no `web` base URL is configured for the active env". Demanding a base in order to ignore it is
  // the requirement this removes.
  assert.equal(resolveWebUrl('https://example.com/x', WEB(null)), 'https://example.com/x');
});

test('CONTROL — a relative `open` still resolves against the base, unchanged', () => {
  assert.equal(resolveWebUrl('/checkout', WEB('http://localhost:5173')), 'http://localhost:5173/checkout');
  assert.equal(resolveWebUrl('checkout', WEB('http://localhost:5173')), 'http://localhost:5173/checkout');
});

test('CONTROL — a relative `open` with no `web` base still errors', () => {
  // The check that had to move above the base-URL requirement, not replace it.
  assert.throws(() => resolveWebUrl('/checkout', WEB(null)), /no `web` base URL is configured/);
});

test('an absolute `open` to a host outside `allow hosts` is refused', () => {
  // The browser route handler already guards navigation (M85/C1, `browser.ts:262`), but that fires
  // once the page has been asked to go there. Refusing at composition means the same answer arrives
  // before a browser context is involved at all.
  assert.throws(
    () => resolveWebUrl('https://elsewhere.example/x', WEB('http://localhost:5173', ['example.com'])),
    AllowHostsError,
  );
});

// ---------------------------------------------------------------------------
// The guardrail (D246) — absence of an allowlist means refusal, and only here
// ---------------------------------------------------------------------------

test('an absolute URL with NO `allow hosts` declared is refused', () => {
  const config = { ...testConfig('http://localhost:4001'), allowHosts: null };
  assert.throws(() => requireAllowHostsForAbsolute('https://x.example/o', 'https://x.example/o', config), AllowHostsError);
});

test('`[]` is refused as well as `null` — both mean "nothing declared"', () => {
  // `resolve.ts` produces `null` when the key never appeared; a config could still hand through an
  // empty list. The rule is about what was declared, not about which spelling of nothing arrived.
  const config = { ...testConfig('http://localhost:4001'), allowHosts: [] };
  assert.throws(() => requireAllowHostsForAbsolute('https://x.example/o', 'https://x.example/o', config), AllowHostsError);
});

test('with an allowlist declared, this guard stands aside — `isHostAllowed` governs', () => {
  // Deliberately a host that is NOT on the list: this guard's question is only "was an allowlist
  // declared at all". Whether *this* host is on it is `checkHostAllowed`'s, and having two guards
  // answer the same question differently is how M85's finding happened.
  const config = { ...testConfig('http://localhost:4001'), allowHosts: ['other.example'] };
  assert.doesNotThrow(() => requireAllowHostsForAbsolute('https://x.example/o', 'https://x.example/o', config));
});

test('CONTROL — a relative target is never subject to this guard', () => {
  // The whole point of D246's scoping. `allow hosts` is opt-in and unset means no enforcement, which
  // is right for a suite written against its env's base URL — that base *is* the declaration. If
  // this guard fired on paths it would break every suite in existence.
  const config = { ...testConfig('http://localhost:4001'), allowHosts: null };
  assert.doesNotThrow(() => requireAllowHostsForAbsolute('http://localhost:4001/orders', '/orders', config));
});

test('the refusal is an `AllowHostsError`, not a plain `RuntimeError`', () => {
  // Carried by type rather than by matching text, because three layers between here and the
  // reporter re-frame what they catch as "request failed: …" — and nothing failed. A request was
  // deliberately not sent (`allowHosts.ts:18-23`).
  const config = { ...testConfig('http://localhost:4001'), allowHosts: null };
  try {
    requireAllowHostsForAbsolute('https://x.example/o', 'https://x.example/o', config);
    assert.fail('expected a refusal');
  } catch (err) {
    assert.ok(err instanceof AllowHostsError);
    assert.ok(err instanceof RuntimeError, 'the subclass relationship the three catch sites rely on');
  }
});

test('the refusal names the host to add and both ways out', () => {
  const config = { ...testConfig('http://localhost:4001'), allowHosts: null };
  try {
    requireAllowHostsForAbsolute('https://payments.example/authorize', 'https://payments.example/authorize', config);
    assert.fail('expected a refusal');
  } catch (err) {
    const message = (err as Error).message;
    assert.match(message, /allow hosts "payments\.example"/);
    assert.match(message, /base URL/, 'the other way round — put the host in the config and write a path');
    assert.equal(message.includes('()'), false, 'must not quote an empty allowlist as though one were misconfigured');
  }
});

// ---------------------------------------------------------------------------
// `api` composition
// ---------------------------------------------------------------------------

test('END TO END — the row\'s own repro sends a real request to the other host', async () => {
  // Everything above tests one function. This tests the sentence: `api GET https://…` was a parse
  // error, and the point of the milestone is that it now reaches a second host. Two servers, so
  // "went somewhere" and "went to the RIGHT somewhere" are distinguishable — a single server would
  // pass whether the base was prepended or not, since a prepended base against the same origin is
  // just a 404, and this suite has plenty of ways to turn a 404 green.
  const base = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const other = await startFixtureServer({ '/orders': (_req, res) => json(res, 200, { from: 'other' }) });
  try {
    const config = { ...testConfig(base.baseUrl), allowHosts: ['127.0.0.1'] };
    const source = `test "t"\n  api GET ${other.baseUrl}/orders\n  expect status equals 200\n  expect body.from equals "other"\n`;
    const { program, diagnostics } = parseSource(source);
    assert.deepEqual(diagnostics, [], 'the repro must parse — that is half the row');
    const { report } = await runProgram(program, config, { source });
    assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
    assert.equal(other.received.get('/orders')!.length, 1, 'the second host did not receive it');
    assert.equal(base.received.has('/orders'), false, 'the env base URL was contacted — the base was prepended');
  } finally {
    await base.close();
    await other.close();
  }
});

test('END TO END — with no `allow hosts`, the same program is refused before any connection', async () => {
  // `received` staying empty is the assertion, not the error message: D246's promise is that the
  // request is never sent, and only the server can testify to that.
  const other = await startFixtureServer({ '/orders': (_req, res) => json(res, 200, { from: 'other' }) });
  try {
    const config = { ...testConfig('http://127.0.0.1:1'), allowHosts: null };
    const source = `test "t"\n  api GET ${other.baseUrl}/orders\n  expect status equals 200\n`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, config, { source });
    assert.equal(report.ok, false);
    assert.match(report.tests[0]!.error ?? '', /declares no `allow hosts`/);
    assert.equal(other.received.has('/orders'), false, 'the request was sent despite the refusal');
  } finally {
    await other.close();
  }
});

test('CONTROL — `resolveBaseUrl` is still what a relative `api` step uses', () => {
  // The absolute branch bypasses this function entirely, so its behaviour must be shown unchanged
  // rather than assumed: a step with no base configured still gets the base-URL error, and that is
  // the error `TF051` predicts.
  const withBase = testConfig('http://localhost:4001');
  assert.equal(resolveBaseUrl(null, withBase), 'http://localhost:4001');
  const noBase = { ...withBase, apiBaseUrl: null };
  assert.throws(() => resolveBaseUrl(null, noBase), /declares no default `api` base URL/);
});
