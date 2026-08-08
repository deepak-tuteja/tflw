# 6. Actions, imports & the JS/TS escape hatch

Factor a repeated step sequence into an `action` and reuse it across files with `import`; drop
into real JS/TS with `use` when a value needs computing (hashing, signing, formatting) rather than
declaring:

```tflw
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

```tflw
import "./shared/create.tflw"
use "./helpers/label.ts"

test "reuses an action and a JS helper"
  let price = 12.5
  let widgetId = create widget("Gadget", price)
  let label = make label(widgetId, price)

  # the helper's return value is an ordinary bound value — assert on it directly
  expect {label} contains "widget"

  api POST /widgets body { name: "Gadget", price: {price}, description: {label} }
  expect status equals 201
```

Space-separated call names (`create widget(...)`, `make label(...)`) resolve to the action/export's
camelCase name (`createWidget`/`makeLabel`) under the hood.

::: tip This page used to say the opposite
Until tflw 0.2 a bound value could not stand on the left of a matcher, and this page told you to
route it through a request `body` or `header` field and assert on *that*. Don't. That workaround
made the system under test carry back a value your test already had — an extra round-trip, and a
real dependency, in order to check something local. Worse, it made the assertion pass or fail for
reasons that had nothing to do with what you were checking. Use `expect {name} …`.
:::

## Keywords never take a name away from you

**A leading keyword never reserves that word for an action name — disambiguation is always by what
follows.** `run` leads a workload clause in [load testing](/guide/load-testing), and `action run
checkout(id)` is still both declarable and callable:

```tflw
action run checkout(orderId)
  api POST /orders/{orderId}/checkout
  expect status equals 201

test "an action named after a keyword is still callable"
  run checkout("order-1")         # a call — the parser scans past the name to the `(`
```

Every keyword in tflw is a *soft* keyword, recognised by position rather than reserved by the
lexer, and this is the promise that makes that useful instead of incidental: **a keyword added in a
future release can never make an action name you already use uncallable.**

**`action`/`use` calls don't work inside `session` blocks** in `v0.1` — a session runs with an
empty call registry, so `create widget(...)` there fails with `unknown call \`create
widget(...)\` — no action (\`import\`) or JS helper (\`use\`) defines it`, even though the
identical call works in a test in the same file. Keep session bodies to plain `api` steps.

## `check` propagates as soft through an action

A `check` failing *inside* an imported action propagates back to the caller as soft — the
caller's own later steps still run, and the whole test only fails at the end, exactly as if the
`check` had been written inline.

## An action can't call itself

Not directly, and not the long way round:

```console
error[TF044]: this call completes a cycle: `retry login → retry login`
 --> login.tflw:2:3
  |
2 |   retry login()
  |   ^^^^^^^^^^^^^
  |
  = help: tflw has no conditionals, so an action that calls itself has no exit — extract
          the steps that should run once into a second action
```

Most languages let you write this and trust you to add a base case. tflw can't, because it has no
`if` — no branching construct of any kind. There is nowhere to put the base case, so a cycle here
isn't *potentially* infinite, it always is, and `tflw check` refuses it before the run rather than
letting it end in a stack overflow.

A cycle that leaves through an `import` and comes back is caught too, and reported against the call
in *your* file that hands control out — the only line here you can delete to break it:

```console
error[TF044]: this call enters a cycle: `a → b → a`
 --> checkout.tflw:4:3
  |
4 |   b()
  |   ^^^
  |
  = help: `b` is imported from "./shared/orders.tflw" and calls `a` — tflw has no
          conditionals, so an action that can reach itself has no exit; break the chain
          here or in that file
```

The check needs the imported file to be readable — if it isn't, the run's own guard still stops the
recursion at the second frame and prints the same path:

```console
✗ t (1 ms)
    action "a" failed: this call completes a cycle: `a → b → a` — an action that reaches itself never terminates
```

If you were reaching for recursion to repeat work, use `with each` over a data table
([Data & hooks](/guide/data-and-hooks)) or a `workload` ([Load testing](/guide/load-testing)) —
both loop a known number of times, which is the shape a test suite actually wants.

## Finding & extracting duplication automatically

Writing steps by hand and only extracting an `action` once you've noticed the duplication yourself
doesn't scale past a handful of files. `tflw check` also looks for near-identical step windows
*across* the whole suite and surfaces them as advisory hints (never blocking, exit 0 regardless):

```sh
npx tflw check
```

```console
hint[RF001]: 3 tests share a near-identical 4-step sequence — extract into an action?
 --> tests/checkout.tflw:12, tests/returns.tflw:8, tests/admin.tflw:21
  = help: run `tflw refactor apply RF001` to extract it automatically
```

`tflw refactor apply <id>` then does the extraction for real — writes a new shared `action` file,
rewrites every matched call site to call it, and only ever touches what it's certain is
byte-identical or safely parameterizable (a literal that differs between occurrences becomes an
action parameter; a step referencing a variable bound only in one caller's own scope is never
pulled into the shared action, since that would break at runtime). Always re-run `tflw check`/
`tflw run` after applying to confirm the rewritten suite still passes.

Full reference: [SPEC.md §8](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#8-actions-imports-element-aliases-p2-p17-18-),
[§11 (JS escape hatch)](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#11-js-escape-hatch-p11-).
