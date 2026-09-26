// One Tab stop per strip, arrows inside it — `M240` `C` (`D1311`).
//
// The review counted the keyboard's surface at four `onKeyDown`s and three `tabIndex`es in 21 000
// lines (U5): every door, every explorer row and every tab was its own Tab stop, so the pane was
// twenty-five presses away and the first stop on the page was a row's own *remove*. A strip is one
// control with several positions, and the keyboard's word for that is roving focus: the strip is
// one stop, arrows move inside it, `Home`/`End` reach its ends, and the position wraps.
//
// Written against the DOM rather than as a component, so the three strips that need it — the door
// bar, the explorer's tree and the tab strip — keep their markup: the hook reads the container the
// ref points at, finds its controls by selector, gives every one but the current `tabIndex=-1`, and
// handles the keys on the container. The current control is the one that already says it is —
// `aria-pressed="true"`, `data-open="yes"`, `.on` — else the first, so Tab lands where the eye is.
// `tabIndex` is set on the DOM after every render (no dependency list on purpose): React does not
// own that attribute on these controls, and a row re-created by a render would otherwise arrive as
// a stop of its own.

import { useEffect, type RefObject } from 'react';

export interface RovingOptions {
  /** `row` answers ←/→, `column` ↑/↓; both answer `Home`/`End`. */
  readonly orientation: 'row' | 'column';
  /** The controls that rove, relative to the container. */
  readonly selector: string;
}

const CURRENT = '[aria-pressed="true"], [data-open="yes"], .on';

export const controlsOf = (root: HTMLElement, selector: string): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(selector)].filter((el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0);

/** Which control Tab lands on: the one marked current, else the first. */
export const currentOf = (controls: readonly HTMLElement[]): HTMLElement | null => controls.find((el) => el.matches(CURRENT)) ?? controls[0] ?? null;

/** The position a key asks for, or `null` for a key the strip does not answer. Exported so the
 *  rule is testable without a DOM: wraps at both ends, `Home`/`End` reach them. */
export function nextIndex(key: string, orientation: RovingOptions['orientation'], at: number, count: number): number | null {
  if (count === 0) return null;
  const back = orientation === 'row' ? 'ArrowLeft' : 'ArrowUp';
  const forth = orientation === 'row' ? 'ArrowRight' : 'ArrowDown';
  if (key === forth) return (at + 1) % count;
  if (key === back) return (at - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

export function useRovingFocus(ref: RefObject<HTMLElement | null>, { orientation, selector }: RovingOptions): void {
  useEffect(() => {
    const root = ref.current;
    if (root === null) return;
    const controls = controlsOf(root, selector);
    const current = currentOf(controls);
    for (const el of controls) el.tabIndex = el === current ? 0 : -1;
  });
  useEffect(() => {
    const root = ref.current;
    if (root === null) return;
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target === null || !root.contains(target)) return;
      const controls = controlsOf(root, selector);
      const at = controls.indexOf(target);
      if (at < 0) return;
      const to = nextIndex(e.key, orientation, at, controls.length);
      if (to === null) return;
      e.preventDefault();
      for (const el of controls) el.tabIndex = -1;
      const next = controls[to]!;
      next.tabIndex = 0;
      next.focus();
    };
    root.addEventListener('keydown', onKey);
    return () => root.removeEventListener('keydown', onKey);
  }, [ref, orientation, selector]);
}
