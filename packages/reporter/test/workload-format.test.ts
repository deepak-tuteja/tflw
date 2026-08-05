// M89b (`B3-03`, D-M89-5) — `describeWorkload`, the one formatter of a `LoadWorkloadReport`.
//
// `packages/cli/test/e2e.test.ts` proves the CLI's pre-run line and the summary line are the same
// string for all 10 kinds through the real binary; these are the unit-level statements about what
// that string says.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LoadWorkloadReport } from '@tflw/runtime';
import { describeWorkload } from '../src/workload-format.js';

test('each shape describes itself in its own words, with its own model', () => {
  assert.equal(describeWorkload({ shape: 'ramp', model: 'closed', target: 3, overMs: 200 }), 'ramp to 3 users over 200ms (closed)');
  assert.equal(describeWorkload({ shape: 'ramp', model: 'open', target: 40, overMs: 400 }), 'ramp to 40 rps over 400ms (open)');
  assert.equal(describeWorkload({ shape: 'hold', model: 'closed', target: 3, forMs: 200 }), 'hold 3 users for 200ms (closed)');
  assert.equal(describeWorkload({ shape: 'hold', model: 'open', target: 40, forMs: 400 }), 'hold 40 rps for 400ms (open)');
  assert.equal(
    describeWorkload({ shape: 'step', model: 'closed', stages: [{ target: 2, durationMs: 100 }, { target: 5, durationMs: 150 }] }),
    'step 2 stages up to 5 users over 250ms (closed)',
  );
  assert.equal(
    describeWorkload({
      shape: 'spike',
      model: 'open',
      stages: [{ target: 10, durationMs: 100, ramped: false }, { target: 50, durationMs: 150, ramped: true }],
    }),
    'spike 2 stages up to 50 rps over 250ms (open)',
  );
  assert.equal(describeWorkload({ shape: 'iterations', iterations: 17, vus: 4, perVu: false }), 'run 17 iterations across 4 users');
  assert.equal(describeWorkload({ shape: 'iterations', iterations: 17, vus: 4, perVu: true }), 'run 17 iterations per user across 4 users');
});

test('a single stage is one `stage`, not `1 stage(s)`', () => {
  assert.equal(
    describeWorkload({ shape: 'step', model: 'closed', stages: [{ target: 5, durationMs: 100 }] }),
    'step 1 stage up to 5 users over 100ms (closed)',
  );
});

test('only a ramp says "ramp"', () => {
  // The whole of `B3-03`: every kind used to render as `ramp to N over Tms`, and the two
  // count-based ones as `ramp to N users over 0ms` — a ramp over zero milliseconds, which the
  // grammar cannot express.
  const notRamps: readonly LoadWorkloadReport[] = [
    { shape: 'hold', model: 'closed', target: 3, forMs: 200 },
    { shape: 'step', model: 'closed', stages: [{ target: 5, durationMs: 100 }] },
    { shape: 'spike', model: 'closed', stages: [{ target: 5, durationMs: 100, ramped: true }] },
    { shape: 'iterations', iterations: 50, vus: 2, perVu: false },
    { shape: 'iterations', iterations: 50, vus: 2, perVu: true },
  ];
  for (const w of notRamps) {
    const text = describeWorkload(w);
    assert.ok(!text.startsWith('ramp'), `${w.shape} describes itself as a ramp: ${text}`);
    assert.ok(!text.includes('over 0ms'), `${w.shape} describes itself as spanning zero milliseconds: ${text}`);
  }
});
