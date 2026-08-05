// M89a — the one formatter every sink now renders a threshold's numbers through
// (`cli-summary.ts`, `html.ts`, `junit.ts`). Two behaviours are under test: `D-M89-1`'s
// `actual: null`, and `B3-15` — a defect found *while writing* this module, not by the plan.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LoadThresholdResult } from '@tflw/runtime';
import { formatThresholdActual, formatThresholdTarget } from '../src/threshold-format.js';

const th = (over: Partial<LoadThresholdResult>): LoadThresholdResult => ({ label: 'p95 duration', op: 'lessThan', target: 100, actual: 42, ok: true, ...over });

test('a duration threshold renders milliseconds, rounded', () => {
  assert.equal(formatThresholdActual(th({ actual: 42.6 })), '43ms');
  assert.equal(formatThresholdTarget(th({ target: 100 })), '100ms');
});

test('an unscoped error-rate threshold renders a percentage', () => {
  const t = th({ label: 'error rate', actual: 0.04, target: 0.05 });
  assert.equal(formatThresholdActual(t), '4.00%');
  assert.equal(formatThresholdTarget(t), '5.00%');
});

test('`B3-15`: a *scoped* error-rate threshold renders a percentage too — it used to render as `0ms`', () => {
  // The units test was `label === 'error rate'`, an exact match. `evaluateThresholds` builds a
  // scoped threshold's label as `${baseLabel} for "${scope}"`, so this one missed the branch
  // entirely and fell through to the duration formatter: `Math.round(0.04)` → `0ms`. A 4 % error
  // rate reported as a 0-millisecond latency, in both the console and `report.html`.
  const t = th({ label: 'error rate for "checkout"', actual: 0.04, target: 0.05 });
  assert.equal(formatThresholdActual(t), '4.00%', 'a scoped error rate must not fall through to the milliseconds branch');
  assert.equal(formatThresholdTarget(t), '5.00%');
});

test('a scoped *duration* threshold still renders milliseconds', () => {
  const t = th({ label: 'p95 duration for "checkout"', actual: 300, target: 800 });
  assert.equal(formatThresholdActual(t), '300ms');
  assert.equal(formatThresholdTarget(t), '800ms');
});

test('`D-M89-1`: `actual: null` renders as words, never as a number', () => {
  const t = th({ actual: null, ok: false });
  const rendered = formatThresholdActual(t);
  assert.equal(rendered, 'no successful iterations');
  // The whole reason for the `null`: `0ms` here would read as the fastest possible run, when what
  // actually happened is that every single request failed.
  assert.doesNotMatch(rendered, /\d/, 'a no-data verdict must not be rendered as any number at all');
  assert.doesNotMatch(rendered, /null/);
});

test('`D-M89-1`: the target is still shown alongside a null actual — the author needs to see what was asked for', () => {
  assert.equal(formatThresholdTarget(th({ actual: null, target: 250, ok: false })), '250ms');
});
