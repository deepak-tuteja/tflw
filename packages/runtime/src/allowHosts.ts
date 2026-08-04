// `allow hosts "…"` (SPEC §3.7, PLAN decision 101a, enterprise arc cluster 2) — the anti-pointed-
// at-prod guardrail, extracted here in M85 (review cluster C1: `B4-02`, `B4-03`, `A4-10`).
//
// It used to live as a private helper inside `interpreter.ts`, which is why it only ever guarded
// the three call sites the interpreter itself makes: an `api` step's composed URL, the `oauth2`
// token request, and a contract fetch. Everything else that opens a socket during a run —
// a redirect hop on any of the three HTTP clients, and the entire browser half — reached the
// network without passing through it, while SPEC §3.7 claimed it "covers every real network call
// a run makes".
//
// The rule this module now states once, for every path: **a host tflw connects to must be on the
// list, checked immediately before the connection, not after it.** Anything that needs to make a
// connection imports `isHostAllowed`; nothing re-implements the matcher.

import { hostMatchesAllowPattern } from '@tflw/lang';
import { RuntimeError } from './eval.js';

/** A refusal, distinguishable from every other `RuntimeError` by type rather than by matching its
 * text. Three layers between the guard and the reporter (`sendRequest`'s catch, the mTLS worker's
 * IPC error channel, `runAction`'s browser wrapper) each re-frame an error they receive as
 * "request failed: … — <message>"; a refusal must survive all three intact, because it is already
 * the finished sentence and nothing failed — a request was deliberately not sent. */
export class AllowHostsError extends RuntimeError {}

/** `null`/empty means the key was never declared: no enforcement at all, the unchanged default
 * (SPEC §3.7). Anything that isn't `http(s)` — `about:blank`, `data:`, `blob:`, a `file://` page —
 * names no host to allow or refuse and is never the thing this guardrail is about; those are let
 * through so the browser guard below can stay a blanket route handler. */
export function isHostAllowed(url: string, allowHosts: readonly string[] | null | undefined): boolean {
  if (!allowHosts || allowHosts.length === 0) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  return allowHosts.some((pattern) => hostMatchesAllowPattern(parsed.hostname, pattern));
}

/** The refusal, phrased for where the request came from. The original wording — "refusing to send
 * this request" — is right for a request tflw composes itself, and wrong for the two surfaces M85
 * adds: a redirect is a host the *server* chose, and a browser request is one the *page* chose, so
 * neither is something the author can find by re-reading their own step. Each variant therefore
 * names who picked the host (C7/M84's discipline: say what happened, not which check fired). */
export function allowHostsRefusal(url: string, allowHosts: readonly string[], origin: RefusalOrigin): string {
  const hostname = new URL(url).hostname;
  const list = `\`allow hosts\` (${allowHosts.join(', ')})`;
  switch (origin.kind) {
    case 'request':
      return `host "${hostname}" is not in ${list} — refusing to send this request`;
    case 'redirect':
      return `${origin.from} redirected to "${url}", whose host "${hostname}" is not in ${list} — refusing to follow it (the redirect target is chosen by the server, not by this step; add the host if the hop is expected)`;
    case 'browser':
      return origin.navigation
        ? `the browser tried to open "${url}", whose host "${hostname}" is not in ${list} — refusing to navigate there`
        : `the page at "${origin.pageUrl}" requested "${url}" (${origin.resourceType}), whose host "${hostname}" is not in ${list} — refusing to send it (this call came from the page, not from a step; add the host, or \`stub\` the call so it never reaches the network)`;
  }
}

export type RefusalOrigin =
  | { readonly kind: 'request' }
  | { readonly kind: 'redirect'; readonly from: string }
  | { readonly kind: 'browser'; readonly navigation: boolean; readonly pageUrl: string; readonly resourceType: string };
