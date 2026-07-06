// M2: per-step `timeout <dur>` and `without redirects` (SPEC §5.1, §5.3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig } from './support.js';

test('per-step timeout fails the request when the server is slower', async () => {
  const server = await startFixtureServer({
    '/slow': (_req, res) => {
      setTimeout(() => res.writeHead(200).end('too late'), 400);
    },
  });

  const source = `test "impatient"
  api GET /slow timeout 100ms
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /timed out after 100ms/);

  await server.close();
});

test('`without redirects` observes the 3xx itself instead of following it', async () => {
  const server = await startFixtureServer({
    '/old-path': (_req, res) => {
      res.writeHead(302, { location: '/new-path' }).end();
    },
  });

  const source = `test "sees the redirect"
  api GET /old-path without redirects
  expect status equals 302
  expect header "location" equals "/new-path"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  await server.close();
});

test('redirects are followed by default', async () => {
  const server = await startFixtureServer({
    '/old-path': (_req, res) => {
      res.writeHead(302, { location: '/new-path' }).end();
    },
    '/new-path': (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"landed":true}');
    },
  });

  const source = `test "follows the redirect"
  api GET /old-path
  expect status equals 200
  expect body.landed equals true
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  await server.close();
});
