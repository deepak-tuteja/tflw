// Declarative field redaction (`redact body.email, body.*.address` — SPEC §3.4, PLAN decision
// 101d, enterprise arc cluster 2). Distinct from `redact.ts`'s taint-based secret redaction: this
// is path-based and masks a field regardless of whether its value ever came from `env(...)`.
// Applied only where the report-only trace is built (`redactRequest`/`redactResponse` in
// interpreter.ts) — the raw trace `expect`/`capture` read from is never touched, so assertions
// keep working on the real value even when the report shows it masked.

import type { PathSegment, RedactPathSegment, RedactPattern } from '@tflw/lang';

const MASK = '[redacted]';

/**
 * Best-effort: returns `text` unchanged if it isn't valid JSON, or if no pattern matches
 * anything in it. Masking is opportunistic, never a hard requirement — a non-JSON body simply
 * can't be field-redacted (`evidence none`/`headers-only` are the tool for that case).
 */
export function redactFields(text: string, patterns: readonly RedactPattern[]): string {
  if (patterns.length === 0) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  let changed = false;
  for (const pattern of patterns) {
    if (maskPath(parsed, pattern.segments)) changed = true;
  }
  return changed ? JSON.stringify(parsed) : text;
}

/** Mutates `value` in place, masking every leaf reached by `segments`. A `wildcard` segment
 * recurses into every key of an object or every element of an array (both are plain JS objects
 * from `JSON.parse`'s point of view, so `Object.keys` covers both for free). Returns true if
 * anything was actually masked. */
function maskPath(value: unknown, segments: readonly RedactPathSegment[]): boolean {
  if (segments.length === 0 || value === null || typeof value !== 'object') return false;
  const [seg, ...rest] = segments as [RedactPathSegment, ...RedactPathSegment[]];
  const obj = value as Record<string, unknown>;
  if (seg.kind === 'wildcard') {
    let changed = false;
    for (const key of Object.keys(obj)) changed = applySegment(obj, key, rest) || changed;
    return changed;
  }
  return applySegment(obj, seg.name, rest);
}

function applySegment(obj: Record<string, unknown>, key: string, rest: readonly RedactPathSegment[]): boolean {
  if (!(key in obj)) return false;
  if (rest.length === 0) {
    obj[key] = MASK;
    return true;
  }
  return maskPath(obj[key], rest);
}

/**
 * Gap #15 (TFLW-GAPS.md): `redact` only ever rewrote the request/response JSON trace above —
 * a `capture`/`expect` step's own rendered detail text (`firstPhone = "+1-234-…" (captured)`,
 * `body.phone to equal "+1-234-…"`) is composed straight from the live value and never passed
 * through `redactFields`, since it isn't a JSON body to rewrite. This checks whether a `body.<path>`
 * subject (the only kind `redact` patterns can target) is covered by any configured pattern, so the
 * interpreter can mask that step's own detail text too — same exact-depth-reaches-a-leaf semantics
 * as `maskPath` above, a `wildcard` pattern segment matching either an object-key or array-index
 * subject segment.
 */
export function pathMatchesRedactPattern(path: readonly PathSegment[], patterns: readonly RedactPattern[]): boolean {
  return patterns.some((p) => segmentsMatch(path, p.segments));
}

function segmentsMatch(path: readonly PathSegment[], pattern: readonly RedactPathSegment[]): boolean {
  if (path.length !== pattern.length) return false;
  return path.every((seg, i) => {
    const p = pattern[i]!;
    return p.kind === 'wildcard' || (seg.kind === 'prop' && seg.name === p.name);
  });
}

/**
 * Substring-masks an already-`repr()`'d value's own text wherever it appears in a `capture`/
 * `expect` detail message — used only once `pathMatchesRedactPattern` has confirmed the step's
 * subject is `redact`-covered. Deliberately a plain value-based replace (not JSON-structure-aware
 * like `redactFields`): the message is already a rendered sentence, not a JSON document to
 * re-serialize. A trivially short `reprValue` (e.g. `true`/a 1-digit number) is left unmasked —
 * same reasoning as `redact.ts`'s `MIN_REDACTABLE_LENGTH`, a short value would blot out unrelated
 * substrings (a status code, an index) elsewhere in the same message.
 */
const MIN_MASKABLE_LENGTH = 6;

export function maskDetailValue(message: string, reprValue: string): string {
  if (reprValue.length < MIN_MASKABLE_LENGTH) return message;
  return message.split(reprValue).join(MASK);
}
