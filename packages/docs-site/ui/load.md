---
pageClass: ui-shots
---

# The LOAD door

> `#/load` — *run the work you already wrote at a rate, and hold it to a threshold.*

A load test is not a different kind of test. It is a test with a **workload** line saying how often
to run it, and **thresholds** saying what counts as holding up.

![Compose on the LOAD door: a load test, its workload and the thresholds that grade it](/ui/compose-load-paper.png){.light-only}
![Compose on the LOAD door: a load test, its workload and the thresholds that grade it](/ui/compose-load-terminal.png){.dark-only}

## The panel in that picture is earned, not granted

The plan panel above the body is there because **this file has a workload line** — not because you
came through this door. Open the same file from the API door and the panel is there too; open a
file without one from this door and it is not.

That is the rule the whole UI is built on, and it is the most counter-intuitive thing about it:

> a test carrying a workload line shows its workload panel in every door, because the panel is
> earned by the construct and not granted by the door you came through.

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
