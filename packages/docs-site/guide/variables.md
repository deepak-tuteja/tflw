# 5. Variables, generators & expressions

`let` declares a variable; `{name}` interpolates it anywhere a value goes — request bodies, table
cells, expect values:

```
test "creates a widget with a random price"
  let price = random decimal 5 to 50
  api POST /widgets body { name: "Random Widget", price: {price} }
  expect status equals 201
  expect body.price equals {price}
```

## `unique` vs. `random`

Two generator families with opposite guarantees — see the
[full generator reference](/reference/generators) for every form:

- **`unique(...)`** (and `unique email`/`unique like "..."`/`unique uuid`) guarantees a
  collision-free value across the whole run, including retries — its counter keeps advancing on
  every retry attempt of the *same* test, by design, so a retried attempt never collides with data
  the failed attempt already created. That also means it **cannot** reproduce a value an earlier
  attempt used.
- **`random`** produces reproducible-under-`--seed` values for anything else. All `random` values
  derive from one run seed with per-test sub-seeds; all `today`/`now`-derived values derive from
  one run clock (the real instant, or `--now <iso>` to pin it). Anything a retry needs to reuse
  identically across its own attempts must come from `random`, never `unique`.

`tflw run --seed <s> --now <iso>` together reproduce a run's exact absolute generated values —
every generated value is shown inline at its step in the report (`qty = 100 (random)`).

## Expressions

A closed grammar, usable in `let`, fills, api bodies, table cells, expect values:

- Arithmetic on numbers: `{price} * {qty}`, `+ - * /`.
- Interpolation in strings: `"Order {orderId} for {name}"`.
- Date math: `today`, `now`, `today + 3 days`, `now - 2 hours`;
  `format {d} as "yyyy-MM-dd"` (project default format in config).
- **Hard fence:** no conditionals, no loops, no boolean operators — reach for the
  [JS escape hatch](/guide/actions) instead.

## Value transforms

```
base64 encode({value})    base64 decode({value})
hex encode({value})       url encode({value})
```

Pure transforms — unlike generators, these consume an existing value rather than manufacture a
fresh one.

Full reference: [SPEC.md §7](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#7-variables-data--expressions-p19-p21-25-).
