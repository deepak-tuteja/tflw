// `M240-03` — an action's steps are read against the action's own file.
//
// `execSteps` read a step's `source` as `tc.lines[line - 1]`, and `tc.lines` was the calling test's
// file whatever the step's span pointed into. Measured on the UI's fixture corpus before the repair:
// `hook-first.tflw` calls `readShelf(1)` from `actions/aaa-shared.tflw`, and its four steps were
// recorded as `import "../actions/aaa-shared.tflw"`, `""`, `before`, `api GET /items` — the caller's
// lines 7–10. The stream carried the same four under a test called `readShelf(...)` that was never
// started or ended.
//
// Each test below states its negative control: the pre-repair value it would have seen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource } from '@tflw/lang';
import type { RunEvent } from '../src/types.js';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';
import { asEntry } from './__helpers__/entry.js';

// The action's lines sit at line numbers the caller also has, holding different text — so a read
// against the wrong file is a wrong string, never an out-of-range blank that could pass by accident.
const SHARED = 'action readShelf(id)\n  api GET /items/{id}\n  expect status equals 200\n  capture body.name as shelfName\n  give shelfName\n\naction pingLocal()\n  local()\n';
const CALLER = 'import "../shared/shelf.tflw"\n\naction local()\n  api GET /ping\n\ntest "reads the shelf"\n  let name = readShelf(1)\n  pingLocal()\n';

async function project(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-action-lines-'));
  await mkdir(join(dir, 'shared'));
  await mkdir(join(dir, 'tests'));
  await writeFile(join(dir, 'shared', 'shelf.tflw'), SHARED);
  return dir;
}

async function run(): Promise<{ steps: readonly { kind: string; source: string; line: number; file?: string }[]; events: RunEvent[] }> {
  const server = await startFixtureServer({
    '/items/1': (_req, res) => json(res, 200, { name: 'widget' }),
    '/ping': (_req, res) => json(res, 200, {}),
  });
  const dir = await project();
  const events: RunEvent[] = [];
  try {
    const { program } = parseSource(CALLER);
    const { report } = await runProgram(program, testConfig(server.baseUrl), {
      source: CALLER,
      baseDir: join(dir, 'tests'),
      filePath: 'tests/caller.tflw',
      emit: (e) => events.push(e),
    });
    assert.equal(report.ok, true, asEntry(report.tests[0], 'functional').error);
    return { steps: asEntry(report.tests[0], 'functional').steps, events };
  } finally {
    await rm(dir, { recursive: true, force: true });
    await server.close();
  }
}

test("an imported action's steps carry the action file's text and name that file", async () => {
  const { steps } = await run();
  const shelf = steps.filter((s) => s.file === 'shared/shelf.tflw');
  // Before: `import "../shared/shelf.tflw"`-era text — line 2 of the caller is blank, 3 is `action local()`.
  assert.deepEqual(
    shelf.slice(0, 3).map((s) => [s.kind, s.line, s.source]),
    [
      ['api', 2, 'api GET /items/{id}'],
      ['expect', 3, 'expect status equals 200'],
      ['capture', 4, 'capture body.name as shelfName'],
    ],
  );
  assert.ok(shelf.some((s) => s.kind === 'give' && s.line === 5 && s.source === 'give shelfName'));
});

test("the calling test's own steps carry no file, and a local action reached through an imported one reads the test's lines", async () => {
  const { steps } = await run();
  const call = steps.find((s) => s.kind === 'call' && s.source.startsWith('let name'));
  assert.ok(call, 'the let-call step is recorded');
  assert.equal(call.file, undefined, "a step of the test's own file names no file");
  assert.equal(call.line, 7);
  // `local()` is declared in the caller and called from `pingLocal`, which is imported: its step is
  // the caller's line 4, and must not inherit the importing frame's lines or file. Before a
  // per-call lookup it would read `shelf.tflw` line 4, `capture body.name as shelfName`.
  const ping = steps.find((s) => s.kind === 'api' && s.line === 4 && s.source === 'api GET /ping');
  assert.ok(ping, `local()'s step reads the caller's line 4 — got ${JSON.stringify(steps.map((s) => [s.line, s.source, s.file]))}`);
  assert.equal(ping.file, undefined);
  // `local()` is called from inside `pingLocal`, whose own step is the imported file's line 8.
  assert.ok(steps.some((s) => s.kind === 'call' && s.line === 8 && s.source === 'local()' && s.file === 'shared/shelf.tflw'));
});

test("the stream files an action's steps under the calling test, never a test of its own", async () => {
  const { events } = await run();
  const stepTests = new Set(events.flatMap((e) => (e.type === 'step:end' ? [e.test] : [])));
  // Before: `{ 'readShelf(...)', 'pingLocal(...)', 'local(...)', 'reads the shelf' }`.
  assert.deepEqual([...stepTests], ['reads the shelf']);
  const streamed = events.flatMap((e) => (e.type === 'step:end' ? [e.step] : []));
  assert.ok(streamed.some((s) => s.file === 'shared/shelf.tflw' && s.source === 'api GET /items/{id}'), 'the streamed step carries its file too');
});
