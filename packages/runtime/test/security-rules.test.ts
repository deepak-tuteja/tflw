// The Tier 1 hygiene pack (M128b, PLAN_M128_PENTEST_TIER1.md D284/D289/D296) — pure unit tests over
// hand-built observations, independent of the interpreter wiring (`security-assert.test.ts`) and of
// the real target (`M128c`'s `tflw-acceptance/security/`, which is D295's actual bar).
//
// **Every rule gets all three of D284's states here**, positive / negative / not-applicable, because
// the third one is the state a boolean cannot express and is therefore the one a test can silently
// stop covering. `notApplicable` is asserted by rule id rather than by count, so a rule that stops
// declaring a precondition fails a test instead of quietly joining the applicable set.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSecurityScan, SECURITY_RULES, type Observation } from '../src/securityRules.js';

/** No `tls` by default — absent means *nobody looked*, which is what every observation in this file
 * is (nothing here opens a socket). The two `sec/tls-*` rules are therefore not-applicable
 * throughout except in the block that hands them facts explicitly. */
function obs(over: Partial<Observation> = {}): Observation {
  return { url: 'https://api.test/v1/orders', headers: {}, setCookie: [], requestHeaders: {}, ...over };
}

/** Rule ids that fired, in pack order. */
function fired(o: Observation): string[] {
  return runSecurityScan(o).findings.map((f) => f.id);
}

function stateOf(o: Observation, id: string): 'fired' | 'silent' | 'not-applicable' {
  const r = runSecurityScan(o);
  if (r.notApplicable.some((n) => n.rule.id === id)) return 'not-applicable';
  return r.findings.some((f) => f.id === id) ? 'fired' : 'silent';
}

// --- the pack itself -------------------------------------------------------

test('the pack is exactly D289\'s ten rules plus M128c\'s two, severity-descending', () => {
  assert.deepEqual(
    SECURITY_RULES.map((r) => `${r.id} ${r.severity}`),
    [
      'sec/cookie-not-httponly critical',
      'sec/cookie-not-secure critical',
      'sec/cors-wildcard-with-credentials critical',
      'sec/hsts-missing serious',
      'sec/csp-missing serious',
      'sec/tls-version-old serious',
      'sec/tls-weak-cipher serious',
      'sec/x-frame-options moderate',
      'sec/cookie-samesite-none moderate',
      'sec/nosniff-missing moderate',
      'sec/authenticated-response-cacheable moderate',
      'sec/server-version-disclosure minor',
    ],
  );
});

test('every rule id is `sec/`-prefixed and unique', () => {
  const ids = SECURITY_RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith('sec/')));
});

// --- sec/cookie-not-httponly -----------------------------------------------

test('cookie-not-httponly: fires on a cookie without the flag', () => {
  const r = runSecurityScan(obs({ setCookie: ['sid=abc; Path=/'] }));
  const f = r.findings.find((x) => x.id === 'sec/cookie-not-httponly');
  assert.ok(f);
  assert.match(f.detail, /`sid`/);
});

test('cookie-not-httponly: silent when the flag is present, in any case', () => {
  assert.equal(stateOf(obs({ setCookie: ['sid=abc; HttpOnly'] }), 'sec/cookie-not-httponly'), 'silent');
  assert.equal(stateOf(obs({ setCookie: ['sid=abc; httponly'] }), 'sec/cookie-not-httponly'), 'silent');
});

test('cookie-not-httponly: not applicable when the response sets no cookie', () => {
  assert.equal(stateOf(obs(), 'sec/cookie-not-httponly'), 'not-applicable');
});

test('cookie rules report one finding per cookie, not one per response', () => {
  const r = runSecurityScan(obs({ setCookie: ['a=1', 'b=2; HttpOnly', 'c=3'] }));
  const names = r.findings.filter((f) => f.id === 'sec/cookie-not-httponly').map((f) => f.detail);
  assert.equal(names.length, 2);
  assert.match(names[0]!, /`a`/);
  assert.match(names[1]!, /`c`/);
});

test('a cookie value never reaches a finding — the detail names the cookie, not its contents', () => {
  const r = runSecurityScan(obs({ url: 'https://api.test/', setCookie: ['session=super-secret-jwt-value; Path=/'] }));
  for (const f of r.findings) assert.doesNotMatch(`${f.description} ${f.detail}`, /super-secret-jwt-value/);
});

// --- sec/cookie-not-secure -------------------------------------------------

test('cookie-not-secure: fires over https on a cookie without the flag', () => {
  assert.equal(stateOf(obs({ setCookie: ['sid=abc; HttpOnly'] }), 'sec/cookie-not-secure'), 'fired');
});

test('cookie-not-secure: silent over https when the flag is present', () => {
  assert.equal(stateOf(obs({ setCookie: ['sid=abc; Secure'] }), 'sec/cookie-not-secure'), 'silent');
});

test('cookie-not-secure: not applicable over http, where the flag is unsettable', () => {
  // The false positive D284 exists for: over plaintext this would fire on every response in a
  // suite, and the fix it implies would break that suite.
  assert.equal(stateOf(obs({ url: 'http://api.test/v1', setCookie: ['sid=abc'] }), 'sec/cookie-not-secure'), 'not-applicable');
});

test('cookie-not-secure: not applicable over https when nothing sets a cookie', () => {
  assert.equal(stateOf(obs(), 'sec/cookie-not-secure'), 'not-applicable');
});

// --- sec/cors-wildcard-with-credentials ------------------------------------

test('cors-wildcard-with-credentials: fires on `*` plus credentials', () => {
  const o = obs({ headers: { 'access-control-allow-origin': '*', 'access-control-allow-credentials': 'true' } });
  assert.equal(stateOf(o, 'sec/cors-wildcard-with-credentials'), 'fired');
});

test('cors-wildcard-with-credentials: silent on a named origin plus credentials', () => {
  const o = obs({ headers: { 'access-control-allow-origin': 'https://storefront.example', 'access-control-allow-credentials': 'true' } });
  assert.equal(stateOf(o, 'sec/cors-wildcard-with-credentials'), 'silent');
});

test('cors-wildcard-with-credentials: silent on `*` without credentials', () => {
  // A wildcard alone is how a public read-only API is meant to look; it is the *pair* that is wrong.
  assert.equal(stateOf(obs({ headers: { 'access-control-allow-origin': '*' } }), 'sec/cors-wildcard-with-credentials'), 'silent');
});

test('cors-wildcard-with-credentials: not applicable when the response carries no CORS headers', () => {
  assert.equal(stateOf(obs(), 'sec/cors-wildcard-with-credentials'), 'not-applicable');
});

// --- sec/hsts-missing ------------------------------------------------------

test('hsts-missing: fires over https with no header', () => {
  assert.equal(stateOf(obs(), 'sec/hsts-missing'), 'fired');
});

test('hsts-missing: silent over https with the header', () => {
  assert.equal(stateOf(obs({ headers: { 'strict-transport-security': 'max-age=31536000' } }), 'sec/hsts-missing'), 'silent');
});

test('hsts-missing: not applicable over http, where a browser ignores the header', () => {
  assert.equal(stateOf(obs({ url: 'http://api.test/v1' }), 'sec/hsts-missing'), 'not-applicable');
});

// --- sec/csp-missing and sec/x-frame-options -------------------------------

const DOC = { 'content-type': 'text/html; charset=utf-8' };

test('csp-missing: fires on a document with no policy', () => {
  assert.equal(stateOf(obs({ headers: DOC }), 'sec/csp-missing'), 'fired');
});

test('csp-missing: silent on a document with a policy', () => {
  assert.equal(stateOf(obs({ headers: { ...DOC, 'content-security-policy': "default-src 'self'" } }), 'sec/csp-missing'), 'silent');
});

test('csp-missing: not applicable on a JSON response — the whole reason four API rules were added', () => {
  assert.equal(stateOf(obs({ headers: { 'content-type': 'application/json' } }), 'sec/csp-missing'), 'not-applicable');
});

test('x-frame-options: fires on a document with neither the header nor frame-ancestors', () => {
  assert.equal(stateOf(obs({ headers: DOC }), 'sec/x-frame-options'), 'fired');
});

test('x-frame-options: silent with the header', () => {
  assert.equal(stateOf(obs({ headers: { ...DOC, 'x-frame-options': 'DENY' } }), 'sec/x-frame-options'), 'silent');
});

test('x-frame-options: silent with a CSP frame-ancestors directive instead', () => {
  // A CSP-only app is correctly defended; firing on it would be a false positive against a policy
  // strictly better than the header being asked for.
  assert.equal(stateOf(obs({ headers: { ...DOC, 'content-security-policy': "default-src 'self'; frame-ancestors 'none'" } }), 'sec/x-frame-options'), 'silent');
});

test('x-frame-options: a CSP without frame-ancestors does not satisfy it', () => {
  assert.equal(stateOf(obs({ headers: { ...DOC, 'content-security-policy': "default-src 'self'" } }), 'sec/x-frame-options'), 'fired');
});

test('x-frame-options: not applicable on a JSON response', () => {
  assert.equal(stateOf(obs({ headers: { 'content-type': 'application/json' } }), 'sec/x-frame-options'), 'not-applicable');
});

// --- sec/cookie-samesite-none ----------------------------------------------

test('cookie-samesite-none: fires on an explicit None', () => {
  assert.equal(stateOf(obs({ setCookie: ['sid=abc; SameSite=None'] }), 'sec/cookie-samesite-none'), 'fired');
});

test('cookie-samesite-none: silent on Lax', () => {
  assert.equal(stateOf(obs({ setCookie: ['sid=abc; SameSite=Lax'] }), 'sec/cookie-samesite-none'), 'silent');
});

test('cookie-samesite-none: silent when SameSite is absent — browsers default to Lax', () => {
  // Reporting absence would fire on the majority of correct cookies on the internet, which is the
  // zero-false-positive bar failing on the pack's commonest input.
  assert.equal(stateOf(obs({ setCookie: ['sid=abc; HttpOnly; Secure'] }), 'sec/cookie-samesite-none'), 'silent');
});

test('cookie-samesite-none: not applicable when no cookie is set', () => {
  assert.equal(stateOf(obs(), 'sec/cookie-samesite-none'), 'not-applicable');
});

// --- sec/nosniff-missing ---------------------------------------------------

test('nosniff-missing: fires when the header is absent', () => {
  assert.equal(stateOf(obs(), 'sec/nosniff-missing'), 'fired');
});

test('nosniff-missing: silent when it says nosniff', () => {
  assert.equal(stateOf(obs({ headers: { 'x-content-type-options': 'nosniff' } }), 'sec/nosniff-missing'), 'silent');
});

test('nosniff-missing: fires, and says so, when the header carries some other value', () => {
  const r = runSecurityScan(obs({ headers: { 'x-content-type-options': 'sniff' } }));
  const f = r.findings.find((x) => x.id === 'sec/nosniff-missing');
  assert.ok(f);
  assert.match(f.detail, /is `sniff`, not `nosniff`/);
});

test('nosniff-missing: applies always — it is never in the not-applicable set', () => {
  for (const o of [obs(), obs({ url: 'http://api.test/' }), obs({ headers: DOC })]) {
    assert.ok(!runSecurityScan(o).notApplicable.some((n) => n.rule.id === 'sec/nosniff-missing'));
  }
});

// --- sec/authenticated-response-cacheable ----------------------------------

test('authenticated-response-cacheable: fires for a cookie-authenticated response with no Cache-Control', () => {
  assert.equal(stateOf(obs({ requestHeaders: { cookie: 'session=x' } }), 'sec/authenticated-response-cacheable'), 'fired');
});

test('authenticated-response-cacheable: fires for a bearer-authenticated response too', () => {
  assert.equal(stateOf(obs({ requestHeaders: { authorization: 'Bearer x' } }), 'sec/authenticated-response-cacheable'), 'fired');
});

test('authenticated-response-cacheable: silent when any Cache-Control is present', () => {
  // Narrowest possible form: absence, not "a policy I judge insufficient". A deliberately-public
  // authenticated endpoint sets `Cache-Control: public` and this stays quiet.
  assert.equal(stateOf(obs({ requestHeaders: { cookie: 'session=x' }, headers: { 'cache-control': 'public, max-age=60' } }), 'sec/authenticated-response-cacheable'), 'silent');
});

test('authenticated-response-cacheable: not applicable for an unauthenticated request', () => {
  assert.equal(stateOf(obs(), 'sec/authenticated-response-cacheable'), 'not-applicable');
});

// --- sec/server-version-disclosure ------------------------------------------

test('server-version-disclosure: fires on a versioned Server header', () => {
  const r = runSecurityScan(obs({ headers: { server: 'nginx/1.27.5' } }));
  const f = r.findings.find((x) => x.id === 'sec/server-version-disclosure');
  assert.ok(f);
  assert.match(f.detail, /nginx\/1\.27\.5/);
});

test('server-version-disclosure: silent on a product name with no version', () => {
  // Resolves the caveat testFlow-tests/VULNS.md left open: bare `X-Powered-By: Express` is a
  // genuine negative, not an unreported positive. The rule id says *version*.
  assert.equal(stateOf(obs({ headers: { 'x-powered-by': 'Express' } }), 'sec/server-version-disclosure'), 'silent');
});

test('server-version-disclosure: reports both headers separately when both are versioned', () => {
  const r = runSecurityScan(obs({ headers: { server: 'nginx/1.27.5', 'x-powered-by': 'PHP/8.2.1' } }));
  assert.equal(r.findings.filter((f) => f.id === 'sec/server-version-disclosure').length, 2);
});

// --- D296: the floor narrows the pack before applicability -------------------

test('a severity floor narrows which rules are considered at all', () => {
  const r = runSecurityScan(obs({ headers: { server: 'nginx/1.27.5' } }), 'critical');
  assert.equal(r.considered, 3);
  assert.ok([...r.applicable, ...r.notApplicable.map((n) => n.rule)].every((rule) => rule.severity === 'critical'));
  // The minor finding that a floorless scan would have reported is not merely filtered out of the
  // findings — its rule was never in play, so the denominator says 3 rather than 10.
  assert.equal(r.findings.length, 0);
});

test('a floor keeps everything at or above it, not only an exact match', () => {
  const r = runSecurityScan(obs(), 'serious');
  assert.equal(r.considered, 7); // 3 critical + 4 serious (hsts, csp, and M128c's two TLS rules)
});

test('considered always equals applicable + not-applicable', () => {
  for (const floor of [null, 'minor', 'moderate', 'serious', 'critical'] as const) {
    const r = runSecurityScan(obs({ setCookie: ['a=1'], headers: DOC, requestHeaders: { cookie: 'x=1' } }), floor);
    assert.equal(r.considered, r.applicable.length + r.notApplicable.length);
  }
});

test('a critical floor against a plain JSON GET engages nothing — the state D285 fails on', () => {
  const r = runSecurityScan(obs({ headers: { 'content-type': 'application/json' } }), 'critical');
  assert.equal(r.applicable.length, 0);
  assert.equal(r.considered, 3);
});

// --- the whole pack against realistic shapes --------------------------------

test('a clean JSON API response over https still trips the two unconditional rules', () => {
  // The §0 prediction, in miniature: a JSON API behind an nginx that sets no security headers.
  assert.deepEqual(fired(obs({ headers: { 'content-type': 'application/json', server: 'nginx/1.27.5' } })), [
    'sec/hsts-missing',
    'sec/nosniff-missing',
    'sec/server-version-disclosure',
  ]);
});

test('a fully hardened https document trips nothing', () => {
  assert.deepEqual(
    fired(
      obs({
        headers: {
          'content-type': 'text/html',
          'strict-transport-security': 'max-age=31536000; includeSubDomains',
          'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
          'x-frame-options': 'DENY',
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
        },
        requestHeaders: { cookie: 'session=x' },
        setCookie: ['sid=abc; HttpOnly; Secure; SameSite=Lax'],
      }),
    ),
    [],
  );
});

test('an unparseable final URL makes the https-conditional rules stand down rather than fire', () => {
  const r = runSecurityScan(obs({ url: 'not a url', setCookie: ['a=1'] }));
  assert.ok(r.notApplicable.some((n) => n.rule.id === 'sec/hsts-missing'));
  assert.ok(r.notApplicable.some((n) => n.rule.id === 'sec/cookie-not-secure'));
});

test('a malformed Set-Cookie line is skipped, not reported as a nameless finding', () => {
  const r = runSecurityScan(obs({ setCookie: ['', '=novalue', 'good=1'] }));
  const details = r.findings.filter((f) => f.id === 'sec/cookie-not-httponly').map((f) => f.detail);
  assert.equal(details.length, 1);
  assert.match(details[0]!, /`good`/);
});

// --- M128c: the two TLS rules ------------------------------------------------
//
// The facts arrive as data (`o.tls`), which is the whole point of the `tlsProbe.ts` split: every
// case below — a TLS 1.0 server, a NULL cipher, a refused handshake — is expressible here without a
// listener that can actually negotiate it. That matters more than usual, because the plan's §3 risk
// note says the TLS 1.0 *positive* may not be constructible against a real modern nginx at all.

/** An observation carrying probe facts, https by default since that is the only way it happens. */
function tlsObs(tls: Observation['tls'], over: Partial<Observation> = {}): Observation {
  return obs({ tls, ...over });
}

const MODERN = { ok: true as const, protocol: 'TLSv1.3', cipherName: 'TLS_AES_256_GCM_SHA384', cipherStandardName: 'TLS_AES_256_GCM_SHA384' };

test('tls-version-old: fires on every protocol RFC 8996 deprecates', () => {
  for (const protocol of ['SSLv2', 'SSLv3', 'TLSv1', 'TLSv1.1']) {
    assert.deepEqual(
      fired(tlsObs({ ok: true, protocol, cipherName: 'ECDHE-RSA-AES128-GCM-SHA256' })).filter((id) => id === 'sec/tls-version-old'),
      ['sec/tls-version-old'],
      `expected ${protocol} to be reported`,
    );
  }
});

test('tls-version-old: silent on TLS 1.2 and 1.3', () => {
  for (const protocol of ['TLSv1.2', 'TLSv1.3']) {
    assert.equal(stateOf(tlsObs({ ok: true, protocol, cipherName: 'ECDHE-RSA-AES128-GCM-SHA256' }), 'sec/tls-version-old'), 'silent');
  }
});

test('tls-version-old: an unrecognized protocol string is silent, not a finding', () => {
  // The set is closed on purpose (`DEAD_PROTOCOLS`). A future `TLSv1.4` must not be reported as
  // deprecated by a rule that has never heard of it, which is exactly what a `< 'TLSv1.2'` string
  // comparison would do.
  assert.equal(stateOf(tlsObs({ ok: true, protocol: 'TLSv1.4', cipherName: 'TLS_AES_128_GCM_SHA256' }), 'sec/tls-version-old'), 'silent');
});

test('tls-weak-cipher: fires on each broken family, in either spelling', () => {
  const broken = [
    'ECDHE-RSA-DES-CBC3-SHA',
    'TLS_RSA_WITH_NULL_SHA256',
    'RC4-MD5',
    'EXP-DES-CBC-SHA',
    'ADH-AES128-SHA',
    'AECDH-NULL-SHA',
  ];
  for (const cipherName of broken) {
    assert.equal(stateOf(tlsObs({ ok: true, protocol: 'TLSv1.2', cipherName }), 'sec/tls-weak-cipher'), 'fired', cipherName);
  }
});

test('tls-weak-cipher: silent on the suites a current server actually negotiates', () => {
  const fine = [
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384',
    'DHE-RSA-AES256-GCM-SHA384',
    'ECDHE-RSA-AES128-SHA256',
  ];
  for (const cipherName of fine) {
    assert.equal(stateOf(tlsObs({ ok: true, protocol: 'TLSv1.2', cipherName }), 'sec/tls-weak-cipher'), 'silent', cipherName);
  }
});

test('tls-weak-cipher: matches whole tokens, so `DES` never hits from inside another word', () => {
  // The reason `cipherTokens` splits rather than searching for a substring. If it did search,
  // anything containing these letters in sequence would be condemned; the tokenizer is what makes
  // the narrow list stay narrow.
  assert.equal(stateOf(tlsObs({ ok: true, protocol: 'TLSv1.2', cipherName: 'ECDHE-RSA-CAMELLIA256-SHA384' }), 'sec/tls-weak-cipher'), 'silent');
  assert.equal(stateOf(tlsObs({ ok: true, protocol: 'TLSv1.2', cipherName: 'ECDHE-RSA-AES256-SHA' }), 'sec/tls-weak-cipher'), 'silent');
});

test('tls-weak-cipher: reads the IANA spelling too, since Node omits it on old handshakes', () => {
  // The OpenSSL name here is unremarkable; only the standard name gives it away. A rule reading one
  // spelling would miss half the ways Node reports the same suite.
  assert.equal(
    stateOf(tlsObs({ ok: true, protocol: 'TLSv1.2', cipherName: 'SOMETHING-OPAQUE', cipherStandardName: 'TLS_RSA_WITH_3DES_EDE_CBC_SHA' }), 'sec/tls-weak-cipher'),
    'fired',
  );
});

test('the finding names the suite and scopes the claim to what a current client gets', () => {
  // D288/D299's caveat is load-bearing and belongs in the failure text, not only in the docs: the
  // probe is a second connection, and it reports what *it* negotiated rather than the server's whole
  // offer. Over-claiming here is how a reader concludes the pack ruled out something it never asked.
  const f = runSecurityScan(tlsObs({ ok: true, protocol: 'TLSv1', cipherName: 'RC4-MD5' })).findings;
  const version = f.find((x) => x.id === 'sec/tls-version-old')!;
  const cipher = f.find((x) => x.id === 'sec/tls-weak-cipher')!;
  assert.match(version.detail, /TLSv1/);
  assert.match(version.detail, /what this host gives a current client/);
  assert.match(cipher.detail, /RC4-MD5/);
  assert.match(cipher.detail, /what this host gives a current client/);
});

test('no probe facts at all: both rules are not-applicable, never a silent pass', () => {
  for (const id of ['sec/tls-version-old', 'sec/tls-weak-cipher']) {
    assert.equal(stateOf(obs(), id), 'not-applicable');
  }
});

test('a failed probe is not-applicable, and says which half of the precondition failed', () => {
  // The reason the dynamic `because` exists. "the scheme is https and the TLS probe succeeded" is
  // equally true of a plaintext response and of a refused handshake, and sending a reader after a
  // scheme problem on an https response is a wrong answer, not merely a vague one.
  const r = runSecurityScan(tlsObs({ ok: false, reason: 'the TLS handshake to api.test:443 failed: ECONNREFUSED' }));
  const stood = r.notApplicable.filter((n) => n.rule.id.startsWith('sec/tls-'));
  assert.equal(stood.length, 2);
  for (const n of stood) {
    assert.match(n.because, /it did not: the TLS handshake to api\.test:443 failed: ECONNREFUSED/);
  }
});

test('an applicable-but-clean probe reports neither rule as not-applicable', () => {
  const r = runSecurityScan(tlsObs(MODERN));
  assert.ok(r.applicable.some((rule) => rule.id === 'sec/tls-version-old'));
  assert.ok(r.applicable.some((rule) => rule.id === 'sec/tls-weak-cipher'));
  assert.equal(r.findings.filter((f) => f.id.startsWith('sec/tls-')).length, 0);
});

test('a `serious` floor keeps both TLS rules; a `critical` floor drops them entirely', () => {
  const bad = { ok: true as const, protocol: 'TLSv1', cipherName: 'RC4-MD5' };
  assert.equal(runSecurityScan(tlsObs(bad), 'serious').findings.filter((f) => f.id.startsWith('sec/tls-')).length, 2);
  const critical = runSecurityScan(tlsObs(bad), 'critical');
  assert.equal(critical.findings.length, 0);
  // D296: dropped from the *pack*, so they are not in the not-applicable listing either — the
  // denominator describes the work the assertion actually did.
  assert.ok(!critical.notApplicable.some((n) => n.rule.id.startsWith('sec/tls-')));
});
