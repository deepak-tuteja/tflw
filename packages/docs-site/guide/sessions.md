# Sessions & auth

`session <name>` is tflw's single auth concept — there's no separate "auth preset". A session's
steps run **once per run per worker**, cached, and a test opts in to reuse the result.

Sessions are declared in **`tflw.config`**, alongside `env` and `defaults` — one login shared by
every test file in the project, not re-declared per file:

```tflw-config fragment
session admin
  api POST /auth/login body { user: env(ADMIN_USER), pass: env(ADMIN_PW) }
  capture body.token as token
  header "Authorization" is "Bearer {token}"
```

Any test in any `.tflw` file then opts in by name:

```tflw
test "admin can list orders" as admin
  api GET /orders
  expect status equals 200
```

A test can opt into more than one independent session at once (`as admin, userA`) — each
session's headers and cookie jar fold into the test's starting state in listed order, a later
session winning any header/cookie-name conflict against an earlier one.

::: warning A session does not log the browser in
`as admin` applies to a test's **`api`** steps — its headers and its cookie jar. It does not touch
the fresh browser context the test gets, so a page opened with `open "/orders"` is logged out.

A cookie jar and a browser context's storage state are two separate representations, and tflw
deliberately never bridges them. A mixed UI+API test establishes identity twice: the session for
the api steps, a UI form login for the page.
:::

## Cookie jar, automatically

Every scope that runs `api` steps — a session's own run, each test's own attempt — has its own
cookie jar with no new syntax. Every `Set-Cookie` a response carries is tracked (`Max-Age`/
`Expires` honored) and auto-attached to subsequent requests in the same scope. A test opting into
`as <session>` starts with a **clone** of that session's jar — its own updates never leak back
into the shared session cache or a concurrent sibling test under `--parallel N>1`.

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

```tflw-config fragment
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

## `privileged` — a principal that is meant to reach other people's data

```tflw-config fragment
session admin privileged
  api POST /auth/login body { email: env(ADMIN_EMAIL), password: env(ADMIN_PW) }
  capture body.token as token
  header "Authorization" is "Bearer {token}"
```

One keyword, read by one feature: `expect response has no authorization violations`
([authorization testing](/guide/authorization-testing)) leaves a `privileged` session out of its
probe set, because an admin reading somebody else's order is the system working. It changes nothing
else — a `privileged` session establishes, caches and applies its headers exactly as any other does.

It goes **after** `oauth2` when both are present (`session svc oauth2 privileged`), and it is a
claim about authority rather than a way to make an assertion cheaper: marking every session
privileged is refused (`TF063`).

## `csrf from … send as header` — a token that travels with the credential

An application that issues a CSRF token on login expects it back on every state-changing request.
`header "X-CSRF-Token" is "{token}"` would be the obvious move and is the wrong one: a `header` step
attaches unconditionally, including to the `GET`s a browser would never send a token on, and an
application may reject a token that arrives where it should not. So the token gets its own channel:

```tflw-config fragment
session shopper
  api POST /auth/login body { user: env(SHOPPER_USER), pass: env(SHOPPER_PW) }
  csrf from body.csrfToken send as header "X-CSRF-Token"
```

The clause captures the token this credential was issued and attaches it to **every mutating
request that credential later makes** — `POST`, `PUT`, `PATCH`, `DELETE`, and any method not on the
safe list (`GET`/`HEAD`/`OPTIONS`). Ordinary `api` steps and security probes alike.

The subject is whatever `capture` can read, so `body.csrfToken` and
`response.headers["X-CSRF-Token"]` both work. It has to sit **after** the session's first `api`
step — the establishment response must exist before anything can be read out of it, and placing it
first is `TF039`, exactly as a premature `capture` is.

**It is a property of the credential, not of the target.** One target has many principals with
different tokens; one principal has one. That is the same reasoning that has `shopper` and
`shopperBearer` declared as two sessions for one human.

Three things it does deliberately loudly:

- **If the path resolves to nothing, the session fails** — and every test naming it fails with it.
  Binding nothing would attach the literal text `undefined` as the token, which an application
  rejects for the right reason by accident: a broken clause that reads as a working CSRF defence.
- **The token is redacted in report evidence unconditionally**, with no `redact` pattern needed. It
  is a credential by construction, so there is no configuration under which printing it is wanted.
- **It is config-only.** The clause has no meaning in a `.tflw` test body and is not part of that
  dialect's grammar; written there it is an unknown step. It is also unavailable on an `oauth2`
  session — that body is a fixed shape with no position for it, and a bearer credential sends no
  cookie for a CSRF token to protect.

It also unlocks a finding. Once the engine can *supply* the token it can also **withhold** it, so
whether a mutating request still succeeds without one becomes `sec/csrf-not-enforced` rather than a
blind spot — see [authorization testing](/guide/authorization-testing#cookie-sessions-and-csrf) for
the probe that reads it.

## `for env` — a session that belongs to some envs and not others

```tflw-config
env plaintext default
  api "http://localhost:4001"
  api adminConsole "http://localhost:8091"

env staging
  api "https://stg.example.com"
  api adminConsole "https://console.stg.example.com"

env offeringTls
  api "https://localhost:8445"

session console for env plaintext, staging
  api adminConsole POST /login form email=env(ADMIN_EMAIL), password=env(ADMIN_PW)
```

A whole config rather than a fragment, because the clause is only meaningful against the envs it
names — and `offeringTls` is the point of the example: it declares no `adminConsole`, and before this
clause existed it would have had to, purely so the session below it could resolve.

Without the clause a session belongs to **every** env, which is what every session on this page
does. The clause only narrows.

Reach for it when a session authenticates against an origin only some of your envs have. A session
body names services (`api adminConsole …`) and services are declared per env, so a session with no
scope has to resolve under every env you declare — including the ones that never touch that origin.
Before this clause existed the only way through was to copy the service into every `env` block, and
because declaring a service brings `allow hosts` and `authorized target` along with it, a
single-origin login could pull three declarations into four envs.

Under an env the session is not scoped to it simply does not exist: nothing in its body is checked
against that env's services, it joins no authorization probe set, and a test that opts into it with
`as console` is refused with a message naming the envs where it does exist. An env name your config
does not declare is refused too (`TF074`) — a `for env` clause with a typo in it would otherwise
scope the session to nothing at all, which reads as a suite that is quietly one identity short
rather than as a mistake.

When a session carries modifiers as well, the scope comes first: `session admin for env local oauth2
privileged`.

::: tip `env` here means an `env` block
Not the operating-system variable that `require env` and `env(NAME)` read. tflw uses the word for
both, and this clause follows `env <name>`, `--env` and `TFLW_ENV`.
:::

Full reference: [SPEC.md §3.3](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#33-session-blocks--the-single-auth-concept-p20-p31-),
[§3.6 (mTLS)](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#36-client-certificates--mtls-p99b-).
