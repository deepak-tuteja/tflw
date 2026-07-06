// Node's global `fetch` collapses every network failure into a bare `TypeError: fetch failed`
// (decision 78) — `fetchErrorHint` unwraps `err.cause.code` into a named hint. The TLS/self-signed
// branch already gets real end-to-end coverage (`insecure-tls.test.ts`, a real self-signed
// `node:https` server); ECONNREFUSED gets one here too (a real closed local port, deterministic —
// no network/DNS dependency). ENOTFOUND is exercised as a synthetic-error unit test instead of a
// live DNS lookup, which would be flaky in a sandboxed/offline CI runner.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { fetchErrorHint } from '../src/http.js';
import { testConfig } from './support.js';

/** An ephemeral port that is guaranteed closed right now: bind it, note the port, close it
 * immediately — the OS won't hand it back out mid-test, so a connection to it is a real, immediate
 * ECONNREFUSED with no network egress or DNS involved (unlike well-known ports, which `fetch`
 * itself forbids for a handful of low numbers, e.g. port 1). */
async function closedLocalPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected a TCP address');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  return port;
}

test('a connection refused (closed local port) gets a named hint, not a bare "fetch failed"', async () => {
  const port = await closedLocalPort();
  const source = `test "x"\n  api GET /health\n  expect status equals 200\n`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(`http://127.0.0.1:${port}`), { source });

  assert.equal(report.ok, false);
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /connection refused/);
  assert.match(error, /listening at that host:port/);
});

test('fetchErrorHint names a DNS failure (ENOTFOUND)', () => {
  const err = new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
  assert.match(fetchErrorHint(err), /DNS lookup failed/);
});

test('fetchErrorHint returns nothing for an unrecognised cause code', () => {
  const err = new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
  assert.equal(fetchErrorHint(err), '');
});

test('fetchErrorHint returns nothing when there is no cause at all', () => {
  assert.equal(fetchErrorHint(new Error('boom')), '');
});
