# testFlow (`tflw`)

A testing-only DSL for API tests — reports first, syntax second. `v0.1.0` is **API-only**; the
browser half (Playwright) lands in `0.2.0`.

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
- **One language, API today, browser next.** `0.2.0` adds UI steps to the same grammar, so a login
  → seed-via-API → drive-UI → assert-backend-state test stays one readable file instead of gluing
  two tools together.

Measured against raw `fetch` + `node:test` (the honest "no tool" baseline, `acceptance/README.md`):
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
| `packages/vscode` | VS Code extension: `.tflw` syntax highlighting |
| `packages/docs-site` | [The documentation site](https://deepak-tuteja.github.io/tflw/) (VitePress), deployed to GitHub Pages |
| `acceptance/` | tflw vs. raw `fetch`+`node:test` head-to-head, plus an external dogfood run against a live public API (restful-booker) — the source of the "2.8× fewer lines" numbers above. [Own README](acceptance/README.md) |
| `examples/dogfood` | Worked `.tflw` files exercising the full grammar together (sessions, hooks, actions, data tables) — used as regression fixtures, and a good place to see real, larger examples beyond this README |

See [CHANGELOG.md](CHANGELOG.md) for released versions.

## Install & quickstart (< 5 minutes, no browser install)

```sh
npm i -D tflw
```

In any project with an API you want to test:

```sh
npx tflw init   # scaffolds tflw.config + example.tflw + .env.example + .gitignore
npx tflw run    # runs it — green in seconds
```

`tflw init` scaffolds a health-check test against `http://localhost:3001` — point `tflw.config`'s
`api` line at your own service and edit `example.tflw` from there. A run always writes
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

## Status & roadmap

`v0.1.0` is shipped: config-as-tflw, sessions, capture-chaining, hooks/retry/tags/data-tables,
actions + the JS/TS escape hatch, generators, teaching-quality diagnostics, parallel workers, CI
ergonomics (`--failed`/`--bail`/`--format ndjson`), and a self-contained `report.html` + `junit.xml`
+ `results.json`. **Next: `0.2.0`** adds the browser half (Playwright —
`open`/`click`/`fill`, selectors, screenshots). See [SPEC.md](SPEC.md)'s per-section status badges
for the full shipped-vs-planned breakdown, and [CHANGELOG.md](CHANGELOG.md) for released versions.

## Platform support

Tested on Linux/macOS. Windows works via WSL; there is no native-Windows CI for `0.1` yet — a
deliberate trade-off (PLAN decision 79), revisited on demand.

## Contributing (working in this monorepo)

Source is public and issues are welcome — pull requests aren't accepted yet (PLAN decision 80).

```sh
git clone <this repo> && cd testFlow
npm install
npm run build       # build all packages
npm run typecheck   # type-check all packages
npm test            # run all package test suites
```

`npm run build` (root, or `-w tflw`) always produces the same self-contained, esbuild-bundled
`packages/cli/dist/cli.cjs` that `npm publish` would ship — see PLAN.md decision 43 (the bundle) and
decision 84 (why `build` and the publish artifact are the same thing, not two).

Running from a clone without publishing to npm, or embedding `tflw` in another local project
without a registry: see
[Getting started](https://deepak-tuteja.github.io/tflw/getting-started#using-tflw-from-a-checkout-no-npm-registry-needed).
