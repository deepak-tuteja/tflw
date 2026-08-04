// `allow hosts "…"` (SPEC §3.7, PLAN decision 101a, enterprise arc cluster 2) — a request whose
// URL hostname matches none of the configured hosts is refused before any network I/O, not just
// reported as a failed request. Real fixture server (no mocking): the assertion that matters most
// here is `server.received` staying empty for a blocked path, proving the connection was never
// attempted at all.
//
// M85 (review cluster C1 / `B4-02`) extends that promise to **redirect hops**. Until then the list
// guarded the URL a step named and nothing the server then sent it to, so an allowlisted staging
// host that 302s to prod reached prod on all three client paths. The tests below are written so
// that "guarded" cannot come to mean "different": every hop-following property is asserted as an
// equality between the guarded and unguarded paths on the same chain, not against a literal.
//
// A note on the fixture addresses, because it is load-bearing here: `allow hosts` matches on
// **hostname only** — two loopback servers on different ports share the hostname `127.0.0.1` and
// so are always both allowed or both refused. Spelling one target `localhost` gives two genuinely
// different hostnames over the same loopback interface, which is what lets a blocked hop be
// blocked while the first hop still goes through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { hostMatchesAllowPattern } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { sendRequest } from '../src/http.js';
import { createPinnedAgents, destroyPinnedAgents, sendPinnedRequest } from '../src/httpPinned.js';
import { AllowHostsError, isHostAllowed } from '../src/allowHosts.js';
import { startFixtureServer, testConfig, json, type FixtureServer } from './support.js';

const SOURCE = `test "health check"\n  api GET /health\n  expect status equals 200\n`;

/** A real, reachable server addressed by a hostname an `allow hosts "127.0.0.1"` cannot match — so
 * a hop to it is refused, and `server.received` proves the refusal happened before the connection
 * rather than after it. Deliberately only ever used as a *blocked* target: nothing here depends on
 * how `localhost` resolves, because a blocked hop never resolves it at all. Cross-origin hops that
 * are meant to go through use a second `127.0.0.1` server (a different port is already a different
 * origin, which is the comparison the Fetch spec makes). */
function unlistedHostUrl(server: FixtureServer, path: string): string {
  return `${server.baseUrl.replace('127.0.0.1', 'localhost')}${path}`;
}

test('a host in `allow hosts` is unaffected — the request goes through as normal', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const config = { ...testConfig(server.baseUrl), allowHosts: ['127.0.0.1'] };

  const { program } = parseSource(SOURCE);
  const { report } = await runProgram(program, config, { source: SOURCE });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(server.received.get('/health')!.length, 1);

  await server.close();
});

test('a host not in `allow hosts` is refused before any network I/O reaches it', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const config = { ...testConfig(server.baseUrl), allowHosts: ['definitely-not-this-host.example.com'] };

  const { program } = parseSource(SOURCE);
  const { report } = await runProgram(program, config, { source: SOURCE });

  assert.equal(report.ok, false);
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /127\.0\.0\.1/);
  assert.match(error, /allow hosts/);
  assert.equal(server.received.has('/health'), false, 'a blocked request must never actually reach the server');

  await server.close();
});

test('a `*.domain` pattern matches subdomains and the bare domain', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  // The fixture server only ever listens on 127.0.0.1, so this exercises the matcher directly
  // rather than through a real DNS name — the point under test is `hostMatchesAllowPattern`'s
  // suffix logic, which is hostname-string-shaped regardless of what actually resolves it.
  const allowedByWildcard = { ...testConfig(server.baseUrl), allowHosts: ['*.0.0.1'] };
  const { program } = parseSource(SOURCE);
  const { report } = await runProgram(program, allowedByWildcard, { source: SOURCE });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));

  await server.close();
});

test('`allow hosts` never declared (null) means no enforcement — unchanged default behavior', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const config = testConfig(server.baseUrl); // allowHosts: null by default

  const { program } = parseSource(SOURCE);
  const { report } = await runProgram(program, config, { source: SOURCE });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));

  await server.close();
});

// ---- redirect hops (M85, C1/`B4-02`) ---------------------------------------
//
// The finding: `execApi` checked the URL *this step names* and nothing checked where a 3xx then
// sent it. An allowlisted staging host that redirects to prod reached prod — on every client path,
// and with `allow hosts` declared, which is precisely the configuration that asked not to.

test('a redirect to an unlisted host is refused, and the hop never reaches it (pooled client)', async () => {
  const target = await startFixtureServer({ '/landing': (_req, res) => json(res, 200, { landed: true }) });
  const server = await startFixtureServer({
    '/go': (_req, res) => res.writeHead(302, { location: unlistedHostUrl(target, '/landing') }).end(),
  });

  await assert.rejects(
    () => sendRequest({ method: 'GET', url: `${server.baseUrl}/go`, headers: {}, timeoutMs: 5000, followRedirects: true, allowHosts: ['127.0.0.1'] }),
    (err: Error) => {
      assert.ok(err instanceof AllowHostsError, `expected an AllowHostsError, got ${err.constructor.name}: ${err.message}`);
      assert.match(err.message, /redirected to "http:\/\/localhost:\d+\/landing"/);
      assert.match(err.message, /host "localhost" is not in `allow hosts` \(127\.0\.0\.1\)/);
      // The refusal names *who chose the host*: this one isn't in the author's step, so telling
      // them to re-read it would be advice they cannot act on (M85's `RefusalOrigin`).
      assert.match(err.message, /the redirect target is chosen by the server, not by this step/);
      return true;
    },
  );
  assert.equal(target.received.has('/landing'), false, 'a refused hop must never reach the target');

  await server.close();
  await target.close();
});

test('the pinned (workload) client refuses the same hop the same way', async () => {
  // Which client a step runs on is a performance decision (`run N iterations` selects this one).
  // It must not also decide whether the guardrail holds — the shape of `B4-01`, one axis over.
  const target = await startFixtureServer({ '/landing': (_req, res) => json(res, 200, { landed: true }) });
  const server = await startFixtureServer({
    '/go': (_req, res) => res.writeHead(302, { location: unlistedHostUrl(target, '/landing') }).end(),
  });
  const agents = createPinnedAgents();

  const opts = { method: 'GET', url: `${server.baseUrl}/go`, headers: {}, timeoutMs: 5000, followRedirects: true, allowHosts: ['127.0.0.1'] } as const;
  const pinnedError = await sendPinnedRequest(opts, agents).then(() => null, (e: Error) => e);
  const pooledError = await sendRequest(opts).then(() => null, (e: Error) => e);

  assert.ok(pinnedError instanceof AllowHostsError, `pinned: ${pinnedError?.message}`);
  assert.ok(pooledError instanceof AllowHostsError, `pooled: ${pooledError?.message}`);
  assert.equal(pinnedError.message, pooledError.message, 'the two clients must refuse identically, not merely both refuse');
  assert.equal(target.received.has('/landing'), false);

  destroyPinnedAgents(agents);
  await server.close();
  await target.close();
});

test('an allowed redirect chain behaves byte-for-byte as it does unguarded (pooled)', async () => {
  // Declaring `allow hosts` switches the pooled client from `fetch`'s own `redirect: 'follow'` to
  // a hand-walked loop, because a single `await` has no seam between hops to check a list at. That
  // is a real change in how requests are made, so the guarded loop is held to the native one's
  // result rather than to a literal: same status, same body, and the same 302 POST→GET downgrade.
  const echo = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, body: string) =>
    json(res, 200, { method: req.method, body, contentType: req.headers['content-type'] ?? null });
  const target = await startFixtureServer({ '/landing': echo });
  const server = await startFixtureServer({
    '/go': (_req, res) => res.writeHead(302, { location: `${target.baseUrl}/landing` }).end(),
  });
  const opts = {
    method: 'POST',
    url: `${server.baseUrl}/go`,
    headers: { 'content-type': 'application/json' },
    body: '{"a":1}',
    timeoutMs: 5000,
    followRedirects: true,
  } as const;

  const guarded = await sendRequest({ ...opts, allowHosts: ['127.0.0.1'] });
  const unguarded = await sendRequest(opts);

  assert.deepEqual(guarded.json, { method: 'GET', body: '', contentType: null });
  assert.deepEqual(guarded.json, unguarded.json);
  assert.equal(guarded.status, unguarded.status);

  await server.close();
  await target.close();
});

test('the guarded loop still strips credentials on a cross-origin hop (M80 survives M85)', async () => {
  // `B4-01`'s fix lives in `redirect.ts` now, shared by all three clients. The pooled path reaching
  // it for the first time is exactly the moment a second opinion could appear, so the property is
  // re-asserted here on the path that acquired the loop, against the path that always had `fetch`'s.
  const echoCreds = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) =>
    json(res, 200, { authorization: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null });
  const target = await startFixtureServer({ '/landing': echoCreds });
  const server = await startFixtureServer({
    '/go': (_req, res) => res.writeHead(302, { location: `${target.baseUrl}/landing` }).end(),
  });
  const headers = { authorization: 'Bearer super-secret', cookie: 'session=SECRET' };
  const opts = { method: 'GET', url: `${server.baseUrl}/go`, headers, timeoutMs: 5000, followRedirects: true } as const;

  const guarded = await sendRequest({ ...opts, allowHosts: ['127.0.0.1'] });
  const unguarded = await sendRequest(opts);

  assert.deepEqual(guarded.json, { authorization: null, cookie: null });
  assert.deepEqual(guarded.json, unguarded.json);

  await server.close();
  await target.close();
});

test('a same-origin redirect to a listed host is followed normally', async () => {
  const server = await startFixtureServer({
    '/go': (_req, res) => res.writeHead(302, { location: '/landing' }).end(),
    '/landing': (_req, res) => json(res, 200, { landed: true }),
  });

  const res = await sendRequest({ method: 'GET', url: `${server.baseUrl}/go`, headers: {}, timeoutMs: 5000, followRedirects: true, allowHosts: ['127.0.0.1'] });

  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { landed: true });

  await server.close();
});

test('`follow redirects false` leaves the 3xx alone — the guard only covers hops actually taken', async () => {
  // The list is about connections tflw makes. A step that asks to *see* the 302 makes none, so
  // refusing it would be the guardrail inventing a failure rather than preventing a connection.
  const target = await startFixtureServer({ '/landing': (_req, res) => json(res, 200, { landed: true }) });
  const server = await startFixtureServer({
    '/go': (_req, res) => res.writeHead(302, { location: unlistedHostUrl(target, '/landing') }).end(),
  });

  const res = await sendRequest({ method: 'GET', url: `${server.baseUrl}/go`, headers: {}, timeoutMs: 5000, followRedirects: false, allowHosts: ['127.0.0.1'] });

  assert.equal(res.status, 302);
  assert.equal(target.received.has('/landing'), false);

  await server.close();
  await target.close();
});

test('the refusal reaches the report as itself, not wrapped as a transport failure', async () => {
  // Three layers between the guard and the reporter re-frame errors as `request failed: … — <msg>`.
  // A refusal is already the finished sentence — nothing failed, a request was deliberately not
  // sent — so `AllowHostsError` exists to survive them, and this asserts it did.
  const target = await startFixtureServer({ '/landing': (_req, res) => json(res, 200, { landed: true }) });
  const server = await startFixtureServer({
    '/health': (_req, res) => res.writeHead(302, { location: unlistedHostUrl(target, '/landing') }).end(),
  });
  const config = { ...testConfig(server.baseUrl), allowHosts: ['127.0.0.1'] };

  const { program } = parseSource(SOURCE);
  const { report } = await runProgram(program, config, { source: SOURCE });

  assert.equal(report.ok, false);
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /is not in `allow hosts`/);
  assert.doesNotMatch(error, /request failed/);
  assert.equal(target.received.has('/landing'), false);

  await server.close();
  await target.close();
});

// ---- the guard that retires the finding ------------------------------------

test('the enforcing matcher agrees with the one the checker blesses configs with', () => {
  // `TF036` (M85, `A4-10`) decides statically whether a config's own base URL can satisfy its own
  // list; this decides it per request. Two copies of that rule is how a checker comes to bless a
  // config the runtime then refuses — the finding one level down — so `allowHosts.ts` imports
  // `@tflw/lang`'s export rather than holding its own, and this pins the agreement over a corpus
  // in case a copy is ever reintroduced.
  const cases: [string, string][] = [
    ['api.example.com', '*.example.com'],
    ['example.com', '*.example.com'],
    ['notexample.com', '*.example.com'],
    ['a.b.example.com', '*.example.com'],
    ['example.com', 'example.com'],
    ['api.example.com', 'example.com'],
    ['127.0.0.1', '127.0.0.1'],
    ['localhost', '127.0.0.1'],
  ];
  for (const [hostname, pattern] of cases) {
    assert.equal(
      isHostAllowed(`https://${hostname}/some/path`, [pattern]),
      hostMatchesAllowPattern(hostname, pattern),
      `${hostname} vs ${pattern}`,
    );
  }
});

test('a non-http(s) URL names no host to allow or refuse and is let through', () => {
  // `about:blank`, `data:`, `blob:` — the browser guard is a blanket route handler, so these reach
  // `isHostAllowed` constantly and are never what the guardrail is about.
  for (const url of ['about:blank', 'data:text/html,<p>hi', 'blob:http://127.0.0.1/abc', 'file:///tmp/x.html']) {
    assert.equal(isHostAllowed(url, ['127.0.0.1']), true, url);
  }
});
