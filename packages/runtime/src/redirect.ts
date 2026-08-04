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
// Note what is deliberately *not* here: response handling. Cookie jar behavior, multi-`Set-Cookie`
// merging and what a chain that hits the cap should return are live divergences between the
// clients (review cluster C2, `B4-05`/`B4-06`/`B4-09`) and settling them is that cluster's
// decision, not this one. This module answers one question — where does the next hop go — and the
// guardrail only ever needed that one.

/** `fetch`'s own cap (Fetch §4.4 "HTTP-redirect fetch", step 5: redirect count 20). */
export const MAX_REDIRECTS = 20;

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

/** Where a 3xx sends this request next, and what it may still carry when it gets there. */
export function nextRedirectHop(current: { readonly url: string; readonly method: string; readonly headers: Record<string, string> }, status: number, location: string): RedirectHop {
  const from = new URL(current.url);
  const to = new URL(location, from);
  const dropBody = status === 303 || ((status === 301 || status === 302) && current.method === 'POST');
  let headers = current.headers;
  if (!isSameOrigin(from, to)) headers = stripHeaders(headers, CROSS_ORIGIN_STRIPPED_HEADERS);
  if (dropBody) headers = stripHeaders(headers, DOWNGRADE_STRIPPED_HEADERS);
  return { url: to.toString(), method: dropBody ? 'GET' : current.method, headers, dropBody };
}
