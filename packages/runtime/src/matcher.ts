// Evaluate the closed matcher set (P#13) against a resolved subject value. M1 covers the API
// matchers; the UI-only matchers (has value, is visible/…) throw "not supported on an API
// subject" until the browser half (M3). API expects evaluate once and fail fast (P#15).

import type { Matcher } from '@tflw/lang';
import { describe, evalValue, RuntimeError, type EvalCtx } from './eval.js';

export interface MatchOutcome {
  readonly ok: boolean;
  readonly message: string;
}

/** Bounds every failure message's "expected"/"got" text (TFLW-GAPS.md gap #8): a bare untruncated
 * `JSON.stringify` on a large response body used to dump the whole thing — one 11,248-char line
 * for a 61-item order — into the CLI and report.html alike. A sane fixed default (no new config
 * surface, matching P#13's closed-feature-set philosophy) keeps every failure message readable;
 * the full response body remains inspectable via the step's own request/response capture in
 * report.html regardless of this cap. */
const MAX_DIFF_CHARS = 2000;

export function truncate(s: string, max: number = MAX_DIFF_CHARS): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… (truncated, showing ${max} of ${s.length} chars — see report.html for the full response body)`;
}

export function evalMatcher(subjectLabel: string, actual: unknown, matcher: Matcher, ctx: EvalCtx): MatchOutcome {
  const raw = rawMatch(actual, matcher, ctx);
  const ok = matcher.negated ? !raw.ok : raw.ok;
  const not = matcher.negated ? 'not ' : '';
  const expectation = `${subjectLabel} ${not}${raw.phrase}${raw.expected ? ' ' + truncate(raw.expected) : ''}`;
  const message = ok ? expectation : `expected ${expectation}, but got ${truncate(raw.gotOverride ?? repr(actual))}`;
  return { ok, message };
}

interface RawMatch {
  readonly ok: boolean;
  readonly phrase: string;
  readonly expected: string;
  /** Set only for a genuine (non-negated) `matches subset` mismatch: replaces the whole-actual
   * dump with just the mismatched/missing keys, since the matcher already knows which literal
   * keys it checked (gap #8's "subset-aware diff"). Left unset everywhere else, including a
   * negated subset match that unexpectedly succeeded — there the whole actual object (truncated
   * like any other matcher) is the right thing to show. */
  readonly gotOverride?: string;
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
    case 'matchesSubset': {
      const expected = evalValue(matcher.value!, ctx);
      const ok = subsetMatch(actual, expected);
      // Reached only when both are confirmed plain objects — subsetMatch() itself throws
      // otherwise, before `ok` could be assigned.
      const gotOverride = ok
        ? undefined
        : describeSubsetMismatches(actual as Record<string, unknown>, expected as Record<string, unknown>);
      return { ok, phrase: 'to match subset', expected: repr(expected), gotOverride };
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
    case 'connects':
    case 'fails':
      throw new RuntimeError(`matcher \`${matcher.name}\` is only valid on a \`request\` subject (\`expect request ${matcher.name}\`, SPEC §6.2.2)`);
    default:
      throw new RuntimeError(`matcher \`${matcher.name}\` is not supported on an API subject (it is UI-only, added in M3)`);
  }
}

/** `expect`/`check request connects`/`fails` (SPEC §6.2.2, PLAN decision 18, enterprise arc
 * cluster 5.5) — evaluated separately from `evalMatcher`/`rawMatch` above (bypassed entirely by
 * `evaluateExpect`, the same way `matchesSchema` already is), because there's no response value
 * to navigate to: the "actual" here is *whether a connection-level error occurred at all*, not
 * something read off a `ResponseTrace`. `connectionError` is the redacted message the interpreter
 * caught from `execApi` for this request, or `null` if it connected normally. */
export function evalRequestMatcher(matcher: Matcher, connectionError: string | null, ctx: EvalCtx): MatchOutcome {
  let raw: { ok: boolean; phrase: string; expected: string };
  if (matcher.name === 'connects') {
    raw = { ok: connectionError === null, phrase: 'to connect', expected: '' };
  } else if (matcher.name === 'fails') {
    if (matcher.value) {
      const pattern = String(evalValue(matcher.value, ctx));
      let matches = false;
      try {
        matches = connectionError !== null && new RegExp(pattern).test(connectionError);
      } catch {
        throw new RuntimeError(`invalid regex in matcher: ${repr(pattern)}`);
      }
      raw = { ok: matches, phrase: 'to fail matching', expected: ' ' + repr(pattern) };
    } else {
      raw = { ok: connectionError !== null, phrase: 'to fail', expected: '' };
    }
  } else {
    throw new RuntimeError(`matcher \`${matcher.name}\` is not valid on a \`request\` subject — use \`connects\`/\`fails\``);
  }
  const ok = matcher.negated ? !raw.ok : raw.ok;
  const not = matcher.negated ? 'not ' : '';
  const expectation = `request ${not}${raw.phrase}${raw.expected}`;
  const got = connectionError !== null ? connectionError : 'the request connected successfully';
  const message = ok ? expectation : `expected ${expectation}, but got: ${truncate(got)}`;
  return { ok, message };
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

/** `matches subset {...}` (P#14): every key in `expected` must be present in `actual` with an
 * equal value; extra keys on `actual` are ignored. Recurses into nested object *values* so a
 * subset literal can itself be partial at any depth; array values still need a full `deepEqual`
 * (arrays are sequences, not sets — same order-sensitivity `equals` already has, P#13's closed
 * feature set deliberately doesn't add a separate "array subset" mode). */
function subsetMatch(actual: unknown, expected: unknown): boolean {
  if (!isPlainObject(expected)) throw new RuntimeError(`\`matches subset\` expects an object literal operand, got ${describe(expected)}`);
  if (!isPlainObject(actual)) throw new RuntimeError(`\`matches subset\` expects an object subject, got ${describe(actual)}`);
  return Object.keys(expected).every((key) => {
    if (!Object.prototype.hasOwnProperty.call(actual, key)) return false;
    const actualVal = actual[key];
    const expectedVal = expected[key];
    if (isPlainObject(expectedVal)) return isPlainObject(actualVal) && subsetMatch(actualVal, expectedVal);
    return deepEqual(actualVal, expectedVal);
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Walks the same shape `subsetMatch` just walked, but collects only the keys that actually
 * differ (missing, or present with a different value) instead of returning a boolean — gap #8's
 * "only prints the mismatched keys" half. Dotted paths flatten nested mismatches (`customer.name`)
 * so a deep subset literal still reads as one flat, scannable list. */
function subsetMismatches(actual: Record<string, unknown>, expected: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(expected)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!Object.prototype.hasOwnProperty.call(actual, key)) {
      out[path] = '<missing>';
      continue;
    }
    const actualVal = actual[key];
    const expectedVal = expected[key];
    if (isPlainObject(expectedVal)) {
      if (!isPlainObject(actualVal)) out[path] = actualVal;
      else Object.assign(out, subsetMismatches(actualVal, expectedVal, path));
    } else if (!deepEqual(actualVal, expectedVal)) {
      out[path] = actualVal;
    }
  }
  return out;
}

function describeSubsetMismatches(actual: Record<string, unknown>, expected: Record<string, unknown>): string {
  const mismatches = subsetMismatches(actual, expected);
  const totalKeys = Object.keys(actual).length;
  return `${repr(mismatches)} (only the ${Object.keys(mismatches).length} mismatched key(s) shown, out of ${totalKeys} total on the response)`;
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
