// `M248` (`D1354`) — `session <name> oauth2 code`: the authorization-code grant with PKCE, signed in
// through a real browser against an in-process authorization server. The server is the known
// answer: it renders a consent form, issues a code bound to the challenge it was sent, 302s to the
// redirect, and checks the verifier at the exchange. Each test below turns one of those checks
// against the client.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseSource, parseConfigSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { resolveConfig, selectEnv } from '../src/resolve.js';
import { BrowserManager } from '../src/browser.js';
import { authorizeUrlFor, challengeOf, pkcePair, startRedirectListener } from '../src/oauth2Code.js';
import type { ResolvedConfig } from '../src/types.js';
import { startFixtureServer, json, type FixtureServer } from './support.js';

let browserManager: BrowserManager;
before(() => {
  browserManager = new BrowserManager();
});
after(async () => {
  await browserManager?.close();
});

interface Knobs {
  /** Send this `state` back instead of the one received. */
  readonly forgeState?: string;
  /** Answer the consent with `error=access_denied`. */
  readonly deny?: boolean;
  /** Bind the code to a challenge the client never sent, so the verifier cannot match. */
  readonly wrongChallenge?: boolean;
  readonly expiresIn?: number;
}

interface Issued {
  readonly challenge: string;
  readonly redirectUri: string;
  used: boolean;
}

/** The authorization server: `/oauth/authorize` (the form and its POST), `/oauth/token` (both grants)
 * and `/me` (reads the bearer). Every grant it served is recorded for the assertions. */
async function authServer(knobs: Knobs = {}): Promise<FixtureServer & { grants: string[]; redirects: string[]; tokens: string[]; codes: string[] }> {
  const codes = new Map<string, Issued>();
  const grants: string[] = [];
  const redirects: string[] = [];
  const tokens: string[] = [];
  const codeList: string[] = [];
  let n = 0;
  const server = await startFixtureServer({
    '/oauth/authorize': (req, res, body) => {
      if (req.method === 'GET') {
        const q = new URL(req.url!, 'http://x').searchParams;
        assert.equal(q.get('response_type'), 'code');
        assert.equal(q.get('code_challenge_method'), 'S256');
        const hidden = ['client_id', 'redirect_uri', 'code_challenge', 'state'].map((k) => `<input type="hidden" name="${k}" value="${q.get(k) ?? ''}">`).join('');
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<!doctype html><title>Consent</title><form method="post" action="/oauth/authorize">${hidden}<label>Email <input name="email"></label><label>Password <input name="password" type="password"></label><button type="submit">Allow</button></form>`);
        return;
      }
      const f = new URLSearchParams(body);
      const redirectUri = f.get('redirect_uri')!;
      redirects.push(redirectUri);
      const state = knobs.forgeState ?? f.get('state')!;
      const target = new URL(redirectUri);
      if (knobs.deny || f.get('password') !== 'pw-1') {
        target.searchParams.set('error', 'access_denied');
        target.searchParams.set('error_description', 'the user said no');
      } else {
        const code = `code-${++n}-abcdefgh`;
        codeList.push(code);
        codes.set(code, { challenge: knobs.wrongChallenge ? challengeOf('not-the-verifier-at-all-xxxxxxxxxxxxxxxxxxxx') : f.get('code_challenge')!, redirectUri, used: false });
        target.searchParams.set('code', code);
      }
      target.searchParams.set('state', state);
      res.writeHead(302, { location: target.toString() }).end();
    },
    '/oauth/token': (_req, res, body) => {
      const f = new URLSearchParams(body);
      const grant = f.get('grant_type')!;
      grants.push(grant);
      const issue = (): void => {
        const token = `access-${grants.length}-zzzzzzzz`;
        tokens.push(token);
        json(res, 200, { access_token: token, token_type: 'Bearer', refresh_token: `refresh-${grants.length}-yyyyyyyy`, ...(knobs.expiresIn !== undefined ? { expires_in: knobs.expiresIn } : {}) });
      };
      if (grant === 'refresh_token') return issue();
      const issued = codes.get(f.get('code') ?? '');
      if (!issued || issued.used) return json(res, 400, { error: 'invalid_grant' });
      issued.used = true;
      if (f.get('redirect_uri') !== issued.redirectUri) return json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri' });
      if (challengeOf(f.get('code_verifier') ?? '') !== issued.challenge) return json(res, 400, { error: 'invalid_grant', error_description: 'code_verifier' });
      issue();
    },
    '/me': (req, res) => json(res, 200, { auth: req.headers['authorization'] ?? null }),
  });
  return Object.assign(server, { grants, redirects, tokens, codes: codeList });
}

function configFor(baseUrl: string): { config: ResolvedConfig; configLines: string[] } {
  const configSource = `env test default
  api "${baseUrl}"

session sso oauth2 code
  authorize url "/oauth/authorize"
  token url "/oauth/token"
  client id "storefront-cli"
  redirect "http://127.0.0.1:0/callback"
  fill field "Email" with "ada@example.com"
  fill field "Password" with "pw-1"
  click button "Allow"
`;
  const parsed = parseConfigSource(configSource);
  assert.deepEqual(parsed.diagnostics, [], JSON.stringify(parsed.diagnostics));
  return { config: resolveConfig(parsed.config, selectEnv(parsed.config, {})), configLines: configSource.split('\n') };
}

const TWO_TESTS = `test "one" as sso\n  api GET /me\n  expect status equals 200\n  expect body.auth matches "^Bearer access-"\n\ntest "two" as sso\n  api GET /me\n  expect status equals 200\n`;

async function run(server: FixtureServer, source = TWO_TESTS) {
  const { config, configLines } = configFor(server.baseUrl);
  const { program } = parseSource(source);
  return runProgram(program, config, { source, browserManager, configLines });
}

test('PKCE pieces: a 43-character verifier, its S256 challenge, and an authorize URL carrying all of it', () => {
  const { verifier, challenge } = pkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  // RFC 7636 appendix B's own example pair.
  assert.equal(challengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  const url = new URL(authorizeUrlFor('http://id.example/authorize?tenant=a', { clientId: 'c', redirectUri: 'http://127.0.0.1:5/cb', challenge, state: 's', scope: 'read' }));
  assert.deepEqual(Object.fromEntries(url.searchParams), { tenant: 'a', response_type: 'code', client_id: 'c', redirect_uri: 'http://127.0.0.1:5/cb', code_challenge: challenge, code_challenge_method: 'S256', state: 's', scope: 'read' });
});

test('the listener binds port 0 to a real port, ignores other paths, and hands back the first code', async () => {
  const listener = await startRedirectListener('http://127.0.0.1:0/callback');
  try {
    const port = Number(new URL(listener.redirectUri).port);
    assert.ok(port > 0, listener.redirectUri);
    assert.equal((await fetch(`http://127.0.0.1:${port}/favicon.ico`)).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${port}/callback?code=c1&state=s1`)).status, 200);
    assert.deepEqual(await listener.arrival(1000), { kind: 'code', code: 'c1', state: 's1' });
  } finally {
    await listener.close();
  }
});

test('a code-flow session signs in through the browser, exchanges the code, and every test under it carries the bearer', async () => {
  const server = await authServer();
  try {
    const { report } = await run(server);
    assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
    // One sign-in, one exchange, shared by both tests (the session cache, not a second login).
    assert.deepEqual(server.grants, ['authorization_code']);
    assert.equal(server.redirects.length, 1);
    // Port 0 became a real port in the redirect the authorization server was sent.
    assert.match(server.redirects[0]!, /^http:\/\/127\.0\.0\.1:[1-9]\d*\/callback$/);
    const kinds = report.tests[0]!.kind === 'functional' ? report.tests[0]!.steps.map((s) => s.kind) : [];
    assert.deepEqual(kinds.slice(0, 6), ['open', 'fill', 'fill', 'click', 'redirect', 'api'], 'the session\'s own steps lead the owning test');
  } finally {
    await server.close();
  }
});

test('the code, the verifier and both tokens are masked everywhere the report can carry them', async () => {
  const server = await authServer();
  try {
    const { report } = await run(server);
    assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
    const text = JSON.stringify(report);
    for (const secret of [...server.codes, ...server.tokens, server.tokens[0]!.replace('access', 'refresh').replace(/-z+$/, '-yyyyyyyy')]) {
      assert.ok(!text.includes(secret), `${secret} is in the report`);
    }
    assert.match(text, /•••\(sso\.access_token\)/);
    assert.match(text, /•••\(sso\.code\)/);
    // The verifier is sent in the exchange's body, and that body is recorded — masked.
    assert.match(text, /code_verifier=•••\(sso\.code_verifier\)/);
  } finally {
    await server.close();
  }
});

test('a redirect whose state is not the one sent is refused, and no exchange is made', async () => {
  const server = await authServer({ forgeState: 'someone-elses-state' });
  try {
    const { report } = await run(server);
    assert.equal(report.ok, false);
    const t = report.tests[0]!;
    assert.ok(t.kind === 'functional' && /`state` is not the one tflw sent/.test(t.error ?? ''), JSON.stringify(t));
    assert.deepEqual(server.grants, []);
  } finally {
    await server.close();
  }
});

test('an `error=` redirect is reported with the server\'s own words', async () => {
  const server = await authServer({ deny: true });
  try {
    const { report } = await run(server);
    const t = report.tests[0]!;
    assert.ok(t.kind === 'functional' && /refused — access_denied: the user said no/.test(t.error ?? ''), JSON.stringify(t));
    assert.deepEqual(server.grants, []);
  } finally {
    await server.close();
  }
});

test('a verifier the code was not bound to is refused at the exchange, and the session fails', async () => {
  const server = await authServer({ wrongChallenge: true });
  try {
    const { report } = await run(server);
    assert.equal(report.ok, false);
    const t = report.tests[0]!;
    assert.ok(t.kind === 'functional' && /oauth2 code exchange failed: 400/.test(t.error ?? ''), JSON.stringify(t));
    // One exchange per test: a failed establishment is not cached (decision 54), so the second test
    // signs in and is refused again rather than inheriting the first test's failure.
    assert.deepEqual(server.grants, ['authorization_code', 'authorization_code']);
  } finally {
    await server.close();
  }
});

test('an expired token is renewed with the refresh grant, not a second browser sign-in', async () => {
  // `expires_in: 1` makes the cached outcome stale after 500 ms (the early margin is half the TTL).
  const server = await authServer({ expiresIn: 1 });
  try {
    const source = `test "one" as sso\n  api GET /me\n  expect status equals 200\n  pause 700ms\n\ntest "two" as sso\n  api GET /me\n  expect body.auth equals "Bearer access-2-zzzzzzzz"\n`;
    const { report } = await run(server, source);
    assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
    assert.deepEqual(server.grants, ['authorization_code', 'refresh_token']);
    assert.equal(server.redirects.length, 1, 'one browser sign-in for the whole run');
  } finally {
    await server.close();
  }
});
