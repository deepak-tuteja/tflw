// `M147c` (`M140-03`) — the join between `resolveImportedActions` and `TF073`, over real files.
//
// `packages/lang/test/importedCalls.test.ts` decides what the checker *does* with the answer. It
// cannot decide whether the answer is ever produced: `@tflw/lang` does no I/O, so every test there
// hands `importsWithErrors` in by hand and would stay green if this resolver went back to throwing
// the fact away — which is precisely the defect `M140-03` is about, one field over from the
// `body`-on-the-floor defect `M109` fixed in this same function. So this file runs the whole check
// the way `tflw check` runs it: parse, resolve off disk, then the composed pass list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource, checkProgram, Codes } from '@tflw/lang';
import { resolveImportedActions } from '../src/imports.js';

/** Writes every `[name, source]` beside an entry file and returns both halves of the resolution
 *  plus the diagnostics the composed pass list produces from them. */
async function resolve(entry: string, files: readonly (readonly [string, string])[]): Promise<{
  actions: Awaited<ReturnType<typeof resolveImportedActions>>['actions'];
  unparseable: readonly string[];
  diagnostics: ReturnType<typeof checkProgram>;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-import-errors-'));
  try {
    const file = join(dir, 'entry.tflw');
    await writeFile(file, entry);
    for (const [name, source] of files) await writeFile(join(dir, name), source);
    const { program, diagnostics } = parseSource(entry);
    assert.deepEqual(diagnostics, [], 'the entry fixture must parse cleanly');
    const imports = await resolveImportedActions(file, program);
    return {
      actions: imports.actions,
      unparseable: [...imports.unparseable],
      diagnostics: checkProgram(program, { importedActions: imports.actions, importsWithErrors: imports.unparseable }),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const ENTRY = 'import "./other.tflw"\n\ntest "t"\n  api GET /a\n  expect status equals 200\n';
const BROKEN = 'action fetchOrder(id)\n  api GET /o headerz "x"\n';

test('an import whose target does not parse reaches `TF073` (M140-03)', async () => {
  const { unparseable, diagnostics } = await resolve(ENTRY, [['other.tflw', BROKEN]]);
  assert.deepEqual(unparseable, ['./other.tflw']);
  const reported = diagnostics.filter((d) => d.code === Codes.IMPORT_PARSE_ERRORS);
  assert.equal(reported.length, 1, JSON.stringify(diagnostics, null, 2));
  assert.match(reported[0]!.message, /"\.\/other\.tflw" does not parse/);
});

test('the world stays unknown, so no name is called unknown on the strength of half a resolution', async () => {
  // The property that has always been right and must survive the change: a broken import means
  // `actions: undefined`, and `checkCalls` then asks no negative question. Both answers come from
  // one walk, and this asserts they agree.
  const entry = 'import "./other.tflw"\n\ntest "t"\n  whatever()\n';
  const { actions, diagnostics } = await resolve(entry, [['other.tflw', BROKEN]]);
  assert.equal(actions, undefined);
  assert.deepEqual(diagnostics.filter((d) => d.code === Codes.UNKNOWN_CALL), []);
});

test('NEGATIVE — an import that parses reports nothing and resolves its actions', async () => {
  const { actions, unparseable, diagnostics } = await resolve(ENTRY, [['other.tflw', 'action fetchOrder(id)\n  api GET /o\n']]);
  assert.deepEqual(unparseable, []);
  assert.deepEqual(actions?.map((a) => a.name), ['fetchOrder']);
  assert.deepEqual(diagnostics.filter((d) => d.code === Codes.IMPORT_PARSE_ERRORS), []);
});

test('NEGATIVE — an import naming nothing at all is left to `TF043`', async () => {
  // The two sets are disjoint by construction. A missing file is `resolveMissingFiles`' answer and
  // reporting it here as well would be two diagnostics for one typo — so `unparseable` stays empty
  // while the world still goes unknown.
  const { actions, unparseable, diagnostics } = await resolve('import "./missing.tflw"\n\ntest "t"\n  api GET /a\n  expect status equals 200\n', []);
  assert.deepEqual(unparseable, []);
  assert.equal(actions, undefined);
  assert.deepEqual(diagnostics.filter((d) => d.code === Codes.IMPORT_PARSE_ERRORS), []);
});

test('both broken imports are named, not just the first', async () => {
  // BREAK MEASURED: the previous implementation returned on the first failure, so a file with two
  // broken imports told you about them one run at a time.
  const entry = 'import "./a.tflw"\nimport "./b.tflw"\n\ntest "t"\n  api GET /a\n  expect status equals 200\n';
  const { unparseable, diagnostics } = await resolve(entry, [['a.tflw', BROKEN], ['b.tflw', BROKEN]]);
  assert.deepEqual(unparseable.sort(), ['./a.tflw', './b.tflw']);
  assert.equal(diagnostics.filter((d) => d.code === Codes.IMPORT_PARSE_ERRORS).length, 2);
});

test('a warning in the imported file is not an error, and does not unmake the world', async () => {
  // The filter is on `severity === 'error'`, matching what `buildRegistry` refuses to run. A
  // deprecation warning in a library file must not make every importer of it fail to check —
  // that would make `tflw migrate`'s own input unrunnable, which is decision 38's whole shape.
  const deprecated = 'action fetchOrder(id)\n  api GET /o\n  expect status equals 200\n';
  const { actions, unparseable } = await resolve(ENTRY, [['other.tflw', deprecated]]);
  assert.deepEqual(unparseable, []);
  assert.equal(actions?.length, 1);
});

test('the transitive-dependency case reaches `TF037` through real files (A4-21)', async () => {
  // The row verbatim, over the three files it was filed with: `entry` imports `orders`, which
  // imports `helpers` and calls `makeId`. `import` does not recurse, so the run dies on the first
  // step; before this the check said `no problems found` on its way past.
  const orders = 'import "./helpers.tflw"\n\naction createOrder(sku)\n  makeId("ord")\n  api GET /orders/{sku}\n  expect status equals 200\n';
  const entry = 'import "./orders.tflw"\n\ntest "t"\n  createOrder("abc")\n';
  const { diagnostics } = await resolve(entry, [
    ['orders.tflw', orders],
    ['helpers.tflw', 'action makeId(prefix)\n  let id = "{prefix}-1"\n'],
  ]);
  const unknown = diagnostics.filter((d) => d.code === Codes.UNKNOWN_CALL);
  assert.equal(unknown.length, 1, JSON.stringify(diagnostics, null, 2));
  assert.match(unknown[0]!.message, /imported action "createOrder" calls `makeId\(\.\.\.\)`/);
});

test('NEGATIVE — the library file checked on its own is clean', async () => {
  // Its own `import` resolves `makeId`, so nothing is wrong with it and nothing is said about it.
  // The dependency is only missing from the file that imports it *without* the helper — which is
  // why the diagnostic goes on the importer's `import` line and not in the library.
  const orders = 'import "./helpers.tflw"\n\naction createOrder(sku)\n  makeId("ord")\n  api GET /orders/{sku}\n  expect status equals 200\n';
  const { diagnostics } = await resolve(orders, [['helpers.tflw', 'action makeId(prefix)\n  let id = "{prefix}-1"\n']]);
  assert.deepEqual(diagnostics.filter((d) => d.code === Codes.UNKNOWN_CALL), []);
});
