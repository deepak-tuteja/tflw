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
// **Coverage, stated rather than implied.** Counted from `MUTATIONS` on 2026-08-08, not from
// memory: **29 entries — 20 from the M98 plan (m98b 5, m98c 12, m98d 3), 8 from M106, 1 from
// M107.** Each of the 20 is one whose target could be identified unambiguously from the plan's own
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

function runSuite(pkg) {
  try {
    const out = execSync(`npm test -w ${pkg} 2>&1`, { cwd: ROOT, encoding: 'utf8' });
    return { green: true, out };
  } catch (err) {
    return { green: false, out: (err.stdout ?? '') + (err.stderr ?? '') };
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
  writeFileSync(full, mutated);
  try {
    const result = runSuite(pkg);
    const fails = failCount(result.out);
    if (result.green && m.equivalent) {
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
      console.log(`✓ killed    ${m.id} (${m.milestone}) — ${fails} failing`);
    }
  } finally {
    writeFileSync(full, original);
  }
}

console.log(`\n${selected.length} mutation(s) run; ${survivors.filter((s) => s.verdict === 'survived').length} survived, ${survivors.filter((s) => s.verdict === 'stale').length} stale.`);
if (!arg) {
  console.log(`\n${UNRECONSTRUCTED.length} group(s) from the plan's 31 are NOT reconstructed here:`);
  for (const [ms, what] of UNRECONSTRUCTED) console.log(`    ${ms}: ${what}`);
}
process.exit(survivors.length > 0 ? 1 : 0);
