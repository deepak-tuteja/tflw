#!/usr/bin/env node
// A test that names a diagnostic code its harness can never produce is a passing test of nothing.
//
// M98d found two of these by mutation: `bomCol` and the `\u` recovery both survived a deliberate
// break because the tests asserted `diags()` — which is `lex(src).diagnostics`, lexer-only —
// against `TF016` (a *parser* code) and `TF030` (a *checker* code). Neither assertion could ever
// have failed, in any state of the code. M98c had shipped the same class one milestone earlier in a
// different disguise (a control that checked clean source stays clean, for a rule that only runs
// after every other branch declines). Mutation testing is how both were caught, which means the
// cost of catching one is a full suite run per mutation, and the coverage is whatever set of
// mutations somebody thought to write.
//
// This is the same question asked statically, over every test at once: for each test that mentions
// a `TF0xx` code, can the pipeline that test actually invokes emit that code at all?
//
// **Why every finding is real, and why they are all negative assertions.** If a test asserted a
// code is *present* through a harness that cannot emit it, the test would be red — it could not be
// sitting in a green tree. So every mismatch this scan can find is an assertion that the code is
// *absent*, or a filter-then-count-zero, which is exactly the vacuous shape. There is no
// "suspicious but fine" tier here to triage.
//
// **Measured, not asserted.** Both M98d defects were reconstructed from the pre-fix source at
// `04aa1e6` and run against this scan, along with the corrected form of one of them as a control
// for the control:
//
//   `diags(src).filter((d) => d.code === 'TF030')`      the `\u` recovery   → flagged
//   `assert.deepEqual(diags(src), [])`, TF016 in prose  `M98d-01`, the BOM  → flagged (§3b)
//   `parseSource(src).diagnostics` filtered for TF016   the shipped fix     → **not** flagged
//
// The first draft of §3b was per-test rather than per-assertion and flagged the fix as loudly as
// the bug, because the corrected test still explains `TF016` in a comment and still calls `lex()`
// for a *different* assertion. That is the same defect this file exists to catch, so it is worth
// naming: a scan that cannot tell the fix from the bug has not measured anything either.
//
// **What it does not do.** Resolution is per *stage* (lex / parse / check / …), not per function:
// a test that calls `checkValueSubjects` and names `TF044` is not flagged, because both are
// check-stage. Widening to per-function needs a real call graph, not regex, and both known defects
// were stage-level. Tests whose harness cannot be resolved at all are counted and reported rather
// than silently passed — see the coverage line at the end.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LANG_SRC = path.join(ROOT, 'packages', 'lang', 'src');

// A `.ts` file is read as text, never grepped. `checker.ts` and `cookieJar.ts` each carry a raw NUL
// byte (a Set-key separator and a comment describing one), which makes `grep` treat them as binary
// and print nothing at all without `-a` — so a grep-based version of this scan would silently skip
// the largest checker in the repo and report clean.
const read = (p) => readFileSync(p, 'utf8');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '__golden__') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Which stage emits which code — derived from source, never listed by hand.
// ---------------------------------------------------------------------------

// `Codes` (diagnostic.ts) is the only place a code string is assigned a name, and every real
// emission in the repo goes through `Codes.NAME` inside `packages/lang/src`. The `TF0xx` occurrences
// in `runtime/`, `cli/` and `lsp-server/` are all prose in comments — checked when this was written,
// and re-checked below by the stray-emitter guard.
function readCodes() {
  const src = read(path.join(LANG_SRC, 'diagnostic.ts'));
  const block = /export const Codes = \{([\s\S]*?)\} as const;/.exec(src);
  if (!block) throw new Error('could not find `export const Codes` in diagnostic.ts — this scan is derived from it');
  const byName = new Map();
  for (const m of block[1].matchAll(/(\w+):\s*'(TF\d{3})'/g)) byName.set(m[1], m[2]);
  return byName;
}

// One file, one stage. A code emitted from two files belongs to both stages, which is correct:
// `TF010` really is reachable from the lexer *and* the parser, so a lexer-only harness naming it is
// not a finding.
const FILE_STAGE = {
  'lexer.ts': 'lex',
  'parser.ts': 'parse',
  'checker.ts': 'check',
  'conformance.ts': 'conformance',
  'reuse.ts': 'reuse',
  'migrate.ts': 'migrate',
  'completion.ts': 'completion',
};

function readEmitters(codesByName) {
  const stagesByCode = new Map();
  const unmapped = [];
  for (const file of readdirSync(LANG_SRC)) {
    if (!file.endsWith('.ts')) continue;
    const stage = FILE_STAGE[file];
    const src = read(path.join(LANG_SRC, file));
    const used = new Set([...src.matchAll(/\bCodes\.([A-Z_]+)\b/g)].map((m) => m[1]));
    if (used.size === 0) continue;
    if (!stage) {
      // A new emitting file added to `packages/lang/src` without a row above would silently widen
      // every harness's observable set to "unknown", i.e. flag nothing. Fail loudly instead.
      unmapped.push(`${file} (emits ${[...used].join(', ')})`);
      continue;
    }
    for (const name of used) {
      const code = codesByName.get(name);
      if (!code) continue; // `Codes.X` that isn't in the table is diagnosticsCoverage.test.ts' job
      if (!stagesByCode.has(code)) stagesByCode.set(code, new Set());
      stagesByCode.get(code).add(stage);
    }
  }
  return { stagesByCode, unmapped };
}

// ---------------------------------------------------------------------------
// 2. Which stages a harness can observe — also derived, from what each src file exports.
// ---------------------------------------------------------------------------

function readEntryPoints() {
  const entry = new Map();
  for (const file of readdirSync(LANG_SRC)) {
    if (!file.endsWith('.ts')) continue;
    const stage = FILE_STAGE[file];
    if (!stage) continue;
    const src = read(path.join(LANG_SRC, file));
    for (const m of src.matchAll(/^export (?:async )?function (\w+)/gm)) entry.set(m[1], new Set([stage]));
  }
  // The two compositions in index.ts, which no per-file rule can derive: each concatenates the
  // diagnostics of several stages into one array, so a test reading their result observes all of
  // them. Read off `parseSource`/`parseConfigSource` in index.ts.
  entry.set('lex', new Set(['lex']));
  entry.set('parseTokens', new Set(['parse']));
  entry.set('parseConfigTokens', new Set(['parse']));
  entry.set('parseSource', new Set(['lex', 'parse']));
  entry.set('parseConfigSource', new Set(['lex', 'parse', 'check']));
  return entry;
}

// ---------------------------------------------------------------------------
// 3. Reading the test files.
// ---------------------------------------------------------------------------

/** Blank out comments and string/template/regex bodies so brace- and call-scanning see only code.
 *  With `keepStrings`, only comments go — used to read code names out of real string literals
 *  without reading them out of prose. Positions are preserved (same length out as in) so offsets
 *  stay usable against the original.
 *
 *  Both passes matter, and the first draft of this scan had only the first: reading `TF0xx` out of
 *  raw source flagged five tests, and **all five were prose** — four comments explaining what a
 *  diagnostic used to say, and one test title. A scan whose every finding is a false positive is
 *  the same failure it exists to catch, one level up. */
function blankLiterals(src, keepStrings = false) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  // A `/` is a regex only where a value may start. Anything else is division.
  const regexAllowedAfter = /[(,=:[!&|?{};+\-*%~^<>]/;
  let lastSignificant = '';
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      blank(i, end === -1 ? n : end);
      i = end === -1 ? n : end;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      blank(i, end === -1 ? n : end + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        j++;
      }
      if (!keepStrings) blank(i + 1, Math.min(j, n));
      i = Math.min(j + 1, n);
      lastSignificant = c;
      continue;
    }
    if (c === '/' && (lastSignificant === '' || regexAllowedAfter.test(lastSignificant))) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      if (!keepStrings) blank(i + 1, Math.min(j, n));
      i = Math.min(j + 1, n);
      lastSignificant = '/';
      continue;
    }
    if (!/\s/.test(c)) lastSignificant = c;
    i++;
  }
  return out.join('');
}

/** Extent of the balanced `(...)` starting at `open` in already-blanked code. */
function matchParen(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth++;
    else if (code[i] === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return code.length - 1;
}

/** Every `test(...)`/`it(...)` call in a file, as {name, start, end, titleEnd}. */
function findTests(src, code) {
  const tests = [];
  for (const m of code.matchAll(/\b(?:test|it)(?:\.\w+)?\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const end = matchParen(code, open);
    // The title is a literal, so it survives only in the original source. Its extent is tracked so
    // a code named in the title can be excluded — a title is a label, not an assertion.
    const head = src.slice(open + 1, end);
    const title = /^\s*([`'"])((?:\\.|[^\\])*?)\1/.exec(head);
    tests.push({
      name: title ? title[2] : '(untitled)',
      start: open,
      end,
      titleSpan: title ? [title.index, title.index + title[0].length] : [0, 0],
    });
  }
  // Nested `test()` inside a `describe()` body would otherwise be counted twice; keep only the
  // innermost by dropping any test whose extent strictly contains another's.
  return tests.filter((t) => !tests.some((o) => o !== t && o.start > t.start && o.end < t.end));
}

/**
 * `M147f` (`M147-06`) — what may legally sit between an arrow function's parameter list and its
 * `=>`: nothing, or one return-type annotation.
 *
 * This replaced `arrow > closeParen + 20`, a character window. An annotation has no length limit —
 * `(source: string, imported: KnownAction[]): ReturnType<typeof checkProgram> => {` puts 36
 * characters there — so the window dropped the helper from the map entirely, and **both directions
 * were wrong**. A test calling that helper *and* a shorter one resolved to the shorter one's stages
 * alone and was reported `this assertion cannot fail`: nine such findings in
 * `importedCalls.test.ts`, all nine false, and the obvious way to silence a false `✗` is to delete
 * the code name from the test — the tool degrading the assertions it exists to protect. The quiet
 * direction is worse: a test whose *only* harness is such a helper resolves to no stage at all and
 * lands in the `reached no known pipeline entry point (not analysed)` list, which is printed and
 * does not fail. That list stood at 29 when this was found.
 *
 * Deliberately conservative rather than a parser. `;`, `{`, `}` and `=` cannot appear in a return
 * annotation but can appear in the statements a bad match would swallow, so their absence is the
 * cheap discriminator. An object-literal return type (`(): { a: number } =>`) is therefore skipped
 * — a known, silent under-match, and it is the same class of miss this replaces, just far rarer.
 * The `not analysed` list is where any such helper still surfaces.
 */
export function isReturnAnnotation(between) {
  const t = between.trim();
  if (t === '') return true;
  return t.startsWith(':') && !/[;{}=]/.test(t);
}

/** Local helper functions/arrow consts in a test file, name → body extent. */
export function findLocalHelpers(code) {
  const helpers = new Map();
  for (const m of code.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g)) {
    const open = code.indexOf('(', m.index + m[0].length - 1 - 1);
    const closeParen = matchParen(code, open);
    const brace = code.indexOf('{', closeParen);
    if (brace === -1) continue;
    let depth = 0;
    let end = brace;
    for (let i = brace; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    helpers.set(m[1], code.slice(brace, end + 1));
  }
  for (const m of code.matchAll(/(?:^|\n)\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(/g)) {
    const open = code.indexOf('(', m.index + m[0].length - 1 - 1);
    const closeParen = matchParen(code, open);
    const arrow = code.indexOf('=>', closeParen);
    if (arrow === -1 || !isReturnAnnotation(code.slice(closeParen + 1, arrow))) continue;
    // Body is either a braced block or a single expression to end of statement.
    const brace = code.slice(arrow, arrow + 10).indexOf('{');
    if (brace !== -1) {
      let depth = 0;
      const from = arrow + brace;
      for (let i = from; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') { depth--; if (depth === 0) { helpers.set(m[1], code.slice(from, i + 1)); break; } }
      }
    } else {
      const semi = code.indexOf(';', arrow);
      helpers.set(m[1], code.slice(arrow, semi === -1 ? code.length : semi));
    }
  }
  return helpers;
}

const callsIn = (chunk) => new Set([...chunk.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));

/** A test that shells out to the built CLI observes the whole pipeline at once, so no stage
 *  argument can be made about it from this file's imports. `packages/cli/test/e2e.test.ts` is
 *  entirely this — it runs `dist/cli.cjs` in a child process and asserts on stderr. */
const SUBPROCESS_CALLS = /\b(execFile|execFileSync|execSync|spawn|spawnSync|fork|runCli|runTflw)\s*\(/;

/** Where a `TF0xx` literal counts as an *assertion* rather than prose. Tests reach a code exactly
 *  three ways: comparing `d.code`, matching rendered output (`error[TF043]`, `warning[TF043]`), or
 *  naming the constant. Everything else — a comment about what a diagnostic used to say, a code in
 *  the test title, an `assert` message explaining the point — is prose that no amount of broken
 *  code can change. Prose is the majority: 5 of 5 first-draft findings were prose. */
function assertedCodes(bodyStrings, bodyCode, codesByName, titleSpan) {
  const found = new Set();
  const scan = bodyStrings.slice(0, titleSpan[0]) + ' '.repeat(titleSpan[1] - titleSpan[0]) + bodyStrings.slice(titleSpan[1]);
  for (const m of scan.matchAll(/\bTF(\d{3})\b/g)) {
    const before = scan.slice(Math.max(0, m.index - 80), m.index);
    const viaCodeField = /\bcodes?\b[^;\n]{0,80}$/i.test(before);
    const viaRendering = /(?:error|warning)\[$/.test(before);
    if (viaCodeField || viaRendering) found.add(`TF${m[1]}`);
  }
  for (const m of bodyCode.matchAll(/\bCodes\.([A-Z_]+)\b/g)) {
    const c = codesByName.get(m[1]);
    if (c) found.add(c);
  }
  return found;
}

/** Stages a chunk of test code can observe, resolving local helpers transitively. */
function observedStages(chunk, helpers, entryPoints, seen = new Set()) {
  const stages = new Set();
  for (const name of callsIn(chunk)) {
    const direct = entryPoints.get(name);
    if (direct) for (const s of direct) stages.add(s);
    else if (helpers.has(name) && !seen.has(name)) {
      seen.add(name);
      for (const s of observedStages(helpers.get(name), helpers, entryPoints, seen)) stages.add(s);
    }
  }
  return stages;
}

// ---------------------------------------------------------------------------
// 3b. The second shape: an emptiness assertion whose subject cannot produce the code.
// ---------------------------------------------------------------------------
//
// The two real M98d defects were not written the same way, and only one of them names a code in
// code. Measured against the pre-fix source at `04aa1e6`:
//
//   the `\u` recovery — `diags(src).filter((d) => d.code === 'TF030')`   → §3 catches it
//   `M98d-01`, the BOM — `assert.deepEqual(diags(src), [])`, TF016 in a comment   → §3 cannot
//
// The second is the harder and more common shape, because "this source produces no diagnostics" is
// a *legitimate* assertion — what makes it vacuous is that the diagnostic it was written to exclude
// could never have arrived. That intent lives in the comment, so the comment has to be read.
//
// Reading comments per-*test* is far too blunt: the corrected version of that very test still
// explains `TF016` in a comment and still calls `lex()` (for a column assertion), so a per-test rule
// flags the fix as loudly as the bug. Per-*assertion* separates them — the emptiness assert is fed
// by `parseSource` there, and the `lex()` call belongs to a different assertion entirely.
const EMPTINESS = /assert\.(?:deepEqual|deepStrictEqual)\s*\(|assert\.equal\s*\(/g;

/** Emptiness assertions in a test body: `deepEqual(x, [])` or `equal(x.length, 0)`. Returns the
 *  subject expression and the assertion's start offset, both relative to the body. */
function emptinessAsserts(bodyCode) {
  const out = [];
  for (const m of bodyCode.matchAll(EMPTINESS)) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(bodyCode, open);
    const args = bodyCode.slice(open + 1, close);
    // Split on the top-level comma separating actual from expected.
    let depth = 0;
    let comma = -1;
    for (let i = 0; i < args.length; i++) {
      const c = args[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') depth--;
      else if (c === ',' && depth === 0) { comma = i; break; }
    }
    if (comma === -1) continue;
    const subject = args.slice(0, comma);
    const expected = args.slice(comma + 1).trim();
    const isEmpty = /^\[\s*\]/.test(expected) || (/^0\b/.test(expected) && /\.length\s*$/.test(subject));
    if (isEmpty) out.push({ subject, at: m.index });
  }
  return out;
}

/** The comment block immediately above an offset, plus any trailing comment on the same line. */
function commentAbove(bodySrc, bodyCode, at) {
  // `bodyCode` has comments blanked, so where the two differ is exactly a comment.
  const lineStart = bodySrc.lastIndexOf('\n', at) + 1;
  let from = lineStart;
  const lines = bodySrc.slice(0, lineStart).split('\n');
  let i = lines.length - 1;
  while (i > 0 && /^\s*(\/\/|\*|\/\*)/.test(lines[i - 1])) i--;
  from = lines.slice(0, i).join('\n').length;
  return bodySrc.slice(from, bodySrc.indexOf('\n', at) === -1 ? bodySrc.length : bodySrc.indexOf('\n', at));
}

// ---------------------------------------------------------------------------
// 4. The scan.
// ---------------------------------------------------------------------------

// `M147f` (`M147-06`) — the scan is a function with a main-guard now, and `findLocalHelpers` /
// `isReturnAnnotation` are exported, so `verify-test-observability.test.mjs` can drive them without
// running a full pass over every test file in the repo. Until this milestone the tool had no tests
// of its own — unlike `verify-ledger.mjs`, which is the neighbour it is most often compared to —
// and its resolver had been quietly dropping helpers for nine milestones.
export function main() {
  const codesByName = readCodes();
  const { stagesByCode, unmapped } = readEmitters(codesByName);
  const entryPoints = readEntryPoints();

  const findings = [];
  let testsSeen = 0;
  let testsWithCodes = 0;
  let testsAnalysed = 0;
  const unresolved = [];

  const testFiles = walk(path.join(ROOT, 'packages')).filter((f) => f.endsWith('.test.ts'));

  const ALL_STAGES = new Set(Object.values(FILE_STAGE));

  for (const file of testFiles) {
    const src = read(file);
    const code = blankLiterals(src);
    const strings = blankLiterals(src, true); // comments gone, string and regex bodies kept
    const helpers = findLocalHelpers(code);
    const rel = path.relative(ROOT, file);

    for (const t of findTests(src, code)) {
      testsSeen++;
      const bodyStrings = strings.slice(t.start, t.end + 1);
      const bodyCode = code.slice(t.start, t.end + 1);

      const named = assertedCodes(bodyStrings, bodyCode, codesByName, t.titleSpan);
      if (named.size === 0) continue;
      testsWithCodes++;

      const stages = SUBPROCESS_CALLS.test(bodyCode)
        ? new Set(ALL_STAGES)
        : observedStages(bodyCode, helpers, entryPoints);
      if (stages.size === 0) {
        unresolved.push(`${rel} — ${t.name}`);
        continue;
      }
      testsAnalysed++;

      for (const c of [...named].sort()) {
        const emitters = stagesByCode.get(c);
        if (!emitters) continue; // an unassigned code named in prose; diagnosticsCoverage owns that
        if ([...emitters].some((s) => stages.has(s))) continue;
        findings.push({
          file: rel,
          test: t.name,
          code: c,
          emittedBy: [...emitters].sort().join(', '),
          observes: [...stages].sort().join(', '),
          shape: 'the code is named in the assertion',
        });
      }
    }

    // Shape 2 — per emptiness assertion, not per test.
    for (const t of findTests(src, code)) {
      const bodySrc = src.slice(t.start, t.end + 1);
      const bodyCode = code.slice(t.start, t.end + 1);
      if (SUBPROCESS_CALLS.test(bodyCode)) continue;

      for (const a of emptinessAsserts(bodyCode)) {
        const stages = observedStages(a.subject, helpers, entryPoints);
        if (stages.size === 0) continue;
        const prose = commentAbove(bodySrc, bodyCode, a.at);
        const claimed = new Set([...prose.matchAll(/\bTF(\d{3})\b/g)].map((m) => `TF${m[1]}`));
        for (const c of [...claimed].sort()) {
          const emitters = stagesByCode.get(c);
          if (!emitters) continue;
          if ([...emitters].some((s) => stages.has(s))) continue;
          findings.push({
            file: rel,
            test: t.name,
            code: c,
            emittedBy: [...emitters].sort().join(', '),
            observes: [...stages].sort().join(', '),
            shape: 'the assertion excludes nothing — the code it was written against is named only in the comment above it',
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Report.
  // ---------------------------------------------------------------------------

  if (unmapped.length > 0) {
    console.error('✗ a file in packages/lang/src emits diagnostics but has no stage in FILE_STAGE:');
    for (const u of unmapped) console.error(`    ${u}`);
    console.error('  Without a stage it contributes nothing, so every harness silently looks wider than it is.\n');
  }

  for (const f of findings) {
    console.error(`✗ ${f.file}`);
    console.error(`    test:      ${f.test}`);
    console.error(`    names:     ${f.code}, emitted only by the ${f.emittedBy} stage`);
    console.error(`    observes:  ${f.observes}`);
    console.error(`    shape:     ${f.shape}`);
    console.error(`    → this assertion cannot fail: the harness never produces ${f.code} in any state of the code.\n`);
  }

  console.log(
    `Scanned ${testFiles.length} test files, ${testsSeen} tests; ` +
      `${testsWithCodes} name a TF code, ${testsAnalysed} of those resolve to a harness.`,
  );
  if (unresolved.length > 0) {
    // Reported, not swallowed: these are tests naming a code where no known entry point was reached,
    // so the scan has nothing to compare against. Usually a renderer or manifest test.
    console.log(`${unresolved.length} named a code but reached no known pipeline entry point (not analysed):`);
    for (const u of unresolved) console.log(`    ${u}`);
  }

  if (findings.length > 0 || unmapped.length > 0) {
    console.error(`\n${findings.length} vacuous code assertion(s).`);
    return 1;
  }

  console.log('\nEvery TF code named in a test is reachable from the pipeline that test invokes.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
