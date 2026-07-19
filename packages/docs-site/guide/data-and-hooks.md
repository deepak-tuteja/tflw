# 7. Data-driven tests & hooks

## Hooks

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

`before file`/`after file` run once per file instead of once per test. There is no `before each`/
`after each` — `each` is exclusively a `with each` data-table keyword (below), a different job.

## Data-driven tests from a file

`with each` reads rows from a file instead of an inline table — same one-case-per-row reporting,
CSV or JSON:

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
array of objects. The inline form (`with each` followed by a `| col | ...` table) works
identically for small fixed datasets — see [Writing your first test](/guide/first-test).

Full reference: [SPEC.md §4](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#4-tests--structure-).
