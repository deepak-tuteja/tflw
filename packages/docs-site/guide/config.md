# 2. Config & environments

`tflw.config` is parsed by the same lexer/parser as your test files — it's the same DSL,
declaration-only (`test` is a checker error here). Two tiers, `defaults` then the active `env`
(same-key-wins, no `extends` chains):

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

Active env selection: `--env <name>` flag > `TFLW_ENV` env var > the block marked `default`. No
resolvable env is a startup error. Unknown config keys are checker errors, not silently ignored.

## Named services

```
env staging
  api "https://stg.example.com/api"          # default service
  api billing "https://billing-stg.example.com"
```

`api <name> "<url>"` declares an extra service; steps address it by name
(`api billing GET /invoices/{id}`). Headers/auth can scope to one service:
`header "X-Key" is env(BILLING_KEY) for billing`.

## Secrets

```
require env ADMIN_USER, ADMIN_PW
```

`require env` validates at startup — one error lists every missing var, and every listed var is
pre-registered with the redactor from the very first step (masked even if never actually
evaluated). `.env` at the project root auto-loads for local dev; real environment variables win
over it. Anything that ever flowed through `env(NAME)` prints as `•••(NAME)` everywhere — reports,
traces, CLI output — automatically, by construction.

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

```
env staging
  api "https://staging.example.com"
  cert "./certs/client.pem"
  key "./certs/client.key"
```

`cert`/`key` are required together. Every request against that env presents the client
certificate during the TLS handshake; both `insecure true` and `NODE_EXTRA_CA_CERTS` still apply
alongside it.

## Host allowlist — an anti-pointed-at-prod guardrail

```
defaults
  allow hosts "api.example.com", "*.staging.example.com"
```

Refuses to send a request to any host not explicitly listed — enforced before any network I/O, so
a violation never even opens a connection. `*.domain` matches that suffix or the bare domain;
never declaring `allow hosts` means no enforcement at all (the unchanged default). Covers every
real network call a run makes, including an `oauth2` session's token request and a
`matches schema ... from ...` contract fetch (see [Assertions in depth](/guide/assertions)) — not
just ordinary `api` steps.

Full reference: [SPEC.md §3](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#3-the-config-dialect--tflwconfig-p27-31).
