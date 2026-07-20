# 1. Writing your first test

A `.tflw` file is a sequence of `test` blocks. A test is a name plus indented steps — no
boilerplate imports, no test-runner ceremony. (Diagnostics, autocomplete, and more are live as you
type in VS Code — see [Editor support](/editor).)

```
test "health check"
  api GET /health
  expect status equals 200
```

Blocks are **indentation-delimited** — the same offside rule Python uses. `api` steps issue an
HTTP request; `expect` is a hard assertion (it stops the test on failure). `check` is its soft
twin — it records a failure and keeps going, only failing the test at the very end:

```
test "product listing looks right"
  api GET /products
  expect status equals 200
  check body.items has count 3
  check header "content-type" contains "json"
```

House style: `expect` for flow gates (nothing downstream makes sense if this fails), `check` for
final-state audits (report everything wrong at once).

## Capturing values

`capture` pulls a value out of a response and gives it a name; later steps reference it with
`{name}` string interpolation:

```
session admin
  api POST /auth/login body { email: env(ADMIN_EMAIL), password: env(ADMIN_PW) }
  expect status equals 200
  capture body.token as token
  header "Authorization" is "Bearer {token}"
```

`session` blocks like this one run **once per run**, cached — a test opts in with `as admin` and
gets the session's captured headers auto-applied, no repeated login boilerplate. More on this in
[Sessions & auth](/guide/sessions).

## Data-driven cases

`with each` runs one reported case per row of an inline table:

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

Each row shows up as its own pass/fail line in the report — not one aggregate assertion for the
whole loop. `retry N` re-runs a failing test up to `N` more times; a pass on a later attempt is
reported passed-but-flagged-`flaky`, never silently green. See
[Data-driven tests & hooks](/guide/data-and-hooks) and
[Retry, polling & flaky handling](/guide/retry-and-polling) for the full story.

## Tags and running a subset

```
@smoke @orders
test "pay for an order" as admin
  ...
```

`--tag <name>[,<name>...]` on `tflw run` filters to tests carrying any of the listed `@name`s
(comma-separated OR; combines with `--only` as AND).

Secrets (`env(NAME)`) are redacted from every report automatically — see
[CI, reporting & safety](/guide/ci-and-reporting).
