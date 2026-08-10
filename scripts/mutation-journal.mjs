// The mutation journal — what `scripts/mutate.mjs` has rewritten on disk right now, and what it
// was before. `M123` (`M118-03`, `M111-02`).
//
// `mutate.mjs` edits **tracked sources in place**. It is only allowed to do that on the promise
// that it puts them back, and until this milestone the promise was a `finally` holding the original
// in a closure — which covers exactly one way to die, an exception. Measured on a clean tree at
// `466d654`, polling the target until the mutation was actually on disk and then signalling:
//
//     SIGINT  at 0.7s  → lexer.ts restored? false   git status: "M packages/lang/src/lexer.ts"
//     SIGKILL at 0.6s  → lexer.ts restored? false   git status: "M packages/lang/src/lexer.ts"
//
// and the residue was
//
//     -    const bomCol = lineStart === 0 && line[0] === BOM ? 1 : 0;
//     +    const bomCol = 0;
//
// which is the whole problem in two lines: a mutation is by construction small, syntactically
// valid and plausible, so it survives a skim of `git diff`, it compiles, and it reads as a
// simplification someone made on purpose. Three occurrences are on the record — `M111` *committed*
// one (`1cdefdc`, the `mkdirSync` line `B6-05` had just added), `M118` filed the row after leaving
// one in `cli.ts`, and `M122` left one in `interpreter.ts` after an `import()` of `mutate.mjs` ran
// a sweep by accident.
//
// So the original goes to **disk** before the source is touched, and the record is removed only
// after the restore has been read back and verified. This module is separate from `mutate.mjs` for
// one reason: it has a second consumer. The journal is also a **sentinel** — root `npm test`
// refuses to run while one is open (`M111-02`), because a suite run against a deliberately-wrong
// tree produces a green that means nothing, or a red that belongs to someone else.
//
// WHY INSIDE `.git`. It cannot be committed even deliberately (`git add -f` will not add a path
// under `.git`), it never appears in `git status`, it is per-worktree without any bookkeeping, and
// it cannot ride along in an `npm pack`. The alternative — a dotfile at the repo root plus a
// `.gitignore` line — is one forgotten `git add -A` away from being the very thing this file
// exists to prevent.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * Where the journal lives.
 *
 * `TFLW_MUTATE_JOURNAL` overrides it, for the same reason `M112` gave `TFLW_MUTATE_TIMEOUT_MS` an
 * override: **a repair path nobody has ever watched run is a claim, not a control.** The tests use
 * it; so can anyone reproducing a report.
 */
export function journalPath() {
  if (process.env.TFLW_MUTATE_JOURNAL) return process.env.TFLW_MUTATE_JOURNAL;
  try {
    const gitDir = execFileSync('git', ['rev-parse', '--absolute-git-dir'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (gitDir) return path.join(gitDir, 'tflw-mutate-journal.json');
  } catch {
    // Not a git checkout — a tarball, or a vendored copy. Fall through to the repo root, where the
    // `.gitignore` entry covers it.
  }
  return path.join(ROOT, '.tflw-mutate-journal.json');
}

/**
 * Is the process that wrote a journal still running? (`M123-03`)
 *
 * Signal 0 checks for existence without delivering anything. `EPERM` means the process exists and
 * belongs to someone else, which for this purpose is still "alive"; only `ESRCH` means gone.
 *
 * PID reuse is real and is deliberately resolved in the cautious direction: a recycled pid makes
 * this say "alive", so the tool refuses to start and asks a human, rather than repairing over a
 * sweep that is mid-suite. Refusing costs a message; guessing wrong costs the thing this whole
 * module exists to prevent.
 */
export function isProcessAlive(pid) {
  if (typeof pid !== 'number') return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** @returns {{id: string, milestone: string, pid: number, startedAt: string, files: Record<string,string>} | undefined} */
export function readJournal(file = journalPath()) {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function writeJournal(entry, file = journalPath()) {
  writeFileSync(file, JSON.stringify(entry, null, 1));
}

export function clearJournal(file = journalPath()) {
  if (existsSync(file)) rmSync(file);
}

/**
 * Put every file in a journal entry back the way it was, and **read each one back to check**.
 *
 * The read-back is not defensive padding: a restore that silently failed would be precisely the
 * defect this whole mechanism exists to prevent, reached from the inside. Files already matching
 * their original are skipped rather than rewritten, so a normal `finally` restore after a run that
 * changed nothing does no I/O and cannot introduce a mtime change of its own.
 */
export function applyJournal(journal, root = ROOT) {
  const restored = [];
  const problems = [];
  for (const [rel, original] of Object.entries(journal?.files ?? {})) {
    const abs = path.join(root, rel);
    try {
      if (readFileSync(abs, 'utf8') === original) continue;
      writeFileSync(abs, original);
      if (readFileSync(abs, 'utf8') === original) restored.push(rel);
      else problems.push(`${rel}: written back, but the file on disk still differs`);
    } catch (err) {
      problems.push(`${rel}: ${err.message}`);
    }
  }
  return { restored, problems };
}

/**
 * The message a second consumer prints when it finds an open journal, or `undefined` when the tree
 * is its own.
 *
 * Shared so that `mutate.mjs` and `verify-test-counts.mjs` describe the same situation the same
 * way. `M111-02`'s worked example is what this text has to be good enough to prevent: `M111`'s
 * commit captured a mutated `cli.ts`, the tell was a `git status` showing one tracked file modified
 * after a clean commit with the diff running the wrong way, and it was caught by reading that diff
 * rather than by any check.
 */
export function openJournalWarning(journal, file = journalPath()) {
  if (!journal) return undefined;
  const files = Object.keys(journal.files ?? {}).join(', ');
  return (
    `a mutation sweep has \`${journal.id}\` (${journal.milestone}) applied to this working tree, ` +
    `started ${journal.startedAt ?? 'at an unknown time'}.\n` +
    `    Affected: ${files}\n` +
    `    Either a sweep is running in another terminal, or one died without restoring.\n` +
    `    Do not commit from this tree until it clears: \`node scripts/mutate.mjs --list\` repairs a ` +
    `stale journal on startup, and\n    ${file} is the only record of the original.`
  );
}
