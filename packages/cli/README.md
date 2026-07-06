# tflw

A testing-only DSL for API tests — reports first, syntax second. `v0.1.0` is **API-only**; the
browser half (Playwright) lands in `0.2.0`.

## Why tflw

Three things tflw does that a general-purpose language + an HTTP client doesn't give you for free:

- **Reporting-first runtime.** Every step is an event, by construction — a self-contained
  `report.html` (full request/response detail) and `junit.xml` fall out of the same event stream
  `tflw run` already emits, with secrets redacted everywhere automatically. Nothing to wire up.
- **Teaching-quality diagnostics.** Source line + caret + "did you mean", stable `TF0xx` codes, a
  conservative unknown-variable checker pass — errors read like a compiler's, not a stack trace.
- **One language, API today, browser next.** `0.2.0` adds UI steps to the same grammar, so a login
  → seed-via-API → drive-UI → assert-backend-state test stays one readable file instead of gluing
  two tools together.

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

`tflw init` scaffolds a health-check test against `http://localhost:3001` — point `tflw.config`'s
`api` line at your own service and edit `example.tflw` from there. A run writes
`report/report.html` (open it in a browser — full request/response detail, redacted secrets) and
`report/junit.xml` (for CI).

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
  its captured headers auto-applied — no repeated login boilerplate.
- `before`/`after` (file or per-test) for setup/teardown; per-test hooks share scope with the test.
- `expect` is a hard assertion (stops the test); `check` is soft (records and continues, fails the
  test at the end).
- `retry N` re-runs a failing test up to N more times; a pass on a later attempt is reported
  passed-but-flagged-`flaky`, never silently green.
- `with each` runs one reported case per row — inline (`| col | ...`) or file-backed
  (`with each from "./data.csv"` / `.json`).
- `--tag <name>` on `tflw run` filters to tests carrying `@name`; `--workers <n>` runs files
  concurrently (default 1); `--seed <n>` reproduces a run's exact generated values.

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
tflw run [files...] [--env <name>] [--seed <n>] [--now <iso>] [--tag <name>] [--workers <n>] [--no-color]
tflw check [files...] [--env <name>] [--no-color]
tflw init
tflw --version, -v
tflw --help, -h
```

```sh
npx tflw run --env staging --workers 4 --seed 42 --now 2026-01-01T00:00:00.000Z --no-color
```

## CI

`tflw check` validates every file (parse + the full checker pipeline) with no execution and no
secrets required — a fast pre-commit/CI lint step. `tflw run` exits non-zero on any test failure
and writes `report/junit.xml`, so it drops into any CI runner as a plain command — no plugin
needed.

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
