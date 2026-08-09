#!/usr/bin/env node
// M107b (`M106-03`) — the suite's own headcount, asserted.
//
// `# fail 0` is the number everyone reads. `# tests N` is the number nobody reads, and for
// `@tflw/lsp-server` it had been **111, 112 or 113 on an unchanged tree** — a suite that silently
// ran fewer tests than it contains and reported success either way. There is no failure mode here
// that turns anything red: a test that never reports cannot fail.
//
// THE CAUSE, MEASURED. `--test-force-exit`. `node` calls `process.exit()` as soon as the runner
// believes the root test is done, and reporting for the last-registered tests can still be in
// flight, so they vanish from the run — plan line, `ok` lines and summary all agree on the smaller
// number, which is why no internal-consistency check could ever have caught it. 20 runs of
// `packages/lsp-server/test/completion.test.ts`, same tree, same machine:
//
//     with    --test-force-exit   29 29 29 29 29 27 29 26 29 29 29 27 29 29 27 29 29 28 27 29
//     without --test-force-exit   29 29 29 29 29 29 29 29 29 29 29 29 29 29 29 29 29 29 29 29
//
// Identical to a file and to a pipe, so it is not lost stdout on exit. Whichever tests are dropped
// are always the tail of the file in registration order.
//
// THE FLAG IS NOW GONE FROM BOTH PACKAGES (M107-03). It was never a property of the suites, only
// of five leaks:
//   · `@tflw/lsp-server` never needed it — 6/6 clean exits in ~1.26s without. Removed (M107b).
//   · `@tflw/runtime` looked like it did: without the flag the suite hung past 120s with no summary
//     at all. Running each of its 50 files alone found exactly three that never exit —
//     `load.test.ts`, `unified-dispatch.test.ts`, `mtls.test.ts` — and `process._getActiveHandles()`
//     in an `unref`'d probe named the handle in one run each: four fixture servers still listening
//     (three tests in `load.test.ts`, one in `unified-dispatch.test.ts` had simply forgotten
//     `await server.close()`), and a live forked `mtlsWorkerEntry` child process that only
//     `cli.ts`'s teardown was calling `shutdownMtlsWorker()` for. Fixed, flag removed, suite exits
//     on its own; `test/support.ts` carries the watchdog that keeps it that way.
//
// So this script is no longer the last line of defence, but it stays: it is the only thing that
// notices a suite running fewer tests than it contains, whatever the cause. Expected counts are
// checked in below and asserted after the suites run. Bump them in the same commit that adds or
// removes tests — a count you have to update is the point, not the cost. If one moves and you did
// not change any test, that is the bug this script exists to catch.
//
// It re-uses the run rather than adding one: this **is** the root `npm test`, and it forwards
// everything to the terminal as it arrives (`npm run test:raw` is the unguarded original).
import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Every workspace with a `test` script, and how many tests its suite contains. Order is
 * irrelevant — blocks are matched by the package name npm prints above each one, not by position,
 * so adding a workspace cannot silently shift the comparison onto the wrong suite. */
const EXPECTED = {
  '@tflw/lang': 925, // +34 in M116: baseUrls 15, capturableSubjects 12, snapshotMasks 7
  '@tflw/runtime': 616, // +15 in `B3-04` (7 non-numbers × 2 matchers + 1 control); +7 in M116 (`checkConfigFiles`); +3 in M117 (`B3-18`: refresh, its control, the failed-refresh branch); +1 in M118 (the `tflw://` guard, added because `reserved-scheme-passes-through` survived); +8 in M119 (`B4-08`: 4 that the diagnosis now fires — expect, soft check, wait until, a failing `has count` — and 4 that it stays quiet on a resolved element, on either kind of pass against nothing, and on css/xpath); +4 in M119 (`M119-02`: `isSaturated`'s two arms at their real thresholds, the M32 short-window floor, and a healthy long window — replacing a `cpuPercent > 50` floor that raced the OS scheduler)
  '@tflw/reporter': 106,
  '@tflw/lsp-server': 117, // +3 in M116: `TF051` in the editor, its control, and the unrooted-buffer case
  tflw: 173, // +13 in M118: `FU-03` 2 (install-browsers success/failure), `FU-04` 4 e2e + 6 in demo-service.test.ts + 1 watch (the demo teardown, added because `demo-outlives-the-run` survived)
  'tflw-vscode': 34,
  '@tflw/docs-site': 32,
};

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const child = spawn(npm, ['run', 'test:raw'], { cwd: repoRoot, env: process.env });
let captured = '';
for (const stream of ['stdout', 'stderr']) {
  child[stream].on('data', (chunk) => {
    captured += chunk;
    process[stream].write(chunk);
  });
}

const status = await new Promise((resolve) => child.on('close', resolve));

// A red suite is the more useful signal, and `npm run test --workspaces` stops at the first failing
// workspace — so every workspace after it prints no summary and would be reported here as "did not
// report", burying the actual failure under a list of consequences. Same rule `mutate.mjs` applies
// to its baseline: do not attribute to one instrument what another has already found.
if (status !== 0) process.exit(status);

// npm prints `> @tflw/lang@0.1.0 test` before each workspace's command; the summary lines that
// follow belong to it until the next such header. A suite that prints no summary at all (crash, or
// a runner that never got to one) is a mismatch, not a skip.
//
// TWO SUMMARY FORMATS, BECAUSE THE DEFAULT REPORTER IS NOT THE SAME ON EVERY NODE. With no TTY,
// Node 22 defaults to `tap` (`# tests 876`) and Node 24 defaults to `spec` (`ℹ tests 876`). The
// first CI run of this script was green on 22 and red on 24 with all seven workspaces reported as
// "printed no summary" — every count was in fact correct and present, in the other syntax. Matching
// both is the fix; the counts themselves are identical because both reporters render the same
// summary object. If a future Node ships a third default, this goes red naming every package rather
// than passing quietly — which is the failure direction this script exists to have.
const counted = {};
let current = null;
for (const line of captured.split('\n')) {
  const header = /^> (\S+?)@[\d.]+ test(?::|$| )/.exec(line);
  if (header) {
    current = header[1];
    continue;
  }
  const tests = /^(?:# |ℹ )tests (\d+)$/.exec(line);
  if (tests && current) counted[current] = (counted[current] ?? 0) + Number(tests[1]);
}

const problems = [];
for (const [pkg, want] of Object.entries(EXPECTED)) {
  const got = counted[pkg];
  if (got === undefined) problems.push(`${pkg}: expected ${want} tests, but the run printed no test-summary line for it (neither \`# tests N\` nor \`ℹ tests N\`)`);
  else if (got !== want) problems.push(`${pkg}: expected ${want} tests, ran ${got}${got < want ? ` — ${want - got} test(s) did not report` : ' — new tests, or a suite counted twice'}`);
}
for (const pkg of Object.keys(counted)) {
  if (!(pkg in EXPECTED)) problems.push(`${pkg}: ran ${counted[pkg]} tests and is not listed in EXPECTED — add it to scripts/verify-test-counts.mjs`);
}

if (problems.length > 0) {
  console.error('\n✗ test headcount mismatch — the suite did not run what it contains:');
  for (const p of problems) console.error(`    ${p}`);
  console.error('\n  If you added or removed tests, update EXPECTED in scripts/verify-test-counts.mjs in the');
  console.error('  same commit. If you did not, a test failed to register — see that file\'s header.');
  process.exit(1);
}

if (status === 0) console.log(`\n✓ headcount: ${Object.values(EXPECTED).reduce((a, b) => a + b, 0)} tests across ${Object.keys(EXPECTED).length} workspaces, all present`);
process.exit(status);
