// The retry layer's own controls — `M235` `B2`.
//
// **A retry layer is the one place in a test suite where a defect makes every gate above it
// weaker and nothing goes red.** `settle` is about to stand under converted reads across two page
// files (`M235` `C2`); if its bound stops bounding, or if `untilMeasurable` starts waiting for the
// value the caller wanted, the suite keeps passing and stops being able to fail. That is `M141`'s
// defect by construction, delivered wholesale.
//
// So the two predicates get one control each, and they are controls in opposite directions:
//
//   - `untilEqual` must **fail when the value never arrives** — the budget is the only thing making
//     a predicate that retries on the assertion falsifiable at all.
//   - `untilMeasurable` must **fail at once when the value is measurable and wrong** — it is a
//     measurability test, not an expectation, and the moment it consults what the caller wanted it
//     becomes `untilEqual` with no budget in sight.
//
// The plan named the second as the one that would be got wrong, and it is: "wait until the charts
// are 180" and "wait until the charts have a height" are the same five lines of code.
//
// **Everything here runs on a fake page and a scripted read.** No browser, no wall clock. That is
// not only speed — a budget asserted by waiting for it is not asserted, and the exact sleep count
// is what convicts a loop that sleeps once too often or does not stop at all. The fake throws past
// a ceiling so an unbounded loop fails loudly instead of hanging the file, which is the failure
// mode `M108` removed `--test-force-exit` to make visible rather than survivable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settle, untilEqual, untilMeasurable, type Sleeper } from './settle.js';

/** A `Sleeper` that records every pause and refuses to be slept more than the budget allows. */
const fakePage = (ceiling: number): { page: Sleeper; waits: number[] } => {
  const waits: number[] = [];
  return {
    waits,
    page: {
      waitForTimeout: async (ms: number): Promise<void> => {
        waits.push(ms);
        if (waits.length > ceiling) {
          throw new Error(`the loop slept ${waits.length} times against a budget of ${ceiling} — it is not bounded`);
        }
      },
    },
  };
};

/** A scripted read. The final value repeats for ever, so "never arrives" is expressible. */
const scripted = <T>(...values: T[]): { read: () => Promise<T>; calls: () => number } => {
  let n = 0;
  return {
    read: async (): Promise<T> => values[Math.min(n++, values.length - 1)]!,
    calls: () => n,
  };
};

test('`M235` `B2`: `untilEqual` fails when the value never arrives, and the budget is what makes it fail', async () => {
  const { read, calls } = scripted(0, 3, 9, 9, 9);
  const { page, waits } = fakePage(20);
  const outcome = await settle(read, untilEqual(11), { attempts: 6, delayMs: 100, page });

  assert.equal(outcome.settled, false, 'nine is not eleven and no number of looks makes it eleven');
  assert.equal(outcome.value, 9, 'the last thing seen is handed back for the caller to fail on');
  assert.equal(outcome.attempts, 6, 'the whole budget was spent');
  assert.equal(calls(), 6, 'and spent on reads, one per attempt');
  // Five, not six: the pause after the final attempt is time nobody waits for a verdict on. This is
  // the one deliberate behavioural difference from the three hand-written loops this replaced.
  assert.deepEqual(waits, [100, 100, 100, 100, 100], 'it sleeps between attempts and not after the last');
});

test('`M235` `B2`: `untilMeasurable` returns a measurable-and-WRONG value immediately, so the caller can still fail (`M141`)', async () => {
  // The chart case, exactly: four canvases, all laid out, all the wrong height. There is nothing to
  // wait for — the page has answered. A predicate that kept looking here would be waiting for the
  // page to change its mind, and `M227` `A` could never go red again.
  const { read, calls } = scripted([200, 200, 200, 200], [180, 180, 180, 180]);
  const { page, waits } = fakePage(20);
  const outcome = await settle(
    read,
    untilMeasurable('every chart is mounted and sized', (h: number[]) => h.length >= 4 && !h.includes(0)),
    { attempts: 50, delayMs: 100, page },
  );

  assert.equal(outcome.settled, true, 'a laid-out chart is a measurement, whatever it measures');
  assert.deepEqual(outcome.value, [200, 200, 200, 200], 'the wrong height is returned, not waited out');
  assert.equal(outcome.attempts, 1, 'on the first attempt');
  assert.equal(calls(), 1, 'the second script entry — the height the caller wants — is never reached');
  assert.deepEqual(waits, [], 'and nothing was slept');
});

test('`M235` `B1`: `untilMeasurable` waits while the value is unreadable and returns the first real one', async () => {
  // The other direction, and the reason the layer exists: 0 is not a short chart, it is a chart with
  // no layout yet. `M227` `A` failed in 103 ms with four canvases all reading 0.
  const { read } = scripted([], [0, 0, 0, 0], [180, 180, 180, 180], [999]);
  const { page, waits } = fakePage(20);
  const outcome = await settle(
    read,
    untilMeasurable('every chart is mounted and sized', (h: number[]) => h.length >= 4 && !h.includes(0)),
    { attempts: 50, delayMs: 100, page },
  );

  assert.equal(outcome.settled, true);
  assert.deepEqual(outcome.value, [180, 180, 180, 180]);
  assert.equal(outcome.attempts, 3, 'empty, then unsized, then laid out');
  assert.deepEqual(waits, [100, 100], 'two pauses for three attempts');
});

test('`M235` `B1`: `untilEqual` compares by value, so an array settles instead of spinning out the budget', async () => {
  // `Object.is` here would make every array and object call exhaust its budget and return the right
  // answer marked unsettled — a mutation that costs 10 s a site and changes no verdict, which is
  // exactly the kind that survives a suite.
  const { page } = fakePage(20);
  const outcome = await settle(scripted([1, 2], [3, 4]).read, untilEqual([1, 2]), { attempts: 5, delayMs: 10, page });
  assert.equal(outcome.settled, true);
  assert.equal(outcome.attempts, 1);
});

test('`M235` `B1`: a read that throws propagates — on the first attempt and on a later one', async () => {
  // A layer that caught this would turn a closed page or a renamed selector into a silent budget
  // exhaustion reported as "the value never settled", which is the wrong sentence and sends the
  // next round looking at timing.
  const { page, waits } = fakePage(20);
  await assert.rejects(
    () => settle(async () => { throw new Error('locator resolution failed'); }, untilEqual(1), { attempts: 5, delayMs: 10, page }),
    /locator resolution failed/,
  );
  assert.deepEqual(waits, [], 'and it does not quietly retry around it');

  // **The second half is here because the first half alone was not a control.** `B2`'s mutation
  // sweep swallowed errors from the read *inside* the loop and all seven tests stayed green: the
  // first draft of `settle` read once before the loop and once at the bottom, and a read that
  // throws on call one only ever exercises the first. `settle` now has a single read site, which
  // is the actual repair — this case is what stops a future refactor from quietly restoring two.
  let reads = 0;
  const { page: later, waits: laterWaits } = fakePage(20);
  await assert.rejects(
    () => settle(
      async () => { reads += 1; if (reads >= 3) throw new Error('page closed'); return 0; },
      untilEqual(1),
      { attempts: 9, delayMs: 10, page: later },
    ),
    /page closed/,
  );
  assert.equal(reads, 3, 'it threw on the third read and the loop did not carry on past it');
  assert.deepEqual(laterWaits, [10, 10], 'two pauses, then the throw');
});

test('`M235` `B1`: a budget that is not a positive integer is refused, because a budget of zero settles nothing for ever', async () => {
  const { page } = fakePage(20);
  for (const attempts of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(
      () => settle(scripted(1).read, untilEqual(1), { attempts, delayMs: 10, page }),
      /attempts must be a positive integer/,
      `attempts: ${attempts}`,
    );
  }
});

test('`M235` `B1`: each predicate carries which rule it is, so a call site can be reviewed without reading its lambda', async () => {
  // `C3`'s lint reads this field. A site that takes `untilEqual` is making a claim about a bounded
  // convergence and should have to say so out loud.
  assert.equal(untilMeasurable('anything', () => true).rule, 'measurable');
  assert.equal(untilEqual(1).rule, 'equal');
  assert.equal(untilEqual([1, 2]).what, 'equal to [1,2]', 'and names the value it is waiting for');
});
