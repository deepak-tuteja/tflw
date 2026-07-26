// UI matcher evaluation (M3a, SPEC §9.4): the state/value/count matchers of §6.2 read against a
// live `Locator` instead of a JSON response value. A separate module from `matcher.ts` (mirroring
// how `evalRequestMatcher` already sits beside `evalMatcher` for `request connects`/`fails`) since
// every read here is an async DOM query, not a synchronous value lookup.

import type { Matcher } from '@tflw/lang';
import { RuntimeError, evalValue, type EvalCtx } from './eval.js';
import { repr, truncate, type MatchOutcome } from './matcher.js';
import type { PWLocator } from './browser.js';

interface RawUiMatch {
  readonly ok: boolean;
  readonly phrase: string;
  readonly expected: string;
  /** Set when the "got" side should show a live-read value instead of a generic locator
   * description (`has value`/`has count`) — mirrors `matcher.ts`'s `RawMatch.gotOverride`. */
  readonly gotOverride?: string;
}

/** One read of the current DOM state against a UI matcher — the caller (`interpreter.ts`) is
 * responsible for the retry-until-timeout polling loop (D5: tflw owns 100% of the assertion retry
 * loop, only actionability is delegated to Playwright); this function always evaluates *once*.
 * `count` is the caller's zero-wait resolution snapshot (`resolveLocatorSnapshot`, browser.ts) —
 * threaded through explicitly (rather than re-derived from `pwLocator.count()` here) so "zero
 * elements" gets one deterministic meaning per matcher instead of depending on which of
 * Playwright's own state methods happen to tolerate a non-existent element and which throw. */
export async function evalUiMatcherOnce(subjectLabel: string, pwLocator: PWLocator, matcher: Matcher, ctx: EvalCtx, count: number): Promise<MatchOutcome> {
  const raw = await rawUiMatch(pwLocator, matcher, ctx, count);
  const ok = matcher.negated ? !raw.ok : raw.ok;
  const not = matcher.negated ? 'not ' : '';
  const expectation = `${subjectLabel} ${not}${raw.phrase}${raw.expected ? ' ' + truncate(raw.expected) : ''}`;
  const message = ok ? expectation : `expected ${expectation}, but got ${truncate(raw.gotOverride ?? '(see above)')}`;
  return { ok, message };
}

const NO_ELEMENT = 'no matching element';

async function rawUiMatch(pwLocator: PWLocator, matcher: Matcher, ctx: EvalCtx, count: number): Promise<RawUiMatch> {
  switch (matcher.name) {
    case 'visible': {
      const ok = count === 1 && (await pwLocator.isVisible());
      return { ok, phrase: 'to be visible', expected: '', ...(count === 0 ? { gotOverride: NO_ELEMENT } : {}) };
    }
    case 'hidden': {
      const ok = count === 0 || !(await pwLocator.isVisible());
      return { ok, phrase: 'to be hidden', expected: '' };
    }
    case 'enabled': {
      const ok = count === 1 && (await pwLocator.isEnabled());
      return { ok, phrase: 'to be enabled', expected: '', ...(count === 0 ? { gotOverride: NO_ELEMENT } : {}) };
    }
    case 'disabled': {
      const ok = count === 1 && !(await pwLocator.isEnabled());
      return { ok, phrase: 'to be disabled', expected: '', ...(count === 0 ? { gotOverride: NO_ELEMENT } : {}) };
    }
    case 'checked': {
      const ok = count === 1 && (await pwLocator.isChecked());
      return { ok, phrase: 'to be checked', expected: '', ...(count === 0 ? { gotOverride: NO_ELEMENT } : {}) };
    }
    case 'hasValue': {
      const expected = String(evalValue(matcher.value!, ctx));
      if (count === 0) return { ok: false, phrase: 'to have value', expected: repr(expected), gotOverride: NO_ELEMENT };
      const actual = await pwLocator.inputValue();
      return { ok: actual === expected, phrase: 'to have value', expected: repr(expected), gotOverride: repr(actual) };
    }
    case 'hasCount': {
      const expected = Number(evalValue(matcher.value!, ctx));
      return { ok: count === expected, phrase: 'to have count', expected: String(expected), gotOverride: String(count) };
    }
    default:
      throw new RuntimeError(
        `matcher \`${matcher.name}\` is not supported on a UI locator subject — only the state/value/count matchers (visible, hidden, enabled, disabled, checked, has value, has count) are valid here (SPEC §9.4)`,
      );
  }
}
