# Running a suite

## Locally

```sh
npx tflw check          # parse and check every file; no request is sent
npx tflw run            # every discovered .tflw file, under the default env
npx tflw run --env staging --tag smoke
```

`report/` holds the last run: `report.html` to read, `results.json` for scripts, `junit.xml` for CI.
Every run is also **kept** under `report/runs/<id>/` — the newest `runs keep N` in `tflw.config`, 50
when it says nothing. `--no-keep` skips that for a scratch run.

## Exit codes

| Exit | Means |
|---|---|
| 0 | every test passed |
| 1 | a test failed |
| 2 | it could not run — a usage error, a config that does not check, a file that does not parse |
| 3 | a load test was inconclusive — tflw's own generator could not keep up, so no verdict |
| 130 | the run was interrupted before a verdict (Ctrl+C) |

## History, and flaky tests

A failing test's summary line says how often it failed before:

```text
  ✗ checkout applies the coupon (412 ms) — failed in 3 of its last 10 kept runs, flaky
```

*Flaky* means the verdict changed between two kept runs **of the same file**. A test that started
failing because someone edited it is a change, not a flake, so the word is withheld. The page's Run
tab draws the same history: a dot per kept run, oldest on the left, and a *flaky across runs* pill.
Each load threshold gets a sparkline of its last values.

## In CI

```yaml
- run: npx tflw check
- run: npx tflw run --forbid-insecure
- uses: actions/upload-artifact@v4
  if: always()
  with: { name: tflw-report, path: report/ }
```

`--forbid-insecure` refuses to run an env that turns certificate checks off. The
[CI guide](/guide/ci-and-reporting) covers `junit.xml`, SARIF, evidence levels and redaction.

## Sharded

```sh
npx tflw run --shard 2/4          # in each of four jobs
npx tflw merge shard-*/report --out report   # in one job after them
```

`--shard i/n` deals the suite's files round-robin, so the jobs are disjoint and together run
everything once. `tflw merge` joins their report directories into one, and its exit code is the
suite's verdict — the one check a branch protection rule needs to name. See
[splitting a suite across CI jobs](/guide/ci-and-reporting#shard).
