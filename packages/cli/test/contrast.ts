// The colour arithmetic behind `D1249`'s contrast claim — `M229` `A`.
//
// WHY THIS IS A MODULE AND NOT TWENTY LINES INSIDE THE GATE. The six-pass review that produced
// `M229` measured `span.seq-kind` at **1.05:1** and filed it as the worst legibility defect on the
// page. It reads **9.82:1**. The colour was `color(srgb 0.681176 0.712549 0.747451)` — what
// Chromium serialises a `color-mix(in srgb, …)` to — and the probe's regex read `0.681` as an
// 8-bit channel, so a light grey was measured as very nearly black. The headline number of a whole
// review pass was wrong, and nothing could have told us: an instrument that returns a plausible
// number is the failure mode `M166` filed under *a gate that fails plausibly beats one that
// refuses, for the worse*.
//
// So the parser lives here, in Node, where it is typechecked and unit-tested against pairs whose
// answers are known independently (`contrast.test.ts`), and the browser half of the gate ships it
// **no arithmetic at all** — it returns CSS strings and lets this file do the maths. That division
// is the design: the risky part is parsing, the part that must run in the page is walking, and
// putting them in the same `page.evaluate` is what made the review's error invisible.
//
// It is deliberately wider than `getComputedStyle` needs. Chromium only ever hands back `rgb()`,
// `rgba()` or `color(srgb …)`, but the unit tests feed it the hex the stylesheet is written in, so
// a token can be checked against a ground without either being routed through a browser first.

/** A colour with its alpha kept — alpha is load-bearing here, unlike in the palette gate. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const clamp = (v: number, hi: number): number => (v < 0 ? 0 : v > hi ? hi : v);

/** `50%` → 0.5, `0.5` → 0.5. Alpha is written both ways and the two are the same value. */
const alpha = (raw: string | undefined): number => {
  if (raw === undefined || raw === '') return 1;
  const t = raw.trim();
  const n = parseFloat(t);
  if (Number.isNaN(n)) return 1;
  return clamp(t.endsWith('%') ? n / 100 : n, 1);
};

/** A `rgb()` channel: `255`, `100%`, or a float (Chromium emits fractional channels). */
const channel = (raw: string): number => {
  const t = raw.trim();
  const n = parseFloat(t);
  if (Number.isNaN(n)) return NaN;
  return clamp(t.endsWith('%') ? (n / 100) * 255 : n, 255);
};

/**
 * Every colour syntax that can reach this gate, resolved to 0–255 channels and a 0–1 alpha.
 *
 * `null` means *this string does not name a colour* — a keyword the browser never resolves, a
 * length, a gradient. A caller must treat that as "do not judge", never as black: the review's
 * parser returned a number for everything it was handed, which is the other half of how it came to
 * report 1.05.
 */
export function parseColor(css: string): Rgba | null {
  const s = css.trim().toLowerCase();
  if (s === '' || s === 'none') return null;
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (!/^[0-9a-f]+$/.test(h)) return null;
    const wide = h.length === 6 || h.length === 8;
    if (h.length !== 3 && h.length !== 4 && !wide) return null;
    const at = (i: number): number => (wide ? parseInt(h.slice(i * 2, i * 2 + 2), 16) : parseInt(h[i]! + h[i]!, 16));
    const hasA = h.length === 4 || h.length === 8;
    return { r: at(0), g: at(1), b: at(2), a: hasA ? at(3) / 255 : 1 };
  }

  // `rgb(1, 2, 3)`, `rgba(1,2,3,.5)`, and the modern `rgb(1 2 3 / 50%)` — one shape, because the
  // separator is the only difference and both spellings are legal for both function names.
  const fn = /^(rgba?|color)\((.*)\)$/s.exec(s);
  if (fn === null) return null;
  const body = fn[2]!;
  const [head, tail] = body.includes('/') ? [body.slice(0, body.indexOf('/')), body.slice(body.indexOf('/') + 1)] : [body, undefined];
  const parts = head.split(/[\s,]+/).filter((p) => p !== '');

  if (fn[1] === 'color') {
    // `color(srgb 0.68 0.71 0.75 / 0.5)` — **the form the review's parser got wrong.** Its channels
    // are 0–1 floats, not 0–255, and the only thing separating the two notations is the colour
    // space keyword sitting in front of them.
    if (parts[0] !== 'srgb') return null; // display-p3, lab, oklch… nothing here emits one; refuse rather than guess
    const ch = parts.slice(1, 4).map((p) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p)));
    if (ch.length !== 3 || ch.some((n) => Number.isNaN(n))) return null;
    const a = tail === undefined && parts.length > 4 ? alpha(parts[4]) : alpha(tail);
    return { r: clamp(ch[0]!, 1) * 255, g: clamp(ch[1]!, 1) * 255, b: clamp(ch[2]!, 1) * 255, a };
  }

  const ch = parts.slice(0, 3).map(channel);
  if (ch.length !== 3 || ch.some((n) => Number.isNaN(n))) return null;
  const a = tail === undefined && parts.length > 3 ? alpha(parts[3]) : alpha(tail);
  return { r: ch[0]!, g: ch[1]!, b: ch[2]!, a };
}

/** Simple alpha compositing, `top` painted over `bottom`. */
export function over(top: Rgba, bottom: Rgba): Rgba {
  if (top.a >= 1) return top;
  if (top.a <= 0) return bottom;
  const a = top.a + bottom.a * (1 - top.a);
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number): number => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

/**
 * The ground a glyph is actually painted on, from a stack of `background-color` values read off an
 * element and its ancestors, **nearest first**.
 *
 * `null` when the stack never reaches an opaque layer — which is a defect in the caller's reading
 * and not a colour, so it is refused rather than papered over with a guessed canvas. `body` in
 * this stylesheet paints `var(--bg)` opaque, so a `null` here means the walk stopped early.
 */
export function flatten(layers: readonly string[]): Rgba | null {
  let out: Rgba = { r: 0, g: 0, b: 0, a: 0 };
  for (let i = layers.length - 1; i >= 0; i--) {
    const c = parseColor(layers[i]!);
    if (c === null) continue;
    out = over(c, out);
  }
  return out.a >= 1 ? out : null;
}

/** WCAG 2.x relative luminance. The 0.03928 threshold is the specification's own, transcribed. */
export function luminance(c: Rgba): number {
  const f = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

/** WCAG 2.x contrast ratio — 1 for identical colours, 21 for black on white. */
export function contrast(a: Rgba, b: Rgba): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The bar this text has to clear — WCAG 1.4.3.
 *
 * **Large text is 18pt, or 14pt bold, and CSS pixels are not points.** 18pt is 24px and 14pt is
 * 18.66px at the 4:3 ratio the specification itself uses, which is why the second number looks
 * arbitrary and is not. Getting this wrong in the lenient direction is how a gate passes text that
 * fails; getting it wrong in the strict direction is how it demands 4.5 of a heading nobody could
 * fault.
 */
export function threshold(fontSizePx: number, fontWeight: number): 3 | 4.5 {
  if (fontSizePx >= 24) return 3;
  if (fontSizePx >= 18.66 && fontWeight >= 700) return 3;
  return 4.5;
}

/** What a reader sees, given an ink, the ground under it, and the opacity stack above both. */
export function effective(ink: Rgba, ground: Rgba, opacity: number): number {
  return contrast(over({ ...ink, a: ink.a * opacity }, ground), ground);
}
