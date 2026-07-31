# M35b root-cause investigation — post-M35a follow-up (PLAN_BROWSER_PERF_SECURITY.md §2.7)

M35a ([FINDINGS.md](FINDINGS.md)) refuted the original D32 redaction hypothesis (~2.4% of CPU
samples) and found the real differentiator was `(idle)` time — 26.7% for tflw vs 2.7% for raw
`fetch`, both at 30 concurrent VUs. It flagged, but explicitly did not confirm, an async-call-chain-
depth mechanism, and stopped there per D33c's one-redirected-pass time-box.

This is a second, deeper pass, done at the user's explicit request to look harder before scoping a
fix. **Bottom line: the leading candidate mechanisms are now individually ruled out by controlled
experiment, and a new, more precise measurement shows the gap is not a concurrency artifact at
all — it reproduces at a single VU with zero contention. The exact mechanism is still not
pinned down**, but the search space is now much smaller and the next diagnostic step is concrete.

## What's ruled out this pass (all measured, not inferred)

Every test below uses the same zero-latency echo server and, where concurrency matters, the same
`RampUsersWorkload` spawn schedule as M35a, so results are comparable.

| Candidate | Test | Result |
|---|---|---|
| Async-call-chain depth (`execApi`'s 4-6 `async function` hops vs raw fetch's 2) | `chain-depth-bench.mjs`, depth 0→24, 30 users | **Flat.** 9337→8944 iter/s (−4%) across a 24-layer sweep. Even a chain 4-6x deeper than `execApi`'s real depth barely moves throughput. |
| `sendRequest`'s body-read mode (`arrayBuffer→Buffer→toString→JSON.parse` vs `res.json()`), its `AbortController`+`setTimeout`/`clearTimeout`, and its header-map building | `sendrequest-shape-bench.mjs`, 30 users and 1 user, each dimension isolated then combined | Body-read mode: no effect. Timer: ~6-8%. Headers: ~4%. **All three combined: ~10% at 30 users, ~2% at 1 user.** |
| Full `RequestTrace`/`ResponseTrace`/redacted-copy/`StepResult` construction (not just the redaction *function*, the whole allocate-then-discard object graph `execApi`+`mkStep` build for every step) | `trace-alloc-bench.mjs`, mode off/trace/full, 1 and 30 users | **~7-10% at both concurrencies.** This was the most promising untested lead from M35a and still isn't enough. |
| TCP keep-alive / connection reuse | Instrumented echo server (`echo-server-connlog.mjs`) counting `'connection'` events | **Identical: 2 connections total** for tens of thousands of requests, both for tflw and for raw fetch. Not a connection-churn problem. |
| `fetch()` call shape (bare `fetch(url)` vs a full `{method, headers: {}, body: undefined, signal, redirect}` options object for a GET) | `fetch-shape-bench.mjs`, 1 user | **~7%.** Passing the fuller options object costs a little, not much. |

None of these — individually or all combined — gets anywhere near the actual gap (see below).

## The real finding: it's not a concurrency artifact

M35a's headline number (idle 26.7% vs 2.7%) was measured at 30 concurrent VUs, which left open a
plausible reading: "tflw's VUs just don't overlap their I/O as well as raw fetch's tight loop does
at high concurrency." That reading is now ruled out.

Profiling **a single VU** (no contention possible — there is nothing else for the process to be
doing) against the same echo server:

| | tflw (`dist/cli.cjs`), 1 VU | raw fetch, 1 VU |
|---|---|---|
| iterations (10s / 10s) | 4,960 (496/s → **2.02ms/iteration**) | 72,754 (7,275/s → **0.137ms/iteration**) |
| `(idle)` (CPU profile, 50µs interval) | **78.9%** | **13.8%** |

A single tflw VU, hammering a zero-latency local server as fast as it can with nothing else
running, still spends ~79% of wall-clock time with nothing on the JS stack — a ~15x per-iteration
latency gap that has nothing to do with multiplexing across VUs. Whatever this is, it's a cost
**within one VU's own sequential loop**, between one response landing and the next request going
out.

This also explains why none of the "shape" experiments above closed the gap: they each correctly
measured that their candidate costs real *CPU* time (a few percent), but the dominant cost isn't
CPU time at all — it's wall-clock time the process spends genuinely idle. A synthetic
microbenchmark that faithfully replicates the *objects* `execApi`/`mkStep` build (as
`trace-alloc-bench.mjs` does) still doesn't reproduce it, which means the idle time isn't coming
from allocation/GC pressure either (GC self-time was consistently small and *proportionally*
similar to the raw-fetch baseline in every profile taken, including this one: 1.2% tflw vs the
raw-fetch baseline's own GC share at low concurrency).

Ruled out as the source of the idle gap specifically (checked this pass, not just inferred):
- `startSelfDiagnosis`'s own `setInterval(..., 100ms)` sampler — unref'd, fires 100x over 10s, not
  a plausible 79%-idle source.
- Hidden `sleep()`/polling calls in the hot path — grepped every `await sleep`/`setImmediate`/
  `process.nextTick` site in `interpreter.ts`; the ones that exist are all gated behind features
  this scenario doesn't use (`wait until`, `retry honoring`, `think`).
- `LatencyHistogram.record`/`Timeline.record` (the per-iteration metrics bookkeeping) — O(1)
  `Map` operations, not I/O.

## What's NOT yet confirmed

The exact mechanism producing that ~65-percentage-point idle gap at 1 VU is still open. Every
targeted, isolated hypothesis tested so far (this pass and M35a's) accounts for at most ~10-15% of
it, combined. The remaining candidates require a different kind of tool than black-box A/B
microbenchmarks:

1. **Direct instrumentation of a real iteration** — temporarily add `performance.now()`
   checkpoints at each boundary inside the actual `execSteps`/`execApi`/`sendRequest` call chain
   (not a reimplementation) and log the deltas for a handful of real iterations. This is the most
   direct way to find where the missing time actually goes, but it means editing (temporarily)
   real runtime source rather than writing more standalone scripts, which is why this pass stopped
   short of it.
2. **V8 tick-log analysis** (`node --prof` + `--prof-process`, not `--cpu-prof`) — a different
   profiler with different bucketing that sometimes attributes what `--cpu-prof` calls bare
   `(idle)` to a specific C++/builtin frame (e.g. a specific syscall or GC sub-phase) instead of
   collapsing it to one opaque label.

Both are real next steps, not further speculation — but both are a bigger investment than this
session's comparative scripts, and neither is guaranteed to land on a fixable cause; it's equally
possible the answer is diffuse (many small event-loop-phase crossings, none individually
attributable) rather than a single fixable line.

## Consequence

The evidence so far argues against a narrow, surgical M35b. Every specific, checkable hypothesis
in the original D32/D33e candidate list has now been tested and refuted or found insufficient. Two
honest options going forward:

- **Invest further**: a new M35b that does direct instrumentation (not blackbox A/B) to actually
  find the mechanism, before committing to any fix — real effort, uncertain payoff, but the only
  path to a *confirmed* root cause.
- **Re-scope the acceptance bar**: given nothing found so far would close even the isolated 1.5x
  CPU-only gap (M35a) — let alone this pass's ~15x single-VU idle gap — getting within D33a's 10%
  tolerance may not be achievable without a much larger investment than this arc originally
  assumed. Worth revisiting D33a/D32's scope with the user directly rather than sinking more time
  into diagnosis on the current budget.

This is a decision point for the user, not something to resolve unilaterally — see
`PLAN_BROWSER_PERF_SECURITY.md` §2.7 for the corresponding plan update.
