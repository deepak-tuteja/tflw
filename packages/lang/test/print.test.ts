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
import type { Node, Program, Step, Subject, TestDecl, Value } from '../src/index.js';
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
const ASKED = new Set<string>(['TestDecl', 'ApiStep', 'ExpectStmt', 'PauseStmt', 'ThresholdDecl', 'LetStmt', 'WaitUntilApiStmt', 'CaptureStmt', 'CallStmt', 'LogStmt', ...WORKLOADS]);

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
  // Narrowed rather than cast: `Workload` is a union and only some members carry `stages`, which is
  // exactly what the hand-written `{ stages: unknown[] }` shape was papering over.
  assert.equal(jumpInStep.type, 'StepRpsWorkload');
  assert.equal(jumpInSpike.type, 'SpikeRpsWorkload');
  assert.deepEqual(stripSpans(jumpInStep.stages), stripSpans(jumpInSpike.stages));
  assert.notEqual(print(jumpInStep).text, print(jumpInSpike).text);

  const stage = jumpInSpike.stages[0]!;
  const bare = print(stage);
  assert.equal(bare.ok, false);
  assert.match(bare.reason ?? '', /cannot be printed on its own/);
  assert.ok(CONTEXT_BOUND.has('Stage'));
  assert.ok(!PRINTABLE.has('Stage'), 'a context-bound kind must not claim to be standalone-printable');
});

test('a quantified expect prints its quantifier, which in `A0` it could not', () => {
  // THE SHAPE OF THIS TEST CHANGED IN `A1-3`, and the change is the record. `any`/`all` only ever
  // quantify a body path; in `A0` no body subject printed, so the branch emitting the quantifier
  // was **unreachable** — and the mutation deleting it SURVIVED, which is what an unreachable
  // branch does. It was made a refusal for exactly that reason, with a note that the refusal was
  // standing in for an assertion nobody could make yet.
  //
  // `A1-3` prints body subjects, so the branch is live and the assertion is the one it was
  // standing in for. The corpus round trip above now carries 98 quantified expects.
  for (const line of ['expect all body.id equals 1', 'check any body.items[0].price is greater than 0', 'expect any {items.price} equals 5']) {
    const printed = print(step(line), { indent: 1 });
    assert.equal(printed.ok, true, `${line}: ${printed.reason ?? ''}`);
    assert.equal(printed.text, `  ${line}`, line);
  }

  // The quantifier is not decoration: dropping it leaves a program that still parses and asserts
  // something else, which is why the mutation that removes it has to redden.
  const quantified = step('expect all body.id equals 1');
  const plain = step('expect body.id equals 1');
  assert.notDeepEqual(stripSpans(quantified), stripSpans(plain));
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

function step(line: string): Step {
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
    const let_ = step(line);
    assert.equal(let_.type, 'LetStmt');
    visit(let_.value);
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
  const unaryStmt = step('let a = -5');
  const spelledStmt = step('let a = 0 - 5');
  assert.equal(unaryStmt.type, 'LetStmt');
  assert.equal(spelledStmt.type, 'LetStmt');
  const unary = unaryStmt.value;
  const spelled = spelledStmt.value;
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

// ---- `A1-2` — the request --------------------------------------------------

/** One source per shape the request half of the grammar has. Text again, not trees, because the
 *  clause ORDER is the whole point of the first row and a tree cannot see it. */
const REQUEST_SPELLINGS: readonly string[] = [
  'api POST /orders body { itemId: 1, qty: 2 }',
  'api POST /orders body [1, 2]',
  'api POST /x body from "./payloads/order.json"',
  'api POST /x body text "not-json-data"',
  'api POST /auth/login form email=env(ADMIN_EMAIL), password=env(ADMIN_PW)',
  'api POST /x upload "../payloads/sample.png" as "image"',
  'api POST /x upload "./f.png" as "image" type "image/png" form caption="hi", n=2',
  'api root GET /health',
  'api GET /x timeout 2s',
  'api GET /x without redirects',
  'api GET /x as "checkout"',
];

test('every shape the request line has prints back as the line it was written as', () => {
  for (const line of REQUEST_SPELLINGS) {
    const printed = print(step(line), { indent: 1 });
    assert.equal(printed.ok, true, `${line}: ${printed.reason ?? ''}`);
    assert.equal(printed.text, `  ${line}`, line);
  }
});

test('the request line is spelled in the grammar’s clause order, not the AST’s field order', () => {
  // THIS IS AN `A0-1` DEFECT, found while reading `parseApiRequestLine` to scope `A1-2`.
  // `ApiRequestSpec` lists `tag` beside `path`, so the first printer emitted `as` right after the
  // path — and the parser takes `as` LAST, after `timeout` and `without redirects`. A step with a
  // tag AND a timeout therefore printed `api GET /x as "l" timeout 2s`, which does not parse at
  // all: `unexpected \`timeout\` at end of step`.
  //
  // NO GATE COULD HAVE SEEN IT. The corpus holds 10 `as` labels and 6 `timeout`s and the two sets
  // are **disjoint**, so the per-node round trip was green on every file that exists. The shape
  // below is the one a form produces the moment somebody names a request and bounds it.
  const all = 'api GET /x body { a: 1 } timeout 2s without redirects as "label"';
  const printed = print(step(all), { indent: 1 });
  assert.equal(printed.ok, true, printed.reason);
  assert.equal(printed.text, `  ${all}`);

  // And it re-parses, which is the claim the text assertion above is standing in for.
  const { diagnostics } = parseSource(`test "t"\n${printed.text}\n`);
  assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), []);
});

test('an api step’s indented block carries its headers and its retry clause', () => {
  const withHeaders = 'api GET /orders/all\n    header "Authorization" is "Bearer {t}"\n    header "Accept" is "application/json"';
  assert.equal(print(step(withHeaders), { indent: 1 }).text, `  ${withHeaders}`);
  const withRetry = 'api GET /jobs/1\n    retry honoring "Retry-After" up to 3';
  assert.equal(print(step(withRetry), { indent: 1 }).text, `  ${withRetry}`);
});

test('`wait until api` keeps its two timeouts apart', () => {
  // `timeout` is how long one poll’s request may take; `timeout wait` is the whole poll budget
  // (`ast.ts` on `WaitUntilApiStmt.waitMs`). They are different clauses on one line and folding
  // them together would silently change the program rather than the text.
  const both = 'wait until api GET /jobs/1 timeout 3s timeout wait 5m\n    header "X" is "y"\n    expect status equals 200';
  const printed = print(step(both), { indent: 1 });
  assert.equal(printed.ok, true, printed.reason);
  assert.equal(printed.text, `  ${both}`);

  const bare = 'wait until api GET /jobs/1\n    expect status equals 200';
  assert.equal(print(step(bare), { indent: 1 }).text, `  ${bare}`);
});

test('a `with each` table sits above the test it belongs to, and its columns are padded', () => {
  // The one construct whose source position is OUTSIDE the declaration that owns it: the table is
  // parsed between the tags and the `test` header, so it is emitted from `printTest` rather than
  // from the body loop.
  const table = 'with each\n  | a | bb   |\n  | 1 | "xx" |\n  | 2 | "y"  |\ntest "t"\n  api GET /x';
  const { program, diagnostics } = parseSource(`${table}\n`);
  assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), []);
  const printed = print(program.tests[0]!);
  assert.equal(printed.ok, true, printed.reason);
  // The padding is not decoration: `format` writes it, and the printer must be a fixpoint of
  // `format` or every insertion through `insertIntoSource` is refused.
  assert.equal(printed.text, table);
  const formatted = format(printed.text + '\n');
  assert.equal(formatted.formatted, printed.text + '\n');

  const fromFile = 'with each from "./data/x.csv"\ntest "t"\n  api GET /x';
  assert.equal(print(parseSource(`${fromFile}\n`).program.tests[0]!).text, fromFile);

  // Tags stay above the table, which is where `parseTest` reads them.
  const tagged = '@smoke @orders\nwith each\n  | row     |\n  | "alpha" |\ntest "t {row}"\n  api GET /x';
  assert.equal(print(parseSource(`${tagged}\n`).program.tests[0]!).text, tagged);
});

test('the request half refuses the shapes that have no source', () => {
  const sl = (v: string): Value => ({ type: 'StringLit', value: v, parts: [{ kind: 'text', value: v }], span: SYNTHETIC });
  const n = (v: number): Value => ({ type: 'NumberLit', value: v, raw: String(v), span: SYNTHETIC });

  // `form` with no fields: `parseFormFields` demands one, so `api POST /x form` is not a program.
  const emptyForm: Node = { type: 'ApiStep', service: null, method: 'POST', path: { type: 'PathExpr', raw: '/x', span: SYNTHETIC }, body: { type: 'FormBody', fields: [], span: SYNTHETIC }, headers: [], timeoutMs: null, followRedirects: true, retryAfter: null, tag: null, span: SYNTHETIC } as unknown as Node;
  const ef = print(emptyForm);
  assert.equal(ef.ok, false);
  assert.match(ef.reason ?? '', /at least one field/);

  // A form key is a bare identifier by grammar and has NO quoted spelling — unlike a JSON key,
  // which is the row above this one in `A1-1`. Same-looking field, opposite verdict.
  const badKey: Node = { type: 'ApiStep', service: null, method: 'POST', path: { type: 'PathExpr', raw: '/x', span: SYNTHETIC }, body: { type: 'FormBody', fields: [{ type: 'FormField', key: 'user name', value: sl('x'), span: SYNTHETIC }], span: SYNTHETIC }, headers: [], timeoutMs: null, followRedirects: true, retryAfter: null, tag: null, span: SYNTHETIC } as unknown as Node;
  const bk = print(badKey);
  assert.equal(bk.ok, false);
  assert.match(bk.reason ?? '', /a form key is a bare identifier/);

  // A ragged table: `parseDataTable` reports a cell-count mismatch rather than building one, so a
  // printed one would be a file the author could not have written.
  const ragged: Node = { type: 'InlineDataTable', columns: ['a', 'b'], rows: [[n(1)]], span: SYNTHETIC } as unknown as Node;
  const rg = print(ragged);
  assert.equal(rg.ok, false);
  assert.match(rg.reason ?? '', /1 cell\(s\) and the header has 2/);

  // A table with a header and no rows is `TF0..`'s EMPTY_BLOCK, and one with no columns is not a
  // table at all.
  assert.match(print({ type: 'InlineDataTable', columns: ['a'], rows: [], span: SYNTHETIC } as unknown as Node).reason ?? '', /at least one data row/);
  assert.match(print({ type: 'InlineDataTable', columns: [], rows: [], span: SYNTHETIC } as unknown as Node).reason ?? '', /at least one column/);

  // A `wait until api` with no `expect` waits for nothing: the block is where the condition lives.
  const noCondition: Node = { type: 'WaitUntilApiStmt', request: { service: null, method: 'GET', path: { type: 'PathExpr', raw: '/x', span: SYNTHETIC }, body: null, headers: [], timeoutMs: null, followRedirects: true, retryAfter: null, tag: null }, expects: [], waitMs: null, span: SYNTHETIC } as unknown as Node;
  const nc = print(noCondition);
  assert.equal(nc.ok, false);
  assert.match(nc.reason ?? '', /no condition to wait for/);
});

// ---- `A1-3` — the assertion -------------------------------------------------

/** One row per response subject and per value matcher. Text again: `is` is a copula the AST does
 *  not record, so which rows carry one is a printer decision a tree comparison cannot see. */
const ASSERTION_SPELLINGS: readonly string[] = [
  // the subjects
  'expect status equals 200',
  'expect duration is less than 500ms',
  'expect request connects',
  'expect header "content-type" contains "json"',
  'expect body.items[0].price equals 9.99',
  'expect body equals { a: 1 }',
  'expect body text contains "Not Found"',
  'expect body bytes has count 1024',
  'expect body csv[0].name equals "x"',
  'expect body pdf text contains "Invoice"',
  'expect {orderId} is greater than 0',
  // the matchers
  'expect request fails',
  'expect request fails matching "certificate"',
  'expect body.items has count 3',
  'expect body has value "x"',
  'expect body matches subset { id: 1 }',
  'expect body text matches "json"',
  'expect body matches schema "ProductDto" from "/openapi.json"',
  'expect body matches schema "ProductDto" from root "/openapi.json"',
  'expect body bytes matches file "expected.pdf"',
  // negation, softness, quantification
  'check status not equals 404',
  'expect body.name is not less than 3',
  'expect all body.id equals 1',
  'check any body.items[0].price is greater than 0',
  // the three statements that read or announce a response
  'capture body.accessToken as token',
  'capture header "X-Trace" as trace',
  'capture status as code',
  'login("a", "b")',
  'create order(env(K))',
  'log "first item is {firstId}"',
  'log warn "careful"',
  'log error "bad" to console',
];

/** A step in a test that already has an `api` step, so a response subject has something to read. */
function assertionStep(line: string): Step {
  const { program, diagnostics } = parseSource(`test "t"\n  api GET /x\n  ${line}\n`);
  assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), [], line);
  const node = program.tests[0]?.body[1];
  assert.ok(node, line);
  return node;
}

test('every response subject and value matcher prints back as the line it was written as', () => {
  for (const line of ASSERTION_SPELLINGS) {
    const printed = print(assertionStep(line), { indent: 1 });
    assert.equal(printed.ok, true, `${line}: ${printed.reason ?? ''}`);
    assert.equal(printed.text, `  ${line}`, line);
  }
});

test('a body path dots every property, including the first', () => {
  // The one difference from an interpolation's path, where the first segment IS the name and takes
  // no dot. Both directions still parse, which is what makes the error invisible without this.
  assert.equal(print(assertionStep('expect body.id equals 1'), { indent: 1 }).text, '  expect body.id equals 1');
  assert.equal(print(step('let a = {order.id}'), { indent: 1 }).text, '  let a = {order.id}');

  // The whole body has no path at all, and an index opens one without a dot.
  assert.equal(print(assertionStep('expect body equals { a: 1 }'), { indent: 1 }).text, '  expect body equals { a: 1 }');
  assert.equal(print(assertionStep('expect body[0].id equals 1'), { indent: 1 }).text, '  expect body[0].id equals 1');
});

test('a `log` level is printed only when it is not the default', () => {
  // THIRD INSTANCE OF ONE SHAPE, THIRD DIFFERENT ANSWER. `parseLogStep` defaults an omitted level
  // to `info`, so `log "x"` and `log info "x"` are the same node and the AST cannot say which was
  // written — `Stage`'s situation exactly. `Stage` REFUSED, because its two spellings parse to
  // different programs; a JSON key is PICKED bare; and this is picked *omitted*, because that is
  // what every `log` line in the corpus writes.
  const implicit = assertionStep('log "x"');
  const explicit = assertionStep('log info "x"');
  assert.deepEqual(stripSpans(implicit), stripSpans(explicit));
  assert.equal(print(explicit, { indent: 1 }).text, '  log "x"');
  // A level that is not the default has to survive, or the assertion above is just "drop it".
  assert.equal(print(assertionStep('log warn "x"'), { indent: 1 }).text, '  log warn "x"');
  assert.equal(print(assertionStep('log debug "x" to html'), { indent: 1 }).text, '  log debug "x" to html');
});

test('A2-1: the three response scan families, every severity, and the negation that reads backwards', () => {
  // Three of the four families, because these are the three whose SUBJECT prints — see the a11y
  // test below, which is the finding this slice turned up. `input handling` is the two-word
  // phrase, the only one a naive `split(' ')` would break.
  for (const src of [
    'expect response has no security violations',
    'expect response has no authorization violations',
    'expect response has no input handling violations',
  ]) {
    assert.equal(print(assertionStep(src)).text, src, src);
  }

  // The floor is a word the AST either has or has not — all four of them, because a fixture using
  // only `critical` cannot see a printer that hardcodes one (`A1-1`'s date-offset finding, whose
  // table held 25 `days` and exactly one `seconds`).
  for (const sev of ['minor', 'moderate', 'serious', 'critical'] as const) {
    const src = `expect response has no ${sev} security violations`;
    assert.equal(print(assertionStep(src)).text, src, src);
  }

  // **`not` goes in front of `has`.** `parseMatcher` eats the negation prefix before it reaches
  // `has`, so `has not no …` and `has no not …` are both unparseable — and 57 of the corpus'
  // 102 scan assertions are negated, because that is how an acceptance test says the scanner
  // FOUND something. Asserted with a floor as well as without, since negation and severity are
  // independent positions in one line and a printer can order them wrongly only when both appear.
  assert.equal(
    print(assertionStep('expect response not has no security violations')).text,
    'expect response not has no security violations',
  );
  assert.equal(
    print(assertionStep('expect response not has no moderate authorization violations')).text,
    'expect response not has no moderate authorization violations',
  );

  // `check` is the other statement that carries these, and it reaches the same matcher.
  assert.equal(
    print(assertionStep('check response has no critical authorization violations')).text,
    'check response has no critical authorization violations',
  );
});

test('A2-1: the a11y matcher prints, and not one a11y assertion does', () => {
  // **The finding that re-sliced this round.** `hasNoA11yViolations` is spelled by the same
  // production as the other three and prints for free — but its only subject is `page`, which is
  // `A3`'s, so every one of the corpus' 16 a11y assertions still refuses. The refusal comes from
  // the SUBJECT.
  //
  // This is worth a test rather than a note because the refusal census that sliced `A2` measured
  // `print(node)` per node and therefore counted all 16 as moving from refused to printable, which
  // is true of the matcher and false of anything a user could write. **A node printing is not the
  // statement containing it printing** — and a tool that measures a rule needs a control as much as
  // the rule does.
  const a11y = assertionStep('expect page has no a11y violations');
  assert.equal(a11y.type, 'ExpectStmt');
  const m = a11y.matcher;
  assert.equal(print(m).text, 'has no a11y violations');
  assert.equal(print(m).ok, true);

  const whole = print(assertionStep('expect page has no serious a11y violations'));
  assert.equal(whole.ok, false);
  assert.match(whole.reason ?? '', /PageSubject/);
  // When `A3` teaches the printer `page`, this assertion starts passing with no change here —
  // which is the point of asserting the reason rather than only the refusal.
});

test('A2-1: a scan matcher never takes an operand', () => {
  // `parseScanViolationsMatcher` builds these with `value: null` and no spelling supplies one, so
  // this guard is unreachable from any source text — the same shape as `connects`, and resolved
  // the way `diagnose`'s unreachable guard was in `A1-4`: the printer is an exported module with a
  // contract, and that contract covers a node built by hand, which `build.ts` does for the forms.
  const withOperand: Node = {
    type: 'Matcher', name: 'hasNoSecurityViolations', negated: false,
    value: { type: 'NumberLit', value: 1, raw: '1', span: SYNTHETIC }, span: SYNTHETIC,
  } as unknown as Node;
  const r = print(withOperand);
  assert.equal(r.ok, false);
  assert.match(r.reason ?? '', /never takes an operand/);
  // Names the phrase the author writes, not the internal matcher name.
  assert.match(r.reason ?? '', /has no security violations/);
});

test('the assertion half refuses what belongs to another door', () => {
  // A locator, a page and an observed network request are the browser's vocabulary. They refuse BY
  // NAME rather than silently, so the census in the gate above can be read as a worklist.
  //
  // **The scan half of this test retired in `A2-1`**, which is what made those matchers print. It
  // is not deleted, because the claim it was making — the refusal names the MATCHER and not the
  // subject under it — is still the claim worth holding; it is now made by the positive test
  // below, over a matcher that is still nobody's (`matchesSnapshot`, `A3`'s).
  const locator = assertionStep('expect button "Buy" is visible');
  const lr = print(locator);
  assert.equal(lr.ok, false);
  assert.match(lr.reason ?? '', /LocatorSubject/);

  // `of request to "…"` moves four otherwise-printable subjects onto traffic observed on a live
  // page, so the CLAUSE is refused while its subject is not.
  const observed = assertionStep('expect status of request to "/api/orders" equals 201');
  const or = print(observed);
  assert.equal(or.ok, false);
  assert.match(or.reason ?? '', /reads traffic observed on a live page/);

  // `capture {x} as y` is `TF0..`-rejected by the parser (`D130`), so a printer that emitted it
  // would be writing a step nothing can read back.
  const bad: Node = { type: 'CaptureStmt', subject: { type: 'ValueSubject', ref: [{ kind: 'prop', name: 'orderId' }], span: SYNTHETIC }, name: 'saved', span: SYNTHETIC } as unknown as Node;
  const br = print(bad);
  assert.equal(br.ok, false);
  assert.match(br.reason ?? '', /cannot be a `\{variable\}`/);

  // `connects` is the one matcher that never takes an operand at all.
  const conn: Node = { type: 'Matcher', name: 'connects', negated: false, value: { type: 'NumberLit', value: 1, raw: '1', span: SYNTHETIC }, span: SYNTHETIC } as unknown as Node;
  assert.match(print(conn).reason ?? '', /never takes an operand/);
});
