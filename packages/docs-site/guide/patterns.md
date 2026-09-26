# Patterns: what to write instead of an `if`

tflw has no conditionals, no loops and no boolean operators, and that is a decision rather than a
gap: a test that branches is a test whose run you have to reconstruct before you can trust its
verdict. Three things people reach for an `if` to do each have a spelling that keeps a run a
straight line. Each is kept true by a file in
[the project tflw is tested against](https://github.com/deepak-tuteja/tflw-tests), named below.

## A feature behind a flag

Do not test the flag inside the test. Tag the tests that need the flag on, and leave them out of
the jobs where it is off:

```tflw
@flag_giftMessage
test "a gift message is printed on the receipt"
  api POST /orders body { productId: 1, qty: 1, giftMessage: "happy birthday" }
  expect status equals 201
  expect body.giftMessage equals "happy birthday"
```

```sh
npx tflw run --tag !flag_giftMessage   # the job where the flag is off
```

When the flag goes away, so does the tag. Kept true by `tests/cookbook/feature-flag.tflw`, and the
exclusion itself by `scripts/verify-cli-flags.mjs`, which compares the run with and without it.

## A value that differs by environment

A value that depends on where the suite runs is an environment variable, read with `env(NAME)`.
`require env` in `tflw.config` makes a run without it stop before the first request instead of
sending an empty value, and a session is where a credential is read once for every test that
signs in:

```tflw-config fragment
require env ADMIN_EMAIL, ADMIN_PW

session admin
  api POST /auth/login body { email: env(ADMIN_EMAIL), password: env(ADMIN_PW) }
  capture body.token as token
  header "Authorization" is "Bearer {token}"
```

A URL that differs by environment belongs in the config instead, as a base URL that names the
variable overriding it — `api env API_BASE default "http://localhost:4001/v1"` — so every step
moves with `--env`. Kept true by the sessions in the project's `tflw.config`, which every
signed-in test uses.

## Acting on what the response said

When the next request depends on something the last one returned, capture it — there is nothing to
branch on if the value itself is carried forward. When the choice needs code (the id of the one
item in a list whose name matches), write that code as a helper and call it:

```tflw
use "./helpers/find-category.ts"

test "the office category has its products"
  api GET /categories
  capture body as categories
  let officeId = find category id(categories, "Office Supplies")
  api GET /products?categoryId={officeId}
  expect body has count at least 1
```

The helper is ordinary TypeScript and the test stays a straight line: what was chosen is in the
report as the value it produced. Kept true by `tests/api/catalog/large-catalog.tflw` and
`tests/helpers/find-category.ts`. See [Actions, imports & the JS/TS escape
hatch](/guide/actions) for what a helper may do.
