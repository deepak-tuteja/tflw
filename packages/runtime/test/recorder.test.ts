// `M213` `S5` — the recorder's judgement, which is all in Node (`D1095`).
//
// **THE PAGE SCRIPT REPORTS RAW EVENTS AND DOES NO THINKING**, so everything worth asserting about
// a recording can be asserted without a browser: given this sequence of DOM events, what statements
// does it write, and in what order. A browser is needed to prove the events *arrive*, which is
// `wireRecordSession`'s claim and a different one.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RecordCoalescer, pathOfUrl, type RawRecordEvent, type RecordedAction, type RecordedLocator } from '../src/browser.js';

const raw = (cssPath: string, name: string) => ({
  buttonName: name, fieldName: name, listName: null, textName: null, cssPath, primaryKind: 'field' as const,
});

const ev = (over: Partial<RawRecordEvent> & Pick<RawRecordEvent, 'kind'> & { css: string; name: string }): RawRecordEvent => ({
  raw: raw(over.css, over.name),
  value: over.value ?? null,
  inputType: over.inputType ?? 'text',
  tag: over.tag ?? 'INPUT',
  checked: over.checked ?? null,
  kind: over.kind,
  /* **A click defaults to the one a mouse made**, so every gate written before `D1267` goes on
     asserting about a real gesture rather than accidentally about a synthetic one. The synthetic
     shape is spelled out in full where it is the subject. */
  detail: over.detail ?? (over.kind === 'click' ? 1 : null),
  activeIsTarget: over.activeIsTarget ?? true,
  scopes: over.scopes ?? [],
});

/** The resolver, stubbed: naming an element needs a live page, and what this file is about is what
 *  happens to the events once they are named. */
const resolve = async (r: { cssPath: string }): Promise<RecordedLocator> => ({ syntax: `field ${JSON.stringify(r.cssPath)}`, within: null });

const run = async (events: readonly RawRecordEvent[]): Promise<readonly RecordedAction[]> => {
  const c = new RecordCoalescer();
  const out: RecordedAction[] = [];
  for (const e of events) out.push(...(await c.accept(e, resolve)));
  const tail = c.flush();
  if (tail !== null) out.push({ kind: 'fill', locator: (await resolve(tail.raw)).syntax, value: tail.value });
  return out;
};

test('THE CLAIM: eighteen keystrokes are one `fill`, not eighteen', async () => {
  const typed = [...'alice'].map((_, i) =>
    ev({ kind: 'input', css: '#email', name: 'Email', value: 'alice'.slice(0, i + 1) }),
  );
  const out = await run([...typed, ev({ kind: 'change', css: '#email', name: 'Email', value: 'alice' })]);
  assert.deepEqual(out, [{ kind: 'fill', locator: 'field "#email"', value: 'alice' }]);
});

test('a field the author never blurred is still written — the pending fill is flushed at the end', async () => {
  const out = await run([ev({ kind: 'input', css: '#email', name: 'Email', value: 'al' })]);
  assert.deepEqual(out, [{ kind: 'fill', locator: 'field "#email"', value: 'al' }]);
});

test('THE ORDER IS THE ORDER IT HAPPENED: a pending fill flushes before the click that ended it', async () => {
  const out = await run([
    ev({ kind: 'input', css: '#email', name: 'Email', value: 'a' }),
    ev({ kind: 'click', css: '#go', name: 'Go', tag: 'BUTTON', inputType: null }),
  ]);
  assert.deepEqual(out.map((a) => a.kind), ['fill', 'click']);
});

test('two fields are two fills, in the order they were typed', async () => {
  const out = await run([
    ev({ kind: 'input', css: '#email', name: 'Email', value: 'a' }),
    ev({ kind: 'input', css: '#pass', name: 'Password', value: 'b' }),
  ]);
  assert.deepEqual(out, [
    { kind: 'fill', locator: 'field "#email"', value: 'a' },
    { kind: 'fill', locator: 'field "#pass"', value: 'b' },
  ]);
});

test('a checkbox is a `tick`, never a fill with the string "on"', async () => {
  const out = await run([
    ev({ kind: 'click', css: '#terms', name: 'Accept', inputType: 'checkbox', checked: true }),
    ev({ kind: 'input', css: '#terms', name: 'Accept', inputType: 'checkbox', value: 'on', checked: true }),
    ev({ kind: 'change', css: '#terms', name: 'Accept', inputType: 'checkbox', value: 'on', checked: true }),
  ]);
  assert.deepEqual(out, [{ kind: 'tick', locator: 'field "#terms"', value: null }]);
});

test('…and unticking is `untick`, which is the state and not the gesture', async () => {
  const out = await run([ev({ kind: 'change', css: '#terms', name: 'Accept', inputType: 'checkbox', value: 'on', checked: false })]);
  assert.deepEqual(out, [{ kind: 'untick', locator: 'field "#terms"', value: null }]);
});

test('THE CLAIM: the click on a checkbox is dropped, or the box is ticked twice', async () => {
  // The browser fires `click` then `change`. Writing both would tick the box and then tick it
  // again — which for a checkbox is the opposite of what was recorded, and still runs.
  const out = await run([
    ev({ kind: 'click', css: '#terms', name: 'Accept', inputType: 'checkbox', checked: true }),
    ev({ kind: 'change', css: '#terms', name: 'Accept', inputType: 'checkbox', checked: true }),
  ]);
  assert.equal(out.filter((a) => a.kind === 'click').length, 0);
  assert.equal(out.length, 1);
});

test('a `<select>` is a `select`, with the chosen value', async () => {
  const out = await run([
    ev({ kind: 'click', css: '#size', name: 'Size', tag: 'SELECT', inputType: null }),
    ev({ kind: 'change', css: '#size', name: 'Size', tag: 'SELECT', inputType: null, value: 'large' }),
  ]);
  assert.deepEqual(out, [{ kind: 'select', locator: 'field "#size"', value: 'large' }]);
});

test('a press carries the control it was typed into', async () => {
  const out = await run([ev({ kind: 'press', css: '#search', name: 'Search', value: 'Enter' })]);
  assert.deepEqual(out, [{ kind: 'press', locator: 'field "#search"', value: 'Enter' }]);
});

test('an `open` records a path, because a recorded absolute URL pins the test to this machine', () => {
  assert.equal(pathOfUrl('http://localhost:3000/checkout?step=2', 'http://localhost:3000/'), '/checkout?step=2');
  assert.equal(pathOfUrl('http://localhost:3000/', null), '/');
  // …unless the origin genuinely changed, which the `web` base cannot express.
  assert.equal(pathOfUrl('https://pay.example.com/x', 'http://localhost:3000/'), 'https://pay.example.com/x');
  // A URL that is not one comes back as it is rather than throwing inside the event handler.
  assert.equal(pathOfUrl('not a url', null), 'not a url');
});
