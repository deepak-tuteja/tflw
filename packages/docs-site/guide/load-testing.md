# 13. Load testing: scenarios & thresholds

Everything so far — `test`, `action`, hooks — is the **functional** execution model: one pass
through a body, pass or fail. Load testing needs a second, genuinely different model: many
virtual users (VUs) looping the same body concurrently, for a while, with pass/fail decided on
*aggregate* numbers (percentiles, error rate) rather than a single outcome. That's `scenario`.

```tflw
scenario "checkout under load"
  ramp to 50 users over 30s
  api POST /cart/checkout body { productId: "widget-1", qty: 1 }
  expect status equals 201
  threshold p95 duration is less than 800ms
  threshold error rate is less than 1%
```

Run it with `tflw load`, not `tflw run`:

```
tflw load checkout.tflw
```

A file may declare at most one `scenario` today — concurrent multi-scenario runs are a later
milestone. `tflw init --load` scaffolds a starter `load.tflw`.

## Reuse, not a second language

A `scenario` body is ordinary steps — `api`, `expect`, `check`, `let`, `capture`, action calls,
all of it. There's no separate load-testing DSL to learn, and no drifting second implementation of
logic you already wrote for the functional suite:

```tflw
action checkout(productId)
  api POST /cart/checkout body { productId: {productId}, qty: 1 }
  expect status equals 201
  capture body.orderId as orderId
  give orderId

scenario "checkout under load"
  ramp to 50 users over 30s
  checkout("widget-1")
```

**Not supported inside a `scenario` (v1):** browser steps (`open`/`click`/`fill`/…) and UI/network
expect subjects. A browser VU is 50-100MB of memory each — running hundreds of them for a load
test is infeasible. Load scenarios are API-only; the checker rejects a browser step here rather
than letting it surface as a confusing runtime error.

## Two workload models — pick deliberately

```
ramp to 50 users over 30s
```

**Closed model.** 50 VUs, ramping in linearly over 30s. Each VU loops its body back-to-back for as
long as the run lasts. The trap: if the system under test slows down, a VU's iterations simply
take longer, so it completes *fewer* of them — the load backs off exactly when you'd want it to
push harder. This understates latency ("coordinated omission"). `tflw load`'s console/report flags
a run whose VUs spent a large share of wall time waiting rather than iterating, so this doesn't
silently distort your numbers.

```
ramp to 200 rps over 30s
```

**Open model.** New iterations are scheduled at a target rate that itself ramps from 0 to 200
requests/second over 30s — independent of whether earlier iterations have finished. Under
saturation, iterations queue up instead of quietly disappearing. This is the only model that
honestly validates an SLA, which is why `tflw init --load` scaffolds this form. Default to it
unless you specifically want to model "N concurrent users clicking through the UI," which is what
the closed model actually represents.

## `think` — pacing, not a hack

```tflw
scenario "browsing"
  ramp to 30 users over 20s
  api GET /products
  expect status equals 200
  think 1s to 3s
  api GET /products/{id}
  expect status equals 200
```

`think <duration>` (fixed) or `think <duration> to <duration>` (a fresh random draw per
iteration) models a real user pausing between actions. It's legal **only** inside a `scenario` —
the checker rejects it inside `test`/`before`/`after`, where a fixed sleep is exactly the sync
hack `sleep` itself was banned for. Think time is excluded from a scenario's own `duration`
threshold: it models pacing, not system latency, so sleeping more should never help a scenario
pass a latency threshold.

## Thresholds — the pass/fail gate

```
threshold p95 duration is less than 800ms
threshold p99 duration is less than 1500ms
threshold error rate is less than 1%
```

Evaluated once, after the whole run, against every iteration's outcome. `tflw load` exits `0` when
every declared threshold passes (or the scenario declares none), `1` when any is breached — the
same signal a CI gate reads. An `expect` failure inside a scenario body fails **that iteration**
only, counted toward the error rate — it never aborts the run the way a functional test's failure
would.

## Cleanup — `after each` is skipped by default

If your file has `before`/`after each` hooks (shared with the functional suite), `before each`
runs on every iteration as normal setup. `after each` does **not** run per iteration by default —
running teardown on every one of thousands of iterations would double request volume and pollute
the very latency numbers the run exists to measure. A scenario that genuinely needs teardown
(releasing a held resource, a seat lock) opts back in:

```tflw
scenario "reserve and release"
  ramp to 10 users over 10s
  cleanup
  api POST /reservations body { seat: "12A" }
  expect status equals 201
```

## Identity per VU — `as <session>` and `unique(...)`

A scenario can opt into a session exactly like a test does:

```tflw
scenario "checkout under load" as customer
  ramp to 50 users over 30s
  api POST /cart/checkout body { productId: "widget-1" }
```

The session establishes **once**, before the VU loop starts — never per iteration — and its
headers/cookies seed every iteration. For per-iteration identity (a fresh cart, a fresh customer
each time), reach for `unique(...)` inside the body, the same generator functional tests already
use.

## What's next

This is the first load-testing milestone — single-process, single-scenario, a metrics-JSON
summary. Concurrent multi-scenario runs, multi-process scaling, and the full `load-report.html`
view with live charts are still ahead; see the changelog for what's landed.
