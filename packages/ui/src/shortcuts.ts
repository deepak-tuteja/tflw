// The page's five shortcuts, as data — `M240` `C` (`D1311`).
//
// One table, read twice: by the listeners that fire the actions and by the legend that lists them,
// so the legend cannot describe a key the page does not answer. `Mod` is ⌘ on a Mac and Ctrl
// elsewhere. `when` is the one rule the review asked for: a shortcut never fires while an input, a
// textarea or a `contenteditable` has focus — except *save* and *run this file*, which are the two
// an author reaches for from inside a field.

export type ShortcutId = 'save' | 'run-file' | 'run-selection' | 'open-file' | 'search' | 'legend';

export interface Shortcut {
  readonly id: ShortcutId;
  /** `Mod+Shift+Enter` — `Mod`, `Shift`, `Alt` modifiers, then the key as `KeyboardEvent.key`. */
  readonly keys: string;
  readonly label: string;
  readonly when: 'always' | 'outside-editable';
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'save', keys: 'Mod+s', label: 'write the file', when: 'always' },
  { id: 'run-file', keys: 'Mod+Enter', label: 'run this file', when: 'always' },
  { id: 'run-selection', keys: 'Mod+Shift+Enter', label: 'run what is selected', when: 'outside-editable' },
  { id: 'open-file', keys: 'Mod+p', label: 'go to the file list', when: 'outside-editable' },
  { id: 'search', keys: '/', label: 'search the project', when: 'outside-editable' },
  { id: 'legend', keys: '?', label: 'this list', when: 'outside-editable' },
];

export const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

/** Whether a keyboard event spells `keys`. Case-insensitive on the letter, exact on the modifiers,
 *  so `Mod+s` does not also fire on `Mod+Shift+s`. Shift is ignored for a punctuation key: `?` only
 *  arrives with Shift held on most layouts, and the key it produced is already the whole fact. */
export function matches(e: { readonly key: string; readonly metaKey: boolean; readonly ctrlKey: boolean; readonly shiftKey: boolean; readonly altKey: boolean }, keys: string): boolean {
  const parts = keys.split('+');
  const key = parts[parts.length - 1]!;
  const mods = new Set(parts.slice(0, -1));
  const mod = e.metaKey || e.ctrlKey;
  if (mods.has('Mod') !== mod) return false;
  const punctuation = key.length === 1 && key.toLowerCase() === key.toUpperCase();
  if (!punctuation && mods.has('Shift') !== e.shiftKey) return false;
  if (mods.has('Alt') !== e.altKey) return false;
  return key.length === 1 ? e.key.toLowerCase() === key.toLowerCase() : e.key === key;
}

/** The shortcut an event fires, honouring `when`, or `null`. */
export function shortcutFor(e: KeyboardEvent): Shortcut | null {
  const editable = isEditable(e.target);
  for (const s of SHORTCUTS) {
    if (s.when === 'outside-editable' && editable) continue;
    if (matches(e, s.keys)) return s;
  }
  return null;
}

/** `Mod+s` as the reader's keyboard spells it. */
export const spell = (keys: string): string => {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return keys.replaceAll('Mod', mac ? '⌘' : 'Ctrl').replaceAll('Shift', '⇧').replaceAll('Enter', '↩').replaceAll('+', mac ? '' : '+');
};
