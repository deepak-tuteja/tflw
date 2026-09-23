#!/usr/bin/env node
// M86 (review `B6-08`) — `npm run coverage`, which until now measured 0% of the CLI package.
//
// The defect was not a low number, it was a number about the wrong thing. Every CLI test spawns the
// *built* `packages/cli/dist/cli.cjs` as a real subprocess — that is `e2e.test.ts`'s entire reason
// for existing ("the built artifact is broken but the source isn't"). c8 does propagate coverage
// into child processes (it sets `NODE_V8_COVERAGE`, and every spawn here inherits the environment),
// so those runs *were* recorded. They were then thrown away twice over: `.c8rc.json` excludes
// `**/dist/**`, and even without that exclusion the bundle had no source map to attribute its lines
// back to `cli.ts` with. Result: `cli.ts` (2194 lines), `env.ts`, `cli-summary.ts` and all three
// package barrels reported 0.00% while being executed thousands of times per suite — and six of
// review batch 6's findings live in that file.
//
// Two changes make the number mean what it says, and this script is the third:
//   1. `bundle.mjs` emits a source map when `TFLW_BUNDLE_SOURCEMAP=1` (gated, so the published
//      artifact is unchanged — see the comment there).
//   2. `.c8rc.json` sets `exclude-after-remap`, so c8 filters on the *remapped* source path rather
//      than dropping `dist/cli.cjs` before it ever consults the map. The `**/dist/**` entry stays:
//      post-remap it still catches any bundled file that has no map to remap through.
//   3. This script, so the env var is set for the whole tree rather than remembered by hand.
//
// It bundles first, deliberately. `e2e.test.ts`'s own `before()` rebuilds anyway and would inherit
// the variable — but the packages that run *earlier* in `npm test --workspaces` (runtime's
// `js-helpers.test.ts` also spawns the bundle) would meanwhile be running against whatever map-less
// `dist/` a previous plain build left behind. One esbuild pass up front costs about a second and
// removes the ordering coupling; it is not the `tsc` build, which the suite does for itself.
//
// THE FLOOR, AND WHERE IT CAME FROM. `.c8rc.json` cannot carry a comment, so the reasoning lives
// here. The rule was: no `check-coverage` threshold before the first honest measurement, because a
// floor invented before one is just a second unfounded number. That reading was taken 2026-08-05 —
// **94.66% statements / 88.56% branches / 94.6% functions**, and `cli.ts` itself went from the
// reported 0.00% to **92.63%**, which is the proof the three fixes above do what they claim.
//
// Pinned one point low (94 / 88 / 94) rather than at the measured value. The measurement is
// deterministic — two full runs produced byte-identical tables, so pinning exactly would hold
// today — but a floor at the high-water mark fails on the first honest refactor that adds an
// unhit branch, and a gate people routinely re-pin to get green is not a gate. The margin buys
// ordinary movement; a real regression is worth more than one point.
//
// Raise it when the number rises and stays risen. Do not lower it to make a red run green.
//
// ## `M234`: TWO TIERS, AND WHY THE AGGREGATE MOVED 94 -> 90
//
// The paragraph above describes a floor over **six** `src` directories. `M234` added a seventh,
// `packages/ui/src`, and had no choice: the package was already leaking into the report one file at
// a time as unit tests imported it — 8 files on `main`, 26 on the branch — so the denominator was
// moving with no decision behind it, and a branch that *added* tests made the number *fall*.
//
// So the aggregate now describes a different population, and re-deriving it against that population
// is not the act the rule above forbids. The forbidden act is dropping a floor at **unchanged**
// scope to turn a red run green; this is a floor following its own subject. What makes the
// distinction more than a form of words is `coverage-floors.json`, added in the same edit: **every
// package is pinned separately, one point under its own measured value**, so nothing the old 94
// protected is now unprotected. `@tflw/lang` was never held at 94 in any useful sense — it sat at
// 98.22 and could have shed four points inside a passing global average. It is held at 97 now.
//
// The two tiers answer different questions and both are kept:
//
//   · `.c8rc.json` — the **aggregate backstop**. One number over everything, pinned under the
//     measured whole (91.10/89.94/82.02). It catches a collapse, and it is deliberately the weaker
//     of the two. It stays `check-coverage: true` because a reader of `ci.yml` must be able to find
//     a real floor in the file that comment names.
//   · `coverage-floors.json` — the **gate**, run below. Nine populations spanning 68.87% to 98.22%
//     on lines and 39.56% to 100% on functions; no single figure can hold a spread like that, and
//     an average over it is exactly `M86`'s *a number about the wrong thing*.
//
// A package with coverage and no pin is a FAILURE there, not a default — `D540`'s rule that an
// allow-list is the honest half and not a silencer.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = { ...process.env, TFLW_BUNDLE_SOURCEMAP: '1' };

function run(command, args) {
  const { status, error } = spawnSync(command, args, { cwd: repoRoot, env, stdio: 'inherit' });
  if (error) throw error;
  return status ?? 1;
}

// `M234`. The page gate's bundle is copied here so c8 can still read it when it remaps, which
// happens after every workspace has finished and long after the gate deleted its own scratch. It is
// keyed by vite's content hash, so a stale copy is never *wrong* — it is only unread and growing, at
// about 4 MB a gate per run. Cleared here rather than by the gate, because two gates write into it
// within one run and neither of them owns it.
rmSync(join(repoRoot, 'coverage', '.ui-bundle'), { recursive: true, force: true });

console.log('› bundling with source maps (TFLW_BUNDLE_SOURCEMAP=1)');
const bundled = run(npm, ['run', 'bundle', '--prefix', 'packages/cli']);
if (bundled !== 0) process.exit(bundled);

// `test:raw`, not `test` — M107b made the root `npm test` a headcount wrapper that spawns npm a
// second time, and this measures *code*, not the headcount. Going through the wrapper would put an
// extra uninstrumented process between c8 and the suites for no gain; CI asserts the headcount in
// its own `npm test` step. Keeping this path byte-identical also keeps the floor above comparable
// to the reading it was pinned from.
//
// `M235` `D`: that `npm test` step is now gated to Node 24 (it and this step were running the same
// suite twice in the Node 22 job — see the long note on it in `.github/workflows/ci.yml`). So the
// sentence above is still true and is true of ONE job rather than both. Nothing here changes: this
// path is unchanged and the floor stays comparable. Said out loud because two files describing one
// arrangement is how `M134a-01` happened.
console.log('› c8 npm run test:raw');
// THE HEAP, AND WHY THE FLAG IS ON THIS PROCESS AND NOT IN `NODE_OPTIONS` (M160d).
//
// c8's *report* phase — the merge that runs after every workspace has already passed — reads the
// whole `coverage/tmp` tree into one process. That tree is currently **2.6 GB across 843 V8
// coverage files**, and merging it peaks at **5.59 GB RSS**, above Node's default old-space cap of
// roughly 4 GB. Measured on the box 2026-08-29 against one captured tmp tree, both directions:
// `--max-old-space-size=4096` spends four minutes in ineffective mark-compacts and dies with
// `FATAL ERROR: … JavaScript heap out of memory`; `=8192` finishes the same merge in 11 seconds.
//
// So this was never a coverage regression. The run that first went red passed all four floors with
// three points of margin; it failed *after* the number was computed. The commit blamed for it had
// added 3.1 MB of the 2.6 GB — 0.12%. That is the shape of the defect worth recording: the merge
// had been sitting a fraction of a percent under a hard ceiling, so whichever test landed next was
// going to be the one that appeared to break it, and the bisect would have accused an innocent file.
//
// The flag goes on *this* argv rather than in `NODE_OPTIONS` because the environment is inherited
// by every test subprocess c8 spawns, and those are not where the memory goes — raising their
// limits would change what the suite runs under to fix something that happens once the suite is
// over. `ubuntu-latest` gives 16 GB, so 8 GB for a single short-lived merge is not tight.
//
// This ceiling moves with the suite, it does not stay fixed. When it is next hit, the honest
// choices are to raise it again or to narrow what `.c8rc.json` instruments with `all: true` —
// not to drop a floor, which measures something else entirely.
const status = run(process.execPath, ['--max-old-space-size=8192', require.resolve('c8/bin/c8.js'), npm, 'run', 'test:raw']);

// `M234` — THE POST-CONDITION, because the way this instrument breaks is silent.
//
// `packages/cli/test/ui-coverage.ts` collects the page gate's browser coverage and hands it to c8
// through a source map. Every *loud* failure of that path is asserted where it happens: no map
// emitted, no script reported. The one that says nothing is a map that resolves to the wrong place
// — and it does not error, it files 55 files' worth of real lines under a path nobody reads while
// `all: true` backfills the real paths at 0%. Measured exactly so during the build: 641 of 2425
// functions non-zero in the coverage file, `ui/src` reading **0** in the report. One `resolve()`
// took it to **61.91%** on the same data.
//
// So the run asserts its own instrument afterwards, and the subject is chosen to make the assertion
// mean something: `ComposePane.tsx` is imported by **no** file in `packages/ui/test`, so the only
// thing that can put a covered line in it is the browser. A unit test cannot quietly hold this up.
// Its measured value from the appearance gate alone is 53.38%; the floor here is not a threshold on
// the UI, it is `> 0` — *did the mechanism run at all*.
const WITNESS = 'packages/ui/src/ComposePane.tsx';
const lcov = join(repoRoot, 'coverage', 'lcov.info');
if (existsSync(lcov)) {
  const record = readFileSync(lcov, 'utf8').split('end_of_record').find((r) => r.includes(WITNESS));
  const hit = Number(/^LH:(\d+)$/m.exec(record ?? '')?.[1] ?? 0);
  if (hit === 0) {
    console.error(
      `\n✗ the page gate's browser coverage did not reach ${WITNESS}.\n` +
        `  No unit test imports that file, so a zero here means the browser tier was not counted —\n` +
        `  the source map resolved somewhere c8 could not file, or the collector never ran. Whatever\n` +
        `  number this run printed for packages/ui/src is unit tests only. See\n` +
        `  packages/cli/test/ui-coverage.ts; do not read the floor until this is green.`,
    );
    process.exit(1);
  }
  console.log(`› browser coverage reached ${WITNESS}: ${hit} line(s) hit`);
}
// `M234` — the per-package gate. After the witness above, because a floor read off an instrument
// that did not run is the thing the witness exists to refuse.
const floors = run(process.execPath, [join(repoRoot, 'scripts', 'coverage-floors.mjs')]);
process.exit(status || floors);
