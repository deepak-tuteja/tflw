// M88a (review cluster C2 — `B4-09`, `B4-10`, `B4-14`) — what a redirect chain that never
// terminates means, stated once for every client path.
//
// The finding: only *native* `redirect: 'follow'` ever errored at the cap. All three hand-written
// loops — the pinned workload client, the mTLS worker, and (since M85) the pooled client whenever
// `allow hosts` is set — handed the last 3xx back as if it were an ordinary response. An infinite
// redirect loop therefore *passed* `expect status equals 302` and reported a 0% error rate. Which
// of the two behaviours a run got was decided by `allow hosts`: a security directive silently
// changing a verdict (`B4-14`).
//
// So the tests below are written as **pairs**, not as literals. The defect was never "one path
// gives the wrong answer" — it was "two paths give different answers", and a test that pins each
// path to a hardcoded expectation would still pass on the day they drift apart again. Every
// property here is asserted as an equality between guarded and unguarded, or pinned and pooled, on
// the same chain (M85's pattern, `allow-hosts.test.ts:8-11`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { sendRequest } from '../src/http.js';
import { createPinnedAgents, destroyPinnedAgents, sendPinnedRequest } from '../src/httpPinned.js';
import { MAX_REDIRECTS, RedirectLimitError } from '../src/redirect.js';
import { startFixtureServer, testConfig, json, type Handler } from './support.js';

/** `/hopN` redirects to `/hop(N-1)`; `/hop0` answers 200. Requesting `/hopN` therefore performs
 * exactly N redirects — which is what lets the cap be tested *at its boundary* rather than only
 * with an infinite loop, and the boundary is the part most easily moved by accident when a
 * `return` becomes a `throw`. */
function hopChainRoutes(depth: number): Record<string, Handler> {
  const routes: Record<string, Handler> = { '/hop0': (_req, res) => json(res, 200, { landed: true }) };
  for (let i = 1; i <= depth; i++) {
    routes[`/hop${i}`] = (_req, res) => res.writeHead(302, { location: `/hop${i - 1}` }).end();
  }
  routes['/loop'] = (_req, res) => res.writeHead(302, { location: '/loop' }).end();
  return routes;
}

const GUARDED = ['127.0.0.1'];

test('an endless redirect chain is an error, not a response — pooled, both with and without `allow hosts`', async () => {
  const server = await startFixtureServer(hopChainRoutes(0));
  const opts = { method: 'GET', url: `${server.baseUrl}/loop`, headers: {}, timeoutMs: 5000, followRedirects: true } as const;

  // The negative control *is* the test (`B4-14`): the two configs differ by one security key and
  // nothing else, and before M88a the guarded one returned a 302 while the unguarded one threw.
  const unguarded = await sendRequest(opts).then((r) => r, (e: Error) => e);
  const guarded = await sendRequest({ ...opts, allowHosts: GUARDED }).then((r) => r, (e: Error) => e);

  assert.ok(unguarded instanceof RedirectLimitError, `unguarded returned instead of throwing: ${JSON.stringify(unguarded)}`);
  assert.ok(guarded instanceof RedirectLimitError, `guarded returned instead of throwing: ${JSON.stringify(guarded)}`);
  assert.equal(guarded.message, unguarded.message, '`allow hosts` must not change what a redirect loop means');

  // And the sentence itself says what happened, in terms of the request the *author* wrote —
  // undici's bare `fetch failed` named neither the chain nor the loop (`B4-10`).
  assert.match(unguarded.message, /too many redirects/);
  assert.match(unguarded.message, new RegExp(`more than ${MAX_REDIRECTS} times`));
  assert.match(unguarded.message, new RegExp(`GET ${server.baseUrl.replace(/\./g, '\\.')}/loop`));
  assert.match(unguarded.message, /without redirects/);

  await server.close();
});

test('the cap sits exactly where `fetch` puts it — 20 redirects land, 21 do not (pooled, guarded and unguarded)', async () => {
  const server = await startFixtureServer(hopChainRoutes(MAX_REDIRECTS + 1));
  const at = { method: 'GET', url: `${server.baseUrl}/hop${MAX_REDIRECTS}`, headers: {}, timeoutMs: 5000, followRedirects: true } as const;
  const over = { ...at, url: `${server.baseUrl}/hop${MAX_REDIRECTS + 1}` };

  // The unguarded arm is native `redirect: 'follow'`, so this pins the guarded loop's boundary to
  // `fetch`'s own rather than to a number this repo chose (D-M88-1: the pooled path is normative).
  const atUnguarded = await sendRequest(at);
  const atGuarded = await sendRequest({ ...at, allowHosts: GUARDED });
  assert.equal(atUnguarded.status, 200);
  assert.equal(atGuarded.status, atUnguarded.status);
  assert.deepEqual(atGuarded.json, atUnguarded.json);

  const overUnguarded = await sendRequest(over).then((r) => r, (e: Error) => e);
  const overGuarded = await sendRequest({ ...over, allowHosts: GUARDED }).then((r) => r, (e: Error) => e);
  assert.ok(overUnguarded instanceof RedirectLimitError, `unguarded: ${JSON.stringify(overUnguarded)}`);
  assert.ok(overGuarded instanceof RedirectLimitError, `guarded: ${JSON.stringify(overGuarded)}`);

  await server.close();
});

test('the pinned (workload) client stops at the same place, saying the same thing', async () => {
  // Which client a step runs on is a performance decision (`run N iterations` selects this one) —
  // `B4-01`'s lesson, one axis over: it must not decide whether an endless chain is a pass.
  const server = await startFixtureServer(hopChainRoutes(MAX_REDIRECTS + 1));
  const agents = createPinnedAgents();
  const opts = { method: 'GET', url: `${server.baseUrl}/loop`, headers: {}, timeoutMs: 5000, followRedirects: true } as const;

  const pinned = await sendPinnedRequest(opts, agents).then((r) => r, (e: Error) => e);
  const pooled = await sendRequest(opts).then((r) => r, (e: Error) => e);

  assert.ok(pinned instanceof RedirectLimitError, `pinned returned instead of throwing: ${JSON.stringify(pinned)}`);
  assert.ok(pooled instanceof RedirectLimitError, `pooled: ${JSON.stringify(pooled)}`);
  assert.equal(pinned.message, pooled.message);

  // Same boundary, too — asserted against the pooled path's own answer, not against 20.
  const at = { ...opts, url: `${server.baseUrl}/hop${MAX_REDIRECTS}` };
  const over = { ...opts, url: `${server.baseUrl}/hop${MAX_REDIRECTS + 1}` };
  assert.equal((await sendPinnedRequest(at, agents)).status, (await sendRequest(at)).status);
  const pinnedOver = await sendPinnedRequest(over, agents).then((r) => r, (e: Error) => e);
  assert.ok(pinnedOver instanceof RedirectLimitError, `pinned at cap+1: ${JSON.stringify(pinnedOver)}`);

  destroyPinnedAgents(agents);
  await server.close();
});

test('`without redirects` still observes the 3xx itself — the cap never fires when nothing is followed', async () => {
  // The cap lives inside the follow branch on every path; this is the guard that it stayed there,
  // since a chain that is never walked cannot be too long (SPEC §5.1, §5.3).
  const server = await startFixtureServer(hopChainRoutes(0));
  const opts = { method: 'GET', url: `${server.baseUrl}/loop`, headers: {}, timeoutMs: 5000, followRedirects: false } as const;
  const agents = createPinnedAgents();

  const pooled = await sendRequest(opts);
  const pinned = await sendPinnedRequest(opts, agents);

  assert.equal(pooled.status, 302);
  assert.equal(pinned.status, pooled.status);

  destroyPinnedAgents(agents);
  await server.close();
});

test('a looping test fails the run, and fails it identically with and without `allow hosts`', async () => {
  // The end-to-end shape of `B4-09`/`B4-14`, at the surface an author actually sees: this exact
  // program reported ✓ 1/1 passed against an infinite redirect loop, and flipped from FAIL to PASS
  // when `allow hosts` was added to the config. `expect status equals 302` is what made that
  // possible — the 3xx handed back at the cap satisfies it.
  const source = 'test "follows a redirect loop"\n  api GET /loop\n  expect status equals 302\n';
  const server = await startFixtureServer(hopChainRoutes(0));
  const { program } = parseSource(source);

  const unguarded = await runProgram(program, testConfig(server.baseUrl), { source });
  const guarded = await runProgram(program, { ...testConfig(server.baseUrl), allowHosts: GUARDED }, { source });

  assert.equal(unguarded.report.ok, false, JSON.stringify(unguarded.report.tests, null, 2));
  assert.equal(guarded.report.ok, unguarded.report.ok, '`allow hosts` must not flip a verdict');
  assert.equal(guarded.report.tests[0]!.error, unguarded.report.tests[0]!.error);
  assert.match(unguarded.report.tests[0]!.error ?? '', /too many redirects/);

  await server.close();
});
