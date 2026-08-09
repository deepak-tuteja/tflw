# Getting started

Install & quickstart takes under 5 minutes — no browser install needed for an API-only suite; run
`tflw install-browsers` once a suite adds UI steps (see [Browser testing](/guide/browser-basics)).
Writing tests in VS Code? See [Editor support](/editor) for diagnostics, autocomplete, rename, and
more, live as you type.

## Prerequisites

- **Node ≥ 22** — check with `node -v`. tflw ships zero runtime dependencies but does need a
  recent Node for its `fetch`/TLS behavior.
- **An API to point it at** — tflw sends real HTTP requests; there's no mocking layer. Have the
  service you're testing running and reachable (locally, or a staging URL) before you write a real
  test. You don't need it for the two commands below: `tflw init` scaffolds against tflw's own demo
  service, so the quickstart is green before you've wired anything up, and repointing it at your
  service is one line.

```sh
npm i -D tflw
```

In any project with an API you want to test:

```sh
npx tflw init   # scaffolds tflw.config + example.tflw + .env.example + .gitignore
npx tflw run    # runs it — green in seconds
```

`tflw init` scaffolds a health-check test against **tflw's own demo service** — a small HTTP server
tflw starts for the run and stops after it, answering `GET /health` and nothing else. That's what
makes the second command green in an empty directory. A passing run looks like this:

```console
  ✓ health check (15 ms)

PASS 1/1 passed · env local · seed 1486355565 · now 2026-07-20T19:09:07.104Z · 15 ms
ℹ demo: this run targeted tflw's built-in demo service, not a service of yours — point `api` at your own in tflw.config

report: report/report.html
```

That `ℹ demo` line is the point of the exercise: the run proved tflw works, and nothing whatsoever
about your system. Point `tflw.config`'s `api` line at your own service — one line — and edit
`example.tflw` from there:

```tflw-config
env local default
  api "tflw://demo"          # ← swap for "http://localhost:3001", or wherever your API lives
```

The run output above is one line per test, a summary tally, and the report path. It always writes
`report/report.html` (open it in a browser — full request/response detail, redacted secrets), `report/junit.xml` (for
CI), and `report/results.json` (the same redacted report as JSON, for scripting). If a test fails
instead, see [Running & debugging tests](/guide/debugging) for how to read the failure, isolate
it, and reproduce it exactly.

## Your first test

```tflw
test "health check"
  api GET /health
  expect status equals 200
```

That's the whole shape: `test "<name>"`, one or more `api` steps, one or more `expect`/`check`
assertions. Continue to [Writing your first test](/guide/first-test) for the full walkthrough —
sessions, capture-chaining, hooks, and everything else the language does.

## Using tflw from a checkout (no npm registry needed)

If you're working from a clone instead of a published package, `packages/cli/dist/cli.cjs` is the
exact runnable artifact after `npm run build`:

```sh
node /path/to/testFlow/packages/cli/dist/cli.cjs run    # or `init`
```

Or install it into another project on the same machine, still with no registry involved:

```sh
cd your-project
npm install --no-save file:/path/to/testFlow/packages/cli
npx tflw run
```
