// Track 2 (grill-me, 2026-07-07): unit tests for extension.ts's vscode-independent logic. `vscode`
// only exists inside a running extension host — nothing that imports it can run under a plain
// `node --test`, so lib.ts factors out everything that doesn't need it, tested here directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { findProjectRoot, resolveTflwBin, parseTestDeclarationLine, spawnSpec, LineReader, verdictOf, parseExplorerEvent, reportDirOf } from '../src/lib.js';

test('findProjectRoot walks up until it finds a directory containing tflw.config', () => {
  // Built with the host's own path functions (`M243-16`): `findProjectRoot` joins with `node:path`,
  // so on Windows it asks the fake fs for `\\home\\user\\…`, which a POSIX literal never matches.
  const project = resolve('/home/user/project');
  const fakeFs = new Set([join(project, 'tflw.config')]);
  const exists = (p: string) => fakeFs.has(p);
  assert.equal(findProjectRoot(join(project, 'tests', 'nested'), exists), project);
  assert.equal(findProjectRoot(project, exists), project);
});

test('findProjectRoot returns undefined when no tflw.config exists anywhere above', () => {
  const exists = () => false;
  assert.equal(findProjectRoot('/home/user/not-a-project/tests', exists), undefined);
});

test('resolveTflwBin prefers a project-local node_modules/.bin/tflw when it exists', () => {
  const local = join('/proj', 'node_modules', '.bin', 'tflw');
  const exists = (p: string) => p === local;
  assert.equal(resolveTflwBin('/proj', 'linux', exists), local);
});

test('resolveTflwBin falls back to a bare "tflw" (PATH lookup) when no local install exists', () => {
  const exists = () => false;
  assert.equal(resolveTflwBin('/proj', 'linux', exists), 'tflw');
});

test('resolveTflwBin looks for a "tflw.cmd" filename (not bare "tflw") when platform is win32', () => {
  // Uses the test runner's own `path.join` (same as resolveTflwBin does internally) rather than
  // hand-building a Windows-style path — the extension only ever runs on the OS it's installed on,
  // so `platform` and the path module's separator are never mismatched in real usage; this just
  // checks the filename choice (.cmd vs. none), not cross-platform path joining.
  const expected = join('/proj', 'node_modules', '.bin', 'tflw.cmd');
  const exists = (p: string) => p === expected;
  assert.equal(resolveTflwBin('/proj', 'win32', exists), expected);
});

test('parseTestDeclarationLine extracts the decoded test name from a `test "..."` line', () => {
  assert.equal(parseTestDeclarationLine('test "health check"'), 'health check');
  assert.equal(parseTestDeclarationLine('test "eventually works" retry 2'), 'eventually works');
});

test('parseTestDeclarationLine decodes \\" and \\\\ escapes the same way the lexer does', () => {
  assert.equal(parseTestDeclarationLine(String.raw`test "a \"quoted\" name"`), 'a "quoted" name');
  assert.equal(parseTestDeclarationLine(String.raw`test "a \\backslash"`), 'a \\backslash');
});

test('parseTestDeclarationLine returns undefined for a non-test line', () => {
  assert.equal(parseTestDeclarationLine('  api GET /health'), undefined);
  assert.equal(parseTestDeclarationLine('session admin'), undefined);
});

// ---- `M251` `C`: the explorer's pure half -----------------------------------------------------
//
// `M252-06`: these five shipped with M251 exercised only through the explorer's happy path, and
// the package's branch coverage fell from 97.78% to 79.47% against a 96% floor. Each branch below
// is one the explorer takes on real input — a Windows path with a space, a chunk that ends mid-line,
// a report entry with no failing step — so each is pinned here, where it can be reached directly.

test('spawnSpec passes a POSIX bin and its args through untouched, with no shell', () => {
  assert.deepEqual(spawnSpec('/p/node_modules/.bin/tflw', ['run', '--only', 'adds to cart'], 'linux'), {
    command: '/p/node_modules/.bin/tflw', args: ['run', '--only', 'adds to cart'], shell: false,
  });
});

test('spawnSpec on win32 goes through the shell, quoting only what cmd.exe would split, and doubling a quote', () => {
  assert.deepEqual(spawnSpec('C:\\Program Files\\p\\tflw.cmd', ['run', 'shop.tflw', '--only', 'say "hi"'], 'win32'), {
    command: '"C:\\Program Files\\p\\tflw.cmd"', args: ['run', 'shop.tflw', '--only', '"say ""hi"""'], shell: true,
  });
});

test('LineReader holds a partial line until its newline arrives, strips CR, drops blank lines, and flushes the rest', () => {
  const r = new LineReader();
  assert.deepEqual(r.push('{"a":1}\r\n{"b"'), ['{"a":1}']);
  assert.deepEqual(r.push(':2}\n\n{"c":3}'), ['{"b":2}']);
  assert.deepEqual(r.flush(), ['{"c":3}']);
  assert.deepEqual(r.flush(), [], 'a second flush has nothing left');
});

test('verdictOf: skipped carries its reason; passed carries only what the entry had', () => {
  assert.deepEqual(verdictOf({ name: 't', skipped: 'payments are down', durationMs: 0, file: 'a.tflw' }), { state: 'skipped', durationMs: 0, file: 'a.tflw', message: 'payments are down' });
  assert.deepEqual(verdictOf({ name: 't', ok: true }), { state: 'passed' });
});

test('verdictOf: a failure names its failing step, or the fatal error, or says only that it failed', () => {
  assert.deepEqual(
    verdictOf({ name: 't', ok: false, steps: [{ ok: true }, { ok: false, source: '  expect status equals 201', detail: 'got 500', line: 7, file: 'b.tflw' }] }),
    { state: 'failed', message: 'expect status equals 201\ngot 500', line: 7, file: 'b.tflw' },
  );
  assert.deepEqual(verdictOf({ name: 't', ok: false, steps: [{ ok: false }] }), { state: 'failed', message: '' }, 'a failing step with nothing to say says nothing, rather than a stale default');
  assert.deepEqual(verdictOf({ name: 't', ok: false, error: 'before file failed' }), { state: 'failed', message: 'before file failed' });
  assert.deepEqual(verdictOf({ name: 't', ok: false }), { state: 'failed', message: 'failed' });
});

test('parseExplorerEvent reads a start and an end, with the file from either place the stream puts it', () => {
  assert.deepEqual(parseExplorerEvent('{"type":"test:start","name":"t","file":"a.tflw"}'), { kind: 'start', name: 't', file: 'a.tflw' });
  assert.deepEqual(parseExplorerEvent('{"type":"test:start","name":"t"}'), { kind: 'start', name: 't' });
  assert.deepEqual(parseExplorerEvent('{"type":"test:end","file":"a.tflw","result":{"name":"t","ok":true}}'), { kind: 'end', name: 't', file: 'a.tflw', verdict: { state: 'passed' } });
  assert.deepEqual(parseExplorerEvent('{"type":"test:end","result":{"name":"t","ok":true,"file":"b.tflw"}}'), { kind: 'end', name: 't', file: 'b.tflw', verdict: { state: 'passed', file: 'b.tflw' } });
  assert.deepEqual(parseExplorerEvent('{"type":"test:end","result":{"name":"t","ok":true}}'), { kind: 'end', name: 't', verdict: { state: 'passed' } });
});

test('parseExplorerEvent ignores everything else: not JSON, a hook, a step, an end with no result', () => {
  for (const line of ['not json', '{"type":"test:start","name":"t","hook":"before"}', '{"type":"step:end","test":"t"}', '{"type":"test:end"}', '{"type":"test:start"}']) {
    assert.equal(parseExplorerEvent(line), null, line);
  }
});

test('reportDirOf reads `report` from the config, and falls back to `report`', () => {
  assert.equal(reportDirOf('defaults\n  report "./out"\n'), './out');
  assert.equal(reportDirOf('env local default\n  api "http://x"\n'), 'report');
});
