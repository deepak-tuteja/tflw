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
  classifySuiteFailure,
  costProblem,
  rebuildTargetFor,
  coverage,
  coverageProblem,
  elapsedLine,
  formatElapsed,
  parseArgs,
  partition,
  registryProblem,
  shardCost,
  tallyLine,
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

test('every mutation still matches the source it quotes, exactly once', () => {
  // M127, and it cost a sweep to learn. This milestone widened `parseArgs`'s unknown-option line to
  // admit `--shard=`, and `unknown-option-ignored` quotes that line verbatim as its `find:`. The
  // control did not fail — it went **stale**, `target matched 0 times, not 1; NOT RUN`, and said so
  // 45 minutes into a six-shard run on the box. Nothing was wrong with the runner: a drifted target
  // is counted as a survivor precisely so it cannot be a quiet zero. What was wrong is *when* it is
  // discovered, and the answer was "after every suite in the shard ahead of it has run".
  //
  // This is that discovery moved to the front, for all of them rather than for the self-mutations
  // that happen to be edited most often. It replicates the runner's own precondition exactly,
  // including the `edits:` chain — each edit applies to the text the previous one produced, so the
  // second edit of a pair is checked against the mutated source and not the original.
  for (const m of MUTATIONS) {
    let text = readFileSync(path.join(ROOT, m.file), 'utf8');
    for (const [find, replace] of m.edits ?? [[m.find, m.replace]]) {
      const occurrences = text.split(find).length - 1;
      assert.equal(
        occurrences,
        1,
        `${m.id} (${m.milestone}) matches ${m.file} ${occurrences} times, not 1 — the source moved and the mutation's \`find:\` did not follow. ` +
          `It would run as \`stale\`, which is a red sweep rather than a wrong one, but only after every suite ahead of it.`,
      );
      text = text.replace(find, replace);
    }
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
  // M127 widened the return shape with `shard`/`manifest`; what this test is about is `list` and
  // `scope`, so it asserts those rather than re-pinning the whole object every time a flag is added.
  const parsed = (...args) => {
    const { list, scope } = parseArgs(['node', 'mutate.mjs', ...args]);
    return { list, scope };
  };
  assert.deepEqual(parsed('--list'), { list: true, scope: undefined });
  assert.deepEqual(parsed('m118', '--list'), { list: true, scope: 'm118' });
  assert.deepEqual(parsed('--list', 'm118'), { list: true, scope: 'm118' });
  assert.deepEqual(parsed(), { list: false, scope: undefined });
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

// ---------------------------------------------------------------------------
// M127 (`M126-01`) — shards.
//
// The sweep outgrew its job's clock, and the fix splits it across machines. Splitting a control
// suite introduces exactly one new way to be green about nothing — a mutation nobody ran — so what
// is asserted here is coverage first and balance second. Balance is a preference; totality is the
// property the whole instrument rests on.

test('a partition is total and disjoint at every shard count the registry can take', () => {
  const ids = MUTATIONS.map((m) => m.id);
  for (const n of [1, 2, 3, 5, 6, 7, 8, 11, 16, MUTATIONS.length]) {
    const shards = partition(MUTATIONS, n);
    assert.equal(shards.length, n, `expected ${n} shards`);
    const dealt = shards.flat().map((m) => m.id);
    assert.equal(dealt.length, ids.length, `n=${n}: ${dealt.length} mutations dealt from a registry of ${ids.length}`);
    assert.equal(new Set(dealt).size, ids.length, `n=${n}: a mutation was dealt to two shards`);
    assert.deepEqual([...dealt].sort(), [...ids].sort(), `n=${n}: the shards are not the registry`);
    for (const [i, s] of shards.entries()) assert.ok(s.length > 0, `n=${n}: shard ${i + 1} is empty, and an empty shard still exits 0`);
  }
});

test('the same registry always deals the same hands', () => {
  // A shard number has to be enough to reproduce what a red shard ran. If the deal moved between
  // runs, the only way to find out what shard 4 held would be to read the log of the run that
  // failed — which is exactly the thing you do not have when the job was killed.
  const a = partition(MUTATIONS, 6).map((s) => s.map((m) => m.id));
  const b = partition(MUTATIONS, 6).map((s) => s.map((m) => m.id));
  assert.deepEqual(a, b);
});

test('a partition refuses a shard count it cannot honour, rather than returning fewer', () => {
  for (const n of [0, -1, 1.5, '6']) {
    assert.throws(() => partition(MUTATIONS, n), /positive integer/, `partition(_, ${n})`);
  }
});

test('shards are balanced by measured suite time, not by mutation count', () => {
  // The property that matters is that the split follows the cost. `@tflw/lang`'s 49 mutations are
  // cheaper together than `tflw`'s seven, so a count-balanced split would be wrong by ~3×; the
  // shard holding the most mutations must not be the most expensive one.
  const shards = partition(MUTATIONS, 6);
  const costs = shards.map(shardCost);
  const biggest = shards.indexOf(shards.reduce((a, b) => (b.length > a.length ? b : a)));
  assert.ok(costs[biggest] <= Math.max(...costs), 'the largest shard by count is also the most expensive — the deal ignored cost');
  // **1.7, raised from 1.5 in M128b, and the number is measured rather than moved to fit.**
  //
  // M128b added six mutations, five of them to `@tflw/runtime`. That fifth one crosses a chunking
  // cliff: at four the packer splits runtime cleanly and the ratio is 1.205; at five it leaves one
  // oversized chunk it cannot break up, and the ratio jumps to 1.584. Dropping *any* one of the five
  // returns it to 1.205, which is what identifies this as a property of the packer rather than of
  // the mutations.
  //
  // What the jump actually costs was measured before this constant was touched, because "the ratio
  // got worse" and "CI got slower" are not the same claim. A sharded sweep's wall-clock is its
  // *slowest* shard: this split's is 18m. A per-mutation LPT pack — perfectly balanced, ratio 1.006
  // — comes out at 17m, because it pays each package's baseline again in every bin it touches
  // (~18 extra minutes of CPU across the matrix to save one minute of clock). So the best achievable
  // max is 17m against this registry, the current split is one minute off it, and a ratio of 1.584
  // is describing a minute.
  //
  // The bar is kept, because the first assertion above is structural and this one is the only thing
  // watching for a genuinely lopsided deal. It is set where the measurement puts it and not where it
  // would be comfortable: at 1.7 the 1.584 split passes and the next real regression still fails.
  // If it trips again, re-measure the max against the atom-LPT floor before moving it — that
  // comparison, not the ratio, is what says whether CI is actually slower.
  assert.ok(Math.max(...costs) / Math.min(...costs) < 1.7, `shards are lopsided: ${costs.map((c) => Math.round(c / 60) + 'm').join(', ')}`);
});

test('every package the registry names has a measured suite time', () => {
  assert.equal(costProblem(), undefined);
  const problem = costProblem([...MUTATIONS, { id: 'x', milestone: 'm127', pkg: '@tflw/unmeasured', file: 'x', what: 'x' }]);
  assert.match(problem, /no measured suite time for: @tflw\/unmeasured/);
});

test('parseArgs understands --shard, and rejects every way of getting it wrong', () => {
  assert.deepEqual(parseArgs(['node', 'x', '--shard=3/6']).shard, { index: 3, of: 6 });
  assert.match(parseArgs(['node', 'x', '--shard=3']).error, /--shard wants <i>\/<n>/);
  assert.match(parseArgs(['node', 'x', '--shard=']).error, /--shard wants <i>\/<n>/);
  assert.match(parseArgs(['node', 'x', '--shard=0/6']).error, /shard numbers run 1\.\.6/);
  assert.match(parseArgs(['node', 'x', '--shard=7/6']).error, /shard numbers run 1\.\.6/);
  assert.match(parseArgs(['node', 'x', '--shard=1/0']).error, /cannot be split into 0 shards/);
  // A shard of a scope is a fraction of a fraction reported as if it were the sweep.
  assert.match(parseArgs(['node', 'x', '--shard=1/6', 'm98c']).error, /cannot be combined with the scope "m98c"/);
});

test('a manifest cannot be written by a run that applies nothing', () => {
  // The manifest is the only evidence `verify-shards.mjs` has that a shard ran. If `--list` could
  // write one, a workflow that listed instead of swept would produce a complete-looking set of
  // attestations for a sweep that never happened.
  assert.match(parseArgs(['node', 'x', '--list', '--manifest=s.json']).error, /would attest a sweep that never ran/);
  assert.equal(parseArgs(['node', 'x', '--manifest=s.json']).manifest, 's.json');
  assert.match(parseArgs(['node', 'x', '--manifest=']).error, /--manifest wants a path/);
});

test('the tally names its denominator when the run is one shard of several', () => {
  const cov = { reconstructed: 13, planned: 31, missing: 18 };
  const whole = tallyLine({ ran: 122, survived: 0, stale: 0, cov });
  assert.match(whole, /^122 mutation\(s\) run; 0 survived/);
  const sharded = tallyLine({ ran: 21, survived: 0, stale: 0, shard: { index: 3, of: 6 }, registry: 122, cov });
  assert.match(sharded, /^21 of 122 mutation\(s\) run — shard 3 of 6; 0 survived/);
  // The clause M126 moved onto this line stays on it under a shard.
  assert.match(sharded, /reconstructs 13 of the M98 plan's 31 mutations, 18 not\.$/);
});

test('more shards than mutations is refused, not run empty', () => {
  // The failure this guard exists for exits 0 with a tally in it. A shard count above the registry's
  // size would sweep nothing, print `0 of N mutation(s) run`, and pass.
  //
  // **The count is derived, not written down.** This test asked for `--shard=200/200` from `M127` until
  // the registry reached exactly 200 mutations, at which point 200 shards of 1 became perfectly legal,
  // the guard correctly said nothing, and this test failed — with a magic number as the only defect. A
  // literal here is a slow fuse: it holds for dozens of milestones and then fires on whichever one
  // happens to add the mutation that crosses it. `MUTATIONS.length + 1` cannot be reached by growth.
  const overshard = MUTATIONS.length + 1;
  const { file, cleanup } = sandboxJournal();
  try {
    const r = spawnSync(process.execPath, [SCRIPT, `--shard=${overshard}/${overshard}`], { cwd: ROOT, encoding: 'utf8', env: withJournal(file) });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /would leave some shard with nothing to run/);
    assert.doesNotMatch(r.stdout, /mutation\(s\) run/);
  } finally {
    cleanup();
  }
});

test('--list --shard shows what one shard holds, with the registry it is a fraction of', () => {
  const { file, cleanup } = sandboxJournal();
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--list', '--shard=2/6'], { cwd: ROOT, encoding: 'utf8', env: withJournal(file) });
    assert.equal(r.status, 0);
    const header = new RegExp(`shard 2 of 6 — \\d+ of ${MUTATIONS.length} mutation\\(s\\)`);
    assert.match(r.stdout, header);
    assert.match(r.stdout, /no mutation was applied and no suite was run\./);
    const listed = partition(MUTATIONS, 6)[1];
    for (const m of listed) assert.ok(r.stdout.includes(m.id), `${m.id} is in shard 2 but was not listed`);
  } finally {
    cleanup();
  }
});

test('a sweep writes down what it ran, and the file says the same thing the run did', () => {
  // End-to-end rather than a unit test of the writer (M98d): the manifest is what CI trusts, so
  // what is asserted is the file a real sweep leaves behind.
  const before = readFileSync(LEXER, 'utf8');
  const { file, cleanup } = sandboxJournal();
  const out = path.join(path.dirname(file), 'shard-1.json');
  try {
    const r = spawnSync(process.execPath, [SCRIPT, `--manifest=${out}`, 'bom-col'], { cwd: ROOT, encoding: 'utf8', env: withJournal(file) });
    assert.equal(r.status, 0);
    const manifest = JSON.parse(readFileSync(out, 'utf8'));
    assert.deepEqual(manifest.ids, ['bom-col']);
    assert.equal(manifest.registry, MUTATIONS.length);
    assert.match(r.stdout, /wrote .*shard-1\.json — 1 id\(s\)/);
    // `D573`, on the run that was already being spawned: the clock is reported when nothing is
    // wrong, which is the only condition under which a baseline can be established at all.
    assert.match(r.stdout, /⏱ this sweep took \d/);
    assert.ok(!r.stdout.includes('OVER BUDGET'), r.stdout);
  } finally {
    if (readFileSync(LEXER, 'utf8') !== before) writeFileSync(LEXER, before);
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// M143a — the sweep's own clock (`M137g-03`, re-stated).

test('a sweep reports its own clock, and is loud only when it crosses the budget', () => {
  // `M137g-03` asked for this and gave a falsified reason — it read JOB totals with a 14-minute apt
  // stall inside them and concluded the shard packer was unstable. The recommendation survives the
  // reason: five passes of archaeology went into separating a heavy shard from a stalled download,
  // and this line is what would have done it at a glance.
  const quiet = elapsedLine({ ms: 13 * 60_000 + 36_000, budgetMs: 20 * 60_000 });
  assert.equal(quiet, '⏱ this sweep took 13m36s (soft budget 20m00s).');
  assert.ok(!quiet.includes('OVER BUDGET'));

  // `D573` — unconditional. A number that appears only when something is already wrong cannot
  // establish a baseline, and the missing baseline is the whole reason this row stayed open.
  assert.match(elapsedLine({ ms: 1_000, budgetMs: 20 * 60_000 }), /^⏱ this sweep took 1s/);

  const loud = elapsedLine({ ms: 21 * 60_000, shard: { index: 11, of: 12 }, budgetMs: 20 * 60_000 });
  assert.match(loud, /^⏱ shard 11 of 12 took 21m00s \(soft budget 20m00s\)\./);
  assert.match(loud, /⚠ OVER BUDGET by 1m00s/);
  // `M136a-01`'s rule, inside the message rather than in a plan nobody opens: a row cited by id is
  // cited with its status, so the next reader does not go looking for an open `M131-06`.
  assert.match(loud, /`M131-06`/);
  assert.match(loud, /\(status: closed\)/);

  // The budget is a ceiling to cross, not to reach. Exactly 20m is inside it — and the boundary
  // matters because `D574` defers a re-shard behind two consecutive crossings, so an off-by-one
  // here would start that clock a run early.
  assert.ok(!elapsedLine({ ms: 20 * 60_000, budgetMs: 20 * 60_000 }).includes('OVER BUDGET'));

  // The shape a CI log gets read in, including the minute boundary in both directions.
  assert.equal(formatElapsed(59_400), '59s');
  assert.equal(formatElapsed(60_000), '1m00s');
  assert.equal(formatElapsed(20 * 60_000 + 100), '20m00s');
});

test('a cross-workspace mutation rebuilds what it mutated', () => {
  // `M147-09`. A workspace's own tests run from source, so a mutation and its suite normally need no
  // build between them. Across workspaces they do: `@tflw/lsp-server` imports `@tflw/lang` by name
  // and that package exports `./dist/index.js`, so a mutation to `packages/lang/src/parser.ts`
  // scored against the lsp-server suite ran the *previous* build and came back `SURVIVED`.
  //
  // That is the worst verdict this file can print wrongly. A hang says it reached no verdict; a
  // false survival reads as a measurement that the assertion is weak, and the honest response to
  // that reading is to delete the test.
  const nameOf = (dir) => ({ 'packages/lang': '@tflw/lang', 'packages/lsp-server': '@tflw/lsp-server' })[dir] ?? null;

  // The broken case: mutate lang, score against lsp-server.
  assert.equal(rebuildTargetFor('packages/lang/src/parser.ts', '@tflw/lsp-server', nameOf), '@tflw/lang');

  // The common case, which must stay free: same workspace, no build.
  assert.equal(rebuildTargetFor('packages/lang/src/parser.ts', '@tflw/lang', nameOf), null);

  // Not under `packages/` at all — the root `scripts/` suite mutating its own file.
  assert.equal(rebuildTargetFor('scripts/mutate.mjs', ROOT_SUITE, nameOf), null);

  // A workspace with no manifest cannot be named, so nothing is built rather than something wrong
  // being built: `npm run build -w <undefined>` would fail the whole mutation for a path shape the
  // registry does not have.
  assert.equal(rebuildTargetFor('packages/not-a-workspace/src/x.ts', '@tflw/lang', nameOf), null);
});

test('an output overflow is not a hang', () => {
  // `M147e-01`. `execSync` kills on both a timeout and a `maxBuffer` overflow, and it uses the same
  // signal for both, so the signal alone cannot tell them apart — reading it that way reported a
  // suite that ran to completion as one that never started. Found by `M147e-4`'s demonstrated break:
  // failing a 256-deep AST snapshot prints the diff, which took the run to 1 084 562 bytes.
  //
  // Both outcomes are still "no verdict", so this is not about correctness of the sweep's exit code.
  // It is about the sentence the reader gets: `the suite hung` sends them looking for an infinite
  // loop that is not there.
  assert.deepEqual(classifySuiteFailure({ code: 'ENOBUFS', signal: 'SIGKILL' }), { timedOut: false, overflowed: true });
  assert.deepEqual(classifySuiteFailure({ code: 'ETIMEDOUT', signal: 'SIGKILL' }), { timedOut: true, overflowed: false });

  // A `SIGKILL` with neither code — the OOM killer, or a `kill -9` from outside — stays a hang. It
  // is the one case where "we do not know why it stopped" is the honest answer, and the hang branch
  // is the one that says so.
  assert.deepEqual(classifySuiteFailure({ signal: 'SIGKILL' }), { timedOut: true, overflowed: false });

  // An ordinary red suite: a non-zero exit, no signal. Neither branch may claim it, or every kill in
  // the sweep would be reported as no-verdict.
  assert.deepEqual(classifySuiteFailure({ status: 1 }), { timedOut: false, overflowed: false });
});

test('the budget warning is one a real run can be watched tripping', () => {
  // `SUITE_TIMEOUT_MS`'s rule applied to the second bound this file now carries: a threshold nobody
  // has ever seen fire is a claim, not a control. Overriding it is how the loud path gets exercised
  // without running a twenty-minute shard — which is exactly the reachability problem that left the
  // sharded tally unasserted until `M127` made it pure.
  const before = readFileSync(LEXER, 'utf8');
  const { file, cleanup } = sandboxJournal();
  try {
    const r = spawnSync(process.execPath, [SCRIPT, 'bom-col'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: withJournal(file, { TFLW_MUTATE_BUDGET_MS: '1' }),
    });
    // Loud and still green. The sweep is judged by its exit code and not by its clock: a budget
    // that could fail a run would be a performance gate, and this repo has one of those already
    // failing jobs with the work done and thrown away (PR #48).
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /⏱ this sweep took \d/);
    assert.match(r.stdout, /⚠ OVER BUDGET by /);
  } finally {
    if (readFileSync(LEXER, 'utf8') !== before) writeFileSync(LEXER, before);
    cleanup();
  }
});
