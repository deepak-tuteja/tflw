// The printer's gate — `M200` `A0-1` (`D1046` as amended, `D1048`).
//
// WHY THIS IS PER NODE AND NOT PER FILE. `D1046` originally named a whole-file round trip,
// `format(print(parse(src))) === format(src)`, over the corpus. The census in
// PLAN_M200_UI_AUTHORING.md §1 measured what that would actually examine: **zero of 652 files**,
// and it stays zero until roughly the twentieth most common node type, because the four
// commonest node types are `StringLit`, `Matcher`, `ExpectStmt` and `Field` — so every file in
// the corpus carries assertion and literal machinery whatever it is for, and the median file
// carries twelve distinct node types. A gate whose loop skips its entire input and reports
// success is the failure this repository keeps a ledger for (`M141`, `M168`). So the property is
// asked of each node instead: print it, wrap it in the smallest source that can hold it,
// re-parse, and compare the two trees with spans stripped.
//
// IT COMPARES TREES, NOT BYTES, AND THAT IS THE POINT. The printer may legitimately write `2m`
// where the file said `120s`, or `to 50 for 30s` where the file said `hold 50 for 30s` — the
// workload nodes store bare milliseconds and a `mode`, so both spellings parse to the identical
// node and nothing has been lost. A byte comparison would fail on a difference with no meaning;
// a tree comparison fails exactly when a field is dropped, which is the defect that matters,
// because a printer that silently drops a field emits source that still parses, still runs and
// still passes while testing something the author never asked for.
//
// IT REPORTS ITS OWN COVERAGE. Every run prints how many nodes of each kind it checked and how
// many it refused. A run that checks nothing fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSource, print, PRINTABLE, CONTEXT_BOUND, format } from '../src/index.js';
import type { Node, Program, TestDecl, Value } from '../src/index.js';
import { SYNTHETIC } from '../src/build.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const siblingRoot = resolve(repoRoot, '..', 'testFlow-tests');

/** Directories that hold copies rather than sources: pulled run artefacts and scratch. */
const SKIP_DIR = /^(node_modules|dist|\.git|runs|coverage)$|^\.m.*-scratch$/;

function corpus(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      if (SKIP_DIR.test(entry)) continue;
      const p = join(dir, entry);
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (entry.endsWith('.tflw')) out.push(p);
    }
  };
  walk(root);
  return out;
}

/** The compare primitive `migrate.test.ts` already uses for "these two sources mean the same". */
function stripSpans(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripSpans);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'span') continue;
      out[k] = stripSpans(v);
    }
    return out;
  }
  return node;
}

/**
 * The kinds asked directly. Every other printable kind — `Matcher`, `StatusSubject`, `PathExpr`,
 * `ApiHeader`, the five literals — is a child of one of these and is compared transitively,
 * because the comparison is deep: a field dropped inside a nested `StringLit` reddens its
 * parent's assertion. Listing them here as well would test the same bytes twice through a
 * flimsier wrapper.
 */
const WORKLOADS = [
  'RampUsersWorkload', 'RampRpsWorkload', 'HoldUsersWorkload', 'HoldRpsWorkload',
  'StepUsersWorkload', 'StepRpsWorkload', 'SpikeUsersWorkload', 'SpikeRpsWorkload',
  'SharedIterationsWorkload', 'PerVuIterationsWorkload',
] as const;
const ASKED = new Set<string>(['TestDecl', 'ApiStep', 'ExpectStmt', 'PauseStmt', 'ThresholdDecl', 'LetStmt', ...WORKLOADS]);

/** Wrap printed text in the smallest source that can hold it, and say where to find it again. */
function reparse(node: Node, text: string): Node | null {
  if (node.type === 'TestDecl') {
    const program = parseSource(wrap(node, text)).program;
    return program.tests.length === 1 ? program.tests[0]! : null;
  }
  const program = parseSource(wrap(node, text)).program;
  const host: TestDecl | undefined = program.tests[0];
  if (!host) return null;
  if (WORKLOADS.includes(node.type as (typeof WORKLOADS)[number])) return host.workload;
  if (node.type === 'ThresholdDecl') return host.thresholds.length === 1 ? host.thresholds[0]! : null;
  return host.body.length === 1 ? host.body[0]! : null;
}

function collect(program: Program): Node[] {
  const found: Node[] = [];
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) { for (const x of n) visit(x); return; }
    if (!n || typeof n !== 'object') return;
    const node = n as Node & Record<string, unknown>;
    if (typeof node.type === 'string' && node.span && ASKED.has(node.type)) found.push(node);
    for (const [k, v] of Object.entries(node)) { if (k !== 'span') visit(v); }
  };
  visit(program);
  return found;
}

interface Tally { checked: number; refused: number; }

/** The source the gate re-parses a printed node from — also what the format-fixpoint claim below
 *  formats, so the two claims are made about the same bytes. */
function wrap(node: Node, text: string): string {
  return node.type === 'TestDecl' ? text + '\n' : `test "wrapper"\n${text}\n`;
}

test('every printable node in the corpus re-parses to the node it was printed from', () => {
  const files = [...corpus(repoRoot), ...corpus(siblingRoot)];
  assert.ok(files.length > 100, `expected the corpus, found ${files.length} files`);

  const tally = new Map<string, Tally>();
  const refusals = new Map<string, number>();
  const mismatches: string[] = [];
  const unstable: string[] = [];
  let filesRead = 0;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const { program, diagnostics } = parseSource(source);
    // A file the parser itself rejects holds recovery nodes, not authored ones.
    if (diagnostics.some((d) => d.severity === 'error')) continue;
    filesRead += 1;

    for (const node of collect(program)) {
      const t = tally.get(node.type) ?? { checked: 0, refused: 0 };
      tally.set(node.type, t);
      const printed = print(node, { indent: node.type === 'TestDecl' ? 0 : 1 });
      if (!printed.ok) {
        t.refused += 1;
        const reason = printed.reason ?? 'unknown';
        refusals.set(reason, (refusals.get(reason) ?? 0) + 1);
        continue;
      }
      const back = reparse(node, printed.text);
      if (!back) {
        mismatches.push(`${file}: ${node.type} printed as\n${printed.text}\n  …which did not re-parse to one node`);
        continue;
      }
      try {
        assert.deepEqual(stripSpans(back), stripSpans(node));
        t.checked += 1;
      } catch {
        mismatches.push(`${file}: ${node.type} printed as\n${printed.text}\n  …which re-parsed to a different node`);
        continue;
      }
      // AND IT HAS TO BE WHAT `format` WOULD ALREADY HAVE WRITTEN, over the whole corpus rather
      // than over one example. Every write path runs `format()` over the spliced result and
      // `insertIntoSource` refuses rather than corrects when that is not a fixpoint, so a printer
      // whose house style differs from the formatter's makes every insertion fail — and the tree
      // comparison above is structurally blind to it, because two spellings of the same node are
      // the same node. This is the `A0-1` tags-on-one-line finding asked as a property instead of
      // remembered as an anecdote.
      const source = wrap(node, printed.text);
      const formatted = format(source);
      if (!formatted.ok || formatted.formatted !== source) {
        unstable.push(`${file}: ${node.type} printed as\n${printed.text}\n  …which \`format\` rewrites to\n${formatted.ok ? formatted.formatted : formatted.reason}`);
      }
    }
  }

  const rows = [...tally.entries()].sort((a, b) => b[1].checked - a[1].checked);
  const total = rows.reduce((n, [, t]) => n + t.checked, 0);
  console.log(`\n  printer coverage — ${filesRead} files, ${total} nodes round-tripped\n`);
  for (const [kind, t] of rows) console.log(`    ${kind.padEnd(26)} ${String(t.checked).padStart(6)} checked  ${String(t.refused).padStart(6)} refused`);
  if (refusals.size > 0) {
    console.log('\n  refused, by reason:');
    for (const [reason, n] of [...refusals.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(6)}  ${reason}`);
  }
  console.log('');

  // A gate that examined nothing is a failed gate, not a passed one.
  assert.ok(total > 0, 'the printer round-tripped no nodes at all');
  assert.deepEqual(mismatches, [], `\n${mismatches.slice(0, 10).join('\n\n')}\n`);
  assert.deepEqual(unstable, [], `\n${unstable.slice(0, 10).join('\n\n')}\n`);
});

test('the printer refuses what it cannot print, and names the node kind', () => {
  const { program } = parseSource('test "t"\n  open "/x"\n  click button "Buy"\n');
  const step = program.tests[0]!.body[0]!;
  const r = print(step);
  assert.equal(r.ok, false);
  assert.equal(r.text, '');
  assert.match(r.reason ?? '', /OpenStmt/);
});

test('printed source is what `format` would already have written', () => {
  const { program } = parseSource(
    '@load\ntest "the catalog holds"\n  run 120 iterations across 4 users\n  api GET /search?q=g as "search"\n  expect status equals 200\n  pause 100ms\n  threshold p95 duration for "search" is less than 500ms\n  threshold error rate is less than 1%\n',
  );
  const printed = print(program.tests[0]!);
  assert.equal(printed.ok, true, printed.reason);
  assert.equal(
    printed.text + '\n',
    '@load\ntest "the catalog holds"\n  run 120 iterations across 4 users\n  api GET /search?q=g as "search"\n  expect status equals 200\n  pause 100ms\n  threshold p95 duration for "search" is less than 500ms\n  threshold error rate is less than 1%\n',
  );
  // Whatever the printer emits still has to survive the formatter unchanged, because every write
  // path runs `format()` over the spliced result.
  const formatted = format(printed.text + '\n');
  assert.equal(formatted.ok, true, formatted.reason);
  assert.equal(formatted.formatted, printed.text + '\n');
});

test('an error-rate bound comes back as the percentage that was written, not as binary floating point', () => {
  // `1%` parses to `0.01` and the printer has to multiply it back up. The first draft of this
  // test used `1% 2.9% 0.5% 10% 99.99%` and the mutation that removes the decimal correction
  // SURVIVED it — every one of those five happens to be exact under a naive `* 100`. Measured:
  // **1,007 of the first 10,000 two-decimal percentages are not**, `0.23%` the smallest. A test
  // whose inputs cannot falsify its claim is the claim going unasserted, so the breakers below
  // are listed first and by name.
  const BREAKS_NAIVELY = ['0.23%', '0.41%', '0.47%', '0.82%', '2.03%', '8.23%'];
  for (const pct of [...BREAKS_NAIVELY, '1%', '2.9%', '0.5%', '10%', '99.99%']) {
    const { program } = parseSource(`test "t"\n  run 1 iterations across 1 users\n  threshold error rate is less than ${pct}\n`);
    const printed = print(program.tests[0]!.thresholds[0]!);
    assert.equal(printed.ok, true, printed.reason);
    assert.equal(printed.text.trim(), `threshold error rate is less than ${pct}`);
  }
});

test('the support set and the switch agree', () => {
  // `PRINTABLE` is what the gate's coverage count is read against, so a kind listed there and
  // unreachable in `print` would inflate the count with nodes nobody can print.
  for (const kind of ['TestDecl', 'ApiStep', 'ExpectStmt', 'ThresholdDecl', 'PauseStmt']) {
    assert.ok(PRINTABLE.has(kind), `${kind} missing from PRINTABLE`);
  }
});

test('a stage is spelled by its block, and a bare stage refuses', () => {
  // Found by this gate's own first run against the corpus. `step` and `spike` spell the same two
  // shapes differently (`M84`, `C11`/`A2-10`) and `Stage` records only `mode`, so the node cannot
  // print itself. Each row below is a program the parser accepts; the fourth is one it does not.
  const block = (src: string) => {
    const { program, diagnostics } = parseSource(`test "t"\n${src}\n  api GET /x\n`);
    assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), [], src);
    const printed = print(program.tests[0]!.workload!, { indent: 1 });
    assert.equal(printed.ok, true, printed.reason);
    return printed.text;
  };
  assert.equal(block('  step users\n    to 50 for 10s'), '  step users\n    to 50 for 10s');
  assert.equal(block('  spike rps\n    hold 10 for 2s'), '  spike rps\n    hold 10 for 2s');
  assert.equal(block('  spike rps\n    to 120 over 1s'), '  spike rps\n    to 120 over 1s');

  // A jump prints differently in the two blocks, from an identical node.
  const jumpInStep = parseSource('test "t"\n  step rps\n    to 10 for 2s\n  api GET /x\n').program.tests[0]!.workload!;
  const jumpInSpike = parseSource('test "t"\n  spike rps\n    hold 10 for 2s\n  api GET /x\n').program.tests[0]!.workload!;
  assert.deepEqual(stripSpans((jumpInStep as { stages: unknown[] }).stages), stripSpans((jumpInSpike as { stages: unknown[] }).stages));
  assert.notEqual(print(jumpInStep).text, print(jumpInSpike).text);

  const stage = (jumpInSpike as { stages: Node[] }).stages[0]!;
  const bare = print(stage);
  assert.equal(bare.ok, false);
  assert.match(bare.reason ?? '', /cannot be printed on its own/);
  assert.ok(CONTEXT_BOUND.has('Stage'));
  assert.ok(!PRINTABLE.has('Stage'), 'a context-bound kind must not claim to be standalone-printable');
});

test('a quantified expect refuses rather than printing a path it cannot print', () => {
  // `any`/`all` only ever quantify a body path, and body subjects are `A1`'s. Printing the
  // quantifier while refusing everything it can quantify is a branch nothing can reach — the
  // printer's mutation run found it by surviving, which is what an unreachable branch does.
  const { program, diagnostics } = parseSource('test "t"\n  api GET /x\n  expect all body.id equals 1\n');
  assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), [], 'the fixture itself must parse');
  const step = program.tests[0]!.body[1]!;
  assert.equal(step.type, 'ExpectStmt');
  const r = print(step);
  assert.equal(r.ok, false);
  // Specifically the quantifier's refusal, not merely *a* refusal: the subject underneath it is
  // also unprintable, so a loose pattern passes whether or not the quantifier is ever looked at —
  // which is how the first draft of this assertion let its mutation survive.
  assert.match(r.reason ?? '', /`all` quantifier needs a body path/);
});

test('tags print on one line, which is what this corpus writes', () => {
  // Measured across both repositories: 682 tag lines, **450 of them carrying more than one tag**,
  // and none written one-per-line. The printer emitted one per line until that was counted — and
  // the corpus round-trip gate is structurally blind to it, because it compares trees and `tags`
  // is the same array whichever way the line is broken. A house-style claim needs its own test.
  const { program } = parseSource('@load @authored @slow\ntest "t"\n  api GET /x\n');
  const printed = print(program.tests[0]!);
  assert.equal(printed.ok, true, printed.reason);
  assert.equal(printed.text.split('\n')[0], '@load @authored @slow');
  assert.equal(printed.text, '@load @authored @slow\ntest "t"\n  api GET /x');
  // And an untagged test opens on its own header line, with no empty tag line above it.
  assert.equal(print(parseSource('test "t"\n  api GET /x\n').program.tests[0]!).text, 'test "t"\n  api GET /x');
});

// ---- `A1-1` — the value grammar --------------------------------------------
//
// Five positions read one `Value` union, so the union is printed once and tested once. The
// corpus gate above covers what the corpus writes (296 `let`s, reaching 27 of the 31 kinds).
// What it cannot cover is the three ways a value is *unprintable*, because none of those shapes
// occurs in 671 files — they are reachable only from a form building a tree by hand, which is
// what this printer exists for. Those get built here, by hand, for the same reason.

/** One source line per kind the value grammar has. Asserted as text rather than as a tree,
 *  because a tree comparison cannot tell `{n: 3}` from `{ n: 3 }` and the formatter can. */
const VALUE_SPELLINGS: readonly string[] = [
  'let a = "hi {name}"',
  'let a = 42',
  'let a = 1.5',
  'let a = 500ms',
  'let a = true',
  'let a = null',
  'let a = other',
  'let a = {order.items[0].id}',
  'let a = env(API_KEY)',
  'let a = {}',
  'let a = { id: 1, "user name": "x" }',
  'let a = []',
  'let a = [1, "two", { n: 3 }]',
  'let a = 1 + 2 * 3',
  'let a = -5',
  'let a = today',
  // Four of the five date-offset units are here because the corpus cannot assert them: it holds
  // **25 `days` and one `seconds`**, and that one `seconds` is the operand of `expect duration
  // is less than 2 seconds` — a subject `A1-1` still refuses. The mutation that hardcodes the
  // unit therefore SURVIVED a table whose only offset was a `days`, which is the percentage
  // finding from `A0-1` in a second costume: a fixture whose value equals the mutant's constant
  // asserts nothing.
  'let a = today + 3 days',
  'let a = today + 2 weeks',
  'let a = today - 6 hours',
  'let a = now - 30 minutes',
  'let a = now + 45 seconds',
  'let a = now - 10s',
  'let a = format {d} as "yyyy-MM-dd"',
  'let a = base64 encode("x")',
  'let a = url decode({t})',
  'let a = create order("Widget", 2)',
  'let a = unique("ord")',
  'let a = unique email',
  'let a = unique number',
  'let a = unique like "ORD-######"',
  'let a = unique uuid',
  'let a = random number 1 to 10',
  'let a = random decimal 0 to 1',
  'let a = random date in past',
  'let a = random date in future',
  'let a = random date between today - 7 days and today',
  'let a = random of "a", "b", "c"',
  'let a = random string 8',
  'let a = random like "SKU-####"',
  'let a = random uuid',
  'let a = random password',
  'let a = random password 16',
];

function step(line: string): Node {
  const { program, diagnostics } = parseSource(`test "t"\n  ${line}\n`);
  assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), [], line);
  const node = program.tests[0]?.body[0];
  assert.ok(node, line);
  return node;
}

test('every kind the value grammar has prints back as the line it was written as', () => {
  for (const line of VALUE_SPELLINGS) {
    const printed = print(step(line), { indent: 1 });
    assert.equal(printed.ok, true, `${line}: ${printed.reason ?? ''}`);
    assert.equal(printed.text, `  ${line}`, line);
  }
  // The table is the claim, so it has to actually hold every kind. 16 `Value` members and 15
  // generators; `Field` is context-bound and reached through `ObjectLit` on the row above.
  const kinds = new Set<string>();
  for (const line of VALUE_SPELLINGS) {
    const visit = (n: unknown): void => {
      if (Array.isArray(n)) { for (const x of n) visit(x); return; }
      if (!n || typeof n !== 'object') return;
      const node = n as Record<string, unknown>;
      if (typeof node.type === 'string' && PRINTABLE.has(node.type)) kinds.add(node.type);
      for (const [k, v] of Object.entries(node)) { if (k !== 'span') visit(v); }
    };
    visit((step(line) as { value: unknown }).value);
  }
  for (const kind of [
    'StringLit', 'NumberLit', 'DurationLit', 'BoolLit', 'NullLit', 'VarRef', 'Interp', 'EnvRef',
    'ObjectLit', 'ArrayLit', 'BinaryExpr', 'DateAtom', 'DateOffsetLit', 'FormatExpr',
    'TransformExpr', 'CallExpr', 'UniquePrefixExpr', 'UniqueEmailExpr', 'UniqueNumberExpr',
    'UniqueLikeExpr', 'UniqueUuidExpr', 'RandomNumberExpr', 'RandomDecimalExpr',
    'RandomDateInPastExpr', 'RandomDateInFutureExpr', 'RandomDateBetweenExpr', 'RandomOfExpr',
    'RandomStringExpr', 'RandomLikeExpr', 'RandomUuidExpr', 'RandomPasswordExpr',
  ]) {
    assert.ok(kinds.has(kind), `${kind} is in PRINTABLE but no row of VALUE_SPELLINGS contains one`);
  }
});

test('a negative literal is the unary spelling, and both spellings are the same node', () => {
  // `-x` is sugar for `0 - x` and the parser records only the result (`parser.ts:4986`), so the
  // AST cannot say which was written and the printer picks. It picks the short one — which is
  // what every negative number in a request body is — and that is safe precisely because the two
  // parse to one node.
  const unary = (step('let a = -5') as { value: unknown }).value;
  const spelled = (step('let a = 0 - 5') as { value: unknown }).value;
  assert.deepEqual(stripSpans(unary), stripSpans(spelled));
  assert.equal(print(step('let a = 0 - 5'), { indent: 1 }).text, '  let a = -5');

  // But only while the operand is an atom: `-(a * b)` printed as `-a * b` re-parses as
  // `(-a) * b`, so that shape takes the long spelling instead.
  assert.equal(print(step('let a = 0 - b * c'), { indent: 1 }).text, '  let a = 0 - b * c');
});

test('a tree this grammar has no parentheses for is refused, not approximated', () => {
  // P#25 fences arithmetic at `+ - * /` with **no parens**, so precedence is the only grouping
  // there is and a tree that disagrees with it has no source at all. The parser cannot build one
  // — `parseMulDiv` only ever takes atoms — so this is built by hand, which is exactly the case
  // a form reaches on its first day.
  const n = (raw: string, value: number): Value => ({ type: 'NumberLit', value, raw, span: SYNTHETIC });
  const sum: Value = { type: 'BinaryExpr', op: '+', left: n('1', 1), right: n('2', 2), span: SYNTHETIC };
  const product: Value = { type: 'BinaryExpr', op: '*', left: sum, right: n('3', 3), span: SYNTHETIC };
  const let_: Node = { type: 'LetStmt', name: 'a', value: product, span: SYNTHETIC } as Node;

  const refused = print(let_);
  assert.equal(refused.ok, false);
  assert.match(refused.reason ?? '', /binds too loosely/);
  assert.match(refused.reason ?? '', /no parentheses/);

  // The same refusal one level down, and this one is about associativity rather than binding
  // power: `parseAddSub` folds left, so `a - (b - c)` has no source either — printing
  // `1 - 2 - 3` would re-parse as `(1 - 2) - 3`, which is a different number.
  const nested: Node = { type: 'LetStmt', name: 'a', value: { type: 'BinaryExpr', op: '-', left: n('1', 1), right: { type: 'BinaryExpr', op: '-', left: n('2', 2), right: n('3', 3), span: SYNTHETIC }, span: SYNTHETIC }, span: SYNTHETIC } as Node;
  const rightAssoc = print(nested);
  assert.equal(rightAssoc.ok, false);
  assert.match(rightAssoc.reason ?? '', /binds too loosely/);

  // The control: the same three numbers in the shape the grammar *does* express print fine, so
  // the refusal above is about the tree and not about arithmetic.
  const ok: Node = { type: 'LetStmt', name: 'a', value: { type: 'BinaryExpr', op: '+', left: n('1', 1), right: { type: 'BinaryExpr', op: '*', left: n('2', 2), right: n('3', 3), span: SYNTHETIC }, span: SYNTHETIC }, span: SYNTHETIC } as Node;
  const printed = print(ok);
  assert.equal(printed.ok, true, printed.reason);
  assert.equal(printed.text, 'let a = 1 + 2 * 3');
});

test('a word the value grammar claims cannot be written as a reference to itself', () => {
  // `parseAtom` dispatches on the identifier before it will read one as a variable or a call
  // name, so a variable called `today` prints source that is a `DateAtom` and a call to an
  // action called `unique` prints a generator. Both are refused.
  for (const word of ['unique', 'random', 'format', 'today', 'now', 'true', 'false', 'null']) {
    const ref: Node = { type: 'LetStmt', name: 'a', value: { type: 'VarRef', name: word, span: SYNTHETIC }, span: SYNTHETIC } as Node;
    const r = print(ref);
    assert.equal(r.ok, false, `a variable called \`${word}\` should not print`);
    assert.match(r.reason ?? '', /a word the value grammar claims/);
  }
  // `env` is the exception and it goes the other way: the parser takes `env` only when a `(`
  // follows, so a *variable* called `env` round-trips and a one-argument *call* to an action of
  // that name does not.
  const envVar: Node = { type: 'LetStmt', name: 'a', value: { type: 'VarRef', name: 'env', span: SYNTHETIC }, span: SYNTHETIC } as Node;
  assert.equal(print(envVar).text, 'let a = env');
  const envCall: Node = { type: 'LetStmt', name: 'a', value: { type: 'CallExpr', name: 'env', args: [], span: SYNTHETIC }, span: SYNTHETIC } as Node;
  const r = print(envCall);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /would be read as the value grammar's own `env`/);
});

test('a generator that is still reading cannot have a sibling printed after it', () => {
  // `random of a, b` reads values until the commas stop, so it swallows whatever is printed next
  // in a comma list: `[random of 1, 2]` is ONE generator with two choices and never an array of
  // two. The tree below therefore has no source.
  const n = (v: number): Value => ({ type: 'NumberLit', value: v, raw: String(v), span: SYNTHETIC });
  const greedy: Value = { type: 'RandomOfExpr', choices: [n(1)], span: SYNTHETIC };
  const bad: Node = { type: 'LetStmt', name: 'a', value: { type: 'ArrayLit', elements: [greedy, n(2)], span: SYNTHETIC }, span: SYNTHETIC } as Node;
  const r = print(bad);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /can only be the last array element/);

  // Last is fine, and that is the control: the refusal is about the position, not the generator.
  const good: Node = { type: 'LetStmt', name: 'a', value: { type: 'ArrayLit', elements: [n(2), greedy], span: SYNTHETIC }, span: SYNTHETIC } as Node;
  const okPrint = print(good);
  assert.equal(okPrint.ok, true, okPrint.reason);
  assert.equal(okPrint.text, 'let a = [2, random of 1]');

  // `random password`'s length is optional and taken only when a value-shaped token follows
  // (`looksLikeValueStart`: a string, a number, `{` or `-`), so it absorbs a `-` and not a `+`.
  // Two operators, one tree shape, opposite verdicts — which is what makes this a rule rather
  // than a blanket refusal.
  const pw: Value = { type: 'RandomPasswordExpr', span: SYNTHETIC } as Value;
  const minus: Node = { type: 'LetStmt', name: 'a', value: { type: 'BinaryExpr', op: '-', left: pw, right: n(1), span: SYNTHETIC }, span: SYNTHETIC } as Node;
  const plus: Node = { type: 'LetStmt', name: 'a', value: { type: 'BinaryExpr', op: '+', left: pw, right: n(1), span: SYNTHETIC }, span: SYNTHETIC } as Node;
  const minusPrint = print(minus);
  assert.equal(minusPrint.ok, false);
  assert.match(minusPrint.reason ?? '', /would be swallowed into it/);
  assert.equal(print(plus).text, 'let a = random password + 1');

  // Give that same `random password` a length and it stops being the special case: the length is
  // read by the full `parseValue`, so `random password 16 + 1` makes the sum the length and BOTH
  // operators are refused. Without this row the mutation collapsing the two cases into one
  // survives, because the length-less half behaves identically under it.
  const pw16: Value = { type: 'RandomPasswordExpr', length: n(16), span: SYNTHETIC } as Value;
  for (const op of ['+', '-'] as const) {
    const withLength: Node = { type: 'LetStmt', name: 'a', value: { type: 'BinaryExpr', op, left: pw16, right: n(1), span: SYNTHETIC }, span: SYNTHETIC } as Node;
    assert.equal(print(withLength).ok, false, `random password 16 ${op} 1`);
  }

  // And a generator whose own tail is an open `parseValue` absorbs either operator, because
  // `random number 1 to 10 + 5` reads the sum as the bound.
  const rn: Value = { type: 'RandomNumberExpr', from: n(1), to: n(10), span: SYNTHETIC };
  const after: Node = { type: 'LetStmt', name: 'a', value: { type: 'BinaryExpr', op: '+', left: rn, right: n(5), span: SYNTHETIC }, span: SYNTHETIC } as Node;
  assert.equal(print(after).ok, false);

  // The comma rule has to follow the tail too, not just look at the value in hand. `x + random of
  // 1` ends in a `random of`, so as a non-final array element it swallows the element after it
  // exactly as a bare one would — and a guard that only inspects the top node misses it.
  const throughBinary: Value = { type: 'BinaryExpr', op: '+', left: { type: 'VarRef', name: 'x', span: SYNTHETIC }, right: greedy, span: SYNTHETIC };
  const hidden: Node = { type: 'LetStmt', name: 'a', value: { type: 'ArrayLit', elements: [throughBinary, n(2)], span: SYNTHETIC }, span: SYNTHETIC } as Node;
  const hiddenPrint = print(hidden);
  assert.equal(hiddenPrint.ok, false);
  assert.match(hiddenPrint.reason ?? '', /can only be the last array element/);
  // Last, it prints — the control that keeps the claim about position.
  const hiddenLast: Node = { type: 'LetStmt', name: 'a', value: { type: 'ArrayLit', elements: [n(2), throughBinary], span: SYNTHETIC }, span: SYNTHETIC } as Node;
  assert.equal(print(hiddenLast).text, 'let a = [2, x + random of 1]');
});

test('an object key is bare when it is a name and quoted when it is not', () => {
  // `parseObject` accepts an identifier or a string and stores the same `string` for both
  // (`parser.ts:5395`), so the AST cannot say which was written and the printer chooses. This is
  // the `Stage` normalisation with the opposite resolution: `Stage` refused because the two
  // spellings parse to different programs, and this one picks because they parse to one.
  const printed = print(step('let a = { id: 1, "user name": "x", "2fa": true }'), { indent: 1 });
  assert.equal(printed.ok, true, printed.reason);
  assert.equal(printed.text, '  let a = { id: 1, "user name": "x", "2fa": true }');

  // A quoted key that IS a name comes back bare — a text difference with no tree behind it.
  const quoted = step('let a = { "id": 1 }');
  assert.equal(print(quoted, { indent: 1 }).text, '  let a = { id: 1 }');
  assert.deepEqual(stripSpans(step('let a = { id: 1 }')), stripSpans(quoted));
});
