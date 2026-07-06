// M2: all four request-body forms + raw text, verified against a real loopback server (SPEC §5.2).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('inline, file, form, upload, and text bodies all reach the server correctly encoded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-body-'));
  await writeFile(join(dir, 'order.json'), '{"name": "{name}", "qty": {qty}}');
  await writeFile(join(dir, 'img.png'), 'fake-png-bytes');

  const server = await startFixtureServer({
    '/inline': (_req, res) => json(res, 201, { ok: true }),
    '/file': (_req, res) => json(res, 201, { ok: true }),
    '/login': (_req, res) => json(res, 200, { ok: true }),
    '/uploads': (_req, res) => json(res, 201, { ok: true }),
    '/webhooks': (_req, res) => res.writeHead(202).end('ack'),
  });

  const source = `test "every body form"
  api POST /inline body { name: "Widget", qty: 3 }
  expect status equals 201
  let name = "Gadget"
  let qty = 7
  api POST /file body from "./order.json"
  expect status equals 201
  api POST /login form user="admin", pass="secret"
  expect status equals 200
  api POST /uploads upload "./img.png" as "avatar" form owner="bob"
  expect status equals 201
  api POST /webhooks body text "plain payload"
  expect status equals 202
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  const inline = server.received.get('/inline')![0]!;
  assert.equal(inline.headers['content-type'], 'application/json');
  assert.equal(inline.body, '{"name":"Widget","qty":3}');

  const file = server.received.get('/file')![0]!;
  assert.equal(file.headers['content-type'], 'application/json');
  assert.equal(file.body, '{"name": "Gadget", "qty": 7}');

  const login = server.received.get('/login')![0]!;
  assert.equal(login.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(login.body, 'user=admin&pass=secret');

  const upload = server.received.get('/uploads')![0]!;
  assert.match(String(upload.headers['content-type']), /^multipart\/form-data; boundary=/);
  assert.match(upload.body, /name="avatar"/);
  assert.match(upload.body, /filename="img\.png"/);
  assert.match(upload.body, /fake-png-bytes/);
  assert.match(upload.body, /name="owner"/);
  assert.match(upload.body, /bob/);

  const webhook = server.received.get('/webhooks')![0]!;
  // `body text` sets no *JSON* content-type (SPEC §5.2) — fetch still defaults a plain-text one.
  assert.match(String(webhook.headers['content-type']), /^text\/plain/);
  assert.equal(webhook.body, 'plain payload');

  await server.close();
  await rm(dir, { recursive: true, force: true });
});

test('a hand-formatted multi-line inline body sends the same JSON as its single-line equivalent (P#46)', async () => {
  const server = await startFixtureServer({ '/booking': (_req, res) => json(res, 200, { ok: true }) });

  const source = `test "multi-line body"
  api POST /booking body {
    firstname: "Jim",
    lastname: "Brown",
    bookingdates: {
      checkin: "2026-01-01",
      checkout: "2026-01-05"
    },
    tags: [
      "vip",
      "early-checkin"
    ]
  }
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const received = server.received.get('/booking')![0]!;
  assert.equal(
    received.body,
    JSON.stringify({
      firstname: 'Jim',
      lastname: 'Brown',
      bookingdates: { checkin: '2026-01-01', checkout: '2026-01-05' },
      tags: ['vip', 'early-checkin'],
    }),
  );

  await server.close();
});
