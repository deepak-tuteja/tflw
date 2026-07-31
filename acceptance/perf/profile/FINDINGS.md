# M35a — CPU-profile findings (PLAN_BROWSER_PERF_SECURITY.md §2.7)

**Verdict up front: the leading redaction hypothesis is refuted by the data.** Building the
discarded per-iteration redacted trace (`redactRequest`/`redactResponse`/`Redactor.redact`/
`redactFields`) accounts for **~0.5% of samples** — real, but nowhere near large enough to explain
the throughput gap M34 found. Combined with every other D33e-flagged candidate (header building,
`mkStep`, cookie-jar clone, body prep, and the per-request `AbortController`/`setTimeout`/
`clearTimeout` machinery `sendRequest` builds fresh on every call), the total is **~2.4% of
samples** — below D33e's own 5% action cutoff for every individual candidate.

## Method

Zero-latency local target (`echo-server.mjs`, no artificial delay, no real network/DB variance —
deliberately not M34's live Postgres target, whose latency would dominate a CPU profile and bury
the generator's own cost). Two workloads against it, **both replicating `RampUsersWorkload`'s exact
spawn schedule** (`runtime/src/interpreter.ts:500-520` — VU `i` of `N` spawns at
`runStart + (i/N)*overMs`, not all `N` at once) so throughput and profile shape are apples-to-apples:

- `bench.tflw`: `ramp to 30 users over 8s`, GET `/products` → POST `/orders` with a body — same
  shape as `checkout-burst.tflw`.
- `raw-fetch-bench.mjs`: the identical GET-then-POST loop using Node's global `fetch` directly
  (the same client `http.ts`'s non-mTLS path uses), same ramp schedule, no interpreter involved.

Profiled the **bundled `dist/cli.cjs`**, not `tsx`-transpiled source — an earlier attempt profiling
via `node --import tsx src/cli.ts` produced a useless 99%-`(idle)` profile with literally zero
samples in any interpreter function, evidently a stack-attribution artifact of tsx's ESM loader
hooks under heavy async/await load, not a real result (confirmed by re-running the identical
scenario against the plain esbuild-bundled CJS output, `format: 'cjs', minify` unset so names
survive — same workload immediately showed sensible, expected function attribution). Worth knowing
for any future tflw CPU-profiling: **profile `dist/cli.cjs`, not the `tsx` dev entry point.**
`node --cpu-prof --cpu-prof-interval=100` (100µs, finer than the 1ms default — the 2-second
first-pass run had too few busy samples to attribute reliably).

## Results

| | tflw (`dist/cli.cjs`) | raw `fetch` |
|---|---|---|
| iterations (8s, 30-user ramp) | 44,739 | 67,004 |
| throughput | 5,592 iter/s (11,184 req/s) | 8,375 iter/s (16,749 req/s) |
| ratio | 1.0x | **1.50x faster** |
| total CPU samples | 54,127 | 53,468 |
| `(idle)` | **26.7%** | **2.7%** |
| `(garbage collector)` | 8.2% | 9.6% |
| `processTicksAndRejections` (microtask drain) | 3.3% | 4.8% |

The isolated, network-latency-free gap here (1.5x) is smaller than M34's real-target acceptance gap
(~3x) — the rest of that gap lives in the interaction between the load model and real network/DB
latency, out of scope for this CPU-only profile.

## What's actually different — and what isn't

GC and microtask-drain overhead are **not** a tflw-specific problem — raw `fetch` shows the *same
or slightly higher* proportions (9.6% vs 8.2% GC, 4.8% vs 3.3% microtask). Both are consuming
undici internally and pay the same allocation/scheduling tax for that. Ruled out as the
differentiator.

The real, striking difference is **`(idle)`: 26.7% vs 2.7%** — a ~10x gap in idle share despite
near-identical relative GC/microtask cost. tflw's generator process spends far more of its wall
time with nothing on the JS stack, meaning it keeps **fewer requests effectively in flight** than
raw `fetch`'s tight loop, even spawning VUs on the identical schedule. This points at a
**concurrency/scheduling-density problem, not a per-request CPU-cost problem** — the opposite shape
from what the original hypothesis assumed.

Grouped tflw-authored candidates (D33e's list), for the record — none individually or combined
clears the 5% action cutoff:

| Candidate | % of samples |
|---|---|
| redaction (`redactRequest`/`redactResponse`/`Redactor.redact`/`redactFields`) | 0.5% |
| body prep (`prepareBody`) | 0.3% |
| timer/abort machinery (`AbortController`, `setTimeout`/`clearTimeout`, `performance.now`) | 1.3% |
| `mkStep` (per-step result allocation) | 0.1% |
| header building (`setHeader`/`buildHeaderMap`) | 0.1% |
| cookie jar (`clone`/`serialize`/`applySetCookie`) | 0.1% |
| **combined** | **2.4%** |

A plausible (not yet confirmed) explanation for the idle-share gap: `execApi`'s call chain is
several `async function` boundaries deep before the real network `await` even happens
(`execSteps` → `execApi` → `await loadMtlsCreds(...)` → `await prepareBody(...)` →
`await sendRequest(...)`) — and *every* `await` of an async function call costs at least one
microtask-queue round trip, even on an already-synchronous fast path (e.g. `loadMtlsCreds`'s
`if (!config.mtls) return undefined`, still wrapped in a Promise by virtue of being declared
`async`). Raw `fetch`'s loop is two flat awaits. More microtask round trips per iteration could
mean a VU takes measurably longer, wall-clock, to circle back and re-issue its next request even
though each individual tick is cheap — consistent with lower effective concurrency density without
requiring any single function to dominate CPU self-time. **Not confirmed** — would need its own
targeted instrumentation (e.g. counting in-flight requests over time per generator, or measuring
wall-clock cost of collapsing `execApi`'s async-boundary depth) to verify, which is more than
D33c's one-redirected-pass time-box covers.

## Consequence for M35b

Per D33c's time-box (one redirected hypothesis pass after the primary one, then ship + document):
this redirected pass is exhausted. The GC/microtask candidates it pointed at turned out to be a
false lead (present equally in the baseline). **M35b as originally scoped in §2.7 — thread a flag
through `execApi`'s redacted-trace call sites — would claw back at most ~2.4% of the gap, not the
~33-50% needed to close even the isolated CPU-only 1.5x gap, let alone M34's real ~3x.** Shipping it
as-is would not meaningfully move D33a's 10% tolerance bar. This needs the user's input before
M35b proceeds — the fix that would actually matter is a different, harder-to-scope piece of work
(reducing async-boundary depth / improving concurrency density) than what D32 originally assumed.
