# 3. Sessions & auth

`session <name>` is tflw's single auth concept — there's no separate "auth preset". A session's
steps run **once per run per worker**, cached, and a test opts in to reuse the result:

```
session admin
  api POST /auth/login body { user: env(ADMIN_USER), pass: env(ADMIN_PW) }
  capture body.token as token
  header "Authorization" is "Bearer {token}"

test "admin can list orders" as admin
  api GET /orders
  expect status equals 200
```

A test can opt into more than one independent session at once (`as admin, userA`) — each
session's headers and cookie jar fold into the test's starting state in listed order, a later
session winning any header/cookie-name conflict against an earlier one.

## Cookie jar, automatically

Every scope that runs `api` steps — a session's own run, each test's own attempt — has its own
cookie jar with no new syntax. Every `Set-Cookie` a response carries is tracked (`Max-Age`/
`Expires` honored) and auto-attached to subsequent requests in the same scope. A test opting into
`as <session>` starts with a **clone** of that session's jar — its own updates never leak back
into the shared session cache or a concurrent sibling test under `--workers N>1`.

## Refresh on 401 + TTL expiry

A session isn't cached forever. Two independent mechanisms cover the two ways a real credential
goes stale:

- **Reactive:** if a test's request comes back `401` and the test opted into a session, the
  runtime re-establishes it and retries the original request exactly once — bounded, so a
  permanently-bad credential fails clearly instead of looping. The re-establish shows up in
  `report.html` as its own evidence steps.
- **Proactive:** a session that knows its own TTL (currently `oauth2` sessions, via `expires_in`)
  re-establishes ahead of time once the run clock passes that deadline, without waiting for a
  `401`.

## `oauth2` session sugar

For the common client-credentials shape, skip the hand-written login steps:

```tflw-config
session billing oauth2
  token url env(BILLING_TOKEN_URL)
  client id env(BILLING_CLIENT_ID)
  client secret env(BILLING_CLIENT_SECRET)
  scope "billing.read billing.write"
```

Posts a standard `client_credentials` grant, applies `access_token` as
`Authorization: Bearer <token>`, and — if the response includes `expires_in` — sets the session's
TTL from it (with a small safety margin so a request right at the boundary refreshes proactively
instead of racing a live `401`). `client secret` is redacted in report evidence exactly like any
other `env(...)`-sourced secret. A session block is either `oauth2` sugar or a hand-written
sequence of steps, never both.

Full reference: [SPEC.md §3.3](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#33-session-blocks--the-single-auth-concept-p20-p31-),
[§3.6 (mTLS)](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#36-client-certificates--mtls-plan-decision-99b-).
