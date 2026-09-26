// The shortcut table and its rule — `M240` `C` (`D1311`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHORTCUTS, isEditable, matches, shortcutFor, spell } from '../src/shortcuts.ts';
import { nextIndex } from '../src/useRovingFocus.ts';

test('every shortcut has one spelling, one label and a stated rule, and no two share either', () => {
  assert.equal(SHORTCUTS.length, 5 + 1, 'five bindings and the legend itself');
  assert.equal(new Set(SHORTCUTS.map((s) => s.keys)).size, SHORTCUTS.length, 'two shortcuts spell the same keys');
  assert.equal(new Set(SHORTCUTS.map((s) => s.label)).size, SHORTCUTS.length, 'two shortcuts share a label');
  assert.equal(new Set(SHORTCUTS.map((s) => s.id)).size, SHORTCUTS.length);
  for (const s of SHORTCUTS) assert.ok(s.when === 'always' || s.when === 'outside-editable', `${s.id}: ${s.when}`);
  // The two an author reaches for from inside a field, by name; everything else waits.
  assert.deepEqual(SHORTCUTS.filter((s) => s.when === 'always').map((s) => s.id), ['save', 'run-file']);
});

test('`matches` is exact on modifiers and case-insensitive on the letter', () => {
  const ev = (key: string, m: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...m });
  assert.equal(matches(ev('s', { metaKey: true }), 'Mod+s'), true, '⌘S on a Mac');
  assert.equal(matches(ev('s', { ctrlKey: true }), 'Mod+s'), true, 'Ctrl+S elsewhere');
  assert.equal(matches(ev('S', { metaKey: true, shiftKey: true }), 'Mod+s'), false, 'Shift is not free');
  assert.equal(matches(ev('s'), 'Mod+s'), false, 'a bare s is typing');
  assert.equal(matches(ev('Enter', { metaKey: true, shiftKey: true }), 'Mod+Shift+Enter'), true);
  assert.equal(matches(ev('Enter', { metaKey: true }), 'Mod+Shift+Enter'), false);
  assert.equal(matches(ev('/'), '/'), true);
  assert.equal(matches(ev('?', { shiftKey: true }), '?'), true, '`?` arrives with Shift held; the key is the whole fact');
  assert.equal(matches(ev('?', { metaKey: true, shiftKey: true }), '?'), false, 'but ⌘? is not `?`');
});

test('roving: arrows wrap, Home and End reach the ends, and the other axis is ignored', () => {
  assert.equal(nextIndex('ArrowRight', 'row', 3, 4), 0, 'wraps forward');
  assert.equal(nextIndex('ArrowLeft', 'row', 0, 4), 3, 'wraps back');
  assert.equal(nextIndex('ArrowDown', 'column', 1, 4), 2);
  assert.equal(nextIndex('ArrowDown', 'row', 1, 4), null, 'a row does not answer ↓');
  assert.equal(nextIndex('Home', 'column', 3, 4), 0);
  assert.equal(nextIndex('End', 'row', 0, 4), 3);
  assert.equal(nextIndex('Enter', 'row', 0, 4), null);
  assert.equal(nextIndex('ArrowRight', 'row', 0, 0), null, 'an empty strip answers nothing');
});

// `isEditable`, `shortcutFor` and `spell` ran only in the browser suites, where a failure names a
// page rather than the rule. This package's tests have no DOM, so `HTMLElement` is a stand-in with
// the two properties the rule reads — installed for each test and removed after it.
class FakeElement {
  constructor(readonly tagName: string, readonly isContentEditable = false) {}
}
const withDom = <T>(fn: () => T): T => {
  const g = globalThis as unknown as { HTMLElement?: unknown };
  const had = 'HTMLElement' in g;
  const was = g.HTMLElement;
  g.HTMLElement = FakeElement;
  try {
    return fn();
  } finally {
    if (had) g.HTMLElement = was;
    else delete g.HTMLElement;
  }
};
const el = (tag: string, editable = false): EventTarget => new FakeElement(tag, editable) as unknown as EventTarget;

test('`isEditable`: a field, a text area, a select and contenteditable are editable; nothing else is', () => {
  withDom(() => {
    for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(isEditable(el(tag)), true, tag);
    assert.equal(isEditable(el('DIV', true)), true, 'contenteditable');
    assert.equal(isEditable(el('BUTTON')), false, 'a button takes keys but is not a field');
    assert.equal(isEditable(null), false, 'no target');
    assert.equal(isEditable({} as EventTarget), false, 'a target that is not an element (the window)');
  });
});

test('`shortcutFor` honours `when`: save fires from inside a field, search does not', () => {
  withDom(() => {
    const key = (k: string, target: EventTarget, m: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) =>
      ({ key: k, target, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...m }) as unknown as KeyboardEvent;
    assert.equal(shortcutFor(key('s', el('INPUT'), { ctrlKey: true }))?.id, 'save', '⌘S is the one an author reaches for mid-field');
    assert.equal(shortcutFor(key('Enter', el('TEXTAREA'), { metaKey: true }))?.id, 'run-file');
    assert.equal(shortcutFor(key('/', el('INPUT'))), null, 'a / typed into a field is a character');
    assert.equal(shortcutFor(key('/', el('DIV')))?.id, 'search');
    assert.equal(shortcutFor(key('?', el('DIV'), { shiftKey: true }))?.id, 'legend');
    assert.equal(shortcutFor(key('x', el('DIV'))), null, 'a key the table does not name');
  });
});

test('`spell` writes the reader’s keyboard: ⌘ run together on a Mac, Ctrl+ elsewhere', () => {
  const g = globalThis as unknown as { navigator?: unknown };
  const had = Object.getOwnPropertyDescriptor(g, 'navigator');
  const as = (platform: string): void => void Object.defineProperty(g, 'navigator', { value: { platform }, configurable: true });
  try {
    as('MacIntel');
    assert.equal(spell('Mod+Shift+Enter'), '⌘⇧↩');
    assert.equal(spell('Mod+s'), '⌘s');
    as('Linux x86_64');
    assert.equal(spell('Mod+Shift+Enter'), 'Ctrl+⇧+↩');
    assert.equal(spell('/'), '/', 'a bare key is itself');
  } finally {
    if (had) Object.defineProperty(g, 'navigator', had);
    else delete g.navigator;
  }
});
