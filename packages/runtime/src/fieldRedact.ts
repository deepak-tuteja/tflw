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
  const bodyPatterns = patterns.filter((p) => p.root === 'body');
  if (bodyPatterns.length === 0) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  let changed = false;
  for (const pattern of bodyPatterns) {
    if (maskPath(parsed, pattern.segments)) changed = true;
  }
  return changed ? JSON.stringify(parsed) : text;
}

/**
 * FS-03 (review findings FU-01/V2-06) — `redact header "<name>"`. HTTP header names are
 * case-insensitive, so matching is too; the literal name `"*"` masks every header, mirroring
 * `body.*`. Applied to both the request and the response header maps in the report-only trace, so
 * `redact header "Authorization"` covers the credential going out *and* a `Set-Cookie` coming back
 * once both are named.
 */
export function redactHeaderFields(headers: Readonly<Record<string, string>>, patterns: readonly RedactPattern[]): Record<string, string> {
  const names = new Set(patterns.filter((p) => p.root === 'header').map((p) => p.name.toLowerCase()));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k] = names.has('*') || names.has(k.toLowerCase()) ? MASK : v;
  return out;
}

/**
 * FS-03 — `redact query "<name>"`. Masks a named query parameter's *value* in a URL while leaving
 * the rest of the URL — origin, path, every other parameter, and the parameter's own name — intact.
 *
 * That precision is the whole reason `query "<name>"` exists rather than a bare `redact url`, which
 * was considered and declined: masking the entire URL destroys the report's ability to say which
 * request this even was, a property `evidence-level.test.ts` protects deliberately ("the URL itself
 * is never trimmed"). Parameter names are matched case-sensitively — unlike header names, query
 * parameters are, and `?Token=` and `?token=` are genuinely different parameters.
 *
 * Best-effort in the same spirit as `redactFields`: a URL that doesn't parse is returned unchanged.
 */
export function redactUrlQuery(url: string, patterns: readonly RedactPattern[]): string {
  const names = patterns.filter((p) => p.root === 'query').map((p) => p.name);
  if (names.length === 0) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  const wildcard = names.includes('*');
  let changed = false;
  for (const key of [...parsed.searchParams.keys()]) {
    if (!wildcard && !names.includes(key)) continue;
    parsed.searchParams.set(key, MASK);
    changed = true;
  }
  return changed ? parsed.toString() : url;
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
  return patterns.some((p) => p.root === 'body' && segmentsMatch(path, p.segments));
}

/** FS-03's taint half, for a `capture header "<name>" as x` subject — the header analogue of
 * `pathMatchesRedactPattern`. Case-insensitive, like HTTP header names and like
 * `redactHeaderFields`. */
export function headerMatchesRedactPattern(name: string, patterns: readonly RedactPattern[]): boolean {
  const lower = name.toLowerCase();
  return patterns.some((p) => p.root === 'header' && (p.name === '*' || p.name.toLowerCase() === lower));
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

export function maskDetailValue(message: string, reprValue: string, mask: string = MASK): string {
  if (reprValue.length < MIN_MASKABLE_LENGTH) return message;
  return message.split(reprValue).join(mask);
}
