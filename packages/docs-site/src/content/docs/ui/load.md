---
pageClass: ui-shots
---

# LOAD tests

> `#/?kind=load` — *run the work you already wrote at a rate, and hold it to a threshold.*

A load test is not a different kind of test. It is a test with a **workload** line saying how often
to run it, and **thresholds** saying what counts as holding up.

![A LOAD test in Compose, and the plan its workload line earned](/ui/compose-load-paper.png){.light-only}
![A LOAD test in Compose, and the plan its workload line earned](/ui/compose-load-terminal.png){.dark-only}

## The plan in that picture is earned, not granted

The **plan** tab in the right-hand column is there because **this test has a workload line** — not
because of which chip is on. Open the same file under the API chip and the tab is there too; open a
test without one under the LOAD chip and it is not. Pick the test's own row and the column opens on
the plan; the workload itself is edited in the card under that row, beside the test's other clauses.

That is the rule the whole UI is built on, and it is the most counter-intuitive thing about it:

> a test carrying a workload line shows its workload panel under every chip, because the panel is
> earned by the statement and never granted by the filter you are looking through.

## What `+ new test` writes here

A request, its assertion, a shape and a threshold:

```tflw
test "the catalog holds under a fixed amount of work"
  ramp to 5 users over 2s
  api GET /search
  expect status equals 200
  threshold error rate is less than 1%
```

**The threshold is not padding.** The checker refuses a workload-bearing test that carries no
threshold (`TF033`) — a load run with nothing grading it produces numbers and no verdict, so the
scaffold writes the floor rather than leaving the author a file that will not check.

`ramp to 5 users over 2s` is small on purpose. It is a shape you can run once to see the panel move
before you decide what the real rung is.

## Reading the plan

The panel draws the workload as a curve, so a `ramp`, a `hold`, a `step` and a `spike` look like
what they are before you run anything. The four shapes and the two units — closed (`users`, each
looping, arrivals depending on how fast the system answers) and open (`rps`, arrivals regardless of
what has finished) — are the whole of the vocabulary.

Next: [Load testing: workloads & scenarios](/guide/load-testing), and
[Thresholds, results & validation](/guide/load-results) for what a verdict means.
