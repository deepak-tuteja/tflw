// `M234` `B` — the corpus the docs photograph, held to the printer (`D1299`).
//
// **THE PAGE'S CLAIM AND THE PICTURE UNDER IT ARE DIFFERENT SIZES.** `docs-site` `ui/browser.md`
// says, correctly, that *all twenty-two kinds the language has* are editable in the Compose pane —
// and the screenshot beside that sentence is a test using **three** (`open`, `click`,
// `screenshot`). The gap is not the product: measured at `M234`'s scoping, the pane authors **31
// of the 31 kinds a `.tflw` file can hold**, and both working corpora sit at the same 31. What the
// docs photograph is `examples/storefront`, which held **6 of 31** on the day this gate was
// written. A reader who judges the tool by its evidence is judging a fifth of it.
//
// **THE SUBJECT IS THE PRINTER, AND THAT IS THE WHOLE DECISION** (`D1299`). The obvious table to
// read is `VOCABULARY` in `packages/ui`, and it is the wrong one for exactly the reason `D1162`
// records: that table held **three** of twenty-two browser kinds while the other nineteen drew as
// dead, uneditable code lines — 650 statements, 27% of every browser step in both trees. A gate
// reading `VOCABULARY` would have been green on every one of those days, because it would have
// been asking the table that was wrong. A printer-derived gate convicts instead: the language can
// print `select`, so the corpus must hold a `select`, and a `select` in the corpus draws as the
// dead row it is.
//
// **AN EQUALITY, NOT A FLOOR** (`M201`'s carry: *a floor is blind in exactly one direction*). The
// stated cost is a standing tax, and it is the mechanism rather than a side effect: **a new
// printable construct obliges a corpus test in the same round, or `main` goes red.** That is how
// the docs stop falling behind the language.
//
// **WHAT THIS GATE DOES NOT ASK.** Not that the example *runs* — `npm run example --tag
// functional` does that, and `lenses.test.ts` already holds the same corpus to reaching all nine
// door combinations. Not that it checks clean (`D1300`): `verify:fmt-roundtrip` walks every
// `.tflw` under `packages/` asserting **round-trip, not semantics**, so a file may reformat
// perfectly and still carry a `TF0xx` — which would leave it counted nowhere while every shot
// still got taken. That one is asked of `tflw check` over the example, where the config and the
// service table are in scope; `checkProgram` called bare here would invent errors the CLI does not
// report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tflwFiles } from '../../../scripts/tflw-corpus.mjs';
import { parseSource, print, PRINTABLE, CONTEXT_BOUND, REFUSES_BY_CONSTRUCTION, STEP_LENS } from '../src/index.js';
import type { Node, Step } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE = resolve(here, '..', '..', '..', 'examples', 'storefront');

const STEP_KINDS = Object.keys(STEP_LENS) as ReadonlyArray<Step['type']>;

/**
 * Does `print` refuse this kind **for want of a case**, as opposed to refusing a particular node?
 *
 * `print.ts`'s `default` branch is `refuse(node.type)` with no detail, so it — and only it —
 * produces the message `no printer for X`. Every other refusal carries a reason (`'a stage is
 * spelled by its block …'`), and a case that simply cannot read a field off a skeleton node throws
 * a `TypeError`, which `print` rethrows. So the three outcomes separate cleanly, and the question
 * is asked **of the switch** rather than of a list beside it.
 */
function refusesForWantOfACase(kind: string): boolean {
  try {
    const result = print({ type: kind } as unknown as Node);
    return !result.ok && result.reason === `no printer for ${kind}`;
  } catch {
    return false; // a case exists and could not read a skeleton node — which is an answer
  }
}

/** Every statement kind `print` can emit standalone — the expected set of `D1299`. */
function printableStepKinds(): string[] {
  return STEP_KINDS
    .filter((k) => !REFUSES_BY_CONSTRUCTION.has(k))
    .filter((k) => !CONTEXT_BOUND.has(k))
    .filter((k) => !refusesForWantOfACase(k))
    .sort();
}

/**
 * The debt, written down — and **empty on the day it was committed, which is the point**.
 *
 * `M201`'s carry is *land the gate before the corpus*: this file was committed while
 * `examples/storefront` stood at 6 of 31, so its first run convicted with twenty-five names. A
 * gate that arrives green has proved nothing about the corpus it arrived with.
 *
 * It survives the corpus that greened it for the same reason `print.test.ts`'s `OWED` does: it is
 * the mechanism by which a kind may enter the language before its example exists — one row, with
 * the reason on it — instead of the gate going red in a way that invites deleting the assertion.
 * An empty set is also the only state in which the equality below reads as a completeness claim.
 */
const OWED: ReadonlySet<string> = new Set<string>([]);

test('the printable statement kinds are the printer\'s own, derived twice and agreeing', () => {
  const behavioural = printableStepKinds();
  // The declarative half: `PRINTABLE` is a hand-kept list, which is exactly the shape `D1299`
  // refuses to trust on its own — but it is not free-floating, because `print.test.ts` holds every
  // kind on it to round-tripping in this repository's own corpus. So the two derivations have
  // independent failure modes, and asking both is cheap.
  const declared = STEP_KINDS.filter((k) => PRINTABLE.has(k)).sort();
  assert.deepEqual(behavioural, declared,
    'the printer\'s switch and `PRINTABLE` disagree about which statements can be written — one of them has drifted');

  // THE VACUITY CONTROLS. Each subtraction above must remove something, and for the recorded
  // reason. Without these the derivation could quietly become `Object.keys(STEP_LENS)` and every
  // number in this file would still look right.
  //
  // `MalformedStep` is the one that would have slipped through, and it is worth the row: it has a
  // case — `print.ts:530` refuses it *with a detail* — so the behavioural probe alone answers 32,
  // not 31. Only `REFUSES_BY_CONSTRUCTION` removes it, which is what that set is for.
  assert.deepEqual(STEP_KINDS.filter((k) => REFUSES_BY_CONSTRUCTION.has(k)), ['MalformedStep'],
    'the parser\'s error node must stay out of the claim — a corpus cannot hold a step the parser could not read');
  assert.ok(!refusesForWantOfACase('MalformedStep'),
    'if `MalformedStep` ever refuses for want of a case, this file\'s stated reason for the row above is stale');

  // `header` and `csrf` are the two `M232`'s `D1272` measured out: the parser dispatches both from
  // `parseSessionBody` ONLY, a `session` block lives in `tflw.config`, and `print.ts` has no case
  // for either kind. Both builders were written during `M232` and withdrawn. So the honest bar is
  // **5 of 11 session-shaped constructs, not 7 of 13** — and against what a `.tflw` file can hold,
  // the pane is 31 of 31.
  //
  // This row moves the day the printer gains a case, in the round that adds it, like `OWED` below.
  assert.deepEqual(STEP_KINDS.filter(refusesForWantOfACase).sort(), ['CsrfStmt', 'HeaderStmt'],
    'the set of statements the printer has no case for has changed — `D1272` is the record of why these two, and it needs amending');

  // And the positive control, so a derivation that removed everything could not pass: a statement
  // every door draws is in.
  assert.ok(behavioural.includes('ExpectStmt'), 'a derivation that excludes `expect` has excluded the language');
});

test('every statement kind the printer can emit occurs in the example the docs photograph', () => {
  const printable = printableStepKinds();
  const files = tflwFiles([EXAMPLE]);
  assert.ok(files.length > 0, `no \`.tflw\` under ${EXAMPLE} — this gate is reading nothing`);

  const covered = new Set<string>();
  let statements = 0;
  for (const file of files) {
    const { program, diagnostics } = parseSource(readFileSync(file, 'utf8'));
    // A parse error would silently shrink the census, and the example is the one corpus a reader
    // opens — so it is asserted here rather than skipped the way `print.test.ts`'s walk skips.
    assert.deepEqual(diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.message}`), [], file);
    const visit = (n: unknown): void => {
      if (Array.isArray(n)) { for (const x of n) visit(x); return; }
      if (!n || typeof n !== 'object') return;
      const node = n as Record<string, unknown>;
      if (typeof node.type === 'string' && node.type in STEP_LENS) { covered.add(node.type); statements += 1; }
      for (const [k, v] of Object.entries(node)) if (k !== 'span') visit(v);
    };
    visit(program);
  }

  const missing = printable.filter((k) => !covered.has(k));
  console.log(
    `\n  example corpus — ${printable.length - missing.length} of ${printable.length} printable statement kinds ` +
    `across ${files.length} files / ${statements} statements; ${missing.length} owed\n`,
  );

  assert.deepEqual(
    missing,
    [...OWED].sort(),
    `\nthe example no longer holds every statement the language can write:\n` +
    `  newly covered, delete from OWED: ${[...OWED].filter((k) => covered.has(k)).sort().join(' ') || '(none)'}\n` +
    `  newly missing, add a test to \`examples/storefront\` (or a row to OWED with a reason): ${missing.filter((k) => !OWED.has(k)).join(' ') || '(none)'}\n`,
  );
});
