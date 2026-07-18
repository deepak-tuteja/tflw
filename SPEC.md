# testFlow — SPEC

The complete language and implementation reference for `.tflw` / the `tflw` CLI, organized by
surface, **API features before UI features**. This is the *what*; the *why* behind every choice
is tracked in an internal numbered decision log, cross-referenced here as `(P#n)`.

Status: the API-only surface (config-as-tflw, sessions, capture-chaining, hooks/retry/tags/data-tables,
actions + JS escape hatch, generators, parallel workers, teaching diagnostics, `report.html` +
`junit.xml`) is feature-complete. **M2.65 is done**: the pre-push critical-hardening pass (PLAN
Round 8, decisions 51–59) fixed every correctness bug and doc-overclaim surfaced in that review
(`body text` subject, date-generator/session-generator `--seed` reproducibility, failed-session-
vs-`retry`, soft-`check`-in-action, redaction ordering, a conservative unknown-`{var}` checker
pass, inert `timeout expect` documented) — the clean-tree push gate cleared 2026-07-06. **M2.66 is
done too**: a second review, run as three parallel passes then merged (Round 9, decisions 60–73),
found further novel bugs not in that list — a lexer/arithmetic collision with HTTP-verb-named
variables, duplicate response headers collapsing to the last value, unencoded path interpolation, a
nested-object parse gap, redactor over-redaction on short secrets, CSV data-table mis-typing/
mis-alignment/mis-counting, an unchecked service reference inside `session` blocks, `wait until
api`'s timeout not bounding an individual poll, session steps vanishing from a retried test's
report, and a few minor message/escaping issues — every one fixed, each with its own regression
test, same day (2026-07-06). **M2.7 (packaging and both critical-hardening gates all done; only
the actual git push + npm publish remain, left to the user)** is packaging + publish: esbuild
bundle, public GitHub repo + MIT, CI, this docs split, acceptance vs raw fetch+node:test +
restful-booker — on a passing verdict, **`npm publish tflw@0.1.0`**. **The push/publish tail is
additionally gated on M2.8 — "public face" (PLAN Round 10, decisions 74–83, 2026-07-06, 🟨 in
progress):** a shippable-public-tool review found the package would currently publish broken
(`"private": true`, no README/LICENSE in the tarball) plus a missing public-tool surface. Done so
far: `tflw --version`/`--check`, CHANGELOG, the un-`private` + README/LICENSE tarball fix, a
highlight-only VS Code extension, the TF0xx diagnostics index, and the zero-dep proxy/TLS story
(`insecure` key + teaching errors). The browser half (M3) is the public `0.2.0`; `1.0.0` follows
the browser-era verdict. Build order is API-first: the API vertical slice builds and dogfoods
before any Playwright/browser code.

Every section below carries a status badge (decision 49): **✅ shipped** (built, tested, in
`v0.1.0`), **🔮 planned** (spec'd, not built), or **🔧 mixed** (part shipped, part planned — read
the section's own note).

---

## 1. Principles (P#1, P#4, P#5) ✅

- External DSL, interpreted over its own AST. No transpile-to-Playwright; the event stream the
  interpreter emits **is** the reporting substrate.
- Flat, declarative steps. **No if/else, no loops, no boolean logic in tests** (P#25) —
  branching lives in JS helpers.
- Teaching-quality diagnostics are a feature: every checker/runtime error carries source line,
  caret, and a "did you mean" where possible (P#6).
- Maintainability comes from tooling (reuse pass, lints), not discipline (P#2).

**Static-checker scope (M2.65, PLAN decision 57):** the checker validates config, named services,
sessions, inline data-table columns, and — as of M2.65 — a conservative pass over `{var}`/bare
variable references: a name provably never bound anywhere reachable in its scope (`let`, `capture`,
an action's own parameter, or an *inline* table's declared columns) is flagged with a "did you
mean" hint where a close match exists. File-backed tables are skipped (their columns aren't known
until the file is read, same carve-out as `checkDataTables`), so this is deliberately conservative:
it only ever flags a name that's *definitely* unreachable, never one that merely *might* be. Matcher
↔subject compatibility (e.g. a UI-only matcher used against an API subject) is **not** checked —
that surfaces only as a runtime error when the step fires — and stays a post-v0.1 item.

**Diagnostic codes are public API (PLAN decision 77):** every checker/runtime diagnostic carries a
stable `TF0xx` code. Rule: a shipped code is **never renumbered or reused**; new diagnostics get
new codes. §17 is the diagnostics appendix — code → one-line meaning → tiny example — so the codes
users grep for and paste into bug reports have a canonical index.
>
> "Named services" validation also covers `api <service>` references inside `session` blocks
> (§3.3) via `checkSessionServices`, a config-level pass run once (not per test file, since sessions
> live in `tflw.config` rather than a test file) — a typo'd service name there is a checker error at
> parse time, exit 2, same as inside a test/action/hook (PLAN decision 66).

## 2. Project layout ✅

```
project/
  tflw.config          # config dialect (§3)
  .env                 # gitignored local secrets, auto-loaded (§3.4)
  tests/               # *.tflw test files
  shared/              # imported actions + element aliases (§8) — reuse-pass target
  payloads/            # file-backed request bodies (§5.3)
  data/                # file-backed data tables, *.csv / *.json (§7.5)
  helpers/             # JS/TS escape-hatch modules (§11)
  report/              # per-run report.html + junit.xml (output)
```

## 3. The config dialect — `tflw.config` (P#27–31) ✅

Parsed by the same lexer/parser as tests; declaration-only (`test` is a checker error here).
Config errors get full diagnostics/squiggles.

### 3.1 `defaults` + `env` blocks (P#28)

```
defaults
  header "Accept" is "application/json"
  timeout step 10s, expect 5s, wait 30s
  workers 4
  report "./report"

env local default
  web "http://localhost:5173"
  api "http://localhost:3001"

env staging
  api "https://stg.example.com/api"
  timeout wait 60s              # overrides just this key
```

- Two tiers only: `defaults`, then the active `env` (same-key-wins). No `extends` chains.
- Checker: unknown keys are errors, not ignored.
- Active env selection precedence: `--env <name>` flag > `TFLW_ENV` env var > block marked
  `default`. No resolvable env → startup error.
- `timeout step` (per-request) and `timeout wait` (`wait until api`) are consumed today.
  🔮 `timeout expect` parses and resolves but is **inert in the API-only tool** — it only applies to
  auto-retrying UI expects, which arrive with the browser half (M3); until then it does nothing.
  SPEC-noted rather than removed, so the grammar stays additive-only past publish (PLAN decision 58).
- `insecure true` — a per-env (or `defaults`) key that disables TLS certificate verification for
  the whole run, for self-signed/private-CA staging certs (PLAN decision 78). Explicit and
  greppable in review; a run with it active carries a visible warning in the CLI summary and the
  report header — never a silent trade-off. See §3.5 for the full corporate-networks story.

### 3.2 Named API services (P#29)

```
env staging
  api "https://stg.example.com/api"          # default service
  api billing "https://billing-stg.example.com"
```

- `api <name> "<url>"` declares an extra service; bare `api "<url>"` is the default service.
- Steps address services by name: `api billing GET /invoices/{id}` (§5.1).
- Headers/auth may be scoped per service: `header "X-Key" is env(BILLING_KEY) for billing`.
- Checker validates service names in steps against the active env ("unknown service, did you
  mean `billing`?").

### 3.3 `session` blocks — the single auth concept (P#20, P#31) ✅

```
session admin
  api POST /auth/login body { user: env(ADMIN_USER), pass: env(ADMIN_PW) }
  capture body.token as token
  header "Authorization" is "Bearer {token}"
```

- Steps inside a session are ordinary parsed steps (API or browser).
- Runtime: each session executes **once per run per worker**; results are cached.
- A test opting in with `test "…" as admin` (§4.1) starts with: the session's declared headers
  applied to its api steps, and the session's browser storage state applied to its fresh context.
- There is no separate "auth preset" concept.
- A test may opt into **more than one independent, unrelated session at once**:
  `test "..." as admin, userA` (decision 96, closing TFLW-GAPS.md gap #7). Each session's headers
  and cookie jar fold into the test's starting state in the order listed — a **later-listed
  session wins any header/cookie-name conflict against an earlier one**, the same "later source
  replaces" rule the cookie-jar precedence chain below already follows. In practice this rarely
  collides at all: independent sessions are usually different auth transports (a bearer
  `Authorization` header vs. a session cookie) with no shared header/cookie names to begin with —
  the ordering rule exists for whenever it doesn't, not because collisions are expected.
- A session's own `random`-family generators are seeded from the session's name (not from
  whichever test happens to trigger it), and which test's report shows a given session's steps is
  decided up front **per session name**, in sorted-file/declaration order — a test can own one
  opted-in session's step-splice without owning another's, if some other test already claimed that
  other name first. Both stay identical regardless of `--workers N>1` concurrency (fixed in M2.65,
  decision 53; extended to multi-session opt-ins in decision 96).
- Only a **successful** establishment is cached: a session that fails (a transient auth blip) is
  not memoized, so a later attempt — a `retry` on the same test, or a later test opting in — may
  re-establish it (fixed in M2.65, decision 54).
- A session block runs with an **empty call registry**: `action`/`use` calls are not available
  inside `session` bodies in `v0.1` — `create widget(...)` inside a session fails with `unknown
  call \`create widget(...)\` — no action (\`import\`) or JS helper (\`use\`) defines it`, even if
  the same call works fine in a test in the same file. Keep session bodies to plain `api` steps.

**Cookie jar (P#33)**: every scope that runs `api`/`wait until api` steps — a `session` block's own
run, and each test's own attempt (including its `before`/`after` hooks and any action calls) — has
its own cookie jar, entirely automatic, no new syntax:

```
session shopper
  api POST /auth/login body { email: env(USER_EMAIL), password: env(USER_PW) }
  expect status equals 200
  # any Set-Cookie this response carried is now tracked — no capture/header needed
```

- Every `Set-Cookie` a response carries is folded into the jar (by name, last-value-wins);
  `Max-Age`/`Expires` are honored (`Max-Age` wins when a line has both, RFC 6265 §5.3), and
  `Max-Age <= 0` deletes the cookie immediately, same as a real logout.
- The jar auto-attaches a bare `name=value; name2=value2` `Cookie` header to every subsequent
  request in the same scope — no `capture`/`header` replay needed, and no risk of the newline-
  joined multi-`Set-Cookie` capture (§5.4) landing in a `Cookie` header value, which real HTTP
  clients reject outright.
- A test opting into `as <session>` starts with a **clone** of that session's own jar, not the live
  instance — the test's own subsequent cookie updates never leak back into the session cache
  (shared for the run's lifetime) or into a concurrently-running sibling test under `--workers
  N>1`. Opting into **several** sessions (`as admin, userA`) clones and merges every one of their
  jars into the test's one starting jar, in listed order — same later-wins-per-name rule as the
  header merge above. An action call shares its caller's live jar (same as `rng`/`redactor`).
- An explicit per-step `header "Cookie" is …` still overrides the jar entirely (the escape hatch
  is never removed) — precedence is config headers → session headers (already merged across every
  opted-in session, if more than one) → jar (already merged the same way) → per-step headers, each
  later source replacing rather than appending.
- Deliberately narrower than a real browser's jar: no `Domain`/`Path` scoping (a jar already
  belongs to one session/test talking to one logical app, not arbitrary origins) and no
  `Secure`/`HttpOnly`/`SameSite` enforcement (those constrain a *browser* deciding whether to
  attach a cookie to a browser-initiated request; a test client deliberately replays whatever the
  server just told it to remember) — a closed, smaller feature set on purpose (P#13).

"Which attempt's report shows the session's steps" is resolved **once per test, per session
name**, not once per retry attempt (PLAN decision 68) — so a `retry`-ing test running `as
<session>` (or several) that fails on attempt 1 and passes on attempt 2 still carries each owned
session's steps only in the surviving (last) attempt's report; earlier failed attempts remain
visible in `report.html` too (PLAN decision 86), just without the session's own steps in them
(§4.4).

**Refresh on 401 + TTL expiry (PLAN decision 99a).** A session is no longer cached forever once
established — two independent mechanisms cover the two ways a real credential goes stale:

- **Reactive: any opted-in session refreshes automatically on a `401`.** If a test's request comes
  back `401` and the test opted into one or more sessions (`as admin` or `as admin, userA`), the
  runtime re-establishes each opted-in session in declared order (a fresh `runSession()` call,
  invalidating the old cache entry first) and retries the original request **exactly once** —
  bounded, so a permanently-bad credential fails clearly rather than looping. The re-establish
  itself shows up in `report.html` as its own evidence steps, so a passing retry never looks like
  it silently self-healed. An anonymous test (no `as <session>`) or a `401` with nothing left to
  refresh just fails normally, same as before this decision.
- **Proactive: a session with a known expiry re-establishes ahead of time.** A session that knows
  its own TTL (currently: `oauth2` sessions, via `expires_in`) is treated as expired — and
  re-established on next use — once the run clock passes that deadline, without waiting for an
  actual `401` to prove it. A hand-written `session` block with no TTL concept keeps its original
  cache-forever-on-success behavior unchanged.

**`oauth2` session sugar (PLAN decision 99c), built on refresh.** An alternative to a hand-written
`session` body, for the common client-credentials shape:

```
session billing oauth2
  token url env(BILLING_TOKEN_URL)
  client id env(BILLING_CLIENT_ID)
  client secret env(BILLING_CLIENT_SECRET)
  scope "billing.read billing.write"
```

- `token url`/`client id`/`client secret` are required; `scope` is optional.
- Runtime posts a standard form-urlencoded client-credentials grant
  (`grant_type=client_credentials&client_id=…&client_secret=…&scope=…`) to `token url`, expects
  `access_token` in the JSON response (fails clearly if absent), and applies it as `Authorization:
  Bearer <access_token>` — same header-application semantics as a hand-written session from here on.
- If the response includes `expires_in` (seconds), the session's TTL is set from it — with a
  built-in safety margin (the smaller of 2 seconds or half of `expires_in` is shaved off the end)
  so a request landing right at the boundary refreshes proactively instead of racing a live `401`.
  No `expires_in` in the response means no TTL — the token is cached like any other session value
  until something (a `401`) invalidates it.
- `client secret`'s value is redacted in report evidence exactly like any other `env(...)`-sourced
  secret (§3.4) — no separate redaction wiring needed.
- Mutually exclusive with a hand-written body: a `session` block is either `oauth2` or a sequence
  of steps, never both.

### 3.4 Secrets (P#30)

```
require env ADMIN_USER, ADMIN_PW
```

- `require env` validates at startup; **one** error lists *all* missing vars. Every `require env`
  variable is also pre-registered with the redactor at run start (fixed in M2.65, decision 56) —
  masked from the very first step even if its `env(NAME)` is never actually evaluated anywhere in
  the run (e.g. a var only used to satisfy a session another file doesn't touch, but that happens
  to leak into an unrelated response).
- `.env` at project root is auto-loaded for local dev; real environment variables win over it.
- `env(NAME)` reads a variable anywhere a value goes. Every value that entered via `env(…)` is
  **taint-tracked**: wherever it flows (header, body, URL, derived interpolation), the reporter
  renders `•••(NAME)` in report.html, traces, and CLI output. Reports are ticket-attachable by
  construction. A secret registered *after* an earlier step's trace was already built (its
  `env(NAME)` isn't evaluated until later in the run) still masks that earlier step: a final
  full-report redaction pass runs once when each file's `runProgram` call finishes, and again on
  the merged report just before `tflw run` writes it, so both the within-file and cross-file
  ordering windows are closed (fixed in M2.65, decision 56).

A value shorter than `MIN_REDACTABLE_LENGTH` (6 characters) is never registered for substring
redaction — a short/common secret (a numeric ID, a port number) would otherwise blot out every
matching substring anywhere in the report, including unrelated fields (PLAN decision 64). If two
different `require env` vars (or a secret and a coincidentally-equal generated value) hold the
same string, the redactor tracks every name registered for it and renders all of them —
`•••(NAME1|NAME2)` — rather than silently keeping only whichever registered first (PLAN decision 72).

### 3.5 Corporate networks (proxies, private CAs, self-signed certs) ✅

Corporate QA — the audience this tool courts — routinely runs against a staging API sitting behind
a self-signed or private-CA certificate, and/or a corporate HTTP(S) proxy. Node's own `fetch`
handles neither by default: both die as an opaque `TypeError: fetch failed` (PLAN decision 78).
Zero new runtime dependencies — every piece below is either a `tflw.config` key or a standard Node
mechanism.

- **Self-signed or expired certs — `insecure true`.** Set per-`env` (or in `defaults`) to disable
  TLS certificate verification for the whole run:
  ```
  env staging
    api "https://staging.example.com"
    insecure true
  ```
  Explicit and greppable in review. Every run with it active says so, loudly: the CLI summary
  prints `⚠ insecure: true — TLS certificate verification was disabled for this run` in bold, and
  `report.html`'s header carries the same banner — this is never a silent trade-off. Implementation
  note: Node's `fetch` (undici) has no zero-dependency per-request TLS-verification switch, so
  `insecure true` sets the process-wide `NODE_TLS_REJECT_UNAUTHORIZED` env var for the run's
  duration (reference-counted so `--workers N>1` files sharing the same active env can run this
  concurrently without one file's completion re-enabling verification for another still in flight)
  and restores whatever it was before once the run finishes.
- **A private/internal CA — `NODE_EXTRA_CA_CERTS`.** If your staging API's cert chains to a real
  (if internal) CA rather than being self-signed, prefer pointing Node at that CA bundle over
  disabling verification outright: `NODE_EXTRA_CA_CERTS=/path/to/ca.pem npx tflw run`. Verification
  stays on; only your organization's own CA is trusted in addition to the public ones.
  `NODE_EXTRA_CA_CERTS` is a standard Node mechanism, not a `tflw`-specific one.
- **Corporate HTTP(S) proxy — `NODE_USE_ENV_PROXY=1` on Node ≥ 24.** Node's `fetch` only honors
  `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` when explicitly opted in via `NODE_USE_ENV_PROXY=1`,
  supported from Node 24 on. **On Node 22 (this tool's floor, P#43) there is no built-in env-var
  proxy path for `fetch` at all** — an honest, stated limitation, not worked around with an
  `undici`/proxy-agent runtime dependency (P#43's zero-dependency bundle stays zero). If your
  network requires a proxy, run on Node ≥ 24, or reach for the JS escape hatch (§11) to route a
  single problematic request differently.
- **Teaching errors, not a bare `fetch failed`.** `http.ts` unwraps the real cause Node already
  attaches to the error (`err.cause.code`) into a named hint appended to the failure message:
  a self-signed/expired/altname-mismatched cert names `insecure true` and `NODE_EXTRA_CA_CERTS` as
  the two fixes; `ENOTFOUND` names a DNS lookup failure; `ECONNREFUSED` asks whether the service is
  actually listening at that host:port. Everything else still surfaces the raw message, unmodified.

### 3.6 Client certificates — mTLS (PLAN decision 99b) ✅

Some enterprise APIs authenticate the *client* via a TLS certificate rather than (or in addition
to) a bearer token. Per-`env` (or `defaults`) `cert`/`key` config keys:

```
env staging
  api "https://staging.example.com"
  cert "./certs/client.pem"
  key "./certs/client.key"
```

- Both keys are required together — `cert` without a matching `key` (or vice versa) is a config
  error, checked once `defaults` and the active `env` are merged (they may legally be split across
  the two blocks: a shared `cert` in `defaults`, a `key` only in one `env`).
- Every request against that env presents the client certificate during the TLS handshake. This is
  the one request path that doesn't use Node's plain global `fetch` under the hood — it needs a
  bundled `undici` dispatcher instead (§15), since Node's `fetch` has no per-request client-cert
  hook. Every other request in a `.tflw` suite, mTLS-configured env or not, is unaffected.
- Cert/key file contents are read once per run (cached by resolved path), not re-read per request.
- `insecure true` (above) and `NODE_EXTRA_CA_CERTS` both still apply on an mTLS-configured env,
  read fresh on every connection rather than cached at the first one — deliberately more defensive
  here than Node's own default behavior for these two env vars, which are otherwise read only once
  per process.

## 4. Tests & structure ✅

### 4.1 `test`

```
@smoke @orders
test "pay for an order" as admin
  ...steps...

test "an admin acting on a shopper's behalf" as admin, userA
  ...steps...
```

- `@tags` filter via `tflw run --tag smoke` (P#10), or `tflw run --tag smoke,critical` for
  comma-separated OR across several tags — a test runs if it carries *any* listed tag (decision
  97). No exclusion syntax (`--tag !x`).
- `as <session>` opts into a cached session (§3.3); `as <session>, <session>...` opts into several
  independent, unrelated sessions at once — a comma-separated list, same shape as `require env A,
  B, C` (§3.4). Omitted → anonymous fresh state.
- Isolation: every test gets a fresh browser context; no state leaks between tests (P#20).

### 4.2 Hooks (P#10, P#19)

```
before file        # once per file
before             # before each test in the file
after              # after each test — cleanup lives here
after file
```

House style for data: tests create their own data (`unique`, §7.2) and delete it in `after`
hooks via shared actions. No runtime auto-cleanup (P#19).

**Scope isolation:** `before`/`after` (each-scope) share one scope with the test they wrap — a
`let` bound in `before` is visible in the test body and in `after`. `before file`/`after file` run
in their **own, separate scope**, isolated from every test in the file — a `let` bound in `before
file` can never be read by a test, or by an each-scope `before`/`after`. Use a `session` block
(§3.3) or a shared `action` (§8) to hand data from file-level setup to individual tests; `before
file` is for side effects (seeding shared fixtures, warm-up calls), not for values a test needs to
read.

### 4.3 Data tables — `with each` (P#10, P#24)

```
with each
  | role    | email        |
  | "admin" | unique email |
  | "guest" | unique email |
test "invite {role}"
  ...
```

- Each row runs and reports as its own case; row values interpolate into the test name.
- Cells accept any expression, including generators — evaluated per row at case start.
- File-backed: `with each from "./data/invites.csv"` (also `.json`). Columns bind by header
  name; checker verifies the file exists and that used columns exist.

`.csv` parsing (PLAN decision 65): minimal RFC-4180 — a field may be quoted (`"Smith, John"`) to
contain a comma verbatim, `""` inside a quoted field is an escaped quote. A numeric-looking cell
(`3`, `-1.5`) is coerced to a real number, matching a `.json`-backed table's native types (so
`expect body.qty equals {qty}` works against a real JSON number either way). Every row's cell count
is validated against the header — a short or long row is a clear runtime error naming the row
number and cell counts, never silent padding/truncation.

### 4.4 `retry` (P#10)

`retry 2` on a test declares up to 2 re-runs on failure; passes-after-retry are flagged
**flaky** in the report, never silently green. Each attempt re-derives the *same* per-test seed,
so `random` values are identical on every attempt — but `unique(...)`/`unique email`/etc. are not:
their run-wide counter keeps advancing across attempts by design, so a retry can never collide
with data the failed attempt already created (§7.2, §7.4).

`report.html` shows every attempt's steps for a `retry`-ed test, not just the last: each failed
prior attempt renders as a collapsed section (labeled `attempt 1 — failed`, `attempt 2 — failed`,
…) above the final attempt's already-visible steps, so a `flaky` badge always has its evidence
trail one click away (PLAN.md decision 86, closing decision 46's deferred gap). `junit.xml` stays
summary-only by design — its `<testcase>` carries a `flaky` `<system-out>` note with the attempt
count, not step-level detail; that detail lives in report.html.

## 5. API steps (P#3, P#7, P#29, P#32, P#33) ✅

### 5.1 Request line

```
api GET /orders?state=open
api POST /orders body { name: {name}, qty: {qty} }
api billing GET /invoices/{oid}
api GET /health timeout 2s
api GET /old-path without redirects
```

Grammar: `api [<service>] <METHOD> <path>[?query] [<body-form>] [timeout <dur>] [without redirects]`

- Path is relative to the service's baseUrl in the active env; `{vars}` interpolate.
- Headers: env/defaults headers apply automatically; per-step extras:
  `header "X-Trace" is "{traceId}"` lines directly under the api step.
- `timeout <dur>` overrides the config request timeout for this step only.
- Redirects are followed by default; `without redirects` leaves the 3xx observable (§6.2).

Interpolated `{var}` path segments are percent-encoded (`encodeURIComponent`) before being
concatenated into the URL, so a captured/generated value containing `&`, `#`, `?`, a space, or
non-ASCII characters lands as its own path/query segment rather than corrupting the request (PLAN
decision 62). This only applies to the URL path — a `body from "<file>"` template's `{var}` holes
interpolate the raw value, unencoded, since that's JSON/text content, not a URL.

### 5.2 Body forms (P#32)

| Form | Syntax | Notes |
|---|---|---|
| Inline JSON | `body { name: {n}, qty: random number 1 to 5 }` | small payloads; expressions + generators inside |
| File-backed | `body from "./payloads/order.json"` | file is a template — `{vars}` interpolate; checker verifies existence |
| Form-encoded | `form user={u}, pass=env(PW)` | `application/x-www-form-urlencoded` |
| Multipart upload | `upload "./files/img.png" as "avatar"` | may combine with `form` fields |
| Raw text | `body text "plain payload"` | sets no JSON content-type |

Out of v1: binary bodies, GraphQL blocks, XML helpers (P#32).

**Multi-line object/array literals** (`body { … }` spanning several hand-indented lines) are
supported: the lexer tracks `{}`/`[]` bracket depth and suppresses `NEWLINE`/`INDENT`/`DEDENT`
while a bracket is open, so a literal's interior lines carry no indentation structure of their own
(the same way parentheses suppress significant newlines in Python). Found missing during the
restful-booker external dogfood (M2.7) — a hand-formatted multi-line create-booking payload didn't
parse — and fixed the same session; see `packages/lang/src/lexer.ts`.

A nested object/array literal's first key may be either a bare ident or a **quoted string** —
`body { user: { "name": "Widget" } }` parses the same as the equivalent top-level `body { "name":
"Widget" }` (PLAN decision 63).

### 5.3 Response subjects (what `expect` can see after an api step)

`status`, `header "<name>"`, `body.<path>` (JSON), `body text` (non-JSON), `duration`.

- `body.<path>`: dot/index addressing — `body.items[0].price`. On a non-JSON response, a
  JSON-path expect raises a teaching error pointing at `body text` (P#33).
- `duration`: wall time of the request — `expect duration is less than 500ms`. A regression
  tripwire, not perf testing (P#33).
- `body text`: the raw response body as a string, for non-JSON (text/HTML/XML) responses —
  `expect body text contains "healthy"`. Implemented end-to-end in M2.65 (PLAN decision 51):
  lexer/parser accept `body text` as a subject (`BodyTextSubject` AST node), the interpreter
  resolves it to `response.bodyText`, and it works with `expect`/`check`/`capture` alike.

### 5.4 `capture` (P#7)

```
api POST /orders body { … }
capture body.id as orderId
capture header "location" as orderUrl
```

Binds response values to variables usable in later API **and** browser steps.

A response with multiple same-named headers (most commonly several `Set-Cookie`s) preserves every
value rather than collapsing to whichever the Fetch API iterates last — `capture header
"set-cookie" as token` sees all of them, newline-joined (PLAN decision 61). This raw capture stays
useful for *asserting* on `Set-Cookie`'s own attributes (`expect header "set-cookie" matches
"HttpOnly"`); it is not how cookies get replayed on a later request anymore — the cookie jar
(§3.3, P#33) does that automatically, and a newline-joined multi-cookie capture reused directly as
a `Cookie` header is exactly the header-injection failure the jar exists to avoid.

### 5.5 Retry semantics & `wait until api` (P#15)

- API expects evaluate **once** against the received response and fail fast.
- Eventual consistency is explicit — the whole block re-issues until its expects pass or the
  `wait` timeout elapses:

```
wait until api GET /orders/{orderId}
  expect body.status equals "shipped"
```

Each individual poll's own request timeout is clamped to whatever's left of the `wait` deadline, not
just the (usually much longer) per-request `timeout step` — so a slow/hanging endpoint can't make
the whole `wait until api` block silently exceed its configured budget (PLAN decision 67).

`wait until api` may carry its own `header "…" is <value>` lines, exactly like an `api` step's
header sub-block (§5.1) — the same `header`/`expect` block, headers first by convention but not
enforced by the grammar. Every poll re-sends them, so a poll that needs a specific auth token,
per-file namespace, or idempotency key attached is expressible without a workaround (PLAN decision
95, closes gap #4):

```
wait until api GET /jobs/{jobId}
  header "Authorization" is "Bearer {token}"
  expect body.status equals "done"
```

## 6. Assertions (P#13–16) ✅

### 6.1 The one form

```
expect <subject> [not] <matcher> [value]
check  <subject> [not] <matcher> [value]     # soft twin (§6.4)
```

Subjects: API (§5.3) and UI (§9.4). The matcher set is **closed** (P#13); custom logic goes
through the JS escape hatch (§11).

### 6.2 Matcher table

🔮 The UI-only rows (`has value`, `is visible/hidden/enabled/disabled/checked`) aren't callable yet
— there are no UI subjects to apply them to until the browser half (M3) exists. Everything else
below is ✅ shipped.

| Matcher | Applies to | Example |
|---|---|---|
| `equals` | any value | `expect status equals 201` |
| `contains` | strings, arrays | `expect body.msg contains "created"` |
| `matches "<regex>"` | strings | `expect header "content-type" matches "json"` |
| `matches subset {...}` | objects | `expect body matches subset { type: "about:blank", status: 422 }` |
| `is greater than` / `is less than` | numbers, `duration` | `expect body.total is less than 100` |
| `has count N` | arrays, UI lists | `expect body.items has count 3` |
| `has value` | UI fields | `expect field "Email" has value "a@b.c"` |
| `is visible/hidden/enabled/disabled/checked` | UI locators | `expect button "Pay" is enabled` |

`not` negates any matcher. For UI, `not visible` retries until absent (P#15).

### 6.3 Array quantifiers (P#14)

```
expect any body.items.name equals "Widget"
expect all body.items.status equals "active"
```

### 6.3.1 Partial-object matching — `matches subset {...}` (P#14)

`equals` is a full deep-equal (every key, both directions); `matches subset {...}` checks the
other direction only — every key/value in the literal must be present on the actual object, extra
keys on the actual object are ignored:

```
expect body matches subset { type: "about:blank", title: "Unprocessable Entity", status: 422 }
```

- Recurses into nested **object** values (a nested field can itself be a partial literal); a
  nested **array** value still needs full equality — arrays are sequences, not sets, same
  order-sensitivity `equals` already has (P#13's closed feature set deliberately has no separate
  "array subset" mode).
- Composes with `any`/`all` (§6.3) like any other matcher — `expect any body.items matches subset
  {...}` runs the subset check once per element.
- `not matches subset {...}` negates the whole result (`not` still wraps any matcher, §6.2).
- The operand is an ordinary object literal (§7's `{...}` grammar — same one `body {...}` uses),
  so field values can be `{ref}` interpolations, generators, etc., not just literals.
- No new subject or grammar production beyond that literal — the matcher is the only new surface,
  keeping `expect`'s single form (§6.1) intact.

### 6.4 Hard vs soft (P#16)

- `expect` fails the test immediately (trustworthy artifacts).
- `check` records pass/fail and continues; any failed check fails the test at the end.
- House style: `expect` = flow gates, `check` = final-state audits.
- This stays uniform through an `action` call (§8): a `check` failing *inside* an imported action
  propagates back to the caller as soft — the caller's own later steps still run, and the whole
  test only fails at the end, exactly as if the `check` had been written inline (fixed in M2.65,
  decision 55; previously any failure inside an action's steps, soft or hard, aborted the caller
  immediately).

### 6.5 Retry split (P#15)

UI expects auto-retry to the expect timeout. API expects evaluate once (§5.5).

### 6.6 Failure-message size (P#14, TFLW-GAPS.md gap #8)

Every failure message's "expected"/"got" text is capped at 2000 characters, with a trailing marker
(`… (truncated, showing 2000 of N chars — see report.html for the full response body)`) when the
untruncated value would have been longer. This is a fixed default, not new config surface (P#13) —
before it, a large response body's `expected`/`got` text was a bare, uncapped `JSON.stringify`, so
a single failing assertion against (for example) a 61-item order produced one 11,248-character
line in both the CLI and `report.html`. The full response body is unaffected by this cap — it
remains available via the step's own request/response capture (§13) regardless of what the
assertion message shows.

`matches subset {...}` gets an additional, more targeted improvement on top of the cap: a failed
subset match reports only the keys that are actually missing or mismatched (dotted paths flatten
nested mismatches, e.g. `customer.vip`), not the whole actual object — the matcher already knows
which literal keys it checked, so a large response with one wrong field now reads as one short
line instead of the entire body. This applies only to a genuine (non-negated) mismatch; a `not
matches subset {...}` that unexpectedly succeeded still shows the ordinary whole-actual message
(there's no "mismatch" to itemize when the raw check actually passed).

## 7. Variables, data & expressions (P#19, P#21–25) ✅

### 7.1 `let`

`let orderId = create order("Widget")` — binds values from expressions, generators, action
returns, `env(…)`.

### 7.2 `unique` — collision-safe identity data (P#19, P#21)

`unique("prefix")`, `unique email`, `unique number`, `unique like "ORD-######"`, `unique uuid`.
Guaranteed distinct across tests/workers within a run (run/worker-seeded). Use for anything with
a uniqueness constraint.

`unique uuid` is v4-shaped, but its trailing 8 hex digits are the run-wide counter itself (the
same guarantee mechanism `unique("prefix")` gets from literal string concatenation), so
distinctness is a true guarantee, not v4's usual low collision probability. There is deliberately
no `unique password` — passwords carry no real-world uniqueness constraint the way email/order-id
do (decision 98); see `random password` (§7.3).

**Under `retry` (§4.4):** `unique(...)`'s run-wide counter keeps advancing on every retry attempt
of the *same* test — by design, so a retried attempt never collides with data the failed attempt
already created. That means a retried attempt **cannot** use `unique(...)` to reproduce a value an
earlier attempt already used — it will always get a new one. Anything a retry needs to reuse
identically across its own attempts (an idempotency key, a namespace already created by the first
attempt) must come from `random` (§7.3), whose per-test seed replays identically on every attempt
of that test — never `unique`, or a "successful" retry will silently operate against different
data than the attempt it's supposedly recovering.

### 7.3 `random` — value-shaped data, collisions allowed (P#21–22)

```
random number 1 to 100          # int        random decimal 0.5 to 99.9
random date in past             # also: in future, between A and B
random of "red", "blue", "green"
random string 12                # alnum
random like "SKU-####-??"       # = digit, ? = letter
random uuid                     # v4, collisions allowed
random password                 # default length 12
random password 16              # custom length (min 4)
```

No built-in faker realism (names/addresses) — use `random of` with your own list, or JS (P#22).
`random password` is not an exception to this — it satisfies a validation policy (at least one
upper/lower/digit/symbol), not a fake human identity, same category as `unique like`'s pattern
fill (decision 98).

### 7.4 Reproducibility (P#23)

- All `random` values derive from **one run seed** with per-test sub-seeds (parallel order
  doesn't shift values).
- All `today`/`now`-derived values (`today`, `now`, `random date in past`/`in future`) derive from
  **one run clock** — the real current instant, or `--now <iso>` to pin it exactly (decision 52).
- Seed and run clock are both stamped in the CLI summary, report.html header, and junit
  properties.
- `tflw run --seed <s>` alone reproduces *which* relative values a run draws — the same choice
  from `random of`, the same offset from `random number`/`random date in past`, etc. — but **not**
  the absolute wall-clock instant those draws are anchored to, since each invocation otherwise
  gets a fresh `now`. `tflw run --seed <s> --now <iso>` together reproduce a run's exact absolute
  dates as well. Watch mode auto-reuses the last failing seed (and will reuse its run clock too).
- `random date between A and B` over fixed anchors was already fully reproducible from `--seed`
  alone, since neither endpoint touches the run clock.
- Every generated value is shown inline at its step in the report: `qty = 100 (random)`.

`unique(…)` values are deliberately **not** seed-reproducible (their run-wide counter keeps
advancing so a retry can't collide — §4.4). Generators used *inside* a `session` block reproduce
identically under any `--workers N` (§3.3, decision 53), same as everywhere else.

### 7.5 Expressions (P#25)

Closed grammar, usable in `let`, fills, api bodies, table cells, expect values:

- Arithmetic on numbers: `{price} * {qty}`, `+ - * /`.
- Interpolation in strings: `"Order {orderId} for {name}"`.
- Date math: `today`, `now`, `today + 3 days`, `now - 2 hours`;
  `format {d} as "yyyy-MM-dd"` (project default format in config).
- **Hard fence:** no conditionals, no loops, no boolean operators.

A variable named `get`, `post`, `put`, `delete`, or `patch` (any case) followed by `/` lexes as
division, not an HTTP path — `let ratio = get / 2` parses fine, since PATH-start requires the
preceding ident to actually sit in HTTP-method grammatical position (right after `api`, optionally
with a named service in between), not just read like a method word (PLAN decision 60). `random
number`/`random decimal` reject a reversed range (`to < from`) as a runtime error rather than
silently producing an out-of-range value (PLAN decision 70).

### 7.6 Transforms: `base64`/`hex`/`url` (decision 98)

Pure value transforms — unlike §7.2/§7.3's generators, these consume an existing value rather
than manufacture a fresh one, same category as `format <value> as "<pattern>"` (§7.5):

```
base64 encode({value})    base64 decode({value})
hex encode({value})       hex decode({value})
url encode({value})       url decode({value})    # encodeURIComponent/decodeURIComponent
```

Motivating case (gap #9): HTTP Basic auth needs a base64-encoded `user:pass` credential in an
`Authorization` header, expressible declaratively for the first time:

```
let creds = base64 encode("{email}:{password}")
api GET /orders
  header "Authorization" is "Basic {creds}"
```

A `decode` direction on malformed input (invalid base64/hex characters, invalid percent-encoding)
is a runtime error, not a silently-wrong value — `Buffer`'s own base64/hex decoding is lenient by
default (drops bad characters instead of throwing), so `decode` validates the input's shape first.
Transform values are shown inline like everything else, but **not** tagged `(random)`/`(unique)`
in the report (§7.4) — same as `format`, they're not generators.

## 8. Actions, imports, element aliases (P#2, P#17–18) 🔧

✅ Actions, `give` returns, `import`, and the reuse-pass description apply today. 🔮 `element`
aliases and the lint nudging a duplicated `css`/`xpath` escape behind one are UI-only and wait for
the browser half (M3); the reuse pass itself (extraction + `tflw refactor apply`) is M6.

```
# shared/orders.tflw
action create order(name)
  api POST /orders body { name: {name} }
  expect status equals 201
  capture body.id as id
  give id

element node card = css ".react-flow__node[data-id]"
```

```
# tests/checkout.tflw
import "./shared/orders.tflw"
test "pay for an order"
  let orderId = create order("Widget")
  open "/orders/{orderId}"
  click node card
```

- Actions: parameters + `give` return values; file-scoped; shared via `import`. No globals (P#17).
- Element aliases centralize locators; lint: a `css`/`xpath` escape duplicated across files
  SHOULD move behind an alias (checker warning) (P#18).
- The **reuse pass** (P#2) detects similar step sequences suite-wide and emits diagnostics with a
  fully prepared extraction (name, params, call-site diff) targeting `shared/`; applied only via
  `tflw refactor apply <id>` or an IDE code action. Builds never mutate source.

## 9. UI steps (P#8–9, P#26) 🔮

Planned for the browser half, `0.2.0` (M3). Nothing in this section is callable yet.

### 9.1 Navigation & interaction

```
open "/orders/{orderId}"        # relative to env web baseUrl
click button "Add to cart"
fill field "Email" with {email}
```

### 9.2 `fill form` (P#26)

```
fill form
  | Name  | unique("user")         |
  | Email | unique email           |
  | Age   | random number 18 to 99 |
```

Each row executes and reports as its own sub-step; same locator resolution as `fill field`.
No fill-and-remember auto-verify — audits are explicit `check` lines.

### 9.3 Locators (P#8–9)

- Semantic-first, documented resolution tier: role+name → label → placeholder → visible text
  (Playwright getByRole/getByLabel underneath).
- Escapes: `css "…"`, `xpath "…"` — greppable, lint-nudged behind `element` aliases (§8).
- Unresolved locator ⇒ diagnosis, never silent fallback: runtime scans the live DOM and prints
  nearest candidates as ready-to-paste locators; `tflw pick <url>` opens the page and prints the
  best locator for a clicked element.

### 9.4 Waiting & UI subjects

- Every step auto-waits; `sleep` does not exist — only `wait until <condition>` (P#8).
- UI expect subjects: locators (`button "…"`, `field "…"`, `text "…"`, `list "…"`, `element`
  aliases) with the state/value/count matchers of §6.2, all auto-retrying.

## 10. Sessions & isolation (P#20, P#31) 🔧

✅ The `session` block half shipped in M2.6 (§3.3). 🔮 Fresh-browser-context-per-test and applying
a session's cached storage state to it are the browser half, M3.

Fresh browser context per test; cached `session` blocks solve auth cost (§3.3). Login flows
still get their own dedicated tests. Context-per-file is rejected — ordering coupling.

## 11. JS escape hatch (P#11) ✅

```
use "./helpers/sign.ts"
let sig = sign payload({body})
```

Plain JS/TS modules exporting async functions, called like native actions (test context in,
values out). No inline JS inside `.tflw` files. This is the outlet for: custom matchers-as-
helpers, faker-grade data, conditional logic, exotic protocols.

## 12. CLI 🔧

**✅ Shipped:**

| Command | Purpose |
|---|---|
| `tflw init` | scaffold `tflw.config` + `example.tflw` + `.env.example` + `.gitignore` (`.env`/`report/`, appended without duplicating if the file already exists) — decision 82; API-only, `--ui` is M3 |
| `tflw run [files] [--env E] [--tag T[,T...]] [--only NAME] [--seed S] [--now ISO] [--workers N] [--no-color] [--verbose]` | run; exit code for CI. A failing test's diff always prints live (no flag, no TTY required — decision 91); `--verbose` additionally prints one line per step (pass or fail), buffered per-file under `--workers > 1` so concurrent files' step logs never interleave. `--tag` takes a comma-separated list with OR semantics — a test runs if it carries any listed tag (decision 97). `--only` runs a single test by its exact declared name (composes with `--tag`'s OR-list as AND) — decision 94, for the VS Code extension's per-test CodeLens |
| `tflw check [files] [--env E] [--no-color] [--format json]` | validate only: parse + the full checker pipeline `run` executes before it does anything (config parse/validate + `checkServices`/`checkSessionServices`/`checkDataTables`/`checkSessions`/`checkUnknownVariables`), teaching diagnostics, exit 0/2, **no execution** — lint in CI/pre-commit without touching a live API or needing `require env` secrets, P#75 (M2.8). Text output by default; `--format json` (decision 94) prints the target file's `Diagnostic[]` as JSON instead, for editor integrations — a config-level failure (broken `tflw.config`, unknown session service) still prints text to stderr and exits 2 with an empty array on stdout, out of scope for a per-file editor check |
| `tflw --version`, `-v` | print the installed version — injected at bundle time via esbuild `--define`, P#74 (M2.8) |
| `tflw docs [topic]` | print a SPEC.md-derived cheatsheet section; no topic lists every one. A static bundled artifact (`docs-data.generated.ts`, regenerated from SPEC.md at `pretest`/`predev`/`bundle` time, not parsed live at runtime — SPEC.md isn't shipped in the npm package), decision 93 |

**🔮 Planned:**

| Command | Purpose |
|---|---|
| `tflw init --ui` | also scaffold a UI test + prompt for `tflw install-browsers` (M3) |
| `tflw watch` | save → affected test re-runs headed, browser stays open at failure, reuses last failing seed (M5) |
| `tflw pick <url>` | click an element, get the best locator printed (M5) |
| `tflw refactor apply <id>` | apply a reuse-pass extraction (M6) |
| `tflw install-browsers` | one-time Playwright browser download for UI tests, P#36 (M3) |
| `tflw migrate` | mechanically rewrite a suite past grammar deprecations, P#38 (1.0 gate) |

## 13. Events, report, CI outputs (P#4–5, P#23, P#30) 🔧

✅ Everything API-side: the event stream, req/res panels, per-`check` rows, generated values
inline, seed header, redaction, CLI summary, `junit.xml`, exit codes. 🔮 Screenshots per browser
step wait for M3/M4.

- Interpreter emits `step:start` / `step:end` (timing, screenshot for browser steps, full
  req/res trace for API steps); reporter is a pure consumer.
- `report.html` (self-contained, per run): step timeline mirroring source; screenshot per
  browser step; req/res panels per API step; failures as source line + expected/actual +
  before/after artifacts; per-`check` pass/fail rows; generated values inline; run seed in the
  header; taint-redacted secrets throughout.
- A collapsible sidebar tree groups every test by its source file, with one clickable link per
  test and one detail panel per test in `<main>` toggled via a shared `active` class — a small
  inline `<script>` (decision 92) wires up click-to-switch, a text filter, and an All/Failed/Passed
  status toggle. Still a single self-contained file (no external requests, opens via `file://`
  the same as before) — just no longer JS-free. A file group with any failing test starts expanded
  with the first failing test's panel shown; an all-passing run defaults to the first file's first
  test. `@media print` forces every panel visible and hides the sidebar, so printing/PDF export is
  unaffected.
- CI: summary to stdout, `junit.xml` (seed in properties), meaningful exit codes.

`junit.xml`'s escaping strips XML-invalid C0 control characters (keeping tab/LF/CR, which XML 1.0
permits) in addition to entity-escaping `& < > "` — a test name or error message that happens to
echo one (e.g. from a garbled/binary response) still produces well-formed XML (PLAN decision 73).

## 14. Architecture (P#1, P#12) 🔧

✅ `lang`/`runtime` (fetch binding)/`reporter`/`cli`/`vscode`, bundled via esbuild for publish.
🔮 The Playwright binding in `runtime` is M3.

```
packages/
  lang/      lexer, parser, AST, checker (pure, no I/O) — also parses tflw.config
  runtime/   interpreter, fetch binding (M1) + Playwright binding (M3), event stream,
             taint tracking, seed derivation
  reporter/  events → report.html + junit.xml, redaction rendering
  cli/       tflw run / check / init / docs / watch / pick / refactor
  vscode/    highlighting + child-process diagnostics + run CodeLens (decision 94) — a thin
             extension-host client of the CLI's `--format json`, not a wrap of lang/ (no LSP)
tests/       dogfood .tflw suite (against automationTestPOC)
```

- Hand-rolled lexer + recursive-descent parser; no parser generator (diagnostics ownership, P#12).
- `lang/` is a pure library so a real LSP can wrap it in v2.
- Build order M0–M7 is API-first: `runtime/` has **no Playwright dependency until M3** (P#34).

## 15. Distribution (P#35–39, amended by P#41–50) 🔧

Describes the whole release plan; individual bullets below are already true (posture, packaging
mechanism, Node ≥ 22, versioning promise) or are 🔮 future events (the `0.2.0`/`1.0.0` publishes).

- **Posture:** public-grade from day one (public GitHub repo — own repo, MIT, CI, P#48 —
  stranger-readable README, `npm pack`-clean layout). First npm publish is the **API-only
  `0.1.0`**, gated by M2.7's acceptance (side-by-side vs raw fetch+node:test + external dogfood
  on restful-booker, P#41) **and by M2.8 "public face"** (P#74–82: un-`private` the package,
  README/LICENSE in the tarball, `--version`, `check`, CHANGELOG, positioning); the browser half
  publishes as `0.2.0`; `1.0.0` follows the browser-era M7 verdict (P#50). Repo is public with
  **contributions closed initially** — issues welcome, PRs not accepted yet, stated plainly in
  the README (P#80). Platform bar at 0.1: tested on Linux/macOS, Windows via WSL (P#79). A VS Code
  extension ships alongside 0.1 on its own Marketplace cadence (P#76): TextMate grammar, snippets,
  child-process diagnostics (`tflw check --format json`), and a run CodeLens — not a real LSP
  (decision 94 supersedes P#76's original "squiggles/LSP stay M5" deferral, since this pattern
  didn't need to wait for a real LSP consumer to exist).
- **Install:** per-project `npm i -D tflw`, run via `npx tflw`; `tflw init` scaffolds.
  **Node ≥ 22** (P#43). `.ts` escape-hatch helpers load via native type stripping — no tsx/
  esbuild runtime dependency. Published tflw now bundles one real runtime dependency,
  **`undici`** (P#99b, mTLS client-cert dispatch — the one request path Node's plain global
  `fetch` can't serve) — build-time-only in `package.json` terms, since esbuild inlines it into
  `dist/cli.cjs` and a consumer's own `npm install` never pulls in a package named `undici`. The
  bundle format itself is CJS (`dist/cli.cjs`, not ESM `dist/cli.js`) because undici's CJS
  internals can't be hoisted into static ESM imports (P#99). A second bundled dependency, `ajv`
  (contract/schema validation), is planned for arc cluster 3 but not yet built.
- **Packages:** one `tflw` on npm — cli + lang + runtime + reporter **bundled via esbuild at
  prepack**; internal workspace packages stay private (P#37, mechanism P#43). `playwright` is an
  **optional peer**, dynamic-imported at the first browser step; `tflw install-browsers` does
  both the npm install and the browser download, so API-only projects stay small forever
  (P#44, P#36). VS Code extension → Marketplace separately, embedding `lang/` (P#37).
- **Versioning:** single semver. The shipped API grammar is **frozen additive-only from the
  first publish** (P#45); any pre-1.0 breaking change requires a checker deprecation warning one
  full release ahead. `tflw migrate` is a 1.0-gate deliverable (P#45); grammar freezes
  additive-only for good at 1.0 (P#38). TF0xx diagnostic codes fall under the same promise:
  never renumbered or reused once shipped (P#77). A root `CHANGELOG.md` (Keep-a-Changelog style)
  carries these promises release-by-release from `0.1.0` on (P#74, M2.8).
- **CI:** plain `npx tflw run` anywhere; README ships a GitHub Actions snippet (browser cache,
  report.html uploaded as artifact). junit.xml + exit codes are the contract (§13).
- **Onboarding:** README quickstart hits a green **API** test in <5 minutes (no browser download
  in the funnel), SPEC.md is the reference, `examples/` mirrors the dogfood suite (P#39).

## 16. Out of v1 (parking lot) 🔮

Mobile/unit/perf testing, DB assertions, OpenAPI/contract (P#3); LSP, recorder, dashboards
(P#6, v2 list); faker realism (P#22); `dataset` construct
(P#24); binary/GraphQL/XML bodies (P#32); response downloads (P#33 — cookie subjects, P#33's other
half, shipped: §3.3's automatic cookie jar); `dependsOn` stays rejected (P#10); standalone binary,
Docker image, official GitHub Action,
docs site, separately published `@tflw/lang` (P#36–39); `tflw fmt` canonical formatter (P#83 —
offside-rule grammar already constrains layout; revisit at M5/M6 with the source-rewriting
machinery); `tflw check --format json` machine-readable diagnostics (P#75 — waits for a real
consumer, the LSP); Windows CI/support beyond WSL (P#79, on demand); community files
(CONTRIBUTING/SECURITY/issue templates) + npm provenance via a workflow publish, when
contributions open (P#80).

## 17. Diagnostic codes (TF0xx) ✅

Every diagnostic carries a stable code (`packages/lang/src/diagnostic.ts`'s `Codes` table — the
single source of truth this appendix mirrors). **Stability rule (P#77):** a shipped code is never
renumbered or reused; a retired diagnostic leaves its number retired, and a new diagnostic always
gets a new one. Codes print in every `error[TFxxx]: …` line, so they're what a CI grep filter, a
bug report, or a search engine query anchors on — this appendix exists so that lookup doesn't
require reading the source.

| Code | Meaning | Example |
|---|---|---|
| `TF001` | Lexer: a character that cannot begin any token. | `let y = $oops` → `unexpected character "$"` |
| `TF002` | Lexer: a string literal has no closing quote before end of line. | `test "open string` |
| `TF003` | Lexer: indentation does not line up with any enclosing block. | a dedent that lands between two open indent levels |
| `TF010` | Parser: a token appeared where the grammar didn't allow it (the catch-all "unexpected token" code — covers many distinct shapes: a missing path after `api GET`, a multi-word call missing its parens, a malformed table row cell count, etc.). | `api GET` (no path) → `expected a path like `/orders`, found end of line` |
| `TF011` | Parser: an unrecognised statement keyword where a step was expected. | `expct status equals 200` → `did you mean `expect`?` |
| `TF012` | Parser: an unknown HTTP method after `api`. | `api FETCH /health` → `did you mean `PATCH`?` |
| `TF013` | Parser: an unrecognised `expect`/`capture` subject. | `expect statuss equals 200` → `did you mean `status`?` |
| `TF014` | Parser: an unrecognised matcher after a subject. | `expect status eq 200` → `did you mean` one of `equals, contains, matches, is …, has …` |
| `TF015` | Parser: a `test`/`action`/hook block has no indented body. | a `before file` block with no steps under it |
| `TF016` | Parser: top-level content that isn't a `test`/`action`/`import`/`use`/`before`/`after`. | a bare `expect …` line outside any block |
| `TF020` | Parser (config): an unrecognised key inside a config block. | `headr "Accept" is "…"` → `did you mean `header`?` |
| `TF021` | Parser (config): a `test` appears in the declaration-only config dialect. | `test "not allowed here"` inside `tflw.config` |
| `TF022` | Parser (config): top-level config content that isn't `defaults`/`env`/`session`/`require`. | `workers 3` at the top level of `tflw.config` (belongs inside a block) |
| `TF023` | Parser (config): a duration with an unknown unit. | `timeout step 5x` → `expected ms, s, or m` |
| `TF024` | Checker (config): more than one `env` marked `default`, or a duplicate env name. | two `env … default` blocks in one `tflw.config` |
| `TF025` | Checker (config): a key used in the wrong block. | `web "…"` inside `defaults` (belongs in an `env` block) |
| `TF026` | Checker: an `api <service>`/`wait until api <service>` name not declared in the active env — checked in test/action/hook bodies **and** inside `session` blocks (decision 66). | `api billng POST /auth/login` → `did you mean `billing`?` |
| `TF027` | Checker: a `{col}` reference not among an inline `with each` table's declared columns. | referencing `{prcie}` when the table's header column is `price` |
| `TF028` | Checker: a `test … as <session>[, <session>...]` name not declared by any `session` block — one diagnostic per unknown name. | `test "…" as ghost` with no `session ghost` declared |
| `TF029` | Checker (config): a duplicate `session` name. | two `session admin` blocks in one `tflw.config` |
| `TF030` | Checker: a `{var}`/bare-identifier reference provably never bound anywhere reachable in its scope — conservative (decision 57): only flags a name that's *definitely* unreachable, never one that merely might be. | `capture body.ok as orderId` then `api GET /orders/{orderid}` → `unknown variable "orderid"`, did-you-mean `orderId` |

Gaps in the numbering (`TF004`–`TF009`, `TF017`–`TF019`) are reserved, not skipped by accident —
they were never assigned to a diagnostic, so they stay open for a genuinely new one rather than
being backfilled to look tidy (backfilling would violate the stability rule in spirit even though
no code would be reused). Matcher↔subject compatibility (e.g. a UI-only matcher against an API
subject) is intentionally **not** a checker diagnostic yet — it surfaces as a runtime error, a
documented gap (§1, decision 57).
