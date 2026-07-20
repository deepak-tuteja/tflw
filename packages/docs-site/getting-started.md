# Getting started

Install & quickstart takes under 5 minutes, no browser install required (`v0.1.0` is API-only —
the browser half lands in `0.2.0`). Writing tests in VS Code? See [Editor support](/editor) for
diagnostics, autocomplete, rename, and more, live as you type.

```sh
npm i -D tflw
```

In any project with an API you want to test:

```sh
npx tflw init   # scaffolds tflw.config + example.tflw + .env.example + .gitignore
npx tflw run    # runs it — green in seconds
```

`tflw init` scaffolds a health-check test against `http://localhost:3001` — point `tflw.config`'s
`api` line at your own service and edit `example.tflw` from there. A run writes
`report/report.html` (open it in a browser — full request/response detail, redacted secrets) and
`report/junit.xml` (for CI).

## Your first test

```
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
