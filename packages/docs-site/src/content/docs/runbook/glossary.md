# Glossary

The words the walkthrough, the page, the report and the CLI use for tflw's own ideas. Each is linked
from the chapter of [Start here](/runbook/) that first uses it. Ordinary testing words (*test*,
*step*, *assertion*, *session*) mean what they mean everywhere and are in the
[Guide](/guide/first-test).

## Authorized target

A line in `tflw.config` naming an address tflw may send requests nobody wrote to, with a reason a
reviewer can read: `authorized target env SHOP_URL default "…" reason "…"`. A crawl or a scan
against any other address is refused with `TF060`. Only name a service you are allowed to scan. See
[`authorized target`](/guide/config#authorized-target-—-what-this-suite-may-scan).

## Baseline

A file of findings you have accepted, each by its [fingerprint](#fingerprint). A scan or crawl
still reports them, but they no longer fail the run. `--baseline-write` records the current
findings. See [Findings and baselines](/guide/findings-and-baselines).

## Clock

The one instant a run treats as *now*: every `today`, `now` and date drawn in the past or future
derives from it. The verdict line prints it (`now 2026-10-01T09:30:14.000Z`); pass it back with
`--now` to pin it. See [Variables](/guide/variables).

## Crawl

A test that sends requests nobody wrote and judges every response by tflw's security rules. Its
`seed traffic` line starts from the requests the tests above it made, re-issued without their
cookies or credentials, leaving out the ones that change data; the `surface:` line under it counts
what was found, withheld, sent and reached. A crawl needs an [authorized target](#authorized-target).
See [Crawling](/guide/crawling).

## Env

A named set of settings in `tflw.config` (a base URL, hosts, secrets) that a run uses as a whole:
`env local default` is the one a run gets without `--env`. The verdict line names the env it ran
under. See [Config](/guide/config).

## Evidence

What the report keeps about each step: request and response bodies and headers, screenshots.
`--evidence full` (the default), `headers-only` or `none`. Turn it down before attaching a report
somewhere public.

## Fence

A line the language deliberately does not cross: no conditionals, no loops, no boolean operators in
a test. What needs one goes into a helper module through `use`. See [the escape hatch](/guide/actions).

## Fingerprint

A finding's identity, stable across runs: the same weakness on the same route has the same
fingerprint every time, which is what lets a [baseline](#baseline) accept it and a report compare
two runs.

## Flaky

A test whose verdict changed between two runs of the same file. The report marks it beside the test,
from the runs kept in `report/runs/`.

## Hint

A suggestion `tflw check` prints that is not an error, and never changes its exit code. A *help*
line under a diagnostic says how to fix it (*did you mean `expect`?*); a *reuse hint* (`RF001`)
proposes lifting a repeated run of steps into an `action`, applied with `tflw refactor apply` or the
editor's Quick Fix.

## Kind

One of the four kinds of work a test can do: **API**, **BROWSER**, **LOAD** and **SCANS**. On the
page they are chips over the file list. Each counts the tests of its kind and, when pressed, filters
the list and what ▶ runs to them; `tflw run --kind` narrows a terminal's run the same way. See
[the four kinds](/ui/kinds).

## Seed

The number every `random` value in a run derives from. The verdict line prints it (`seed 902`);
pass it back with `--seed` and the same values come out again. A crawl's `seed traffic` is a
different thing: where the [crawl](#crawl) starts.

## Spine

The page's fixed shape: the header across the top, the file list on the left with the kinds at its
head, and the tabs over whichever file is open. See [the spine](/ui/spine).

## Threshold

A limit a [workload](#workload) test is judged by: `threshold p95 duration is less than 250ms`. A
workload test needs at least one, since without one it would generate load and pass whatever
happened. See [Load testing](/guide/load-testing).

## Token

The part of the page's address after `?token=`. Each `tflw ui` start mints a new one and prints the
address with it; a request without it is refused, so an address from an earlier start answers
`401`.

## Verdict

What a run concluded about a test: passed, failed, skipped (with its reason), or *inconclusive* —
a [workload](#workload) whose own generator was the bottleneck, so its numbers measured tflw rather
than the service. The last line of a run is the verdict for the run, and the exit code follows the
worst one: 1 for a failure, 3 for inconclusive.

## Workload

The line that makes a test a load test, saying how many users run its body and for how long:
`ramp to 4 users over 2s`. The run's first line names it (`workload "…" — ramp to 4 users over 2s`).
See [Load testing](/guide/load-testing).
