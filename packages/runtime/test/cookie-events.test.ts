// M88c1 (review cluster C2 — `B4-15`, `B4-16`, D-M88-11/D-M88-13/D-M88-14) — every hop that hands
// over a cookie is reported, and it is reported with the origin that handed it over.
//
// The finding: only the *final* response's headers survived a redirect chain. Every earlier hop was
// drained and discarded — inside undici on the native path, explicitly on the three hand-walked
// ones. So the commonest login shape in existence, `POST /login` → `302` + `Set-Cookie` →
// `GET /dashboard`, lost its session cookie outright; and because a request's headers are fixed once
// before the chain starts, the hop to the protected page also went out unauthenticated. Nothing said
// so. The 200 from `/dashboard` looked exactly like a successful login, and the jar stayed empty.
//
// Two things follow that the row did not:
//
//   1. Fixing it meant the pooled client had to stop delegating to native `redirect: 'follow'`
//      (D-M88-14). There is no seam between hops inside a single `await fetch()`, so an intermediate
//      `Set-Cookie` is unreachable there in principle, not by omission. Hand-walking only when
//      `allow hosts` was set — the M85 arrangement — would have fixed the lost session *only for
//      runs that had opted into an unrelated security key*, which is `B4-14`'s own failure shape
//      wearing a different hat.
//   2. That costs the oracle the old split was accidentally providing: with both arms hand-walked,
//      "guarded equals unguarded" no longer pins anything to `fetch`'s own answer. The last test
//      here states that property directly instead, against a raw `fetch(redirect: 'follow')`.
//
// Written as pairs, like `redirect-cap.test.ts` and `timeout-chain.test.ts` — the property is
// "these two clients agree on this chain", not "this client does what I typed".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { sendRequest } from '../src/http.js';
import { createPinnedAgents, destroyPinnedAgents, sendPinnedRequest } from '../src/httpPinned.js';
import { startFixtureServer, testConfig, json, type Handler } from './support.js';

const GUARDED = ['127.0.0.1'];

const SESSION_COOKIE = 'sid=abc123; Path=/; HttpOnly';
const CSRF_COOKIE = 'csrf=xyz789';

/** The login-by-302: the hop that sets the cookies is not the hop that answers. `/dashboard` sets
 * nothing at all, which is the point — it is the only response the jar used to see. */
function loginChainRoutes(): Record<string, Handler> {
  return {
    '/login': (_req, res) => res.writeHead(302, { location: '/dashboard', 'set-cookie': [SESSION_COOKIE, CSRF_COOKIE] }).end(),
    '/dashboard': (_req, res) => json(res, 200, { landed: true }),
  };
}

test('a `Set-Cookie` on an intermediate hop is reported, not discarded with the hop (pooled)', async () => {
  const server = await startFixtureServer(loginChainRoutes());
  const res = await sendRequest({ method: 'GET', url: `${server.baseUrl}/login`, headers: {}, timeoutMs: 5000, followRedirects: true });

  // The half that always worked, restated so the failure below can't be misread: the chain lands,
  // and the response that lands carries no cookie whatsoever.
  assert.equal(res.status, 200);
  assert.equal(res.headers['set-cookie'], undefined, 'sanity: the final response is the one that never had the cookie');

  assert.equal(res.cookieEvents.length, 1, JSON.stringify(res.cookieEvents));
  assert.equal(res.cookieEvents[0]!.origin, server.baseUrl);
  assert.deepEqual(res.cookieEvents[0]!.setCookie, [SESSION_COOKIE, CSRF_COOKIE]);

  await server.close();
});

test('the pinned (workload) client reports the same hop the same way', async () => {
  const server = await startFixtureServer(loginChainRoutes());
  const agents = createPinnedAgents();
  const opts = { method: 'GET', url: `${server.baseUrl}/login`, headers: {}, timeoutMs: 5000, followRedirects: true } as const;

  const pooled = await sendRequest(opts);
  const pinned = await sendPinnedRequest(opts, agents);

  // Not "the pinned path returns these two strings" — that would still pass on the day the two
  // paths drift. Whether a login survives must not depend on whether the step ran under `run …
  // iterations` (the same property `B4-01` was about for credentials, one milestone's worth of
  // plumbing later).
  assert.deepEqual(pinned.cookieEvents, pooled.cookieEvents);
  assert.equal(pinned.finalUrl, pooled.finalUrl);

  destroyPinnedAgents(agents);
  await server.close();
});

test('`allow hosts` changes nothing about which cookies are reported', async () => {
  // The `B4-14` shape, applied to this change: guarded and unguarded are now the *same* loop, so
  // this should be trivially true — and that is exactly why it is worth pinning. The arrangement it
  // replaced (hand-walk only when guarded) would have made the guarded arm see two cookies and the
  // unguarded arm none, i.e. a security key deciding whether a login works.
  const server = await startFixtureServer(loginChainRoutes());
  const opts = { method: 'GET', url: `${server.baseUrl}/login`, headers: {}, timeoutMs: 5000, followRedirects: true } as const;

  const unguarded = await sendRequest(opts);
  const guarded = await sendRequest({ ...opts, allowHosts: GUARDED });

  assert.deepEqual(guarded.cookieEvents, unguarded.cookieEvents);
  assert.equal(guarded.cookieEvents.length, 1);

  await server.close();
});

test('a chain that crosses origins files each cookie under the host that actually set it', async () => {
  // D-M88-8, and the reason `finalUrl` alone cannot do this job: the chain ends on B, so filing by
  // terminus would hand A's session cookie to B, and filing by *requested* URL would hand B's to A.
  // Both are the cross-service replay the jar's scoping exists to prevent (D-M88-3).
  const other = await startFixtureServer({
    '/dashboard': (_req, res) => res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': ['bsid=from-b'] }).end(JSON.stringify({ landed: 'b' })),
  });
  const home = await startFixtureServer({
    '/login': (_req, res) => res.writeHead(302, { location: `${other.baseUrl}/dashboard`, 'set-cookie': [SESSION_COOKIE] }).end(),
  });

  const res = await sendRequest({ method: 'GET', url: `${home.baseUrl}/login`, headers: {}, timeoutMs: 5000, followRedirects: true });

  assert.equal(res.status, 200);
  assert.equal(res.cookieEvents.length, 2, JSON.stringify(res.cookieEvents));
  // Order is the order they arrived — a jar applying them in sequence gets last-wins right for free.
  assert.deepEqual(
    res.cookieEvents.map((e) => e.origin),
    [home.baseUrl, other.baseUrl],
  );
  assert.deepEqual(res.cookieEvents[0]!.setCookie, [SESSION_COOKIE]);
  assert.deepEqual(res.cookieEvents[1]!.setCookie, ['bsid=from-b']);
  assert.notEqual(home.baseUrl, other.baseUrl, 'sanity: two genuinely different origins, not one server twice');

  await home.close();
  await other.close();
});

test('the pinned client crosses origins the same way', async () => {
  const other = await startFixtureServer({
    '/dashboard': (_req, res) => res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': ['bsid=from-b'] }).end(JSON.stringify({ landed: 'b' })),
  });
  const home = await startFixtureServer({
    '/login': (_req, res) => res.writeHead(302, { location: `${other.baseUrl}/dashboard`, 'set-cookie': [SESSION_COOKIE] }).end(),
  });
  const agents = createPinnedAgents();
  const opts = { method: 'GET', url: `${home.baseUrl}/login`, headers: {}, timeoutMs: 5000, followRedirects: true } as const;

  const pooled = await sendRequest(opts);
  const pinned = await sendPinnedRequest(opts, agents);

  assert.deepEqual(pinned.cookieEvents, pooled.cookieEvents);
  assert.equal(pinned.finalUrl, `${other.baseUrl}/dashboard`);

  destroyPinnedAgents(agents);
  await home.close();
  await other.close();
});

test('`finalUrl` is where the chain ended, and the request URL when nothing redirected', async () => {
  const server = await startFixtureServer(loginChainRoutes());
  const opts = { method: 'GET', url: `${server.baseUrl}/login`, headers: {}, timeoutMs: 5000, followRedirects: true } as const;

  const followed = await sendRequest(opts);
  assert.equal(followed.finalUrl, `${server.baseUrl}/dashboard`);

  const direct = await sendRequest({ ...opts, url: `${server.baseUrl}/dashboard` });
  assert.equal(direct.finalUrl, `${server.baseUrl}/dashboard`);

  // `without redirects` stops on the 3xx, so the chain ended where it was told to start — and the
  // 3xx's own cookies are still reported, because that response really did set them.
  const unfollowed = await sendRequest({ ...opts, followRedirects: false });
  assert.equal(unfollowed.status, 302);
  assert.equal(unfollowed.finalUrl, `${server.baseUrl}/login`);
  assert.deepEqual(unfollowed.cookieEvents[0]!.setCookie, [SESSION_COOKIE, CSRF_COOKIE]);

  await server.close();
});

test('multiple `Set-Cookie`s on one response stay separate lines, and `headers` still joins them as before', async () => {
  // Decision 61's surface is deliberately untouched by this milestone: `capture header "set-cookie"`
  // still sees the newline-joined final-response value and nothing else. If that had moved, an
  // author's existing `expect header "set-cookie" matches …` would have changed meaning.
  const server = await startFixtureServer({
    '/login': (_req, res) => res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': [SESSION_COOKIE, CSRF_COOKIE] }).end(JSON.stringify({ ok: true })),
  });
  const agents = createPinnedAgents();
  const opts = { method: 'GET', url: `${server.baseUrl}/login`, headers: {}, timeoutMs: 5000, followRedirects: true } as const;

  const pooled = await sendRequest(opts);
  const pinned = await sendPinnedRequest(opts, agents);

  assert.equal(pooled.headers['set-cookie'], `${SESSION_COOKIE}\n${CSRF_COOKIE}`);
  assert.equal(pinned.headers['set-cookie'], pooled.headers['set-cookie']);
  assert.deepEqual(pooled.cookieEvents, [{ origin: server.baseUrl, setCookie: [SESSION_COOKIE, CSRF_COOKIE] }]);
  assert.deepEqual(pinned.cookieEvents, pooled.cookieEvents);

  destroyPinnedAgents(agents);
  await server.close();
});

test('the report copy carries the final URL and never the raw cookies (`B4-16`)', async () => {
  // `cookieEvents` is raw `Set-Cookie` — credentials, whose redacted stand-in (`headers`, after
  // `redactHeaderFields`) is already in the report. `redactResponseTrace`'s old `{ ...r }` spread
  // would have passed them straight into `report.html` and `results.json` the moment the field
  // existed, with no type error and no test to catch it; this is that default inverted.
  const server = await startFixtureServer(loginChainRoutes());
  const source = `test "logs in"\n  api GET /login\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.deepEqual(apiStep.response!.cookieEvents, [], 'the report copy must not carry raw Set-Cookie values');
  assert.equal(apiStep.response!.finalUrl, `${server.baseUrl}/dashboard`, 'the terminus is diagnostics, and does belong in the report');
  assert.doesNotMatch(JSON.stringify(report), /abc123/, 'no path through the serialized report reaches the session cookie');

  await server.close();
});

test('a secret reaching the report only through `finalUrl` is masked by the final pass too (`B4-16`)', async () => {
  // This is `B4-16` itself, and the only shape that can show it. `redactResponseTrace` (redact.ts)
  // is the *second* redaction pass — the one decision 56 added so a secret first registered late in
  // a run retroactively masks an earlier step's already-built trace. Its `{ ...r }` spread copied
  // any field it didn't name straight through, so a new field was unredacted in exactly that case:
  // no type error, no failing test, and a token in `report.html`.
  //
  // A redirect carrying a credential in its `location` is not a contrived way to reach it — it is
  // how every OAuth-style callback in the world hands one over.
  const server = await startFixtureServer({
    '/authorize': (_req, res) => res.writeHead(302, { location: '/callback?token=p@ssw0rd-xyz' }).end(),
    '/callback': (_req, res) => json(res, 200, { ok: true }),
    '/login': (_req, res) => json(res, 200, { ok: true }),
  });

  // Step 1's chain terminates on the URL holding the secret; only step 2 evaluates `env(ADMIN_PW)`
  // and so registers it. Nothing at the time step 1's trace was built knew the value.
  const source = `test "callback carries a token in its URL"
  api GET /authorize
  expect status equals 200
  api POST /login body { pass: env(ADMIN_PW) }
  expect status equals 200
`;
  const { program } = parseSource(source);
  const environ = { ...process.env, ADMIN_PW: 'p@ssw0rd-xyz' };
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, environ });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const authorizeStep = report.tests[0]!.steps.find((s) => s.detail?.includes('/authorize'))!;
  assert.doesNotMatch(authorizeStep.response!.finalUrl, /p@ssw0rd-xyz/, 'the final report pass must retroactively mask a secret in `finalUrl`');
  assert.match(authorizeStep.response!.finalUrl, /•••\(ADMIN_PW\)/);

  await server.close();
});

test('the hand-walked chain lands exactly where native `redirect: follow` lands (D-M88-14)', async () => {
  // The oracle the guarded/unguarded split used to provide implicitly. Every hop decision this loop
  // makes — 302 downgrading a POST to a bodyless GET, the terminus, the body that comes back — is
  // a restatement of something `fetch` was doing for us, and the only honest check of a restatement
  // is the thing it restates.
  const server = await startFixtureServer({
    ...loginChainRoutes(),
    '/post-login': (_req, res) => res.writeHead(302, { location: '/dashboard' }).end(),
  });

  for (const [method, path] of [
    ['GET', '/login'],
    ['POST', '/post-login'],
  ] as const) {
    const ours = await sendRequest({ method, url: `${server.baseUrl}${path}`, headers: {}, timeoutMs: 5000, followRedirects: true });
    const native = await fetch(`${server.baseUrl}${path}`, { method, redirect: 'follow' });
    const nativeBody = await native.text();

    assert.equal(ours.status, native.status, `${method} ${path}: status`);
    assert.equal(ours.bodyText, nativeBody, `${method} ${path}: body`);
    assert.equal(ours.finalUrl, native.url, `${method} ${path}: terminus`);
  }

  await server.close();
});
