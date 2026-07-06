// Evaluate the closed matcher set (P#13) against a resolved subject value. M1 covers the API
// matchers; the UI-only matchers (has value, is visible/…) throw "not supported on an API
// subject" until the browser half (M3). API expects evaluate once and fail fast (P#15).

import type { Matcher } from '@tflw/lang';
import { describe, evalValue, RuntimeError, type EvalCtx } from './eval.js';

export interface MatchOutcome {
  readonly ok: boolean;
  readonly message: string;
}

export function evalMatcher(subjectLabel: string, actual: unknown, matcher: Matcher, ctx: EvalCtx): MatchOutcome {
  const raw = rawMatch(actual, matcher, ctx);
  const ok = matcher.negated ? !raw.ok : raw.ok;
  const not = matcher.negated ? 'not ' : '';
  const expectation = `${subjectLabel} ${not}${raw.phrase}${raw.expected ? ' ' + raw.expected : ''}`;
  const message = ok ? expectation : `expected ${expectation}, but got ${repr(actual)}`;
  return { ok, message };
}

interface RawMatch {
  readonly ok: boolean;
  readonly phrase: string;
  readonly expected: string;
}

function rawMatch(actual: unknown, matcher: Matcher, ctx: EvalCtx): RawMatch {
  switch (matcher.name) {
    case 'equals': {
      const expected = evalValue(matcher.value!, ctx);
      return { ok: deepEqual(actual, expected), phrase: 'to equal', expected: repr(expected) };
    }
    case 'contains': {
      const expected = evalValue(matcher.value!, ctx);
      return { ok: contains(actual, expected), phrase: 'to contain', expected: repr(expected) };
    }
    case 'matches': {
      const expected = String(evalValue(matcher.value!, ctx));
      let ok = false;
      try {
        ok = new RegExp(expected).test(String(actual));
      } catch {
        throw new RuntimeError(`invalid regex in matcher: ${repr(expected)}`);
      }
      return { ok, phrase: 'to match', expected: repr(expected) };
    }
    case 'greaterThan': {
      const expected = num(evalValue(matcher.value!, ctx), 'is greater than');
      return { ok: num(actual, 'is greater than') > expected, phrase: 'to be greater than', expected: String(expected) };
    }
    case 'lessThan': {
      const expected = num(evalValue(matcher.value!, ctx), 'is less than');
      return { ok: num(actual, 'is less than') < expected, phrase: 'to be less than', expected: String(expected) };
    }
    case 'hasCount': {
      const expected = num(evalValue(matcher.value!, ctx), 'has count');
      const len = count(actual);
      return { ok: len === expected, phrase: 'to have count', expected: String(expected) };
    }
    default:
      throw new RuntimeError(`matcher \`${matcher.name}\` is not supported on an API subject (it is UI-only, added in M3)`);
  }
}

/** Structural equality: object key *order* never matters (only membership + values); array
 * *order* still does (arrays are sequences, not sets) — P#46's documented key-order-sensitivity
 * gap, fixed here instead of via a raw `JSON.stringify` comparison. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((el, i) => deepEqual(el, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const aRec = a as Record<string, unknown>;
    const bRec = b as Record<string, unknown>;
    const aKeys = Object.keys(aRec);
    const bKeys = Object.keys(bRec);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k) => Object.prototype.hasOwnProperty.call(bRec, k) && deepEqual(aRec[k], bRec[k]));
  }
  return false;
}

function contains(actual: unknown, expected: unknown): boolean {
  if (typeof actual === 'string') return actual.includes(String(expected));
  if (Array.isArray(actual)) return actual.some((el) => deepEqual(el, expected));
  throw new RuntimeError(`\`contains\` expects a string or array subject, got ${describe(actual)}`);
}

function count(actual: unknown): number {
  if (Array.isArray(actual)) return actual.length;
  if (typeof actual === 'string') return actual.length;
  throw new RuntimeError(`\`has count\` expects an array (or string) subject, got ${describe(actual)}`);
}

function num(value: unknown, matcher: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) throw new RuntimeError(`\`${matcher}\` expects a number, got ${describe(value)}`);
  return n;
}

/** Human-readable literal for messages: strings quoted, everything else JSON-ish. */
export function repr(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return JSON.stringify(value);
  return JSON.stringify(value) ?? String(value);
}
