# M35b — root cause found (PLAN_BROWSER_PERF_SECURITY.md D34-D37)

Per D35's two-step plan: a V8 tick-log pass, then direct `performance.now()` instrumentation of
the real `execSteps`/`execApi`/`sendRequest` call chain. The first step gave a partial clue; the
second found the actual mechanism. **Root cause confirmed, mechanism understood, fix scope is
small — stopping here per D37 to check in before writing fix code.**

## Step 1: V8 tick-log (`node --prof` / `--prof-process`)

Same 1-VU, zero-latency `bench.tflw` scenario as `FINDINGS_M35B_INVESTIGATION.md`'s decisive
1-VU test. `--cpu-prof`'s `(idle)` bucket resolves, under `--prof-process`, to
`__syscall_cancel_arch_end` — 79.1% of all ticks, 85.4% of non-library ticks — with **no
resolvable JS caller above the 1% cutoff** in the bottom-up view. This confirms the time is spent
genuinely blocked in a cancellable syscall (consistent with waiting on socket I/O), but doesn't by
itself explain *why* that wait is ~15x longer than raw fetch's own waits against the same
zero-latency server. Inconclusive on its own, as anticipated in D35.

## Step 2: real-code instrumentation — this is the finding

Added temporary `performance.now()` checkpoints at every boundary in the real
`runIteration`→`execSteps`→`execApi`→`sendRequest`→`fetch()` call chain (not a reimplementation —
the actual `interpreter.ts`/`http.ts` source, rebuilt into `dist/cli.cjs`, run for real, then
reverted). 182 steady-state iterations captured (first 5 discarded as JIT/connection warm-up):

| Span | avg (ms) | share of ~3.04ms/iteration |
|---|---|---|
| **`fetch()` call itself** (both GET+POST steps) | **2.79** | **~92%** |
| everything else combined (header build, `prepareBody`, trace/redact construction, step dispatch, `execSteps`/`runIteration` bookkeeping) | 0.25 | ~8% |

This matches every prior microbenchmark in `FINDINGS_M35B_INVESTIGATION.md`: the interpreter's
*own* overhead really is only ~8-10%, exactly what `trace-alloc-bench.mjs` and friends measured.
**The dominant cost is inside `fetch()` itself** — a per-call average of ~1.4ms against a
zero-latency local echo server, where `raw-fetch-bench.mjs`'s own steady-state `fetch()` calls
average ~0.068ms (a ~20x difference) for the *identical* Node built-in global `fetch()` function.

Since it's the same `fetch()`, the difference isn't in what's called — it's something about the
*process* it runs in. `packages/runtime/src/http.ts` has one thing raw-fetch-bench.mjs doesn't: a
**module-scope, unconditional** import of the standalone `undici` npm package —

```ts
import { Agent, fetch as undiciFetch } from 'undici';
```

— present so the mTLS path (SPEC §3.5) can dispatch through a one-off `undici.Agent` carrying a
client cert. It's imported at the top of the file, so it loads on every `tflw load`/`tflw run`
regardless of whether any test in the run actually uses mTLS.

### Decisive test

`undici-import-bench.mjs` — identical raw-fetch loop, one flag controls whether `undici` is
imported (never called, just imported):

| mode | iter/s (1 VU) |
|---|---|
| bare fetch, no `undici` import | 7,069 |
| same loop, `import('undici')` at top, never used | 381 |

**18.6x slower, from an unused import.** `undici-import-bench2.mjs` narrowed it further — it's not
specific to importing `fetch` from the package:

| import | iter/s |
|---|---|
| none | 19,592 |
| `{ Agent }` only | 755 |
| `{ fetch: undiciFetch }` only | 754 |
| both | 764 |

Merely loading the `undici` module — regardless of which export is touched, even if none are ever
called — triggers a global side effect that cripples Node's *separate*, built-in global `fetch()`
for the rest of the process. (Node's global `fetch` is itself backed by an internally-vendored
copy of undici; the two almost certainly share process-global state — e.g. `diagnostics_channel`
publish/subscribe fast-paths are keyed by channel name, global across any code in the process, so
one package merely being loaded can turn an unrelated fetch's normally-free "no subscribers" check
into real per-event work. Not confirmed to that level of detail, but the shape fits: constant-ish
multiplier, present the instant the module loads, independent of the mTLS code path ever running.)

## Consequence

This explains the tflw-vs-raw-fetch gap almost entirely by itself — 18.6x measured here vs. the
~15x single-VU idle-time gap and the original ~3x on the real contended acceptance target (which
has other real latency diluting the effect). It is **not diffuse** and **not a platform/GC/V8
limitation** — it's one specific, unconditional import, active for every run whether or not mTLS
is configured.

## M35c — fixed

Confirmed after checking in with the user (D37): a deferred/lazy `undici` import alone wouldn't
have covered mixed mTLS/non-mTLS runs, since the poisoning is process-global, not per-call — so
(a) "never import for non-mTLS runs" and (b) "don't poison mixed runs" collapsed into one fix: the
entire mTLS dispatch path now runs in a dedicated, lazily-spawned child process
(`packages/runtime/src/mtlsWorker.ts` + `mtlsWorkerEntry.ts`, forked directly — not via the
existing `--internal-load-worker` self-fork trick, since this call site must also work from
`@tflw/runtime`'s own unit tests, which have no `cli.ts`/`process.argv[1]` dispatch in their module
graph at all). `http.ts` no longer imports `undici` at all, in any form. Full design in
`PLAN_BROWSER_PERF_SECURITY.md` §2.7, M35c.

**Result, same 1-VU zero-latency scenario used throughout this investigation:**

| | before | after |
|---|---|---|
| iterations / 3s | 1,046 (~349/s) | 13,409 (~4,470/s) |
| avg iteration duration | ~3ms | rounds to 0ms |

**~12.8x throughput improvement** on the isolated harness, from this one fix — consistent with the
~18.6x isolated-import measurement, the difference explained by the real (small) interpreter
overhead this fix doesn't touch. All 372 runtime tests + 106 CLI tests pass, including the full
real-TLS `mtls.test.ts` suite (both in dev/tsx and, separately, end-to-end through the *bundled*
CLI with a real client-cert-requiring HTTPS server) and a new packaging assertion
(`pack.test.ts`) confirming `dist/mtls-worker.cjs` ships alongside `dist/cli.cjs` with zero added
runtime dependencies. Next: M35d (re-measure against the real acceptance target/k6).
