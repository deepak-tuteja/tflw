# tflw enterprise-readiness arc — plan

*Outcome of a `/grill-me` session, 2026-07-18. Covers both `testFlow/` (tflw) and
`../testFlow-tests/` (the dogfood app) — the two proceed in parallel, ping-pong per cluster.
Amended 2026-07-19 (decisions 16–17, a second `/grill-me` session) to insert two new clusters —
docs site and LSP — before what was cluster 4. Cluster 4 (docs site) shipped 2026-07-19 as M12
(PLAN.md decision 103) — see decision 16's per-item status below. Cluster 5 (LSP) shipped
2026-07-20 as M13 (PLAN.md decision 104) — see decision 17's status line above.*

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
14. **Cadence & order** *(amended 2026-07-19, decision 16 below)*: ping-pong per cluster (tflw
    milestone → immediate testFlow-tests consumption milestone → gaps fed back to
    TFLW-GAPS.md), except clusters 4/5 which have no consumption milestone (decision 16.9):
    **1) Auth** (refresh/TTL, oauth2 sugar, mTLS — fixtures: TLS sidecar + token endpoint) →
    **2) Safety/redaction** (allow hosts, --forbid-insecure, evidence levels, field redaction —
    fixture: PII endpoint) →
    **3) Contract + Retry-After** (#6 + #5 — fixtures: OpenAPI schemas + Retry-After headers) →
    **4) Docs site** (VitePress on GitHub Pages, decision 16) →
    **5) LSP** (packages/lsp-server + VS Code client rewrite, decision 17) →
    **6) CI ergonomics** (json, --failed, --bail) →
    **7) Governance** (SECURITY.md, provenance CI staged, stability policy, secrets/signing
    docs) →
    **8) Gap tail** (#12, #10, #11, #13).
15. **Onboarding** *(superseded by decision 16 for the docs-site half — kept here for the
    original `tflw init --openapi` scope, which stays undecided/unscheduled)*: `tflw init
    --openapi <url>` (scaffold a starter suite from openapi.json — dogfoodable against apiV2).
    Benchmark expansion (vs Karate/Hurl) deferred.

16. **Docs site** *(2026-07-19 `/grill-me` session — inserted as cluster 4, before the original
    cluster 4)* — ✅ **shipped 2026-07-19 as M12, PLAN.md decision 103**: a real, detailed GitHub
    Pages documentation site — tflw is a new external DSL with its own grammar, and today's only
    docs surface is SPEC.md/README.md/`tflw docs`.
    1. **Generator**: **VitePress** — markdown-first, built-in local search, Vite-based, stays
       in the monorepo's existing Node/TS/esbuild ecosystem (vs. Docusaurus's heavier config
       surface or mkdocs-material's Python toolchain).
    2. **Content strategy — hybrid**: hand-adapted narrative *Guide* pages (started from
       SPEC.md §2–13's existing prose, lightly rewritten for an external first-time reader, not
       written from a blank page) + mechanically **auto-generated Reference pages** (matchers,
       generators, CLI flags, diagnostic codes TF001–TF030, config keys). Pure generate-from-
       SPEC.md was rejected (SPEC's decision-log prose isn't reader-facing); pure hand-rewrite
       was rejected (two documents drifting apart, unacceptable for a solo maintainer).
    3. **IA**: Home · Getting Started · Guide (Project layout, Config dialect, Tests &
       structure, API steps, Assertions & matchers, Variables & data, Sessions & auth, JS
       escape hatch, CLI) · Reference (auto-generated) · Grammar (renders
       `packages/lang/GRAMMAR.md`) · Changelog (mirrors `CHANGELOG.md`).
    4. **A new canonical structured manifest**, `packages/lang/src/spec-data.ts` — real
       structured data (name/params/types/doc text) for every matcher/generator/CLI flag,
       instead of each consumer re-parsing SPEC.md's markdown prose independently. **SPEC.md's
       own tables are generated from this manifest** (reversed from today's direction, where
       `gen-docs.mjs` parses SPEC.md prose into `DOCS_TOPICS` for `tflw docs`) — the manifest
       becomes the single source feeding: SPEC.md's tables, the CLI's `tflw docs`, the site's
       Reference pages, and (cluster 5) the LSP's hover/signature-help/completion. CLI flags go
       into the manifest by hand (the CLI's arg parsing in `cli.ts` is hand-rolled `if (a ===
       '--x')` chains, not a declarative registry — nothing to introspect).
    5. **Browser playground — parse+check only, in scope**: `@tflw/lang` is the only zero-
       runtime-dependency package (confirmed via its `package.json`) and browser-bundles
       cleanly via the same esbuild recipe `packages/cli` already uses for Node — paste/type a
       `.tflw` file, get live syntax highlighting + `tflw check`-equivalent diagnostics inline.
       No execution, no network calls, no backend (a real "run this against a live API" mode is
       infeasible — CORS, and a public site must not proxy arbitrary user-supplied URLs).
    6. **Versioning**: single unversioned site tracking `main`. A version switcher/archived-
       version builds are explicitly deferred until tflw's first real npm publish — the same
       trigger decision 8's grammar stability policy already uses.
    7. **Placement**: new workspace member `packages/docs-site` (private, unpublished), added to
       root `package.json`'s `workspaces` — gets a real workspace-symlinked dependency on
       `@tflw/lang` for the playground bundle, participates in root `npm ci`/`build`/`typecheck`.
    8. **Deploy**: a new GitHub Actions workflow (separate from `ci.yml`), auto-deploying via
       `actions/configure-pages` + `actions/deploy-pages` on every push to `main`.
    9. **Search**: VitePress's built-in local search (client-side, build-time indexed) — no
       Algolia DocSearch application/external dependency needed at this scale.
    10. **README.md trimmed to a lean landing page**: keep Why/Install-quickstart/Status/
        Platform/Contributing; replace the deep walkthroughs (Actions, Hooks, Polling,
        Data-driven, Generators, Retry, full CLI reference) with short teasers + links to the
        site — avoids README and the site's Guide drifting apart the way SPEC.md and a
        hand-rewritten site would have.
    11. **`GRAMMAR.md` freshening**: `packages/lang/GRAMMAR.md` was last touched at decision 96
        (2026-07-10) and is missing M9–M11 entirely (session refresh/oauth2/mTLS, allow
        hosts/redact/evidence, contract schema/retry honoring — confirmed zero mentions). A
        one-time catch-up pass through decision 102 is in scope for this cluster before it's
        published as the site's Grammar page; going forward, updating `GRAMMAR.md` alongside
        SPEC.md is expected of every milestone (the discipline that lapsed after M0).
    12. **Theming**: the site supports both light and dark mode via VitePress's built-in
        `appearance` toggle (`'dark' | 'light' | 'auto'` — a simple config flag, no separate
        theme build), so it matches the reader's OS/browser preference rather than forcing one
        palette.

17. **LSP** *(2026-07-19 `/grill-me` session — inserted as cluster 5, immediately after the docs
    site, consuming its `spec-data.ts` manifest)* — ✅ **shipped 2026-07-20 as M13, PLAN.md
    decision 104**: replace the VS Code extension's child-process `tflw check --format json`
    diagnostics with a real Language Server Protocol implementation.
    1. **v1 scope — full feature set** (not phased): diagnostics, hover, go-to-definition,
       autocomplete, rename, signature help, all in this cluster.
    2. **Architecture — stay in this monorepo, restructured**: new `packages/lsp-server`
       (editor-agnostic language server) + `packages/vscode` becomes a thin client that launches
       it. Explicitly *not* split into a separate sibling repo (unlike testFlow-tests): the LSP
       needs `checker.ts`'s exact types/symbol-resolution, and a separate repo would force
       consuming `@tflw/lang` via the same npm-pack-tarball mechanism testFlow-tests uses —
       every grammar change would need a re-pack+reinstall before the extension could build,
       recreating the drift risk decision 16.4 was designed around. In-repo workspace symlinking
       keeps them permanently in lockstep for free.
    3. **Diagnostics — full replacement**, not dual-path: the LSP server parses/checks in-
       process using `packages/lang` directly, publishing live diagnostics on every debounced
       change. The old spawn-based path in `extension.ts` is deleted entirely; CodeLens/Run stay
       client-side vscode-only features, untouched.
    4. **`tflw lsp` CLI subcommand ships**: `packages/cli` gains a thin subcommand launching the
       language server over stdio — the mechanism that actually delivers editor-agnosticism
       (Neovim's `lspconfig`, Helix, coc.nvim, etc. all get support for free); the VS Code
       extension's own launch reuses the same entry point instead of duplicating it.
    5. **Rename scoped to checker-resolved symbols only**: captured variables, session names,
       and imported action names (`use "path" import name`) — the exact same closed set
       go-to-definition targets, cross-file safe via already-tracked `use` imports. No renaming
       of test names, tags, or other free-text tokens (no checker-tracked symbol identity to
       back it safely).
    6. **Autocomplete — true grammar-aware, not heuristic**: rejected the lower-risk
       line-context/regex heuristic (the same philosophy `lib.ts`'s `parseTestDeclarationLine`
       already documents) in favor of a real parser mode. Scoped via a **prefix-based
       mechanism**: parse up to the cursor, and when the parser hits end-of-input mid-production
       (the common case — everything before the cursor is itself valid), capture the set of
       tokens/keywords that would have been legal next. Deliberately *not* full statement/block-
       level error recovery (handling cursor completion inside a file with *other*, unrelated
       syntax errors elsewhere) — out of scope for v1.
    7. **Consumes `packages/lang/src/spec-data.ts`** (decision 16.4) for hover content and
       signature-help parameter shapes — built once in the docs-site cluster, not duplicated.
    8. **Testing — pure-function-first**: resolution logic (definition-at-position, hover-at-
       position, completion-candidates-at-position, rename-edits-for-symbol) as pure functions
       over `packages/lang`'s AST/checker output, unit-tested directly with `node:test` — same
       split `packages/vscode/src/lib.ts` already uses (pure logic tested, `vscode`-dependent
       glue isn't). A handful of real in-memory JSON-RPC protocol tests (one per capability)
       prove the `vscode-languageserver` wiring itself, not exhaustive protocol coverage.
    9. **Reparse strategy — full reparse per change, debounced** (~150–300ms), not incremental
       parsing. Realistic `.tflw` file sizes (a few hundred lines at most, this suite's largest
       files included) and this parser's existing speed make incremental parsing unnecessary
       engineering investment.

    **Cadence exception** (both clusters 4 and 5): neither adds new DSL grammar/runtime
    behavior, so neither gets the usual testFlow-tests consumption milestone — a deliberate,
    documented pause in the ping-pong pattern (decision 14), which resumes normally at cluster 6
    (CI ergonomics), since that cluster *does* add new dogfoodable CLI behavior.

## Execution shape

Per the big-build workflow rule: each cluster is a numbered milestone in **testFlow/PLAN.md**
(decision log continues) + **PROGRESS.md**, with per-milestone unit/integration tests; the
consumption side runs as milestones in **testFlow-tests/plan_v2.md** + its PROGRESS.md, every
feature proven against the running apiV2 stack (the M17–M20 pattern) — except clusters 4/5
(decision 16/17's cadence exception), which have no consumption side. Key touch-points:

- tflw (clusters 1–3, done): `packages/lang` (grammar: oauth2 session kind, `allow hosts`,
  `redact`, evidence level, contract matcher, `retry honoring`), `packages/runtime` (session
  refresh, undici dispatch/mTLS, Retry-After, ajv validation, host allowlist),
  `packages/reporter` (evidence levels, field redaction), `packages/cli`. testFlow-tests:
  `docker-compose.yml` (nginx sidecar), `apiV2/` (token/retry-demo/contract-demo endpoints,
  OpenAPI annotations, PII endpoint), new `tests/*.tflw` per cluster, TFLW-GAPS.md ledger.
- **Cluster 4 (docs site)**: new `packages/lang/src/spec-data.ts` (manifest), `packages/lang`'s
  `gen-docs.mjs`-equivalent logic extracted to a shared module consumed by both
  `packages/cli`'s `tflw docs` generator and the new site; new `packages/docs-site` (VitePress,
  workspace member) with a browser-bundled `@tflw/lang` playground; new `.github/workflows/`
  Pages-deploy workflow; `packages/lang/GRAMMAR.md` freshened through decision 102; `README.md`
  trimmed; SPEC.md's matcher/generator/CLI tables switched to generated-from-manifest.
- **Cluster 5 (LSP)**: new `packages/lsp-server` (definition/hover/completion/rename/signature-
  help as pure functions + `vscode-languageserver` wiring, consumes `spec-data.ts`); a new
  prefix-based error-tolerant completion mode in `packages/lang`'s parser;
  `packages/vscode/src/extension.ts` rewritten as a thin LSP client (diagnostics spawn path
  deleted); `packages/cli` gains `tflw lsp`.
- Clusters 6–8 (not yet detailed): `packages/cli` (--failed/--bail/--format json/
  --forbid-insecure, `init --openapi`), SPEC.md status badges, SECURITY.md; provenance CI staged
  for the first real publish.

## Verification

**Clusters 1–3, 6–8** (feature clusters with a consumption side): tflw package tests green
(`npm test` in testFlow), then fresh `node cli.mjs stop && start` in testFlow-tests,
`npx tflw check`, `npx tflw run` full-suite green (including under `--workers 4`), new scenarios
proving the feature against the real API — same bar as the existing Fixed entries in
TFLW-GAPS.md. Redaction/evidence features verified by inspecting the emitted report.html
artifact for absence of the PII fixture values.

**Cluster 4 (docs site)** — no testFlow-tests consumption; instead: `packages/docs-site` builds
clean (`npm run build`), the deployed GitHub Pages site manually reviewed (nav, search, every
Reference page's data matches `spec-data.ts`, the playground correctly flags a real syntax
error and accepts a real valid file), `GRAMMAR.md` manually diffed against SPEC.md §5–13 for
completeness, and the Pages-deploy workflow confirmed green on a push to `main`.

**Cluster 5 (LSP)** — no testFlow-tests consumption; instead: `packages/lsp-server`'s pure-
function unit tests green, protocol smoke tests (one per capability) green, and a manual VS
Code session proving all six capabilities (diagnostics-on-type, hover, go-to-definition,
autocomplete mid-typing, rename, signature help) against a real `.tflw` file in a real tflw
project (e.g. testFlow-tests' own `tests/`); `tflw lsp` manually confirmed reachable over stdio
outside VS Code (e.g. a minimal Neovim `lspconfig` smoke test, if available).
