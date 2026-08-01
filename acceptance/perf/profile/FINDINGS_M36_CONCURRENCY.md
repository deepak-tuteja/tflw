# M36 — client-side concurrency ceiling: refuted (PLAN_BROWSER_PERF_SECURITY.md D39-D42)

Per D41's one bounded measurement pass: does tflw's own generator actually hold as many
concurrent in-flight requests as its configured VU count, on both the isolated harness and the
real contended acceptance target — or does something (suspected: Node's global `fetch()`/undici's
per-origin connection pool) cap it below that? **Answer: no ceiling anywhere checked. tflw reaches
its full configured VU count of genuinely concurrent in-flight requests on both targets.**

## Why this hypothesis looked plausible going in

M35a-2's own investigation (`FINDINGS_M35B_INVESTIGATION.md`) recorded, almost in passing while
ruling out a *different* question (TCP connection churn): "Identical: 2 connections total for tens
of thousands of requests, both for tflw and for raw fetch." Read in isolation that number looks
like a hard client-side cap. It isn't — see below.

## Step 0: why the "2 connections" number was a red herring, not evidence

`echo-server-connlog.mjs` (M35b) responds with zero artificial delay. Against a target that fast,
each request completes before the next VU's request has any real chance to overlap it in time —
"concurrent in flight" reads near 1 almost by construction, regardless of client capability. It was
a valid check for *connection churn* (is tflw reconnecting instead of reusing keep-alive sockets? —
no, ruled out correctly), but uninformative for a *concurrency-ceiling* question, which only shows
up when responses are slow enough that genuine overlap is possible in the first place. This wasn't
caught in M35a-2 because that pass wasn't asking a concurrency question at the time.

## Step 1: does Node's global `fetch()` itself have a per-origin concurrency cap? — no

`concurrency-groundtruth-instant.mjs`: 30 requests fired via `Promise.all` with zero stagger
(upper-bound case) against a server holding each request open 50ms. **Result: 30/30 concurrent,
30 real TCP connections, wall time 73ms (vs. 50ms fully-concurrent-ideal, 1500ms if serialized).**
No artificial cap at this raw level.

## Step 2: does a `RampUsersWorkload`-shaped tight VU loop still get full concurrency against a slow target? — yes

`concurrency-groundtruth-ramped.mjs` mirrors `interpreter.ts`'s exact `RampUsersWorkload` spawn
schedule (VU `i` of `N` spawns at `runStart + (i/N)*rampMs`, then loops issuing requests
back-to-back) — plain Node `fetch()`, no tflw interpreter involved — against a 200ms-delay server
(a proxy for checkout-burst's real contended latency), 60 users ramped over 8s, 15s total run:

| | value |
|---|---|
| max concurrent in-flight (server-side ground truth) | **60 / 60** |
| avg in-flight | 43.9 |
| p50 / p90 in-flight | 56 / 60 |
| throughput | 219/s (vs. 300/s theoretical ceiling at 60 users × 1000/200ms) |

Full VU-count concurrency, no cap, at the raw-`fetch` level under the real ramp shape.

## Step 3: does tflw's own generator (real interpreter, not a mirror script) also get there?

Temporary instrumentation (`sendRequest` in `packages/runtime/src/http.ts`, in-flight counter +
20ms-interval sampler, gated behind `TFLW_DEBUG_CONCURRENCY=1`, reverted after use — same
temporary-checkpoint convention M35b used) — `dist/cli.cjs` rebuilt for real, run for real, then
reverted and rebuilt clean again (confirmed via `grep` for the debug marker + a full 372/372
runtime-test pass after revert).

**Isolated harness** (`delayed/bench-60.tflw`, new: same 60-users-over-8s ramp + GET/POST shape as
`bench.tflw`, against a new `echo-server-delayed-connlog.mjs` — `echo-server.mjs` plus a 200ms
per-request delay, since a zero-latency target makes this question unanswerable per Step 0):

```
maxInFlight: 60   avgInFlight: 30.5   p50InFlight: 31   p90InFlight: 54   (630 iterations, 0 failures)
```

**Real acceptance target** (`acceptance/perf/tflw/checkout-burst.tflw`, fresh testFlow-tests stack
+ load-target reset, run directly through the instrumented `dist/cli.cjs`, not through
testFlow-tests' own installed tarball):

```
maxInFlight: 60   avgInFlight: 30.8   p50InFlight: 31   p90InFlight: 55   (3,508 iterations, 0 failures, 83% back-off — consistent with M34/M35d)
```

**tflw's real generator hits the full configured VU count (60/60) on both targets.** The
avg-around-31 (~half of 60) is exactly what a linear closed-model ramp predicts on its own — for
roughly the first half of a "ramp to 60 users over 20s" scenario, fewer than 60 VUs have even
spawned yet, so time-averaged concurrency over the whole scenario naturally sits near half of peak.
Not a ceiling artifact; the max hitting exactly 60 (not 58, not 45) is the decisive number.

## Verdict

**D40's client-side concurrency-ceiling hypothesis is refuted**, at both the raw-`fetch` level and
inside tflw's real generator, on both the isolated harness and the real Postgres-backed acceptance
target. tflw is not silently capped below its configured VU count by an undici connection pool or
anything else client-side checked here. Whatever explains the residual ~3.2-3.4x gap to k6
(M34/M35d), it is not this.

Per D41: stopping here, reporting before writing any fix code (there is no fix to write — nothing
was found broken at the client-request-dispatch level). Per D42, the next candidate (if the user
wants a further pass) is scheduling/dispatch overhead in the `RampUsersWorkload` spawn loop itself
— not "are enough requests in flight" (answered: yes) but "how much wall-clock time does one VU's
own loop spend between a request resolving and the next one being issued" — a different, narrower
question this pass didn't measure. Not started without explicit direction, per the same
one-bounded-pass-then-check-in convention this whole arc has used throughout.
