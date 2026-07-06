// `insecure true` (decision 78) needs to disable TLS certificate verification for Node's global
// `fetch`. Node's fetch (undici) has no zero-dependency, per-request way to do this — the only way
// without a real `undici`/`https.Agent` runtime dependency (which would reverse decision 43's
// zero-runtime-dep bundle) is the process-wide `NODE_TLS_REJECT_UNAUTHORIZED` env var, which Node's
// TLS layer reads at connection time.
//
// That's process-global, but every file in one `tflw run` invocation shares the same active env
// (P#28) and therefore the same `config.insecure` value — under `--workers N>1`, multiple
// `runProgram` calls may want it active *concurrently*, so a naive set-then-restore would let
// whichever file finishes first turn verification back on while another file is still running.
// Reference-counted instead: only the first acquire sets it, only the last release restores it.

let refCount = 0;
let savedValue: string | undefined;

export function acquireInsecureTls(): void {
  if (refCount === 0) {
    savedValue = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
  refCount++;
}

export function releaseInsecureTls(): void {
  refCount--;
  if (refCount === 0) {
    if (savedValue === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = savedValue;
    savedValue = undefined;
  }
}
