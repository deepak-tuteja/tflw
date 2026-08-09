# tflw

A testing-only DSL for API tests — reports first, syntax second. API testing, browser testing (real
Playwright automation) and load testing (ramp/hold/step/spike, thresholds, validated against k6 on
real contended workloads) are all built; security/pen-test testing is next. Pre-1.0, not yet
published to npm.

## Why tflw

Three things tflw does that a general-purpose language + an HTTP client doesn't give you for free:

- **Reporting-first runtime.** Every step is an event, by construction — a self-contained
  `report.html` (full request/response detail), `junit.xml`, and `results.json` all fall out of
  the same event stream `tflw run` already emits, with secrets redacted everywhere automatically.
  Nothing to wire up.
- **Teaching-quality diagnostics.** Source line + caret + "did you mean", stable `TF0xx` codes, a
  conservative unknown-variable checker pass — errors read like a compiler's, not a stack trace.
- **One language for API, browser and load testing** (security testing is next)**.** UI steps share
  the same grammar as API steps, so a login → seed-via-API → drive-UI → assert-backend-state test
  stays one readable file instead of gluing two tools together — and a load test is the same `test`
  block with a `ramp to …` line in it, not a separate tool with its own script format.

Measured against raw `fetch` + `node:test` (the honest "no tool" baseline): **2.8× fewer lines**
overall (4–8× on retry/polling/generated-data scenarios), a categorical report quality gap, and
**~3× faster runs** purely from session reuse. Where tflw *isn't* the right pick: if **Karate**
already works for your team, its Java/Gherkin ecosystem and maturity are a real reason to stay;
**Hurl**'s single-file, no-runtime scripts fit simple curl-replacement smoke checks better than a
full DSL.

## Install & quickstart (< 5 minutes, no browser install)

```sh
npm i -D tflw
```

In any project with an API you want to test:

```sh
npx tflw init   # scaffolds tflw.config + example.tflw + .env.example + .gitignore
npx tflw run    # runs it — green in seconds
```

`tflw init` scaffolds a health-check test against **tflw's own demo service** — a small HTTP server
that tflw starts for the run and stops after it — so that second command really is green in an empty
directory, with nothing installed and nothing running. It answers `GET /health` and nothing else; a
run against it is labelled as a demo run in the summary and in `report.html`, because it proves
something about tflw and nothing about your system.

Point `tflw.config`'s `api` line at your own service to test something real — one line, and it is
the first thing the scaffolded config asks you to change:

```
env local default
  api "tflw://demo"          # ← swap for "http://localhost:3001", or wherever your API lives
```

A run always writes
`report/report.html` (open it in a browser — full request/response detail, redacted secrets),
`report/junit.xml` (for CI), and `report/results.json` (the same redacted report as JSON).

## Writing a test

```
test "health check"
  api GET /health
  expect status equals 200
```

```
session admin
  api POST /auth/login body { email: env(ADMIN_EMAIL), password: env(ADMIN_PW) }
  expect status equals 200
  capture body.token as token
  header "Authorization" is "Bearer {token}"
```

```
with each
  | category   |
  | "tools"    |
  | "hardware" |
test "creates a {category} product" as admin retry 1
  api POST /products body { name: unique("Widget"), price: 12.5, category: {category} }
  expect status equals 201
  check body.category equals {category}
```

- `session <name>` (in `tflw.config`) runs once per run; a test opts in with `as <name>` and gets
  its captured headers auto-applied — no repeated login boilerplate. It also auto-refreshes on a
  `401` and honors its own TTL if it has one; `session <name> oauth2` is sugar for a
  client-credentials grant. Per-env `cert`/`key` config keys add mTLS client certs. See
  [SPEC.md](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md) §3.3/§3.6 for the full grammar.
- `before`/`after` (file or per-test) for setup/teardown; per-test hooks share scope with the test.
- `expect` is a hard assertion (stops the test); `check` is soft (records and continues, fails the
  test at the end).
- `retry N` re-runs a failing test up to N more times; a pass on a later attempt is reported
  passed-but-flagged-`flaky`, never silently green.
- `with each` runs one reported case per row — inline (`| col | ...`) or file-backed
  (`with each from "./data.csv"` / `.json`).
- `--tag <name>[,<name>...]` on `tflw run` filters to tests carrying any of the listed `@name`s
  (comma-separated OR; combines with `--only` as AND); `--parallel <n>` runs files concurrently
  (default: `tflw.config`'s `workers` key); `--seed <n>` reproduces a run's exact generated values.
  `--workers <n>` is the unrelated, workload-only axis — it forks load-generation processes for one
  file's workload-bearing tests, never files.

Secrets (`env(NAME)`) are redacted from every report automatically.

### Actions, imports, the JS/TS escape hatch, and polling

```
# shared/create.tflw
action create widget(name, price)
  api POST /widgets body { name: {name}, price: {price} }
  expect status equals 201
  capture body.id as id
  give id
```

```ts
// helpers/label.ts
export function makeLabel(ctx: { env: NodeJS.ProcessEnv }, id: string, price: number): string {
  return `widget ${id} at $${price.toFixed(2)}`;
}
```

```
import "./shared/create.tflw"
use "./helpers/label.ts"

test "reuses an action and a JS helper"
  let price = 12.5
  let widgetId = create widget("Gadget", price)
  let label = make label(widgetId, price)

  api POST /widgets body { name: "Gadget", price: {price}, description: {label} }
  expect status equals 201
  expect body.description contains "widget"
```

A JS helper's return value isn't itself an assertion subject — route it through a request `body`/
`header` field and assert on that. `action`/`use` calls don't work inside `session` blocks in
`v0.1` (empty call registry there) — keep session bodies to plain `api` steps.

`wait until api` polls a request until its `expect`-only block passes or the wait timeout elapses:

```
test "order eventually ships"
  api POST /products body { name: "Widget", status: "processing" }
  expect status equals 201
  capture body.id as id

  wait until api GET /products/{id}
    expect body.status equals "shipped"
```

`with each from "./data.csv"` reads rows from a file (also `.json`) instead of an inline table;
numeric-looking cells are coerced automatically, quoted fields support embedded commas.

`retry N` reports a later-attempt pass as passed-but-flagged, never silently green:

```
test "flaky endpoint eventually succeeds" retry 2
  api GET /flaky
  expect status equals 200
```
```
✓ flaky endpoint eventually succeeds (flaky) (48 ms)
```

### Load testing

There is no second language and no separate command. A `test` becomes a load test the moment it
contains a workload line — `ramp`/`hold`/`step`/`spike`/`run … iterations` — and `tflw run` drives
it alongside the functional tests, into the same one report:

```
test "checkout under load"
  ramp to 50 users over 30s
  api POST /cart/checkout body { productId: "widget-1", qty: 1 }
  expect status equals 201
  threshold p95 duration is less than 800ms
  threshold error rate is less than 1%
```

Its verdict comes from the `threshold` lines, not from a single request's outcome. The body is
ordinary steps, so an `action` written for the functional suite is callable here unchanged. Browser
steps are rejected inside one (a browser VU is 50–100MB each — API-only in v1). `--workers <n>`
forks generator processes when one Node process becomes the bottleneck, and `--skip-workload` drops
these tests entirely for fast iteration on the functional ones. `tflw init --load` scaffolds a
runnable starter file. Measured against k6 and Artillery on real contended workloads — see the
[load-testing guide](https://deepak-tuteja.github.io/tflw/guide/load-testing) for the numbers.

Full worked examples (hooks, generators, CSV, CLI flag reference) are in the root
[README.md](https://github.com/deepak-tuteja/tflw#readme) and [SPEC.md](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md).

## Corporate networks

- **Self-signed/expired staging cert:** `insecure true` in `tflw.config` (per-`env` or `defaults`)
  disables TLS verification for the run — every run with it active says so loudly, in the CLI
  summary and `report.html`, never silently.
- **Private/internal CA:** prefer `NODE_EXTRA_CA_CERTS=/path/to/ca.pem npx tflw run` over
  `insecure true` — verification stays on, only your org's CA is added.
- **Corporate HTTP(S) proxy:** `NODE_USE_ENV_PROXY=1` on Node ≥ 24 makes `fetch` honor
  `HTTP_PROXY`/`HTTPS_PROXY`. Node 22 has no built-in env-var proxy path for `fetch` — an honest
  limitation, not worked around with a proxy-agent dependency.

## CLI

```
tflw run [files...] [--env <name>] [--seed <n>] [--now <iso>] [--tag <name>[,<name>...]] [--only <name>]
         [--parallel <n>] [--workers <n>] [--skip-workload] [--no-color] [--verbose]
         [--forbid-insecure] [--evidence <level>] [--failed] [--bail] [--format ndjson]
         [--no-timestamps] [--log-file <path>] [--log-output <dest>] [--log-level <level>]
         [--browser chromium|firefox|webkit] [--headed] [--update-snapshots]
tflw check [files...] [--env <name>] [--no-color] [--format json]
tflw init [--load]
tflw docs [topic]
tflw lsp
tflw install-browsers [--browser chromium|firefox|webkit]
tflw pick <url> [--browser chromium|firefox|webkit]
tflw watch [files...] [--env <name>] [--seed <n>] [--browser chromium|firefox|webkit] [--no-color]
tflw refactor apply <id>
tflw migrate [files...] [--env <name>] [--no-color]
tflw --version, -v
tflw --help, -h
```

`run` drives functional and workload-bearing tests alike in one pass — a `test` becomes
workload-bearing the moment it contains a `ramp`/`hold`/`step`/`spike`/`run … iterations` line, and
everything renders into the same one report. There is no separate `load` command (folded into `run`
in M53). `--parallel <n>` runs files concurrently; `--workers <n>` is the unrelated, workload-only
axis that forks load-generation processes; `--skip-workload` drops the workload-bearing tests for
fast iteration on the functional ones. `install-browsers`/`pick`/`watch` are the browser half,
`refactor apply` is the reuse pass, and `migrate` currently has nothing to do — no checker rule
emits a deprecation yet, so it always reports `no deprecated syntax found`.

```sh
npx tflw run --env staging --parallel 4 --seed 42 --now 2026-01-01T00:00:00.000Z --no-color
```

Every run always writes `report/report.html`, `report/junit.xml`, and `report/results.json`
(plus `report/.last-run.json` for `--failed` and `report/events.ndjson` under `--format ndjson`).
See the [full CLI flags reference](https://deepak-tuteja.github.io/tflw/reference/cli) for what
each flag does, or [Running & debugging tests](https://deepak-tuteja.github.io/tflw/guide/debugging)
for a walkthrough.

## CI

`tflw check` validates every file (parse + the full checker pipeline) with no execution and no
secrets required — a fast pre-commit/CI lint step. `tflw run` exits non-zero on any test failure
and writes `report/junit.xml` + `report/results.json`, so it drops into any CI runner as a plain
command — no plugin needed. `--bail` stops at the first failure; `--failed` re-runs just what
failed last time.

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npm ci
- run: npx tflw run
- uses: actions/upload-artifact@v4
  if: always()
  with:
    name: tflw-report
    path: report/
```

## Platform support

Tested on Linux/macOS. Windows works via WSL; there is no native-Windows CI yet — revisited on
demand.

## Learn more

Full language reference, design decisions, and source: <https://github.com/deepak-tuteja/tflw>.
