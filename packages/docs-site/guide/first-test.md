# Writing your first test

A `.tflw` file is a sequence of `test` blocks. A test is a name plus indented steps — no
boilerplate imports, no test-runner ceremony. (Diagnostics, autocomplete, and more are live as you
type in VS Code — see [Editor support](/editor).)

```tflw
test "health check"
  api GET /health
  expect status equals 200
```

Blocks are **indentation-delimited** — the same offside rule Python uses. `api` steps issue an
HTTP request; `expect` is a hard assertion (it stops the test on failure). `check` is its soft
twin — it records a failure and keeps going, only failing the test at the very end:

```tflw
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

```tflw-config fragment
require env ADMIN_EMAIL, ADMIN_PW

session admin
  api POST /auth/login body { email: env(ADMIN_EMAIL), password: env(ADMIN_PW) }
  expect status equals 200
  capture body.token as token
  header "Authorization" is "Bearer {token}"
```

If the response has no such header or field, the `capture` **fails** rather than binding an empty
value — otherwise every later `{name}` would carry the literal text `undefined`, and an endpoint
that shrugs at `?id=undefined` would leave you with a passing suite that checked nothing. A JSON
`null` is a real value and still captures fine.

This one goes in `tflw.config`, not the test file — sessions are project-wide. `session` blocks
like it run **once per run**, cached — a test opts in with `as admin` and
gets the session's captured headers auto-applied, no repeated login boilerplate. More on this in
[Sessions & auth](/guide/sessions).

### Chaining a captured value forward

Most real tests are a chain: create something, keep its id, use it, then assert against what the
server did with it. Each `capture` binds into the test's own scope, so a later step can interpolate
it into a path, a body, or another assertion's expected value:

```tflw
test "an order carries the product it was created from"
  api POST /products body { name: unique("Widget"), price: 9.99 }
  expect status equals 201
  capture body.id as productId

  api POST /orders body { productId: {productId}, qty: 2 }
  expect status equals 201
  capture body.id as orderId

  api GET /orders/{orderId}
  expect status equals 200
  expect body.productId equals {productId}
  expect body.total equals 19.98
```

Two things worth noticing. The last assertion compares a server-computed total against a number the
test worked out itself, which is the difference between checking that an endpoint answered and
checking that it answered *correctly*. And `{productId}` is used twice — once to build a request,
once as an expected value — because a captured name is an ordinary value and not a special
request-building thing.

## What a failure looks like

Say the API returns the unit price where the test expects a line total. Only the failing step
prints, and it prints the moment it fails:

```console
  ✗ an order carries the product it was created from (34 ms)
    ✗ expect body.total equals 19.98
      expected body.total to equal 19.98, but got 9.99

FAIL 0/1 passed, 1 failed · env local · seed 868036364 · now 2026-08-23T09:12:44.180Z · 41 ms
```

The four assertions above it passed and stayed quiet — by default a run prints one line per test and
expands only what broke. The test also **stopped** at that line: `expect` is hard, so the
`capture`-and-assert chain never continued past a response it could not trust. Had that been a
`check`, the run would have carried on and reported every other problem in the same pass.

## Data-driven cases

`with each` runs one reported case per row of an inline table:

```tflw
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

```tflw
@smoke @orders
test "pay for an order" as admin
  api POST /orders/42/pay
  expect status equals 200
```

`--tag <name>[,<name>...]` on `tflw run` filters to tests carrying any of the listed `@name`s
(comma-separated OR; combines with `--only` as AND).

Secrets (`env(NAME)`) are redacted from every report automatically — see
[CI, reporting & safety](/guide/ci-and-reporting). For what a run actually prints, `--verbose`,
isolating a failing test, and reading `report.html`, see
[Running & debugging tests](/guide/debugging).
