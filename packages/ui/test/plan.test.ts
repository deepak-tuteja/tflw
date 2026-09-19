// `M213` `S6` — the workload a LOAD test is composing, as points on a clock (`D1103`).
//
// **THE CURVE IS THE CLAIM AND IT IS PURE**, which is the whole reason it is a module rather than
// a `useMemo` in a component: *what shape is a `spike` with four stages* is a question about the
// language's own workload spec, and a question with an answer belongs where a gate can ask it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { plannedCurve, plannedSeries, levelAt, overlayIsComparable } from '../src/plan.ts';

const input = (over: Partial<Parameters<typeof plannedCurve>[0]>) => ({
  shape: 'ramp' as const, unit: 'users' as const, target: 50, seconds: 30, stages: [], ...over,
});

test('THE DIFFERENCE A `<select>` HID: a ramp starts at nothing and a hold does not', () => {
  assert.deepEqual(plannedCurve(input({ shape: 'ramp' })), [{ at: 0, level: 0 }, { at: 30, level: 50 }]);
  assert.deepEqual(plannedCurve(input({ shape: 'hold' })), [{ at: 0, level: 50 }, { at: 30, level: 50 }]);
});

test('a shape with no clock returns `null` rather than a line to an invented right-hand edge', () => {
  // `run N iterations across M users` ends when the iterations are done, and how long that takes
  // is a property of the system under test — which is the thing being measured.
  assert.equal(plannedCurve(input({ shape: 'iterations' })), null);
  assert.equal(plannedCurve(input({ shape: 'iterations-per-user' })), null);
  assert.equal(plannedSeries(input({ shape: 'iterations' })), null);
});

test('a `step` is a staircase — each stage jumps to its level and holds it', () => {
  const curve = plannedCurve(input({
    shape: 'step',
    stages: [{ mode: 'jump', target: 10, durationMs: 5000 }, { mode: 'jump', target: 20, durationMs: 5000 }],
  }))!;
  assert.deepEqual(curve, [
    { at: 0, level: 0 }, { at: 0, level: 10 }, { at: 5, level: 10 },
    { at: 5, level: 10 }, { at: 5, level: 20 }, { at: 10, level: 20 },
  ]);
});

test('a `spike`’s ramp stage is a slope, and its jump stage is a vertical edge', () => {
  const curve = plannedCurve(input({
    shape: 'spike',
    stages: [{ mode: 'ramp', target: 100, durationMs: 10_000 }, { mode: 'jump', target: 5, durationMs: 10_000 }],
  }))!;
  // The ramp contributes no edge at its own start: the line from 0 to 100 IS the ramp.
  assert.deepEqual(curve.slice(0, 2), [{ at: 0, level: 100 }, { at: 10, level: 100 }]);
  // …and the jump after it does, which is what makes it a spike rather than a second slope.
  assert.deepEqual(curve.slice(2), [{ at: 10, level: 100 }, { at: 10, level: 5 }, { at: 20, level: 5 }]);
});

test('`step` has no spelling for a ramp, so a `ramp` stage in one is still drawn as a jump', () => {
  // `buildWorkload` refuses a ramp stage inside a `step`, and the form does not offer one — a
  // picture that drew a slope there would be showing something the file cannot say.
  const curve = plannedCurve(input({ shape: 'step', stages: [{ mode: 'ramp', target: 9, durationMs: 1000 }] }))!;
  assert.deepEqual(curve, [{ at: 0, level: 0 }, { at: 0, level: 9 }, { at: 1, level: 9 }]);
});

test('the sampled series is exact, not an approximation — a ramp is a straight line', () => {
  const series = plannedSeries(input({ shape: 'ramp', target: 30, seconds: 30 }))!;
  assert.equal(series.x.length, 31);
  assert.equal(series.y[0], 0);
  assert.equal(series.y[10], 10);
  assert.equal(series.y[30], 30);
});

test('at a jump’s own instant the LATER level wins — a jump at second 5 is the new level from 5 on', () => {
  const curve = plannedCurve(input({ shape: 'step', stages: [{ mode: 'jump', target: 10, durationMs: 5000 }, { mode: 'jump', target: 20, durationMs: 5000 }] }))!;
  assert.equal(levelAt(curve, 4), 10);
  assert.equal(levelAt(curve, 5), 20);
  assert.equal(levelAt(curve, 10), 20);
  // Outside the curve it holds its ends rather than extrapolating.
  assert.equal(levelAt(curve, -1), 0);
  assert.equal(levelAt(curve, 99), 20);
});

test('THE CLAIM: the achieved curve is comparable to an `rps` plan and NOT to a `users` plan', () => {
  // `TimelinePoint` records arrivals — `count`, `rps`, `errorRate`, the duration percentiles —
  // and never concurrency. Drawing the achieved arrival rate against a `users` plan would put two
  // different quantities in one comparison, which reads as an answer and is not one.
  assert.equal(overlayIsComparable('rps'), true);
  assert.equal(overlayIsComparable('users'), false);
});
