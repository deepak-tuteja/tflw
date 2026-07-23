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

  api POST /widgets body { name: "Gadget", price: {price}, description: {label} }
  expect status equals 201
  expect body.description contains "widget"
```

A JS helper's return value isn't itself an assertion subject — route it through a request `body`
(or `header`) field and assert on that, same as any other captured value. Space-separated call
names (`create widget(...)`, `make label(...)`) resolve to the action/export's camelCase name
(`createWidget`/`makeLabel`) under the hood.

**`action`/`use` calls don't work inside `session` blocks** in `v0.1` — a session runs with an
empty call registry, so `create widget(...)` there fails with `unknown call \`create
widget(...)\` — no action (\`import\`) or JS helper (\`use\`) defines it`, even though the
identical call works in a test in the same file. Keep session bodies to plain `api` steps.

## `check` propagates as soft through an action

A `check` failing *inside* an imported action propagates back to the caller as soft — the
caller's own later steps still run, and the whole test only fails at the end, exactly as if the
`check` had been written inline.

Full reference: [SPEC.md §8](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#8-actions-imports-element-aliases-p2-p17-18-),
[§11 (JS escape hatch)](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#11-js-escape-hatch-p11-).
