// The authorization probe (M130b1, PLAN_M130B_AUTHZ_ENGINE.md D323–D326) — every branch driven
// through an injected sender, so the whole taxonomy is reachable without a network.
//
// Two things these tests are built to make hard to break. **A `not probed` principal must send
// nothing** — asserted against `sentCount`, because a skip whose only evidence is its own label is a
// skip that could be probing anyway. And **the identity actually swapped** — asserted against the
// captured request, not against the absence of a failure, because "the probe went out as somebody"
// is the one fact this file exists to establish.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANONYMOUS,
  AuthzProber,
  buildProbeRequest,
  classifyResponse,
  isCookieBorne,
  isSafeMethod,
  probeOrder,
  type ProbePolicy,
  type ProbePrincipal,
  type ProbeRequest,
} from '../src/authzProbe.js';
import { CookieJar } from '../src/cookieJar.js';
import type { RequestTrace, ResponseTrace } from '../src/types.js';

const POLICY: ProbePolicy = { timeoutMs: 5_000, allowHosts: null, insecure: false, probeMutating: false };

function req(over: Partial<RequestTrace> = {}): RequestTrace {
  return {
    method: 'GET',
    url: 'https://api.test/v1/orders/a1',
    headers: { Authorization: 'Bearer OWNER', 'Content-Type': 'application/json', 'X-Trace': 'keep-me' },
    ...over,
  };
}

function res(over: Partial<ResponseTrace> = {}): ResponseTrace {
  const json = 'json' in over ? over.json : {};
  return {
    status: 200,
    statusText: 'OK',
    headers: {},
    bodyText: JSON.stringify(json ?? null),
    bodyBytes: Buffer.from(''),
    json,
    durationMs: 1,
    finalUrl: 'https://api.test/v1/orders/a1',
    cookieEvents: [],
    ...over,
  };
}

function principal(name: string, over: Partial<ProbePrincipal> = {}): ProbePrincipal {
  return { name, headers: {}, ...over };
}

function jarWith(origin: string, line: string): CookieJar {
  const jar = new CookieJar();
  jar.applySetCookieLines(origin, [line]);
  return jar;
}

/** A sender that records what it was asked to send and replies with a fixed response. */
function recordingSender(response: ResponseTrace = res()) {
  const sent: ProbeRequest[] = [];
  return {
    sent,
    send: async (r: ProbeRequest) => {
      sent.push(r);
      return response;
    },
  };
}

// ---------------------------------------------------------------------------
// D323 — building the probe.
// ---------------------------------------------------------------------------

test('D323: method, URL and body travel verbatim', () => {
  const observed = req({ method: 'POST', url: 'https://api.test/v1/orders?dry=1', body: '{"n":1}' });
  const p = buildProbeRequest(observed, principal('peer'), POLICY);
  assert.equal(p.method, 'POST');
  assert.equal(p.url, 'https://api.test/v1/orders?dry=1');
  assert.equal(p.body, '{"n":1}');
});

test('D323: the owner’s Authorization and Cookie are stripped', () => {
  const observed = req({ headers: { Authorization: 'Bearer OWNER', Cookie: 'sid=owner' } });
  const p = buildProbeRequest(observed, principal('peer'), POLICY);
  assert.equal(p.headers['Authorization'], undefined);
  assert.equal(p.headers['Cookie'], undefined);
});

test('D323: stripping is case-insensitive, because a header map keeps the case its author typed', () => {
  // The exact assumption M128's `authenticated-response-cacheable` got wrong, which is why it fired
  // for nobody. Getting it wrong *here* would send the owner's own token on the probe.
  const observed = req({ headers: { authorization: 'Bearer OWNER', COOKIE: 'sid=owner' } });
  const p = buildProbeRequest(observed, principal('peer'), POLICY);
  assert.deepEqual(Object.keys(p.headers), []);
});

test('D323: every other header travels unchanged', () => {
  const p = buildProbeRequest(req(), principal('peer'), POLICY);
  assert.equal(p.headers['Content-Type'], 'application/json');
  assert.equal(p.headers['X-Trace'], 'keep-me');
});

test('D323: the principal’s own identity is applied', () => {
  const p = buildProbeRequest(req(), principal('peer', { headers: { Authorization: 'Bearer PEER' } }), POLICY);
  assert.equal(p.headers['Authorization'], 'Bearer PEER');
});

test('D323: the principal’s jar cookies for THIS origin are applied', () => {
  const p = buildProbeRequest(req(), principal('shopper', { cookieJar: jarWith('https://api.test', 'sid=shopper; Path=/') }), POLICY);
  assert.match(p.headers['Cookie'] ?? '', /sid=shopper/);
});

test('D323: a jar holding cookies for a DIFFERENT origin contributes nothing', () => {
  const p = buildProbeRequest(req(), principal('shopper', { cookieJar: jarWith('https://elsewhere.test', 'sid=shopper; Path=/') }), POLICY);
  assert.equal(p.headers['Cookie'], undefined);
});

test('D323/D306: anonymous applies neither a header nor a cookie', () => {
  // A real anonymous request, not a request with somebody's cookies missing.
  const observed = req({ headers: { Authorization: 'Bearer OWNER', Cookie: 'sid=owner', Accept: 'application/json' } });
  const p = buildProbeRequest(observed, principal(ANONYMOUS), POLICY);
  assert.deepEqual(p.headers, { Accept: 'application/json' });
});

test('D323: the step’s own timeout and insecure flag travel with the probe', () => {
  const p = buildProbeRequest(req(), principal('peer'), { ...POLICY, timeoutMs: 1234, insecure: true });
  assert.equal(p.timeoutMs, 1234);
  assert.equal(p.insecure, true);
});

test('D323: building a probe does not mutate the principal’s jar or the observed request', () => {
  const jar = jarWith('https://api.test', 'sid=shopper; Path=/');
  const observed = req();
  const before = jar.serialize('https://api.test');
  buildProbeRequest(observed, principal('shopper', { cookieJar: jar }), POLICY);
  assert.equal(jar.serialize('https://api.test'), before);
  assert.equal(observed.headers['Authorization'], 'Bearer OWNER', 'the observed trace is evidence and must not be edited');
});

// ---------------------------------------------------------------------------
// D326 — order.
// ---------------------------------------------------------------------------

test('D326: anonymous is probed last, whatever order the caller assembled', () => {
  const order = probeOrder([principal(ANONYMOUS), principal('peer'), principal('oauthLong')]).map((p) => p.name);
  assert.deepEqual(order, ['peer', 'oauthLong', ANONYMOUS]);
});

test('D326: probes are sequential and in that order', async () => {
  const rec = recordingSender();
  const prober = new AuthzProber(rec.send);
  await prober.probeAll(req(), ['a1'], [principal(ANONYMOUS, {}), principal('peer', { headers: { Authorization: 'Bearer PEER' } })], POLICY);
  assert.deepEqual(
    rec.sent.map((r) => r.headers['Authorization'] ?? 'none'),
    ['Bearer PEER', 'none'],
  );
});

// ---------------------------------------------------------------------------
// D324 — the taxonomy.
// ---------------------------------------------------------------------------

const ctxGet = { method: 'GET', cookieBorne: false };

test('D324: a 2xx carrying an owner id is a leak', () => {
  assert.deepEqual(classifyResponse(res({ json: { id: 'a1' } }), ['a1'], ctxGet), { kind: 'leaked', ids: ['a1'] });
});

test('D324: a 2xx carrying no owner id served different content', () => {
  assert.deepEqual(classifyResponse(res({ json: { id: 'b7' } }), ['a1'], ctxGet), { kind: 'served-different', status: 200 });
});

test('D324: 401, 403 and 404 are refusals', () => {
  for (const status of [401, 403, 404]) {
    assert.deepEqual(classifyResponse(res({ status, json: {} }), ['a1'], ctxGet), { kind: 'refused', status });
  }
});

test('D324: 404 is a refusal, not a suspicion — it is the more careful of two correct answers', () => {
  const o = classifyResponse(res({ status: 404, json: { message: 'not found' } }), ['a1'], ctxGet);
  assert.equal(o.kind, 'refused');
});

test('D324: 429 is inconclusive — a rate limiter is not an authorization boundary', () => {
  const o = classifyResponse(res({ status: 429, json: {} }), ['a1'], ctxGet);
  assert.equal(o.kind, 'inconclusive');
  assert.match(o.kind === 'inconclusive' ? o.reason : '', /rate limited/);
});

test('D324: any 5xx is inconclusive', () => {
  for (const status of [500, 502, 503]) {
    assert.equal(classifyResponse(res({ status, json: {} }), ['a1'], ctxGet).kind, 'inconclusive');
  }
});

test('D324: a 2xx with a non-JSON body is inconclusive, never clean', () => {
  const o = classifyResponse(res({ json: undefined, bodyText: '<html></html>' }), ['a1'], ctxGet);
  assert.equal(o.kind, 'inconclusive');
  assert.match(o.kind === 'inconclusive' ? o.reason : '', /not JSON/);
});

test('D324: a 400 or a 405 is inconclusive — answered, but not with an authorization decision', () => {
  for (const status of [400, 405, 409, 422]) {
    const o = classifyResponse(res({ status, json: {} }), ['a1'], ctxGet);
    assert.equal(o.kind, 'inconclusive', `status ${status}`);
  }
});

test('a leak requires the resource to have been SERVED — a 404 that echoes the id is not a leak', () => {
  // THE false-positive this design turns off, and it is live in the dogfood target:
  // `categories.service.ts:44` throws `category ${id} not found`, so a correct 404 returns the
  // owner's id in its body. Running containment over a refusal would report a critical BOLA
  // finding on a correctly-refusing endpoint, which is the opposite of Tier 2's stated bar.
  const echo = res({ status: 404, json: { message: 'order a1 not found', statusCode: 404 } });
  assert.deepEqual(classifyResponse(echo, ['a1'], ctxGet), { kind: 'refused', status: 404 });

  const forbidden = res({ status: 403, json: { message: 'you may not access order a1' } });
  assert.deepEqual(classifyResponse(forbidden, ['a1'], ctxGet), { kind: 'refused', status: 403 });
});

// ---------------------------------------------------------------------------
// D325 / M130-01 — the CSRF case.
// ---------------------------------------------------------------------------

test('D325: a cookie-borne principal refused on a mutating method is inconclusive', () => {
  const o = classifyResponse(res({ status: 403, json: {} }), ['a1'], { method: 'DELETE', cookieBorne: true });
  assert.equal(o.kind, 'inconclusive');
  const reason = o.kind === 'inconclusive' ? o.reason : '';
  assert.match(reason, /may be CSRF rather than authorization/);
  assert.match(reason, /Give it a bearer session/, 'the reason must name the way out');
  assert.match(reason, /DELETE/);
});

test('D325: the same principal refused on a SAFE method is an ordinary refusal', () => {
  // CSRF guards do not apply to safe methods, so a cookie principal refused on a GET really was
  // refused by authorization.
  assert.deepEqual(classifyResponse(res({ status: 403, json: {} }), ['a1'], { method: 'GET', cookieBorne: true }), {
    kind: 'refused',
    status: 403,
  });
});

test('D325: a BEARER principal refused on a mutating method is an ordinary refusal', () => {
  assert.deepEqual(classifyResponse(res({ status: 403, json: {} }), ['a1'], { method: 'DELETE', cookieBorne: false }), {
    kind: 'refused',
    status: 403,
  });
});

test('D325: the cookie-borne principal is still PROBED, so an app with no CSRF defence is caught', () => {
  // The argument for classifying rather than skipping: an unprotected app answers 2xx and leaks,
  // and a structural pre-flight skip would decline to probe exactly that app.
  const leak = classifyResponse(res({ status: 200, json: { id: 'a1' } }), ['a1'], { method: 'DELETE', cookieBorne: true });
  assert.deepEqual(leak, { kind: 'leaked', ids: ['a1'] });
});

test('D325: cookie-borne is read off the principal’s own establishment outcome', () => {
  const origin = 'https://api.test';
  const jar = jarWith(origin, 'sid=shopper; Path=/');
  assert.equal(isCookieBorne(principal('shopper', { cookieJar: jar }), origin), true);
  assert.equal(isCookieBorne(principal('admin', { headers: { Authorization: 'Bearer A' }, cookieJar: jar }), origin), false, 'a bearer is not cookie-borne');
  assert.equal(isCookieBorne(principal('peer', { headers: { authorization: 'Bearer A' }, cookieJar: jar }), origin), false, 'case-insensitively');
  assert.equal(isCookieBorne(principal(ANONYMOUS), origin), false);
  assert.equal(isCookieBorne(principal('shopper', { cookieJar: jarWith('https://elsewhere.test', 'sid=s') }), origin), false, 'cookies for another origin are not an identity here');
});

// ---------------------------------------------------------------------------
// not-probed, and the proof that nothing went out.
// ---------------------------------------------------------------------------

test('a mutating method with no `probe mutating` is not probed, and sends NOTHING', async () => {
  const rec = recordingSender();
  const prober = new AuthzProber(rec.send);
  const results = await prober.probeAll(req({ method: 'DELETE' }), ['a1'], [principal('peer')], POLICY);
  assert.equal(results[0]!.outcome.kind, 'not-probed');
  assert.equal(prober.sentCount, 0, 'an un-opted-in write must not reach the network');
  assert.equal(rec.sent.length, 0);
  assert.match(results[0]!.outcome.kind === 'not-probed' ? results[0]!.outcome.reason : '', /probe mutating/);
});

test('`probe mutating` lets the write through', async () => {
  const rec = recordingSender();
  const prober = new AuthzProber(rec.send);
  const results = await prober.probeAll(req({ method: 'DELETE' }), ['a1'], [principal('peer')], { ...POLICY, probeMutating: true });
  assert.notEqual(results[0]!.outcome.kind, 'not-probed');
  assert.equal(prober.sentCount, 1);
});

test('an unknown method counts as mutating — the failure directions are not symmetric', async () => {
  const rec = recordingSender();
  const prober = new AuthzProber(rec.send);
  const results = await prober.probeAll(req({ method: 'PURGE' }), ['a1'], [principal('peer')], POLICY);
  assert.equal(results[0]!.outcome.kind, 'not-probed');
  assert.equal(prober.sentCount, 0);
  assert.equal(isSafeMethod('PURGE'), false);
  for (const m of ['get', 'GET', 'head', 'OPTIONS']) assert.equal(isSafeMethod(m), true, m);
});

test('a session that would not establish is not probed, and says which session and why', async () => {
  const rec = recordingSender();
  const prober = new AuthzProber(rec.send);
  const results = await prober.probeAll(req(), ['a1'], [principal('oauthLong', { unavailable: 'token endpoint answered 500' })], POLICY);
  const outcome = results[0]!.outcome;
  assert.equal(outcome.kind, 'not-probed');
  assert.match(outcome.kind === 'not-probed' ? outcome.reason : '', /session "oauthLong" could not be established: token endpoint answered 500/);
  assert.equal(prober.sentCount, 0);
});

test('a host outside `allow hosts` is not probed, and the refusal names the principal', async () => {
  const rec = recordingSender();
  const prober = new AuthzProber(rec.send);
  const results = await prober.probeAll(req(), ['a1'], [principal('peer')], { ...POLICY, allowHosts: ['other.test'] });
  const outcome = results[0]!.outcome;
  assert.equal(outcome.kind, 'not-probed');
  const reason = outcome.kind === 'not-probed' ? outcome.reason : '';
  assert.match(reason, /authorization probe as `peer`/, 'the sentence must name what the author did not write');
  assert.match(reason, /the original request was allowed/);
  assert.equal(prober.sentCount, 0);
});

test('a transport failure is not probed, never a refusal', async () => {
  // A socket error must not read as "the boundary held". It is the one failure that could
  // masquerade as a clean result, since both produce no resource.
  const prober = new AuthzProber(async () => {
    throw new Error('ECONNRESET');
  });
  const results = await prober.probeAll(req(), ['a1'], [principal('peer')], POLICY);
  const outcome = results[0]!.outcome;
  assert.equal(outcome.kind, 'not-probed');
  assert.match(outcome.kind === 'not-probed' ? outcome.reason : '', /the probe request failed: ECONNRESET/);
});

test('probeAll never throws, and returns one result per principal', async () => {
  const prober = new AuthzProber(async () => {
    throw new Error('boom');
  });
  const results = await prober.probeAll(req(), ['a1'], [principal('peer'), principal('oauthLong'), principal(ANONYMOUS)], POLICY);
  assert.equal(results.length, 3);
  assert.deepEqual(results.map((r) => r.principal), ['peer', 'oauthLong', ANONYMOUS]);
});

test('a probed result carries its response; a not-probed one carries none', async () => {
  const prober = new AuthzProber(recordingSender().send);
  const [probed, skipped] = await prober.probeAll(
    req(),
    ['a1'],
    [principal('peer'), principal('oauthLong', { unavailable: 'no credentials' })],
    POLICY,
  );
  assert.ok(probed!.response, 'a sent probe records what came back');
  assert.equal(skipped!.response, undefined, 'a probe that never went out has no response to record');
});

test('end to end: the four outcomes of one assertion, in one call', async () => {
  const byPrincipal: Record<string, ResponseTrace> = {
    peer: res({ json: { id: 'a1' } }), //           leak
    oauthLong: res({ status: 403, json: {} }), //   refused
    oauthShort: res({ json: { id: 'b7' } }), //     served different content
    [ANONYMOUS]: res({ status: 429, json: {} }), // inconclusive
  };
  let current = '';
  const prober = new AuthzProber(async (r) => byPrincipal[current] ?? res());
  const principals = [principal('peer', { headers: { Authorization: 'Bearer P' } }), principal('oauthLong'), principal('oauthShort'), principal(ANONYMOUS)];

  const results: string[] = [];
  for (const p of probeOrder(principals)) {
    current = p.name;
    const [r] = await prober.probeAll(req(), ['a1'], [p], POLICY);
    results.push(`${r!.principal}:${r!.outcome.kind}`);
  }
  assert.deepEqual(results, ['peer:leaked', 'oauthLong:refused', 'oauthShort:served-different', 'anonymous:inconclusive']);
});
