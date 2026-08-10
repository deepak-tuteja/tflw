// M125b1 (`FU-18`, D245/D265) — what makes a request target "absolute", stated once.
//
// Four places have to agree on this and they are in three packages: the lexer, which decides
// whether `https://x/y` in method position is a `path` token at all; the checker, which warns about
// an absolute URL (`TF057`, `TF058`); the interpreter's `api` composition, which must not prepend a
// base to one; and `resolveWebUrl`, which must not prepend a `web` base to one and must stop
// demanding that a `web` base exist.
//
// D233's rule, and the failure it exists to prevent is concrete here rather than theoretical. If the
// interpreter's notion were even slightly narrower than the lexer's — `https?:` where the lexer
// takes any RFC 3986 scheme, say — then `api GET ftp://host/f` would lex as a path, skip the
// absolute branch, and be concatenated onto the base URL: `http://localhost:4001/v1/ftp://host/f`.
// That is `FU-18`'s `open` bug reintroduced on the `api` side by a fix for `FU-18`, and every
// assertion downstream would still pass, because a request *was* sent and it *did* get a response.
// One predicate, imported by all four.

/** RFC 3986's scheme grammar — `ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )` — followed by `://`.
 *
 * Deliberately not an `http`/`https` allowlist. The runtime hands the string to `fetch`, so which
 * schemes are acceptable is `fetch`'s question and it answers it with a real error; a lexer that
 * pre-judged it would reject `api GET ws://…` as a syntax error, which is both wrong and the kind
 * of wrong that needs a grammar change to walk back. Refusing at the layer that actually knows is
 * the same reasoning `isHostAllowed` uses when it lets a non-`http(s)` URL through untouched.
 *
 * Anchored, so it answers "does the target *begin* absolutely" — which is the question at every one
 * of the four call sites, including the lexer's, where it is applied to the rest of the line. */
export const ABSOLUTE_URL_START = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/** Whether a request target is written as an absolute URL rather than a path under the active env's
 * base. `/orders` is false, `https://x/orders` is true, and `{base}/orders` — an interpolated
 * literal the checker cannot resolve — is false here and must be treated as undecidable by the
 * caller rather than as "relative": see `TF057`'s guard. */
export function isAbsoluteUrl(target: string): boolean {
  return ABSOLUTE_URL_START.test(target);
}

/** The host an absolute target names, or `null` when it names none it can be sure of.
 *
 * `null` covers two genuinely different cases and the caller must not distinguish them: a relative
 * path (there is no host, the base supplies it) and a URL the `URL` constructor rejects. Both mean
 * "do not decide anything about a host from this string", which is the only use either has. */
export function absoluteUrlHost(target: string): string | null {
  if (!isAbsoluteUrl(target)) return null;
  try {
    return new URL(target).hostname;
  } catch {
    return null;
  }
}
