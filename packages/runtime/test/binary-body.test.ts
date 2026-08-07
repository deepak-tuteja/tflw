// `body bytes` subject + `matches file "<path>"` matcher (TFLW-GAPS.md gap #17) — proves the raw
// response body survives byte-for-byte (no UTF-8 corruption) and that `body text`/`json` stay
// exactly as correct as before the single-read refactor in `http.ts` (D17.1).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig } from './support.js';

// Real binary content, not valid UTF-8 — a PNG's own magic header (`\x89PNG\r\n\x1a\n`) plus a
// couple of arbitrary high bytes. `body text` decoding this produces U+FFFD replacement
// characters (never a crash); `body bytes` must see the exact original bytes untouched.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x01]);

test('`body bytes` round-trips a real binary response byte-for-byte via `matches file`, and negates cleanly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-binary-'));
  await writeFile(join(dir, 'expected.bin'), PNG_MAGIC);
  await writeFile(join(dir, 'wrong.bin'), Buffer.from('not the same bytes'));

  const server = await startFixtureServer({
    '/image': (_req, res) => res.writeHead(200, { 'content-type': 'image/png' }).end(PNG_MAGIC),
  });

  const source = `test "binary response matches the exact bytes on disk"
  api GET /image
  expect status equals 200
  expect body bytes has count ${PNG_MAGIC.length}
  expect body bytes matches file "./expected.bin"
  expect body bytes not matches file "./wrong.bin"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  await server.close();
  await rm(dir, { recursive: true, force: true });
});

test('`body bytes matches file` fails clearly on a real mismatch, naming the file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-binary-'));
  await writeFile(join(dir, 'wrong.bin'), Buffer.from('not the same bytes'));

  const server = await startFixtureServer({
    '/image': (_req, res) => res.writeHead(200, { 'content-type': 'image/png' }).end(PNG_MAGIC),
  });

  const source = `test "binary response does not match a different file"
  api GET /image
  expect body bytes matches file "./wrong.bin"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir });

  assert.equal(report.ok, false);
  const expectStep = report.tests[0]!.steps.find((s) => s.kind === 'expect')!;
  assert.match(expectStep.detail!, /to match file "\.\/wrong\.bin"/);
  assert.match(expectStep.detail!, /<binary body, \d+ bytes>/);

  await server.close();
  await rm(dir, { recursive: true, force: true });
});

test('`body bytes matches file` against a nonexistent file fails clearly, naming the path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-binary-'));
  const server = await startFixtureServer({
    '/image': (_req, res) => res.writeHead(200, { 'content-type': 'image/png' }).end(PNG_MAGIC),
  });

  const source = `test "expected file does not exist"
  api GET /image
  expect body bytes matches file "./does-not-exist.bin"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /could not read file ".\/does-not-exist\.bin" for `matches file`/);

  await server.close();
  await rm(dir, { recursive: true, force: true });
});

test('`matches file` on anything other than `body bytes` is a clear runtime error', async () => {
  const server = await startFixtureServer({
    '/health': (_req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end('ok'),
  });

  const source = `test "matches file on body text is not allowed"
  api GET /health
  expect body text matches file "./whatever.bin"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /`matches file` is only valid on a `body bytes` subject/);

  await server.close();
});

// `matches file` interpolates its path (`A4-OS-09`, D174)
// ---------------------------------------------------------------------------
//
// Every test below writes its fixture at the **interpolated** name and asserts, first, that
// nothing exists at the literal one. That precondition is the whole calibration: `{slug}.bin` is a
// perfectly legal filename on every filesystem tflw runs on, so a fixture written under the raw
// literal would make all three of these pass against the pre-fix `.value` read — green, and
// testing nothing. This is `M98`'s lesson applied before the fact rather than after: the assertion
// that a control *can* fail belongs in the control.

/** Fails the test if `name` exists in `dir` — the literal path these tests must never satisfy. */
async function assertAbsent(dir: string, name: string): Promise<void> {
  await assert.rejects(
    () => access(join(dir, name)),
    `"${name}" exists on disk, so this test would pass without interpolating anything`,
  );
}

test('`matches file` interpolates `{var}` in its path, in both the plain and negated forms', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-binary-'));
  await writeFile(join(dir, 'receipt-9.bin'), PNG_MAGIC);
  await writeFile(join(dir, 'receipt-8.bin'), Buffer.from('some other receipt'));
  await assertAbsent(dir, '{slug}.bin');
  await assertAbsent(dir, '{other}.bin');

  const server = await startFixtureServer({
    '/image': (_req, res) => res.writeHead(200, { 'content-type': 'image/png' }).end(PNG_MAGIC),
  });

  const source = `test "a path built out of variables names the same file a literal would"
  let slug = "receipt-9"
  let other = "receipt-8"
  api GET /image
  expect status equals 200
  expect body bytes matches file "./{slug}.bin"
  expect body bytes not matches file "./{other}.bin"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  await server.close();
  await rm(dir, { recursive: true, force: true });
});

test('`matches file` interpolates a path captured from a response, which is the shape the corpus wanted', async () => {
  // The dogfood site this row came from computes its path at run time — a `use`d JS action writes
  // a scratch file and hands back where it put it. A `capture` stands in for that here: the point
  // is that the value cannot exist until a step has run, which is exactly what `.value` could not
  // express and why that suite had to write its path out twice.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-binary-'));
  await writeFile(join(dir, 'scratch-a1b2.bin'), PNG_MAGIC);
  await assertAbsent(dir, '{handle.name}.bin');

  const server = await startFixtureServer({
    '/handle': (_req, res) =>
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: 'scratch-a1b2' })),
    '/image': (_req, res) => res.writeHead(200, { 'content-type': 'image/png' }).end(PNG_MAGIC),
  });

  const source = `test "the expected file's name is only known once a step has run"
  api GET /handle
  expect status equals 200
  capture body.name as handle
  api GET /image
  expect body bytes matches file "./{handle}.bin"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  await server.close();
  await rm(dir, { recursive: true, force: true });
});

test('a failing `matches file` reports the interpolated path, not the literal the user typed', async () => {
  // The control that pins the fix rather than merely exercising it. Both assertions below are
  // about the *message*: it must name `./receipt-9.bin`, the path actually opened, and must not
  // leak the `{slug}` spelling. A run that skipped interpolation cannot produce either — it would
  // fail earlier, with `{slug}` verbatim in the text.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-binary-'));
  await assertAbsent(dir, '{slug}.bin');

  const server = await startFixtureServer({
    '/image': (_req, res) => res.writeHead(200, { 'content-type': 'image/png' }).end(PNG_MAGIC),
  });

  const source = `test "the missing-file error names the resolved path"
  let slug = "receipt-9"
  api GET /image
  expect body bytes matches file "./{slug}.bin"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir });

  assert.equal(report.ok, false);
  const error = report.tests[0]!.error ?? '';
  assert.match(error, /could not read file ".\/receipt-9\.bin" for `matches file`/);
  assert.doesNotMatch(error, /\{slug\}/);

  await server.close();
  await rm(dir, { recursive: true, force: true });
});

test('`body bytes has count` measures raw byte length, distinct from `body text`\'s JS string length on multi-byte UTF-8', async () => {
  // "€€€" is 3 JS characters but 9 UTF-8 bytes (0xE2 0x82 0xAC each) — proves `body bytes` isn't
  // secretly measuring the decoded string, and that valid multi-byte UTF-8 still round-trips
  // perfectly through the single-read refactor (D17.1's behavior-preservation claim, the mirror
  // case to the invalid-UTF-8 fixture above).
  const euros = Buffer.from('€€€', 'utf8');
  const server = await startFixtureServer({
    '/money': (_req, res) => res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(euros),
  });

  const source = `test "byte count differs from char count"
  api GET /money
  expect body bytes has count 9
  expect body text has count 3
  expect body text equals "€€€"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));

  await server.close();
});
