// `D967` — the enumerator behind every record gate. Tested in a throwaway repository because the
// three claims it makes are about git's answer, not about parsing: the index is read, an untracked
// file that is not ignored is read, and an ignored file is not. The not-a-repository case throws
// rather than answering with an empty list (`D880`).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { committableFiles, describeCorpus } from './committable.mjs';

const temps = [];
after(() => { for (const t of temps) rmSync(t, { recursive: true, force: true }); });

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'tflw-committable-'));
  temps.push(dir);
  execFileSync('git', ['init', '-q'], { cwd: dir });
  writeFileSync(join(dir, '.gitignore'), 'ignored/\n*.log\n', 'utf8');
  writeFileSync(join(dir, 'tracked.md'), '# tracked\n', 'utf8');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'tracked.ts'), '// tracked\n', 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  // Everything below is written AFTER the add: the exact shape `M186-01` filed.
  writeFileSync(join(dir, 'src', 'new.ts'), '// untracked\n', 'utf8');
  writeFileSync(join(dir, 'new.md'), '# untracked\n', 'utf8');
  mkdirSync(join(dir, 'ignored'));
  writeFileSync(join(dir, 'ignored', 'scratch.ts'), '// ignored by directory\n', 'utf8');
  writeFileSync(join(dir, 'run.log'), 'ignored by pattern\n', 'utf8');
  return dir;
}

test('the corpus is the index plus the untracked files that are not ignored, in that order', () => {
  const c = committableFiles(repo());
  assert.deepEqual(c.paths, ['.gitignore', 'src/tracked.ts', 'tracked.md', 'new.md', 'src/new.ts']);
  assert.equal(c.tracked, 3);
  assert.deepEqual(c.untracked, ['new.md', 'src/new.ts']);
  assert.equal(describeCorpus(c), '3 tracked + 2 untracked');
});

test('a pathspec narrows both halves', () => {
  const c = committableFiles(repo(), ['*.md']);
  assert.deepEqual(c.paths, ['tracked.md', 'new.md']);
  assert.equal(describeCorpus(c), '1 tracked + 1 untracked');
});

test('a directory that is not a repository throws rather than answering with nothing (D880)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tflw-not-a-repo-'));
  temps.push(dir);
  assert.throws(() => committableFiles(dir));
});
