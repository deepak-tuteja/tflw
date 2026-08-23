<picture>
  <source media="(prefers-color-scheme: dark)" srcset="packages/docs-site/public/logo-dark.svg">
  <img alt="tflw" src="packages/docs-site/public/logo-light.svg" width="150">
</picture>

# testFlow (`tflw`)

A testing-only DSL for API tests — reports first, syntax second. Four pillars are built and share
one grammar: API testing, browser testing (real Playwright automation), load testing
(ramp/hold/step/spike, thresholds, validated against k6 on real contended workloads) and security
scanning (hygiene, authorization, input handling, and an active crawl). Pre-1.0, **not yet published
to npm**.

**Full docs: [the documentation site](https://deepak-tuteja.github.io/tflw/)** — a Guide, a
generated Reference (matchers/generators/CLI flags), a formal [Grammar](packages/lang/GRAMMAR.md)
reference, and an in-browser parse+check playground. [SPEC.md](SPEC.md) stays the canonical
language spec — every section carries a shipped/planned (`✅`/`🔧`/`🔮`) status badge, so it
doubles as the single source of truth for what's actually built vs. still ahead.

## Why tflw

Three things tflw does that a general-purpose language + an HTTP client doesn't give you for free:

- **Reporting-first runtime.** Every step is an event, by construction — a self-contained
  `report.html` (full request/response detail), `junit.xml`, and `results.json` all fall out of
  the same event stream `tflw run` already emits, with secrets redacted everywhere automatically.
  Nothing to wire up.
- **Teaching-quality diagnostics.** Source line + caret + "did you mean", stable `TF0xx` codes
  (§17), a conservative unknown-variable checker pass — errors read like a compiler's, not a stack
  trace.
- **One language for API, browser, load and security testing.** UI steps share the same grammar as
  API steps, so a login → seed-via-API → drive-UI → assert-backend-state test stays one readable
  file instead of gluing two tools together — and a load test is the same `test` block with a
  `ramp to …` line in it, not a separate tool with its own script format.

Measured against raw `fetch` + `node:test` (the honest "no tool" baseline, [`tflw-acceptance/README.md`](https://github.com/deepak-tuteja/tflw-tests/blob/main/tflw-acceptance/README.md)):
**2.8× fewer lines** overall (4–8× on retry/polling/generated-data scenarios), a categorical report
quality gap (raw's default output has no request/response capture or redaction without hand-building
it), and **~3× faster runs** purely from session reuse (a cached login vs. re-authenticating per
file). Where tflw *isn't* the right pick: if you already have **Karate** working for your team, its
Java/Gherkin ecosystem and maturity are a real reason to stay; **Hurl**'s single-file, no-runtime
`.hurl` scripts are a better fit for simple curl-replacement smoke checks than a full DSL.

## Project layout

An npm workspaces monorepo. The only thing most users need is `packages/cli` (the `tflw` binary);
the rest is the implementation and the evidence behind the numbers above.

| Path | What it is |
|---|---|
| `packages/lang` | Lexer, parser, and checker — the `.tflw` grammar. Grammar reference: [`GRAMMAR.md`](packages/lang/GRAMMAR.md) |
| `packages/runtime` | The interpreter: HTTP execution, sessions, hooks, retries, data tables, generators |
| `packages/reporter` | Turns the runtime's event stream into `report.html`, `junit.xml`, and `results.json` (+ `events.ndjson` under `--format ndjson`) |
| `packages/cli` | The `tflw` command itself — what `npm i -D tflw` installs. Own [README](packages/cli/README.md) (what ships in the npm package) |
| `packages/lsp-server` | The Language Server behind `tflw lsp` — diagnostics, hover, go-to-definition, completion, rename, signature help, semantic tokens |
| `packages/vscode` | VS Code extension: an LSP client over `packages/lsp-server`, plus TextMate syntax highlighting and snippets |
| `packages/docs-site` | [The documentation site](https://deepak-tuteja.github.io/tflw/) (VitePress), deployed to GitHub Pages |
| `examples/dogfood` | Worked `.tflw` files exercising the full grammar together (sessions, hooks, actions, data tables) — used as regression fixtures, and a good place to see real, larger examples beyond this README |

See [CHANGELOG.md](CHANGELOG.md) for released versions.

## Install & quickstart (< 5 minutes, no browser install)

tflw is **not published to npm yet**, so today you install it from a clone — build once, then point
any project at the built CLI:

```sh
git clone <this repo> && cd testFlow && npm install && npm run build
cd your-project && npm install --no-save file:/path/to/testFlow/packages/cli
```

At 1.0 that becomes one line. It does **not** work yet:

```sh
npm i -D tflw   # not published — see the two commands above
```

Either way, in any project with an API you want to test:

```sh
npx tflw init   # scaffolds tflw.config + example.tflw + .env.example + .gitignore
npx tflw run    # runs it — green in seconds
```

`tflw init` scaffolds a health-check test against **tflw's own demo service** — a small HTTP server
that tflw starts for the run and stops after it — so that second command really is green in an empty
directory, with nothing installed and nothing running. It answers `GET /health` and nothing else; a
run against it is labelled as a demo run in the summary and in `report.html`, because it proves
something about tflw and nothing about your system.

Point `tflw.config`'s `api` line at your own service to test something real — one line, and it is
the first thing the scaffolded config asks you to change:

```
env local default
  api "tflw://demo"          # ← swap for "http://localhost:3001", or wherever your API lives
```

A run always writes
`report/report.html` (open it in a browser — full request/response detail, redacted secrets),
`report/junit.xml` (for CI), and `report/results.json` (the same redacted report as JSON).

```
test "health check"
  api GET /health
  expect status equals 200
```

For sessions, capture-chaining, hooks, retry, data-driven tests, generators, actions/imports, the
JS/TS escape hatch, and the full CLI/matcher/generator reference, see
**[the documentation site](https://deepak-tuteja.github.io/tflw/)** — start at
[Getting started](https://deepak-tuteja.github.io/tflw/getting-started) or jump straight into the
[Guide](https://deepak-tuteja.github.io/tflw/guide/first-test).

## CI

`tflw check` validates every file (parse + the full checker pipeline) with no execution and no
secrets required — a fast pre-commit/CI lint step. `tflw run` exits non-zero on any test failure
and writes `report/junit.xml` + `report/results.json`, so it drops into any CI runner as a plain
command — no plugin needed. `--bail` stops at the first failure; `--failed` re-runs just what
failed last time. See [CI, reporting & safety](https://deepak-tuteja.github.io/tflw/guide/ci-and-reporting)
for a worked GitHub Actions example and the redaction/evidence-level/host-allowlist safety
features.

## Status

Built so far (internal milestones, not yet published): config-as-tflw, sessions,
capture-chaining, hooks/retry/tags/data-tables, actions + the JS/TS escape hatch, generators, teaching-quality diagnostics, file-level
concurrency (`--parallel`), CI ergonomics (`--failed`/`--bail`/`--format ndjson`), a self-contained
`report.html` + `junit.xml` + `results.json`; the full browser half (Playwright — interaction steps,
tiered locators, frames/tabs/downloads/drag-drop, network mocking, accessibility assertions, visual
regression, `tflw watch`/`tflw pick`); a real Language Server (`tflw lsp`) behind the VS Code
extension; the full load-testing arc — the five workload shapes (`ramp`/`hold`/`step`/`spike`/
`run … iterations`), `threshold` assertions, `pause`, multi-process load generation (`--workers`),
and a `parallel`/`sequential` test-header modifier, all rendering into the same one report; and a
reuse pass (`tflw refactor apply`).

Security testing is **built and dogfooded, inside `tflw run` rather than as a mode of its own**:
response-hygiene, authorization (BOLA/IDOR) and input-handling assertions — `expect response has no
security violations`, `… no authorization violations`, `… no input handling violations` — with a
`--fail-on` severity gate, a `--baseline` file for staged adoption, per-finding remediation in
`report.html`, and a `findings.sarif` for GitHub code scanning. The active tier is built too: a
top-level `crawl` declaration that discovers routes from an OpenAPI document, from the run's own traffic, or by
spidering a page; CSRF-token capture on a `session` and the `sec/csrf-not-enforced` probe derived
from it; and a TLS cipher **offer** enumeration. The acceptance pass against the dogfood app's
planted-vulnerability ledger is measured and gated in CI.

`tflw migrate` ships but has nothing to do yet: no checker rule emits a deprecation, because the
grammar has been additive-only since the first release, so it always reports `no deprecated syntax found`. See [SPEC.md](SPEC.md)'s per-section status badges for
the full shipped-vs-planned breakdown, and [CHANGELOG.md](CHANGELOG.md) for what's built and pending
release.

## Platform support

Tested on Linux/macOS. Windows works via WSL; there is no native-Windows CI for `0.1` yet — a
deliberate trade-off (PLAN decision 79), revisited on demand.

## Contributing (working in this monorepo)

Source is public and issues are welcome — pull requests aren't accepted yet (PLAN decision 80).

```sh
git clone <this repo> && cd testFlow
npm install
```

**The gates — what has to be green before a branch is pushed — live in
[CONTRIBUTING.md](CONTRIBUTING.md), and only there.** This section used to list three of them; it
was missing five, for the whole life of the ledger row that eventually produced that file. The list
there is held to `.github/workflows/` by a test, so it cannot go stale the way this paragraph could.

`npm run build` (root, or `-w tflw`) always produces the same self-contained, esbuild-bundled
`packages/cli/dist/cli.cjs` that `npm publish` would ship — see PLAN.md decision 43 (the bundle) and
decision 84 (why `build` and the publish artifact are the same thing, not two).

Running from a clone without publishing to npm, or embedding `tflw` in another local project
without a registry: see
[Getting started](https://deepak-tuteja.github.io/tflw/getting-started#using-tflw-from-a-checkout-no-npm-registry-needed).
