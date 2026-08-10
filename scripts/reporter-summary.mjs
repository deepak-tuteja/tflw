// Reading node:test's summary out of a captured run — one implementation, two consumers.
//
// `scripts/verify-test-counts.mjs` and `scripts/mutate.mjs` both spawn `npm test`, capture the
// output and parse the summary block for a count. They have now been wrong about that parse three
// times, in the same way, and the third time is why this module exists rather than a fourth copy of
// the regex:
//
//   1. Both only knew `# tests N` (tap). CI's first run of `verify-test-counts.mjs` was green on
//      Node 22 and red on Node 24 with all seven workspaces reported as "printed no summary" —
//      every count was present, in the `ℹ tests N` (spec) syntax. Fixed there.
//   2. `mutate.mjs` had the identical bug and kept it for fourteen more milestones (`M115-01`),
//      so on every spec-reporter machine each kill printed "a guard script, not a node:test
//      assertion" and each baseline printed "green, ? passing". `M119` fixed it — by editing the
//      regexes in place, forty lines from the file that had already documented the lesson. That
//      file's own header notes the lesson "didn't travel the 40 lines to here." It still didn't.
//   3. `M123`: both are `^`-anchored and neither strips ANSI, so **an environment that exports
//      `FORCE_COLOR` breaks both on any Node and any reporter**. `node --test` colours its summary
//      when told to, whether or not stdout is a pipe, and `^(?:# |ℹ )` cannot match a line that
//      begins with an escape sequence.
//
// (3) is the one that matters most, because it is not version-dependent and so cannot be reasoned
// about from "which Node is CI on". Measured, same machine, same Node v26.7.0, one variable:
//
//     FORCE_COLOR=3   →  "\x1b[34mℹ pass 17\x1b[39m"  →  NO MATCH
//     FORCE_COLOR unset →  "ℹ pass 17"                 →  17
//
// It was mistaken for a Node-version difference for four milestones because the two machines it was
// compared on differed in both: the Mac's terminal exports `FORCE_COLOR` and runs Node 26, while the
// Fedora box is reached over ssh (which does not forward it) and runs Node 22. Two machines
// differing in the suspected variable are not a controlled pair if they also differ in an
// unsuspected one.
//
// **The subject's environment is deliberately not touched.** The obvious alternative is to pass
// `NO_COLOR=1` to the child, which this repo already does in `verify-docs.mjs` and
// `verify-ledger.test.mjs`. Not here: `mutate.mjs`'s whole contract is that it runs the suite
// exactly as `npm test` runs it, so a verdict means the same thing locally as in CI — and
// `NO_COLOR` is not inert (`cli.ts` gates on it). The instrument adapts to the output; it does not
// edit the experiment to be easier to read.

/**
 * CSI SGR sequences — the colour/style codes node:test's reporters emit. Deliberately narrow: this
 * is for making a summary line matchable, not for sanitising arbitrary terminal output, and a
 * broader pattern risks eating something a caller wanted to keep.
 */
const SGR = /\x1b\[[0-9;]*m/g;

/** @param {string} text @returns {string} */
export function stripAnsi(text) {
  return text.replace(SGR, '');
}

/**
 * The count on one of node:test's summary lines, in either reporter's syntax.
 *
 * Returns `undefined` rather than a number when the line is absent, because every caller here has
 * to tell "the suite reported 0" apart from "the suite reported nothing" — a suite that never
 * printed a summary crashed, hung, or was cancelled, and none of those is a zero. `mutate.mjs`
 * used to conflate them into `-1`, a number that cannot occur and that no caller checked for.
 *
 * @param {string} out captured stdout+stderr of a `npm test` run
 * @param {'tests' | 'pass' | 'fail' | 'cancelled'} which
 * @returns {number | undefined}
 */
export function summaryCount(out, which) {
  const m = new RegExp(`^(?:# |ℹ )${which} (\\d+)$`, 'm').exec(stripAnsi(out));
  return m ? Number(m[1]) : undefined;
}

/**
 * Every `<pkg>: <count>` pair in a `npm run test:raw` capture, keyed by workspace.
 *
 * npm prints `> @tflw/lang@0.1.0 test` before each workspace's command and does **not** colour that
 * line, so the header has always matched and only the summary was being missed — which is why the
 * failure looked like "the suite ran but reported nothing" rather than "nothing was parsed".
 *
 * @param {string} out @returns {Record<string, number>}
 */
export function countsByWorkspace(out) {
  /** @type {Record<string, number>} */
  const counted = {};
  let current = null;
  for (const line of stripAnsi(out).split('\n')) {
    const header = /^> (\S+?)@[\d.]+ test(?::|$| )/.exec(line);
    if (header) {
      current = header[1];
      continue;
    }
    const tests = /^(?:# |ℹ )tests (\d+)$/.exec(line);
    if (tests && current) counted[current] = (counted[current] ?? 0) + Number(tests[1]);
  }
  return counted;
}

/**
 * The names of the tests that failed, from either reporter (`not ok N - name` / `✖ name (1.2ms)`).
 *
 * `M119`: a count is not actionable. An unscoped sweep aborted 26 mutations in with nothing but
 * "(1 failing)", and the suite passed on the next three runs — so the one run that could have named
 * the test was also the only run that would ever have it.
 *
 * @param {string} out @returns {string[]}
 */
export function failedTestNames(out) {
  const named = [...stripAnsi(out).matchAll(/^(?:not ok \d+ - (.+?)|✖ (.+?) \([\d.]+ms\))$/gm)]
    .map((m) => (m[1] ?? m[2]).trim())
    .filter((n) => n && n !== 'failing tests:');
  return [...new Set(named)];
}
