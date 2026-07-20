# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows the public line:
`0.1.0` (API-only) → `0.2.0` (browser half) → `1.0.0` (final). Pre-1.0, the shipped API grammar is
frozen additive-only: no existing syntax changes, only new syntax.

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
  the report, a declarative mechanism distinct from the existing `env(...)` secret redaction.
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
  tables), the Grammar reference, and an in-browser parse+check playground. `GRAMMAR.md` was
  refreshed to cover the full grammar through this release (it had been a frozen M0-only snapshot).
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

### Fixed

- `tflw.config`'s `require env` list would hang the parser (and, on a second attempt, crash Node
  with an out-of-heap error) if a trailing comma preceded the newline — a malformed multi-line
  continuation left the parser's config recovery loop stuck reprocessing the same token forever.
  Now reports bounded diagnostics and recovers normally; `require env` itself still needs to stay
  on one line (no continuation support).
