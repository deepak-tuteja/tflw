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
// **Coverage, stated rather than implied.** Counted from `MUTATIONS` on 2026-08-09 by parsing the
// array, not from memory: **48 entries — 20 from the M98 plan (m98b 5, m98c 12, m98d 3), 8 from
// M106, 1 from M107, 1 from M107b, 1 from M108, 3 from M109, 2 from M110, 2 from M110b, 7 from
// M111, 3 from M114.** The 2026-08-08 line this replaces said 42 and omitted `m107b` from its own
// breakdown, so it was short by one on the day it was written and by six by the time CI read it.
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

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LEXER = 'packages/lang/src/lexer.ts';
const PARSER = 'packages/lang/src/parser.ts';
const DIAG = 'packages/lang/src/diagnostic.ts';
const INTERP = 'packages/runtime/src/interpreter.ts';
const CHECKER = 'packages/lang/src/checker.ts';
const SPEC_DATA = 'packages/lang/src/spec-data.ts';

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
const MUTATIONS = [
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
    find: "        if (!env.api && node['service'] === null) diags.push(missingBaseUrl('api', 'api', node as unknown as { span: Span }, env));",
    replace: "        if (!env.api) diags.push(missingBaseUrl('api', 'api', node as unknown as { span: Span }, env));",
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

const arg = process.argv[2];
const selected = MUTATIONS.filter((m) => !arg || m.id === arg || m.milestone === arg);
if (selected.length === 0) {
  console.error(`no mutation matches "${arg}" — ids: ${MUTATIONS.map((m) => m.id).join(', ')}`);
  process.exit(2);
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

function runSuite(pkg) {
  try {
    const out = execSync(`npm test -w ${pkg} 2>&1`, {
      cwd: ROOT,
      encoding: 'utf8',
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

const failCount = (out) => Number(/^# fail (\d+)$/m.exec(out)?.[1] ?? -1);

// A baseline first. A suite that is already red makes every "killed" verdict meaningless — the
// mutation would be credited with failures it did not cause. One per package actually selected, so
// running `mutate.mjs m98d` still pays for exactly one suite.
const baselined = new Set();
function baseline(pkg) {
  if (baselined.has(pkg)) return;
  process.stdout.write(`baseline ${pkg} … `);
  const result = runSuite(pkg);
  if (result.timedOut) {
    console.error(`\n✗ ${pkg}'s suite hung — killed after ${TIMEOUT_LABEL} without finishing. Nothing below ran. This is a hang, not a red suite: the last test to report is the one before the one to look at.`);
    process.exit(1);
  }
  if (!result.green) {
    console.error(`\n✗ ${pkg} is red before any mutation (${failCount(result.out)} failing). Fix that first — every verdict below would be borrowed from it.`);
    process.exit(1);
  }
  console.log(`green, ${/^# pass (\d+)$/m.exec(result.out)?.[1] ?? '?'} passing`);
  baselined.add(pkg);
}

const survivors = [];
for (const m of selected) {
  const pkg = m.pkg ?? DEFAULT_PKG;
  baseline(pkg);
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
  const sideEffects = SIDE_EFFECT_FILES.map((rel) => [path.join(ROOT, rel), readFileSync(path.join(ROOT, rel), 'utf8')]);
  writeFileSync(full, mutated);
  try {
    const result = runSuite(pkg);
    const fails = failCount(result.out);
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
      console.log(`✗ NOT A NO-OP  ${m.id} (${m.milestone}) — killed ${fails} test(s); its \`equivalent\` claim is wrong`);
      survivors.push({ ...m, verdict: 'mislabelled' });
    } else {
      // M110: `# fail N` is node:test's summary, and not every workspace's `npm test` is only
      // node:test — `@tflw/docs-site` chains a guard script after it, so a kill by that script
      // leaves the summary reading `# fail 0`. Printing "killed 0 failing" would state a measured
      // zero where the truth is "this suite does not count failures that way".
      console.log(`✓ killed    ${m.id} (${m.milestone}) — ${fails > 0 ? `${fails} failing` : 'suite exited non-zero (a guard script, not a node:test assertion)'}`);
    }
  } finally {
    writeFileSync(full, original);
    for (const [abs, before] of sideEffects) if (readFileSync(abs, 'utf8') !== before) writeFileSync(abs, before);
  }
}

const timedOut = survivors.filter((s) => s.verdict === 'timeout').length;
console.log(`\n${selected.length} mutation(s) run; ${survivors.filter((s) => s.verdict === 'survived').length} survived, ${survivors.filter((s) => s.verdict === 'stale').length} stale${timedOut > 0 ? `, ${timedOut} timed out` : ''}.`);
if (!arg) {
  console.log(`\n${UNRECONSTRUCTED.length} group(s) from the plan's 31 are NOT reconstructed here:`);
  for (const [ms, what] of UNRECONSTRUCTED) console.log(`    ${ms}: ${what}`);
}
process.exit(survivors.length > 0 ? 1 : 0);
