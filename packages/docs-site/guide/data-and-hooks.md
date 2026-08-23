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

**File-scope hooks have a scope of their own**, isolated from every test in the file. A `let` bound
in `before file` is not visible to any test:

```text
before file
  let fixtureId = create widget(unique("Fixture"), 1.00)

test "reads the shared fixture"
  api GET /widgets/{fixtureId}    # TF030 — unknown variable "fixtureId"
```

That is a checker error rather than a runtime surprise: the squiggle is on the line as you type it.

So `before file` is for **side effects** — seeding a shared fixture, a warm-up call, a health probe
— and not for values a test needs to read. When a test genuinely needs one, the two ways across are
a [`session`](/guide/sessions) block or a shared [`action`](/guide/actions) that the test calls
itself.

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

The two *labels* do not share with each other. `before file` and `after file` are two separate runs
of that scope, so a value bound in one is unreadable in the other — the same `session`/`action`
answer applies.

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
