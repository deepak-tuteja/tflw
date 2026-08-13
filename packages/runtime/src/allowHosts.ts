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
    // M128c. Its own variant rather than reusing `request`, for the reason every variant here
    // exists: "refusing to send this request" points the author at a step they wrote, and the TLS
    // probe is not one — it is a second connection tflw opens on its own initiative to read the
    // negotiated protocol and cipher (D288). An author told the `request` sentence would go
    // re-reading an `api` step that was allowed and did send.
    case 'tls-probe':
      return `host "${hostname}" is not in ${list} — refusing to open the TLS probe connection (this is a second connection tflw makes to read the negotiated protocol and cipher, not one your step wrote; the request itself was allowed)`;
    // M130b1. Its own variant for the same reason `tls-probe` is: this is a request tflw composes on
    // its own initiative, re-issuing a step's own request under a different identity, so neither
    // "refusing to send this request" nor the TLS sentence points anywhere an author can act on. It
    // names the principal, because that is the part of this request the author did not write.
    case 'authz-probe':
      return `host "${hostname}" is not in ${list} — refusing to send the authorization probe as \`${origin.principal}\` (this is a re-issue of your step's own request under another identity, not a step you wrote; the original request was allowed)`;
    case 'redirect':
      return `${origin.from} redirected to "${url}", whose host "${hostname}" is not in ${list} — refusing to follow it (the redirect target is chosen by the server, not by this step; add the host if the hop is expected)`;
    case 'browser':
      return origin.navigation
        ? `the browser tried to open "${url}", whose host "${hostname}" is not in ${list} — refusing to navigate there`
        : `the page at "${origin.pageUrl}" requested "${url}" (${origin.resourceType}), whose host "${hostname}" is not in ${list} — refusing to send it (this call came from the page, not from a step; add the host, or \`stub\` the call so it never reaches the network)`;
  }
}

/**
 * M125b1 (`FU-18`, D246) — the refusal for an absolute URL written in a suite that declares no
 * `allow hosts` at all.
 *
 * Separate from `allowHostsRefusal` above rather than a fourth `RefusalOrigin`, because every
 * variant there answers "this host is not on the list" and quotes the list. Here there is no list,
 * and saying `not in \`allow hosts\` ()` would be both ungrammatical and misleading — it reads as a
 * misconfigured allowlist when the actual state is that the guardrail was never switched on.
 *
 * Says what happened and what to write, and nothing about which check fired (C7/M84). The two ways
 * out are genuinely different choices rather than one fix and one workaround — declare the host, or
 * put it in the config as a base URL and go back to writing paths — so both are named and neither
 * is recommended over the other.
 */
export function absoluteUrlNeedsAllowHosts(url: string): string {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    hostname = url;
  }
  return (
    `this step names an absolute URL ("${url}"), and the config declares no \`allow hosts\` — refusing to send it. ` +
    `An absolute URL can reach a host \`tflw.config\` never mentions, so writing one opts the suite into saying where it may reach: ` +
    `add \`allow hosts "${hostname}"\` to the env (or to \`defaults\`). ` +
    `If this host is where the suite normally talks, giving it an \`api\` base URL and writing a path is the other way round (SPEC §3.1, §3.7).`
  );
}

export type RefusalOrigin =
  | { readonly kind: 'request' }
  | { readonly kind: 'tls-probe' }
  | { readonly kind: 'authz-probe'; readonly principal: string }
  | { readonly kind: 'redirect'; readonly from: string }
  | { readonly kind: 'browser'; readonly navigation: boolean; readonly pageUrl: string; readonly resourceType: string };
