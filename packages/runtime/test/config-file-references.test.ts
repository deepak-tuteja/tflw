// M116 (`PLAN_M97_CHECKER_CONTRACT.md`, D151) — `TF043` over `tflw.config`: `cert`/`key` and the
// paths a `session` body names. Closes `M97c-01`.
//
// Two things are being asserted here, and the second is the one with teeth:
//
//  1. The paths are found at all. `collectFileReferences` walks a `Program` and never saw a
//     `ConfigFile`, which is why `cert "./nope.pem"` checked clean for eleven milestones.
//  2. **They resolve against `tflw.config`'s directory, not the cwd.** Those are the same directory
//     in every test anyone writes from a repo root, so a test that does not deliberately separate
//     them proves nothing — and getting it wrong is invisible until a user runs `tflw` from
//     somewhere else, which is D137 clause 1's failure mode arriving in the field.
//
// Every test states its negative control (`M92d`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfigSource, Codes } from '@tflw/lang';
import { checkConfigFiles } from '../src/index.js';

const check = async (configSource: string, configDir: string) => {
  const parsed = parseConfigSource(configSource);
  assert.deepEqual(parsed.diagnostics, [], `fixture did not parse:\n${configSource}`);
  return checkConfigFiles(parsed.config, configDir);
};

const MTLS = 'env local default\n  api "http://x"\n  cert "./certs/client.pem"\n  key "./certs/client.key"\n';

test('`cert`/`key` naming files that are not there is `TF043`', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m116-'));
  const diags = await check(MTLS, dir);
  assert.deepEqual(diags.map((d) => d.code), [Codes.MISSING_FILE, Codes.MISSING_FILE]);
  // Control: the same config with both files present, asserted below rather than assumed.
});

test('`cert`/`key` that exist report nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m116-'));
  await mkdir(join(dir, 'certs'));
  await writeFile(join(dir, 'certs/client.pem'), 'x');
  await writeFile(join(dir, 'certs/client.key'), 'x');
  assert.deepEqual(await check(MTLS, dir), []);
});

test('both are WARNINGS, never errors (D147/D151)', async () => {
  // The severity is the whole `A4-05` argument: `loadMtlsCreds` runs at the first api step
  // (`interpreter.ts:3125`), not while the config is resolved, so a `before all` hook can create
  // the file and the checker is predicting. An error here would make a valid suite unrunnable with
  // no override — which M97c shipped once already, in the milestone whose thesis forbade it.
  // Control: flip the severity in `checkConfigFiles` and this is the test that catches it.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m116-'));
  const diags = await check(MTLS, dir);
  assert.ok(diags.length > 0, 'fixture produced no diagnostics at all');
  assert.deepEqual([...new Set(diags.map((d) => d.severity))], ['warning']);
});

test('paths resolve against the CONFIG directory, not the cwd', async () => {
  // The test that has to be built deliberately, because the two are the same directory in every
  // casual fixture. `nested/` holds the file; the config that names `./client.pem` lives there too
  // and must be clean, while an identical config one level up must not be.
  const root = await mkdtemp(join(tmpdir(), 'tflw-m116-'));
  const nested = join(root, 'nested');
  await mkdir(nested);
  await writeFile(join(nested, 'client.pem'), 'x');
  await writeFile(join(nested, 'client.key'), 'x');
  const config = 'env local default\n  api "http://x"\n  cert "./client.pem"\n  key "./client.key"\n';
  assert.deepEqual(await check(config, nested), [], 'resolved against the config dir: should be clean');
  const fromRoot = await check(config, root);
  assert.equal(fromRoot.length, 2, 'the same config one directory up must NOT find those files');
});

test('a `session` body\'s own file references are checked too', async () => {
  // The other half D151 unblocked: `checkReferencedFiles`' session verdict read "the same missing
  // piece `M97c-01` needs, so the two land together or not at all". They did.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m116-'));
  const config = 'env local default\n  api "http://x"\n\nsession s\n  api POST /auth/login body from "./creds.json"\n';
  const missing = await check(config, dir);
  assert.deepEqual(missing.map((d) => d.code), [Codes.MISSING_FILE]);
  await writeFile(join(dir, 'creds.json'), '{}');
  assert.deepEqual(await check(config, dir), []);
});

test('an interpolated config path is skipped, not reported', async () => {
  // D144's doctrine, unchanged on this side: not knowable is not known-bad.
  // Control: `"./creds.json"` in the same position *is* reported (the test above).
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m116-'));
  const config = 'env local default\n  api "http://x"\n\nsession s\n  let n = "a"\n  api POST /auth/login body from "./{n}.json"\n';
  assert.deepEqual(await check(config, dir), []);
});

test('a config naming no files at all reports nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-m116-'));
  assert.deepEqual(await check('env local default\n  api "http://x"\n', dir), []);
});
