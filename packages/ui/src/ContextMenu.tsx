// The right-click menu (`M218` `A`, `D1145`-`D1149`).
//
// ── WHY A NEW PRIMITIVE AT ALL ─────────────────────────────────────────────────────────────────
//
// Measured before it was written: this page had **zero** `onContextMenu` handlers and **zero**
// `role="menu"` elements, and exactly two floating layers — `.tip` (`z-index: 50`) and the modal
// scrim `.new-thing` (`z-index: 40`). So there was nothing to extend and the shape had to be
// chosen rather than inherited.
//
// ── THE PLACEMENT IS BORROWED, NOT REWRITTEN (`D1145`) ─────────────────────────────────────────
//
// `Tooltip.tsx`'s `place()` is pure, exported and already tested by `packages/ui/test/tooltip.
// test.ts` against the geometry a small window produces. The question a menu asks is the same
// question — *four candidate positions, score them, keep it on screen* — so it calls that function
// with the **pointer** as a 1x1 anchor instead of growing a second answer that drifts from it.
// `right` first therefore puts the menu just below-and-right of the cursor, which is the one thing
// everybody already knows about a context menu, and the left/above flips near an edge come free.
//
// `z-index: 45` sits between them on purpose: above the scrim so a menu is never half-covered,
// below the tip so a menu item can still explain itself on hover.
//
// ── NEVER HIDE WHAT YOU CANNOT DO (`D1146`) ────────────────────────────────────────────────────
//
// A `MenuItem` with `run: null` is **shown, disabled, carrying its reason**. This is not a taste
// call: `M214`'s frozen mutation `the-add-menu-hides-what-it-cannot-add` is this repository's
// measured precedent for a completeness rule freezing a lifeless UI, and `.add-clause` already
// carries `data-add-state` and a refusal line for exactly this shape. *Delete* on an imported file
// reads `3 files import this`, and a menu that simply omitted it would be a menu that lies about
// what the explorer can do.
//
// The type makes the pairing structural rather than remembered: `why` is required exactly when
// `run` is `null`, so a disabled item with no reason does not compile.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { place, type Spot } from './Tooltip';

/** One line of the menu. A disabled item **must** say why (`D1146`) — the union enforces it. */
export type MenuItem =
  | { readonly id: string; readonly label: string; readonly run: () => void; readonly why?: string; readonly danger?: boolean }
  | { readonly id: string; readonly label: string; readonly run: null; readonly why: string; readonly danger?: boolean };

/**
 * What a row hands over when it is right-clicked.
 *
 * `subject` is the menu's header and is the whole of `D1149` made visible: the menu acts on the
 * row under the pointer, never on the selection, and the reader can see which before reading a
 * single item. `kind` exists for the gates — a property about "every file row's menu" needs to
 * find them without matching on labels.
 */
export interface MenuRequest {
  readonly x: number;
  readonly y: number;
  readonly kind: 'file' | 'dir' | 'test' | 'request' | 'step';
  readonly subject: string;
  readonly items: readonly MenuItem[];
}

/**
 * The props a row spreads to become right-clickable — **one function, both triggers** (`D1147`).
 *
 * The pointer path focuses the row before opening, which is not cosmetic: it is what gives
 * `Escape` somewhere to put focus back, and it makes the two triggers converge on one state
 * instead of the keyboard one being a second-class copy.
 *
 * `build` is called at open time rather than on every render, so a row costs nothing until it is
 * actually asked — a project with 275 files renders 275 rows and builds zero item lists.
 */
export interface MenuTrigger {
  readonly onContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  readonly onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
}

export function menuTrigger(open: (r: MenuRequest) => void, build: () => Omit<MenuRequest, 'x' | 'y'>): MenuTrigger {
  return {
    onContextMenu: (e) => {
      e.preventDefault();
      e.stopPropagation();
      // **Focus the row, or the first focusable thing in it.** A sidebar row *is* a `<button>`; a
      // sequence row is an `<li>` wrapping one, and `focus()` on a non-focusable element silently
      // does nothing — which would leave `Escape` with nowhere to put focus back. Asking for the
      // nearest focusable makes the two shapes behave the same without either one changing.
      const host = e.currentTarget;
      const target = host.matches('button, [tabindex]') ? host : host.querySelector<HTMLElement>('button, [tabindex]');
      target?.focus();
      open({ x: e.clientX, y: e.clientY, ...build() });
    },
    onKeyDown: (e) => {
      // The two keys every platform agrees on for "open the menu for what is focused".
      if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return;
      e.preventDefault();
      e.stopPropagation();
      // Anchored on the row, not on a remembered pointer: a keyboard user has no pointer, and a
      // menu appearing wherever the mouse happens to rest would be the worse answer.
      const r = e.currentTarget.getBoundingClientRect();
      open({ x: r.left + 12, y: r.top + r.height, ...build() });
    },
  };
}

const enabledIndexes = (items: readonly MenuItem[]): readonly number[] =>
  items.map((it, i) => (it.run === null ? -1 : i)).filter((i) => i >= 0);

/**
 * The one menu element, mounted once beside `TooltipLayer` and driven by the shell's single
 * `menu` state — which is what makes "at most one menu is open" a fact about the state shape
 * rather than a rule anything has to enforce.
 */
export function ContextMenuLayer({ menu, onClose }: { readonly menu: MenuRequest | null; readonly onClose: () => void }) {
  const box = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [active, setActive] = useState(0);
  /** The menu this component has already reacted to — see the render-phase reset below. */
  const lastMenu = useRef<MenuRequest | null>(null);
  /** `active` for the document listener, which must not be re-registered on every arrow press. */
  const activeRef = useRef(0);

  /**
   * **The placement is discarded during render, not in an effect**, and that ordering is the whole
   * of this block.
   *
   * The first draft nulled `spot` in a `useEffect` keyed on `menu`. Passive effects run *after*
   * layout effects, so the sequence was: render hidden → `useLayoutEffect` measures and places →
   * the passive effect wipes it back to `null`. Measured on the live page: `data-menu-placed`
   * read `measuring` and the menu sat at `0,0` in the corner of the window, every time.
   *
   * Adjusting state while rendering is React's own documented answer for state derived from a
   * changing prop, and it is the right one here: the reset has to be *earlier* than the measure,
   * and nothing that runs after the commit can be.
   */
  activeRef.current = active;

  if (lastMenu.current !== menu) {
    lastMenu.current = menu;
    // Not `setSpot(null)` unconditionally — that would loop.
    if (spot !== null) setSpot(null);
    if (menu !== null) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const first = enabledIndexes(menu.items)[0] ?? 0;
      if (first !== active) setActive(first);
    }
  }

  const close = useCallback((restoreFocus: boolean): void => {
    const back = opener.current;
    onClose();
    if (restoreFocus && back !== null && back.isConnected) back.focus();
  }, [onClose]);

  // **Measured, then placed** — the same hidden-first-frame the tooltip uses, for the same reason:
  // a menu's height is however many items it has, and `place` cannot know whether `above` fits
  // until the element exists.
  useLayoutEffect(() => {
    if (menu === null) { setSpot(null); return; }
    if (box.current === null) return;
    const rect = box.current.getBoundingClientRect();
    setSpot(place(
      { left: menu.x, top: menu.y, width: 1, height: 1 },
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
      null,
    ));
  }, [menu]);

  useEffect(() => {
    if (menu === null) return;
    const outside = (e: Event): void => {
      if (e.target instanceof Node && box.current?.contains(e.target) === true) return;
      close(false);
    };
    const key = (e: KeyboardEvent): void => {
      const order = enabledIndexes(menu.items);
      if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
      if (e.key === 'Tab') { e.preventDefault(); close(true); return; }
      if (order.length === 0) return;
      // **Functional updates, not `active` read from the closure.** Two arrow presses inside one
      // frame both see the same pre-render value otherwise: measured on the live page, `Up` twice
      // from item 1 landed on 0 rather than wrapping to the last item, because React had not
      // re-rendered between them. Real key repeat spans frames and hides it; a held key does not.
      const step = (d: number) => setActive((cur) => {
        const at = order.indexOf(cur);
        return order[(at + d + order.length) % order.length]!;
      });
      if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
      else if (e.key === 'Home') { e.preventDefault(); setActive(order[0]!); }
      else if (e.key === 'End') { e.preventDefault(); setActive(order[order.length - 1]!); }
      else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const it = menu.items[activeRef.current];
        if (it !== undefined && it.run !== null) { const go = it.run; close(true); go(); }
      }
    };
    // `pointerdown` rather than `click`: a menu that outlives the press that dismissed it lets the
    // press land on whatever is underneath, which is the one way a context menu can cause an edit
    // nobody asked for.
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', () => close(false), true);
    window.addEventListener('resize', () => close(false));
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [menu, close]);

  // Focus the menu itself so the keydown listener has a home and the browser stops sending keys to
  // the row underneath. `aria-activedescendant` carries which item is current, which is what lets
  // the items stay plain buttons instead of each stealing focus in turn.
  useEffect(() => {
    if (menu !== null && spot !== null) box.current?.focus();
  }, [menu, spot]);

  if (menu === null) return null;
  return (
    <div
      className="ctx-menu"
      role="menu"
      tabIndex={-1}
      ref={box}
      data-menu={menu.kind}
      data-menu-subject={menu.subject}
      data-menu-placed={spot === null ? 'measuring' : spot.side}
      aria-label={`actions for ${menu.subject}`}
      aria-activedescendant={`ctx-item-${active}`}
      style={{ left: `${spot?.left ?? 0}px`, top: `${spot?.top ?? 0}px`, visibility: spot === null ? 'hidden' : 'visible' }}
    >
      {/* `M240` `E` — a `menu` owns `menuitem`s and nothing else, so the list, its items and the
          two paragraphs are presentation: the name is the menu's `aria-label`, and a refusal's
          reason is the item's description. */}
      <p className="ctx-subject" data-menu-header role="none">{menu.subject}</p>
      <ul role="none">
        {menu.items.map((it, i) => (
          <li key={it.id} role="none">
            <button
              type="button"
              id={`ctx-item-${i}`}
              role="menuitem"
              className={`ctx-item${it.danger === true ? ' danger' : ''}${i === active ? ' on' : ''}`}
              disabled={it.run === null}
              data-menu-item={it.id}
              data-menu-state={it.run === null ? 'disabled' : 'enabled'}
              {...(it.run === null ? { 'aria-describedby': `ctx-why-${i}` } : {})}
              onPointerEnter={() => { if (it.run !== null) setActive(i); }}
              onClick={() => { if (it.run !== null) { const go = it.run; close(true); go(); } }}
            >
              {it.label}
            </button>
            {/* `D1146` — the reason travels with the item that refused, on its own line, the way
                `.clause-refusal` already says a refused removal on the row that refused it. */}
            {it.run === null ? <p className="ctx-why" id={`ctx-why-${i}`} data-menu-why={it.id} role="none">{it.why}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
