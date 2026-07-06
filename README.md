# testFlow (`tflw`)

A testing-only DSL for API tests — reports first, syntax second. `v0.1.0` is **API-only**; the
browser half (Playwright) lands in `0.2.0`. See [SPEC.md](SPEC.md) for the full language
reference — every section carries a shipped/planned (`✅`/`🔧`/`🔮`) status badge, so it doubles as
the single source of truth for what's actually built vs. still ahead.

## Why tflw

Three things tflw does that a general-purpose language + an HTTP client doesn't give you for free:

- **Reporting-first runtime.** Every step is an event, by construction — a self-contained
  `report.html` (full request/response detail) and `junit.xml` fall out of the same event stream
  `tflw run` already emits, with secrets redacted everywhere automatically. Nothing to wire up.
- **Teaching-quality diagnostics.** Source line + caret + "did you mean", stable `TF0xx` codes
  (§17), a conservative unknown-variable checker pass — errors read like a compiler's, not a stack
  trace.
- **One language, API today, browser next.** `0.2.0` adds UI steps to the same grammar, so a login
  → seed-via-API → drive-UI → assert-backend-state test stays one readable file instead of gluing
  two tools together.

Measured against raw `fetch` + `node:test` (the honest "no tool" baseline, `acceptance/README.md`):
**2.8× fewer lines** overall (4–8× on retry/polling/generated-data scenarios), a categorical report
quality gap (raw's default output has no request/response capture or redaction without hand-building
it), and **~3× faster runs** purely from session reuse (a cached login vs. re-authenticating per
file). Where tflw *isn't* the right pick: if you already have **Karate** working for your team, its
Java/Gherkin ecosystem and maturity are a real reason to stay; **Hurl**'s single-file, no-runtime
`.hurl` scripts are a better fit for simple curl-replacement smoke checks than a full DSL.

## Project layout

An npm workspaces monorepo. The only thing most users need is `packages/cli` (the `tflw` binary);
the rest is the implementation and the evidence behind the numbers above.

| Path | What it is |
|---|---|
| `packages/lang` | Lexer, parser, and checker — the `.tflw` grammar. Grammar reference: [`GRAMMAR.md`](packages/lang/GRAMMAR.md) |
| `packages/runtime` | The interpreter: HTTP execution, sessions, hooks, retries, data tables, generators |
| `packages/reporter` | Turns the runtime's event stream into `report.html` and `junit.xml` |
| `packages/cli` | The `tflw` command itself — what `npm i -D tflw` installs. Own [README](packages/cli/README.md) (what ships in the npm package) |
| `packages/vscode` | VS Code extension: `.tflw` syntax highlighting |
| `acceptance/` | tflw vs. raw `fetch`+`node:test` head-to-head, plus an external dogfood run against a live public API (restful-booker) — the source of the "2.8× fewer lines" numbers above. [Own README](acceptance/README.md) |
| `examples/dogfood` | Worked `.tflw` files exercising the full grammar together (sessions, hooks, actions, data tables) — used as regression fixtures, and a good place to see real, larger examples beyond this README |

See [CHANGELOG.md](CHANGELOG.md) for released versions.

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
  passed-but-flagged-`flaky`, never silently green. `random` values replay identically on every
  attempt (same per-test seed); `unique(...)`/`unique email`/etc. deliberately do **not** — their
  counter keeps advancing so a retried attempt can never collide with data the failed attempt
  already created.
- `with each` runs one reported case per row — inline (`| col | ...`) or file-backed
  (`with each from "./data.csv"` / `.json`).
- `--tag <name>` on `tflw run` filters to tests carrying `@name`; `--workers <n>` runs files
  concurrently (default 1); `--seed <n>` reproduces a run's exact generated values.

Secrets (`env(NAME)`) are redacted from every report automatically.

### Actions, imports, and the JS/TS escape hatch

Factor a repeated step sequence into an `action` and reuse it across files with `import`; drop into
real JS/TS with `use` when a value needs computing (hashing, signing, formatting) rather than
declaring:

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

A JS helper's return value isn't itself an assertion subject — route it through a request `body`
(or `header`) field and assert on that, same as any other captured value. Space-separated call
names (`create widget(...)`, `make label(...)`) resolve to the action/export's camelCase name
(`createWidget`/`makeLabel`) under the hood.

**`action`/`use` calls don't work inside `session` blocks** in `v0.1` — a session runs with an
empty call registry, so `create widget(...)` there fails with `unknown call \`create widget(...)\`
— no action (\`import\`) or JS helper (\`use\`) defines it`, even though the identical call works
in a test in the same file. Keep session bodies to plain `api` steps (SPEC.md §3.3).

### Hooks

`before`/`after` run once per test and share its scope — seed data in `before`, clean it up in
`after`, no manual plumbing between them:

```
import "./shared/create.tflw"

before
  let widgetId = create widget(unique("Widget"), 9.99)

test "seeded widget is fetchable"
  api GET /widgets/{widgetId}
  expect status equals 200
  expect body.name contains "Widget"

after
  api DELETE /widgets/{widgetId}
  expect status equals 200
```

(`before file`/`after file` run once per file instead — SPEC.md §4.2. There is no `before each`/
`after each`; `each` is exclusively a `with each` data-table keyword, §"Data-driven tests" below.)

### Polling: `wait until api`

For state that becomes true asynchronously (a job finishes, an order ships), `wait until api`
re-issues the request until its `expect`-only block passes or the wait timeout (default 30s,
`timeout wait <duration>` to override) elapses:

```
test "order eventually ships"
  api POST /products body { name: "Widget", status: "processing" }
  expect status equals 201
  capture body.id as id

  wait until api GET /products/{id}
    expect body.status equals "shipped"
```

### Data-driven tests from a file

`with each` also reads rows from a file instead of an inline table — same one-case-per-row
reporting, CSV or JSON:

```
# data/widgets.csv
name,price
"Widget, Standard",9.99
Widget Pro,19.99
```

```
with each from "./data/widgets.csv"
test "creates {name} from a CSV row"
  api POST /widgets body { name: {name}, price: {price} }
  expect status equals 201
  expect body.price equals {price}
```

Numeric-looking cells (`price` above) are coerced to numbers automatically; quoted fields support
embedded commas and `""`-escaped quotes (minimal RFC-4180). `.json` rows work the same way, as an
array of objects.

### Generators

`unique(...)` (and `unique email`/etc.) guarantee collision-free values across retries; `random`
produces reproducible-under-`--seed` values for anything else:

```
test "creates a widget with a random price"
  let price = random decimal 5 to 50
  api POST /widgets body { name: "Random Widget", price: {price} }
  expect status equals 201
  expect body.price equals {price}
```

### Retry & flaky reporting

`retry N` re-runs a failing test up to N more times. A pass on a later attempt is never silently
green — it's reported passed-but-flagged:

```
test "flaky endpoint eventually succeeds" retry 2
  api GET /flaky
  expect status equals 200
```

```
✓ flaky endpoint eventually succeeds (flaky) (48 ms)
```

## Corporate networks

- **Self-signed/expired staging cert:** `insecure true` in `tflw.config` (per-`env` or `defaults`)
  disables TLS verification for the run — every run with it active says so loudly, in the CLI
  summary and `report.html`, never silently.
- **Private/internal CA:** prefer `NODE_EXTRA_CA_CERTS=/path/to/ca.pem npx tflw run` over
  `insecure true` — verification stays on, only your org's CA is added.
- **Corporate HTTP(S) proxy:** `NODE_USE_ENV_PROXY=1` on Node ≥ 24 makes `fetch` honor
  `HTTP_PROXY`/`HTTPS_PROXY`. Node 22 has no built-in env-var proxy path for `fetch` — an honest
  limitation, not worked around with a proxy-agent dependency.

See SPEC.md §3.5 for the full story, including why network failures name the likely cause instead
of a bare `fetch failed`.

## CLI reference

```sh
npx tflw run --env staging --workers 4 --seed 42 --now 2026-01-01T00:00:00.000Z --no-color
```

| Flag | Effect |
|---|---|
| `--env <name>` | selects a named `env` block from `tflw.config` instead of the `default` one — e.g. run the same suite against `staging` |
| `--tag <name>` | only runs tests carrying `@name` |
| `--workers <n>` | runs files concurrently across `n` workers (default 1) |
| `--seed <n>` | fixes every `random`-family value for the run, so a failure is reproducible byte-for-byte |
| `--now <iso>` | pins the run's notion of "now" to an exact instant (combine with `--seed` to reproduce a run's exact absolute generated values) |
| `--no-color` | disables ANSI color in CLI output — useful for CI logs or piping to a file |
| `--version`, `-v` | print the installed version |
| `--help`, `-h` | print usage |

`tflw check [files] [--env <name>] [--no-color]` runs the same flags against validation-only mode
(parse + checker pipeline, no execution, no secrets required).

## CI

`tflw check` validates every file (parse + the full checker pipeline) with no execution and no
secrets required — a fast pre-commit/CI lint step. `tflw run` exits non-zero on any test failure
and writes `report/junit.xml`, so it drops into any CI runner as a plain command — no plugin
needed. A GitHub Actions example:

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

## Status & roadmap

`v0.1.0` is shipped: config-as-tflw, sessions, capture-chaining, hooks/retry/tags/data-tables,
actions + the JS/TS escape hatch, generators, teaching-quality diagnostics, parallel workers, and
a self-contained `report.html` + `junit.xml`. **Next: `0.2.0`** adds the browser half (Playwright —
`open`/`click`/`fill`, selectors, screenshots). See [SPEC.md](SPEC.md)'s per-section status badges
for the full shipped-vs-planned breakdown, and [CHANGELOG.md](CHANGELOG.md) for released versions.

## Platform support

Tested on Linux/macOS. Windows works via WSL; there is no native-Windows CI for `0.1` yet — a
deliberate trade-off (PLAN decision 79), revisited on demand.

## Contributing (working in this monorepo)

Source is public and issues are welcome — pull requests aren't accepted yet (PLAN decision 80).

```sh
git clone <this repo> && cd testFlow
npm install
npm run build       # build all packages
npm run typecheck   # type-check all packages
npm test            # run all package test suites
```

`npm run build` (root, or `-w tflw`) always produces the same self-contained, esbuild-bundled
`packages/cli/dist/cli.js` that `npm publish` would ship — see PLAN.md decision 43 (the bundle) and
decision 84 (why `build` and the publish artifact are the same thing, not two).

## Using tflw from a checkout (no npm registry needed)

The public repo may exist before `tflw` is published to npm, or you may just want to run the tool
straight from a clone without waiting on a release. After the build above, `packages/cli/dist/cli.js`
is the exact runnable artifact — invoke it directly from anywhere, no `npm i -D tflw` required:

```sh
node /path/to/testFlow/packages/cli/dist/cli.js run    # or `init`
```

To get it as a real `tflw` command inside another project on this machine (still no registry
involved):

```sh
cd your-project
npm install --no-save file:/path/to/testFlow/packages/cli
npx tflw run
```
