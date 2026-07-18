// The fetch binding (M1, widened M2). No Playwright dependency here — the browser binding is a
// separate module added in M3 (SPEC §14). Sends a fully-built request and returns a response
// trace. `body` is whatever `BodyInit` the caller prepared (string for JSON/text/urlencoded,
// `FormData` for multipart uploads, SPEC §5.2) — decoupled from `RequestTrace.body`, which is
// purely the human-readable trace text shown in the report.

import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { Agent, fetch as undiciFetch } from 'undici';
import { RuntimeError } from './eval.js';
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

/** Node's global `fetch` reads `NODE_EXTRA_CA_CERTS`/`NODE_TLS_REJECT_UNAUTHORIZED` only once, at
 * whichever moment its default TLS context first gets built — setting either mid-process (as a
 * test does, or as a config-driven CLI run effectively does relative to Node's own startup) can
 * silently miss it. Read fresh on every mTLS connection instead of relying on that cached default,
 * so `insecure true` and a private `NODE_EXTRA_CA_CERTS` bundle both compose correctly with
 * `cert`/`key` even when set after the process has already made an earlier TLS connection. */
function mtlsConnectOptions(mtls: { readonly cert: string; readonly key: string }): { cert: string; key: string; ca: string[]; rejectUnauthorized: boolean } {
  const ca = [...rootCertificates];
  const extra = process.env.NODE_EXTRA_CA_CERTS;
  if (extra) {
    try {
      ca.push(readFileSync(extra, 'utf8'));
    } catch {
      // Same lenient behavior as Node's own handling of a bad NODE_EXTRA_CA_CERTS path: the
      // request still goes out, just without that extra bundle, rather than crashing the run.
    }
  }
  return { cert: mtls.cert, key: mtls.key, ca, rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' };
}

export async function sendRequest(opts: SendRequestOptions): Promise<ResponseTrace> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const start = performance.now();
  // `mtls` routes through a one-off undici `Agent` carrying the client cert/key, dispatched via
  // undici's own `fetch` (Node's *global* `fetch` accepts no `dispatcher` option) — every other
  // request keeps using the global `fetch` unchanged, so this dependency's blast radius is limited
  // to the new mTLS path (decision 3b, enterprise arc).
  const agent = opts.mtls ? new Agent({ connect: mtlsConnectOptions(opts.mtls) }) : undefined;
  try {
    const res = opts.mtls
      ? await undiciFetch(opts.url, {
          method: opts.method,
          headers: opts.headers,
          // Node's global `FormData`/`Blob`/`ReadableStream` (what `opts.body` is built from,
          // interpreter.ts's `prepareBody`) *are* undici's own implementations under the hood —
          // this cast bridges a type-declaration mismatch between lib.dom.d.ts and undici's
          // hand-rolled types, not a real runtime one.
          body: opts.body as unknown as string,
          signal: controller.signal,
          redirect: opts.followRedirects ? 'follow' : 'manual',
          dispatcher: agent,
        })
      : await fetch(opts.url, {
          method: opts.method,
          headers: opts.headers,
          body: opts.body,
          signal: controller.signal,
          redirect: opts.followRedirects ? 'follow' : 'manual',
        });
    const bodyText = await res.text();
    const durationMs = Math.round(performance.now() - start);
    const headers = buildHeaderMap(res.headers);
    let json: unknown;
    try {
      json = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
    } catch {
      json = undefined;
    }
    return { status: res.status, statusText: res.statusText, headers, bodyText, json, durationMs };
  } catch (err) {
    if (controller.signal.aborted) throw new RuntimeError(`request timed out after ${opts.timeoutMs}ms: ${opts.method} ${opts.url}`);
    throw new RuntimeError(`request failed: ${opts.method} ${opts.url} — ${(err as Error).message}${fetchErrorHint(err)}`);
  } finally {
    clearTimeout(timer);
    if (agent) await agent.close();
  }
}
