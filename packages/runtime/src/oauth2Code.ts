// `M248` (`D1354`) — the pieces of `session <name> oauth2 code` that are not steps: the PKCE pair,
// the `state`, the authorize URL, and the loopback listener the code comes back to. The flow that
// strings them together (open the browser, run the sign-in, exchange the code) is `runOauth2CodeSession`
// in `interpreter.ts`, beside the client-credentials session it extends; these are kept apart so each
// can be tested without a browser.
//
// RFC 7636 (PKCE) and RFC 8252 §7.3 (loopback redirect) are the two documents this follows. The
// verifier is 32 random bytes as base64url (43 characters, inside 7636's 43–128), the challenge is
// its SHA-256 as base64url (`S256`, the only method sent — `plain` exists for clients that cannot
// hash, and this one can), and the listener binds the redirect's own host on the port it names, `0`
// asking the OS for one, which is 8252's "any port" rule seen from the client's side.

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface PkcePair {
  readonly verifier: string;
  readonly challenge: string;
}

export function pkcePair(): PkcePair {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: challengeOf(verifier) };
}

/** `S256`: base64url(SHA-256(verifier)), no padding (RFC 7636 §4.2). */
export function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function newState(): string {
  return randomBytes(16).toString('base64url');
}

export interface AuthorizeParams {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly state: string;
  readonly scope?: string;
}

/** The authorize URL with the grant's parameters added to whatever query it already carries. */
export function authorizeUrlFor(authorizeUrl: string, p: AuthorizeParams): string {
  const url = new URL(authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', p.clientId);
  url.searchParams.set('redirect_uri', p.redirectUri);
  url.searchParams.set('code_challenge', p.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', p.state);
  if (p.scope !== undefined) url.searchParams.set('scope', p.scope);
  return url.toString();
}

/** What arrived on the redirect: a code, or the authorization server's refusal (RFC 6749 §4.1.2.1). */
export type RedirectArrival =
  | { readonly kind: 'code'; readonly code: string; readonly state: string | null }
  | { readonly kind: 'error'; readonly error: string; readonly description: string | null; readonly state: string | null };

export interface RedirectListener {
  /** The redirect as sent to the authorization server — the declared one with the bound port. */
  readonly redirectUri: string;
  /** Resolves with the first request to the redirect's path that carries `code` or `error`, or
   * `null` when `timeoutMs` passes first. Any other request (a favicon, a stray path) is answered
   * `404` and ignored. */
  arrival(timeoutMs: number): Promise<RedirectArrival | null>;
  close(): Promise<void>;
}

const PAGE = (title: string, line: string): string =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;margin:3rem"><h1>${title}</h1><p>${line}</p></body>`;

/** Bind the loopback listener for `redirect` (already checked by `loopbackRedirectRefusal`). */
export async function startRedirectListener(redirect: string): Promise<RedirectListener> {
  const declared = new URL(redirect);
  const path = declared.pathname || '/';
  // `URL.hostname` keeps the brackets on an IPv6 literal; `listen` wants the bare address.
  const host = declared.hostname === '[::1]' ? '::1' : declared.hostname;
  const port = declared.port === '' ? 80 : Number(declared.port);

  let settle: ((a: RedirectArrival) => void) | null = null;
  let arrived: RedirectArrival | null = null;
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://loopback');
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');
    if (url.pathname !== path || (code === null && error === null)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not the redirect');
      return;
    }
    const state = url.searchParams.get('state');
    const a: RedirectArrival = code !== null
      ? { kind: 'code', code, state }
      : { kind: 'error', error: error!, description: url.searchParams.get('error_description'), state };
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
    res.end(a.kind === 'code' ? PAGE('Signed in', 'tflw has the code and is exchanging it. This tab can close.') : PAGE('Sign-in refused', 'The authorization server refused the request; tflw reports why.'));
    if (!arrived) {
      arrived = a;
      settle?.(a);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const bound = (server.address() as AddressInfo).port;
  const uri = new URL(redirect);
  uri.port = String(bound);

  return {
    redirectUri: uri.toString(),
    arrival(timeoutMs: number): Promise<RedirectArrival | null> {
      if (arrived) return Promise.resolve(arrived);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          settle = null;
          resolve(null);
        }, timeoutMs);
        settle = (a) => {
          clearTimeout(timer);
          settle = null;
          resolve(a);
        };
      });
    },
    close(): Promise<void> {
      return new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      });
    },
  };
}
