#!/usr/bin/env node
// `M237` `A2` — every test file survives a run that selects none of its tests.
//
// ## What it asserts, and why it is a run and not a shape
//
// `node:test` runs the root `after()` hook without awaiting the root `before()` hook when
// `--test-name-pattern` selects zero tests (measured, Node v22.22.0, `scripts/test-staging.mjs`).
// A file whose setup is async and whose teardown touches what that setup assigns therefore either
// crashes in its teardown naming an argument (`M236-03`) or leaks the handles the setup went on to
// open and never exits (`M235-02`). Eleven of this repository's 257 test files did one or the
// other, and the repair is `stagedSetup`.
//
// A cheaper gate was available and is deliberately not what this is. Walking each `after()` body
// for an unguarded call to a binding only `before()` assigns costs seconds and covers a file added
// tomorrow — but it asserts the SHAPE of the repair rather than its subject, which is `M141`'s
// whole finding, and it would have passed `ui-page.test.ts` for the eight days that file was
// guarded, silent and still hanging. This runs the invocation and reads the exit code.
//
// It was affordable only because it was priced first: `A0`'s census was **234 s for all 257
// files**, and that figure included six files each burning a 20 s timeout. With those repaired the
// run is the sum of 257 setups and teardowns.
//
// ## THE INVOCATION IS EACH WORKSPACE'S OWN, NEVER RETYPED
//
// `A0`'s census reported `packages/vscode/test/extension.test.ts` as a twelfth defective file. It
// is not: that package's `test` script is prefixed `TSX_TSCONFIG_PATH=./tsconfig.test.json` and
// runs with the package as its cwd, and the census — one hand-written `node --import tsx --test`
// from the repository root — got `ERR_MODULE_NOT_FOUND` for the `vscode` specifier the package's
// own tsconfig remaps. Re-run through the package's own command it is clean.
//
// `scripts/test-concurrency.test.mjs` is this repository's standing record of the same mistake at
// larger scale — 307 failures, every one an artifact of a retyped invocation — so the command here
// is derived from each `package.json` by `mutate.mjs`'s `fastCommand`, which is the function that
// already does exactly this for the mutation runner and refuses rather than guesses. A package
// whose `test` script it refuses is REPORTED as unreachable, never silently skipped: a scan
// pointed at nothing passes every rule (`D880`).

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fastCommand } from './mutate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** A name no test in this repository has, and the one every caller must use. */
export const PATTERN = 'zzz-no-such-test-zzz';

/** Generous: a repaired file runs its whole setup and teardown, which for a browser file is a real
 *  browser launch. The bound is here to turn a hang into a verdict, not to measure speed. */
const TIMEOUT_MS = 120_000;

/** The self-test's two files do 400 ms of setup; one of them then hangs on purpose. */
const SELF_TEST_TIMEOUT_MS = 15_000;

/**
 * A package's own test command, narrowed to one file and filtered to select nothing.
 *
 * `fastCommand` hands back the script with its glob replaced and ` 2>&1` appended; the pattern goes
 * immediately after `--test`, where node's own scripts put their flags, rather than after the file
 * list where it would be read positionally.
 */
export function zeroMatchCommand(testScript, file) {
  // ONE NARROW DEPARTURE FROM `fastCommand`'S OWN REFUSAL, AND WHY IT IS SOUND HERE. It refuses a
  // chained script outright, because for the mutation runner a subset of the `node:test` half is
  // not a subset of that suite's verdict at all — `@tflw/docs-site` runs `verify-docs.mjs` after
  // its tests and a mutation those catch would be scored against a run that never reached them.
  // This gate asks a different question: does ONE file exit cleanly when its pattern selects
  // nothing. The steps after `&&` cannot change that answer, and refusing here would leave a
  // whole workspace's eight test files ungated by the round that exists to end exactly that.
  const narrowed = fastCommand(testScript.split('&&')[0].trim(), [file]);
  if (narrowed === null) return null;
  if (!narrowed.includes('--test ')) return null;
  // `--test-reporter=tap` IS PART OF THE INSTRUMENT, not a preference. Node picks its reporter by
  // whether stdout is a TTY and which version is running: the box's Node 22 emitted TAP and this
  // Mac's emitted `spec` for the identical command, and `failureType: 'hookFailed'` — the string
  // that tells the crash half from the leak half — exists only in the TAP one. A classifier whose
  // subject appears or vanishes with the terminal it is run from is not a classifier.
  return narrowed.replace('--test ', `--test --test-reporter=tap --test-name-pattern ${JSON.stringify(PATTERN)} `);
}

/**
 * The verdict for one finished run.
 *
 * `hookFailed` is reported separately from the exit code because the two failures this gate exists
 * for are distinguishable and the distinction is the diagnosis: a crash names a hook, a leak names
 * nothing at all and simply never ends.
 */
export function classify({ status, timedOut, output }) {
  const hookFailed = /failureType: 'hookFailed'/.test(output);
  if (timedOut) return { ok: false, why: 'never exited', hookFailed };
  if (hookFailed) return { ok: false, why: 'teardown crashed (hookFailed)', hookFailed };
  if (status !== 0) return { ok: false, why: `exit ${status}`, hookFailed };
  return { ok: true, why: 'clean', hookFailed };
}

/** Every `*.test.{ts,mjs}` under `dir/test`, package-relative and sorted. */
function testFilesUnder(dir, sub = 'test') {
  const out = [];
  const walk = (rel) => {
    let entries;
    try {
      entries = readdirSync(path.join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const next = path.posix.join(rel, e.name);
      if (e.isDirectory()) walk(next);
      else if (/\.test\.(ts|mjs)$/.test(e.name)) out.push(next);
    }
  };
  walk(sub);
  return out.sort();
}

/**
 * Every unit of work: a directory, the command template it owns, and the files that command runs.
 *
 * The root is a unit too — `test:scripts` is a real suite that `verify-test-counts.mjs` spawns on
 * every PR, and its 22 files are as capable of this defect as any other.
 */
export function units(root = ROOT) {
  const out = [];
  const pkgDirs = readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `packages/${e.name}`)
    .sort();
  for (const dir of pkgDirs) {
    const manifest = path.join(root, dir, 'package.json');
    if (!existsSync(manifest)) continue;
    const script = JSON.parse(readFileSync(manifest, 'utf8')).scripts?.test;
    // BOTH, because `A0`'s census globbed `packages/*/test/*.test.ts` and therefore never saw
    // `packages/docs-site/scripts/*.test.mjs` — eight files, a whole workspace's suite, in a
    // census that reported itself as covering "every test file in the repository". The
    // enumeration here comes off the workspace list and the disk, which is the difference.
    const files = [...testFilesUnder(path.join(root, dir)), ...testFilesUnder(path.join(root, dir), 'scripts')].sort();
    if (files.length === 0) continue;
    out.push({ dir, script: script ?? null, files });
  }
  const rootScript = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts?.['test:scripts'];
  const rootFiles = testFilesUnder(root, 'scripts');
  if (rootFiles.length > 0) out.push({ dir: '.', script: rootScript ?? null, files: rootFiles });
  return out;
}

function runOne(dir, command, timeout = TIMEOUT_MS) {
  const r = spawnSync(command, {
    cwd: dir,
    shell: true,
    encoding: 'utf8',
    timeout,
    killSignal: 'SIGKILL',
    maxBuffer: 32 * 1024 * 1024,
  });
  return classify({
    status: r.status,
    timedOut: r.error?.code === 'ETIMEDOUT',
    output: `${r.stdout ?? ''}${r.stderr ?? ''}`,
  });
}

function main(root = ROOT, { quiet = false } = {}) {
  const log = quiet ? () => {} : (...a) => console.log(...a);
  const all = units(root);
  const unreachable = [];
  const failures = [];
  let ran = 0;

  for (const unit of all) {
    if (unit.script === null) {
      unreachable.push({ dir: unit.dir, files: unit.files.length, why: 'no test script' });
      continue;
    }
    const probe = zeroMatchCommand(unit.script, unit.files[0]);
    if (probe === null) {
      unreachable.push({ dir: unit.dir, files: unit.files.length, why: `not narrowable: ${unit.script}` });
      continue;
    }
    for (const file of unit.files) {
      const command = zeroMatchCommand(unit.script, file);
      const verdict = runOne(path.join(root, unit.dir), command);
      ran++;
      if (!verdict.ok) {
        failures.push({ file: path.posix.join(unit.dir === '.' ? '' : unit.dir, file), why: verdict.why });
        log(`  FAIL ${unit.dir}/${file} — ${verdict.why}`);
      }
    }
    log(`  ${unit.dir}: ${unit.files.length} file(s)`);
  }

  log(`\nran ${ran} file(s) with --test-name-pattern ${JSON.stringify(PATTERN)}`);
  if (unreachable.length > 0) {
    log('\nNOT COVERED — named rather than skipped:');
    for (const u of unreachable) log(`  ${u.dir} (${u.files} file(s)) — ${u.why}`);
  }
  if (ran === 0) {
    console.error('\nFAIL — this gate ran nothing at all, which is not a pass.');
    return 1;
  }
  if (failures.length > 0) {
    console.error(`\nFAIL — ${failures.length} of ${ran} file(s) do not survive a run that selects none of their tests.`);
    console.error('Each one either crashed in its teardown or never exited. The repair is `stagedSetup`');
    console.error('in `scripts/test-staging.mjs`, which is where the mechanism is written down.');
    for (const f of failures) console.error(`  ${f.file} — ${f.why}`);
    return 1;
  }
  log(`\nOK — all ${ran} file(s) exit cleanly when the pattern selects nothing.`);
  return 0;
}

/**
 * The control this gate would be worthless without.
 *
 * Two files in a throwaway package, identical but for the repair: one whose async `before()` opens
 * a listening socket the teardown closes, and one that routes the same setup through
 * `stagedSetup`. The gate must call the first red and the second green. If it calls both green the
 * gate is measuring nothing, which is the state every vacuous check in this repository was in
 * before someone mutated it.
 */
function selfTest() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tflw-zero-match-'));
  try {
    mkdirSync(path.join(dir, 'test'), { recursive: true });
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'zero-match-self-test', private: true, type: 'module', scripts: { test: 'node --test "test/*.test.mjs"' } }, null, 2),
    );
    // The crash half on its own (`M236-03`, `pack.test.ts`'s exact shape): a setup that opens
    // nothing, so the file EXITS — `rc=1` with `hookFailed` — rather than hanging. Without it this
    // control demonstrates only the leak, and the timeout that catches the leak takes the TAP with
    // it, so `hookFailed` is never even observed on the other two files.
    const crashing = `
import { test, before, after } from 'node:test';
import { rm } from 'node:fs/promises';
let scratch;
before(async () => {
  await new Promise((r) => setTimeout(r, 400));
  scratch = '/tmp/tflw-zero-match-self-test-nothing-here';
});
after(async () => {
  await rm(scratch, { recursive: true, force: true });
});
test('alpha', () => {});
`;
    const body = (staged) => `
import { test, before, after } from 'node:test';
import { createServer } from 'node:http';
${staged ? `import { stagedSetup } from ${JSON.stringify(path.join(ROOT, 'scripts', 'test-staging.mjs'))};` : ''}
let server;
const bring = async () => {
  await new Promise((r) => setTimeout(r, 400));
  server = createServer(() => {});
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
};
${staged ? 'const setup = stagedSetup(bring);\nbefore(setup.begin);' : 'before(bring);'}
after(async () => {
  ${staged ? 'await setup.settled();' : ''}
  await new Promise((r) => server.close(r));
});
test('alpha', () => {});
`;
    const script = 'node --test "test/*.test.mjs"';
    writeFileSync(path.join(dir, 'test', 'crashing.test.mjs'), crashing);
    const crash = runOne(dir, zeroMatchCommand(script, 'test/crashing.test.mjs'), SELF_TEST_TIMEOUT_MS);
    rmSync(path.join(dir, 'test', 'crashing.test.mjs'));
    writeFileSync(path.join(dir, 'test', 'racing.test.mjs'), body(false));
    // `SELF_TEST_TIMEOUT_MS`, not the gate's: the unrepaired file hangs BY CONSTRUCTION, so waiting
    // the gate's 120 s on it would make this control the slowest step in CI for no information.
    const racing = runOne(dir, zeroMatchCommand(script, 'test/racing.test.mjs'), SELF_TEST_TIMEOUT_MS);
    rmSync(path.join(dir, 'test', 'racing.test.mjs'));
    writeFileSync(path.join(dir, 'test', 'staged.test.mjs'), body(true));
    const staged = runOne(dir, zeroMatchCommand(script, 'test/staged.test.mjs'), SELF_TEST_TIMEOUT_MS);

    // Both halves are named, because one file produces both: the teardown crashes on an
    // unassigned binding (`M236-03`) AND the setup goes on to open a socket nothing will ever
    // close (`M235-02`). A control that reported only the first would leave the more expensive
    // half of this round undemonstrated.
    console.log(`  crash half: ok=${crash.ok} (${crash.why}, hookFailed=${crash.hookFailed})`);
    console.log(`  leak half:  ok=${racing.ok} (${racing.why}, hookFailed=${racing.hookFailed})`);
    console.log(`  repaired:   ok=${staged.ok} (${staged.why}, hookFailed=${staged.hookFailed})`);
    if (racing.ok || crash.ok) {
      console.error('\nFAIL — the gate passed a file with the exact defect it exists to catch.');
      return 1;
    }
    if (!crash.hookFailed) {
      console.error('\nFAIL — the crash control was caught, but not as a `hookFailed`, so this gate is');
      console.error('no longer reading the thing `M236-03` was filed about.');
      return 1;
    }
    if (!staged.ok) {
      console.error(`\nFAIL — the gate failed the repaired file: ${staged.why}`);
      return 1;
    }
    console.log('\nOK — the gate separates the defect from its repair.');
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// `D224`'s main guard, for the same reason `mutate.mjs` has one: this file is importable by its
// own tests and importing it must run nothing.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : main());
}

export { main, selfTest };
