# 6. Load and scan

The tests so far each ran once and checked one answer. This chapter runs work **at a rate**,
which is a load test, and walks the shop **as a stranger** would, which is a scan. In tflw both are
ordinary tests with one line more, and both run under `tflw run`.

## A test at a rate

Open `tests/load.tflw`. Its first test is the catalogue read from chapter 3, with a **[workload](/runbook/glossary#workload)**
line and two **[thresholds](/runbook/glossary#threshold)** added:

```tflw
@catalogue @workload
test "the catalogue holds up when everyone arrives at once"
  ramp to 4 users over 2s
  threshold p95 duration is less than 250ms
  threshold error rate is less than 1%
  api GET /items
  expect status equals 200
```

`ramp to 4 users over 2s` runs the body over and over, adding users up to four. The thresholds are
the verdict: 95% of iterations must finish in under 250 ms, and fewer than 1% may fail. A
workload test needs at least one threshold, because without one it would generate load and pass
whatever happened. `tflw check` refuses it.

Run the load tests:

```sh runbook
npx tflw run --tag workload || echo "tflw exited $?"
```

```text runbook-output
09:38:10.006 workload "the catalogue holds up when everyone arrives at once" — ramp to 4 users over 2s (closed)
…
09:38:12.215   – the catalogue holds up when everyone arrives at once (workload — ramp to 4 users over 2s (closed))
…
09:38:12.215       – p95 duration < 250ms (actual: 0.18ms) — no verdict, run inconclusive
…
09:38:12.216 INCONCLUSIVE 3/3 passed · env local · seed 6610 · now 2026-10-01T09:38:10.000Z · 2210 ms
…
09:38:12.216 ⚠ inconclusive — tflw itself is the bottleneck; workload numbers above reflect tflw contending with itself, not the system under test
…
tflw exited 3
```

## Exit 3: no verdict

That run did not pass or fail. It was **inconclusive**, and tflw exited 3. The catalogue test's `iterations`
line shows why: tens of thousands in two seconds, each answered in a fraction of a millisecond. The shop answers on
loopback faster than tflw's own generator can send requests, so the generator, not the shop, was the
bottleneck, and the timings measured tflw. Rather than report numbers about itself as numbers about
the shop, tflw marks the thresholds skipped and says why.

This is what you should expect from a toy shop on the same machine. Against a real service on
another machine, the shop is the slow side and the thresholds decide. In CI, treat exit 3 as *no
answer*, not as a pass: re-run on a quieter runner, or move the generator off the target's machine.
[Load results](/guide/load-results) explains the bottleneck judgement and every number in the load
report.

## A scan

`tests/scan.tflw` ends with a [`crawl`](/runbook/glossary#crawl):

```tflw
@functional
crawl "everything this file touched, walked again as a stranger"
  seed traffic
  expect response has no serious security violations
```

`seed traffic` re-issues the requests the tests above it in the same file made, without their
cookies or credentials, and leaves out the ones that change data. The `surface` line counts them: three requests
found, one withheld (the sign-in, a `POST`), two sent. Each response is judged by tflw's security
rules: a cookie a script could read, a page with no content security policy, a CORS header
open to everyone, and so on. `serious` is a floor, so a `critical` finding fails it too.

```sh runbook
npx tflw run tests/scan.tflw
```

```text runbook-output
09:38:30.101   ✓ the surface the crawl will walk: the two pages a visitor sees (14 ms)
09:38:30.106   ✓ …and the sign-in it posts to, which the crawl will withhold (5 ms)
09:38:30.131   ✓ everything this file touched, walked again as a stranger (crawl, 25 ms)
09:38:30.131     surface: 3 discovered (traffic → 3) · 1 withheld · 2 sent · 2 reached

09:38:30.131 PASS 3/3 passed · env local · seed 902 · now 2026-10-01T09:38:30.000Z · 44 ms
…
```

The findings, when there are any, are in `report.html` and in `report/findings.sarif`, which
GitHub's code scanning reads. To see one, delete `HttpOnly; ` from the `set-cookie` line in
`server.mjs`, restart the shop, and run the scan again. A finding you decide to live with goes into a
[baseline](/runbook/glossary#baseline) by its [fingerprint](/runbook/glossary#fingerprint), and stops failing the run.

## `authorized target`: why the config names the shop

A crawl sends requests nobody wrote, so tflw will not run one until `tflw.config` names the address
it may send them to, with a reason a reviewer can read. Chapter 2's config has this line:

```tflw-config fragment
defaults
  authorized target env SHOP_URL default "http://127.0.0.1:4720" reason "the example storefront in this directory, on loopback"
```

Without it, `tflw check` and `tflw run` refuse `scan.tflw` with `TF060` and say which line to add.
The rule exists so that pointing a scanner at a service is a decision someone made in a file under
review, never the side effect of an `api` line. Only name a service you are allowed to scan.

## You now have

Seen a load test give no verdict, and why; run a scan; and seen the line that allows it. The
project is unchanged: this chapter only ran what the example already had.

## Next, or instead

- **Next:** [7. The page](/runbook/start/page), the same project in your browser.
- Writing load tests: [Load testing](/guide/load-testing), and the report: [Load results](/guide/load-results).
- Every rule a scan applies, and baselines for accepted findings: [Security scanning](/guide/security-scanning),
  [Crawling](/guide/crawling) and [Findings and baselines](/guide/findings-and-baselines).
- The page's LOAD and SCANS doors: [Load](/ui/load) and [Scans](/ui/scans).
