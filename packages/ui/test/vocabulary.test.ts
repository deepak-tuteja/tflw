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
  buildApiStep, buildCall, buildCapture, buildClick, buildExpect, buildFill, buildGive,
  buildLet, buildLog, buildOpen, buildPause, buildWaitUntilApi, type Step,
} from '@tflw/lang';

import { VOCABULARY } from '../src/vocabulary.ts';
import { statementEditOf } from '../src/ComposePane.tsx';

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

test('the control: a kind no row edits is caught, which is how `WithinBlock` was', () => {
  // `buildWithin` exists, which is what made `WithinBlock` look constructible in the first draft.
  // `statementEditOf` is what decides, and it says no — so the assertion above would have failed.
  const within = ok(buildClick({ locator: { kind: 'button', value: 'x' }, kind: 'single' }));
  assert.ok(statementEditOf(within) !== null, 'the instrument reads a kind that IS editable');
  assert.equal(statementEditOf({ ...within, type: 'WithinBlock' } as unknown as Step), null, 'and refuses one that is not');
});

test('only API sends, and the table is where that is decided', () => {
  // `send` prints a scratch cut off after the selected request and runs it; a browser test's unit
  // is a session, so there is no prefix that can be cut at a statement and still mean anything.
  assert.deepEqual(
    Object.entries(VOCABULARY).filter(([, v]) => v.sends).map(([d]) => d),
    ['api'],
  );
});
