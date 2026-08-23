# Thresholds, results & validation

The [previous chapter](/guide/load-testing) is how you generate load. This one is how you judge it:
the declarations that decide pass or fail, the four exit codes a workload run can leave behind, the
one case where tflw refuses to give a verdict at all, and the measured evidence that the numbers it
reports are worth judging.

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

**And a duration threshold needs an error-rate one beside it.** Requiring *a* threshold isn't
enough, because a `duration` threshold structurally cannot observe failure — it reads the
successful iterations. A service failing half its requests fast and serving the rest in 12ms
satisfies `p95 duration is less than 5000ms` with `error rate: 50.00%` printed on the line directly
above the `✓`. So `TF033` also rejects a workload whose only thresholds are on duration.

The error-rate threshold must be the **unscoped** form. `threshold error rate for "checkout" is
less than 1%` bounds one endpoint's own bucket, which leaves every other endpoint in the scenario
free to fail — it reads like coverage without being it. Scope one if you want the extra detail,
but the whole-scenario line is the one that decides the verdict.

This makes an error-rate threshold *present*, not *meaningful*: `is less than 100%` still satisfies
it, and an `api` step with no `expect` never fails at all, so the rate it bounds stays `0.00%` no
matter what the server returns. A checker can require the line; only you can make it mean
something.

Every threshold also lands in the one `report/junit.xml` as its own `<testcase>` (named `test name
— label op target`), interleaved with the functional suite's own `<testcase>`s in file-declaration
order — no separate junit file to point CI at.

## The generator diagnoses itself

A load test measures the system under test — unless it is measuring tflw. Every run (1 worker or
many) tracks its own event-loop lag and CPU usage. If tflw's own generator process saturates — no headroom left to generate more load even if
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
for "the system under test passed." Add more [`--workers`](/guide/load-testing#scaling-across-processes-—-workers-n) before trusting the
latency/throughput numbers you're looking at.

## Four exit codes, not two

A functional run exits `0` or `1`. A workload-bearing run has two more, and both exist because a
run can end without reaching a verdict — which is a different thing from failing:

| exit | means | what CI should read it as |
| --- | --- | --- |
| `0` | every declared threshold passed | green |
| `1` | at least one threshold was breached | red |
| `3` | **inconclusive** — tflw's own generator saturated | neither; re-run with more `--workers` |
| `130` | **aborted** — Ctrl-C before the planned duration elapsed | neither; the partial evidence is still written |

`3` and `130` print `INCONCLUSIVE` and `ABORTED` rather than `PASS`/`FAIL`, in the same red as
`FAIL` — the one thing such a run is not is green. `report/results.json` says the same to a script
(`ok: false` with `failed: 0`), and junit reports every `<testcase>` as `skipped`, never passed or
failed. A gate reading any of the three artifacts reaches the same conclusion, which is the point:
there is no artifact from which a saturated or interrupted run can be mistaken for a passing one.

An aborted run keeps what it had. `report.html`, `results.json` and `junit.xml` are all written and
all carry `aborted: true` with a message like `aborted at 4s of 30s planned` — because the usual
reason to hit Ctrl-C on a load test is "this is melting down, kill it", and those seconds are
exactly the evidence you want to keep. See [stopping a run
early](/guide/load-testing#live-console-and-stopping-a-run-early) for what happens in flight.

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

## Where to go next

- **Writing the workload these thresholds judge:** [Load testing: workloads &
  scenarios](/guide/load-testing) — the five workload shapes, `pause`, `parallel`, `--workers`.
- **Reading the artifacts:** [CI, reporting & safety](/guide/ci-and-reporting) — where
  `report.html`, `results.json` and `junit.xml` go, and what CI does with them.
- **The two execution models side by side:** [Performance testing](/guide/performance), this
  pillar's overview.
- **The other pillars:** [Functional testing](/guide/functional) and [Security
  testing](/guide/security).

Full reference: [SPEC.md
§4.5](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#45-load-testing--workload-bearing-tests-m29m30-m50-m56-d16-d19d24ad26d70d93-d122).
