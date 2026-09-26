// The shortcut table and its rule — `M240` `C` (`D1292`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHORTCUTS, matches } from '../src/shortcuts.ts';
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
