// The page's one spelling of a moment — `M240` `F` (`M239-05`).
//
// `when` was `toLocaleString()` with no options, so a run chip said `9/25/2026, 7:56:44 PM` with
// no zone beside report ids spelling the same instant `2026-09-25T17-56-44-949Z`. Three forms from
// one input at a fixed zone, so the test does not depend on where the runner is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ago, when } from '../src/format.ts';

const ISO = '2026-09-25T17:56:44.949Z';

test('`when` is the date, the clock and the offset of the zone it is read in', () => {
  assert.equal(when(ISO, 'Europe/Berlin'), '2026-09-25 19:56:44 +02:00');
  assert.equal(when(ISO, 'UTC'), '2026-09-25 17:56:44 +00:00', 'UTC spells its offset like every other zone');
  assert.equal(when(ISO, 'America/New_York'), '2026-09-25 13:56:44 -04:00');
  assert.equal(when(ISO, 'Asia/Kolkata'), '2026-09-25 23:26:44 +05:30', 'a half-hour zone keeps its minutes');
  // Midnight is `00`, not `24`: `hourCycle: 'h23'` is what makes that so, and this is the case it exists for.
  assert.equal(when('2026-09-25T22:00:00Z', 'Europe/Berlin'), '2026-09-26 00:00:00 +02:00');
  // The mutation this reddens on: `toLocaleString()` back.
  assert.doesNotMatch(when(ISO, 'Europe/Berlin'), /PM|AM|\//);
  assert.equal(when('not a date'), 'not a date', 'an unparseable stamp is returned as itself');
});

test('`ago` is the shortest true relative form, and the chip and its tip describe one instant', () => {
  const then = Date.parse(ISO);
  assert.equal(ago(ISO, then + 12_000), '12s ago');
  assert.equal(ago(ISO, then + 3 * 60_000), '3m ago');
  assert.equal(ago(ISO, then + 5 * 3_600_000), '5h ago');
  assert.equal(ago(ISO, then + 2 * 86_400_000), '2d ago');
  assert.equal(ago(ISO, then - 5_000), '0s ago', 'a clock ahead of the report is not a negative age');
  assert.equal(ago('nope', then), 'at an unrecorded time');
});
