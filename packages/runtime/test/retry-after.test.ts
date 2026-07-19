// `retry honoring "Retry-After" up to N` (SPEC §5.1, PLAN decision 102b, enterprise arc cluster
// 3, closes TFLW-GAPS.md gap #5) — re-issues *this one request*, not the whole test. Real fixture
// server (no mocking): a per-path attempt counter drives a 429-then-200 sequence, exactly like a
// real rate-limited endpoint.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('a seconds-format Retry-After is honored, and the retried request succeeds', async () => {
  let attempts = 0;
  const server = await startFixtureServer({
    '/limited': (_req, res) => {
      attempts++;
      if (attempts === 1) {
        res.setHeader('Retry-After', '1');
        json(res, 429, { detail: 'slow down' });
        return;
      }
      json(res, 200, { ok: true });
    },
  });
  const config = testConfig(server.baseUrl);
  const source = `test "rate limited then succeeds"
  api POST /limited
    retry honoring "Retry-After" up to 3
  expect status equals 200
`;
  const { program } = parseSource(source);
  const start = Date.now();
  const { report } = await runProgram(program, config, { source });
  const elapsed = Date.now() - start;

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(attempts, 2);
  assert.ok(elapsed >= 1000, `expected the runtime to actually sleep ~1s, only took ${elapsed}ms`);
  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.match(apiStep.detail!, /retried 1x honoring Retry-After \(waited 1000ms total\)/);

  await server.close();
});

test('an HTTP-date-format Retry-After is honored too', async () => {
  let attempts = 0;
  const server = await startFixtureServer({
    '/limited-date': (_req, res) => {
      attempts++;
      if (attempts === 1) {
        res.setHeader('Retry-After', new Date(Date.now() + 800).toUTCString());
        json(res, 429, { detail: 'slow down' });
        return;
      }
      json(res, 200, { ok: true });
    },
  });
  const config = testConfig(server.baseUrl);
  const source = `test "rate limited via HTTP-date then succeeds"
  api POST /limited-date
    retry honoring "Retry-After" up to 3
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(attempts, 2);

  await server.close();
});

test('max attempts exhausted still fails cleanly, not an infinite loop', async () => {
  const server = await startFixtureServer({
    '/always-limited': (_req, res) => {
      res.setHeader('Retry-After', '0');
      json(res, 429, { detail: 'never recovers' });
    },
  });
  const config = testConfig(server.baseUrl);
  const source = `test "rate limit never lifts"
  api POST /always-limited
    retry honoring "Retry-After" up to 2
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, false);
  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.match(apiStep.detail!, /retried 2x honoring Retry-After/);
  assert.equal(report.tests[0]!.steps.find((s) => s.kind === 'expect')!.ok, false);

  await server.close();
});

test('no `retry honoring` clause — today\'s unchanged single-attempt behavior', async () => {
  let attempts = 0;
  const server = await startFixtureServer({
    '/limited-plain': (_req, res) => {
      attempts++;
      res.setHeader('Retry-After', '1');
      json(res, 429, { detail: 'slow down' });
    },
  });
  const config = testConfig(server.baseUrl);
  const source = `test "no retry clause, single attempt"
  api POST /limited-plain
  expect status equals 429
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, config, { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(attempts, 1);
  const apiStep = report.tests[0]!.steps.find((s) => s.kind === 'api')!;
  assert.doesNotMatch(apiStep.detail!, /retried/);

  await server.close();
});
