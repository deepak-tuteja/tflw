// `M213` `S4` — the door vocabulary table, and the two ways it can lie (`D1094`).
//
// **A TABLE THAT DESCRIBES A PANE IS A SECOND SOURCE OF TRUTH ABOUT IT**, and the whole point of
// extracting one was to remove a second source of truth rather than to add one. So the table gets
// the gate its own existence creates: every word it offers must be a word the pane can act on, in
// both directions — a `+` gesture with no branch behind it is a button that does nothing, and a
// `constructs` entry with no row behind it is a pane claiming a capability its controls lack.
//
// The first draft of the table had the second defect: it listed `WithinBlock`, because
// `buildWithin` exists — and nothing in the pane offers a gesture that produces one or a row that
// edits one. That is the exact failure this file is here to catch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAcceptDialog, buildApiStep, buildCall, buildCapture, buildCheck, buildClick, buildCloseTab,
  buildDismissDialog, buildDownload, buildDrag, buildDropFile, buildExpect, buildFill, buildFillForm,
  buildGive, buildHover, buildLet, buildLog, buildOpen, buildPause, buildPress, buildScreenshot,
  buildScroll, buildSelect, buildStub, buildSwitchToNewTab, buildSwitchToTab, buildWaitUntilApi,
  buildWaitUntilUi, buildWithin, STEP_LENS, type Step,
} from '@tflw/lang';

import { VOCABULARY } from '../src/vocabulary.ts';
import { statementEditOf } from '../src/parts.tsx';

const here = dirname(fileURLToPath(import.meta.url));
const doorSource = readFileSync(join(here, '..', 'src', 'ComposeDoor.tsx'), 'utf8');

/**
 * **The dispatcher's own text, and not the file's** — which is the difference between this gate
 * working and this gate being decorative.
 *
 * The first draft searched the whole module for `case '<key>':`, and a mutation deleting
 * `case 'fill':` from the dispatcher **survived**: `applyExpectEdit` has a `case 'fill':` of its
 * own, for the row editor, so the substring was still there and the claim was still "true". That
 * is *a gate's substring is not its rule*, met here for the second time in this workspace. The
 * slice cut below is what makes the search ask about the function it is actually about.
 */
const dispatcher = ((): string => {
  const start = doorSource.indexOf('const add = useCallback(');
  assert.ok(start > 0, "ComposeDoor no longer has an `add` dispatcher — this gate is reading for a shape that moved");
  const end = doorSource.indexOf('\n  );', start);
  assert.ok(end > start, 'the dispatcher does not end where this gate expects it to');
  return doorSource.slice(start, end);
})();

/** One node of every kind any door claims to construct, built the way the pane builds it. */
const ok = <T,>(r: { ok: true; node: T } | { ok: false; reason: string }): T => {
  assert.ok(r.ok, r.ok ? '' : r.reason);
  return r.node;
};
const SAMPLES: Readonly<Record<string, Step>> = {
  ExpectStmt: ok(buildExpect({ soft: false, quantifier: null, subject: { kind: 'status' }, matcher: 'equals', operand: '200' })),
  CaptureStmt: ok(buildCapture({ subject: { kind: 'body', path: 'id' }, name: 'id' })),
  LetStmt: ok(buildLet({ name: 'n', value: '1' })),
  LogStmt: ok(buildLog({ level: 'info', message: 'hi', destination: null })),
  CallStmt: ok(buildCall({ name: 'sign in', args: [] })),
  GiveStmt: ok(buildGive('1')),
  PauseStmt: ok(buildPause({ min: '1ms', max: '' })),
  OpenStmt: ok(buildOpen('/')),
  ClickStmt: ok(buildClick({ locator: { kind: 'button', value: 'Buy' }, kind: 'single' })),
  FillStmt: ok(buildFill({ locator: { kind: 'field', value: 'Email' }, value: '"a"' })),
  ApiStep: ok(buildApiStep({ method: 'GET', path: '/', service: null, label: null, headers: [], body: null })),
  WaitUntilApiStmt: ok(buildWaitUntilApi({
    request: { method: 'GET', path: '/', service: null, label: null, headers: [], body: null },
    expects: [{ soft: false, quantifier: null, subject: { kind: 'status' }, matcher: 'equals', operand: '200' }],
    waitMs: null,
  })),
  /* **The other nineteen, from `M219` `C`** (`D1162`). The BROWSER door claimed three of the
     language's twenty-two browser kinds when this round was scoped; every one of these is a kind
     a row now draws, and the assertion below is what holds the table to it. */
  HoverStmt: ok(buildHover({ kind: 'button', value: 'Menu' })),
  ScrollStmt: ok(buildScroll({ kind: 'button', value: 'Bottom' })),
  TickStmt: ok(buildCheck({ locator: { kind: 'field', value: 'Subscribe' }, ticked: true })),
  UntickStmt: ok(buildCheck({ locator: { kind: 'field', value: 'Offers' }, ticked: false })),
  SelectStmt: ok(buildSelect({ locator: { kind: 'field', value: 'Role' }, value: '"member"' })),
  PressStmt: ok(buildPress({ keys: 'Enter', locator: null })),
  DismissDialogStmt: ok(buildDismissDialog()),
  CloseTabStmt: ok(buildCloseTab()),
  AcceptDialogStmt: ok(buildAcceptDialog('')),
  SwitchToTabStmt: ok(buildSwitchToTab('1')),
  ScreenshotStmt: ok(buildScreenshot('shot')),
  DropFileStmt: ok(buildDropFile({ filePath: './a.csv', locator: { kind: 'css', value: '.drop' } })),
  DragStmt: ok(buildDrag({ from: { kind: 'css', value: '.a' }, to: { kind: 'css', value: '.b' } })),
  FillFormStmt: ok(buildFillForm({ rows: [{ field: 'Email', value: '"a@b.c"' }] })),
  StubStmt: ok(buildStub({ method: 'GET', urlPattern: '**/x', status: '200', body: '' })),
  WaitUntilUiStmt: ok(buildWaitUntilUi({
    expect: { soft: false, quantifier: null, subject: { kind: 'locator', locator: { kind: 'text', value: 'Ok' } }, matcher: 'visible', operand: '' },
    hold: '',
    wait: '',
  })),
  WithinBlock: ok(buildWithin({
    locator: { kind: 'list', value: 'Cart' },
    frame: false,
    body: [ok(buildClick({ locator: { kind: 'button', value: 'Remove' }, kind: 'single' }))],
  })),
  SwitchToNewTabBlock: ok(buildSwitchToNewTab([ok(buildClick({ locator: { kind: 'text', value: 'Receipt' }, kind: 'single' }))])),
  DownloadBlock: ok(buildDownload({ name: 'file', body: [ok(buildClick({ locator: { kind: 'text', value: 'CSV' }, kind: 'single' }))] })),
};

/** The two kinds a door constructs that are **not** rows: a request is a card, and `wait until` is
 *  a request too. Named rather than special-cased silently, so a third would have to be added here
 *  by someone who noticed they were adding one. */
const NOT_ROWS = new Set(['ApiStep', 'WaitUntilApiStmt']);

test('every `+` gesture a door offers has a branch behind it', () => {
  for (const [door, vocab] of Object.entries(VOCABULARY)) {
    for (const gesture of vocab.adds) {
      assert.match(
        dispatcher,
        new RegExp(`case '${gesture.key}':`),
        `${door}'s \`${gesture.label}\` has no \`case '${gesture.key}':\` in ComposeDoor's dispatcher — the button would refuse itself`,
      );
    }
  }
});

test('…and the dispatcher refuses a key the table does not offer, rather than doing nothing', () => {
  // The other direction, which a `case` list cannot state: the default branch names the
  // disagreement instead of a button silently going nowhere.
  assert.match(dispatcher, /default: return setEditProblem\(/);
  assert.match(dispatcher, /vocabulary\.ts\\` and this switch disagree/);
});

test('every kind a door claims to construct is one the pane can actually draw', () => {
  for (const [door, vocab] of Object.entries(VOCABULARY)) {
    for (const kind of vocab.constructs) {
      const sample = SAMPLES[kind];
      assert.ok(sample, `${door} claims to construct \`${kind}\` and this test has no sample for it — add one, or the claim is untested`);
      if (NOT_ROWS.has(kind)) continue;
      assert.ok(
        statementEditOf(sample) !== null,
        `${door} claims to construct \`${kind}\`, but no row edits one — the table would be promising a control that does not exist`,
      );
    }
  }
});

test('the control: a kind no row edits is still caught — and `WithinBlock` is no longer the example', () => {
  /**
   * **This control was vacated by the round it was written for**, and that is worth recording
   * rather than quietly rewriting. It read: *"`buildWithin` exists, which is what made
   * `WithinBlock` look constructible in the first draft; `statementEditOf` says no, so the
   * assertion above would have failed."* True until `M219` `C` made `WithinBlock` a row — after
   * which the control asserted that `statementEditOf` refuses a kind it now accepts, and the only
   * reason it failed rather than passing silently is that it asserted the refusal *positively*.
   *
   * A control needs a kind the pane genuinely does not edit, and the language has one that will
   * never be edited by anything: `MalformedStep` is the parser's recovery node — the *absence* of
   * a construct — so no door can construct it and no row can draw it. It is the right subject for
   * this gate for the same reason it is `null` in `STEP_LENS`.
   */
  const click = ok(buildClick({ locator: { kind: 'button', value: 'x' }, kind: 'single' }));
  assert.ok(statementEditOf(click) !== null, 'the instrument reads a kind that IS editable');
  assert.equal(statementEditOf({ ...click, type: 'MalformedStep' } as unknown as Step), null, 'and refuses one that is not');
  /* And the vacuity check the round itself supplies: the kind this control used to name is now
     one the pane draws, which is the claim `D1162` makes and this is the cheapest place to hold
     it against the same instrument. */
  assert.ok(statementEditOf(SAMPLES.WithinBlock!) !== null, '`WithinBlock` is a row from `M219` `C` — `D1162`');
});

test('the BROWSER door constructs every browser kind the language has — `D1162`', () => {
  /**
   * **Measured when this round was scoped: three of twenty-two.** The other nineteen drew as a
   * plain code line with no disabled control and no reason — 650 statements, 27% of all browser
   * steps in the two corpora, which is the pane `D1082` refuses. The number is not written here:
   * the language's own table is asked, so a kind the language gains reddens this the day it lands
   * rather than the day somebody updates a count.
   */
  const browser = (Object.keys(STEP_LENS) as Step['type'][]).filter((k) => STEP_LENS[k] === 'browser');
  assert.ok(browser.length >= 22, `the language has ${browser.length} browser kinds — fewer than 22 means this gate is reading the wrong table`);
  const missing = browser.filter((k) => !VOCABULARY.browser.constructs.has(k));
  assert.deepEqual(missing, [], `the BROWSER door cannot construct: ${missing.join(', ')}`);
});

test('the doors that send are the doors that issue requests, and the table is where that is decided', () => {
  // `send` prints a scratch cut off after the selected request and runs it; a browser test's unit
  // is a session, so there is no prefix that can be cut at a statement and still mean anything.
  //
  // **LOAD joined in `M224` `D`** (`D1211`), and the argument is the one above read forwards: a
  // workload-bearing test's body is `api` steps — `TF033` forbids a browser step beside a workload
  // — so a prefix cut at a statement means exactly what it means on API. What `send` does there is
  // the point rather than a caveat: it strips the workload and the thresholds by design
  // (`ComposeDoor`), which is *issue this request once, without load, before committing to run it
  // at a rate*.
  //
  /* **THE BICONDITIONAL WAS REFUTED BY `M228` `B` (`D1241`), AND THIS GATE IS WHERE IT SHOWED.**
     It read *a door sends **iff** its `constructs` holds `ApiStep`*, which was true of three doors
     and is false of the fourth: SCAN constructs `ApiStep` — a scan assertion grades *the last
     response*, so the body of a scan-bearing test is `api` steps — and does **not** send.
     `D1119` is the reason and it is structural rather than a preference: `send` filters the
     assertions out of the scratch, so a send on a scan-bearing test issues the request, shows a
     200 and displays no scan verdict at all. On API that is exactly the gesture; here it is a
     control that looks like it answers the door's question and cannot.

     So the surviving half is the implication, and it is the half that was ever load-bearing:
     **a door that sends must be able to construct what `send` cuts a prefix of.** The converse is
     now a decision per door, and the list below is what records those four decisions — kept
     deliberately as a list, because after this refutation there is no predicate to derive it
     from, and a list is honest about being four separate arguments. */
  for (const [door, v] of Object.entries(VOCABULARY)) {
    if (!v.sends) continue;
    assert.ok(v.constructs.has('ApiStep'), `${door} sends but cannot construct an \`ApiStep\`, so there is no prefix for \`send\` to cut`);
  }
  assert.deepEqual(
    Object.entries(VOCABULARY).filter(([, v]) => v.sends).map(([d]) => d),
    ['api', 'load'],
    'a door gained or lost `send` — which is a decision with an argument, not a derivation (`D1119`, `D1241`)',
  );
  // …and the refutation itself, pinned, so the biconditional cannot be quietly re-taken.
  assert.ok(VOCABULARY.scan.constructs.has('ApiStep'), 'SCAN stopped constructing `ApiStep`, which is what made `D1241` a decision rather than a consequence');
  assert.equal(VOCABULARY.scan.sends, false, '`send` on a scan-bearing test strips the assertions this door exists for (`D1119`/`D1241`)');
});
