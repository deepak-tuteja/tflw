# Data-driven tests & hooks

Two features that get used together constantly: a hook puts data in place around a test, and a data
table runs the same test once per set of it.

## The four hooks

| hook | runs |
| --- | --- |
| `before file` | once, before the file's first test |
| `before` | before every test in the file |
| `after` | after every test |
| `after file` | once, after the file's last test |

`before`/`after` are the **each-scope** pair, and they share the scope of the test they wrap — seed
data in `before`, clean it up in `after`, no manual plumbing between them:

```tflw
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

There is no `before each`/`after each`. `before`/`after` **are** the each-scope hooks, and `each` is
exclusively a `with each` keyword (below), a different job.

## What a hook can hand to a test

Worth learning before you write your first `before file`, because the two pairs differ in exactly
one way and only one of them can hand a value to a test.

**Each-scope hooks share the test's scope.** `widgetId` above is bound in `before`, read in the test
body, and read again in `after` — one scope, three places, which is the whole reason the pattern
above needs no plumbing.

**File-scope hooks share what they make, read-only.** A `let` or a `capture` in `before file` is
readable by every test in the file, by every row of a table, by the each-scope hooks and by
`after file` — made once, before anything else runs:

```tflw
before file
  api POST /widgets body { name: unique("Fixture"), price: 1.00 }
  expect status equals 201
  capture body.id as fixtureId

test "reads the shared fixture"
  api GET /widgets/{fixtureId}
  expect status equals 200

after file
  api DELETE /widgets/{fixtureId}
```

Read-only means what it says: a test that binds `fixtureId` again — a `let`, a `capture`, a table
column of that name — is `TF091`, because the name would then mean two things depending on where it
was read. Each test starts from its own copy of the shared values, so nothing a test binds reaches
another test.

A shared value is the right tool for **one thing many tests look at** — a fixture, a coupon a race is
run over, the product whose stock it drains. Data a test changes still belongs to that test: each
test building its own is what keeps the file runnable in any order, and in parallel.

### Two hooks with the same label

Several hooks of one label are allowed. They run in declaration order and **share one scope**, so a
`let` in the first `before file` is readable in the second:

```tflw
before file
  let region = "eu-west"

before file
  api POST /warmup body { region: {region} }
  expect status equals 200

test "the suite is warm"
  api GET /health
  expect status equals 200
```

`after file` starts from what `before file` made and binds into its own scope, so it can clean up
the shared fixture by its id, and never sees what a test bound.

## Data-driven tests

`with each` runs **one reported case per row** — its own pass/fail line in the report, not one
aggregate assertion for the whole loop. The inline table is introduced in
[Writing your first test](/guide/first-test); what follows is what the table itself can hold.

**Cells take the full value grammar, not just literals.** A generator in a cell is evaluated once
per row, at that case's start — so the two rows below get two different addresses, not one shared
one:

```tflw
with each
  | role    | email        |
  | "admin" | unique email |
  | "guest" | unique email |
test "invite a {role}"
  api POST /invites body { role: {role}, email: {email} }
  expect status equals 201
```

Column names interpolate into the **test name** as well as into its steps, which is what makes each
row legible as its own line in the report.

**Column names are unique within a header** (`TF072`). A repeated `| name |` binds once, so every
cell under the earlier column would be read and thrown away — silently, with the test still passing.
The caret lands on the second occurrence, because that is the one to rename.

## Rows at once — `with each concurrently` {#concurrently}

Some questions are only asked by several requests at the same time: two buyers reserving the last
unit, five refunds against one order, ten logins racing one rate limit. `concurrently` on the table
runs its rows at once instead of one after another:

```tflw
with each concurrently
  | buyer   |
  | "ana"   |
  | "ben"   |
  | "chloe" |
test "{buyer} tries to reserve the last unit"
  api POST /reservations body { sku: "LAST-1", buyer: {buyer} }
  expect status is less than 500

test "exactly one reservation won"
  api GET /stock/LAST-1
  expect body.reserved equals 1
```

Each row accepts either answer — a `201` for the winner, a `409` for the others — because which row
wins is the race. Each row is still its own case with its own hooks and its own line in the report,
in row order. A row that fails stops nothing — the others run to their end. What the rows raced over
is asserted **afterwards**, as state: the test below the table reads the one number the race
decides. A table of one row marked `concurrently` is `TF090`, because nothing runs beside it.

`concurrently` is about a table's rows. `parallel` on a test header runs neighbouring *tests* beside
each other, and `--parallel N` runs *files*.

### Meeting before the race — `together` {#together}

A row often needs its own setup before the request that races — its own shopper, its own cart. That
setup takes a different time on every row, so the racing requests would leave one setup apart and a
server that is not atomic would usually pass. `together` is where the rows wait for one another:

```tflw
before file
  api POST /coupons body { code: unique("RACE"), usageLimit: 1 }
  capture body.code as coupon

with each concurrently
  | shopper |
  | "a"     |
  | "b"     |
  | "c"     |
test "{shopper} redeems the last use"
  api POST /cart/items body { sku: "A-1" }
  together
  api POST /cart/checkout body { couponCode: "{coupon}" }

test "the coupon was used once"
  api GET /coupons/{coupon}
  expect body.used equals 1
```

Every row runs up to `together`, waits until each row still running has reached it, then all go on
at once. A row whose setup fails no longer holds the others, and the step says how many rows went on
together. The coupon is made once in `before file`, so every row and the test after the race name the
same one. `together` belongs at the top level of a `with each concurrently` test; anywhere else it
is `TF092`, because there are no rows to meet.

## Rows from a file

`with each from` reads rows from a file instead — same one-case-per-row reporting, CSV or JSON:

```csv
# data/widgets.csv
name,price
"Widget, Standard",9.99
Widget Pro,19.99
```

```tflw
with each from "./data/widgets.csv"
test "creates {name} from a CSV row"
  api POST /widgets body { name: {name}, price: {price} }
  expect status equals 201
  expect body.price equals {price}
```

`with each from "…" concurrently` runs a file's rows at once, the same way.

Numeric-looking cells (`price` above) are coerced to real numbers, which is what lets
`expect body.price equals {price}` compare against a JSON number rather than a string — and it
matches what a `.json`-backed table would have bound natively. Quoted fields carry embedded commas
and `""`-escaped quotes (minimal RFC-4180). `.json` rows work the same way, as an array of objects.

### What the checker catches, and what the run catches

The split is worth knowing because a file-backed table is checked less than an inline one, and
deliberately so.

- **A missing file is a warning** (`TF043`), not an error. The table is read when the test runs, so
  a hook or a build step may still produce it — predicting otherwise made valid suites unrunnable.
- **Columns are not checked at all.** Unlike the inline form they are not known until the file is
  read, and a warning about a missing file does not read it. So a misspelled column is the **run's**
  message instead — ``unknown table column "nmae" … did you mean `name`?`` — because by then the
  row is loaded and its real columns are known.
- **Every row's cell count is validated against the header**, at run time, naming the row number and
  both counts. A short or long row is never silently padded or truncated.

Full reference: [SPEC.md §4](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#4-tests--structure-).
