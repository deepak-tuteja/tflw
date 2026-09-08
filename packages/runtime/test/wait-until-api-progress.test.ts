// M182a (`D937`, `M181-01`) — the one `wait until api` test that spends REAL TIME, in a file of its
// own so that it overlaps with the rest of the suite instead of adding to it.
//
// WHY IT CANNOT BE SHORTENED. `D937`'s threshold is 3s and its guard is `budget > 2 x threshold`,
// so proving the line appears needs a budget over 6s and then needs to wait it out. The assertion
// that costs the seconds is `elapsed >= 7000`, and it is the one that separates "speaks and keeps
// polling" from "speaks and gives up" — which is the whole of the decision, and the thing `D248`
// refused. A shorter budget would still print a line; it would just stop proving the part that
// matters.
//
// WHY THE OTHER HALF IS NOT HERE. `D937`'s silence guard used to be asserted the same way — a wait
// run for five real seconds while nothing was observed. It is now a boundary assertion on
// `speculativeSpeakAt` in `wait-until-api.test.ts`: a rule about two numbers, tested as a function
// of two numbers, on both sides of where it changes its mind. That is both cheaper and stronger,
// since it pins a value instead of an absence. This test stays end-to-end because what it asserts
// is not a rule about numbers — it is that the step keeps polling after it speaks, and that it says
// so exactly once, which nothing but a real run can show.
//
// WHY THE SECONDS ARE WORTH ACCOUNTING FOR AT ALL. The mutation sweep re-runs this suite once per
// mutation, so a second here is a second multiplied by every runtime mutation. The two waits
// together took `@tflw/runtime` from 60-73s to 81-84s across the CI runs either side of this
// milestone and pushed the sweep's longest shard from 17m58s to 20m11s, past its 20m re-shard
// trigger — a milestone with no registry footprint moving the sweep's critical path. Measured at
// `--test-concurrency=2`, which reproduces the runner. See `ci.yml`'s re-shard log.
//
// So: anything that waits on the wall clock belongs in a file like this one, and anything that does
// not belongs in `wait-until-api.test.ts` beside the rest of the construct's tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';
import { captureStderr } from './__helpers__/stderr.js';

test('M182a: a budget with room to spare says so at 3s, once, and keeps polling to its own deadline (D937)', async () => {
  // `M125c`'s line, on `M125c`'s threshold, for the API form. The three things it must name are the
  // three the locator line names: what is being waited on, why the last poll did not satisfy, and
  // how much longer this will go on. The `once` assertion is the one that matters most — a line per
  // poll at `WAIT_POLL_INTERVAL_MS` would be twelve of them.
  const server = await startFixtureServer({
    '/poll': (_req, res) => json(res, 200, { status: 'pending' }),
  });

  const source = `test "speaks, then carries on"
  wait until api GET /poll
    expect body.status equals "shipped"
`;
  const { program } = parseSource(source);
  const startedAt = performance.now();
  const { result, stderr } = await captureStderr(() => runProgram(program, testConfig(server.baseUrl, { wait: 7000 }), { source }));
  const elapsed = performance.now() - startedAt;

  assert.equal(result.report.ok, false);
  assert.match(stderr, /⏳ tflw: `GET .*\/poll` has not satisfied its condition after 3s/);
  assert.match(stderr, /expected body\.status to equal "shipped", but got "pending"/);
  assert.match(stderr, /still waiting, up to 7s/);
  assert.equal(stderr.match(/⏳ tflw:/g)?.length, 1, 'once per step, not once per poll');
  // The deadline does not move. A progress line that quietly became a shorter timeout would turn a
  // slow service's green suite red — `D248`'s own non-negotiable, restated on this form.
  assert.ok(elapsed >= 7000, `the wait must still run its full budget, took ${elapsed}ms`);

  await server.close();
});
