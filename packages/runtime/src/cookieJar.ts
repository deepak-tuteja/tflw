// A first-class cookie jar (SPEC §3.3/§16 P#33): tracks cookies by name, applies `Set-Cookie`
// attribute semantics (`Max-Age`/`Expires`, last-value-wins per name, `Max-Age<=0` deletes),
// and re-serializes only `name=value` pairs on the next request. Fixes the hard crash the old
// "capture the raw header, replay it as a `Cookie` header" workaround hit the moment a response
// set 2+ cookies at once (the newline-joined multi-`Set-Cookie` capture embeds a literal `\n` in
// what becomes an HTTP header value — real HTTP clients reject that outright as header injection,
// not a graceful failure).
//
// Deliberately narrower than a real browser's cookie jar: no `Domain`/`Path` scoping (every jar is
// already scoped to one session/test talking to one logical app under test, not an arbitrary set
// of origins) and no `Secure`/`HttpOnly`/`SameSite` enforcement (those constrain a *browser*
// deciding whether to attach a cookie to a *browser-initiated* request; this is a test client
// deliberately replaying whatever the server just told it to remember). Both are intentional
// scope-narrowings, not oversights — SPEC documents them explicitly (P#13's "closed feature set"
// philosophy).

interface JarEntry {
  readonly value: string;
  /** Absolute expiry (epoch ms), or `undefined` for a session cookie (never expires within a
   * run's lifetime — there is no real "browser session end" to expire it at). */
  readonly expiresAt?: number;
}

interface ParsedSetCookie {
  readonly name: string;
  readonly value: string;
  readonly maxAgeSeconds?: number;
  readonly expiresAtMs?: number;
}

/** Parses one `Set-Cookie` line's `name=value` pair plus `Max-Age`/`Expires`, ignoring every other
 * attribute (`Path`, `Domain`, `HttpOnly`, `Secure`, `SameSite` — see this file's header comment).
 * Returns `null` for a line with no `name=value` pair at all (malformed input, not our problem to
 * throw over — the response actually sent it, so silently skipping is more useful than aborting
 * the whole request). */
function parseSetCookieLine(line: string): ParsedSetCookie | null {
  const parts = line.split(';').map((p) => p.trim());
  const first = parts[0];
  if (!first) return null;
  const eq = first.indexOf('=');
  if (eq === -1) return null;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name) return null;

  let maxAgeSeconds: number | undefined;
  let expiresAtMs: number | undefined;
  for (const attr of parts.slice(1)) {
    const eqIdx = attr.indexOf('=');
    if (eqIdx === -1) continue;
    const key = attr.slice(0, eqIdx).trim().toLowerCase();
    const rawVal = attr.slice(eqIdx + 1).trim();
    if (key === 'max-age') {
      const seconds = Number(rawVal);
      if (Number.isFinite(seconds)) maxAgeSeconds = seconds;
    } else if (key === 'expires') {
      const t = Date.parse(rawVal);
      if (!Number.isNaN(t)) expiresAtMs = t;
    }
  }
  return { name, value, maxAgeSeconds, expiresAtMs };
}

export class CookieJar {
  private readonly cookies = new Map<string, JarEntry>();

  /** Applies one response's `Set-Cookie` header value — possibly several lines, newline-joined
   * the same way `capture header "set-cookie"` already sees them (PLAN decision 61) — to this
   * jar. `Max-Age` wins over `Expires` when a line carries both (RFC 6265 §5.3); `Max-Age <= 0`
   * deletes the cookie immediately, the same as a real browser. */
  applySetCookie(headerValue: string | undefined): void {
    if (!headerValue) return;
    const now = Date.now();
    for (const line of headerValue.split('\n')) {
      const parsed = parseSetCookieLine(line);
      if (!parsed) continue;
      if (parsed.maxAgeSeconds !== undefined && parsed.maxAgeSeconds <= 0) {
        this.cookies.delete(parsed.name);
        continue;
      }
      const expiresAt =
        parsed.maxAgeSeconds !== undefined ? now + parsed.maxAgeSeconds * 1000 : parsed.expiresAtMs;
      this.cookies.set(parsed.name, { value: parsed.value, expiresAt });
    }
  }

  /** The `Cookie` header value to send on the next request — bare `name=value` pairs, `; `-joined
   * (RFC 6265 §4.2.1), pruning anything already expired rather than sending stale cookies.
   * `undefined` when the jar is empty (or every cookie in it has expired), so callers never send
   * an empty `Cookie: ` header. */
  serialize(): string | undefined {
    const now = Date.now();
    const pairs: string[] = [];
    for (const [name, entry] of this.cookies) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) continue;
      pairs.push(`${name}=${entry.value}`);
    }
    return pairs.length > 0 ? pairs.join('; ') : undefined;
  }

  /** A shallow copy — used to seed a test's own jar from a cached `session`'s jar without sharing
   * the live, mutable instance (SPEC §3.3): the session establishes once per run and its outcome
   * is reused by every test opting into it, but each test's *own* subsequent cookie updates must
   * never leak into that shared cache or into a sibling test running concurrently under
   * `--workers N>1`. */
  clone(): CookieJar {
    const copy = new CookieJar();
    for (const [name, entry] of this.cookies) copy.cookies.set(name, entry);
    return copy;
  }

  /** Folds another jar's cookies into this one, by name — last-call-wins per name, the same
   * "later source replaces" rule the whole header/cookie precedence chain already follows
   * (SPEC §3.3). Used to combine several independent, unrelated sessions' jars into one starting
   * jar for a test opting into more than one (`test "..." as admin, userA`) — each session's own
   * jar is a genuine `clone()` first, so merging never mutates a cached session's live instance. */
  mergeFrom(other: CookieJar): void {
    for (const [name, entry] of other.cookies) this.cookies.set(name, entry);
  }
}
