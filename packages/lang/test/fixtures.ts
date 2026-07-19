// Shared source fixtures for the golden tests. Valid ones exercise the whole M0 grammar;
// invalid ones each target one diagnostic. Kept as data so both the AST and error suites can
// iterate them. Every valid fixture must parse with zero diagnostics.

export interface Fixture {
  readonly name: string;
  readonly source: string;
}

export const VALID: readonly Fixture[] = [
  {
    name: 'minimal-get',
    source: `test "health is ok"
  api GET /health
  expect status equals 200
`,
  },
  {
    name: 'post-with-body-and-capture',
    source: `@smoke @orders
test "create an order" as admin
  api POST /orders body { name: "Widget", qty: 3, active: true, meta: null }
  expect status equals 201
  capture body.id as orderId
  api GET /orders/{orderId}
  expect body.name equals "Widget"
  expect body.items[0].price is less than 100
`,
  },
  {
    name: 'multi-session',
    source: `@smoke
test "an order visible to both admin and the shopper" as admin, shopper
  api GET /orders
  expect status equals 200
`,
  },
  {
    name: 'subjects-and-matchers',
    source: `test "assorted assertions"
  api GET /orders?state=open
  expect status is less than 400
  expect duration is less than 500
  expect header "content-type" matches "json"
  expect body.items has count 3
  expect body.message contains "ok"
  expect body.error not equals "boom"
  expect body has count 0
`,
  },
  {
    name: 'subset-matcher',
    source: `test "structural error-shape check"
  api GET /orders/does-not-exist
  expect status equals 404
  expect body matches subset { type: "about:blank", title: "Not Found", status: 404 }
  expect body not matches subset { title: "Something Else" }
`,
  },
  {
    name: 'let-and-interpolation',
    source: `test "uses variables"
  let name = "Widget"
  let qty = 5
  api POST /orders body { label: "order for {name}", quantity: {qty}, nested: { a: 1, b: [1, 2, 3] } }
  expect status equals 201
`,
  },
  {
    name: 'named-service',
    source: `test "hits the billing service"
  api billing GET /invoices/{invoiceId}
  expect status equals 200
`,
  },
  {
    name: 'per-step-headers-and-env',
    source: `test "admin creates a product"
  api POST /auth/login body { email: env(ADMIN_EMAIL), password: env(ADMIN_PW) }
  expect status equals 200
  capture body.token as token
  api POST /products body { name: "Widget", price: 9.99 }
    header "Authorization" is "Bearer {token}"
    header "X-Trace" is "abc"
  expect status equals 201
`,
  },
  {
    name: 'm2-methods-and-redirects',
    source: `test "full verb set, timeout, and redirect control"
  api PUT /orders/{orderId} body { qty: 4 } timeout 2s
  expect status equals 200
  api PATCH /orders/{orderId} body { qty: 5 }
  expect status equals 200
  api DELETE /orders/{orderId}
  expect status equals 204
  api GET /old-path without redirects
  expect status equals 301
  expect duration is less than 500ms
`,
  },
  {
    name: 'm2-body-forms',
    source: `test "every request body form"
  api POST /orders body from "./payloads/order.json"
  expect status equals 201
  api POST /login form user="admin", pass=env(ADMIN_PW)
  expect status equals 200
  api POST /uploads upload "./files/img.png" as "avatar" form owner="bob"
  expect status equals 201
  api POST /webhooks body text "plain payload"
  expect status equals 202
`,
  },
  {
    name: 'm2-quantifiers',
    source: `test "any and all over array bodies"
  api GET /orders
  expect any body.items.name equals "Widget"
  expect all body.items.status equals "active"
  expect any body.tags equals "urgent"
`,
  },
  {
    name: 'm2-wait-until-api',
    source: `test "polls until the order ships"
  api POST /orders body { qty: 1 }
  expect status equals 201
  capture body.id as orderId
  wait until api GET /orders/{orderId}
    expect body.status equals "shipped"
    expect status equals 200
`,
  },
  {
    name: 'wait-until-headers',
    source: `test "polls an endpoint that needs a per-step auth header" as admin
  wait until api GET /jobs/{jobId}
    header "Authorization" is "Bearer {token}"
    header "X-Test-NS" is env(TEST_NS)
    expect body.status equals "done"
`,
  },
  {
    name: 'm2-arithmetic',
    source: `test "arithmetic value expressions"
  let price = 10
  let qty = 3
  let total = {price} * {qty}
  let diff = 10 - 3
  let ratio = {price} / {qty}
  let negative = -5
  let sum = {price} + {qty} * 2
  api POST /orders body { total: {total}, doubled: {price} * 2, items: [{price}, {qty} + 1] }
  expect status equals 201
  expect body.total equals {price} * {qty}
`,
  },
  {
    name: 'm2-date-math',
    source: `test "date math and formatting"
  let today2 = today
  let now2 = now
  let shipDate = format today + 3 days as "yyyy-MM-dd"
  let deadline = format now - 2 hours as "yyyy-MM-dd HH:mm"
  api POST /orders body { shipDate: {shipDate} }
  expect status equals 201
`,
  },
  {
    name: 'm2-generators',
    source: `test "unique and random generators"
  let sku = unique like "ORD-######"
  let email = unique email
  let seq = unique number
  let id = unique("order")
  let uid = unique uuid
  let qty = random number 1 to 100
  let price = random decimal 1.5 to 9.99
  let color = random of "red", "blue", "green"
  let token = random string 12
  let code = random like "SKU-####-??"
  let past = random date in past
  let future = random date in future
  let between = random date between today and today + 7 days
  let rid = random uuid
  let pw = random password
  let pw16 = random password 16
  let creds = base64 encode("{email}:{pw}")
  let decoded = base64 decode(creds)
  let hexed = hex encode(sku)
  let unhexed = hex decode(hexed)
  let urled = url encode(email)
  let unurled = url decode(urled)
  api POST /orders body { sku: {sku}, email: {email}, qty: {qty} }
  expect status equals 201
`,
  },
  {
    name: 'm2-actions',
    source: `action create order(name, qty)
  api POST /orders body { name: {name}, qty: {qty} }
  expect status equals 201
  capture body.id as id
  give id

test "checkout composes an action"
  let orderId = create order("Widget", 3)
  api GET /orders/{orderId}
  expect status equals 200
`,
  },
  {
    name: 'm2-import-use',
    source: `import "./shared/orders.tflw"
use "./helpers/sign.ts"

test "uses an imported action and a JS helper"
  let orderId = create order("Widget", 3)
  let sig = sign payload({orderId})
  api POST /webhooks body { orderId: {orderId}, sig: {sig} }
  expect status equals 200
`,
  },
  {
    name: 'm2.5-check-soft-assert',
    source: `test "audits a full profile without stopping at the first mismatch"
  api GET /profile
  expect status equals 200
  check body.name equals "Widget"
  check body.email equals "widget@example.com"
  check body.active equals true
`,
  },
  {
    name: 'm2.5-hooks',
    source: `before file
  api POST /seed
  expect status equals 201
  capture body.token as fileToken

before
  let orderId = unique("order")

test "creates and checks an order"
  api POST /orders body { id: {orderId} }
  expect status equals 201

after
  api DELETE /orders/{orderId}
  expect status equals 200

after file
  api POST /cleanup
  expect status equals 200
`,
  },
  {
    name: 'm2.5-retry',
    source: `test "flaky endpoint" as admin retry 2
  api GET /flaky
  expect status equals 200
`,
  },
  {
    name: 'm2.5-data-table-inline',
    source: `@smoke
with each
  | role    | email        |
  | "admin" | unique email |
  | "guest" | unique email |
test "invite {role}"
  api POST /invites body { role: {role}, email: {email} }
  expect status equals 201
`,
  },
  {
    name: 'm2.5-data-table-file',
    source: `with each from "./data/invites.csv"
test "invite {role}"
  api POST /invites body { role: {role}, email: {email} }
  expect status equals 201
`,
  },
  {
    name: 'm2.65-body-text-subject',
    source: `test "asserts on a non-JSON response"
  api GET /health.txt
  expect body text equals "ok"
  expect body text contains "healthy"
  capture body text as raw
`,
  },
  {
    name: 'm2.6-multiline-body',
    source: `test "creates a booking"
  api POST /booking body {
    firstname: "Jim",
    lastname: "Brown",
    bookingdates: {
      checkin: "2026-01-01",
      checkout: "2026-01-05"
    },
    tags: [
      "vip",
      "early-checkin"
    ]
  }
  expect status equals 200
`,
  },
  {
    name: 'm2.66-nested-object-string-key',
    source: `# decision 63: a nested object/array literal may use a quoted string key, not just a bare ident
test "nested object literal with a quoted string key"
  api POST /widgets body { user: { "name": "Widget", "qty": 3 }, tags: [ { "id": 1 }, { "id": 2 } ] }
  expect status equals 201
`,
  },
  {
    name: 'contract-schema-matcher',
    source: `# PLAN decision 102a, enterprise arc cluster 3, closes TFLW-GAPS.md gap #6
test "product response matches its documented schema"
  api GET /products/{productId}
  expect body matches schema "ProductResponseDto" from "/openapi.json"
  expect body not matches schema "OrderResponseDto" from "/openapi.json"
`,
  },
  {
    name: 'retry-honoring-retry-after',
    source: `# PLAN decision 102b, enterprise arc cluster 3, closes TFLW-GAPS.md gap #5
test "rate-limited create honors Retry-After"
  api POST /retry-demo body { key: "abc" }
    header "Authorization" is "Bearer {token}"
    retry honoring "Retry-After" up to 3
  expect status equals 200
`,
  },
];

// Config-dialect fixtures (tflw.config). Valid ones parse + check clean; invalid ones each
// target one config diagnostic.
export const CONFIG_VALID: readonly Fixture[] = [
  {
    name: 'defaults-and-envs',
    source: `defaults
  header "Accept" is "application/json"
  timeout step 10s, expect 5s, wait 30s
  workers 4
  report "./report"

env local default
  web "http://localhost:5173"
  api "http://localhost:3001"

env staging
  api "https://stg.example.com/api"
  api billing "https://billing-stg.example.com"
  timeout wait 60s

require env ADMIN_EMAIL, ADMIN_PW
`,
  },
  {
    name: 'session-block',
    source: `env local default
  api "http://localhost:3001"

session admin
  api POST /auth/login body { user: env(ADMIN_EMAIL), pass: env(ADMIN_PW) }
  capture body.token as token
  header "Authorization" is "Bearer {token}"

require env ADMIN_EMAIL, ADMIN_PW
`,
  },
  {
    name: 'insecure-key',
    source: `defaults
  insecure true

env staging
  api "https://staging.example.com"
  insecure false
`,
  },
  {
    name: 'session-oauth2',
    source: `env local default
  api "http://localhost:3001"

session admin oauth2
  token url "http://localhost:3001/oauth/token"
  client id env(CLIENT_ID)
  client secret env(CLIENT_SECRET)
  scope "read write"

require env CLIENT_ID, CLIENT_SECRET
`,
  },
  {
    name: 'cert-key-pair',
    source: `env staging
  api "https://staging.example.com"
  cert "./certs/client.pem"
  key "./certs/client.key"
`,
  },
  {
    name: 'allow-hosts',
    source: `defaults
  allow hosts "api.example.com", "*.staging.example.com"

env staging
  api "https://staging.example.com"
  allow hosts "billing-staging.example.com"
`,
  },
  {
    name: 'evidence-level',
    source: `defaults
  evidence "full"

env staging
  api "https://staging.example.com"
  evidence "headers-only"
`,
  },
  {
    name: 'redact-fields',
    source: `env staging
  api "https://staging.example.com"
  redact body.email, body.*.address
`,
  },
];

export const CONFIG_INVALID: readonly Fixture[] = [
  {
    name: 'unknown-config-key',
    source: `defaults
  headr "Accept" is "application/json"
`,
  },
  {
    name: 'test-in-config',
    source: `env local default
  api "http://localhost:3001"

test "not allowed here"
  api GET /health
`,
  },
  {
    name: 'web-in-defaults',
    source: `defaults
  web "http://localhost:5173"
`,
  },
  {
    name: 'two-default-envs',
    source: `env a default
  api "http://localhost:3001"

env b default
  api "http://localhost:3002"
`,
  },
  {
    name: 'duplicate-session',
    source: `env local default
  api "http://localhost:3001"

session admin
  api GET /health

session admin
  api GET /health
`,
  },
  {
    name: 'insecure-bad-value',
    source: `defaults
  insecure yes
`,
  },
  {
    name: 'oauth2-missing-client-secret',
    source: `env local default
  api "http://localhost:3001"

session admin oauth2
  token url "http://localhost:3001/oauth/token"
  client id env(CLIENT_ID)
`,
  },
  {
    name: 'oauth2-unknown-field',
    source: `env local default
  api "http://localhost:3001"

session admin oauth2
  token url "http://localhost:3001/oauth/token"
  client id env(CLIENT_ID)
  client secret env(CLIENT_SECRET)
  grant_type "client_credentials"
`,
  },
  {
    // Regression for a real hang/OOM bug (found 2026-07-18 dogfooding testFlow-tests M22):
    // `require env`'s comma list has no line-continuation support, so a trailing comma before the
    // newline left the parser's top-level `parseConfig()` loop stuck on the continuation line's
    // orphaned `dedent` forever — `synchronize()` won't cross a `dedent` it's already sitting on,
    // and this loop (alone among the file's recovery loops) had no fallback `advance()`. This
    // fixture must terminate with diagnostics, not hang; the second `env` block below proves
    // recovery actually resumes normal parsing afterward, not just that the loop exits.
    name: 'require-env-trailing-comma-continuation',
    source: `env local default
  api "http://localhost:3001"

require env ADMIN_EMAIL, ADMIN_PW,
  USER_A_EMAIL, USER_A_PW

env staging
  api "https://staging.example.com"
`,
  },
  {
    name: 'allow-hosts-missing-hosts-keyword',
    source: `defaults
  allow "api.example.com"
`,
  },
  {
    name: 'evidence-bad-value',
    source: `defaults
  evidence "verbose"
`,
  },
  {
    name: 'redact-missing-path',
    source: `env staging
  api "https://staging.example.com"
  redact body
`,
  },
];

export const INVALID: readonly Fixture[] = [
  {
    name: 'misspelled-step',
    source: `test "typo in a step"
  expct status equals 200
`,
  },
  {
    name: 'trailing-comma-session-list',
    source: `test "dangling comma in as list" as admin,
  api GET /health
`,
  },
  {
    name: 'unknown-method',
    source: `test "bad verb"
  api FETCH /health
  expect status equals 200
`,
  },
  {
    name: 'unknown-matcher',
    source: `test "bad matcher"
  api GET /health
  expect status eq 200
`,
  },
  {
    name: 'unknown-subject',
    source: `test "bad subject"
  api GET /health
  expect statuss equals 200
`,
  },
  {
    name: 'missing-path',
    source: `test "no path"
  api GET
  expect status equals 200
`,
  },
  {
    name: 'unterminated-string',
    source: `test "open string
  api GET /health
`,
  },
  {
    name: 'empty-test',
    source: `test "nothing here"
`,
  },
  {
    name: 'top-level-junk',
    source: `expect status equals 200
`,
  },
  {
    name: 'recovers-and-continues',
    source: `test "two errors, both reported"
  expct status equals 200
  api GET /health
  expect status blergh 200
`,
  },
  {
    name: 'quantifier-on-non-body-subject',
    source: `test "any only applies to body"
  api GET /health
  expect any status equals 200
`,
  },
  {
    name: 'wait-until-headers-only-no-expect',
    source: `test "headers but no condition to wait for"
  wait until api GET /jobs/{jobId}
    header "Authorization" is "Bearer {token}"
`,
  },
  {
    name: 'random-number-missing-to',
    source: `test "random number needs a range"
  let bad = random number 1
`,
  },
  {
    name: 'transform-missing-direction',
    source: `test "base64 needs encode or decode"
  let bad = base64("hi")
`,
  },
  {
    name: 'unique-password-unsupported',
    source: `test "no unique variant for password"
  let bad = unique password
`,
  },
  {
    name: 'multi-word-call-missing-parens',
    source: `test "forgot the parens"
  let bad = create order
`,
  },
  {
    name: 'action-missing-name',
    source: `action (x)
  give x
`,
  },
  {
    name: 'hook-missing-block',
    source: `before file

test "unaffected"
  api GET /health
  expect status equals 200
`,
  },
  {
    name: 'data-table-row-mismatch',
    source: `with each
  | role    | email        |
  | "admin" | unique email | "extra" |
test "invite {role}"
  api GET /health
`,
  },
  {
    name: 'schema-matcher-missing-from',
    source: `test "forgot the source"
  api GET /health
  expect body matches schema "Widget"
`,
  },
  {
    name: 'retry-honoring-unknown-header',
    source: `test "only Retry-After is supported"
  api GET /health
    retry honoring "X-RateLimit-Reset" up to 3
`,
  },
  {
    name: 'retry-honoring-missing-up-to',
    source: `test "forgot up to"
  api GET /health
    retry honoring "Retry-After" 3
`,
  },
];
