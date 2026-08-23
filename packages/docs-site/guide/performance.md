# Performance testing

A functional test runs its body once and reports one outcome. A load test runs the same kind of
body many times over, concurrently, for a while, and decides pass or fail from the *aggregate* —
percentiles and error rates rather than a single result.

That second execution model is the whole of this pillar. What it deliberately is **not** is a
second language: there is no separate keyword, no separate file type and no separate command. A
`test` becomes a load test the moment its body contains a workload line, and `tflw run` drives both
kinds in one pass.

## What each chapter answers

| chapter | the question it answers |
| --- | --- |
| [Load testing: scenarios & thresholds](/guide/load-testing) | how do I generate load, and how do I judge the result? |

One chapter today. The reason this pillar has an overview at all is the paragraph below: the
relationship between the two execution models is the thing readers get wrong, and it belongs
somewhere before the chapter that assumes it.

## The two models live in one file

Here is the claim the load chapter makes in prose, written out. A functional test and a load test,
in one file, run by one command:

```tflw
test "checkout works"
  api POST /checkout body { widgetId: "widget-1", qty: 1 }
  expect status equals 201
  expect body.total is greater than 0

test "checkout keeps working under load"
  ramp to 50 users over 30s
  api POST /checkout body { widgetId: "widget-1", qty: 1 }
  expect status equals 201
  threshold p95 duration is less than 800ms
  threshold error rate is less than 1%
```

The two bodies are nearly the same text, and that is the design rather than a coincidence in the
example. The second test differs by exactly two kinds of line — a **workload** (`ramp to …`), which
says how the body is driven, and a **threshold**, which says how the aggregate is judged. Everything
between them is ordinary steps, and everything you know about writing them from the [functional
pillar](/guide/functional) still applies.

Two consequences follow, and both are why the models were not split into separate tools:

- **A load test is debuggable as a functional test.** It is the same body, so `--tag`, `--only`,
  the report and the diagnostics all behave the way they do everywhere else — you are not reading a
  different artifact when the thing under load starts failing.
- **`expect` still means `expect` under load.** Correctness does not stop being checked once a
  test is driven concurrently, and it does not move to a different artifact — what a failed
  assertion does to the aggregate is
  [the chapter's thresholds section](/guide/load-testing#thresholds-—-the-pass-fail-gate).

## Where to go next

- **Writing your first load test:** [Load testing: scenarios &
  thresholds](/guide/load-testing) — the five workload shapes, `--workers`, and the exit-code
  model.
- **Comparing it against what you already run:** the same chapter's [measured comparison against
  k6 and Artillery](/guide/load-testing#validated-against-k6-and-artillery).
- **Never written a tflw test at all:** [Writing your first test](/guide/first-test) first. A load
  test is a body plus two lines, and the body is the part this pillar does not teach.
- **The other pillars:** [Functional testing](/guide/functional) and [Security
  testing](/guide/security).
