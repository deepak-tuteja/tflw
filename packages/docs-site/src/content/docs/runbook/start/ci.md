# 9. CI

A suite earns its keep when it runs on every change without anyone remembering to run it. This
chapter puts the Coffee Shelf's suite in a CI job: what to run, what to keep, how to split a slow
suite across machines and join the halves, and how to send a run to your tracing system.

## What CI installs

<Published :when="false">

Chapter 1 installed tflw from a tarball on your machine, and `package.json` now points at that file's
path, which a CI runner does not have. Until 1.0, keep the tarball in the project and install it
from there, so `npm ci` finds it on any machine:

```sh runbook
mkdir -p vendor
cp "$TFLW_TGZ" vendor/
npm install -D "./vendor/$(basename "$TFLW_TGZ")"
```

Commit `vendor/` with the rest. On 1.0 day this step goes away: `npm install -D tflw` records a
version, and `npm ci` fetches it.

</Published>

<Published>

`npm install -D tflw` in chapter 1 recorded a version in `package.json`, so `npm ci` on a runner
installs the same one. Nothing else is needed.

</Published>

## The four lines

Every CI job for a tflw project comes down to these, run from the project's directory:

```sh runbook
npx tflw fmt --check
npx tflw check
```

```text runbook-output
15 files, 0 would change.
15 files checked, no problems found.
```

```sh runbook
npx tflw run --tag functional --forbid-insecure
```

```text runbook-output
…
09:40:22.517 PASS 39/39 passed · env local · seed 7712 · now 2026-10-01T09:40:20.000Z · 2803 ms
…
```

1. **`fmt --check`** fails the job when a file is not formatted, and changes nothing.
2. **`check`** fails it when a file does not parse or check, before anything is sent.
3. **`run`** is the suite. Its exit code is the job's verdict: 0 passed, 1 a test failed, 2 it could
   not run, 3 a load test gave no verdict.
4. **Keep `report/`** as the job's artifact, whatever the verdict, so a failure can be read. In
   GitHub Actions that is `actions/upload-artifact` with `if: always()`.

`--forbid-insecure` refuses to run at all when the env turns certificate checks off (`insecure true`
in `tflw.config`), so a setting meant for a laptop cannot reach CI unnoticed.

The shop has to be running for `run`, the way it is in your terminal: a job that starts the service
it tests starts it first. Here is the whole job for GitHub Actions:

```yaml
jobs:
  tflw:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with: { node-version: 22 }
      - run: npm ci
      - run: npx tflw install-browsers
      - run: npx tflw fmt --check
      - run: npx tflw check
      - run: npm run shop &
      - run: npx tflw run --tag functional --forbid-insecure
      - uses: actions/upload-artifact@v7
        if: always()
        with: { name: tflw-report, path: report/ }
```

<Published>

Or the tflw Action, which installs tflw and the browsers, runs the suite, keeps the report and
annotates each failing test on the pull request:

```yaml
      - run: npm run shop &
      - uses: deepak-tuteja/tflw/.github/action@v1
        with:
          args: run --tag functional --forbid-insecure
```

</Published>

`report/junit.xml` is what most CI systems draw as a list of tests, and `report/findings.sarif` is
what GitHub's code scanning reads. [CI and reporting](/guide/ci-and-reporting) covers both.

## Splitting a slow suite: `--shard` and `merge`

`--shard 1/2` runs the first half of the suite's files and `--shard 2/2` the second, so two machines
can each run half. Each says which files it took: 8 of 15, then the other 7. Each half writes its own `report/`. Here both run on one machine, and each
report is copied aside before the next run replaces it:

```sh runbook
npx tflw run --tag functional --shard 1/2
cp -R report shard-1
npx tflw run --tag functional --shard 2/2
cp -R report shard-2
```

```text runbook-output
09:41:03.020 shard 1/2: 8 of 15 files
…
09:41:05.112 PASS 21/21 passed · env local · seed 5150 · now 2026-10-01T09:41:03.000Z · 2091 ms
…
09:41:05.774 shard 2/2: 7 of 15 files
…
09:41:07.402 PASS 18/18 passed · env local · seed 1209 · now 2026-10-01T09:41:05.000Z · 1627 ms
…
```

`tflw merge` joins finished runs into one report, as if one machine had run everything. The counts
add up again, 21 and 18 to 39:

```sh runbook
npx tflw merge shard-1 shard-2 --out merged
```

```text runbook-output
…
PASS 39/39 passed · env local · seed 5150 · now 2026-10-01T09:41:03.000Z · 3718 ms
…
merged 2 runs into merged/report.html
```

`merged/` holds the same four files a run writes. In CI, each shard job uploads its `report/`, and
one job after them downloads all of them and merges.

## Sending a run to your tracing system: `export`

If your team watches services in an OpenTelemetry system (Jaeger, Tempo, Honeycomb, Datadog), `tflw
export otlp` sends a finished run there as one trace: a span for the run, each file, each test and
each step. To see what it sends without a real collector, this one-line server prints what reaches
it:

```sh runbook background
node -e 'require("node:http").createServer((req, res) => { let n = 0; req.on("data", (c) => (n += c.length)); req.on("end", () => { console.log(`collector: ${req.method} ${req.url}, ${n} bytes`); res.end("{}"); }); }).listen(4318, "127.0.0.1", () => console.log("collector on http://127.0.0.1:4318"))' &
```

```text runbook-output
collector on http://127.0.0.1:4318
```

Send the last run to it. `export` reads `report/` unless you name another directory:

```sh runbook
npx tflw export otlp --endpoint http://127.0.0.1:4318/v1/traces
```

```text runbook-output
exported 99 spans (one trace) to http://127.0.0.1:4318/v1/traces
```

The run became one trace of 99 spans: one for the run, one per file, one per test and one per step,
and the stand-in printed the request it received. Point `--endpoint` at your collector's OTLP/HTTP
traces address, and add `--header` for its API key.
The stand-in can be stopped with `kill %N`; `jobs` lists the numbers.

## You now have

A project CI can install, the four lines that make a job, a suite split in two and joined again in
`merged/`, and a run sent as a trace.

## Next, or instead

- **Next:** [10. Your own service](/runbook/start/your-service).
- Everything about running in CI, including flaky-test history: [Running a suite](/runbook/running).
- Reports, JUnit, SARIF, evidence levels and redaction: [CI and reporting](/guide/ci-and-reporting).
- Every flag: [`tflw run`](/reference/cli#tflw-run), [`tflw merge`](/reference/cli#tflw-merge-report-dir),
  [`tflw export`](/reference/cli#tflw-export).
