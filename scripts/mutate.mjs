#!/usr/bin/env node
// The M98 cluster's mutations, made repeatable.
//
// `PLAN_M98_LEXER_POSITIONS.md` records 31 mutations across M98b/M98c/M98d and what each one did to
// the suite — but records them as *prose*, run by hand, once, on a stacked branch that no longer
// exists. Between then and now `M97e`, `M99`–`M105` edited the same lexer and parser regions. The
// question a written mutation cannot answer is whether the control that killed it still can.
//
// Each entry below is one exact-string edit to one source file. The runner applies it, runs the
// suite of the workspace that entry names (`pkg`, default `@tflw/lang` — ~1.4s, tsx straight off
// source, no build step), records which tests died, and reverts. A mutation that leaves the suite
// **green has survived**, and a survivor is a claim about the tests, not about the code: nothing in
// the suite can tell that line from its opposite.
//
//   node scripts/mutate.mjs            run all
//   node scripts/mutate.mjs m98d       run one milestone's
//   node scripts/mutate.mjs bom-col    run one by id
//
// M107 widened it past `@tflw/lang`: the first mutation outside the language packages targets the
// runtime's back-off diagnostic, whose negative control had been passing for free. Its suite costs
// ~21s rather than 1.4s, so a runtime mutation is worth adding only where the claim is about a
// control's kill power and no cheaper subject exists.
//
// M108 widened it again, past *source* files: a mutation may target a test file where the thing
// being measured is a guard's kill power rather than a behaviour's coverage.
//
// M109 added the clearest case the runtime rule has had: `imports-drop-body` reverts
// `resolveImportedActions` to dropping the imported body, which **no `@tflw/lang` test can see** —
// every cross-file cycle test over there builds its `KnownAction[]` by hand and stays green. The
// 21s buys the only signal that `packages/runtime/test/import-cycles.test.ts` tests the join it
// names.
//
// M110 widened the *subject* rather than the package: `cli-reference-section` mutates a docs page,
// not code. It is the only way to measure a documentation guard, and it exposed a reporting bug in
// this file — `@tflw/docs-site`'s `npm test` chains `verify-docs.mjs` after node:test, so a kill by
// the guard leaves the summary reading `# fail 0` and the runner printed "killed 0 failing". A
// measured zero that is really "not counted this way" is the exact class this tool exists to find,
// so the kill line now says which it is.
//
// M119 found the *second* way that line lied, and it had nothing to do with guard scripts: the two
// summary formats. With no TTY, Node 22 defaults to the `tap` reporter (`# fail 0`) and Node 24+ to
// `spec` (`ℹ fail 0`), and these regexes only ever knew `tap`. So on any modern Node — CI's Node 24
// leg, and this Mac — *every* kill printed "suite exited non-zero (a guard script, not a node:test
// assertion)" and every baseline printed "green, ? passing", whatever actually happened. The
// verdicts were never affected (kill/survive reads the exit code, not the summary), but the stated
// reason was wrong on half the machines that run this. `verify-test-counts.mjs` had already been
// bitten by exactly this and documents it at length; the lesson didn't travel the 40 lines to here.
// Both formats are matched now, the same way that file matches them.
//
// **Coverage is derived now, not written down (M126, `M125e-02`).** This paragraph used to carry a
// hand-counted census — *"74 entries — 20 from the M98 plan (m98b 5, m98c 12, m98d 3), 8 from M106,
// …"*, stopping at M121. By M126 the array held **120**. That is the **fourth** time the number here
// went wrong, after the three recorded below, and it went wrong the same way every time: *every
// milestone that adds a mutation updates the array and not the prose*, because `verify:mutations`
// checks the array and nothing checks the sentence. So the census is gone rather than corrected.
// `coverage()` computes it from `MUTATIONS`, the sweep prints it **on** the summary line, and
// `coverageProblem()` fails the run when it stops adding up — the same treatment the ledger's
// `tally:current` marker gives the other side of the repo, which is what the line this replaces
// already named as the right answer without doing it.
//
// **The M98 reconciliation, settled.** The plan's 31 is `M98_PLAN` below — 5 + 11 + 15, read off
// `PLAN_M98_LEXER_POSITIONS.md`'s own shipped sections (*"All five negative controls
// mutation-tested"*; *"Eleven mutations run"*; *"Two of fifteen mutations survived"*). M98a shipped
// none. Against that, this registry holds 20 `m98`-scoped entries, of which **13 reconstruct a plan
// mutation** (flagged `plan: true`) and **7 are controls #28 invented while writing them**:
// generalising `unlexable-drops-at` to `#` and `"`, the three `M98c-02` fix controls,
// `unclosed-bracket-silent`, `bom-not-hidden-exempt`. Those seven are good mutations and they are
// not reconstructions — counting them as such is how *"20 of the plan's 31"* overstated this
// registry's coverage of M98 by seven, from #28 until M126.
//
// **And the 11-vs-16 that "cannot be settled from this side" was a category error.** The note here
// used to read: 31 − 20 = 11 unreconstructed, but the five `UNRECONSTRUCTED` groups' own counts
// (2 + 1 + 1 + 2 + 10) sum to 16, and that disagreement lives in prose which cannot be settled
// against prose. The parenthesised numbers were never mutation counts. They are **kill** counts,
// lifted verbatim from the plan's *"Nine died as intended (D159 reverted → 2; re-scanning for `#`
// instead of taking `lexContent`'s return → 1; …)"*, where `→ 2` means *two tests failed*. Each of
// those groups is one mutation. Read as what they are, the plan settles the question by itself and
// no second source is needed: the real gap is **18 mutations in 18 groups** — the four in m98c the
// old array named, **thirteen** in m98d where it claimed ten, and one in m98b it omitted entirely
// (`A1-20`'s stray closer, which exists nowhere in this registry under any milestone).
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyJournal, clearJournal, isProcessAlive, journalPath, readJournal, writeJournal } from './mutation-journal.mjs';
import { failedTestNames, summaryCount } from './reporter-summary.mjs';
import { ROOT_SUITE, SELF_MUTATIONS } from './self-mutations.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LEXER = 'packages/lang/src/lexer.ts';
const PARSER = 'packages/lang/src/parser.ts';
const DIAG = 'packages/lang/src/diagnostic.ts';
const INTERP = 'packages/runtime/src/interpreter.ts';
const CHECKER = 'packages/lang/src/checker.ts';
const SPEC_DATA = 'packages/lang/src/spec-data.ts';
const LSP_SERVER = 'packages/lsp-server/src/server.ts';
const CRAWL = 'packages/runtime/src/crawl.ts';
const CRAWL_SURFACE = 'packages/runtime/src/crawlSurface.ts';
const SPIDER = 'packages/runtime/src/spiderSurface.ts';
const REDIRECT = 'packages/runtime/src/redirect.ts';
const REPRO = 'packages/reporter/src/repro.ts';
const SARIF = 'packages/reporter/src/sarif.ts';

// M123 (D226) — a mutation may name the root `test:scripts` suite instead of a workspace, because
// this file and its helper modules are now mutation targets themselves. Those entries live in
// `scripts/self-mutations.mjs`, which explains at length why they cannot live here: a `find:`
// literal in the same file it targets makes the string occur twice, and the runner's
// exactly-once guard then refuses to apply it — silently, as `stale`.
export { ROOT_SUITE };

/** Tracked files a suite *rewrites as a side effect of running*, which therefore have to be
 *  restored alongside the mutated file. SPEC.md is one: `@tflw/lang`'s `pretest` regenerates its
 *  §6.2/§7/§17 tables from `spec-data.ts`. Anything gitignored (`docs-data.generated.ts`,
 *  `dist/`) is deliberately absent — the next build reproduces it and no commit can carry it. */
const SIDE_EFFECT_FILES = ['SPEC.md'];

/** M107 — a mutation names the workspace whose suite judges it, because the tool no longer only
 * mutates `@tflw/lang`. Defaulted rather than added to all 18 existing entries: the lang suite is
 * still where nearly every mutation lives, and a field repeated 18 times to say "as before" is
 * noise. Each distinct package is baselined once, on first use. */
const DEFAULT_PKG = '@tflw/lang';

/**
 * M127 (`M126-01`) — one run of each package's suite, in seconds, on a 2-core GitHub runner.
 *
 * **Balancing hint only.** `partition()` is total and disjoint whatever these numbers say; a stale
 * entry makes a shard slower or faster than its siblings and can make nothing else go wrong. That
 * property is the reason a measured table is affordable here at all, and it is why there is no
 * machinery to keep it fresh.
 *
 * Measured rather than guessed, which is what `M126-01` asked for. Run 31540764432's `mutation
 * controls` job printed a timestamp per mutation and per baseline; the deltas group by package as:
 *
 *     package             baseline    n   per-mutation   total
 *     @tflw/runtime            58s   36          59.6s   36.8m
 *     tflw                    163s    7         160.8s   21.5m
 *     root:test:scripts        41s   12          30.9s    6.9m
 *     @tflw/lang                8s   49           6.6s    5.6m
 *     @tflw/lsp-server          4s    8           7.4s    1.1m
 *     @tflw/reporter            3s    9           2.6s    0.4m
 *     @tflw/docs-site           4s    1           4.5s    0.1m
 *
 * Two things in that table decide the whole design. **A baseline costs almost exactly one mutation
 * of the same package** — it is the same suite run — so a shard's price is `(1 + n) × suite` per
 * package it touches, and splitting a package across shards is charged one extra suite run each
 * time. And **two packages hold 81% of the clock**, so sharding by milestone — the axis `M126-01`
 * reached for first — would have split the registry along a line the cost does not follow.
 */
/**
 * M148 (`M147-11`) — **re-measured from runner logs, because the first set went stale and killed a
 * shard.** Every number below was `31`-style folklore until run 32504021628: each shard prints
 * `baseline <pkg> …` with a timestamp, so the true cost of one suite run is the delta into that
 * line, and eleven shard logs give it for free. What that showed:
 *
 *     package              was   measured   samples
 *     root:test:scripts     31       108          1     ← 3.5× light; this is the one that killed
 *     @tflw/runtime         60        68          8
 *     tflw                 161       169 (max 185) 2
 *     @tflw/lang             7        10          1
 *     @tflw/reporter         3         4          1
 *     @tflw/lsp-server       7         5          1     ← table was heavy, which is the safe way
 *     tflw-vscode            3         1          1     ← ditto
 *     @tflw/docs-site        5         5          1     ← the only one that was right
 *
 * Seven of eight had drifted, and only the direction saved most of them: a table that reads *heavy*
 * over-provisions, and a table that reads *light* packs a shard it cannot pay for. `partition()`
 * packs by these numbers, so a light entry does not merely mispredict — it decides the hand. At 31
 * the eighteen root-suite mutations modelled at `19 × 31 = 589s` and looked cheap enough to keep in
 * one bin; at the true 108 the same chunk is `19 × 108 = 2052s`, over the job's whole limit with a
 * shard to itself, and the packer cuts it up on its own.
 *
 * **`costProblem()` asserted every package *has* a number here and nothing ever asserted the number
 * was still true.** That is why `verify-shards.mjs` now re-measures: each shard writes what its
 * baselines actually cost into its manifest, and the aggregate job reads them back. A constant
 * nobody re-measures is a constant that is wrong and cannot say so.
 */
export const SUITE_SECONDS = {
  '@tflw/lang': 10,
  '@tflw/runtime': 68,
  '@tflw/reporter': 4,
  '@tflw/lsp-server': 5,
  '@tflw/docs-site': 5,
  // M136b — first mutations aimed at the extension package. Measured locally rather than on a
  // runner (the table above is 2-core GitHub numbers): the suite is ~1s of tests behind a
  // `vscode-oniguruma` WASM load. M148 re-measured it on a runner at 1s and took the runner's
  // number, since every other entry here is now a runner number and a mixed table is the thing
  // that made this one hard to check.
  'tflw-vscode': 1,
  // Two samples, 169s and 185s. The larger, because `tflw` is the second-heaviest package and this
  // number's job is to stop a shard overrunning, not to predict its median.
  tflw: 185,
  [ROOT_SUITE]: 108,
};

// The two adjacent branches in `parsePrimary`'s number path, verbatim, so the ordering mutation is a
// swap of whole blocks rather than a hand-retyped approximation of them.
const DURATION_BRANCH = `        if (unitTok.type === 'ident' && unitTok.span.start.offset === tok.span.end.offset && (DURATION_UNITS as readonly string[]).includes(unitTok.value)) {
          this.advance();
          const ms = toMs(Number(tok.value), unitTok.value as (typeof DURATION_UNITS)[number]);
          const lit: DurationLit = { type: 'DurationLit', ms, raw: \`\${tok.raw}\${unitTok.value}\`, span: { start: tok.span.start, end: unitTok.span.end } };
          return lit;
        }
`;
const DATE_BRANCH = `        // A number followed (whitespace allowed) by a spelled-out unit is a date offset, e.g.
        // \`3 days\` in \`today + 3 days\` (P#25) — distinct word set from the duration units above.
        if (unitTok.type === 'ident' && (DATE_OFFSET_UNITS as readonly string[]).includes(unitTok.value)) {
          this.advance();
          const lit: DateOffsetLit = { type: 'DateOffsetLit', amount: Number(tok.value), unit: unitTok.value as DateOffsetUnit, span: { start: tok.span.start, end: unitTok.span.end } };
          return lit;
        }
`;

/**
 * `plan: true` marks an entry as a **reconstruction of a mutation the M98 plan actually ran**, as
 * opposed to a control written here while reconstructing one. Only `m98*` entries carry it; it is
 * what `coverage()` counts against `M98_PLAN`, and the two sides are asserted equal by
 * `coverageProblem()` so neither can drift alone (M126, `M125e-02`).
 *
 * @type {{id: string, milestone: string, file: string, what: string, plan?: boolean, find?: string, replace?: string, edits?: [string, string][], equivalent?: boolean}[]}
 */
const REGISTRY = [
  // --- M98d ------------------------------------------------------------------------------------
  {
    id: 'bom-col',
    milestone: 'm98d',
    plan: true,
    file: LEXER,
    what: 'a BOM at offset 0 counts as an indent column again (`M98d-01`)',
    find: 'const bomCol = lineStart === 0 && line[0] === BOM ? 1 : 0;',
    replace: 'const bomCol = 0;',
  },
  {
    id: 'unicode-escape-recovery',
    milestone: 'm98d',
    plan: true,
    file: LEXER,
    what: 'a malformed `\\u{…}` recovers verbatim, inventing a variable for the checker to reject',
    find: "      this.diag(Codes.UNKNOWN_ESCAPE, 'error', message, { start: at(c), end: at(end) }, hint);\n      return { text: '', next: end };",
    replace: "      this.diag(Codes.UNKNOWN_ESCAPE, 'error', message, { start: at(c), end: at(end) }, hint);\n      return { text: line.slice(c + 1, end), next: end };",
  },
  {
    id: 'bom-not-hidden-exempt',
    milestone: 'm98d',
    file: LEXER,
    what: 'the `BOM` clause leaves `isUnlexable`',
    find: "function isUnlexable(ch: string): boolean {\n  return !(ch === ' ' || ch === '\\t' || ch === BOM",
    replace: "function isUnlexable(ch: string): boolean {\n  return !(ch === ' ' || ch === '\\t'",
    // Surviving is the *correct* result here, and saying so is the point of keeping it. At offset 0
    // the leading-whitespace scan consumes the BOM before `isUnlexable` is consulted; mid-line the
    // hidden-character check (`TF049`) intercepts it before recovery runs. Probed both positions
    // plus two controls: byte-identical diagnostics with and without the clause. So this mutation
    // does not mutate, and a survivor here is a fact about the mutation, not about the tests —
    // exactly the distinction a bare survivor count erases.
    equivalent: true,
  },

  // --- M98c ------------------------------------------------------------------------------------
  {
    id: 'unlexable-drops-at',
    milestone: 'm98c',
    plan: true,
    file: LEXER,
    what: '`@` leaves `isUnlexable`, so a garbage run swallows the start of a tag',
    find: "|| ch === '\"' || ch === '/' || ch === '@' ||",
    replace: "|| ch === '\"' || ch === '/' ||",
  },
  {
    id: 'unlexable-drops-hash',
    milestone: 'm98c',
    file: LEXER,
    what: '`#` leaves `isUnlexable`, so a garbage run swallows the start of a comment',
    find: "ch === BOM || ch === '#' ||",
    replace: 'ch === BOM ||',
  },
  {
    id: 'unlexable-drops-quote',
    milestone: 'm98c',
    file: LEXER,
    what: '`"` leaves `isUnlexable`, so a garbage run swallows the start of a string',
    find: "ch === '#' || ch === '\"' ||",
    replace: "ch === '#' ||",
  },
  {
    id: 'max-run-chars-unbounded',
    milestone: 'm98c',
    plan: true,
    file: LEXER,
    what: 'the coalesced run is unbounded — `A1-01`\'s quadratic blow-up returns through the message',
    find: 'const MAX_RUN_CHARS = 16;',
    replace: 'const MAX_RUN_CHARS = Number.MAX_SAFE_INTEGER;',
  },
  {
    id: 'max-unexpected-unbounded',
    milestone: 'm98c',
    plan: true,
    file: LEXER,
    what: 'the per-file diagnostic ceiling is gone (`A1-01`)',
    find: 'const MAX_UNEXPECTED_CHARS = 50;',
    replace: 'const MAX_UNEXPECTED_CHARS = Number.MAX_SAFE_INTEGER;',
  },
  {
    id: 'invisible-requoted',
    milestone: 'm98c',
    plan: true,
    file: LEXER,
    what: 'invisible characters are quoted whole again — `unexpected character " "` for a U+00A0',
    find: 'const named = anyInvisible ? chars.map(describeChar).join(\', \') : JSON.stringify(run);',
    replace: 'const named = JSON.stringify(run);',
  },
  {
    id: 'cut-short-dropped',
    milestone: 'm98c',
    plan: true,
    file: LEXER,
    what: 'the "name was cut short" clause is dropped, so `let café = 1` reads as two unrelated errors',
    find: "            ? `the name \\`${prev.value}\\` was cut short here — `\n            : '';",
    replace: "            ? ''\n            : '';",
  },
  {
    id: 'tab-under-tf003',
    milestone: 'm98c',
    plan: true,
    file: LEXER,
    what: 'the tab rule goes back under `TF003`, so one code means two unrelated things again',
    find: '      Codes.TAB_INDENT,\n',
    replace: '      Codes.INCONSISTENT_INDENT,\n',
  },
  {
    id: 'duration-any-adjacent-word',
    milestone: 'm98c',
    plan: true,
    file: PARSER,
    what: 'the enumerated duration table becomes "any adjacent word"',
    find: "  if ((DURATION_UNITS as readonly string[]).includes(lower)) return lower as DurationUnit;",
    replace: "  if (lower.length > 0) return lower as DurationUnit;",
  },
  // `M98c-02`, both halves and the pair — and the row turns out to be wrong about its own example.
  //
  // The row says `today + 3 hours` becomes `unknown time unit` when, and only when, both properties
  // break together. Measured across six configurations (baseline, each half, the pair, the adjacency
  // guard removed, and adjacency removed *with* half 1), `today + 3 hours` is **clean in every one**.
  // It cannot reach the duration rule at all: `today + …` goes through the value path below, where
  // the duration branch is guarded by *adjacency*, and `pause 3 hours` goes through `parseDuration`,
  // a different function. The two vocabularies never compete on the same input.
  //
  // What the disjointness invariant really protects is the *message* `pause 3 hours` gets — half 1
  // turns ``unknown time unit `hours` `` (true: tflw has no unit above `m`) into `a duration unit
  // must touch its number` (advice that points at a spelling which is still not a unit). Worth
  // keeping and worth pinning. But it is not a two-change failure, and `date-check-before-duration`
  // is not half of one — see its `equivalent` note.
  //
  // `A1-07`'s own comment in `teaching.test.ts` already reasons its way to "with disjoint tables,
  // swapping the order changes no output". That much is right, and is now measured rather than
  // argued. The sentence beside it — that each half was mutated separately and only the pair breaks
  // anything — describes a break that does not occur.
  {
    id: 'duration-table-gains-hours',
    milestone: 'm98c',
    file: PARSER,
    what: 'half 1 of `M98c-02`: the vocabularies stop being disjoint (`hours` joins the duration table)',
    edits: [['export const DURATION_UNITS = [\'ms\', \'s\', \'m\'] as const;', "export const DURATION_UNITS = ['ms', 's', 'm', 'hours'] as const;"]],
  },
  {
    id: 'date-check-before-duration',
    milestone: 'm98c',
    file: PARSER,
    what: 'the date-offset branch is consulted before the duration branch',
    edits: [[DURATION_BRANCH + DATE_BRANCH, DATE_BRANCH + DURATION_BRANCH]],
    // Surviving is correct. With the tables disjoint, neither branch can claim a word the other
    // wants, so order cannot matter: a spaced date word (`3 days`) fails the duration branch's
    // adjacency test either way, an adjacent one (`3days`) fails its membership test, and an
    // adjacent duration (`30s`) is not a date word. Probed on all four shapes with identical output.
    // Left in the registry rather than deleted: if the tables ever stop being disjoint this becomes
    // a real mutation, and it will report itself as mislabelled rather than quietly pass.
    //
    // **It reported itself, and the report was right about the file and wrong about the premise**
    // (`M147d`, D638). `DurationLit` gained a `raw` field, `DURATION_BRANCH`'s quoted text moved,
    // and `mutate.test.mjs` failed this entry as stale in the same milestone that folded the three
    // unit vocabularies into one — which reads exactly like the condition above coming true. It is
    // not: D638's union lives in `TIME_UNIT_MS` and in `parseDuration`, and the two arrays this
    // branch pair tests against are still **disjoint**, because in *value* position the split is
    // what distinguishes `500ms` (a duration) from `3 days` (a date offset). So the entry stays
    // `equivalent`, and the thing worth keeping is that a comment written eight milestones ago
    // named its own falsification condition precisely enough to be checked when it nearly fired.
    equivalent: true,
  },
  {
    id: 'm98c-02-both-halves',
    milestone: 'm98c',
    file: PARSER,
    what: 'both halves of `M98c-02` at once — the only combination that changes what a user sees',
    edits: [
      ["export const DURATION_UNITS = ['ms', 's', 'm'] as const;", "export const DURATION_UNITS = ['ms', 's', 'm', 'hours'] as const;"],
      [DURATION_BRANCH + DATE_BRANCH, DATE_BRANCH + DURATION_BRANCH],
    ],
  },

  // --- M98b ------------------------------------------------------------------------------------
  {
    id: 'number-rule-broadened',
    milestone: 'm98b',
    plan: true,
    file: LEXER,
    what: 'D158 as the plan first wrote it — any number followed by an ident, which is every duration',
    find: "    if (/^[eE][+-]?\\d+$/.test(suffix)) {",
    replace: "    if (suffix.length > 0) {",
  },
  {
    id: 'unknown-escape-silent',
    milestone: 'm98b',
    plan: true,
    file: LEXER,
    what: '`TF047` goes back to silence — an unknown escape just loses its backslash (`A1-05`)',
    find: "        const decoded = ESCAPES[next];\n        if (decoded === undefined) {\n          this.diag(",
    replace: "        const decoded = ESCAPES[next];\n        if (false) {\n          this.diag(",
  },
  {
    id: 'unclosed-bracket-outermost',
    milestone: 'm98b',
    plan: true,
    file: LEXER,
    what: 'the *outermost* unclosed bracket is reported instead of the innermost (`A1-10`)',
    find: 'const unclosed = this.openBrackets[this.openBrackets.length - 1];',
    replace: 'const unclosed = this.openBrackets[0];',
  },
  {
    id: 'unclosed-bracket-silent',
    milestone: 'm98b',
    file: LEXER,
    what: 'an unclosed `{`/`[` at EOF produces no lexer diagnostic at all (`A1-10`)',
    find: 'const unclosed = this.openBrackets[this.openBrackets.length - 1];\n    if (unclosed) {',
    replace: 'const unclosed = this.openBrackets[this.openBrackets.length - 1];\n    if (false && unclosed) {',
  },
  {
    id: 'empty-tag-on-every-tag',
    milestone: 'm98b',
    plan: true,
    file: LEXER,
    what: '`TF046` fires on every tag, well-formed or not (`A1-11`)',
    find: "        if (name === '' || !isIdentStart(name[0]!)) {",
    replace: '        if (true) {',
  },

  // --- M106 ------------------------------------------------------------------------------------
  // Written *with* the milestone rather than reconstructed after it, which is the whole point of the
  // file existing. Each of M106's eight controls has exactly one mutation that kills it and does not
  // kill the two negative controls; the mapping is in `PLAN_M106_ZERO_EXTENT_CARET.md`.
  {
    id: 'anchor-never-moves',
    milestone: 'm106',
    file: DIAG,
    what: 'the caret is never re-anchored — every end-of-source diagnostic back on the phantom line (`M98c-01`)',
    find: 'if (start.offset !== end.offset) return here;',
    replace: 'if (true) return here;',
  },
  {
    id: 'anchor-ignores-extent',
    milestone: 'm106',
    file: DIAG,
    what: 'the zero-extent guard is dropped, so a diagnostic with a real underline moves too (D192)',
    find: 'if (start.offset !== end.offset) return here;',
    replace: 'if (false) return here;',
  },
  {
    id: 'anchor-blank-only',
    milestone: 'm106',
    file: DIAG,
    what: 'the walk-back skips blank lines but not comments — the caret lands in prose (D193)',
    find: "  return trimmed !== '' && !trimmed.startsWith('#');",
    replace: "  return trimmed !== '';",
  },
  {
    id: 'anchor-no-floor',
    milestone: 'm106',
    file: DIAG,
    what: 'the walk-back has no floor and runs off the front of the array (D196)',
    find: '  if (i < 0) return here;',
    replace: '  if (false) return here;',
  },
  {
    id: 'anchor-keeps-trailing-space',
    milestone: 'm106',
    file: DIAG,
    what: 'the anchor column includes trailing whitespace instead of stopping at the code (D194)',
    find: "  const afterCode = (line: string): number => line.replace(/[ \\t\\r]+$/, '').length + 1;",
    replace: '  const afterCode = (line: string): number => line.length + 1;',
  },
  {
    id: 'anchor-own-line-no-clamp',
    milestone: 'm106',
    file: DIAG,
    what: 'a caret already on its own code line is not clamped back to the end of that code (D194b)',
    find: 'return { line: start.line, column: Math.min(start.column, afterCode(atCaret)) };',
    replace: 'return { line: start.line, column: start.column };',
  },
  {
    id: 'anchor-locator-unmoved',
    milestone: 'm106',
    file: DIAG,
    what: 'the caret moves but the `-->` locator stays behind, naming a line the snippet does not show (D195)',
    find: "const locator = `${pad}${c.blue('-->')} ${filename}:${anchor.line}:${anchor.column}`;",
    replace: "const locator = `${pad}${c.blue('-->')} ${filename}:${start.line}:${start.column}`;",
  },
  {
    id: 'anchor-caret-width',
    milestone: 'm106',
    file: DIAG,
    what: "a re-anchored caret takes its width from the line it left, spraying carets across the anchor line",
    find: 'const rawCaretEnd = moved ? rawCaretStart + 1 :',
    replace: 'const rawCaretEnd = false ? rawCaretStart + 1 :',
  },
  // --- M107 ------------------------------------------------------------------------------------
  {
    id: 'backoff-hold-kind',
    milestone: 'm107',
    pkg: '@tflw/runtime',
    file: INTERP,
    what: 'the D17 back-off diagnostic stops applying to `hold N users` — its negative control has nothing left to check',
    find: "const CLOSED_USERS_KINDS = new Set<Workload['type']>(['RampUsersWorkload', 'HoldUsersWorkload', 'StepUsersWorkload', 'SpikeUsersWorkload']);",
    replace: "const CLOSED_USERS_KINDS = new Set<Workload['type']>(['RampUsersWorkload', 'StepUsersWorkload', 'SpikeUsersWorkload']);",
  },
  // --- M107b (`M107-01`) -------------------------------------------------------------------------
  // The other direction. `backoff-hold-kind` above checks that removing the diagnostic from a kind
  // that should have it turns something red; this checks that *restoring* it to a kind that should
  // not gets caught too. Without it, D-M107-1's rule is protected only by tests asserting
  // `undefined`, and an assertion that a value is absent is satisfied by a great many accidents.
  {
    id: 'backoff-constant-concurrency',
    milestone: 'm107b',
    pkg: '@tflw/runtime',
    file: INTERP,
    what: 'the back-off diagnostic is handed rising-target workloads again — a healthy service under `ramp` scores 0.57 and reads as backing off',
    find: '  if (!hasConstantConcurrency(scenario.workload)) return undefined;',
    replace: '',
  },
  // --- M108 ------------------------------------------------------------------------------------
  // The first mutation of a *test* file rather than a source file, and it is the right subject: what
  // M107-03 shipped is a guard whose whole job is to notice a test that leaks. Deleting one
  // `await server.close()` is exactly the defect it exists to catch, so its kill power is a claim
  // this tool can keep re-checking rather than one the milestone asserts once. Costs the runtime
  // suite (~21s) plus the watchdog's own 30s, and the 30s is only ever paid by a mutant.
  {
    id: 'leaked-fixture-server',
    milestone: 'm108',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/test/unified-dispatch.test.ts',
    what: 'a test forgets `await server.close()`, so its file can never exit — the exact shape `--test-force-exit` used to hide',
    find: "  assert.ok(sceneB!.iterations > 0, 'a forked shard must not zero out a later-batch sequential scenario either');\n  await server.close();",
    replace: "  assert.ok(sceneB!.iterations > 0, 'a forked shard must not zero out a later-batch sequential scenario either');",
  },
  // --- M109 ------------------------------------------------------------------------------------
  {
    // The one mutation the `@tflw/lang` suite structurally cannot judge, which is why it is here and
    // why it pays the runtime suite's ~21s: every cross-file cycle test in `actionCycles.test.ts`
    // builds its `KnownAction[]` by hand, so all of them stay green with the resolver reverted to
    // its pre-M109 self. If this survives, `import-cycles.test.ts` is not testing the join it names.
    id: 'imports-drop-body',
    milestone: 'm109',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/imports.ts',
    what: '`resolveImportedActions` goes back to dropping the imported body, so `TF044` cannot cross a file boundary',
    find: 'out.push({ name: action.name, arity: action.params.length, from: imp.path.value, body: action.body });',
    replace: 'out.push({ name: action.name, arity: action.params.length, from: imp.path.value });',
  },
  {
    id: 'cycle-imported-shadowing',
    milestone: 'm109',
    file: CHECKER,
    what: 'an imported action overwrites a same-named local one, inverting `buildRegistry`\'s order and inventing cycles no run can reach',
    find: 'if (imported.body !== undefined && !graph.has(imported.name)) graph.set(imported.name, { body: imported.body, from: imported.from });',
    replace: 'if (imported.body !== undefined) graph.set(imported.name, { body: imported.body, from: imported.from });',
  },
  {
    id: 'cycle-anchor-foreign-span',
    milestone: 'm109',
    file: CHECKER,
    what: 'the cross-file diagnostic points at the closing call wherever it is, underlining an offset into another file\'s text',
    find: 'const anchor = closing.localSite ? closing : cycleEdges.find((edge) => edge.localSite);',
    replace: 'const anchor = closing;',
  },
  {
    id: 'config-directive-list',
    milestone: 'm110',
    file: 'packages/lang/src/spec-data.ts',
    what: '`TF022` goes back to naming four config directives while the parser accepts five — `V4-04` exactly, re-introduced at its single source',
    find: "export const CONFIG_DIRECTIVES = ['defaults', 'env', 'session', 'require', 'exclude'] as const;",
    replace: "export const CONFIG_DIRECTIVES = ['defaults', 'env', 'session', 'require'] as const;",
  },
  {
    id: 'cli-reference-section',
    milestone: 'm110',
    pkg: '@tflw/docs-site',
    file: 'packages/docs-site/reference/cli.md',
    what: 'the CLI reference loses its `tflw lsp` section — the state the page shipped in for eleven milestones',
    find: '## `tflw lsp`',
    replace: '## The language server',
  },
  {
    id: 'session-source-lines',
    milestone: 'm111',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: "a session's derived context goes back to carrying the *caller's* text, so every session step is rendered from the wrong document (`FU-06`)",
    find: 'return { ...tc, lines: tc.configLines, baseDir: tc.configDir,',
    replace: 'return { ...tc, baseDir: tc.configDir,',
  },
  {
    id: 'oauth2-session-ctx',
    milestone: 'm111',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'the oauth2 arm goes back to bypassing `sessionCtx` entirely, as it did through all of M97c-03 (`FU-06`)',
    find: 'if (decl.oauth2) return runOauth2Session(decl.name, decl.oauth2, config, sessionTc);',
    replace: 'if (decl.oauth2) return runOauth2Session(decl.name, decl.oauth2, config, tc);',
  },
  {
    id: 'aborted-badge',
    milestone: 'm111',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/run-verdict.ts',
    // Retargeted by `M114`, which rewrote the two lines this anchored into and left it **stale** —
    // not failing, not passing, silently not run. Caught by CI's unscoped sweep after a local
    // `verify:mutations m114` had reported all three of that milestone's own mutations killed.
    //
    // The `what` is weaker than it was, and deliberately says so. `FU-07`'s defect was a green
    // `PASS` over an aborted run; since `M114` derives `RunReport.ok` from the same reason, an
    // aborted run reaching this line already carries `ok: false`, so the badge it collapses to is
    // `FAIL`. `PASS` is no longer a state the mutated code can produce — claiming otherwise would
    // be describing a defect this tool can no longer reconstruct.
    what: 'the badge stops distinguishing `ABORTED` from a verdict, collapsing an aborted run into `FAIL` (`FU-07`; pre-`M114` this read `PASS`)',
    find: "  const reason = noVerdictReason(report);\n  if (reason !== null) return reason === 'aborted' ? 'ABORTED' : 'INCONCLUSIVE';",
    replace: "  const reason = report.inconclusive ? 'inconclusive' : null;\n  if (reason !== null) return 'INCONCLUSIVE';",
  },
  {
    id: 'aborted-threshold-verdict',
    milestone: 'm111',
    pkg: '@tflw/reporter',
    // Retargeted by `M114` alongside `aborted-badge`. The branch this used to delete now lives in
    // `packages/runtime/src/run-verdict.ts`, which this suite cannot see: `@tflw/runtime` resolves
    // through its `dist/`, and this runner has no build step, so a mutation there would run against
    // the *previous* build and be scored green — a survivor that measured nothing.
    //
    // Moved to junit's own call site rather than to reporter's re-export, because `M114` made
    // `runBadgeText` a consumer of the same function: blinding the re-export would be killed by the
    // badge tests, and a control killed by the sink it is not about stops being evidence for the
    // sink it is. Here the mutation reaches `junit.xml` and nothing else.
    file: 'packages/reporter/src/junit.ts',
    what: 'thresholds measured over a truncated sample get their ticks and their `junit.xml` pass back (`FU-07`)',
    find: '  const noVerdict = noVerdictReason(report);',
    replace: "  const noVerdict = report.inconclusive ? 'inconclusive' : null;",
  },
  {
    id: 'browser-close-rethrow',
    milestone: 'm111',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/browser.ts',
    what: 'teardown re-raises an already-reported launch failure, turning a complete report into exit 2 (`B6-03`)',
    find: 'const browser = await this.browserPromise.catch(() => undefined);\n    if (browser) await browser.close();',
    replace: 'const browser = await this.browserPromise;\n    await browser.close();',
  },
  {
    id: 'log-file-mkdir',
    milestone: 'm111',
    pkg: 'tflw',
    file: 'packages/cli/src/cli.ts',
    what: '`--log-file` stops creating its parent directory, so a passing run ends in `ENOENT` and exit 2 (`B6-05`)',
    find: '  mkdirSync(dirname(resolve(logFile)), { recursive: true });\n',
    replace: '',
  },
  {
    id: 'log-file-stderr-mirror',
    milestone: 'm111',
    pkg: 'tflw',
    file: 'packages/cli/src/cli.ts',
    what: '`--log-file` stops mirroring stderr, so every `error:` line and rendered diagnostic vanishes from the log (`B6-05`)',
    find: '  logMirror = mirror;\n',
    replace: '',
  },
  {
    id: 'diagnostic-example-wrong-code',
    milestone: 'm110b',
    file: SPEC_DATA,
    what: "`TF003`'s worked example goes back to the shape it shipped with for fifty milestones — 3 spaces inside 2, which emits `TF011`, under a `TF003` heading on four rendered surfaces (`M110-01`, the `V4-05` class)",
    find: `source: ['test "misaligned"', '    log "a"', '  log "b"']`,
    replace: `source: ['test "misaligned"', '  log "a"', '   log "b"']`,
  },
  {
    id: 'diagnostic-example-not-derived',
    milestone: 'm110b',
    file: SPEC_DATA,
    what: 'the rendered example stops being computed from the probes, so a row can once again claim in prose what its source does not do — the vacuous-control class this milestone exists to close (`M110-01`)',
    find: '  example: renderDiagnosticExample(row.probes),',
    replace: "  example: row.probes[0]?.as ?? '',",
  },
  {
    id: 'ok-ignores-no-verdict',
    milestone: 'm114',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/run-verdict.ts',
    what: '`ok` goes back to meaning "nothing that ran failed", so an aborted run\'s `results.json` and `run:end` event assert a pass beside `"aborted": true` again (`M111-01`)',
    find: '  const ok = noVerdictReason(report) === null && report.tests.every((t) => t.ok);',
    replace: '  const ok = report.tests.every((t) => t.ok);',
  },
  {
    id: 'verdict-not-restamped-after-splice',
    milestone: 'm114',
    pkg: '@tflw/runtime',
    file: INTERP,
    what: 'the merged load report stops re-deriving the verdict, so a `--workers N` run whose abort arrives at the splice keeps the stale `ok: true` `runProgram` stamped before it (`M111-01`)',
    find: '  // `M114` — `inconclusive`/`aborted` arrive *here*, after `runProgram` already stamped this\n  // report\'s `ok`, so the verdict has to be re-derived rather than carried over (`M111-01`).\n  return finalizeVerdict({',
    replace: '  return ({',
  },
  {
    id: 'badge-drops-inconclusive',
    milestone: 'm114',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/run-verdict.ts',
    what: "the console/`report.html` badge special-cases `aborted` alone again, so a saturated run prints a green `PASS` while its own `junit.xml` marks every threshold `<skipped/>` — `M111`'s half-fix, restored",
    find: "  const reason = noVerdictReason(report);\n  if (reason !== null) return reason === 'aborted' ? 'ABORTED' : 'INCONCLUSIVE';",
    replace: "  const reason = report.aborted ? 'aborted' : null;\n  if (reason !== null) return 'ABORTED';",
  },
  // --- M115 ------------------------------------------------------------------------------------
  // Restores the `Number()` coercion verbatim. This one is worth its ~21s because the suite it has
  // to be killed by is *new*, and because the shape it re-introduces already fooled a test once:
  // `matchers.test.ts` has carried a "non-number subject is a clear runtime error" test since long
  // before `B3-04`, and that test stays green under this mutation — it asserts on the string
  // `'not-a-number'`, the single non-number `Number()` maps to `NaN`. So a survivor here would not
  // mean "the comparison matchers are untested"; it would mean the tests are back to covering only
  // the value that never needed covering.
  {
    id: 'comparison-coerces-operands',
    milestone: 'm115',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/matcher.ts',
    what: '`is less than`/`is greater than` coerce with `Number()` again, so `null`/`false`/`[]`/`""` compare as 0, `true` as 1 and `[5]` as 5 (`B3-04`)',
    find: "  if (typeof value !== 'number' || Number.isNaN(value)) {\n    const got = Number.isNaN(value as number) ? 'NaN' : describe(value);\n    throw new RuntimeError(`\\`${matcher}\\` expects a number, got ${got}`);\n  }\n  return value;",
    replace: "  const n = typeof value === 'number' ? value : Number(value);\n  if (Number.isNaN(n)) throw new RuntimeError(`\\`${matcher}\\` expects a number, got ${describe(value)}`);\n  return n;",
  },
  // M116 (D148-D150) — one per rule, each aimed at the *specific* way that rule could look correct
  // and be hollow. Not "delete the pass": deleting a pass is caught by any test at all, which is
  // exactly the control M92d called a passing test of nothing.
  {
    id: 'base-url-ignores-service-prefix',
    milestone: 'm116',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/checker.ts',
    what: '`TF051` fires on every api step, prefixed or not — the false positive that would reject a correct multi-service suite with no default `api` (D137 clause 1)',
    // RETARGETED by `M125b1`, and the retarget is the point rather than housekeeping. That milestone
    // added `!apiTargetIsAbsolute(...)` to this condition and split the statement across lines, so
    // this `find` stopped matching and the sweep reported it **stale** — `0 survived` in the
    // headline, the real answer one line below it. `M123`'s lesson, arriving on schedule: a mutant
    // whose anchor has drifted is not a mutant that found nothing, it is a rule that went unchecked
    // while the report said otherwise. Deleting it would have been the easy read of "0 survived".
    //
    // The mutation itself is unchanged in meaning: drop the `service === null` clause and nothing
    // else, so `api billing GET /orders` is reported as needing a default `api` base it never
    // resolves.
    find: "        if (!env.api && node['service'] === null && !apiTargetIsAbsolute(node['path'])) {",
    replace: "        if (!env.api && !apiTargetIsAbsolute(node['path'])) {",
  },
  {
    id: 'base-url-treats-undefined-as-false',
    milestone: 'm116',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/checker.ts',
    what: '`checkBaseUrls` runs with no resolved config, reading `undefined` as "declares nothing" — the `undefined`-vs-`[]` doctrine inverted, which would report `TF051` on every docs-site sample',
    find: '  if (!opts.envBaseUrls) return diags;',
    replace: "  const envOrNone = opts.envBaseUrls ?? { envName: 'unknown', api: false, web: false };\n  if (!envOrNone) return diags;",
  },
  {
    id: 'capturable-ignores-of-modifier',
    milestone: 'm116',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/checker.ts',
    what: '`TF053` tests subject *kind* only, so `capture status of request to "/x" as n` passes — the exact hole a kind-only rule leaves, since those subjects are kind `value`',
    find: "  const hasOfModifier = 'of' in subject && (subject as { of?: unknown }).of != null;\n  if (subject.type === 'NetworkRequestSubject' || hasOfModifier) {",
    replace: "  const hasOfModifier = false;\n  if (subject.type === 'NetworkRequestSubject' || hasOfModifier) {",
  },
  {
    id: 'mask-rule-inverted',
    milestone: 'm116',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/checker.ts',
    what: '`TF052` fires on a mask that *does* sit alongside `matches snapshot` — breaking the one feature the rule exists to protect, while still passing any test that only checks the error case',
    find: "  if (expect.masks.length === 0 || expect.matcher.name === 'matchesSnapshot') return;",
    replace: "  if (expect.masks.length === 0) return;",
  },
  {
    id: 'config-files-resolve-against-cwd',
    milestone: 'm116',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/imports.ts',
    what: "`cert`/`key` resolve against the process cwd instead of `tflw.config`'s directory — identical in every fixture written from a repo root, wrong for any user who runs `tflw` from elsewhere (D151)",
    find: '      if (!(await exists(resolve(configDir, literal)))) missing.add(literal);',
    replace: '      if (!(await exists(resolve(process.cwd(), literal)))) missing.add(literal);',
  },
  {
    id: 'config-files-are-errors',
    milestone: 'm116',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/imports.ts',
    what: 'a missing `cert` becomes an error rather than a warning — D147\'s `A4-05` shipped a second time, making a suite whose hook writes the cert unrunnable with no override',
    find: "    severity: 'warning' as const,",
    replace: "    severity: 'error' as const,",
  },
  {
    id: 'refresh-billed-to-endpoint',
    milestone: 'm117',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'the api step is billed from `stepStart` again, so a reactive 401 re-establish lands back inside the triggering endpoint\'s latency sample — `B3-18` exactly as filed, and invisible to every assertion that does not look at a duration',
    find: "                billFrom = performance.now();\n                ({ trace, redacted, retryAfterAttempts, retryAfterWaitedMs, cookieScopeNote } = await execApi(step, config, ctx, tc.redactor, tc.baseDir, tc.configDir, tc.pinnedAgents));",
    replace: "                ({ trace, redacted, retryAfterAttempts, retryAfterWaitedMs, cookieScopeNote } = await execApi(step, config, ctx, tc.redactor, tc.baseDir, tc.configDir, tc.pinnedAgents));",
  },
  {
    id: 'failed-refresh-billed-to-endpoint',
    milestone: 'm117',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'only the *successful* refresh is re-based, so a re-establish that fails is still billed to the 401 attempt — the half of `B3-18` that a test written only against the happy path would never reach',
    find: "                billFrom = performance.now() - firstAttemptMs;",
    replace: "                billFrom = stepStart;",
  },
  {
    id: 'demo-never-starts',
    milestone: 'm118',
    pkg: 'tflw',
    file: 'packages/cli/src/cli.ts',
    what: '`api "tflw://demo"` is treated as an ordinary URL and nothing is started — `FU-04` restored exactly as filed, with the quickstart red in a clean directory. The control for the whole milestone: if this survives, the green-quickstart test is asserting something other than a run against a live demo server',
    find: '  const usingDemo = usesDemoService(configured);',
    replace: '  const usingDemo = false;',
  },
  {
    id: 'demo-outlives-the-run',
    milestone: 'm118',
    pkg: 'tflw',
    file: 'packages/cli/src/cli.ts',
    // This one SURVIVED on its first sweep, and was right to. The probe it was written against ran
    // *after the CLI exited*, where the child's `disconnect` handler closes the port anyway — so the
    // test passed with the teardown deleted. The leak is only observable while the CLI process is
    // still alive, i.e. `watch`: one `runCommand` per save, one demo each, all but the last leaked.
    // Now killed by `watch.test.ts`, which probes the first run's port during the second run.
    what: 'the demo service is never stopped, so every `watch` rebuild leaks the previous run’s server — the port stays open for the life of the session, invisible to any probe that waits until the CLI has exited',
    find: '    activeDemo?.stop();',
    replace: '    void 0;',
  },
  {
    id: 'demo-url-not-threaded-to-workers',
    milestone: 'm118',
    pkg: 'tflw',
    file: 'packages/cli/src/cli.ts',
    what: "a forked load worker re-reads `tflw://demo` off disk instead of being told the concrete port — D200's whole reason for existing. Measured before the fix as *exactly* 50% failures at `--workers 2`, which is the shape a single-process test can never produce",
    find: '          const resolved = msg.demoBaseUrl ? withDemoBaseUrls(loaded.resolved, msg.demoBaseUrl) : loaded.resolved;',
    replace: '          const resolved = loaded.resolved;',
  },
  {
    id: 'install-browsers-silent-success',
    milestone: 'm118',
    pkg: 'tflw',
    file: 'packages/cli/src/cli.ts',
    what: '`install-browsers` goes back to saying nothing at all on success — `FU-03` as filed, and the state that measured 0 bytes on both streams after a ~120 MB download',
    // The whole message, not just its first line: dropping one line would still leave `next:` on
    // stdout, and `FU-03` was measured at **0 bytes on both streams**. Restoring the row as filed
    // means restoring the silence exactly.
    find:
      "      `${browser} is ready — playwright ${playwright.version} in this project can launch it.\\n\\n` +\n" +
      '        `next:\\n  add a browser step (e.g. \\`open "/login"\\`) to a .tflw file, then \\`tflw run\\`\\n`,',
    replace: "      '',",
  },
  {
    id: 'reserved-scheme-passes-through',
    milestone: 'm118',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'a `tflw://…` base URL reaches the HTTP client instead of being rejected, so a typo inside the reserved scheme fails with whatever `fetch` says about an unknown protocol rather than with the one sentence naming the only legal spelling (`M118-01` is about moving this to *check* time; the runtime guard still has to exist)',
    find: "  if (!url.startsWith('tflw://')) return url;",
    replace: '  return url;',
  },
  {
    id: 'assertion-diagnosis-never-fires',
    milestone: 'm119',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: '`B4-08` restored exactly as filed: the nearest-candidate diagnosis fires on actions only, so `expect button "Add to Crat" is visible` goes back to saying nothing but "no matching element" while the identical `click` names the real button',
    find: "  if (count !== 0) return '';\n  return diagnoseMissingLocator(scope, locatorAst.kind, name);",
    replace: "  return '';",
  },
  {
    id: 'diagnosis-ignores-the-resolved-element',
    milestone: 'm119',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    // The over-firing direction, which is the one a "does it appear?" test cannot catch. Without
    // this, every test in the cluster could pass with the guard deleted — and a state failure would
    // print a list of names when the name was never the problem.
    what: 'the zero-match guard is dropped, so an element that resolved and failed on its *state* (`is disabled` against an enabled button) is answered with a list of similarly-named other elements — a diagnosis pointing away from the cause',
    find: "  if (count !== 0) return '';",
    replace: '  void count;',
  },
  {
    id: 'passing-assertion-gets-annotated',
    milestone: 'm119',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'the diagnosis is appended regardless of outcome, so `expect button "Nope" is hidden` — which *passes*, absence being the asserted state — reports success with "nearest matches on the page" stapled to it',
    find: "      const message = outcome.message + (outcome.ok ? '' : await diagnoseIfNothingMatched(scope, subject.locator, name, count));",
    replace: '      const message = outcome.message + (await diagnoseIfNothingMatched(scope, subject.locator, name, count));',
  },
  {
    id: 'wait-until-diagnosis-dropped',
    milestone: 'm119',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    // Scoped to the `wait until` call site alone: `assertion-diagnosis-never-fires` guts the shared
    // helper and would be killed by the `expect` tests whether or not `wait until` was ever wired
    // up. Only this one fails if the third call site is missing.
    what: '`wait until` alone loses the diagnosis — the half of the fix that a test suite covering only `expect`/`check` would never notice was missing. **Repointed by `M147d-5`** (`A3-11`, D641): the line it used to quote was inside the poll loop, and the loop stopped being locator-specific when the subject set widened. The claim did not move, so the mutation follows it to the locator arm of `waitUntilReader`, which is now the only `wait until`-only wiring of the diagnosis — the other two arms have nothing to diagnose',
    find: '      return { outcome, diagnose: () => diagnoseIfNothingMatched(scope, locator, name, count) };',
    replace: '      return { outcome };',
  },
  {
    id: 'saturation-lag-arm-never-fires',
    milestone: 'm119',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/selfDiagnosis.ts',
    // The arm a real busy-block actually drives. Before `M119-02` this was reachable only through
    // the busy-block test, which also carried the racing `cpuPercent > 50` floor — so a green kill
    // here proves the deterministic replacement really does bind the arm, not just observe it.
    what: 'a generator whose event loop is queuing behind its own work never reports it — lag can run arbitrarily far past the sample interval and `saturated` stays false unless CPU alone crosses 90%',
    find: '  return sample.avgEventLoopLagMs > sample.sampleMs * LAG_SATURATION_MULTIPLE || sample.cpuPercent > CPU_SATURATION_PERCENT;',
    replace: '  return sample.cpuPercent > CPU_SATURATION_PERCENT;',
  },
  {
    id: 'saturation-cpu-arm-never-fires',
    milestone: 'm119',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/selfDiagnosis.ts',
    // The arm that had NO deterministic coverage before `M119-02` — the old floor of 50 sat below
    // the real threshold of 90, so a pinned-CPU generator with a healthy loop was never tested at
    // all. This mutation would have survived the entire pre-M119 suite.
    what: 'a generator pinning a core while its event loop still keeps up is never called saturated — the CPU arm is dropped entirely and only lag can trip the verdict',
    find: '  return sample.avgEventLoopLagMs > sample.sampleMs * LAG_SATURATION_MULTIPLE || sample.cpuPercent > CPU_SATURATION_PERCENT;',
    replace: '  return sample.avgEventLoopLagMs > sample.sampleMs * LAG_SATURATION_MULTIPLE;',
  },
  {
    id: 'saturation-ignores-the-min-window',
    milestone: 'm119',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/selfDiagnosis.ts',
    // M32's floor, restated as a mutation: without it a very short run's one-time startup cost
    // reads as a sustained-saturation verdict (the original finding was a 150ms run at 140% CPU).
    what: 'M32 undone — a run too short to mean anything can declare itself saturated on startup cost alone, so a brief `tflw load` reports its own generator as the bottleneck',
    find: '  if (sample.wallMs < MIN_SATURATION_WINDOW_MS) return false;',
    replace: '',
  },
  {
    id: 'text-diagnosis-offers-structural-css-paths',
    milestone: 'm120',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/browser.ts',
    // `M119-01` restored exactly as filed. Note this mutation is the *pre-M119-01 production code*
    // — which is why it is worth having: the defect was live from M5 to M120 and nothing went red.
    what: '`M119-01` restored: the unnamed arm fires for `text` too, so `text "Somethign Unrelated"` is answered with `css "html"`, `css "html > head"` and `css "html > body"` — structural containers ranked by document position, one of which can never be visible, all offered as ready-to-paste locators',
    find: '  const unnamed = UNNAMED_IS_STILL_A_CANDIDATE[kind] ? raw.filter((c) => !c.name).map((c) => ({ suggestion: `css ${JSON.stringify(c.cssPath)}`, score: 0 })) : [];',
    replace: '  const unnamed = raw.filter((c) => !c.name).map((c) => ({ suggestion: `css ${JSON.stringify(c.cssPath)}`, score: 0 }));',
  },
  {
    id: 'unnamed-arm-dropped-for-every-kind',
    milestone: 'm120',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/browser.ts',
    // The over-correction direction. A fix that reads "stop offering css paths" is one keystroke
    // from taking the arm away from the kinds it was written for, and the `text` tests alone would
    // stay green — an icon-only button genuinely has no accessible name, and a generated path is
    // the only way to name it (PLAN.md §9).
    what: 'the unnamed arm is removed for every kind, not just `text`, so an icon-only button with no accessible name becomes unsuggestable — the exact case the arm exists for',
    find: '  const unnamed = UNNAMED_IS_STILL_A_CANDIDATE[kind] ? raw.filter((c) => !c.name).map((c) => ({ suggestion: `css ${JSON.stringify(c.cssPath)}`, score: 0 })) : [];',
    replace: '  const unnamed: { suggestion: string; score: number }[] = [];',
  },
  {
    id: 'open-model-back-to-fetch',
    milestone: 'm121',
    pkg: '@tflw/runtime',
    file: INTERP,
    what: "an open-model (`rps`) arrival goes back out over `sendRequest`'s unpinned `fetch` — `M118-02` restored verbatim, and the state in which a 0.2ms endpoint reported p50 36ms under `hold 10 rps` while `hold 1 users` reported 0ms in the same process. The control for the whole milestone: this is the one line D206 changes, and if it survives then nothing in the suite can tell tflw's two load models apart by the client they use",
    find: '  const openArrival = (): Promise<void> => runIteration((openAgents ??= createKeepAliveAgents()));',
    replace: '  const openArrival = (): Promise<void> => runIteration();',
  },
  {
    id: 'open-model-agents-per-arrival',
    milestone: 'm121',
    pkg: '@tflw/runtime',
    file: INTERP,
    what: 'each arrival builds its own agent pair instead of sharing the scenario\'s — the over-correction D207 rejects, which is *worse* than the `fetch` path it replaced because every sample then pays for a fresh TCP handshake. It exists to keep the D207 test honest: a structural test that only asked "did an arrival use a keep-alive agent" stays green here, so the assertion has to be that arrivals share **one** pool, observed as connection reuse',
    find: '  const openArrival = (): Promise<void> => runIteration((openAgents ??= createKeepAliveAgents()));',
    replace: '  const openArrival = (): Promise<void> => runIteration(createKeepAliveAgents());',
  },
  {
    id: 'open-model-maxsockets-bounded',
    milestone: 'm121',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/httpPinned.ts',
    what: "the connection pool gains a cap, so arrivals past it queue *inside the generator* — where the wait falls within `sendPinnedRequest`'s measured window and is reported as service time. This manufactures, for real, the defect `M118-02` was originally and wrongly filed as. Killed by an assertion on the constant rather than on its consequence: reaching a cap of 50 needs a slow endpoint driven hard enough to make the test both expensive and flaky, and D208's point is that the value is a decision, not tuning",
    find: 'const MAX_SOCKETS = Infinity;',
    replace: 'const MAX_SOCKETS = 50;',
  },
  {
    id: 'untitled-uri-back-to-filepath',
    milestone: 'm122',
    pkg: '@tflw/lsp-server',
    file: LSP_SERVER,
    what: "`B5-06` restored verbatim: every document URI is assumed to be a path again, so an unsaved `untitled:` buffer throws `ERR_INVALID_URL_SCHEME` inside `onDidOpen`. Kept for fidelity, but read its kill with care — the uncaught throw drains the event loop, so node:test **cancels** the rest of the file (`failureType: 'cancelledByParent'`, reported as `# fail 0` with the process still exiting 1) instead of failing anything. Nine `not ok` lines, zero assertions run, four of them belonging to `B5-07`. `untitled-buffer-silently-skipped` is the sibling that pins the behaviour",
    find: "  return uri.startsWith('file:') ? fileURLToPath(uri) : undefined;",
    replace: '  return fileURLToPath(uri);',
  },
  {
    id: 'untitled-buffer-silently-skipped',
    milestone: 'm122',
    pkg: '@tflw/lsp-server',
    file: LSP_SERVER,
    // This is what the *user* saw before M122, and it is the version that proves the tests work.
    // The throw above was swallowed by vscode-jsonrpc, so in a real editor there was no crash and
    // no error — just a buffer that answered nothing, forever. Reproducing that observable
    // behaviour (rather than the explosion) is what makes the kill attributable: 5 failures, 0
    // cancellations, each B5-06 test red on its own message, and B5-07's four still green.
    what: "the observable half of `B5-06`: a non-file URI is skipped instead of throwing, so an unsaved buffer is never stored and answers nothing for the life of the session — silently, exactly as it did in a real editor, where vscode-jsonrpc swallowed the throw. The mutation that proves the B5-06 tests fail *on their assertions* rather than on a drained event loop",
    find: '    store.open(e.document.uri, uriToPath(e.document.uri), e.document.getText());\n    void publishDiagnostics(e.document.uri);',
    replace: '    const p = uriToPath(e.document.uri);\n    if (p === undefined) return;\n    store.open(e.document.uri, p, e.document.getText());\n    void publishDiagnostics(e.document.uri);',
  },
  {
    id: 'pathless-buffer-gets-a-synthetic-path',
    milestone: 'm122',
    pkg: '@tflw/lsp-server',
    file: 'packages/lsp-server/src/workspace/documentStore.ts',
    what: 'the over-correction D214 rejects — a pathless buffer is handed a made-up path instead of `undefined`, which is the obvious way to make the crash go away without touching anything else. It is worse than the crash it fixes: `resolveMissingFiles` then stats a directory that does not exist and answers confidently, so every `import "./x.tflw"` in an unsaved scratch file is squiggled `TF043`. Killed by the pathless-import test, whose `file:` control is what stops that test passing for the wrong reason (a deleted `TF043` pass)',
    find: '    const missingFiles = doc.absPath === undefined ? undefined : await resolveMissingFiles(doc.absPath, parsed.program, async (absPath) => {',
    replace: "    const missingFiles = await resolveMissingFiles(doc.absPath ?? '/untitled/Untitled-1', parsed.program, async (absPath) => {",
  },
  {
    id: 'rename-name-unvalidated',
    milestone: 'm122',
    pkg: '@tflw/lsp-server',
    file: LSP_SERVER,
    what: "`B5-07` restored verbatim: `newName` is spliced into every span with no check, so an empty rename box leaves the file unparseable — and for a `crossFile` symbol, every file in the project with it",
    find: '    if (problem) return new ResponseError(LSPErrorCodes.RequestFailed, problem);',
    replace: '',
  },
  {
    id: 'preparerename-answers-the-first-span',
    milestone: 'm122',
    pkg: '@tflw/lsp-server',
    file: LSP_SERVER,
    what: "`prepareRename` reports the symbol's first occurrence rather than the one under the cursor, so renaming the second use of a variable silently moves the editor's selection to the definition. Survives any test that renames the *first* occurrence, which is the natural way to write one — the `prepareRename` test deliberately uses the last",
    find: '    const span = found.result.spans.find((s) => spanContains(s, found.offset));',
    replace: '    const span = found.result.spans[0];',
  },
  // M125e (`FU-24` · `FU-29` · `FU-30`) — one per decision that a later edit could undo while
  // leaving a surface that still looks helpful. The manifest is the interesting case: several of
  // these leave hover and completion *working*, and wrong only in what they teach.
  {
    id: 'step-completion-without-its-detail',
    milestone: 'm125e',
    pkg: '@tflw/lsp-server',
    file: 'packages/lsp-server/src/resolution/completion.ts',
    what: "the step list goes back to bare labels — the exact state `FU-24` measured (\"37 items, 0 carrying detail\"). Completion still works, still filters, still offers every keyword; it just stops saying what any of them do, which is the whole reason the manifest exists. Every test asserting *which* labels are offered still passes",
    find: '      return STEP_KEYWORDS.filter((k) => byPrefix(k.id)).map((k) => ({ label: k.id, detail: k.summary }));',
    replace: '      return STEP_KEYWORDS.filter((k) => byPrefix(k.id)).map((k) => ({ label: k.id }));',
  },
  {
    id: 'blank-line-completion-keeps-the-probe-character',
    milestone: 'm125e',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/completion.ts',
    what: "the synthetic character used to make an indented blank line non-blank survives into `prefix`, so the caller filters candidates by `_`. Nothing starts with `_`, so the list is empty again — the row's exact symptom, reached by a different route, and now with a context object that looks perfectly well-formed",
    find: '  return ctx ? { ...ctx, prefix: \'\' } : null;',
    replace: '  return ctx;',
  },
  {
    id: 'blank-line-completion-answers-at-column-zero',
    milestone: 'm125e',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/completion.ts',
    what: "D278's column-0 arm, which the condition around it makes redundant rather than the tests failing to cover",
    find: '  if (line.length === 0 || !/\\s$/.test(line)) return null;',
    replace: '  if (!/\\s$/.test(line)) return null;',
    // Filed as a live mutant and it survived the first unscoped sweep, so the claim it was written
    // with is on record and wrong: "answering on an unindented blank line offers the step list at
    // declaration position". It does not, and cannot.
    //
    // **`M137a`/D444 rewrote why, and the old reason is now false in both halves.** It read:
    // `getCompletionContext` is `parseForCompletion(…) ?? resolveOnBlankLine(…)`, so dropping the
    // arm matters only where the parser declines and the `_` probe then answers — and declaration
    // position is instrumented nowhere, so the probe reaches no production. Both clauses have since
    // changed. The order is reversed (the probe is tried *first*, D444's own bug), and the config
    // dialect instruments its top level, so declaration position now sets a completion context.
    // The 10,152-cursor measurement that backed the old note measured a program that no longer
    // exists, and is superseded rather than merely restated.
    //
    // Equivalent for a stronger and much simpler reason now: the arm is **syntactically subsumed**
    // by the disjunct beside it. `resolveAtUntypedCursor` fires on a line ending in whitespace, and
    // the empty string does not end in whitespace — `/\s$/.test('')` is `false` — so a column-0
    // cursor returns `null` through the second arm whether or not the first exists. There is no
    // input that separates them and no future instrumentation that could create one, which is a
    // different and better guarantee than the reachability argument it replaces.
    //
    // The arm stays, precisely because that guarantee is subtle. It states D278's boundary at the
    // boundary in the form the decision is written in, instead of leaving a reader to derive it
    // from how a regex treats an empty string.
    equivalent: true,
  },
  {
    id: 'step-hover-without-the-grammar-guard',
    milestone: 'm125e',
    pkg: '@tflw/lsp-server',
    file: 'packages/lsp-server/src/resolution/hover.ts',
    what: 'step-keyword hover stops asking the parser whether a statement may begin at that offset, and matches on text alone. A body field spelt `log:` and the word `api` inside a `log "api is down"` message then hover as keywords — the over-match a textual rule invites, and the reason the guard is the grammar rather than a list of node types to exclude',
    find: "  if (getCompletionContext(text, wordStart)?.kind !== 'step') return null;",
    replace: '',
  },
  {
    id: 'imported-action-labelled-for-every-file',
    milestone: 'm125e',
    pkg: '@tflw/lsp-server',
    file: 'packages/lsp-server/src/resolution/hover.ts',
    what: "the `imported action` label is applied whether or not the file brings names in from elsewhere, so a plain typo'd call in a file with no `use`/`import` at all hovers as an imported action — asserting an origin nothing here can know. The `use`d-helper case, which is what `FU-24` filed, still reads correctly",
    find: "  if (ref.kind === 'action' && !ref.defSpan && bringsInNames(root)) return SYMBOL_KIND_LABEL.importedAction;",
    replace: "  if (ref.kind === 'action' && !ref.defSpan) return SYMBOL_KIND_LABEL.importedAction;",
  },
  // NO MUTANT FOR D279a ITSELF, and the reason is a property of this harness worth stating once.
  // The mistake it guards against is `collectSymbols` writing `importedAction` into `SymbolRef.kind`
  // — a `packages/lang/src/symbols.ts` edit whose damage shows up only in `@tflw/lsp-server`'s
  // suite (`definition.test.ts`, `workspaceIndex.test.ts`, `stepHover.test.ts`). A mutant names one
  // `pkg` whose suite runs against the tree as mutated, and that suite reaches `@tflw/lang` through
  // its built `dist`, not its source — so a source-level mutation of `symbols.ts` is invisible to
  // the only tests that would kill it, and it would be scored `survived` while three tests stand
  // ready to catch the real thing. Recorded rather than staged.
  {
    id: 'docs-index-groups-sorted-alphabetically',
    milestone: 'm125e',
    pkg: 'tflw',
    file: 'packages/cli/src/docs-index.ts',
    what: "the topic groups are ordered by their own names instead of by SPEC's structure, so the listing opens on `Actions, imports, element aliases` and buries `Principles` in the middle. Still grouped, still titled, still complete — just no longer the reading order the document was written in, which is the one thing the grouping was for",
    find: '  for (const slug of Object.keys(DOCS_TOPICS)) byGroup.set(DOCS_TOPICS[slug]!.group, []);',
    replace: '  for (const slug of Object.keys(DOCS_TOPICS).sort((a, b) => DOCS_TOPICS[a]!.group.localeCompare(DOCS_TOPICS[b]!.group))) byGroup.set(DOCS_TOPICS[slug]!.group, []);',
  },
  // M125d (`FU-16` · `FU-25` · `FU-23` · `FU-19`) — the plan named one of these in advance (the
  // report's failure-first behaviour applying to a green run). The rest are the decisions that a
  // later edit could undo while leaving a report that still looks right: the filter that is
  // highlighted but never applied, the evidence folded away on the very step that failed, the final
  // attempt badge that always reads `passed`, and the filter recorded as `''` rather than absent.
  {
    id: 'report-failure-first-on-a-green-run',
    milestone: 'm125d',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/html.ts',
    what: "D249's explicit boundary: a green run must be unchanged in every respect. Defaulting every report to the Failed tab makes an all-passing run open on an empty list — the reader's first impression of a successful suite is that nothing ran. Both the button and the script still agree with each other, so nothing looks broken",
    find: '  return report.failed > 0 ? \'fail\' : \'all\';',
    replace: "  return 'fail';",
  },
  {
    id: 'filter-highlighted-but-never-applied',
    milestone: 'm125d',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/html.ts',
    what: 'the Failed button renders `active` and the script initialises `statusFilter` to match, but nothing applies it until the reader clicks something. The report then shows a highlighted "Failed" tab over the complete, unfiltered list — a label that lies, which is worse than the "All" default it replaced. Every markup assertion about the button and the variable still passes',
    // The leading newline is load-bearing: bare `  applyFilter();` also matches the tail of the
    // click handler's six-space-indented call, making this match twice and land as `stale` — run by
    // nothing, reported as neither killed nor survived (M123's lesson about reading the line under
    // the headline). `\n  ` matches only the two-space init call.
    find: '\n  applyFilter();',
    replace: '',
  },
  {
    id: 'evidence-collapsed-on-the-failing-step-too',
    milestone: 'm125d',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/html.ts',
    what: "the disclosure closes on every step including the one that failed, so the request and response for the failure — the reason the file was opened — sit behind a click. The report is smaller and tidier than before, and fails `PLAN_LAUNCH_REVIEW.md` §B.3's attach-to-a-ticket test in a way that reads as a deliberate design",
    find: '  return `<details class="evidence"${ok ? \'\' : \' open\'}><summary>',
    replace: '  return `<details class="evidence"><summary>',
  },
  {
    id: 'final-attempt-always-reads-passed',
    milestone: 'm125d',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/html.ts',
    what: 'restores the defect M125d\'s probe found: the final-attempt badge is emitted whenever `attempts` exists and hard-codes "passed", so a test that failed every attempt gets a green `attempt 2 of 2 — passed` inside a panel whose dot, class and run badge all say it failed. The report contradicts itself and the console, and only the badge is wrong',
    find: '${test.attempts ? `<p class="attempt-final-label"><span class="attempt-badge ${test.ok ? \'ok\' : \'fail\'}">attempt ${test.attempts.length} of ${test.attempts.length} — ${test.ok ? \'passed\' : \'failed\'}</span></p>` : \'\'}',
    replace: '${test.attempts ? `<p class="attempt-final-label"><span class="attempt-badge ok">attempt ${test.attempts.length} of ${test.attempts.length} — passed</span></p>` : \'\'}',
  },
  {
    id: 'retry-count-never-printed',
    milestone: 'm125d',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/cli-summary.ts',
    what: '`FU-25` restored exactly as filed: a test that burned its whole `retry` budget failing prints the same line as one that ran once and failed. `results.json` still carries `attempts`, the report still renders every attempt — only the surface a reader actually watches stays silent',
    // Blanks the suffix rather than short-circuiting above the guard: an early `return` would leave
    // the guard unreachable, and unreachable code is a compile-time complaint, not a surviving
    // mutant. A mutant has to be *plausible source*, not merely wrong behaviour.
    find: '  return ` ${c.dim}(${test.attempts.length} attempts)${c.reset}`;',
    replace: "  return '';",
  },
  {
    id: 'last-run-filter-recorded-as-empty-string',
    milestone: 'm125d',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/last-run.ts',
    what: "`describeRunFilter` returns `''` instead of `undefined` for a full run, so `renderLastRun` writes a `filter` key on every record. `--failed` keys its clause on presence, so every replay — including one after a completely unfiltered run — claims the last run was \"filtered by ``\". The file still parses, still round-trips, and the filtered case still reads correctly",
    find: "  return parts.length > 0 ? parts.join(' ') : undefined;",
    replace: "  return parts.join(' ');",
  },
  // M125c (`FU-14` · `FU-21` ≡ `B4-11`) — the two the plan named in advance (the candidate count
  // re-derived from a second query, the speculative line replacing rather than preceding the final
  // diagnosis) plus two for `B4-11`'s halves. Every one leaves the diagnosis visibly present, well
  // formatted, and wrong only in the way its row was filed about.
  {
    id: 'ambiguity-count-from-a-second-query',
    milestone: 'm125c',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/browser.ts',
    what: "the ambiguity message reports the caller's `.count()` again while listing a separately-queried set of matches, restoring the two-independent-queries shape that is the only explanation for `FU-21`'s filed \"matched 2 elements … 1 shown … and 1 more\". On a stable page the two queries agree and every existing assertion passes; the arithmetic only comes apart on a DOM that changes between them, which is exactly when someone is reading the message",
    find: "  const more = matches.length > shown.length ? `\\n  … and ${matches.length - shown.length} more` : '';",
    replace: "  const more = observedCount > shown.length ? `\\n  … and ${observedCount - shown.length} more` : '';",
  },
  {
    id: 'ambiguity-list-without-discriminators',
    milestone: 'm125c',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/browser.ts',
    what: 'the per-candidate discriminator is computed and then not printed, so the list goes back to N identical quoted labels. Measured before the fix: twelve matches, five candidates shown, **one distinct string among them** — a list carrying zero bits for the choice it demands the reader make. The message still names the count, still says `within <container>`, and still looks like a diagnosis',
    find: "    return `  ${i + 1}. ${text}${m.discriminator ? ` — ${m.discriminator}` : ''}`;",
    replace: '    return `  ${i + 1}. ${text}`;',
  },
  {
    id: 'nearest-matches-not-deduped',
    milestone: 'm125c',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/browser.ts',
    what: "`B4-11`: byte-identical suggestions are offered again, so a page with two `Save` buttons prints ``- `button \"Save\"`` twice and a page with twelve identical controls spends all five candidate slots on one string — the crowding-out half, where a genuinely different candidate cannot be shown at all. The list is still ranked, still capped, still labelled `nearest matches on the page`",
    find: '  return dedupeCandidates([...named, ...unnamed]).slice(0, MAX_DIAGNOSIS_CANDIDATES);',
    replace: '  return [...named, ...unnamed].map((c) => ({ ...c, matches: 1 })).slice(0, MAX_DIAGNOSIS_CANDIDATES);',
  },
  {
    id: 'suggestion-offered-without-its-ambiguity-caveat',
    milestone: 'm125c',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/browser.ts',
    what: "the deduped suggestion is printed bare, with no note that N elements render it. This is the subtler half of `B4-11` and the one dedup alone does not fix: SPEC §9.3 calls these ready-to-paste, and pasting `button \"Save\"` into a page with two of them produces the *ambiguity* error — a different failure than the one being diagnosed. Deduping without the caveat looks like a clean, unique, actionable suggestion",
    find: "    const caveat = c.matches > 1 ? ` — ${c.matches} elements render this same locator, so pasting it as-is is ambiguous; add \\`within <container>\\`` : '';",
    replace: "    const caveat = '';",
  },
  {
    id: 'speculative-line-replaces-the-final-diagnosis',
    milestone: 'm125c',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/browser.ts',
    what: "`FU-14`/D248 inverted: the step gives up at the speculative mark instead of speaking and continuing, so ~3 s becomes a *deadline* rather than a progress point. This is the genuine fast-fail option the decision rejected, and rejecting it is the whole reason `M119`'s guard could stay untouched — under this mutant a slow-rendering app that legitimately resolves at 8 s now fails, turning a green suite red for a reason the user never asked for",
    find: '  const deadline = startedAt + timeoutMs;',
    replace: '  const deadline = startedAt + Math.min(timeoutMs, SPECULATIVE_DIAGNOSIS_MS);',
  },
  // M125b2 (`FU-20a` · `FU-20c` · `FU-15`) — same rule as below, one per decision, each stating the
  // *silent* failure. All three of these leave the feature visibly present and working, which is
  // why the tests aimed at them had to be written to fail on the reversion specifically rather than
  // on the feature's absence.
  {
    id: 'blocked-port-hint-reads-undicis-prose',
    milestone: 'm125b2',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/http.ts',
    what: "the blocked-port hint is gated on `err.cause.message === 'bad port'` instead of being derived from the URL — D260's whole point, inverted. It passes every test in `blocked-ports.test.ts` except the one written for exactly this, because undici says `bad port` today. What it does is fail *closed* on the next minor bump: the hint disappears, the user is back to a bare `fetch failed`, and nothing anywhere goes red",
    find: '  const port = blockedPort(url);',
    replace: "  const port = String((cause as { message?: unknown } | undefined)?.message ?? '') === 'bad port' ? blockedPort(url) : undefined;",
  },
  {
    id: 'suggest-threshold-back-on-the-typed-word',
    milestone: 'm125b2',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/diagnostic.ts',
    what: "`suggest`'s budget is keyed on the typed word again, so abbreviating a long name is judged against the abbreviation's own length and `prodId` stops suggesting `productId`. The reason this mutant has to exist, and has to be checked with that exact pair: **every suggestion test in the repo predating M125b2 passes under either keying**, which is how the defect survived forty milestones of green suites before anyone drove the binary",
    find: '  return bestDist <= suggestThreshold(Math.max(w.length, best.length)) ? best : undefined;',
    replace: '  return bestDist <= suggestThreshold(w.length) ? best : undefined;',
  },
  {
    id: 'warning-handler-installed-without-delegation',
    milestone: 'm125b2',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/helpers.ts',
    what: "the `warning` handler stops calling the captured listeners, so tflw owns every process warning for the length of the helper-loading loop and silently eats the ones it does not claim — an `ExperimentalWarning` or a `DeprecationWarning` from a dependency simply never prints. D259's second row. Nothing fails: the typeless-module warning is still suppressed and still restated, the run is still green, and the only evidence is output that isn't there",
    find: '    for (const fn of captured) fn(warning);',
    replace: '',
  },
  // M125b1 (`FU-18`) — one per decision that could be silently undone, and "silently" is doing the
  // work in every one of them. A mutation that deletes the absolute-URL branch outright is caught
  // by the first test that writes `api GET https://…`; these five each leave the feature visibly
  // working and wrong somewhere no existing test looks.
  {
    id: 'absolute-url-lexes-outside-method-position',
    milestone: 'm125b1',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/lexer.ts',
    what: 'the new lexer branch drops `canStartPath()`, so any ident followed by `://` starts a path anywhere in a file — decision 60 undone by a fix that never mentions it. Every `api GET https://…` test still passes; what breaks is `let ratio = get / 2`, three years of grammar away from anything this milestone touched',
    find: '      if (isIdentStart(ch) && this.canStartPath() && ABSOLUTE_URL_START.test(line.slice(c))) {',
    replace: '      if (isIdentStart(ch) && ABSOLUTE_URL_START.test(line.slice(c))) {',
  },
  {
    id: 'absolute-api-target-still-gets-the-base-prepended',
    milestone: 'm125b1',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: '`execApi` composes the base URL onto an absolute target anyway — `http://localhost:4001/v1/https://other/x`. The concatenation bug this milestone exists to remove, reintroduced on the `api` side by the fix for it. A request IS sent and a response IS received, so any test asserting only that the step ran stays green: it takes two servers to notice',
    find: '  const url = isAbsoluteUrl(path) ? guardDemoUrl(path) : resolveBaseUrl(spec.service, config) + ensureLeadingSlash(path);',
    replace: '  const url = resolveBaseUrl(spec.service, config) + ensureLeadingSlash(path);',
  },
  {
    id: 'absolute-open-target-still-gets-the-web-base-prepended',
    milestone: 'm125b1',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'the `open` half reverts to unconditional concatenation — `http://localhost:5173/https://example.com/x`, which LOADS on any SPA with a catch-all route. This is the original defect verbatim, and the reason it survived to be filed is that it fails as a plausible assertion error several steps later',
    find: '  if (isAbsoluteUrl(path)) {\n    requireAllowHostsForAbsolute(path, path, config);\n    checkHostAllowed(path, config);\n    return path;\n  }',
    replace: '',
  },
  {
    id: 'tf058-fires-when-no-config-was-resolved',
    milestone: 'm125b1',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/checker.ts',
    what: 'the `undefined`-vs-`[]` rule collapses in the dangerous direction: an absent `envAllowHosts` is read as "declares none", so every absolute URL in the docs-site editor demo — a browser, where no `tflw.config` can exist even in principle — warns that the run will refuse it. D263, and the only visible symptom is a warning that is *plausible*',
    find: '  if (declared && declared.hosts.length === 0) {',
    replace: '  if (!declared || declared.hosts.length === 0) {',
  },
  {
    id: 'tf051-demands-a-base-url-for-an-absolute-step',
    milestone: 'm125b1',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/checker.ts',
    what: "`TF051` stops exempting absolute targets, so `api GET https://x/y` in an env with no default `api` base is reported as an ERROR and cannot run — a checker blocking a program the runtime accepts (D137 clause 1). Aimed here because this was a *live* defect found mid-milestone rather than a hypothetical: every `TF051` test predating M125b1 writes a path and passes either way",
    find: "        if (!env.api && node['service'] === null && !apiTargetIsAbsolute(node['path'])) {",
    replace: "        if (!env.api && node['service'] === null) {",
  },
  // M124 (D239) — one per rule, and every one of them aimed at a *false positive* rather than a
  // miss. That is the asymmetry this milestone runs on: `TF054`/`TF055`/`TF056` are
  // `'static-if-literal'` rules, so the way they fail is by deciding something they cannot know and
  // reporting an error on a program that runs. A mutation that deletes a rule is caught by any test
  // at all; these each leave the rule visibly present and quietly wrong.
  {
    id: 'literal-operand-reads-interpolated-text',
    milestone: 'm124',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/checker.ts',
    what: '`literalText` returns an interpolated `StringLit`\'s raw text, so `hex decode("{token}")` is checked as though `{token}` were hex digits — D237 inverted, and a `TF054` error on a program that decodes fine at run time (D137 clause 1)',
    find: '  if (value.type !== \'StringLit\') return null;\n  if (value.parts.some((part) => part.kind !== \'text\')) return null;\n  return value.value;',
    replace: '  if (value.type !== \'StringLit\') return null;\n  return value.value;',
  },
  {
    id: 'random-range-rejects-equal-bounds',
    milestone: 'm124',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/checker.ts',
    what: '`TF054` reports `random number 3 to 3`, a legal one-element range the runtime accepts — the checker inventing a rule instead of predicting one, which is `A4-05`\'s shape and passes every test that only checks the error case',
    find: '  if (from === null || to === null || to.n >= from.n) return;',
    replace: '  if (from === null || to === null || to.n > from.n) return;',
  },
  {
    id: 'decode-test-rederived-in-the-checker',
    milestone: 'm124',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/checker.ts',
    what: 'the checker stops importing the runtime\'s own decode test and uses a plausible character-class regex instead — which accepts the odd-length `hex decode("abc")` and the URL-safe `base64 decode("ab-_")` that `applyTransform` refuses. The exact drift D233 hoisted `literalValidity.ts` to make impossible',
    find: '  if (input === null || isDecodable(node.kind, input)) return;',
    replace: '  if (input === null || /^[A-Za-z0-9+/_=-]*$/.test(input)) return;',
  },
  {
    id: 'hold-window-invents-a-budget',
    milestone: 'm124',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/checker.ts',
    what: '`checkHoldWindows` falls back to the documented 30s default when the caller resolved no env, reading `undefined` as an answer — the `undefined`-vs-present doctrine inverted, and *usually right*, which is what would let it ship: it only misreports in a workspace whose config raises `timeout wait`. **Repointed by `M147d`/D640**, which deleted the whole-pass early return this used to quote: the skip is per-step now, because a step carrying its own `timeout wait` supplies the second operand itself. The claim is unchanged and so is the mutant behaviour — only the line that expresses it moved',
    find: "      if (typeof hold === 'number' && budget !== undefined && hold >= budget) {",
    replace: "      if (typeof hold === 'number' && hold >= (budget ?? 30_000)) {",
  },
  {
    id: 'hold-window-is-an-error',
    milestone: 'm124',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/checker.ts',
    what: '`TF055` becomes an error, so a suite whose CI env legitimately raises `timeout wait` cannot run at all — D147 shipped a third time, after `A4-05` and the `cert` warning M116 had to fix',
    find: "          code: Codes.HOLD_EXCEEDS_WAIT_TIMEOUT,\n          severity: 'warning',",
    replace: "          code: Codes.HOLD_EXCEEDS_WAIT_TIMEOUT,\n          severity: 'error',",
  },
  {
    id: 'data-table-extension-is-case-sensitive',
    milestone: 'm124',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/checker.ts',
    what: '`TF056` compares the extension without lowercasing, so `with each from "./ROWS.CSV"` is rejected — a file `loadTableRows` reads without complaint, since it lowercases first. The checker and the loader disagreeing about the same path',
    find: '  const ext = dot > slash + 1 ? path.slice(dot).toLowerCase() : \'\';',
    replace: '  const ext = dot > slash + 1 ? path.slice(dot) : \'\';',
  },

  // ---- M128b — the pentest arc's Tier 1 pack, and the declaration that gates it ----
  //
  // Six mutants, one per claim this milestone makes that a reader would otherwise have to take on
  // trust. Four of them re-introduce a *plausible* implementation — the shape somebody would write
  // first and ship — rather than obvious sabotage, which is the only kind worth spending a suite run
  // on.
  {
    id: 'applicability-collapses-to-pass',
    milestone: 'm128b',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/securityRules.ts',
    what: 'a not-applicable rule is counted as applicable-and-silent — D284 deleted, and it deletes quietly: every suite still passes, just with a bigger `applicable` number and no rule that can ever say "this question did not apply here"',
    find: '    const outcome = rule.evaluate(o);\n    if (!outcome.applicable) {\n      notApplicable.push({ rule, because: outcome.because ?? rule.appliesWhen });\n      continue;\n    }',
    replace: '    const outcome = rule.evaluate(o);\n    if (!outcome.applicable) {\n      applicable.push(rule);\n      continue;\n    }',
  },
  {
    id: 'floor-filters-findings-not-rules',
    milestone: 'm128b',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/securityRules.ts',
    what: 'D296 inverted: the floor filters findings afterwards instead of narrowing the pack first. The obvious implementation, and symmetric with `filterBySeverity` — it just makes the denominator describe work the assertion did not do, and puts D285 out of reach through the floor',
    find: '  const inPlay = floor ? pack.filter((r) => SEVERITY_RANK[r.severity] >= SEVERITY_RANK[floor]) : pack;',
    replace: '  const inPlay = pack;',
  },
  {
    id: 'no-power-to-fail-passes',
    milestone: 'm128b',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'D285 reversed — an assertion where every rule stood down reports a pass. This is the shape the codebase keeps re-filing (a control that reports success over nothing), and it is invisible in a green run by construction',
    find: '  if (result.applicable.length === 0 && findings.length === 0) {',
    replace: '  if (false && result.applicable.length === 0 && findings.length === 0) {',
  },
  {
    // M130b2 — D285's second tenant, and it needs its own mutation because it has its own arithmetic:
    // Tier 2 reaches "nothing applied" through **two** doors (an owner body the oracle refuses to
    // read, D321; a probe set nobody could judge, D324) where Tier 1 has one. The sibling above
    // cannot cover it — that is how this pair was found, when `no-power-to-fail-passes`' quoted line
    // started matching twice and `mutate.test.mjs` refused the sweep in seconds rather than 49
    // minutes in. That precondition-hoisted-into-a-test is `M127`'s own fix, working.
    id: 'authz-no-power-to-fail-passes',
    milestone: 'm130b',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'D285 reversed for the authorization matcher — an assertion whose probe set nobody could judge, or whose owner body carries no readable resource id, reports a pass. The failure is toward silence and is invisible in a green run, which is the same shape `judgeable` already got wrong once inside this milestone',
    find: '  const nothingApplied = result.applicable.length === 0 && findings.length === 0;',
    replace: '  const nothingApplied = false;',
  },
  {
    id: 'input-no-power-to-fail-passes',
    milestone: 'm134a',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'D285 reversed for the input-handling matcher — an assertion on a request with no mutable input, or one whose whole matrix came back unreadable, reports a pass. This is `TF067`\'s runtime twin, and it is the half that catches what the checker deliberately cannot: an interpolated path that binds to nothing id-shaped is silent at check time and only this door can fail it',
    find: '  const noInputRuleApplied = result.applicable.length === 0 && findings.length === 0;',
    replace: '  const noInputRuleApplied = false;',
  },
  {
    id: 'input-disclosure-control-not-subtracted',
    milestone: 'm134a',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/inputRules.ts',
    what: 'D373\'s differential half removed: a disclosure the observed response already contained is no longer subtracted, so an application that prints a stack frame on its happy path reports one `sec/error-detail-disclosure` per probe — a finding per payload, none of them caused by the payload. This is the false-positive direction Tier 1 shipped at zero and the bar this arc has not renegotiated, and it fails toward noise loud enough to switch the tier off',
    find: '      if (controlHit && controlHit.what === hit.what) continue;\n      findings.push({\n        id: INPUT_RULE_IDS.errorDetailDisclosure,',
    replace: '      findings.push({\n        id: INPUT_RULE_IDS.errorDetailDisclosure,',
  },
  {
    id: 'input-class-optin-ignored',
    milestone: 'm134a',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/inputProbe.ts',
    what: 'D372/D21-layer-4 removed: `oversized` and `traversal` payloads go out against every target, whether or not the covering `authorized target` granted them. A 64 KiB body and four `../` reads are sent to a host nobody said they could be sent to, and the run stays green while doing it — a safety control whose failure is invisible in the report is the exact shape this arc has been burned by twice',
    find: '    if (!policy.classes.includes(planned.payload.class)) {',
    replace: '    if (false) {',
  },
  {
    id: 'input-stack-frame-raw-newline-only',
    milestone: 'm134a',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/inputRules.ts',
    what: 'the stack-frame detector goes back to matching only a raw U+000A, which is the form nobody serves: inside a JSON error envelope the newline is the two characters `\\` and `n`, so the rule fires for the shape unit tests spell and misses the shape every framework actually sends. This mutation is a *measured* defect, not an invented one — it is what the code did until `input-assert.test.ts` answered with real `JSON.stringify` output, and it is `M128`\'s `sec/authenticated-response-cacheable` casing bug one tier on. Only the end-to-end file can kill it',
    find: "  pattern('a stack frame', /(?:\\n|\\\\n)\\s+at [\\w$.<>[\\] ]+ \\(/),",
    replace: "  pattern('a stack frame', /\\n\\s+at [\\w$.<>[\\] ]+ \\(/),",
  },
  {
    id: 'gate-drops-withheld-findings',
    milestone: 'm134b',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/scanFindings.ts',
    what: 'D386\'s *relaxation is never silent* removed: a finding the gate withheld no longer reaches the report at all, only the verdict. `--fail-on` and `--baseline` stop being ways to stage adoption and become ways to make a report look clean — and a baseline whose contents you cannot see is not reviewable, so nobody ever deletes an entry and the deferral is permanent. The build is green either way, which is why only a test that reads `all` rather than `gating` can kill this',
    find: '    const stamped = reason ? { ...f, withheld: reason } : f;\n    all.push(stamped);',
    replace: '    const stamped = reason ? { ...f, withheld: reason } : f;\n    if (!reason) all.push(stamped);',
  },
  {
    id: 'seeded-findings-gate',
    milestone: 'm134b',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/scanFindings.ts',
    what: 'D369 reversed: a generated payload\'s finding now fails the build like a reviewed one. Since R8 excludes the seed from a fingerprint, that finding appears under one seed and vanishes under the next — so a suite goes red or green on which seed it happened to draw, which is the precise failure mode `--seed` was built to prevent, and it lands on the one layer whose findings nobody promised to keep stable',
    find: "  if (f.seeded) return 'seeded';",
    replace: '  if (false) return null;',
  },
  {
    id: 'fingerprint-hashes-the-detail',
    milestone: 'm134b',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/scanFindings.ts',
    what: 'R8\'s exclusion list ignored: the finding\'s `detail` — which carries the concrete payload and a response excerpt — joins the fingerprint. Every baseline entry is then invalidated the first time somebody rewords an error message, i.e. by a change that fixed nothing, and the two payloads that reach one weakness become two entries. Fails in the direction that makes the feature look broken rather than unsafe, which is why it needs a test asserting the *absence* of movement',
    find: '    ...(seeded || !locus ? {} : { fingerprint: fingerprintOf(scan, f.id, locus) }),',
    replace: '    ...(seeded || !locus ? {} : { fingerprint: fingerprintOf(scan, f.id, { ...locus, invariant: f.detail }) }),',
  },
  {
    id: 'seeded-findings-lose-their-provenance',
    milestone: 'm134b',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'D369\'s **join** cut: the boundary stops being told which payloads this run generated, so every seeded finding is lifted as though it had come from the reviewed corpus — fingerprinted, baselinable, and gating. A build then goes red or green on which seed it happened to draw, and worse, somebody baselines the fingerprint of a payload that will never be drawn again. Both halves of the layer are separately correct here (`judge` still exempts anything carrying `seeded`, the generator still draws); it is only the wire between them that is gone, which is `M134a-02`\'s shape and the reason `input-assert.test.ts` exists',
    find: '  const verdict = gateScan(\'input-handling\', result.findings, templateEndpoint(request.method, request.url), step, tc, seededIds(drawn));',
    replace: '  const verdict = gateScan(\'input-handling\', result.findings, templateEndpoint(request.method, request.url), step, tc);',
  },
  {
    id: 'baseline-prunes-stale-entries',
    milestone: 'm134b',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/scanFindings.ts',
    what: 'D387\'s report-never-remove reversed: an entry this run did not reproduce is treated as gone. A `--tag smoke` run legitimately produces a subset of the suite\'s findings, so the next full run finds every acceptance outside that tag deleted and goes red on findings somebody had already reviewed and accepted — the failure arrives one run later than the change that caused it, attached to a file nobody edited',
    find: '  return baseline.accepted.filter((e) => !produced.has(e.fingerprint));',
    replace: '  return [];',
  },
  {
    id: 'session-findings-dropped',
    milestone: 'm128b',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'D287 removed: the session login scan still runs and its findings are still carried, they just never reach the assertion. A suite whose session cookie lacks `HttpOnly` goes back to reporting clean',
    find: '  const sessionFindings = filterBySeverity(ctx.sessionFindings ?? [], floor);',
    replace: '  const sessionFindings = filterBySeverity([], floor);',
  },
  {
    id: 'request-headers-not-lowercased',
    milestone: 'm128b',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'the real bug this milestone shipped and then found: request headers keep the case the author wrote, so `authenticated-response-cacheable` never fires against any suite that writes `Authorization` the normal way. Passes any test that happens to spell the header lower-case',
    find: "    requestHeaders: Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v])),",
    replace: '    requestHeaders: request.headers,',
  },
  {
    id: 'authorized-target-accepts-wildcards',
    milestone: 'm128b',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/checker.ts',
    what: '`TF061` stops rejecting wildcards, so `authorized target "https://*.com"` is a valid affirmation. D291\'s one hard rule, and the mutant is exactly the code somebody writes by reusing `allow hosts`\' matcher',
    find: "  if (raw.includes('*')) {",
    replace: '  if (false) {',
  },

  // ---- M128c — the TLS probe, and the two rules that read it ----
  //
  // Six mutants. The first is the reason `connectionOptions` is exported at all: on OpenSSL 3.x a
  // TLS 1.0 listener cannot be constructed, so deleting D298's floor changes no handshake anywhere
  // and no ordinary test can see it. A decision no test can distinguish from its opposite is one
  // that gets silently reverted, and a mutation registry is exactly where that gets caught.
  {
    id: 'tls-probe-floor-left-at-default',
    milestone: 'm128c',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/tlsProbe.ts',
    what: "D298 deleted: the probe uses Node's `DEFAULT_MIN_VERSION` of TLSv1.2, so a host speaking nothing but a deprecated protocol refuses the handshake and `sec/tls-version-old` reports \"could not tell\" in exactly the case it exists for. Invisible on any modern machine — the rule keeps passing every test, because no listener here can negotiate TLS 1.0 either way",
    // Anchored to the line **below** it rather than quoted bare. `M137g` added a second
    // `minVersion: 'TLSv1'` to this file — `suiteHandshake`'s, which needs the same floor for the
    // same reason — and the bare quote then matched twice and went stale. The SNI comment is unique
    // to `connectionOptions`, which is the one this mutation is about: deleting the *enumeration's*
    // floor is a different defect and would want its own row.
    find: "    minVersion: 'TLSv1',\n    // SNI is a hostname extension",
    replace: '    // SNI is a hostname extension',
  },
  {
    id: 'tls-probe-ignores-insecure-in-cache-key',
    milestone: 'm128c',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/tlsProbe.ts',
    what: 'the cache keys on `host:port` alone, so a strict run inherits the answer a lax run already cached for the same host — a certificate failure and a successful handshake sharing one entry, decided by whichever file ran first',
    find: "  return `${url.hostname}:${port}${policy.insecure ? ' insecure' : ''}`;",
    replace: '  return `${url.hostname}:${port}`;',
  },
  {
    id: 'tls-probe-authorized-target-unchecked',
    milestone: 'm128c',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/tlsProbe.ts',
    what: "D291's runtime half removed: the probe opens its second connection to wherever the run ended up, declared or not. The checker's `TF060` still passes, because it judges the *base URL* — this is the redirect case that only exists at run time",
    find: '    if (!authorizedFor(parsed, policy.authorizedTargets)) {',
    replace: '    if (false) {',
  },
  {
    id: 'tls-facts-absent-counts-as-applicable',
    milestone: 'm128c',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/securityRules.ts',
    what: 'a response nobody probed is treated as a response with nothing wrong: the two TLS rules join the applicable set over plaintext and report silent. The counts line then claims two more questions were asked than were, which is D284 broken in the direction nothing goes red for',
    find: '      if (o.tls === undefined) return { applicable: false, findings: [] };',
    replace: '      if (o.tls === undefined) return { applicable: true, findings: [] };',
  },
  {
    id: 'tls-version-old-fires-on-unknown-protocol',
    milestone: 'm128c',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/securityRules.ts',
    what: 'the closed dead-protocol set becomes an open "anything not on the modern list", so a future `TLSv1.4` is reported as deprecated by a rule that has never heard of it. The plausible implementation, and the one that ages into a false positive rather than announcing itself',
    find: "const DEAD_PROTOCOLS = new Set(['SSLv2', 'SSLv3', 'TLSv1', 'TLSv1.1']);",
    replace: "const DEAD_PROTOCOLS = { has: (p) => !['TLSv1.2', 'TLSv1.3'].includes(p) };",
  },
  {
    id: 'probe-opens-a-connection-the-floor-discarded',
    milestone: 'm128c',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'the TLS probe opens its second connection even when the severity floor has already dropped both rules that read it, so a suite written entirely at a `critical` floor pays a handshake per host whose answer is thrown away. Nothing goes red — the assertion is correct either way — and the connection is exactly the kind this arc\'s safety model exists to make deliberate',
    find: "  if (floor && !SECURITY_RULES.some((r) => r.id.startsWith('sec/tls-') && SEVERITY_RANK[r.severity] >= SEVERITY_RANK[floor])) return undefined;",
    replace: '',
  },
  {
    id: 'negated-pass-hides-its-findings',
    milestone: 'm128c',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: "a passing `not has no … violations` goes back to printing only a count. The form exists to assert that something *is* wrong, so the rule ids are the whole answer — and the report is the only record, so nothing downstream can recover them. Invisible: the assertion is green either way",
    find: "    return { ok: true, message: `response ${state} — ${counts}${findings.length > 0 ? `:\\n${listing()}` : ''}${note}` };",
    replace: '    return { ok: true, message: `response ${state} — ${counts}${note}` };',
  },
  {
    id: 'degraded-probe-not-announced',
    milestone: 'm128c',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'D300 removed: a rule blocked by a *failed instrument* goes back to being indistinguishable from one blocked by its precondition, so a green `expect response has no security violations` whose TLS probe never connected prints a clean line and says nothing. The silent-cap shape, in the control built to avoid it',
    // Retargeted in `M137g`. This used to quote `if (byReason.size === 0) return '';`, which the
    // note channel's second tenant deleted. Deliberately narrowed to the **degraded-instrument**
    // half rather than blanked to `return ''`: that would also silence M137g's notes, and one
    // mutation standing in for two decisions is a control that cannot say which one broke.
    find: '  const lines = [...byReason].map(([because, ids]) => `\\n  note: ${ids.join(\', \')} could not be evaluated — ${because}`);',
    replace: '  const lines: string[] = [];',
  },
  // --- M137g -----------------------------------------------------------------------------------
  //
  // The offered-suite enumeration (D485/D486). Four of the five kill a *silence*, which is what this
  // milestone is about: the rule it widens has been shipping since M128a and reporting clean on
  // hosts that still offer RC4, because nobody had opened the second connection to find out.
  {
    id: 'a-half-asked-question-reported-as-a-clean-answer',
    milestone: 'm137g',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/securityRules.ts',
    what: 'D485 removed: without `probe ciphers` the rule goes back to passing quietly on the negotiated suite alone, so a host that offers a broken suite alongside a modern one reads clean and says nothing about what it did not ask. Exactly the false negative D441 exists to close, restored',
    find: '  if (tls.offered === undefined) {',
    replace: '  if (false && tls.offered === undefined) {',
  },
  {
    id: 'the-ceiling-goes-unprinted',
    milestone: 'm137g',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/securityRules.ts',
    what: "D486 removed: suites this stack could not put in a ClientHello stop being reported, so \"enumerated the offer and found nothing\" covers a question that was never asked. M136a's rule — a scan that could not ask is not a scan that found nothing — with the instrument itself as the cap",
    find: '  if (unaskable.length > 0) {',
    replace: '  if (false && unaskable.length > 0) {',
  },
  {
    id: 'unaskable-folded-into-refused',
    milestone: 'm137g',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/tlsProbe.ts',
    what: "D486's three lists collapsed to two: a suite our own OpenSSL refused to offer is recorded as one the *server* declined, which reports a clean answer to a question that never reached the network",
    find: "  return code.includes('NO_CIPHERS_AVAILABLE') || code.includes('NO_CIPHER_MATCH');",
    replace: '  return false;',
  },
  {
    id: 'enumeration-without-the-affirmation',
    milestone: 'm137g',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/tlsProbe.ts',
    what: 'D485 removed: eighteen handshakes go out at every https host the suite touches, with no `probe ciphers` anywhere. D21 layer 4 names resource exhaustion, and this is the construct it names it for',
    find: '    if (!policy.probeCiphers) return undefined;',
    replace: '',
  },
  {
    id: 'enumeration-verifies-the-certificate-after-all',
    milestone: 'm137g',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/tlsProbe.ts',
    what: "D486's restriction inverted: the enumerating connection starts verifying certificates, so every candidate against a self-signed or otherwise-untrusted host comes back `refused` and the host reports a clean offer it never gave. The failure is silent and points at the server",
    find: '        rejectUnauthorized: false,\n        ciphers: `${suite}:@SECLEVEL=0`,',
    replace: '        rejectUnauthorized: !policy.insecure,\n        ciphers: `${suite}:@SECLEVEL=0`,',
  },
  {
    id: 'enumeration-goes-concurrent',
    milestone: 'm137g',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/tlsProbe.ts',
    what: 'D435 broken on the non-HTTP path: the candidate handshakes are raced instead of awaited one at a time, which is the change `probe rate`\'s deferral names as its own reviving condition — arriving without anybody deciding it',
    find: '      const verdict = await suiteHandshake(host, port, suite, policy, track);',
    replace: '      const verdict = (await Promise.all([suiteHandshake(host, port, suite, policy, track), suiteHandshake(host, port, suite, policy, track)]))[0];',
  },
  // --- M135a -----------------------------------------------------------------------------------
  {
    id: 'kb-prose-rendered-unescaped',
    milestone: 'm135a',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/findings.ts',
    what: 'the remediation entry\'s prose reaches `report.html` without being escaped first. The KB is authored text and every entry currently in it is inert, so the build is green and the page looks right — which is exactly why this is worth a mutation rather than a comment: the file it renders into is the one carrying *reflected input* findings, and the class of defect it documents is the class its own renderer would then have. Escaping before the backtick spans are formed is also the order that matters, since escaping afterwards would let an entry close the `<code>` element it opened',
    find: '  return esc(text).replace(/`([^`]+)`/g, \'<code>$1</code>\');',
    replace: '  return text.replace(/`([^`]+)`/g, \'<code>$1</code>\');',
  },
  {
    id: 'unknown-rule-drops-the-finding',
    milestone: 'm135a',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/findings.ts',
    what: 'a finding whose rule the KB does not know is rendered as nothing at all rather than as a row without fixes. The path is a `results.json` written by a newer build and opened by an older reporter, and the failure is this arc\'s standing one in miniature — a report that silently omits what it could not explain reads exactly like a run that found less',
    find: '      const fix = entry ? renderFix(entry) : \'\';',
    replace: '      const fix = entry ? renderFix(entry) : \'\';\n      if (!entry) return \'\';',
  },
  // --- M135b -----------------------------------------------------------------------------------
  {
    id: 'sarif-written-when-nothing-scanned',
    milestone: 'm135b',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/sarif.ts',
    what: 'D404 removed: a run that never scanned writes a SARIF document with an empty `results` array. `upload-sarif` reads that as *everything previously reported is fixed* and resolves the matching alerts, so a repository whose functional and security suites are separate CI jobs has the functional job silently close the security job\'s entire backlog — green run, empty dashboard, no error anywhere. This is the arc\'s three-state rule at the artifact layer, and the only mutation here whose damage lands outside tflw',
    find: '  return (report.scanCoverage?.length ?? 0) > 0 || (report.findings?.length ?? 0) > 0;',
    replace: '  return true;',
  },
  {
    id: 'sarif-includes-seeded-findings',
    milestone: 'm135b',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/sarif.ts',
    what: 'D411 reversed: generated payloads reach the SARIF document. They carry no fingerprint by construction (D369) and GitHub dedupes on fingerprints, so each one becomes a permanent alert and the next seed mints another — and the obvious cure for the churn is to invent the identity D369 deliberately withheld, which would also make them baselinable and gating. The build is green either way and the damage appears only in someone\'s alert list, weeks later',
    find: '  const findings = sortFindings((report.findings ?? []).filter((f) => !f.seeded));',
    replace: '  const findings = sortFindings(report.findings ?? []);',
  },
  {
    id: 'sarif-suppresses-below-floor',
    milestone: 'm135b',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/sarif.ts',
    what: 'D410 collapsed: a finding held back by `--fail-on` is uploaded as a *suppressed* alert alongside a baselined one. It makes the document agree exactly with the build verdict, which is why it is tempting, and it overloads "a human accepted this" onto "a flag ranked this out" — two states with opposite lifetimes. A team that later lowers the floor then watches a pile of alerts un-dismiss themselves with no corresponding change in the application',
    find: "    ...(f.withheld === 'baseline' ? { suppressions:",
    replace: "    ...(f.withheld ? { suppressions:",
  },
  {
    id: 'sarif-declares-every-rule',
    milestone: 'm135b',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/sarif.ts',
    what: 'D412 flattened: `rules[]` declares the whole catalog every run instead of the rules that applied. This is what most SARIF producers do and it makes document diffs clean, which is exactly the argument that loses — a rule that applied and found nothing and a rule that stood down become one indistinguishable empty state, and the machine-readable artifact stops being able to answer *did you even check for this*. `M128-01` is filed about that question',
    find: '  const known = SCAN_RULE_IDS.filter((id) => applied.has(id));',
    replace: '  const known = [...SCAN_RULE_IDS];',
  },
  {
    id: 'sarif-uri-relative-to-cwd',
    milestone: 'm135b',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/sarif.ts',
    what: "D405 undone: `artifactLocation.uri` goes back to the path as the run recorded it, which is relative to the directory tflw was invoked from rather than to the repository root. This is not a hypothetical — it is what shipped, and what `M135c`'s first acceptance run found: a corpus run from its own folder emitted `positives.tflw` for a file the repository holds three directories down. GitHub anchors an alert by matching that path against the checked-out tree, so every alert lands on nothing; and the upload that would have shown it *succeeds*, which is why this needed a test rather than a reading",
    find: "    const rebased = relative(sourceRoot, resolve(fileBase ?? process.cwd(), normalized)).replace(/\\\\/g, '/');",
    replace: '    const rebased = normalized;',
  },
  // --- M136a -----------------------------------------------------------------------------------
  {
    id: 'input-tier-blind-spot-not-reported',
    milestone: 'm136a',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'D418a undone for Tier 3: the input-handling scan goes back to announcing its un-asked subjects on the console and nowhere else. This is the state the milestone found, and its whole point is that it is invisible — a run whose entire mutation matrix was refused before it left the process writes a `results.json` byte-identical to one that probed everything, so every downstream reader (CI, SARIF, a person opening the report a week later) is told a scan happened that did not. The suite is green either way, and the console line that survives is the one nobody keeps',
    find: "  reportDeclines(\n    'input-handling',",
    replace: "  if (false as boolean) reportDeclines(\n    'input-handling',",
  },
  {
    id: 'blind-spot-swallows-inconclusive',
    milestone: 'm136a',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: "D418a narrowed to half its subjects: only `not-probed` is reported, so a probe that was SENT and answered without answering — Tier 2's CSRF-refused cookie principal (D325), a 429 — vanishes from the report. This is the more dangerous half, because `not-probed` is usually a config the reader chose and `inconclusive` is the app surprising them; and `M130-01` is exactly the row filed about a refusal being read as an answer, so the mutation reopens it in the reporting layer after D325 closed it in the engine",
    find: "      .filter((p) => p.outcome.kind === 'not-probed' || p.outcome.kind === 'inconclusive')\n      .map((p) => ({ subject: p.principal,",
    replace: "      .filter((p) => p.outcome.kind === 'not-probed')\n      .map((p) => ({ subject: p.principal,",
  },
  {
    id: 'sarif-drops-the-subject-half',
    milestone: 'm136a',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/sarif.ts',
    what: "D421 removed: `tflw/notApplicable` carries the rules that stood down and not the subjects nobody asked. The document stays valid, uploads cleanly and reads as a complete account of what the scan did not do — which is the failure D412 built the property to prevent, arriving through the half that was added second. A consumer cannot tell a principal that was never probed from one that was probed and cleared",
    find: '    ...(report.scanBlindSpot?.declines ?? []).map((d) => ({',
    replace: '    ...[].map((d) => ({',
  },
  {
    id: 'sarif-subject-id-not-namespaced',
    milestone: 'm136a',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/sarif.ts',
    what: "D421's namespacing dropped: a subject id is emitted bare, so a principal called `sec/authz-object-leak` — or, far more plausibly, any future subject that happens to share a name with a rule — collides with the rule half in the one property a consumer groups by. `kind` still distinguishes them, which is exactly what makes this survivable-looking: the document is well-formed, and only a consumer that keys on `id` (the reason the property exists) is wrong",
    find: '      id: `${SUBJECT_NAMESPACE[d.scan]}:${d.subject}`,',
    replace: '      id: d.subject,',
  },

  // --- M136b ------------------------------------------------------------------------------------
  //
  // The config-dialect language-id split. Every entry here is a *silent* failure in the real editor
  // — nothing throws, nothing logs, a feature simply stops existing — which is why the milestone is
  // worth mutating at all. The last two are the first mutations ever aimed at `tflw-vscode`, the
  // package where this milestone's only irreversible-feeling change lives.
  {
    id: 'dialect-ignored-by-token-pass',
    milestone: 'm136b',
    file: 'packages/lang/src/semanticTokens.ts',
    what: "D427 half-undone in the direction that looks harmless: the config vocabulary is consulted for *both* dialects, which is exactly the one-flat-list fix `M133-01` proposed and D427 rejected. Every config word colours correctly and `key`, `web` and `destination` become keywords in every .tflw file in the world — a regression with no error attached to it, visible only as ordinary identifiers turning a keyword colour",
    find: "    if (KEYWORDS.has(tok.value) || (dialect === 'config' && CONFIG_KEYWORDS.has(tok.value))) tokens.push({ span: tok.span, type: 'keyword' });",
    replace: "    if (KEYWORDS.has(tok.value) || CONFIG_KEYWORDS.has(tok.value)) tokens.push({ span: tok.span, type: 'keyword' });",
  },
  {
    id: 'config-words-never-consulted',
    milestone: 'm136b',
    file: 'packages/lang/src/semanticTokens.ts',
    what: 'the other direction: the dialect argument is accepted and then never used, so the eighteen words stay uncoloured and the milestone is a no-op that typechecks. The state `M133-01` describes, reachable by deleting one clause',
    find: "    if (KEYWORDS.has(tok.value) || (dialect === 'config' && CONFIG_KEYWORDS.has(tok.value))) tokens.push({ span: tok.span, type: 'keyword' });",
    replace: '    if (KEYWORDS.has(tok.value)) tokens.push({ span: tok.span, type: \'keyword\' });',
  },
  {
    id: 'semantic-tokens-assume-test-dialect',
    milestone: 'm136b',
    pkg: '@tflw/lsp-server',
    file: LSP_SERVER,
    what: "the wiring rather than the wordlist: the server stops asking the store which dialect the buffer is and assumes the test one. `collectSemanticTokens` keeps its parameter, the call still typechecks, and config buffers go back to being coloured by the wrong vocabulary — the failure a required parameter was chosen to prevent, reintroduced at the one call site that has to get it right",
    find: "    const kind = store.get(params.textDocument.uri)?.kind ?? 'test';",
    replace: "    const kind = 'test';",
  },
  {
    id: 'lsp-selector-drops-config-dialect',
    milestone: 'm136b',
    pkg: 'tflw-vscode',
    file: 'packages/vscode/src/extension.ts',
    what: 'D427a site 2: the `documentSelector` names only the test dialect again. In a real editor this is total and silent for `tflw.config` — no diagnostics, no completion, no hover, no error anywhere — while every server-side test stays green, which is the precise failure mode D428 exists to catch',
    find: "    documentSelector: [{ language: 'tflw' }, { language: 'tflw-config' }],",
    replace: "    documentSelector: [{ language: 'tflw' }],",
  },
  {
    id: 'config-language-never-activates',
    milestone: 'm136b',
    pkg: 'tflw-vscode',
    file: 'packages/vscode/package.json',
    what: "D427a site 4, the one the plan did not know about and the worst of them: the `tflw-config` activation event is removed, so a user whose only open document is a `tflw.config` gets no extension at all. Not a degraded feature — nothing runs. This mutation is the reason that guard is written as a property over every contributed language rather than as an assertion about this one id",
    find: '    "onLanguage:tflw",\n    "onLanguage:tflw-config"',
    replace: '    "onLanguage:tflw"',
  },

  // -- M137a (D444): the config dialect's first completion ------------------------------------
  //
  // Four mutations for four separate ways this feature can look built and not be. Three of them are
  // bugs the build actually made and the tests then caught, which is the reason they are worth
  // pinning: each was reasoned about correctly and still landed wrong.
  {
    id: 'config-completion-outer-guard-wins',
    milestone: 'm137a',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/parser.ts',
    what: "the first-answer-wins rule is dropped, so a completion context set deep in the grammar is overwritten by one set in an enclosing production as recovery unwinds. This is not hypothetical — it is what the build did before the rule existed: every `probe …` sub-clause completion came back as the list of `defaults` keys, because `parseConfigEntries`' loop re-entered `parseConfigEntry` on the same token one frame up. The test dialect cannot see it, which is why it went un-noticed for eleven milestones",
    find: '    if (this.completionResult) return false;\n',
    replace: '',
  },
  {
    id: 'config-completion-ignores-the-block',
    milestone: 'm137a',
    pkg: '@tflw/lsp-server',
    file: 'packages/lsp-server/src/resolution/completion.ts',
    what: "config-key completion stops filtering by which block the cursor is in, so `defaults` is offered `web`/`api` and `env` is offered `workers`/`report`/`viewport`. `A2-07b` in its loudest form: the tool names a key, the author writes it, and the checker rejects it with `TF025`. That row was filed against the much quieter did-you-mean hint",
    find: '  return configSlot(\'key\').filter((c) => configKeyAllowedIn(c.label, block));',
    replace: '  return configSlot(\'key\');',
  },
  {
    id: 'probe-completion-offers-a-bare-word-at-line-start',
    milestone: 'm137a',
    pkg: '@tflw/lsp-server',
    file: 'packages/lsp-server/src/resolution/completion.ts',
    what: "the `probe` phrase loses its keyword, so the start of a sub-clause line offers `mutating` where the grammar needs `probe mutating`. Accepting a candidate then writes a line the parser rejects — the failure `SUGGESTION_VOCABULARIES.scanKind` records for the hint side (`M134a`: a bare `input` is not something a user can write)",
    find: "      return configSlot('probe').map((c) => ({ ...c, label: `probe ${c.label}` })).filter((c) => byPrefix(c.label));",
    replace: "      return configSlot('probe').filter((c) => byPrefix(c.label));",
  },
  {
    id: 'untyped-cursor-probe-runs-last',
    milestone: 'm137a',
    pkg: '@tflw/lang',
    file: 'packages/lang/src/completion.ts',
    what: "the untyped-cursor probe goes back to being the fallback rather than the first question. Harmless before D444 and wrong after it: with the config top level instrumented, the cursor on an indented line under `defaults` is answered from the last *token*, which is still `defaults` — so the top-level guard replies about a line the user left two keystrokes ago, and every config key in every block loses its completion",
    find: '  return resolveAtUntypedCursor(truncated, parseFor) ?? parseFor(lex(truncated).tokens);',
    replace: '  return parseFor(lex(truncated).tokens) ?? resolveAtUntypedCursor(truncated, parseFor);',
  },

  // -- M137a (`M136c-01`): the cross-repo artifact contract ------------------------------------
  //
  // Note what is deliberately **not** mutated here. Renaming a *value* in `artifact-contract.ts`
  // cannot be killed by any test in this repository, and that is the design rather than a gap: the
  // emitter builds the document from those constants, so a rename moves both together and the
  // document stays self-consistent. Nothing here knows what another repository expects. The gate for
  // that direction is `testFlow-tests`' `verify-artifact-contract.mjs`, which was verified against a
  // replay of `M136a`'s actual rename. What this side can be held to is the two below: that the
  // contract describes what is really emitted, and that it reaches the consumer at all.
  {
    id: 'sarif-contract-promises-a-key-nothing-emits',
    milestone: 'm137a',
    pkg: '@tflw/reporter',
    file: 'packages/reporter/src/sarif.ts',
    what: "a result property named in the cross-repo contract stops being emitted, so the contract goes on promising `tflw/invariant` to a consumer that will never find it. The consumer is then told a field exists, finds it missing at run time, and cannot tell a bug from a version skew — `M136c-01`'s confusion with the gate installed and pointing the wrong way. Found while writing the contract test that this mutation now guards: no fixture finding carried an `invariant`, so the property had shipped since `M135b` with nothing asserting it reached the document",
    find: '      ...(f.invariant !== undefined ? { [SARIF.resultProperties.invariant]: f.invariant } : {}),\n',
    replace: '',
  },
  {
    id: 'contract-never-reaches-the-consumer',
    milestone: 'm137a',
    pkg: 'tflw',
    file: 'packages/cli/scripts/bundle.mjs',
    what: "the artifact contract stops being written into `dist/`, so it never ships. The consumer's gate then finds no contract file — which it treats as a hard failure rather than a skip, on purpose, but only if someone runs it. Every test in *this* repository still passes without the file, because nothing here reads it: it exists solely for the other repository, which is exactly the shape of thing that gets dropped in a refactor and missed",
    find: "const { ARTIFACT_CONTRACT } = await import(\n  new URL('../../reporter/dist/artifact-contract.js', import.meta.url).href\n);\nwriteFileSync(\n  new URL('../dist/artifact-contract.json', import.meta.url),\n  `${JSON.stringify(ARTIFACT_CONTRACT, null, 2)}\\n`,\n  'utf8',\n);",
    replace: '',
  },

  // `D451` — the three controls the two folded-in `M134` rows are closed by. Each is the exact edit
  // its row was worried about, so a registry entry is what stops the guard from quietly becoming
  // decorative later.
  {
    id: 'enabled-payloads-classes-default',
    milestone: 'm137a',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/inputCorpus.ts',
    what: "`M134b-01`'s residue, applied. `enabledPayloads` gains a default for its class list, which reads as a harmless convenience and is invisible to every other test in the package because they all pass it explicitly. The consequence is that a caller who omits the argument silently receives payloads from classes the target's config never granted — D372 undone by omission rather than by decision. The row left this as a sentence asking somebody to watch for it; this is the watch",
    find: 'export function enabledPayloads(classes: readonly MutationClass[], corpus',
    replace: 'export function enabledPayloads(classes: readonly MutationClass[] = [], corpus',
  },
  {
    id: 'coverage-comment-denies-the-gate',
    milestone: 'm137a',
    pkg: ROOT_SUITE,
    file: '.github/workflows/ci.yml',
    what: "`M134a-01` re-created: `ci.yml`'s Coverage step stops saying it gates. Nothing breaks, every test passes, and the next person to read a red Coverage step is told by the file describing the job that the job cannot fail — which is measured, not hypothetical, since that is exactly how `M134a`'s run was first misdiagnosed as a `c8` flake. The mutation is on a comment on purpose: this repository has now paid for stale prose three times, and prose is only defended by something that reads it",
    find: 'THIS STEP GATES',
    replace: 'THIS STEP IS INFORMATIONAL',
  },
  {
    id: 'shard-count-of-stale',
    milestone: 'm137a',
    pkg: ROOT_SUITE,
    file: '.github/workflows/ci.yml',
    what: "`D449`'s own near-miss, frozen as a control. The reassembly job's `--of=` falls behind the `shard:` matrix — which is what actually happened during this milestone's re-shard, and it cost a full CI round trip: twelve shards each green about themselves, and a failure three jobs away from the two integers that disagreed. `verify-shards.mjs` still catches it at runtime and is still the only thing that can see a shard that never reported; this kills it in a second instead",
    // M148 moved this with the 12 → 18 widen. The `find:` has to quote the live workflow, and the
    // `replace:` is deliberately the *previous* count rather than a nonsense one: the failure being
    // controlled is a re-shard that updates two of the four copies, so the mutant should look
    // exactly like a half-finished widen.
    find: 'verify-shards.mjs shards --of=18',
    replace: 'verify-shards.mjs shards --of=12',
  },

  // -- M137b (D433/D434/D457): the CSRF clause and the derived principal ----------------------------
  //
  // Six mutations, and the selection is deliberate: every one of them leaves a suite GREEN while
  // removing the thing being built. That is this milestone's whole failure profile — a CSRF defence
  // that looks enforced because our own probe was broken is indistinguishable from one that is
  // enforced, unless something asserts the difference.
  {
    id: 'csrf-attached-to-safe-methods',
    milestone: 'm137b',
    pkg: '@tflw/runtime',
    file: INTERP,
    what: "the verb condition is dropped, so the token rides GET/HEAD/OPTIONS too. This is the reason `csrfHeaders` is a separate channel from `headers` (D433) — folded in, it would behave exactly like this mutant, and no existing test would have noticed, because sending a token where none is needed usually still succeeds",
    find: '  if (!isSafeMethod(spec.method)) {\n    for (const [k, v] of Object.entries(ctx.sessionCsrfHeaders ?? {})) setHeader(headers, k, v);\n  }',
    replace: '  for (const [k, v] of Object.entries(ctx.sessionCsrfHeaders ?? {})) setHeader(headers, k, v);',
  },
  {
    id: 'csrf-token-miss-binds-undefined',
    milestone: 'm137b',
    pkg: '@tflw/runtime',
    file: INTERP,
    what: "a `csrf from` path that resolves to nothing no longer fails the session. This is where D443's `TF069` went (D456), and the mutant is the exact false negative that decision is about: the literal text `\"undefined\"` goes out as the token, the app rejects it for the right reason by accident, and a broken clause reads as a working CSRF defence over the whole mutating surface",
    find: '  if (value === undefined) {\n    throw new RuntimeError(\n      `no CSRF token at ${label}',
    replace: '  if (false) {\n    throw new RuntimeError(\n      `no CSRF token at ${label}',
  },
  {
    id: 'csrf-owner-token-not-identity',
    milestone: 'm137b',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/authzProbe.ts',
    what: "the owner's CSRF token stops being stripped as identity, so every probe re-sends it under another principal's cookie. The app rejects the session/token mismatch, the probe comes back refused, and a refusal reads as a boundary holding — `M130-01`'s failure shape reintroduced by the milestone that fixes it, and green",
    find: "    if (lower === 'authorization' || lower === 'cookie' || stripped.has(lower)) continue;",
    replace: "    if (lower === 'authorization' || lower === 'cookie') continue;",
  },
  {
    id: 'csrf-supplied-does-not-close-d325',
    milestone: 'm137b',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/authzProbe.ts',
    what: "a cookie principal that DID supply a token still has its 4xx scored `inconclusive` as a possible CSRF artefact. That is the half of `M130-01` this milestone closes; with the mutation applied the arc's central blind spot survives its own fix, and every mutating authz probe stays unjudged",
    find: '  if (ctx.cookieBorne && !ctx.suppliedCsrf && !isSafeMethod(ctx.method)',
    replace: '  if (ctx.cookieBorne && !isSafeMethod(ctx.method)',
  },
  {
    id: 'csrf-probe-shares-the-authz-list',
    milestone: 'm137b',
    pkg: '@tflw/runtime',
    file: INTERP,
    what: "the derived withheld-token probes are merged into the authorization probe list, which is D457's rejected design. The derived principal IS the owner, so a successful token-less write returns the owner's own resource ids and `sec/authz-object-leak` fires: a critical BOLA finding against the owner's own resource, on the happy path of the rule this milestone adds",
    find: '{ owner: { request, response }, ownerPrincipals: ctx.sessionNames, ownerIds, probes, ...(csrfProbes.length ? { csrfProbes } : {}) }',
    replace: '{ owner: { request, response }, ownerPrincipals: ctx.sessionNames, ownerIds, probes: [...probes, ...csrfProbes] }',
  },
  {
    id: 'csrf-unreached-probe-reads-as-clean',
    milestone: 'm137b',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/authzRules.ts',
    what: "a withheld-token probe that never reached the application is treated as applicable rather than as a blind spot, so a target with no `probe mutating` opt-in reports *CSRF is enforced* instead of *not measured*. D285's shape, in the newest place it can appear",
    find: '    const reached = probes.filter((p) => p.response !== undefined);\n    if (!reached.length) {',
    replace: '    const reached = probes;\n    if (false) {',
  },

  // -- M137c (D435/D436/D465/D466/D467): the crawl ------------------------------------------------
  //
  // Eight, and the selection follows this milestone's own thesis: a crawl's failure mode is not a wrong
  // answer, it is a *confident* one. Every mutation below leaves the suite green while widening what the
  // crawl claims to have covered — a bigger numerator, a smaller denominator, or a judgement about code
  // that never ran. None of them can make a crawl report a finding that is not there; all of them make
  // it report a clean surface it never reached.
  {
    id: 'crawl-discloses-after-it-has-sent',
    milestone: 'm137c',
    pkg: '@tflw/runtime',
    file: CRAWL,
    what: "the disclosure moves to the end, so it describes work already done instead of bounding work about to happen. Both mutants send exactly the same requests, which is why this needs the timeline and not a count: a planned total that only exists once the walk is finished is a report, and a crawl interrupted on its first request would then have disclosed nothing at all",
    edits: [
      [
        "  steps.push(deps.step('seed', `crawl \"${crawl.name.value}\"`, true, plannedDetail));",
        "  const disclose = () => steps.push(deps.step('seed', `crawl \"${crawl.name.value}\"`, true, plannedDetail));",
      ],
      [
        '  return { steps, ok, surface: { discovered, withheld, sent, reached, seeds: surfaceSeeds, ...walkFigures } };',
        '  disclose();\n  return { steps, ok, surface: { discovered, withheld, sent, reached, seeds: surfaceSeeds, ...walkFigures } };',
      ],
    ],
  },
  {
    id: 'crawl-scores-a-validators-refusal',
    milestone: 'm137c',
    pkg: '@tflw/runtime',
    file: CRAWL,
    what: "a `400`/`422` counts as having reached real code, so the crawl judges the response a validator wrote about tflw's own invented value. `reached` rises, every assertion passes, and the run reports a conclusion about code behind a validator that never ran — D436's rejected alternative, which is the false-negative engine wearing a coverage badge",
    find: '  if (status === 400 || status === 422) {',
    replace: '  if (status === 400 || status === 422) return { reached: true };\n  if (false) {',
  },
  {
    id: 'crawl-reads-its-own-refusal-as-clean',
    milestone: 'm137c',
    pkg: '@tflw/runtime',
    file: CRAWL,
    what: "a `401`/`403` counts as reached, so the differential oracle scores an exchange in which the crawl's own principal never got past the door. There is nothing to compare against and it compares anyway — `M130-01` in the newest place it can appear, and the single commonest false negative in this class of tool. The mutation that made the table test worth writing: the fixture answers no 401, so before it, only `400` of the seven rows was asserted",
    find: '  if (status === 401 || status === 403) {',
    replace: '  if (status === 401 || status === 403) return { reached: true };\n  if (false) {',
  },
  {
    id: 'crawl-write-not-gated-by-probe-mutating',
    milestone: 'm137c',
    pkg: '@tflw/runtime',
    file: CRAWL,
    what: "D465 is dropped: every synthesized write on the surface is sent, whether or not the origin's `authorized target` declares `probe mutating`. This is the milestone's only mutation whose consequence is outside the report — a `DELETE` nobody wrote, against a target that affirmed a scan and never affirmed writes. Killed by the absence of packets, not by a label",
    find: '      if (plan.mutating && !mayProbeMutating(absoluteFor(plan.path, seed.base, config), config.authorizedTargets)) {',
    replace: '      if (false) {',
  },
  {
    id: 'crawl-base-ignores-the-document',
    milestone: 'm137c1',
    pkg: '@tflw/runtime',
    file: INTERP,
    what: "D480 is reverted to exactly what shipped in M137c: an openapi-seeded path resolves against the `api` base rather than against the document's own server. Against a target behind a global prefix this dials `/v1/v1/…` on every route, takes a 404 on every one, judges nothing — and, before D481, reported green. This is the mutation the whole milestone exists for, and it is only killable because `crawl.test.ts`'s fixture now serves under a prefix; against the root-served fixture it shipped with, this mutation is a no-op",
    find: '      const url = isAbsoluteUrl(request.path) ? guardDemoUrl(request.path) : (request.base ?? resolveBaseUrl(null, config)) + ensureLeadingSlash(request.path);',
    replace: '      const url = isAbsoluteUrl(request.path) ? guardDemoUrl(request.path) : resolveBaseUrl(null, config) + ensureLeadingSlash(request.path);',
  },
  {
    id: 'crawl-document-declared-base-ignored',
    milestone: 'm137c1',
    pkg: '@tflw/runtime',
    file: CRAWL_SURFACE,
    what: "D480's `servers` reader always answers the root, so a document that declares `servers: [{url: '/v1'}]` and leaves the prefix out of its paths is crawled at the origin. Narrower than the mutation above on purpose: it leaves the common shape (prefix baked into `paths`, `servers` absent) working, so only the explicitly-declared-base test can kill it. Two spellings of one deployment, and this proves the second one is tested rather than assumed",
    find: '  const substituted = substituteServerVariables(declared, asObject(first?.variables));',
    replace: '  const substituted = \'/\';',
  },
  {
    id: 'crawl-reached-nothing-reads-green',
    milestone: 'm137c1',
    pkg: '@tflw/runtime',
    file: CRAWL,
    what: 'D481 is dropped: a crawl that sent requests and reached none returns success. The engine still prints `31 sent · 0 reached` — it simply does not act on it, which is precisely the state M137c shipped in. Killed by a crawl whose every route 404s, which must be a red run rather than a green one with interesting numbers in it',
    find: '  if (sent > 0 && reached === 0) {',
    replace: '  if (false) {',
  },
  {
    id: 'crawl-404-always-blames-a-path-parameter',
    milestone: 'm137c1',
    pkg: '@tflw/runtime',
    file: CRAWL,
    what: "The 404 decline stops branching on whether anything was actually invented, so every 404 reads *the value tflw invented for a path parameter does not exist* — including on a parameterless route where nothing was invented at all. That sentence is what sent the reader to synthesis and away from the base for a whole milestone, so the branch is a guard rather than a nicety",
    find: '      reason: invented',
    replace: '      reason: true',
  },
  {
    id: 'public-collection-is-a-critical-bola',
    milestone: 'm137c2',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/authzRules.ts',
    what: "D482 is dropped: a collection the built-in `anonymous` principal also receives is still reported as a critical authorization violation against every authenticated principal that read it. This is the state M137c shipped in, and the first crawl of a real surface produced 20 of these beside its one true positive — a public catalog, feed or category tree has no owner, so there is no boundary anyone crossed. Killed by a fixture route that answers a credential-less caller",
    find: '      const anonymous = o.probes.find((p) => p.principal === RESERVED_PRINCIPAL);',
    replace: '      const anonymous = undefined as undefined | (typeof o.probes)[number];',
  },
  {
    id: 'public-collection-suppressed-silently',
    milestone: 'm137c2',
    pkg: '@tflw/runtime',
    file: INTERP,
    what: "D482's note is dropped, so the suppression happens and nothing says so. The probe line still reads `3 leaked` and the counts still read `0 violations` — both true, and together unreadable. The same argument `probeNote` already makes for announcing a `privileged` exclusion on a green line: a reader comparing two passing runs has no other way to tell a boundary that held from a boundary that never existed",
    find: '  const anonymous = probes.find((p) => p.principal === ANONYMOUS);',
    replace: '  const anonymous = undefined as undefined | (typeof probes)[number];',
  },
  {
    id: 'repro-emitted-for-a-suppressed-leak',
    milestone: 'm137c2',
    pkg: '@tflw/runtime',
    file: INTERP,
    what: "The repro emitter goes back to reading raw probe outcomes instead of the rule's findings — a second opinion about what a leak is, one function away from the rule that decides. Under D482 the two disagree: a public collection yields no finding and this still writes a runnable `.tflw` repro for it, so a report with zero findings ships with repro files reproducing them. This mutation is the reason the loop was rewritten rather than the guard duplicated",
    find: '  for (const finding of result.findings) {\n    const principal = finding.where?.location;',
    replace: '  for (const finding of (probes.filter((p) => p.outcome.kind === \'leaked\').flatMap((p) => result.applicable.map((r) => ({ id: r.id, where: { location: p.principal } }))))) {\n    const principal = finding.where?.location;',
  },
  {
    id: 'crawl-empty-surface-reads-green',
    milestone: 'm137c',
    pkg: '@tflw/runtime',
    file: CRAWL,
    what: "`TF068`'s runtime door is removed, so a crawl whose seeds resolved to nothing passes. It has to be a failure for the reason every empty scan in tflw is (D285): a document that 404s, a `traffic` seed on a suite that sent nothing, or an `exclude` that swallowed everything all produce a body whose every assertion would have held whatever the application did",
    find: '  if (sendable.length === 0) {',
    replace: '  if (false) {',
  },
  {
    id: 'crawl-drops-what-it-could-not-build',
    milestone: 'm137c',
    pkg: '@tflw/runtime',
    file: CRAWL_SURFACE,
    what: "an operation synthesis could not build a request for vanishes instead of being reported, so `discovered` counts only what tflw was capable of sending. The identity `discovered = withheld + sent` still holds — that is what makes this the dangerous one — and the surface reads as *smaller and fully covered* rather than as partly out of reach. A crawler that hides its own limits reports better coverage the worse it gets",
    find: "      if ('reason' in plan) skipped.push({ method: verb, template, reason: plan.reason });\n      else requests.push(plan);",
    replace: "      if (!('reason' in plan)) requests.push(plan);",
  },
  {
    id: 'crawl-exclude-matched-against-the-invented-path',
    milestone: 'm137c',
    pkg: '@tflw/runtime',
    file: CRAWL_SURFACE,
    what: "D466's `exclude` is matched after the path parameters are filled, so whether a route is excluded depends on the value synthesis happened to invent. `exclude \"/products/{id}\"` then stops matching the route it names, and an author who excluded a destructive route keeps a crawl pointed at it — an instruction silently not followed, in the one channel of this report that is somebody's decision rather than tflw's limitation",
    find: '    const excludedBy = excludes.find((pattern) => matchesRoutePattern(template, pattern));',
    replace: "    const excludedBy = excludes.find((pattern) => matchesRoutePattern(template.replace(/\\{[^}]+\\}/g, 'tflw'), pattern));",
  },
  {
    id: 'crawl-via-reaches-the-fingerprint',
    milestone: 'm137c',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/scanFindings.ts',
    what: "D437's provenance is folded into the fingerprint, so one weakness reached by both seeds becomes two baseline entries and adding a seed churns every existing baseline. This is the distinction between provenance and identity, and it is the reason `via` is set *after* the hash is taken and stays out of `partialFingerprints`: `via` says how tflw got there, and a fingerprint says what is wrong",
    find: '    ...(seeded || !locus ? {} : { fingerprint: fingerprintOf(scan, f.id, locus) }),',
    replace: '    ...(seeded || !locus ? {} : { fingerprint: fingerprintOf(scan, f.id, extra?.via ? { ...locus, endpoint: `${locus.endpoint} via ${extra.via}` } : locus) }),',
  },

  // -- M137d (D471/D472/D473/D475): the repro emitter, generalised ---------------------------------
  //
  // Ten, and they share one shape, which is the shape of this milestone's whole risk: **every one
  // produces a repro that is GREEN against an unfixed application.** Not a crash, not a missing file, not
  // a wrong count — a `.tflw` file that runs, passes, and thereby says the weakness is not there. That is
  // the artifact a maintainer closes the ticket with, so a mutation surviving here is worse than a
  // mutation surviving almost anywhere else in this registry: the tool's output would be actively
  // misleading rather than merely incomplete.
  //
  // Two of the ten (`-single-backslash`, `-body-without-content-type`) instead produce a file that
  // cannot run at all. They are in the same set because the failure is still silent *at emit time* — the
  // report says the repro was written, and only whoever opens it finds out.
  {
    id: 'input-repro-reasserts-the-scan-matcher',
    milestone: 'm137d',
    pkg: '@tflw/reporter',
    file: REPRO,
    what: "the disclosure template re-asserts tflw's own matcher instead of naming the leak — D471, and the whole reason this milestone has four templates rather than one. It reads as the obvious generalisation and it is the broken one: the rule is differential against the observed request and subtracts the control by label, so in a repro the mutated request IS the observed request, the disclosure appears in the control, and it is subtracted from itself. The file passes against a live vulnerability",
    find: "        : { title: `must not disclose ${f.invariant} for ${f.location}`, assertion: `expect body text not matches \"${tflwString(pattern)}\"` };",
    replace: "        : { title: `must not disclose ${f.invariant} for ${f.location}`, assertion: 'expect response has no input handling violations' };",
  },
  {
    id: 'input-repro-asserts-the-payload-it-echoed',
    milestone: 'm137d',
    pkg: '@tflw/reporter',
    file: REPRO,
    what: "the traversal template forbids the *payload* rather than the filesystem signature. This is the exact confusion `FILESYSTEM_SIGNATURES`' own comment exists to prevent — an application that reflects `../../etc/passwd` back in an error message has not read anything — so the repro fires forever on an app that merely echoes, and stops testing whether a file was read at all",
    find: "        : { title: `must not read a file through ${f.location}`, assertion: `expect body text not matches \"${tflwString(pattern)}\"` };",
    replace: "        : { title: `must not read a file through ${f.location}`, assertion: `expect body text not contains \"${tflwString(f.payloadText ?? '')}\"` };",
  },
  {
    id: 'input-repro-dials-the-observed-request',
    milestone: 'm137d',
    pkg: '@tflw/runtime',
    file: INTERP,
    what: "the repro is built from the observed request instead of `applyMutation`'s output — D475 inverted. The emitted file re-sends the request that behaved CORRECTLY, so it passes, and nothing anywhere says the payload was dropped. Green on a live finding, from one field",
    find: '      url: mutated.url,',
    replace: '      url: request.url,',
  },
  {
    id: 'input-repro-emits-an-absolute-url',
    milestone: 'm137d',
    pkg: '@tflw/reporter',
    file: REPRO,
    what: "the emitter falls back to the absolute URL instead of the runtime's base-relative path, so every repro names an absolute address. `D246` makes an absolute URL conditional on `allow hosts`, so the recipient's own config refuses the file tflw just told them to run — D469's lesson met from the authoring side instead of the sender's, and it fails as a *diagnostic* about their config rather than as anything about the finding",
    find: '  return f.path || f.url;',
    replace: '  return f.url;',
  },
  {
    id: 'repro-path-re-applies-the-base-prefix',
    milestone: 'm137d',
    pkg: '@tflw/runtime',
    file: INTERP,
    what: "`reproPathFor` stops stripping the base URL's own path prefix, which restores the D478 defect VERBATIM — the one that shipped in every authorization repro from M130b to M137d. An env whose `api` is `https://host/v1` gets `api POST /v1/vuln/notes`, tflw resolves it against the base a second time, the repro dials `/v1/v1/vuln/notes`, gets a 404, finds no leak and PASSES against the application it was generated from. Restored deliberately: this is the only mutation in the registry that reproduces a bug that really shipped, and it survived seven milestones because every fixture server in the suite has no path prefix, so the buggy and the correct answer were byte-identical everywhere a test could look",
    find: '    if (prefix !== \'\' && (u.pathname === prefix || u.pathname.startsWith(`${prefix}/`))) {',
    replace: '    if (false) {',
  },
  {
    id: 'repro-omits-the-env-it-came-from',
    milestone: 'm137d',
    pkg: '@tflw/reporter',
    file: REPRO,
    what: "the `re-run` line disappears, so a repro no longer says which env produced it. A repro is base-relative and nothing in the language lets a file pin its own env, so the reader runs it under whichever env is `default` — against a different application, or against a target that withholds the payload class's opt-in, where it reaches a route that cannot fire the rule and goes GREEN. Measured rather than imagined: the traversal repro did exactly this under `secureLocal` while this milestone was being verified, and the green was indistinguishable from a fix",
    find: '  return `# re-run: tflw run --env ${f.env} ${reproDirFor(f.kind)}/${reproFileName(f)}\\n`;',
    replace: "  return '';",
  },
  {
    id: 'input-repro-single-backslash',
    milestone: 'm137d',
    pkg: '@tflw/reporter',
    file: REPRO,
    what: "`tflwString` stops doubling the backslash, so an emitted regex carries `\\s` as a single escape. `TF047` closed the escape set and made anything outside it an ERROR rather than a preserved backslash, so the repro does not merely match the wrong thing — it refuses to parse, in a file whose entire purpose is to be handed to somebody else",
    find: "    .replace(/\\\\/g, '\\\\\\\\')",
    replace: "    .replace(/\\\\/g, '\\\\')",
  },
  {
    id: 'input-repro-oversized-names-a-status',
    milestone: 'm137d',
    pkg: '@tflw/reporter',
    file: REPRO,
    what: "the oversized template asserts a specific `400` instead of any refusal. The rule fires only on a 2xx, so `>399` is the repair and naming one code picks a winner between `400` and `413` that the rule itself declines to pick — the repro then goes red against an application that fixed the bug the other way, which is D332's two-template lesson repeated on a new tier",
    find: "      return { title: `must bound the length of ${f.location}`, assertion: 'expect status is greater than 399' };",
    replace: "      return { title: `must bound the length of ${f.location}`, assertion: 'expect status equals 400' };",
  },
  {
    id: 'input-repro-body-without-content-type',
    milestone: 'm137d',
    pkg: '@tflw/reporter',
    file: REPRO,
    what: "a body-site repro drops the `content-type` header line. `body text` deliberately sets no content type, so the request the repro sends is not the request the finding describes: an API that requires JSON answers `415`, the assertion about the leak never gets a chance to run, and the file reports something about tflw's own emission rather than about the application",
    find: "      : `  api ${f.method} ${path} body text \"${tflwString(f.body)}\"\\n    header \"content-type\" is \"application/json\"\\n`;",
    replace: "      : `  api ${f.method} ${path} body text \"${tflwString(f.body)}\"\\n`;",
  },
  {
    id: 'repro-key-drops-the-invariant',
    milestone: 'm137d',
    pkg: '@tflw/reporter',
    file: SARIF,
    what: "the SARIF join key stops distinguishing detectors at one site. One mutation site can produce several findings — a stack frame and a SQL fragment at the same query parameter are two repairs, which is what R8's fingerprint separates them on — so the two collapse onto one key and the document ships TWO alerts pointing at ONE repro file, one of which is about a different leak. No error, no warning: just a link that quietly describes the wrong thing",
    find: "  return scan === 'input-handling' ? `${base} | ${invariant ?? ''}` : base;",
    replace: '  return base;',
  },
  {
    id: 'repro-hides-that-tflw-invented-the-request',
    milestone: 'm137d',
    pkg: '@tflw/reporter',
    file: REPRO,
    what: "a crawl-derived repro stops saying it was derived. The file then reads exactly like one an author wrote — an endpoint nobody declared, with a body nobody typed, and no note that D467's synthesis invented the values in it. For a synthesized request the repro is the ONLY artifact carrying that caveat, and the caveat is what decides whether a reader treats the finding as real or as a consequence of a bad guess",
    find: "  if (f.via === undefined) return '';",
    replace: "  return '';",
  },
  {
    id: 'repro-claims-every-request-was-invented',
    milestone: 'm137d',
    pkg: '@tflw/reporter',
    file: REPRO,
    what: "the provenance line goes on every repro, including the twelve derived from requests an author wrote. The failure is not the noise: a line present unconditionally carries no information, so the one file that really was synthesized becomes indistinguishable from the rest — the field stops meaning anything precisely when a reader needs it to",
    find: "  if (f.via === undefined) return '';",
    replace: "  if (f.via === undefined) return '# via: derived by a crawl from `seed openapi` — tflw built this request, no test declared it\\n';",
  },
  {
    id: 'input-repro-drops-the-crawl-provenance-at-the-emit-site',
    milestone: 'm137d',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: "the repro sink stops being told the seed, while `ScanFinding.via` keeps carrying it. This is the mutation the reporter-side pair cannot catch: two sinks are fed from two places, so `results.json` would still attribute the finding correctly and only the .tflw file — the artifact a maintainer actually opens — would lose the fact. It is the same class of gap as D478, where the emitter's own view of a request diverged from the run's",
    find: '      ...(tc.crawlVia !== undefined ? { via: tc.crawlVia } : {}),\n    });',
    replace: '    });',
  },

  // -- M137f (D442/D483): the spider ----------------------------------------------------------------
  //
  // Three, and they follow the same thesis `M137c`'s block states: a crawl's failure mode is a
  // *confident* answer, not a wrong one. Each of these leaves the walk green while making it claim more
  // ground than it covered — a truncation that stops announcing itself, a site the spider cannot read
  // reported as a site with nothing in it, and a value tflw invented passed off as the application's
  // own. None makes the spider report a finding that is not there.
  {
    id: 'spider-truncation-stops-announcing-itself',
    milestone: 'm137f',
    pkg: '@tflw/runtime',
    file: SPIDER,
    what: "a walk stopped by its cap reports as a completed one. Both mutants fetch exactly the same pages and produce exactly the same surface, which is precisely why this needs the flag and not a count: `D435` requires that truncation is reported *as* truncation, and without it every figure downstream reads as a total when it is a floor. This is the coverage lie in its cheapest form — nothing is wrong except that nobody is told",
    find: '    walked,\n    walkCapped,',
    replace: '    walked,\n    walkCapped: false,',
  },
  {
    id: 'spider-blind-spot-becomes-an-empty-site',
    milestone: 'm137f',
    pkg: '@tflw/runtime',
    file: SPIDER,
    what: "an origin the spider fetched but could not read — the client-rendered SPA of `D442` — stops being declared a blind spot, so *we cannot see this* renders identically to *there is nothing here*. The mutant's crawl is green and its surface is honest about what it found; the only thing lost is the sentence saying the tool was the limit, which is the one thing a reader cannot reconstruct from the numbers",
    find: '    ...(walked > 0 && !sawAnyLink',
    replace: '    ...(false && walked > 0 && !sawAnyLink',
  },
  {
    id: 'spider-invents-a-value-and-does-not-say-so',
    milestone: 'm137f',
    pkg: '@tflw/runtime',
    file: SPIDER,
    what: "a form field tflw filled in itself is no longer named in `invented`, so a finding resting on a made-up value reads as a finding about the application's own data. The request sent is byte-for-byte identical — this mutation changes nothing but the provenance, which is `D436`'s whole point about what a synthesized response is allowed to mean",
    find: '        fields.push([name, syntheticFor(type)]);\n        invented.push(`form field \\`${name}\\``);',
    replace: '        fields.push([name, syntheticFor(type)]);',
  },
  {
    id: 'a-chain-forgets-the-cookie-it-was-just-given',
    milestone: 'm137f',
    pkg: '@tflw/runtime',
    file: REDIRECT,
    what: "the sending half of `M88c1` is reverted: an intermediate `Set-Cookie` is still *reported*, and the next hop still goes out without it. This is the only mutation in the registry whose unmutated form was the shipped behaviour for nine milestones, and it is here because of HOW it hid — a login through a `302` stays green, since an app that answers an unauthenticated page by redirecting to its login form lands the chain on a `200`. Nothing fails; the run is simply not logged in. It needs a fixture whose protected route REFUSES, which is exactly what the four fixtures already in `cookie-events.test.ts` could not do",
    find: '  headers = withChainCookie(headers, chainCookie);',
    replace: '  headers = withChainCookie(headers, undefined);',
  },

  // --- M147c -----------------------------------------------------------------------------------
  // Order 6's checker/runtime contract. Ten rules shipped across five slices, each entered here as
  // the one mutation that removes the rule and leaves the build green. The registry had not grown
  // since `m137g` — nine milestones — because the ones between it and here were instrument and
  // documentation work whose breaks were demonstrated in throwaway scripts. A throwaway script
  // proves the assertion could fail *once*; only this array keeps proving it.
  {
    id: 'reversed-date-bounds-check-clean',
    milestone: 'm147c',
    file: CHECKER,
    what: "D630 removed: `random date between \"2030-01-01\" and \"2020-01-01\"` goes back to checking clean and dying in `asDate` at run time — `M140-05`. The two numeric siblings (`random number`, `random decimal`) have always thrown on a reversed literal range, so the mutant is a language where three generators of one family answer the same mistake two different ways, which is the asymmetry `M124-01` was filed about",
    find: '  if (from === null || to === null || from.anchor !== to.anchor || to.ms >= from.ms) return;',
    replace: '  if (from === null || to === null || from.anchor !== to.anchor || true) return;',
  },
  {
    id: 'setting-value-floor-unchecked',
    milestone: 'm147c',
    file: PARSER,
    what: "D631's floor removed: `workers 0` and `viewport 0 0` parse again — a worker pool that can run nothing and a window with no pixels in it, both accepted by `check` and discovered at run time or not at all (`A2-09`). The zeros that are *legal* survive this mutation untouched, which is the half of the rule that is easy to lose: `retry 0` and `timeout expect 0s` are meaningful settings and their tests stay green either way",
    find: '    if (n < min) {',
    replace: '    if (false && n < min) {',
  },
  {
    id: 'setting-value-fraction-unchecked',
    milestone: 'm147c',
    file: PARSER,
    what: "D631's other half: `retry 2.5` is accepted and truncated somewhere downstream without a word. A fractional count of whole things is the shape `A2-09` named first, and it is a separate branch from the floor above because a value can be legal on one and not the other — which is why one mutation could not have covered both",
    find: '    if (integer && !Number.isInteger(n)) {',
    replace: '    if (false && integer && !Number.isInteger(n)) {',
  },
  {
    id: 'reserved-scheme-typo-runs',
    milestone: 'm147c',
    file: CHECKER,
    what: "D632 removed: `api \"tflw://dmeo\"` checks clean and fails at run time in `guardDemoUrl` (`M118-01`). The reserved scheme has exactly one legal host, it is written as a string literal in `tflw.config`, and the set is known at check time — the mutant is the statically decidable rule left to the runtime, which is D137 clause 2 broken in the one place the manifest could not see it",
    find: '  if (!url.value.startsWith(DEMO_SCHEME) || url.value === DEMO_BASE_URL) return;',
    replace: '  if (true || !url.value.startsWith(DEMO_SCHEME) || url.value === DEMO_BASE_URL) return;',
  },
  {
    id: 'duplicate-table-column-accepted',
    milestone: 'm147c',
    file: PARSER,
    what: "D633 removed: `| id | id |` parses again, the second column silently wins, and every cell under the first is discarded without a word (`A2-11`). `TF072` is raised inside the loop that reads the header rather than over the finished column list, and the mutant is what the post-hoc version also produced — so this entry guards the *placement* as much as the rule: M83's panic mode swallows the second complaint when the cursor has not moved",
    find: '    if (seen.has(name.value)) {',
    replace: '    if (false && seen.has(name.value)) {',
  },
  {
    id: 'row-case-name-column-typo-silent',
    milestone: 'm147c',
    pkg: '@tflw/runtime',
    file: INTERP,
    what: "`A4-18`'s runtime half removed: a `{col}` in a `with each` test's **name** that the row does not carry goes back to `lookupVar`'s general sentence, which names `let` and `capture` — two keywords that cannot bind a table column — in the one scope where the header is the only thing that could have helped. The row was filed on the *remedy*, not on a missing error, and this is the only home for the file-backed form: `@tflw/lang` does no I/O, so `TF027` cannot see the columns of `with each from \"./rows.csv\"`",
    find: '    if (first.kind !== \'prop\' || columns.includes(first.name)) continue;',
    replace: '    if (first.kind !== \'prop\' || true) continue;',
  },
  {
    id: 'unparseable-import-reported-nowhere',
    milestone: 'm147c',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/imports.ts',
    what: "`M140-03` restored exactly: the resolver still runs a full `parseSource` on the imported file and still throws every diagnostic away, so `tflw check <entry>` prints `no problems found` about a program that cannot start. `actions: undefined` keeps the world unknown either way, which is why this hid — the *verdict* was always right and only the report was missing, and a check that is right and silent looks identical to a check that is right",
    find: '      unparseable.add(imp.path.value);\n',
    replace: '',
  },
  {
    id: 'imported-body-calls-unresolved',
    milestone: 'm147c',
    file: CHECKER,
    what: "`A4-21` reopened: a call written inside an imported action's body is never resolved against the importing file's registry, so an extracted `action` that calls a helper nobody brought in checks clean and dies on the first step that reaches it. The frame is the whole finding — the same call is *undecidable* in the file that declares it, because calls bind late and a library action may call a name only its importers define, and *fully decidable* one file up. Five wrong implementations were built for this; the test that catches each of them is the one asserting a library file stays clean",
    find: '  if (!closedWorld) return [];',
    replace: '  if (!closedWorld || true) return [];',
  },
  {
    id: 'malformed-api-step-loses-its-response-scope',
    milestone: 'm147c',
    file: CHECKER,
    what: "`M140-01`'s first victim restored: an `api` step the parser could not finish reading stops establishing a response scope, so the *next* line — which is correct — is told `TF039`, no response to read. The mistake and the diagnostic are on different lines, sometimes several apart, which is why neither `recoveredSpans` nor M83's panic mode could ever have filtered it: both match by position and there is no position to match",
    find: '        if (step.head === \'api\' || step.head === \'wait until api\') established = true;\n',
    replace: '',
  },
  {
    id: 'malformed-step-blinds-the-whole-variable-world',
    milestone: 'm147c',
    file: CHECKER,
    what: "the second victim's fix over-applied: *any* malformed head makes the scope's bindings unknown, not just the three that bind a name (`let`, `capture`, `download … as`). `TF030` then stops being reported after a malformed `click` or `fill`, which is a real diagnostic suppressed by an unrelated typo — the mirror of the bug being fixed, and the reason the two suppressions in this pass are kept independent with a negative control each way",
    find: '        if (step.head === \'let\' || step.head === \'capture\' || step.head === \'download\') bindings.unknown = true;',
    replace: '        bindings.unknown = true;',
  },

  // -- M147d --------------------------------------------------------------------------------
  //
  // Cluster 4's additive widenings (D627's rider: resolve an asymmetry by widening the narrower
  // side). Every entry here breaks a rule the language *gained*, so a survivor means the widening
  // is unasserted rather than that a guard rotted — the failure mode D636 added this milestone for.

  {
    id: 'call-argument-trailing-comma-refused',
    milestone: 'm147d',
    file: PARSER,
    what: "`A3-18` restored on the call side: `sign(\"x\",)` goes back to ``TF010: expected a value, found `)` `` while `{ a: 1, }` two lines away stays clean. The row named this one site; the rule that resolves it (D637 — a bracket-closed list takes a trailing comma, a line-terminated one does not) names two, and this is the half a reader meets first",
    find: "            if (this.check('rparen')) break; // trailing comma — D637\n            continue;\n          }\n          break;\n        }\n      }\n      if (!this.expect('rparen', '`)` to close the call')) return null;",
    replace: "            continue;\n          }\n          break;\n        }\n      }\n      if (!this.expect('rparen', '`)` to close the call')) return null;",
  },
  {
    id: 'action-parameter-trailing-comma-refused',
    milestone: 'm147d',
    file: PARSER,
    what: "the same widening on the declaration side: `action make id(prefix,)` back to an error. Kept as a separate entry from the call site on purpose — they are two independent `if`s in two productions, and one registry entry covering both would let either be deleted with the sweep still green, which is exactly the coverage claim `verify-shards.mjs` exists to keep honest",
    find: "          if (this.check('rparen')) break; // trailing comma — D637\n          continue;\n        }\n        break;\n      }\n    }\n    if (!this.expect('rparen', '`)` to close the parameter list')) return null;",
    replace: "          continue;\n        }\n        break;\n      }\n    }\n    if (!this.expect('rparen', '`)` to close the parameter list')) return null;",
  },
  {
    id: 'spelled-out-unit-refused-as-duration',
    milestone: 'm147d',
    file: PARSER,
    what: "`A3-13`'s own clause restored: `seconds` leaves the one time table, so `timeout wait 90 seconds` and `pause 2 seconds` are `TF023` again while `today + 3 seconds` two lines away stays clean. Targeted at the table rather than at `parseDuration`, because the date-offset path resolves through `DATE_OFFSET_UNITS` and its own `DATE_OFFSET_MS`/`offsetToMs` — so this breaks exactly the position the row is about and leaves the position it compared against alone",
    find: '  seconds: 1_000,\n',
    replace: '',
  },
  {
    id: 'adjacency-dropped-with-the-union',
    milestone: 'm147d',
    file: PARSER,
    what: "the union taken too far — the adjacency test removed outright instead of narrowed to abbreviations, so `timeout wait 2 s` and `expect duration is less than 250 ms` become legal again and D170 is undone. This is the failure the union invites, since the easy way to accept `2 seconds` is to stop asking where the unit sits",
    find: '    if (!spelledOut && !adjacent && this.reportBadDurationUnit(num, unitTok, adjacent)) return null;\n',
    replace: '',
  },
  {
    id: 'spelled-out-unit-must-touch-its-number',
    milestone: 'm147d',
    file: PARSER,
    equivalent: true,
    what: "adjacency asked of a **word** as well as an abbreviation — the plausible wrong version of D638, where `pause 2 seconds` is legal only as `pause 2seconds`",
    // Surviving is correct, and finding that out is why this entry exists. `reportBadDurationUnit`
    // reports nothing unless `nearestDurationUnit` can name the unit the word was reaching for, and
    // that lookup consults `DURATION_UNITS` and `UNIT_SPELLINGS` — neither of which contains any of
    // the five spelled-out words. So dropping `!spelledOut` changes no program today: the guard is a
    // fence around a collision that does not yet exist.
    //
    // Kept rather than deleted, on `date-check-before-duration`'s precedent and for its reason: the
    // day a plural joins `UNIT_SPELLINGS` — `minutes` is one edit from `minute`, which is already
    // there — this becomes a real mutation and reports itself as mislabelled rather than quietly
    // passing. That entry's identical comment was written eight milestones ago and was worth having
    // this week, which is the whole argument.
    find: '    if (!spelledOut && !adjacent && this.reportBadDurationUnit(num, unitTok, adjacent)) return null;',
    replace: '    if (!adjacent && this.reportBadDurationUnit(num, unitTok, adjacent)) return null;',
  },
  {
    id: 'abbreviated-date-bound-invisible-to-tf054',
    milestone: 'm147d',
    file: CHECKER,
    what: "the state `M147c` shipped in and this milestone found: `random date between today and today - 10s` reaches `no problems found` while `today - 10 seconds` raises `TF054`. One rule, two spellings, one of them judged — and the survivor is a *silence*, so nothing but a negative-facing test can catch it",
    find: '        : offset.type === \'DurationLit\'\n          ? { ms: offset.ms, text: offset.raw }\n          : null;',
    replace: '        : null;',
  },
  {
    id: 'spelled-out-duration-not-a-number',
    milestone: 'm147d',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/matcher.ts',
    what: "the second consequence restored: `expect duration is less than 2 seconds` checks clean and fails every run with ``\`is less than\` expects a number, got object``, while `2s` on the next line passes. Registered against `matcher.ts` rather than `eval.ts` because this is the guard `B3-04` hardened — the mutation has to prove the unwrap is a named exception to that guard and not a re-loosening of it",
    find: '  const offset = dateOffsetMs(value);\n  if (offset !== null) return offset;\n  if (typeof value !== \'number\' || Number.isNaN(value)) {',
    replace: '  if (typeof value !== \'number\' || Number.isNaN(value)) {',
  },
  {
    id: 'api-body-must-be-an-object',
    milestone: 'm147d',
    file: PARSER,
    what: "`A3-12` restored at the site the row named: `api POST /o body [1, 2]` back to ``TF010: expected `{` to start an object, found `[` ``, while the same array one level down (`body { items: [1, 2] }`), in a file body and in `expect body equals [1, 2]` all stay clean — which is the asymmetry the row was about, seen from the other side",
    find: "    const value = this.parseJsonDocument('the request body');",
    replace: '    const value = this.parseObject();',
  },
  {
    id: 'stub-body-must-be-an-object',
    milestone: 'm147d',
    file: PARSER,
    what: "the same restoration at the site the row did **not** name — `stub GET \"/api/orders\" respond status 200 body [1, 2]` refused, so a list endpoint cannot be stubbed. A separate entry from the `api` one on purpose: they are two calls in two productions, and one entry covering both would let either be reverted with the sweep still green",
    find: "      body = this.parseJsonDocument('the stubbed response body');",
    replace: '      body = this.parseObject();',
  },
  {
    id: 'body-refusal-forgets-the-array',
    milestone: 'm147d',
    file: PARSER,
    what: "the widening shipped but not told: `body 5` is still refused — correctly — with the pre-D639 sentence, which names one opener and offers ``expected `{` `` as the whole of its help. A user reading it learns neither that an array is now legal nor that `body text` is the form they want. The mutation is invisible to every positive test in the milestone, which is why the negatives assert the message verbatim rather than only the code",
    find: "      `expected \\`{\\` or \\`[\\` to start ${what}, found ${describeToken(tok)}`,\n      tok.span,\n      'a `body` is a JSON object or array — for anything else, use `body text \"…\"`',",
    replace: "      `expected \\`{\\` to start an object, found ${describeToken(tok)}`,\n      tok.span,\n      'expected `{`',",
  },
  {
    id: 'array-body-unwalked-by-the-checker',
    milestone: 'm147d',
    file: CHECKER,
    what: "the half-done widening: the parser accepts an array body and the checker keeps its `.fields` loop, so `body [{ id: {nope} }]` reports nothing at all and a typo'd variable reaches the runtime. The survivor is a **silence** — `check` says `no problems found` on a file it cannot read — so only a test that asserts a diagnostic *appears* can catch it",
    find: '      // `checkValue` already walks both `ObjectLit` and `ArrayLit`, so D639\'s widening needed no\n      // new arm here — only the loop that assumed fields had to go.\n      checkValue(body.value, bound, diags);',
    replace: "      if (body.value.type === 'ObjectLit') for (const field of body.value.fields) checkValue(field.value, bound, diags);",
  },
  {
    id: 'stub-array-body-unwalked-by-the-checker',
    milestone: 'm147d',
    file: CHECKER,
    what: 'the same silence at the `stub` site, which travels a different `case` in the same walker. Registered separately for the same reason the two parser entries are separate',
    find: '        if (step.body) checkValue(step.body, bound, diags);',
    replace: "        if (step.body && step.body.type === 'ObjectLit') for (const field of step.body.fields) checkValue(field.value, bound, diags);",
  },
  {
    id: 'array-body-not-navigable',
    milestone: 'm147d',
    pkg: '@tflw/lsp-server',
    file: 'packages/lsp-server/src/resolution/findNodeAtOffset.ts',
    what: "the editor half: the walker stops at `InlineBody` for an array, so hover, go-to-definition and rename all decline to know about anything inside `body [ … ]`. No diagnostic changes and no `@tflw/lang` test moves — the failure is that the editor does nothing, which `M106`'s rows are the standing reminder to assert deliberately",
    find: "      return inline.type === 'ObjectLit' ? inline.fields : inline.elements;",
    replace: "      return inline.type === 'ObjectLit' ? inline.fields : [];",
  },
  {
    id: 'array-body-flattened-to-an-object',
    milestone: 'm147d',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: "the pre-D639 mental model applied to a post-D639 AST: `InlineBody` meant *fields*, so an array gets spread into an object and `[{\"name\":\"Widget\"}]` leaves as `{\"0\":{\"name\":\"Widget\"}}`. **Invisible to every `@tflw/lang` test** — the file parses, checks and reports green, and the server receives a document nobody wrote. That is M109's stated bar for spending the runtime suite's 21s: the claim is about a join no cheaper subject can see",
    find: '      const text = JSON.stringify(evalValue(body.value, ctx));',
    replace: '      const text = JSON.stringify({ ...(evalValue(body.value, ctx) as object) });',
  },

  // ---- M147d-4 (`A3-10`, D640): the per-step wait budget ----------------------------------------
  {
    id: 'wait-budget-parsed-then-discarded',
    milestone: 'm147d',
    file: 'packages/lang/src/parser.ts',
    what: 'the clause is consumed but its duration is thrown away, so every `timeout wait <dur>` silently takes the env budget instead. The nastiest shape this widening can fail in: the file parses, `check` is clean, and the only symptom is a step that gives up at a moment nobody wrote',
    find: '    return { ok: true, ms };',
    replace: '    return { ok: true, ms: null };',
  },
  {
    id: 'request-timeout-eats-the-wait-budget',
    milestone: 'm147d',
    file: 'packages/lang/src/parser.ts',
    what: "the per-request `timeout` stops declining the two-token clause, so `wait until api GET /jobs timeout wait 5m` loses `timeout` to `parseApiRequestLine` and dies on ``expected a duration … found `wait` ``. This is the half of D640 that is easy not to notice needing a change at all, because the locator form works perfectly without it",
    find: "    if (this.isKw(this.peek(), 'timeout') && !this.atWaitBudget()) {",
    replace: "    if (this.isKw(this.peek(), 'timeout')) {",
  },
  {
    id: 'wait-budget-not-taught-at-end-of-step',
    milestone: 'm147d',
    file: 'packages/lang/src/parser.ts',
    what: "M84's hint table stops distinguishing the two `timeout` mistakes, so a plain `api` step's `timeout wait 5m` is answered with advice about `api` requests — the exact shape of unhelpfulness M84 exists to remove, reintroduced one token later",
    find: '        return this.atWaitBudget()',
    replace: '        return false',
  },
  {
    id: 'tf055-reads-the-env-over-the-step',
    milestone: 'm147d',
    file: 'packages/lang/src/checker.ts',
    what: 'the hold-window check goes back to the env budget alone, which makes `for 60s timeout wait 2m` — a perfectly satisfiable program — a warning against a 30s default. A false positive on the new grammar\'s very first use, and the reason widening this operand was not optional',
    find: "      const budget = typeof own === 'number' ? own : env?.wait;",
    replace: '      const budget = env?.wait;',
  },
  {
    id: 'tf055-reach-not-widened',
    milestone: 'm147d',
    file: 'packages/lang/src/checker.ts',
    what: 'the whole pass is skipped again whenever no env was resolved, including for the steps that supplied both operands themselves. Restores exactly the line D640 removed, so an editor with no config goes back to saying nothing about a program written entirely in front of it',
    find: '  const diags: Diagnostic[] = [];\n  for (const test of program.tests) checkHoldWindowsInSteps(test.body, opts.envTimeouts, diags);',
    replace: '  const diags: Diagnostic[] = [];\n  if (!opts.envTimeouts) return diags;\n  for (const test of program.tests) checkHoldWindowsInSteps(test.body, opts.envTimeouts, diags);',
  },
  {
    id: 'tf055-stops-naming-the-env',
    milestone: 'm147d',
    file: 'packages/lang/src/checker.ts',
    what: 'every `TF055` claims the budget is "on this step", including the env-derived ones where it is not — sending the reader to edit a line that does not exist. The mirror of the in-file case, and the reason the sentence forks rather than being written once',
    find: "          typeof own === 'number' ? `\\`timeout wait ${budget}ms\\` on this step`",
    replace: "          true ? `\\`timeout wait ${budget}ms\\` on this step`",
  },
  {
    id: 'ui-wait-ignores-its-own-budget',
    milestone: 'm147d',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'the locator form parses `timeout wait` and then polls the env budget anyway. Invisible to `@tflw/lang` — the AST is right, the checker agrees with it, and only a real poll loop shows the step giving up at the wrong moment. Kills the FS-05 backstop pair, which is why those two tests are written against "can never be satisfied" rather than against elapsed time',
    find: '  // there is no path on which the number a failure reports is not the number that bounded it.\n  const waitBudget = step.waitMs ?? config.timeouts.wait;',
    replace: '  // there is no path on which the number a failure reports is not the number that bounded it.\n  const waitBudget = config.timeouts.wait;',
  },
  {
    id: 'api-wait-ignores-its-own-budget',
    milestone: 'm147d',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'the same drop on the poll-loop side. Both halves are registered separately because they are two independent lines that happen to read alike — a widening that reached only one form would be exactly the asymmetry `A3-10` was filed about, one level down',
    find: '  // clause could never have served as the poll budget the row asked the locator form to gain.\n  const waitBudget = step.waitMs ?? config.timeouts.wait;',
    replace: '  // clause could never have served as the poll budget the row asked the locator form to gain.\n  const waitBudget = config.timeouts.wait;',
  },

  // ---- M147d-5 (`A3-11`, D641): which subjects a `wait until` may poll ----
  {
    id: 'wait-until-admits-anything',
    milestone: 'm147d',
    file: 'packages/lang/src/parser.ts',
    what: 'the guard stops refusing anything at all, so `wait until body.state equals "done"` — the row\'s own program — parses and becomes a step that reads a value nothing between polls can change',
    find: '    if (!pollable(subject)) {',
    replace: '    if (false && !pollable(subject)) {',
  },
  {
    id: 'pollable-ignores-the-of-clause',
    milestone: 'm147d',
    file: 'packages/lang/src/ast.ts',
    what: 'the `of request to "…"` arm goes away, so a value subject is judged by its keyword instead of by the clause that moves its read onto the browser\'s observed traffic. `status of request to "/x"` becomes `TF010` while a bare `page` still passes — the half of D641 that is easiest to write and easiest to leave out',
    find: "  return 'of' in subject && (subject as { of?: unknown }).of != null;",
    replace: '  return false;',
  },
  {
    id: 'pollable-admits-the-response-scope',
    milestone: 'm147d',
    file: 'packages/lang/src/ast.ts',
    what: 'the predicate says yes to everything, which is the widening done without the rule. Every refusal in the slice disappears at once, including the one `A3-11` filed',
    find: "  if (subject.type === 'LocatorSubject' || subject.type === 'PageSubject' || subject.type === 'NetworkRequestSubject') return true;",
    replace: '  return true;',
  },
  {
    id: 'one-refusal-for-two-mistakes',
    milestone: 'm147d',
    file: 'packages/lang/src/parser.ts',
    what: 'a `{variable}` subject is told it reads the last `api` response, which it does not. The fork exists because the two shapes fail for different reasons and need different repairs — collapsing it restores the one-sentence-for-eight-mistakes defect the row was really about',
    find: "      const isBoundValue = subject.type === 'ValueSubject';",
    replace: '      const isBoundValue = false;',
  },
  {
    id: 'snapshot-can-be-waited-on',
    milestone: 'm147d',
    file: 'packages/lang/src/parser.ts',
    what: 'the matcher half of D641 stops being enforced, so `wait until <locator> matches snapshot "s"` parses again — a wait whose condition is compared once against a file and can never become true by waiting',
    find: "    if (matcher.name === 'matchesSnapshot') {",
    replace: "    if (matcher.name === 'never-a-matcher-name') {",
  },
  {
    id: 'tf042-still-cannot-see-a-wait',
    milestone: 'm147d',
    file: 'packages/lang/src/checker.ts',
    what: 'the second traversal is dropped, restoring the state D641 found: `expect button "Go" has no critical a11y violations` is `TF042` and the identical mistake one keyword over checks clean and fails mid-run. Registered separately from the subject-set entries because the widening and the check that covers it are independently forgettable',
    find: '  forEachWaitUntilUi(program, (step) => checkOneMatcherSubject(step, diags));',
    replace: '',
  },
  {
    id: 'tf042-misses-a-nested-wait',
    milestone: 'm147d',
    file: 'packages/lang/src/checker.ts',
    what: 'the new traversal stops descending into `within`/`switch to new tab`/`download` bodies, so the check covers a `wait until` only at the top level of a body — the exact partial coverage that makes a gate read green while half the corpus is unvisited',
    find: "      else if (step.type === 'WithinBlock' || step.type === 'SwitchToNewTabBlock' || step.type === 'DownloadBlock') walk(step.body);",
    replace: '',
  },
  {
    id: 'wait-reader-picks-the-subject-over-the-ref',
    milestone: 'm147d',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'the network ref is consulted *after* the subject type, so `wait until status of request to "/x"` falls through to the response-scope throw instead of polling observed traffic. `execSteps` orders these two the same way for the same reason; a run is the only thing that can tell them apart',
    find: '  const ref = subjectNetworkRef(subject);\n  if (ref) {',
    replace: "  const ref = subject.type === 'NetworkRequestSubject' ? subjectNetworkRef(subject) : null;\n  if (ref) {",
  },
  {
    id: 'wait-page-arm-never-rescans',
    milestone: 'm147d',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'the a11y arm scans once, before the loop, and every later poll re-judges the same stale result. The step then cannot observe a page fixing itself — which is the only thing that distinguishes `wait until page …` from the `expect` it was already able to write',
    find: '    return async () => ({ outcome: describeA11yOutcome(step.matcher.negated, floor, filterBySeverity(await runA11yScan(page), floor)) });',
    replace: '    const once = filterBySeverity(await runA11yScan(page), floor);\n    return async () => ({ outcome: describeA11yOutcome(step.matcher.negated, floor, once) });',
  },
  {
    id: 'wait-network-arm-never-rereads',
    milestone: 'm147d',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/interpreter.ts',
    what: 'the same freeze one arm over: the observed-request log is read once instead of on every poll, so traffic the page issues after the step begins is never seen. Both arms are registered because they fail identically and are fixed in different places',
    find: '      const matched = findLastMatchingRequest(browser.page.networkRequestsSoFar(), urlPattern, method);',
    replace: '      const matched = findLastMatchingRequest([], urlPattern, method);',
  },

  // --- `M147d-6` / `M137f-02` (D642) — the env-scoped `session` -------------------------------
  //
  // The product half of this slice is one filter in `resolve.ts` and one argument in `cli.ts`, and
  // the two are registered separately on purpose: the filter decides what a session *is* under an
  // env, and the argument decides whether the checker was told. Reverting either one alone reopens
  // the row, and only the second one reopens it the way it was originally filed.
  {
    id: 'session-scope-never-narrows',
    milestone: 'm147d',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/resolve.ts',
    what: 'the scope clause parses, is checked, is documented — and resolves to nothing, because every session is in scope for every env again. The row reopens with the grammar in place, which is the worst of the available failures: a config that says `for env one` and behaves as though it did not',
    find: 's.envs === null || s.envs.some((e) => e.name === env.name)',
    replace: 'true',
  },
  {
    id: 'session-scope-drops-the-unscoped',
    milestone: 'm147d',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/resolve.ts',
    what: '`envs === null` stops meaning *every env* and starts meaning *no env*, so every session written before D642 resolves nowhere. This is the mutation that would turn an additive clause into a breaking change, and it is one character of the filter away at all times',
    find: 's.envs === null ||',
    replace: 's.envs !== null &&',
  },
  {
    id: 'out-of-scope-map-always-empty',
    milestone: 'm147d',
    pkg: '@tflw/runtime',
    file: 'packages/runtime/src/resolve.ts',
    what: 'the roster is still filtered correctly and the record of *why* is dropped, so `TF028` falls back to `known sessions: ...` in front of an author looking straight at the `session` block it says does not exist. The scoping works and the diagnostic lies about it',
    find: 'config.sessions.filter((s) => !sessions.has(s.name))',
    replace: 'config.sessions.filter(() => false)',
  },
  {
    id: 'check-session-body-sees-every-session',
    milestone: 'm147d',
    pkg: 'tflw',
    file: 'packages/cli/src/cli.ts',
    what: '`M137f-02` verbatim: the config-stage check goes back to reading every declared session against the active env\'s service map, so a session scoped to another env is `TF026` at its own line before a single assertion runs. This is the pre-D642 line, restored',
    find: '...checkSessionBody(Array.from(resolved.sessions.values()), Object.keys(resolved.services), envBaseUrls, envTimeouts),',
    replace: '...checkSessionBody(parsedConfig.config.sessions, Object.keys(resolved.services), envBaseUrls, envTimeouts),',
  },
  {
    id: 'tf074-never-fires',
    milestone: 'm147d',
    file: 'packages/lang/src/checker.ts',
    what: 'a `for env` clause naming an env that does not exist is accepted, which scopes the session to nothing at all. Every `as <name>` opting into it becomes a `TF028` pointing at a test file, and the suite quietly runs one identity short of the probe set it thinks it has',
    find: '      if (seen.has(ref.name)) continue;',
    replace: '      if (seen.has(ref.name) || true) continue;',
  },
  {
    id: 'tf074-underlines-the-declaration',
    milestone: 'm147d',
    file: 'packages/lang/src/checker.ts',
    what: 'the diagnostic anchors on the `session` instead of on the name, and a session span runs to the end of its indented body — so a five-step login gets a caret under the whole paragraph to complain about one word. The reason `SessionDecl.envs` carries nodes rather than strings, deleted',
    find: '        span: ref.span,',
    replace: '        span: session.span,',
  },
  {
    id: 'tf028-forgets-the-scoping-hint',
    milestone: 'm147d',
    file: 'packages/lang/src/checker.ts',
    what: 'the out-of-scope branch never runs, so `as console` under the wrong env reports `known sessions: shopper, peer` — true, useless, and the exact reading that sends an author looking for a typo in a name they spelled correctly',
    find: '      if (outOfScope && scopedTo) {',
    replace: '      if (false && outOfScope && scopedTo) {',
  },
  {
    id: 'env-scope-clause-never-parsed',
    milestone: 'm147d',
    file: 'packages/lang/src/parser.ts',
    what: 'the clause stops being read at all. `session console for env one` then reaches `endLine()` with three tokens left over, so the fix is unreachable from the grammar',
    find: "    if (!this.isKw(this.peek(), 'for')) return null;",
    replace: '    return null;',
  },
  {
    id: 'env-scope-takes-only-one-name',
    milestone: 'm147d',
    file: 'packages/lang/src/parser.ts',
    what: 'the comma loop stops after the first name, so `for env plaintext, staging` silently scopes to `plaintext` alone and the second env loses the session. Silently, because the leftover `, staging` is what `endLine()` then complains about — a diagnostic about a comma, for a bug about an identity',
    find: '      if (!this.check(\'comma\')) break;',
    replace: '      break;',
  },
  {
    id: 'late-env-scope-silent',
    milestone: 'm147d',
    file: 'packages/lang/src/parser.ts',
    what: '`session admin privileged for env local` loses its named diagnostic and falls through to `endLine()`, which is the cascade D310 spent a message to avoid: one honest complaint about `for`, then the indented body parsed as something it is not',
    find: "    if (!this.isKw(this.peek(), 'for')) return;",
    replace: '    return;',
  },
  {
    id: 'lsp-session-check-ignores-env-scope',
    milestone: 'm147d',
    pkg: '@tflw/lsp-server',
    file: 'packages/lsp-server/src/workspace/configResolution.ts',
    what: '`M137f-02` survives in the editor after the CLI is fixed: the language server checks every declared session against whichever env the workspace resolved, so a session scoped elsewhere is `TF026` in VS Code on a config `tflw check` calls clean. The CLI and the LSP disagreeing about what is legal, which is the one failure neither is allowed to have',
    find: '      ...checkSessionBody(Array.from(resolved.sessions.values()), Object.keys(resolved.services)),',
    replace: '      ...checkSessionBody(parsed.config.sessions, Object.keys(resolved.services)),',
  },
  {
    id: 'for-without-env-unnamed',
    milestone: 'm147d',
    file: 'packages/lang/src/parser.ts',
    what: '`session admin for local` stops being told which of the language\'s two `for`s it wrote — the other being `header "X" is "Y" for <service>`, which is exactly what an author reaching for a scope clause is likely to have had in mind. It becomes an anonymous unexpected token instead',
    find: "    if (!this.isKw(this.peek(), 'env')) {",
    replace: '    if (false) {',
  },

  // --- `M147e-1` (`A2-15`) — an oauth2 session names only what is missing ------------------------
  //
  // The shipped message restated all three required fields whichever ones were written, so an author
  // who forgot one read a paragraph about two they had. The narrowing is one `filter`, and both
  // mutations below put the paragraph back — one through the field list, one through the help arity.
  // The all-three golden is byte-identical to the old message, so it deliberately survives both:
  // what these break is the *partial* case, which is the only case the row was ever about.
  {
    id: 'oauth2-names-all-three-regardless',
    milestone: 'm147e',
    file: 'packages/lang/src/parser.ts',
    what: '`A2-15` verbatim: `session admin oauth2` with two of three fields present is told it `needs `token url`, `client id`, and `client secret`` — an answer to a question the author did not ask, and the reading that sends them checking two lines that are already correct',
    find: '      const missing = OAUTH2_REQUIRED.filter((f) => !bound[f.name]);',
    replace: '      const missing = OAUTH2_REQUIRED.slice();',
  },
  {
    id: 'oauth2-help-always-restates-the-block',
    milestone: 'm147e',
    file: 'packages/lang/src/parser.ts',
    what: 'the field list narrows but the help does not, so a config missing one line is shown a fresh three-line `session admin oauth2` block to write — next to the one it already has. The message and its worked example disagree about what is wrong, which is worse than either being wrong alone',
    find: '        missing.length === OAUTH2_REQUIRED.length',
    replace: '        true',
  },

  // --- `M147e-2` (`A2-13`) — the trailing-token noun follows the dialect ------------------------
  //
  // Three mutations, one per way the fix can be undone, because the noun and the hints are separate
  // mechanisms and the two loops that reclaim the noun are separate again. The last one is the
  // subtlest: nothing about `parse()`'s loop looks load-bearing, and dropping it leaves every
  // *first* declaration in a file correct.
  {
    id: 'endline-noun-always-step',
    milestone: 'm147e',
    file: 'packages/lang/src/parser.ts',
    what: '`A2-13` verbatim: `web "http://x" oops` in a `tflw.config` is told about the end of a step, in a dialect that has no steps. The noun goes back to being a constant',
    find: 'unexpected ${describeToken(tok)} at end of ${this.lineNoun}',
    replace: 'unexpected ${describeToken(tok)} at end of step',
  },
  {
    id: 'config-loop-never-claims-directive',
    milestone: 'm147e',
    file: 'packages/lang/src/parser.ts',
    what: "the config dialect stops naming itself, so the noun is whatever the constructor left — `'step'` — for every directive outside a `defaults`/`env` block. Half the row reopens, and it is the half whose fixture is a `session`-adjacent line rather than a block entry",
    find: "      // Same reclamation as `parse()`'s loop: a `session` body parses steps, which claims the noun.\n      this.lineNoun = 'directive';",
    replace: "      // Same reclamation as `parse()`'s loop: a `session` body parses steps, which claims the noun.",
  },
  {
    id: 'top-level-loop-never-reclaims',
    milestone: 'm147e',
    file: 'packages/lang/src/parser.ts',
    what: "the noun is claimed by `parseStep()` and never given back, so a file's *first* declaration reports correctly and every declaration after a `test` body says `at end of step` again. The failure only appears in a file with two declarations, which is why the `import` fixture has a `test` under it",
    find: "      this.lineNoun = 'declaration';",
    replace: '',
  },
  {
    id: 'step-hints-offered-in-every-dialect',
    milestone: 'm147e',
    file: 'packages/lang/src/parser.ts',
    what: "the noun is right and the hint under it is not: a `tflw.config` line ending in `and` is told `one assertion per `expect`` — advice about a keyword the config dialect does not have. This is the half of `A2-13` that survives a noun-only fix",
    find: "        return this.lineNoun !== 'step' ? null : 'one assertion per `expect` — put the second one on its own `expect` line';",
    replace: "        return 'one assertion per `expect` — put the second one on its own `expect` line';",
  },
  {
    id: 'timeout-hint-offered-in-config',
    milestone: 'm147e',
    file: 'packages/lang/src/parser.ts',
    what: '`timeout` is a real `defaults` key, so writing it in the wrong position inside `tflw.config` was answered with "a per-step `timeout` … is only accepted on `api` requests" — in the file that accepts it. The most confusing single line the ungated table produced, because it is the one case where the hint is about the right word and the wrong dialect',
    find: "        if (this.lineNoun !== 'step') return null;",
    replace: '',
  },

  // --- `M147e-3` (`A3-19`) — a bare word run is a call missing its parens -----------------------
  //
  // Three ways to lose this: the branch itself, the two-word floor, and the end-of-line test. The
  // last two are the ones that matter, because both leave the branch present and working on the
  // row's own example while quietly answering the wrong question everywhere else.
  {
    id: 'bare-word-run-gets-the-keyword-wall',
    milestone: 'm147e',
    file: 'packages/lang/src/parser.ts',
    what: '`A3-19` verbatim: `create order` as a step goes back to `unknown step` plus all thirty step keywords, while `let x = create order` one line below still gets the parens advice. The same mistake answered two ways in the same file, and the worse answer at the position where a bare call is actually written',
    find: '          if (!hint && this.looksLikeBareWordRun()) {',
    replace: '          if (false) {',
  },
  {
    id: 'one-word-is-a-call-shape',
    milestone: 'm147e',
    file: 'packages/lang/src/parser.ts',
    what: "the floor drops to one word, so every unrecognised single keyword with no near miss is told it looks like a call — `zzz` becomes paren advice instead of the list of what may go there. The enumeration stops being reachable at all, which is the failure mode of fixing a diagnostic by widening it",
    find: '    if (k < 2) return false;',
    replace: '    if (k < 1) return false;',
  },
  {
    id: 'word-run-need-not-fill-the-line',
    milestone: 'm147e',
    file: 'packages/lang/src/parser.ts',
    what: "the end-of-line test goes away, so `expct status equals 200` is read as a call — a mis-spelled `expect` with three arguments after it, answered with advice about parentheses. Only reachable when `suggest` has nothing, so it looks harmless until a typo lands outside the edit-distance window",
    find: "    const end = this.peek(k).type;\n    return end === 'newline' || end === 'dedent' || end === 'eof';",
    replace: '    return true;',
  },

  // --- `M147e-4` (`A3-14`, D643) — the recursion depth limit -------------------------------------
  //
  // Two mutations, not three. The *bound* is deliberately not mutated: 256 against 257 is an
  // arbitrary point on a scale whose only real constraint is "far below the stack and far above
  // anything a person writes", and a test pinning the exact integer would assert a number rather
  // than a property. What is load-bearing is that the limit exists and that it measures one
  // expression rather than the file.
  {
    id: 'unary-depth-unbounded',
    milestone: 'm147e',
    file: 'packages/lang/src/parser.ts',
    what: '`A3-14` verbatim, and the worst failure in this milestone: `parseSource` throws a raw V8 `RangeError` out of a function documented as never throwing for a syntax error. The user sees `Maximum call stack size exceeded` with no filename, no line and no caret — not a bad diagnostic but none at all',
    find: '      if (this.unaryDepth >= Parser.MAX_UNARY_DEPTH) {',
    replace: '      if (false) {',
  },
  {
    id: 'unary-depth-never-unwinds',
    milestone: 'm147e',
    file: 'packages/lang/src/parser.ts',
    what: 'the counter stops measuring the expression and starts measuring the file: every unary minus anywhere spends depth that is never returned, so the 257th one in a file — however shallow the expression it sits in — is refused. A limit against pathological input turned into a limit on how many times a legal operator may appear',
    find: '      this.unaryDepth--;',
    replace: '',
  },

  // --- `M147e-5` (`M106-02`) — the empty-block rules anchor on their own header -------------------
  //
  // Eleven rules, one mechanism, and the mutations go at the mechanism rather than at each rule:
  // `headerSpanFrom` itself, the two rules whose span is hardest to get right, and the census
  // property. `parseStepOrSpikeWorkload` is deliberately not mutated — it has anchored correctly
  // since `A2-04` and this slice only moved it onto the shared helper.
  {
    id: 'header-span-taken-after-the-newline',
    milestone: 'm147e',
    file: 'packages/lang/src/parser.ts',
    what: "the header span loses its extent — captured before `endLine()`, `peek()` is the header's own terminating newline, so all eleven rules go back to a zero-width caret sitting one cell past the header instead of underlining it. Right line, no extent, which is the half of `M106-02` the CLI *could* see: sixteen goldens move. The half it could not see is `empty-block-anchors-past-the-block` below",
    find: '  private headerSpanFrom(start: Position): Span {\n    return this.spanFrom(start);\n  }',
    replace: '  private headerSpanFrom(_start: Position): Span {\n    return this.peek().span;\n  }',
  },
  {
    id: 'wait-until-second-raise-anchors-past-the-block',
    milestone: 'm147e',
    file: 'packages/lang/src/parser.ts',
    what: "the row's own example, and the half a one-line fix misses: `wait until` raises `TF015` twice, and the *second* raise fires after the dedent is consumed, so `peek()` is the first token beyond the whole block. Headers-but-no-`expect` is the shape that reaches it, and the caret lands two lines below the construct the sentence names",
    find: "      this.error(Codes.EMPTY_BLOCK, 'this `wait until` has no `expect` lines', headerSpan, 'indent at least one `expect` under the request line');\n    }\n    return { headers, expects };",
    replace: "      this.error(Codes.EMPTY_BLOCK, 'this `wait until` has no `expect` lines', this.peek().span, 'indent at least one `expect` under the request line');\n    }\n    return { headers, expects };",
  },
  {
    id: 'fill-form-header-span-spans-the-block',
    milestone: 'm147e',
    file: 'packages/lang/src/parser.ts',
    what: '`fill form`\'s second raise takes `spanFrom(start)` instead of the header span — the shape this slice replaced, and the one that looks correct: it starts in the right place. It ends at the last token *consumed*, so the caret underlines the whole malformed block rather than the line that opened it, and `M106`\'s one-cell rule is the only reason that is visible at all',
    find: "      this.error(Codes.EMPTY_BLOCK, 'this `fill form` has no rows', headerSpan, 'add at least one `| \"Field\" | value |` row');",
    replace: "      this.error(Codes.EMPTY_BLOCK, 'this `fill form` has no rows', this.spanFrom(start), 'add at least one `| \"Field\" | value |` row');",
  },

  // --- `M147e-6` (`M106-01`) — the CLI and the editor agree, and something holds them to it -------
  //
  // The same producer edit as `header-span-taken-after-the-newline`, aimed at the *other* suite.
  // `M106-01` is an agreement between two surfaces, and a mutation that only runs `@tflw/lang`'s
  // tests cannot see the editor half go wrong — which is precisely how the disagreement `M140-3`
  // measured survived from `M106` to here without a red test anywhere.
  {
    id: 'empty-block-anchors-past-the-block',
    milestone: 'm147e',
    file: 'packages/lang/src/parser.ts',
    what: "`M106-02` verbatim, at the rule rather than at the helper: the span is read at the *error site*, where `endLine()` has run and `peek()` is the first token of whatever comes next — the phantom last line for a file that ends there. This is the shape the helper exists to prevent, and mutating the helper does not reproduce it: called before `endLine()`, even `peek()` is still on the header line",
    find: "      this.error(Codes.EMPTY_BLOCK, `this \\`${context}\\` has no steps`, headerSpan, `indent at least one step under the \\`${context}\\` line`);\n      return { workload: null, thresholds: [], cleanup: false, body: [] };",
    replace: "      this.error(Codes.EMPTY_BLOCK, `this \\`${context}\\` has no steps`, this.peek().span, `indent at least one step under the \\`${context}\\` line`);\n      return { workload: null, thresholds: [], cleanup: false, body: [] };",
  },
  {
    id: 'lsp-loses-the-header-anchor',
    milestone: 'm147e',
    pkg: '@tflw/lsp-server',
    file: 'packages/lang/src/parser.ts',
    what: "`M106-01` reopened in the editor, and the reason this entry names a *different* suite than the identical edit above: the row is an agreement between two surfaces, so the failure only appears where both are read. With `test`'s empty-block rule anchoring past its construct again, the LSP publishes a range on the phantom last line while the CLI caret walks back to the header — `M140-3`'s measurement, which no test in either package could see",
    find: "      this.error(Codes.EMPTY_BLOCK, `this \\`${context}\\` has no steps`, headerSpan, `indent at least one step under the \\`${context}\\` line`);\n      return { workload: null, thresholds: [], cleanup: false, body: [] };",
    replace: "      this.error(Codes.EMPTY_BLOCK, `this \\`${context}\\` has no steps`, this.peek().span, `indent at least one step under the \\`${context}\\` line`);\n      return { workload: null, thresholds: [], cleanup: false, body: [] };",
  },

];

/**
 * How many mutations each M98 sub-milestone ran, from `PLAN_M98_LEXER_POSITIONS.md`'s own shipped
 * sections. This is the denominator every "N of the plan's 31" sentence in this repo has quoted,
 * and until M126 it was a bare `31` with no record of where it came from.
 *
 * M98a is absent because it shipped no mutation note, not because it was overlooked — an absent key
 * and a `0` mean different things here, and `coverageProblem()` only grades the keys present.
 */
const M98_PLAN = { m98b: 5, m98c: 11, m98d: 15 };

/**
 * The plan's mutations this registry does **not** reconstruct. Named rather than silently omitted.
 *
 * `count` is a count of **mutations**, and saying so is the whole point of this rewrite. The five
 * entries this replaces carried the plan's *kill* counts in parentheses — `(2 kills)`, `(1)`, `(1)`,
 * `(2)` — copied out of its "Nine died as intended (D159 reverted → 2; …)" list, where `→ 2` means
 * *two tests failed*. Summed as if they were mutation counts they gave 16 against an arithmetic 11,
 * and that contradiction sat in this file for eighteen milestones as something that "cannot be
 * settled from this side". It could: each of those four groups is one mutation.
 *
 * Each of these is described in the plan at a granularity that admits more than one concrete edit
 * ("D159 reverted", "per-code-unit recovery"), so reconstructing one needs the milestone's own diff,
 * not its prose — which is why they are still open rather than closed by guesswork. Reconstruct one
 * and `coverageProblem()` goes red until this array is updated to match: that is the check the old
 * array did not have, and the reason it could quietly stop being true.
 */
const UNRECONSTRUCTED = [
  // m98b. Omitted entirely by the array this replaces — the plan lists five negative controls and
  // this is the one with no counterpart here, under any milestone (grep the registry for a stray
  // closer and nothing comes back). Its absence is exactly why the count is now checked.
  { milestone: 'm98b', count: 1, what: 're-clamping the stray closer, so `A1-20`\'s note stops being reported' },

  // m98c. These four the old array had right; only their numbers were kill counts.
  { milestone: 'm98c', count: 1, what: 'D159 reverted — the `newline` token back at the physical end of line' },
  { milestone: 'm98c', count: 1, what: 're-scanning for `#` instead of taking `lexContent`\'s return' },
  { milestone: 'm98c', count: 1, what: 'the tab rule applied per-line rather than once per file' },
  { milestone: 'm98c', count: 1, what: 'per-code-unit recovery for astral characters' },

  // m98d. The old array said "10 of the 15". Thirteen: the registry reconstructs only the two
  // survivors (`bom-col`, `unicode-escape-recovery`), and the third survivor the plan records —
  // `M2`, the trailing-comment coverage gap — is not here either.
  { milestone: 'm98d', count: 13, what: '13 of the 15: the eight-position hidden-character property, its two probe additions, and the `M2` trailing-comment survivor' },
];

/**
 * What this registry covers, computed rather than recalled. Printed on the summary line so the
 * denominator travels with the numerator — `M125e-02` is the row for what happens when it doesn't.
 */
export function coverage(mutations = MUTATIONS) {
  const planned = Object.values(M98_PLAN).reduce((a, b) => a + b, 0);
  const missing = UNRECONSTRUCTED.reduce((a, u) => a + u.count, 0);
  const reconstructed = mutations.filter((m) => m.plan).length;
  return { planned, missing, reconstructed, total: mutations.length };
}

/**
 * The M98 accounting, checked from both sides.
 *
 * One side is `MUTATIONS.filter(m => m.plan)`; the other is `M98_PLAN` minus `UNRECONSTRUCTED`.
 * Neither can move without the other agreeing, which is the property the old prose lacked: an
 * unchecked array of sentences forty lines under a census that had already gone wrong three times
 * — and went wrong a fourth before anyone noticed. Reconstructing one of the plan's mutations now
 * means flagging it *and* dropping it from `UNRECONSTRUCTED`; doing either alone turns the sweep
 * red on its next run rather than silently overstating coverage.
 */
/**
 * M127 — every package the registry names has a measured suite time.
 *
 * A missing entry costs no correctness (`partition()` is a partition whatever the weights say) but
 * it silently weights a package at the 60s fallback, and the two packages that dominate this sweep
 * are 161s and 60s. A new `pkg:` whose suite runs for three minutes would be dealt as if it ran for
 * one, and the only symptom would be one shard finishing much later than its siblings — read as
 * ordinary noise, on a job nobody watches the shape of. Cheaper to refuse and ask for a number.
 */
export function costProblem(mutations = MUTATIONS, costs = SUITE_SECONDS) {
  const missing = [...new Set(mutations.map((m) => m.pkg ?? DEFAULT_PKG))].filter((pkg) => !(pkg in costs));
  if (missing.length === 0) return undefined;
  return (
    `mutate.mjs has no measured suite time for: ${missing.join(', ')}\n` +
    `  Add each to SUITE_SECONDS with the seconds one run of its suite takes on a 2-core runner.\n` +
    `  The number only balances the shards — it cannot make a sweep wrong — but guessing it is how\n` +
    `  one shard quietly becomes the long pole again.`
  );
}

export function coverageProblem(mutations = MUTATIONS) {
  const problems = [];
  for (const [ms, planned] of Object.entries(M98_PLAN)) {
    const reconstructed = mutations.filter((m) => m.milestone === ms && m.plan).length;
    const missing = UNRECONSTRUCTED.filter((u) => u.milestone === ms).reduce((a, u) => a + u.count, 0);
    if (reconstructed + missing !== planned) {
      problems.push(
        `${ms}: the plan ran ${planned} mutation(s), this file accounts for ${reconstructed + missing} ` +
          `(${reconstructed} flagged \`plan: true\`, ${missing} counted in UNRECONSTRUCTED).`,
      );
    }
  }
  for (const u of UNRECONSTRUCTED) {
    if (!(u.milestone in M98_PLAN)) {
      problems.push(`UNRECONSTRUCTED names \`${u.milestone}\`, which M98_PLAN does not know.`);
    }
    if (!Number.isInteger(u.count) || u.count < 1) {
      problems.push(`UNRECONSTRUCTED entry "${u.what}" has a \`count\` of ${u.count}; it must be a positive integer count of *mutations*.`);
    }
  }
  for (const m of mutations) {
    if (m.plan && !(m.milestone in M98_PLAN)) {
      problems.push(`\`${m.id}\` is flagged \`plan: true\` but \`${m.milestone}\` is not one of M98's sub-milestones.`);
    }
  }
  if (problems.length === 0) return undefined;
  return (
    `mutate.mjs no longer adds up against the M98 plan:\n` +
    problems.map((p) => `    ${p}`).join('\n') +
    `\n  Reconstructing one of the plan's mutations means flagging it \`plan: true\` **and** dropping it` +
    `\n  from UNRECONSTRUCTED. Doing one without the other is what this check exists to catch.`
  );
}

// ---------------------------------------------------------------------------
// THE RUNNER. Nothing below runs on `import` — see the `main` guard at the very bottom (M123, D224).

// The registry the runner works from: the mutations written here, plus the ones this tool aims at
// its own instrumentation (M123). Two files for a mechanical reason, not an organisational one —
// see `scripts/self-mutations.mjs` for why a self-targeting `find:` cannot live beside its target.
const MUTATIONS = [...REGISTRY, ...SELF_MUTATIONS];

export { M98_PLAN, MUTATIONS, UNRECONSTRUCTED };

// M122 (`M122-01`). `MUTATIONS` silently lost an entry between `M120` and `M121`: a missing
// `},\n  {` merged two object literals into one, so `M121`'s `id`, `file`, `find` and `replace`
// overwrote `M120`'s and `unnamed-arm-dropped-for-every-kind` — the over-correction control for
// `B4-08`'s fix — stopped existing. Every run since was green, because **a mutation that is not in
// the array cannot survive**. Scoping made it invisible rather than obvious: the surviving object
// carried `milestone: 'm121'`, so even `M114`'s run-it-unscoped rule showed no gap, and the count
// printed at the end of a run counts what was built, never what was written.
//
// The array cannot catch this from the inside — by the time it is a value the duplicate keys are
// already collapsed. So the check reads this file's own source and compares `id:` keys *written*
// against objects *built*. Same shape as `verify-test-counts.mjs`, for the same reason: an
// instrument has to count what it ran against what exists, because "nothing went red" is not a
// result (`M119`).
// M123: the registry is now two files, so the check counts across both. A per-file check would
// have passed on each half and still missed a merged entry, which is the whole failure mode.
const REGISTRY_SOURCES = [fileURLToPath(import.meta.url), fileURLToPath(new URL('./self-mutations.mjs', import.meta.url))];

export function registryProblem(source = REGISTRY_SOURCES.map((f) => readFileSync(f, 'utf8')).join('\n'), built = MUTATIONS.length) {
  const idKeysWritten = (source.match(/^ {4}id: '/gm) ?? []).length;
  if (idKeysWritten === built) return undefined;
  return (
    `mutate.mjs is malformed: ${idKeysWritten} \`id:\` keys are written in this file but ${built} ` +
    `mutation objects were built. A missing \`},\` between two entries merges them, and the earlier ` +
    `mutation stops existing without any run going red.`
  );
}

// ---------------------------------------------------------------------------
// M123 (`M118-03`, `M111-02`) — THE JOURNAL. The mechanism and the measurements behind it live in
// `scripts/mutation-journal.mjs`, which is a separate module because it has a second consumer: the
// root `npm test` refuses to run while a journal is open.

/** The entry currently on disk, so a signal handler knows what to undo. */
let inFlight = null;

/**
 * Open the journal, and treat a journal that cannot be written as a reason not to proceed.
 *
 * This is also what makes the ordering in `sweep` testable rather than merely correct. With the
 * journal opened first, an unwritable location stops the run with the source untouched; with the two
 * lines swapped, the same failure leaves the source mutated **and** nothing on disk saying what it
 * was — `M118-03` produced by the journal's own failure path. A test can point
 * `TFLW_MUTATE_JOURNAL` at a directory that does not exist and read the difference straight off the
 * working tree, which nothing watching the sub-millisecond gap between two `writeFileSync` calls
 * could ever do without flaking.
 */
function openJournal(entry) {
  try {
    writeJournal(entry);
  } catch (err) {
    console.error(`✗ cannot write the mutation journal at ${journalPath()} (${err.message}).`);
    console.error(`  Nothing has been mutated: without somewhere to record the original, an interrupted run`);
    console.error(`  would leave a tracked source wrong with no way back (M118-03).`);
    return false;
  }
  inFlight = entry;
  return true;
}

function closeJournal() {
  inFlight = null;
  clearJournal();
}

/**
 * A journal left behind by a run that died. Repaired — and reported — *before* anything else
 * happens, because the alternative is a sweep baselining against a tree that still holds the last
 * run's mutation: a red baseline at best, and at worst a green one that means nothing.
 */
function repairStaleJournal() {
  let journal;
  try {
    journal = readJournal();
  } catch (err) {
    console.error(`✗ the mutation journal at ${journalPath()} is unreadable (${err.message}).`);
    console.error(`  It was written by a run that did not finish, and it is the only record of what that run changed.`);
    console.error(`  Check \`git status\` for a modified source file before deleting it by hand.`);
    return 2;
  }
  if (!journal) return 0;

  // M123 (`M123-03`) — a journal whose owner is still running is not stale, and repairing it is
  // actively destructive. Measured, one worktree, two processes:
  //
  //     outer sweep is live (pid 24371); lexer.ts is mutated; journal present? true
  //     ↺ repaired: a previous run died at … with `bom-col` (m98d) applied.
  //         restored packages/lang/src/lexer.ts
  //     after the second process: lexer.ts back to pristine? true
  //                              the LIVE sweep's journal still there? false
  //
  // The second process un-mutated the first one's source **mid-suite** and announced that a run had
  // died about a run that was still going. The first sweep then measured unmutated code and
  // reported SURVIVED — a false survivor, which is the safe direction to fail in but is still a
  // broken instrument. It cost three of this milestone's own nine controls, and it was found only
  // because those controls existed: `M123`'s tests spawn `mutate.mjs`, so `test:scripts` ran a
  // second sweep inside the first.
  //
  // Refuse, rather than wait or repair. Two sweeps cannot share a worktree in any case — they would
  // fight over the same sources — so there is nothing useful to do but say which process holds it.
  if (isProcessAlive(journal.pid) && journal.pid !== process.pid) {
    console.error(`✗ another mutation sweep is already running in this worktree (pid ${journal.pid}), holding \`${journal.id}\` (${journal.milestone}).`);
    console.error(`  Two sweeps cannot share one worktree: they rewrite the same tracked sources, and whichever`);
    console.error(`  finishes second restores what the first was still measuring.`);
    console.error(`  Wait for it, or — if you are certain that process is gone and its pid has been reused —`);
    console.error(`  delete ${journalPath()} by hand after checking \`git status\`.`);
    return 2;
  }
  const { restored, problems } = applyJournal(journal);
  if (problems.length > 0) {
    console.error(`✗ a previous run of this tool died while \`${journal.id}\` was applied, and the repair failed:`);
    for (const p of problems) console.error(`    ${p}`);
    return 2;
  }
  if (restored.length > 0) {
    console.log(`↺ repaired: a previous run died at ${journal.startedAt ?? 'an unknown time'} with \`${journal.id}\` (${journal.milestone}) applied.`);
    for (const rel of restored) console.log(`    restored ${rel}`);
    console.log(`  Nothing announced that at the time, which is exactly what \`M118-03\` was about.`);
  }
  closeJournal();
  return 0;
}

// ---------------------------------------------------------------------------
// Shards. M127 (`M126-01`).
//
// The sweep took 1h13m11s on run 31540764432 against `timeout-minutes: 90`, having grown
// 51m → 53m → 55m → 59m → 69m → 71m → 73m in seven milestones. The failure waiting at the end of
// that line is not a red test: it is PR #48's, where the sweep finished *green* and the job was
// killed in a later step with the work done and thrown away.
//
// A bigger number would be the third application of a fix that has not held twice, and `M114`'s
// rule forbids the cheap structural one — scoping the sweep on PRs is how `M122-01` stayed
// invisible, a merged registry entry leaving one mutation not merely surviving but *absent*, with
// every scoped run green about a mutation that no longer existed. So: every mutation still runs on
// every pull request, and what changes is how many machines run them.
//
// WHAT A SHARD MUST NOT BE ABLE TO DO. Splitting a sweep introduces exactly one new way to be
// green about nothing — a mutation that lands in no shard, or a shard that runs zero mutations and
// exits 0. That is this file's oldest recurring shape, and it is designed against three times over
// rather than once:
//
//   1. `partition()` is total and disjoint by construction, and says so — it throws rather than
//      returning a partition that lost or duplicated an entry, so the bug cannot be silent.
//   2. An empty shard is an error, not an early return (`main`). Zero mutations run is never a
//      thing this tool reports success about.
//   3. The workflow's matrix and this tool's `n` are two numbers that can drift apart, and no
//      amount of care inside one file fixes that. So each shard writes down what it actually ran
//      (`--manifest=`) and `scripts/verify-shards.mjs` re-assembles the registry from those
//      manifests in a job of its own. A shard silently dropped from the matrix fails *there*.

/** Mutations grouped by resolved package, in registry order, as `[pkg, mutations[]]`. */
function byPackage(mutations) {
  const groups = new Map();
  for (const m of mutations) {
    const pkg = m.pkg ?? DEFAULT_PKG;
    if (!groups.has(pkg)) groups.set(pkg, []);
    groups.get(pkg).push(m);
  }
  return [...groups];
}

/** What `n` mutations of `pkg` cost when they are the only ones of that package in a shard: their
 *  own suite runs plus the one baseline the shard has to pay before the first of them. */
function chunkCost(pkg, n) {
  return (n + 1) * (SUITE_SECONDS[pkg] ?? 60);
}

/** `ms` split into `k` contiguous, near-equal slices. Contiguous because registry order is
 *  milestone order, and a shard whose mutations come from one stretch of the registry is far easier
 *  to read a failure out of than one holding every seventh entry. */
function slices(ms, k) {
  const out = [];
  let taken = 0;
  for (let i = 0; i < k; i++) {
    const size = Math.round(((i + 1) * ms.length) / k) - taken;
    out.push(ms.slice(taken, taken + size));
    taken += size;
  }
  return out.filter((s) => s.length > 0);
}

/**
 * `mutations` dealt into `n` shards, deterministically.
 *
 * Chunk, then pack. Each package is cut into as many pieces as its cost exceeds an even share, and
 * the pieces are then packed longest-first into whichever shard they make cheapest — counting the
 * baseline only when that shard does not already hold the package. The target share is recomputed
 * after cutting, because cutting is what adds the extra baselines that move it; three passes is
 * enough for it to settle on this registry and the loop stops when it does.
 *
 * Deterministic at every step that could be arbitrary: slices are contiguous and in registry order,
 * the pack order breaks cost ties on package name then first id, and the "cheapest shard" search
 * keeps the lowest index on a tie. The same registry always deals the same hands — which is what
 * makes a shard's contents reproducible from the shard number alone when one of them goes red.
 */
export function partition(mutations, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error(`shard count must be a positive integer, got ${n}`);
  const groups = byPackage(mutations);

  let target = groups.reduce((a, [pkg, ms]) => a + chunkCost(pkg, ms.length), 0) / n;
  let chunks = [];
  for (let pass = 0; pass < 3; pass++) {
    chunks = [];
    for (const [pkg, ms] of groups) {
      const pieces = Math.max(1, Math.min(ms.length, Math.ceil(chunkCost(pkg, ms.length) / target)));
      for (const part of slices(ms, pieces)) chunks.push({ pkg, ms: part });
    }
    const settled = chunks.reduce((a, c) => a + chunkCost(c.pkg, c.ms.length), 0) / n;
    if (Math.abs(settled - target) < 1) break;
    target = settled;
  }

  // Cost-driven cutting can leave fewer chunks than shards — at `n` near the size of the registry
  // the shares are smaller than a single suite run, and the cut is capped at one chunk per
  // mutation per package. Keep halving the widest chunk until there is one for every shard, which
  // is always reachable while `n` does not exceed the number of mutations. Without this the packer
  // below hands out fewer chunks than it has bins and a shard comes out empty — found by the
  // totality assertion at the bottom of this function, on the first run of the test that exercises
  // every shard count the registry can take.
  while (chunks.length < n) {
    let widest = 0;
    for (let i = 1; i < chunks.length; i++) if (chunks[i].ms.length > chunks[widest].ms.length) widest = i;
    if (chunks[widest].ms.length < 2) break;
    const [left, right] = slices(chunks[widest].ms, 2);
    chunks.splice(widest, 1, { pkg: chunks[widest].pkg, ms: left }, { pkg: chunks[widest].pkg, ms: right });
  }

  chunks.sort(
    (a, b) =>
      chunkCost(b.pkg, b.ms.length) - chunkCost(a.pkg, a.ms.length) ||
      a.pkg.localeCompare(b.pkg) ||
      a.ms[0].id.localeCompare(b.ms[0].id),
  );

  const bins = Array.from({ length: n }, () => ({ cost: 0, pkgs: new Set(), ms: [] }));
  chunks.forEach((c, nth) => {
    const suite = SUITE_SECONDS[c.pkg] ?? 60;
    let best = nth;
    let bestAfter = 0;
    if (nth >= n) {
      // Past the seeding round, a chunk goes wherever it lands cheapest — and landing in a shard
      // that already holds its package is cheaper by one baseline, which is what keeps a package
      // from being scattered across every shard and paying for itself six times.
      bestAfter = Infinity;
      for (let i = 0; i < n; i++) {
        const after = bins[i].cost + c.ms.length * suite + (bins[i].pkgs.has(c.pkg) ? 0 : suite);
        if (after < bestAfter) {
          bestAfter = after;
          best = i;
        }
      }
    } else {
      // The `n` most expensive chunks are dealt one per shard before anything is stacked. Classic
      // longest-processing-time seeding, and it is also what makes an empty shard impossible.
      bestAfter = chunkCost(c.pkg, c.ms.length);
    }
    bins[best].cost = bestAfter;
    bins[best].pkgs.add(c.pkg);
    bins[best].ms.push(...c.ms);
  });

  const order = new Map(mutations.map((m, i) => [m.id, i]));
  const dealt = bins.map((b) => b.ms.sort((x, y) => order.get(x.id) - order.get(y.id)));

  // The guard, not an assertion of the obvious. Every other check in this file exists because the
  // silent version of this bug shipped once; this one is written before it can.
  const seen = new Set(dealt.flat().map((m) => m.id));
  const total = dealt.reduce((a, s) => a + s.length, 0);
  if (total !== mutations.length || seen.size !== mutations.length) {
    throw new Error(
      `partition lost or duplicated entries: ${mutations.length} in, ${total} out across ${n} shard(s), ${seen.size} distinct. ` +
        `A shard split that is not a partition is a sweep that is green about mutations nobody ran.`,
    );
  }
  return dealt;
}

/**
 * The `timeout-minutes` on `ci.yml`'s mutation shard job, in seconds, and the fraction of it a
 * shard may reach before the `shard:` list is due for a widen.
 *
 * **The trigger is a fraction of the limit, never the limit itself** — `M131-06` wrote that rule
 * down and `ci.yml` has restated it twice. A trigger set *at* the limit says to act only once a
 * shard has already died, and a dead shard uploads no manifest, so the check would be reading an
 * absence.
 *
 * These two constants are the single source for both consumers: `SWEEP_BUDGET_MS` below, which
 * *warns* from inside the running shard, and `checkShardCost` in `verify-shards.mjs`, which *fails*
 * from the aggregate job afterwards. M148 exists because only the first of those existed, it fired
 * correctly at 25m02s on `main`, and a warning inside a job that passes is a warning nobody reads.
 *
 * `SHARD_BUDGET_SECONDS` must equal the shard job's `timeout-minutes`; `verify-shards.test.mjs`
 * asserts it, because two numbers in two files describing one limit is the drift this whole area
 * keeps producing.
 */
export const SHARD_BUDGET_SECONDS = 30 * 60;
export const RESHARD_AT = 2 / 3;

/** Estimated wall-clock seconds for a shard, for `--list`'s benefit. The same model `partition()`
 *  packs by, so a listing that looks unbalanced *is* the balance the packer achieved. */
export function shardCost(shard) {
  const groups = byPackage(shard);
  return groups.reduce((a, [pkg, ms]) => a + chunkCost(pkg, ms.length), 0);
}

// ---------------------------------------------------------------------------
// Arguments. M123 (D228): `M118-03` began life as `mutate.mjs m118 --list`, typed expecting a
// listing — `--list` was silently ignored, `m118` was taken as a scope, and the tool started
// rewriting tracked sources. An unrecognised argument is an error here, never a filter that happens
// to match nothing, and `--list` now means what it looked like it meant.
export function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = args.filter((a) => a.startsWith('-'));
  const positional = args.filter((a) => !a.startsWith('-'));
  const unknown = flags.filter((f) => f !== '--list' && !f.startsWith('--shard=') && !f.startsWith('--manifest='));
  if (unknown.length > 0) return { error: `unknown option${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')} — the options are --list, --shard=<i>/<n> and --manifest=<file>. Usage: mutate.mjs [--list] [--shard=<i>/<n>] [--manifest=<file>] [<id>|<milestone>]` };
  if (positional.length > 1) return { error: `expected at most one id or milestone, got ${positional.length}: ${positional.join(', ')}` };

  // M127. `--shard=3/6`, joined rather than spaced: `--shard 3/6` would leave `3/6` looking exactly
  // like a scope to the split above, and a mistyped shard silently becoming a scope that matches
  // nothing is the `M118-03` shape again.
  const shardFlag = flags.find((f) => f.startsWith('--shard='));
  let shard;
  if (shardFlag !== undefined) {
    const m = /^--shard=(\d+)\/(\d+)$/.exec(shardFlag);
    if (!m) return { error: `--shard wants <i>/<n>, e.g. --shard=3/6 — got ${JSON.stringify(shardFlag.slice('--shard='.length))}` };
    const [index, of] = [Number(m[1]), Number(m[2])];
    if (of < 1) return { error: `--shard=${index}/${of}: a sweep cannot be split into ${of} shards` };
    if (index < 1 || index > of) return { error: `--shard=${index}/${of}: shard numbers run 1..${of}, and ${index} is not one of them` };
    if (positional.length > 0) {
      return {
        error:
          `--shard=${index}/${of} cannot be combined with the scope "${positional[0]}". A shard is a slice of the whole ` +
          `registry, and slicing an already-scoped run would report a fraction of a fraction as if it were the sweep.`,
      };
    }
    shard = { index, of };
  }

  const manifestFlag = flags.find((f) => f.startsWith('--manifest='));
  const manifest = manifestFlag?.slice('--manifest='.length);
  if (manifestFlag !== undefined && !manifest) return { error: `--manifest wants a path, e.g. --manifest=shard-3.json` };
  if (manifest && flags.includes('--list')) {
    return {
      error:
        `--manifest cannot be combined with --list. A manifest is this tool's word that the mutations in it were ` +
        `applied and judged; --list applies nothing, so the file would attest a sweep that never ran.`,
    };
  }

  return { list: flags.includes('--list'), scope: positional[0], shard, manifest };
}

// M112. Every suite run is bounded, because until now none of them was.
//
// `pick.test.ts` waits on a spawned `tflw pick` child that never exits when it cannot reach a
// display. node:test sets no per-test timeout, `execSync` had no `timeout`, and the only bound in
// the stack was the CI job's `timeout-minutes` — the one layer that cannot say *what* hung. It
// duly killed the job after 31 minutes of silence and named nothing (run 31273904180).
//
// 10 minutes: the slowest suite is `tflw` at ~119s locally, and this repo's CI/local ratio runs
// 1.5–2.4×, so ~3–5m on a 2-core runner — 2–3× headroom. It bounds a hang; it is not a performance
// budget, and it must never be tightened toward the real suite time or it becomes one.
//
// Overridable so the guard can be watched firing — `TFLW_MUTATE_TIMEOUT_MS=500 node
// scripts/mutate.mjs bom-col` makes every suite "hang". A bound nobody has ever seen trip is a
// claim, not a control.
const SUITE_TIMEOUT_MS = Number(process.env.TFLW_MUTATE_TIMEOUT_MS ?? 10 * 60_000);
const TIMEOUT_LABEL = SUITE_TIMEOUT_MS >= 60_000 ? `${SUITE_TIMEOUT_MS / 60_000}m` : `${SUITE_TIMEOUT_MS}ms`;

// `M147e` (`M147e-01`) — and the bound above needs a *second* bound beside it, because `execSync`
// has one of its own that nobody chose. Its default `maxBuffer` is 1 MB; a suite that prints more
// than that is killed with `SIGKILL` and throws with `code: 'ENOBUFS'`. `runSuite` read the signal
// alone, so an overflow arrived here as a hang — and `M147e-4`'s demonstrated break tripped it: a
// mutation that fails a 256-deep AST snapshot prints the diff, the run reached 1 084 562 bytes, and
// a mutation that had in fact been *killed* was reported as `TIMED OUT — the suite hung`, with no
// verdict and the wrong cause named. Silent in the safe direction — it can never manufacture a
// `killed` — but a control that cannot score its own success is not a control.
//
// 64 MB matches `no-nul-bytes.test.mjs` and `removed-commands.test.mjs`, the two places in this repo
// that had already met the default. It is a buffer and not a budget: nothing is expected to approach
// it, and if anything ever does, the `ENOBUFS` branch below now says so in those words instead of
// blaming a clock.
const SUITE_MAX_BUFFER = 64 * 1024 * 1024;

// M143a (`M137g-03`, re-stated) — the sweep says how long it took, every time.
//
// `M137g-03` asked for exactly this, and gave a reason that turned out to be false: it read JOB
// totals, saw the slowest shard change identity between consecutive runs, and concluded a
// deterministic LPT bin-packer could not be producing that. The packer is fine. What moved was
// `Install Playwright browsers` — an apt stall of up to 14.5m sitting inside those totals — and the
// row's own two headline runs are one of each mechanism: `32136069351` shard 11 = 0.5m install +
// 20.0m mutation (a genuinely heavy shard), `32154411348` shard 6 = 14.1m install + 13.7m mutation
// (the stall). Five passes of archaeology went into telling those two apart. One printed line would
// have done it, which is why the row's recommendation is worth more after the measurement than
// before it.
//
// **Measured against this sweep, not against the job.** A budget on the job is not this tool's to
// know, and taking one would re-import the exact contamination that made the row's reason wrong.
//
// Twenty minutes — the same number `M131-06` (status: closed) recorded as the re-shard trigger,
// and the same on purpose: this warning firing on two consecutive runs of `main` then IS the
// condition the re-shard is deferred behind, rather than a second threshold to correlate against
// it. Calibrated on the `Mutation controls` step across 108 shard-jobs of 9 runs (2026-08-18):
// median 13.6m, p90 15.5m, max 20.1m, under a 30m `timeout-minutes`. So it sits at the observed
// ceiling, ~1.5x the median, and leaves ten minutes of notice before the job is killed.
// `M137g-03` proposed ~22m; that came off totals with a stalled apt inside them and is not what
// this is set from.
//
// Overridable for the reason `SUITE_TIMEOUT_MS` is: `TFLW_MUTATE_BUDGET_MS=1` puts any sweep over
// budget, which is how the warning gets watched firing. A bound nobody has seen trip is a claim,
// not a control.
//
// M148 (`M147-11`) — **this budget did its job and it was not enough, and the reason is worth more
// than the fix.** The comment above names the re-shard condition exactly right, and the warning
// fired exactly as designed: run 32416405841, `main`, shard 11 of 12 —
//
//     ⏱ shard 11 of 12 took 25m02s (soft budget 20m00s).
//     ⚠ OVER BUDGET by 5m02s. Nothing has failed …
//
// — and the job went green, and the next two runs lost a shard to `timeout-minutes`. So the defect
// was never a missing threshold or an unnamed condition. It is that **the only thing watching the
// condition was the job the condition is about, and that job passes.** A warning printed by a green
// job is read by nobody; "nothing has failed" is true, and it is also the sentence that makes the
// line skippable. `M131`'s rule — a deferral names a condition, not a milestone number — was
// honoured here and still failed, because naming a condition and *observing* it are two jobs.
//
// The observer is `verify-shards.mjs`, in the aggregate job, reading the timings out of the shard
// manifests. It is a different job from the one being judged, it fails rather than warns, and it
// cannot be skipped by being green. This line stays: an operator watching a single shard scroll by
// still wants it, and it is the earliest possible notice. It just is no longer the *only* notice.
//
// One number, two consumers. The threshold below is derived from the limit and the fraction rather
// than restated, because a 20 written here and a 20 computed there is the two-copies-of-one-number
// shape that this file has now been bitten by at five different sites.
const SWEEP_BUDGET_MS = Number(process.env.TFLW_MUTATE_BUDGET_MS ?? SHARD_BUDGET_SECONDS * RESHARD_AT * 1000);

/** `ms` as `13m36s` or `47s` — the shape a CI log gets read in. */
export function formatElapsed(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/**
 * What a finished sweep says about its own clock.
 *
 * Pure and exported for `M98d`'s reason — the same one that made `tallyLine` pure. The sharded,
 * over-budget form of this line is otherwise reachable only by running a shard for twenty minutes,
 * which is to say it would be asserted by nothing.
 *
 * `D573` — printed on every run, pass or fail; only crossing the budget is loud. A number that
 * appears only when something is already wrong cannot establish a baseline, and not being able to
 * establish the baseline is what cost this row five passes of guesswork.
 */
export function elapsedLine({ ms, shard, budgetMs = SWEEP_BUDGET_MS }) {
  const what = shard ? `shard ${shard.index} of ${shard.of}` : 'this sweep';
  const line = `⏱ ${what} took ${formatElapsed(ms)} (soft budget ${formatElapsed(budgetMs)}).`;
  if (ms <= budgetMs) return line;
  return (
    `${line}\n` +
    `⚠ OVER BUDGET by ${formatElapsed(ms - budgetMs)}. Nothing has failed — a sweep is judged by its exit\n` +
    `  code and not by its clock — but this budget sits at the ~20m re-shard trigger \`M131-06\`\n` +
    `  (status: closed) named, over a step whose measured median is 13.6m. Two consecutive runs of\n` +
    `  \`main\` crossing it is the condition to re-shard; one crossing is the variance this has been\n` +
    `  mistaken for before.`
  );
}

export function suiteCommand(pkg) {
  return pkg === ROOT_SUITE ? 'npm run test:scripts 2>&1' : `npm test -w ${pkg} 2>&1`;
}

/**
 * Which workspace has to be **rebuilt** before a mutation's suite can see it (`M147e`, `M147-09`).
 *
 * A workspace's own tests run from source — `@tflw/lang` is `node --import tsx --test`, and the
 * mutated `.ts` is what tsx compiles — so a mutation and its suite normally need no build between
 * them. That stops being true the moment the two are in *different* workspaces. `@tflw/lsp-server`
 * imports `@tflw/lang` by name, and `packages/lang/package.json` exports `./dist/index.js`, so a
 * mutation to `packages/lang/src/parser.ts` scored against the lsp-server suite ran the *previous*
 * build. Every such mutation therefore came back **`SURVIVED`**, which is the worst verdict this
 * file can print wrongly: a hang is a no-verdict and says so, but a false survival reads as a
 * measured statement that the assertion is weak, and the honest response to it is to weaken or
 * delete the test.
 *
 * Found by `M147e-6`, whose whole subject is an agreement between two surfaces and therefore has to
 * be scored against the *other* package's suite by construction. Confirmed by hand: the same edit,
 * with `npm run build --workspaces` in front of it, takes the lsp-server suite from `# pass 171` to
 * `# fail 1`, naming exactly the test written for the row.
 *
 * Returns `null` in the common case, so nothing is rebuilt for a mutation whose file and suite live
 * together, and the sweep does not get slower for the sake of a case it does not have.
 *
 * `nameOf` is injected so this stays pure and testable against a fixture map rather than the tree.
 */
export function rebuildTargetFor(file, pkg, nameOf) {
  const m = /^(packages\/[^/]+)\//.exec(file);
  if (!m) return null;
  const dir = m[1];
  const name = nameOf(dir);
  if (!name || name === pkg) return null;
  return name;
}

/**
 * M123 (`M123-02`) — the environment a suite must NOT inherit.
 *
 * `NODE_TEST_CONTEXT` is how `node --test` tells a child test process to speak its internal
 * serializer instead of printing a human report. It is exported into everything a test spawns, so
 * a sweep started from inside any node:test process — which is exactly what this milestone's own
 * tests do, and what a `test:scripts` mutation does — hands it straight to the suite it is
 * measuring. Measured, same command, one variable:
 *
 *     clean                        exit=0   ℹ pass 925 / ℹ fail 0    98,997 bytes
 *     NODE_TEST_CONTEXT=child-v8   exit=0   (no summary at all)         472 bytes
 *
 * **Exit 0 either way.** So every mutation would be reported `SURVIVED` and every baseline
 * `green, ? passing`, with nothing anywhere going red — the vacuous-instrument shape this file has
 * now hit three times (`M110`, `M119`, and here), and the first one that inverts the verdict rather
 * than just the stated reason.
 *
 * This is *removing* contamination, not editing the experiment (D225): the variable is never set in
 * a normal run, so deleting it restores the condition the suite is supposed to be measured under
 * rather than changing it.
 */
function suiteEnv() {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;
  return env;
}

/** `packages/<dir>` -> the workspace's declared package name, or `null` if there is no manifest. */
function workspaceName(dir) {
  try {
    return JSON.parse(readFileSync(path.join(ROOT, dir, 'package.json'), 'utf8')).name ?? null;
  } catch {
    return null;
  }
}

function runSuite(pkg, mutatedFile) {
  // `M147-09` — see `rebuildTargetFor`. Skipped entirely when the mutation and its suite share a
  // workspace, which is every mutation in the registry but one.
  const rebuild = mutatedFile ? rebuildTargetFor(mutatedFile, pkg, workspaceName) : null;
  if (rebuild) {
    try {
      execSync(`npm run build -w ${rebuild} 2>&1`, { cwd: ROOT, encoding: 'utf8', env: suiteEnv(), timeout: SUITE_TIMEOUT_MS, maxBuffer: SUITE_MAX_BUFFER });
    } catch (err) {
      // A mutation that does not compile is a *stale* mutation, not a survivor — the registry entry
      // is quoting a line the source no longer has in a form that type-checks. Reported as a red
      // suite so it lands in the kill/stale reporting rather than being silently scored.
      return { green: false, out: `building ${rebuild} for a cross-workspace mutation failed:\n${(err.stdout ?? '') + (err.stderr ?? '')}`, timedOut: false, overflowed: false };
    }
  }
  try {
    const out = execSync(suiteCommand(pkg), {
      cwd: ROOT,
      encoding: 'utf8',
      env: suiteEnv(),
      timeout: SUITE_TIMEOUT_MS,
      maxBuffer: SUITE_MAX_BUFFER,
      killSignal: 'SIGKILL',
    });
    return { green: true, out, timedOut: false, overflowed: false };
  } catch (err) {
    // A timeout is NOT a red suite, and the difference is load-bearing: the `else` below prints
    // `✓ killed … suite exited non-zero` for anything non-green, so without this flag a mutation
    // whose suite hung would be credited with killing it. That is the vacuous-control shape —
    // a control that passes because nothing ran — arrived at from the opposite direction.
    return { green: false, out: (err.stdout ?? '') + (err.stderr ?? ''), ...classifySuiteFailure(err) };
  }
}

/**
 * Why a non-green `execSync` came back — the three answers that are not "the suite went red".
 *
 * Pure and exported for the same reason `formatElapsed` and `tallyLine` are: the branch it decides
 * can only be reached by a suite that actually blows up, and a branch reachable only by catastrophe
 * is a branch nobody ever sees run. `scripts/mutate.test.mjs` calls it with the three error shapes
 * directly.
 *
 * `ENOBUFS` is tested first and separately (`M147e-01`). An output overflow is *also* delivered as
 * `SIGKILL`, so reading the signal alone folded it into the hang bucket and reported a suite that
 * ran to completion as one that never started. Same no-verdict outcome either way, but the wrong
 * cause named and the wrong fix implied — the reader goes looking for an infinite loop that is not
 * there. Found by `M147e-4`, whose demonstrated break fails a 256-deep AST snapshot: printing that
 * diff took the run to 1 084 562 bytes, eighty kilobytes past `execSync`'s 1 MB default.
 */
export function classifySuiteFailure(err) {
  const overflowed = err.code === 'ENOBUFS';
  const timedOut = !overflowed && (err.code === 'ETIMEDOUT' || err.signal === 'SIGKILL');
  return { timedOut, overflowed };
}

// M123 (`M115-01`): the summary parse moved to `scripts/reporter-summary.mjs`, shared with
// `verify-test-counts.mjs`. It had gone wrong here three times — `# fail N` only, then `ℹ fail N`
// added forty lines from the file that already documented the lesson, and finally the discovery
// that both are `^`-anchored and neither strips ANSI, so any environment exporting `FORCE_COLOR`
// silently defeats them on **any** Node. `summaryCount` returns `undefined`, not `-1`, when a suite
// printed no summary at all: "reported zero failures" and "reported nothing" are different facts,
// and the old sentinel was a number no caller ever checked for.
//
// A baseline first. A suite that is already red makes every "killed" verdict meaningless — the
// mutation would be credited with failures it did not cause. One per package actually selected, so
// running `mutate.mjs m98d` still pays for exactly one suite.
const baselined = new Set();

/**
 * What each package's baseline actually cost, in seconds — the measurement `SUITE_SECONDS` above is
 * supposed to be, taken on the machine that is paying for it. M148 (`M147-11`): the table had gone
 * 3.5× light on the root suite and nothing could tell, because a baseline's cost was observable
 * only as a timestamp in a log nobody reads. Written into the shard manifest, read back by
 * `verify-shards.mjs`, and the reason the constants can never go stale in silence again.
 */
const measuredSeconds = new Map();

/** Seconds each package's baseline took in this run, for the manifest. Only packages actually
 *  baselined appear — a shard reports what it measured, not what it guessed. */
export function baselineCosts() {
  return Object.fromEntries([...measuredSeconds].sort(([a], [b]) => a.localeCompare(b)));
}

function baseline(pkg) {
  if (baselined.has(pkg)) return 0;
  process.stdout.write(`baseline ${pkg} … `);
  const startedAt = Date.now();
  const result = runSuite(pkg);
  if (result.timedOut) {
    console.error(`\n✗ ${pkg}'s suite hung — killed after ${TIMEOUT_LABEL} without finishing. Nothing below ran. This is a hang, not a red suite: the last test to report is the one before the one to look at.`);
    return 1;
  }
  if (!result.green) {
    // M119: a count is not actionable. This aborted an unscoped sweep 26 mutations in with nothing
    // but "(1 failing)" — and the suite passed on the next three runs, so the one run that could
    // have named the test was also the only one that would ever have it. The suite's output is
    // already captured; not printing the names was pure loss.
    const unique = failedTestNames(result.out);
    const fails = summaryCount(result.out, 'fail');
    console.error(`\n✗ ${pkg} is red before any mutation (${fails ?? 'no'} failing). Fix that first — every verdict below would be borrowed from it.`);
    if (unique.length > 0) console.error(unique.map((n) => `    ✖ ${n}`).join('\n'));
    else console.error("    (no test name in the output — the suite failed outside node:test, e.g. in a guard script chained after it)");
    return 1;
  }
  // Only the green path records. A suite that went red or hung stopped early or ran long for a
  // reason that has nothing to do with what it costs when it works, and feeding either into the
  // cost table would be worse than the stale number this replaces.
  measuredSeconds.set(pkg, Math.round((Date.now() - startedAt) / 1000));
  console.log(`green, ${summaryCount(result.out, 'pass') ?? '?'} passing`);
  baselined.add(pkg);
  return 0;
}

/**
 * How a kill was actually delivered. M122 (`M122-02`): a node:test file whose test awaits an event
 * that never arrives drains the event loop, node:test cancels the rest of the file, and the run
 * reports `# fail 0` / `# cancelled 9` while still exiting non-zero. A sweep scoring exit codes
 * calls that a kill — and **no assertion ran**. The three cases are named apart here so that
 * "killed" never has to be taken on trust.
 */
function killReason(out) {
  const fails = summaryCount(out, 'fail');
  if (fails !== undefined && fails > 0) return `${fails} failing`;
  const cancelled = summaryCount(out, 'cancelled');
  if (cancelled !== undefined && cancelled > 0) {
    return `${cancelled} CANCELLED and 0 failing — the suite drained before asserting (M122-02); no assertion ran, so this is not the control it looks like`;
  }
  // M110: not every workspace's `npm test` is only node:test — `@tflw/docs-site` chains a guard
  // script after it, so a kill by that script leaves the summary reading `# fail 0`. Printing
  // "killed 0 failing" would state a measured zero where the truth is "this suite does not count
  // failures that way".
  return 'suite exited non-zero (a guard script, not a node:test assertion)';
}

/**
 * The headline a sweep ends on.
 *
 * A pure function since M127, for the reason `M98d` left behind — a control whose harness cannot
 * observe the thing it names is not a control. The shard form of this line was otherwise reachable
 * only by running a whole shard, thirteen minutes of suites, which is to say it would have been
 * asserted by nothing.
 *
 * M126 (`M125e-02`) put the M98 gap *in* the tally rather than in a paragraph under it, because a
 * number under a headline is a number nobody reads. M127 applies the same rule to the count it
 * introduces: `41 mutation(s) run; 0 survived` is a true sentence about a sixth of the sweep, and
 * reads exactly like a sentence about all of it.
 */
export function tallyLine({ ran, survived, stale, timedOut = 0, shard, registry = MUTATIONS.length, cov = coverage() }) {
  const count = shard
    ? `${ran} of ${registry} mutation(s) run — shard ${shard.index} of ${shard.of}`
    : `${ran} mutation(s) run`;
  return (
    `${count}; ${survived} survived, ${stale} stale${timedOut > 0 ? `, ${timedOut} timed out` : ''} ` +
    `— over a registry that reconstructs ${cov.reconstructed} of the M98 plan's ${cov.planned} mutations, ${cov.missing} not.`
  );
}

function sweep(selected, scope, shard) {
  const survivors = [];
  for (const m of selected) {
    const pkg = m.pkg ?? DEFAULT_PKG;
    const code = baseline(pkg);
    if (code !== 0) return code;
    const full = path.join(ROOT, m.file);
    const original = readFileSync(full, 'utf8');
    const edits = m.edits ?? [[m.find, m.replace]];
    let mutated = original;
    let stale = null;
    for (const [find, replace] of edits) {
      const occurrences = mutated.split(find).length - 1;
      if (occurrences !== 1) {
        stale = `matched ${occurrences} times, not 1`;
        break;
      }
      mutated = mutated.replace(find, replace);
    }
    if (stale) {
      // Not a survivor and not a kill — the mutation did not apply, which is its own kind of silent
      // pass. M97e's lesson: a probe that cannot run is not a probe that found nothing.
      console.log(`⚠ ${m.id} (${m.milestone}) — target ${stale}; source has drifted. NOT RUN.`);
      survivors.push({ ...m, verdict: 'stale' });
      continue;
    }
    // M110 — revert the *side effects* too, not only the edit.
    //
    // `@tflw/lang`'s `pretest` runs `docs:gen`, which regenerates SPEC.md's matcher/generator/
    // diagnostic tables from `spec-data.ts`. So the first mutation ever to target that manifest
    // (`config-directive-list`) had the suite rewrite SPEC.md from the *mutated* array, and the
    // revert below — which only knows about `m.file` — left the mutation's output sitting in a
    // tracked file. Caught by reading the diff, one commit from shipping the exact defect the
    // mutation exists to prove is fixed: a `TF022` row naming four config directives.
    //
    // Snapshotted rather than regenerated afterwards, because "run the generator again" assumes the
    // generator is the only writer, and this list is meant to hold whatever a suite touches.
    const files = { [m.file]: original };
    for (const rel of SIDE_EFFECT_FILES) files[rel] = readFileSync(path.join(ROOT, rel), 'utf8');

    // M123 — the journal goes down BEFORE the source is touched, and every file whose original this
    // run is holding goes into it, side effects included. A crash between here and the `finally`
    // used to be unrecoverable; now the next run repairs it and says so.
    if (!openJournal({ id: m.id, milestone: m.milestone, pid: process.pid, startedAt: new Date().toISOString(), files })) return 2;
    writeFileSync(full, mutated);
    try {
      const result = runSuite(pkg, m.file);
      if (result.overflowed) {
        // Distinct from the hang below on purpose (`M147e-01`): this suite *finished*, and what
        // stopped us reading its verdict was our own buffer. No verdict either way, but the reader
        // is sent to the right place.
        console.log(`✗ NO VERDICT ${m.id} (${m.milestone}) — ${pkg}'s output passed ${SUITE_MAX_BUFFER / (1024 * 1024)}MB and was truncated before a summary could be read; no verdict on: ${m.what}`);
        survivors.push({ ...m, verdict: 'timeout' });
      } else if (result.timedOut) {
        // Not a kill and not a survival — the suite never reached a verdict, so neither has this
        // mutation. Counted against the run so a hang can never leave the sweep exiting 0.
        console.log(`✗ TIMED OUT ${m.id} (${m.milestone}) — ${pkg}'s suite hung; no verdict on: ${m.what}`);
        survivors.push({ ...m, verdict: 'timeout' });
      } else if (result.green && m.equivalent) {
        console.log(`· no-op     ${m.id} (${m.milestone}) — ${m.what}; survives because it changes nothing`);
      } else if (result.green) {
        console.log(`✗ SURVIVED  ${m.id} (${m.milestone}) — ${m.what}`);
        survivors.push({ ...m, verdict: 'survived' });
      } else if (m.equivalent) {
        // The claim above was that this edit is behaviourally equivalent. A kill disproves it, and a
        // disproved claim in a comment is worse than none — it reads as measured.
        console.log(`✗ NOT A NO-OP  ${m.id} (${m.milestone}) — killed ${summaryCount(result.out, 'fail') ?? 0} test(s); its \`equivalent\` claim is wrong`);
        survivors.push({ ...m, verdict: 'mislabelled' });
      } else {
        console.log(`✓ killed    ${m.id} (${m.milestone}) — ${killReason(result.out)}`);
      }
    } finally {
      // D227 — restore, then read it back. A silent restore failure is the same defect this whole
      // mechanism exists to prevent, reached from the inside.
      const { problems } = applyJournal({ files });
      if (problems.length > 0) {
        console.error(`✗ could not put the source back after ${m.id}:`);
        for (const p of problems) console.error(`    ${p}`);
        console.error(`  The journal at ${journalPath()} is being left in place so the next run can retry.`);
        // Deliberately not cleared: the journal is the only remaining record of the original.
        inFlight = null;
      } else {
        closeJournal();
      }
    }
  }

  const timedOut = survivors.filter((s) => s.verdict === 'timeout').length;

  // M126 (`M125e-02`). The gap is part of the tally, not a paragraph under it. It used to print
  // below the headline and only when the run was unscoped — so `node scripts/mutate.mjs m98c`, the
  // scope these groups actually belong to, reported a clean number and disclosed nothing. Three
  // findings on this board now share the shape *read the line under the headline*; the fix for the
  // third is to stop having a line under the headline.
  console.log(
    `\n${tallyLine({
      ran: selected.length,
      survived: survivors.filter((s) => s.verdict === 'survived').length,
      stale: survivors.filter((s) => s.verdict === 'stale').length,
      timedOut,
      shard,
    })}`,
  );
  if (shard) {
    console.log(
      `  This shard is not the sweep. The other ${shard.of - 1} run elsewhere, and only \`verify-shards.mjs\` over all ${shard.of} manifests\n` +
        `  can say the registry was covered.`,
    );
  }

  // Itemised for the scope in hand: everything when unscoped, that milestone's own gap when not.
  // A scope with nothing missing says so rather than staying quiet, because silence here is what
  // reads as coverage.
  const relevant = scope ? UNRECONSTRUCTED.filter((u) => u.milestone === scope) : UNRECONSTRUCTED;
  if (relevant.length > 0) {
    const n = relevant.reduce((a, u) => a + u.count, 0);
    console.log(`\n${n} of the plan's mutations are NOT reconstructed here${scope ? ` in \`${scope}\`` : ''}:`);
    for (const u of relevant) console.log(`    ${u.milestone}: ${u.what}`);
  } else if (scope && scope in M98_PLAN) {
    console.log(`\nNothing from the M98 plan is missing in \`${scope}\` — all ${M98_PLAN[scope]} of its mutations are reconstructed.`);
  }
  return survivors.length > 0 ? 1 : 0;
}

function main(argv = process.argv) {
  const problem = registryProblem() ?? coverageProblem() ?? costProblem();
  if (problem) {
    console.error(problem);
    return 2;
  }

  const { error, list, scope, shard, manifest } = parseArgs(argv);
  if (error) {
    console.error(error);
    return 2;
  }

  let selected = MUTATIONS.filter((m) => !scope || m.id === scope || m.milestone === scope);
  if (selected.length === 0) {
    console.error(`no mutation matches "${scope}" — ids: ${MUTATIONS.map((m) => m.id).join(', ')}`);
    return 2;
  }

  // The repair runs before everything, `--list` included: a stale journal means a source file on
  // disk is still wrong, and there is no mode of this tool in which leaving it that way is right.
  const repair = repairStaleJournal();
  if (repair !== 0) return repair;

  if (shard) {
    if (shard.of > selected.length) {
      console.error(`✗ ${shard.of} shards over ${selected.length} mutation(s) would leave some shard with nothing to run,`);
      console.error(`  and a shard that runs nothing still exits 0. Use at most ${selected.length}.`);
      return 2;
    }
    selected = partition(selected, shard.of)[shard.index - 1];
    // Unreachable while `partition` holds — which is the point of checking anyway. The one thing
    // this tool must never do is report a clean run over an empty selection (M127).
    if (selected.length === 0) {
      console.error(`✗ shard ${shard.index}/${shard.of} came out empty. Refusing to exit 0 over zero mutations.`);
      return 2;
    }
    console.log(`shard ${shard.index} of ${shard.of} — ${selected.length} of ${MUTATIONS.length} mutation(s), ~${Math.round(shardCost(selected) / 60)}m of suite time\n`);
  }

  // `--list` applies nothing. It exists because `M118-03` was opened by someone typing exactly this
  // and getting a sweep instead (D228).
  if (list) {
    for (const m of selected) console.log(`${m.id}\t${m.milestone}\t${m.pkg ?? DEFAULT_PKG}\t${m.file}\n    ${m.what}`);
    console.log(`\n${selected.length} mutation(s) listed; no mutation was applied and no suite was run.`);
    return 0;
  }

  // M123 (`M111-02`) — say out loud that tracked sources are about to be deliberately wrong. The
  // row's worked example is a commit made during exactly this window: `M111`'s `1cdefdc` captured a
  // mutated `cli.ts`, and the only tell was a `git status` whose diff ran the wrong way. The window
  // cannot be removed — the suite has to run against the real tree — so what changes here is that
  // it is announced, journalled, and refused by the root `npm test` while it is open.
  console.log(`⚠ ${selected.length} mutation(s) will be applied to tracked sources in this worktree, one at a time.`);
  console.log(`  Do not commit or stage from this tree until the run finishes; \`git status\` will show a modified`);
  console.log(`  source file for as long as each suite takes, and that modification is not yours.\n`);

  // D223 — Ctrl-C is the normal way to abandon a 20-minute sweep, so the common case self-repairs
  // rather than waiting for the next run to notice the journal.
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      if (inFlight) {
        const { restored, problems } = applyJournal(inFlight);
        for (const rel of restored) console.log(`\n↺ ${sig} — restored ${rel} (\`${inFlight.id}\` was applied)`);
        for (const p of problems) console.error(`\n✗ ${sig} — could not restore: ${p}; the journal at ${journalPath()} still holds the original`);
        if (problems.length === 0) closeJournal();
      }
      process.exit(130);
    });
  }

  const sweepStartedAt = Date.now();
  try {
    return sweep(selected, scope, shard);
  } finally {
    // `D573` — unconditional, and in the `finally` so it covers the paths that end a sweep early
    // too. A red baseline aborts the run from inside the loop, which is how a shard could burn
    // twenty minutes and leave no record of having burned them.
    console.log(`\n${elapsedLine({ ms: Date.now() - sweepStartedAt, shard })}`);

    // In a `finally` because a shard that finds a survivor still has to say what it ran: the job
    // fails on the exit code, and `verify-shards.mjs` must still be able to tell "this shard ran and
    // found something" apart from "this shard never ran", which are the same missing file otherwise.
    if (manifest) {
      writeFileSync(
        manifest,
        // M148 (`M147-11`) — `modelledSeconds` and `actualSeconds` are what turn `ci.yml`'s
        // re-shard trigger from a paragraph into a check. The trigger has been written down since
        // M127 and restated at M136a; it fired at 25m on `8fe3e66` and nobody was looking, and the
        // next run lost a shard to the 30-minute limit. A number a job writes down is a number a
        // later job can fail on. `costs` is the same idea one level down: the per-package
        // measurement that says whether `SUITE_SECONDS` is still telling the truth.
        `${JSON.stringify(
          {
            shard: shard?.index ?? 1,
            of: shard?.of ?? 1,
            registry: MUTATIONS.length,
            modelledSeconds: Math.round(shardCost(selected)),
            actualSeconds: Math.round((Date.now() - sweepStartedAt) / 1000),
            costs: baselineCosts(),
            ids: selected.map((m) => m.id),
          },
          null,
          2,
        )}\n`,
      );
      console.log(`\nwrote ${manifest} — ${selected.length} id(s), the record this shard is judged complete by.`);
    }
  }
}

// D224 — the `main` guard. `M122` reproduced `M118-03` by `import()`-ing this file to read
// `MUTATIONS`; the import ran a sweep and left a deleted guard in `interpreter.ts`. The response at
// the time was a rule written into the ledger header — *never `import()` this script* — which is a
// sign next to a landmine, in a file the next session may not read. Importing it now runs nothing,
// which is also what makes this file testable at all and what lets it be a mutation target of
// itself (D226).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
