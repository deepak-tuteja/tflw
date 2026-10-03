// `M249` `D` (`D1370`) — `tflw doctor`: what a project will run with, read offline, failing only for
// the things that stop every run (three until `M266` added an unset required secret).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { diagnose, renderDoctor } from '../src/doctor.js';

const CONFIG = [
  'env local default',
  '  api "http://localhost:4001/v1"',
  '  api inventory "http://localhost:4002"',
  '',
  'env secure',
  '  api "https://localhost:8443/v1"',
  '  insecure true',
  '  cert "./certs/client.crt"',
  '  key "./certs/client.key"',
  '',
].join('\n');

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-doctor-'));
  for (const [name, body] of Object.entries(files)) {
    if (name.includes('/')) await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), body);
  }
  return dir;
}

test('a healthy API-only project: its env, its services, the suite, and no problem', async () => {
  const dir = await project({ 'tflw.config': CONFIG, 'a.tflw': 'test "t"\n  api GET /health\n  expect status equals 200\n' });
  try {
    const r = await diagnose(dir, { version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.equal(r.ok, true, r.problems.join('; '));
    assert.deepEqual(r.config, { path: 'tflw.config', env: 'local', envs: ['local', 'secure'] });
    assert.deepEqual(r.services, { '': 'http://localhost:4001/v1', inventory: 'http://localhost:4002' });
    assert.deepEqual(r.suite, { files: 1, tests: 1, browserTests: 0, unparsed: 0 });
    assert.equal(r.proxy.line, 'none set — requests go straight to each service');
    assert.equal(r.tls.line, 'certificates verified; no client certificate');
    assert.match(renderDoctor(r), /✓ nothing here stops a run/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('another env: its own base, insecure said loudly, a client certificate not on disk yet, a proxy nobody reads', async () => {
  const dir = await project({ 'tflw.config': CONFIG });
  try {
    const r = await diagnose(dir, { env: 'secure', version: '9.9.9', nodeVersion: 'v22.11.0', environ: { HTTPS_PROXY: 'http://proxy:3128' } });
    assert.equal(r.ok, true, 'none of these stops a run');
    assert.equal(r.config.env, 'secure');
    assert.deepEqual(r.services, { '': 'https://localhost:8443/v1' });
    assert.equal(r.tls.insecure, true);
    assert.match(r.tls.line, /^insecure true — certificates are NOT verified/);
    assert.deepEqual(r.tls.clientCert, { cert: 'certs/client.crt', key: 'certs/client.key', onDisk: false });
    assert.match(r.proxy.line, /HTTPS_PROXY set; .* only when NODE_USE_ENV_PROXY=1 \(it is not\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the three that fail it: no config, an old Node, and browser tests with no browser', async () => {
  const empty = await project({});
  const browser = await project({ 'tflw.config': CONFIG, 'ui.tflw': 'test "page"\n  open "/"\n' });
  try {
    const none = await diagnose(empty, { version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.equal(none.ok, false);
    assert.match(none.problems[0]!, /^no tflw\.config in .* — run `tflw init` here/);
    const old = await diagnose(browser, { version: '9.9.9', nodeVersion: 'v20.10.0', environ: {} });
    assert.equal(old.node.supported, false);
    assert.ok(old.problems.some((p) => /Node v20\.10\.0 is older than 22/.test(p)), old.problems.join('; '));
    // A scratch directory resolves no `playwright`, which is the "not installed" arm.
    assert.ok(old.problems.some((p) => /1 test drives a browser and `playwright` is not installed here/.test(p)), old.problems.join('; '));
    assert.equal(old.suite.browserTests, 1);
  } finally {
    await rm(empty, { recursive: true, force: true });
    await rm(browser, { recursive: true, force: true });
  }
});

// `M266` (`D1430`) — the env's required secrets, by name, set or not, never a value. A required name
// that is not set is the fourth thing that fails doctor, since `run` refuses before its first request.
const PER_ENV = [
  'require env EVERY_TOKEN',
  'env local default',
  '  api "http://localhost:4001/v1"',
  '',
  'env staging',
  '  api "https://staging.example.com"',
  '  require env STG_TOKEN',
  '',
].join('\n');

test('secrets: the env\'s own names are marked, an unset one fails doctor, and no value is printed', async () => {
  const dir = await project({ 'tflw.config': PER_ENV });
  try {
    const staging = await diagnose(dir, { env: 'staging', version: '9.9.9', nodeVersion: 'v22.11.0', environ: {}, runEnviron: { EVERY_TOKEN: 'e-v4lue' } });
    assert.equal(staging.ok, false);
    assert.deepEqual(staging.secrets.required, [
      { name: 'EVERY_TOKEN', env: null, set: true },
      { name: 'STG_TOKEN', env: 'staging', set: false },
    ]);
    assert.equal(staging.secrets.line, 'EVERY_TOKEN, STG_TOKEN (env staging only) — not set: STG_TOKEN');
    assert.ok(staging.problems.some((p) => /^STG_TOKEN \(required by env staging\) is required by `require env` and not set/.test(p)), staging.problems.join('; '));
    assert.match(renderDoctor(staging), /^secrets {3}EVERY_TOKEN, STG_TOKEN/m);
    assert.doesNotMatch(renderDoctor(staging), /e-v4lue/, 'a value never reaches the output');

    // Control: `local` does not require the staging secret, so the same shell passes.
    const local = await diagnose(dir, { version: '9.9.9', nodeVersion: 'v22.11.0', environ: {}, runEnviron: { EVERY_TOKEN: 'e-v4lue' } });
    assert.equal(local.ok, true, local.problems.join('; '));
    assert.equal(local.secrets.line, 'EVERY_TOKEN — all set');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('secrets: a config with no `require env` says so, and the shell alone is read when no `.env` is passed', async () => {
  const dir = await project({ 'tflw.config': CONFIG });
  try {
    const r = await diagnose(dir, { version: '9.9.9', nodeVersion: 'v22.11.0', environ: {} });
    assert.equal(r.secrets.line, 'none required');
    assert.deepEqual(r.secrets.required, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
