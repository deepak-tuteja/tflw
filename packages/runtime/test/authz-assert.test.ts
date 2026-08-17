// `expect response has no authorization violations`, wired end to end (M130b2, D335) — a real
// `node:http` fixture, real sessions established from a real `tflw.config`, and the interpreter in
// between.
//
// **This file exists because `M128` paid for not having its twin.** `sec/authenticated-response-
// cacheable` read a lowercase `authorization` key against a header map that preserves the case its
// author typed, so it **fired for nobody while its unit tests passed** — because those tests spelled
// the header lowercase too. A pure, injectable design makes unit tests reach every branch; it does
// not make them right about the world. `authz-rules.test.ts` covers what the pack decides and
// `authz-probe.test.ts` covers what the prober sends; what is only observable here is the *joins* —
// that the probe set is really assembled from the config, that sessions really establish lazily,
// that a probe really goes out carrying somebody else's identity, and that D324's taxonomy really
// reaches the assertion's message.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { parseConfigSource, parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { resolveConfig } from '../src/resolve.js';
import type { AuthzFinding } from '../src/interpreter.js';
import type { ScanDecline, ScanSink } from '../src/scanFindings.js';
import type { ResolvedConfig } from '../src/types.js';

// --- the fixture ---------------------------------------------------------------------------------
//
// One app, four identities, and every route below is a deliberate row of D324's table. Tokens are
// the whole authorization model: `shopper` owns `a1`, `peer` owns `b7`, and the routes decide what
// each principal is allowed to see.

const TOKENS: Record<string, string> = { 'tok-shopper': 'shopper', 'tok-peer': 'peer', 'tok-admin': 'admin', 'tok-audit': 'audit' };
const OWNER_OF: Record<string, string> = { a1: 'shopper', b7: 'peer' };

let server: Server;
let baseUrl: string;
/** Flipped per test to steer the routes that have more than one behaviour to demonstrate. */
let mode = 'safe';

function whoami(req: IncomingMessage): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return TOKENS[auth.slice(7)] ?? null;
  const cookie = req.headers['cookie'];
  if (typeof cookie === 'string') {
    const m = /sid=([^;]+)/.exec(cookie);
    if (m) return TOKENS[m[1]!] ?? null;
  }
  return null;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const who = whoami(req);

    // Login, one route per identity. A session body posts here and captures its token.
    const login = /^\/login\/(\w+)$/.exec(url.pathname);
    if (login) {
      const name = login[1]!;
      const token = `tok-${name}`;
      // `audit` logs in by cookie alone and contributes no `Authorization` header — the shape D325
      // is about, and the reason it is a *fixture* identity rather than a mocked flag.
      if (name === 'audit') {
        res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `sid=${token}; Path=/` }).end('{"ok":true}');
        return;
      }
      // M137b (D433) — `cookieshop` is `shopper` on a cookie, and the one login that issues a CSRF
      // token. It shares `tok-shopper` deliberately, so `whoami` resolves it to the same human and it
      // owns the same `a1`: the derived withheld-token principal has to be the OWNER for the CSRF
      // question to mean anything.
      if (name === 'cookieshop') {
        res
          .writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'sid=tok-shopper; Path=/' })
          .end('{"csrfToken":"csrf-1"}');
        return;
      }
      json(res, 200, { token });
      return;
    }

    // The object endpoint. `/orders/a1` belongs to `shopper`.
    const order = /^\/orders\/(\w+)$/.exec(url.pathname);
    if (order) {
      const id = order[1]!;
      if (who === null) return json(res, 401, { error: 'unauthenticated' });
      if (req.method !== 'GET') {
        // A cookie-borne principal on a mutating method is refused before authorization is
        // consulted — apiV2's real `AnyAuthGuard` shape (`M130-01`), reproduced.
        if (who === 'audit') return json(res, 403, { error: 'missing X-CSRF-Token' });
        if (who !== OWNER_OF[id] && who !== 'admin') return json(res, 403, { error: 'forbidden' });
        return json(res, 200, { id, deleted: true });
      }
      if (who === 'admin') return json(res, 200, { id, total: 41 });
      if (mode === 'leak') return json(res, 200, { id, total: 41 });
      if (who !== OWNER_OF[id]) {
        // A correct 404 that echoes the requested id — live in the dogfood target at
        // `categories.service.ts:44`, and the reason containment runs on success statuses only.
        return json(res, 404, { error: `order ${id} not found` });
      }
      return json(res, 200, { id, total: 41 });
    }

    // The collection endpoint: a correct answer is a *filtered* 200, invisible to a status oracle.
    if (url.pathname === '/orders') {
      if (who === null) return json(res, 401, { error: 'unauthenticated' });
      if (mode === 'collection-leak') return json(res, 200, [{ id: 'a1' }, { id: 'b7' }]);
      const mine = Object.entries(OWNER_OF).filter(([, owner]) => owner === who).map(([id]) => ({ id }));
      return json(res, 200, mine);
    }

    if (url.pathname === '/throttled') {
      if (who === 'shopper') return json(res, 200, { id: 'a1' });
      return json(res, 429, { error: 'slow down' });
    }
    if (url.pathname === '/broken') {
      if (who === 'shopper') return json(res, 200, { id: 'a1' });
      return json(res, 500, { error: 'boom' });
    }
    if (url.pathname === '/html') {
      if (who === 'shopper') return json(res, 200, { id: 'a1' });
      res.writeHead(200, { 'content-type': 'text/html' }).end('<html>nope</html>');
      return;
    }
    // M137b (D434) — an endpoint with NO CSRF defence: it never looks at `X-CSRF-Token`, so a cookie
    // alone changes state. The owner's own body is an object with a root `id`, which is what makes
    // this route able to distinguish D457's two designs: merged into one probe list, the token-less
    // 2xx carries the owner's id and `sec/authz-object-leak` fires as well.
    const unguarded = /^\/unguarded\/(\w+)$/.exec(url.pathname);
    if (unguarded) {
      const id = unguarded[1]!;
      if (who === null) return json(res, 401, { error: 'unauthenticated' });
      if (req.method === 'GET') return json(res, 200, { id, total: 41 });
      if (who !== OWNER_OF[id] && who !== 'admin') return json(res, 403, { error: 'forbidden' });
      return json(res, 200, { id, deleted: true });
    }

    // M137c2 (D482) — a **public** catalog: an array of objects with root ids, served to anybody
    // including a caller with no credentials at all. Deliberately unlike `/orders`, whose first act is
    // to `401` an unauthenticated caller: that one difference is the whole predicate, so the fixture
    // has to carry a route on each side of it. Real applications are full of these — a product list, a
    // public feed, a category tree — and pointing a crawler at one is what turned a rare false
    // positive into 20 of them.
    if (url.pathname === '/catalog') {
      return json(res, 200, [{ id: 'p1' }, { id: 'p2' }]);
    }
    if (url.pathname === '/enveloped') {
      return json(res, 200, { data: [{ id: 'a1' }], nextCursor: 'x' });
    }
    if (url.pathname === '/missing') {
      return json(res, 404, { error: 'gone' });
    }
    json(res, 404, { error: 'no route' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// --- the config, parsed and resolved rather than hand-built ---------------------------------------
//
// Through the real grammar and the real `resolveConfig`, so `privileged` and `probe mutating` are
// exercised as written rather than as a field somebody set. That is half of what this file proves:
// `M130b2`'s grammar commit and its engine commit have to agree, and only a config that travels the
// whole way can say whether they do.

function configSource(extra = '', extraSessions = ''): string {
  return (
    'defaults\n' +
    `  authorized target "${baseUrl}" reason "self-hosted test fixture"\n` +
    extra +
    '\n' +
    'env local default\n' +
    `  api "${baseUrl}"\n` +
    '\n' +
    'session shopper\n' +
    '  api POST /login/shopper\n' +
    '  capture body.token as token\n' +
    '  header "Authorization" is "Bearer {token}"\n' +
    '\n' +
    'session peer\n' +
    '  api POST /login/peer\n' +
    '  capture body.token as token\n' +
    '  header "Authorization" is "Bearer {token}"\n' +
    '\n' +
    'session admin privileged\n' +
    '  api POST /login/admin\n' +
    '  capture body.token as token\n' +
    '  header "Authorization" is "Bearer {token}"\n' +
    '\n' +
    'session audit\n' +
    '  api POST /login/audit\n' +
    extraSessions
  );
}

/**
 * M137b (D433) — the same human as `shopper`, on a cookie, able to supply a CSRF token.
 *
 * Passed in per-test rather than added to `configSource` above, and that is not a style choice: every
 * declared session joins the probe set, so putting it in the shared config changed the probe counts in
 * ten existing assertions at once. A milestone's new principal must not silently re-baseline the
 * numbers the file already proves.
 */
const COOKIE_CSRF_SESSION =
  '\n' +
  'session cookieshop\n' +
  '  api POST /login/cookieshop\n' +
  '  csrf from body.csrfToken send as header "X-CSRF-Token"\n';

function resolved(extra = '', extraSessions = ''): ResolvedConfig {
  const source = configSource(extra, extraSessions);
  const { config, diagnostics } = parseConfigSource(source);
  assert.deepEqual(diagnostics.map((d) => `${d.code}: ${d.message}`), [], 'the fixture config must parse and check clean');
  return resolveConfig(config!, config!.envs[0]!);
}

interface RunResult {
  readonly detail: string;
  readonly ok: boolean;
  readonly error: string | undefined;
  readonly findings: AuthzFinding[];
  readonly declines: ScanDecline[];
}

async function run(source: string, cfg: ResolvedConfig = resolved()): Promise<RunResult> {
  const findings: AuthzFinding[] = [];
  // D418a — declines moved from `ReproSink` to the shared `ScanSink`, so this harness collects them
  // from the channel the report actually reads.
  const declines: ScanDecline[] = [];
  const scanSink: ScanSink = { finding: () => {}, census: () => {}, decline: (d) => declines.push(d) };
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${source}`);
  const { report } = await runProgram(program, cfg, {
    source,
    reproSink: { finding: (f) => findings.push(f) },
    scanSink,
  });
  const t = report.tests[0]!;
  const steps = t.kind === 'functional' ? t.steps : [];
  const asserts = steps.filter((s) => s.kind === 'expect' || s.kind === 'check');
  const last = asserts[asserts.length - 1];
  return { detail: last?.detail ?? '', ok: last?.ok ?? false, error: t.kind === 'functional' ? t.error : undefined, findings, declines };
}

const asserting = (step: string, owner = 'shopper'): string =>
  `test "t" as ${owner}\n  ${step}\n  expect response has no authorization violations\n`;

// --- the join itself ------------------------------------------------------------------------------

test('the probe set is assembled from the config: owner out, privileged out, anonymous in', async () => {
  mode = 'safe';
  const r = await run(asserting('api GET /orders/a1'));
  // `shopper` is the owner, `admin` is privileged — so `peer`, `audit` and `anonymous` are probed.
  assert.match(r.detail, /3 principals probed/);
  assert.match(r.detail, /not probed as `admin` — declared `privileged`/);
  assert.ok(r.ok, `expected a pass, got: ${r.detail}`);
});

test('the boundary holding is a pass, and the counts say what actually happened', async () => {
  mode = 'safe';
  const r = await run(asserting('api GET /orders/a1'));
  assert.match(r.detail, /response has no authorization violations/);
  // M137b (D434) made this three: the CSRF rule is always considered and reports not-applicable when
  // no owning session declares a `csrf from` clause, which is the case here.
  assert.match(r.detail, /3 rules — 1 applicable, 2 not applicable, 0 violations/);
  // `peer` and `anonymous` are refused; `audit` reads by cookie and a GET is not a mutating method,
  // so it is refused too rather than inconclusive. Three refusals, no inconclusive rows.
  assert.match(r.detail, /3 refused/);
  assert.deepEqual(r.findings, [], 'a passing assertion records nothing for the repro emitter');
});

test('an object leak is a critical finding, naming the rule and the leaked id', async () => {
  mode = 'leak';
  const r = await run(asserting('api GET /orders/a1'));
  assert.equal(r.ok, false);
  assert.match(r.detail, /sec\/authz-object-leak/);
  assert.match(r.detail, /\[critical\]/);
  assert.match(r.detail, /a1/);
  // One finding per violating principal (D320) — `peer` and `audit` both got the order.
  assert.deepEqual(r.findings.map((f) => f.principal).sort(), ['audit', 'peer']);
  assert.deepEqual([...new Set(r.findings.map((f) => f.rule))], ['sec/authz-object-leak']);
  assert.deepEqual(r.findings[0]!.owners, ['shopper']);
});

test('a collection leak is caught where a status oracle sees only two 200s', async () => {
  mode = 'collection-leak';
  const r = await run(asserting('api GET /orders'));
  assert.equal(r.ok, false);
  assert.match(r.detail, /sec\/authz-collection-leak/);
  // The whole reason this tier is differential rather than status-based: `peer`'s correct answer to
  // `GET /orders` is also a `200`, and `authz.tflw` had to hand-write this case for the same reason.
  assert.match(r.detail, /3 principals probed/);
});

test('a filtered collection is a pass — the correct answer is also a 200', async () => {
  mode = 'safe';
  const r = await run(asserting('api GET /orders'));
  assert.ok(r.ok, `expected a pass, got: ${r.detail}`);
  assert.match(r.detail, /served different content/);
});

// --- D324's remaining rows, each reaching the message ---------------------------------------------

test('a 429 is inconclusive, never a boundary — a suite must not read its own throttle as a pass', async () => {
  mode = 'safe';
  const r = await run(asserting('api GET /throttled'));
  assert.match(r.detail, /inconclusive/);
  assert.match(r.detail, /rate limited/i);
  // Every probe inconclusive means nothing was judged, so D285 fires rather than a green.
  assert.equal(r.ok, false);
  assert.match(r.detail, /had no power to fail/);
  assert.equal(r.declines.length, 3);
});

test('a 5xx is inconclusive for the same reason a 429 is', async () => {
  mode = 'safe';
  const r = await run(asserting('api GET /broken'));
  assert.match(r.detail, /inconclusive/);
  assert.equal(r.ok, false);
});

test('a non-JSON probe body is un-judged, never clean', async () => {
  mode = 'safe';
  const r = await run(asserting('api GET /html'));
  assert.match(r.detail, /inconclusive/);
  assert.match(r.detail, /a body that is not JSON/);
});

test('D325: a cookie-borne principal refused on a mutating method is inconclusive, and still probed', async () => {
  mode = 'safe';
  const r = await run(asserting('api DELETE /orders/a1'), resolved('    probe mutating\n'));
  // `audit` holds its identity in the jar alone, so its 403 on a DELETE may be CSRF rather than
  // authorization — and the engine says so instead of scoring it as a boundary that held.
  assert.match(r.detail, /`audit` inconclusive/);
  assert.match(r.detail, /CSRF/);
  // `peer` and `anonymous` still answered, so the assertion is judged rather than powerless.
  assert.ok(r.ok, `expected a pass, got: ${r.detail}`);
});

test('without `probe mutating`, a mutating step probes nobody and says so', async () => {
  mode = 'safe';
  const r = await run(asserting('api DELETE /orders/a1'));
  assert.match(r.detail, /not probed/);
  assert.match(r.detail, /probe mutating/);
  assert.equal(r.ok, false, 'nothing was judged, so D285 fires');
  assert.equal(r.declines.length, 3);
});

// --- D285's two doors -----------------------------------------------------------------------------

test('an owner body the oracle refuses to guess at is a not-applicable, not a pass', async () => {
  mode = 'safe';
  const r = await run(asserting('api GET /enveloped'));
  assert.equal(r.ok, false);
  assert.match(r.detail, /had no power to fail/);
  // The message names the shape it could not read, so the widening evidence arrives as a user
  // report rather than as speculation (D321).
  assert.match(r.detail, /no resource identity found/);
});

test('a 4xx owner response engages nothing, and fails rather than greening', async () => {
  mode = 'safe';
  const r = await run(asserting('api GET /missing'));
  assert.equal(r.ok, false);
  assert.match(r.detail, /had no power to fail/);
});

// --- the two runtime guards -----------------------------------------------------------------------

test('TF062 runtime half: a credential the owner sessions never supplied fails before any probe', async () => {
  mode = 'safe';
  const src = `test "t" as shopper\n  api GET /orders/a1\n    header "Authorization" is "Bearer tok-peer"\n  expect response has no authorization violations\n`;
  const r = await run(src);
  assert.equal(r.ok, false);
  assert.match(r.error ?? r.detail, /carries a `Authorization` header that none of its owning session/);
  assert.deepEqual(r.declines, [], 'the guard runs before the probe set is established, so nothing was declined');
});

test('TF063 runtime backstop: an ownerless test fails at the assertion, not silently', async () => {
  // The checker refuses this statically too — but only for a test body it can see. This is the half
  // that survives the assertion being written inside an `action`, which is why it is asserted here
  // against the interpreter rather than trusted to the checker.
  mode = 'safe';
  // The action is named `read order`, not `check ownership`: `check` is the soft-assert keyword,
  // so a call written `check ownership()` lexes as an assertion about a subject named `ownership`.
  const src = 'action read order()\n  api GET /orders/a1\n  expect response has no authorization violations\n\ntest "t"\n  read order()\n';
  const r = await run(src);
  assert.equal(r.ok, false);
  assert.match(r.error ?? '', /needs an owner/);
});

// --- the severity floor ----------------------------------------------------------------------------

test('the floor narrows the pack before applicability, exactly as it does for Tier 1', async () => {
  mode = 'leak';
  const src = 'test "t" as shopper\n  api GET /orders/a1\n  expect response has no critical authorization violations\n';
  const r = await run(src);
  // Both rules are critical, so a `critical` floor narrows nothing and the leak is still reported.
  assert.equal(r.ok, false);
  assert.match(r.detail, /sec\/authz-object-leak/);
});

// --- M137b (D433/D434/D457): the CSRF clause and the derived principal, end to end ----------------
//
// `authz-rules.test.ts` proves what the rule decides given a bundle and `authz-probe.test.ts` proves
// what the prober sends. Only this file can prove the JOIN — that the derived principal is really
// assembled from a real config, that its probe really goes out, and that `runAuthzScan` is really
// handed it in the field D457 put it in. That last one is not a hypothetical worry: the mutation
// `csrf-probe-shares-the-authz-list` SURVIVED the suite until this test existed, because every
// assertion about the separation was made against a hand-built bundle rather than against the call
// site the interpreter actually makes.

// `as cookieshop, shopper` names BOTH, which is D327's legal multi-owner form and necessary here:
// they are one human under two session names (the corpus's own `shopper`/`shopperBearer` idiom), so
// naming only the cookie one leaves the bearer one in the probe set, where it reaches the owner's own
// resource and is reported — correctly, by the oracle's definition — as an object leak. That is a
// property of declaring one person twice, not of this milestone.
const CSRF_OWNER = 'test "t" as cookieshop, shopper\n  api DELETE /unguarded/a1\n  expect response has no authorization violations\n';

test('D434: a mutating request that succeeds with the token withheld is a critical finding', async () => {
  mode = 'safe';
  const r = await run(CSRF_OWNER, resolved('    probe mutating\n', COOKIE_CSRF_SESSION));
  assert.equal(r.ok, false, `the app has no CSRF defence, so the assertion must fail: ${r.detail}`);
  assert.match(r.detail, /sec\/csrf-not-enforced/);
  assert.match(r.detail, /\[critical\]/);
  assert.match(r.detail, /csrf token withheld/, 'the derived principal names itself as derived (D434)');
  // Asserted on the report detail rather than on `r.findings`, and the difference is worth stating:
  // `ReproSink` is fed from `leaked` probes because its job is writing runnable repros (D418a), and
  // generalizing that emitter to every originating scan is D440's work in `M137c`/`M137d`. So a CSRF
  // finding reaches the verdict and the message — which is what fails the run — and does not yet
  // reach the repro channel. Named here so its absence reads as sequencing rather than an oversight.
  assert.deepEqual(r.findings, [], 'no repro is emitted for this class yet — D440 generalizes the emitter later in the arc');
});

test('D457: the derived probe is not read as a BOLA leak against the owner’s own resource', async () => {
  // The mutation-killing half, and the reason the route returns an object with a root `id`: the
  // token-less 2xx carries `a1`, which is `sec/authz-object-leak`'s exact trigger. With the derived
  // probe merged into the authorization list, this run reports a critical BOLA finding against the
  // owner's own resource — on the happy path of the rule this milestone adds.
  mode = 'safe';
  const r = await run(CSRF_OWNER, resolved('    probe mutating\n', COOKIE_CSRF_SESSION));
  const leaks = r.findings.filter((f) => f.rule !== 'sec/csrf-not-enforced');
  assert.deepEqual(
    leaks.map((f) => `${f.rule} (${f.principal})`),
    [],
    'no authorization rule may see the withheld-token probe — the derived principal IS the owner',
  );
});

test('D433: a cookie principal that supplies its token is judged; one that cannot still declines', async () => {
  // The half of `M130-01` this milestone closes, and BOTH halves are asserted from one run because
  // that is the pair D455 is about. `cookieshop` and `audit` are both cookie-borne principals refused
  // on a mutating method; the only difference is that one holds a token. So the decline channel must
  // name `audit` and must not name `cookieshop` — the ambiguity is gone for one and real for the
  // other, which is why D455 keeps a token-less cookie principal declared in the corpus rather than
  // letting the fix erase its own evidence.
  //
  // Asserted per-principal rather than against the whole message: `audit`'s note legitimately still
  // contains the D325 wording, so a match against the message would pass for the wrong reason.
  mode = 'safe';
  const r = await run(asserting('api DELETE /orders/b7'), resolved('    probe mutating\n', COOKIE_CSRF_SESSION));
  const csrfDeclines = r.declines.filter((d) => /cannot supply the CSRF token/.test(d.reason)).map((d) => d.subject);
  assert.deepEqual(csrfDeclines, ['audit'], `only the principal with no \`csrf from\` clause may decline for CSRF, got: ${csrfDeclines.join(', ') || '(none)'}`);
});

test('D434: a withheld-token probe with no `probe mutating` is a blind spot, not a defence working', async () => {
  mode = 'safe';
  const r = await run('test "t" as cookieshop\n  api DELETE /unguarded/a1\n  expect response has no authorization violations\n', resolved('', COOKIE_CSRF_SESSION));
  assert.equal(r.ok, false, 'nothing was judged, so D285 fails rather than greening');
  assert.ok(
    r.declines.some((d) => d.subject.includes('csrf token withheld')),
    `the derived principal must declare its own decline, got: ${r.declines.map((d) => d.subject).join(', ')}`,
  );
});

// --- D482: a public resource has no owner (M137c2) -------------------------------------------------
//
// The unit half lives in `authz-rules.test.ts`. This half exists for the reason that file's header
// gives: a pure test can agree with the code about a fact the rest of the system contradicts. What is
// proved here is that the probe set the *interpreter* assembles contains `anonymous` in the state the
// rule reads, and that the note reaches the step detail a reader actually sees.

test('D482: a public collection is a pass, not a critical finding', async () => {
  mode = 'safe';
  const r = await run(asserting('api GET /catalog'));
  assert.ok(r.ok, `a public catalog is not a BOLA finding, got: ${r.detail}`);
  assert.doesNotMatch(r.detail, /sec\/authz-collection-leak:/, 'the rule must not fire here');
  assert.deepEqual(r.findings, [], 'and nothing may reach the repro emitter either');
});

test('D482: the pass says why, because the probe line otherwise contradicts it', async () => {
  mode = 'safe';
  const r = await run(asserting('api GET /catalog'));
  // Every principal receives the catalog, so the probe line reads `3 leaked` — beside `0 violations`.
  // Both are true and the pair is unreadable without the reason on the same line, which is why this
  // assertion is on the *text* rather than only on the verdict.
  assert.match(r.detail, /3 leaked/);
  assert.match(r.detail, /0 violations/);
  assert.match(r.detail, /`anonymous` received the same resources, so this is public data with no owner/);
  assert.match(r.detail, /found nothing to violate rather than finding a boundary intact/);
});

test('D482: the rule stays applicable, so D285 does not fail a crawl over a public API', async () => {
  mode = 'safe';
  const r = await run(asserting('api GET /catalog'));
  // The decision the whole fix turns on. Routed through the not-applicable door this response would
  // have **no** applicable rule — `authz-object-leak` reads an object, `csrf-not-enforced` needs a
  // clause — and D285 would fail the assertion. That trades 20 spurious findings for 4 spurious
  // failures, which is why the guard says "applicable, nothing violated" instead.
  assert.match(r.detail, /3 rules — 1 applicable, 2 not applicable, 0 violations/);
  assert.doesNotMatch(r.detail, /had no power to fail/);
});

test('D482: the guard is narrow — a guarded route still leaks, because `anonymous` is refused there', async () => {
  // The negative control, and the one that matters most: the arc's whole plant set (`V6`, `V7`, `V15`)
  // sits behind a guard that `401`s a credential-less caller. A guard keyed on anything looser than
  // "`anonymous` received the owner's own ids" would suppress those too and look like a precision win
  // while silently becoming a false-negative machine.
  //
  // `/orders` is that route: its first act is to `401` an unauthenticated caller, and in
  // `collection-leak` mode it serves everybody's rows to anyone who is logged in.
  mode = 'collection-leak';
  const r = await run(asserting('api GET /orders'));
  assert.equal(r.ok, false, 'a real leak must still fire');
  assert.match(r.detail, /sec\/authz-collection-leak/);
  assert.doesNotMatch(r.detail, /public data with no owner/, 'and it must not claim the data is public');
});
