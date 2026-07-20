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
