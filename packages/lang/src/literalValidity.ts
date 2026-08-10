// M124 (`PLAN_M124_LITERAL_DECIDABILITY.md`, D233) — the operand tests the runtime applies before
// it decodes or compiles something, hoisted into `lang` so that `TF054` and the `throw` it predicts
// are running *the same code* rather than two copies of it.
//
// Every other rule M116 moved into the checker was a comparison the checker could restate in one
// line (`masks.length > 0 && matcher.name !== 'matchesSnapshot'`), and "kept identical on purpose"
// was an honest thing to write in a comment. These are not that shape. `hex decode("abc")` is
// invalid for a reason nobody guesses right from memory — odd length, not a bad character — and
// `BASE64_RE` deliberately rejects the URL-safe alphabet that `Buffer.from` happily accepts. A
// checker that re-derived those tests would drift from the runtime on the exact inputs a user is
// most likely to hit, and the drift would show up as a *false* `TF054` on a program that runs fine:
// D137 clause 1, violated by a copy-paste.
//
// So the predicates live here and both sides import them. The messages do not: `eval.ts` and
// `matcher.ts` keep their own `throw` strings, because `conformance.test.ts` matches rows against
// those literal excerpts in those files, and a rule's wording belongs where it fires.
//
// Pure, allocation-light, no I/O — `@tflw/lang`'s standing constraint.

/** `hex`'s alphabet. Exported for the same reason the functions are: one definition, two readers. */
const HEX_RE = /^[0-9a-fA-F]*$/;
/** Standard base64 only — **not** the URL-safe `-`/`_` alphabet, matching `applyTransform`. */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Can `hex decode(input)` succeed?
 *
 * Two conditions, and the second is the one that surprises: `Buffer.from(s, 'hex')` *silently
 * truncates* rather than throwing, so an odd-length string decodes to something shorter instead of
 * failing, which is why the runtime checks the length itself.
 */
export function isDecodableHex(input: string): boolean {
  return HEX_RE.test(input) && input.length % 2 === 0;
}

/** Can `base64 decode(input)` succeed? Same silent-truncation reason for the `% 4` test. */
export function isDecodableBase64(input: string): boolean {
  return BASE64_RE.test(input) && input.length % 4 === 0;
}

/**
 * Can `url decode(input)` succeed?
 *
 * `decodeURIComponent`'s own answer, by trial: the rule is "every `%` starts a well-formed escape
 * that decodes to valid UTF-8", which has no readable regex and no reason to be written twice.
 */
export function isDecodablePercentEncoding(input: string): boolean {
  try {
    decodeURIComponent(input);
    return true;
  } catch {
    return false;
  }
}

/** All three, dispatched the way `applyTransform` does. `encode` never fails, so only `decode`
 *  reaches a test at all — the caller that forgets the direction gets `true`, not a false alarm. */
export function isDecodable(kind: 'base64' | 'hex' | 'url', input: string): boolean {
  if (kind === 'hex') return isDecodableHex(input);
  if (kind === 'base64') return isDecodableBase64(input);
  return isDecodablePercentEncoding(input);
}

/**
 * Does `pattern` compile as a JavaScript regular expression?
 *
 * `new RegExp` is the only authority on this and both matcher sites already call it — the shared
 * function exists so the *checker* asks the identical question, engine version included, instead of
 * approximating it with a bracket counter.
 */
export function regexCompiles(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/** Why `pattern` does not compile, in the engine's own words — the hint half of `TF054`. Returns
 *  `null` when it compiles, so a caller can branch on one call rather than two. */
export function regexCompileError(pattern: string): string | null {
  try {
    new RegExp(pattern);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}
