// Unit tests for workspace/crossFile.ts (PLAN_M13_LSP.md Phase 3, design decision 5) — real
// mkdtemp fixture files (not literal-source-only, since this module's whole job is reading other
// files off disk).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CrossFileResolver } from '../src/workspace/crossFile.js';

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-lsp-crossfile-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('resolveImportedAction finds an action declared in an imported .tflw file, with its real param names', async () => {
  await withTmpDir(async (dir) => {
    await writeFile(join(dir, 'actions.tflw'), `action create order(name, amount)\n  give name\n`, 'utf8');
    const resolver = new CrossFileResolver();
    const located = await resolver.resolveImportedAction(dir, ['./actions.tflw'], [], 'create order');
    assert.ok(located);
    assert.equal(located!.absPath, join(dir, 'actions.tflw'));
    assert.deepEqual(located!.params, ['name', 'amount']);
    assert.ok(located!.span);
  });
});

test('resolveImportedAction searches import paths in order, first declaring file wins', async () => {
  await withTmpDir(async (dir) => {
    await writeFile(join(dir, 'a.tflw'), `action noop()\n  give "x"\n`, 'utf8');
    await writeFile(join(dir, 'b.tflw'), `action create order(id)\n  give id\n`, 'utf8');
    const resolver = new CrossFileResolver();
    const located = await resolver.resolveImportedAction(dir, ['./a.tflw', './b.tflw'], [], 'create order');
    assert.equal(located?.absPath, join(dir, 'b.tflw'));
    assert.deepEqual(located?.params, ['id']);
  });
});

test('resolveImportedAction falls back to line 1 of the first `use`d helper when no import declares the name', async () => {
  await withTmpDir(async (dir) => {
    await writeFile(join(dir, 'helpers.ts'), `export function createOrder() {}\n`, 'utf8');
    const resolver = new CrossFileResolver();
    const located = await resolver.resolveImportedAction(dir, [], ['./helpers.ts'], 'create order');
    assert.ok(located);
    assert.equal(located!.absPath, join(dir, 'helpers.ts'));
    assert.equal(located!.span, undefined);
    assert.equal(located!.params, undefined);
  });
});

test('resolveImportedAction returns null when neither imports nor uses resolve the name', async () => {
  const resolver = new CrossFileResolver();
  const located = await resolver.resolveImportedAction('/nonexistent', [], [], 'create order');
  assert.equal(located, null);
});

test('resolveImportedAction re-reads a changed import once its mtime changes (cache invalidation)', async () => {
  await withTmpDir(async (dir) => {
    const file = join(dir, 'actions.tflw');
    await writeFile(file, `action create order(name)\n  give name\n`, 'utf8');
    const resolver = new CrossFileResolver();
    const first = await resolver.resolveImportedAction(dir, ['./actions.tflw'], [], 'create order');
    assert.deepEqual(first?.params, ['name']);

    await writeFile(file, `action create order(name, amount)\n  give name\n`, 'utf8');
    // Force a distinct mtime — some filesystems have coarse mtime resolution and a same-tick
    // rewrite could otherwise look unchanged to the cache.
    const bumped = new Date(Date.now() + 5000);
    await utimes(file, bumped, bumped);

    const second = await resolver.resolveImportedAction(dir, ['./actions.tflw'], [], 'create order');
    assert.deepEqual(second?.params, ['name', 'amount']);
  });
});
