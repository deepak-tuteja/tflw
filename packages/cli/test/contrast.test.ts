// The instrument's own control — `M229` `A` (`D1249`).
//
// **This file exists because the review that asked for the contrast gate got contrast wrong.** Its
// first parser read `color(srgb 0.681176 0.712549 0.747451)` as an 8-bit triple and reported
// **1.05:1** for text that measures **9.68:1**, and that number was the headline of a review pass
// before it was caught by hand. A gate whose reading is wrong in the alarming direction wastes a
// round; wrong in the reassuring direction it certifies an unreadable page. Neither is visible from
// inside the gate, because both produce a plausible float.
//
// So every pair below is one whose answer is fixed somewhere other than in `contrast.ts`: the two
// extremes the specification itself states, the greys the WCAG community has published to four
// significant figures as the minimum on white, and the exact string that broke the review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, over, flatten, contrast, threshold, effective, type Rgba } from './contrast.js';

const near = (actual: number, want: number, tol: number, what: string): void => {
  assert.ok(Math.abs(actual - want) <= tol, `${what}: ${actual.toFixed(4)} is not ${want} ± ${tol}`);
};
const rgba = (s: string): Rgba => {
  const c = parseColor(s);
  assert.notEqual(c, null, `${s} did not parse`);
  return c!;
};

test('the two ratios the specification states outright', () => {
  near(contrast(rgba('#000000'), rgba('#ffffff')), 21, 1e-9, 'black on white');
  near(contrast(rgba('#ffffff'), rgba('#000000')), 21, 1e-9, 'white on black — the ratio is symmetric');
  near(contrast(rgba('#3fb950'), rgba('#3fb950')), 1, 1e-9, 'a colour on itself');
});

test('the published greys on white, which fix the scale between those extremes', () => {
  // `#767676` is the canonical "darkest grey that still passes AA on white" and `#777777` the
  // lightest that fails — the pair every contrast checker is demonstrated with. If the maths here
  // drifted by even a percent one of these two would cross 4.5 and this test would say so.
  near(contrast(rgba('#767676'), rgba('#ffffff')), 4.54, 0.005, '#767676 on white');
  near(contrast(rgba('#777777'), rgba('#ffffff')), 4.48, 0.005, '#777777 on white');
  assert.ok(contrast(rgba('#767676'), rgba('#ffffff')) >= 4.5, '#767676 is the passing one');
  assert.ok(contrast(rgba('#777777'), rgba('#ffffff')) < 4.5, '#777777 is the failing one');
});

test('`color(srgb …)` is 0–1 floats, and reading them as 8-bit channels is what broke the review', () => {
  // The exact string measured off `span.seq-kind` on 2026-09-22. Chromium serialises every
  // `color-mix(in srgb, …)` this way, so this is not an exotic form — it is most of the tints in
  // `styles.css`.
  //
  // **The hand-correction was wrong too, by a smaller margin, and this line is where that was
  // found.** The review recovered from its 1.05 by computing the ratio by hand and publishing
  // **9.82**; the arithmetic here says **9.683**, and the difference is that the hand pass rounded
  // the three float channels to 8-bit integers before taking luminance (which gives 9.716 — not
  // 9.82 either). A number checked by hand once is a number nobody has checked.
  const painted = rgba('color(srgb 0.681176 0.712549 0.747451)');
  near(painted.r, 173.7, 0.1, 'red channel');
  near(painted.g, 181.7, 0.1, 'green channel');
  near(painted.b, 190.6, 0.1, 'blue channel');
  near(contrast(painted, rgba('#08090b')), 9.683, 0.001, 'the real ratio on Terminal’s ground');
  // The failure the review actually shipped, stated as the thing that must NOT happen. Reading
  // `0.681` as a channel gives a colour indistinguishable from the ground.
  assert.ok(contrast(painted, rgba('#08090b')) > 9, 'the 8-bit misreading is back — this is `M229`’s own instrument defect');
});

test('every syntax the page can hand back, and the refusals', () => {
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3, a: 1 });
  assert.deepEqual(parseColor('rgba(1, 2, 3, 0.5)'), { r: 1, g: 2, b: 3, a: 0.5 });
  assert.deepEqual(parseColor('rgb(1 2 3 / 50%)'), { r: 1, g: 2, b: 3, a: 0.5 });
  assert.deepEqual(parseColor('#abc'), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(parseColor('#aabbccff'), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(parseColor('transparent'), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(parseColor('color(srgb 1 0 0)'), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor('color(srgb 1 0 0 / 0.25)'), { r: 255, g: 0, b: 0, a: 0.25 });
  // **A refusal is the point of the `null` return.** Each of these is something a walk over a real
  // document hands back, and a parser that answered would answer with a colour nobody painted.
  for (const nope of ['', 'none', 'currentcolor', '12px', 'linear-gradient(to right, red, blue)', '#12345', 'color(display-p3 1 0 0)', 'rgb(1, 2)']) {
    assert.equal(parseColor(nope), null, `${nope || '(empty)'} was read as a colour`);
  }
});

test('compositing: a translucent ink and a stack of translucent grounds', () => {
  // Half-white over black is mid-grey, which is the one compositing answer that needs no library
  // to check.
  const half = over(rgba('rgba(255, 255, 255, 0.5)'), rgba('#000000'));
  near(half.r, 127.5, 0.01, 'the composite of half white on black');
  assert.equal(half.a, 1);

  // A tint over a tint over an opaque ground — the shape `color-mix` tints actually make on this
  // page, where a panel sits on a panel sits on the body.
  const ground = flatten(['color(srgb 1 1 1 / 0.2)', 'rgba(0, 0, 0, 0)', '#101010']);
  assert.notEqual(ground, null);
  near(ground!.r, 0.8 * 16 + 0.2 * 255, 0.01, 'the two layers composited in order');

  // **A stack that never reaches an opaque layer is refused.** `body` paints `var(--bg)` opaque, so
  // a `null` here means the caller's walk stopped short — which is a bug in the reading, and a
  // guessed canvas would hide it behind a plausible ratio.
  assert.equal(flatten(['rgba(0, 0, 0, 0)', 'transparent']), null);
  assert.equal(flatten([]), null);
});

test('the large-text bar is 18pt and 14pt bold, in CSS pixels', () => {
  assert.equal(threshold(13, 400), 4.5);
  assert.equal(threshold(23.9, 400), 4.5);
  assert.equal(threshold(24, 400), 3, '18pt is 24px');
  assert.equal(threshold(18.66, 700), 3, '14pt bold is 18.66px bold');
  assert.equal(threshold(18.66, 600), 4.5, 'bold is 700, and 600 is not it');
  assert.equal(threshold(18.65, 700), 4.5);
});

test('opacity is a property of the reading, not of the ink', () => {
  // `styles.css` dims several things with `opacity` rather than with a quieter token — a locked
  // step, an unmatched file row, the source gutter. A gate that read `color` alone would grade all
  // of them as if they were painted at full strength, which is the whole reason this helper exists.
  const ink = rgba('#c9d1d9');
  const ground = rgba('#08090b');
  near(effective(ink, ground, 1), contrast(ink, ground), 1e-9, 'opacity 1 changes nothing');
  assert.ok(effective(ink, ground, 0.38) < effective(ink, ground, 1), 'dimming did not lower the reading');
  near(effective(ink, ground, 0), 1, 1e-9, 'fully transparent ink is its own ground');
});
