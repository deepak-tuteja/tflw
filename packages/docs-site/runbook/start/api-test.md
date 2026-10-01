# 4. An API test of your own

The example's tests were written for you. This chapter writes one: a file of its own, a value
captured from one response and used in the next request, and the three commands that keep a growing
suite tidy: `fmt`, `check` and `refactor apply`.

## A file, and a value carried between requests

A `.tflw` file anywhere under the project is part of the suite. This one places orders: two check
what an order costs, and the third reads one back. `capture` takes a value out of a response and
gives it a name; `{name}` puts it into a later step. The spacing is deliberately untidy, for `fmt` to
fix below:

```sh runbook
cat > tests/my-order.tflw <<'EOF'
@functional
test "an order costs the price times the quantity"
  api POST /orders body {itemId: 1, qty: 2}
  expect status equals 201
  expect body.total   equals 2800

@functional
test "a bigger order costs more"
  api POST /orders body {itemId: 1, qty: 5}
  expect status equals 201
  expect body.total equals 7000

@functional
test "an order reads back the way it was placed"
  api POST /orders body {itemId: 1, qty: 2}
  capture body.id as order
  api GET /orders/{order}
  expect status equals 200
  expect body.qty equals 2
EOF
```

Run it:

```sh runbook
npx tflw run tests/my-order.tflw
```

```text runbook-output
09:32:10.402   ✓ an order costs the price times the quantity (11 ms)
09:32:10.406   ✓ a bigger order costs more (3 ms)
09:32:10.412   ✓ an order reads back the way it was placed (6 ms)

09:32:10.412 PASS 3/3 passed · env local · seed 6120 · now 2026-10-01T09:32:10.000Z · 26 ms
…
```

`expect` lines are the test. Each one names a part of the response (`status`, `body.total`,
`body.qty`) and what it must be. [Assertions](/guide/assertions) lists every matcher: `equals`,
`contains`, `has count`, `matches`, and the rest.

## `fmt`: one layout for every file

`tflw fmt` rewrites files to one layout, the way a code formatter does. It changes whitespace only,
never what a file means, and names each file it changed:

```sh runbook
npx tflw fmt tests/my-order.tflw
```

```text runbook-output
formatted tests/my-order.tflw
1 file, 1 formatted.
```

`npx tflw fmt --check` changes nothing and exits 1 if any file would change, which is the form for
CI.

## `check`: everything except running

`tflw check` parses and checks every file and sends no request. It is fast enough to run on every
save, and it needs none of the suite's secrets:

```sh runbook
npx tflw check
```

```text runbook-output
13 files checked, no problems found.

1 reuse hint found — apply with `tflw refactor apply <id>`:

reuse[RF001]: 2 occurrences of a similar 3-step sequence
  --> tests/my-order.tflw:3 (test "an order costs the price times the quantity")
  --> tests/my-order.tflw:9 (test "a bigger order costs more")
  = proposed: action post orders(qty, value) in shared/post-orders.tflw
  = call site: post orders(2, 2800)
  = call site: post orders(5, 7000)
  = apply: tflw refactor apply RF001
```

Besides problems, `check` looks for the same steps repeated across tests and offers to make them
one `action`. The first two tests both place an order and check its status and total, so `check`
offers to extract those three steps. That is a **hint**, with an id, and it never changes the exit
code. The third test is not offered, though it places an order too: its next step `capture`s from
that order's response, which an extracted action would keep to itself.

## `refactor apply`: take the hint

```sh runbook
npx tflw refactor apply RF001
```

```text runbook-output
applied RF001: extracted `action post orders(qty, value)` into shared/post-orders.tflw
  updated: tests/my-order.tflw
```

It wrote the repeated steps into `shared/post-orders.tflw` as an `action`, with the two values that
differed as its parameters, replaced each copy with one line calling it, and imported the new file.
The file it rewrote still passes:

```sh runbook
cat tests/my-order.tflw
npx tflw run tests/my-order.tflw
```

```text runbook-output
import "../shared/post-orders.tflw"
@functional
test "an order costs the price times the quantity"
  post orders(2, 2800)

@functional
test "a bigger order costs more"
  post orders(5, 7000)

@functional
test "an order reads back the way it was placed"
  api POST /orders body { itemId: 1, qty: 2 }
  capture body.id as order
  api GET /orders/{order}
  expect status equals 200
  expect body.qty equals 2

…
09:34:51.630 PASS 3/3 passed · env local · seed 4113 · now 2026-10-01T09:34:51.000Z · 22 ms
…
```

An `action` is the unit of reuse: steps with a name, called like a function, and able to `give` a
value back. [Actions](/guide/actions) covers writing them by hand.

## The language, from the terminal

`tflw docs` prints the language's cheatsheet, one section at a time. With no topic it lists them:

```sh runbook
npx tflw docs
```

```text runbook-output
tflw docs <topic> — print a SPEC.md cheatsheet section. Topics:
…
Assertions
…
  matchers                       Matcher table
…
run `tflw docs <topic>` to read one, e.g. `tflw docs matchers`.
the full SPEC lives at https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md.
```

And `tflw spec` lists every construct this build knows: each keyword, matcher, generator and
diagnostic code. It is the answer to *does my version have this?*:

```sh runbook
npx tflw spec
```

```text runbook-output
…
declaration:
  test
  crawl
  action
…
```

## You now have

A test file of your own, `tests/my-order.tflw`, formatted, checked and passing, calling an `action`
in `shared/` that `refactor apply` extracted from it.

## Next, or instead

- **Next:** [5. A browser test](/runbook/start/browser-test).
- Writing API tests in depth: [Functional tests](/guide/functional) and
  [Variables](/guide/variables).
- Sign-ins and acting as more than one user: [Sessions](/guide/sessions).
- Every command in this chapter, with all its flags: [`tflw fmt`](/reference/cli#tflw-fmt-paths),
  [`tflw check`](/reference/cli#tflw-check), [`tflw refactor`](/reference/cli#tflw-refactor-apply-id).
