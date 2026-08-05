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

// -- M60: the server runs the CLI's pass list, not a subset -----------------------------------
//
// It used to run four of the CLI's six: no `checkRequestAssertions`, no `checkWorkloadTests`. So an
// editor showed a clean file that `tflw run` then refused to run at all — the two missing passes
// being exactly the ones that report load-testing and connection-assertion mistakes. These assert
// per-diagnostic, one per formerly-missing pass, rather than counting: a count would still pass if
// one pass were dropped and another double-reported.

test('analyze: a workload-bearing test with no threshold is reported by the server too (checkWorkloadTests, M60)', async () => {
  await withTmpProject(CLEAN_CONFIG, async (dir) => {
    const store = new DocumentStore();
    const uri = 'file:///doc.tflw';
    store.open(uri, join(dir, 'doc.tflw'), `test "load"\n  hold 2 users for 1s\n  api GET /health\n`);
    const analysis = await store.analyze(uri, undefined);
    assert.ok(
      analysis?.diagnostics.some((d) => d.code === 'TF033'),
      `expected TF033 from the workload pass, got ${JSON.stringify(analysis?.diagnostics.map((d) => d.code))}`,
    );
  });
});

test('analyze: a `request` assertion mixed with a response assertion is reported by the server too (checkRequestAssertions, M60)', async () => {
  await withTmpProject(CLEAN_CONFIG, async (dir) => {
    const store = new DocumentStore();
    const uri = 'file:///doc.tflw';
    store.open(uri, join(dir, 'doc.tflw'), `test "ok"\n  api GET /health\n  expect request connects\n  expect status equals 200\n`);
    const analysis = await store.analyze(uri, undefined);
    assert.ok(
      analysis?.diagnostics.some((d) => d.code === 'TF031'),
      `expected TF031 from the request-assertion pass, got ${JSON.stringify(analysis?.diagnostics.map((d) => d.code))}`,
    );
  });
});

test('analyze: a duplicate action name is reported by the server too (checkActionDecls, M60/A2-01)', async () => {
  await withTmpProject(CLEAN_CONFIG, async (dir) => {
    const store = new DocumentStore();
    const uri = 'file:///doc.tflw';
    store.open(uri, join(dir, 'doc.tflw'), `action a()\n  give 1\n\naction a()\n  give 2\n\ntest "t"\n  api GET /health\n`);
    const analysis = await store.analyze(uri, undefined);
    assert.ok(
      analysis?.diagnostics.some((d) => d.code === 'TF035'),
      `expected TF035, got ${JSON.stringify(analysis?.diagnostics.map((d) => d.code))}`,
    );
  });
});

// M87 (review cluster C6) — the language server's own resolved world. `checkCalls` needs the
// actions a file's `import` lines bring in, and the checker cannot read them itself, so each caller
// supplies them. That is the shape M60 found had drifted: one shared pass list, but per-call-site
// inputs, and the editor silently answering a narrower question than the CLI.
test('analyze: an imported action is resolved off disk, so a wrong-arity call squiggles (M87)', async () => {
  await withTmpProject(CLEAN_CONFIG, async (dir) => {
    await writeFile(join(dir, 'orders.tflw'), 'action create order(name)\n  api GET /health\n  expect status equals 200\n', 'utf8');
    const store = new DocumentStore();
    const uri = 'file:///doc.tflw';
    store.open(uri, join(dir, 'doc.tflw'), 'import "./orders.tflw"\n\ntest "t"\n  create order("a", "b")\n');
    const analysis = await store.analyze(uri, undefined);
    assert.equal(analysis?.diagnostics.length, 1);
    assert.equal(analysis?.diagnostics[0]!.code, 'TF038');
    assert.match(analysis!.diagnostics[0]!.message, /expects 1 argument, got 2/);
  });
});

test('analyze: an imported file open in another buffer is read from that buffer, not from disk (M87)', async () => {
  await withTmpProject(CLEAN_CONFIG, async (dir) => {
    // On disk the action takes one parameter, so the call below is correct. In the editor it has
    // just been given a second one and not yet saved. The squiggle must follow what is on screen —
    // otherwise the editor disagrees with itself across two tabs, which is the failure mode the
    // buffer-first reader exists to prevent.
    await writeFile(join(dir, 'orders.tflw'), 'action create order(name)\n  api GET /health\n  expect status equals 200\n', 'utf8');
    const store = new DocumentStore();
    store.open('file:///orders.tflw', join(dir, 'orders.tflw'), 'action create order(name, qty)\n  api GET /health\n  expect status equals 200\n');
    const uri = 'file:///doc.tflw';
    store.open(uri, join(dir, 'doc.tflw'), 'import "./orders.tflw"\n\ntest "t"\n  create order("a")\n');
    const analysis = await store.analyze(uri, undefined);
    assert.equal(analysis?.diagnostics.length, 1);
    assert.equal(analysis?.diagnostics[0]!.code, 'TF038');
    assert.match(analysis!.diagnostics[0]!.message, /expects 2 arguments, got 1/);
  });
});
