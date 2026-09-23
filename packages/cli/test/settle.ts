// The retry this suite has never had — `M235` `B1`.
//
// ## Why this module exists
//
// `ui-page.test.ts` and `ui-appearance.test.ts` drive a live, re-rendering React page and then read
// it with `node:assert/strict`. Neither half retries. `node:assert` does not, and a *resolved*
// Playwright read does not either — `count()`, `textContent()`, `evaluate()`, `evaluateAll()` and
// `boundingBox()` each answer against whatever the DOM held on one tick. Playwright's own
// auto-retrying assertions live in `@playwright/test`, which these files do not use: they are
// `node:test` plus the `playwright` library.
//
// `M235` §4 counted the consequence. **631 one-shot reads across the two files, three of them
// hardened, and not a single retrying assertion anywhere.** The three that are hardened are the
// three CI happened to catch, one per round, over three rounds — `M234` `A6`'s `countSettling`,
// `M234-06`'s `openMenuAndBox` and `M235` `A1`'s `laidOutChartHeights`. Each was written out by
// hand at the site that failed, and all three are the same loop.
//
// So this is a layer rather than a fourth helper. The three are re-expressed through it (`B1`'s
// acceptance) and `C2` converts the rest.
//
// ## The rule this module exists to make checkable
//
// **Retry on *not measurable*. Never on *measured wrong*.** That is `M141`'s rule, and a retry
// layer is exactly where it gets broken, because the broken version is easier to write and looks
// like it works: loop until the page says what the test wants, and the test can no longer fail.
//
// The two predicates are that rule made into vocabulary, and they are not interchangeable:
//
//   - `untilMeasurable` waits while the value **cannot be read at all** — a canvas that is mounted
//     but unsized measures `0`, a menu that is not in the document has no box. The moment the value
//     is readable it is returned, *whatever it says*, and the caller's assertion judges it. A chart
//     that settles at 200 px fails immediately against an expected 180. This is the safe predicate
//     and it is the one to reach for.
//
//   - `untilEqual` waits until the value **is** the wanted one, which is retrying on the assertion
//     itself. It stays falsifiable only because the budget is bounded: a value that is genuinely and
//     permanently wrong exhausts the attempts and is returned wrong, failing the caller exactly as a
//     single read would have. It is the right shape for a count that is climbing toward a known
//     total and the wrong shape for almost everything else. `rule: 'equal'` is on the object so a
//     reviewer — and `C3`'s lint — can ask a call site which of the two it took.
//
// ## Three smaller decisions, each of which could have gone the other way
//
// **`settle` never throws when the value does not settle; it returns what it last saw.** The caller
// asserts, so the diagnostic is written where the page's other state is in scope — `countSettling`
// was built this way for that reason and it is the reason `M235` §9 chose a local primitive over
// `expect(locator)`, which throws its own message and cannot say what else was on the page.
//
// **A real error from the read propagates.** Not settling is an outcome; a closed page or a bad
// selector is a defect, and a layer that swallowed it would turn every such defect into a silent
// budget exhaustion. Only the caller's own `read` may decide that a failure means *not yet* — which
// is what `openMenuAndBox` does when its bounded `waitFor` rejects, by returning `null`.
//
// **The budget is required, with no default.** It is the falsifiability bound: it is the only
// reason `untilEqual` can fail at all. A default would be copied silently into the sites `C2`
// converts, and the one number that must be a decision at every site would stop being one.

import { isDeepStrictEqual } from 'node:util';

/**
 * What `settle` needs a page for: a pause between attempts.
 *
 * Structurally satisfied by a Playwright `Page`, which is what every call site passes. Declared as
 * the narrow shape rather than importing `Page` so that `settle.test.ts` can drive the loop with a
 * counting fake and assert the budget exactly, with no browser and no wall clock — a bound that is
 * asserted by waiting for it is not asserted.
 */
export interface Sleeper {
  waitForTimeout(ms: number): Promise<void>;
}

/** The last observation, and how many it took to get there. */
export interface Settled<T> {
  /** What the final `read` returned — the settled value, or the last one seen before the budget ran out. */
  readonly value: T;
  /** 1-based; equals `attempts` from the options when `settled` is `false`. */
  readonly attempts: number;
  /** Whether the predicate was ever reached. */
  readonly settled: boolean;
}

/**
 * A reason to stop waiting, carrying its own name and which of the two rules it is.
 *
 * Build one with `untilMeasurable` or `untilEqual` rather than by hand: the constructors are what
 * make `rule` honest, and `rule` is the field a review reads.
 */
export interface Predicate<T> {
  /** The wait, in the reader's words, for the diagnostic: "every chart is mounted and sized". */
  readonly what: string;
  /** Whether this observation ends the wait. */
  readonly reached: (value: T) => boolean;
  /** `'measurable'` retries on unreadable; `'equal'` retries on the assertion. See the head docblock. */
  readonly rule: 'measurable' | 'equal';
}

const show = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/**
 * Wait while the value **cannot be read**, and return it the moment it can — right or wrong.
 *
 * `measurable` answers one question only: *is this a reading at all?* It must not consult what the
 * test expects. `(h) => h.length >= 4 && !h.includes(0)` is a measurability test — a zero-height
 * canvas is not a short chart, it is a chart that has not been laid out. `(h) => h.every((x) => x
 * === 180)` is the same code shape and is the defect: it retries until the page agrees, and the
 * gate can no longer fail.
 */
export const untilMeasurable = <T>(what: string, measurable: (value: T) => boolean): Predicate<T> => ({
  what,
  reached: measurable,
  rule: 'measurable',
});

/**
 * Wait until the value **is** `want` — retrying on the assertion itself, which is only sound because
 * the budget is bounded.
 *
 * Deep equality, so an array or an object works; `Object.is` would compare two equal arrays as
 * unequal and spin out the whole budget every time.
 *
 * Reach for `untilMeasurable` unless the value is genuinely converging on a known total from a
 * known-unreadable state, as a row count does while a pane paints. See the head docblock.
 */
export const untilEqual = <T>(want: T): Predicate<T> => ({
  what: `equal to ${show(want)}`,
  reached: (value: T) => isDeepStrictEqual(value, want),
  rule: 'equal',
});

export interface SettleOptions {
  /** Maximum reads. Must be at least 1. The falsifiability bound — see the head docblock. */
  readonly attempts: number;
  /** Pause between attempts. `0` when the `read` does its own bounded waiting. */
  readonly delayMs: number;
  /** The page, for the pause. */
  readonly page: Sleeper;
}

/**
 * Read until the predicate is reached or the budget runs out. Returns the last observation either
 * way and never throws for failing to settle.
 *
 * The pause is skipped after the final attempt — the only deliberate behavioural difference from
 * the three hand-written loops this replaces, all of which slept once more on their way out. It
 * changes no verdict, only how long a total failure takes to report.
 *
 * **`do…while`, and there is exactly one `read()` in this function on purpose.** The obvious shape
 * — read once before the loop, read again at the bottom — has two, and `B2`'s mutation sweep found
 * that its control could only reach the first: swallowing errors from the *second* left all seven
 * tests green. Putting the pause at the top of the subsequent iteration instead of the bottom of
 * this one collapses both read sites into one and makes the trailing sleep unwriteable as well.
 * Removing a branch beats testing it.
 */
export const settle = async <T>(
  read: () => Promise<T>,
  until: Predicate<T>,
  { attempts, delayMs, page }: SettleOptions,
): Promise<Settled<T>> => {
  // Not a settle failure — a budget of zero would make every call vacuously unsettled, and a
  // negative one silently the same. This is the bound; it has to be real.
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error(`settle: attempts must be a positive integer (got ${show(attempts)})`);
  }
  let attempt = 0;
  let value: T;
  do {
    if (attempt > 0 && delayMs > 0) await page.waitForTimeout(delayMs);
    value = await read();
    attempt += 1;
    if (until.reached(value)) return { value, attempts: attempt, settled: true };
  } while (attempt < attempts);
  return { value, attempts: attempt, settled: false };
};
