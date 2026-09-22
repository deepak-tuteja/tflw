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
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSource } from '@tflw/lang';

import { recordedLine } from '../src/record.js';

/**
 * A recorded line is only worth anything if the grammar takes it back.
 *
 * **Every line of it, since `D1268`.** This indented the first line and left the rest where they
 * were, which was right for as long as a recorded statement was a line — and a block's body then
 * lands at its own head's indent and does not parse. The same fact the page end had to learn.
 */
const parses = (line: string): boolean =>
  parseSource(`test "r"\n${line.split('\n').map((l) => `  ${l}`).join('\n')}\n`).diagnostics.every((d) => d.severity !== 'error');

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

/* ── `M231` — the tab constructs, and the scope an ambiguous name needs ─────────────────────────
 *
 * Both are printed through the language's own builders, like everything else here, which is what
 * keeps arbitrary page content out of the concatenation path (`D1087`). What is new is that two of
 * these statements are **blocks**, so a recorded line is no longer always one line.
 */

test('`M231` `D`: an ambiguous name is printed inside the `within` that disambiguates it (`D1266`)', () => {
  assert.equal(
    line({ kind: 'click', locator: 'button "Add to cart"', value: null, within: 'css "[aria-label=\\"Product 2\\"]"' }),
    'within css "[aria-label=\\"Product 2\\"]"\n  click button "Add to cart"',
  );
  // And the scope is read back through the grammar too — the same discipline the locator gets,
  // for the same reason: its text came off the page.
  const refused = recordedLine({ kind: 'click', locator: 'button "Add to cart"', value: null, within: 'li Product 2' });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.match(refused.reason, /could not read the scope/);
});

test('`M231` `E`: a click that opened a tab is the block that wraps it, never a following switch (`D1268`)', () => {
  assert.equal(
    line({ kind: 'click', locator: 'text "View receipt"', value: null, opensNewTab: true }),
    'switch to new tab\n  click text "View receipt"',
  );
  /* **Outside in**, and the order is load-bearing: the tab block wraps whatever the scope produced,
     because the scope names a subtree of the page the click is still on. Inverted, the `within`
     would scope the *new* tab's document. */
  assert.equal(
    line({ kind: 'click', locator: 'text "View receipt"', value: null, within: 'css "[aria-label=\\"Order 7\\"]"', opensNewTab: true }),
    'switch to new tab\n  within css "[aria-label=\\"Order 7\\"]"\n    click text "View receipt"',
  );
});

test('`M231` `F`: the other two tab statements are the language’s own, and name nothing (`M219-04`)', () => {
  assert.equal(line({ kind: 'switch', locator: null, value: '2' }), 'switch to tab 2');
  assert.equal(line({ kind: 'close', locator: null, value: null }), 'close tab');
});

test('`M231` `G`: `tflw record` writes steps to stdout and everything else to stderr (`M219-01`, `D1265`)', async () => {
  /**
   * **The claim this round rests on, gated at the layer that makes it** — and it is not gated
   * anywhere else. `ui-page.test.ts`'s `M213` `S5` drives a **stub** `tflw record`, deliberately
   * and for good reasons (a page gate cannot produce a human clicking a real browser), so it
   * asserts what the *page* does with the two channels and nothing at all about which channel the
   * real command uses. Shipping `D1265` on that would be a guard narrower than its repair, which
   * this project has a row about (`M167`).
   *
   * The command is driven for real and fails fast: the banner is written **before** the session
   * starts, so pointing Playwright at a browser directory that does not exist makes the launch
   * throw immediately — no window, no display, no lease. What is left is exactly the claim:
   * **stdout is empty**, because nothing was recorded and only steps go there.
   */
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const child = spawn(process.execPath, ['--import', 'tsx', cli, 'record', 'http://127.0.0.1:1/'], {
    env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: join(tmpdir(), 'tflw-no-browsers-here') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let errText = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (c: string) => (out += c));
  child.stderr.on('data', (c: string) => (errText += c));
  /* Killed on a timer as well as awaited, so a build where the launch somehow succeeds leaves no
     browser behind — a gate that orphans a window is the same defect in a test's clothing. */
  const guard = setTimeout(() => child.kill('SIGKILL'), 30_000);
  await new Promise<void>((done) => child.on('close', () => done()));
  clearTimeout(guard);

  assert.equal(out, '', `stdout carries steps and nothing else — a redirect must produce a file whose every line is one:\n${JSON.stringify(out)}`);
  assert.match(errText, /^recording http:\/\/127\.0\.0\.1:1\/ — press Ctrl\+C to stop\./, 'the banner is on stderr, where it cannot be mistaken for a gesture the grammar refused');
});
