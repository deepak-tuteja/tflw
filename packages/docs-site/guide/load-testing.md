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

```sh
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
  threshold p95 duration is less than 800ms
```

**Not supported inside a workload-bearing `test` (v1):** browser steps (`open`/`click`/`fill`/…)
and UI/network expect subjects. A browser VU is 50-100MB of memory each — running hundreds of them
for a load test is infeasible. Load tests are API-only; the checker rejects a browser step here
rather than letting it surface as a confusing runtime error. `retry`/`with each` are also rejected
alongside a workload — a load test's own iterations already provide repetition, and it has no
per-row cases, only per-VU ones.

Calling an `action` doesn't get around either ban. The checker follows the call, and reports on the
call line — because the same action is perfectly legal inside a functional test, so only the caller
decides. (Before M60 it didn't follow the call: a workload test calling an action containing
`click` ran tens of thousands of failing iterations and still printed `PASS`.)

## Two workload models — pick deliberately

```tflw fragment workload
ramp to 50 users over 30s
```

**Closed model.** 50 VUs, ramping in linearly over 30s. Each VU loops its body back-to-back for as
long as the run lasts. The trap: if the system under test slows down, a VU's iterations simply
take longer, so it completes *fewer* of them — the load backs off exactly when you'd want it to
push harder. This understates latency ("coordinated omission"). `tflw run`'s console/report flags
a run whose VUs spent a large share of wall time waiting rather than iterating, so this doesn't
silently distort your numbers:

```console
✓ checkout under load (workload — ramp to 50 users over 30000ms (closed))
    iterations: 812  failures: 3  error rate: 0.37%
    duration (ms, pause-excluded, all 812): min 40  avg 210  p50 210  p90 480  p95 640  p99 910  max 1200
    duration (ms, successful 809 — what thresholds read): min 40  avg 211  p50 212  p90 482  p95 642  p99 912  max 1200
⚠ your load backed off — an estimated 41% of this test's available VU time was lost to the target
system slowing down; results understate real latency
```

A healthy run just shows the numbers, no warning line. The percentage compares how many iterations
actually completed against how many the test's own fastest-observed pace would have allowed —
unlike a saturated generator (below), this doesn't change `tflw run`'s exit code or a threshold's
pass/fail: it's a warning about how to *read* the numbers, not a verdict on whether they're
trustworthy. Switch to the open model if you want to measure the true degradation curve instead of
being warned about it after the fact.

```tflw fragment workload
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

```tflw fragment workload
hold 50 users for 2m
```

**`hold`** — a flat target for the whole duration, no ramp-in. Use it to measure steady-state
behavior once the system's already warmed up, or to follow a `ramp` you write yourself as a second,
separate `test` block for the warm-up phase.

```tflw fragment workload
step users
  to 20 for 1m
  to 50 for 1m
  to 100 for 1m
```

**`step`** — a staircase: each `to N for <dur>` line is an instant jump to a new level, held there
for its own duration. Unlike `ramp`'s continuous linear increase, `step` holds each level long
enough to read a stable percentile at that level before moving on — the shape you want when the
question is "at what concurrency does p95 start climbing," not just "does it survive the peak."

```tflw fragment workload
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

```tflw fragment workload alternatives
run 5000 iterations across 50 users
run 100 iterations per user across 50 users
```

**The 2 iteration-count forms** — no duration at all, just a fixed amount of work. `run N
iterations across M users` pulls from one shared pool of `N` total iterations until it's exhausted
(faster VUs simply do more). `run N iterations per user across M users` gives each of the `M` VUs
its own fixed `N`. Reach for these when you want a reproducible, fixed-size run for a benchmark or
regression comparison — "exactly how long does 5,000 checkouts take today" — rather than a
time-boxed one where the iteration count varies run to run.

## `pause` — pacing, not a hack

```tflw
test "browsing"
  ramp to 30 users over 20s
  api GET /products
  expect status equals 200
  capture body.products[0].id as id
  pause 1s to 3s
  api GET /products/{id}
  expect status equals 200
  threshold error rate is less than 1%
```

`pause <duration>` (fixed) or `pause <duration> to <duration>` (a fresh random draw per
iteration) models a real user pausing between actions. It's legal **only** inside a
workload-bearing `test` — the checker rejects it inside a plain functional `test`/`before`/
`after`, where a fixed sleep is exactly the sync hack `sleep` itself was banned for. Pause time is
excluded from a load test's own `duration` threshold: it models pacing, not system latency, so
sleeping more should never help a load test pass a latency threshold.

Waiting in a *functional* test is a different construct entirely. If you're waiting for something
to become true, that's [`wait until …`](/guide/browser-basics); if it has to *stay* true —
"the error toast never appears" — that's `wait until … for <duration>`. And if elapsed time is
genuinely the thing under test, a cache TTL or a token expiry, no condition exists to poll and the
[JS escape hatch](/guide/actions) is the honest answer.

## Thresholds — the pass/fail gate

```tflw fragment
threshold p95 duration is less than 800ms
threshold p99 duration is less than 1500ms
threshold error rate is less than 1%
```

Evaluated once, after the whole run. `tflw run` exits `0` when every declared threshold passes, `1`
when any is breached — the same signal a CI gate reads. An `expect` failure inside a
workload-bearing test's body fails **that iteration** only, counted toward the error rate — it
never aborts the run the way a functional test's failure would.

**A `duration` threshold reads the iterations that succeeded; `error rate` reads all of them.**
A failing request is usually a *fast* one — an instant 5xx, a refused connection — so pooling
failures into the latency population drags the percentile down, and a latency threshold can pass
*because* the target is broken. That is why the console prints two duration lines whenever anything
failed: the run that happened, and the successful subset the thresholds actually read. If they
diverge, your failures are fast.

If **nothing** succeeded there is no percentile to take, so a `duration` threshold **fails** and
reports `actual: no successful iterations` rather than a `0ms` that would sail under any bound.

**At least one threshold is required.** A workload-bearing test's verdict comes from nothing else,
so one declaring none can never fail: a run with a 100% error rate would report `✓`, `PASS`, and
exit `0`. The checker rejects that shape (`TF033`). If you want a workload for the numbers rather
than as a gate, say so out loud with a deliberately loose one — `threshold error rate is less than
100%` reads as "I am not gating on this", where silence read as "this passed".

Every threshold also lands in the one `report/junit.xml` as its own `<testcase>` (named `test name
— label op target`), interleaved with the functional suite's own `<testcase>`s in file-declaration
order — no separate junit file to point CI at.

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
  threshold error rate is less than 1%
```

## Identity per VU — `as <session>` and `unique(...)`

A workload-bearing test can opt into a session exactly like a functional one does:

```tflw
test "checkout under load" as customer
  ramp to 50 users over 30s
  api POST /cart/checkout body { productId: "widget-1" }
  threshold p95 duration is less than 800ms
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
unique within a file — the name keys this test's own entry in the report (a plain functional test's
name may repeat freely, as always).

Each workload-bearing test renders standalone in the one `report.html`/`results.json` — its own
metrics, charts, and threshold verdicts — the same way a `parallel` batch's functional tests each
get their own entry, no shared container. There's deliberately no pooled "combined" view across
tests: two tests hitting different endpoints (or the same endpoint under different conditions)
rarely want their percentiles blended into one number anyway; a run that genuinely wants a
run-wide figure sums the per-test tables itself. The overall run passes only if every test's
thresholds do — independent of which other tests, if any, happened to share its `parallel` batch.

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
Results merge back into the one `report.html`/`results.json`/`junit.xml` — the end-of-run summary
looks identical whether the run used 1 worker or 8; nothing downstream needs to know. The live console line (below) works the same way too — each worker relays its own
progress back to the main process.

**Generator self-diagnosis:** every run (1 worker or many) tracks its own event-loop lag and CPU
usage. If tflw's own generator process saturates — no headroom left to generate more load even if
the system under test could take it — the summary's `generator:` line says so instead of silently
handing back numbers that describe tflw contending with itself, not your system:

```console
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

```console
iterations: 1204  failures: 3  rps: 198.4  error rate: 0.25%  4.1s/30.0s planned
```

**Ctrl-C stops the run early.** No new iterations start (whatever's already in flight finishes
naturally), and everything that completed is still written out — the run-level `report.html`/
`results.json`/`junit.xml` all carry `aborted: true` and a message like `aborted at 4s of 30s
planned`, and the process exits `130`. This is deliberate: the most common reason to hit
Ctrl-C on a load test is "this is melting down, kill it" — the evidence from those seconds is
exactly what you want to keep, not lose. A second Ctrl-C before the first finishes flushing
force-quits immediately, for a run that's genuinely stuck.

## Validated against k6 and Artillery

Numbers are only useful if they can be trusted — a 7-rung comparison ran tflw against **k6** and
**Artillery** against the same real NestJS+Postgres application (not a synthetic microbenchmark),
covering everything from a zero-latency echo endpoint to a real row-lock-contended checkout.

On the two rungs with genuine contention — where the target system itself is the bottleneck, not
just how fast a generator can fire requests — tflw tracks k6 closely:

| | tflw | k6 | gap |
|---|--:|--:|--:|
| Uncontended write, throughput | 1,827.7/s | 1,820.1/s | +0.42% |
| Uncontended write, p95 | 29.67ms | 30.47ms | -2.6% (tflw ahead) |
| Contended checkout, throughput | 661.5/s | 658.7/s | +0.44% |
| Contended checkout, p95 | 71.33ms | 68.89ms | +3.54% |
| Contended checkout, p99 | 97.67ms | 91.76ms | +6.44% |

Both rungs land well inside a ~20% tolerance set before any of these numbers were known. Artillery,
run as a third comparator on the same rungs, proved less stable under sustained load (connection
resets, coarser sub-millisecond precision) — a genuine finding about Artillery on this workload
shape, not a knock against it in general.

Full methodology, every rung's numbers (including the ones excluded above for self-saturating at
near-zero latency, where tflw's own generator — not the target system — becomes the bottleneck),
and the raw run logs: [`tflw-acceptance`
README](https://github.com/deepak-tuteja/tflw-tests/blob/main/tflw-acceptance/README.md).

## What's next

The security/pentest arc is next; see the changelog for what's landed.
