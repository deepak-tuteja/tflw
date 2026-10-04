# 3. The first run and its report

Chapter 2 ended with a green run. This one reads what that run left behind, then breaks a test on
purpose so you have seen a failure before you meet one for real.

## What the terminal said

Run one file, so the output fits on a screen:

```sh runbook
npx tflw run tests/catalogue.tflw
```

```text runbook-output
…
09:30:14.215   ✓ the catalogue lists what is on the shelf (12 ms)
09:30:14.221   ✓ one item reads back the way the catalogue listed it (4 ms)
09:30:14.702   ✓ the shelf page shows the same three things a person can read (481 ms)
09:30:14.890   ✓ an order placed over the API is the one the shop page can price (188 ms)

09:30:14.891 PASS 4/4 passed · env local · seed 77120 · now 2026-10-01T09:30:14.000Z · 912 ms
09:30:14.891 ℹ authorized target http://127.0.0.1:4720 — the example storefront in this directory, on loopback

09:30:14.902 report: report/report.html
09:30:14.902 kept: report/runs/2026-10-01T09-30-14-902Z
```

Each line starts with the time it was printed. Pass `--no-timestamps` if you would rather not see
it. A passing test is one line: `✓`, its name and how long it took. The last line is the
**[verdict](/runbook/glossary#verdict)**: how many passed, the env it ran under, the **[seed](/runbook/glossary#seed)** and the **[clock](/runbook/glossary#clock)**. Pass that seed
back with `--seed`, and the same clock with `--now`, and generated values come out the same again,
which is how a failure that depends on data is reproduced.

## What it wrote

Every run writes `report/`:

```sh runbook
ls report
```

```text runbook-output
junit.xml
report.html
results.json
runs
```

- **`report.html`** is the report, one self-contained file. Open it in a browser: every test, every
  step, the request and the response for each API step, and a screenshot for each browser step that
  failed: the run's [evidence](/runbook/glossary#evidence). It needs no server and can be attached to a ticket
  as it is.
- **`results.json`** is the same run as data, for a script, a dashboard or `tflw merge`.
- **`junit.xml`** is the format every CI system draws as a test list.
- **`findings.sarif`** appears when a scan ran. GitHub's code scanning reads it.
- **`runs/`** keeps every run, newest last. The page and `--failed` read it, and so does the
  history beside each test in the report: a test that changed verdict between two runs of the same
  file is marked **[flaky](/runbook/glossary#flaky)**. `runs keep N` in `tflw.config` says how many to keep (50 when it says
  nothing), and `--no-keep` skips keeping one.

`results.json` is ordinary JSON, so any tool can read it. This prints the verdict and the counts:

```sh runbook
node -e 'const r = require("./report/results.json"); console.log(r.ok, r.passed, "of", r.total)'
```

```text runbook-output
true 4 of 4
```

## A failure, on purpose

Make a test that is wrong. The catalogue has three items, and this one says four:

```sh runbook
cat > tests/wrong.tflw <<'EOF'
test "the catalogue holds what the shop sells"
  api GET /items
  expect status equals 200
  expect body.items has count 4
EOF
```

Then run it. `|| echo` prints tflw's exit code, which a CI job reads to decide pass or fail:

```sh runbook
npx tflw run tests/wrong.tflw || echo "tflw exited $?"
```

```text runbook-output
09:31:02.310 ✗ the catalogue holds what the shop sells
09:31:02.310     expected body.items to have count 4, but got [{"id":1,"name":"Filter coffee, 1kg","price":1400},{"id":2,"name":"Espresso blend, 250g","price":850},{"id":3,"name":"Decaf, 250g","price":900}]
…
09:31:02.312 FAIL 0/1 passed, 1 failed · env local · seed 51406 · now 2026-10-01T09:31:02.000Z · 41 ms
…
tflw exited 1
```

The failure prints as it happens, with what the step expected and what it got, then again in the
summary under the step that failed. The same text is in `report.html`, beside the response the assertion read.

| exit | means |
|---|---|
| 0 | every test passed |
| 1 | a test failed |
| 2 | it could not run: a usage error, a config that does not check, a file that does not parse |
| 3 | a load test was inconclusive (chapter 6) |
| 130 | you pressed Ctrl+C; the tests already running finished, and the partial report was kept |

Fix the test (the number is 3) and run only what failed last time. `--failed` reads `report/runs/`
and replays each test whose newest kept verdict is a failure:

```sh runbook
sed -i.bak 's/has count 4/has count 3/' tests/wrong.tflw && rm tests/wrong.tflw.bak
npx tflw run --failed
```

```text runbook-output
09:31:40.118 re-running 1 test whose last run failed

09:31:40.131   ✓ the catalogue holds what the shop sells (9 ms)

09:31:40.131 PASS 1/1 passed · env local · seed 30981 · now 2026-10-01T09:31:40.000Z · 13 ms
…
```

That file has done its job:

```sh runbook
rm tests/wrong.tflw
```

## You now have

The Coffee Shelf, its shop still running, and a `report/` with this chapter's runs kept under
`report/runs/`. You have seen a pass, a failure and its exit code, and replayed what failed.

## Next, or instead

- **Next:** [4. An API test of your own](/runbook/start/api-test).
- Every flag `run` takes: [`tflw run`](/reference/cli#tflw-run).
- Running in CI, sharded and with history: [Running a suite](/runbook/running).
- The report as you will read it every day: [A run, on the page](/ui/a-run).
