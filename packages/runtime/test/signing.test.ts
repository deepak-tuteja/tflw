// `M246` — signed requests (`D1344`–`D1349`).
//
// Two kinds of evidence. Known answers pin the arithmetic against values the providers publish, so
// a test cannot agree with an implementation that is merely self-consistent. The end-to-end half
// runs real requests at a fixture server that verifies the signature the way a receiver does — over
// the raw bytes it received — so "signed the bytes it sent" is observed from the far side of the
// socket, not asserted from inside the sender.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseSource, parseConfigSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { signRequest, sigv4Parts, sigv4SigningKey, hmacMessage, uriEncode, canonicalQuery, type HmacSigner, type Sigv4Signer } from '../src/signing.js';
import { startFixtureServer, testConfig, json } from './support.js';
import { asEntry } from './__helpers__/entry.js';
import type { ResolvedConfig } from '../src/types.js';

// ---- known answers ------------------------------------------------------------------------------

test('HMAC: GitHub\'s published webhook example signs to its published digest', () => {
  // docs.github.com, "Validating webhook deliveries": secret "It's a Secret to Everybody", payload
  // "Hello, World!", `X-Hub-Signature-256: sha256=757107ea…`.
  const signer: HmacSigner = { kind: 'hmac', algorithm: 'sha256', encoding: 'hex', secret: "It's a Secret to Everybody", signs: '{body}', headers: [{ name: 'X-Hub-Signature-256', value: 'sha256={signature}' }] };
  const out = signRequest(signer, { method: 'POST', url: 'http://h/hook', headers: {}, body: Buffer.from('Hello, World!'), now: new Date(0) });
  assert.deepEqual(out, { 'X-Hub-Signature-256': 'sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17' });
});

test('SigV4: AWS\'s published IAM ListUsers example reproduces its signing key, canonical request and signature', () => {
  // docs.aws.amazon.com, "Signature Version 4 signing process" worked example: AKIDEXAMPLE,
  // us-east-1, iam, 20150830T123600Z.
  const signer: Sigv4Signer = { kind: 'sigv4', region: 'us-east-1', service: 'iam', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', sessionToken: null };
  assert.equal(sigv4SigningKey(signer.secretAccessKey, '20150830', 'us-east-1', 'iam').toString('hex'), 'c4afb1cc5771d871763a393e44b703571b55cc28424d1a5e86da6ed3c154a4b9');
  const parts = sigv4Parts(signer, {
    method: 'GET',
    url: 'https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
    body: undefined,
    now: new Date('2015-08-30T12:36:00Z'),
  });
  assert.equal(
    parts.canonicalRequest,
    ['GET', '/', 'Action=ListUsers&Version=2010-05-08', 'content-type:application/x-www-form-urlencoded; charset=utf-8', 'host:iam.amazonaws.com', 'x-amz-date:20150830T123600Z', '', 'content-type;host;x-amz-date', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'].join('\n'),
  );
  assert.equal(parts.signature, '5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
  assert.equal(parts.headers.Authorization, 'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7');
});

test('SigV4: a session token is signed, S3 alone gets the content hash, and encoding is RFC 3986', () => {
  const base: Sigv4Signer = { kind: 'sigv4', region: 'eu-west-1', service: 'execute-api', accessKeyId: 'AKID', secretAccessKey: 'secret', sessionToken: 'tok' };
  const req = { method: 'PUT', url: 'https://x.example/a b/c?b=2&a=1&a=0', headers: {}, body: Buffer.from('{}'), now: new Date('2026-09-27T10:00:00Z') };
  const api = sigv4Parts(base, req);
  assert.match(api.canonicalRequest, /\nx-amz-security-token:tok\n/);
  assert.ok(!('x-amz-content-sha256' in api.headers), 'only S3 is sent the payload hash header');
  assert.match(api.canonicalRequest, /^PUT\n\/a%2520b\/c\n/, 'a non-S3 path segment is encoded a second time');
  const s3 = sigv4Parts({ ...base, service: 's3' }, req);
  assert.equal(s3.headers['x-amz-content-sha256'], '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  assert.match(s3.canonicalRequest, /^PUT\n\/a%20b\/c\n/, 'S3 signs the path as sent');
  assert.equal(canonicalQuery(new URL(req.url)), 'a=0&a=1&b=2');
  assert.equal(uriEncode("a!'()*~"), 'a%21%27%28%29%2A~');
});

test('HMAC templates splice the raw body bytes and fill every placeholder as sent', () => {
  const body = Buffer.from([0x7b, 0xff, 0x00, 0x7d]);
  const msg = hmacMessage('{method} {path}?{query} {timestamp}.{body}|{body sha256}', { method: 'post', url: 'http://h/p/q?x=1', headers: {}, body, now: new Date(1_700_000_000_500) });
  const head = Buffer.from('POST /p/q?x=1 1700000000.');
  assert.deepEqual(msg.subarray(0, head.length), head);
  assert.deepEqual(msg.subarray(head.length, head.length + 4), body, 'the bytes are the bytes, not a text round-trip');
  assert.match(msg.subarray(head.length + 4).toString(), /^\|[0-9a-f]{64}$/);
});

// ---- end to end -------------------------------------------------------------------------------

const SECRET = 'whsec-test-7d1f-not-in-any-report';
const NOW = '2026-09-27T12:00:00.000Z';

const CONFIG = `env other
  api "http://127.0.0.1:9"
signer stripe hmac sha256 hex secret env(STRIPE_SECRET)
  signs "{timestamp}.{body}"
  header "Stripe-Signature" is "t={timestamp},v1={signature}"
signer later for env other hmac sha256 hex secret env(STRIPE_SECRET)
  signs "{body}"
  header "X-Sig" is "{signature}"
session partner signed with stripe
  header "X-Partner" is "p1"
`;

function configFor(baseUrl: string): ResolvedConfig {
  const { config, diagnostics } = parseConfigSource(CONFIG);
  assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), [], 'the fixture config is clean');
  const inEnv = (config.signers ?? []).filter((s) => s.envs === null);
  return {
    ...testConfig(baseUrl),
    signers: new Map(inEnv.map((s) => [s.name, s] as const)),
    signersOutOfScope: new Map([['later', ['other']]]),
    sessions: new Map(config.sessions.map((s) => [s.name, s] as const)),
  };
}

/** A receiver in Stripe's shape: `t=<unix>,v1=<hex hmac of "t.body">`, over the raw bytes received. */
function verifies(req: IncomingMessage, body: string): { ok: boolean; t: number } {
  const header = String(req.headers['stripe-signature'] ?? '');
  const t = /t=(\d+)/.exec(header)?.[1];
  const v1 = /v1=([0-9a-f]+)/.exec(header)?.[1];
  if (!t || !v1) return { ok: false, t: 0 };
  const expected = createHmac('sha256', SECRET).update(Buffer.concat([Buffer.from(`${t}.`), Buffer.from(body, 'latin1')])).digest('hex');
  return { ok: expected === v1, t: Number(t) };
}

const verifying = (_req: IncomingMessage, res: ServerResponse, body: string): void => {
  const v = verifies(_req, body);
  json(res, v.ok ? 200 : 401, { verified: v.ok, t: v.t });
};

async function run(source: string, baseUrl: string, baseDir?: string) {
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), [], 'the test source parses');
  return runProgram(program, configFor(baseUrl), { source, now: NOW, environ: { ...process.env, STRIPE_SECRET: SECRET }, ...(baseDir ? { baseDir } : {}) });
}

test('a `sign with` request verifies at the receiver, stamped with the run clock', async () => {
  const server = await startFixtureServer({ '/hook': verifying });
  try {
    const { report } = await run('test "signed"\n  api POST /hook body { id: "evt_1", amount: 12.5 }\n    sign with stripe\n  expect status equals 200\n', server.baseUrl);
    assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
    const got = server.received.get('/hook')![0]!;
    const t = Number(/t=(\d+)/.exec(String(got.headers['stripe-signature']))![1]);
    // `--now` pins the clock; the run's own elapsed time is added to it (`D1349`), which here is
    // well under a minute.
    assert.ok(t >= Date.parse(NOW) / 1000 && t < Date.parse(NOW) / 1000 + 60, `timestamp ${t} is the pinned clock`);
  } finally {
    await server.close();
  }
});

test('an unsigned request, the same body, is refused by the same receiver — the control', async () => {
  const server = await startFixtureServer({ '/hook': verifying });
  try {
    const { report } = await run('test "unsigned"\n  api POST /hook body { id: "evt_1" }\n  expect status equals 401\n', server.baseUrl);
    assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  } finally {
    await server.close();
  }
});

test('the overrides each fail verification for their own reason: wrong key, tampered body, stale clock', async () => {
  const server = await startFixtureServer({ '/hook': verifying });
  try {
    const { report } = await run(
      [
        'test "wrong key"',
        '  api POST /hook body { id: "evt_1" }',
        '    sign with stripe secret "not-the-secret"',
        '  expect status equals 401',
        'test "tampered"',
        '  api POST /hook body { amount: 100 }',
        '    sign with stripe then body { amount: 1 }',
        '  expect status equals 401',
        'test "stale"',
        '  api POST /hook body { id: "evt_1" }',
        '    sign with stripe at now - 10 minutes',
        '  expect status equals 200',
        // The receiver here has no tolerance, so the stale signature verifies; what the override
        // changed is the instant it carries — ten minutes before the request, not before the run.
        `  expect body.t is less than ${Date.parse(NOW) / 1000 - 590}`,
        '',
      ].join('\n'),
      server.baseUrl,
    );
    assert.equal(report.ok, true, JSON.stringify(report.tests.map((t) => asEntry(t, 'functional').error)));
    const [, tampered] = server.received.get('/hook')!;
    assert.equal(tampered!.body, '{"amount":1}', 'the tamper case sends the other body');
  } finally {
    await server.close();
  }
});

test('a multipart body is signed as the bytes that arrived, boundary and all', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-sign-'));
  await writeFile(join(dir, 'a.txt'), 'file-bytes-A');
  const server = await startFixtureServer({ '/hook': verifying });
  try {
    const { report } = await run('test "multipart"\n  api POST /hook upload "./a.txt" as "file" form note="x"\n    sign with stripe\n  expect status equals 200\n', server.baseUrl, dir);
    assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
    const got = server.received.get('/hook')![0]!;
    assert.match(String(got.headers['content-type']), /^multipart\/form-data; boundary=/);
    assert.ok(got.body.includes('file-bytes-A'));
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a session `signed with` signs every request of a test that opts in, and a step\'s own line wins', async () => {
  const server = await startFixtureServer({ '/hook': verifying });
  try {
    const { report } = await run(
      'test "partner" as partner\n  api POST /hook body { a: 1 }\n  expect status equals 200\n  api POST /hook body { a: 2 }\n    sign with stripe secret "wrong"\n  expect status equals 401\n',
      server.baseUrl,
    );
    assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
    assert.equal(server.received.get('/hook')![0]!.headers['x-partner'], 'p1', 'the session\'s own headers still apply');
  } finally {
    await server.close();
  }
});

test('a retry re-signs: each attempt carries its own timestamp', async () => {
  let calls = 0;
  const server = await startFixtureServer({
    '/hook': (req, res, body) => {
      calls++;
      if (calls === 1) {
        res.writeHead(429, { 'retry-after': '1' }).end();
        return;
      }
      verifying(req, res, body);
    },
  });
  try {
    const { report } = await run('test "retry"\n  api POST /hook body { a: 1 }\n    sign with stripe\n    retry honoring "Retry-After" up to 1\n  expect status equals 200\n', server.baseUrl);
    assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
    const [first, second] = server.received.get('/hook')!;
    const t = (h: IncomingMessage['headers']) => Number(/t=(\d+)/.exec(String(h['stripe-signature']))![1]);
    assert.ok(t(second!.headers) > t(first!.headers), `the second attempt was re-signed (${t(first!.headers)} → ${t(second!.headers)})`);
  } finally {
    await server.close();
  }
});

test('the secret appears in no part of the report, and the signature header does', async () => {
  const server = await startFixtureServer({ '/hook': verifying });
  try {
    const { report } = await run('test "leak"\n  api POST /hook body { id: "evt_1" }\n    sign with stripe\n  expect status equals 999\n', server.baseUrl);
    const text = JSON.stringify(report);
    assert.ok(!text.includes(SECRET), 'the signer\'s secret never reaches the report');
    assert.match(text, /Stripe-Signature/i, 'the signature header is shown, so a failed verification can be diagnosed');
  } finally {
    await server.close();
  }
});

test('a signer declared for another env fails the step naming the envs it is scoped to', async () => {
  const server = await startFixtureServer({ '/hook': verifying });
  try {
    const { report } = await run('test "scoped"\n  api POST /hook body {}\n    sign with later\n', server.baseUrl);
    assert.equal(report.ok, false);
    assert.match(String(asEntry(report.tests[0], 'functional').error ?? JSON.stringify(report.tests[0])), /declared `for env other`/);
    assert.equal(server.received.get('/hook'), undefined, 'nothing unsigned was sent in its place');
  } finally {
    await server.close();
  }
});
