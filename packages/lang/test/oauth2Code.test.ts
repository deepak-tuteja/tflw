// `M248` (`D1354`) — `session <name> oauth2 code`: the declaration, and the checker's two rules about
// it — the sign-in holds browser steps only (`TF093`), and the redirect is a loopback `http` URL
// (`TF094`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigSource, checkCodeFlowSessions, loopbackRedirectRefusal, Codes } from '../src/index.js';

const HEAD = 'session sso oauth2 code\n  authorize url "http://localhost:4001/oauth/authorize"\n  token url "/oauth/token"\n  client id "storefront-cli"\n';
const REDIRECT = '  redirect "http://127.0.0.1:0/callback"\n';
const SIGN_IN = '  fill field "Email" with "ada@example.com"\n  click button "Allow"\n';

const check = (src: string): { codes: string[]; messages: string[] } => {
  const parsed = parseConfigSource(src);
  const diags = [...parsed.diagnostics, ...checkCodeFlowSessions(parsed.config)];
  return { codes: diags.map((d) => d.code), messages: diags.map((d) => d.message) };
};

test('the config lines and the sign-in parse into one session, in any order, with `privileged` read last', () => {
  const src = 'session sso oauth2 code privileged\n  click button "Next"\n  client secret env(SSO_SECRET)\n  authorize url "http://localhost:4001/oauth/authorize"\n  scope "orders:read"\n  token url "/oauth/token"\n' + REDIRECT + '  client id "storefront-cli"\n' + SIGN_IN;
  const { config, diagnostics } = parseConfigSource(src);
  assert.deepEqual(diagnostics, []);
  const session = config.sessions[0]!;
  assert.equal(session.privileged, true);
  assert.equal(session.oauth2, null, 'the client-credentials field stays empty — the two kinds are different grants');
  assert.deepEqual(session.body.map((s) => s.type), ['ClickStmt', 'FillStmt', 'ClickStmt']);
  const code = session.oauth2Code!;
  assert.equal(code.clientSecret?.type, 'EnvRef');
  assert.equal(code.scope?.type, 'StringLit');
  assert.equal(code.redirect?.type, 'StringLit');
  assert.deepEqual(check(src).codes, []);
});

test('a public client needs no secret; the three lines it cannot do without are named when missing', () => {
  assert.deepEqual(check(HEAD + REDIRECT + SIGN_IN).codes, []);
  const { codes, messages } = check('session sso oauth2 code\n  token url "/t"\n' + SIGN_IN);
  assert.deepEqual(codes, [Codes.CONFIG_UNEXPECTED]);
  assert.match(messages[0]!, /needs `authorize url` and `client id`/);
});

test('a plain `session … oauth2` is still the client-credentials grant', () => {
  const { config, diagnostics } = parseConfigSource('session svc oauth2\n  token url "/t"\n  client id "c"\n  client secret "s"\n');
  assert.deepEqual(diagnostics, []);
  assert.equal(config.sessions[0]!.oauth2Code, undefined);
  assert.equal(config.sessions[0]!.oauth2?.type, 'Oauth2SessionConfig');
});

test('TF093: a request of its own in the sign-in — `api`, `wait until api`, `capture` — each once', () => {
  const src = HEAD + REDIRECT + '  api POST /login\n  capture body.token as t\n  wait until api GET /ready\n    expect status equals 200\n' + SIGN_IN;
  const { codes, messages } = check(src);
  assert.deepEqual(codes, [Codes.OAUTH2_CODE_NON_BROWSER_STEP, Codes.OAUTH2_CODE_NON_BROWSER_STEP, Codes.OAUTH2_CODE_NON_BROWSER_STEP]);
  assert.match(messages[0]!, /^an `api` step in the sign-in of `session sso oauth2 code`/);
  assert.match(messages[1]!, /^a `capture` in the sign-in/);
  assert.match(messages[2]!, /^a `wait until api` in the sign-in/);
});

test('TF094: no redirect, a remote host, `https` — and an `env(…)` redirect is left to the run', () => {
  assert.match(check(HEAD + SIGN_IN).messages[0]!, /has no `redirect`/);
  assert.deepEqual(check(HEAD + '  redirect "http://app.example.com/cb"\n' + SIGN_IN).codes, [Codes.OAUTH2_CODE_REDIRECT]);
  assert.match(check(HEAD + '  redirect "https://127.0.0.1:0/cb"\n' + SIGN_IN).messages[0]!, /a loopback listener speaks plain `http`/);
  assert.deepEqual(check(HEAD + '  redirect env(SSO_REDIRECT)\n' + SIGN_IN).codes, []);
});

test('the loopback rule: 127.0.0.1, localhost and [::1] over http, and nothing else', () => {
  for (const ok of ['http://127.0.0.1:0/cb', 'http://localhost:8765/', 'http://[::1]:9/x']) assert.equal(loopbackRedirectRefusal(ok), null, ok);
  assert.match(loopbackRedirectRefusal('http://127.0.0.2/cb')!, /not this machine/);
  assert.match(loopbackRedirectRefusal('not a url')!, /not a URL/);
  assert.match(loopbackRedirectRefusal('https://localhost/cb')!, /plain `http`/);
});
