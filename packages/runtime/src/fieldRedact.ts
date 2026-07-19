// Declarative field redaction (`redact body.email, body.*.address` — SPEC §3.4, PLAN decision
// 101d, enterprise arc cluster 2). Distinct from `redact.ts`'s taint-based secret redaction: this
// is path-based and masks a field regardless of whether its value ever came from `env(...)`.
// Applied only where the report-only trace is built (`redactRequest`/`redactResponse` in
// interpreter.ts) — the raw trace `expect`/`capture` read from is never touched, so assertions
// keep working on the real value even when the report shows it masked.

import type { RedactPathSegment, RedactPattern } from '@tflw/lang';

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
