// `cert`/`key` per-env mTLS client certificate config (SPEC §3.5, decision 3b, enterprise arc).
// Real end-to-end coverage against a real `node:https` server that requires + verifies a client
// certificate (no mocking) — a tiny local CA signs both the server's and the client's certs so the
// whole handshake is exercised exactly as it runs against a real mTLS-gated API.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:https';
import type { TLSSocket } from 'node:tls';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource, parseConfigSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { sendRequest } from '../src/http.js';
import { resolveConfig, selectEnv } from '../src/resolve.js';
import { testConfig } from './support.js';

let server: Server;
let baseUrl: string;
let certDir: string;
let clientCertPath: string;
let clientKeyPath: string;

function openssl(args: string[]): void {
  execFileSync('openssl', args, { stdio: 'ignore' });
}

before(async () => {
  certDir = mkdtempSync(join(tmpdir(), 'tflw-mtls-'));
  const caKey = join(certDir, 'ca-key.pem');
  const caCert = join(certDir, 'ca-cert.pem');
  const serverKey = join(certDir, 'server-key.pem');
  const serverCert = join(certDir, 'server-cert.pem');
  const serverCsr = join(certDir, 'server.csr');
  clientKeyPath = join(certDir, 'client-key.pem');
  clientCertPath = join(certDir, 'client-cert.pem');
  const clientCsr = join(certDir, 'client.csr');

  // A tiny local CA so the server can require + verify a client cert without a public CA. The
  // server cert needs a real `subjectAltName` (not just a CN) — Node's TLS hostname check rejects
  // CN-only certs outright, so `-copy_extensions copy` carries the CSR's SAN into the signed cert.
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-keyout', caKey, '-out', caCert, '-days', '1', '-nodes', '-subj', '/CN=tflw-test-ca']);
  openssl(['req', '-newkey', 'rsa:2048', '-keyout', serverKey, '-out', serverCsr, '-nodes', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1']);
  openssl(['x509', '-req', '-in', serverCsr, '-CA', caCert, '-CAkey', caKey, '-CAcreateserial', '-out', serverCert, '-days', '1', '-copy_extensions', 'copy']);
  openssl(['req', '-newkey', 'rsa:2048', '-keyout', clientKeyPath, '-out', clientCsr, '-nodes', '-subj', '/CN=tflw-test-client']);
  openssl(['x509', '-req', '-in', clientCsr, '-CA', caCert, '-CAkey', caKey, '-CAcreateserial', '-out', clientCertPath, '-days', '1']);

  server = createServer(
    { key: readFileSync(serverKey), cert: readFileSync(serverCert), ca: readFileSync(caCert), requestCert: true, rejectUnauthorized: true },
    (req, res) => {
      // M85 (review cluster C1 / `B4-02`): one route that hands the client to a host no allowlist
      // here names, so the mTLS worker's own redirect loop can be shown refusing a hop. `.invalid`
      // is reserved by RFC 2606 and never resolves — which costs nothing, because a refused hop is
      // refused before any resolution is attempted.
      if (req.url === '/redirect-to-unlisted') {
        res.writeHead(302, { location: 'https://unlisted.invalid/landing' }).end();
        return;
      }
      // M88a (review cluster C2 / `B4-09`): a chain that never lands, so the worker's *own* two
      // branches — native `redirect: 'follow'` and the hand-walked loop `allow hosts` selects —
      // can be shown reaching the same verdict. It stayed an allowed host on purpose; this is
      // about the cap, not the allowlist.
      if (req.url === '/loop') {
        res.writeHead(302, { location: '/loop' }).end();
        return;
      }
      // M88c1 (review cluster C2 / `B4-15`): the login-by-302 — the hop that hands over the cookie
      // is not the hop that answers. The worker is the fourth client path and the one hardest to
      // reach from a test (a child process, behind a real TLS handshake), which is precisely why it
      // is the one that would have been left behind.
      if (req.url === '/login') {
        res.writeHead(302, { location: '/dashboard', 'set-cookie': ['sid=mtls-session; Path=/', 'csrf=mtls-token'] }).end();
        return;
      }
      const peerCert = (req.socket as TLSSocket).getPeerCertificate();
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ clientCn: peerCert.subject?.CN ?? null }));
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  baseUrl = `https://127.0.0.1:${address.port}`;

  // The client also needs to trust the test CA to verify the *server's* cert — the documented
  // `NODE_EXTRA_CA_CERTS` pattern for a private CA (SPEC §3.5), orthogonal to mTLS itself (which
  // is only about the client presenting its own cert).
  process.env.NODE_EXTRA_CA_CERTS = caCert;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  delete process.env.NODE_EXTRA_CA_CERTS;
  rmSync(certDir, { recursive: true, force: true });
});

test('a `cert`/`key` config presents a client certificate the server requires and verifies', async () => {
  const config = { ...testConfig(baseUrl), mtls: { certPath: clientCertPath, keyPath: clientKeyPath } };
  const source = `test "health check"\n  api GET /health\n  expect status equals 200\n  expect body.clientCn equals "tflw-test-client"\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
});

test('without `cert`/`key`, a server that requires a client cert rejects the connection', async () => {
  // `insecure true` isolates this test to *only* the missing-client-cert failure — otherwise the
  // plain (non-mTLS) `fetch` path would fail first on not trusting the test server's own cert,
  // for an unrelated reason (it doesn't dynamically re-read `NODE_EXTRA_CA_CERTS` the way the new
  // mTLS path does, see `mtlsConnectOptions` in http.ts).
  const config = testConfig(baseUrl, {}, true); // insecure: true, mtls: null
  const source = `test "health check"\n  api GET /health\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /request failed/);
});

test('with `expect request fails`, the exact same missing-client-cert scenario now passes green (decision 18)', async () => {
  // The whole point of decision 18: the previous test proves this scenario crashes the run
  // unconditionally today; this one proves the new assertion turns it into a genuinely passing
  // regression test instead — same server, same missing cert, same real TLS rejection.
  const config = testConfig(baseUrl, {}, true); // insecure: true, mtls: null
  const source = `test "health check"\n  api GET /health\n  expect request fails\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
});

test('`expect request connects` correctly fails when the connection was actually rejected', async () => {
  const config = testConfig(baseUrl, {}, true); // insecure: true, mtls: null
  const source = `test "health check"\n  api GET /health\n  expect request connects\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /expected request to connect, but got:/);
});

test('`expect request connects` passes for a real successful request against the same server, with a valid client cert', async () => {
  const config = { ...testConfig(baseUrl), mtls: { certPath: clientCertPath, keyPath: clientKeyPath } };
  const source = `test "health check"\n  api GET /health\n  expect request connects\n  check request not fails\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
});

test('the `api` step itself still reports `ok: true` when it caught a connection failure — the `expect` step is what judges it', async () => {
  const config = testConfig(baseUrl, {}, true); // insecure: true, mtls: null
  const source = `test "health check"\n  api GET /health\n  expect request fails\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.equal(apiStep.ok, true);
  assert.match(apiStep.detail, /connection failed/);
});

test('the same client cert is reused across requests, not re-read from disk every time', async () => {
  const config = { ...testConfig(baseUrl), mtls: { certPath: clientCertPath, keyPath: clientKeyPath } };
  const source = `test "first"\n  api GET /health\n  expect status equals 200\n\ntest "second"\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(report.tests.length, 2);
});

// M85 (review cluster C1 / `B4-02`) — the third client path. `allow hosts` is enforced in the
// forked worker, not the parent, because the parent has no seam between hops here either; the
// refusal then has to survive the IPC error channel, which re-frames what it carries as a
// transport failure for every *other* error it forwards.
test('the mTLS worker refuses a redirect hop to an unlisted host, and says why across the process boundary', async () => {
  const config = { ...testConfig(baseUrl), mtls: { certPath: clientCertPath, keyPath: clientKeyPath }, allowHosts: ['127.0.0.1'] };
  const source = `test "redirected away"\n  api GET /redirect-to-unlisted\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /redirected to "https:\/\/unlisted\.invalid\/landing"/);
  assert.match(error, /host "unlisted\.invalid" is not in `allow hosts` \(127\.0\.0\.1\)/);
  assert.doesNotMatch(error, /request failed/, 'a refusal is the finished sentence, not a transport failure to re-frame');
});

// M88a (review cluster C2 / `B4-09`, `B4-14`) — the third client, and the one with two internal
// redirect implementations of its own. Before M88a the hand-walked branch `break`ed at the cap and
// reported the last 3xx as a response, so this exact program passed under `allow hosts` and failed
// without it. The assertion is the *pair*: same program, same server, one config key apart.
test('an endless redirect chain fails on the mTLS path too, identically with and without `allow hosts`', async () => {
  const base = { ...testConfig(baseUrl), mtls: { certPath: clientCertPath, keyPath: clientKeyPath } };
  const source = `test "follows a redirect loop"\n  api GET /loop\n  expect status equals 302\n`;
  const { program } = parseSource(source);

  const unguarded = await runProgram(program, base, { source });
  const guarded = await runProgram(program, { ...base, allowHosts: ['127.0.0.1'] }, { source });

  assert.equal(unguarded.report.ok, false, JSON.stringify(unguarded.report.tests, null, 2));
  assert.equal(guarded.report.ok, unguarded.report.ok, '`allow hosts` must not flip a verdict');
  assert.equal(guarded.report.tests[0]!.error, unguarded.report.tests[0]!.error);
  assert.match(unguarded.report.tests[0]!.error ?? '', /too many redirects/);
  // The cap crosses the IPC boundary as its own finished sentence, the way a refusal does — not
  // re-framed as the transport failure the worker's error channel formats everything else into.
  assert.doesNotMatch(unguarded.report.tests[0]!.error ?? '', /request failed/);
});

test('an allowed host on the mTLS path is unaffected by declaring `allow hosts`', async () => {
  const config = { ...testConfig(baseUrl), mtls: { certPath: clientCertPath, keyPath: clientKeyPath }, allowHosts: ['127.0.0.1'] };
  const source = `test "health check"\n  api GET /health\n  expect status equals 200\n  expect body.clientCn equals "tflw-test-client"\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
});

// M88c1 (review cluster C2 / `B4-15`) — the fourth client path reports an intermediate hop's
// cookies too. Called through `sendRequest` rather than a `.tflw` program on purpose: `cookieEvents`
// is deliberately stripped from the report copy (it is raw `Set-Cookie`), so a program-level
// assertion could only ever confirm that stripping, never that the worker collected anything.
test('the mTLS worker reports a cookie set on an intermediate redirect hop', async () => {
  const mtls = { cert: readFileSync(clientCertPath, 'utf8'), key: readFileSync(clientKeyPath, 'utf8') };
  const opts = { method: 'GET', url: `${baseUrl}/login`, headers: {}, timeoutMs: 5000, followRedirects: true, mtls } as const;

  const res = await sendRequest(opts);

  assert.equal(res.status, 200, res.bodyText);
  assert.equal(res.headers['set-cookie'], undefined, 'sanity: the landing response sets nothing');
  assert.deepEqual(res.cookieEvents, [{ origin: baseUrl, setCookie: ['sid=mtls-session; Path=/', 'csrf=mtls-token'] }]);
  assert.equal(res.finalUrl, `${baseUrl}/dashboard`);

  // And `allow hosts` — which until M88c1 decided whether this path walked its own chain at all —
  // makes no difference to any of it (`B4-14`'s shape, third path).
  const guarded = await sendRequest({ ...opts, allowHosts: ['127.0.0.1'] });
  assert.deepEqual(guarded.cookieEvents, res.cookieEvents);
});

test('`cert` without a matching `key` is rejected once `defaults`+`env` are merged (decision 3b)', () => {
  const configSource = `env staging\n  api "https://staging.example.com"\n  cert "./certs/client.pem"\n`;
  const parsed = parseConfigSource(configSource);
  assert.deepEqual(parsed.diagnostics, []);
  const env = selectEnv(parsed.config, {});
  assert.throws(() => resolveConfig(parsed.config, env), /`cert` and `key` must be set together/);
});

test('`key` without a matching `cert` is rejected too', () => {
  const configSource = `env staging\n  api "https://staging.example.com"\n  key "./certs/client.key"\n`;
  const parsed = parseConfigSource(configSource);
  assert.deepEqual(parsed.diagnostics, []);
  const env = selectEnv(parsed.config, {});
  assert.throws(() => resolveConfig(parsed.config, env), /`cert` and `key` must be set together/);
});

test('a `cert` in `defaults` paired with `key` only in one `env` still resolves correctly (merge, not per-block pairing)', () => {
  const configSource = `defaults\n  cert "${clientCertPath}"\n\nenv staging default\n  api "${baseUrl}"\n  key "${clientKeyPath}"\n`;
  const parsed = parseConfigSource(configSource);
  assert.deepEqual(parsed.diagnostics, []);
  const env = selectEnv(parsed.config, {});
  const config = resolveConfig(parsed.config, env);
  assert.deepEqual(config.mtls, { certPath: clientCertPath, keyPath: clientKeyPath });
});
