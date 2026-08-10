// M123 — the crash journal, tested. `M118-03`/`M111-02`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { applyJournal, clearJournal, journalPath, openJournalWarning, readJournal, writeJournal } from './mutation-journal.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function sandbox() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tflw-journal-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('journalPath goes inside .git where there is one, and somewhere gitignored where there is not', () => {
  // Both branches are load-bearing and both get exercised for real. The Fedora offload box runs
  // from an **rsync'd copy with no `.git`** (`scripts/exec.mjs` syncs the tree, not the repository),
  // so the fallback is not a defensive nicety — it is the path taken on every remote gate run. The
  // first version of this test asserted only the `.git` branch and went red there while passing
  // locally, which is the useful direction: it told us where the journal actually lives on the box.
  const before = process.env.TFLW_MUTATE_JOURNAL;
  delete process.env.TFLW_MUTATE_JOURNAL;
  try {
    let gitDir;
    try {
      gitDir = spawnSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: path.dirname(HERE), encoding: 'utf8' });
    } catch {
      gitDir = { status: 1 };
    }
    const p = journalPath();
    if (gitDir.status === 0 && gitDir.stdout.trim()) {
      assert.match(p, /\.git[/\\]tflw-mutate-journal\.json$/, 'a checkout must put the journal where `git add -f` cannot reach it');
    } else {
      assert.match(p, /[/\\]\.tflw-mutate-journal\.json$/, 'a copy with no .git must still put the journal somewhere named and ignored');
      // And that name must actually be ignored, or the fallback re-creates the very hazard the
      // `.git` location exists to remove: a mutation's original contents, committable.
      const ignore = readFileSync(path.join(path.dirname(HERE), '.gitignore'), 'utf8');
      assert.match(ignore, /^\.tflw-mutate-journal\.json$/m);
    }
  } finally {
    if (before !== undefined) process.env.TFLW_MUTATE_JOURNAL = before;
  }
});

test('the fallback journal name is gitignored, on every machine', () => {
  // Asserted unconditionally as well as inside the branch above, because the branch that checks it
  // is the one that does NOT run on a developer's checkout — so on the machine where someone would
  // notice, nothing would be checking.
  const ignore = readFileSync(path.join(path.dirname(HERE), '.gitignore'), 'utf8');
  assert.match(ignore, /^\.tflw-mutate-journal\.json$/m);
});

test('TFLW_MUTATE_JOURNAL overrides the location, so the repair path can be watched running', () => {
  const before = process.env.TFLW_MUTATE_JOURNAL;
  process.env.TFLW_MUTATE_JOURNAL = '/somewhere/else.json';
  try {
    assert.equal(journalPath(), '/somewhere/else.json');
  } finally {
    if (before === undefined) delete process.env.TFLW_MUTATE_JOURNAL;
    else process.env.TFLW_MUTATE_JOURNAL = before;
  }
});

test('write → read → clear is a round trip, and clear on a missing journal is not an error', () => {
  const { dir, cleanup } = sandbox();
  try {
    const file = path.join(dir, 'journal.json');
    assert.equal(readJournal(file), undefined);
    const entry = { id: 'bom-col', milestone: 'm98d', startedAt: '2026-08-10T00:00:00.000Z', files: { 'a.ts': 'before' } };
    writeJournal(entry, file);
    assert.deepEqual(readJournal(file), entry);
    clearJournal(file);
    assert.equal(readJournal(file), undefined);
    clearJournal(file); // again — a signal handler and the `finally` can both reach this
  } finally {
    cleanup();
  }
});

test('a corrupt journal throws rather than being read as "no journal"', () => {
  // The difference matters: "nothing to repair" would let a sweep baseline against a tree that is
  // still holding the last run's mutation. Every caller catches this and says so by name.
  const { dir, cleanup } = sandbox();
  try {
    const file = path.join(dir, 'journal.json');
    writeFileSync(file, '{ this is not json');
    assert.throws(() => readJournal(file), SyntaxError);
  } finally {
    cleanup();
  }
});

test('applyJournal restores every file it holds and reports which', () => {
  const { dir, cleanup } = sandbox();
  try {
    writeFileSync(path.join(dir, 'src.ts'), 'MUTATED');
    mkdirSync(path.join(dir, 'nested'));
    writeFileSync(path.join(dir, 'nested', 'SPEC.md'), 'REGENERATED FROM THE MUTATION');
    const journal = { files: { 'src.ts': 'original', 'nested/SPEC.md': 'the real spec' } };

    const { restored, problems } = applyJournal(journal, dir);

    assert.deepEqual(problems, []);
    assert.deepEqual(restored.sort(), ['nested/SPEC.md', 'src.ts']);
    assert.equal(readFileSync(path.join(dir, 'src.ts'), 'utf8'), 'original');
    assert.equal(readFileSync(path.join(dir, 'nested', 'SPEC.md'), 'utf8'), 'the real spec');
  } finally {
    cleanup();
  }
});

test('applyJournal skips a file that already matches, so a clean restore does no writes', () => {
  const { dir, cleanup } = sandbox();
  try {
    writeFileSync(path.join(dir, 'src.ts'), 'original');
    const { restored, problems } = applyJournal({ files: { 'src.ts': 'original' } }, dir);
    assert.deepEqual(restored, []);
    assert.deepEqual(problems, []);
  } finally {
    cleanup();
  }
});

test('applyJournal reports a file it could not put back rather than returning quietly', () => {
  // The restore is verified by reading it back (D227). A silent failure here would be the very
  // defect the journal exists to prevent, reached from the inside.
  const { dir, cleanup } = sandbox();
  try {
    const { restored, problems } = applyJournal({ files: { 'never-existed.ts': 'original' } }, dir);
    assert.deepEqual(restored, []);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^never-existed\.ts: /);
  } finally {
    cleanup();
  }
});

test('applyJournal on an empty or absent entry is a no-op, not a crash', () => {
  assert.deepEqual(applyJournal(undefined), { restored: [], problems: [] });
  assert.deepEqual(applyJournal({}), { restored: [], problems: [] });
});

test('openJournalWarning names the mutation, the files and the fact that a commit is unsafe', () => {
  const warning = openJournalWarning(
    { id: 'log-file-mkdir', milestone: 'm111', startedAt: '2026-08-10T09:00:00.000Z', files: { 'packages/cli/src/cli.ts': 'x' } },
    '/repo/.git/tflw-mutate-journal.json',
  );
  assert.match(warning, /log-file-mkdir/);
  assert.match(warning, /packages\/cli\/src\/cli\.ts/);
  assert.match(warning, /Do not commit/);
  assert.equal(openJournalWarning(undefined), undefined);
});

test('the root `npm test` refuses to run while a sweep holds the tree (M111-02)', () => {
  // The journal's second consumer, and the reason it is a module of its own. `mutate.mjs` rewrites
  // tracked sources in place for as long as each suite takes; `M111`'s commit `1cdefdc` was made
  // inside that window and captured a mutated `cli.ts`. The window cannot be closed — the suite has
  // to run against the real tree — but the gate people run *before* committing can refuse to hand
  // out a green while it is open.
  //
  // The guard sits before the spawn, so this costs milliseconds rather than a full suite run.
  const { dir, cleanup } = sandbox();
  try {
    const file = path.join(dir, 'journal.json');
    writeJournal({ id: 'log-file-mkdir', milestone: 'm111', startedAt: '2026-08-10T09:00:00.000Z', files: { 'packages/cli/src/cli.ts': 'x' } }, file);
    const r = spawnSync(process.execPath, [path.join(HERE, 'verify-test-counts.mjs')], {
      cwd: path.dirname(HERE),
      encoding: 'utf8',
      env: { ...process.env, TFLW_MUTATE_JOURNAL: file },
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /log-file-mkdir/);
    assert.match(r.stderr, /Do not commit/);
    assert.doesNotMatch(r.stdout, /test:raw/, 'the guard must fire before any suite is spawned');
  } finally {
    cleanup();
  }
});

test('a journal survives a file being made read-only — the problem is reported, not thrown', () => {
  const { dir, cleanup } = sandbox();
  try {
    const target = path.join(dir, 'src.ts');
    writeFileSync(target, 'MUTATED');
    chmodSync(target, 0o444);
    const { problems } = applyJournal({ files: { 'src.ts': 'original' } }, dir);
    // Root can write through a read-only bit, so this asserts the two acceptable outcomes rather
    // than one: either the write was refused and named, or it succeeded. What must never happen is
    // an uncaught throw that abandons the remaining files in the journal.
    assert.ok(problems.length === 1 || readFileSync(target, 'utf8') === 'original');
    if (existsSync(target)) chmodSync(target, 0o644);
  } finally {
    cleanup();
  }
});
