// One statement of "what is the next hop of a redirect chain", shared by every client path
// (M85, review cluster C1/`B4-02`).
//
// The pooled path (`http.ts`) gets redirect-following free from `fetch`'s `redirect: 'follow'`, and
// so has no place to stand between two hops — which is exactly why `allow hosts` was enforced on
// the URL a step names and on nothing after it. Enforcing per hop means owning the loop, and owning
// the loop means restating decisions `fetch` was making for us: which statuses downgrade a POST to
// a bodyless GET, which headers a cross-origin hop drops, where the chain stops.
//
// Restating them *once*, here, is the whole point. `httpPinned.ts` already had to make these
// decisions by hand (it runs on `node:http`, which never auto-follows) and its versions were the
// tested ones — `httpPinned.test.ts` states each as a pinned-vs-pooled comparison rather than a
// hardcoded expectation. This module is those decisions lifted out of that file unchanged, so the
// third path to need them adds a caller and not a fourth opinion.
//
// M85 left response handling deliberately out — cookie jar behavior, multi-`Set-Cookie` merging and
// what a chain that hits the cap should return were live divergences between the clients (review
// cluster C2) and settling them was that cluster's decision, not the guardrail's. M88a settles the
// third of those here, because "where does the next hop go" and "what happens when there is no
// legitimate next hop" are the same question asked one step apart; the other two are the jar's, and
// stay out (`B4-05`/`B4-06`, `M88c2`). This line said `M88c` until `M169c`: the step split
// mid-milestone into `M88c1` (the transport half) and `M88c2` (the jar), both of which took the
// name in the records, and the pre-split name kept the citation. The two findings named here are
// `M88c2`'s own, which is what identifies the half this sentence meant.

import { RuntimeError } from './eval.js';
import type { CookieEvent } from './types.js';
import { CookieJar } from './cookieJar.js';

/** `fetch`'s own cap (Fetch §4.4 "HTTP-redirect fetch", step 5: redirect count 20). */
export const MAX_REDIRECTS = 20;

/** A chain that never terminates, distinguishable by type rather than by matching its text — the
 * same reason `AllowHostsError` is (`allowHosts.ts:18-23`): the three layers between a client and
 * the reporter each re-frame what they catch as "request failed: … — <message>", and this is
 * already the finished sentence.
 *
 * Until M88a only the *unguarded* pooled path errored at all, and only because it delegates to
 * native `redirect: 'follow'`; the three hand-written loops (`http.ts`, `httpPinned.ts`,
 * `mtlsWorker.ts`) each `break`/`return`ed the last 3xx as if it were an ordinary response, which
 * made an infinite redirect loop a **green** test on every path a real suite uses (`B4-09`). Worse,
 * which of the two behaviours you got was decided by `allow hosts` — a *security* directive silently
 * changing a verdict (`B4-14`). D-M88-1 makes the pooled path normative, so all four conform to
 * `fetch`: the cap is an error, not a result. */
export class RedirectLimitError extends RuntimeError {}

/** Phrased from the *original* request only — the method and URL the step itself named, never the
 * hop the chain happened to die on. That is not a simplification: native `fetch` knows nothing but
 * the original, so anything richer could only be said by the hand-walked loops, and the two would
 * disagree again on exactly the axis `B4-14` is about. Parity is the message. */
export function redirectLimitMessage(method: string, url: string): string {
  return `too many redirects: ${method} ${url} redirected more than ${MAX_REDIRECTS} times without landing on a final response — refusing to follow further (this is almost always a redirect loop; use \`without redirects\` if you meant to assert on the 3xx itself)`;
}

/** Node's `fetch` reports its own cap as a bare `TypeError: fetch failed` with the real reason one
 * level down in `err.cause` — undici's `Error: redirect count exceeded`, which carries no `code` to
 * match on, so the message is the only signal there is. Recognising it is what lets the unguarded
 * pooled path (and the unguarded mTLS worker) say the same sentence the hand-walked loops say
 * instead of `request failed: … — fetch failed` (`B4-10`).
 *
 * A backstop since M88c1: no client reaches native `redirect: 'follow'` any more (D-M88-14), so
 * nothing should produce this cause today. Kept because the cost is one string comparison on an
 * error path, and the day someone reintroduces a native follow — for a body shape the hand-walked
 * loop can't carry, say — the message must not silently regress to `fetch failed`. */
export function isRedirectLimitCause(err: unknown): boolean {
  const cause = (err as { cause?: { message?: unknown } } | undefined)?.cause;
  return typeof cause?.message === 'string' && cause.message === 'redirect count exceeded';
}

/** Fetch §4.4 deletes these from the request's header list when the redirect leaves the request's
 * origin, and Node's own `fetch` (undici) implements exactly this list — `authorization` and
 * `proxy-authorization` as authentication entries, `cookie` and `host` as forbidden
 * request-headers. Until M80 the pinned path didn't (B4-01, S1): the *same* step, with the same
 * `header "Authorization" is …`, disclosed the credential to the redirect target when it ran under
 * a workload and withheld it when it didn't. Which client a step runs on is a performance
 * decision; it must not be a credential-disclosure decision. */
export const CROSS_ORIGIN_STRIPPED_HEADERS: ReadonlySet<string> = new Set(['authorization', 'proxy-authorization', 'cookie', 'host']);

/** Fetch's "request-body header name" list, deleted when a 301/302/303 drops the body on the way to
 * a bodyless GET. `content-length` isn't on Fetch's own list only because `fetch` derives it from
 * the body it just nulled and so can't emit a stale one; a manual loop takes `content-length` from
 * the caller's header map when one is set explicitly, so it has to be dropped by name to reach the
 * same wire result (B4-13). */
export const DOWNGRADE_STRIPPED_HEADERS: ReadonlySet<string> = new Set(['content-encoding', 'content-language', 'content-location', 'content-type', 'content-length']);

/** Scheme + host + port, the comparison Fetch makes. An opaque origin (`URL.origin === 'null'`,
 * i.e. any non-http(s) scheme) is never same-origin with anything, including another opaque one —
 * so a redirect to such a target strips rather than forwards. */
export function isSameOrigin(a: URL, b: URL): boolean {
  return a.origin === b.origin && a.origin !== 'null';
}

export function stripHeaders(headers: Record<string, string>, drop: ReadonlySet<string>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!drop.has(key.toLowerCase())) kept[key] = value;
  }
  return kept;
}

export function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

export interface RedirectHop {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  /** 301/302/303 turn a POST into a bodyless GET; 307/308 alone preserve method + body. */
  readonly dropBody: boolean;
}

/** The one entry a hop contributes to `ResponseTrace.cookieEvents`, or `undefined` when it set no
 * cookie — which is almost every hop, so callers push only what this returns.
 *
 * Lives here, beside `nextRedirectHop`, for the reason this module exists at all: it is per-hop
 * chain bookkeeping that all four clients must do identically, and the three that walk their chains
 * by hand each reach it from a differently-shaped response object (`Headers.getSetCookie()`,
 * `IncomingHttpHeaders['set-cookie']`, undici's `Headers`). Normalising the *shape* at each call
 * site while sharing the *decision* — which URL is the origin, what an empty list means — is what
 * keeps a fourth opinion from appearing (M88c1, `B4-15`). */
export function cookieEventFor(hopUrl: string, setCookie: readonly string[] | undefined): CookieEvent | undefined {
  if (!setCookie || setCookie.length === 0) return undefined;
  // A URL this loop just successfully requested always parses; the fallback is for the theoretical
  // caller that hands over something else, where losing the cookie would be worse than an odd key.
  let origin: string;
  try {
    origin = new URL(hopUrl).origin;
  } catch {
    origin = hopUrl;
  }
  return { origin, setCookie: [...setCookie] };
}

/** Where a 3xx sends this request next, and what it may still carry when it gets there.
 *
 * **`chainCookie` is `M137f-01`, and it is required rather than optional on purpose.** `M88c1`
 * found that a chain's intermediate `Set-Cookie` was discarded and fixed the *reporting* half —
 * every hop's cookies now reach `cookieEvents`. Its own header comment states the other half in
 * one sentence (*"because a request's headers are fixed once before the chain starts, the hop to
 * the protected page also went out unauthenticated"*) and that half was never built: the caller's
 * header map was carried forward verbatim, so `POST /login` → `302` + `Set-Cookie` →
 * `GET /dashboard` sent the dashboard hop **anonymously**, exactly as before. A browser carries it;
 * `curl -L -c -b` carries it; this loop did not.
 *
 * The consequence is a silent false green rather than an error, which is why four milestones of
 * green sweeps walked past it. On an app that answers an unauthenticated page with a redirect to
 * its login form — the commonest shape there is — the chain lands on the login page with a `200`,
 * so `expect status equals 200` passes; and if that app touches its session on every request (a
 * synchroniser-token middleware is enough), the login page's own fresh anonymous cookie is a
 * *later* event than the authenticated one, so last-wins leaves the jar holding an anonymous
 * credential. The session establishes, reports success, and is not logged in.
 *
 * Required, not `chainCookie?`, because an optional parameter is satisfied by forgetting it. Three
 * clients hand-walk chains and all three have to do this identically; a default would let a fourth
 * arrive silently anonymous, which is the failure this parameter exists to end.
 *
 * Applied **after** the cross-origin strip and scoped by the caller to the hop's own origin, so the
 * jar's rule is unchanged: host A's cookie is not replayed to host B. */
export function nextRedirectHop(
  current: { readonly url: string; readonly method: string; readonly headers: Record<string, string> },
  status: number,
  location: string,
  chainCookie: string | undefined,
): RedirectHop {
  const from = new URL(current.url);
  const to = new URL(location, from);
  const dropBody = status === 303 || ((status === 301 || status === 302) && current.method === 'POST');
  let headers = current.headers;
  if (!isSameOrigin(from, to)) headers = stripHeaders(headers, CROSS_ORIGIN_STRIPPED_HEADERS);
  if (dropBody) headers = stripHeaders(headers, DOWNGRADE_STRIPPED_HEADERS);
  headers = withChainCookie(headers, chainCookie);
  return { url: to.toString(), method: dropBody ? 'GET' : current.method, headers, dropBody };
}

/** What the chain itself has learned, as a `Cookie` header for the hop `location` names.
 *
 * Built from `cookieEvents` — the list every hand-walked client is already accumulating — through
 * the run's own `CookieJar`, so a redirect chain and an authored step agree about `Max-Age`,
 * expiry, domain matching and last-wins ordering instead of this module growing a second opinion
 * about what a cookie is. That shared-decision rule is why `cookieEventFor` lives here, and this is
 * the same rule applied to the sending half.
 *
 * Origin-scoped by construction: the jar is asked for the *hop's* origin, so a chain that crosses
 * from A to B is handed B's cookies and never A's. `nextRedirectHop`'s cross-origin strip and this
 * are therefore not redundant — the strip drops what the *caller* was sending, this decides what
 * the chain may add.
 *
 * A fresh jar per hop rather than one threaded through the loop: a chain is capped at
 * `MAX_REDIRECTS`, so the cost is bounded and trivial, and a caller cannot forget to update it. */
export function chainCookieForRedirect(currentUrl: string, location: string, events: readonly CookieEvent[]): string | undefined {
  if (events.length === 0) return undefined;
  let origin: string;
  try {
    origin = new URL(location, currentUrl).origin;
  } catch {
    return undefined;
  }
  const jar = new CookieJar();
  jar.applyCookieEvents(events);
  return jar.serialize(origin);
}

/** The hop's `Cookie` header, given what the caller was already sending and what earlier hops in
 * this same chain set for the hop's origin.
 *
 * **The chain wins on a name collision**, which is the only ordering that can be right: the
 * caller's value is the jar as it stood *before* the request, and a `Set-Cookie` seen since is by
 * definition newer. A login that rotates the session id is precisely this case — carrying the
 * pre-login value forward would send the hop the credential the server just replaced.
 *
 * Any existing header spelling of `cookie` is consumed rather than left in place, since a second
 * entry differing only in case would be sent as a second header line and the two would disagree. */
export function withChainCookie(headers: Record<string, string>, chainCookie: string | undefined): Record<string, string> {
  if (!chainCookie) return headers;
  const pairs = new Map<string, string>();
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'cookie') addCookiePairs(pairs, value);
    else kept[key] = value;
  }
  addCookiePairs(pairs, chainCookie);
  if (pairs.size > 0) kept['Cookie'] = [...pairs].map(([name, value]) => `${name}=${value}`).join('; ');
  return kept;
}

/** `name=value; name2=value2` into a map, last-wins, skipping anything without a name. Deliberately
 * not a `Set-Cookie` parser: a `Cookie` request header carries bare pairs and no attributes, so
 * splitting on `;` is the whole grammar (RFC 6265 §4.2.1). */
function addCookiePairs(into: Map<string, string>, header: string): void {
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    into.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
  }
}
