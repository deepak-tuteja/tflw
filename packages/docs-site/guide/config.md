# Config & environments

`tflw.config` is parsed by the same lexer/parser as your test files — it's the same DSL,
declaration-only (`test` is a checker error here). Two tiers, `defaults` then the active `env`
(same-key-wins, no `extends` chains):

```tflw-config
defaults
  header "Accept" is "application/json"
  timeout step 10s, browser 30s, expect 5s, wait 30s
  workers 4
  report "./report"

env local default
  web "http://localhost:5173"
  api "http://localhost:3001"

env staging
  api "https://stg.example.com/api"
  timeout wait 60s              # overrides just this key
```

Active env selection: `--env <name>` flag > `TFLW_ENV` env var > the block marked `default`. No
resolvable env is a startup error. Unknown config keys are checker errors, not silently ignored.

## Timeouts

Five targets, in two families.

```tflw-config fragment
defaults
  timeout step 10s      # the fallback budget for both transports
  timeout api 10s       # HTTP requests only
  timeout browser 60s   # browser steps only
  timeout expect 5s     # a UI expect/check's retry budget
  timeout wait 30s      # a `wait until` step's poll ceiling
```

`timeout api` and `timeout browser` **narrow** `timeout step` rather than replacing it: an HTTP
request uses `timeout api` if you set one and `timeout step` otherwise, and a browser step uses
`timeout browser` if you set one and `timeout step` otherwise. Setting only `timeout step` therefore
still bounds both, which is what it has always done.

| written | HTTP request | browser step |
|---|---|---|
| nothing | 30s | 30s |
| `timeout step 10s` | 10s | 10s |
| `timeout step 30s, api 10s` | 10s | 30s |
| `timeout browser 60s` | 30s | 60s |

Reach for `timeout browser` when a page renders slowly: an `api` step can carry its own budget on
its own line (`api GET /slow timeout 90s`), while a browser step cannot, so before this existed the
only way to be more patient with the UI was to be equally patient with every request in the suite.

`timeout api` is also the one that matters under load. A request that overruns its budget is
aborted, so that iteration *fails* and never reaches the duration percentiles — meaning the budget
defines the right-hand tail your `threshold p95 duration …` reads. Browser steps aren't supported
inside a workload-bearing `test` at all, so `timeout browser` never affects a load run.

The two tiers merge **per key**, and one case catches people out: `defaults` setting `timeout api
10s` beside an `env` setting `timeout step 20s` gives api 10s and browser 20s. The env's broader key
doesn't reset the narrower one it inherited — same-key-wins is about the same key.

`timeout api 0s` and `timeout browser 0s` are refused (they'd abort every operation before it
started), while `timeout expect 0s` and `timeout wait 0s` are legal and mean *evaluate once, don't
poll*.

## The demo service

A freshly scaffolded config carries `api "tflw://demo"` instead of a real address:

```tflw-config
env local default
  api "tflw://demo"          # ← swap for "http://localhost:3001", or wherever your API lives
```

`tflw://demo` is tflw's own bundled demo service — a small HTTP server `tflw run` starts on a
loopback port for the duration of the run and stops afterwards, so a brand-new project is green
before you have wired anything up. It answers `GET /health` and 404s everything else; `tflw check`
never starts it. Runs against it are labelled `ℹ demo` in the summary and in `report.html`, because
they prove nothing about your system — replacing that one line is the first thing to do.

## Named services

```tflw-config
env staging
  api "https://stg.example.com/api"          # default service
  api billing "https://billing-stg.example.com"
```

`api <name> "<url>"` declares an extra service; steps address it by name
(`api billing GET /invoices/{id}`). Headers/auth can scope to one service:
`header "X-Key" is env(BILLING_KEY) for billing`.

## Secrets

```tflw-config fragment
require env ADMIN_USER, ADMIN_PW
```

`require env` validates at startup — one error lists every missing var, and every listed var is
pre-registered with the redactor from the very first step (masked even if never actually
evaluated). `.env` at the project root auto-loads for local dev; real environment variables win
over it. Anything that ever flowed through `env(NAME)` prints as `•••(NAME)` everywhere — reports,
traces, CLI output — automatically, by construction.

For a secret that **doesn't** come from an env var — a token the API mints and hands back mid-run,
a `Set-Cookie`, an API key baked into a fixture — name its position with `redact` instead:

```tflw-config
env staging
  redact header "Authorization", body.accessToken, query "token"
```

A value `capture`d out of a position you named is tracked from then on and masked wherever it later
appears. See [CI, reporting & safety](/guide/ci-and-reporting#redact).

## Corporate networks

Three real-world blockers Node's plain `fetch` doesn't handle, each with a zero-new-dependency
fix:

- **Self-signed/expired staging cert:** `insecure true` (per-`env` or `defaults`) disables TLS
  verification for the run — loudly: the CLI summary and `report.html` header both carry a bold
  warning banner, never a silent trade-off.
- **Private/internal CA:** prefer `NODE_EXTRA_CA_CERTS=/path/to/ca.pem npx tflw run` over
  `insecure true` — verification stays on, only your org's CA is added.
- **Corporate HTTP(S) proxy:** `NODE_USE_ENV_PROXY=1` on Node ≥ 24 makes `fetch` honor
  `HTTP_PROXY`/`HTTPS_PROXY`. Node 22 has no built-in env-var proxy path for `fetch` — an honest
  limitation, not worked around with a proxy-agent dependency.

Network failures name the likely cause instead of a bare `fetch failed` — a cert problem points at
`insecure true`/`NODE_EXTRA_CA_CERTS`, `ENOTFOUND` names a DNS failure, `ECONNREFUSED` asks whether
the service is actually listening.

## Client certificates (mTLS)

```tflw-config
env staging
  api "https://staging.example.com"
  cert "./certs/client.pem"
  key "./certs/client.key"
```

`cert`/`key` are required together. Every request against that env presents the client
certificate during the TLS handshake; both `insecure true` and `NODE_EXTRA_CA_CERTS` still apply
alongside it.

## Host allowlist — an anti-pointed-at-prod guardrail

```tflw-config
defaults
  allow hosts "api.example.com", "*.staging.example.com"

env staging default
  api "https://api.staging.example.com"
  allow hosts "billing-staging.example.com"
```

Refuses to send a request to any host not explicitly listed — enforced before any network I/O, so
a violation never even opens a connection. `*.domain` matches that suffix or the bare domain;
never declaring `allow hosts` means no enforcement at all (the unchanged default). The list
accumulates: a baseline in `defaults`, extended per env.

Covers every real network call a run makes — every `api` step on every client path, an `oauth2`
session's token request, a `matches schema ... from ...` contract fetch (see
[Assertions in depth](/guide/assertions)), **every hop of a redirect chain**, and **every request
the browser makes**, including the page's own XHR calls and not just what you `open`. A
[`stub`](/guide/browser-advanced#network-observation-stub-mocking)bed request is answered locally
and never reaches the network, so the list
doesn't apply to it.

If the env you're running has an `api`/`web` base URL that isn't on its own list, `tflw check` says
so (`TF036`) rather than letting every step fail identically at run time. It checks the env you
selected, not every env in the file — so a suite can keep a deliberately-blocked env around as the
negative-case fixture for this feature, and only hears about it when it actually runs that env.

### `authorized target` — what this suite may scan

```tflw-config
env secureLocal
  api "https://localhost:8443/v1"
  authorized target "https://localhost:8443" reason "self-hosted test fixture"
```

Required before any `expect response has no … security violations` or `… authorization violations`
assertion, and only for those — an ordinary suite never needs this key. Unlike `allow hosts`
directly above, it takes **no wildcards**: it is an affirmation that you may point a scanner at one
named host, and a pattern is not something anyone can affirm. The `reason` is required and is
printed in the run summary and the report, so the claim travels with the findings.

**Four optional indented sub-clauses** grant further permissions for *that host*, each granting
only itself. The one-line declaration above is unchanged; these are lines beneath it:

```tflw-config fragment
defaults
  authorized target "http://localhost:4001" reason "self-hosted test fixture"
    probe mutating
    probe oversized
    probe traversal
    probe ciphers
```

| sub-clause | grants | read by |
| --- | --- | --- |
| `probe mutating` | re-issuing a `POST`/`PUT`/`PATCH`/`DELETE` against this host | [authorization](/guide/authorization-testing), [input handling](/guide/input-handling), [crawling](/guide/crawling) |
| `probe oversized` | sending a 64 KiB payload | [input handling](/guide/input-handling) |
| `probe traversal` | sending `../` payloads | [input handling](/guide/input-handling) |
| `probe ciphers` | one TLS handshake per candidate suite, to read this host's *offer* | [hygiene scanning](/guide/security-scanning#probe-ciphers-—-asking-what-the-host-offers) |

Without the relevant one, the scan that needed it reports `not probed` rather than silently doing
the thing nobody said it could — and `not probed` is [never counted as
clean](/guide/security#what-a-green-scan-does-not-claim). They hang off the target because each is
a property of *that host*: staging may be safe to read as a stranger and not safe to write to.
Grants accumulate across declarations covering the same origin, and are never inherited from a
neighbouring one.

See [Security hygiene scanning](/guide/security-scanning) and
[Authorization testing](/guide/authorization-testing).

Full reference: [SPEC.md §3](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#3-the-config-dialect--tflwconfig-p2731-).
