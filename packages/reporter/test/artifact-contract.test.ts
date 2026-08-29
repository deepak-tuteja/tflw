// `M160d` (`D812`) — the `durations` half of `ARTIFACT_CONTRACT`, compared against the rule it
// describes.
//
// WHY THIS FILE EXISTS AT ALL. Every other entry in the contract is a *name*, and names cannot
// drift undetected: `sarif.ts` builds its document from those constants as computed keys, so a
// rename has to come through the registry, and `sarif.test.ts` walks a real emitted document to
// catch the other direction. `durations` is the first entry that is a **behaviour**, and behaviour
// has no emit site to make computed. It is therefore a genuine second copy of `D809`'s rule, held
// deliberately (`bundle.mjs` forbids this module importing `duration.ts` — see the block's own
// comment), and a second copy with nothing comparing it is the drift this registry exists to
// prevent. This file is the comparison.
//
// It is the analogue of the SARIF walk: the contract's claim is checked against what the shipped
// function actually does, not against another statement of the claim.
import assert from 'node:assert/strict';
import test from 'node:test';

import { roundDurationMs } from '@tflw/runtime';

import { ARTIFACT_CONTRACT } from '../src/artifact-contract.js';

const { maxRelativeError } = ARTIFACT_CONTRACT.durations;
const relErr = (v: number) => Math.abs(roundDurationMs(v) - v) / v;

/** Log-spaced sweep across six decades — the rule is magnitude-relative, so a linear sweep would
 *  spend all its probes in the top decade and never see the boundary where the bound is reached. */
function* sweep(decades = 6, perDecade = 40000): Generator<number> {
  const n = decades * perDecade;
  for (let i = 0; i <= n; i++) yield 10 ** (-3 + (decades * i) / n);
}

test('D812: `maxRelativeError` is a true upper bound on what `roundDurationMs` reports', () => {
  let worst = 0;
  let worstAt = 0;
  for (const v of sweep()) {
    const e = relErr(v);
    if (e > worst) {
      worst = e;
      worstAt = v;
    }
  }
  assert.ok(
    worst <= maxRelativeError,
    `contract publishes ${maxRelativeError} but roundDurationMs(${worstAt}) errs by ${worst}`,
  );
});

test('D812: the bound is tight — a loose bound would suppress a consumer’s bands for nothing', () => {
  // The supremum is approached, never attained (it needs `v` *just under* the cell boundary), so
  // this asserts closeness rather than equality. Without it the contract could publish 0.5 and
  // still pass the test above, while telling `derive-perf-bands.mjs` that no rung is ever bandable.
  let worst = 0;
  for (const v of sweep()) worst = Math.max(worst, relErr(v));
  assert.ok(
    worst > maxRelativeError * 0.98,
    `contract publishes ${maxRelativeError}, but the worst error found is only ${worst} — the bound is loose`,
  );
});

test('D812: the bound is exactly 1/21, and both branches of D809 reach it the same way', () => {
  // Approach `1.05 x 10^k` from below. `k = 1` is the integer branch (10.4999... -> 10); the rest
  // are the two-significant-digit branch (1.04999... -> 1). One number, one cause: a value that has
  // just crossed into a cell ten times wider than the last.
  //
  // `k = 1` is the LAST one. Above 10 the lattice is integer and stays integer, so it never widens
  // again and the relative error just decays as `0.5 / v` — at `v = 104.99` the error is 1e-9, not
  // 1/21. The first draft of this test swept `k` up to 2 on the assumption that "every decade
  // boundary" was the rule; the rule is "every widening", and there are only four.
  for (const k of [-2, -1, 0, 1]) {
    const v = 1.05 * 10 ** k - 10 ** k * 1e-9;
    assert.ok(
      Math.abs(relErr(v) - 1 / 21) < 1e-6,
      `at v=${v} (k=${k}) the error is ${relErr(v)}, not 1/21`,
    );
  }
  assert.ok(maxRelativeError >= 1 / 21, 'the published bound must not be under the true supremum');
});

test('D812: `rule` names the decision a consumer cites when it suppresses on quantisation', () => {
  assert.equal(ARTIFACT_CONTRACT.durations.rule, 'D809');
});
