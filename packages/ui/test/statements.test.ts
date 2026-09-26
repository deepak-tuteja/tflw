// **The one construction path, held to the whole browser vocabulary** — `M219` `C`/`E` (`D1087`,
// `D1162`).
//
// `buildStatement` is what the row editor calls when a field changes and what `+ step…` calls when
// a kind is chosen, and it was one `switch` inside `ComposeDoor` until this round. The claim these
// gates hold is the one `D1087` makes: **the pane builds nothing**, and what a control produces is
// bytes the language can read back.
//
// THE ROUND TRIP IS THE GATE, and it is a round trip rather than a string comparison on purpose:
// `print` → `parseSource` → `statementEditOf` asks whether the edit *survives* the file, which is
// the property a form has to have and which no assertion about a literal can state. A kind that
// prints something the parser reads as a different kind passes every "the bytes look right" check
// ever written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, print, STEP_LENS, type Step } from '@tflw/lang';
import { defaultEdit, stepCatalogue, withEmptiesFilled } from '../src/AddStep.tsx';
import { buildStatement, statementLead } from '../src/statements.ts';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tflwFiles } from '../../../scripts/tflw-corpus.mjs';
import { statementEditOf } from '../src/parts.tsx';
import { VOCABULARY } from '../src/vocabulary.ts';

/** Every browser kind the language has — asked of the language, never listed here. */
const BROWSER = (Object.keys(STEP_LENS) as Step['type'][]).filter((k) => STEP_LENS[k] === 'browser');

/**
 * **The door-agnostic kinds** — `STEP_LENS[kind] === null` — asked of the language the same way.
 *
 * `null` there means *this construct does not decide which door a test lands behind*, which is the
 * opposite of what `stepCatalogue` read it as until `M232` (`D1273`). `let` and `expect` are
 * excluded here for the reason they are excluded from `CATALOGUE`: every door carries `+ let` in
 * its foot, and an assertion is a row rather than a step you add.
 */
const AGNOSTIC = (Object.keys(STEP_LENS) as Step['type'][]).filter(
  /* `MalformedStep` is the parser's error node and not a construct anybody authors — it has a
     `null` lens because it has no lens, which is a third meaning of `null` in this table and the
     reason `D1273` reads the door's own vocabulary rather than this one. */
  (k) => STEP_LENS[k] === null && !['LetStmt', 'ExpectStmt', 'MalformedStep'].includes(k),
);

/** A block needs a body before it can be built at all — `AddStep`'s own seed, one gesture. */
const seed = (kind: Step['type']): Step | null => {
  const click = buildStatement({ kind: 'click', locatorKind: 'button', locator: 'x', clickKind: 'single' }, null);
  assert.ok(click.ok, click.ok ? '' : click.reason);
  if (kind === 'SwitchToNewTabBlock') return { type: 'SwitchToNewTabBlock', body: [click.node], span: click.node.span } as Step;
  if (kind === 'DownloadBlock') return { type: 'DownloadBlock', name: 'file', body: [click.node], span: click.node.span } as Step;
  if (kind === 'WithinBlock') return { type: 'WithinBlock', locator: (click.node as { locator: unknown }).locator, frame: false, body: [click.node], span: click.node.span } as Step;
  return null;
};

test('`+ step…` offers every browser kind the foot does not, and none it cannot build', () => {
  const offers = stepCatalogue(VOCABULARY.browser.constructs, ['open', 'click', 'fill']);
  const listed = new Set(offers.map((o) => o.kind));
  /* `within` is deliberately absent — `D1164`: a scope is a **field on a row** under `D1163`, so
     its 433 occurrences leave the `+` vocabulary entirely, and the `⤹` on a statement is how it
     stays constructible. That is most of why the tail is as small as it is. */
  const expected = [...BROWSER.filter((k) => !['OpenStmt', 'ClickStmt', 'FillStmt', 'WithinBlock'].includes(k)), ...AGNOSTIC];
  assert.deepEqual([...listed].sort(), [...expected].sort());
  /* **23, and it was 18 until `M232` (`D1273`)** — `M213-06`. The five door-agnostic kinds are
     constructible on every door and were offered on none: `buildStatement` has had a case for each
     since `M214`, and `stepCatalogue`'s third clause read `STEP_LENS[kind] !== null` as *this door
     cannot build it* when it means *this construct does not choose a door*. It filtered nothing on
     the day it was written, because every `CATALOGUE` row was a browser kind — so it was a trap
     rather than a defect, and the trap is that adding the five would have changed nothing and
     reddened no gate. */
  assert.equal(offers.length, 23, '22 browser kinds − 3 in the foot − `within`, plus the five door-agnostic kinds');
  assert.equal(AGNOSTIC.length, 5, 'capture, log, call, give, pause — if the language gains a sixth it needs a CATALOGUE row and a seed');
  // And the list cannot claim a kind the door cannot construct, which is the direction that
  // matters: a chooser offering a kind with no builder is a control that refuses itself.
  for (const o of offers) assert.ok(VOCABULARY.browser.constructs.has(o.kind), `${o.label} is offered and not constructible`);
});

test('every offerable kind has a default; one with a field to fill refuses until it is, and the filled edit prints and parses back as itself', () => {
  /* `M240` `F` (`M239-04`). The defaults were `change me`, which the builder accepts, so a
     dialog's *add it* wrote the placeholder into the file. Now a default with a required text
     field is EMPTY and the builder refuses it — that refusal is what disables the button — and the
     round trip is made on the same edit with its empties filled, which is the edit an author
     produces by typing. Both halves are stated: a default that builds when it should not is the
     old defect, and a filled edit that fails to build is a dialog that can never be accepted. */
  /* The review's shot was `select`; the rest are every kind whose default carried `change me` in a
     field the builder refuses when blank — a locator, a name, a path, a pattern, a form row. */
  const MUST_REFUSE = new Set<Step['type']>(['HoverStmt', 'ScrollStmt', 'TickStmt', 'UntickStmt', 'SelectStmt', 'ScreenshotStmt', 'DropFileStmt', 'DragStmt', 'FillFormStmt', 'StubStmt', 'WaitUntilUiStmt']);
  let refused = 0;
  for (const kind of [...BROWSER, ...AGNOSTIC]) {
    if (kind === 'OpenStmt' || kind === 'ClickStmt' || kind === 'FillStmt' || kind === 'WithinBlock') continue;
    const edit = defaultEdit(kind);
    assert.ok(edit, `\`${kind}\` has no default in \`AddStep\` — \`+ step…\` would offer a kind with nothing to put in the fields`);
    const asIs = buildStatement(edit, seed(kind));
    const filled = withEmptiesFilled(edit);
    /* Which empties are REQUIRED is the builder's to say, not this test's: `press` with no locator
       is *whatever has focus* and `accept dialog` with no text is *accept with nothing* — both
       spellings, not missing values — so a default may build. The kinds whose blank is a missing
       value are named below, and those must refuse. */
    if (!asIs.ok) {
      assert.ok(asIs.reason.length > 0, `${kind}: the refusal carries no reason for the dialog to show`);
      refused += 1;
    }
    if (MUST_REFUSE.has(kind)) assert.ok(!asIs.ok, `${kind}: a default with an empty field must not build — it built ${asIs.ok && print(asIs.node).ok ? (print(asIs.node) as { text: string }).text : ''}`);
    const built = buildStatement(filled, seed(kind));
    assert.ok(built.ok, built.ok ? '' : `${kind}: ${built.reason}`);
    const printed = print(built.node);
    assert.ok(printed.ok, `${kind} did not print`);
    const back = parseSource(`test "t"\n  ${printed.text.split('\n').join('\n  ')}\n`);
    assert.deepEqual(back.diagnostics.filter((d) => d.severity === 'error'), [], `${kind} printed bytes the parser refuses: ${printed.text}`);
    assert.equal(back.program.tests[0]?.body[0]?.type, kind, `${kind} printed something that parses as a different kind: ${printed.text}`);
  }
  assert.ok(refused >= 10, `the kinds with a field to fill must refuse their default: ${refused} did`);
});

test('an edit survives the file — read a node, change a field, and the change comes back', () => {
  /* The property a form must have and which no assertion about a literal can state. Two kinds,
     one from each shape family: a locator-only kind and a block whose body must be carried. */
  const src = 'test "t"\n  hover button "Menu"\n  within list "Cart"\n    click button "Remove"\n';
  const decl = parseSource(src).program.tests[0]!;

  const hover = statementEditOf(decl.body[0]!);
  assert.ok(hover && hover.kind === 'locatorOnly');
  const rebuiltHover = buildStatement({ ...hover, locator: 'Account' }, decl.body[0]!);
  assert.ok(rebuiltHover.ok, rebuiltHover.ok ? '' : rebuiltHover.reason);
  assert.equal(print(rebuiltHover.node).ok && (print(rebuiltHover.node) as { text: string }).text, 'hover button "Account"');

  const within = statementEditOf(decl.body[1]!);
  assert.ok(within && within.kind === 'within');
  const rebuiltWithin = buildStatement({ ...within, locator: 'Saved' }, decl.body[1]!);
  assert.ok(rebuiltWithin.ok, rebuiltWithin.ok ? '' : rebuiltWithin.reason);
  const text = print(rebuiltWithin.node).ok ? (print(rebuiltWithin.node) as { text: string }).text : '';
  assert.match(text, /^within list "Saved"/);
  /* **THE BODY IS CARRIED, NEVER REBUILT** (`build.ts`'s family note). A form that rebuilt a
     block's body would be a second authoring surface for every statement inside it, which is what
     `D1087` refuses — and the failure would be silent: the head would be right and the gesture
     inside would be gone. */
  assert.match(text, /click button "Remove"/);
});

test('a builder’s refusal is the refusal the field shows, and it is reached through `validate`', () => {
  /**
   * **Mutation 7's vacuity control, and §5 asked for it by name.** A gate that reaches a refusal
   * by handing the builder something that could never come from a control proves that the builder
   * throws, not that the control is guarded — so each of these is a value a **field can hold**:
   * an empty locator, a tab number that is not whole, a status outside the range, a hold longer
   * than the budget.
   */
  const bad: [string, ReturnType<typeof buildStatement>][] = [
    ['an empty locator', buildStatement({ kind: 'locatorOnly', of: 'HoverStmt', locatorKind: 'button', locator: '   ' }, null)],
    ['a fractional tab', buildStatement({ kind: 'switchToTab', index: '1.5' }, null)],
    ['a status of 99', buildStatement({ kind: 'stub', method: 'GET', urlPattern: '**/x', status: '99', body: '' }, null)],
    ['a body that is a scalar', buildStatement({ kind: 'stub', method: 'GET', urlPattern: '**/x', status: '200', body: '"no"' }, null)],
    ['an empty screenshot name', buildStatement({ kind: 'screenshot', name: '' }, null)],
    ['a download name with a space', buildStatement({ kind: 'download', name: 'my file' }, seed('DownloadBlock'))],
  ];
  for (const [what, r] of bad) {
    assert.equal(r.ok, false, `${what} was accepted`);
    if (!r.ok) assert.ok(r.reason.trim().length > 10, `${what} was refused without saying why: ${r.reason}`);
  }

  /* **AND THE SIBLING, which §5 requires of every refusal gate**: the same path succeeds on good
     input. Without it, a builder that refused everything would pass the block above. */
  const good: [string, ReturnType<typeof buildStatement>][] = [
    ['a locator', buildStatement({ kind: 'locatorOnly', of: 'HoverStmt', locatorKind: 'button', locator: 'Menu' }, null)],
    ['tab 1', buildStatement({ kind: 'switchToTab', index: '1' }, null)],
    ['a 201', buildStatement({ kind: 'stub', method: 'GET', urlPattern: '**/x', status: '201', body: '' }, null)],
    ['an object body', buildStatement({ kind: 'stub', method: 'GET', urlPattern: '**/x', status: '200', body: '{ "ok": true }' }, null)],
    ['a screenshot name', buildStatement({ kind: 'screenshot', name: 'empty-cart' }, null)],
    ['a download name', buildStatement({ kind: 'download', name: 'receipt' }, seed('DownloadBlock'))],
  ];
  for (const [what, r] of good) assert.ok(r.ok, r.ok ? '' : `${what} was refused: ${r.reason}`);
});

test('a `wait until` refuses a subject that cannot change, and takes one that can', () => {
  // `pollable()` is the parser's own predicate, asked rather than re-derived — so a subject this
  // accepts is a subject the file parses back.
  const dead = buildStatement({
    kind: 'waitUntilUi',
    expect: { soft: false, negated: false, quantifier: '', subject: 'duration', argument: '', locatorKind: 'text', matcher: 'lessThan', operand: '1s', subset: [], severityFloor: '', schemaName: '', schemaSource: '', schemaService: '', filePath: '', snapshotName: '' },
    hold: '',
    wait: '',
  }, null);
  assert.equal(dead.ok, false);
  const live = buildStatement({
    kind: 'waitUntilUi',
    expect: { soft: false, negated: false, quantifier: '', subject: 'locator', argument: 'Ok', locatorKind: 'text', matcher: 'visible', operand: '', subset: [], severityFloor: '', schemaName: '', schemaSource: '', schemaService: '', filePath: '', snapshotName: '' },
    hold: '2s',
    wait: '10s',
  }, null);
  assert.ok(live.ok, live.ok ? '' : live.reason);
  assert.equal(print(live.node).ok && (print(live.node) as { text: string }).text, 'wait until text "Ok" is visible for 2s timeout wait 10s');
  // `TF055`'s two operands are both in the file now, so the refusal is made here rather than at
  // the run: a hold that does not fit inside the budget can never pass.
  const tooLong = buildStatement({
    kind: 'waitUntilUi',
    expect: { soft: false, negated: false, quantifier: '', subject: 'locator', argument: 'Ok', locatorKind: 'text', matcher: 'visible', operand: '', subset: [], severityFloor: '', schemaName: '', schemaSource: '', schemaService: '', filePath: '', snapshotName: '' },
    hold: '20s',
    wait: '10s',
  }, null);
  assert.equal(tooLong.ok, false);
});

// ── The chip is the language's own spelling — `M240` `F` (`M239-03`) ─────────────────────────────
//
// Held to the PRINTER over the whole corpus rather than to a list written here: for every step the
// repository's `.tflw` files hold, the printed line must begin with the chip. A chip that read the
// node's type name (`closetab`) fails on the first `close tab`; a kind added to the language whose
// phrase is two words fails the day the corpus first spells it.
test('`M239-03`: every statement chip is the phrase the printed statement begins with — never the lowercased node kind', () => {
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const kinds = new Map<string, string>();
  let steps = 0;
  const walk = (body: readonly Step[], path: string): void => {
    for (const step of body) {
      const printed = print(step);
      if (!printed.ok) continue; // `MalformedStep` and the context-bound kinds refuse to print alone
      const lead = statementLead(step);
      const line = printed.text.trim().split('\n')[0] ?? '';
      // A call is the one statement with no keyword — it begins with the action's own name — so
      // its chip is the language's word for the construct, and `afterLead` leaves its text whole.
      if (step.type === 'CallStmt') assert.equal(lead, 'call');
      else assert.ok(line === lead || line.startsWith(`${lead} `), `${path}: the chip \`${lead}\` is not how \`${line}\` begins (${step.type})`);
      kinds.set(step.type, lead);
      steps += 1;
      const inner = (step as { body?: readonly Step[] }).body;
      if (Array.isArray(inner)) walk(inner, path);
    }
  };
  for (const path of tflwFiles(repoRoot)) {
    const { program, diagnostics } = parseSource(readFileSync(path, 'utf8'));
    if (diagnostics.some((d) => d.severity === 'error')) continue;
    for (const t of program.tests) walk(t.body, path);
    for (const h of program.hooks) walk(h.body, path);
    for (const a of program.actions) walk(a.body, path);
  }
  // Measured 2026-09-26: 364 steps over 31 kinds. The floor is under both so a corpus edit does
  // not move this gate, and above the point where a walker that skipped every block would land.
  assert.ok(steps >= 300 && kinds.size >= 25, `the corpus must exercise the vocabulary: ${steps} steps over ${kinds.size} kinds`);
  // The two the review photographed, by name — and the control: on these the old rule's answer
  // is a word nobody wrote.
  assert.equal(kinds.get('CloseTabStmt'), 'close tab');
  assert.equal(kinds.get('SwitchToTabStmt'), 'switch to tab');
  for (const [type, lead] of kinds) {
    const oldRule = type === 'LetStmt' ? 'let' : type.replace(/Stmt$/, '').toLowerCase();
    if (lead.includes(' ')) assert.notEqual(lead, oldRule, `${type}'s chip is the old rule's slug`);
  }
});
