// The `crawl` declaration, wired end to end (`M137c`, `D432`/`D435`/`D436`/`D465`/`D468`) — a real
// `node:http` fixture serving a real OpenAPI document, a real `tflw.config` through the real grammar,
// and the interpreter in between.
//
// **This file exists for the reason `authz-assert.test.ts` and `input-assert.test.ts` exist**, and
// `M128` is still that reason: `sec/authenticated-response-cacheable` read a lowercase header key
// against a map that preserves the case its author typed, so it fired for nobody while its unit tests
// passed — because those tests spelled the header the same way. `crawlSurface.ts`'s tests cover what a
// document turns into and `crawl.ts`'s policy is pure, but only this file can observe the **joins**:
// that a synthesized request really leaves the process carrying a declared session's credential, that
// `probe mutating` really travels from config text to the send site, that the surface counts a reader
// sees are the counts of what actually happened, and that `seed traffic` really sees the run's traffic.
//
// Almost every assertion here is about a request that was **not** sent, or a response that was **not**
// judged. That is the tier: `D436`'s whole claim is that a crawl says what it did not do, and every
// one of those properties fails *green* if it breaks.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { parseConfigSource, parseSource } from '@tflw/lang';
import { runProgram, type ReproSubject } from '../src/interpreter.js';
import { reachability } from '../src/crawl.js';
import { resolveConfig } from '../src/resolve.js';
import type { CrawlResult, ResolvedConfig } from '../src/types.js';
import type { ScanDecline, ScanFinding, ScanSink } from '../src/scanFindings.js';

let server: Server;
let baseUrl: string;

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

/** Every request the fixture received — so a test can assert on what was **sent**, which for this
 *  milestone is more often about the requests that never left the process. */
let seen: { method: string; path: string; body: string; auth: string | undefined }[] = [];
/** Concurrency, measured rather than counted: `D435` keeps the crawl to one request in flight, and a
 *  `Promise.all` rewrite would send exactly the same requests, so a call counter cannot see it. Same
 *  instrument `authz-probe-pacing.test.ts` uses on the prober. */
let inFlight = 0;
let peakInFlight = 0;

/** A document with one safe route, one templated route, one write, and one route a crawl is asked to
 *  exclude — the four cases every test below needs, in the shape a generated document has. */
const OPENAPI = {
  openapi: '3.0.0',
  paths: {
    '/v1/products': { get: { responses: { '200': { description: 'ok' } } } },
    '/v1/products/{id}': {
      get: { parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'ok' } } },
    },
    '/v1/orders': {
      post: {
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['sku'], properties: { sku: { type: 'string' } } } } } },
        responses: { '201': { description: 'created' } },
      },
    },
    '/v1/vuln/notes': { get: { responses: { '200': { description: 'ok' } } } },
    '/v1/strict': {
      get: { parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } },
    },
  },
};

/** `M137c1` (`D480`) — a document that declares its base **explicitly**, where the main fixture leaves
 *  `servers` absent. Both spellings must land on the same URL, because "absent" and "`/`" are one case
 *  in the specification rather than two. */
const OPENAPI_WITH_SERVERS = {
  openapi: '3.0.0',
  servers: [{ url: '/v1' }],
  paths: { '/products': { get: { responses: { '200': { description: 'ok' } } } } },
};

/** A document describing a prefix **the fixture does not serve**, so every route 404s and nothing is
 *  reached — `D481`'s condition, arrived at the way a real one is: not by an empty surface, but by a
 *  full surface that lands nowhere. */
const OPENAPI_WRONG_BASE = {
  openapi: '3.0.0',
  servers: [{ url: '/not-served' }],
  paths: { '/products': { get: { responses: { '200': { description: 'ok' } } } } },
};

/** A one-route document whose route sets a cookie without `HttpOnly` — `sec/cookie-not-httponly`, the
 *  critical rule the main fixture deliberately satisfies. Its own document rather than a sixth path in
 *  `OPENAPI`, so every test above keeps a clean surface and the provenance tests below get a finding. */
const OPENAPI_LEAKY = { openapi: '3.0.0', paths: { '/v1/leaky': { get: { responses: { '200': { description: 'ok' } } } } } };

/** A one-route document whose route takes a query parameter and echoes it back into an HTML body
 *  unescaped — so the `injection` payload `<tflw>` comes back verbatim,
 *  `sec/reflected-input-unescaped` fires, and the crawl produces a **Tier 3** finding. Needed
 *  because Tier 1 hygiene emits no repro at all (`D476`), so the hygiene-based provenance tests
 *  above cannot reach the repro emitter's `via` plumbing.
 *
 *  **Reflection rather than the oversized rule**, and the reason is a property of the transport, not
 *  a preference. `oversized/64kib-string` lists `query` among its targets, but a 64 KiB value in a
 *  query string is a 64 KiB *request line*, and Node's server caps that at `maxHeaderSize` (16 KB) —
 *  so that probe never comes back `2xx` and `sec/oversized-input-accepted`, which fires only on a
 *  success, cannot fire on a query site at all. That is why the one oversized test in
 *  `input-assert.test.ts` mutates a POST **body** and grants `probe mutating` beside
 *  `probe oversized`. Reflection needs neither opt-in: `injection` is on by default and a `GET`
 *  passes the mutating gate untouched, so this fixture tests the provenance join rather than the
 *  safety model a dozen other tests already cover. */
const OPENAPI_ECHO = {
  openapi: '3.0.0',
  paths: {
    '/v1/echo': {
      get: { parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'ok' } } },
    },
  },
};

before(async () => {
  server = createServer((req, res) => {
    inFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    const path = req.url ?? '/';
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', path, body, auth: req.headers.authorization });
      const done = (fn: () => void): void => {
        // Held open briefly so a concurrent second request would overlap this one and `peakInFlight`
        // would see it. Without the delay a sequential and a parallel crawl are indistinguishable.
        setTimeout(() => {
          inFlight--;
          fn();
        }, 15);
      };
      const pathname = path.split('?')[0]!;
      // The documents answer both prefixed and unprefixed, because the *seed source* is a separate
      // question from `D480`'s and must not be tangled with it here. A real deployment serves the
      // document outside the prefix (`SwaggerModule.setup` sits outside `setGlobalPrefix`), so a suite
      // whose `api` carries one has to name the document absolutely — which is exactly what this
      // repo's own acceptance corpus does. Answering both lets every existing test keep its short
      // relative seed while the routes below still prove the prefix.
      const docPath = pathname.startsWith('/v1/') ? pathname.slice('/v1'.length) : pathname;
      if (docPath === '/openapi.json') return done(() => json(res, 200, OPENAPI));
      if (docPath === '/openapi-missing.json') return done(() => json(res, 404, { message: 'no such document' }));
      if (docPath === '/openapi-leaky.json') return done(() => json(res, 200, OPENAPI_LEAKY));
      if (docPath === '/openapi-echo.json') return done(() => json(res, 200, OPENAPI_ECHO));
      if (docPath === '/openapi-servers.json') return done(() => json(res, 200, OPENAPI_WITH_SERVERS));
      if (docPath === '/openapi-wrong-base.json') return done(() => json(res, 200, OPENAPI_WRONG_BASE));

      // `M137c1` (`D480`) — **the application lives under a global prefix, and unknown paths 404.**
      // Both halves are load-bearing and neither was here before.
      //
      // Every server in this arc's tests was `http://127.0.0.1:<port>` serving from the root, which is
      // the one shape where joining a document's path onto a base that already carries a prefix and
      // joining it onto the origin produce **the same bytes**. `D478` wrote that sentence about the
      // repro emitter one milestone ago; the crawl had the identical hole, and it took pointing a crawl
      // at the dogfood target to find it — 31 sent, 0 reached, exit 0.
      //
      // The 404 is the other half. A fixture that answered `200` to anything would still have hidden
      // it: `/v1/v1/products` would have come back clean and the buggy join would have *passed*. A
      // fixture app must be able to say "I do not serve that", or it cannot testify about addressing at
      // all. The document is served from the root, as a real one is (`SwaggerModule.setup` sits outside
      // `setGlobalPrefix`) — so the seed URL is unprefixed while every route it describes is not.
      if (!pathname.startsWith('/v1/')) return done(() => json(res, 404, { message: `no route for ${pathname}` }));
      const route = pathname.slice('/v1'.length);

      // `/echo` interpolates `q` into an HTML body raw — the reflection rule's own precondition, since
      // it reads only responses carrying markup (a JSON echo is deliberately not a finding). Answers
      // `200` to anything, so the control response is clean and the finding is the payload's doing.
      if (route === '/echo') {
        const q = new URL(path, 'http://x').searchParams.get('q') ?? '';
        return done(() => {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><p>you searched for ${q}</p>`);
        });
      }
      // One real, critical weakness, reachable by BOTH seeds — which is what makes `D437`'s
      // fingerprint claim testable: the same weakness found two ways must be one finding.
      if (route === '/leaky') {
        return done(() => {
          res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'sid=leaky; Path=/' }).end('{"ok":1}');
        });
      }
      // A validator that refuses the value synthesis had to invent — `D436`'s central case, and the
      // one a crawl must never score: a `400` here is indistinguishable from a hardened endpoint.
      if (route === '/strict') {
        const q = new URL(path, 'http://x').searchParams.get('q');
        if (q !== 'the-real-one') return done(() => json(res, 400, { message: 'q is not a known query' }));
        return done(() => json(res, 200, { results: [] }));
      }
      if (route === '/orders' && req.method === 'POST') return done(() => json(res, 201, { id: 9 }));
      // The routes left over — and only those. `/products`, one `/products/<id>`, `/vuln/notes`. See
      // the 404 above for why an open-ended fallback would have made this whole file blind.
      if (!(route === '/products' || route === '/vuln/notes' || /^\/products\/[^/]+$/.test(route))) {
        return done(() => json(res, 404, { message: `no route for ${pathname}` }));
      }
      // The cookie is not decoration. `D296`/`D285`: the floor narrows the pack *before* applicability,
      // so `expect response has no critical security violations` against a plain JSON `GET` with no
      // cookie and no CORS header engages **nothing** and fails as an assertion with no power to fail.
      // A correct `HttpOnly` cookie over http gives the critical rules a subject they can judge and
      // clear — `sec/cookie-not-httponly` applies and finds nothing, `sec/cookie-not-secure` correctly
      // stands down because the flag is unsettable over plaintext (D284).
      return done(() => {
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'sid=fixture; HttpOnly; Path=/; SameSite=Lax' }).end(JSON.stringify({ ok: pathname }));
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  seen = [];
  peakInFlight = 0;
});

/** The config through the **real grammar** and the real `resolveConfig`, because half of what this
 *  file proves is that the grammar half and the engine half agree about `probe mutating` — and only a
 *  config that travels the whole way can say whether they do (`input-assert.test.ts`'s rule). */
function resolved(subClauses = '', session = false): ResolvedConfig {
  // The session, when asked for, is declared in the config **text** rather than spliced into the
  // resolved object. A hand-built `sessions` map is how a test comes to pass against a shape
  // `resolveConfig` would never produce — and this file's whole job is the joins.
  const sessionBlock = session ? `session peer\n  header "Authorization" is "Bearer peer-token"\n` : '';
  // `M137c1` (`D480`) — **the `api` base carries a path, and that is the point of this fixture.** With
  // a bare origin here, joining a document's `/v1/products` onto the base and joining it onto the
  // origin are the same string, and every crawl assertion in this file was blind to the difference.
  const source = `defaults\n  authorized target "${baseUrl}" reason "self-hosted test fixture"\n${subClauses}\n${sessionBlock}env local default\n  api "${baseUrl}/v1"\n`;
  const { config, diagnostics } = parseConfigSource(source);
  assert.deepEqual(diagnostics.map((d) => `${d.code}: ${d.message}`), [], 'the fixture config must parse and check clean');
  return resolveConfig(config!, config!.envs[0]!);
}

interface Run {
  readonly crawl: CrawlResult;
  readonly declines: readonly ScanDecline[];
  readonly findings: readonly ScanFinding[];
  readonly ok: boolean;
}

async function run(source: string, cfg: ResolvedConfig = resolved()): Promise<Run> {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${source}`);
  const findings: ScanFinding[] = [];
  const declines: ScanDecline[] = [];
  const scanSink: ScanSink = { finding: (f) => findings.push(f), census: () => {}, decline: (d) => declines.push(d) };
  const { report } = await runProgram(program, cfg, { source, scanSink });
  const entry = report.tests.find((t) => t.kind === 'crawl');
  assert.ok(entry !== undefined && entry.kind === 'crawl', `no crawl entry in the report: ${JSON.stringify(report.tests.map((t) => t.kind))}`);
  return { crawl: entry, declines, findings, ok: report.ok };
}

const SECURITY = '  expect response has no critical security violations';
const CRAWL = `crawl "the v1 surface"\n  seed openapi "/openapi.json"\n  exclude "/v1/vuln/**"\n${SECURITY}\n`;

// -- the surface, and the arithmetic a reader is given ---------------------------------------------

test('a crawl walks the documented surface, and `discovered = withheld + sent`', async () => {
  const { crawl, ok } = await run(CRAWL);
  assert.equal(ok, true, crawl.error ?? '');
  const { discovered, withheld, sent, reached } = crawl.surface;
  assert.equal(discovered, 5, 'five operations in the document');
  // The identity `D435`'s disclosure rests on. A surface that dropped what it could not send would
  // report a smaller `discovered` and read as better coverage — `M134a`'s green-report tell.
  assert.equal(withheld + sent, discovered);
  assert.ok(reached <= sent);
  assert.deepEqual(crawl.surface.seeds.map((s) => s.seed), ['openapi']);
  assert.match(crawl.surface.seeds[0]!.source!, /\/openapi\.json$/);
});

test('the entry is `kind: "crawl"`, and it is counted in the run like any other', async () => {
  // `D462`'s payoff read from the outside: the third kind exists, reaches `RunReport.tests`, and is
  // not a functional test wearing a crawl's name.
  const { program } = parseSource(CRAWL);
  const { report } = await runProgram(program, resolved(), { source: CRAWL });
  assert.deepEqual(report.tests.map((t) => t.kind), ['crawl']);
  assert.equal(report.total, 1);
  assert.equal(report.passed, 1);
});

test('the disclosure step is emitted BEFORE anything is sent (D435)', async () => {
  // A planned total that only exists once the work is done is a report, not a bound. The `seed` steps
  // therefore precede every `api` step in the timeline, which is the observable form of that claim.
  const { crawl } = await run(CRAWL);
  const kinds = crawl.steps.map((s) => s.kind);
  const lastSeed = kinds.lastIndexOf('seed');
  const firstApi = kinds.indexOf('api');
  assert.ok(lastSeed >= 0 && firstApi > lastSeed, `seed steps must all precede the first api step: ${kinds.join(', ')}`);
  assert.match(crawl.steps[lastSeed]!.detail!, /5 discovered · \d+ withheld/);
});

test('an `api` step carries its own request and response, so report.html renders the same panels', async () => {
  const { crawl } = await run(CRAWL);
  const api = crawl.steps.find((s) => s.kind === 'api')!;
  assert.ok(api.request !== undefined, 'a synthesized request is evidence like an authored one');
  assert.ok(api.response !== undefined);
  assert.ok(api.endpoint !== undefined, 'and it is grouped by the TEMPLATE, not the invented path');
});

// -- `D465`: the crawl's own writes ---------------------------------------------------------------

test('D465: a synthesized write is withheld when the origin has no `probe mutating`', async () => {
  const { crawl, declines } = await run(CRAWL);
  // The whole assertion is the absence of these packets. A refusal whose only evidence is its own
  // label could be sending anyway — `input-probe.test.ts`'s rule, and this is the same shape.
  assert.deepEqual(seen.filter((r) => r.method === 'POST'), [], 'no unaffirmed write may leave the process');
  const withheldWrite = declines.find((d) => d.subject === 'POST /v1/orders');
  assert.ok(withheldWrite, `expected a decline for POST /v1/orders, got ${declines.map((d) => d.subject).join(', ')}`);
  assert.match(withheldWrite.reason, /does not declare `probe mutating`/);
  assert.match(withheldWrite.reason, /affirming a scan is not affirming writes/);
});

test('D465: and it IS sent once the config affirms it, which is the control', async () => {
  // Without this, the test above passes for a crawl that never sends anything at all.
  const { crawl } = await run(CRAWL, resolved('    probe mutating\n'));
  assert.equal(seen.filter((r) => r.method === 'POST' && r.path === '/v1/orders').length, 1);
  assert.equal(seen.find((r) => r.method === 'POST')!.body, '{"sku":"tflw"}', 'and it carries the body synthesis built');
  assert.ok(crawl.surface.sent > 3);
});

// -- `D436`: reachability -------------------------------------------------------------------------

test('D436: a route that refused the synthesized request is NOT judged, and says so', async () => {
  // `/strict` answers 400 to any `q` but one. Scoring that response would report a conclusion about
  // code that never ran, and a validator's refusal is indistinguishable from a hardened endpoint —
  // the false-negative engine `D436` rejected an alternative to avoid.
  const { crawl, declines } = await run(CRAWL);
  const declined = declines.find((d) => d.subject === 'GET /v1/strict');
  assert.ok(declined, `expected /v1/strict to be declined, got ${declines.map((d) => d.subject).join(', ')}`);
  assert.match(declined.reason, /rejected as invalid \(400\)/);
  assert.match(declined.reason, /indistinguishable from a hardened endpoint/);
  const step = crawl.steps.find((s) => s.kind === 'api' && s.source.includes('/strict'))!;
  assert.match(step.detail!, /not judged/);
  assert.equal(crawl.surface.sent - crawl.surface.reached, 1, 'sent and not judged is exactly one route here');
});

test('D436: a reached route IS judged, one assertion per response', async () => {
  const { crawl } = await run(CRAWL);
  const asserts = crawl.steps.filter((s) => s.kind === 'expect');
  // `/products` and `/products/{id}` both answer 200; `/strict` is unreached and `/vuln/notes`
  // excluded, so the body's one assertion ran exactly twice. This is `D450`'s "per response the crawl
  // issues" made countable.
  assert.equal(asserts.length, 2, `expected one assertion per reached route: ${crawl.steps.map((s) => s.kind).join(', ')}`);
  assert.equal(crawl.surface.reached, 2);
});

test('D436: every row of the reachability table, including the two the fixture cannot produce', () => {
  // The fixture answers `200`, `201` and `400`, so the behavioural tests above reach three of the
  // seven rows `guide/crawling.md` publishes — and the row a reader most needs to be true is one of
  // the four they miss. `401`/`403` is `M130-01` in its newest place: the crawl's own principal
  // refused at the door leaves nothing for the differential oracle to compare against, and scoring
  // that as clean is this tool class's commonest false negative. Asserted directly on the predicate,
  // because building a route that refuses tflw's own declared session would take a second config.
  for (const status of [200, 201, 204, 302, 399, 500, 503]) {
    assert.equal(reachability(status).reached, true, `${status} reached real code`);
  }
  for (const [status, expected] of [
    [401, /refused \(401\) before the route's code ran/],
    [403, /`M130-01`/],
    [400, /indistinguishable from a hardened endpoint/],
    [422, /nothing behind the validator ran/],
    [404, /the value tflw invented for a path parameter does not exist/],
    [405, /no route answered \(405\)/],
    [410, /no route answered \(410\)/],
    [415, /refused the content type/],
    [429, /about pacing rather than about the route/],
    [418, /refused before the route's code ran \(418\)/],
  ] as const) {
    const landing = reachability(status);
    assert.equal(landing.reached, false, `${status} did not reach real code`);
    assert.match(landing.reached ? '' : landing.reason, expected, `${status}'s reason must say why`);
  }
});

test('a synthesized path parameter is disclosed as invented, in the step a reader sees', async () => {
  const { crawl } = await run(CRAWL);
  const step = crawl.steps.find((s) => s.kind === 'api' && s.source.includes('/products/'))!;
  assert.match(step.detail!, /tflw invented path parameter `id`/);
});

// -- `TF068`'s runtime door -----------------------------------------------------------------------

test('TF068 at run time: a document that does not answer fails the crawl, naming the seed', async () => {
  // `D443`'s second door. The checker refuses a crawl with no `seed`; this is the same repair for the
  // same mistake from the other side, so it reuses the code rather than minting one. It must FAIL and
  // not pass vacuously: every assertion in the body would have held whatever the application did.
  const source = `crawl "the v1 surface"\n  seed openapi "/openapi-missing.json"\n${SECURITY}\n`;
  const { crawl, ok } = await run(source);
  assert.equal(ok, false);
  assert.equal(crawl.ok, false);
  assert.match(crawl.error!, /has nothing to crawl/);
  assert.match(crawl.error!, /would pass whatever the application did/);
  const seed = crawl.steps.find((s) => s.kind === 'seed')!;
  assert.equal(seed.ok, false);
  assert.match(seed.detail!, /got 404/, 'the seed step says WHICH seed and why, which is what the hint sends a reader to');
});

test('TF068 at run time: an `exclude` that swallows the whole surface is the same failure', async () => {
  // The runtime half of `crawlChecks.test.ts`'s static case: the checker deliberately stays silent on
  // `exclude "/**"` because whether it covers everything depends on what the run discovers. This is
  // where that is known.
  const source = `crawl "everything"\n  seed openapi "/openapi.json"\n  exclude "/**"\n${SECURITY}\n`;
  const { crawl, ok } = await run(source);
  assert.equal(ok, false);
  assert.match(crawl.error!, /has nothing to crawl/);
  assert.deepEqual(seen.filter((r) => !r.path.startsWith('/openapi')), [], 'and nothing was sent');
});

// -- `exclude`, at run time -----------------------------------------------------------------------

test('D466: an excluded subtree is never requested, and the decline names the pattern', async () => {
  const { declines } = await run(CRAWL);
  assert.deepEqual(seen.filter((r) => r.path.startsWith('/v1/vuln')), [], 'excluded means not sent, not sent-and-ignored');
  const declined = declines.find((d) => d.subject.includes('/vuln/notes'));
  assert.ok(declined);
  assert.match(declined.reason, /excluded by this crawl's `exclude "\/v1\/vuln\/\*\*"`/);
});

// -- `seed traffic` and `D468`'s ordering ---------------------------------------------------------

test('seed traffic re-issues what this run`s own tests sent', async () => {
  const source = `test "a test that touches one route"\n  api GET /products\n  expect status equals 200\n\ncrawl "what the suite touched"\n  seed traffic\n${SECURITY}\n`;
  const { crawl, ok } = await run(source);
  assert.equal(ok, true, crawl.error ?? '');
  assert.equal(crawl.surface.discovered, 1, 'one distinct route was touched');
  assert.equal(crawl.surface.reached, 1);
  assert.equal(seen.filter((r) => r.path === '/v1/products').length, 2, 'the test sent it, then the crawl re-issued it');
  assert.deepEqual(crawl.surface.seeds.map((s) => s.seed), ['traffic']);
});

test('D468: a crawl declared FIRST still sees the traffic of a test declared after it', async () => {
  // The decision, pinned. A crawl's `traffic` seed is the run's own output, so running it in the
  // position an author typed it in would make *what it discovers* depend on where the declaration
  // sits — which is why this is the one entry kind not in file-declaration order.
  const source = `crawl "what the suite touched"\n  seed traffic\n${SECURITY}\n\ntest "declared after the crawl"\n  api GET /products\n  expect status equals 200\n`;
  const { crawl } = await run(source);
  assert.equal(crawl.surface.discovered, 1);
  assert.equal(crawl.surface.reached, 1);
});

test('seed traffic on a suite that sent nothing is TF068, and says which seed came back empty', async () => {
  const source = `crawl "what the suite touched"\n  seed traffic\n${SECURITY}\n`;
  const { crawl, ok } = await run(source);
  assert.equal(ok, false);
  assert.match(crawl.error!, /has nothing to crawl/);
  assert.match(crawl.steps.find((s) => s.kind === 'seed')!.detail!, /only as large as the suite that ran before it/);
});

test('seed traffic deduplicates by normalized template, so a suite cannot multiply the crawl', async () => {
  // Forty calls to one route are one thing to crawl. Without the normalization a suite that iterates
  // over ids would make the crawl re-issue every one of them — the run`s own traffic squared.
  const source = [
    'test "three calls, two routes"',
    '  api GET /products',
    '  expect status equals 200',
    '  api GET /products/1',
    '  expect status equals 200',
    '  api GET /products/2',
    '  expect status equals 200',
    '',
    'crawl "what the suite touched"',
    '  seed traffic',
    SECURITY,
    '',
  ].join('\n');
  const { crawl } = await run(source);
  assert.equal(crawl.surface.discovered, 2, '`/products` and `/products/{id}`, not three');
});

// -- pacing, credentials, and the channel the declines go to --------------------------------------

test('D435: the crawl is strictly sequential — one request in flight (D21 layer 5 stays deferred)', async () => {
  // Measured as *concurrency*, not as a call count: a `Promise.all` rewrite sends exactly the same
  // requests, and only this instrument can see it. Same tripwire `authz-probe-pacing.test.ts:101`
  // keeps on the prober, and it is what keeps `probe rate`'s deferral condition unmet.
  await run(CRAWL, resolved('    probe mutating\n'));
  assert.equal(peakInFlight, 1, `the crawl must never have two requests in flight: peak was ${peakInFlight}`);
});

test('every synthesized request carries the declared session`s credential', async () => {
  const source = `crawl "as somebody" as peer\n  seed openapi "/openapi.json"\n  exclude "/vuln/**"\n${SECURITY}\n`;
  await run(source, resolved('', true));
  const sent = seen.filter((r) => !r.path.startsWith('/openapi'));
  assert.ok(sent.length > 0);
  // Every one of them, not the first: a crawl that established a session and then dropped it after
  // one request would still satisfy an assertion about `sent[0]`.
  assert.deepEqual([...new Set(sent.map((r) => r.auth))], ['Bearer peer-token']);
});

test('a route the crawl could not judge is declined under EVERY scan the body asks about', async () => {
  // The denominators differ per scan, so a route this crawl could not reach is a gap in each question
  // it was asked. `ScanKind` gains no fourth member for the crawl: a crawl is not a scan, it is a
  // source of requests for the three that exist (`D450`).
  const source = [
    'crawl "two families" as peer',
    '  seed openapi "/openapi.json"',
    '  exclude "/v1/vuln/**"',
    '  expect response has no critical security violations',
    '  expect response has no critical input handling violations',
    '',
  ].join('\n');
  const { declines } = await run(source, resolved('', true));
  const strict = declines.filter((d) => d.subject === 'GET /v1/strict');
  assert.deepEqual([...new Set(strict.map((d) => d.scan))].sort(), ['input-handling', 'security']);
});

// -- `D437`/`D461`/`D470`: where a finding came from -----------------------------------------------

test('D437: a crawl`s finding carries the seed that reached it', async () => {
  const source = `crawl "documented"\n  seed openapi "/openapi-leaky.json"\n${SECURITY}\n`;
  const { findings, ok } = await run(source);
  assert.equal(ok, false, 'the fixture route really is weak, so the assertion really fails');
  assert.deepEqual(findings.map((f) => f.rule), ['sec/cookie-not-httponly']);
  assert.equal(findings[0]!.via, 'openapi');
});

test('D470: the traffic seed says `traffic`, the word an author writes', async () => {
  // `D437`'s prose spelled this `captured`. The field's whole job is to be correlated with a
  // declaration, and the declaration says `seed traffic`.
  const source = `test "touch it"\n  api GET /leaky\n  expect status equals 200\n\ncrawl "what the suite touched"\n  seed traffic\n${SECURITY}\n`;
  const { findings } = await run(source);
  assert.deepEqual(findings.map((f) => f.via), ['traffic']);
});

test('D437: an authored `api` step`s finding carries NO `via`, which is what makes the field mean something', async () => {
  // The control. If `via` were stamped on every finding, its presence would say nothing about
  // provenance and a reader could not tell a crawl's finding from a hand-written assertion's.
  // Driven directly rather than through `run`, which requires a crawl entry — this source deliberately
  // has none, and that is the point of the test.
  const source = `test "a hand-written security assertion"\n  api GET /leaky\n${SECURITY}\n`;
  const { program } = parseSource(source);
  const findings: ScanFinding[] = [];
  const scanSink: ScanSink = { finding: (f) => findings.push(f), census: () => {}, decline: () => {} };
  await runProgram(program, resolved(), { source, scanSink });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]!.via, undefined);
});

test('D437: a crawl-derived finding reaches the REPRO sink carrying its seed', async () => {
  // The join the two tests above cannot see. They read `ScanFinding.via`, which travels to
  // `results.json`/`findings.sarif`; the repro emitter is fed by a **different** sink, so `via` reaching
  // one says nothing about it reaching the other. Left untested, the repro's provenance line would be a
  // comment that lies — which is exactly what it was when this milestone's item list was checked
  // against the code, and precisely the shape-not-effect failure `D478`/`D479` were.
  //
  // A **Tier 3** finding, deliberately: Tier 1 hygiene emits no repro at all (`D476`), so the
  // `/leaky` fixture the tests above use cannot reach this code path however many findings it makes.
  const source = `crawl "documented"\n  seed openapi "/openapi-echo.json"\n  expect response has no input handling violations\n`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${source}`);
  const repros: ReproSubject[] = [];
  await runProgram(program, resolved(), { source, reproSink: { finding: (f) => repros.push(f) } });
  assert.equal(repros.length, 1, `expected one input repro subject, got ${JSON.stringify(repros)}`);
  const [only] = repros;
  assert.equal(only!.kind, 'input-handling');
  assert.equal(only!.rule, 'sec/reflected-input-unescaped');
  assert.equal(only!.via, 'openapi', 'the repro subject must carry the seed that reached it');
});

test('D437: a hand-written test`s finding reaches the repro sink with NO `via` — the control', async () => {
  // Same instrument, no crawl. Without this the assertion above would pass just as well against a
  // `via: 'openapi'` hard-coded at the emit site.
  const source = `test "t"\n  api GET /echo?q=shoes\n  expect response has no input handling violations\n`;
  const { program } = parseSource(source);
  const repros: ReproSubject[] = [];
  await runProgram(program, resolved(), { source, reproSink: { finding: (f) => repros.push(f) } });
  assert.equal(repros.length, 1, `expected one input repro subject, got ${JSON.stringify(repros)}`);
  assert.equal(repros[0]!.via, undefined);
});

test('D437: the same weakness found by two seeds is ONE weakness — provenance is not identity', async () => {
  // The property the whole discriminator rests on, and the reason it is excluded from
  // `partialFingerprints`: two seeds finding one flaw must not become two baseline entries, and
  // re-seeding a crawl must not invalidate a baseline. Asserted through the real pipeline rather than
  // on `toScanFinding` alone, because that is where a future edit would break it.
  const source = [
    'test "touch it"',
    '  api GET /leaky',
    '  expect status equals 200',
    '',
    'crawl "documented"',
    '  seed openapi "/openapi-leaky.json"',
    SECURITY,
    '',
    'crawl "exercised"',
    '  seed traffic',
    SECURITY,
    '',
  ].join('\n');
  const { findings } = await run(source);
  assert.deepEqual(findings.map((f) => f.via), ['openapi', 'traffic'], 'two findings, two provenances');
  assert.equal(findings[0]!.fingerprint, findings[1]!.fingerprint, 'and one identity between them');
  assert.ok(findings[0]!.fingerprint, 'a fingerprint that is absent from both would satisfy the line above');
});

// -- `D480`/`D481`: which URL a synthesized path actually dials -------------------------------------
//
// This whole file now runs against a fixture whose app sits under `/v1` and whose `api` base carries
// that prefix, so every assertion above is a witness to `D480` too — before `M137c1` they ran against
// a root-served origin, the one shape where the right join and the wrong one are the same bytes. The
// three below name the property directly, because a property only every *other* test depends on is one
// nobody will recognise when it breaks.

test('D480: the crawl dials the document`s own path, not the `api` base`s prefix twice', async () => {
  const { crawl } = await run(CRAWL);
  const app = seen.filter((r) => !r.path.includes('openapi'));
  assert.ok(app.length > 0, 'the crawl must actually send something for this to mean anything');
  assert.deepEqual(
    app.filter((r) => r.path.startsWith('/v1/v1/')),
    [],
    'the defect this closes: base `…/v1` + document path `/v1/products` dialled `/v1/v1/products`',
  );
  assert.ok(app.some((r) => r.path === '/v1/products'), `expected /v1/products, saw ${app.map((r) => r.path).join(', ')}`);
  assert.ok(crawl.surface.reached > 0, 'and something reached the application, which is what 0-reached hid');
});

test('D480: `servers: [{url: "/v1"}]` and an absent `servers` land on the same URL', async () => {
  // The main document leaves `servers` absent and carries the prefix in its paths (what Nest, Django
  // and Rails generate); this one declares the prefix and leaves it out of its paths (what a
  // hand-written document does). Two spellings of one deployment must reach one place.
  const { crawl } = await run(`crawl "declared base"\n  seed openapi "/openapi-servers.json"\n${SECURITY}\n`);
  assert.ok(seen.some((r) => r.path === '/v1/products'), `expected /v1/products, saw ${seen.map((r) => r.path).join(', ')}`);
  assert.equal(crawl.surface.reached, 1);
});

test('D481: a full surface that reaches NOTHING fails the crawl rather than passing over it', async () => {
  // The failure `D480` was hiding behind, and the reason it stayed hidden for a milestone: the engine
  // had `sent` and `reached` in front of it, printed them both, and returned success. `TF068`'s fourth
  // runtime cause — not a fourth code, per `D456`.
  const { crawl, ok } = await run(`crawl "wrong base"\n  seed openapi "/openapi-wrong-base.json"\n${SECURITY}\n`);
  assert.equal(crawl.surface.sent, 1, 'the surface resolved and a request really went out');
  assert.equal(crawl.surface.reached, 0);
  assert.equal(ok, false, 'a crawl that judged nothing must not report green');
  assert.match(crawl.error!, /none of them reached your application/);
  assert.match(crawl.error!, /passed having judged no response/);
  assert.match(crawl.error!, /TF068/);
});

test('D481: the 404 decline does not blame a path parameter a request never had', async () => {
  // 17 of the 31 declines on the dogfood target read "the value tflw invented for a path parameter
  // does not exist" against routes with no path parameter at all. A reason naming a cause the request
  // cannot have is worse than no reason: it sends the reader to synthesis and away from the base.
  const { declines } = await run(`crawl "wrong base"\n  seed openapi "/openapi-wrong-base.json"\n${SECURITY}\n`);
  const gone = declines.find((d) => d.subject === 'GET /products')!;
  assert.ok(gone, `expected a decline for GET /products, got ${declines.map((d) => d.subject).join(', ')}`);
  assert.doesNotMatch(gone.reason, /invented for a path parameter/);
  assert.match(gone.reason, /nothing invented in it/);
  assert.match(gone.reason, /`api` base and the document's own `servers` agree/);
});

test('D481: a route WITH an invented id keeps the path-parameter reason', () => {
  // The control for the branch above — the original sentence is still right when something really was
  // invented, and `reachability` is pure so the two branches are testable without a server.
  const invented = reachability(404, true);
  assert.equal(invented.reached, false);
  assert.match((invented as { reason: string }).reason, /invented for a path parameter/);
});
