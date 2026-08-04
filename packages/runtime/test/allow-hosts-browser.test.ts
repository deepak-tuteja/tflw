// `allow hosts` on the browser half (M85, review cluster C1 / `B4-03`) — real headless Chromium
// against real loopback servers, same no-mocking philosophy as `browser-steps.test.ts`.
//
// The finding: the guardrail whose stated purpose is anti-pointed-at-prod had three call sites,
// all in `interpreter.ts`, all on the API half. One run, one config, one host would refuse
// `api other GET /echo` and then happily `open` a page on that same host — and the browser is the
// half most likely to be aimed at a real environment by accident.
//
// Two shapes are covered, because guarding only the first would read as covered while leaving the
// one that actually happens open: a **navigation** (`open`), and a **subresource** the page itself
// requests. The modern way a test ends up talking to prod isn't `open "https://prod…"`, it's a
// staging page whose bundle calls `https://api.prod…` over XHR.
//
// Addressing note, as in `allow-hosts.test.ts`: the list matches on hostname only, so `localhost`
// and `127.0.0.1` are used as two distinct names for the same loopback server. `localhost` appears
// only as a *blocked* target — a blocked request is refused before any DNS resolution, so nothing
// here depends on which address `localhost` happens to resolve to.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { BrowserManager } from '../src/browser.js';
import { startFixtureServer, testConfig, json, type FixtureServer } from './support.js';
import type { ResolvedConfig } from '../src/types.js';

const HOME_HTML = `<!doctype html><html><head><title>home</title></head><body><h1>Home</h1></body></html>`;

/** A page that issues one `fetch` to whatever `?to=` names and reports the outcome in the DOM, so
 * a blocked subresource is observable from a step rather than only from the network log. The
 * `catch` is what a real bundle does too — which is the point of the finding: a refused XHR fails
 * nothing on its own and would otherwise surface several steps later as an empty table. */
const XHR_HTML = (target: string) => `<!doctype html><html><head><title>xhr</title></head><body>
  <h1>Fetcher</h1>
  <p id="out">pending</p>
  <script>
    fetch(${JSON.stringify(target)})
      .then((r) => r.json())
      .then((d) => { document.getElementById('out').textContent = 'xhr:' + JSON.stringify(d); })
      .catch(() => { document.getElementById('out').textContent = 'xhr:failed'; });
  </script>
</body></html>`;

let server: FixtureServer;
let browserManager: BrowserManager;

before(async () => {
  server = await startFixtureServer({
    '/': (_req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(HOME_HTML),
    '/xhr': (req, res) => {
      const to = new URL(req.url ?? '/', 'http://x').searchParams.get('to') ?? '/api/data';
      res.writeHead(200, { 'content-type': 'text/html' }).end(XHR_HTML(to));
    },
    '/api/data': (_req, res) => json(res, 200, { real: true }),
  });
  browserManager = new BrowserManager();
});

after(async () => {
  await browserManager.close();
  await server.close();
});

/** `webBaseUrl` decides which hostname the *navigation* uses; `allowHosts` is always the same list,
 * so what changes between tests is only whether the page tflw opens is on it. */
function browserConfig(webBaseUrl: string, allowHosts: string[] | null): ResolvedConfig {
  return { ...testConfig(server.baseUrl), webBaseUrl, allowHosts };
}

function localhostUrl(path: string): string {
  return `${server.baseUrl.replace('127.0.0.1', 'localhost')}${path}`;
}

async function run(source: string, config: ResolvedConfig) {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `unexpected parse diagnostics: ${JSON.stringify(diagnostics)}`);
  return runProgram(program, config, { source, browserManager });
}

test('`open` on a host outside `allow hosts` is refused, and the page never loads', async () => {
  const before = server.received.get('/')?.length ?? 0;
  const config = browserConfig(server.baseUrl.replace('127.0.0.1', 'localhost'), ['127.0.0.1']);

  const { report } = await run(`test "navigate to an unlisted host"\n  open "/"\n`, config);

  assert.equal(report.ok, false);
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /the browser tried to open "http:\/\/localhost:\d+\/"/);
  assert.match(error, /host "localhost" is not in `allow hosts` \(127\.0\.0\.1\)/);
  // A blocked navigation reaches the interpreter as Playwright's own `net::ERR_FAILED` — true, and
  // useless in exactly the way cluster C11 is about. The refusal is the real reason and wins.
  assert.doesNotMatch(error, /ERR_FAILED/);
  assert.equal(server.received.get('/')?.length ?? 0, before, 'a refused navigation must never reach the server');
});

test('a page\'s own XHR to an unlisted host is refused too, not just what tflw navigates to', async () => {
  // The row that makes this cluster worth a milestone. The navigation here is *allowed* — this is
  // a legitimately-staging page — and what it reaches for is not.
  const before = server.received.get('/api/data')?.length ?? 0;
  const config = browserConfig(server.baseUrl, ['127.0.0.1']);

  const { report } = await run(
    // The `wait until` is what makes the assertion deterministic rather than a race: the page's
    // `catch` writes `xhr:failed`, so by the time this step resolves the route handler has already
    // run and recorded its refusal, which the step boundary then raises.
    `test "page calls an unlisted host"\n  open "/xhr?to=${encodeURIComponent(localhostUrl('/api/data'))}"\n  wait until text "xhr:failed" is visible\n`,
    config,
  );

  assert.equal(report.ok, false);
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /the page at "http:\/\/127\.0\.0\.1:\d+\/xhr/, 'the refusal names the page that made the call');
  assert.match(error, /requested "http:\/\/localhost:\d+\/api\/data" \(fetch\)/);
  assert.match(error, /this call came from the page, not from a step/);
  assert.match(error, /`stub` the call so it never reaches the network/);
  assert.equal(server.received.get('/api/data')?.length ?? 0, before, 'a refused XHR must never reach the server');
});

test('with `allow hosts` declared, an allowed page and its allowed XHR both still work', async () => {
  // The regression this milestone could most easily have shipped: routing every request through a
  // handler and then never resuming it. `route.continue()`, not `route.fallback()` — this guard is
  // registered first, at context creation, so at the moment it runs there is by construction no
  // next handler to defer to and `fallback()` drops the request entirely. Verified, not assumed:
  // with `fallback()` this test fails identically to the blocked ones.
  const config = browserConfig(server.baseUrl, ['127.0.0.1']);

  const { report } = await run(
    `test "allowed page and call"\n  open "/xhr?to=${encodeURIComponent('/api/data')}"\n  expect text "xhr:{\\"real\\":true}" is visible\n`,
    config,
  );

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
});

test('a `stub`bed call is answered locally and is not subject to the list', async () => {
  // A stubbed request is not a real network call, and `allow hosts` is about real ones. Playwright
  // runs page routes ahead of context routes, so the stub wins by construction — this pins that
  // ordering as intended semantics rather than a loophole nobody chose.
  const before = server.received.get('/api/data')?.length ?? 0;
  const config = browserConfig(server.baseUrl, ['127.0.0.1']);

  const { report } = await run(
    `test "stubbed call to an unlisted host"\n  open "/"\n  stub GET "**/api/data" respond status 200 body { stubbed: true }\n  open "/xhr?to=${encodeURIComponent(localhostUrl('/api/data'))}"\n  expect text "xhr:{\\"stubbed\\":true}" is visible\n`,
    config,
  );

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  assert.equal(server.received.get('/api/data')?.length ?? 0, before, 'a stub answers locally either way');
});

test('no `allow hosts` declared leaves the browser half exactly as it was', async () => {
  // The guard registers a blanket context route, which is not free — it disables some of the
  // browser's own fast paths. A run that never wrote `allow hosts` must not pay for, or observe,
  // any of it: the same cross-host XHR that is refused above goes through untouched here.
  const config = browserConfig(server.baseUrl, null);

  const { report } = await run(
    `test "unguarded"\n  open "/xhr?to=${encodeURIComponent('/api/data')}"\n  expect text "xhr:{\\"real\\":true}" is visible\n`,
    config,
  );

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
});
