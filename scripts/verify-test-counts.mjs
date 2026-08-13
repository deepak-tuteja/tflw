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

import { journalPath, openJournalWarning, readJournal } from './mutation-journal.mjs';
import { countsByWorkspace } from './reporter-summary.mjs';

/** Every workspace with a `test` script, and how many tests its suite contains. Order is
 * irrelevant — blocks are matched by the package name npm prints above each one, not by position,
 * so adding a workspace cannot silently shift the comparison onto the wrong suite. */
const EXPECTED = {
  '@tflw/lang': 1102, // +29 in M130b2 (authzAssertions.test.ts, D307/D315/D328/D329/D331/D333 — the four placement rules, each with the negative control that keeps it from widening into the case the feature exists for, and with the silences asserted as hard as the reports: an `action` body and a bare `before` hook must stay quiet, because a checker that answered confidently there would refuse the language's only unit of reuse. Includes the case-insensitive `authorization` header, which is `M128`'s own bug pointed the other way — slipping through here sends a probe carrying the owner's token; the interpolated header *name* that is skipped rather than guessed at, since this rule refuses a file; the two controls proving Tier 1 is frozen, one for `wait until api` and one for an ownerless test; and the census under-claiming on an `action` step on purpose, a number whose whole job is to state a bound); +14 in M130b2 (D304/D307/D330's grammar: 5 hand-written in config.test.ts — each addition asserted to land on the node it was written under and on no other, because both ways of getting that wrong are silent (a `privileged` that leaks to the next session exempts a principal nobody exempted; a `probe mutating` that leaks grants a write nobody granted), plus the misordered `session … privileged oauth2` header, which is one diagnostic and a recovery rather than the two-error cascade it produced first — the second error was ``unknown step `token` `` about a block the author had written correctly; 8 from fixtures (`authz-declarations` and three invalid ones, 2 golden tests each); 1 absorbed by `suggestions.test.ts`'s round-trip loop, which will not let `authorization` be suggested until it is shown to complete a statement); +28 in M128b (`M128b` D291: 23 in authorizedTarget.test.ts — TF061's two shapes in both blocks plus its tier and its hint, TF060's origin matching across scheme/port/path, the loopback non-exemption, one-per-assertion, the two negative controls (no security assertion, an a11y assertion), the three `undefined`-vs-empty skips, and 2 composition tests pinning that `response` inherits `TF031` and `TF039` by not being on an exclusion list; +3 absorbed by existing suites: the `scanKind` vocabulary's two worked examples and its coverage guard); +18 in M125e (`FU-24`/D278 11 in blankLineCompletion.test.ts: the blank-line branch at four nesting depths, the probe character never reaching the answer, column zero, the two non-blank controls, one that pins `expect ` → `{kind:'step'}` as PRE-EXISTING behaviour this branch never reaches — I asserted `subject` first and was wrong about the code, not the code about itself — and one added by D278a that asserts nothing completes at declaration position, the fact the column-0 guard is redundant *because of*, so the harness's `equivalent: true` on that mutant cannot rot unnoticed; `FU-24`/D277 7 in stepKeywords.test.ts: the two-way parity sweep against `parser.ts`'s `STATEMENT_KEYWORDS`, the retired-spelling exclusion, unique ids, no `|` in a cell that renders into a markdown table, and the three shape checks); +9 in M125b2 (`FU-20c`/D261: the `prodId`/`productId` control that every EXISTING suggestion test passes either way, the 6-row measured ladder, the symmetry check, two over-widening guards incl. all 7 HTTP methods against each other, and the unchanged rules — exact match, empty candidates, ranked selection); +35 in M125b1 (`FU-18`: 10 lexer/D265 incl. THE control that has to contain `://` — the first version used decision 60's own `get / 2` example, which the mutation harness proved reaches none of the new branch, 2 shared-predicate, 8 TF057/TF058 incl. the undefined-vs-[] discriminator, 5 D247 scoping + relative/interpolated controls, 5 TF059, 3 reachability, 3 for the `TF051` interaction — an absolute step needs no base URL, and `TF051` is an ERROR, so the missing guard would have blocked programs that run); +44 in M124: literalOperands (TF054 26, TF055 7, TF056 9, composition 2)
  '@tflw/runtime': 877, // +15 in M130b2 (authz-assert.test.ts, D335 — the end-to-end fixture, which exists because `M128` paid for not having one: `sec/authenticated-response-cacheable` read a lowercase `authorization` key against a header map that preserves the case its author typed, so it fired for nobody while its unit tests passed, because those tests spelled the header the same way. What only this file can observe is the *joins* — the probe set really assembled from a parsed `tflw.config` (so the grammar commit and the engine commit have to agree), sessions really establishing lazily, a probe really going out as somebody else, and D324's taxonomy really reaching the message. The fixture app reproduces two shapes measured in the dogfood target rather than invented: a correct 404 that echoes the requested id (`categories.service.ts:44`), and a cookie-borne principal refused for CSRF before authorization is consulted (`M130-01`)); +4 in M130b2 (`mayProbeMutating`, D330: the grant is per origin and never inherited from a neighbouring declaration; two rows for one origin OR together and the answer cannot depend on their order — `resolve.ts` deliberately keeps accumulating so each declaration reaches the report with its own reason, which is exactly what leaves one origin arriving twice; port and scheme never widen it; and neither side of an unparseable URL is a grant); +35 in M130b1 (authz-probe.test.ts, D323-D326: identity replacement incl. case-insensitive stripping of the OWNER's `Authorization`/`Cookie` — the M128 header-casing bug repeated here would send the owner's own token on the probe — anonymous applying neither, a jar scoped to the wrong origin contributing nothing, and the observed trace surviving unedited; the full D324 taxonomy; D325's three-way split of one 403 by method and transport; and four `not probed` paths each asserted against `sentCount === 0`, because a skip whose only evidence is its own label is a skip that could be probing anyway. Includes THE test for the false positive this design turns off: a correct 404 that echoes the requested id — live in the target at `categories.service.ts:44` — must be a refusal, not a critical leak); +38 in M130b1 (authz-rules.test.ts, D320-D322/D324: 9 extraction shapes incl. the envelope and the `orderId`/`_id`/`uuid` refusals that keep the oracle from guessing; 7 containment incl. THE exact-leaf test that stops a numeric id `1` matching inside `"total": 41` — the reason there is no substring oracle and so no length threshold — and a 20,000-deep body proving the walk is iterative; the D320 shape-gate table with BOTH doors into D285, an owner body the oracle cannot read and a probe set nobody could judge; the finding's five facts, one-finding-per-violating-principal, D296's floor arithmetic; and 3 pack invariants, one of which caught `judgeable` defined as `refused || served-different`, which made a lone LEAKED probe engage no rule and report as not-applicable — a critical finding downgraded to silence); +66 in M128b (49 in security-rules.test.ts: all three of D284's states for each of the ten rules, the pack manifest, D296's floor-narrows-the-pack arithmetic, and the parse-failure/malformed-cookie edges; 17 in security-assert.test.ts: the counts line, D285's no-power-to-fail verdict, the floor, cookies split per line and read off an earlier redirect hop, the request-header casing bug that made `authenticated-response-cacheable` silently never fire, D287's session findings in three shapes, and `capture response`); +23 in M125c (`FU-21`/`B4-11` 15 pure: dedup's 4 incl. the crowding-out case, render's 3, `formatAmbiguity`'s 8 incl. the two branches no live page can stage on demand — the settled-page race, and the caller's count disagreeing with the describing query; `FU-14`/`FU-21` 8 against real Chromium: 3 discriminator tiers, 2 `B4-11` halves, and 3 for the speculative line incl. THE one that says the deadline did not move — an app rendering at 4s still passes); +16 in M125b2 (`FU-20a` 10: the two-direction conformance sweep of tflw's blocked-port list against what `fetch` actually refuses, no-explicit-port, unparseable, the hint's four claims, the never-read-the-cause-prose control, code-wins-over-port, end-to-end `:19`, and the unblocked-closed-port control that stops the switch being deleted wholesale; `FU-15` 6: suppression, once-per-run, delegation of a coded and an uncoded warning, listener-set restoration, end-to-end in a typeless temp project); +15 in M125b1 (`FU-18`: 6 `resolveWebUrl` incl. the literal concat regression, 6 D246 guard incl. the AllowHostsError type, 2 end-to-end two-server, 1 resolveBaseUrl control); +15 in `B3-04` (7 non-numbers × 2 matchers + 1 control); +7 in M116 (`checkConfigFiles`); +3 in M117 (`B3-18`: refresh, its control, the failed-refresh branch); +1 in M118 (the `tflw://` guard, added because `reserved-scheme-passes-through` survived); +8 in M119 (`B4-08`: 4 that the diagnosis now fires — expect, soft check, wait until, a failing `has count` — and 4 that it stays quiet on a resolved element, on either kind of pass against nothing, and on css/xpath); +4 in M119 (`M119-02`: `isSaturated`'s two arms at their real thresholds, the M32 short-window floor, and a healthy long window — replacing a `cpuPercent > 50` floor that raced the OS scheduler); +3 in M120 (`M119-01`: a typo'd `text` name, an unrelated one, and the same on the assertion path — all three asserting no `css "html…"` structural paths are offered); +6 in M121 (`M118-02`: one per open workload grammar x 4, the shared-pool assertion, and D208's `maxSockets`)
  '@tflw/reporter': 132, // +3 in M128b (D291's summary line: rendered with its reason, every declaration and not just the first, and the not-ambient control); +23 in M125d (`FU-16` 12 in failure-first.test.ts: the filter default both ways, THE one that proves the default is applied and not merely highlighted, the anchor, evidence open-on-fail/closed-on-pass, the assertion text staying outside the disclosure, no empty disclosure, the body surviving the fold, the cross-repo `.detail{`-ordering guard that only this side can check, and 2 for the final-attempt badge the milestone's own probe found lying; `FU-25`/`FU-19`/`FU-23` 11 in retry-and-filter.test.ts: 4 attempt-count incl. the two-lines-must-differ test that is the row restated, 3 for the relation firing only when both diagnoses do, 4 for the filter record incl. absent-not-empty-string)
  '@tflw/lsp-server': 151, // +21 in M125e (`FU-24` 15 in stepHover.test.ts: the four keywords the row names — all four hovered null — the span the editor underlines, the six places the textual rule must NOT fire incl. `log:` inside a wrapped body and `api` inside a string, the retired spelling the manifest never held, the `text`-defaulted-off branch, the three `imported action` label cases, THE D279a regression test that pins the label as a label while the ref stays kind `action`, and the config-buffer root that has no `imports` to read; `FU-24`/D277 6 in stepCompletionDetail.test.ts: every step completion carries its one-line detail, the count matches the manifest, prefix filtering keeps it, and the three that were previously offered bare); +3 in M116: `TF051` in the editor, its control, and the unrooted-buffer case; +13 in M122 — `B5-06` 9 (5 over the wire: diagnostics, hover+tokens, survives an edit, in-file rename, the `TF043` control; 4 `DocumentStore` units for the pathless buffer) and `B5-07` 4 (the 8 refused names, the keyword control that stops the fix over-rejecting, `prepareRename`'s range/placeholder, and its null case)
  tflw: 187, // +10 in M125e (`FU-29`/D252/D281 in docs-index.test.ts: 3 generator-side against a fixture — the `##` group each topic sits under, a heading whose trailing parenthetical wrapped onto the next SPEC line, and `headingSection` reading the number `headingTitle` strips — and 7 against the real generated `DOCS_TOPICS`, since the listing's whole job is the shape of the real list: every topic exactly once and nothing else, grouped rather than one flat run, SPEC order and not alphabetical, sorted inside a group, the title beside the slug, a `##` section's own topic not repeating its heading, and per-group column width so one 45-character outlier does not open that gutter on all sixty lines); +2 in M125d (`FU-23`/D250 end-to-end: an unfiltered run records no `filter` key and its replay says nothing about one; a `--tag smoke` run that fails records both, and the next `--failed` names the tag it is replaying); +2 in M125b2 (`FU-15`: `init` scaffolds `"type": "module"` and leaves an existing `package.json` byte-for-byte alone; plus THE end-to-end, which lives here and not in `@tflw/runtime` because that package's tests run under `--import tsx`, which resolves `.ts` itself and so suppresses the very warning the row is about — a fixture there asserts against an empty stderr and proves nothing); +13 in M118: `FU-03` 2 (install-browsers success/failure), `FU-04` 4 e2e + 6 in demo-service.test.ts + 1 watch (the demo teardown, added because `demo-outlives-the-run` survived)
  'tflw-vscode': 34,
  '@tflw/docs-site': 32,
};

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// M123 (`M111-02`) — refuse to run against a tree `scripts/mutate.mjs` is deliberately holding
// wrong.
//
// The sweep rewrites tracked sources in place for as long as each suite takes, and the row's worked
// example is a commit made inside that window: `M111`'s `1cdefdc` captured a mutated `cli.ts`. The
// window cannot be closed — the suite has to run against the real tree — but the gate people run
// *before* committing can refuse to give them a green while it is open. A suite run against a
// mutated source is worthless in both directions: red for someone else's edit, or green about code
// nobody is shipping.
//
// This is also the guard for a *dead* sweep, which is the more common case: `mutate.mjs` repairs a
// stale journal at startup, but nothing else does, so a tree left broken by a `kill -9` would
// otherwise sail into a full run and report a headcount for the wrong code.
//
// Deliberately NOT scoped to "is a sweep still alive", and the asymmetry with `mutate.mjs` is the
// point. That tool checks the journal's pid and treats the two cases differently — a live owner
// means another sweep holds the worktree, so refuse; a dead one means wreckage, so repair
// (`M123-03`). Here both cases have the same answer: the tree cannot be trusted either way, and a
// crashed run is the case that actually costs a commit. Same signal, opposite reason, one message.
let openSweep;
try {
  openSweep = readJournal();
} catch (err) {
  console.error(`✗ the mutation journal at ${journalPath()} is unreadable (${err.message}).`);
  console.error('  Something wrote it and did not finish. Check `git status` before deleting it by hand.');
  process.exit(2);
}
if (openSweep) {
  console.error(`✗ ${openJournalWarning(openSweep)}`);
  process.exit(2);
}

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
//
// M123 (`M123-01`): AND A THIRD FORMAT, WHICH IS NOT A FORMAT AT ALL. Both patterns above are
// `^`-anchored, and `node --test` colours its summary whenever the environment exports
// `FORCE_COLOR` — pipe or no pipe, any Node, either reporter. So on a machine whose terminal sets
// it (this repo's Mac does; ssh to the Fedora box does not forward it, which is why the box never
// showed it) the line is `\x1b[34mℹ tests 925\x1b[39m`, nothing matches, and **this script goes red
// naming every workspace as "printed no test-summary line" while every suite was in fact green with
// the right count**. Measured against a real captured run: `{}` as captured, `{"@tflw/lang":925}`
// after stripping. The parse now lives in `reporter-summary.mjs` and strips ANSI first — one
// implementation, because this is the third time the two consumers have been wrong about the same
// line and the first two fixes were made by editing each copy in place.
const counted = countsByWorkspace(captured);

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
