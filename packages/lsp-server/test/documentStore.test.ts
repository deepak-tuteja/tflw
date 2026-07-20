// Unit tests for workspace/documentStore.ts (PLAN_M13_LSP.md Phase 3) — open-document analysis
// (dialect branch, decision A) and the diagnostics debounce (decision 17.9). Uses real mkdtemp
// fixture projects since `analyze()` reads the project's `tflw.config` off disk for a `.tflw`
// buffer's known services/sessions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocumentStore } from '../src/workspace/documentStore.js';

async function withTmpProject<T>(configSource: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-lsp-docstore-'));
  try {
    await writeFile(join(dir, 'tflw.config'), configSource, 'utf8');
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const CLEAN_CONFIG = `env local default\n  api "http://localhost:3001"\n\nsession admin\n  api GET /health\n`;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('analyze: a clean .tflw buffer against a matching project config reports zero diagnostics', async () => {
  await withTmpProject(CLEAN_CONFIG, async (dir) => {
    const store = new DocumentStore();
    const uri = 'file:///doc.tflw';
    store.open(uri, join(dir, 'doc.tflw'), `test "ok" as admin\n  api GET /health\n  expect status equals 200\n`);
    const analysis = await store.analyze(uri, undefined);
    assert.deepEqual(analysis?.diagnostics, []);
    assert.ok(analysis?.program);
    assert.equal(analysis?.root, dir);
  });
});

test('analyze: a .tflw buffer referencing an unknown session is flagged against the project config on disk', async () => {
  await withTmpProject(CLEAN_CONFIG, async (dir) => {
    const store = new DocumentStore();
    const uri = 'file:///doc.tflw';
    store.open(uri, join(dir, 'doc.tflw'), `test "ok" as nope\n  api GET /health\n`);
    const analysis = await store.analyze(uri, undefined);
    assert.equal(analysis?.diagnostics.length, 1);
    assert.equal(analysis?.diagnostics[0]!.code, 'TF028');
  });
});

test('analyze: a tflw.config buffer gets checkSessionServices diagnostics against its own in-memory text (decision A)', async () => {
  await withTmpProject(CLEAN_CONFIG, async (dir) => {
    const store = new DocumentStore();
    const uri = 'file:///tflw.config';
    store.open(uri, join(dir, 'tflw.config'), `env local default\n  api "http://localhost:3001"\n\nsession admin\n  api billng GET /health\n`);
    const analysis = await store.analyze(uri, undefined);
    assert.equal(analysis?.diagnostics.length, 1);
    assert.equal(analysis?.diagnostics[0]!.code, 'TF026');
    assert.ok(analysis?.config);
    assert.equal(analysis?.program, undefined);
  });
});

test('update: analyze reflects the buffer\'s latest text, not what open() first saw', async () => {
  await withTmpProject(CLEAN_CONFIG, async (dir) => {
    const store = new DocumentStore();
    const uri = 'file:///doc.tflw';
    store.open(uri, join(dir, 'doc.tflw'), `test "ok"\n  api GET /health\n`);
    store.update(uri, `test "ok" as nope\n  api GET /health\n`);
    const analysis = await store.analyze(uri, undefined);
    assert.equal(analysis?.diagnostics.length, 1);
    assert.equal(analysis?.diagnostics[0]!.code, 'TF028');
  });
});

test('analyze: an unknown uri returns undefined rather than throwing', async () => {
  const store = new DocumentStore();
  assert.equal(await store.analyze('file:///nope.tflw', undefined), undefined);
});

test('scheduleDiagnostics: a burst of updates collapses into one publish reflecting the final text', async () => {
  await withTmpProject(CLEAN_CONFIG, async (dir) => {
    const store = new DocumentStore();
    const uri = 'file:///doc.tflw';
    store.open(uri, join(dir, 'doc.tflw'), `test "ok"\n  api GET /health\n`);

    const publishes: (readonly unknown[])[] = [];
    const publish = (diagnostics: readonly unknown[]): void => {
      publishes.push(diagnostics);
    };

    store.scheduleDiagnostics(uri, undefined, publish);
    store.update(uri, `test "ok" as nope\n  api GET /health\n`);
    store.scheduleDiagnostics(uri, undefined, publish);
    store.update(uri, `test "ok" as admin\n  api GET /health\n`);
    store.scheduleDiagnostics(uri, undefined, publish);

    await delay(350);
    assert.equal(publishes.length, 1);
    assert.deepEqual(publishes[0], []);
  });
});

test('close: cancels a pending debounced publish', async () => {
  await withTmpProject(CLEAN_CONFIG, async (dir) => {
    const store = new DocumentStore();
    const uri = 'file:///doc.tflw';
    store.open(uri, join(dir, 'doc.tflw'), `test "ok" as nope\n  api GET /health\n`);

    let published = false;
    store.scheduleDiagnostics(uri, undefined, () => {
      published = true;
    });
    store.close(uri);

    await delay(350);
    assert.equal(published, false);
  });
});
