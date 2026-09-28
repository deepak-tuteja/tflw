// `M247` `A` (`D1352`) — a session signs the browser in. Real headless Chromium against a real
// loopback server, the same no-mocking stance as `browser-steps.test.ts`: the page decides whether
// it is signed in from the `Cookie` header the *browser* sent, so a pass here means the browser
// really carried the session's cookie, not that a helper said it would.
//
// Five known-answers: the seed signs the page in; a test without `as` is the control and opens
// signed out; `HttpOnly` survives the seed (the page's script cannot read the cookie); a session
// that captured headers only seeds nothing and the trace says so; and the loopback spellings are
// not aliased — a jar filed under `127.0.0.1` does not sign in a page opened at `localhost`.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { BrowserManager } from '../src/browser.js';
import { resolveConfig, selectEnv } from '../src/resolve.js';
import { startFixtureServer, type FixtureServer } from './support.js';
import type { ResolvedConfig } from '../src/types.js';
import { asEntry } from './__helpers__/entry.js';
import { stagedSetup } from '../../../scripts/test-staging.mjs';

/** Server-rendered from the request's own `Cookie` header, then a script reports what
 * `document.cookie` can see — so one page answers both *did the browser send it* and *can the
 * page's script read it*. */
function mePage(cookieHeader: string | undefined): string {
  const signedIn = /(?:^|;\s*)sid=tok-42(?:;|$)/.test(cookieHeader ?? '');
  return `<!doctype html><html><head><title>me</title></head><body>
  <h1>${signedIn ? 'signed in as shopper' : 'signed out'}</h1>
  <p id="js"></p>
  <script>document.getElementById('js').textContent = 'script sees: [' + document.cookie + ']';</script>
</body></html>`;
}

let server: FixtureServer;
let browserManager: BrowserManager;

const setup = stagedSetup(async () => {
  server = await startFixtureServer({
    '/login': (_req, res) => res.writeHead(200, { 'set-cookie': ['sid=tok-42; Path=/; HttpOnly; SameSite=Lax', 'theme=dark; Path=/'] }).end('{}'),
    '/me': (req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(mePage(req.headers.cookie)),
  });
  browserManager = new BrowserManager();
});

before(setup.begin);

after(async () => {
  await setup.settled(); // `M237` `A1` — see `scripts/test-staging.mjs`
  await browserManager?.close();
  await server?.close();
});

function config(sessionBody: string, webBaseUrl = server.baseUrl): ResolvedConfig {
  const configSource = `env test default\n  api "${server.baseUrl}"\n  web "${webBaseUrl}"\n\nsession shopper\n${sessionBody}`;
  const parsed = parseConfigSource(configSource);
  assert.deepEqual(parsed.diagnostics, [], JSON.stringify(parsed.diagnostics));
  return resolveConfig(parsed.config, selectEnv(parsed.config, {}));
}

const COOKIE_LOGIN = `  api POST /login\n  expect status equals 200\n`;
const HEADER_ONLY = `  header "Authorization" is "Bearer abc"\n`;

async function run(source: string, cfg: ResolvedConfig) {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `unexpected parse diagnostics: ${JSON.stringify(diagnostics)}`);
  return runProgram(program, cfg, { source, browserManager });
}

function openStep(report: Awaited<ReturnType<typeof run>>['report']) {
  const steps = asEntry(report.tests[0], 'functional').steps;
  const open = steps.find((s) => s.kind === 'open');
  assert.ok(open, JSON.stringify(steps));
  return open;
}

test('`as <session>` opens the page signed in: the browser carries the session\'s cookie', async () => {
  const { report } = await run(`test "signed in" as shopper\n  open "/me"\n  expect text "signed in as shopper" is visible\n`, config(COOKIE_LOGIN));
  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const detail = openStep(report).detail ?? '';
  assert.match(detail, /browser signed in from session "shopper": 2 cookies for 127\.0\.0\.1:\d+/);
  assert.doesNotMatch(detail, /tok-42/, 'a cookie value never reaches the trace');
});

test('control: the same page without `as` opens signed out, and the trace says nothing about a seed', async () => {
  const { report } = await run(`test "no session"\n  open "/me"\n  expect text "signed out" is visible\n`, config(COOKIE_LOGIN));
  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.doesNotMatch(openStep(report).detail ?? '', /session/);
});

test('`HttpOnly` survives the seed: the page\'s script sees the plain cookie and not the session one', async () => {
  const { report } = await run(
    `test "httponly kept" as shopper\n  open "/me"\n  expect text "script sees: [theme=dark]" is visible\n`,
    config(COOKIE_LOGIN),
  );
  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
});

test('a session that captured headers only seeds nothing, and the open step says so', async () => {
  const { report } = await run(`test "bearer only" as shopper\n  open "/me"\n  expect text "signed out" is visible\n`, config(HEADER_ONLY));
  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.match(openStep(report).detail ?? '', /session "shopper" carries headers only — the page opens signed out/);
});

test('loopback names are not aliased: a jar filed under 127.0.0.1 does not sign in a page at localhost', async () => {
  const web = server.baseUrl.replace('127.0.0.1', 'localhost');
  const { report } = await run(`test "other loopback name" as shopper\n  open "/me"\n  expect text "signed out" is visible\n`, config(COOKIE_LOGIN, web));
  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  // The seed still happened — for the host that set the cookies — and the trace names that host,
  // which is how an author sees why the page is signed out.
  assert.match(openStep(report).detail ?? '', /2 cookies for 127\.0\.0\.1:\d+/);
});
