# 13. Load testing: scenarios & thresholds

Everything so far — `test`, `action`, hooks — has been the **functional** execution model: one
pass through a body, pass or fail. Load testing needs a second, genuinely different model: many
virtual users (VUs) looping the same body concurrently, for a while, with pass/fail decided on
*aggregate* numbers (percentiles, error rate) rather than a single outcome. There's no separate
keyword for it — a `test` becomes a load test the moment it contains a workload line (`ramp
to …`, or one of the other 4 shapes below); the same `test "…" { … }` block covers both.

```tflw
test "checkout under load"
  ramp to 50 users over 30s
  api POST /cart/checkout body { productId: "widget-1", qty: 1 }
  expect status equals 201
  threshold p95 duration is less than 800ms
  threshold error rate is less than 1%
```

Run it exactly like any other file — `tflw run` drives functional and workload-bearing `test`s
alike, in one pass, in file declaration order:

```
tflw run checkout.tflw
```

`tflw init --load` scaffolds a starter `load.tflw`, runnable the same way.

## Reuse, not a second language

A workload-bearing test's body is ordinary steps — `api`, `expect`, `check`, `let`, `capture`,
action calls, all of it. There's no separate load-testing DSL to learn, and no drifting second
implementation of logic you already wrote for the functional suite:

```tflw
action checkout(productId)
  api POST /cart/checkout body { productId: {productId}, qty: 1 }
  expect status equals 201
  capture body.orderId as orderId
  give orderId

test "checkout under load"
  ramp to 50 users over 30s
  checkout("widget-1")
```

**Not supported inside a workload-bearing `test` (v1):** browser steps (`open`/`click`/`fill`/…)
and UI/network expect subjects. A browser VU is 50-100MB of memory each — running hundreds of them
for a load test is infeasible. Load tests are API-only; the checker rejects a browser step here
rather than letting it surface as a confusing runtime error. `retry`/`with each` are also rejected
alongside a workload — a load test's own iterations already provide repetition, and it has no
per-row cases, only per-VU ones.

## Two workload models — pick deliberately

```
ramp to 50 users over 30s
```

**Closed model.** 50 VUs, ramping in linearly over 30s. Each VU loops its body back-to-back for as
long as the run lasts. The trap: if the system under test slows down, a VU's iterations simply
take longer, so it completes *fewer* of them — the load backs off exactly when you'd want it to
push harder. This understates latency ("coordinated omission"). `tflw run`'s console/report flags
a run whose VUs spent a large share of wall time waiting rather than iterating, so this doesn't
silently distort your numbers:

```
scenario "checkout under load":
  iterations 812  failures 3  error rate 0.37%  p50 210ms  p95 640ms  p99 910ms
⚠ your load backed off — this scenario's VUs spent an estimated 41% of their available time unable
to keep pace with the target system; results understate real latency
```

(The console/report still labels a workload-bearing test's own line "scenario" — a human-readable
name for "the load-test entry this is," independent of the `test` keyword it's written with.)

A healthy run just shows the numbers, no warning line. The percentage compares how many iterations
actually completed against how many the scenario's own fastest-observed pace would have allowed —
unlike a saturated generator (below), this doesn't change `tflw run`'s exit code or a threshold's
pass/fail: it's a warning about how to *read* the numbers, not a verdict on whether they're
trustworthy. Switch to the open model if you want to measure the true degradation curve instead of
being warned about it after the fact.

```
ramp to 200 rps over 30s
```

**Open model.** New iterations are scheduled at a target rate that itself ramps from 0 to 200
requests/second over 30s — independent of whether earlier iterations have finished. Under
saturation, iterations queue up instead of quietly disappearing. This is the only model that
honestly validates an SLA, which is why `tflw init --load` scaffolds this form. Default to it
unless you specifically want to model "N concurrent users clicking through the UI," which is what
the closed model actually represents.

## Beyond `ramp` — steady, staircase, spike, and fixed-count workloads

`ramp` covers the two most common shapes, but a workload line is any of 5 keywords — every one
supports both a closed (`users`) and open (`rps`) variant, the same choice `ramp` offers:

```
hold 50 users for 2m
```

**`hold`** — a flat target for the whole duration, no ramp-in. Use it to measure steady-state
behavior once the system's already warmed up, or to follow a `ramp` you write yourself as a second,
separate `test` block for the warm-up phase.

```
step users
  to 20 for 1m
  to 50 for 1m
  to 100 for 1m
```

**`step`** — a staircase: each `to N for <dur>` line is an instant jump to a new level, held there
for its own duration. Unlike `ramp`'s continuous linear increase, `step` holds each level long
enough to read a stable percentile at that level before moving on — the shape you want when the
question is "at what concurrency does p95 start climbing," not just "does it survive the peak."

```
spike users
  hold 10 for 30s
  to 200 over 10s
  hold 200 for 20s
  to 10 over 10s
```

**`spike`** — a mixed schedule: `hold N for <dur>` (flat, same instant-jump semantics as `step`)
and `to N over <dur>` (a gradual ramp, in either direction — up or back down) can appear in any
order. This is the shape for "baseline load, sudden burst, recovery" — a flash-sale or breaking-news
traffic pattern that `ramp`'s one-directional linear increase can't express on its own.

```
run 5000 iterations across 50 users
run 100 iterations per user across 50 users
```

**The 2 iteration-count forms** — no duration at all, just a fixed amount of work. `run N
iterations across M users` pulls from one shared pool of `N` total iterations until it's exhausted
(faster VUs simply do more). `run N iterations per user across M users` gives each of the `M` VUs
its own fixed `N`. Reach for these when you want a reproducible, fixed-size run for a benchmark or
regression comparison — "exactly how long does 5,000 checkouts take today" — rather than a
time-boxed one where the iteration count varies run to run.

## `think` — pacing, not a hack

```tflw
test "browsing"
  ramp to 30 users over 20s
  api GET /products
  expect status equals 200
  think 1s to 3s
  api GET /products/{id}
  expect status equals 200
```

`think <duration>` (fixed) or `think <duration> to <duration>` (a fresh random draw per
iteration) models a real user pausing between actions. It's legal **only** inside a
workload-bearing `test` — the checker rejects it inside a plain functional `test`/`before`/
`after`, where a fixed sleep is exactly the sync hack `sleep` itself was banned for. Think time is
excluded from a load test's own `duration` threshold: it models pacing, not system latency, so
sleeping more should never help a load test pass a latency threshold.

## Thresholds — the pass/fail gate

```
threshold p95 duration is less than 800ms
threshold p99 duration is less than 1500ms
threshold error rate is less than 1%
```

Evaluated once, after the whole run, against every iteration's outcome. `tflw run` exits `0` when
every declared threshold passes (or the test declares none), `1` when any is breached — the
same signal a CI gate reads. An `expect` failure inside a workload-bearing test's body fails
**that iteration** only, counted toward the error rate — it never aborts the run the way a
functional test's failure would.

Every threshold also lands in `report/load-junit.xml` as its own `<testcase>` (`scenario name —
label`), alongside the ordinary functional suite's own `report/junit.xml` — one `tflw run`
invocation writes both, so an existing CI job already reading the functional junit gates the
workload-bearing tests the same way, no separate command or parsing path to build.

## Cleanup — `after each` is skipped by default

If your file has `before`/`after each` hooks (shared with the functional suite), `before each`
runs on every iteration as normal setup. `after each` does **not** run per iteration by default —
running teardown on every one of thousands of iterations would double request volume and pollute
the very latency numbers the run exists to measure. A load test that genuinely needs teardown
(releasing a held resource, a seat lock) opts back in:

```tflw
test "reserve and release"
  ramp to 10 users over 10s
  cleanup
  api POST /reservations body { seat: "12A" }
  expect status equals 201
```

## Identity per VU — `as <session>` and `unique(...)`

A workload-bearing test can opt into a session exactly like a functional one does:

```tflw
test "checkout under load" as customer
  ramp to 50 users over 30s
  api POST /cart/checkout body { productId: "widget-1" }
```

The session establishes **once**, before the VU loop starts — never per iteration — and its
headers/cookies seed every iteration. For per-iteration identity (a fresh cart, a fresh customer
each time), reach for `unique(...)` inside the body, the same generator functional tests already
use.

## `parallel`/`sequential` — a test's relation to its file-siblings

`test` defaults to `sequential`: it blocks whatever comes before and after it in the same file,
regardless of kind — a plain, predictable "one thing finishes, then the next starts" order,
top to bottom exactly as written. Add `parallel` right after the test name (same header slot as
`retry N`) to opt a test into running concurrently with its immediate neighbors instead:

```tflw
test "browsing" parallel
  ramp to 100 rps over 30s
  api GET /products
  expect status equals 200
  threshold p95 duration is less than 300ms

test "checkout burst" parallel
  ramp to 10 users over 30s
  api POST /cart/checkout body { productId: "widget-1", qty: 1 }
  expect status equals 201
  threshold p95 duration is less than 800ms
```

A maximal run of *consecutive* `parallel` tests forms one concurrently-executed batch; a
`sequential` test (the default) always runs alone. Given `A, B(parallel), C(parallel), D`, the
file executes as `A -> (B and C together) -> D`. This is a generic, cross-kind concept — it governs
*any* two tests' relation to each other, not just workload-bearing ones: a `parallel` functional
test and a `parallel` workload-bearing test declared next to each other run concurrently too, each
picking its own execution shape (single-shot vs. per-VU loop) from its own `workload` field. A
`with each` test's own row-cases always keep iterating sequentially internally, regardless of
`parallel`/`sequential` — that keyword only ever governs this test's relation to *other* tests in
the file.

The worked example above is the shape a real load test usually wants: a steady background trickle
of browsing traffic alongside a smaller, bursty checkout path, both hitting the system at once —
closer to production than testing either path in isolation. Each one keeps its own identity
(`as <session>`), its own workload model (open or closed, independently), and its own
`threshold`s, evaluated only against *its own* iterations. Workload-bearing test names must be
unique within a file — they key the report's per-scenario breakdown (a plain functional test's
name may repeat freely, as always).

The end-of-run summary, `report/load-report.html`, and `report/load-results.json` all report two
layers: a **combined** view (every scenario's iterations pooled — the quotable run-wide numbers)
and a **per-scenario** breakdown (each scenario's own metrics, charts, and threshold verdicts). The
overall run passes only if every scenario's thresholds do — independent of which other tests, if
any, happened to share its `parallel` batch.

## Scaling across processes — `--workers N`

By default a workload-bearing test's iterations all generate from `tflw run`'s one Node process.
Load generation is CPU-bound (TLS, JSON parsing, redaction scanning) — one process caps out around
one core, same reason k6 is written in Go. `--workers N` forks `N - 1` additional generator
processes alongside the main one, each running an equal (±1) striped share of every workload-bearing
test's `users`/`rps` target — scoped to those tests only (there's no population/rate to stripe, and
no percentile aggregate to merge, for a purely functional test; `--workers N` on a file with none
prints a non-fatal warning and runs on a single process instead):

```sh
npx tflw run load.tflw --workers 4
```

`--workers` is a completely different axis from `parallel`/`sequential` above: `parallel` controls
which of *this file's own tests* run concurrently with each other; `--workers` controls how many
*processes* generate the load for a workload-bearing test's own target population, independent of
which batch that test happens to be in. No coordination happens between the processes beyond each
one knowing its own index — the target splits evenly up front, and every VU's generated values
(`unique(...)`, `random ...`) stay reproducible under `--seed` regardless of how many workers ran,
since each worker's share of the run draws from a disjoint, deterministic slice of the same seed.
Results merge back into one report — `report/load-report.html`/`load-results.json`/`load-junit.xml`
and the end-of-run summary look identical whether the run used 1 worker or 8; nothing downstream
needs to know. The live console line (below) works the same way too — each worker relays its own
progress back to the main process.

**Generator self-diagnosis:** every run (1 worker or many) tracks its own event-loop lag and CPU
usage. If tflw's own generator process saturates — no headroom left to generate more load even if
the system under test could take it — the summary's `generator:` line says so instead of silently
handing back numbers that describe tflw contending with itself, not your system:

```
generator:
⚠ tflw itself is the bottleneck (avg event-loop lag 340.2ms  max 890.1ms  cpu 97%) — measured
latency/throughput reflects tflw's own generator process, not your system under test. Results are
unreliable.
```

A healthy run just shows the numbers, dimmed, with no warning. If you see this warning, `tflw run`
exits `3` (**inconclusive**) instead of `0`/`1` — every junit `<testcase>` comes back `skipped`,
never passed or failed, so a CI gate reading exit codes or junit can't mistake a saturated generator
for "the system under test passed." Add more `--workers` before trusting the latency/throughput
numbers you're looking at.

## Skipping workload-bearing tests — `--skip-workload`

Iterating on a file's *functional* tests shouldn't have to pay for its workload-bearing ones every
time — `--skip-workload` drops every workload-bearing test from the run, regardless of which
`parallel`/`sequential` batch it's declared in, leaving the functional tests to run at their normal
speed:

```sh
npx tflw run --skip-workload
```

## Live console, and stopping a run early

While a run is in flight, a ~1Hz console line tracks progress — iterations, current rps (windowed,
not averaged since the start), error rate, and elapsed vs. planned duration:

```
iterations: 1204  failures: 3  rps: 198.4  error rate: 0.25%  4.1s/30.0s planned
```

**Ctrl-C stops the run early.** No new iterations start (whatever's already in flight finishes
naturally), and everything that completed is still written out — `report/load-report.html`,
`load-results.json`, and `load-junit.xml` all carry `aborted: true` and a message like `aborted at
4s of 30s planned`, and the process exits `130`. This is deliberate: the most common reason to hit
Ctrl-C on a load test is "this is melting down, kill it" — the evidence from those seconds is
exactly what you want to keep, not lose. A second Ctrl-C before the first finishes flushing
force-quits immediately, for a run that's genuinely stuck.

## What's next

Per-endpoint metric breakdown (today's report covers combined + per-scenario, R6's third axis) and
the security/pentest arc are still ahead; see the changelog for what's landed.
