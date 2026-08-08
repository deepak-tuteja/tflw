// M109 (review row `M97d-01`) — the wiring between `resolveImportedActions` and `TF044`.
//
// `packages/lang/test/actionCycles.test.ts` decides what the cycle pass *does* with an imported
// body. It cannot decide whether one ever arrives: `@tflw/lang` does no I/O and cannot import the
// resolver, so every test over there builds the `KnownAction[]` by hand and would stay green if
// `resolveImportedActions` went back to dropping `body` on the floor — which is exactly the defect
// this row is about. This file is the join, over real files on disk, through the same composed
// `checkProgram` the CLI and the language server call.
//
// The mutation `imports-drop-body` in `scripts/mutate.mjs` is the standing check that this file can
// still fail: it removes the one field the resolver now carries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource, checkProgram, Codes } from '@tflw/lang';
import { resolveImportedActions } from '../src/imports.js';

/** Writes `other.tflw` beside an entry file and runs the whole check the way `tflw check` does:
 * parse, resolve the imports off disk, then the composed pass list. */
async function checkWithImports(entry: string, other: string): Promise<ReturnType<typeof checkProgram>> {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-import-cycle-'));
  try {
    const file = join(dir, 'entry.tflw');
    await writeFile(file, entry);
    await writeFile(join(dir, 'other.tflw'), other);
    const { program, diagnostics } = parseSource(entry);
    assert.deepEqual(diagnostics, [], 'the entry fixture must parse cleanly');
    return checkProgram(program, { importedActions: await resolveImportedActions(file, program) });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('the resolver carries imported bodies far enough for `TF044` to close a cross-file cycle', async () => {
  const diags = await checkWithImports('import "./other.tflw"\n\naction a()\n  b()\n\ntest "t"\n  a()\n', 'action b()\n  a()\n');
  const cycles = diags.filter((d) => d.code === Codes.CALL_CYCLE);
  assert.equal(cycles.length, 1, JSON.stringify(diags, null, 2));
  assert.match(cycles[0]!.message, /`a → b → a`/);
  // Line 4 of the entry file: the local `b()`, which is the only line here that can be underlined.
  assert.equal(cycles[0]!.span.start.line, 4);
  assert.match(cycles[0]!.hint ?? '', /imported from "\.\/other\.tflw"/);
});

test('an imported action that does not call back is clean', async () => {
  // NEGATIVE CONTROL. Identical wiring, one line different in the imported file — without it, a
  // pass that flagged every resolved import would pass the test above.
  const diags = await checkWithImports('import "./other.tflw"\n\naction a()\n  b()\n\ntest "t"\n  a()\n', 'action b()\n  api GET /x\n');
  assert.deepEqual(diags, []);
});

test('an unreadable import leaves the cycle undecided rather than guessed at', async () => {
  // NEGATIVE CONTROL for the `undefined` world. The import names a file that is not there, so the
  // resolver returns `undefined` and the pass sees no imported bodies at all. The missing file is
  // `TF043`'s to report — this asserts only that no cycle is invented in its place.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-import-cycle-'));
  try {
    const file = join(dir, 'entry.tflw');
    const source = 'import "./missing.tflw"\n\naction a()\n  b()\n\ntest "t"\n  a()\n';
    await writeFile(file, source);
    const { program } = parseSource(source);
    const diags = checkProgram(program, { importedActions: await resolveImportedActions(file, program) });
    assert.deepEqual(diags.filter((d) => d.code === Codes.CALL_CYCLE), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
