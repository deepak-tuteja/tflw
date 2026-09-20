// Where the hover goes (`M216` `B2`, `D1125` as amended).
//
// **The placement rule is the one part of this round with real geometry in it**, and geometry is
// cheap to ask about here and expensive to ask about through a browser — so `place` is pure and
// this file asks it every awkward shape, while `ui-page` confirms the same rule once on the page
// the reader actually gets. Neither file can replace the other: this one cannot see a stylesheet
// and that one cannot afford twelve window sizes.
//
// **The property under test came from three screenshots, not from a preference.** The user filed
// the tooltip for line 28 covering line 29 whole, and the door bar's covering the env row beneath
// it. So the claim is *never the control, never the row under it*, and the plan's original wording
// — below, flipping above — is amended, because below a row in a list **is** the next row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { place, type Box } from '../src/Tooltip';

const VIEW = { width: 1440, height: 900 };
const TIP = { width: 300, height: 40 };
const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height });
const rectOf = (spot: { left: number; top: number }, tip: { width: number; height: number }): Box =>
  box(spot.left, spot.top, tip.width, tip.height);
const hits = (a: Box, b: Box): boolean =>
  a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;

test('`M216` `B2`: a row in a list is described beside itself, never over the row under it', () => {
  // A sidebar row at the pane's width, with the next row directly beneath — the exact shape of the
  // screenshot that started this.
  const row = box(8, 300, 300, 24);
  const next = box(8, 324, 300, 24);
  const spot = place(row, TIP, VIEW, next);
  assert.equal(spot.side, 'right', 'the work pane is to the right and is empty of what the reader is reading');
  assert.equal(hits(rectOf(spot, TIP), row), false, 'it does not cover the control it describes');
  assert.equal(hits(rectOf(spot, TIP), next), false, 'nor the row under it — which is the whole defect');
});

test('`M216` `B2`: with no room on the right it goes to the left, and still touches neither', () => {
  const row = box(1100, 300, 300, 24);
  const next = box(1100, 324, 300, 24);
  const spot = place(row, TIP, VIEW, next);
  assert.equal(spot.side, 'left');
  assert.ok(spot.left >= 6 && spot.left + TIP.width <= 1400, 'and it is on the screen');
  assert.equal(hits(rectOf(spot, TIP), row), false);
  assert.equal(hits(rectOf(spot, TIP), next), false);
});

test('`M216` `B2`: a full-width control has no side, so it flips to whichever of above/below is free', () => {
  // **This is where the plan's original vertical rule survives**, and it is the only place it can:
  // a control spanning the window has no horizontal neighbour to sit beside.
  const wide = box(8, 700, 1424, 28);
  const above = place(wide, TIP, VIEW, null);
  assert.equal(above.side, 'above', 'low on the page, the space below is shorter than the tooltip');
  assert.equal(hits(rectOf(above, TIP), wide), false);

  const high = box(8, 40, 1424, 28);
  const below = place(high, TIP, VIEW, null);
  assert.equal(below.side, 'below', 'and high on the page it is the other way round');
  assert.equal(hits(rectOf(below, TIP), high), false);
});

test('`M216` `B2`: it stays on the screen in every corner, and covering the control is the last thing it will do', () => {
  // Twelve anchors around the edges and the middle, at three tooltip heights — the cheap sweep
  // that a browser gate cannot afford and that catches an off-by-one in a clamp.
  const heights = [24, 60, 160];
  const anchors: Box[] = [];
  for (const left of [0, 700, 1400]) {
    for (const top of [0, 440, 880]) anchors.push(box(left, top, 40, 20));
  }
  anchors.push(box(-20, 450, 40, 20), box(1430, 450, 40, 20), box(700, -10, 40, 20));
  for (const height of heights) {
    const tip = { width: 300, height };
    for (const anchor of anchors) {
      const spot = place(anchor, tip, VIEW, null);
      const rect = rectOf(spot, tip);
      assert.ok(rect.left >= 6 - 0.001, `left edge (${JSON.stringify({ anchor, height, spot })})`);
      assert.ok(rect.top >= 6 - 0.001, `top edge (${JSON.stringify({ anchor, height, spot })})`);
      assert.ok(rect.left + tip.width <= VIEW.width - 6 + 0.001, 'right edge');
      assert.ok(rect.top + tip.height <= VIEW.height - 6 + 0.001, 'bottom edge');
      assert.equal(hits(rect, anchor), false, `nothing covers its own control (${JSON.stringify({ anchor, height, spot })})`);
    }
  }
});

test('`M216` `B2`: when nothing can be clear of both, the control wins and the row loses', () => {
  // **A tie has to be broken somewhere and the order is not arbitrary.** Losing sight of the thing
  // the pointer is on is worse than losing sight of the row below it, so on a window too small for
  // any clear placement the tooltip is allowed over the next row and never over the anchor.
  const tiny = { width: 320, height: 200 };
  const anchor = box(10, 90, 300, 24);
  const next = box(10, 114, 300, 24);
  const spot = place(anchor, { width: 300, height: 80 }, tiny, next);
  assert.equal(hits(rectOf(spot, { width: 300, height: 80 }), anchor), false, 'never the control');
});
