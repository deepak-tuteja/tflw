// The load-bearing flag nobody can see is load-bearing (2026-08-22).
//
// ## What happened
//
// A run of the suite invoked package by package, with the invocations retyped by hand rather than
// taken from each package's `test` script, reported **307 failures** across `tflw`, `@tflw/runtime`
// and `@tflw/lsp-server` — complete with plausible root causes: a broken vitepress build, deep-equal
// mismatches, a read of `undefined` at a named source line. Every one of them was an artifact of the
// invocation. `npm test` on the same tree, unchanged, reported 3574 tests and zero failures.
//
// The cause is that four files in `packages/cli/test` each shell out to `npm run build` **at the
// repo root** — the whole seven-workspace build, vitepress included — because what they assert is a
// property of the shipped `packages/cli/dist/cli.cjs`. Run two of them at once and the root builds
// race: on `.vitepress/.temp`, and on each other's `dist/`. The CLI suite then fails with
// `ERR_MODULE_NOT_FOUND`, and — the expensive part — any other suite importing a `dist/` mid-rewrite
// fails with assertion diffs that read exactly like product defects.
//
// The only thing preventing that is `--test-concurrency=1` in one `test` script. It is one flag,
// it looks like a performance knob, and until this file nothing anywhere said otherwise: it appeared
// exactly once in the repo, uncommented.
//
// ## What this guards, and what it cannot
//
// It guards the half that is mechanical: **the flag does not get deleted**. The other half — a
// person or a tool choosing to hand-roll an invocation, which is what actually happened — cannot be
// caught from inside the suite, and is documented in `CONTRIBUTING.md` ("Run the suite with
// `npm test`, not package by package") rather than pretended about here.
//
// The premise is asserted first and separately, because this guard is worth nothing if the thing it
// protects against stops being possible: should those four files ever stop building at the repo
// root, the flag is no longer load-bearing and this file should be revisited rather than obeyed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI_PKG = join(ROOT, 'packages', 'cli');

/** Test files under `packages/cli/test` that spawn a build at the REPO ROOT (as opposed to a
 *  workspace build, which cannot race anything outside itself). Matched on the argv array rather
 *  than on a command string, because that is how `execFileSync` is actually called here. */
function rootBuildingTestFiles() {
  const dir = join(CLI_PKG, 'test');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.test.ts'))
    .filter((f) => {
      const src = readFileSync(join(dir, f), 'utf8');
      return /\[\s*'run'\s*,\s*'build'\s*\]/.test(src) && /cwd:\s*repoRoot/.test(src);
    });
}

test('the premise: more than one cli test file builds at the repo root', () => {
  // If this ever drops to one or zero, the concurrency flag below is no longer protecting anything
  // and the next person should find out from a failure here rather than by deleting it and waiting.
  const files = rootBuildingTestFiles();
  assert.ok(
    files.length > 1,
    `only ${files.length} cli test file(s) build at the repo root (${files.join(', ') || 'none'}). ` +
      'Two or more is what makes --test-concurrency=1 load-bearing; at one or zero, re-examine this file ' +
      'and the CONTRIBUTING.md section it backs rather than keeping a guard for a hazard that is gone.',
  );
});

test('packages/cli runs its tests one at a time, so those builds cannot race', () => {
  const pkg = JSON.parse(readFileSync(join(CLI_PKG, 'package.json'), 'utf8'));
  const script = pkg.scripts?.test ?? '';
  assert.match(
    script,
    /--test-concurrency=1\b/,
    'packages/cli\'s `test` script has lost `--test-concurrency=1`. It is not a tuning knob: ' +
      `${rootBuildingTestFiles().join(', ')} each run \`npm run build\` at the repo root, and in parallel ` +
      'those builds corrupt `.vitepress/.temp` and each other\'s `dist/`. The visible damage lands in OTHER ' +
      'packages, as assertion failures that look like product defects — 307 of them on 2026-08-22. ' +
      `Script is currently: ${JSON.stringify(script)}`,
  );
});
