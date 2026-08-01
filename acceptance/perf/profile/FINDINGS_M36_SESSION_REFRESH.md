# M36 — real root cause found: load-scenario sessions never refresh their shared base snapshot

D42's fallback pass (does per-VU dispatch/scheduling overhead explain the residual gap?) was
refuted almost as cleanly as D40 was — see the dispatch-gap measurement below — but chasing down
*why* one specific real-target run's numbers looked odd surfaced something else entirely: a real,
confirmed, fixable bug in the load engine's session handling that appears to be the actual
dominant cause of the whole M34/M35d gap. Not started as a hypothesis; found by accident while
debugging an instrumentation artifact, then run down properly.

## D42 itself: dispatch/scheduling overhead — refuted

Same instrumentation approach as D41 (temporary counter, gated behind an env var, reverted after
use): for each iteration, compare total wall time to the sum of each step's own `durationMs`
(already present on every `StepResult`, no new timing needed) — the difference is time spent in
the VU loop's own bookkeeping between requests, not inside any request itself.

**Isolated harness, 1 VU (control) vs. 60 VUs, same slow (200ms) target:**

| | avg gap | p90 gap | max gap |
|---|---|---|---|
| 1 VU | 0.048ms | 0.907ms | 1.450ms |
| 60 VUs | 0.043ms | 0.625ms | 0.993ms |

Flat, not ballooning — dispatch overhead does not scale up under real 60-VU concurrency contending
for the same single-threaded event loop. This matches the low event-loop lag (`max 1.2-1.8ms`)
`selfDiagnosis` already reported on every prior run in this arc. **D42 refuted**, consistent with
D41: nothing checked at the client-dispatch layer explains the gap.

## How the real bug surfaced

Running the same gap measurement against the *real* acceptance target produced a bizarre result:
**negative** average gaps (-62ms to -82ms) — a sum-of-steps that exceeds the iteration's own total
wall time, which shouldn't be possible for sequential, non-overlapping step execution. Sampling a
few raw examples (`exec.steps` dump) showed why:

```json
{
  "steps": [
    { "kind": "api", "durationMs": 39, "detail": "GET .../products?q=... → 200 (39ms)" },
    { "kind": "expect", "durationMs": 0, "detail": "status to equal 200" },
    { "kind": "capture", "durationMs": 0, "detail": "productId = \"...\" (captured)" },
    { "kind": "header", "durationMs": 74, "detail": "401 response → session \"load\" re-established, retrying" },
    { "kind": "api", "durationMs": 118, "detail": "POST .../orders → 201 (41ms)" },
    { "kind": "expect", "durationMs": 0, "detail": "status to equal 201" }
  ]
}
```

The `"header"` step is a full session re-authentication (`refreshSessions` internally re-running
`POST /auth/login`) happening **mid-iteration**, on a `checkout-burst.tflw` run that had already
been reporting a clean 0.00% error rate across M34, M35d, and this arc's own D41 measurements —
completely invisible until someone looked at a successful iteration's own step breakdown, because
the automatic-reauth-on-401 behavior (SPEC §3.3, decision 3a) is *designed* to make this
transparent. The retried `api` step's own `durationMs` (118ms) is measured from a `stepStart`
captured *before* the first (401'd) attempt, so it also fully contains the 74ms reauth cost nested
inside it — accounting for the double-counted "negative gap" artifact that led here in the first
place. (That artifact was a bug in this measurement's own arithmetic, not in tflw — noted for the
record, not chased further; it did its job by pointing at something real.)

## Why: `apiV2`'s `JWT_ACCESS_TTL=5s`, known and already documented — but not for this

`testFlow-tests/.env`: `JWT_ACCESS_TTL=5s` — a deliberately short access-token lifetime in this dev
environment (it exercises other suites' own token-refresh coverage). This is **not new** —
`acceptance/README.md`'s existing "A qualitative asymmetry worth its own line: session resilience"
section already documents it, and `checkout-burst.js`'s own comment header already explains that
k6's hand-written `authedRequest` wrapper exists specifically because of it. What was never
measured before now: **how often this actually fires under load, and what it costs.**

## Quantified: 40-42% of every real-target run's iterations are paying for a silent extra request

Instrumented (temporarily) every iteration for whether it hit a 401-triggered reauth, bucketed by
the second of the run it landed in. Three separate real-target runs, all consistent:

| run | total iterations | reauthed | reauthed % |
|---|---|---|---|
| 1 | 4,095 | ~1,800 (est. from 2%-sampled negative-gap subset) | ~44% |
| 2 | 4,211 | 1,755 | 41.7% |
| 3 | 4,257 | 1,712 | 40.2% |

**The per-second breakdown is the real story** (run 3, `checkout-burst.tflw`'s 20s ramp):

```
sec 0-3: 0 reauthed / ~2,000 total   (token still fresh from t=0's one-time session setup)
sec 4:   4 / 559                    (first expiries land, near the 5s TTL boundary)
sec 5:   110 / 110  (100%)
sec 6:   115 / 115  (100%)
...
sec 20:   60 / 60   (100%)
```

**From the 5-second mark onward — 75% of the scenario's own 20-second window — literally every
single iteration re-authenticates.** Not a periodic "thundering herd" every 5 seconds (the
originally-suspected shape, based on 60 VUs sharing one token) — continuously, on every request,
forever, once the shared token first expires.

## Root cause: the shared session snapshot is never refreshed, only the per-iteration copy is

`runLoadCore` (`packages/runtime/src/interpreter.ts:430-438`) establishes each scenario's session
**once**, before the VU loop starts, into a scenario-scoped `baseSessionHeaders` object shared by
every VU:

```ts
const baseSessionHeaders: Record<string, string> = {};
...
Object.assign(baseSessionHeaders, outcome.headers);
```

Every iteration then clones this same base snapshot (`interpreter.ts:453`):

```ts
sessionHeaders: { ...baseSessionHeaders },
```

When a 401 hits, `refreshSessions` (`interpreter.ts:1105-1132`) correctly invalidates and
re-establishes the session **in the shared `sessionCache`** — but only ever writes the fresh
headers into *that one iteration's own* `ctx.sessionHeaders`:

```ts
Object.assign(ctx.sessionHeaders as Record<string, string>, outcome.headers);
```

`baseSessionHeaders` itself — the object every *future* iteration clones from — is never touched
again after scenario setup. So iteration N's 401 gets silently patched for iteration N alone;
iteration N+1 (from the same VU, or any of the other 59) clones the same stale snapshot, 401s
again, patches its own local copy again, and the cycle repeats — for every iteration, for the rest
of the run, once the shared token first expires. `sessionCache` itself is correct and current the
whole time; the bug is purely that `runLoadCore`'s own snapshot never re-reads it.

## Causal confirmation: an environment-only A/B, no source code touched

To confirm this really is the dominant driver (not just a real-but-secondary cost), `testFlow-tests/.env`'s `JWT_ACCESS_TTL` was temporarily raised from `5s` to `10m` (so the
token effectively never expires mid-run), the stack restarted, load target reset, and
`checkout-burst.tflw` re-run completely unchanged — then the env var was restored to `5s` and the
stack re-verified clean. No tflw source code was touched for this experiment.

| | iterations | throughput | p95 | back-off | vs. k6 (620/s) |
|---|---|---|---|---|---|
| `JWT_ACCESS_TTL=5s` (real environment, bug active) | ~3,500-4,300 | ~172-219/s | 500-523ms | 83-86% | ~2.8-3.6x |
| `JWT_ACCESS_TTL=10m` (bug can't fire) | 10,613 | **528.4/s** | **105ms** | 57% | **1.17x** |

**The p95 threshold (`< 250ms`) passes outright once the bug can't fire** — it had failed on every
prior run in this entire perf arc (M34, M35d, and every re-check in M36 up to this point).
Throughput roughly **triples**, and the gap to k6 collapses from ~3.2-3.4x to ~1.17x — squarely
inside architecture-driven-residual territory, plausibly within reach of D33a's ~10% tolerance
once a real fix (not an environment workaround) is in place.

This is **not** the fix — `JWT_ACCESS_TTL` stays at its real `5s` in the committed environment,
which other suites rely on for their own token-refresh coverage. It's evidence: proof that the
session-refresh bug identified above, not connection concurrency (D40, refuted) and not per-VU
dispatch overhead (D42, refuted), is the real, dominant, and fixable driver of the gap this entire
arc (M34→M35→M36) has been chasing.

## Status: mechanism confirmed and causally verified. Stopping here, per this arc's own convention.

No fix code has been written. `packages/runtime/src/interpreter.ts` and `http.ts` are back to their
pre-M36 state — every temporary counter/instrumentation added during D41/D42/this investigation
has been reverted, confirmed via a clean grep for debug markers and a full 372/372 runtime + 106/106
CLI test pass. `testFlow-tests/.env` is restored to `JWT_ACCESS_TTL=5s`.

A real fix here means `runLoadCore`'s per-scenario session setup needs to re-read (or be kept in
sync with) `sessionCache` rather than freezing a one-time snapshot into `baseSessionHeaders` —
scope, edge cases (multiple sessions per scenario, `RampUsersWorkload` vs. the open/arrival-rate
model, whether a fix should update the shared base in place or have each iteration re-derive from
the cache directly) not yet worked out. Same pattern this whole arc has used every time a mechanism
was actually confirmed (M35b→M35c): stop, write up, get an explicit go-ahead before touching real
interpreter internals on a hot path used by every load run, not just this acceptance scenario.
