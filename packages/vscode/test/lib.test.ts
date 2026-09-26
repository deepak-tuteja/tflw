// Track 2 (grill-me, 2026-07-07): unit tests for extension.ts's vscode-independent logic. `vscode`
// only exists inside a running extension host — nothing that imports it can run under a plain
// `node --test`, so lib.ts factors out everything that doesn't need it, tested here directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { findProjectRoot, resolveTflwBin, parseTestDeclarationLine } from '../src/lib.js';

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
