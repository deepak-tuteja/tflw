// `insecure true` (decision 78) — the corporate-QA escape hatch for self-signed/private-CA staging
// certs. Real end-to-end coverage against a real self-signed `node:https` server (no mocking):
// (1) the default (`insecure` unset) fails with a teaching hint, not an opaque `fetch failed`;
// (2) `insecure true` in the resolved config makes the identical request succeed;
// (3) the global `NODE_TLS_REJECT_UNAUTHORIZED` toggle is always restored once the run finishes,
// so an insecure run can never silently leak into an unrelated later test in this same process.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { testConfig } from './support.js';

let server: Server;
let baseUrl: string;
let certDir: string;

before(async () => {
  certDir = mkdtempSync(join(tmpdir(), 'tflw-insecure-tls-'));
  const keyPath = join(certDir, 'key.pem');
  const certPath = join(certDir, 'cert.pem');
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-keyout', keyPath, '-out', certPath, '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1'],
    { stdio: 'ignore' },
  );

  server = createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  baseUrl = `https://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  rmSync(certDir, { recursive: true, force: true });
});

const SOURCE = `test "health check"\n  api GET /health\n  expect status equals 200\n`;

test('a self-signed cert fails with a teaching hint by default, not a bare "fetch failed"', async () => {
  const { program } = parseSource(SOURCE);
  const { report } = await runProgram(program, testConfig(baseUrl), { source: SOURCE });

  assert.equal(report.ok, false);
  assert.equal(report.insecure, false);
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /self-signed or private-CA certificate/);
  assert.match(error, /insecure true/);
  assert.match(error, /NODE_EXTRA_CA_CERTS/);
});

test('`insecure true` makes the identical request succeed against the same self-signed cert', async () => {
  const { program } = parseSource(SOURCE);
  const { report } = await runProgram(program, testConfig(baseUrl, {}, true), { source: SOURCE });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  assert.equal(report.insecure, true, 'the report must say so, visibly, whenever insecure was active (decision 78)');
});

test('NODE_TLS_REJECT_UNAUTHORIZED is restored to its prior value once an insecure run finishes', async () => {
  const before_ = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  const { program } = parseSource(SOURCE);
  await runProgram(program, testConfig(baseUrl, {}, true), { source: SOURCE });
  assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, before_, 'an insecure run must never leak into whichever test runs next in this process');
});
