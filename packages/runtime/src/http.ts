// The fetch binding (M1, widened M2). No Playwright dependency here — the browser binding is a
// separate module added in M3 (SPEC §14). Sends a fully-built request and returns a response
// trace. `body` is whatever `BodyInit` the caller prepared (string for JSON/text/urlencoded,
// `FormData` for multipart uploads, SPEC §5.2) — decoupled from `RequestTrace.body`, which is
// purely the human-readable trace text shown in the report.

import { RuntimeError } from './eval.js';
import { blockedPort } from './blockedPorts.js';
import { sendMtlsRequest } from './mtlsWorker.js';
import { AllowHostsError, allowHostsRefusal, isHostAllowed } from './allowHosts.js';
import { MAX_REDIRECTS, RedirectLimitError, chainCookieForRedirect, cookieEventFor, isRedirectLimitCause, isRedirectStatus, nextRedirectHop, redirectLimitMessage } from './redirect.js';
import type { CookieEvent, ResponseTrace } from './types.js';

/**
 * A request this client aborted on its own timeout, distinguishable by **type** rather than by
 * matching its text — the reason `RedirectLimitError` and `AllowHostsError` exist, applied to the
 * third thing a caller needs to tell apart from a transport failure.
 *
 * `wait until api` is that caller (`M115-02`, M143b). Decision 67 clamps every poll's request
 * timeout to what is left of the *wait* budget, so a timeout at the clamped value is the wait
 * deadline expiring wearing a request timeout's clothes: the step used to report
 * `request timed out after 186.63485000000003ms`, a figure the author never configured, about a
 * clock they were not watching. The message is unchanged — this is a subclass so every existing
 * reader, matcher and report line sees exactly what it saw before.
 */
export class RequestTimeoutError extends RuntimeError {}

export interface SendRequestOptions {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: BodyInit;
  readonly timeoutMs: number;
  /** false for `without redirects` — leaves the 3xx itself observable (SPEC §5.1, §5.3). */
  readonly followRedirects: boolean;
  /** Client certificate + key *contents* (already read from disk by the caller) for a per-env
   * `cert`/`key` mTLS config (SPEC §3.5, decision 3b, enterprise arc). Only this request's own
   * connection uses them — routed through a one-off `undici.Agent`, never the process-wide
   * `NODE_TLS_REJECT_UNAUTHORIZED` toggle `insecure true` uses (tls.ts), since a client cert is
   * inherently per-connection, not a global switch. `undici` is a build-time-bundled dependency
   * (decision 13) — `package.json` for the *published* `tflw` CLI still has zero runtime deps;
   * this package itself is only ever consumed pre-bundle. */
  readonly mtls?: { readonly cert: string; readonly key: string };
  /** This env's `allow hosts` list, or `null`/absent for no enforcement (SPEC §3.7). Present only
   * so redirect *hops* can be checked (M85, C1/`B4-02`) — the URL the caller composed is still
   * checked by the caller, before this function is reached at all. */
  readonly allowHosts?: readonly string[] | null;
}

/** The finished chain: the response a step gets to assert on, plus the two things only the walk
 * itself knows — where it ended, and every `Set-Cookie` handed over along the way. */
interface ChainResult {
  readonly res: Response;
  readonly finalUrl: string;
  readonly cookieEvents: readonly CookieEvent[];
}

/** `redirect: 'follow'`, re-done a hop at a time. Returns the final response, exactly as `fetch`
 * would have — the chain's own bookkeeping (method downgrade, cross-origin header stripping, the
 * 20-hop cap) comes from `redirect.ts`, shared with the pinned path rather than invented here.
 *
 * **M88c1 (D-M88-14) — unconditional now.** This used to run only when `allow hosts` was set
 * (`mustFollowByHand`), so an unguarded run — every run, the key being opt-in — kept native
 * `redirect: 'follow'` byte for byte, and only a run that asked to be guarded paid for being
 * guarded. That split cannot survive `B4-15`: `redirect: 'follow'` is a single `await` with no seam
 * between hops, so an intermediate hop's `Set-Cookie` is drained and discarded inside undici where
 * nothing can reach it. Keeping the split would have meant fixing the lost-session bug *only for
 * runs that had opted into an unrelated security key* — `allow hosts` deciding whether a login
 * works, which is `B4-14`'s own failure shape reappearing one milestone later.
 *
 * So the rule is now one line with no conditions: if this client follows a chain, it walks it. The
 * seam that `allow hosts` needed (M85, C1/`B4-02`) and the seam that cookies need are the same seam,
 * and there is no third configuration in which it is absent.
 *
 * What that costs is the oracle the split was accidentally providing — with both arms hand-walked,
 * "guarded equals unguarded" no longer pins anything to `fetch`'s own answer. `cookie-events.test.ts`
 * states that property directly instead, comparing this loop against a raw
 * `fetch(url, { redirect: 'follow' })` on the same chain, which is what those tests were really
 * asserting all along. */
async function fetchChain(opts: SendRequestOptions, signal: AbortSignal): Promise<ChainResult> {
  let current: { url: string; method: string; headers: Record<string, string>; body?: BodyInit } = {
    url: opts.url,
    method: opts.method,
    headers: opts.headers,
    body: opts.body,
  };
  const cookieEvents: CookieEvent[] = [];
  for (let redirects = 0; ; redirects++) {
    const res = await fetch(current.url, { method: current.method, headers: current.headers, body: current.body, signal, redirect: 'manual' });
    // Recorded before anything can `return` or `throw` past it, and filed under the URL *this* hop
    // was sent to — not `opts.url`, and not the terminus. A chain can cross origins, and the whole
    // point of carrying an origin per event is that the jar (M88c2) must not replay host A's
    // cookie to host B.
    const event = cookieEventFor(current.url, setCookieLines(res.headers));
    if (event) cookieEvents.push(event);
    const location = res.headers.get('location');
    // `followRedirects: false` (`without redirects`) stops here with the 3xx itself intact and
    // observable, which is the same thing the old `redirect: 'manual'` single call did.
    if (!opts.followRedirects || !isRedirectStatus(res.status) || !location) return { res, finalUrl: current.url, cookieEvents };
    if (redirects >= MAX_REDIRECTS) {
      // Not `return res` (M88a, `B4-09`/`B4-14`). Handing back the 21st hop's 3xx makes an endless
      // chain indistinguishable from a deliberate `without redirects` — an infinite loop passed
      // `expect status equals 302` and reported a 0% error rate. Native `redirect: 'follow'`, which
      // this request used to use whenever `allow hosts` was unset (until D-M88-14 made the walk
      // unconditional), throws here; so does this.
      await res.arrayBuffer().catch(() => undefined);
      throw new RedirectLimitError(redirectLimitMessage(opts.method, opts.url));
    }
    const hop = nextRedirectHop(current, res.status, location, chainCookieForRedirect(current.url, location, cookieEvents));
    if (!isHostAllowed(hop.url, opts.allowHosts)) {
      // Drained before throwing: this hop's own response is a 3xx we are choosing not to follow,
      // and leaving its body unread holds the socket open for the rest of the process.
      await res.arrayBuffer().catch(() => undefined);
      throw new AllowHostsError(allowHostsRefusal(hop.url, opts.allowHosts!, { kind: 'redirect', from: `${current.method} ${current.url}` }));
    }
    await res.arrayBuffer().catch(() => undefined);
    current = { url: hop.url, method: hop.method, headers: hop.headers, body: hop.dropBody ? undefined : current.body };
  }
}

/** `Headers.forEach` already Fetch-spec-combines every repeated header with `, ` EXCEPT
 * `set-cookie`, whose entries are deliberately kept distinct (a comma is a valid, common
 * character inside a cookie's own `Expires` attribute, so joining with `, ` would corrupt it —
 * this is why the Fetch spec special-cased it). Naively overwriting `headers[key] = value` in
 * that forEach silently keeps only the last cookie of a multi-`Set-Cookie` response — e.g. a
 * session cookie *and* a CSRF cookie on one login response — with no error (decision 61). Use
 * `getSetCookie()` (WHATWG Headers, Node ≥ 18.14) to recover every value and join with `\n`,
 * a separator that can't appear inside a header value, so no cookie is silently dropped. */
function setCookieLines(resHeaders: Headers): string[] {
  const getSetCookie = (resHeaders as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  return getSetCookie ? getSetCookie.call(resHeaders) : [];
}

function buildHeaderMap(resHeaders: Headers): Record<string, string> {
  const headers: Record<string, string> = {};
  resHeaders.forEach((value, key) => {
    headers[key] = value;
  });
  const cookies = setCookieLines(resHeaders);
  if (cookies.length > 0) headers['set-cookie'] = cookies.join('\n');
  return headers;
}

/** Node's global `fetch` collapses every network failure into a bare `TypeError: fetch failed`,
 * with the actually-useful system error one level down in `err.cause` (undici's own behavior) —
 * corporate-QA's two most common failure modes (a self-signed/private-CA staging cert, a proxy or
 * DNS misconfiguration) would otherwise surface as that same opaque message with no lead at all
 * (decision 78). Unwraps the cause chain into a named hint; returns '' for anything unrecognised
 * (the raw `err.message` still gets through unmodified from the caller).
 *
 * `url` is the request's own URL and is **required**, not optional: it is the sole evidence behind
 * the blocked-port hint (M125b2, `FU-20a`, D260), and making it required is what stops a call site
 * from silently dropping the one input that hint depends on — the typechecker refuses instead.
 * `localhost:9` and `localhost:19` used to answer a bare `fetch failed` with nothing else, because
 * the fetch standard refuses those ports before any socket opens and so there is no `cause.code`
 * for the switch below to have missed. The port either is on the standard's list or is not; see
 * `blockedPorts.ts` for why that question is answered from the URL rather than from undici's prose. */
export function fetchErrorHint(err: unknown, url: string): string {
  const cause = (err as { cause?: { code?: unknown } } | undefined)?.cause;
  const code = typeof cause?.code === 'string' ? cause.code : undefined;
  switch (code) {
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'CERT_HAS_EXPIRED':
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return ` — self-signed or private-CA certificate? set \`insecure true\` in tflw.config, or point NODE_EXTRA_CA_CERTS at your CA bundle (see SPEC.md §3.5 "corporate networks")`;
    case 'ENOTFOUND':
      return ` — DNS lookup failed for this host; check the URL and your network/DNS`;
    case 'ECONNREFUSED':
      return ` — connection refused; is the service actually listening at that host:port?`;
    default:
      break;
  }
  // Only once no code matched: a blocked port produces no code at all, so reaching here is a
  // precondition of the check rather than a fallback ordering choice.
  const port = blockedPort(url);
  if (port !== undefined) {
    return ` — port ${port} is on the fetch standard's blocked-ports list (https://fetch.spec.whatwg.org/#bad-port), so no request was sent and no socket was opened; this is the standard refusing the port, not tflw and not your network. Move the service to a port that isn't on that list.`;
  }
  return '';
}

export async function sendRequest(opts: SendRequestOptions): Promise<ResponseTrace> {
  // `mtls` routes through a dedicated child process (`mtlsWorker.ts`, M35c) carrying the client
  // cert/key over a one-off `undici.Agent` — isolated there specifically so the `undici` npm
  // package (needed for that `Agent` class) is never imported in *this* process: merely importing
  // it, even without calling it, was found to cripple this global `fetch()` below by ~20x (M35b,
  // `tflw-acceptance/perf/profile/FINDINGS_M35B_ROOT_CAUSE.md` in testFlow-tests, moved there in
  // reorg Phase 2) — every other request keeps using the
  // global `fetch` unchanged.
  if (opts.mtls) {
    try {
      return await sendMtlsRequest({ ...opts, mtls: opts.mtls });
    } catch (err) {
      // Same exemption as the pooled catch below, and it needs stating twice because this branch
      // has always had its own `catch` — an `allow hosts` refusal the worker sent back is already
      // the finished sentence, so wrapping it yields `request failed: … — host "x" is not in …`,
      // which frames a request that was deliberately never sent as a transport failure.
      if (err instanceof AllowHostsError) throw err;
      // Both shapes the worker can send back for a chain that never terminated: its guarded loop
      // labels it (`redirectLimit`, arriving already typed), its unguarded `redirect: 'follow'`
      // buries it in undici's cause the same way the pooled path does (M88a, `B4-09`/`B4-10`).
      if (err instanceof RedirectLimitError) throw err;
      if (isRedirectLimitCause(err)) throw new RedirectLimitError(redirectLimitMessage(opts.method, opts.url));
      if ((err as { timedOut?: boolean }).timedOut) throw new RequestTimeoutError(`request timed out after ${opts.timeoutMs}ms: ${opts.method} ${opts.url}`);
      throw new RuntimeError(`request failed: ${opts.method} ${opts.url} — ${(err as Error).message}${fetchErrorHint(err, opts.url)}`);
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const start = performance.now();
  try {
    const { res, finalUrl, cookieEvents } = await fetchChain(opts, controller.signal);
    // Single read (gap #17): the body stream can only be consumed once, so `bodyText` is derived
    // from `bodyBytes` rather than a separate `res.text()` call — confirmed behavior-preserving,
    // `Buffer.from(bytes).toString('utf8')` matches `res.text()`'s own `TextDecoder` byte-for-byte,
    // including replacement-character behavior on invalid UTF-8.
    const bodyBytes = Buffer.from(await res.arrayBuffer());
    const bodyText = bodyBytes.toString('utf8');
    // `M160`/`D807`: unrounded. This value reaches the latency histogram, `threshold pNN`
    // and `expect duration`, all of which are built for precision `Math.round` destroys —
    // at a 0.4 ms response the rounding error was 100%. Render-time rounding is `D809`.
    const durationMs = performance.now() - start;
    const headers = buildHeaderMap(res.headers);
    let json: unknown;
    try {
      json = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, statusText: res.statusText, headers, bodyText, bodyBytes, json, durationMs, finalUrl, cookieEvents };
  } catch (err) {
    // An `allow hosts` refusal from the guarded loop above is already the finished, teachable
    // message — re-wrapping it as `request failed: … — host "x" is not in …` would bury the one
    // sentence the author needs behind a transport framing that isn't what happened (no request
    // failed; one was deliberately not sent).
    if (err instanceof AllowHostsError) throw err;
    // Likewise a chain that never terminated — thrown by the guarded loop above already typed, or
    // buried by native `redirect: 'follow'` in undici's own cause (M88a, `B4-09`/`B4-10`). The two
    // producing the *same* sentence is the point: `allow hosts` decides which of them ran, and a
    // security directive must not decide what a redirect loop means (`B4-14`).
    if (err instanceof RedirectLimitError) throw err;
    if (isRedirectLimitCause(err)) throw new RedirectLimitError(redirectLimitMessage(opts.method, opts.url));
    if (controller.signal.aborted) throw new RequestTimeoutError(`request timed out after ${opts.timeoutMs}ms: ${opts.method} ${opts.url}`);
    throw new RuntimeError(`request failed: ${opts.method} ${opts.url} — ${(err as Error).message}${fetchErrorHint(err, opts.url)}`);
  } finally {
    clearTimeout(timer);
  }
}
