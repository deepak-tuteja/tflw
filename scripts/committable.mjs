/**
 * The files a commit taken right now would contain — one enumerator for every record gate.
 *
 * `M186-01` / `D967`. Each record gate used to read `git ls-files`, which is the INDEX: a brand-new
 * file joins that corpus at `git add`, not when it is written. So `M186` ran every record gate
 * green, staged, committed, and the gate went red on the very next run — on `M186`'s own new file.
 * CI is structurally unable to be the backstop, because the demand half needs the gitignored
 * records (`D668`, `D683`, `D859`), so this is a developer-machine discipline, and a discipline
 * that depends on the ORDER of two commands is the kind that fails silently and then recurs on
 * every milestone that adds a gate — the class of file most likely to cite an identifier.
 *
 * The corpus is therefore *the tree that will be committed*: the index (`--cached`) plus every
 * untracked file that is not ignored (`--others --exclude-standard`). The gitignored records
 * (`PLAN*`, `REVIEW_*`) stay out by exactly the rule that keeps them out of a commit. An untracked
 * scratch file citing a bad identifier turns a gate red *before* staging, and the gate names it as
 * untracked — the right signal: scratch belongs in the scratchpad, and anything else is about to be
 * committed.
 *
 * The row's own candidate — *name* the unread untracked files and stay green — is refused as the
 * weaker half: a run that says "I skipped X" and exits 0 is still green, and green is what gets
 * trusted (`D527`, `D859`).
 *
 * Deleted-but-still-tracked files are listed exactly as they always were (`--cached` is what
 * `ls-files` did before); out of scope and unchanged.
 *
 * This throws when git cannot answer, and every caller wraps that in its own sentence, because the
 * sentence differs by gate (`D880`: an unenumerable corpus must not report as an empty one). The
 * offload driver's copy of this tree has no `.git/` (`scripts/exec.mjs`), so every gate on this
 * enumerator runs on the Mac.
 */
import { execFileSync } from 'node:child_process';

const OPTS = (root) => ({ cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });

function list(root, args) {
  return execFileSync('git', ['ls-files', '-z', ...args], OPTS(root)).split('\0').filter(Boolean);
}

/**
 * @param {string} root
 * @param {string[]} [pathspec] e.g. `['*.md']`; applied to both halves
 * @returns {{ paths: string[], tracked: number, untracked: string[] }} `paths` is tracked first,
 *   then untracked, each half in git's order; `untracked` is the second half by name so a gate can
 *   say which of its findings are in files that are not yet staged.
 */
export function committableFiles(root, pathspec = []) {
  const tracked = list(root, ['--cached', ...pathspec]);
  const untracked = list(root, ['--others', '--exclude-standard', ...pathspec]);
  return { paths: [...tracked, ...untracked], tracked: tracked.length, untracked };
}

/** `544 tracked + 1 untracked` — the phrase every gate prints beside its corpus count. */
export function describeCorpus({ tracked, untracked }) {
  return `${tracked} tracked + ${untracked.length} untracked`;
}
