// The hover (`M216` `B1`-`B3`, `D1124`-`D1129`).
//
// **The premise this replaces was wrong, and measuring it is what produced this file.** The round
// began with *"no hover info anywhere?"*, and on the live page at 1440x900 **62 of 67** interactive
// controls on the API door already carried a `title`. What failed was never coverage: 40 of those
// sentences are real guidance and good, and the defect is in the four things `title` does not let
// anyone touch — **the ~1 s delay, the position, the OS styling, and the fact that a touch device
// never sees it.** The user's own screenshots are the evidence, and they are all position: the
// tooltip for line 28 covered line 29 whole, and the door bar's covered the env row.
//
// **So this is a presentation change, and deliberately not a writing one.** Not one of the 40
// sentences is rewritten here. `title` is retired across the shell and the Compose pane, the same
// words are handed to an element we control, and the two things the round actually owes the reader
// — *where does it appear* and *is it there at all* — become answerable.
//
// ── TWO WAYS A CONTROL ASKS FOR ONE, AND THE SECOND IS THE INTERESTING ONE ──────────────────────
//
// `data-tip="…"` is an authored sentence. `data-tip-derived` is `D1127`: **the row says nothing of
// its own and the tooltip is computed from whether the row is truncated.** 15 of the 67 titles were
// a row's own visible text said back to it — `POST /baskets` hovering to `POST /baskets` — and 7
// were the useful half of the same thing, a name the ellipsis had cut. Those are the same control
// in two states, not two kinds of control, and `scrollWidth > clientWidth` is the question that
// tells them apart **at the width the reader is currently using**. `A2` turned the pane width from
// a constant into a variable an hour before this was written, so any authored answer would have
// been right at exactly one width. Zero strings, self-correcting, and the round's one contradiction
// — *drop the echoes* and *keep this information* — dissolves rather than being adjudicated.
//
// ── WHERE IT GOES (`D1125`, AMENDED) ───────────────────────────────────────────────────────────
//
// The plan wrote the rule as *below, flipping above when the space below is short*, and `§5` wrote
// the property as *never intersects the control, nor the next row*. **Those two cannot both hold**
// — below a row in a list IS the next row — and the property is the half that came from the
// screenshots, so the property wins and the placement is amended here: **beside first.** Right of
// the control, then left, then above, then below, and the first candidate that stays on screen and
// touches neither the control nor the row under it is the one used. In a list of rows the right
// side is the work pane, which is empty of anything the reader is mid-sentence in.
//
// ── THE ACCESSIBLE NAME IS NOT THE DESCRIPTION (`D1129`) ────────────────────────────────────────
//
// On an icon-only control `title` is doing two jobs: it is the hover text AND it is the accessible
// name, because there is no text node to take that role. Move it to `data-tip` and the button is
// announced as "button" and nothing else — a silent regression no rendering shows. So the tooltip
// is `aria-describedby` and never a name, every icon-only control in the reach carries its own
// `aria-label`, and `ui-page` gates that rather than trusting it.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** The one tooltip element's id — `aria-describedby` points at it while it is shown. */
export const TIP_ID = 'tflw-tip';
/** Ours, and shorter than the platform's ~1 s: a hover held on purpose should not be a wait. */
const DELAY_MS = 280;
const GAP = 8;
const EDGE = 6;

export type Box = { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
export type Side = 'right' | 'left' | 'above' | 'below';
export type Spot = { readonly left: number; readonly top: number; readonly side: Side };

const right = (b: Box): number => b.left + b.width;
const bottom = (b: Box): number => b.top + b.height;
const hits = (a: Box, b: Box): boolean => a.left < right(b) && right(a) > b.left && a.top < bottom(b) && bottom(a) > b.top;

/**
 * Where the tooltip goes — pure, so `packages/ui/test/tooltip.test.ts` can ask it the geometry
 * questions without a browser and `ui-page` can then confirm the same rule on the real page.
 *
 * `avoid` is the row under the control's own row. It is passed in rather than looked up because
 * *what counts as a row* is a DOM question and *where a box fits* is not.
 */
export function place(anchor: Box, tip: { width: number; height: number }, view: { width: number; height: number }, avoid: Box | null): Spot {
  const clampX = (x: number): number => Math.min(Math.max(EDGE, x), Math.max(EDGE, view.width - tip.width - EDGE));
  const clampY = (y: number): number => Math.min(Math.max(EDGE, y), Math.max(EDGE, view.height - tip.height - EDGE));
  const candidates: readonly Spot[] = [
    { side: 'right', left: right(anchor) + GAP, top: clampY(anchor.top) },
    { side: 'left', left: anchor.left - GAP - tip.width, top: clampY(anchor.top) },
    { side: 'above', left: clampX(anchor.left), top: anchor.top - GAP - tip.height },
    { side: 'below', left: clampX(anchor.left), top: bottom(anchor) + GAP },
  ];
  // **Scored rather than first-match**, because every candidate can fail on a small window and a
  // tooltip that cannot be placed perfectly is still worth more than no tooltip. Covering the
  // control it describes is the worst outcome (the reader loses what they are pointing at), then
  // covering the next row, then hanging off the screen.
  let best: Spot | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const box: Box = { left: c.left, top: c.top, width: tip.width, height: tip.height };
    const off = Math.max(0, EDGE - box.left) + Math.max(0, EDGE - box.top)
      + Math.max(0, right(box) - (view.width - EDGE)) + Math.max(0, bottom(box) - (view.height - EDGE));
    const cost = (hits(box, anchor) ? 100000 : 0) + (avoid !== null && hits(box, avoid) ? 10000 : 0) + off;
    if (cost < bestCost) { bestCost = cost; best = c; }
    if (cost === 0) break;
  }
  const won = best!;
  return { side: won.side, left: clampX(won.left), top: clampY(won.top) };
}

/**
 * What a control says on hover, or `null` for silence.
 *
 * **Silence is a real answer here and not a fallback.** A derived row that fits shows nothing at
 * all, which is the whole of `D1127`: the tooltip appears exactly when the row cannot say the thing
 * itself, and disappears again when the reader widens the pane.
 */
export function tipTextFor(el: Element): string | null {
  const authored = el.getAttribute('data-tip');
  if (authored !== null && authored.trim() !== '') return authored;
  if (!el.hasAttribute('data-tip-derived')) return null;
  const holder = el.querySelector('[data-tip-text]') ?? el;
  const text = (holder.textContent ?? '').trim();
  // The `+ 1` is a rounding guard: a sub-pixel layout makes `scrollWidth` one larger than
  // `clientWidth` on rows that are visibly whole, which would have put a tooltip on every row.
  return text !== '' && holder.scrollWidth > holder.clientWidth + 1 ? text : null;
}

const ASKS = '[data-tip], [data-tip-derived]';

/** The row a control sits in, and the row after it — the thing `D1125` refuses to cover. */
function nextRowOf(el: Element): Element | null {
  const own = el.closest('li, tr, .row, .field');
  return own === null ? null : own.nextElementSibling;
}

const boxOf = (r: DOMRect): Box => ({ left: r.left, top: r.top, width: r.width, height: r.height });

/**
 * Mounted once, by `App`. One element, one listener set, and no wrapper around any of the 67
 * controls — which is what made retiring `title` a mechanical change rather than 67 edits with 67
 * chances to drop an `aria-label`.
 */
export function TooltipLayer() {
  const [shown, setShown] = useState<{ readonly text: string } | null>(null);
  const [spot, setSpot] = useState<Spot | null>(null);
  const anchor = useRef<Element | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  const hide = useCallback(() => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    anchor.current?.removeAttribute('aria-describedby');
    anchor.current = null;
    setShown(null);
    setSpot(null);
  }, []);

  const show = useCallback((el: Element, delay: number) => {
    if (anchor.current === el) return;
    const text = tipTextFor(el);
    if (text === null) { hide(); return; }
    hide();
    anchor.current = el;
    const go = () => {
      timer.current = null;
      // The description, never the name (`D1129`).
      el.setAttribute('aria-describedby', TIP_ID);
      setShown({ text });
    };
    if (delay === 0) go();
    else timer.current = setTimeout(go, delay);
  }, [hide]);

  useEffect(() => {
    const under = (target: EventTarget | null): Element | null =>
      target instanceof Element ? target.closest(ASKS) : null;
    const over = (e: Event): void => {
      const el = under(e.target);
      if (el === null) { if (anchor.current !== null) hide(); return; }
      show(el, DELAY_MS);
    };
    // **Keyboard focus shows it at once and with no delay.** A delay is a device for not flashing
    // a tooltip at a pointer crossing the page; a focus is nobody's accident.
    const focus = (e: Event): void => {
      const el = under(e.target);
      if (el === null) { hide(); return; }
      show(el, 0);
    };
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') hide(); };
    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('focusin', focus, true);
    document.addEventListener('focusout', hide, true);
    document.addEventListener('keydown', esc, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('focusin', focus, true);
      document.removeEventListener('focusout', hide, true);
      document.removeEventListener('keydown', esc, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [hide, show]);

  // **Measured, then placed.** The element is rendered hidden at the origin for one frame so its
  // own height is a fact rather than an estimate — a tooltip wraps to two lines or three depending
  // on the sentence, and `place` needs the height to know whether above fits.
  useLayoutEffect(() => {
    if (shown === null || box.current === null || anchor.current === null) return;
    const rect = box.current.getBoundingClientRect();
    const next = nextRowOf(anchor.current);
    setSpot(place(
      boxOf(anchor.current.getBoundingClientRect()),
      { width: rect.width, height: rect.height },
      { width: window.innerWidth, height: window.innerHeight },
      next === null ? null : boxOf(next.getBoundingClientRect()),
    ));
  }, [shown]);

  if (shown === null) return null;
  return (
    <div
      id={TIP_ID}
      role="tooltip"
      className="tip"
      ref={box}
      data-tip-shown={spot === null ? 'measuring' : spot.side}
      style={{ left: `${spot?.left ?? 0}px`, top: `${spot?.top ?? 0}px`, visibility: spot === null ? 'hidden' : 'visible' }}
    >
      {shown.text}
    </div>
  );
}
