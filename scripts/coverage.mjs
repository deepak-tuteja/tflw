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

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
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

console.log('› bundling with source maps (TFLW_BUNDLE_SOURCEMAP=1)');
const bundled = run(npm, ['run', 'bundle', '--prefix', 'packages/cli']);
if (bundled !== 0) process.exit(bundled);

console.log('› c8 npm test');
process.exit(run(process.execPath, [require.resolve('c8/bin/c8.js'), npm, 'test']));
