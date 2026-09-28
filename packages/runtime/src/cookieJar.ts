// A first-class cookie jar (SPEC §3.3/§16 P#33): tracks cookies per origin, applies `Set-Cookie`
// attribute semantics (`Max-Age`/`Expires`, last-value-wins per name, `Max-Age<=0` deletes,
// `Domain=`), and re-serializes only `name=value` pairs on the next request. Fixes the hard crash
// the old "capture the raw header, replay it as a `Cookie` header" workaround hit the moment a
// response set 2+ cookies at once (the newline-joined multi-`Set-Cookie` capture embeds a literal
// `\n` in what becomes an HTTP header value — real HTTP clients reject that outright as header
// injection, not a graceful failure).
//
// **Scoped by origin since M88c2 (`B4-06`).** Until then every cookie in a jar was replayed to every
// service a test talked to: a session cookie for the app under test went out to the second API on
// another port, to a third-party sandbox, to whatever `api <name>` the env declared. That is a
// credential leaving the origin that issued it, decided by nothing — no config, no directive, no
// step. The key is `scheme://host:port` (D-M88-7), i.e. `URL.origin`: named services are config
// sugar, not a security boundary, and keying by service name would let a config file's naming choice
// change what a request carries (`tflw-tests` declares one NestJS app twice, as `api` and
// `api root`, because its Swagger mounts outside the `/v1` prefix — a session cookie must reach
// both). A cookie is filed under the origin that *set* it, which after a redirect is not the origin
// that was asked (D-M88-8) — hence `CookieEvent`, produced per hop by all four clients (M88c1).
//
// Still deliberately narrower than a browser's jar, but on one axis fewer than before:
//   - `Domain=` **is** honored (D-M88-9), matched against the setting host. It is not a new feature
//     so much as a preserved one: the old unscoped jar made subdomain SSO work *by accident*, so
//     host-only keying would have been a capability regression. The usual blocker — needing a
//     public-suffix list, without which `Domain=com` shadows across unrelated sites — does not
//     apply, because the only hosts this jar is ever asked to serialize for are the ones the env
//     declared (`api`/`api <name>`): finite, author-declared, never the open web.
//   - `Path=` is **not** honored. Path scoping partitions *within* an origin, which is exactly the
//     `api`/`root` split D-M88-7 rejected, reached by a different mechanism.
//   - `Secure`/`HttpOnly`/`SameSite` are still not enforced — those constrain a *browser* deciding
//     whether to attach a cookie to a *browser-initiated* request; this is a test client
//     deliberately replaying whatever the server just told it to remember.

import type { CookieEvent } from './types.js';

interface JarEntry {
  readonly value: string;
  /** Absolute expiry (epoch ms), or `undefined` for a session cookie (never expires within a
   * run's lifetime — there is no real "browser session end" to expire it at). */
  readonly expiresAt?: number;
  /** An accepted `Domain=` (lowercased, leading dot stripped), or `undefined` for a host-only
   * cookie — the overwhelming majority. Only a domain cookie can be read by an origin other than
   * the one that set it. */
  readonly domain?: string;
  /** `M247` `A` (`D1352`) — the three attributes this jar never *enforces* (see the header comment)
   * are still *remembered*, because the browser it now seeds does enforce them. A page must not be
   * able to read from `document.cookie` a cookie its server marked `HttpOnly`, and a seed that
   * dropped the flag would make a test pass against a page that a real signed-in user could not
   * reproduce. */
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: 'Strict' | 'Lax' | 'None';
}

interface ParsedSetCookie {
  readonly name: string;
  readonly value: string;
  readonly maxAgeSeconds?: number;
  readonly expiresAtMs?: number;
  readonly domain?: string;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite?: 'Strict' | 'Lax' | 'None';
}

/** One cookie in the shape Playwright's `BrowserContext.addCookies` takes (`M247` `A`, `D1352`).
 * Declared here rather than imported so `@tflw/runtime`'s jar stays free of a Playwright type; it
 * is structurally the same object. A host-only cookie carries `url` (Playwright derives a host-only
 * domain and `/` from an origin); a domain cookie carries `domain` with its leading dot and `path`,
 * which is how a browser files one. `expires` is epoch **seconds**, absent for a session cookie. */
export interface BrowserSeedCookie {
  readonly name: string;
  readonly value: string;
  readonly url?: string;
  readonly domain?: string;
  readonly path?: string;
  readonly expires?: number;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: 'Strict' | 'Lax' | 'None';
}

/** Parses one `Set-Cookie` line's `name=value` pair plus `Max-Age`/`Expires`/`Domain`, ignoring
 * every other attribute (`Path`, `HttpOnly`, `Secure`, `SameSite` — see this file's header
 * comment). Returns `null` for a line with no `name=value` pair at all (malformed input, not our
 * problem to throw over — the response actually sent it, so silently skipping is more useful than
 * aborting the whole request). */
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
  let domain: string | undefined;
  let httpOnly = false;
  let secure = false;
  let sameSite: 'Strict' | 'Lax' | 'None' | undefined;
  for (const attr of parts.slice(1)) {
    const eqIdx = attr.indexOf('=');
    if (eqIdx === -1) {
      const flag = attr.toLowerCase();
      if (flag === 'httponly') httpOnly = true;
      else if (flag === 'secure') secure = true;
      continue;
    }
    const key = attr.slice(0, eqIdx).trim().toLowerCase();
    const rawVal = attr.slice(eqIdx + 1).trim();
    if (key === 'max-age') {
      const seconds = Number(rawVal);
      if (Number.isFinite(seconds)) maxAgeSeconds = seconds;
    } else if (key === 'expires') {
      const t = Date.parse(rawVal);
      if (!Number.isNaN(t)) expiresAtMs = t;
    } else if (key === 'domain') {
      // RFC 6265 §5.2.3: a leading dot is ignored, matching is case-insensitive.
      const d = rawVal.replace(/^\./, '').toLowerCase();
      if (d) domain = d;
    } else if (key === 'samesite') {
      const v = rawVal.toLowerCase();
      sameSite = v === 'strict' ? 'Strict' : v === 'lax' ? 'Lax' : v === 'none' ? 'None' : undefined;
    }
  }
  return { name, value, maxAgeSeconds, expiresAtMs, domain, httpOnly, secure, ...(sameSite ? { sameSite } : {}) };
}

/** `URL.origin`'s host half, for domain matching. Falls back to the raw string for a key that
 * didn't come from a URL — `cookieEventFor` has the same fallback, and losing the cookie would be
 * worse than an odd key. */
function hostOf(origin: string): string {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return origin.toLowerCase();
  }
}

/** An IP literal is never a domain-match target (RFC 6265 §5.1.3): `127.0.0.1` must not "belong to"
 * a `Domain=0.0.1`, and `[::1]` has no dotted structure to match on at all. */
function isIpLiteral(host: string): boolean {
  return /^\d+(\.\d+)*$/.test(host) || host.includes(':') || host.startsWith('[');
}

/** RFC 6265 §5.1.3 domain-match: identical, or a subdomain of it. */
export function domainMatches(host: string, domain: string): boolean {
  if (host === domain) return true;
  if (isIpLiteral(host)) return false;
  return host.endsWith(`.${domain}`);
}

/** What a `Domain=` attribute is worth, given the host that sent it.
 *
 * A domain the setting host does not itself belong to is dropped and the cookie filed host-only,
 * rather than the cookie being rejected outright the way a browser would (RFC 6265 §5.3 step 6).
 * Both readings are defensible; this one is chosen because the failure the jar exists to end is
 * *silent cookie loss* (D-M88-8's rejected alternative), and the threat a browser's rejection
 * guards against — one site claiming another's cookies — is not this jar's threat model: it only
 * ever serializes for hosts the env itself declared. Narrowing the scope to where the cookie was
 * actually set is the conservative half of the browser's answer without the lossy half. */
function acceptedDomain(domain: string | undefined, host: string): string | undefined {
  if (!domain) return undefined;
  return domainMatches(host, domain) ? domain : undefined;
}

function isExpired(entry: JarEntry, now: number): boolean {
  return entry.expiresAt !== undefined && entry.expiresAt <= now;
}

export class CookieJar {
  /** `origin` → `name` → entry. Two levels, not a flattened `"origin\0name"` key, because
   * `serialize`/`clone`/`mergeFrom` all want a whole origin at once and none of them ever wants a
   * name across origins. */
  private readonly byOrigin = new Map<string, Map<string, JarEntry>>();

  /** Applies every hop of one response chain that carried `Set-Cookie` (M88c1's `ResponseTrace`
   * field), each filed under the origin that actually sent it. This replaced
   * `applySetCookie(headerValue)`, which took the *final* response's `\n`-joined header and had no
   * way to know which origin it came from — after a cross-origin redirect that meant filing a
   * cookie under the wrong origin, and before M88c1 an intermediate hop's cookie was not
   * observable at all (`B4-15`). */
  applyCookieEvents(events: readonly CookieEvent[]): void {
    for (const event of events) this.applySetCookieLines(event.origin, event.setCookie);
  }

  /** One origin's `Set-Cookie` lines, unjoined. `Max-Age` wins over `Expires` when a line carries
   * both (RFC 6265 §5.3); `Max-Age <= 0` deletes the cookie immediately, the same as a real
   * browser. */
  applySetCookieLines(origin: string, lines: readonly string[]): void {
    const now = Date.now();
    const host = hostOf(origin);
    for (const line of lines) {
      const parsed = parseSetCookieLine(line);
      if (!parsed) continue;
      const domain = acceptedDomain(parsed.domain, host);
      if (parsed.maxAgeSeconds !== undefined && parsed.maxAgeSeconds <= 0) {
        this.deleteCookie(origin, parsed.name, domain);
        continue;
      }
      const expiresAt =
        parsed.maxAgeSeconds !== undefined ? now + parsed.maxAgeSeconds * 1000 : parsed.expiresAtMs;
      this.bucket(origin).set(parsed.name, {
        value: parsed.value,
        expiresAt,
        ...(domain !== undefined ? { domain } : {}),
        ...(parsed.httpOnly ? { httpOnly: true } : {}),
        ...(parsed.secure ? { secure: true } : {}),
        ...(parsed.sameSite ? { sameSite: parsed.sameSite } : {}),
      });
    }
  }

  /** The `Cookie` header value to send to `origin` — bare `name=value` pairs, `; `-joined
   * (RFC 6265 §4.2.1), pruning anything already expired rather than sending stale cookies.
   * `undefined` when this origin has nothing to send, so callers never send an empty `Cookie: `
   * header (which is also the condition D-M88-12's step-trace note reports on).
   *
   * A domain cookie set by *another* origin is included when this origin's host domain-matches it;
   * this origin's own cookie of the same name wins over an inherited one, which is the closest
   * thing available to RFC 6265 §5.4's "more specific first" ordering without `Path`. */
  serialize(origin: string): string | undefined {
    const now = Date.now();
    const host = hostOf(origin);
    const chosen = new Map<string, string>();
    for (const [otherOrigin, bucket] of this.byOrigin) {
      if (otherOrigin === origin) continue;
      for (const [name, entry] of bucket) {
        if (entry.domain === undefined || isExpired(entry, now)) continue;
        if (domainMatches(host, entry.domain)) chosen.set(name, entry.value);
      }
    }
    for (const [name, entry] of this.byOrigin.get(origin) ?? []) {
      if (isExpired(entry, now)) continue;
      chosen.set(name, entry.value);
    }
    const pairs = [...chosen].map(([name, value]) => `${name}=${value}`);
    return pairs.length > 0 ? pairs.join('; ') : undefined;
  }

  /** Origins this jar currently holds at least one unexpired cookie for, in the order they were
   * first seen. Exists for D-M88-12: when `serialize(origin)` returns nothing, the step trace says
   * whether that is an empty jar or a jar scoped somewhere else — the one thing the existing header
   * trace cannot distinguish, and the whole way an author finds out that origin scoping (not their
   * login) is why a request went out unauthenticated. Names only, never values. */
  originsWithCookies(): string[] {
    const now = Date.now();
    const origins: string[] = [];
    for (const [origin, bucket] of this.byOrigin) {
      for (const entry of bucket.values()) {
        if (!isExpired(entry, now)) {
          origins.push(origin);
          break;
        }
      }
    }
    return origins;
  }

  /** Every unexpired cookie, as a browser context should be seeded with it (`M247` `A`, `D1352`).
   *
   * **The host is never rewritten.** A cookie set by `http://127.0.0.1:3000` is seeded for
   * `127.0.0.1` and nothing else, so a page opened at `http://localhost:3000` starts signed out —
   * the three loopback spellings (`127.0.0.1`, `localhost`, `::1`) are three hosts to a browser,
   * and a seed that aliased them would sign in a page no real browser would. The runbook states
   * the rule; the remedy is to name the same host in `api` and `web`.
   *
   * **Ports do not partition cookies in a browser**, and so do not here either: a host-only cookie
   * from `:3000` is visible to the page at `:5173` on the same host. That is RFC 6265 §8.5 and is
   * what makes the common dev shape (API on one port, SPA on another) sign in at all. Two origins on
   * one host holding the same name are both seeded; the browser keeps the later, which is the
   * jar's own insertion order.
   *
   * `SameSite=None` without `Secure` is a pair every current browser refuses at `Set-Cookie`, and
   * Playwright refuses it at `addCookies`; the seed drops the `SameSite` rather than the cookie,
   * which leaves the browser's default (`Lax`) — the closest thing to what the server asked for
   * that a browser will hold. */
  browserCookies(): BrowserSeedCookie[] {
    const now = Date.now();
    const out: BrowserSeedCookie[] = [];
    for (const [origin, bucket] of this.byOrigin) {
      for (const [name, entry] of bucket) {
        if (isExpired(entry, now)) continue;
        const where = entry.domain !== undefined ? { domain: `.${entry.domain}`, path: '/' } : { url: origin };
        const sameSite = entry.sameSite === 'None' && !entry.secure ? undefined : entry.sameSite;
        out.push({
          name,
          value: entry.value,
          ...where,
          ...(entry.expiresAt !== undefined ? { expires: Math.floor(entry.expiresAt / 1000) } : {}),
          ...(entry.httpOnly ? { httpOnly: true } : {}),
          ...(entry.secure ? { secure: true } : {}),
          ...(sameSite ? { sameSite } : {}),
        });
      }
    }
    return out;
  }

  /** A copy — used to seed a test's own jar from a cached `session`'s jar without sharing the live,
   * mutable instance (SPEC §3.3): the session establishes once per run and its outcome is reused by
   * every test opting into it, but each test's *own* subsequent cookie updates must never leak into
   * that shared cache or into a sibling test running concurrently under `--workers N>1`.
   *
   * **Two levels deep, deliberately.** A one-level copy of a nested `Map` copies the outer entries
   * and *shares every inner `Map`* — which would leave this method's own guarantee false in exactly
   * the case it was written for, with a cached session's jar mutated by whichever test happened to
   * run. The entries themselves are immutable, so the copy stops there. */
  clone(): CookieJar {
    const copy = new CookieJar();
    for (const [origin, bucket] of this.byOrigin) copy.byOrigin.set(origin, new Map(bucket));
    return copy;
  }

  /** Folds another jar's cookies into this one — last-call-wins per `(origin, name)`, the same
   * "later source replaces" rule the whole header/cookie precedence chain already follows
   * (SPEC §3.3). Used to combine several independent, unrelated sessions' jars into one starting
   * jar for a test opting into more than one (`test "..." as admin, userA`) — each session's own
   * jar is a genuine `clone()` first, so merging never mutates a cached session's live instance.
   *
   * Within one origin this is byte-identical to the pre-M88c2 by-name merge; across origins the
   * cookies now coexist instead of clobbering each other, which is the point — two sessions against
   * two services no longer overwrite each other's `session` cookie. */
  mergeFrom(other: CookieJar): void {
    for (const [origin, bucket] of other.byOrigin) {
      const mine = this.bucket(origin);
      for (const [name, entry] of bucket) mine.set(name, entry);
    }
  }

  private bucket(origin: string): Map<string, JarEntry> {
    let bucket = this.byOrigin.get(origin);
    if (!bucket) {
      bucket = new Map();
      this.byOrigin.set(origin, bucket);
    }
    return bucket;
  }

  /** A `Max-Age<=0` logout. Clears the cookie from the origin that sent the deletion, and — when
   * that deletion carried an accepted `Domain=` — from every other origin holding the same name
   * under the same domain, because a domain cookie's identity is `(name, domain)` and it may well
   * have been *set* by a sibling host (`api.example.com` logs you in, `www.example.com` logs you
   * out). Without that second half, a domain cookie could be deleted and still be sent. */
  private deleteCookie(origin: string, name: string, domain: string | undefined): void {
    this.byOrigin.get(origin)?.delete(name);
    if (domain === undefined) return;
    for (const bucket of this.byOrigin.values()) {
      if (bucket.get(name)?.domain === domain) bucket.delete(name);
    }
  }
}
