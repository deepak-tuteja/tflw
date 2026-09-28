# Patterns: what to write instead of an `if`

tflw has no conditionals, no loops and no boolean operators, and that is a decision rather than a
gap: a test that branches is a test whose run you have to reconstruct before you can trust its
verdict. Every time someone reaches for an `if`, a `for` or a `sleep`, the language refuses it for
that reason. This page is the list of those moments, one section each: what was asked for, why the
language says no, and the shape that works instead. Where a section says *kept true by*, the named
file in [the project tflw is tested against](https://github.com/deepak-tuteja/tflw-tests) runs that
shape on every change.

| You wanted | Write instead |
|---|---|
| [a feature behind a flag](#a-feature-behind-a-flag) | a tag, and `--tag !flag` in the job where it is off |
| [a value that differs by environment](#a-value-that-differs-by-environment) | `env(NAME)`, `require env`, a base URL that names its override |
| [to act on what the response said](#acting-on-what-the-response-said) | `capture`, and a helper when the choice needs code |
| [a test that cannot run in one environment](#a-test-that-cannot-run-in-one-environment) | `skip "why" on env ci` |
| [five requests at the same moment](#five-requests-at-the-same-moment) | `with each concurrently`, and assert the state afterwards |
| [a page that is already signed in](#signed-in-on-both-sides) | `as <session>` — the session signs the browser in |
| [every page of a list](#every-page-of-a-list) | a helper that walks the pages |
| [to wait a fixed time](#waiting-for-something-not-for-a-time) | `wait until` the condition you were waiting for |
| [to check a call your app makes outward](#a-call-your-app-makes-outward) | a helper that receives it |

## A feature behind a flag

**The ask:** *if the flag is on, check the gift message.* **Why not:** a test that checks the flag
first has two verdicts, and the report cannot say which one it gave. Tag the tests that need the
flag on, and leave them out of the jobs where it is off:

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

**The ask:** *if we are on staging, use the staging admin.* **Why not:** the suite would carry every
environment's values and pick one at run time. A value that depends on where the suite runs is an
environment variable, read with `env(NAME)`. `require env` in `tflw.config` makes a run without it
stop before the first request instead of sending an empty value, and a session is where a
credential is read once for every test that signs in:

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

**The ask:** *if the list has an item called "Office", open it.* **Why not:** there is nothing to
branch on if the value itself is carried forward. Capture it. When the choice needs code (the id of
the one item in a list whose name matches), write that code as a helper and call it:

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

## A test that cannot run in one environment

**The ask:** *if this is CI, skip the refund test — there is no payments sandbox there.* **Why
not:** a test that decides whether to run is a test that sometimes reports a pass it never earned.
Say it on the header instead, where the report can show it:

```tflw
test "refunds settle" skip "no payments sandbox in CI" on env ci
  api POST /refunds body { orderId: 7 }
  expect status equals 202
```

Under `--env ci` the test is reported skipped with its reason and the env; under every other env it
runs. The names are `env` blocks in `tflw.config`, and a name the config does not declare is
`TF088`. Checked under the env it skips, the test is not held to a service or session only another
env declares, since that is usually why it skips. See [skipping a test](/guide/ci-and-reporting#skip).
Kept true by `tests/api/identity/secure-local.tflw` and `tests/api/identity/mtls.tflw`, which run only
through the project's TLS sidecars and are skipped, with their reason, everywhere else.

## Five requests at the same moment

**The ask:** *loop five times in parallel and check only one reservation won.* **Why not:** a loop
is a branch that repeats, and a race asserted from inside the race has no order to assert. Run the
rows of a table at once, and assert what the race decided afterwards:

```tflw
with each concurrently
  | buyer   |
  | "ana"   |
  | "ben"   |
  | "chloe" |
  | "dev"   |
  | "eli"   |
test "{buyer} tries to reserve the last unit"
  api POST /reservations body { sku: "LAST-1", buyer: {buyer} }
  expect status is less than 500

test "exactly one reservation won"
  api GET /stock/LAST-1
  expect body.reserved equals 1
```

Each row is its own case in the report, and a failing row stops nothing. See [rows at
once](/guide/data-and-hooks#concurrently).

This works when each row's racing request is the whole row. A row that first needs its own setup (a
shopper to register, a cart to fill) runs that setup inside the race, so the requests that matter no
longer land together. And a value made once before the race, such as the product every row buys,
cannot be handed to the rows: `before file` runs in its own scope. The project tflw is tested
against still proves its races with a helper for both reasons, so no file there keeps this section
true yet.

## Signed in on both sides

**The ask:** *log in through the API, then open the page already logged in.* **Why not:** nothing
here needs a branch — this one used to be a limit, and is not any more. A session signs in once, and
`as <session>` hands its cookies to the test's browser, so the page opens signed in:

```tflw
test "the orders page lists my orders" as shopper
  api POST /orders body { productId: 1, qty: 1 }
  expect status equals 201
  open "/orders"
  expect text "Your orders" is visible
```

It works when the app signs in by cookie. A session that signs in with a header — a bearer token,
an API key — has nothing a browser can hold, and a page that keeps its token in `localStorage`
still signs in through its form. The API and the page must name the same host; see [a session signs
the browser in](/guide/sessions#a-session-signs-the-browser-in) for the three limits.

A fourth limit is the app's rather than tflw's. A page that sends a CSRF token its own login form
stores (in `sessionStorage`, say) opens signed in and can read, but its first write is refused. Keep
the form login for the tests that write through the page. Kept true by `tests/mixed/storefront.tflw`,
whose read-only journeys run `as shopper` and whose writing journeys still sign in through the form.

## Every page of a list

**The ask:** *keep requesting the next page until there isn't one.* **Why not:** that is a loop
whose length the response decides, and the report could not say in advance how many requests the
test makes. Following **one** cursor is ordinary — capture `nextCursor`, make one more request.
Walking **every** page is a helper's job:

```tflw
use "./helpers/paginate.ts"

test "every tagged product is reachable through the pages"
  let seen = walk all pages("spring-sale", 2)
  expect {seen} equals 5
```

The helper is where the loop lives, and what it returned is in the report as one value. Kept true by
`tests/api/catalog/product-query.tflw` and `tests/helpers/paginate.ts`.

## Waiting for something, not for a time

**The ask:** *sleep five seconds, then check the order shipped.* **Why not:** a fixed wait is too
long on a fast machine and too short on a slow one — the suite gets slower and still flakes. Wait
for the thing itself; the step polls until it is true or its budget runs out:

```tflw
test "an order ships"
  api POST /orders body { productId: 1, qty: 1 }
  capture body.id as orderId
  wait until api GET /orders/{orderId}
    expect body.status equals "shipped"
```

The budget is `timeout wait` in the config, or on the one step that needs longer. `pause 500ms`
exists for the rare case where a pause is the point — a debounce the test is about — and says so.
Kept true by `tests/api/identity/token-expiry.tflw`, which waits out a real token lifetime.

## A call your app makes outward

**The ask:** *check that placing an order sent the webhook.* **Why not:** tflw sends requests; it
does not stand up a server to receive them, because a listener is a second program running beside
the test. A helper can be that program:

```tflw
use "./helpers/webhook-receiver.ts"

test "fulfilling an order calls the webhook"
  let receiverUrl = start webhook receiver()
  api POST /orders body { productId: 1, qty: 1, webhookUrl: {receiverUrl} }
  expect status equals 201
  capture body.id as orderId
  let proof = assert webhook received(receiverUrl, "order.fulfilled", orderId, 2000)
```

The helper's call is the assertion: it throws, and the step fails, when the event does not arrive
within the time given.

A browser test that needs a third party to answer can `stub` the call instead; see [network
observation](/guide/browser-advanced#network-observation-stub-mocking). Kept true by
`tests/api/orders/order-webhooks.tflw` and `tests/helpers/webhook-receiver.ts`.
