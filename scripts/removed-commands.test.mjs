// M144a (`D592`, `D600`) — prose may not name a subcommand this CLI no longer has.
//
// Four of Order 4's six ledger rows are one defect: *prose naming something that no longer exists*.
// `A2-16` is the type — exported AST doc comments still describing `tflw load`, folded into
// `tflw run` by `M53`. The obvious guard for that class was measured and cannot be built:
//
//   · **The milestone-id half is dead.** 1839 milestone-id references across 150+ distinct ids in
//     tracked source, and no tracked authority for any of them — the plan files are gitignored, so
//     nothing in this repo can say whether `M53` exists or what it did. `"M0 lexer/parser"` is not
//     wrong because the id is unknown; it is wrong because the claim beside it is stale. That is
//     semantics, and no vocabulary check reaches it.
//   · **The command half is real but noisy.** Flagging every `tflw <word>` that is not a subcommand
//     needs ~15 allow-list entries of ordinary English on day one (`tflw fragment`, `tflw has`,
//     `tflw itself`, `tflw spells`) to catch one real claim.
//
// So this is a **denylist, not a derivation**. It knows two dead command names and nothing else.
//
// ## Why an allow-list and not a cleverer regex
//
// `verify-contributing.mjs`'s header refuses to check prose, and its reason is exactly right:
// *"checking sentences for keywords cannot tell a claim from a citation."* This repo proves it —
// **all eight** `tflw scan` occurrences are correct *because* they say the command does not exist
// ("that mode stays deleted", "`D364` established that mode will never exist"). A guard that read
// sentences would fail every one of them.
//
// The refusal is answered rather than overridden: **this guard does not read sentences, it reads a
// list somebody maintained.** A human classified each site once and wrote down why; anything
// unlisted fails. Same shape as `verify-contributing.mjs`'s `CLASSIFIED` table and `M141`'s
// resolver allow-list — the honest part of both is that the exceptions are named, not inferred.
//
// ## What it found on its first run
//
// Seven live false claims, and the one that matters least resembled documentation:
// `httpPinned.ts`'s pinned-connection fallback printed **`⚠ tflw load: …` to stderr** — a
// *user-facing* string naming a command removed three milestones before `M53` finished. None of
// Order 4's six rows names it; no row could, because every one of them was filed by reading doc
// comments. Filed as its own row rather than folded in silently.
//
// ## The floor, stated
//
// Counting occurrences per file cannot see a **swap** — delete one honest citation from `cli.ts`
// and add one false claim in the same commit and the count still reads 13. That is a real hole and
// it is left open on purpose: closing it means keying on line content, which turns every reflow of
// a comment into a red build. This is a coverage floor in the same sense `diagnosticsCoverage` and
// `conformance` are floors — it catches the failure that actually happens (somebody writes a new
// sentence about a command that is gone) and not the one nobody has ever committed.
//
// The scan set (`D600`) is tracked `.ts` under `packages/*/src`, the docs-site markdown, and
// `SPEC.md`. A false claim is no less false for being in a `.md`. Note that `scripts/` is
// deliberately *outside* the set — which is the only reason this file may quote the dead names in
// prose without tripping itself. That is an accident of `D600`'s scope, not a design, so a future
// widening of the set has to deal with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The denylist. Two entries, both verified absent from `cli.ts`'s dispatch.
 *
 * A command belongs here the day it is removed. The `why` is not decoration — it is what the
 * failure message hands the next author, who will otherwise reasonably assume the guard is stale.
 */
const REMOVED = [
  { name: 'load', why: '`M50`–`M53` folded it into `tflw run`; a workload-bearing `test` is now dispatched by `run` itself (Phase 2b, D99).' },
  { name: 'scan', why: 'never shipped. `D364`/`D432` killed the proposed mode on evidence; SARIF landed on `tflw run` instead (`M135a`/`M135b`).' },
];

const PATTERN = new RegExp(String.raw`tflw\s+(${REMOVED.map((r) => r.name).join('|')})\b`, 'g');

/**
 * Every site that legitimately names a dead command, with the reason it is legitimate and the
 * number of times it does so.
 *
 * **The count is load-bearing.** A file is not blanket-exempted: the entry claims a number, and a
 * new sentence in an already-listed file fails until somebody bumps it and says why — the shape
 * `conformance.test.ts` already uses ("every row still matches the number of sites it claims, so a
 * deleted throw fails too"). An entry that drifts to zero fails as well, so a citation deleted by a
 * later refactor cannot leave a stale exemption sitting here forever.
 */
const CITATIONS = [
  {
    file: 'SPEC.md',
    command: 'scan',
    count: 3,
    why: 'All three are the spec correcting itself in place — §13.4 records that SARIF was once assigned to a `scan` mode that will never exist, and §15 that the crawl is deliberately not one. Deleting the sentences would delete the correction.',
  },
  {
    file: 'packages/cli/src/cli.ts',
    command: 'load',
    count: 13,
    why: 'Every one is explicitly historical — this file *is* the Phase 2b unification, and its comments document what each flag mirrors from the command that was folded in ("pre-Phase-2b", "no longer exists as its own command", "carried over from"). The `--workers`/`--parallel` distinction is unreadable without that history.',
  },
  {
    file: 'packages/lang/src/ast.ts',
    command: 'load',
    count: 1,
    why: '`CrawlDecl`\'s note citing `M50`–`M53` "collapsing `tflw load` into `tflw run`" as the *evidence* for why a crawl is not a workload kind. The claim is about entry points and needs the example.',
  },
  {
    file: 'packages/lang/src/ast.ts',
    command: 'scan',
    count: 1,
    why: 'The same `CrawlDecl` note stating the crawl is "not a `tflw scan` mode" — a denial, which is the sentence this guard exists to protect rather than flag.',
  },
  {
    file: 'packages/reporter/src/sarif.ts',
    command: 'scan',
    count: 1,
    why: 'Records that `findings.sarif` was originally assigned to a mode `D364` established will never exist. The file header explaining why the reporter hangs off `run` instead.',
  },
  {
    file: 'packages/runtime/src/interpreter.ts',
    command: 'load',
    count: 2,
    why: 'Both past-tense and both about the console-event surface: one says session establishment stays silent "exactly as `tflw load` always was", the other is `B3-08`\'s own fix note recording that a message *used to* name a command `M53` removed.',
  },
  {
    file: 'packages/runtime/src/securityRules.ts',
    command: 'scan',
    count: 2,
    why: 'Two self-corrections, both naming `D432` as what killed the mode — one of them explicitly opens "That sentence was true when it was written and is not now".',
  },
  {
    file: 'packages/runtime/src/tlsProbe.ts',
    command: 'scan',
    count: 1,
    why: 'Records a Tier 3 assumption that was "overtaken twice", `D432` being the first. The history is the point of the comment.',
  },
];

// Only consulted by the fallback walk; `git ls-files` already excludes all of these.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', 'report', 'runs', '.vitepress']);

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
 * `D600`'s three surfaces, minus generated artifacts.
 *
 * **The `.generated.` exclusion is what makes the two routes below agree.** `git ls-files` and the
 * filesystem walk return identical 137-file sets with it and differ by exactly one file without it:
 * `packages/cli/src/docs-data.generated.ts`, which is gitignored (`.gitignore:26`) and which the
 * walk therefore sees and the git route does not. It carries three `tflw scan` occurrences, all
 * inherited from the docs prose it is built from.
 *
 * Excluded rather than allow-listed, and **excluding it costs no coverage**: `gen-docs.mjs`
 * builds it from `SPEC.md`, which is itself in scope, so those three occurrences are the same three
 * sentences this guard already reads at their source. Editing the copy is undone by the next build.
 * Allow-listing it would have been worse than useless — it would pin a count that only one of the
 * two routes can observe, so the entry would read as satisfied on this Mac and as drifted on the
 * box, or the reverse, depending on nothing.
 *
 * The general rule, for whatever generated file appears next: a build product is in scope only if
 * its *source* is not. Check that before adding an exception.
 */
const inScope = (f) =>
  !/\.generated\.[a-z]+$/.test(f) &&
  (/^packages\/[^/]+\/src\/.*\.ts$/.test(f) || (f.startsWith('packages/docs-site/') && f.endsWith('.md')) || f === 'SPEC.md');

/**
 * The files to scan (`D600`), and how the set was obtained.
 *
 * `git ls-files` is preferred: the set that can be committed is the set this guards.
 *
 * **The first version of this had no fallback, and the reasoning behind that was wrong.** It argued
 * that unlike a byte scan there is no wider-but-safe superset, so a failure to enumerate should be
 * a hard error. Both halves are false. The Fedora offload box receives an rsync of the working tree
 * with **no `.git`**, so `git ls-files` there exits non-zero and all three tests below died on it —
 * on the machine this project actually runs its gates on. And a walk *is* the wider-but-safe
 * superset: it can include files git ignores, and scanning an untracked file for a sentence about a
 * dead command costs nothing and can only find more. `no-nul-bytes.test.mjs` had already worked
 * this out and written it down; the mistake was not reading its answer before restating its
 * question.
 *
 * The walk needs `SKIP_DIRS` in a way the git route does not: `packages/docs-site/node_modules`
 * holds thousands of `.md` files that pass the docs-site filter and belong to nobody here.
 */
function scanSet() {
  try {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 })
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
    if (files.length) return { files: files.filter(inScope), source: 'git ls-files' };
  } catch {
    // not a git repository (the offload box), or git is absent — fall through
  }
  return { files: walk(ROOT).filter(inScope), source: 'filesystem walk' };
}

function occurrences() {
  const found = [];
  for (const rel of scanSet().files) {
    let text;
    try {
      text = readFileSync(join(ROOT, rel), 'utf8');
    } catch {
      continue; // removed mid-scan, or a symlink
    }
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(PATTERN)) {
        found.push({ file: rel, command: m[1], line: i + 1, text: lines[i].trim() });
      }
    }
  }
  return found;
}

const key = (file, command) => `${file}${command}`;

test('no unclassified prose names a removed subcommand', () => {
  const listed = new Set(CITATIONS.map((c) => key(c.file, c.command)));
  const unlisted = occurrences().filter((o) => !listed.has(key(o.file, o.command)));

  const why = new Map(REMOVED.map((r) => [r.name, r.why]));
  const detail = unlisted.map((o) => `${o.file}:${o.line} — tflw ${o.command}\n      ${o.text.slice(0, 160)}`);

  assert.deepEqual(
    detail,
    [],
    'prose here names a subcommand that does not exist:\n\n  ' +
      detail.join('\n\n  ') +
      '\n\n' +
      [...new Set(unlisted.map((o) => o.command))].map((c) => `  tflw ${c} — ${why.get(c)}`).join('\n') +
      '\n\nIf the sentence is a CLAIM, fix it: name what the command became.\n' +
      'If it is a CITATION — a sentence that is true precisely because it says the command is gone —\n' +
      "add it to CITATIONS in this file with a written reason, or bump an existing entry's count.\n" +
      'Both are one-line edits. What is not available is leaving it unclassified.',
  );
});

test('every citation entry still matches the number of sites it claims', () => {
  const counted = new Map();
  for (const o of occurrences()) counted.set(key(o.file, o.command), (counted.get(key(o.file, o.command)) ?? 0) + 1);

  const drifted = CITATIONS.filter((c) => (counted.get(key(c.file, c.command)) ?? 0) !== c.count).map(
    (c) => `${c.file} / tflw ${c.command}: entry claims ${c.count}, found ${counted.get(key(c.file, c.command)) ?? 0}`,
  );

  assert.deepEqual(
    drifted,
    [],
    'a CITATIONS entry no longer describes the file it exempts:\n  ' +
      drifted.join('\n  ') +
      '\n\nFound MORE than claimed: a new sentence slipped in under an existing exemption — classify it\n' +
      'and bump the count. Found FEWER (or zero): the citation was deleted or the file moved, and the\n' +
      'exemption is now blanket cover for nothing. Delete the entry.',
  );
});

test('the scan set is real, and reaches all three of the surfaces D600 names', () => {
  // A guard on the guard. Both tests above pass vacuously against an empty file list, and the
  // failure that produces one is mundane — a tightened regex, a directory rename. Name a file from
  // each of D600's three surfaces so a set that collapses to one of them is red rather than green.
  const { files, source } = scanSet();
  assert.ok(files.length > 50, `${source} produced only ${files.length} in-scope files — too few to be a real scan`);
  assert.ok(files.includes('SPEC.md'), `SPEC.md is not in the scan set produced by ${source}`);
  assert.ok(
    files.includes(join('packages', 'lang', 'src', 'ast.ts')),
    `packages/lang/src/ast.ts — the file A2-16 was filed against — is not in the set produced by ${source}`,
  );
  assert.ok(
    files.some((f) => f.startsWith(join('packages', 'docs-site')) && f.endsWith('.md')),
    `no docs-site markdown is in the set produced by ${source}`,
  );
  // The docs-site currently holds ZERO occurrences, so its coverage is correct-but-vacuous today.
  // Asserted here rather than left implicit: the reason to scan it is that it is the surface a
  // reader is most likely to be sent to, not that it has ever been wrong.
  assert.ok(REMOVED.length >= 2 && PATTERN.source.includes('load'), 'the denylist emptied out — every occurrence would pass');
  // The property that keeps this guard machine-independent: no generated artifact is in scope, so
  // the git route and the walk route see the same files. Without it the box (no `.git`, so the
  // walk) failed on three occurrences the Mac could not see.
  assert.deepEqual(
    files.filter((f) => f.includes('.generated.')),
    [],
    'a generated artifact is in the scan set — it cannot be fixed in place, and only one of the two scan routes can see it',
  );
});
