// M45 (PLAN_BROWSER_PERF_SECURITY.md §2.16, D75) — a load-only send path on Node's native
// `node:http`/`node:https` with a per-VU `Agent({keepAlive: true})`, structurally separate from
// `http.ts`'s `sendRequest` (`fetch()`). Never imports `undici` — the M35b root-cause finding
// (`acceptance/perf/profile/FINDINGS_M35B_ROOT_CAUSE.md`) is specific to that package; importing
// it anywhere in this shared process would re-cripple `sendRequest`'s `fetch()` for the non-load
// `tflw run` path, which is exactly why `mtlsWorker.ts` isolates its own `undici.Agent` usage in a
// dedicated child process. `node:http`'s own `Agent` was never implicated and needs no such
// isolation — it lives directly in this process, created once per VU and reused for that VU's
// whole lifetime (mirrors Artillery's/k6's own default, and M42's own finding that this is what
// closes most of the gap).

import * as http from 'node:http';
import * as https from 'node:https';
import { RuntimeError } from './eval.js';
import { fetchErrorHint } from './http.js';
import type { ResponseTrace } from './types.js';

export interface PinnedAgents {
  readonly http: http.Agent;
  readonly https: https.Agent;
}

/** One pair per VU (`interpreter.ts`'s `runLoadCore`, the closed-model per-VU spawn block) —
 * `keepAlive: true` is the entire point: without it Node's own agent still pools sockets, but
 * closes them between requests instead of reusing one across a VU's whole iteration loop. */
export function createPinnedAgents(): PinnedAgents {
  return { http: new http.Agent({ keepAlive: true }), https: new https.Agent({ keepAlive: true }) };
}

/** Called once a VU's loop ends — releases its sockets instead of leaving them open (and the
 * process un-exitable) for the run's remaining lifetime. */
export function destroyPinnedAgents(agents: PinnedAgents): void {
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
    `⚠ tflw load: pinned connection skipped for a request with ${detail} — falling back to the unpinned client for that request (M45 known limitation)\n`,
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

function isTimeoutError(err: unknown): boolean {
  const e = err as { name?: string; code?: string };
  return e.name === 'TimeoutError' || e.name === 'AbortError' || e.code === 'ABORT_ERR';
}

/** Load-only pinned send path (M45, D75). A manual redirect loop stands in for `fetch`'s
 * `redirect: 'follow'` — `node:http`/`node:https` never auto-follows a 3xx — sharing this call's
 * one `start` timestamp across every hop so a redirected request's reported duration matches what
 * `sendRequest`'s single `await fetch()` would have measured for the same chain, not just its
 * final hop. 301/302/303 downgrade a POST to a bodyless GET (matching `fetch`'s own behavior and
 * every browser); 307/308 alone preserve method + body. */
export async function sendPinnedRequest(opts: PinnedSendOptions, agents: PinnedAgents): Promise<ResponseTrace> {
  const start = performance.now();
  let current = opts;
  for (let redirects = 0; ; redirects++) {
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
        const req = lib.request(url, { method: current.method, headers, agent, signal: AbortSignal.timeout(opts.timeoutMs) }, resolve);
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
      if (isTimeoutError(err)) throw new RuntimeError(`request timed out after ${opts.timeoutMs}ms: ${opts.method} ${opts.url}`);
      throw new RuntimeError(`request failed: ${opts.method} ${opts.url} — ${(err as Error).message}${fetchErrorHint({ cause: err })}`);
    }

    const chunks: Buffer[] = [];
    try {
      for await (const chunk of res) chunks.push(chunk as Buffer);
    } catch (err) {
      if (isTimeoutError(err)) throw new RuntimeError(`request timed out after ${opts.timeoutMs}ms: ${opts.method} ${opts.url}`);
      throw new RuntimeError(`request failed: ${opts.method} ${opts.url} — ${(err as Error).message}${fetchErrorHint({ cause: err })}`);
    }
    const bodyBytes = Buffer.concat(chunks);
    const status = res.statusCode ?? 0;

    if (current.followRedirects && status >= 300 && status < 400 && res.headers.location && redirects < 20) {
      const nextUrl = new URL(res.headers.location, url).toString();
      const downgrade = status === 303 || ((status === 301 || status === 302) && current.method === 'POST');
      current = { ...current, url: nextUrl, method: downgrade ? 'GET' : current.method, body: downgrade ? undefined : current.body };
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
    return { status, statusText: res.statusMessage ?? '', headers: responseHeaders, bodyText, bodyBytes, json, durationMs };
  }
}
