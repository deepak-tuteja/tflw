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
import type { Node, Program, TestDecl } from '../src/index.js';

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
const ASKED = new Set<string>(['TestDecl', 'ApiStep', 'ExpectStmt', 'PauseStmt', 'ThresholdDecl', ...WORKLOADS]);

/** Wrap printed text in the smallest source that can hold it, and say where to find it again. */
function reparse(node: Node, text: string): Node | null {
  if (node.type === 'TestDecl') {
    const program = parseSource(text + '\n').program;
    return program.tests.length === 1 ? program.tests[0]! : null;
  }
  const program = parseSource(`test "wrapper"\n${text}\n`).program;
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

test('every printable node in the corpus re-parses to the node it was printed from', () => {
  const files = [...corpus(repoRoot), ...corpus(siblingRoot)];
  assert.ok(files.length > 100, `expected the corpus, found ${files.length} files`);

  const tally = new Map<string, Tally>();
  const refusals = new Map<string, number>();
  const mismatches: string[] = [];
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
