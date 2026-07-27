# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Internal milestone labels track the
arc order: `0.1` (API) → `0.2` (browser) → `0.3` (performance) → `0.4` (pen-test) → `1.0.0`. None
of `0.1`–`0.4` is ever actually published — **the first `npm publish` is `1.0.0`**, gated on all
four arcs plus one final integrated acceptance pass against the real dogfood app (`PLAN.md`
decision 112). The shipped API grammar is frozen additive-only from `1.0.0` on: no existing syntax
changes, only new syntax.

## [Unreleased]

Everything below is built and verified but not yet published — it ships as part of `1.0.0`
alongside the performance and pen-test arcs, once those are also done (decision 112).

### Added — browser arc (`0.2` internal milestone)

- Browser interaction steps (`open`/`click`/`fill`/`fill form`/`select`/`check`/`uncheck`/`hover`/
  `press`/`scroll`), a tiered locator model (`button`/`text`/`list`/`field` cascade, `css`/`xpath`
  escapes, `within` scoping, strict-ambiguity errors), auto-retrying UI expects, and dialog
  handling (`accept`/`dismiss`).
- Frames (`within frame`), tabs, downloads, drag-drop, and `wait until <ui-locator>`.
- The `report/` directory: failure-first screenshots + Playwright trace, `--browser`/`--headed`/
  viewport flags.
- Network observation (`expect request to "<url>" was made`) and `stub` route mocking.
- Accessibility assertions (`expect page has no [<severity>] a11y violations`, axe-core).
- Visual regression (`expect page matches snapshot "<name>" [mask <locator>]*`,
  `--update-snapshots`).
- `tflw watch` (headed re-run on every save, one shared browser, same seed) and `tflw pick`
  (opens a real browser, prints a verified locator per click).

### Added — reuse pass & acceptance

- `tflw check` now surfaces advisory duplication hints (`RF0xx`) and `tflw refactor apply <id>`
  mechanically extracts a flagged window into a shared `action`, rewriting every call site.
- `tflw migrate`: a real rewrite engine (`Diagnostic.deprecation` + `collectMigrations`/
  `applyMigrations`) for checker-flagged deprecations, wired end to end. Reports "nothing to
  migrate" today since the grammar has had no deprecations to migrate yet — proven via synthetic
  diagnostics, ready for the day a real one exists.
- A 10-test mixed UI/API acceptance suite against a purpose-built dogfood target (webV2:
  React/Vite SPA storefront + SSR admin console) plus a side-by-side comparison vs. raw
  Playwright + `node:test` — found and fixed 4 real, previously-shipped bugs in the process.

## [0.1.0] — 2026-07-06

First public draft. API-only — the browser half lands in `0.2.0`.

### Added

- `.tflw` DSL: a `tflw.config` dialect (`env`/`defaults`/`session`/`require env`), `test`/`action`/
  `before`/`after` blocks, `import`/`use` for shared actions and a JS/TS escape hatch.
- `api` steps for GET/POST/PUT/DELETE/PATCH; all four request-body forms (`body { … }`, `body from
  "file"`, `form k=v`, `upload`) plus raw `body text`; named services; per-step `timeout`; `without
  redirects`.
- A closed assertion grammar: `expect` (hard) and `check` (soft) over status/header/`body.<path>`/
  `body text`/`duration`, with `any`/`all` quantifiers and a `not` negation.
- `capture` + chaining (create → use → verify across steps), `let`, and value expressions
  (arithmetic, string interpolation, `today`/`now` date math).
- `unique(...)`/`unique email`/`unique like "…"`/`unique uuid` (collision-safe) and `random number`/
  `random date`/`random of`/`random like "…"`/`random uuid`/`random password [N]` (value-shaped)
  generators; a run seed with `--seed`/`--now` replay. `base64`/`hex`/`url` `encode(...)`/
  `decode(...)` value transforms.
- `session <name>` blocks: run once per run, auto-apply captured headers to every test running
  `as <name>` — no repeated login boilerplate. A session now auto-refreshes on a `401` (bounded to
  one retry) and honors its own TTL if it has one; `session <name> oauth2` sugar runs a
  client-credentials grant and sets that TTL from `expires_in`. Per-env `cert`/`key` config keys
  add mTLS client-certificate support.
- Orchestration: `@tags` + `--tag a,b,c` (comma-separated OR — a test runs if it carries any
  listed tag; combines with `--only` as AND), `retry N` with `flaky` marking, inline (`with each`) and
  file-backed (`.csv`/`.json`) data tables, `--workers N` (in-process, per-file, default 1,
  deterministic under `--seed` at any concurrency).
- Teaching-quality diagnostics: source line + caret + "did you mean", stable `TF0xx` codes, a
  conservative unknown-variable/unknown-service checker pass.
- Reporting: a self-contained, theme-aware `report.html` (step timeline, full request/response
  detail, screenshots-ready layout for `0.2.0`) plus `junit.xml` for CI; secrets (`env(NAME)`) are
  redacted from every report, trace, and CLI line automatically.
- Safety/redaction: `allow hosts "…"` config allowlist — a request to a host outside the list is
  refused before any network I/O; `--forbid-insecure` fails a run up front if `insecure true` is
  active; `evidence full|headers-only|none` config key + `--evidence` CLI override control how
  much of the request/response trace lands in the report (never affects what `expect`/`capture`
  can see); `redact body.email, body.*.address` masks matching JSON fields with `[redacted]` in
  the report, a declarative mechanism distinct from the existing `env(...)` secret redaction — now
  also masking a plain `body.<path>` `capture`/`expect`/`check` step's own detail text when its
  subject is redact-covered (closes TFLW-GAPS.md gap #15), not just the request/response trace;
  quantified `any`/`all` assertions are a documented exception, left unmasked.
- Contract validation: `expect body matches schema "Name" from "source"` runs real ajv JSON-Schema
  validation against a schema in an API's own generated OpenAPI document (`components.schemas`),
  including cross-`$ref` resolution — the assertion itself fetches and caches the document.
- `retry honoring "Retry-After" up to N` — a per-step `api` clause that re-issues just that one
  request when its response carries a `Retry-After` header (seconds or HTTP-date), sleeping the
  indicated duration before each re-attempt; distinct from `retry N`, which retries a whole test.
- `tflw run` and `tflw init` (scaffolds `tflw.config` + `example.tflw`); `tflw --version`/`-v`.
- Packaged as a single self-contained `dist/cli.cjs` (esbuild bundle). Bundles two real runtime
  dependencies, `undici` (mTLS client-cert request path) and `ajv` (contract/schema validation) —
  both build-time only, never installed by a consumer; every other request still uses Node's plain
  global `fetch`.
- Documentation site (VitePress, `packages/docs-site`, deployed to GitHub Pages): a hand-adapted
  Guide, a generated Reference (matchers/generators/CLI flags, from a new canonical
  `packages/lang/src/spec-data.ts` manifest that also regenerates SPEC.md's own matcher/generator
  tables), the Grammar reference, an Editor page (install, plus live in-page demos of diagnostics,
  hover, autocomplete, go-to-definition, rename, signature help, and semantic highlighting — each
  one runs the real `@tflw/lang`/`@tflw/lsp-server` classifier and resolver code client-side against
  an editable or fixed sample, not a screenshot or recording), and an in-browser parse+check
  playground. `GRAMMAR.md` was refreshed to cover the full grammar through this release (it had
  been a frozen M0-only snapshot).
- `tflw lsp` — a real Language Server Protocol implementation (`packages/lsp-server`), replacing
  the VS Code extension's old child-process `tflw check --format json` diagnostics. Diagnostics,
  hover, go-to-definition, autocomplete, rename, and signature help, all live over debounced
  in-process reparsing, for both `.tflw` test files and `tflw.config`; a `tflw.env` VS Code setting
  controls which environment diagnostics resolve services/sessions against. `tflw lsp` itself
  speaks LSP over stdio, so any LSP-capable editor (not just VS Code) can use it. It also serves
  `textDocument/semanticTokens/full`, coloring matcher/operator words, numbers, variable/parameter
  names, and object-literal field keys using the editor's own built-in default semantic palette —
  richer and theme-independent, closing a gap the static TextMate grammar structurally can't (it
  has no way to color arbitrary user-chosen names, and some of its scopes go unstyled under
  themes that don't define rules for them).
- `expect`/`check request connects`/`fails` — asserts on the connection attempt itself rather than
  a response: a request that fails before any HTTP response exists (a TLS handshake rejection, DNS
  failure, `ECONNREFUSED`, an `allow hosts` block) can now be the expected, passing outcome of a
  test instead of always crashing the run. `fails matching "<regex>"` asserts on the failure reason
  too, reusing the same teaching-error text already unwrapped for connection failures. Opt-in per
  request (only an `api` step immediately followed by a `request` assertion catches the error;
  every other request keeps today's unconditional fail-fast); a `request` assertion can't be
  combined with a response-based one on the same request, and isn't supported inside `wait until
  api` (both checker errors, `TF031`).
- CI ergonomics + console/log output: `report/results.json` (always written, the same redacted
  run report as JSON, no flag) and `report/.last-run.json` (always overwritten, feeds `--failed`).
  `tflw run --failed` re-runs only the previous run's failing tests; `--bail` stops after the
  first failing test (in-flight files still finish under `--workers > 1`). `--format ndjson`
  streams the event log as one JSON line per event (always file-tagged, full detail regardless of
  `--verbose`) instead of human text, also written to `report/events.ndjson`. Console output now
  gets an `HH:MM:SS.mmm` timestamp prefix by default (`--no-timestamps` opts out); on GitHub
  Actions, `--verbose` output folds into a collapsible `::group::`/`::endgroup::` block per test
  (auto-detected, no flag). `--log-file <path>` duplicates console output to a file, always plain
  text regardless of stdout's own color state.

### Fixed

- `tflw.config`'s `require env` list would hang the parser (and, on a second attempt, crash Node
  with an out-of-heap error) if a trailing comma preceded the newline — a malformed multi-line
  continuation left the parser's config recovery loop stuck reprocessing the same token forever.
  Now reports bounded diagnostics and recovers normally; `require env` itself still needs to stay
  on one line (no continuation support).
