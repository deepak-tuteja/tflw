// `M192b` (`M192-03`): a run owns `report/` whole — the members it writes only sometimes are
// removed before it writes anything, so nothing from the run before reads as this run's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RUN_OWNED_CONDITIONAL_MEMBERS, clearRunOwnedMembers } from '../src/report-dir.js';

test('every conditional member is removed; runs/, the unconditional members and a user\'s own file stay', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-report-dir-'));
  try {
    await writeFile(join(dir, 'findings.sarif'), '{}');
    await writeFile(join(dir, 'events.ndjson'), '');
    await mkdir(join(dir, 'assets', 'screenshots'), { recursive: true });
    await writeFile(join(dir, 'assets', 'screenshots', 'a.png'), 'png');
    await mkdir(join(dir, 'authz-repro'), { recursive: true });
    await writeFile(join(dir, 'authz-repro', 'x.tflw'), '');
    await mkdir(join(dir, 'input-repro'), { recursive: true });
    // What must survive: the page's kept runs, the unconditional members (they are overwritten by
    // the run, not cleared — a crash between clear and write must not leave nothing), and a file
    // tflw never wrote.
    await mkdir(join(dir, 'runs', 'r1'), { recursive: true });
    await writeFile(join(dir, 'runs', 'r1', 'results.json'), '{}');
    await writeFile(join(dir, 'results.json'), '{}');
    await writeFile(join(dir, 'notes.md'), 'mine');

    await clearRunOwnedMembers(dir);

    assert.deepEqual((await readdir(dir)).sort(), ['notes.md', 'results.json', 'runs']);
    assert.equal(await readFile(join(dir, 'runs', 'r1', 'results.json'), 'utf8'), '{}');
    // The list is the contract: five names, each of them something a run writes only sometimes.
    assert.deepEqual([...RUN_OWNED_CONDITIONAL_MEMBERS], ['findings.sarif', 'events.ndjson', 'assets/', 'authz-repro/', 'input-repro/']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a report directory that does not exist yet is not an error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-report-dir-none-'));
  try {
    await clearRunOwnedMembers(join(dir, 'report'));
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
