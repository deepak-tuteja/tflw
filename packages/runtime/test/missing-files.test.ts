// M97c (`PLAN_M97_CHECKER_CONTRACT.md`, D144) — `A4-07`: the I/O half of `TF043`.
//
// `@tflw/lang` decides *what* to report and `@tflw/runtime` decides *what is there*. The split
// exists so the docs-site editor demo can keep running the real checker in a browser; the property
// that makes it correct lives here, and it is the one thing this file is really about:
//
//   **`resolveMissingFiles` must resolve a path exactly as the interpreter does.**
//
// A checker that resolved differently would report files as missing that the run then finds — not a
// stricter checker but a broken one, and D137 clause 1's own failure mode.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource } from '@tflw/lang';
import { resolveMissingFiles } from '../src/imports.js';

const program = (source: string) => {
  const parsed = parseSource(source);
  assert.deepEqual(parsed.diagnostics, [], `fixture did not parse: ${source}`);
  return parsed.program;
};

test('resolves against the directory of the file that names the path, not the cwd', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-missing-'));
  try {
    await mkdir(join(dir, 'tests'), { recursive: true });
    await mkdir(join(dir, 'fixtures'), { recursive: true });
    await writeFile(join(dir, 'fixtures', 'rows.csv'), 'role\nadmin\n');

    const src = `with each from "../fixtures/rows.csv"\ntest "t {role}"\n  api GET /health\n  expect status equals 200\n`;
    const missing = await resolveMissingFiles(join(dir, 'tests', 'suite.tflw'), program(src));
    assert.deepEqual([...missing], [], '`../fixtures/rows.csv` resolves from tests/ and is there');

    // Control: the identical literal, from a file one directory up, resolves somewhere else and is
    // genuinely absent — so the assertion above is about resolution and not about a pass that never
    // reports anything.
    const fromRoot = await resolveMissingFiles(join(dir, 'suite.tflw'), program(src));
    assert.deepEqual([...fromRoot], ['../fixtures/rows.csv']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('every syntax that opens a file is answered, and an interpolated path is left alone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-missing-'));
  try {
    await writeFile(join(dir, 'there.json'), '{}');
    const src = `test "t"
  api POST /x body from "./there.json"
  api POST /y upload "./gone.png" as "f"
  api POST /z upload "./{name}.png" as "f"
`;
    const missing = await resolveMissingFiles(join(dir, 'suite.tflw'), program(src));
    // `./there.json` exists, `./gone.png` does not, and `./{name}.png` is not a question that can
    // be asked before the run picks a `name` — so it must be absent from *both* answers.
    assert.deepEqual([...missing], ['./gone.png']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the existence probe is injectable, so the language server can answer from an unsaved buffer', async () => {
  const asked: string[] = [];
  const missing = await resolveMissingFiles('/project/tests/suite.tflw', program(`import "./shared/orders.tflw"\ntest "t"\n  api GET /health\n  expect status equals 200\n`), async (absPath) => {
    asked.push(absPath);
    return true;
  });
  assert.deepEqual([...missing], [], 'a probe that says "yes" must produce no diagnostics');
  assert.deepEqual(asked, ['/project/tests/shared/orders.tflw'], 'and it must be asked the resolved absolute path');
});

test('a path named five times is probed once', async () => {
  let probes = 0;
  const src = `test "t"
  api POST /a body from "./same.json"
  api POST /b body from "./same.json"
  api POST /c body from "./same.json"
`;
  await resolveMissingFiles('/p/suite.tflw', program(src), async () => {
    probes++;
    return false;
  });
  assert.equal(probes, 1, 'deduped by literal text — the checker still reports each occurrence, but the disk is asked once');
});
