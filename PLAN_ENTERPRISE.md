# tflw enterprise-readiness arc — plan

*Outcome of a `/grill-me` session, 2026-07-18. Covers both `testFlow/` (tflw) and
`../testFlow-tests/` (the dogfood app) — the two proceed in parallel, ping-pong per cluster.*

## Context

tflw v0.1.0 (API-only DSL — **not yet npm-published**; consumed locally via `npm pack` tarballs)
is feature-complete; testFlow-tests (dogfood app, M1–M20) has surfaced 14 gaps, 7 fixed. This
arc prepares the API half for **enterprise use** — usability, UX, security, governance — with
testFlow-tests evolving in parallel as the gap-provoking/proving instrument. The arc **displaces
the browser half (M3)** as tflw's next work.

## Decisions (from the interview)

1. **Target**: credible-for-real-teams **and** an actual adoption push — so governance
   (security policy, provenance, versioning guarantees) is in scope, not just features.
2. **Roadmap**: the enterprise arc displaces M3 (browser). Browser slides until after.
3. **Auth scope**: (a) session refresh/TTL — auto re-establish on 401 under a session (M14's
   real pain; makes OAuth2 client-credentials work end-to-end); (b) mTLS client certs —
   per-env `cert`/`key` config; (c) `oauth2` session sugar on top of refresh. Request signing
   (SigV4/HMAC) stays out — document the JS-escape-hatch recipe.
4. **Secrets**: env-vars only, no provider mechanism. Docs page of Vault/1Password/GitHub-secrets
   → env patterns. "Config never executes commands" becomes a documented security property.
5. **Report PII — both knobs**: (a) evidence level `full | headers-only | none` (config +
   CLI override); (b) declarative field redaction (`redact body.email, body.*.address`-style
   patterns in tflw.config).
6. **Entire open gap backlog closes in the arc**: #6 OpenAPI contract validation and #5
   Retry-After-aware retry as headline items, plus #12 (assert computed local value), with
   #10 (upload Content-Type), #11 (nested-array quantifier), #13 (concurrent requests) as the
   lower-priority tail.
7. **CI ergonomics**: `--format json`/results.json (serializer over the existing event
   stream), `tflw run --failed` (last-run state file), `--bail`. No sharding, no GitHub
   annotations (premature).
8. **Governance**: SECURITY.md + supply-chain statement now; npm publish `--provenance` from CI
   prepared but only exercised at the first actual publish; and a written **grammar stability
   policy** (semver contract for .tflw files + TF0xx deprecation-warning mechanism). Windows CI
   and accept-PRs stay deferred (decisions 79/80).
9. **Policy guardrails**: `allow hosts` config allowlist (runtime refuses unlisted hosts —
   anti-"pointed at prod") and `--forbid-insecure` (fail if `insecure true` active). No
   `--no-js` mode.
10. **testFlow-tests TLS sidecar**: nginx in docker-compose — self-signed HTTPS listener
    proxying to the api (dogfoods `insecure`/`NODE_EXTRA_CA_CERTS`/`--forbid-insecure`) plus a
    second listener requiring a client cert (dogfoods mTLS). Certs generated at container
    start; nothing committed.
11. **apiV2 fixtures (all four)**: `/oauth/token` client-credentials endpoint with a
    short-`expires_in` (~5s) variant; real OpenAPI response schemas on a meaningful endpoint
    set + one deliberately-drifted endpoint; `Retry-After` headers (seconds + HTTP-date) on
    rate-limited endpoints; a PII-rich profile/export endpoint for the redaction knobs.
12. **Versioning: stays 0.1.0 throughout the arc** — tflw isn't on npm yet, so version numbers
    only start meaning something at the first real publish; releases/renumbering get decided
    then. The grammar stability policy (decision 8) is written now but takes effect from that
    first published version.
13. **Dependency policy**: build-time-bundle **undici** (mTLS) and **ajv** (contract
    validation) into cli.js via esbuild; package.json keeps zero runtime deps; the
    supply-chain statement discloses bundled packages + versions.
14. **Cadence & order**: ping-pong per cluster (tflw milestone → immediate testFlow-tests
    consumption milestone → gaps fed back to TFLW-GAPS.md), in this order:
    **1) Auth** (refresh/TTL, oauth2 sugar, mTLS — fixtures: TLS sidecar + token endpoint) →
    **2) Safety/redaction** (allow hosts, --forbid-insecure, evidence levels, field redaction —
    fixture: PII endpoint) →
    **3) Contract + Retry-After** (#6 + #5 — fixtures: OpenAPI schemas + Retry-After headers) →
    **4) CI ergonomics** (json, --failed, --bail) →
    **5) Governance** (SECURITY.md, provenance CI staged, stability policy, secrets/signing
    docs) →
    **6) Gap tail** (#12, #10, #11, #13).
15. **Onboarding**: `tflw init --openapi <url>` (scaffold a starter suite from openapi.json —
    dogfoodable against apiV2) and a **docs site** (GitHub Pages built from SPEC/README).
    Benchmark expansion (vs Karate/Hurl) deferred.

## Execution shape

Per the big-build workflow rule: each cluster is a numbered milestone in **testFlow/PLAN.md**
(decision log continues) + **PROGRESS.md**, with per-milestone unit/integration tests; the
consumption side runs as milestones in **testFlow-tests/plan_v2.md** + its PROGRESS.md, every
feature proven against the running apiV2 stack (the M17–M20 pattern). Key touch-points:

- tflw: `packages/lang` (grammar: oauth2 session kind, `allow hosts`, `redact`, evidence level,
  contract matcher), `packages/runtime` (session refresh, undici dispatch/mTLS, Retry-After,
  ajv validation, host allowlist), `packages/reporter` (evidence levels, field redaction,
  results.json), `packages/cli` (--failed/--bail/--format json/--forbid-insecure,
  init --openapi), SPEC.md sections + status badges, SECURITY.md; provenance CI staged for the
  first real publish.
- testFlow-tests: `docker-compose.yml` (nginx sidecar), `apiV2/` (token endpoint, OpenAPI
  annotations, Retry-After, PII endpoint), new `tests/*.tflw` per cluster, TFLW-GAPS.md ledger.

## Verification

Each cluster: tflw package tests green (`npm test` in testFlow), then fresh
`node cli.mjs stop && start` in testFlow-tests, `npx tflw check`, `npx tflw run` full-suite
green (including under `--workers 4`), new scenarios proving the feature against the real API —
same bar as the existing Fixed entries in TFLW-GAPS.md. Redaction/evidence features verified by
inspecting the emitted report.html artifact for absence of the PII fixture values.
