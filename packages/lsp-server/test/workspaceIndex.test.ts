// Unit tests for workspace/workspaceIndex.ts (PLAN_M13_LSP.md Phase 3, design decision 6) — real
// mkdtemp fixture projects (this module's whole job is a project-wide filesystem walk + re-parse).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverProjectFiles, findCrossFileRenameEdits } from '../src/workspace/workspaceIndex.js';

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-lsp-index-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('discoverProjectFiles finds every *.tflw file, skipping node_modules and dot-directories', async () => {
  await withTmpDir(async (dir) => {
    await mkdir(join(dir, 'nested'), { recursive: true });
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
    await mkdir(join(dir, '.git'), { recursive: true });
    await writeFile(join(dir, 'a.tflw'), `test "a"\n  api GET /health\n`, 'utf8');
    await writeFile(join(dir, 'nested', 'b.tflw'), `test "b"\n  api GET /health\n`, 'utf8');
    await writeFile(join(dir, 'node_modules', 'pkg', 'c.tflw'), `test "c"\n  api GET /health\n`, 'utf8');
    await writeFile(join(dir, '.git', 'd.tflw'), `test "d"\n  api GET /health\n`, 'utf8');
    await writeFile(join(dir, 'notes.txt'), 'not a test file', 'utf8');

    const files = await discoverProjectFiles(dir);
    assert.deepEqual(files, [join(dir, 'a.tflw'), join(dir, 'nested', 'b.tflw')]);
  });
});

test('findCrossFileRenameEdits: an action rename finds the importing file\'s call site, skipping the origin file', async () => {
  await withTmpDir(async (dir) => {
    const actionsPath = join(dir, 'actions.tflw');
    const userPath = join(dir, 'user.tflw');
    await writeFile(actionsPath, `action create order(name)\n  give name\n`, 'utf8');
    await writeFile(userPath, `import "./actions.tflw"\n\ntest "ok"\n  let o = create order("x")\n  api GET /health\n`, 'utf8');

    const edits = await findCrossFileRenameEdits(dir, 'action', 'create order', actionsPath);
    assert.equal(edits.length, 1);
    assert.equal(edits[0]!.absPath, userPath);
    assert.equal(edits[0]!.spans.length, 1);
  });
});

test('findCrossFileRenameEdits: a session rename finds every other test file\'s ref plus tflw.config\'s own def', async () => {
  await withTmpDir(async (dir) => {
    await writeFile(join(dir, 'tflw.config'), `env local default\n  api "http://localhost:3001"\n\nsession admin\n  api GET /health\n`, 'utf8');
    const aPath = join(dir, 'a.tflw');
    const bPath = join(dir, 'b.tflw');
    await writeFile(aPath, `test "a" as admin\n  api GET /health\n`, 'utf8');
    await writeFile(bPath, `test "b" as admin\n  api GET /health\n`, 'utf8');

    const edits = await findCrossFileRenameEdits(dir, 'session', 'admin', aPath);
    const byPath = new Map(edits.map((e) => [e.absPath, e.spans.length] as const));
    assert.equal(byPath.get(bPath), 1);
    assert.equal(byPath.get(join(dir, 'tflw.config')), 1);
    assert.equal(byPath.has(aPath), false);
  });
});

test('findCrossFileRenameEdits: no matches anywhere returns an empty list', async () => {
  await withTmpDir(async (dir) => {
    await writeFile(join(dir, 'a.tflw'), `test "a"\n  api GET /health\n`, 'utf8');
    const edits = await findCrossFileRenameEdits(dir, 'action', 'nonexistent action', join(dir, 'a.tflw'));
    assert.deepEqual(edits, []);
  });
});
