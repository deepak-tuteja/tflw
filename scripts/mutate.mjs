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
// **Coverage, stated rather than implied.** Counted from `MUTATIONS` on 2026-08-10 by parsing the
// array, not from memory: **74 entries — 20 from the M98 plan (m98b 5, m98c 12, m98d 3), 8 from
// M106, 1 from M107, 1 from M107b, 1 from M108, 3 from M109, 2 from M110, 2 from M110b, 7 from
// M111, 3 from M114, 1 from M115, 6 from M116, 2 from M117, 5 from M118, 7 from M119, 2 from M120,
// 3 from M121.**
//
// The line this replaces said 48 and was written on 2026-08-09 — one day and six milestones stale,
// short by 26. That is the third time this paragraph has gone wrong (see below), and the pattern is
// now unambiguous rather than anecdotal: **every milestone that adds a mutation updates the array
// and not the prose**, because `verify:mutations` checks the array and nothing checks the sentence.
// The count is one `node -e` away — parse `/^\s*milestone: '([^']+)',/gm` over this file — so the
// only defensible way to touch this number is to re-derive it, never to add to it. Exactly the
// failure mode the ledger's own `tally:current` check exists to prevent on the other side of the
// repo, and the argument for giving this one the same treatment.
//
// Each of the 20 is one whose target could be identified unambiguously from the plan's own
// description plus the source it names; the other 11 of the plan's 31 are described at a level
// ("D159 reverted", "per-code-unit recovery") that admits more than one edit, and guessing at them
// would produce a number rather than a measurement. They are listed at the bottom of this file as
// `UNRECONSTRUCTED` so the gap is visible in the tool and not only in a commit message.
//
// Two numbers here were wrong until M107, in the one file whose whole subject is that a count
// nobody re-measures stops being true. The paragraph shipped in #28 claiming "18 of 31" over a
// `MUTATIONS` array that already held 20, and M106's 8 additions never touched it at all. Counted
// rather than recalled this time. A third does not reconcile and is left visible rather than
// rounded: 31 − 20 = 11 unreconstructed, but the five `UNRECONSTRUCTED` groups' own prose counts
// (2 + 1 + 1 + 2 + 10) sum to 16. That disagreement is in `PLAN_M98_LEXER_POSITIONS.md`'s prose,
// which is the only record of the 31, so it cannot be settled from this side.
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

// The two adjacent branches in `parsePrimary`'s number path, verbatim, so the ordering mutation is a
// swap of whole blocks rather than a hand-retyped approximation of them.
const DURATION_BRANCH = `        if (unitTok.type === 'ident' && unitTok.span.start.offset === tok.span.end.offset && (DURATION_UNITS as readonly string[]).includes(unitTok.value)) {
          this.advance();
          const ms = toMs(Number(tok.value), unitTok.value as (typeof DURATION_UNITS)[number]);
          const lit: DurationLit = { type: 'DurationLit', ms, span: { start: tok.span.start, end: unitTok.span.end } };
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

/** @type {{id: string, milestone: string, file: string, what: string, find?: string, replace?: string, edits?: [string, string][], equivalent?: boolean}[]} */
const REGISTRY = [
  // --- M98d ------------------------------------------------------------------------------------
  {
    id: 'bom-col',
    milestone: 'm98d',
    file: LEXER,
    what: 'a BOM at offset 0 counts as an indent column again (`M98d-01`)',
    find: 'const bomCol = lineStart === 0 && line[0] === BOM ? 1 : 0;',
    replace: 'const bomCol = 0;',
  },
  {
    id: 'unicode-escape-recovery',
    milestone: 'm98d',
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
    file: LEXER,
    what: 'the coalesced run is unbounded — `A1-01`\'s quadratic blow-up returns through the message',
    find: 'const MAX_RUN_CHARS = 16;',
    replace: 'const MAX_RUN_CHARS = Number.MAX_SAFE_INTEGER;',
  },
  {
    id: 'max-unexpected-unbounded',
    milestone: 'm98c',
    file: LEXER,
    what: 'the per-file diagnostic ceiling is gone (`A1-01`)',
    find: 'const MAX_UNEXPECTED_CHARS = 50;',
    replace: 'const MAX_UNEXPECTED_CHARS = Number.MAX_SAFE_INTEGER;',
  },
  {
    id: 'invisible-requoted',
    milestone: 'm98c',
    file: LEXER,
    what: 'invisible characters are quoted whole again — `unexpected character " "` for a U+00A0',
    find: 'const named = anyInvisible ? chars.map(describeChar).join(\', \') : JSON.stringify(run);',
    replace: 'const named = JSON.stringify(run);',
  },
  {
    id: 'cut-short-dropped',
    milestone: 'm98c',
    file: LEXER,
    what: 'the "name was cut short" clause is dropped, so `let café = 1` reads as two unrelated errors',
    find: "            ? `the name \\`${prev.value}\\` was cut short here — `\n            : '';",
    replace: "            ? ''\n            : '';",
  },
  {
    id: 'tab-under-tf003',
    milestone: 'm98c',
    file: LEXER,
    what: 'the tab rule goes back under `TF003`, so one code means two unrelated things again',
    find: '      Codes.TAB_INDENT,\n',
    replace: '      Codes.INCONSISTENT_INDENT,\n',
  },
  {
    id: 'duration-any-adjacent-word',
    milestone: 'm98c',
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
    file: LEXER,
    what: 'D158 as the plan first wrote it — any number followed by an ident, which is every duration',
    find: "    if (/^[eE][+-]?\\d+$/.test(suffix)) {",
    replace: "    if (suffix.length > 0) {",
  },
  {
    id: 'unknown-escape-silent',
    milestone: 'm98b',
    file: LEXER,
    what: '`TF047` goes back to silence — an unknown escape just loses its backslash (`A1-05`)',
    find: "        const decoded = ESCAPES[next];\n        if (decoded === undefined) {\n          this.diag(",
    replace: "        const decoded = ESCAPES[next];\n        if (false) {\n          this.diag(",
  },
  {
    id: 'unclosed-bracket-outermost',
    milestone: 'm98b',
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
    what: '`wait until` alone loses the diagnosis — the half of the fix that a test suite covering only `expect`/`check` would never notice was missing',
    find: '      const message = held + (await diagnoseIfNothingMatched(scope, subject.locator, name, count));',
    replace: '      const message = held;',
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
    what: '`checkHoldWindows` falls back to the documented 30s default when the caller resolved no env, reading `undefined` as an answer — the `undefined`-vs-present doctrine inverted, and *usually right*, which is what would let it ship: it only misreports in a workspace whose config raises `timeout wait`',
    find: '  if (!opts.envTimeouts) return diags;',
    replace: "  const env = opts.envTimeouts ?? { envName: 'local', wait: 30_000 };\n  if (!env) return diags;",
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
];

// Named, not silently omitted. Each is described in the plan at a granularity that admits more than
// one concrete edit; reconstructing them needs the milestone's own diff, not its prose.
const UNRECONSTRUCTED = [
  ['m98c', 'D159 reverted — the `newline` token back at the physical end of line (2 kills)'],
  ['m98c', 're-scanning for `#` instead of taking `lexContent`\'s return (1)'],
  ['m98c', 'the tab rule applied per-line rather than once per file (1)'],
  ['m98c', 'per-code-unit recovery for astral characters (2)'],
  ['m98d', '10 of the 15: the eight-position hidden-character property and its two probe additions'],
];

// ---------------------------------------------------------------------------
// THE RUNNER. Nothing below runs on `import` — see the `main` guard at the very bottom (M123, D224).

// The registry the runner works from: the mutations written here, plus the ones this tool aims at
// its own instrumentation (M123). Two files for a mechanical reason, not an organisational one —
// see `scripts/self-mutations.mjs` for why a self-targeting `find:` cannot live beside its target.
const MUTATIONS = [...REGISTRY, ...SELF_MUTATIONS];

export { MUTATIONS, UNRECONSTRUCTED };

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
// Arguments. M123 (D228): `M118-03` began life as `mutate.mjs m118 --list`, typed expecting a
// listing — `--list` was silently ignored, `m118` was taken as a scope, and the tool started
// rewriting tracked sources. An unrecognised argument is an error here, never a filter that happens
// to match nothing, and `--list` now means what it looked like it meant.
export function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = args.filter((a) => a.startsWith('-'));
  const positional = args.filter((a) => !a.startsWith('-'));
  const unknown = flags.filter((f) => f !== '--list');
  if (unknown.length > 0) return { error: `unknown option${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')} — the only option is --list. Usage: mutate.mjs [--list] [<id>|<milestone>]` };
  if (positional.length > 1) return { error: `expected at most one id or milestone, got ${positional.length}: ${positional.join(', ')}` };
  return { list: flags.includes('--list'), scope: positional[0] };
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

export function suiteCommand(pkg) {
  return pkg === ROOT_SUITE ? 'npm run test:scripts 2>&1' : `npm test -w ${pkg} 2>&1`;
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

function runSuite(pkg) {
  try {
    const out = execSync(suiteCommand(pkg), {
      cwd: ROOT,
      encoding: 'utf8',
      env: suiteEnv(),
      timeout: SUITE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    });
    return { green: true, out, timedOut: false };
  } catch (err) {
    // A timeout is NOT a red suite, and the difference is load-bearing: the `else` below prints
    // `✓ killed … suite exited non-zero` for anything non-green, so without this flag a mutation
    // whose suite hung would be credited with killing it. That is the vacuous-control shape —
    // a control that passes because nothing ran — arrived at from the opposite direction.
    const timedOut = err.code === 'ETIMEDOUT' || err.signal === 'SIGKILL';
    return { green: false, out: (err.stdout ?? '') + (err.stderr ?? ''), timedOut };
  }
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
function baseline(pkg) {
  if (baselined.has(pkg)) return 0;
  process.stdout.write(`baseline ${pkg} … `);
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

function sweep(selected, scope) {
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
      const result = runSuite(pkg);
      if (result.timedOut) {
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
  console.log(`\n${selected.length} mutation(s) run; ${survivors.filter((s) => s.verdict === 'survived').length} survived, ${survivors.filter((s) => s.verdict === 'stale').length} stale${timedOut > 0 ? `, ${timedOut} timed out` : ''}.`);
  if (!scope) {
    console.log(`\n${UNRECONSTRUCTED.length} group(s) from the plan's 31 are NOT reconstructed here:`);
    for (const [ms, what] of UNRECONSTRUCTED) console.log(`    ${ms}: ${what}`);
  }
  return survivors.length > 0 ? 1 : 0;
}

function main(argv = process.argv) {
  const problem = registryProblem();
  if (problem) {
    console.error(problem);
    return 2;
  }

  const { error, list, scope } = parseArgs(argv);
  if (error) {
    console.error(error);
    return 2;
  }

  const selected = MUTATIONS.filter((m) => !scope || m.id === scope || m.milestone === scope);
  if (selected.length === 0) {
    console.error(`no mutation matches "${scope}" — ids: ${MUTATIONS.map((m) => m.id).join(', ')}`);
    return 2;
  }

  // The repair runs before everything, `--list` included: a stale journal means a source file on
  // disk is still wrong, and there is no mode of this tool in which leaving it that way is right.
  const repair = repairStaleJournal();
  if (repair !== 0) return repair;

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

  return sweep(selected, scope);
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
