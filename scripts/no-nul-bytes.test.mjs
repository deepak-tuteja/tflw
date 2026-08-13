// M130b1 (`M130-03`) — no text file in this tree may contain a raw NUL byte.
//
// WHY THIS IS A TEST AND NOT A NOTE. `M128b` committed a raw NUL into `interpreter.ts` as the
// separator in a dedup key. The runtime behaviour was correct — the byte and the escape are the
// same character — but the file became *binary* to `grep`, and this `grep` (ugrep 7.5.0) then
// suppressed every match in every mode, printing nothing and exiting **1**, which is the exit code
// for an honest no-match. So a search over the runtime's largest file silently returned "no
// matches" for symbols that were there, and read as "M128b shipped a rule pack the interpreter
// never calls". It is called twice.
//
// The note that was supposed to prevent recurrence did not. While *fixing* the defect, the same
// byte was reintroduced three separate times into the prose describing it — the ledger row, the
// milestone entry, and the plan for the fix — because the character is invisible in every editor,
// every `git diff`, and every review path a human uses. A defect nobody can see is not one anybody
// remembers to check for; it needs a machine.
//
// AND `grep` CANNOT BE THAT MACHINE. Measured on this repo: `REVIEW_FINDINGS.md` carries NULs at
// byte 456,641 of 531,918 and greps perfectly; a 39 KB file with one at line 51 was silently
// blind. That is consistent with ugrep sampling only a first buffer (~256 KB) to decide whether a
// file is binary. So the same defect is visible or invisible depending on nothing but where in the
// file it landed, and a *working* grep is no evidence a file is clean. Only a byte scan settles it,
// which is what this test does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// A denylist rather than an allowlist, on purpose: a new *text* extension must be covered the day
// it appears, and the cost of getting that wrong is a false failure someone reads, not a defect
// that ships silently. Every entry here is a format whose bytes are meant to be arbitrary.
const BINARY_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.pdf', '.woff', '.woff2', '.ttf', '.eot', '.zip', '.gz', '.tgz']);

// Only consulted by the fallback walk; `git ls-files` already excludes all of these.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', 'report', 'report-by-phase', 'runs', '.venv', '.vscode-test']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const f = join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (e.isFile()) out.push(relative(ROOT, f));
  }
  return out;
}

/**
 * The file set to scan, and *how* it was obtained.
 *
 * `git ls-files` is preferred: it is exactly the set that can be committed, which is what this
 * gate is protecting. But the tree is also executed somewhere without a `.git` at all — the
 * Fedora offload box receives an rsync of the working tree, and `git ls-files` there fails with
 * "not a git repository", which is how the first version of this test went red for a reason that
 * had nothing to do with NUL bytes.
 *
 * So there is a fallback, and it is a real scan rather than a skip. A test that quietly checks
 * nothing when its preferred instrument is unavailable is the vacuous-pass shape this very
 * milestone exists to close. The fallback set is slightly *wider* (it can include files git would
 * ignore), which is the safe direction to be wrong in.
 */
function scanSet() {
  try {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
    if (files.length) return { files, source: 'git ls-files' };
  } catch {
    // not a git repository, or git is absent — fall through
  }
  return { files: walk(ROOT), source: 'filesystem walk' };
}

test('no text file in the tree contains a raw NUL byte', () => {
  const { files, source } = scanSet();
  const offenders = [];

  for (const rel of files) {
    if (BINARY_EXT.has(extname(rel).toLowerCase())) continue;

    let buf;
    try {
      buf = readFileSync(join(ROOT, rel));
    } catch {
      continue; // a submodule entry, a symlink, or a path removed mid-scan
    }

    const at = buf.indexOf(0);
    if (at === -1) continue;

    let count = 0;
    for (const b of buf) if (b === 0) count++;
    const line = buf.subarray(0, at).toString('utf8').split('\n').length;
    offenders.push(`${rel}:${line} — ${count} NUL byte${count === 1 ? '' : 's'} (first at byte ${at})`);
  }

  assert.deepEqual(
    offenders,
    [],
    `raw NUL bytes found via ${source}:\n  ${offenders.join('\n  ')}\n\n` +
      'A NUL makes the file binary to grep, which then suppresses matches silently. Write the\n' +
      'escape instead of the byte. To find them without grep (which cannot see them):\n' +
      "  node -e 'console.log(require(\"fs\").readFileSync(process.argv[1]).filter(b=>b===0).length)' <file>",
  );
});

test('the scan reaches the file the defect lived in, by either route', () => {
  // A guard on the guard. An empty file list, or a denylist that grew until it swallowed `.ts`,
  // would both make the test above pass by checking nothing. Name the specific file, and assert
  // the set is substantial, so a scan that collapses to a handful of paths is a failure rather
  // than a green.
  const { files, source } = scanSet();
  assert.ok(files.length > 100, `${source} produced only ${files.length} files — too few to be a real scan`);
  assert.ok(
    files.includes(join('packages', 'runtime', 'src', 'interpreter.ts')),
    `interpreter.ts — the file M130-03 was found in — is not in the set produced by ${source}`,
  );
  assert.ok(!BINARY_EXT.has('.ts'), '.ts must never be treated as binary');
});
