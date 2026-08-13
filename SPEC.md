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
(`insecure` key + teaching errors). The browser half (M3, internal milestone label `0.2.0`) has
since shipped in full (M3a–M4b) along with the reuse pass (M6) and acceptance (M7) — see §15 and
`PLAN.md` decision 112 for the current versioning story: `1.0.0` is the actual first publish,
gated on the perf and pentest arcs too, not on the browser-era verdict alone. Build order was
API-first: the API vertical slice built and dogfooded before any Playwright/browser code.

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
it only ever flags a name that's *definitely* unreachable, never one that merely *might* be.

**Matcher↔subject compatibility (M97b, `TF042`)** is checked, over the subject's *kind* and no
further. A UI-only matcher against an API subject (`expect status is visible`) is a checker error;
so is an `any`/`all` quantifier on `matches schema`/`matches file`, which judge the subject whole.
What is deliberately **not** checked is the subject's *shape*: `contains` applies to "strings,
arrays" (§6.2), but whether `body.msg` is either cannot be known before the response exists, so
that stays a runtime error — and a captured value is never held to a stricter standard than the
response it came from. The rule reads `MATCHERS` directly, so §6.2's table and the checker are one
statement rather than two that can drift. (This was a documented gap until M97b; §17's `TF042` row
carries the detail.)

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
  report/              # per-run report.html + junit.xml + results.json + .last-run.json (output)
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
  viewport 1280 720

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
- `timeout step` (per-request, and per browser-step locator resolution, M3a), `timeout wait`
  (`wait until api`, and since M3b `wait until <ui condition>`, §9.5), and `timeout expect` (a UI
  `expect`/`check`'s retry budget, M3a — still inert for a plain API `expect`, which evaluates once
  and fails fast, P#15) are all consumed today.
- `insecure true` — a per-env (or `defaults`) key that disables TLS certificate verification for
  the whole run, for self-signed/private-CA staging certs (PLAN decision 78). Explicit and
  greppable in review; a run with it active carries a visible warning in the CLI summary and the
  report header — never a silent trade-off. See §3.5 for the full corporate-networks story.
- `viewport <width> <height>` (M3c, D11, §9.6) — browser window size in px for every new context;
  `defaults`-only (a run-level browser setting, like `workers`/`report`, not one that varies per
  env). Omitted: Playwright's own default (1280×720) applies.
- `api "tflw://demo"` — **tflw's own bundled demo service** (M118, `FU-04`, D198–D203), what
  `tflw init` scaffolds so that a first `tflw run` is green in an empty directory with nothing
  installed and nothing running. `tflw run` starts it as a child process on an ephemeral loopback
  port, substitutes the real address everywhere before a single test executes, and stops it on every
  exit path; `tflw check` never starts it (no I/O, P#75). It answers `GET /health` → `200
  {"status":"ok"}` and 404s everything else with a hint naming the file to edit — it is a fixture for
  the quickstart, not a mock server. A demo run is labelled in the CLI summary and the report header
  for `insecure true`'s reason: a green run that proves nothing about the reader's system must never
  look like one that does. `tflw://` is reserved; no other address under it resolves.

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
- A test opting in with `test "…" as admin` (§4.1) starts with the session's declared headers and
  cookie jar applied to its **api** steps.
- **A session does not log the browser in.** Its cached state is never applied to the test's fresh
  browser context — a cookie jar and a browser context's storage state are two separate
  representations, and D10 deliberately never bridges them (§10). A mixed UI+API test establishes
  identity twice: an API login for the api steps, a UI form login for the page. Until B4-07 this
  bullet claimed the opposite, in the section where a reader looks for it, while §10 stated the
  truth and called it deliberate — of the two, §10 was the one describing the shipped tool.
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
  other name first. Both stay identical regardless of `--parallel N>1` concurrency (fixed in M2.65,
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
  `Max-Age <= 0` deletes the cookie immediately, same as a real logout. Every hop of a redirect
  chain counts, not just the response that finally answered — the commonest login shape sets its
  cookie on the `302`.
- Cookies are **scoped by origin** (`scheme://host:port`), and filed under the origin that *set*
  them, which after a redirect need not be the one the step named. A cookie the app under test
  issues is therefore never replayed to a second `api <name>` service on another host or port —
  including the case where both names in `env` point at one app (`api` and `api root`), which is
  one origin and one jar. `Domain=` is honored and matched against the setting host, so a cookie
  issued by `login.example.com` for `Domain=example.com` still reaches `api.example.com`; a
  `Domain=` the setting host does not itself belong to is narrowed to that host rather than
  dropped.
- The jar auto-attaches a bare `name=value; name2=value2` `Cookie` header to every subsequent
  request to that origin in the same scope — no `capture`/`header` replay needed, and no risk of
  the newline-joined multi-`Set-Cookie` capture (§5.4) landing in a `Cookie` header value, which
  real HTTP clients reject outright. When a request goes out with no `Cookie` header *because* the
  jar's cookies belong to a different origin, its step line says so — an informational trace note,
  never a failure.
- A test opting into `as <session>` starts with a **clone** of that session's own jar, not the live
  instance — the test's own subsequent cookie updates never leak back into the session cache
  (shared for the run's lifetime) or into a concurrently-running sibling test under `--parallel
  N>1`. Opting into **several** sessions (`as admin, userA`) clones and merges every one of their
  jars into the test's one starting jar, in listed order — same later-wins-per-name rule as the
  header merge above. An action call shares its caller's live jar (same as `rng`/`redactor`).
- An explicit per-step `header "Cookie" is …` still overrides the jar entirely (the escape hatch
  is never removed) — precedence is config headers → session headers (already merged across every
  opted-in session, if more than one) → jar (already merged the same way) → per-step headers, each
  later source replacing rather than appending.
- Still deliberately narrower than a real browser's jar: no `Path` scoping (it would partition
  *within* an origin, which is exactly the `api`/`api root` split origin scoping is written to
  keep together) and no `Secure`/`HttpOnly`/`SameSite` enforcement (those constrain a *browser*
  deciding whether to attach a cookie to a browser-initiated request; a test client deliberately
  replays whatever the server just told it to remember) — a closed, smaller feature set on
  purpose (P#13).

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
- **Relative paths in a session body resolve against `tflw.config`'s own directory**, not against
  the test file that happened to trigger the session. This is the one deliberate exception to the
  "relative to this file" convention `matches file`/`body from`/`upload`/`snapshots` otherwise
  follow (§9.9 states that convention for snapshots), and it exists because a session has no test
  file: it is declared once in `tflw.config` and shared by every file that says `as <name>`.
  Resolving it against the caller would make one config line mean a different file per test file,
  decided by run order — so
  `body from "./creds.json"` in a session is always the `creds.json` sitting next to the
  `tflw.config` you wrote it in, whichever suite, file, or worker establishes the session.

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
  ordering windows are closed (fixed in M2.65, decision 56). `report/events.ndjson` (§13) is
  re-walked through that same pass before it is written (M63) — it is a persisted artifact, built
  after the run, so it gets the fully-populated redactor like every other file in `report/`. The
  one thing that pass cannot reach is the **live** `--format ndjson` stdout stream: a line is
  already out of the process by the time a later `env()` reveals the secret, so a stream consumer
  that reads stdout directly sees only per-step redaction — read `report/events.ndjson` instead
  when that difference matters.

A value shorter than `MIN_REDACTABLE_LENGTH` (6 characters) is never registered for substring
redaction — a short/common secret (a numeric ID, a port number) would otherwise blot out every
matching substring anywhere in the report, including unrelated fields (PLAN decision 64). **A run
that skips a value for this reason says so**, naming the variables (never their values) in the CLI
summary and in `report.html`'s header, beside the `insecure: true` banner and for the same reason —
declining to protect something you were told is a secret is not a silent trade-off:

```console
⚠ unmasked secret: SHORTPW — shorter than 6 characters, so too short to mask without corrupting
unrelated report text; its value appears in full above and in report.html
```

An empty/unset variable is not named (there is nothing to hide), and neither is a name that *also*
carried a maskable value somewhere in the same run — pointing a reader at a name that is in fact
masked in the report they are holding would be worse than saying nothing. If two
different `require env` vars (or a secret and a coincidentally-equal generated value) hold the
same string, the redactor tracks every name registered for it and renders all of them —
`•••(NAME1|NAME2)` — rather than silently keeping only whichever registered first (PLAN decision 72).

**Declarative position redaction — `redact` (PLAN decision 101d, enterprise arc cluster 2;
widened by FS-03).** The secret redaction above is *value-based*: it only ever masks something that
actually entered via `env(...)`. `redact` is a separate, *position-based* mechanism for masking a
named JSON field, header or query parameter regardless of where its value came from — a response's
`email`/`address`/`ssn` field is PII whether or not it's ever read through `env(...)`, and an
`Authorization` header is a credential whoever minted it:

```
env staging
  api "https://staging.example.com"
  redact body.email, body.*.address
  redact header "Authorization", header "X-Api-Key", query "token"
```

- A pattern names one of three roots:
  - **`body`** — the request or response JSON body, followed by `.prop` segments and/or a `.* `
    wildcard segment (matches every key of an object, or every element of an array — both are plain
    JS values from `JSON.parse`'s point of view, so one wildcard form covers both).
  - **`header "<name>"`** — one request *or* response header, matched **case-insensitively** as HTTP
    header names are. `redact header "*"` masks every header.
  - **`query "<name>"`** — one URL query parameter. Only the parameter's **value** is masked; the
    origin, path, other parameters and the parameter's own name all survive, so the report can still
    say which request this was. Parameter names are matched case-sensitively (unlike header names,
    query parameters are). `redact query "*"` masks every parameter's value.

  Header and query names are **quoted strings**, matching every other header-name site in the
  language (`header "Accept" is …`, `expect header "content-type" …`, `capture header "location"
  as …`) — and necessarily so: identifiers cannot contain the hyphen that `X-Api-Key`/`Set-Cookie`
  need. There is deliberately **no bare `redact url`**: masking a whole URL destroys the report's
  ability to identify a request, and `query "<name>"` is the precise form.

  Patterns accumulate across `defaults` + `env`, like `allow hosts` (§3.7) — not override semantics.
- **`redact` means "this value is a secret", not "this position is masked" (FS-03).** A
  `capture` whose subject is a covered position (`capture body.accessToken as token` under `redact
  body.accessToken`, or `capture header "x-auth-token" as t` under `redact header "x-auth-token"`)
  **registers its value with the taint redactor above**. From then on that value is masked wherever
  it later appears in any file sink — a subsequent request's URL, a `log` line, another step's
  detail text — and the end-of-run full-report pass catches occurrences written before the
  `capture` ran. Without this, naming a position masked it in exactly one place and then let the
  same bytes flow onward unmasked one step later. The `MIN_REDACTABLE_LENGTH` floor (§3.4) still
  applies, and only string/number values are registered — substring-replacing an object's
  `[object Object]` would mask unrelated text and hide nothing.
- Applied to the request/response **report-only** trace — the same `redactRequest`/
  `redactResponse` boundary every step already routes through, right after the secret redactor
  above and right before the evidence-level trim (§13) — *and*, since gap #15 (TFLW-GAPS.md,
  fixed in tflw 0.1.0), to a `capture`/`expect`/`check` step's own rendered detail text when its
  subject is a plain (non-quantified) `body.<path>` or `header "<name>"` covered by a pattern:
  `capture body.phone as p`
  renders `p = [redacted] (captured)` instead of the real number, and `expect body.phone equals
  "..."` masks whichever side of the message carries the real response value — even on a *passing*
  assertion, where the shown "expected" text is the real value by construction (`actual ===
  expected`). In every case, `expect`/`capture` still **see** (evaluate against) the real,
  unmasked value — only what's **rendered** into `report.html`/`junit.xml`/the CLI line is
  affected; a later step reading a captured variable gets the real value regardless of whether its
  own capture line was masked. Quantified (`any`/`all`) assertions are a known, deliberate
  exception — the per-element path that actually matched isn't known statically the way a plain
  subject's is — so their messages are never masked, whatever `redact` patterns are configured.
- Best-effort: a non-JSON body, or a pattern that matches nothing in a particular body, passes
  through unchanged (no attempt to force JSON parsing, no crash). A matched leaf is replaced with
  the literal string `[redacted]`. The `capture`/`expect` detail-text masking above is a plain
  substring replace of the value's own rendered text (not a JSON-structure rewrite, since a step's
  detail is already a sentence, not a document) and — matching the secret redactor's own
  `MIN_REDACTABLE_LENGTH` reasoning (§3.4 above) — skips a value shorter than 6 characters, so a
  short redacted field (e.g. a 4-digit PIN) doesn't blot out unrelated short substrings elsewhere
  in the same message.

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
  duration (reference-counted so `--parallel N>1` files sharing the same active env can run this
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
- A relative `cert`/`key` resolves against **`tflw.config`'s own directory** — the same rule as a
  session body (§3.3), and for the same reason: these are config keys, not test-file keys, so the
  example above means `<the directory holding tflw.config>/certs/client.pem` no matter which test
  file's request is presenting the certificate.
- `insecure true` (above) and `NODE_EXTRA_CA_CERTS` both still apply on an mTLS-configured env,
  read fresh on every connection rather than cached at the first one — deliberately more defensive
  here than Node's own default behavior for these two env vars, which are otherwise read only once
  per process.

### 3.7 Host allowlist — `allow hosts` (PLAN decision 101a, enterprise arc cluster 2) ✅

An "anti-pointed-at-prod" guardrail: refuse to send a request to any host not explicitly listed.

```
defaults
  allow hosts "api.example.com", "*.staging.example.com"

env staging
  api "https://staging.example.com"
  allow hosts "billing-staging.example.com"
```

- Accumulates across `defaults` + `env` (like `header` — not override semantics like `insecure`):
  a baseline list in `defaults`, extended per env. Never declaring `allow hosts` anywhere means no
  enforcement at all — unrestricted, the unchanged default.
- A pattern starting with `*.` matches that suffix or the bare domain (`*.example.com` matches
  both `api.example.com` and `example.com`); anything else must match the hostname exactly.
- Enforced *before* any network I/O — a violating request throws immediately, no connection ever
  attempted, not just a request that then fails. Covers every real network call a run makes
  (M85, review cluster C1), on every path:
  - every `api` step, on all three client paths (pooled `fetch`, the workload-pinned client, and
    the mTLS worker), and the `oauth2` session sugar's (§3.3) client-credentials token request and
    a `matches schema … from "…"` contract fetch (§6.4);
  - **every hop of a redirect chain**, not just the URL the step names. A 3xx to an unlisted host
    is refused rather than followed — the whole point of the guardrail is the case where an
    allowlisted staging host hands the run to prod, and the target is chosen by the server, not by
    the test;
  - **every request the browser half makes** (§9) — navigations *and* the page's own subresource/
    XHR calls, since the modern shape of accidentally testing against prod is a staging page whose
    bundle calls a prod API. A `stub`bed request (§9.6) is fulfilled locally and never reaches the
    network, so it is not subject to the list.
- A `tflw check` error (`TF036`, §17) when the **active** env's own `api`/`web` base URL has a host
  its own accumulated list doesn't match — a contradiction decidable from the config alone
  shouldn't cost a run to discover. Scoped to the env actually selected (`--env`/`TFLW_ENV`, else
  the `default` one), like every other config-level check: an env you did not select is not this
  run's problem, and a suite may deliberately keep a blocks-everything env as the negative-case
  fixture proving this guardrail works.
- Declaring the key changes how requests are made, not only whether they're allowed: redirect
  chains are then followed hop-by-hop rather than by `fetch` itself, and browser requests are
  routed through an interception handler. Both are opt-in with the key and both are held to the
  unguarded behavior by tests; a run that never declares `allow hosts` is byte-for-byte unaffected.
  What a hop-by-hop chain *decides* is held to the unguarded path too, and deliberately so: until
  M88a, declaring this key flipped a redirect-loop test from failing to passing (§5.1's 20-hop cap),
  which made a security directive a change of verdict. A guardrail may change how a request is made;
  it may never change what the test means.

### 3.8 Logging defaults — `log destination`/`log level` (M27, PLAN_LOG.md) ✅

Defaults a bare `log "…"` statement (§7.7) resolves against, so most tests never need to name a
destination/level explicitly.

```
defaults
  log destination "console"
  log level "warn"

env ci
  log destination "html"
```

- `log destination "console"|"html"|"both"` — where a `log` call with no `to …` clause ends up.
  Default `"both"` when never declared.
- `log level "debug"|"info"|"warn"|"error"` — the minimum level a `log` step must clear to be
  *rendered* in console output/`report.html`; never affects whether it's *recorded* (`results.json`/
  `--format ndjson` always carry every `log` step, regardless of level or destination — §13).
  Default `"debug"` (show everything) when never declared.
- Override semantics like `evidence`/`insecure` (env wins over `defaults`), not accumulating like
  `header`/`allow hosts`.
- `--log-output`/`--log-level` (§12) override these for one run; `--log-output` only ever reaches a
  bare `log "…"` call, never a statement's own explicit `to …` clause.

### 3.9 Test discovery — `exclude` (D127, PLAN_DISCOVERY_EXCLUDE.md)

```
exclude "tflw-acceptance", "fixtures/broken"
```

- Top-level, like `require env` (§3.4) — not a `defaults`/`env` entry. Declares one or more paths,
  relative to this `tflw.config`'s own directory, that `tflw run`/`check`/`migrate`/`watch`'s bare
  (no-file-args) discovery must never descend into — for a nested tree that's really a second,
  independent suite with its own `tflw.config` (different sessions/envs), so it shouldn't be swept
  into the root's default run.
- Only affects bare discovery. An explicit file path given on the command line always runs, even
  if it lives inside an excluded directory — `exclude` narrows the *default* file set, it isn't a
  hard deny.
- Matches by exact relative-path equality at any depth, not a glob — `exclude "a/b"` matches
  whatever sits literally at `a/b` under the config's directory. **A directory or a single `.tflw`
  file** — a directory is not descended into, a file is not collected. (Before B6-10 the equality
  test only ran on directory entries, so `exclude "b.tflw"` was silently nothing, which the word
  *paths* above never suggested.) Always written with `/`, on every platform. A path that doesn't
  currently exist (typo, or excluding a not-yet-created directory) is silently a no-op, same
  tolerance a `.gitignore` line has for a pattern matching nothing.

### 3.10 Authorized targets — `authorized target` (M128b, D21/D291) ✅

```
defaults
  authorized target "https://localhost:8443" reason "self-hosted test fixture"

env staging
  api "https://stg.example.com"
  authorized target "https://stg.example.com" reason "our own staging, sign-off in TICKET-4412"
```

- **Required before any security assertion (§9.10).** `expect response has no … security
  violations` against an env whose `api` base URL no declaration names is `TF060`, a checker error.
  This is layer 2 of the D21 safety model, and it is enforced from the milestone that introduces it
  rather than from the one that first sends a probe — shipping a safety control that nothing
  exercises is not shipping a safety control.
- **Named, never a wildcard.** `authorized target "https://*.example.com"` is `TF061`. This
  declaration is not an allowlist: it is an author affirming, in writing, that they are permitted to
  point a scanner at one named host, and nobody is authorized to scan `*.com`. A bare hostname with
  no scheme is the same error one step earlier — matching is by **origin** (scheme + host + port),
  so `staging.example.com` authorizes nothing, and `https://x.example.com` does not authorize
  `https://x.example.com:8443`, which may be a different team's listener.
- **`reason` is required and is the point.** It is printed in the CLI summary and embedded in
  `report.html`, so every artifact a run produces records the claim that permitted the scan. A
  declaration without one would be a checkbox.
- **No loopback or private-address exemption.** D21 layer 3 does treat those as lower-risk, but
  exempting them here would exempt precisely the target this arc is tested against, shipping the
  requirement untested.
- Accumulates across `defaults` + `env`, like `allow hosts` (§3.7) — not override semantics.
- **Deferred to the milestone that first sends a probe** (Tier 3): the public-target CLI flag that
  cannot live in config, per-class destructive opt-in, and default throttling. Those guard a threat
  that does not exist yet.

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
- **The three header modifiers — `as <session>...` (§3.3), `retry N` (§4.4), `parallel`/
  `sequential` (§4.5) — may appear in any order, each at most once.** They are independent
  attributes of the test, not a sequence: `test "x" retry 2 as admin` and `test "x" as admin
  retry 2` are the same test. Repeating one is an error naming it (several sessions go in a single
  comma-separated `as` clause; `parallel sequential` contradicts itself), rather than the last one
  quietly winning. Before A2-06 the order was fixed and undocumented, and getting it wrong reported
  the valid keyword as unexpected.
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

**Several hooks of the same label share one scope, in declaration order** — two `before file`
blocks run one after the other against a single scope, so a `let` in the first is visible in the
second. **`before file` and `after file` do not share with each other**: they are two separate runs
of that scope, so a `let` bound in `before file` is not readable in `after file` (use a `session` or
an `action` for that too). The same holds for each-scope `before`/`after`, which additionally share
with the test they wrap. This paragraph is new in M97b: the spec had been silent on both points,
and `A4-05` — the checker rejecting a valid second `before file` — happened in that silence.

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
  name; the checker warns when the file is not there (`TF043`, M97c; a warning rather than an error
  since M97e/D147 — the table is read when the test runs, so a hook or a build step may still
  produce it, and predicting otherwise made valid suites unrunnable). It does **not** check that the
  columns a test reads exist: unlike the inline form, they aren't known until the file is read, and
  a `stat` doesn't read it. That half of this sentence used to be here and was never implemented.

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
count, not step-level detail; that detail lives in report.html. The final attempt is labelled with
its own verdict — `attempt N of N — passed` or `— failed` — so a test that exhausted its budget
failing is never shown a green badge inside a panel marked failed (`FU-16`'s neighbour, M125d).

The CLI summary says how many attempts ran whenever more than one did: `✗ always fails (2 attempts)`.
It is suppressed on a `flaky` pass, where `(flaky)` already states the same fact more usefully — that
a retry *saved* this test, rather than merely that retries happened (`FU-25`, M125d). A test that ran
once carries no count at all.

### 4.5 Load testing — workload-bearing tests (M29/M30, M50-M56, D16-D19/D24a/D26/D70/D93-D122)

A `test` becomes **workload-bearing** the moment its body contains one workload line — no separate
keyword (`scenario` existed through M30, removed in M50, D93-D96): kind is inferred purely from
whether a workload clause is present. A workload-bearing test runs as a per-VU loop instead of one
single-shot pass, with pass/fail decided once, after the run, by its `threshold` lines against the
run's aggregate metrics — not by any single iteration's outcome.

```tflw
test "checkout under load"
  ramp to 50 users over 30s
  api POST /cart/checkout body { productId: "widget-1", qty: 1 }
  expect status equals 201
  threshold p95 duration is less than 800ms
  threshold error rate is less than 1%
```

- **5 workload kinds**, each with a closed (`users`) and open (`rps`) variant (D97/D98):
  - `ramp to N users|rps over <dur>` — linear ramp from 0 to the target over `<dur>` (D17).
  - `hold N users|rps for <dur>` — a flat target for the whole duration, no ramp-in.
  - `step users|rps` / `spike users|rps` — an indented block of stage lines: `step`'s `to N for
    <dur>` lines are a staircase of instant jumps, each held for its own duration; `spike`'s `hold
    N for <dur>` (flat) and `to N over <dur>` (ramped) lines can mix in any order, for a
    baseline → burst → recovery shape.
  - `run N iterations across M users` / `run N iterations per user across M users` — count-bounded,
    no duration: a shared pool of `N` total iterations, or each of `M` VUs running its own fixed `N`.
    The count is exact and independent of `--workers` (§12): spreading the run over more generator
    processes than there are VUs changes how the iterations are distributed, never how many run.
- **None of those five words is reserved** (FS-06). `ramp`/`hold`/`step`/`spike`/`run` lead these
  clauses, but an `action run checkout(id)` stays callable as `run checkout("1")` — a leading
  keyword never reserves that word for an action name, and disambiguation is always by what follows
  (§8).
- **Closed (`users`) vs. open (`rps`).** Closed loops VUs continuously — under saturation a VU
  simply completes fewer iterations, which understates latency ("coordinated omission"); tflw's own
  back-off diagnostic (D17) flags a run whose VUs spent a large share of wall time waiting instead
  of iterating. Open schedules new iterations at a target arrival rate regardless of whether earlier
  ones have finished — queues build under saturation instead of silently disappearing, the only
  model that honestly validates an SLA. The 2 iteration-count kinds skip the back-off diagnostic
  entirely (D102) — there's no duration to divide by, so it's structurally undefined, not withheld.
  **Both models send over the same HTTP client** (M121/D206), so the durations they report are
  comparable: a difference between a `hold N users` run and a `hold N rps` run against one endpoint
  is a fact about the target or the load shape, never about how tflw issued the request. Until M121
  that was not true — the open model used a different client and, on Node 26, reported the
  inter-arrival gap as service time.
- **The back-off diagnostic needs a flat target** (D-M107-1). It compares the run's first half
  against its second, which reads as "the target slowed down" only when the two halves are otherwise
  alike. Under a rising target they are not — a `ramp to N users over M` runs its second half at
  roughly 3× the concurrency of its first, and every finite-capacity system answers more concurrent
  work more slowly. Measured against a *healthy* service, `ramp` warned on 8 runs out of 8, scoring
  higher than a genuinely degrading service did. So the diagnostic applies to `hold users`, and to a
  `step`/`spike users` that names one target throughout; for `ramp users` and any changing-target
  `step`/`spike` it is **absent, not `false`** — the same rule the open model and the count-based
  kinds already follow. **To measure degradation, hold at the level you care about**: a ramp finds
  capacity, a hold finds deterioration.
- **`threshold <metric> [for "<label>"] is less than|greater than <value>`** — `p50`/`p90`/`p95`/
  `p99 duration` (a duration value) or `error rate` (a percentage). `for "<label>"` scopes the
  threshold to one `api` step's identity within the same test (its explicit `as "<label>"` tag, or
  its automatic `METHOD path.raw` identity when untagged) instead of the whole test's iterations
  (M43, D70; checker-enforced resolution — `TF034`).

  **A duration threshold reads only the iterations that succeeded** (M89a, `B3-02`, D-M89-0); an
  error-rate threshold reads every iteration, which is its whole job. The asymmetry is deliberate:
  a failing request is usually *fast* — an instant 5xx, a refused connection — so pooling failures
  into a percentile drags it down, and a latency threshold then passes precisely *because* the
  target is broken. A run of 1000 iterations at a 96 % error rate reported `p95 2ms ✓ < 100ms`,
  `PASS`, exit 0. The console prints both populations whenever anything failed, labelled, and
  `results.json` carries the successful-only one as `metrics.successful` alongside the unchanged
  all-iterations `metrics.durations`. The same rule applies to a `for "<label>"`-scoped threshold,
  reading that endpoint's own successful requests.

  **With zero successful iterations there is no percentile**, so a duration threshold reports
  `actual: null` — rendered `no successful iterations` — and **fails** (M89a, D-M89-1). Reporting
  `0` was rejected: it reads as a passing 0 ms result that never happened, and would make "every
  single request failed" the easiest possible way to satisfy a latency threshold.

  **At least one `threshold` is required** on a
  workload-bearing test (M60/A4-01, `TF033`): the verdict is decided only by thresholds, so a test
  that declares none can never fail — a 100% error rate reported `✓`, `PASS`, and exit 0. To run a
  workload for the numbers alone rather than to gate on them, declare a deliberately loose one.

  **A `duration` threshold additionally requires an unscoped `error rate` threshold** (M89c,
  `B3-14`, D-M89-6, `TF033`). Requiring *a* threshold does not meet M60's own stated goal, because
  a duration threshold structurally cannot observe failure: it reads the successful iterations
  (above), so a target failing half its requests fast and serving the rest in 12 ms satisfies
  `p95 duration is less than 5000ms` while the run reports a 50% error rate. The pairing must be
  the **unscoped** form — `threshold error rate for "x"` bounds one endpoint's bucket and leaves
  every other endpoint in the scenario free to fail, so accepting it would cover one side of the
  rule and not the rule. A scoped error-rate threshold remains legal *in addition*.

  This makes an error-rate threshold **present, not meaningful**, and the limit is stated rather
  than papered over: `is less than 100%` satisfies it vacuously, and an `api` step carrying no
  assertion can never fail, so the rate it bounds is structurally `0.00%` whatever the server
  returns (`B3-17`). Neither is statically decidable — a body with no `api` step at all is a legal
  workload, and a JS-helper throw is a real failure the checker cannot see — so the rule is a
  prompt, not a proof.
- **`cleanup`** — a bare line opting this workload-bearing test back into running the file's
  `after each` hook on *every* iteration. Default: skipped — running teardown thousands of times
  would double request volume and pollute the very latency numbers the run exists to measure (D26).
- **`parallel`/`sequential`** — a header modifier (`test "name" [as <session>...] [retry N]
  [parallel|sequential]`, one of the three that may follow a test name **in any order**, each at
  most once — A2-06) controlling this test's execution
  relation to its file-siblings, functional or workload-bearing alike (D105) — not a
  workload-specific concept. Default `sequential`: blocks whatever comes before and after it. A
  maximal run of *consecutive* `parallel`-marked tests forms one concurrently-executed batch
  (D109): `A, B(parallel), C(parallel), D` executes as `A -> (B and C together) -> D`. Display order
  in the report is always declaration order, independent of completion order (D112). See the
  [load testing guide](/guide/load-testing) for the worked multi-test example and how this
  interacts with `--workers`/`--skip-workload` (§12).
- **Checker-enforced exclusivity (D96, `TF033`).** `retry`/`with each` can't coexist with a workload
  on the same test — a load test's own iterations already provide repetition, and it has no
  per-row cases, only per-VU ones. `pause <dur>` / `pause <dur> to <dur>` (per-iteration pacing,
  excluded from a `duration` threshold; spelled `think` before FS-05) is legal only inside a
  workload-bearing body; a browser
  step is rejected inside one (a browser VU is ~50-100MB, infeasible at load-test scale). Both of
  those two bans follow calls into an `action` since M60 (A4-02) — the diagnostic lands on the call
  site, because the same action is legal under a workload and illegal outside one, so only the
  caller's context decides. Two workload-bearing tests in one file can't share a name — the name
  keys the report's per-test metrics/threshold breakdown (M30, D29).
- **The removed `scenario` keyword (D103, `TF033`).** `scenario "…"` is now a hard parser error
  naming its replacement directly: write `test` instead. It is a one-word rewrite — the workload
  line the block needs is already there, since the old grammar made one mandatory — and `tflw
  migrate` applies it for you (§12). This sentence used to end *"a one-line mechanical rewrite, no
  migration flag needed"*, which was true about the size of the edit and wrong about the tool
  (`A3-OS-07`); the brace form it showed is itself a parse error in an indentation-based language.

Reporting (M56, D116-D122): a workload-bearing test's result renders inline in the same
`report.html`/`junit.xml`/`results.json` as every functional test, in file-declaration order —
there is no separate `load-*` report artifact. See §17 for `TF033`/`TF034`'s full diagnostic text,
and the [load testing guide](/guide/load-testing) for the console/report shape, `--workers`, the
generator self-diagnosis warning, and Ctrl-C/abort behavior.

**A report states the workload it actually ran (M89b, D-M89-4/D-M89-5).** `results.json`'s
`workload` object is a union discriminated on `shape` — `ramp` (`target`, `overMs`), `hold`
(`target`, `forMs`), `step` (`stages[]` of `{target, durationMs}`), `spike` (`stages[]` of
`{target, durationMs, ramped}`) and `iterations` (`iterations`, `vus`, `perVu`) — with `model:
"closed" | "open"` on the first four. `iterations` carries no `model`: the count-based kinds have
no `rps` form, so the field could only ever hold one value.

It replaced a flat `{kind: "users"|"rps", target, overMs}` that could describe only a `ramp`, into
which the other 8 kinds were squeezed and lost: `hold 4 users for 300ms` and `ramp to 4 users over
300ms` serialized identically, as did a `step` and a `spike` sharing a peak and a span, and the two
count-based kinds — which have no duration at all — reported `overMs: 0` and were rendered as `ramp
to N users over 0ms`, a workload the grammar cannot express. **Every** description of a workload —
the CLI's pre-run `scenario "…" — …` line, the run summary, `report.html`'s panel — is now one
formatter over that one value, so the pre-run line and the summary line are the same string by
construction rather than by two functions agreeing.

### 4.6 Step keyword quick reference (M125e, `FU-24`, D277)

Every word a step line may begin with, in one table. Generated from `packages/lang/src/spec-data.ts`
by `npm run docs:gen -w @tflw/lang` — the same manifest the editor's hover text and completion
`detail` come from, so what an editor tells you about a keyword and what this table says are one
string, not two that agree.

Held to `parser.ts`'s own `STATEMENT_KEYWORDS` (plus the workload directives `parseTestBody`
dispatches) by a two-way parity test: a row here for a word the parser rejects, or a word the parser
accepts with no row here, is a test failure. The two retired spellings are deliberately absent —
`think` (now `pause`) and `uncheck` (now `untick`) are recognised only in order to be rejected by
name (§17), and documenting them would be teaching a spelling that is itself an error.

<!-- GENERATED:step-keywords:start -->
| Family | Keyword | Syntax | What it does | Example |
|---|---|---|---|---|
| api | `api` | `api [<service>] <METHOD> <target> [body …] [timeout <dur>] [without redirects]` | issue one HTTP request; `<target>` is a path against the env base URL or an absolute URL | `api POST /orders body { name: "Widget", qty: 1 }` |
| api | `wait` | `wait until api <METHOD> <target>` + indented expects, or `wait until <locator> [is] <matcher> [for <dur>]` | re-issue a request, or re-poll a UI condition, until it passes or the wait budget elapses | `wait until button "Submit" is enabled` |
| assertion | `expect` | `expect <subject> [not] <matcher> [value]` | hard assertion — evaluated once against the received response, fails the test immediately | `expect status equals 201` |
| assertion | `check` | `check <subject> [not] <matcher> [value]` | the soft twin of `expect`: records a failure and keeps going. Not the checkbox action — that is `tick` (FS-04) | `check body.total equals 42` |
| value | `let` | `let <name> = <expr>` | bind a value — a literal, a generator, an expression, or a call — for later steps to interpolate as `{name}` | `let email = unique email` |
| value | `capture` | `capture <subject> as <name>` | bind a value off the response; a capture that resolves to nothing fails the step rather than binding `undefined` | `capture body.id as orderId` |
| value | `log` | `log [<level>] "<message>"` | emit one user-authored line into the run log and the report | `log "created order {orderId}"` |
| value | `give` | `give <expr>` | an action's return value; ends its step sequence | `give {orderId}` |
| browser | `open` | `open "<path-or-url>"` | navigate the active page — a path resolves against the env `web` base URL, an absolute URL is the address | `open "/checkout"` |
| browser | `click` | `click <locator>` | left-click the element a locator resolves to | `click button "Add to cart"` |
| browser | `double` | `double click <locator>` | double-click the element a locator resolves to | `double click button "Row"` |
| browser | `right` | `right click <locator>` | right-click (context-menu click) the element a locator resolves to | `right click button "Row"` |
| browser | `fill` | `fill <locator> with <value>`, or `fill form` + an indented table | type a value into one field, or fill several from a table where each row reports as its own sub-step | `fill field "Email" with {email}` |
| browser | `select` | `select "<option>" from <locator>` | choose an option in a `<select>` | `select "Widget" from field "Size"` |
| browser | `tick` | `tick <locator>` | tick a checkbox or radio. Spelled `tick`, not `check` — `check` is the soft assertion and nothing else (FS-04) | `tick field "Accept terms"` |
| browser | `untick` | `untick <locator>` | untick a checkbox | `untick field "Accept terms"` |
| browser | `press` | `press "<key>" [on <locator>]` | send a key press — page-level, or scoped to one locator | `press "Enter" on field "Search"` |
| browser | `hover` | `hover <locator>` | move the pointer over the element a locator resolves to | `hover button "Menu"` |
| browser | `scroll` | `scroll to <locator>` | scroll the element into view | `scroll to button "Load more"` |
| browser | `within` | `within <locator>` or `within frame <locator>` + an indented block | scope nested steps to one container — or, with `frame`, into an iframe's own document | `within list "Cart items"` |
| browser | `accept` | `accept dialog` | arm a one-shot handler accepting the *next* native dialog; without it Playwright auto-dismisses silently | `accept dialog` |
| browser | `dismiss` | `dismiss dialog` | arm a one-shot handler dismissing the next native dialog | `dismiss dialog` |
| browser | `switch` | `switch to new tab` + an indented block, or `switch to tab <N>` | make another tab active — the block form arms the popup listener before running, so a fast tab cannot race past it | `switch to tab 1` |
| browser | `close` | `close tab` | close the active tab and fall back to the previous one; closing the last tab is a runtime error | `close tab` |
| browser | `download` | `download as <name>` + an indented block | run the block with a download listener armed, then bind the download's suggested filename | `download as file` |
| browser | `drag` | `drag <locator> to <locator>` | dispatch a real native drag-and-drop sequence with a genuine `DataTransfer` | `drag text "First item" to text "Second item"` |
| browser | `drop` | `drop file "<path>" onto <locator>` | drop a real file onto a dropzone that has no `<input type="file">` | `drop file "./receipt.png" onto css "#dropzone"` |
| browser | `screenshot` | `screenshot "<name>"` | capture the active page unconditionally; binary evidence, so only captured at `evidence full` | `screenshot "before payment"` |
| browser | `stub` | `stub <METHOD> "<url-pattern>" respond status <N> [body …]` | intercept a matching network request and answer it, without touching the server | `stub POST "/api/payments/**" respond status 500` |
| browser | `pause` | `pause <duration>` | wait a fixed duration. Renamed from `think` (FS-05); a real wait belongs in `wait until`, not here | `pause 500ms` |
| workload | `ramp` | `ramp to N users over <dur>` / `ramp to N rps over <dur>` | linear ramp from zero to the target — makes the test workload-bearing | `ramp to 50 users over 30s` |
| workload | `hold` | `hold N users for <dur>` / `hold N rps for <dur>` | a flat target for the whole duration, with no ramp-in | `hold 20 rps for 2m` |
| workload | `step` | `step users` / `step rps` + indented `to N for <dur>` lines | a staircase of instant jumps, each held for its own duration | `step users` |
| workload | `spike` | `spike users` / `spike rps` + indented `hold N for <dur>` / `to N over <dur>` lines | a baseline → burst → recovery shape, mixing flat and ramped stages in any order | `spike rps` |
| workload | `run` | `run N iterations [per user] across M users` | count-bounded load with no duration; the count is exact and independent of `--workers` | `run 500 iterations across 10 users` |
| workload | `threshold` | `threshold <metric> is less than <value>` | the pass/fail rule for a workload-bearing test — decided once, after the run, against the run's aggregate metrics | `threshold p95 duration is less than 800ms` |
| workload | `cleanup` | `cleanup` + an indented block | steps that run once after a workload finishes, whatever its verdict | `cleanup` |
<!-- GENERATED:step-keywords:end -->

## 5. API steps (P#3, P#7, P#29, P#32, P#33) ✅

### 5.1 Request line

```
api GET /orders?state=open
api POST /orders body { name: {name}, qty: {qty} }
api billing GET /invoices/{oid}
api GET /health timeout 2s
api GET /old-path without redirects
api GET https://status.example.com/v1/health      # absolute — see below (M125b1)
```

Grammar: `api [<service>] <METHOD> <target>[?query] [<body-form>] [timeout <dur>] [without redirects]`,
where `<target>` is either a path (`/orders`) or an absolute URL (`https://host/orders`).

- A **path** is relative to the service's baseUrl in the active env; `{vars}` interpolate.
- An **absolute URL** is the address, and no base URL is consulted or required. Any RFC 3986 scheme
  lexes — which schemes actually work is `fetch`'s question, answered at run time, not the
  grammar's. `{vars}` interpolate here too, including in the host (`https://{tenant}.example.com/x`).
  Three things follow, and all three are checked statically (§17):
  - `--env` does not move the step. That is a legitimate thing to want for a one-off request to a
    second host, and is a **warning** (`TF057`) rather than an error, so that "this step ignores the
    env" is something the file says out loud rather than something a reader has to notice.
  - **Writing an absolute URL opts the suite into declaring where it may reach.** `allow hosts`
    (§3.7) is opt-in and unset means no enforcement — which is the right default for a suite written
    entirely against its env's base URL, because that base *is* the declaration of where it talks.
    An absolute URL is the one form that can reach a host `tflw.config` never mentions, so with no
    `allow hosts` declared anywhere the run **refuses the step** (`TF058` predicts it). With a list
    declared, the ordinary rule applies: the host must be on it.
  - A named `<service>` and an absolute URL on the same step is an **error** (`TF059`): a service
    names the base URL to send to and an absolute URL already is one, so one of the two would be
    silently ignored.
- The same rules hold for `wait until api` (§5.5) and for `open` (§9.1), which resolves against the
  `web` base rather than the `api` one. Through v0.1 `api` rejected an absolute URL outright and
  `open` *concatenated* it onto the `web` base — opening `http://localhost:5173/https://example.com/x`,
  a URL that loads on any SPA with a catch-all route, so the step passed and the run failed later on
  an unrelated assertion (`FU-18`).
- Headers: env/defaults headers apply automatically; per-step extras:
  `header "X-Trace" is "{traceId}"` lines directly under the api step.
  **Both operands interpolate** — the name as well as the value (M102, D176), so
  `header "X-{tenant}-Key" is "{apiKey}"` names the header the run computed. The same holds for a
  `header` line in a `session` block and for `expect header "{name}"`/`capture header "{name}"`,
  where the name is resolved *before* the case-insensitive lookup. Through v0.1 the name alone was
  read literally, which `tflw check` had never agreed with: it binds `{var}`s in a header name and
  reports `TF030` for a typo there, so the checker was validating an interpolation the runtime did
  not perform (`A4-OS-11`).
- `timeout <dur>` overrides the config request timeout for this step only.
- Redirects are followed by default; `without redirects` leaves the 3xx observable (§6.2).
  A redirect that leaves the request's origin (scheme + host + port) drops `Authorization`,
  `Cookie`, `Proxy-Authorization` and `Host` before the next hop; a 301/302/303 that downgrades a
  POST to a bodyless GET drops the body's `Content-*` headers along with the body. These are the
  rules `fetch` and every browser follow, and they hold identically whether or not the step runs
  under a workload — which client a step runs on is a performance decision, never a
  credential-disclosure one (M80).
  A chain that has not reached a final response after **20 redirects** (`fetch`'s own cap) is a
  **step failure**, not a result: the last 3xx is never handed back as if the request had landed,
  because a test asserting on it would then pass against an endless loop. This holds on all three
  client paths and with or without `allow hosts` — the guardrail changes how a chain is walked
  (§3.7), never what walking off the end of one means (M88a, review cluster C2). `without
  redirects` is unaffected: a chain that is never followed cannot be too long.
- `retry honoring "Retry-After" up to N` (PLAN decision 102b, enterprise arc cluster 3, closes
  TFLW-GAPS.md gap #5): a line under the api step, alongside `header`. Re-issues *this one
  request* — not the whole test, unlike `retry N` on `test` (§4.4) — whenever its response
  carries a `Retry-After` header, sleeping the indicated duration before each re-attempt, up to
  `N` extra attempts. Both header formats are honored: whole seconds (RFC 9110) and an HTTP-date.
  A response with no `Retry-After` header, or one that fails to parse as either format, is never
  retried — guessing a wait time is worse than not retrying at all. A retried step's report line
  says so directly: `..., retried 1x honoring Retry-After (waited 2000ms total)`. Not available on
  `wait until api`, which already has its own poll-until-expect-passes retry mechanism.
  ```
  api POST /orders/{orderId}/reviews body { rating: 5 }
    header "Authorization" is "Bearer {userToken}"
    retry honoring "Retry-After" up to 3
  expect status equals 201
  ```

Interpolated `{var}` path segments are percent-encoded (`encodeURIComponent`) before being
concatenated into the URL, so a captured/generated value containing `&`, `#`, `?`, a space, or
non-ASCII characters lands as its own path/query segment rather than corrupting the request (PLAN
decision 62). This only applies to the URL path — a `body from "<file>"` template's `{var}` holes
interpolate the raw value, unencoded, since that's JSON/text content, not a URL.

### 5.2 Body forms (P#32)

| Form | Syntax | Notes |
|---|---|---|
| Inline JSON | `body { name: {n}, qty: random number 1 to 5 }` | small payloads; expressions + generators inside |
| File-backed | `body from "./payloads/order.json"` | file is a template — `{vars}` interpolate; checker warns when a literal path names nothing (`TF043`, M97c; warning not error since M97e/D147 — the file is read at step time) |
| Form-encoded | `form user={u}, pass=env(PW)` | `application/x-www-form-urlencoded` |
| Multipart upload | `upload "./files/img.png" as "avatar"` | Content-Type inferred from the file extension by default (small curated table — images/documents/archives/web text; unrecognized extensions fall back to `application/octet-stream`); optional `type "…"` overrides the inference; may combine with `form` fields (decision 22/M19) |
| Raw text | `body text "plain payload"` | sets no JSON content-type |

Out of v1: binary bodies, GraphQL blocks, XML helpers (P#32).

**`upload`'s Content-Type** (decision 22/M19): `upload "./files/img.png" as "avatar" type "image/png"`
places the optional `type "…"` clause after `as "field"` and before any `form k=v, …` fields. Left
out, the Content-Type is inferred from the file's extension; an unrecognized extension (or no
extension) falls back to `application/octet-stream`, matching pre-M19 behavior exactly. When given,
`type` always wins over inference — useful for a negative test deliberately sending a wrong or
missing type. A non-interpolated `type` literal is checker-validated against a light
`type/subtype` shape (TF032) — a typo check, not an IANA-vocabulary gatekeeper.

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

`status`, `header "<name>"`, `body.<path>` (JSON), `body text` (non-JSON), `body bytes` (binary),
`body csv` (CSV), `body pdf text` (PDF), `duration`, `request` (§6.2.2 — the connection attempt
itself, not the response).

- `body.<path>`: dot/index addressing — `body.items[0].price`. On a non-JSON response, a
  JSON-path expect raises a teaching error pointing at `body text` (P#33).
- `duration`: wall time of the request — `expect duration is less than 500ms`. A regression
  tripwire, not perf testing (P#33).
- `body text`: the raw response body as a string, for non-JSON (text/HTML/XML) responses —
  `expect body text contains "healthy"`. Implemented end-to-end in M2.65 (PLAN decision 51):
  lexer/parser accept `body text` as a subject (`BodyTextSubject` AST node), the interpreter
  resolves it to `response.bodyText`, and it works with `expect`/`check`/`capture` alike.
- `body bytes`: the raw, untouched response body, for binary responses (PDF, image, …) that
  `body text` would otherwise irreversibly UTF-8-corrupt — closes TFLW-GAPS.md gap #17.
  `capture body bytes as x` and `expect body bytes hasCount N` (byte length) work like any other
  subject; the one dedicated matcher is `matches file "<path>"`, a byte-for-byte comparison
  against a file on disk (§6.2.1), since there's no literal syntax for an inline binary value.
  `any`/`all` and every other matcher are rejected on `body bytes` — raw bytes aren't a
  quantifiable array, and `equals`/`contains` have no non-lossy inline literal to compare against
  (only reachable via a *captured* variable, gap #12's existing limitation, not new here).
- `body csv` / `body csv[0].name`: the response body parsed as RFC 4180 CSV (header row required,
  comma delimiter, `""`-escaped quoted fields — closes TFLW-GAPS.md gap #19), addressed via the
  same `body.<path>` machinery — bare `body csv` is the whole parsed array, `body csv[0].name`
  indexes into a row's column. Every matcher works on it like any other array/object subject
  (`equals`/`contains`/`matches subset`/`hasCount`/…), and `any`/`all` extend to it too:
  `expect any body csv.status equals "delivered"`. A malformed row (wrong field count for the
  header) raises a specific `RuntimeError`, not a silent empty/partial result.
- `body pdf text`: text extracted from a PDF response body (closes TFLW-GAPS.md gap #19) — walks
  the `/Pages` tree (every page, not just the first), inflating each `/Contents` stream when
  `/Filter /FlateDecode` is present, and reads the `Tj`/`TJ`/`T*` text-showing operators. A flat
  string subject (no path): lines within a page join with `\n`, pages join with `\n\n`. Scoped to
  PDFs shaped like what a simple PDF writer emits (standard text encoding, no embedded fonts,
  annotations, or images) — a malformed/unparsable PDF raises a specific `RuntimeError`.
- `request`: not response-scoped like the others — judges whether the connection attempt itself
  succeeded (`connects`) or failed (`fails`) before any response existed. Only meaningful with
  those two matchers; not capturable, and can't be combined with a response-based assertion on the
  same request (§6.2.2).

### 5.4 `capture` (P#7)

```
api POST /orders body { … }
capture body.id as orderId
capture header "location" as orderUrl
```

Binds response values to variables usable in later API **and** browser steps.

**A `capture` that finds nothing fails the step** (`A4-06`). An absent header, an absent object key,
an out-of-range index — anything that resolves to no value at all — is an error at the `capture`
itself, not a variable quietly bound to `undefined`: a binding like that reaches later steps as the
literal text `undefined`, and a target that answers `200` to `?v=undefined` would report a green
suite that asserted nothing. `expect` has always failed on the same subject (`undefined` is not
`"1"`); `capture` now agrees with it. An explicit JSON `null` is unaffected — that is a value the
response really carried, and capturing it is meaningful.

An interpolation typo *inside* the subject (`capture header "X-{noSuchVar}" as v`) is caught earlier
still, by `tflw check`, with the same `TF030` `expect` gives for the identical subject.

**`capture` reads the system under test; `let` names a value the test already has.** Both bind a
name, and the split between them is deliberate — it is the provenance distinction the value subject
(§6.1) depends on. `capture` fails when its subject resolves to nothing, because a response that
did not carry the value is a real finding; `let` cannot fail that way, because the test supplied
the value itself. So `capture` does **not** accept a `{variable}` subject: `capture {orderId} as
savedId` is `let savedId = {orderId}` with a second name, and the diagnostic says so.

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

Subjects: API (§5.3), UI (§9.4), and any **bound value** — `{name}`, `{name.path}`, `{name[0]}`.
The matcher set is **closed** (P#13); custom logic goes through the JS escape hatch (§11).

**The value subject** (M96, `FU-11`). A value named by `let`, `capture`, or an `action` parameter
can stand on the left of a matcher:

```
capture body.token as first
api POST /auth/refresh
capture body.token as second
expect {second} not equals {first}          # the token really did rotate
```

Until 0.2 this was the one thing the language could not say. A bound value was legal as an
*operand* (`expect body.total equals {orderId}`) but never as a subject, and the documented
workaround was to route the value through a request `body` field and assert on that — making the
system under test carry back a value the test already had. The rule was enforced by *position*
while the principle it claimed ("assertions are about the system under test") was about
*provenance*: it banned captured values, which are SUT-derived by construction, and permitted
`2 + 2` smuggled through a request body.

Three rules keep the form honest:

- **Braces are required.** `expect n equals 5` is an error, not a value assertion. Seven subject
  keywords (`text`, `status`, `list`, `field`, `page`, `request`, `button`) are also plausible
  variable names, so a bare-identifier rule would make `let text = "hi"` silently assert on a UI
  locator. The diagnostic names the fix.
- **Only an interpolation.** Not a literal, not arithmetic, not a call — `expect 2 equals 2` stays
  ungrammatical. Bind it first: `let sum = {a} + {b}`, then `expect {sum} equals 10`.
- **`capture` does not take one.** `capture {x} as y` is `let y = {x}` with extra steps; `capture`
  reads a *response* (§5.4). See §5.4 for the split.

`any`/`all` extend to it (§6.3), and a value subject needs no preceding `api` step — it reads the
variable scope, not the response. Matchers that need a **live handle** rather than a value are
rejected statically as `TF041` (§6.2).

### 6.2 Matcher table

✅ Every row below is shipped, including the UI-only ones (`has value`,
`is visible/hidden/enabled/disabled/checked`) — M3a (§9.4) added the UI locator subjects that make
them callable.

<!-- GENERATED:matchers:start -->
| Matcher | Applies to | Example |
|---|---|---|
| `equals` | any value | `expect status equals 201` |
| `contains` | strings, arrays | `expect body.msg contains "created"` |
| `matches "<regex>"` | strings | `expect header "content-type" matches "json"` |
| `matches subset {...}` | objects | `expect body matches subset { type: "about:blank", status: 422 }` |
| `matches schema "Name" from "src"` | objects | `expect body matches schema "ProductResponseDto" from "/openapi.json"` |
| `matches file "<path>"` | `body bytes` | `expect body bytes matches file "expected-receipt.pdf"` |
| `is greater than` / `is less than` | numbers, `duration` | `expect body.total is less than 100` |
| `has count <value>` | arrays, UI lists, `body bytes` | `expect body.items has count 3` |
| `has value` | UI fields | `expect field "Email" has value "a@b.c"` |
| `is visible/hidden/enabled/disabled/checked` | UI locators | `expect button "Pay" is enabled` |
| `connects` | `request` | `expect request connects` |
| `fails` / `fails matching "<regex>"` | `request` | `expect request fails matching "certificate"` |
| `was made` | `request to "<url>"` | `expect request to "/api/orders" was made` |
| `has no [minor/moderate/serious/critical] a11y violations` | `page` | `expect page has no critical a11y violations` |
| `has no [minor/moderate/serious/critical] security violations` | `response` | `expect response has no serious security violations` |
| `has no [minor/moderate/serious/critical] authorization violations` | `response` | `expect response has no authorization violations` |
| `matches snapshot "<name>" [mask <locator>]*` | `page`, UI locators | `expect page matches snapshot "checkout-page" mask css ".timestamp"` |
<!-- GENERATED:matchers:end -->

Generated from `packages/lang/src/spec-data.ts` by `npm run docs:gen -w @tflw/lang`
(`scripts/gen-spec-tables.mjs`) — do not hand-edit the rows above; edit the manifest instead.

`not` negates any matcher. `is` is an **optional copula** (FS-08) — it carries no meaning of its
own, and it may sit on either side of `not`, so `is not visible`, `not is visible`, `is visible`
and `not visible` are four spellings of two assertions. **`is not visible` is the canonical one** —
it reads as English. Before FS-08, `is` was a matcher keyword rather than a copula and `not` was
consumed ahead of it, so `not is visible` was the *only* negated state spelling that parsed: this
section's own documented example (`not visible`) was a `TF010`, and so was the spelling everyone
actually reaches for. For UI, a negated state matcher retries until the condition holds (P#15) —
`expect text "Spinner" is not visible` polls until the spinner is gone rather than failing on the
first look.

There are **no negated state words**: `invisible`, `unchecked`, `unhidden` are not matchers, and
writing one is an error that teaches `not <state>` (M61). This is a diagnostic the language owes
you rather than a nicety. Every negated spelling a user reaches for is exactly one edit from its
own *positive* twin and further from anything else, so a plain did-you-mean answered
`expect button "Go" is invisible` with "did you mean `visible`?" — and following the suggestion
produced a green test asserting the exact opposite of what was written. Edit distance cannot see
meaning; the negation prefix is detected outright instead. If a `not` was already typed, the advice
inverts accordingly: `is not invisible` is told to write `visible`, not to add a second `not`.

**There is no `empty` matcher, and `has count` is equality only** (`FU-09`). "This collection is
not empty" has two spellings, both of which work in both directions: `expect body.items not has
count 0`, or the comparison moved onto the length — `expect body.items.length is greater than 0`,
which takes `greater than`/`less than`/`equals` alike. The three spellings a user reaches for
first (`is not empty`, `has at least 1`, `has count greater than 0`) are all errors, and the third
used to be the worst kind: it fell out of the matcher grammar into call-parsing and answered with
advice about **parens**, for a mistake that has nothing to do with calls. All three now name a
working form. This was filed as a capability gap and re-probed as a discoverability one — the
language could always express it, nothing pointed the way.

### 6.2.1 Contract validation — `matches schema "Name" from "src"` (PLAN decision 102a,
enterprise arc cluster 3, closes TFLW-GAPS.md gap #6)

Validates the subject against a named schema in an externally-fetched OpenAPI document, using a
real bundled **ajv** (JSON-Schema) validator — including `$ref` resolution across
`components.schemas`, so a documented DTO referencing another one validates correctly, not just
flat schemas:

```
api GET /products/{productId}
expect body matches schema "ProductResponseDto" from "/openapi.json"
```

- `"Name"` is the key under the fetched document's `components.schemas`; `"src"` is an absolute
  URL, or a path resolved against the **default** `api` service's base URL (a non-default
  service's document needs an absolute URL — a deliberate minimal-scope limitation).
- The document is fetched once and cached for the rest of the run (keyed by resolved URL) — every
  further `matches schema` assertion against the same source reuses it, including across
  `--parallel N` (the cache is per-process, so `--workers N`'s forked generators each keep their
  own). Only a *successful* fetch is cached (M63): if the document can't be loaded, the
  next assertion tries again rather than replaying the first failure's message, so a transient
  outage doesn't fail the rest of the run — and, under `tflw watch`, doesn't outlive the fix.
  `allow hosts` (§3.7) gates this fetch the same as any `api` step's request.
  OpenAPI 3.0's `nullable: true` is understood (folded into a JSON-Schema `type` union before
  validating), since plain JSON-Schema doesn't have that keyword.
- **The fetch is visible evidence, never a silent round-trip.** The assertion that actually paid
  for the document says so in its own detail line — the URL, how many schemas came back, and how
  long it took — and every later assertion served from the cache says *that*, in as many words.
  Both forms reach `report.html`, `results.json`, `--format ndjson` and `junit.xml`, because the
  detail text is one string shared by all four; no new step or event kind is introduced.

  ```console
  ✓ body to match schema "Widget" (fetched schema document "http://localhost:4001/openapi.json" — 2 schemas, 38ms)
  ✓ body to match schema "Widget" (schema document from cache: "http://localhost:4001/openapi.json")
  ```

  This holds the matcher to the standard the runtime already states for `retry` — *a retry is
  visible evidence in the report, never a silent, invisible extra round-trip* — which matters more
  here, not less, because the fetch is `allow hosts`-gated and therefore security-relevant. It is
  also the only artifact trail the cache has: previously the sole signal that a later assertion did
  no I/O was its sub-millisecond duration.
- The one matcher this codebase evaluates outside the ordinarily-pure, synchronous matcher
  set (P#13) — fetching an external document is I/O the other matchers never need. `any`/`all`
  quantifiers can't be combined with it (§6.3) — validating an array element-by-element against a
  whole-document contract fetch is out of scope; the checker/runtime rejects the combination
  loudly rather than silently doing something surprising.
- `not matches schema ...` asserts the subject does **not** conform — useful for a deliberately-
  drifted-endpoint regression check.

### 6.2.2 Connection-failure assertions — `request connects`/`fails` (PLAN decision 18,
enterprise arc cluster 5.5)

Before this, a request that failed *before* any HTTP response existed — a TLS handshake rejection
(bad/missing client cert against an mTLS-requiring listener), DNS failure, `ECONNREFUSED`, an
`allow hosts` block (§3.7) — always crashed the whole test fail-fast, with no way to write a
genuinely passing regression test proving a guardrail actually triggers. `request` is a subject
carrying no response data of its own; `connects`/`fails` are bare, argument-less matchers judging
the connection attempt itself, the same state-matcher shape `is visible`/`is hidden` use for the UI
half (§9.4) — chosen over a `fail`-style keyword specifically so the positive/negative pair reads
as natural-language opposites (`connects`/`fails`), the DSL's founding design philosophy, rather
than forcing every negative case through `not connects`:

```
api GET /health
expect request fails matching "certificate"
```

- **Opt-in, not a mode switch**: only an `api` step immediately followed by a `request`-subject
  `expect`/`check` opts into catching a connection-level error instead of the ordinary fail-fast
  crash — every other `api` step anywhere, in either this repo or any existing suite, is completely
  unaffected (P#16's fail-fast default still holds everywhere else).
- **`fails matching "<regex>"`** (optional): same regex semantics as `matches "<regex>"` elsewhere,
  tested against the same teaching-error text §3.5 already unwraps for a connection failure
  (`insecure true`/`NODE_EXTRA_CA_CERTS` hints, `ECONNREFUSED`, `ENOTFOUND` — confirm the exact
  substring empirically per server/cause rather than guessing). A bare `fails` (no `matching`)
  passes on any connection-level failure, whatever its cause.
- **`not` still composes generically** (P#15's existing rule already covers this) —
  `expect request not connects` behaves exactly like a bare `expect request fails`, and vice versa;
  no special-cased negation logic, just the same "`not` negates any matcher" rule every other
  matcher already follows.
- **Not capturable**: `capture request as x` is a runtime error — there's no value here, only a
  pass/fail judgment on whether a connection was established.
- **Can't mix with a response-based assertion on the same request** — `expect status`/`header`/
  `body`/`duration` immediately after an `api` step that also carries a `request` assertion is a
  checker error (`TF031`): once a connection-level failure is being asserted on, there is no
  response for those to evaluate. Two separate `api` calls in the same test each get their own
  independent, unmixed assertion group.
- **Not supported inside `wait until api`** (`TF031`) — polling re-issues the request until its
  nested expects pass or the wait deadline elapses; it never opts into catching a connection
  failure the way a plain `api` step does, so a `request` assertion there would be structurally
  meaningless (either silently never satisfied, or a real failure still crashes the poll loop
  exactly like today, unchanged).
- Verifying that a report/artifact actually *shows* a masked/redacted value is a separate, unrelated
  concern from this — asserting on the tool's own output isn't a request/response judgment and
  doesn't fit this (or any) DSL assertion; that stays an out-of-band concern for whatever consumes
  `report.html`/`junit.xml` directly.

### 6.2.3 Binary body matching — `matches file "<path>"` (closes TFLW-GAPS.md gap #17)

`body bytes` (§5.3) captures the raw, untouched response body — a binary response (PDF, image, …)
that `body text` would otherwise irreversibly UTF-8-corrupt before any assertion ever saw it.
`matches file` is the one dedicated matcher for it: a byte-for-byte comparison against a file on
disk, proving "the file I get back is the file that was actually sent":

```
api GET /orders/{orderId}/receipt
capture body bytes as receiptBytes
expect body bytes matches file "fixtures/expected-receipt.pdf"
```

- **Only on `body bytes`** — `matches file` on any other subject is a runtime error.
- **Path interpolates `{var}` and resolves against the test file's own directory** — the same
  convention `body from`/`upload`/`drop file` use, and the same `evalValue` call (M101, D174):

  ```
  capture body bytes as receiptBytes
  let scratchPath = save temp file(receiptBytes)     # a `use`d JS action; writes the file
  expect body bytes matches file "{scratchPath}"
  ```

  Through v0.1 this operand alone read its literal text, so the path above had to be written out a
  second time by hand. That was documented here as deliberate and consistent with `matches schema
  "Name" from "src"`, but the consistency argument was backwards: the three *other* file operands
  in the language all interpolated, and this one carried the identical `StringLit`. `matches
  schema`'s two operands still read their literal text, and that one is genuine — a schema name is
  an identifier in a contract document, not a path (filed as `A4-OS-10`).

  Interpolating is additive in practice: it changes the meaning of a path only if a `{` was meant
  literally in a filename, which nothing in the corpus or acceptance suites does.

  Because the path is now a variable reference, `tflw check` binds the names in it: `matches file
  "./{slgu}.bin"` is a `TF030` at check time, exactly like the same typo in `screenshot "{name}"`.
  `TF043` (does the file exist?) is the separate, opposite case — an interpolated path is not
  statically known, so it is skipped rather than guessed at. Not-knowable is not known-bad.
- **No inline expected value** — no byte-array or base64 literal syntax exists in the grammar, so a
  binary expectation can't be spelled any other way. Comparing against a real file on disk is the
  only non-lossy option, and inventing a literal syntax is a separate, much bigger feature.
- **`hasCount` also widened** to accept `body bytes` (byte length), reusing the existing matcher —
  `expect body bytes hasCount 45296`.
- **`equals`/`contains` are not supported** directly on `body bytes` for the same no-inline-literal
  reason above — only reachable via a *captured* variable from an earlier `body bytes` capture,
  which is gap #12's already-known, already-accepted limitation, not new here.

### 6.3 Array quantifiers (P#14)

```
expect any body.items.name equals "Widget"
expect all body.items.status equals "active"
expect all {items.price} is greater than 0     # over a captured array (§6.1)
```

Three subjects can carry a quantifier: `body.<path>`, `body csv`, and a value subject. For a value
subject the array must be reachable **inside** the braces — `{items.price}`, never `{items}.price`.

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

#### 7.1.1 Referring to a variable: `{x}` and the bare form (M99a)

A variable is read as `{x}` — braced — in every position the language has, and that spelling always
works. A **bare** name (`x`, no braces) is also a value, and this is the form the grammar had never
written down: 36 sites in the corpus use it, and until M99a its one limitation was undocumented and
therefore only ever found by hitting it.

tflw has **no reserved words**. Every word lexes the same way and keywords are contextual, decided
by whatever production consumes them — which is what lets `action create order(…)` name itself in
plain English. The cost is that at a value position `random number lo to hi` and `create order(…)`
look identical for two tokens: a variable followed by a keyword, and a multi-word call name.

The rule that resolves it: **a run of bare words is a call if it reaches `(`, and otherwise the
first word alone is a variable** — the rest goes back to the enclosing production. So all of these
are variables, and all of them work:

```
let x = random number lo to hi
let z = random date between a and b
let f = format d as "yyyy-MM-dd"
select size from field "Size"
```

and a word run that *was* reaching for a call still says so:

```
let a = create order
  error[TF010]: `create` looks like the start of a call but never reaches `(`
  help: multi-word calls need parens, e.g. `create order(...)`
```

**When to prefer `{x}`.** Inside a string it is the only form — `"/orders/{id}"` interpolates,
`"/orders/id"` does not. Everywhere else the two are equivalent, and `{x}` reads unambiguously next
to a keyword.

**One position takes only a self-delimiting value** (§7.3): `random password`'s optional length is
the grammar's only value that is both optional and unmarked, so a bare name cannot be told from the
keyword that ends the enclosing expression. Write `random password 8` or `random password {n}`.

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
random password {n}             # from a variable
```

**The length must be a number or a `{var}`, never a bare name** (M99b). It is the only value in the
grammar that is both optional and unmarked, so a bare word there cannot be told apart from the
keyword that ends the enclosing expression — `select random password from field "pw"` consumed
`from` as the length. `random password n` is therefore an error naming the three spellings above;
`{n}` is the one to reach for.

**Patterns interpolate** (M102, D177) — `random like "{region}-####"` and `unique like "{region}-??"`
resolve `{region}` first, then fill. Additive: `{` is a placeholder in neither pattern language
(`#`/`?` here, `yyyy`/`MM`/`dd`/`HH`/`mm`/`ss` in `format … as …`), so a pattern without one renders
exactly as before. Same reason as the header name above — `tflw check` already bound these `{var}`s
while the runtime read the pattern literally (`A4-OS-13`).

No built-in faker realism (names/addresses) — use `random of` with your own list, or JS (P#22).
`random password` is not an exception to this — it satisfies a validation policy (at least one
upper/lower/digit/symbol), not a fake human identity, same category as `unique like`'s pattern
fill (decision 98).

### 7.3.1 Generators quick reference (PLAN decision 103, enterprise arc cluster 4)

<!-- GENERATED:generators:start -->
| Family | Generator | Notes | Example |
|---|---|---|---|
| unique | `unique("prefix")` | collision-safe across tests/workers/retries | `unique("Widget")` |
| unique | `unique email` | collision-safe across tests/workers/retries | `unique email` |
| unique | `unique number` | collision-safe across tests/workers/retries | `unique number` |
| unique | `unique like "ORD-######"` | `#` = digit; pattern fill, collision-safe | `unique like "ORD-######"` |
| unique | `unique uuid` | v4-shaped; trailing digits are the run-wide counter, so distinctness is guaranteed, not probabilistic | `unique uuid` |
| random | `random number A to B` / `random decimal A to B` | seed-reproducible; rejects a reversed range as a runtime error | `random number 1 to 100` |
| random | `random date in past` / `in future` / `between A and B` | seed- and run-clock-reproducible (`--seed`/`--now`) | `random date in past` |
| random | `random of "a", "b", ...` | seed-reproducible pick from an inline list | `random of "red", "blue", "green"` |
| random | `random string N` | seed-reproducible alnum string of length N | `random string 12` |
| random | `random like "SKU-####-??"` | `#` = digit, `?` = letter; seed-reproducible pattern fill | `random like "SKU-####-??"` |
| random | `random uuid` | v4, collisions allowed (not collision-guaranteed like `unique uuid`) | `random uuid` |
| random | `random password [N]` | default length 12, min 4; satisfies a validation policy, not fake-identity realism | `random password 16` |
| transform | `base64 encode(...)` / `base64 decode(...)` | pure deterministic value transform, not a fresh-value generator (decision 98) | `base64 encode("{email}:{password}")` |
| transform | `hex encode(...)` / `hex decode(...)` | pure deterministic value transform, not a fresh-value generator (decision 98) | `hex encode("{token}")` |
| transform | `url encode(...)` / `url decode(...)` | pure deterministic value transform, not a fresh-value generator (decision 98) | `url encode("{query}")` |
<!-- GENERATED:generators:end -->

Generated from `packages/lang/src/spec-data.ts` by `npm run docs:gen -w @tflw/lang`
(`scripts/gen-spec-tables.mjs`) — do not hand-edit the rows above; edit the manifest instead.

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
identically under any `--parallel N` (§3.3, decision 53), same as everywhere else.

### 7.5 Expressions (P#25)

Closed grammar, usable in `let`, fills, api bodies, table cells, expect values:

- Arithmetic on numbers: `{price} * {qty}`, `+ - * /`.
- Interpolation in strings: `"Order {orderId} for {name}"`.
- Date math: `today`, `now`, `today + 3 days`, `now - 2 hours`;
  `format {d} as "yyyy-MM-dd"` (project default format in config).
- **Hard fence:** no conditionals, no loops, no boolean operators.

**The `{` rule (FS-07).** One value grammar serves every position — a `let`, a fill, an api body, a
table cell, and *every* matcher operand alike, so `has count {expected}` works exactly like `equals
{expected}`. That means `{` has to mean one thing consistently:

- `{ref}`, `{ref.path}`, `{ref[0]}` — an **interpolation**, always. `{stock}` is the variable
  `stock`, never a one-field object.
- `{key: value}`, `{"key": value}`, `{}` — an **object literal**, always.

Since M96 the rule is **total**: subject position was the last place `{` did not honour it, and
`expect {orderId} …` now reads the same way as every other `{orderId}` in the language (§6.1).

The discriminator is two tokens (`{`, then an ident or string, then `:`), and the rule behind it is
a promise rather than an implementation detail: **an object literal always requires `key: value`**.
tflw will never grow a JavaScript-style shorthand-key form — `{stock}` meaning `{stock: stock}` is
permanently spoken for by interpolation. This is what lets `expect body.stock equals {stock}` and
`expect body matches subset {id: 1}` sit on consecutive lines and each mean the obvious thing.

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

### 7.7 `log` — user-defined logging (M27, PLAN_LOG.md) ✅

```
log "order {orderId} created"
log warn "stock low: {qty} remaining"
log error "checkout failed" to console
log debug "raw payload: {body}" to html
```

`log [debug|info|warn|error] "<message>" [to console|html|both]` — narrates what a test is doing
at a point in its flow, independent of whether the test passes or fails. `<message>` is an
ordinary string: `{var}` interpolation works exactly like every other string-bearing step, and an
unbound reference is the same `TF030` unknown-variable diagnostic `capture`/`check` already give.

- **Level** (`debug`/`info`/`warn`/`error`, default `info` when omitted) is a semantic label — it
  never affects whether a step runs or what it does, only how loud it is once `log level` (§3.10)/
  `--log-level` (§12) set a rendering threshold.
- **Destination** (`to console`/`to html`/`to both`) picks where this call ends up; omitted, it
  falls back to `tflw.config`'s `log destination` (§3.8, itself defaulting to `both`).
- A `log` step **always succeeds** — unlike every other step kind, it can't itself fail a test; a
  bad `{var}` reference is caught by the checker (TF030) before the test ever runs, not at runtime.
- **Structured output is always complete.** Every `log` step lands in `report/results.json`/
  `--format ndjson` regardless of its destination or level — only the two human-facing renderers
  (console text, `report.html`) filter what they actually display (§13). Console output for a
  `log` step is unconditional whenever its destination includes `console` and its level clears the
  threshold: unlike `--verbose`-gated step lines, it prints on a passing test too, since a `log`
  call is deliberate author signal, not step-execution plumbing.

## 8. Actions, imports, element aliases (P#2, P#17–18) 🔧

✅ Actions, `give` returns, `import`, the bare-call `CallStmt` form, and the reuse pass itself
(`tflw check` diagnostics + `tflw refactor apply`, M6) all apply today. 🔮 `element` aliases and
the lint nudging a duplicated `css`/`xpath` escape behind one remain unbuilt — no milestone owns
them yet (M6 shipped the reuse *pass*; alias-centralized locators are a separate, still-open gap).

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
- **An action may not reach itself** — not directly (`a` calling `a`) and not through others
  (`a → b → a`). Rejected by the checker (`TF044`, M97d; across `import`s since M109), and by the
  runtime for whatever the checker could not resolve — which reports the same path in the same
  arrow notation. Rejecting statically is *sound* rather than merely cautious because **tflw has no
  conditionals**: there is no branching construct anywhere in the language, so a cycle is not
  potentially infinite but unconditionally so, and the only way such a run can end is by failing.
  This is the one rule in §8 that follows from something the language deliberately does *not* have.
- `login("alice", "secret1")` — a bare call to an action or JS helper as a standalone step (M6),
  its return value (if any) discarded. Exists alongside `let x = login(...)` specifically so a
  reuse-pass extraction that produces nothing worth binding gets a natural call site.
- **A leading keyword never reserves that word for user-defined action names; disambiguation is
  always by what follows** (FS-06). Every keyword in tflw is a *soft* keyword — recognised by
  position, not reserved by the lexer — and this is the promise that makes that observable rather
  than incidental. `run` leads a workload clause (§4.5), yet `action run checkout(id)` is both
  declarable and callable: `run checkout("1")` is a call, `run 200 iterations across 10 users` is a
  workload, and the parser decides by scanning past the name to the `(`. The versioning consequence
  is the point — **a keyword added in a future release can never make an existing action name
  uncallable**, so §15's additive-only grammar freeze covers action names too, not just the syntax
  already written down. Before this rule, `run checkout("1")` failed with "expected an iteration count"
  while the identical call in value position (`let x = run checkout("1")`) worked: the language
  would let you declare an action it then refused to call.
- Element aliases centralize locators; lint: a `css`/`xpath` escape duplicated across files
  SHOULD move behind an alias (checker warning) (P#18). Not yet built (see the status line above).
- The **reuse pass** (P#2, M6) scans every test body `tflw check` is given and reports similar
  step sequences as hints (`RF001`, `RF002`, …, stable within one scan/run — not a content hash)
  alongside the ordinary checker diagnostics, each with a fully prepared extraction: a proposed
  `action` name, its params, and a call-site preview. Applying one (`tflw refactor apply <id>`)
  writes the action into a fresh `shared/<name>.tflw` and rewrites every occurrence's call site in
  place — the *only* command that ever mutates source; `tflw check`/`tflw run` never do.
  v1 scope (a deliberate cut, not the final ambition of P#2): only `test` bodies are scanned (not
  `action`/`before`/`after` bodies); a candidate sequence may only contain steps that neither
  introduce a binding (`let`/`capture`) nor carry a nested step block (`within`, `switch to new
  tab`, `download as`, `fill form`, `wait until`) — so an extracted action never needs `give`,
  every call site is a bare `CallStmt` (above), and no binding-escape analysis across the
  extraction boundary is required; and only literals sitting in a genuinely value-typed position
  (a `fill … with` value, a matcher operand, an object-literal field, a call argument, …) become
  parameters — a locator's own name/text, an opened path, and similar `StringLit`/`NumberLit`
  -*typed* fields stay structural (must match exactly) since there is no `{ref}`-shaped hole to
  parameterize them into without an IDE code action or another language release. Matching itself
  is greedy and longest-window-first, not a full suite-wide LCS search — simple, deterministic, and
  enough to find the obviously-duplicated flows this targets.
  Whatever it proposes, **applying a hint leaves a suite that still checks** (M81): a hint is
  offered only if the `action` it would write resolves every variable it references against its own
  parameters alone. A duplicated sequence that reads something the *caller* bound — a `capture`, a
  `let`, an inline `with each` column — is reported as no hint at all, rather than as an extraction
  that would fail `tflw check` the moment it was applied. The exception is a reference inside a
  literal that *varies* across the occurrences: that literal becomes a real parameter, so each call
  site passes its own text and it resolves in the caller's scope, where the variable exists.
  No IDE code action yet (P#2's other
  named entry point) — `tflw refactor apply <id>` is the only way to apply a hint today.

## 9. UI steps (P#8–9, P#26) 🔧

Browser half, `0.2.0` (M3), landing in slices — see `PLAN_BROWSER_PERF_SECURITY.md` §1.12. **M3a
✅ shipped**: the core interaction steps below, the selector model, strict ambiguity, `within`
scoping, and the state/value/count UI expect subjects. **M3b ✅ shipped**: frame traversal
(`within frame`), tab/window switching, download capture, drag-drop, and `wait until <ui
condition>` — see §9.5. **M3c ✅ shipped**: `screenshot`, failure screenshots, Playwright
trace-on-failure/retry, `report/assets/`, `--browser`/`--headed`/`viewport` — see §9.6. **M3d ✅
shipped**: network observation (`request to "…"`, `of request to "…"`) and `stub` — see §9.7.
**M3e ✅ shipped**: the `page` a11y subject (axe-core) — see §9.8. **M4a ✅ shipped**: LSP/VS Code
tooling catch-up for M3a-M3e (no new grammar). **M4b ✅ shipped**: visual regression
(`matches snapshot`) — see §9.9. **M5 ✅ shipped**: the live-DOM "nearest candidate" cold-start
diagnosis (§9.3) and `tflw pick <url>` (§12).
**Still planned**: `element <name> = <locator>` aliases (§8 — no milestone owns them yet).
`tflw install-browsers [--browser chromium|firefox|webkit]` downloads the browser binary
(`playwright` is an optional peer, D5 — you install it, and it is dynamically imported only once a
suite actually runs a browser step).

### 9.1 Navigation & interaction ✅

```
open "/orders/{orderId}"                 # relative to env `web` base URL (§3.1)
open "https://idp.example.com/login"     # absolute — the address, no `web` base needed (§5.1)
click button "Add to cart"
double click button "Row"
right click button "Row"
fill field "Email" with {email}
select "Widget" from field "Size"
tick field "Accept terms"                # ticks a checkbox/radio
untick field "Accept terms"
hover button "Menu"
press "Enter"                            # page-level
press "Enter" on field "Search"          # scoped to one locator
scroll to button "Load more"             # scrolls the locator into view

within list "Cart items"                 # an indented step block, scoped resolution (§9.3, D7)
  click button "Remove"

accept dialog                            # arms a one-shot handler for the *next* native dialog
click button "Delete"                    # (Playwright otherwise auto-dismisses silently — a real
                                          #  no-op trap for a confirm()-guarded action)
dismiss dialog
```

**The tick action is `tick`/`untick`, not `check`/`uncheck` (FS-04).** `check` is the soft-assertion
keyword (§6.4) and nothing else. It used to be dual-grammar: a locator *with* a matcher after it
(`check field "X" is checked`) was the soft assertion, a bare locator with nothing after it (`check
field "X"`) was the checkbox action. The two readings are one forgotten word apart and they fail in
opposite directions — an author who meant "assert this box is ticked" and dropped the matcher got a
test that *ticked the box* and passed, reporting a green assertion it never made. A soft assertion
silently becoming a mutation is not a shape a dual grammar can be trusted with.

Playwright and Cypress both spell this action `check()`, so arrivals from either will type `check
field "X"` from muscle memory; that is exactly why the replacement is a diagnostic naming `tick`
rather than a quiet re-reading. A bare `check <locator>` is now `TF014`, and it names *both*
readings — `tick field "…"` to tick the box, `check field "…" is checked` to assert its state —
because which one the author meant is the entire question a did-you-mean would have to guess at.
`uncheck` is likewise `TF011` naming `untick` outright (§17), since edit distance does not reach it.

### 9.2 `fill form` (P#26) ✅

```
fill form
  | "Name"  | unique("user")         |
  | "Email" | unique email           |
  | "Age"   | random number 18 to 99 |
```

Each row's left cell is a quoted field name — same resolution as a bare `fill field` — and each
row executes and reports as its own sub-step. No fill-and-remember auto-verify — audits are
explicit `check`/`expect` lines.

### 9.3 Locators (P#8–9) ✅ (`element` aliases not yet built)

- The **noun picks the resolution strategy** (D6) — cascading isn't the sin, cascading
  *invisibly* is:
  - `button "…"` / `text "…"` / `list "…"` — single strategy (role+name / visible text /
    role="list"+name).
  - `field "…"` — a closed 3-step cascade: label → placeholder → role (textbox). A below-tier-1
    resolution is annotated right in the CLI/report line (`field "Search" (resolved via
    placeholder)`), never silently accepted.
  - Escapes: `css "…"`, `xpath "…"` — greppable; lint-nudged behind `element` aliases once §8
    builds them.
- **Strict ambiguity (D7):** more than one match is always a hard error — never "take the first".
  The error lists up to 5 matched candidates and suggests `within <container>` or a more specific
  name. Each candidate carries its visible text **plus the first thing the page offers to tell it
  apart from its identical siblings** (`M125c`, `FU-21`): `data-testid`, then `id`, then
  `aria-label`, then the nearest enclosing labelled or headed container — `2. "Add to cart" — in
  "Product 2"` — degrading to a bare ordinal when the page offers nothing. No generated CSS paths
  here, for the same reason `M119-01` keeps them out of the nearest-candidate list. Twelve identical
  "Add to cart" buttons used to print five identical quoted labels, which is a list carrying no
  information for the choice it asks the reader to make.
  The count and the list come from **one** query, so "matched N, showing M, and K more" always
  accounts for every match; they used to be two independent round-trips against a live DOM, which is
  the only way the filed "matched 2 elements … 1 shown … and 1 more" can happen.
- **`within <locator>`** + an indented step block scopes every nested step's locator resolution to
  inside that container (block form only, same indentation every other construct uses — no brace
  syntax).
- **Live-DOM "nearest candidate" diagnosis (M5):** a persistently-unresolved semantic locator
  (`button`/`field`/`text`/`list` — `css`/`xpath` are skipped, no semantic name to fuzzy-match
  against) scans the live DOM for elements of the right shape and appends up to 5 ranked
  ready-to-paste suggestions to the failure, e.g. `click button "Add to Crat"`
  (a typo) surfaces `button "Add to Cart"`. An element with no usable name at all (an icon-only
  button, e.g.) is still surfaced via a generated CSS selector rather than dropped — **for
  `button`/`field`/`list`, whose scans are shape-scoped, but not for `text` (`M119-01`)**. A `text`
  scan is over every element, and an element with no text is not a near-miss for a text locator but
  a non-candidate; offering it as a ready-to-paste `css "html > head"` is worse than saying nothing,
  so when no text on the page is similar enough the message is left unchanged. This is a
  diagnosis, not a fallback — it never changes which element a step acts on, only what the failure
  message suggests. See also `tflw pick <url>` (§12), which prints a *verified* (not just
  best-guess) locator for a clicked element.
  **It fires on assertions and waits too, not only on actions (`B4-08`)** — the same typo in
  `expect`/`check`/`wait until` gets the same suggestions, under two conditions: only on the step's
  *final* failure (the scan is a whole-DOM round-trip and these steps poll until their deadline),
  and only when *nothing* matched. With an element resolved, the failure is about its state rather
  than its name, and naming other similar elements would point away from the cause. Absence that
  the matcher is happy with — `is hidden`, `has count 0` — passes, and a pass is never annotated.
  **Byte-identical suggestions are collapsed, and a collapsed one says so (`M125c`, `B4-11`).** Two
  `Save` buttons produced the list ``- `button "Save"`` twice; pasting it back in produced the
  *ambiguity* error above — a different failure than the one being diagnosed, from a list this
  section calls ready-to-paste. So duplicates now collapse to a single entry annotated with how many
  elements render it and the `within <container>` way out. Collapsing happens **before** the cap,
  which is the larger half of the fix: on a page of twelve identical controls all five slots were
  spent on one string, so a genuinely different candidate could not be shown at all.
- **A step still unresolved at ~3s says so, and keeps waiting (`M125c`, `FU-14`):** one line on
  stderr — ``⏳ tflw: still nothing matching `button "Log Inn"` after 3s — the closest thing on the
  page is `button "Login"`; still waiting, up to 30s`` — then the step polls to its own deadline
  exactly as before. **No deadline moves and nothing that passed stops passing**: an app that
  renders at 8s still resolves at 8s. A locator typo is the most common UI authoring error and used
  to buy 30s of unbroken silence before any output at all; the complaint is the silence, not the
  thirty seconds. It speaks even when nothing on the page resembles the name, which is the case
  where the wait is otherwise not even repaid with a suggestion at the end. The line is progress,
  not a result: it is never added to the event stream, and it is deliberately *not* buffered per
  file under `--parallel` the way `--verbose` step logs are, since flushing it at end-of-file would
  deliver it after the failure it exists to pre-empt. Steps whose own timeout leaves no room to wait
  after speaking stay quiet — which covers `expect`/`check` at their 5s default.

### 9.4 Waiting & UI subjects ✅

- Every interaction step polls up to `timeout step` (default 30s) for its locator to resolve
  (D9's spirit: a not-yet-rendered element isn't the same failure as a genuinely missing one) —
  `sleep` does not exist, only auto-waiting/auto-retrying.
- **UI expect subjects** (D5: tflw owns 100% of this retry loop, not Playwright) — locators
  (`button "…"`, `field "…"`, `text "…"`, `list "…"`, `css "…"`, `xpath "…"`) with the state/value/
  count matchers of §6.2 (`visible`/`hidden`/`enabled`/`disabled`/`checked`/`has value`/
  `has count`), auto-retrying to `timeout expect` (default 5s). `has count` is the one matcher
  meaningful against more than one element; every other matcher still hard-errors on ambiguity.
  "Zero elements" is itself a legitimate, non-erroring state for `is hidden`/`has count 0`.

### 9.5 Frames, tabs, downloads, drag-drop & `wait until <ui>` (M3b) ✅

```
within frame css "#payment-frame"        # traverses into the iframe's own document (Locator.
  click button "Pay"                     # contentFrame()) — nested steps resolve inside it, not
                                          # on the main page

switch to new tab                        # arms a listener for the *next* popup before running the
  click text "Open in new tab"           # block, then makes the new tab active for every step
                                          # after this block (persists, unlike `within`'s scoping)
expect text "Second tab" is visible
switch to tab 1                          # 1-based, in the order tabs were opened
close tab                                # closes the active tab, falls back to the previous one —
                                          # closing the last remaining tab is a runtime error

download as file                         # arms a listener for the active page's next download,
  click text "Download report"           # runs the block, then binds the suggested filename
expect field "Filename" has value {file}

drag text "First item" to text "Second item"    # native dragstart/dragenter/dragover/drop/dragend,
                                                 # dispatched directly with a real DataTransfer —
                                                 # not Playwright's own dragTo() mouse simulation,
                                                 # which doesn't reliably fire native DnD listeners
drop file "./receipt.png" onto css "#dropzone"  # for a dropzone with no <input type="file">; reads
                                                 # the file's real bytes and builds a genuine in-
                                                 # page File before dispatching the drop

wait until button "Submit" is enabled    # like `expect`, but polls `timeout wait` (default 30s)
                                          # instead of `timeout expect` (default 5s) — for a UI
                                          # condition that can legitimately outlast the ordinary
                                          # UI-expect budget. Always hard-fails; no soft/`check` form.

wait until text "Error" is hidden for 2s  # must hold *continuously* for 2s, not merely be true on
                                          # one poll — the only way to assert a sustained condition
```

- **`within frame <locator>`** — the container locator must resolve to exactly one `<iframe>`
  element; nested steps resolve inside that frame's own document, not merely inside a container
  element on the same page like the ordinary (non-frame) `within`.
- **Tabs**: `switch to new tab` + block is the only form that opens one (the block's step(s) are
  expected to trigger it, e.g. clicking a `target="_blank"` link) — the popup listener starts
  *before* the block runs, so a fast-opening tab can't race past it. `switch to tab N` moves
  directly (no event to wait for). `close tab` always falls back to the previous tab in open order;
  closing the only open tab is a runtime error, not a silent no-op.
- **`download as <name>`** — same before/run/listen shape as `switch to new tab`, but for the active
  page's `download` event. Binds the download's suggested filename as a plain string; the file's
  actual bytes/on-disk path still aren't surfaced as a report artifact — M3c's `report/assets/`
  directory (§9.6, §13) covers screenshots and traces, not downloads; no milestone owns this yet.
- **`drag`/`drop file`** are both real native-event simulations, not semantic "reorder the list"
  actions — they only work against a page that actually listens for `dragstart`/`dragover`/`drop`
  the way a real drag-and-drop UI does (a fixture/app with no such listeners simply won't react,
  same as a real user dragging over it wouldn't do anything either).
- **`wait until <locator> [is] [not] <matcher> [for <duration>]`** is the UI sibling of `wait until
  api` (§5.5): same "budget, not a moment" framing, but for a UI condition — no separate request to
  re-issue, so it's a single line rather than a block. `has count` keeps its ambiguity exception
  from §9.4.
- **`for <duration>`** (FS-05) requires the condition to hold *continuously* for that long instead
  of passing on the first poll that satisfies it. Without it a negative is unassertable: `wait until
  text "Error" is hidden` passes immediately, because the toast has not rendered *yet*, and would
  have passed just as readily one tick before it appeared. The hold clock restarts from zero
  whenever the condition goes false, so only an uninterrupted window passes; `timeout wait` still
  bounds the whole step, and a hold window at least as long as it is a runtime error rather than a
  guaranteed timeout. Scoped to the UI form — sustaining an *API* condition means re-issuing the
  request for the whole window, which is load rather than waiting, so `wait until api … for` is
  refused by name and stays available as a later additive change.

### 9.6 Screenshots, failure evidence & Playwright trace (M3c, D12) ✅

```
open "/checkout"
screenshot "before payment"       # captures the active page unconditionally, whatever happens next
click button "Pay"
expect text "Order confirmed" is visible
```

Everything in this section is **binary evidence, and is captured only at `evidence full`**
(FS-01, §13) — no redactor reaches rendered pixels, so below `full` none of it is captured at all.
The rest of this section describes behavior at the default level.

- **Explicit `screenshot "<name>"`** — a real step, reported like any other (`click`/`fill`): a
  capture failure (a closed page, an unexpected navigation mid-capture) is itself a diagnosis and
  surfaces the same way any other action failure does, never silently swallowed. Below `evidence
  full` the shot is not taken and the step passes reporting `not captured (evidence level)`.
- **Automatic failure screenshot** — best-effort, attached to whichever step just failed (a browser
  action, a UI `expect`, or even an API step inside an otherwise-UI test) whenever a browser page
  already exists for the attempt. Never creates a browser process just to try to screenshot nothing
  (an API-only test sharing a `BrowserManager` never pays for this), and never masks the real
  failure if the capture itself fails.
- **Playwright trace** — a full time-travel DOM + network + console recording, started for every
  browser context and kept only when it's worth keeping: **on a failing attempt, and on every
  `retry` attempt** (passed or not — the retry path itself is the evidence worth keeping, D12). A
  clean, single-attempt pass never captures one. Open a kept trace with
  `npx playwright show-trace <path>` — the single best answer to "passed locally, failed in CI".
- **`report/assets/`** — screenshots and traces land here, not inlined into `report.html`, once a
  run actually produces one (an API-only run, or an all-green UI run with no explicit `screenshot`
  step, still writes no `assets/` directory at all — §13). A small screenshot instead stays inlined
  as a `data:` URI, under a configurable byte budget, so the "one self-contained file" UX an
  API-only suite already has is never taken away by an occasional UI test running alongside it.
- **Engine & viewport (D11)** — `tflw run --browser chromium|firefox|webkit` (default chromium)
  switches the *whole* run's browser steps to one engine; no in-run matrix — a CI pipeline matrixes
  three separate jobs instead. The engine actually used is stamped on the report header. `--headed`
  shows a real browser window (local debugging only). `viewport <width> <height>` in `tflw.config`
  (`defaults` only, §3.1) sizes every new browser context; omitted, Playwright's own default
  (1280×720) applies.

### 9.7 Network observation & `stub` (M3d, D14) ✅

```
open "/checkout"
click button "Pay"
expect request to "/api/orders" was made
expect status of request to "/api/orders" equals 201
expect body.status of request to "/api/orders" equals "created"

stub POST "/api/payments/**" respond status 500 body { error: "gateway down" }
click button "Pay"
expect text "gateway down" is visible
```

- **`request to "<url-pattern>" [with method "<M>"]`** — a subject targeting a network request
  actually observed on the active page during this test attempt, distinct from §6.2.2's
  `RequestSubject` (`expect request connects`/`fails`, scoped to the *last `api` step*) —
  disambiguated by whether `to` follows `request`. `<url-pattern>` is a plain substring match
  against the request's full URL (forgiving of query strings and cross-origin absolute URLs, the
  same "just write the path" ergonomics `open "/path"` already has); `with method "<M>"` narrows
  the match to that HTTP method. When several observed requests match, the **most recently
  completed one** wins. Only meaningful with the `was made` matcher (existence) — a request that's
  still in flight when the assertion runs is retried, polling to `timeout expect` (default 5s),
  the same "not yet, not never" reasoning §9.4's UI expects already apply to a not-yet-rendered
  element.
- **`status`/`header "<name>"`/`body[.path]`/`body text` `of request to "<url>" […]`** — an
  optional trailing clause on the ordinary response subjects (§5.3), reading the matched network
  request's real response instead of the last `api` step's — the same subjects, the same matcher
  set, just a different source. Omit the clause and nothing changes (§5.3's existing
  last-`api`-step-response behavior). No matching request yet retries the same way `was made` does;
  a genuinely non-JSON response still needs `body text` instead of `body.<path>`, exactly as §5.3
  already requires.
- **`stub <METHOD> "<url-pattern>" respond status <code> [body {...}]`** — route-level response
  mocking for the active page (Playwright's `page.route()`), registered for the rest of the test. A
  bare path like `/api/payments/**` is auto-prefixed with Playwright's own `**` glob wildcard so it
  matches regardless of origin; an already-absolute URL or an already-wildcarded pattern passes
  through unchanged, giving direct access to Playwright's own glob/regex matching when that's
  actually wanted. A request whose method doesn't match falls through to the real network
  untouched, rather than being silently swallowed — a `stub POST` never intercepts a `GET` to the
  same path. A stubbed response still shows up in `request to "…"`/`of request to "…"` exactly like
  a real one (the page genuinely receives it) — a `stub ... respond status 500` followed by `expect
  status of request to "…" equals 500` observes its own mock, not a coincidence.
- **House style: real fixtures by default.** `stub` exists for third-party/unavailable
  dependencies — a payment gateway's sandbox that's flaky in CI, a webhook callback from a service
  this suite doesn't own, an error response a real dependency won't reliably reproduce on demand —
  not as a general substitute for a real fixture. tflw's own dogfood suites never mock the API
  they're testing (P#1's "no transpile-to-Playwright, the interpreter's own event stream is the
  reporting substrate" spirit extends here too: a suite that stubs its own backend is testing the
  stub, not the app). Reach for `stub` when the real dependency is the *unreliable* or *out of
  scope* part of the system under test, not when a real fixture would just be inconvenient to set
  up.
- **Not supported (out of scope for M3d):** `capture ... of request to "…"`/`capture request to
  "…"` (a clear runtime error, not a silent wrong-data capture — SPEC §6.2.2's "not capturable"
  precedent for the connection-attempt `request` subject); `any`/`all` quantifiers against a
  network-observation subject; the `redact <path>`-driven field-path masking §6.6 already gives
  `body.<path>` on an `api` step's own response (a captured network body still passes through the
  universal secret-value redactor every step's report text already gets, just not that
  more-targeted, path-declared masking).

### 9.8 Accessibility (M3e, D14) ✅

```
open "/checkout"
expect page has no a11y violations              # every severity

open "/admin/legacy-widget"                      # a known-broken corner (dogfood-flagged for M7)
expect page has no critical a11y violations       # a severity floor, not an exact match
```

- **`expect`/`check page has no [<severity>] a11y violations`** — a real [axe-core](https://github.com/dequelabs/axe-core)
  scan of the active page's current DOM. `<severity>` (`minor`/`moderate`/`serious`/`critical`,
  axe-core's own impact scale) is optional and, when given, is a **floor, not an exact match** —
  `has no serious a11y violations` also counts `critical` findings, so a worse violation can never
  quietly slip under a lower bar. Omitting it counts every severity. Retries to `timeout expect`
  (default 5s) like every other UI expect (§9.4) — re-scanning the *current* DOM on every poll, not
  judging a stale snapshot, so a page that's still hydrating (a label attached once data loads) has
  the same "not yet, not never" grace a not-yet-rendered locator gets. `axe-core` is a second
  optional peer dependency alongside `playwright` (D5) — installed and dynamically imported only
  once a suite actually writes this assertion. A failing assertion lists up to 5 real violations
  (rule id, severity, description, and a target-element pointer) in the failure message — the
  diagnostics pillar applied to accessibility, not just a pass/fail bit.
- **Scan-arc reuse (D14).** This is deliberately built as a generic two-layer shape: `a11y.ts` is
  the only file that knows axe-core exists, mapping its output onto `finding.ts`'s
  scanner-agnostic `Finding`/`Severity` model (id/severity/description/detail, plus
  `filterBySeverity`'s floor semantics above) — the "scan-and-assert machinery" the pentest scan
  arc (`v0.4.0`, `PLAN_BROWSER_PERF_SECURITY.md` §3) is required to reuse rather than reimplementing its own severity
  vocabulary and filter/count logic. A future HTTP-scan finding source slots into `finding.ts`
  without touching this section's grammar or `a11y.ts`.
- **Not supported (out of scope for M3e):** `capture page as x` (a clear runtime error, same
  "not capturable" precedent as §6.2.2's connection-attempt `request` subject and §9.7's
  network-observation subjects — a page's a11y findings are asserted, never captured as a value);
  `any`/`all` quantifiers against `page`; per-rule allow-listing (e.g. suppressing one known-noisy
  rule id while still failing on everything else) — only a severity floor is a first-class filter
  today.

### 9.9 Visual regression (M4b, D15) ✅

```
open "/checkout"
expect page matches snapshot "checkout-page" mask css ".timestamp" mask css ".order-id"

click button "Add to cart"
expect list "Cart items" matches snapshot "cart-badge"
```

- **`expect`/`check page|<locator> matches snapshot "<name>" [mask <locator>]*`** — captures either
  the whole active page (`page`) or one element's own bounding box (a `LocatorSubject` — `button`/
  `field`/`text`/`list`/`css`/`xpath`, same D6 resolution, same D7 single-match requirement as
  every other locator use) and compares it, pixel for pixel, against a baseline PNG. Never retries
  (unlike every other UI expect, §9.4/§9.8) — a screenshot is one point-in-time capture, not a
  condition that becomes true as the page settles.
- **`mask <locator>`** — zero or more, each resolved the same way and painted over (Playwright's
  own `screenshot({ mask })`) *before* the comparison runs, so a dynamic region (a timestamp, an
  avatar, an order id) can never itself cause a failure. Only meaningful alongside
  `matches snapshot` — a stray `mask` after any other matcher is a runtime error. **Apply the same
  `mask` clause(s) every time a given `<name>` is written or compared** — masking paints a solid
  color over the region on *every* capture, baseline included; a baseline written without a mask
  still has the real, unmasked pixels underneath, so comparing it against a later masked capture
  fails on the mask itself, not because anything real changed.
- **Baselines are committed to the repo** at `snapshots/<file>/<test>/<name>.png` (resolved against
  the `.tflw` file's own directory, the same "relative to this file" convention `matches file`/
  `body from`/`upload` already use) — diffable in code review like any other checked-in fixture.
  `snapshots/` is deliberately **not** in `.gitignore` (only `.env`/`report/` are, `tflw init`).
- **Platform-key pinned, hard error, not a tolerance knob.** Each baseline's directory also carries
  a `<name>.platform.json` sidecar recording the OS + browser engine + exact browser build version
  that produced it (`linux-chromium-131.0.6778.33`). A run whose own platform key doesn't match the
  baseline's fails immediately with a clear message, *before* any pixel is compared — font
  hinting/subpixel AA between two OSes or engines never reconciles, and a looser cross-platform
  threshold only hides real regressions instead of catching them. Generate and verify baselines in
  the same environment (a CI image, most reliably — `testFlow-tests` has a Docker compose stack
  that's free to run this in).
- **The compare itself has no exposed fuzz knob either** — same-platform pixels are compared with
  pixelmatch's own default anti-aliasing threshold (just enough to absorb harmless AA jitter on an
  otherwise byte-identical render) and a pass requires **zero** differing pixels. There is no
  "% of image allowed to differ" setting: a real visual change is a real regression, not something
  to tune a slider against.
- **`tflw run --update-snapshots`** writes a new baseline (first run) or overwrites the existing one
  (every later run, whatever it currently compares as) instead of comparing — the accept step for a
  deliberate visual change. `report.html` shows a **before/after/diff triptych** for any step that
  wrote or changed a baseline, or that failed to match one; a step that matched an unchanged
  baseline shows nothing extra (D12's "don't inflate the report on success" restraint, same reason
  screenshot-per-step-by-default was rejected in §9.6).
- **`not matches snapshot "<name>"`** asserts the opposite — that the current render *differs* from
  the baseline. Only meaningful once a same-platform, same-dimensions baseline actually exists to
  compare against; a missing baseline or a platform-key mismatch is "couldn't compare" either way,
  not a yes/no answer `not` could flip (mirrors `matches file`/`matches schema`'s own handling of
  negation).
- **Not supported (out of scope for M4b):** `capture ... matches snapshot` isn't a thing —
  `matches snapshot` is a matcher, not a subject, so this is simply not valid grammar; `any`/`all`
  quantifiers (there's no array to quantify over); a configurable diff-pixel-ratio tolerance (see
  above — deliberately not exposed).

### 9.10 Security hygiene scan (M128b, D283–D296) ✅

```
authorized target "https://localhost:8443" reason "self-hosted test fixture"   # tflw.config, §3.10

api GET /orders
expect response has no security violations              # every severity
expect response has no serious security violations      # a floor, not an exact match
check  response has no security violations              # soft form, §6.4
```

- **`expect`/`check response has no [<severity>] security violations`** — runs a built-in pack of
  ten hygiene rules over the response the last `api` step actually received (its status line, its
  headers, every `Set-Cookie` line including ones set on an earlier redirect hop, and the request
  that produced them). `<severity>` uses the same four-level scale as §9.8 and the same floor
  semantics — `has no serious security violations` also counts `critical`.
- **`response` is a scan subject, not an addressable one.** §5.3's subjects each name one part of
  the response and compare it against an operand; a scan reads all of it and returns a list, so
  there is no part to name. `capture response as x` is a runtime error naming the parts that *can*
  be bound (`body.…`, `status`, `header "…"`), and `{variable}` in this position is `TF041`.
- **Applicability is a third state (D284).** Every rule declares a precondition, and a rule whose
  precondition is unmet is **not applicable** — never a violation, and never a silent pass. Without
  this the pack's zero-false-positive bar is unreachable: over `http://` a `Secure` cookie is not
  merely unset but *unsettable*, and HSTS is ignored by browsers, so both rules would fire on every
  response in a plaintext suite and the fix each implied would break it.

  | rule | severity | applies when |
  | --- | --- | --- |
  | `sec/cookie-not-httponly` | critical | the response sets a cookie |
  | `sec/cookie-not-secure` | critical | the scheme is https AND the response sets a cookie |
  | `sec/cors-wildcard-with-credentials` | critical | the response carries `Access-Control-Allow-Origin` |
  | `sec/hsts-missing` | serious | the scheme is https |
  | `sec/csp-missing` | serious | the response is a document (`text/html`) |
  | `sec/tls-version-old` | serious | the scheme is https and the TLS probe succeeded |
  | `sec/tls-weak-cipher` | serious | the scheme is https and the TLS probe succeeded |
  | `sec/x-frame-options` | moderate | the response is a document (`text/html`) |
  | `sec/cookie-samesite-none` | moderate | the response sets a cookie |
  | `sec/nosniff-missing` | moderate | always |
  | `sec/authenticated-response-cacheable` | moderate | the request carried session or bearer credentials |
  | `sec/server-version-disclosure` | minor | always |

  Severity is static and built in, not user-editable — the same arrangement §9.8 has with axe-core's
  impact scale. The floor is the filter.
- **Zero applicable rules is a failure (D285).** An assertion where every rule stood down had no
  power to fail, so passing it would report "checked and clean" about a response nothing checked.
  The failure names each rule and the precondition it wanted. This is the `M127` "an empty shard is
  an error, not an early return" rule one layer up.
- **The floor narrows the pack before applicability, not the findings afterwards (D296).** `has no
  critical security violations` considers three rules, not twelve — so the printed denominator
  describes the work the assertion actually did, and a critical-floor assertion against a plain JSON
  GET correctly reports that nothing engaged rather than collecting a green.
- **Counts are printed on one line, all three of them** — `12 rules — 7 applicable, 5 not
  applicable, 2 violations` — on pass and on failure alike (`M126`: a count and its denominator
  belong together). A **passing negated** assertion (`not has no … violations`, which asserts that
  something *is* wrong) lists the findings it found: that is the one fact it exists to establish, and
  withholding it on the green line leaves it in no artifact at all.
- **A rule blocked by a failed instrument is announced; one blocked by its precondition is not**
  (D300). The first means the assertion did less than it was asked to, and it is reported on every
  result line including a passing one:
  `note: sec/tls-version-old, sec/tls-weak-cipher could not be evaluated — …`. The second is the
  ordinary third state, and listing every not-applicable rule on every line would bury the counts.
- **The two TLS rules read a second connection, and say so (D288).** The runtime drives Node's
  global `fetch`, which exposes neither the negotiated protocol version nor the cipher, and the
  dependency that would (`undici`) is the one decision 43 declined. So tflw opens its own
  `tls.connect()` to the same `host:port`, reads `getProtocol()`/`getCipher()`, and closes — stdlib
  only, **once per `host:port` per run**, never once per response. It honours `allow hosts` and
  requires an `authorized target` covering the origin it is about to reach, checked against where the
  run actually *ended up* rather than the base URL the checker could see. A probe that cannot connect
  — refused, timed out, or a certificate this run declines to trust — makes both rules **not
  applicable**, with the handshake's own failure quoted in the listing. It is never an error: a
  network hiccup is not a security verdict.

  What that buys, stated because both rules would otherwise over-claim: the facts describe *one
  fresh connection, made with this run's own client parameters*. Not the asserted request (behind a
  load balancer with unlike nodes the two can differ), and not the server's whole offer (a host that
  supports RC4 alongside AES-GCM negotiates AES-GCM and is correctly silent — enumerating everything
  a server would accept takes one handshake per suite, and belongs to `tflw scan`). The question
  answered is **"what does this host give a current client?"**

  The probe deliberately offers a **TLS 1.0 floor**, below Node's own `DEFAULT_MIN_VERSION` of
  TLS 1.2. Without that, a host speaking nothing but a deprecated protocol simply refuses the
  handshake and `sec/tls-version-old` reports "could not tell" in exactly the case it exists for.
  Offering an old floor cannot drag a healthy server down — the server still picks the best version
  both sides speak. Cipher suites are *not* widened the same way, because reaching a legacy-cipher-
  only peer requires OpenSSL's `@SECLEVEL=0`, which also lowers what counts as an acceptable
  certificate; that is a verification cost paid for a cipher reach.
- **The TLS rules are response-scoped only (D297).** Unlike the cookie rules, they are not carried
  through the session channel below. A login response's `Set-Cookie` is a fact only that response
  carries; a TLS version is a property of the *host*, which any assertion pointed at that host
  rediscovers directly — so probing at establishment would report the same finding twice.
- **A session's own login response is scanned once, at establishment (D287).** Findings are labelled
  `session "<name>" login — …` and folded into every security assertion in a test that opted into
  that session, filtered by *that assertion's* floor. Without this, a suite whose session cookie
  lacks `HttpOnly` reports clean — close to the single most important thing the pack could catch.
  Nothing inspects a cookie jar: the login response is a response the run genuinely made.
- **No retry**, unlike §9.8's a11y assertion. That one re-scans a live DOM because a hydrating page
  can fix its own gaps; this judges a response already received in full, and re-polling cannot change
  a header that already arrived. It is rejected inside `wait until api` for the same reason `TF041`
  rejects value subjects there.
- **Coverage is per-assertion, by design (D286).** There is no config key that auto-asserts on every
  response: a hidden assertion no line of the test file shows would make a passing suite's
  guarantees unreadable from the suite.

  There is also **no hook shortcut**, and this corrects D286's own sketch, which proposed teaching
  an `after each` hook as the whole-file idiom. Two things make that unwritable: this language has
  no `before each`/`after each` (§4 — `each` is exclusively a `with each` keyword), and a bare
  `after` hook runs in its own scope where `TF039` applies, because a response never crosses out of
  a hook into the body that called it. The assertion therefore sits in the test body beside the
  request it judges, which is the shape D286's own reasoning wanted anyway.
- **Requires an `authorized target` declaration** naming the env's base URL (§3.10). Writing this
  assertion without one is `TF060`, a checker error.
- **Not in this milestone:** the two TLS rules (`sec/tls-version-old`, `sec/tls-weak-cipher`), which
  need an out-of-band `tls.connect()` probe; SARIF output and a standalone scan report, which land
  with `tflw scan`; and per-rule suppression by id, which §9.8 records as deliberately unsupported
  for a11y and which would create an asymmetry here.

## 10. Sessions & isolation (P#20, P#31) 🔧

✅ The `session` block half shipped in M2.6 (§3.3). ✅ Fresh browser context (and page) per test
*attempt* shipped in M3a (D13) — one shared browser process for the whole run, a clean context per
test so a retried test never inherits a failed attempt's leftover UI state. Since M3b, a context
can hold several open tabs at once (§9.5) — still just the one context per attempt; `switch to new
tab`/`switch to tab N`/`close tab` move between pages within it, not across contexts. 🔮 Not yet
built:
applying a `session`'s cached storage state to a browser context — SPEC §3.3/§9's cookie jar and a
browser context's storage state are two separate representations that are deliberately never
bridged (D10); a mixed UI+API test establishes identity twice (an API login call and a UI form
login), each independently cached.

Context-per-file is rejected — ordering coupling. Login flows still get their own dedicated tests.

## 11. JS escape hatch (P#11) ✅

```
use "./helpers/sign.ts"
let sig = sign payload({body})
```

Plain JS/TS modules exporting async functions, called like native actions (test context in,
values out). No inline JS inside `.tflw` files. This is the outlet for: custom matchers-as-
helpers, faker-grade data, conditional logic, exotic protocols.

**Put `"type": "module"` in your `package.json`.** `.ts` helpers load through Node's own native
type stripping (no `tsx`, no esbuild at runtime, P#43). When a `package.json` exists and declares no
`"type"`, Node has to *guess* the module type, re-parse the file once it finds ES syntax, and warn
about having done so — four raw lines above the results, the one stack-trace-flavoured output that
used to get past the diagnostics layer (M125b2, `FU-15`). tflw now replaces those with a single
`⚠ tflw:` line naming the fix, printed once per run, and every other Node warning still reaches you
in Node's own voice, unchanged. (With *no* `package.json` above the helper at all, Node says
nothing — the trigger is a manifest missing the key, not a missing manifest, which is why
`tflw init` scaffolds one with the key already set rather than leaving the file out.)

## 12. CLI 🔧

**✅ Shipped:**

| Command | Purpose |
|---|---|
| `tflw init [--load]` | scaffold `tflw.config` + `example.tflw` + `.env.example` + `.gitignore` (`.env`/`report/`, appended without duplicating if the file already exists) + `package.json` (`{"private": true, "type": "module"}`) — decision 82; API-only, `--ui` is M3. Every file after `tflw.config` is written **only if absent**, never merged into or overwritten; `package.json` is there so the §11 `.ts` escape hatch doesn't make Node guess the module type on first use (M125b2, `FU-15`). The scaffolded config points `api` at `tflw://demo` (§3.1, M118/`FU-04`), so `tflw init` followed by `tflw run` is green in an empty directory — swapping that one line for your own service is the intended first edit. `--load` (M29/D30) additionally scaffolds a `load.tflw` holding a workload-bearing `test` in the open (`rps`) model, run by plain `tflw run` like any other file |
| `tflw run [files] [--env E] [--tag T[,T...]] [--only NAME] [--seed S] [--now ISO] [--parallel N] [--workers N] [--skip-workload] [--no-color] [--verbose] [--forbid-insecure] [--evidence LEVEL] [--failed] [--bail] [--format ndjson] [--no-timestamps] [--log-file PATH] [--browser chromium\|firefox\|webkit] [--headed] [--log-output console\|html\|both\|none] [--log-level debug\|info\|warn\|error]` | run; exit code for CI. A failing test's diff always prints live (no flag, no TTY required — decision 91); `--verbose` additionally prints one line per step (pass or fail), buffered per-file under `--parallel > 1` so concurrent files' step logs never interleave. `--tag` takes a comma-separated list with OR semantics — a test runs if it carries any listed tag (decision 97). `--only` runs a single test by its exact declared name (composes with `--tag`'s OR-list as AND) — decision 94, for the VS Code extension's per-test CodeLens. `--parallel N` runs up to N *files* concurrently in this process (default: `tflw.config`'s `workers` key); `--workers N` is the unrelated, workload-only axis (§4.5, D111/D113): it forks N generator *processes* to produce one file's workload-bearing test(s)' load, a no-op warning on a file with none. `--skip-workload` (D110, renamed from `--skip-load` in M53) drops every workload-bearing test from the run for fast iteration on the functional ones alone. `--forbid-insecure` (decision 101b) is a CI policy gate: fail before any test runs if `insecure true` (§3.5) is active for the env actually running. `--evidence full\|headers-only\|none` (decision 101c) overrides `tflw.config`'s `evidence` key (§13) for this run only. `--failed`/`--bail`/`--format ndjson`/`--no-timestamps`/`--log-file` are PLAN decision 111 (enterprise arc cluster 6) — see §13. `--browser` (M3c, D11) switches the whole run's browser steps to one engine (default chromium), stamped on the report header; `--headed` shows a real browser window instead of running headless. `--log-output`/`--log-level` (M27, PLAN_LOG.md) override `tflw.config`'s `log destination`/`log level` keys (§3.10) for `log` statements (§7.7) — `--log-output` only reaches a bare `log "…"` call (an explicit `to …` clause always wins), `--log-level` filters rendering only, never recording |
| `tflw check [files] [--env E] [--no-color] [--format json]` | validate only: parse + the full checker pipeline `run` executes before it does anything (config parse/validate + `checkSessionServices`, then `checkProgram` — the one composed per-file pass list, `checkServices`/`checkDataTables`/`checkSessions`/`checkActionDecls`/`checkUnknownVariables`/`checkRequestAssertions`/`checkWorkloadTests` — shared verbatim with the language server and the docs-site editor demo since M60, so all three report the same thing), teaching diagnostics, exit 0/2, **no execution** — lint in CI/pre-commit without touching a live API or needing `require env` secrets, P#75 (M2.8). Text output by default; `--format json` (decision 94) prints JSON instead, for editor and CI integrations: an array with **one `{ "file": "<path>", "diagnostics": [ … ] }` entry per file checked**, in discovery order, paths relative to the cwd and POSIX-separated. Clean files are listed with an empty `diagnostics` array — a consumer that draws diagnostics needs to know a file was checked and found clean in order to clear the ones it drew last time (M70; before that this was a flat `Diagnostic[]` concatenated across files, and `Diagnostic` carries a span but no file, so it only worked when exactly one file was named). A config-level failure (broken `tflw.config`, unknown session service) still prints text to stderr and exits 2 with an empty array on stdout — which under this shape means "nothing was checked" rather than being ambiguous with "everything was clean". Text mode also runs the reuse pass (M6, §8, P#2) across every file just checked and prints any hints (`RF001`, …) after the usual diagnostics — advisory, never affects the exit code; `--format json` skips this — a reuse hint is a cross-file suggestion carrying a diff preview, not a diagnostic anchored to a span, so it does not belong in a per-file diagnostics array |
| `tflw --version`, `-v` | print the installed version — injected at bundle time via esbuild `--define`, P#74 (M2.8) |
| `tflw docs [topic]` | print a SPEC.md-derived cheatsheet section; no topic lists every one. A static bundled artifact (`docs-data.generated.ts`, regenerated from SPEC.md at `pretest`/`predev`/`bundle` time, not parsed live at runtime — SPEC.md isn't shipped in the npm package), decision 93 |
| `tflw lsp` | run the Language Server over stdio, for editor integrations (M13, enterprise arc cluster 5). Speaks LSP on stdin/stdout and never writes to them otherwise, so it is not a command you run by hand — `packages/vscode`'s extension spawns exactly this, and any other LSP-capable editor can. It serves diagnostics, hover, go-to-definition, completion, document symbols and semantic tokens off the same `checkProgram` pass list `tflw check` runs (M60), which is what makes the squiggles and the CI exit code agree. Absent from this table until M110 (`V4-02`) — the one shipped command SPEC never listed, for eleven milestones |
| `tflw install-browsers [--browser chromium\|firefox\|webkit]` | one-time browser binary download for UI steps (M3a, P#36, default chromium per D11) — runs the `playwright` CLI that ships inside the optional peer dependency itself, resolved from the consuming project (M92b, `B6-09`). It never installs `playwright`: with the peer absent it refuses and says how to add it, rather than fetching an unpinned copy the project won't then use. Playwright's own download output passes through; tflw brackets it (M118, `FU-03`, D204) — success names the engine and the `playwright` version that now has it (which is the `B6-09` confusion, stated), failure adds a tflw-voice summary and exits 2 ("could not run", not "a test failed"). Before M118 the success path printed **nothing at all**, on either stream |
| `tflw pick <url> [--browser chromium\|firefox\|webkit]` | opens a real, visible browser at `<url>`; every click prints the best *verified* tflw locator for whatever was clicked (M5, §9.3) — walks the same resolution tiers (D6) the runtime itself uses and only ever prints a suggestion once it's confirmed to resolve to exactly the clicked element (D7), falling back to a generated CSS selector when nothing semantic round-trips. Picking is inert: `preventDefault`/`stopPropagation` stop a clicked link or submit button from actually navigating/submitting. Runs until the window is closed or Ctrl+C; `<url>` must be absolute (no `tflw.config` involved) |
| `tflw watch [files] [--env E] [--seed S] [--browser chromium\|firefox\|webkit] [--no-color]` | save → the affected test re-runs headed (M5) — one shared, real browser window for the *whole watch session* (not relaunched per save), so it's still there to inspect after a failure. One seed, resolved once at startup (`--seed`, else freshly minted) and reused for every run for the life of the session — since it never changes, a run right after a fix trivially reuses the seed the failing run before it used. Saving a `.tflw` file re-runs *that file*; saving `tflw.config` re-runs the whole (requested) suite, since every file's resolved settings could have changed — no cross-file dependency tracking beyond that (a `.ts` helper behind `use "…"` isn't watched). Runs until Ctrl+C |
| `tflw refactor apply <id>` | apply one reuse-pass extraction (M6, §8, P#2) — re-runs the same deterministic detection over the whole default-discovered suite (no `[files]`, matching `tflw run`/`tflw check` with none given), finds the hint with that id, writes its `action` into a fresh `shared/<name>.tflw`, and rewrites every occurrence's call site in place (a bare `CallStmt`, §8) — adding an `import "…"` line to each affected file that doesn't already have one. Refuses (exit 2, nothing written) if the id isn't found (ids can shift as the suite changes — re-run `tflw check` for fresh ones) or if the target `shared/<name>.tflw` already exists, rather than ever guessing or clobbering. The only command that mutates source (P#2's "builds never mutate source" is about `run`/`check`, not this explicit, user-invoked one) |
| `tflw migrate [files] [--env E] [--no-color]` | mechanically rewrite a suite past every deprecation the checker can name (P#38/45, decision 112; cluster C8/M90). A diagnostic carrying a `deprecation.replacement` gets that exact source span spliced, widest-first, in the same ordering `refactor apply` uses — no id to pick, since a deprecation is never something to leave half-migrated on purpose. Three rules carry one today: `scenario`→`test`, `think`→`pause`, `uncheck`→`untick`. **Bare `check <locator>` deliberately carries none** — `tick field "…"` (the old click) and `check field "…" is checked` (the assertion) are both honest readings of it, and guessing wrong writes a mutation into a test that keeps passing, so migrate reports it and leaves it to you (§9.1). Any diagnostic that offers ``run `tflw migrate` to apply this automatically`` is one it can act on; that line is *derived* from the payload, so the offer and the capability cannot drift apart. **It acts on files that do not parse** — the only kind it exists for: it splices what it can, writes, re-checks the rewritten source, and renders whatever remains against post-splice offsets, repeating until a pass finds nothing left (a `think` nested in a `scenario` is invisible to the parser until the `scenario` is fixed). Exit **0** when the suite is clean afterwards, **2** when errors remain — including when migrate successfully did work and the file still fails, because migrate's job is the rewrite, not the verdict. It rewrites *keywords*, not prose: a migrated file can be entirely correct and still say the old name in its comments and `test "…"` names. Takes no `--format`: its output is a report of edits, not a diagnostics array (`check --format json` already serializes `deprecation` for machines). The second of the two commands that mutate source |

Across every subcommand, a flag that takes a value must actually be given one: `--evidence` with
nothing after it, or with another `--flag` in the value slot, is a usage error (exit 2), never a
silent fall-back to the default (M63). This matters most where the default is the *least*
protective setting — `--evidence` that lost its argument to a CI YAML fold used to run at `full`
and leave the pipeline green. Only `--`-prefixed tokens are refused as values, so a negative
number or a `-`-prefixed name still works positionally; `--flag=value` takes any non-empty value,
including one beginning with `--`.

An **empty** value is refused the same way, in both spellings (M70). `--tag ""` and `--tag=` are
not "no filter": they ask for nothing, so they are a usage error rather than a run of everything.
The two narrowing flags are the reason the rule exists — `--tag` and `--only` were read for
truthiness downstream, so an empty value was indistinguishable from omitting the flag and quietly
widened the run from the requested subset to the entire suite at exit 0, while `--tag nope`
correctly failed. Nobody types that by hand; a shell interpolates it, from
`tflw run --tag "$SUITE_TAGS"` with the variable unset. A `--tag` value made only of separators
(`--tag=,,`) names no tags and is refused for the same reason.

And a `--`-prefixed token no subcommand recognises is an **unknown flag** (exit 2), named as one,
with the nearest documented flag offered — `tflw run --verbos` → ``unknown flag `--verbos` for
`tflw run` ‖ did you mean `--verbose`?`` (M61). Every `parse*Args` used to funnel an unrecognised
token into the *file* list, so this surfaced several layers later as a raw
`ENOENT: no such file or directory, open '/…/--verbos'`, naming a file nobody asked for; the two
commands with no fall-through branch at all were quieter and worse — `tflw install-browsers
--browsr firefox` downloaded Chromium at exit 0, and `tflw init --lod` scaffolded without
`load.tflw` and never mentioned the flag. Single-dash tokens are untouched, matching the value rule
above.
Every flag listed above also appears in `tflw --help`, and a test enforces that (`CLI_FLAGS` in
`packages/lang/src/spec-data.ts` is the list this table, the docs-site reference page, and
`--help` are all checked against).

**🔮 Planned:**

| Command | Purpose |
|---|---|
| `tflw init --ui` | also scaffold a UI test + prompt for `tflw install-browsers` (M3) |

## 13. Events, report, CI outputs (P#4–5, P#23, P#30) 🔧

✅ Everything API-side: the event stream, req/res panels, per-`check` rows, generated values
inline, seed header, redaction, CLI summary, `junit.xml`/`results.json`, exit codes, `--failed`/
`--bail`/`--format ndjson` CI ergonomics. ✅ Browser-side evidence since M3c: failure/explicit
screenshots, Playwright trace on failure and every retry attempt (§9.6). M3d's `request to "…"`/
`of request to "…"`/`stub` steps report through the same generic step timeline as every other step
(source line + pass/fail detail, e.g. `stub POST "/api/payments/**" → 500`) — no dedicated
network-panel evidence was added; the full request/response is inspectable via the kept Playwright
trace (§9.6) when one exists. M3e's `page has no … a11y violations` reports the same way — its
failure detail text lists up to 5 real axe-core findings inline (§9.8) rather than gaining its own
report panel; a kept Playwright trace still has the DOM these findings point at. 🔮 Visual
regression baselines (their own before/after/diff evidence) wait for M4b.

- Interpreter emits `step:start` / `step:end` (timing + screenshot when one was captured for a
  browser step, full req/res trace for API steps); reporter is a pure consumer.
- `report.html` (per run): step timeline mirroring source; a screenshot under a failed or explicit
  `screenshot` step, a Playwright trace link on a failing/retry attempt (§9.6); req/res panels per
  API step; failures as source line + expected/actual + before/after artifacts; per-`check`
  pass/fail rows; generated values inline; run seed + (when a browser ran) engine in the header;
  taint-redacted secrets throughout.
- **`report/assets/`** (M3c, D12) — screenshots over a byte-size budget and every Playwright trace
  (always, regardless of size — a multi-hundred-KB binary zip is never usefully embeddable) are
  written here as `assets/screenshots/<hash>.png` / `assets/traces/<hash>.zip`, linked from
  `report.html` by relative path; identical bytes (the same failure screenshot from two steps)
  dedupe to one file. A screenshot under the budget stays inlined as a `data:` URI instead — a run
  that never produces one (API-only, or an all-green UI run with no explicit `screenshot` step)
  writes no `assets/` directory at all, so `report.html` stays the single self-contained file it
  always was.
- A collapsible sidebar tree groups every test by its source file, with one clickable link per
  test and one detail panel per test in `<main>` toggled via a shared `active` class — a small
  inline `<script>` (decision 92) wires up click-to-switch, a text filter, and an All/Failed/Passed
  status toggle. Self-contained (no external requests, opens via `file://`) whenever the run
  produced no external `assets/` (M3c, above) — no longer JS-free either way; the footer says which
  of the two this report is (FS-01, below). A file group with any
  failing test starts expanded
  with the first failing test's panel shown; an all-passing run defaults to the first file's first
  test. `@media print` forces every panel visible and hides the sidebar, so printing/PDF export is
  unaffected.
- **Failure-first when the run failed** (`FU-16`, M125d). A run with at least one failure opens with
  the status toggle on **Failed** — applied, not merely highlighted — and scrolls to the first
  failing step of the panel it opened. Each step's bulky evidence (req/res panels, screenshots,
  snapshot triptychs) sits in a native `<details>`, collapsed on a passing step and left **open** on
  a failing one. The failing assertion text itself is never inside that disclosure: it is the answer
  a reader opened the file for, not evidence to go looking for. Content is folded, never dropped —
  response bodies remain in the file for Ctrl-F and for any downstream consumer that greps it.
  **A green run is unchanged in every respect**: the toggle starts on All and nothing is collapsed
  that was not collapsed before.
- CI: summary to stdout, `junit.xml` (seed in properties), meaningful exit codes. `report/` also
  always gets `results.json` (the same redacted `RunReport` as JSON) and `.last-run.json` (this
  run's failing tests) — see the CI ergonomics subsection below.

`junit.xml`'s escaping strips XML-invalid C0 control characters (keeping tab/LF/CR, which XML 1.0
permits) in addition to entity-escaping `& < > "` — a test name or error message that happens to
echo one (e.g. from a garbled/binary response) still produces well-formed XML (PLAN decision 73).

**`junit.xml`'s document shape (FS-09, review finding A13-01).** A `<testsuites name="tflw">` root
holding **one `<testsuite>` per `.tflw` file**, named by that file's path relative to the run's cwd
— the same grouping key `report.html`'s sidebar uses, from one shared implementation. Every
`<testcase>` carries `classname="<that file>"` alongside its `name`. This is the identity CI
dashboards key flaky-test history off: without it, two tests that happen to share a name in
different files are byte-identical to a dashboard, which merges them into one row and attributes
each one's failures to the other. A workload test's per-`threshold` `<testcase>`s carry the same
`classname`.

Counts are per level: each `<testsuite>` reports its own file's `tests`/`failures`/`skipped`, the
root reports the run's. `time` differs by level too — a suite's is the sum of its own testcases'
durations, the root's is the run's wall clock, because files run concurrently and summing the
suites would report a run as slower than it was. A workload `<testcase>` contributes `0.000` (a
workload's declared span is an input, not an elapsed time — and two of the five shapes declare no
span at all).

`<properties>` (`env`, `seed`, `now`, and `aborted` when set) describe the run rather than any one
file, but the JUnit schema only admits `<properties>` under a `<testsuite>`, so each suite repeats
them — any suite a reader opens hands back the seed needed to reproduce the run. A test that
arrives with no `file` at all (`TestResult.file` is optional; the interpreter never sets it) groups
under `(no file)`, the same placeholder `report.html` uses.

**Evidence levels — `evidence full\|headers-only\|none` (PLAN decision 101c, enterprise arc
cluster 2).** A `tflw.config` key (`evidence "headers-only"` — a string literal, since the lexer
has no hyphen in identifiers) controlling how much of each step's request/response trace lands in
`report.html`; `--evidence LEVEL` (§12) overrides it for one run. Override semantics like
`insecure` (env wins over `defaults`); default `full`, today's unchanged behavior.

- `full` — everything, as always: method/url/status/headers/body, plus all binary evidence.
- `headers-only` — drops the request/response body, replaced with a `[omitted by evidence level]`
  marker (distinguishable in the report from a genuinely empty, e.g. 204, body). Headers still
  shown.
- `none` — drops headers too. Only method/url/status/statusText/duration remain.

`evidence` governs **three things at once** (FS-01/FS-02), so that one dial covers everything a
report can leak rather than covering the trace and quietly leaving two other doors open:

1. **The request/response trace**, as above.
2. **Step detail text.** A step's own rendered line never shows what the level already dropped from
   the trace: at `headers-only` a `header "<name>"` subject's value still shows (it is printed in
   full in the header panel above) while every body-derived subject's does not; at `none` only
   `status` and `duration` survive. *What* was compared always survives — a failure at `evidence
   none` still reads `expected body.token to equal "…", but got [omitted by evidence level]`.
   Dropping detail entirely was rejected: it would make `evidence none` useless for diagnosing the
   CI failure it was turned on for.
3. **Binary evidence — captured only at `evidence full`.** Playwright trace archives, explicit
   `screenshot` steps, automatic failure screenshots and `matches snapshot` diff images are all page
   *pixels*, and **no redactor reaches rendered text** (see §3.4 — the redaction pass walks text
   fields only). The only promise the tool can keep about a captured screenshot is *"we didn't
   capture it"*, so `headers-only` and `none` — the levels reached for precisely when an artifact is
   about to be attached somewhere — suppress all of it. Post-processing the archive was rejected:
   the format is Playwright's and changes on their schedule, and it cannot touch pixels at all.
   `matches snapshot` is the one case where the capture is load-bearing for the assertion, so there
   the comparison, the baseline write and the `N px / N% differed` message are unaffected and only
   the images are withheld. An explicit `screenshot "<name>"` step still **passes** below `full` —
   it is an evidence step, never an assertion — and reports `not captured (evidence level)`.
   *Accepted cost:* at `evidence none` a failing browser test loses its trace. `full` is the
   default, so this only bites when evidence was deliberately turned down, which is itself the
   "I am going to attach this somewhere" signal.

Trimming happens where the **report-only** trace is built, entirely separate from the trace
`expect`/`capture` read during the run itself — an assertion against a response body still works
identically under `evidence none`; only what a human (or CI artifact) later sees is reduced. Order
of operations on that report-only trace: secret redaction (this section, taint-based) → `redact`
position redaction (§3.4) → evidence-level trim (coarsest cut, applied last).

**`report.html`'s footer states what the file contains, and promises nothing (FS-01).** It names
the run's `evidence` level and lists what actually landed in the report — request/response bodies,
page screenshots, trace archives — or says positively that none of those are present, and tells the
reader to copy the whole report directory when some assets live in `assets/`. It used to read
*"report.html is self-contained and safe to attach to a ticket"*; both halves could be false at
once (at the default `evidence full` the file embeds whole response bodies and screenshots, and a
report with external assets is not one file), and a report generator is not in a position to
certify that anything is safe to share.

**CI ergonomics + console/log output (PLAN decision 111, enterprise arc cluster 6).**

- `report/results.json` — always written (no flag), the exact same redacted `RunReport` that
  feeds `report.html`, so CI can read a run's outcome from a file instead of scraping stdout.

  **`ok` answers "did this run pass?" — not "did nothing that ran fail?" (M114).** They are
  different questions whenever a run reaches no verdict at all: `aborted` (Ctrl-C before the
  planned duration elapsed) and `inconclusive` (tflw's own generator saturated, so the numbers
  describe tflw rather than the system under test). Such a run is `ok: false` **with `failed: 0`**,
  and that pair is not a contradiction — it reads "this run did not pass, and no test failed",
  which is exactly what an abort is. The narrow question has its own field: `failed === 0`.

  **When the saturation verdict and a per-test back-off warning both fire** (`FU-19`, M125d), the
  summary states how they relate instead of leaving two adjacent lines blaming opposite parties.
  They are two readings of one overloaded machine, not a contradiction — and the saturation line is
  the one to believe first, because a saturated generator mistimes its own requests, so the back-off
  estimate is derived from numbers that saturation already distorted. Give tflw more headroom,
  re-run, and only then read the target's verdict. The clause appears only when both fired; either
  warning alone reads exactly as it always did. The pair is rare: under a closed model a generator
  waiting on a slow target is definitionally not saturated (measured — throttling a target 8× drove
  generator CPU *down*, 36 % → 8-10 %), so the two conditions are close to mutually exclusive.

  This makes the JSON agree with the exit code it ships beside. Before M114 an aborted run wrote
  `{"ok": true, "passed": 1, "failed": 0, "aborted": true}` and exited `130` — the artifact said
  clean, the process said cut short, and a CI job branching on the field named for the question
  read the wrong one. `ok`, `aborted` and `inconclusive` now carry the same verdict the console
  badge (`PASS`/`FAIL`/`ABORTED`/`INCONCLUSIVE`), `report.html`'s header and `junit.xml`'s
  `<skipped/>` thresholds show, from one shared derivation. The same `RunReport` is what the
  `run:end` ndjson event carries, so `--format ndjson` consumers get the identical answer.
- `tflw run --failed` — re-runs only the previous run's failing tests. State lives in
  `report/.last-run.json` (always overwritten, every run, including `--failed` runs themselves —
  a test that failed on an earlier `retry` attempt but ultimately passed, i.e. `flaky`, is never
  in this list, since `TestResult.ok` is already the final post-retry verdict). No state file, or
  a prior run with zero failures: falls back to the full suite with a printed note, matching
  pytest's `--lf` default. Composes with `--tag`/`--only` as AND.

  A replay says what it is replaying — `re-running 3 tests that failed in the last run` — and,
  when the run it is replaying was itself narrowed, says so: `— which was filtered by
  \`--tag smoke\`, not the whole suite` (`FU-23`, M125d). The record carries a `filter` field
  recording the filters as typed, present only on a filtered run; an unfiltered record is
  byte-identical to what earlier versions wrote. The overwrite behaviour is deliberately unchanged:
  a filtered run still records what it found, because *not* writing would replace one silence with
  another — run `--tag smoke`, then `--failed`, and replay something unrelated to what you just
  watched fail.
- `--bail` — stops after the first failing test's final (post-retry) verdict. Under
  `--parallel > 1`, the pool stops pulling new files once a failure is seen; files already claimed
  finish normally (no hard-abort/cancellation-token plumbing into the interpreter). `--parallel`,
  not `--workers`: this is the *file* concurrency axis (§12), and `--workers` — the workload-only
  load-generation axis — has no bearing on it (`B5-04`).
- `--format ndjson` — replaces the human console output with one `JSON.stringify`'d `RunEvent` per
  line (always full step-level detail, independent of `--verbose`), safe to pipe into a log
  aggregator; also always written to `report/events.ndjson` as a permanent artifact. `RunEvent`
  carries an optional `file` field (tagged by the CLI, not the interpreter — same "display
  concern" precedent as `TestResult.file`) so concurrent files' events stay distinguishable under
  `--parallel > 1`.

  **What the stream guarantees** (cluster C4 — `B3-05`, `B3-07`, `B5-03`, `B3-11`; each of these
  was violated before M77/M88d, and each is a regression test now):

  1. **Every test counted in `run:end.report.total` emits a `test:start`/`test:end` pair** — a
     functional test, a `with each` row-case, and a **workload-bearing test** alike, on every path.
     `before file` / `after file` hooks emit a pair too, like any other unit of work; a *passing*
     file hook is still absent from the final report's `tests` — a hook that worked is not a test
     result — so pairing `test:start`/`test:end` tracks work in flight, and `total` is how you
     count tests. This used to be stated the other way round ("every `test:start` has a matching
     `test:end`"), which is a promise about *pairs*: a unit of work emitting **neither** event
     satisfied it vacuously, and that is exactly how a workload-bearing test streamed nothing at
     all for a full milestone without any regression test noticing (`B3-11`). Quantified over
     report rows, silence is a violation.

     A workload `test:end` carries a `WorkloadTestResult` (`kind: 'workload'`) — metrics and
     evaluated thresholds, no `steps` and no `durationMs`, the same shape it has in
     `report.tests` — so a consumer branches on `result.kind` exactly as it already does for the
     report. It emits no `step:end` at all: a workload iteration's body executes silently by
     design — only aggregate metrics are kept, which is why a `WorkloadTestResult` has no `steps`
     in the first place — so there is no step timeline to stream, and the pair is the whole of
     what `total` promises.
  2. **`run:start.total` counts the tests that are about to run** — functional cases *and*
     workload-bearing tests. It is a forecast, not a promise: a **failing** file hook adds one
     further entry, so `run:end`'s `total` may exceed it by the number of hooks that failed. It
     will never be *lower*.
  3. **A file that crashes appears in the stream.** A runtime throw (a bad `import`/`use` path,
     say) used to produce no event at all while the report sinks got the full reason, so a
     consumer of the documented streaming contract saw a run with the file simply missing. It now
     emits the same `run:start` → `test:start` → `test:end` → `run:end` sequence any other file
     would, carrying the `ok: false` report every other sink receives.
- Timestamps — every console line gets an `HH:MM:SS.mmm` wall-clock prefix by default;
  `--no-timestamps` opts out (symmetric to `--no-color`).
- GitHub Actions log grouping — auto-detected via the `GITHUB_ACTIONS` env var, wraps a test's
  block in `::group::`/`::endgroup::`, only under `--verbose` (normal mode is already one line per
  test). Pure log folding, not a GitHub annotation (`::error::`) — out of scope, unchanged from
  decision 7.
- `--log-file <path>` — duplicates console output to a file, always plain text (ANSI stripped)
  regardless of stdout's own color state.

## 14. Architecture (P#1, P#12) 🔧

✅ `lang`/`runtime` (fetch binding + Playwright binding, M3a)/`reporter`/`cli`/`lsp-server`/`vscode`/`docs-site`, bundled via
esbuild for publish (esbuild marks `playwright` external — M3a's optional peer must never be
inlined into the single-file CLI bundle, both because it's often absent and because
`playwright-core`'s own bundle references optional native-transport deps esbuild can't resolve
statically).

```
packages/
  lang/      lexer, parser, AST, checker (pure, no I/O) — also parses tflw.config
  runtime/   interpreter, fetch binding (M1) + Playwright binding (M3a), event stream,
             taint tracking, seed derivation
  reporter/  events → report.html + junit.xml + results.json (+ events.ndjson), redaction rendering
  cli/       tflw run / check / init / docs / lsp / watch / pick / refactor / migrate /
             install-browsers
  lsp-server/ the Language Server (M13) — diagnostics, hover, go-to-definition, completion,
             document symbols, semantic tokens; a pure wrap of lang/, no I/O of its own beyond
             the LSP transport and reading imported files
  vscode/    highlighting + run CodeLens (decision 94) + a `LanguageClient` that spawns
             `tflw lsp` — the editor's diagnostics come from the language server, not from
             parsing `tflw check --format json` output
  docs-site/ the VitePress documentation site (decision 103), deployed to GitHub Pages; imports
             lang/'s own manifests so its reference pages cannot drift from the tool
```

The dogfood suite is not in this repo: it is the sibling `tflw-tests`, which installs `tflw` from
a packed tarball the way a user would (M4/P#43). It replaced `automationTestPOC` on 2026-07-06.

- Hand-rolled lexer + recursive-descent parser; no parser generator (diagnostics ownership, P#12).
- `lang/` is a pure library, which is what let `lsp-server/` wrap it directly in M13 — the editor
  and `tflw check` run the *same* `checkProgram` pass list (M60), so a squiggle and a CI failure
  are the same computation rather than two implementations that agree by inspection.
- Build order M0–M7 is API-first: `runtime/` had **no Playwright dependency until M3a** (P#34) —
  it's an optional peer dependency now (D5), dynamically imported only on a test's first browser
  step, so an API-only consumer's install/bundle is completely unaffected.

## 15. Distribution (P#35–39, amended by P#41–50) 🔧

Describes the whole release plan; individual bullets below are already true (posture, packaging
mechanism, Node ≥ 22, versioning promise) or are 🔮 future events (the `0.3.0`/`0.4.0` internal
milestones and the eventual `1.0.0` publish — see decision 112).

- **Posture:** public-grade from day one (public GitHub repo — own repo, MIT, CI, P#48 —
  stranger-readable README, `npm pack`-clean layout). The mechanical publish-readiness bar
  (un-`private` the package, README/LICENSE in the tarball, `--version`, `check`, CHANGELOG,
  positioning — P#74–82, M2.8) and the acceptance methodology (side-by-side vs raw
  fetch+node:test + external dogfood on restful-booker, P#41) were both proven out at the M2.7/
  M2.8 stage — but **no `npm publish` actually happens until `1.0.0`** (PLAN.md decision 112):
  browser (`0.2.0`, done), perf (`0.3.0`), and pentest (`0.4.0`) all land as internal milestones
  first, then one final integrated acceptance pass verifies all four arcs together against the
  real dogfood app before the first-ever publish. Repo is public with
  **contributions closed initially** — issues welcome, PRs not accepted yet, stated plainly in
  the README (P#80). Platform bar at 0.1: tested on Linux/macOS, Windows via WSL (P#79). A VS Code
  extension ships alongside 0.1 on its own Marketplace cadence (P#76): TextMate grammar, snippets,
  a run CodeLens, and diagnostics. Diagnostics arrived first as child-process
  `tflw check --format json` parsing (decision 94, superseding P#76's "squiggles/LSP stay M5"
  deferral — the CodeLens pattern didn't need to wait for a real LSP consumer to exist), and
  **M13 replaced that path with a real language server**: the extension now spawns `tflw lsp`
  (§12) via a `LanguageClient`. This paragraph said "not a real LSP" until M110 (`V4-03`).
- **Install:** per-project `npm i -D tflw`, run via `npx tflw`; `tflw init` scaffolds.
  **Node ≥ 22** (P#43). `.ts` escape-hatch helpers load via native type stripping — no tsx/
  esbuild runtime dependency. Published tflw now bundles two real runtime dependencies:
  **`undici`** (P#99b, mTLS client-cert dispatch — the one request path Node's plain global
  `fetch` can't serve) and **`ajv`** (decision 102a, enterprise arc cluster 3, real JSON-Schema
  validation for `matches schema ... from ...`, §6.2.1) — both build-time-only in `package.json`
  terms, since esbuild inlines them into `dist/cli.cjs` and a consumer's own `npm install` never
  pulls in packages named `undici`/`ajv`. `ajv` needed zero extra esbuild config to get bundled —
  it's a transitive dependency of `@tflw/runtime` now, and the existing `bundle: true` build
  already picks up every dependency, the same way it already did for `undici`. The bundle format
  itself is CJS (`dist/cli.cjs`, not ESM `dist/cli.js`) because undici's CJS internals can't be
  hoisted into static ESM imports (P#99).
- **Packages:** one `tflw` on npm — cli + lang + runtime + reporter **bundled via esbuild at
  prepack**; internal workspace packages stay private (P#37, mechanism P#43). `playwright` is an
  **optional peer**, dynamic-imported at the first browser step; `tflw install-browsers` downloads
  the browser binaries for the `playwright` the project already has — it does **not** install
  `playwright` itself (M92b, `B6-09`: it used to appear to, via `npx --yes`, which fetched an
  unpinned copy the project never saw). API-only projects stay small forever (P#44, P#36). VS Code
  extension → Marketplace separately, embedding `lang/` (P#37).
- **Versioning:** single semver. The shipped API grammar is **frozen additive-only from the
  first publish** (P#45), i.e. from `1.0.0` — the only version that ever actually ships (decision
  112); any pre-1.0 breaking change requires a checker deprecation warning one full release ahead.
  `tflw migrate` was the browser arc's (`0.2.0`-equivalent) deliverable (P#45) and has already
  shipped, proven against synthetic diagnostics since the grammar has had nothing to deprecate
  yet; the additive-only freeze itself takes effect for good at `1.0.0` (P#38, decision 112).
  TF0xx diagnostic codes fall under the same promise: never renumbered or reused once shipped
  (P#77). A root `CHANGELOG.md` (Keep-a-Changelog style) tracks progress arc-by-arc under
  `[Unreleased]` starting from `0.1.0`'s internal milestone label, becoming real release notes
  only once `1.0.0` actually publishes (P#74, M2.8).
- **CI:** plain `npx tflw run` anywhere; README ships a GitHub Actions snippet (browser cache,
  report.html uploaded as artifact). junit.xml + exit codes are the contract (§13).
- **Onboarding:** README quickstart hits a green **API** test in <5 minutes (no browser download
  in the funnel), SPEC.md is the reference, `examples/` mirrors the dogfood suite (P#39).

## 16. Out of v1 (parking lot) 🔮

Mobile/unit testing, DB assertions (P#3) — **not** performance or security/pen-test testing,
which are committed in-scope arcs per `PLAN_BROWSER_PERF_SECURITY.md` (decisions D1/D16–D22),
gating `1.0.0` rather than parked; recorder, dashboards
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

Every diagnostic carries a stable code (`packages/lang/src/diagnostic.ts`'s `Codes` table defines
the constants; `packages/lang/src/spec-data.ts`'s `DIAGNOSTICS` manifest is the single source of
truth for what each one *means* — this appendix, the docs-site Reference page, and LSP hover all
generate from it, decision 20). **Stability rule (P#77):** a shipped code is never
renumbered or reused; a retired diagnostic leaves its number retired, and a new diagnostic always
gets a new one. Codes print in every `error[TFxxx]: …` line, so they're what a CI grep filter, a
bug report, or a search engine query anchors on — this appendix exists so that lookup doesn't
require reading the source.

**Every example below is executed** (M110b). A row's `Example` cell is not prose: it is generated
from source that `packages/lang/test/diagnosticExamples.test.ts` runs through the same checker pass
list `tflw check` runs, asserting both that it emits that row's code and that any output quoted
after `→` appears verbatim in the real message or hint. Before that, nothing ran them, and four
rows were wrong — including `TF003`, whose example described an indentation mistake that produces
`TF011`. So a cell here can be out of date only by being *incomplete*, never by being false.

<!-- GENERATED:diagnostics:start -->
| Code | Meaning | Example |
|---|---|---|
| `TF001` | Lexer: a character that cannot begin any token. Also carries the **numeric-notation** case (M98b, `A1-18`): `1e3`, `0xff`, `0b1010`, `0o17` and `1_000` are not tflw numbers, and each lexes as a number followed by a *name* — `1e3` reads as `1` then `e3`, a 1000× difference between what was written and what was read. Those five shapes now say so at the number, naming the decimal value to write instead, rather than surfacing downstream as ``unexpected `e3` at end of step`` with a help line pointing at the end of the line. Deliberately narrow: "a number directly followed by a name" is exactly how every **duration** lexes (`pause 30s`, `expect duration is less than 500ms`), so only the five unambiguous notations are diagnosed. `.5` is not covered — `dot` + `number` is legal in a path and in a field access, and the lexer has no parser context to tell them apart. Recovery is unchanged: the tokens are still number + name. | `let y = $oops` → `unexpected character "$"`; `let n = 1e3` → `` exponent notation is not supported — this reads as `1` followed by the name `e3` `` |
| `TF002` | Lexer: a string literal has no closing quote before end of line. | `test "open string` |
| `TF003` | Lexer: indentation does not line up with any enclosing block. This is now the code's *only* meaning: until M98c (`A1-13`) it was also emitted for "tabs are not allowed in indentation", a different condition with a different fix, while this row documented only the alignment case — so SPEC §17, the docs-site Reference page and LSP hover, which are all generated from this row, described the wrong rule for half of the code's firings. The tab rule is `TF048`. | a line dedented to a column that matches no enclosing block — `4` spaces, then `2`, inside a body opened at `4` → `indentation does not match any enclosing block` |
| `TF010` | Parser: a token appeared where the grammar didn't allow it (the catch-all "unexpected token" code — covers many distinct shapes: a missing path after `api GET`, a multi-word call missing its parens, a malformed table row cell count, etc.). | `api GET` → `` expected a path like `/orders`, found end of line `` |
| `TF011` | Parser: an unrecognised statement keyword where a step was expected, or a *retired* one — a keyword the parser still recognises solely so it can name its replacement outright (FS-04's `uncheck` → `untick`, D103 style). A retired spelling is kept out of both the did-you-mean vocabulary and the "expected one of" fallback: offering it back as valid would be worse than no suggestion. | `expct status equals 200` → `` did you mean `expect`? ``; `uncheck field "Terms"` → `` `uncheck` was renamed to `untick` `` |
| `TF012` | Parser: an unknown HTTP method after `api`. | `api FETCH /health` → `` did you mean `PATCH`? `` |
| `TF013` | Parser: an unrecognised `expect`/`capture` subject. | `expect statuss equals 200` → `` did you mean `status`? `` |
| `TF014` | Parser: an unrecognised matcher after a subject, or none at all — including the one shape that used to be legal, a bare `check <locator>` (FS-04): it ticked a checkbox, so a forgotten matcher silently turned a soft assertion into a mutation that then passed. That case names both readings rather than guessing which was meant. | `expect text "x" is vissible` → `` did you mean `visible`? ``; `check field "Terms"` → `` `check <locator>` needs a matcher `` |
| `TF015` | Parser: a `test`/`action`/hook block has no indented body. | a `before file` block with no steps under it → `` this `before file` has no steps `` |
| `TF016` | Parser: top-level content that isn't a `test`/`action`/`import`/`use`/`before`/`after`. | `expect status equals 200` → `` expected a `test`, `action`, `import`, `use`, `before`, or `after`, found `expect` `` |
| `TF020` | Parser (config): an unrecognised key inside a config block. | `defaults` then `headr "Accept" is "application/json"` in `tflw.config` → `` did you mean `header`? `` |
| `TF021` | Parser (config): a `test` appears in the declaration-only config dialect. | `test "not allowed here"` in `tflw.config` → `` `test` is not allowed in tflw.config `` |
| `TF022` | Parser (config): top-level config content that isn't one of `defaults`, `env`, `session`, `require`, or `exclude` (M110, `V4-04` — this list is `CONFIG_DIRECTIVES` above, the same array the parser's own message is built from, so the two cannot drift again). | `workers 3` in `tflw.config` → `` expected `defaults`, `env`, `session`, `require`, or `exclude`, found `workers` `` |
| `TF023` | Parser: a duration whose unit is missing, mis-spelled, mis-cased, or spaced off its number. M98c (`A1-07`) made it reachable from **value** position — `expect duration is less than 250 ms` and `2sec` used to fall out of the step as ``TF010: unexpected `ms` at end of step`` / `= help: expected end of line`, because `250ms` and `250 ms` lex identically and the value path simply declined to build a duration when its adjacency or unit check failed. The three cases are kept apart because their fixes differ: a real unit written with a space, shown the closed-up spelling, a word that means a unit tflw spells differently (`sec` → `s`, `MS` → `ms`), and a word that was never a unit, which keeps the generic error. The known-spelling table is enumerated, not inferred, so `1e3` and `0xff` stay `TF001`'s numeric-notation case rather than acquiring a second, wrong explanation. | `defaults` then `timeout step 5x` in `tflw.config` → `` unknown time unit `x` ``; `api GET /a` then `expect duration is less than 2sec` → `` tflw's time units are `ms`, `s` and `m` — write `2s` `` |
| `TF024` | Checker (config): more than one `env` marked `default`, or a duplicate env name. | two `env … default` blocks in one `tflw.config` → `` more than one env is marked `default` `` |
| `TF025` | Checker (config): a key used in the wrong block. | `defaults` then `web "https://example.com"` in `tflw.config` → `` `web` is not allowed in defaults `` |
| `TF026` | Checker: an `api <service>`/`wait until api <service>` name not declared in the active env — checked in test/action/hook bodies **and** inside `session` blocks (decision 66). | `api billng POST /auth/login` → `` did you mean `billing`? `` |
| `TF027` | Checker: a `{col}` reference **in a test's name** that is not among its inline `with each` table's declared columns. Deliberately the name and nothing else (M110, `V4-05`): a bad `{col}` in the test *body* is indistinguishable from any other unbound variable at check time and is already `TF030`, which says the same thing with the same "did you mean" — a second code for it would split one mistake across two. **File-backed** tables (`with each from "…"`) are skipped entirely: their columns are not known until the file is read at run time, and `lang` does no I/O (`TF043` covers the file itself going missing). | `test "checkout {prcie}"` over a `with each` table whose only column is `price` → `unknown table column "prcie" referenced in the test name` |
| `TF028` | Checker: a `test … as <session>[, <session>...]` name not declared by any `session` block — one diagnostic per unknown name. | `test "x" as ghost` then `api GET /a` → `unknown session "ghost"` |
| `TF029` | Checker (config): a session name that is not the session's alone — a duplicate, or (M130b, D333) the reserved name `anonymous`. **One code, because it is one repair**: rename the session. `anonymous` is the built-in principal every `has no authorization violations` assertion probes with, present in the probe set without being declared, so a session by that name would either shadow it or be shadowed by it and neither is visible from the config. That is the same failure a duplicate has — one name, two things behind it — which is why this widened the row rather than taking a code of its own. | two `session admin` blocks in one `tflw.config` → `` duplicate session `admin` ``; `session anonymous` then `api POST /login` in `tflw.config` → `is a reserved principal name` |
| `TF030` | Checker: a `{var}`/bare-identifier reference provably never bound anywhere reachable in its scope — conservative (decision 57): only flags a name that's *definitely* unreachable, never one that merely might be. | `api POST /orders` then `capture body.ok as orderId` then `api GET /orders/{orderid}` → `unknown variable "orderid"` |
| `TF031` | Checker: a `request` assertion (`connects`/`fails`) combined with a response-based assertion (`status`/`header`/`body`/`duration`) on the same request, or used at all inside `wait until api` (decision 18). | `api GET /a` then `expect request connects` then `expect status equals 200` → `` can't be combined with `request connects`/`fails` on the same request `` |
| `TF032` | Checker: an `upload … type "…"` value that is a non-interpolated literal not shaped like `type/subtype` (decision 22/M19) — a light regex, not an IANA vocabulary check, so it only catches an obvious typo before the run. | `api POST /u upload "./f.png" as "avatar" type "imagepng"` → `invalid content type "imagepng", expected a "type/subtype" shape like "image/png"` |
| `TF033` | Parser/checker (load, M29/M30, M50/D93-D96): a workload-bearing `test`'s workload/threshold shape is invalid, two such tests in one file share a name (M30, D29 — names key each one's own metrics/threshold breakdown under concurrent multi-load-test runs), a `retry`/`with each` clause coexists with a workload (D96), a browser step appears inside a workload-bearing body (D19 — API-only in v1), `pause` appears outside one (D18), a workload-bearing `test` carries no `threshold` at all (M60/A4-01 — its verdict comes only from thresholds, so with none it can never fail), a workload-bearing `test` thresholds `duration` without pairing it with an **unscoped** `error rate` threshold (M89c/B3-14 — a duration threshold reads only the iterations that succeeded, so alone it is satisfied by a target that fails half its requests fast, and a *scoped* error-rate threshold bounds one endpoint while the rest of the scenario fails freely), an `authorization violations` assertion appears inside a workload-bearing body (M130b, D315 — each one sends a probe per declared principal, so under a workload the cross-identity traffic is multiplied by the load factor against a host authorized for a scan, not for a scan times the VU count), or a removed keyword is found — `scenario` (D103 — write `test "…" { ramp to … }` instead) or `think` (FS-05 — renamed to `pause`). The `pause`/browser-step bans follow calls into `action`s (M60/A4-02) and report at the call site, since the same action is legal under a workload and illegal outside one. The `pause` hint names both ways out honestly (FS-05): a *condition* is `wait until …` / `wait until … for <dur>`, while genuinely elapsed time — a cache TTL, a token expiry — has no condition to poll and belongs in the JS escape hatch (§11). | `pause 2s` → `` `pause` is only legal inside a workload-bearing `test` ``; `think 2s` → `` `think` was renamed to `pause` `` |
| `TF034` | Checker (load, M43/D70): a `threshold … for "label"` clause references a label that matches no `api` step's identity (its explicit `as "label"` tag, or its automatic `METHOD path.raw` identity when untagged) within the same workload-bearing test. | `threshold p95 duration for "checkotu" is less than 250ms` with only an `as "checkout"`-tagged step in scope → `` threshold `for "checkotu"` matches no step in this test `` |
| `TF035` | Checker (M60/`A2-01`; widened M97b/`B5-02`): a name is declared as an `action` more than once in the namespace a file actually runs in. Two `action`s in one file is the original case — actions are file-scoped, so the second shadows nothing, it is simply ambiguous. As of M97b the same code also covers a name declared locally *and* brought in by an `import`, and a name two `import`s both provide: the runtime (`buildRegistry`) has always refused all three, and `TF035` used to see only the first — so the manifest, the checker and its test agreed with each other while missing what the runtime enforced. The imported halves are reported only when the imports were actually read (the same `undefined`-vs-`[]` rule `TF037` turns on): a name cannot be called a duplicate of something nobody looked at. | `action fetch it()` declared twice → `duplicate action "fetch it"`; the same name arriving via `import "./shared/orders.tflw"` → `duplicate action "fetch it" (imported from "./shared/orders.tflw")` |
| `TF036` | Checker (M85/A4-10): the **active** env's own `api`/`api <service>`/`web` base URL has a host that its own `allow hosts` list (accumulated across `defaults` + the env, SPEC §3.7) does not match — a statically decidable contradiction that costs a whole run to discover otherwise, one identical runtime refusal per step for one config line. Env-scoped like every other config check (`checkSessionServices`, `knownServices`): a contradiction in an env you have not selected is not this run's problem, and a suite may legitimately keep a deliberately-blocked env as a negative-case fixture. The hint names the consequence *that key* has — only the default `api` base takes the whole suite down; a named service takes its own calls, `web` takes the browser half. Only fully literal URLs are checked: a base URL containing `{…}` names a host this pass cannot decide, and is skipped rather than guessed at (note that `resolveConfig` takes such a URL literally today — the recorded `A2-12` gap — so skipping it neither hides a live behaviour nor pre-commits this check if config interpolation ever lands). | `api "http://127.0.0.1:9099"` alongside `allow hosts "example.com"` → `` env `local`'s `api` base URL is "http://127.0.0.1:9099", whose host "127.0.0.1" is not in its own `allow hosts` (example.com) `` |
| `TF037` | Checker (M87/A4-03, `FU-08`): a call names neither an `action` nor a JS helper, so the run dies at that step with `unknown call`. Being a *negative* claim it is made only where it is sound, which is narrower than it first looks. **The world must be closed**: every `import` resolved, and no `use` at all — a JS helper module's exports cannot be enumerated without importing it, and the checker never executes the code it checks (P#2), so one `use` line makes this undecidable for that file. **And the frame's registry must be knowable**: a `test` or hook body, never an `action` body. Calls bind late, against the *entry* file's registry, so a shared action may legitimately call a name only its importer defines; a `test` is safe because an imported file's tests never run (`buildRegistry` takes only its `actions`). `TF038` is unaffected by either condition — it only ever fires on a name that already resolved. | `creat order("Widget")` beside `action create order(name)` → `` did you mean `create order`? `` |
| `TF038` | Checker (M87/A4-03): a call resolves to a known `action` but passes the wrong number of arguments. Sound regardless of `use`, unlike `TF037` — the runtime resolves actions before helpers (`execCall`), and an action name is unique across the whole registry (`TF035` and `buildRegistry` both refuse a duplicate), so a name that matches a declared action is that action and nothing else. | `create order("Widget", "extra")` against `action create order(name)` → `action "create order" expects 1 argument, got 2` |
| `TF039` | Checker (M87/A4-16, `FU-12`): an `expect`/`check` on a response-backed subject (`status`/`duration`/`header`/`body …`/`request`), or any `capture`, appears before the first `api`/`wait until api` step **in its own response scope**. The scope is exactly one `execSteps` frame in the interpreter, which is narrower than it looks: a `test`/`action`/hook body is one, and so is each nested `within` / `switch to new tab` / `download` body. An `action` gets its own — calling one never publishes its response to the caller (that is `FU-12`) — and a `before` hook's response is likewise invisible to the test body. UI subjects (a locator, `page`) and `request to "…"` network observations are excluded: the interpreter routes those away from the response path entirely, so they never needed one. A `{variable}` subject (M96) is excluded for the same reason — it reads a `let`/`capture` binding, and an *unbound* one is already `TF030`. | `expect status equals 200` as a test's first step → `` no response yet — an `api` step must run before this assertion/capture `` |
| `TF040` | Checker (M87, found while fixing `A4-03`): a call is written somewhere its value is never computed. The interpreter evaluates a `CallExpr` in exactly two places — a bare call step, and the *whole* right-hand side of a `let` — because running one is asynchronous and `evalValue` (which computes every other value) is synchronous by design. A call anywhere else parses, checks, and then silently yields nothing: `body { id: create thing() }` drops the field and sends `{}`, `[create thing()]` sends `[null]`, and `give create thing()` returns nothing — each at a green `✓`, testing a request nobody wrote. Reported alone for such a call: `TF037`/`TF038` are suppressed there, since the position is the thing to fix first. | `api POST /orders body { id: create thing() }` → `` bind it first — `let result = create thing(…)` — then use `{result}` here `` |
| `TF041` | Checker (M96, `FU-11`): a `{variable}` subject stands somewhere a value cannot. Two cases. **A live-handle matcher** — `is visible`/`hidden`/`enabled`/`disabled`/`checked`, `has value`, `matches snapshot`, `has no … a11y violations`, `connects`/`fails`, `was made` — needs a browser element, a page, a connection attempt or an observed request; a bound value has no such state to observe, whatever its type. The *type*-constrained matchers (`equals`, `contains`, `matches "<regex>"`/`subset`/`schema`/`file`, `is greater/less than`, `has count`) are deliberately **not** checked here: a mismatch there is a runtime error for `body.<path>` today, and a captured value must not be stricter than the response it came from. **Inside `wait until api`** — that block re-issues its request and re-evaluates its expects each poll, and a value subject cannot change between polls, so the assertion either passes on the first attempt or times out blaming an endpoint that never controlled it. Distinct from `TF014` (an *unrecognised* matcher): `is visible` is recognised, just misplaced. | `expect {orderId} is visible` → `` `is visible` needs a live browser element, page, or request — not a value `` |
| `TF042` | Checker (M97b, `A4-11`/`A4-15`): a matcher used where its subject cannot be read, or an `any`/`all` quantifier on a matcher that cannot be applied element by element. The rule is over the subject's **kind** — a value, a UI locator, `page`, `request`, `request to "…"` — and is read straight off SPEC §6.2's own table, so the checker and the reference are one statement. **Shape is deliberately not checked**: `contains` documents "strings, arrays", but whether `body.msg` is either is not knowable until the response arrives, so that stays a runtime error. The quantifier half covers the two matchers that fetch an external document (`matches schema`, `matches file`); `matches file` in particular used to fail with a message about UI matchers, and under `any` was swallowed into "none of N elements matched". Distinct from `TF041`, which is this same rule for a `{variable}` subject and says so in that case's own words. Was a documented gap in §1 until M97b closed it. | `api GET /a` then `expect status is visible` → `` `is visible/hidden/enabled/disabled/checked` can't be used on a value ``; `api GET /a` then `expect any body.items matches schema "W" from "/o.json"` → `` `any` can't be combined with `matches schema "Name" from "src"` `` |
| `TF043` | Checker (M97c, `A4-07`): a path literal names a file that is not there. Covers every syntax that opens one — `import`, `use`, `with each from`, `body from`, `upload`, `matches file`, `drop file` — resolved exactly as the runtime resolves it, against the directory of the file that names it. **Only statically-known paths**: `upload "./fixtures/{name}.png"` names no file until the run picks a `name`, so it is skipped rather than guessed at. **Two severities (M97e, D147).** `import`/`use` are an **error**: `tflw check` opens them itself, so a missing one degrades the check that is running. The other five are a **warning** — the checker only `stat`s them on behalf of a step that has not run yet, and an earlier step, a hook, a `use`d JS action or a fixture build between `check` and `run` may create the file first. As an error that was a D137 clause 1 violation: `matches file "./x.bin"`, where an earlier step writes `x.bin`, is a valid suite that ran for eleven milestones and that M97c made unrunnable with no override. SPEC §4.3 has claimed this check since M2.5 and it did not exist; the row concluded the checker "could not" do it because it does no I/O, which mistook a `@tflw/lang` package invariant for a `tflw check` command one — the CLI has read imported files at check time since M87. The cost of not having it was the whole console output of a failed run being `✗ t.tflw (crashed) (0 ms)`, `--verbose` included. **`cert`/`key` in `tflw.config` are not covered** (config dialect, filed separately), and neither is CSV *column* existence, which needs the file's contents rather than a `stat`. | `import "./nowhere.tflw"` then `test "t"` then `api GET /a` → `` `import` names a file that does not exist: "./nowhere.tflw" `` |
| `TF044` | Checker (M97d, `A4-13`): an `action` that can reach itself, directly (`a → a`) or through others (`a → b → a`). Sound to reject because **tflw has no conditionals** — no `IfStmt`, no branching keyword — so a cycle is not *potentially* infinite but unconditionally so, and the only way such a run can end is by failing. **Not gated on a closed world**: a same-file name can never be shadowed (`buildRegistry` throws on a duplicate and `TF035` reports it), so the check still applies to a suite that `use`s a JS helper. **Across `import`s too (M109, `M97d-01`)**: the graph is the one a run would build — this file's actions, then each import's, first declaration winning as `buildRegistry` has it — which is decidable precisely because calls bind late against the entry file's registry. Two limits, both by construction: with the imports unread (`importedActions` `undefined`) only local edges are seen, and a cycle whose every call site sits inside imported files is left to that file's own check, there being no span here to underline. The runtime guard stays the backstop for both, naming the same path in the same arrow notation; it used to be a raw V8 `RangeError` plus a 14,505-character single-line error. Only *evaluated* calls are edges: `let x = f() + "y"` never runs `f`. One diagnostic per cycle, not one per member. | `action a()` calling `b()`, `action b()` calling `a()` → `` this call completes a cycle: `a → b → a` `` |
| `TF045` | Lexer (M98b, `A1-10`/`A1-20`): bracket accounting does not balance — a `{`/`[` that is never closed, or a `}`/`]` that closes nothing. Both directions carry this one code because they are the same fact seen from either side. The unclosed case is reported **at the opening bracket**, and only for the innermost one: while a bracket is open the lexer emits no `newline`/`indent`/`dedent` at all, so a single stray `{` absorbs every following line into the same logical line, and the outer entries are consequences of the same typo rather than separate mistakes. Before this the lexer tracked only a *count*, which is enough to decide continuation and leaves nothing to point at, so the failure surfaced as `TF010: expected a field name, found a dedent` — carets on a synthesized dedent at line 3 of a 2-line file, underlining nothing. | `api POST /o body {` → `` this `{` is never closed ``; a stray `}` → `` `}` closes a bracket that was never opened `` |
| `TF046` | Lexer (M98b, `A1-11`): a tag with no usable name — a bare `@`, `@ smoke` with a stray space, or `@123` starting with a digit. The tag token used to be pushed unconditionally, so `@` alone became `tag:""` and `tflw check` reported no problems at all. The cost is specific: a tag that is not a writable identifier can never appear in a `--tag` expression, so the test carrying it can be neither selected nor excluded — the failure class where a filter appears to work and silently runs the wrong set. `@ smoke` gets its own help line, because by the time the parser sees it the `@` is gone and the error reads ``expected `test`, found `smoke```. | `@ smoke` then `test "t"` then `api GET /a` → `` a tag needs a name after the `@` `` |
| `TF047` | Lexer (M98b, `A1-05`): a string escape outside the supported set (`\"`, `\\`, `\n`, `\r`, `\t`). `"^\d+$"` used to decode to `^d+$` — the backslash silently dropped — and the run then matched against a pattern nobody wrote, printing the written form in the step echo and the mangled form in the reason line without connecting them. **An error rather than a preserved backslash**, and this is the permanent choice: preserving it is what a regex author wants, but under that rule the meaning of `"\q"` depends on membership in a five-entry table, so every escape added to the table later would silently change the value of existing suites. A rejected program becoming legal is additive; the reverse is not, which is the only direction a frozen surface can move. Matches JS, Java and non-raw Python. In a regular expression, write the backslash twice. **M98d (D166) adds `\u{XXXX}` to the set, and every way of getting it wrong to this code**: no braces (`\u0041` — what a JS or Java author's fingers produce), no code point (`\u{}`), unclosed, above `\u{10FFFF}`, or naming a surrogate half. That is one code widened rather than a second one added, and the test is the *fix*, not the number of conditions: all of these are corrected by spelling the escape the way tflw spells it, whereas `TF003`'s two conditions (M98c) were split precisely because re-indenting a block and changing an editor setting are unrelated repairs. The braced form is the only one, because it is the only one that can write a character above U+FFFF as a single escape rather than as a surrogate pair. | `api GET /a` then `expect body.id matches "^\d+$"` → `` unknown escape `\d` in a string `` |
| `TF048` | Lexer (M98c, `A1-12`/`A1-13`): a line is indented with tabs. Split out of `TF003`, which was carrying this and "indentation does not line up with any enclosing block" under one code while documenting only the second — and this row is what SPEC §17, the docs-site Reference page and LSP hover are generated from, so one code meaning two things made all four surfaces wrong at once. Reported **once per file**, at the first offending line, with the number of remaining lines in the help: the rule fired once per line before, so one wrong editor setting produced 100 identical errors on a 100-line file, none of which is a separate mistake and all of which have the same one-setting fix. The rule itself is unchanged, and is now written down in `GRAMMAR.md` § Lexical, where it had never appeared. | a file indented with tabs → `tabs are not allowed in indentation; use spaces` |
| `TF049` | Lexer (M98d, `A1-17`): a Trojan Source character — a bidi control (`U+202A`–`U+202E`, `U+2066`–`U+2069`), a zero-width character (`U+200B`–`U+200D`), or a `U+FEFF` anywhere but the very start of the file. What these share is that they make the source as *rendered* and the source as *parsed* two different texts: a bidi override inside a comment can display as an assertion that is not the one being run, and a zero-width space inside a compared string renders identically to the string without it. **An error, not a warning** (D165): for a general-purpose language a lint is the norm, but here `tflw check` is the gate, exit 0 is the signal, and a warning changes neither — while a reviewer reading a `.tflw` in a pull request has the rendered text as their only evidence of what it asserts. CVE-2021-42574; Rust, Go and the major C++ compilers all added a rule after it. Reported **only from the paths that consume a character without lexing it** — indentation, whitespace between tokens, a comment, the inside of a string — because everywhere else these characters cannot start a token and so already reach the author as `TF001`, and reporting both would be one mistake twice. `U+FEFF` is the case that could not be left to `TF001`: it is deliberately skipped as whitespace (M59, `A1-04`), so away from offset 0 it can sit inside what reads as a single name and split it into two tokens in silence. Every rejection here has a legal alternative — `\u{…}`, added by the same milestone (D166) — because a rule with no way to comply is a capability removed, not a lint. | a comment containing `U+202E` → `hidden character U+202E RIGHT-TO-LEFT OVERRIDE in a comment` |
| `TF050` | Lexer (M103, `M98d-02`): the other half of the Trojan Source class — a word **inside a string** that mixes Latin with a script that has Latin lookalikes (Cyrillic, Greek, Cherokee, Armenian). Where `TF049` covers characters with no glyph, these have a glyph and it is somebody else's: `"аdmin"` with a Cyrillic `а` renders exactly like `"admin"` and compares unequal to it. **The severity comes from the negative matchers.** In `is`/`equals` a confusable makes the test *fail*, which is loud and self-correcting; in `not equals`/`not contains` — the shape a leak-prevention assertion takes — it makes the test **pass without asserting anything**, with no evidence on screen, in a diff, or in `tflw check`. The unit is one **word**, not one string (D178): a `.tflw` string is prose and prose is legitimately multilingual, so `"Willkommen — добро пожаловать"` is two scripts with no mixed word and stays legal, where a per-string rule would reject it. Only lookalike scripts count (D179): `"東京Tower"` mixes Latin and Han in one word and deceives nobody, because Han has no Latin homoglyphs. Common and Inherited never count — that is where `—`, `§`, `…`, `→` and `×` live. **Strings only** (D180), unlike `TF049`: a comment has no `\u{…}` to escape into, and a rule with no way to comply is a capability removed rather than a lint. **Not covered:** a word written *entirely* in one non-Latin script that still reads as Latin (`"аԁmіn"` in all Cyrillic) — that needs the UTS #39 confusables table and is indistinguishable by shape from legitimate Russian data. The escape hatch is `\u{…}`, and it works because the scan reads raw source. | `expect body.status not equals "оk"` → `` the word `оk` mixes Latin with Cyrillic — U+043E `` |
| `TF051` | Checker (M116, `M97a-04`/`M97a-15`): a step needs a base URL the **active env** does not declare — `open` needs `web`, and an api request line with no `<service>` prefix needs the default `api`. Both halves are one rule with two operands, which is why they share a code: the AST says which kind a step needs, `tflw.config` says which kinds the env declares, and the answer is the same missing line either way. **An error, not a warning**, and the contrast with `TF043` is the point: a path a step opens may be created by an earlier step, so `TF043`'s run tier is a *prediction*; a base URL cannot appear after the config is resolved, so this is an *observation*. The rule is precise about the service prefix — `api orders GET /health` resolves against a named service and stays silent even when the env declares no default `api`, because a multi-service config with no default is an ordinary shape rather than a mistake. The third site is the one nobody expects: `matches schema "…" from "<relative>"` resolves its source against the default service too (`contract.ts`), so a relative schema path needs `api` exactly as a request does, while an `http(s)://` one needs nothing. | `api GET /health` → `` needs an `api` base URL ``; `open "/login"` → `` needs a `web` base URL `` |
| `TF052` | Checker (M116, `M97a-05`): `mask <locator>` written against a matcher other than `matches snapshot "…"`. A mask blanks a region *of a snapshot* before comparing it, so against any other matcher there is nothing for it to blank and the clause is silently doing nothing — which is the failure mode worth a diagnostic, since the author plainly believed it was masking something. The parser accepts a mask after any matcher **by design** (`parseSnapshotMasks`): rejecting it there would produce a parse error pointing at the wrong token, where this points at the mask itself. One diagnostic per mask rather than per statement, because each mask is a separate thing the author wrote and expected to do something. | `api GET /a` then `expect status equals 200 mask field "Email"` → `` only applies alongside `matches snapshot `` |
| `TF053` | Checker (M116, `M97a-11`–`M97a-14`): `capture` against a subject that can be *asserted about* but not bound to a name — `page`, `request`, a UI locator, or an observed `request to "…"`. One code for what the runtime throws from five sites, because all five say the same sentence, and the hint names the operation each subject actually supports. **The `of request to "…"` case is the one that is easy to get wrong**: `status`/`header`/`body`/`body text` are ordinary value subjects, and `capture status as n` is perfectly legal — it is the `of` modifier that makes them uncapturable, since an observed network request is read from the browser's network log rather than from the last api step's response. So the rule tests the modifier before the subject kind; a kind-only rule looks complete and passes `capture status of request to "/x" as n` straight through. | `api GET /a` then `capture request as r` → `` does not support `request` ``; `api GET /a` then `capture status of request to "/a" as s` → `` does not support a `request to `` |
| `TF054` | Checker (M124, `M97a-02`/`M97a-03`/`M97a-16`): an operand **written in the file** that the step will reject the moment it evaluates — `random number 5 to 1` (an empty range), `random password 2` (no room for the four character classes it guarantees), `hex`/`base64`/`url` `decode("…")` over a literal that will not decode, or a `matches`/`fails matching` pattern that is not a valid regular expression. Seven runtime `throw`s, one sentence, one code. **The rule fires on literals only, and that is the point rather than a limitation**: `random number {lo} to {hi}` is ordinary, legal and unknowable until the run binds those names, so an interpolated operand stays the runtime's. The decode tests are *imported* from the same module `eval.ts` uses (`literalValidity.ts`) rather than restated — "valid hex" has a length clause and "valid base64" excludes the URL-safe alphabet, and a second copy that drifted would report an error on a program that runs fine. | `let bad = random number 5 to 1` → `` `to` must be ≥ `from` ``; `let x = hex decode("not-hex!")` → `is not valid hex`; `api GET /a` then `expect body.name matches "("` → `invalid regex in matcher` |
| `TF055` | Checker (M124, `M97a-06`): `wait until <locator> … for <duration>` whose hold window is at least as long as `timeout wait`. The window asks the condition to stay true for longer than the step is allowed to run, so it can never close — the step can only end by timing out, reporting a slow app, which is the one thing that was not wrong. **A warning, not an error, and the tier is the whole decision.** The second operand comes from `tflw.config` and differs per env, so the checker is *predicting* what this run will do rather than observing something settled: a suite whose CI env raises `timeout wait` to 120s is correct, and an error would make it unrunnable with no override. That is D147, filed after `A4-05` shipped exactly this mistake inside the milestone whose thesis forbade it. Skipped entirely when the caller resolved no env — `undefined` means nobody looked, not "the budget is zero". | `open "/x"` then `wait until button "Hidden" is hidden for 60s` → `can never be satisfied` |
| `TF056` | Checker (M124, `M97a-01`): `with each from "…"` naming a file whose extension is neither `.csv` nor `.json`. The loader reads rows from CSV (a header row) or JSON (an array of row objects) and picks between them by extension, so anything else is refused — but only *after* the file is opened, which means the run gets far enough to read a path whose problem was legible in the source all along. **Its own code rather than `TF043`**: `TF043` is `MISSING_FILE`, and here the file is very likely present — being present is what leaves the extension as the only thing wrong. They also sit on opposite sides of D147, since a missing file may be created by an earlier step (a prediction, warning) while an extension cannot change between check and run (an observation, error). Interpolated paths are skipped, like every other M124 rule. | `with each from "./rows.txt"` then `test "t"` then `api GET /health` → `` must be `.csv` or `.json` `` |
| `TF057` | Checker (M125b1, `FU-18`, D245): an `api`/`wait until api`/`open` step whose target is written as an absolute URL rather than a path under the active env's base. Absolute URLs became legal in M125b1 — before it, `api GET https://x/y` was a parse error and `open "https://x/y"` was *silently concatenated* onto the `web` base, opening `http://localhost:5173/https://x/y`, which loads on any SPA with a catch-all route and fails later on an unrelated assertion. This warning is the cost of making it legal: the step is fixed wherever it points, so `--env staging` moves every other request in the suite and not this one. **Not phrased as a mistake, because it frequently is not one** — a one-off request to a second host is the case the row was filed about, and the warning exists so that "this step ignores the env" is something the file says out loud rather than something a reader has to notice. Emitted when the caller resolved no config at all (nothing can be predicted about a refusal) or when an allowlist exists; when a config *was* resolved and declares none, `TF058` is emitted instead, because a step that is going to be refused does not also need to be told it is unportable. | `api GET https://api.example.com/orders` → `` `--env` will not move it ``; `open "https://example.com/checkout"` → `absolute URL` |
| `TF058` | Checker (M125b1, `FU-18`, D246): an absolute URL in a suite whose resolved env declares no `allow hosts` — the run will refuse to send it. **This is the one place in the language where the *absence* of an allowlist means enforcement rather than the lack of it**, and that inversion is the rule: `allow hosts` is opt-in and unset means every host is permitted (`allowHosts.ts:30`), which is the right default for a suite written entirely against its env's base URL, because that base *is* the declaration of where it talks. An absolute URL is the one form that can reach a host `tflw.config` never mentions, so writing one opts the suite into declaring where it may reach. **A warning here and a refusal at run time, and the split is D147**: `allow hosts` is read from `tflw.config` and differs per env, so the checker is predicting what *this* run would do — a suite whose CI env declares an allowlist is correct, and an error would make it unrunnable with no override — while the runtime has resolved the config and is looking at the URL it is about to fetch, so it observes and may refuse outright. Requires the caller to distinguish "a config was resolved and declares none" from "no config was resolved": the first is this rule, the second is `TF057`. | `api GET https://api.example.com/orders` → `the run will refuse to send it` |
| `TF059` | Checker (M125b1, `FU-18`, D266): a named api service and an absolute URL on the same step — `api billing GET https://other.example/x`. A service names the base URL to send to and an absolute URL already is one, so one of the two is dead text the author believes is doing something, and picking a winner silently is the failure class this whole row was filed about. **An error rather than a warning, and the contrast with the two codes above it is the clearest statement of D147 in the manifest**: both of `TF059`'s operands are written in the file, so no config can make the combination meaningful and there is nothing to predict — exactly `M124`'s line, one milestone later. The hint names both ways out without preferring one, since which of the two the author meant is genuinely not knowable from the step. | `api billing GET https://other.example/x` → `names a service and an absolute URL` |
| `TF060` | Checker (M128b, D291): `expect`/`check response has no … security violations` written against an env whose `api` base URL no `authorized target` declaration names. D21's declaration layer, made load-bearing in the milestone that introduces it — the alternative, ship the grammar and enforce it once something actually sends a probe, means shipping a safety control nothing exercises, which is the same criticism relocated. Matching is by **origin** (scheme + host + port), not by the pattern rules `allow hosts` uses: a declaration for `https://x.example.com` does not authorize `https://x.example.com:8443`, which is a different listener that may belong to a different team. **Loopback is not exempt**, deliberately — exempting it would exempt exactly the target this arc is tested against, shipping the requirement untested. Narrow in the same three ways `TF036` is: only the env's default `api` base, only a fully literal one, and skipped entirely when no config was resolved. | `api GET /orders` then `expect response has no security violations` → `` needs an `authorized target` declaration `` |
| `TF061` | Checker (M128b, D291): an `authorized target` that contains a wildcard, or that is not an absolute URL. **Why a wildcard is rejected here when `allow hosts` accepts one**: the two declarations look alike and mean opposite kinds of thing. `allow hosts` bounds where a suite may send ordinary traffic, and a bound expressed as a pattern is still a bound. This one is not a bound — it is an author affirming in writing that they are permitted to point a scanner at a named host, and nobody is authorized to scan `*.com`. A pattern records a claim whose scope its author could not have known when they wrote it. The non-absolute case is the same error one step earlier: `authorized target "staging.example.com"` reads like a declaration and authorizes nothing, because `TF060` compares origins and a bare hostname has none. | `defaults` then `authorized target "https://*.example.com" reason "staging"` in `tflw.config` → `cannot contain a wildcard`; `defaults` then `authorized target "staging.example.com" reason "staging"` in `tflw.config` → `must be an absolute URL with a scheme` |
| `TF062` | Checker (M130b, D328): the `api` step an `authorization violations` assertion judges names its own `Authorization` or `Cookie` header. Not a style objection — the probe strips the observed identity headers and applies the probing principal's own, so a credential written onto the step belongs to *neither* the owner's `as <session>` nor any principal in the probe set, and the differential comparison is then between two identities the run cannot name. A finding from that is confidently wrong in either direction. **Closed in two halves, on purpose** (D328): here, for a step in the same body, which is the boundary `checker.ts` already draws for call resolution (`a frame whose registry is knowable: a test or hook body, never an action body`); and again at run time, where the engine compares the observed request's identity headers against what the owning sessions actually contributed — both values are known, so that half is a comparison, not a heuristic. An interpolated header *name* is skipped rather than guessed at, since this rule refuses a file. Out of reach either way, and named in the run's own blind-spot line: a credential in a query string, in a body, or in an app-specific header the language cannot recognise. | `test "t" as shopper` then `api GET /orders/1` then `header "Authorization" is "Bearer x"` then `expect response has no authorization violations` → `` names its own `Authorization` header `` |
| `TF063` | Checker (M130b, D307/D329): an `authorization violations` assertion with no principal behind it. **Two doors, one rule and one repair — declare an identity.** (1) The assertion sits in a `test` that declares no `as <session>`, or in a `before file`/`after file` hook, which runs in its own scope isolated from every test (`ast.ts:57`) and can therefore never have an owner; a bare `before`/`after` hook runs once per test and shares its scope, so it is fine (there is no `before each` keyword — `each` belongs to `with each`). (2) `tflw.config` marks *every* declared `session` as `privileged`, so the probe set holds only the built-in `anonymous` — which tests authentication, not authorization. The oracle is differential: it re-issues the observed request under every declared principal but the owner's and compares what comes back, so with no owner, or no non-privileged principal, there is nothing to compare. Silent inside an `action` body, deliberately and symmetrically with `TF062`: calls bind late against the entry file's registry, so the executing test is a run-time fact, and the interpreter repeats the judgement with it in hand. That leaves a shared authorization check writable once and reusable, which is the language's only unit of reuse. | `test "t"` then `api GET /orders/1` then `expect response has no authorization violations` → `needs an owner`; `before file` then `api GET /orders/1` then `expect response has no authorization violations` → `needs an owner` |
| `TF064` | Checker (M130b, D315): an `authorization violations` assertion inside `wait until api`. **The cost is not the wasted traffic, it is what a real finding turns into.** `wait until api` re-issues its request until its nested expects pass, so a genuine BOLA — the assertion failing — would be re-probed under every declared principal on every poll, and then reported as a *wait timeout* rather than as a critical finding: the loudest possible result the tier can produce, converted into the quietest. Its own code rather than `TF063`'s because the repair is different (move the assertion to a plain `api` step after the block, rather than declare an identity), which is the same rule that split `TF003` and kept `TF047` whole. The sibling case — inside a workload-bearing `test` — is `TF033`, beside `browser steps aren't supported inside a workload-bearing test`, because that is the same rule about the same construct with the same fix. | `test "t" as shopper` then `wait until api GET /orders/1` then `expect status equals 200` then `expect response has no authorization violations` → `` can't be asserted inside `wait until api` `` |
<!-- GENERATED:diagnostics:end -->

Gaps in the numbering (`TF004`–`TF009`, `TF017`–`TF019`) are reserved, not skipped by accident —
they were never assigned to a diagnostic, so they stay open for a genuinely new one rather than
being backfilled to look tidy (backfilling would violate the stability rule in spirit even though
no code would be reused). Matcher↔subject compatibility became a checker diagnostic in M97b
(`TF042`) — over subject *kind* only; shape stays a runtime error, see §1.
