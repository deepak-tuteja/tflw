// The fetch binding (M1, widened M2). No Playwright dependency here — the browser binding is a
// separate module added in M3 (SPEC §14). Sends a fully-built request and returns a response
// trace. `body` is whatever `BodyInit` the caller prepared (string for JSON/text/urlencoded,
// `FormData` for multipart uploads, SPEC §5.2) — decoupled from `RequestTrace.body`, which is
// purely the human-readable trace text shown in the report.

import { RuntimeError } from './eval.js';
import { sendMtlsRequest } from './mtlsWorker.js';
import type { ResponseTrace } from './types.js';

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
}

/** `Headers.forEach` already Fetch-spec-combines every repeated header with `, ` EXCEPT
 * `set-cookie`, whose entries are deliberately kept distinct (a comma is a valid, common
 * character inside a cookie's own `Expires` attribute, so joining with `, ` would corrupt it —
 * this is why the Fetch spec special-cased it). Naively overwriting `headers[key] = value` in
 * that forEach silently keeps only the last cookie of a multi-`Set-Cookie` response — e.g. a
 * session cookie *and* a CSRF cookie on one login response — with no error (decision 61). Use
 * `getSetCookie()` (WHATWG Headers, Node ≥ 18.14) to recover every value and join with `\n`,
 * a separator that can't appear inside a header value, so no cookie is silently dropped. */
function buildHeaderMap(resHeaders: Headers): Record<string, string> {
  const headers: Record<string, string> = {};
  resHeaders.forEach((value, key) => {
    headers[key] = value;
  });
  const getSetCookie = (resHeaders as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (getSetCookie) {
    const cookies = getSetCookie.call(resHeaders);
    if (cookies.length > 0) headers['set-cookie'] = cookies.join('\n');
  }
  return headers;
}

/** Node's global `fetch` collapses every network failure into a bare `TypeError: fetch failed`,
 * with the actually-useful system error one level down in `err.cause` (undici's own behavior) —
 * corporate-QA's two most common failure modes (a self-signed/private-CA staging cert, a proxy or
 * DNS misconfiguration) would otherwise surface as that same opaque message with no lead at all
 * (decision 78). Unwraps the cause chain into a named hint; returns '' for anything unrecognised
 * (the raw `err.message` still gets through unmodified from the caller). */
export function fetchErrorHint(err: unknown): string {
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
      return '';
  }
}

export async function sendRequest(opts: SendRequestOptions): Promise<ResponseTrace> {
  // `mtls` routes through a dedicated child process (`mtlsWorker.ts`, M35c) carrying the client
  // cert/key over a one-off `undici.Agent` — isolated there specifically so the `undici` npm
  // package (needed for that `Agent` class) is never imported in *this* process: merely importing
  // it, even without calling it, was found to cripple this global `fetch()` below by ~20x (M35b,
  // `acceptance/perf/profile/FINDINGS_M35B_ROOT_CAUSE.md`) — every other request keeps using the
  // global `fetch` unchanged.
  if (opts.mtls) {
    try {
      return await sendMtlsRequest({ ...opts, mtls: opts.mtls });
    } catch (err) {
      if ((err as { timedOut?: boolean }).timedOut) throw new RuntimeError(`request timed out after ${opts.timeoutMs}ms: ${opts.method} ${opts.url}`);
      throw new RuntimeError(`request failed: ${opts.method} ${opts.url} — ${(err as Error).message}${fetchErrorHint(err)}`);
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const start = performance.now();
  try {
    const res = await fetch(opts.url, {
      method: opts.method,
      headers: opts.headers,
      body: opts.body,
      signal: controller.signal,
      redirect: opts.followRedirects ? 'follow' : 'manual',
    });
    // Single read (gap #17): the body stream can only be consumed once, so `bodyText` is derived
    // from `bodyBytes` rather than a separate `res.text()` call — confirmed behavior-preserving,
    // `Buffer.from(bytes).toString('utf8')` matches `res.text()`'s own `TextDecoder` byte-for-byte,
    // including replacement-character behavior on invalid UTF-8.
    const bodyBytes = Buffer.from(await res.arrayBuffer());
    const bodyText = bodyBytes.toString('utf8');
    const durationMs = Math.round(performance.now() - start);
    const headers = buildHeaderMap(res.headers);
    let json: unknown;
    try {
      json = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, statusText: res.statusText, headers, bodyText, bodyBytes, json, durationMs };
  } catch (err) {
    if (controller.signal.aborted) throw new RuntimeError(`request timed out after ${opts.timeoutMs}ms: ${opts.method} ${opts.url}`);
    throw new RuntimeError(`request failed: ${opts.method} ${opts.url} — ${(err as Error).message}${fetchErrorHint(err)}`);
  } finally {
    clearTimeout(timer);
  }
}
