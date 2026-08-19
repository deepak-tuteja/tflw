// M45 (PLAN_BROWSER_PERF_SECURITY.md §2.16, D75) — a load-only send path on Node's native
// `node:http`/`node:https` with an `Agent({keepAlive: true})`, structurally separate from
// `http.ts`'s `sendRequest` (`fetch()`). Never imports `undici` — the M35b root-cause finding
// (`tflw-acceptance/perf/profile/FINDINGS_M35B_ROOT_CAUSE.md` in testFlow-tests, moved there in
// reorg Phase 2) is specific to that package; importing
// it anywhere in this shared process would re-cripple `sendRequest`'s `fetch()` for the non-load
// `tflw run` path, which is exactly why `mtlsWorker.ts` isolates its own `undici.Agent` usage in a
// dedicated child process. `node:http`'s own `Agent` was never implicated and needs no such
// isolation — it lives directly in this process, created once per VU and reused for that VU's
// whole lifetime (mirrors Artillery's/k6's own default, and M42's own finding that this is what
// closes most of the gap).
//
// M121 (`M118-02`, D206) — this path is now the load engine's *only* client, closed and open model
// alike. M45 covered the closed model and explicitly left the open (rate-based) one on `fetch`,
// reasoning that an arrival has no persistent VU to pin a connection to. That was right about
// *pinning* and wrong about *pooling*, and the cost was not merely a lost optimisation: on Node 26
// (the first release shipping undici 8) a `fetch` started inside a timer callback and not awaited
// by that loop — precisely the open model's dispatch shape — has its completion deferred to roughly
// the next timer tick, so a 0.2ms endpoint reported p50 36ms while the closed model reported 0ms
// over the same endpoint in the same process. Measured chain and version bisect:
// `tflw-acceptance/perf/profile/FINDINGS_M121_OPEN_MODEL_FETCH.md`. M35b's lesson arriving a second
// time at the one path M45 declined to cover.

import * as http from 'node:http';
import * as https from 'node:https';
import { RuntimeError } from './eval.js';
import { RequestTimeoutError, fetchErrorHint } from './http.js';
import { AllowHostsError, allowHostsRefusal, isHostAllowed } from './allowHosts.js';
import { MAX_REDIRECTS, RedirectLimitError, chainCookieForRedirect, cookieEventFor, isRedirectStatus, nextRedirectHop, redirectLimitMessage } from './redirect.js';
import type { CookieEvent, ResponseTrace } from './types.js';

export interface KeepAliveAgents {
  readonly http: http.Agent;
  readonly https: https.Agent;
}

// M121 (D208) — `maxSockets: Infinity` is `http.Agent`'s own default and is set explicitly here
// because for the open model it is load-bearing rather than incidental. A bounded pool would make
// excess arrivals queue *inside the generator*, and that queue time lands inside `sendPinnedRequest`
// below — i.e. it would be counted into the reported `durationMs`, manufacturing for real the defect
// `M118-02` was originally (and wrongly) filed as. An open model exists to let queues build **at the
// target**, where they are the signal; a queue in the client is noise wearing the signal's clothes.
// The closed model cannot hit this — a VU issues one request at a time — so this constraint comes
// from the caller M121 added, not from the pair itself.
const MAX_SOCKETS = Infinity;

/** One pair per VU for the closed model (`interpreter.ts`'s `runLoadCore` spawn blocks), one pair
 * per *scenario* for the open model (M121/D207 — an arrival is not a VU and has nothing to pin to,
 * but every arrival in a scenario can still share one pool; a pair per arrival would add a fresh TCP
 * handshake to every sample and be strictly worse than the `fetch` path it replaced).
 * `keepAlive: true` is the entire point: without it Node's own agent still pools sockets, but
 * closes them between requests instead of reusing one across a VU's whole iteration loop. */
export function createKeepAliveAgents(): KeepAliveAgents {
  return {
    http: new http.Agent({ keepAlive: true, maxSockets: MAX_SOCKETS }),
    https: new https.Agent({ keepAlive: true, maxSockets: MAX_SOCKETS }),
  };
}

/** Called once a VU's loop ends (closed model) or once a scenario's last arrival settles (open) —
 * releases the sockets instead of leaving them open (and the process un-exitable) for the run's
 * remaining lifetime. */
export function destroyKeepAliveAgents(agents: KeepAliveAgents): void {
  agents.http.destroy();
  agents.https.destroy();
}

export interface PinnedSendOptions {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly timeoutMs: number;
  readonly followRedirects: boolean;
  /** This env's `allow hosts` list, or `null`/absent for no enforcement (SPEC §3.7). The caller
   * has already checked the URL it composed; what this loop adds is every hop after it (M85,
   * C1/`B4-02`). */
  readonly allowHosts?: readonly string[] | null;
}

const warnedFallbacks = new Set<string>();

/** A request `execApi` (interpreter.ts) couldn't route through the pinned path — a `FormData`/
 * upload body, or an mTLS request (own dedicated worker path, no pinning benefit there — an
 * acknowledged M45 gap, not solved by this milestone). Falls back to `sendRequest`'s unpinned
 * `fetch()` for that one request; printed once per reason per process so a scenario hitting this
 * on every iteration doesn't flood the console. */
export function warnPinnedFallback(reason: 'formdata' | 'mtls'): void {
  if (warnedFallbacks.has(reason)) return;
  warnedFallbacks.add(reason);
  const detail = reason === 'formdata' ? 'a multipart/upload body' : 'an mTLS client cert';
  process.stderr.write(
    `⚠ tflw run: pinned connection skipped for a request with ${detail} — falling back to the unpinned client for that request (M45 known limitation)\n`,
  );
}

function hasHeaderCI(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((k) => k.toLowerCase() === name.toLowerCase());
}

/** Mirrors `http.ts`'s own `buildHeaderMap`, adapted to `IncomingHttpHeaders`'s shape — Node's own
 * parser already merges duplicate headers (comma-joined) except `set-cookie`, which it keeps as an
 * array precisely so a multi-`Set-Cookie` response survives intact (the same reason `http.ts`
 * special-cases it via `getSetCookie()` on the Fetch `Headers` side). */
function buildHeaderMap(resHeaders: http.IncomingHttpHeaders): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(resHeaders)) {
    if (value === undefined) continue;
    headers[key] = Array.isArray(value) ? value.join(key === 'set-cookie' ? '\n' : ', ') : value;
  }
  return headers;
}

// The redirect decision this loop used to own — `CROSS_ORIGIN_STRIPPED_HEADERS`,
// `DOWNGRADE_STRIPPED_HEADERS`, `isSameOrigin`, the 301/302/303-vs-307/308 split and the hop cap —
// moved verbatim to `redirect.ts` in M85, unchanged. It was written here because `node:http` never
// auto-follows a 3xx and so this file had to make the calls `fetch` makes for the pooled path; the
// pooled path now has to make them too — at first only when `allow hosts` was enforced (M85,
// C1/`B4-02`), and since M88c1 (D-M88-14) on every chain it follows — and one shared statement is
// the only way the two stay the same answer.

function isTimeoutError(err: unknown): boolean {
  const e = err as { name?: string; code?: string };
  return e.name === 'TimeoutError' || e.name === 'AbortError' || e.code === 'ABORT_ERR';
}

/** Load-only pinned send path (M45, D75). A manual redirect loop stands in for `fetch`'s
 * `redirect: 'follow'` — `node:http`/`node:https` never auto-follows a 3xx — sharing this call's
 * one `start` timestamp across every hop so a redirected request's reported duration matches what
 * `sendRequest`'s single `await fetch()` would have measured for the same chain, not just its
 * final hop, and (M88b) one *deadline* across every hop for the same reason: a measured duration
 * and the budget it is measured against have to cover the same thing.
 * 301/302/303 downgrade a POST to a bodyless GET, dropping the body's own headers with
 * it (matching `fetch`'s own behavior and every browser); 307/308 alone preserve method + body; a
 * hop that leaves the origin drops the
 * credential headers `fetch` would drop (`CROSS_ORIGIN_STRIPPED_HEADERS`, M80/B4-01). Every one of
 * those is a place `redirect: 'follow'` decides something on the pooled path that this loop has to
 * decide identically — the pooled path is normative, and `httpPinned.test.ts` states each such
 * property as a pinned-vs-pooled comparison rather than a hardcoded expectation. */
export async function sendPinnedRequest(opts: PinnedSendOptions, agents: KeepAliveAgents): Promise<ResponseTrace> {
  const start = performance.now();
  let current = opts;

  // D81 (PLAN_BROWSER_PERF_SECURITY.md §2.2x) — a plain setTimeout/clearTimeout hard deadline
  // replaces AbortSignal.timeout(opts.timeoutMs). An isolated diagnostic (60k requests/side
  // against a zero-work local server, 7 interleaved rounds) found AbortSignal.timeout()
  // attached a real, reproducible tail cost — a 7-18ms single-request stall in 5/7 rounds,
  // absent in 0/7 no-signal rounds — with avg/p50/p95/p99 unaffected either way (a rare,
  // per-request-object/timer-bookkeeping event, not a systemic cost). AbortController/
  // AbortSignal wraps EventTarget + internal listener bookkeeping that plain setTimeout doesn't
  // pay for; a manual timer reproduced in the same isolated test showed no such spike (max
  // stayed in the ~1ms no-signal band across 5/5 rounds). `req.destroy()` (no argument) on an
  // in-flight request surfaces as a generic ECONNRESET/"socket hang up" on `error` — not a
  // distinguishable code — so timeout detection here uses a closure flag (`timedOut`), not the
  // caught error's shape (confirmed via the same diagnostic, not assumed).
  //
  // M88b (`B4-04`, D-M88-2) — armed **once, out here**, not per hop. It used to live inside the
  // loop, so every redirect got a fresh `timeoutMs` and `timeout step 1s` meant "no single hop
  // exceeds 1s" on this path while meaning "the step finishes within 1s" on the other two
  // (`http.ts:159` holds one `AbortController` across `fetch`'s whole follow; `mtlsWorker.ts:80`
  // hoists its own above its own loop). A 3-hop chain at 400ms/hop therefore failed functionally
  // and *passed* under a workload, which then reported p95 1210ms — 21% over its own configured
  // deadline — as healthy. The pooled path is normative (D-M88-1); this is now what it does.
  // Which hop is in flight changes, so the timer destroys whichever one is (`inFlight`) rather
  // than closing over a single `req`.
  let timedOut = false;
  let inFlight: http.ClientRequest | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    inFlight?.destroy();
  }, opts.timeoutMs);
  // Phrased from the original request on every hop, like the redirect-cap message (M88a): it is
  // the request the author wrote, and it is all native `redirect: 'follow'` would have known.
  const timeoutError = (): RuntimeError => new RequestTimeoutError(`request timed out after ${opts.timeoutMs}ms: ${opts.method} ${opts.url}`);

  // M88c1 (`B4-15`) — every hop's `Set-Cookie`, not just the last one's. This loop was already the
  // path with the *least* excuse for losing them: unlike native `redirect: 'follow'`, it has held
  // `res.headers` for each hop all along and simply threw them away on `continue`.
  const cookieEvents: CookieEvent[] = [];

  // Cleared exactly once, on every exit — success, timeout, refusal or cap. Leaving it armed past
  // a `return` would hold the VU's event loop open for the rest of `timeoutMs` on every request a
  // workload makes, which is the one thing this path cannot afford.
  try {
    for (let redirects = 0; ; redirects++) {
      // The deadline can also expire *between* hops — while the previous hop's body was draining,
      // or in the turn after it finished. `inFlight` is a completed request by then, so destroying
      // it does nothing, and without this check the loop would open a fresh connection to the next
      // hop having already blown the budget. Everything from here to `lib.request` below is
      // synchronous, so no timer can slip in after the check and before the connection.
      if (timedOut) throw timeoutError();

      const url = new URL(current.url);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;
      const agent = isHttps ? agents.https : agents.http;
      const bodyBuffer = current.body === undefined ? undefined : Buffer.from(current.body, 'utf8');
      const headers: Record<string, string> = { ...current.headers };
      if (bodyBuffer !== undefined && !hasHeaderCI(headers, 'content-length') && !hasHeaderCI(headers, 'transfer-encoding')) {
        headers['content-length'] = String(bodyBuffer.length);
      }

      let res: http.IncomingMessage;
      try {
        res = await new Promise<http.IncomingMessage>((resolve, reject) => {
          const req = lib.request(url, { method: current.method, headers, agent }, resolve);
          inFlight = req;
          // D76/D77 (PLAN_BROWSER_PERF_SECURITY.md §2.17) — unlike undici (fetch's own connect.js
          // calls socket.setNoDelay(true) unconditionally) and unlike Go's net.Dial (k6, TCP_NODELAY
          // on by default), node:http/https leaves Nagle's algorithm ON unless the caller opts out.
          // Nagle + a peer's delayed-ACK timer (~40ms) is a well-documented cause of intermittent
          // head-of-line stalls when headers and a small body are written in separate socket.write()
          // calls — exactly this path's shape, and exactly a p95-tail symptom, not a throughput one.
          req.setNoDelay(true);
          req.on('error', reject);
          if (bodyBuffer !== undefined) req.end(bodyBuffer);
          else req.end();
        });
      } catch (err) {
        if (timedOut || isTimeoutError(err)) throw timeoutError();
        throw new RuntimeError(`request failed: ${opts.method} ${opts.url} — ${(err as Error).message}${fetchErrorHint({ cause: err }, opts.url)}`);
      }
      // Filed under the URL this hop was sent to, before the redirect branch below can `continue`
      // past it — `current.url` is reassigned there, and after the loop it names the terminus, which
      // is the wrong origin for a cookie set three hops earlier (D-M88-8).
      const event = cookieEventFor(current.url, res.headers['set-cookie']);
      if (event) cookieEvents.push(event);

      // The deadline still spans the body read as well as the request, which is what
      // AbortSignal.timeout() gave for free (it stayed attached to `req` until destroyed, so a
      // slow body drip past `timeoutMs` was aborted too, not just a slow time-to-first-byte) —
      // it just now spans every hop's body read rather than restarting for each.
      const chunks: Buffer[] = [];
      try {
        for await (const chunk of res) chunks.push(chunk as Buffer);
      } catch (err) {
        if (timedOut || isTimeoutError(err)) throw timeoutError();
        throw new RuntimeError(`request failed: ${opts.method} ${opts.url} — ${(err as Error).message}${fetchErrorHint({ cause: err }, opts.url)}`);
      }
      const bodyBytes = Buffer.concat(chunks);
      const status = res.statusCode ?? 0;

      if (current.followRedirects && isRedirectStatus(status) && res.headers.location) {
        // The cap was `redirects < MAX_REDIRECTS` folded into this same condition, so hitting it fell
        // through to the `return` below and handed the 21st hop's 3xx back as an ordinary response —
        // a workload could loop forever and still report a 0% error rate (M88a, `B4-09`). The pooled
        // path is normative (D-M88-1) and `fetch` throws here.
        if (redirects >= MAX_REDIRECTS) throw new RedirectLimitError(redirectLimitMessage(opts.method, opts.url));
        const hop = nextRedirectHop(current, status, res.headers.location, chainCookieForRedirect(current.url, String(res.headers.location), cookieEvents));
        // The guardrail, one hop at a time (M85, C1/`B4-02`). `execApi` checked the URL *this step
        // names*; nothing checked where a 3xx then sent it, so an allowlisted staging host that
        // redirects to prod reached prod on both client paths. Refusing here is what makes SPEC
        // §3.7's "no connection ever attempted" true of the whole chain and not just its first link:
        // the next `lib.request` never happens.
        if (!isHostAllowed(hop.url, current.allowHosts)) {
          throw new AllowHostsError(allowHostsRefusal(hop.url, current.allowHosts!, { kind: 'redirect', from: `${current.method} ${current.url}` }));
        }
        current = { ...current, url: hop.url, headers: hop.headers, method: hop.method, body: hop.dropBody ? undefined : current.body };
        continue;
      }

      const durationMs = Math.round(performance.now() - start);
      const bodyText = bodyBytes.toString('utf8');
      const responseHeaders = buildHeaderMap(res.headers);
      let json: unknown;
      try {
        json = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
      } catch {
        json = undefined;
      }
      return { status, statusText: res.statusMessage ?? '', headers: responseHeaders, bodyText, bodyBytes, json, durationMs, finalUrl: current.url, cookieEvents };
    }
  } finally {
    clearTimeout(timer);
  }
}
