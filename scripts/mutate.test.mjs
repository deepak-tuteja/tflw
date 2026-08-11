// M123 — `scripts/mutate.mjs`, tested. It had no tests at all.
//
// That is the finding behind half this milestone: the instrument that every "0 survived" verdict in
// this repo rests on is 1100 lines, it rewrites tracked sources in place, and until now nothing
// asserted anything about it. Each defect closed here — a signalled run leaving the mutation on
// disk (`M118-03`), a merged object literal deleting a mutation in silence (`M122-01`), an
// `import()` starting a sweep (`M122`), a summary parse the environment could defeat (`M115-01`) —
// is one a test would have caught the first time.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  M98_PLAN,
  MUTATIONS,
  ROOT_SUITE,
  UNRECONSTRUCTED,
  coverage,
  coverageProblem,
  parseArgs,
  registryProblem,
  suiteCommand,
} from './mutate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const SCRIPT = path.join(HERE, 'mutate.mjs');
const LEXER = path.join(ROOT, 'packages/lang/src/lexer.ts');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Every `mutate.mjs` this file spawns gets a journal of its own (`M123-03`).
 *
 * Not hygiene — correctness. The real journal lives at `<git-dir>/tflw-mutate-journal.json`, one
 * per worktree, and `test:scripts` is itself a mutation suite: when the sweep runs its own
 * `root:test:scripts` entries, a test here that used the default location would find the **live**
 * outer sweep's journal, repair it, and un-mutate the very code it was supposed to be measuring.
 * That is not hypothetical — it cost three of this milestone's nine controls, which reported
 * SURVIVED for mutations that do kill. `mutate.mjs` now refuses on a live journal, so a test that
 * shared one would simply fail instead; sandboxing keeps the tests independent of that.
 */
function sandboxJournal() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tflw-mutate-'));
  return { file: path.join(dir, 'journal.json'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const withJournal = (file, extra = {}) => ({ ...process.env, TFLW_MUTATE_JOURNAL: file, ...extra });

// ---------------------------------------------------------------------------
// D224 — the `main` guard.

test('importing this module runs nothing — the M122 landmine, removed', () => {
  // `M122` read `MUTATIONS` with an `import()` and got a sweep, which left a deleted guard in
  // `packages/runtime/src/interpreter.ts` sitting in `git status` among six legitimately edited
  // files. The response then was a rule in the ledger header. A rule is a sign next to a landmine,
  // in a file the next session may not read; this import is the guard itself. If it ever regresses,
  // *this test file* starts a sweep on import and the whole suite goes strange — which is a louder
  // failure than the silence that cost `M122` twenty minutes.
  assert.ok(Array.isArray(MUTATIONS));
  assert.ok(MUTATIONS.length > 0);
});

test('the registry self-check passes on this file, and fires when an entry is merged away', () => {
  assert.equal(registryProblem(), undefined);

  // `M122-01`: a missing `},\n  {` merges two object literals, JavaScript keeps the last of each
  // duplicate key, and the earlier mutation stops existing without any run going red — because a
  // mutation that is not in the array cannot survive. The array cannot see this from the inside, so
  // the check counts `id:` keys *written* against objects *built*.
  const problem = registryProblem("    id: 'a',\n    id: 'b',\n", 1);
  assert.match(problem, /2 `id:` keys are written/);
  assert.match(problem, /1 mutation objects were built/);
});

test('every mutation names a file that exists and a unique id', () => {
  const ids = new Set();
  for (const m of MUTATIONS) {
    assert.ok(!ids.has(m.id), `duplicate mutation id: ${m.id}`);
    ids.add(m.id);
    assert.ok(existsSync(path.join(ROOT, m.file)), `${m.id} names a file that does not exist: ${m.file}`);
    assert.ok(m.what, `${m.id} has no \`what\``);
    assert.ok(m.milestone, `${m.id} has no \`milestone\``);
  }
});

// ---------------------------------------------------------------------------
// D228 — arguments.

test('parseArgs rejects an unknown option instead of silently ignoring it', () => {
  // This is the keystroke that opened `M118-03`: `mutate.mjs m118 --list` was typed expecting a
  // listing, `--list` was ignored, `m118` was taken as a scope, and five mutations were applied to
  // the working tree. The tool now refuses rather than guessing.
  assert.match(parseArgs(['node', 'mutate.mjs', 'm118', '--lst']).error, /unknown option --lst/);
  assert.match(parseArgs(['node', 'mutate.mjs', '-l']).error, /unknown option -l/);
});

test('parseArgs rejects two scopes rather than quietly using the first', () => {
  assert.match(parseArgs(['node', 'mutate.mjs', 'm118', 'm119']).error, /at most one id or milestone/);
});

test('parseArgs understands --list, in either position, with or without a scope', () => {
  assert.deepEqual(parseArgs(['node', 'mutate.mjs', '--list']), { list: true, scope: undefined });
  assert.deepEqual(parseArgs(['node', 'mutate.mjs', 'm118', '--list']), { list: true, scope: 'm118' });
  assert.deepEqual(parseArgs(['node', 'mutate.mjs', '--list', 'm118']), { list: true, scope: 'm118' });
  assert.deepEqual(parseArgs(['node', 'mutate.mjs']), { list: false, scope: undefined });
});

test('--list applies nothing and runs no suite', () => {
  const before = readFileSync(LEXER, 'utf8');
  const { file, cleanup } = sandboxJournal();
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--list', 'm98d'], { cwd: ROOT, encoding: 'utf8', env: withJournal(file) });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /bom-col\tm98d/);
    assert.match(r.stdout, /no mutation was applied and no suite was run/);
    assert.doesNotMatch(r.stdout, /baseline/);
    assert.equal(readFileSync(LEXER, 'utf8'), before);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// D226 — the root suite, so this file can be a mutation target of itself.

test('a mutation may name the root test:scripts suite instead of a workspace', () => {
  assert.equal(suiteCommand(ROOT_SUITE), 'npm run test:scripts 2>&1');
  assert.equal(suiteCommand('@tflw/lang'), 'npm test -w @tflw/lang 2>&1');
});

// ---------------------------------------------------------------------------
// D222/D223 — the journal, end to end through the real CLI.

test('a journal left by a dead run is repaired at startup, and says so', () => {
  // The `kill -9` case, which no signal handler reaches. Driven through `--list` because the repair
  // deliberately runs before every mode — there is no mode of this tool in which leaving a source
  // file wrong is right.
  const { file, cleanup } = sandboxJournal();
  const fixture = path.join(ROOT, 'node_modules/.tflw-m123-fixture.txt');
  try {
    writeFileSync(fixture, 'MUTATED — a run died holding this');
    writeFileSync(
      file,
      JSON.stringify({
        id: 'bom-col',
        milestone: 'm98d',
        startedAt: '2026-08-10T09:00:00.000Z',
        files: { 'node_modules/.tflw-m123-fixture.txt': 'the original contents' },
      }),
    );

    const r = spawnSync(process.execPath, [SCRIPT, '--list', 'm98d'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: withJournal(file),
    });

    assert.equal(r.status, 0);
    assert.equal(readFileSync(fixture, 'utf8'), 'the original contents');
    assert.match(r.stdout, /repaired: a previous run died/);
    assert.match(r.stdout, /bom-col/);
    assert.equal(existsSync(file), false, 'the journal should be cleared once the repair is verified');
  } finally {
    rmSync(fixture, { force: true });
    cleanup();
  }
});

test('a journal that cannot be written stops the run with the source untouched', () => {
  // The control for the ordering in `sweep`: journal down *before* the source is mutated. The gap
  // between those two writes is sub-millisecond, so no test watching from another process can see
  // it — but the failure path can be forced, and it separates the two orders completely. Point the
  // journal at a directory that does not exist and the correct order refuses with a clean message
  // and a clean tree, while the swapped order leaves `lexer.ts` mutated with nothing on disk saying
  // what it used to be, which is `M118-03` produced by the journal's own failure.
  const before = readFileSync(LEXER, 'utf8');
  try {
    const r = spawnSync(process.execPath, [SCRIPT, 'bom-col'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: withJournal(path.join(tmpdir(), 'tflw-m123-no-such-dir', 'journal.json')),
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /cannot write the mutation journal/);
    assert.match(r.stderr, /Nothing has been mutated/);
    assert.equal(readFileSync(LEXER, 'utf8'), before, 'the source was mutated before the journal was safely down');
  } finally {
    if (readFileSync(LEXER, 'utf8') !== before) writeFileSync(LEXER, before);
  }
});

test('a journal whose owner is still running stops the run instead of being repaired (M123-03)', () => {
  // Found by these very tests: `test:scripts` is itself a mutation suite, so when the sweep ran its
  // own `root:test:scripts` entries, a test in this file spawned a second `mutate.mjs`, which
  // treated the live outer sweep's journal as wreckage. Measured, one worktree, two processes:
  //
  //     outer sweep is live (pid 24371); lexer.ts is mutated; journal present? true
  //     ↺ repaired: a previous run died at … with `bom-col` (m98d) applied.
  //         restored packages/lang/src/lexer.ts
  //     after the second process: lexer.ts back to pristine? true
  //                              the LIVE sweep's journal still there? false
  //
  // The first sweep then measured unmutated code and reported SURVIVED. Three of this milestone's
  // nine controls were lost that way, and the report still read `0 stale` — a false survivor is the
  // safe direction to fail in, but it is not a working instrument.
  //
  // `process.pid` is used as a liveness token that is certainly alive: this process.
  const { file, cleanup } = sandboxJournal();
  try {
    writeFileSync(file, JSON.stringify({ id: 'bom-col', milestone: 'm98d', pid: process.pid, startedAt: '2026-08-10T09:00:00.000Z', files: {} }));
    const r = spawnSync(process.execPath, [SCRIPT, '--list'], { cwd: ROOT, encoding: 'utf8', env: withJournal(file) });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /another mutation sweep is already running in this worktree/);
    assert.match(r.stderr, new RegExp(`pid ${process.pid}`));
    assert.equal(existsSync(file), true, 'refusing must never delete the live run\'s only record');
  } finally {
    cleanup();
  }
});

test('an unreadable journal stops the run rather than being treated as "nothing to repair"', () => {
  const { file, cleanup } = sandboxJournal();
  try {
    writeFileSync(file, '{ not json');
    const r = spawnSync(process.execPath, [SCRIPT, '--list'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: withJournal(file),
    });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /unreadable/);
    assert.match(r.stderr, /git status/);
  } finally {
    cleanup();
  }
});

test('Ctrl-C during a sweep puts the source back and clears the journal', async (t) => {
  t.diagnostic('this one really mutates packages/lang/src/lexer.ts and really signals the run');
  const { file, cleanup } = sandboxJournal();
  const pristine = readFileSync(LEXER, 'utf8');

  // `detached: true` so the child leads its own process group, and the signal below goes to the
  // group. That is what Ctrl-C in a terminal actually does, and the distinction is the whole
  // behaviour: signalling only the `mutate.mjs` process leaves its blocking `execSync` running the
  // suite to completion, so the sweep finishes normally and nothing is being tested. Signalling the
  // group kills the `npm test` grandchild too, which is the condition `M118-03` was measured under.
  const child = spawn(process.execPath, [SCRIPT, 'bom-col'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: withJournal(file),
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));

  try {
    // Poll rather than time it: the `@tflw/lang` baseline is ~0.6s wall on a warm machine and
    // several seconds on a cold one, and a test that guesses that window is a flake waiting to be
    // filed. Signalling before the mutation is applied would prove nothing at all.
    // Stop early if the child dies: without this, a sweep that refuses to start (a broken registry,
    // an unwritable journal, a live journal) burns the whole 120s here and reports "never reached
    // disk" instead of what the child actually said. Measured — `registry-count-guard-off` took
    // over two minutes to kill for exactly that reason.
    let exited = false;
    child.once('exit', () => (exited = true));
    const deadline = Date.now() + 120_000;
    let applied = false;
    while (Date.now() < deadline && !exited) {
      if (readFileSync(LEXER, 'utf8') !== pristine) {
        applied = true;
        break;
      }
      await sleep(20);
    }
    assert.ok(applied, `the mutation never reached disk, so nothing was being tested. The run said:\n${out}`);
    assert.ok(existsSync(file), 'the journal must be on disk before the source is touched, not after');

    process.kill(-child.pid, 'SIGINT');
    await new Promise((r) => child.once('exit', r));

    // The contract is about the tree, not about which line of code repaired it: the handler and the
    // `finally` race here, because the group signal also kills `npm test` and unblocks `execSync`.
    // Either winning is correct. What must never be true again is this file left holding a mutation
    // — measured at `466d654` as `M118-03`, three occurrences, one of them committed.
    assert.equal(readFileSync(LEXER, 'utf8'), pristine, 'Ctrl-C left the mutation on disk — this is M118-03');
    assert.equal(existsSync(file), false, 'the journal outlived a verified restore');

    // Without the handler this process would take SIGINT's default action and die on the spot, so
    // the `finally` would never run either — which is precisely how the row was measured. The
    // `signal-handlers-removed` mutation is the control for that claim.
    assert.doesNotMatch(out, /could not restore/);
  } finally {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // already gone
    }
    // Belt and braces: if the assertion above failed, the mutation is still on disk and every later
    // test in this run would be measuring the wrong lexer.
    if (readFileSync(LEXER, 'utf8') !== pristine) writeFileSync(LEXER, pristine);
    cleanup();
  }
});

test('a sweep started from inside a node:test process still measures the suite (M123-02)', () => {
  // `NODE_TEST_CONTEXT` is exported into everything `node --test` spawns, and it tells a child
  // node:test to speak the internal serializer instead of printing a report. Handed to the suite
  // under measurement it produces 472 bytes, no summary, and **exit 0** — so every mutation reads
  // as SURVIVED and every baseline as `green, ? passing`, with nothing going red anywhere. Found by
  // writing this file: the first version of the Ctrl-C test below hit it and reported a survivor
  // for a mutation that kills a test.
  //
  // Set explicitly rather than relying on the ambient value, so the test states its own condition
  // instead of depending on how the runner happens to spawn this file.
  const before = readFileSync(LEXER, 'utf8');
  const { file, cleanup } = sandboxJournal();
  try {
    const r = spawnSync(process.execPath, [SCRIPT, 'bom-col'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: withJournal(file, { NODE_TEST_CONTEXT: 'child-v8' }),
    });
    assert.equal(r.status, 0);
    // `\d+`, not the literal count. M124 added 44 tests to `@tflw/lang` and this line went red for
    // a reason unrelated to anything it proves — the property is that a *number* arrives at all,
    // since the defect's signature is `green, ? passing` (asserted below) rather than a wrong one.
    // Pinning the live headcount here makes every milestone that adds a lang test edit an
    // instrument test, and `verify-test-counts.mjs` is already the place that owns that number.
    assert.match(r.stdout, /baseline @tflw\/lang … green, \d+ passing/);
    assert.match(r.stdout, /✓ killed {4}bom-col \(m98d\) — 1 failing/);
    assert.doesNotMatch(r.stdout, /SURVIVED/);
    assert.doesNotMatch(r.stdout, /\? passing/);
  } finally {
    if (readFileSync(LEXER, 'utf8') !== before) writeFileSync(LEXER, before);
    cleanup();
  }
});

test('a sweep announces that tracked sources are about to be wrong (M111-02)', () => {
  const { file, cleanup } = sandboxJournal();
  const r = spawnSync(process.execPath, [SCRIPT, 'no-such-mutation'], { cwd: ROOT, encoding: 'utf8', env: withJournal(file) });
  cleanup();
  assert.equal(r.status, 2);
  assert.match(r.stderr, /no mutation matches "no-such-mutation"/);
  // The banner belongs to a run that will actually apply something, so an unmatched scope must not
  // print it — a warning that appears when nothing is happening stops being read.
  assert.doesNotMatch(r.stdout, /will be applied to tracked sources/);
});

// ---------------------------------------------------------------------------
// M126 (`M125e-02`) — the summary line names its own denominator.
//
// The row: `verify:mutations` ended on `120 mutation(s) run; 0 survived, 0 stale.` over a registry
// that reconstructs part of the M98 plan, and the gap printed *underneath* — the third finding on
// this board with the shape **read the line under the headline**. Worse, it printed only when the
// run was unscoped, so the scoped local run a developer actually makes disclosed nothing at all.
//
// These tests hold the two halves that a comment cannot: that the number and its denominator arrive
// together, and that the accounting behind the denominator cannot drift one side at a time.

test('coverage() is derived from the registry, not from a sentence in it', () => {
  const c = coverage();
  assert.equal(c.total, MUTATIONS.length);
  assert.equal(c.planned, Object.values(M98_PLAN).reduce((a, b) => a + b, 0));
  assert.equal(c.missing, UNRECONSTRUCTED.reduce((a, u) => a + u.count, 0));
  assert.equal(c.reconstructed, MUTATIONS.filter((m) => m.plan).length);
  // The identity the whole scheme rests on. Stated here as well as inside `coverageProblem` so this
  // file fails on a broken registry even if that function is what broke.
  assert.equal(c.reconstructed + c.missing, c.planned);
});

test('the accounting is checked from both sides, and this registry passes it', () => {
  assert.equal(coverageProblem(), undefined);
});

test('reconstructing a mutation without dropping its UNRECONSTRUCTED entry turns the run red', () => {
  // The exact drift the old prose array could not notice: a group gets reconstructed, the array
  // keeps claiming it is missing, and the reported coverage silently understates. The mirror case —
  // dropping the entry without flagging the mutation — overstates, and fails the same check.
  const extra = [...MUTATIONS, { id: 'pretend', milestone: 'm98c', file: 'x', what: 'x', plan: true }];
  const problem = coverageProblem(extra);
  assert.match(problem, /m98c: the plan ran 11 mutation\(s\), this file accounts for 12/);
  assert.match(problem, /flagging it `plan: true` \*\*and\*\* dropping it/);
});

test('a `plan: true` outside M98 is rejected rather than counted', () => {
  // `plan` means "reconstructs a mutation the M98 plan ran". Nothing else has a plan to be counted
  // against, so a flag on an m124 entry is a mistake and not a 32nd planned mutation.
  const problem = coverageProblem([...MUTATIONS, { id: 'pretend', milestone: 'm124', file: 'x', what: 'x', plan: true }]);
  assert.match(problem, /`pretend` is flagged `plan: true` but `m124` is not one of M98's/);
});

test('a scoped sweep prints the coverage clause too — the half the old report withheld', () => {
  // `if (!scope)` is what this replaces. `node scripts/mutate.mjs m98c` used to end on a clean
  // `N mutation(s) run; 0 survived` and say nothing about what it had not run, which is precisely
  // the run a developer makes and precisely where the disclosure was missing.
  const before = readFileSync(LEXER, 'utf8');
  const { file, cleanup } = sandboxJournal();
  try {
    const r = spawnSync(process.execPath, [SCRIPT, 'bom-col'], { cwd: ROOT, encoding: 'utf8', env: withJournal(file) });
    assert.equal(r.status, 0);
    const c = coverage();
    assert.match(
      r.stdout,
      new RegExp(`1 mutation\\(s\\) run; 0 survived, 0 stale — over a registry that reconstructs ${c.reconstructed} of the M98 plan's ${c.planned} mutations, ${c.missing} not\\.`),
    );
    // And it is on the tally line, not beneath it: nothing separates the count from its denominator.
    assert.doesNotMatch(r.stdout, /0 stale\.\n/);
  } finally {
    if (readFileSync(LEXER, 'utf8') !== before) writeFileSync(LEXER, before);
    cleanup();
  }
});
