# 11. CI, reporting & safety

## Reports

Every run writes `report/report.html` (step timeline, full request/response detail),
[`report/junit.xml`](#junit-xml) (for CI test-result ingestion), and
`report/results.json` (the same redacted run
report as JSON — read a run's outcome from a file instead of scraping stdout) — they all fall out of
the same event stream `tflw run` already emits, nothing to wire up.

`report.html` is a single file unless the run captured a screenshot or trace large enough to be
written out beside it, in which case the report is `report.html` **plus** `report/assets/` — its
footer tells you which, along with what the file actually contains. Read that footer before you
attach a report anywhere: at the default evidence level it holds whole response bodies and page
screenshots. See [evidence levels](#evidence-levels) to turn that down.

`tflw check [files]` runs the same parse + full checker pipeline `run` executes before it does
anything, with **no execution** and no secrets required — a fast pre-commit/CI lint step. `tflw
run` exits non-zero on any test failure. A GitHub Actions example:

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

## `junit.xml` — what your CI dashboard reads {#junit-xml}

`report/junit.xml` is the artifact GitHub Actions, Jenkins, GitLab and friends ingest to build a
test-results view. Its shape mirrors your suite: a `<testsuites>` root, **one `<testsuite>` per
`.tflw` file**, and a `classname` on every `<testcase>` naming the file it came from.

```xml
<testsuites name="tflw" tests="2" failures="1" errors="0" time="1.234" timestamp="…">
  <testsuite name="tests/smoke.tflw" tests="1" failures="0" errors="0" time="0.012" timestamp="…">
    <properties>
      <property name="env" value="local"/>
      <property name="seed" value="42"/>
      <property name="now" value="…"/>
    </properties>
    <testcase name="checkout works" classname="tests/smoke.tflw" time="0.012"/>
  </testsuite>
  <testsuite name="tests/regression.tflw" tests="1" failures="1" errors="0" time="0.020" timestamp="…">
    …
    <testcase name="checkout works" classname="tests/regression.tflw" time="0.020">
      <failure message="expected status to equal 200, but got 500">…</failure>
    </testcase>
  </testsuite>
</testsuites>
```

Dashboards identify a test by `name` + `classname` and track its history — flaky rate, "first
failed in", "fixed in" — under that identity. Two files declaring a test with the same name (a
`smoke.tflw` and a `regression.tflw` both having a `"checkout works"`) therefore stay two distinct
rows, which is why the file is on every testcase and not only on the suite.

Each suite repeats the run's `<properties>` — including the **seed**, so you can reproduce a failed
CI run locally with `tflw run --seed <n>` straight from the dashboard. They're duplicated because
JUnit only allows `<properties>` inside a `<testsuite>`, not at the root.

A workload-bearing test contributes one `<testcase>` per declared `threshold` (see
[Load testing](/guide/load-testing)); a run whose generator saturated marks them `<skipped>` rather
than passed or failed.

## Secrets are redacted automatically

Anything that ever flowed through `env(NAME)` — header, body, URL, a derived interpolation —
prints as `•••(NAME)` in `report.html`, traces, and CLI output, automatically. See
[Config & environments](/guide/config) for `require env`.

## `redact` — name a secret by position, not by source {#redact}

`redact` masks a named body field, header or query parameter regardless of where its value came
from — useful for PII (`email`, `address`, `ssn`) and for credentials that were never read through
`env(...)` in the first place:

```tflw-config
env staging
  api "https://staging.example.com"
  redact body.email, body.*.address
  redact header "Authorization", header "X-Api-Key", query "token"
```

- **`body.<path>`** — `.prop` segments and a `.*` wildcard (matches every object key or array
  element).
- **`header "<name>"`** — one request or response header, matched case-insensitively. `"*"` matches
  every header.
- **`query "<name>"`** — one URL query parameter. Only the **value** is masked; the path, the other
  parameters and the parameter's own name survive, so the report still says which request this was.
  (There is no `redact url` on purpose — masking a whole URL makes the report unreadable.)

Header and query names are quoted strings, the same way every header name is written elsewhere in
the language (`header "Accept" is …`) — and the only form that can express `X-Api-Key` or
`Set-Cookie`.

Applied to the report-only trace — `expect`/`capture` always see the real, unmasked value.

**`redact` means "this value is a secret."** If you `capture` out of a position you named here, the
captured value is tracked from then on and masked wherever it turns up later — a subsequent
request's URL, a `log` line, another step's detail text:

```tflw-config
env staging
  redact body.accessToken
```

```tflw
test "reads a session"
  api POST /login
  capture body.accessToken as token
  api GET /session?token={token}    # the token is masked here too
```

## Evidence levels — how much lands in the report {#evidence-levels}

```tflw-config
env staging
  evidence "headers-only"
```

- `full` (default) — everything: method/url/status/headers/body, screenshots and traces included.
- `headers-only` — drops the request/response body (replaced with an `[omitted by evidence
  level]` marker).
- `none` — drops headers too; only method/url/status/duration remain.

The level governs three things, not just the trace:

1. **The request/response trace**, as above.
2. **Step detail text** — a step's own line never shows what the level already dropped. A failing
   assertion at `evidence none` reads `expected body.token to equal "…", but got [omitted by
   evidence level]`: you still see *what* was compared, just not the value.
3. **Screenshots and traces — captured only at `full`.** Nothing can redact a screenshot; it is
   pixels, and a page that renders a token on screen renders it into the image. So rather than
   promise to clean them, `headers-only` and `none` don't capture them at all. A `screenshot` step
   still passes below `full`, reporting `not captured (evidence level)`; a `matches snapshot`
   assertion still runs and still tells you how many pixels differed, it just doesn't attach the
   images. The cost is real: at `evidence none` a failing browser test has no trace to open.

`--evidence <level>` overrides the config value for one run — handy for a CI job that wants
`none`-level reports by policy regardless of what any given `tflw.config` declares.

## `--forbid-insecure` — a CI policy gate

Fails **before any test runs** if `insecure true` (TLS verification disabled — see
[Config & environments](/guide/config)) is active for the env actually running. Use it in CI to
make sure a self-signed-cert workaround never silently ships as the default for a shared pipeline.

## Replaying failures — `--failed` and `--bail`

```sh
npx tflw run --failed   # re-run only what failed last time
npx tflw run --bail     # stop at the first failing test
```

`--failed` reads `report/.last-run.json` (always written, every run) and re-runs just those
tests — nothing failed last time, or no state file yet: falls back to the full suite with a note,
never a silent zero-test run. `--bail` stops after the first failing test's final verdict; under
`--parallel > 1` it stops starting new files, but files already in flight finish normally.

## Structured logs — `--format ndjson`

```sh
npx tflw run --format ndjson
```

Replaces the human console output with one JSON object per line (`RunEvent`s — `run:start`/
`test:start`/`step:end`/`test:end`/`run:end`, each tagged with its source file) — pure stdout, no
human text mixed in, safe to pipe into a log aggregator or `jq`. Always full step-level detail,
independent of `--verbose`. Also always written to `report/events.ndjson`, so the stream survives
even when the invoking process didn't capture stdout.

The file is not a byte-for-byte copy of stdout: it is written after the run, so it gets the same
final redaction pass as `report.html`/`results.json` (see [secrets](/guide/config#secrets)) with
the fully-populated redactor. The live stream can't — a line has already left the process by the time
a secret read later in the run reveals itself. **If you archive one of the two, archive the file.**

## User-defined logging — the `log` statement

```tflw
test "checkout narrates what it's doing"
  api POST /cart/checkout body { email: "shopper@example.com" }
  expect status equals 201
  capture body.orderId as orderId

  log "order {orderId} placed"
  log warn "stock for this order is running low"
  log error "payment gateway retried once before succeeding" to html
```

`log [debug|info|warn|error] "message with {var}" [to console|html|both]` narrates what a test is
doing, in the author's own words — level defaults to `info`, destination defaults to
`tflw.config`'s `log destination` key (built-in default `both`). A `log` step always succeeds; it's
author signal, never an assertion. An explicit `to …` clause always wins over both config and a
`--log-output` override — only a bare `log "…"` (no `to`) resolves against config/CLI at all.

Two `tflw.config` keys (`defaults`/`env`, override semantics like `evidence`): `log destination
"console"|"html"|"both"` and `log level "debug"|"info"|"warn"|"error"` — the minimum level a step
must clear to render. `results.json`/`--format ndjson` always record every `log` step regardless of
level or destination; only console text and `report.html` filter what's actually displayed. See
[CLI flags reference](/reference/cli#tflw-run) for `--log-output`/`--log-level`, which override
both config keys for a single run.

## Console ergonomics — timestamps, GitHub Actions grouping, `--log-file`

Every console line gets an `HH:MM:SS.mmm` prefix by default — `--no-timestamps` opts out. On
GitHub Actions (auto-detected via the `GITHUB_ACTIONS` env var), `--verbose`'s per-test step lines
fold into a collapsible `::group::`/`::endgroup::` block — normal mode is already one line per
test, so grouping only kicks in under `--verbose`. `--log-file <path>` duplicates console output to
a file, always plain text regardless of whether stdout itself has color.

## Keeping a suite current — `tflw migrate`

```sh
npx tflw migrate
```

When a piece of syntax is deprecated, the checker flags it as a warning (never silently — a
deprecation always spends at least one release as a visible warning before removal) and carries
its exact mechanical replacement. `tflw migrate` reads those warnings and rewrites every affected
file in place, then tells you to re-run `tflw check` to confirm the result is clean. Run it from
CI or a pre-upgrade script the same way you'd run `check` — it's a normal exit-0/non-zero command,
not interactive.

The grammar has been additive-only since the very first internal milestone (no existing syntax has
ever changed, only new syntax added), so today `tflw migrate` genuinely has nothing to do and
reports exactly that — `no deprecated syntax found — nothing to migrate.` — rather than pretending
there's work to review. It's real, tested machinery sitting ready for the day a deprecation
actually ships, not a stub.

Full reference: [SPEC.md §12](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#12-cli-),
[§13 (events/report)](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#13-events-report-ci-outputs-p4-5-p23-p30-).
