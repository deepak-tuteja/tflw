// `M213` `S5` — `tflw record`'s line, which is where a recorder's risk lives (`D1095`).
//
// **EVERY VALUE IN A RECORDED LINE COMES FROM THE PAGE.** An `<option>`'s text, a field's
// contents, a button's label — all of it is content somebody else wrote, arriving at a function
// whose job is to emit a program. That is the whole reason `D1087`'s *build it, never concatenate
// it* is not fastidiousness here: one apostrophe in a product name turns a concatenated
// `select … with 'Women's'` into a file that does not lex, and the recording is gone the moment
// the window closes.
//
// So the claims below are about **quoting, refusing, and the one thing a recorder knows that a
// person would have to remember** — which control a key was pressed into.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';

import { recordedLine } from '../src/record.js';

/** A recorded line is only worth anything if the grammar takes it back. */
const parses = (line: string): boolean =>
  parseSource(`test "r"\n  ${line}\n`).diagnostics.every((d) => d.severity !== 'error');

const line = (action: Parameters<typeof recordedLine>[0]): string => {
  const out = recordedLine(action);
  assert.ok(out.ok, out.ok ? '' : out.reason);
  assert.ok(parses(out.text), `the grammar must take this back: ${out.text}`);
  return out.text;
};

test('a click becomes a click, with the locator the session verified', () => {
  assert.equal(line({ kind: 'click', locator: 'button "Sign in"', value: null }), 'click button "Sign in"');
});

test('THE CLAIM: a value the page supplied is quoted by the printer, not by this code', () => {
  // The apostrophe is the cheap case; the quote and the backslash are the ones that end a
  // concatenated string early and leave the rest of the line as syntax.
  for (const value of ['Women\'s', 'say "hi"', 'back\\slash', 'line\nbreak', '{not interpolation}']) {
    const out = recordedLine({ kind: 'fill', locator: 'field "Name"', value });
    assert.ok(out.ok, out.ok ? '' : out.reason);
    assert.ok(parses(out.text), `a value the page supplied must not be able to break the file: ${JSON.stringify(value)} → ${out.text}`);
  }
});

test('a select carries its chosen value, and is a `select` rather than a fill', () => {
  assert.equal(line({ kind: 'select', locator: 'field "Size"', value: 'large' }), 'select "large" from field "Size"');
});

test('a tick and an untick are the state, not the gesture', () => {
  assert.equal(line({ kind: 'tick', locator: 'field "Accept"', value: null }), 'tick field "Accept"');
  assert.equal(line({ kind: 'untick', locator: 'field "Accept"', value: null }), 'untick field "Accept"');
});

test('a press carries the control it was typed into — page-level `press` goes to whatever has focus', () => {
  // *Whatever has focus* is a fact about the moment rather than about the test, which is why a
  // recorder records the control and a person writing by hand usually forgets to.
  assert.equal(line({ kind: 'press', locator: 'field "Search"', value: 'Enter' }), 'press "Enter" on field "Search"');
  assert.equal(line({ kind: 'press', locator: null, value: 'Control+A' }), 'press "Control+A"');
});

test('an open records the path, which is what `open` resolves against the env’s `web` base', () => {
  assert.equal(line({ kind: 'open', locator: null, value: '/checkout' }), 'open "/checkout"');
});

test('a locator the grammar does not admit is refused with a reason, never emitted', () => {
  const out = recordedLine({ kind: 'click', locator: 'button Sign in', value: null });
  assert.equal(out.ok, false);
  if (!out.ok) assert.match(out.reason, /could not read the locator/);
});

test('the control: the refusal is the grammar’s, not a string check of this file’s', () => {
  // `css "…"` is a perfectly good locator and looks nothing like the one above; if the refusal
  // were a hand-rolled shape test it would have to know that, and this is what says it does not.
  assert.equal(line({ kind: 'click', locator: 'css "#totals .amount"', value: null }), 'click css "#totals .amount"');
});
