// mTLS dispatch, isolated in its own child process (PLAN_BROWSER_PERF_SECURITY.md M35b/M35c).
// M35b found that merely *importing* the `undici` npm package (for its `Agent` class — needed to
// carry a client cert/key on the TLS handshake, SPEC §3.5) cripples Node's separate, built-in
// global `fetch()` for the rest of the process — an ~18-26x slowdown, present the instant the
// module loads, independent of whether any mTLS request ever actually fires. A `worker_thread`
// isolates it too, but a real child process was chosen instead: this code must work both inside
// the bundled CLI *and* inside `@tflw/runtime`'s own unit tests (`mtls.test.ts` calls `runProgram`
// directly — no `cli.ts`/`process.argv[1]` dispatch in that graph at all), so a genuinely separate,
// purpose-built entry file (`mtlsWorkerEntry.ts`) is forked directly rather than reusing the
// load-worker's `process.argv[1]` self-fork trick (M31/D19), which only works because it's called
// exclusively from within `cli.ts` itself.

import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuntimeError } from './eval.js';
import { AllowHostsError, allowHostsRefusal, isHostAllowed } from './allowHosts.js';
import { MAX_REDIRECTS, RedirectLimitError, isRedirectLimitCause, isRedirectStatus, nextRedirectHop, redirectLimitMessage } from './redirect.js';
import type { ResponseTrace } from './types.js';
import type { SendRequestOptions } from './http.js';

type MtlsRequestMessage = {
  readonly type: 'request';
  readonly id: number;
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly timeoutMs: number;
  readonly followRedirects: boolean;
  readonly mtls: { readonly cert: string; readonly key: string };
  /** SPEC §3.7, carried across the process boundary so the child can guard its own redirect hops
   * (M85, C1/`B4-02`) — the third client path, and the one easiest to forget precisely because it
   * runs somewhere else. */
  readonly allowHosts?: readonly string[] | null;
};

type MtlsWorkerFromParentMessage = MtlsRequestMessage;

type MtlsWorkerToParentMessage =
  | { readonly type: 'ready' }
  | {
      readonly type: 'response';
      readonly id: number;
      readonly status: number;
      readonly statusText: string;
      readonly headers: Record<string, string>;
      readonly bodyText: string;
      readonly bodyBytes: Buffer;
      readonly json: unknown;
      readonly durationMs: number;
    }
  | { readonly type: 'error'; readonly id: number; readonly message: string; readonly timedOut: boolean; readonly code?: string; readonly refused?: boolean; readonly redirectLimit?: boolean };

/** Server side — runs inside the forked child (`mtlsWorkerEntry.ts`), never in the main process.
 * `undici` is imported here, and *only* here — this file's whole reason to exist. */
export async function runMtlsWorkerProcess(): Promise<void> {
  const { Agent, fetch: undiciFetch } = await import('undici');
  const { rootCertificates } = await import('node:tls');
  const { readFileSync } = await import('node:fs');

  function mtlsConnectOptions(mtls: { readonly cert: string; readonly key: string }): { cert: string; key: string; ca: string[]; rejectUnauthorized: boolean } {
    const ca = [...rootCertificates];
    const extra = process.env.NODE_EXTRA_CA_CERTS;
    if (extra) {
      try {
        ca.push(readFileSync(extra, 'utf8'));
      } catch {
        // Same lenient behavior as http.ts's own original version: request still goes out.
      }
    }
    return { cert: mtls.cert, key: mtls.key, ca, rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' };
  }

  process.on('message', (msg: MtlsWorkerFromParentMessage) => {
    void (async () => {
      const { id } = msg;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), msg.timeoutMs);
      const agent = new Agent({ connect: mtlsConnectOptions(msg.mtls) });
      const start = performance.now();
      try {
        // Same conditional split as the pooled path (`http.ts#mustFollowByHand`): without an
        // `allow hosts` list this stays one native `redirect: 'follow'` call; with one, the chain
        // is walked a hop at a time so the list can be checked before each connection (M85,
        // C1/`B4-02`). The hop decision itself comes from `redirect.ts` — shared with the other two
        // clients, because three clients silently disagreeing about redirects is review cluster C2
        // and this milestone must not add a fourth opinion to it.
        const guarded = msg.followRedirects && !!msg.allowHosts && msg.allowHosts.length > 0;
        let res!: Awaited<ReturnType<typeof undiciFetch>>;
        if (!guarded) {
          res = await undiciFetch(msg.url, {
            method: msg.method,
            headers: msg.headers,
            body: msg.body,
            signal: controller.signal,
            redirect: msg.followRedirects ? 'follow' : 'manual',
            dispatcher: agent,
          });
        } else {
          let current: { url: string; method: string; headers: Record<string, string>; body?: string } = { url: msg.url, method: msg.method, headers: msg.headers, body: msg.body };
          for (let redirects = 0; ; redirects++) {
            res = await undiciFetch(current.url, { method: current.method, headers: current.headers, body: current.body, signal: controller.signal, redirect: 'manual', dispatcher: agent });
            const location = res.headers.get('location');
            if (!isRedirectStatus(res.status) || !location) break;
            if (redirects >= MAX_REDIRECTS) {
              // Not `break` (M88a, `B4-09`) — breaking here fell through to the `response` message
              // below and reported the 21st hop's 3xx as an ordinary answer. The `!guarded` branch
              // above, which is the same request without `allow hosts`, throws; so does this now.
              await res.arrayBuffer().catch(() => undefined);
              process.send?.({ type: 'error', id, message: redirectLimitMessage(msg.method, msg.url), timedOut: false, redirectLimit: true } satisfies MtlsWorkerToParentMessage);
              return;
            }
            const hop = nextRedirectHop(current, res.status, location);
            await res.arrayBuffer().catch(() => undefined); // release the socket either way
            if (!isHostAllowed(hop.url, msg.allowHosts)) {
              process.send?.({ type: 'error', id, message: allowHostsRefusal(hop.url, msg.allowHosts!, { kind: 'redirect', from: `${current.method} ${current.url}` }), timedOut: false, refused: true } satisfies MtlsWorkerToParentMessage);
              return;
            }
            current = { url: hop.url, method: hop.method, headers: hop.headers, body: hop.dropBody ? undefined : current.body };
          }
        }
        const bodyBytes = Buffer.from(await res.arrayBuffer());
        const bodyText = bodyBytes.toString('utf8');
        const durationMs = Math.round(performance.now() - start);
        const headers: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          headers[key] = value;
        });
        let json: unknown;
        try {
          json = bodyText.length > 0 ? JSON.parse(bodyText) : undefined;
        } catch {
          json = undefined;
        }
        process.send?.({ type: 'response', id, status: res.status, statusText: res.statusText, headers, bodyText, bodyBytes, json, durationMs } satisfies MtlsWorkerToParentMessage);
      } catch (err) {
        const timedOut = controller.signal.aborted;
        const cause = (err as { cause?: { code?: unknown } } | undefined)?.cause;
        const code = typeof cause?.code === 'string' ? cause.code : undefined;
        // The `!guarded` branch's native `redirect: 'follow'` reports the cap as undici's opaque
        // `fetch failed`; relabel it here so both branches cross the IPC boundary saying the same
        // thing (M88a, `B4-10`) — the parent can't tell them apart once it's a bare message.
        if (isRedirectLimitCause(err)) {
          process.send?.({ type: 'error', id, message: redirectLimitMessage(msg.method, msg.url), timedOut: false, redirectLimit: true } satisfies MtlsWorkerToParentMessage);
          return;
        }
        process.send?.({ type: 'error', id, message: (err as Error).message, timedOut, code } satisfies MtlsWorkerToParentMessage);
      } finally {
        clearTimeout(timer);
        await agent.close();
      }
    })();
  });
  process.send?.({ type: 'ready' } satisfies MtlsWorkerToParentMessage);
}

// --- Client side (main process) ---

let child: ChildProcess | undefined;
let readyPromise: Promise<void> | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (r: ResponseTrace) => void; reject: (e: Error) => void }>();

// `import.meta.url` is only valid when this module is real ESM (dev/test, unbundled `tsx`, and
// `@tflw/runtime`'s own `tsc`-compiled `dist/*.js` output — the package stays `"type": "module"`).
// `bundle.mjs` forces `format: 'cjs'` for both `dist/cli.cjs` and `dist/mtls-worker.cjs`, where
// `import.meta.url` is empty (esbuild's own warning) but `__dirname` is the real, correct Node CJS
// global instead — `typeof` is the standard safe way to probe for an identifier that may not be
// declared at all in the current module format without it throwing a `ReferenceError`.
declare const __dirname: string | undefined;

function resolveWorkerEntryPath(): string {
  const here = typeof __dirname !== 'undefined' ? __dirname : dirname(fileURLToPath(import.meta.url));
  const bundled = join(here, 'mtls-worker.cjs');
  if (existsSync(bundled)) return bundled;
  // Dev/test: unbundled, running as source via tsx — the sibling `.ts` file, same directory.
  return join(here, 'mtlsWorkerEntry.ts');
}

function getChild(): ChildProcess {
  if (child) return child;
  const entry = resolveWorkerEntryPath();
  const isSource = entry.endsWith('.ts');
  child = fork(entry, [], {
    execArgv: isSource ? process.execArgv : [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  const spawned = child;
  readyPromise = new Promise((resolve) => {
    spawned.once('message', (msg: MtlsWorkerToParentMessage) => {
      if (msg.type === 'ready') resolve();
    });
  });
  spawned.on('message', (msg: MtlsWorkerToParentMessage) => {
    if (msg.type === 'ready') return;
    const entry2 = pending.get(msg.id);
    if (!entry2) return;
    pending.delete(msg.id);
    if (msg.type === 'response') {
      entry2.resolve({ status: msg.status, statusText: msg.statusText, headers: msg.headers, bodyText: msg.bodyText, bodyBytes: msg.bodyBytes, json: msg.json, durationMs: msg.durationMs });
    } else {
      // Left as a plain Error (not a RuntimeError) with `.cause.code`/`.timedOut` mirroring the
      // shape `sendRequest`'s own non-mTLS catch block already expects — `http.ts` formats the
      // final user-facing message the same way for both paths (`fetchErrorHint`, the "timed out
      // after Nms" text), rather than duplicating that formatting here.
      // …except an `allow hosts` refusal (M85), which isn't a transport failure to be formatted —
      // it's a finished sentence about a request that was deliberately never sent. A `RuntimeError`
      // is `sendRequest`'s signal to re-throw verbatim rather than wrap.
      // A redirect-cap error is the same kind of thing as a refusal: a finished sentence about a
      // chain, not a transport failure to be re-framed as "request failed: …" (M88a, `B4-09`).
      const e = msg.refused
        ? new AllowHostsError(msg.message)
        : msg.redirectLimit
          ? new RedirectLimitError(msg.message)
          : Object.assign(new Error(msg.message), { timedOut: msg.timedOut, cause: msg.code ? { code: msg.code } : undefined });
      entry2.reject(e);
    }
  });
  spawned.on('exit', () => {
    if (child === spawned) child = undefined;
    for (const { reject } of pending.values()) reject(new RuntimeError('mTLS worker process exited unexpectedly'));
    pending.clear();
  });
  return child;
}

/** Client side — called from `http.ts`'s `sendRequest` for any request carrying `mtls` creds.
 * Lazily spawns (once) and reuses a single persistent worker for the rest of the process — every
 * mTLS request in the run, including `retry honoring "Retry-After"` re-attempts, reuses it. */
export async function sendMtlsRequest(opts: SendRequestOptions & { readonly mtls: { readonly cert: string; readonly key: string } }): Promise<ResponseTrace> {
  const c = getChild();
  await readyPromise;
  const id = nextId++;
  const result = new Promise<ResponseTrace>((resolve, reject) => pending.set(id, { resolve, reject }));
  c.send({ type: 'request', id, method: opts.method, url: opts.url, headers: opts.headers, body: opts.body as unknown as string | undefined, timeoutMs: opts.timeoutMs, followRedirects: opts.followRedirects, mtls: opts.mtls, allowHosts: opts.allowHosts ?? null } satisfies MtlsRequestMessage);
  return result;
}

/** Called once, at the end of a run (`cli.ts`'s `main()` teardown) — a no-op if mTLS was never
 * used this run (the worker was never spawned). Without this, a persistent forked child would
 * keep the process alive past its natural exit. */
export async function shutdownMtlsWorker(): Promise<void> {
  if (!child) return;
  const c = child;
  child = undefined;
  c.disconnect();
  await new Promise<void>((resolve) => {
    c.once('exit', () => resolve());
    setTimeout(() => {
      c.kill();
      resolve();
    }, 500).unref();
  });
}
