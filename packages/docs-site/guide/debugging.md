# 10. Running & debugging tests

## What a run actually prints

```
  ✓ health check (16 ms)

PASS 1/1 passed · env local · seed 1486355565 · now 2026-07-20T19:09:07.104Z · 17 ms

report: report/report.html
```

One line per test (`✓`/`✗`, name, duration), then a summary line (`PASS`/`FAIL`, pass tally, the
`env` that ran, the `seed`/`now` that generated any random/date values, total duration), then the
report path. A failing test also prints its failing step(s) indented underneath, live, the moment
it fails — you don't have to wait for the whole suite or open the report to see what broke:

```
✗ health check
    request failed: GET http://localhost:3001/health — fetch failed — connection refused; is the
    service actually listening at that host:port?

  ✗ health check (12 ms)
    ✗ api GET /health
      request failed: GET http://localhost:3001/health — fetch failed — connection refused; is the
      service actually listening at that host:port?

FAIL 0/1 passed, 1 failed · env local · seed 868036364 · now 2026-07-20T19:09:56.501Z · 13 ms
```

Network failures name the likely cause instead of a bare `fetch failed` (see
[Config & environments](/guide/config#corporate-networks) for the cert/proxy variants of this).

## `--verbose` — one line per step

By default only failing steps print. `--verbose` prints every step of every test as it runs,
passing or not — useful when a test *times out* rather than fails outright, since you can see
which step it's stuck on:

```sh
npx tflw run --verbose
```

```
health check
  ✓ GET http://localhost:3001/health → 200 (13ms)
  ✓ status to equal 200 (0ms)
✓ health check (14ms)
```

## Isolate a test

Re-running the whole suite to chase one failure is slow. Narrow to exactly what you're debugging:

```sh
npx tflw run --only "health check"        # one test, by its exact declared name
npx tflw run --tag smoke                  # every test carrying @smoke (comma-separated OR)
npx tflw run --only "health check" --tag smoke   # composes as AND
npx tflw run --failed                     # only what failed last time (report/.last-run.json)
npx tflw run --bail                       # stop at the first failure — don't wait for the rest
```

`--failed` is the fast loop for fixing a batch of failures one at a time: run once, fix the first
thing, `tflw run --failed` again to check just what's still red — the failure set narrows every
time until an all-green `--failed` run falls back to the full suite (nothing left to replay).
`--bail` is the opposite direction: stop as soon as anything breaks, so a broken early assumption
doesn't waste time running everything downstream of it.

## Reproduce a failure exactly

Any `random`/`date`-family generator value and the run's notion of "now" are derived from a seed
that's different every run by default — printed in the summary line (`seed 868036364 · now
2026-07-20T...`). Pin both to get byte-for-byte the same generated values back:

```sh
npx tflw run --seed 868036364 --now 2026-07-20T19:09:56.501Z
```

Handy for turning "it failed once in CI and I can't repro it" into a reliable local repro — copy
the `seed`/`now` straight out of the CI log's summary line.

## Lint before you run — `tflw check`

`tflw check` runs the same parse + full checker pipeline `run` does, with **no execution** and no
secrets required — catches typos and unknown-matcher/unknown-variable mistakes in editor-quality
diagnostics, in milliseconds, before any request goes out:

```sh
npx tflw check example.tflw
```

```
error[TF014]: unknown matcher `eq`
 --> example.tflw:3:17
  |
3 |   expect status eq 200
  |                 ^^
  |
  = help: expected one of: equals, contains, matches, is …, has …
```

Source line + caret + "did you mean" + a stable `TF0xx` code you can look up in the
[diagnostic codes reference](/reference/diagnostics) — the same diagnostics VS Code shows live as
you type (see [Editor support](/editor)), available from the CLI for non-editor workflows (a
pre-commit hook, CI lint step) too.

## The full picture — `report.html`

The terminal only ever shows a summary. `report/report.html` (written on every run, pass or fail)
has the complete picture for every step: full request/response — method, URL, headers, body,
status, timing — with secrets redacted the same way everywhere. Open it in a browser first when a
failure isn't self-explanatory from the terminal output alone. `--evidence <level>` trims how much
of that detail gets captured (`full`/`headers-only`/`none`) — see
[CI, reporting & safety](/guide/ci-and-reporting#evidence-levels-—-how-much-trace-lands-in-the-report).
