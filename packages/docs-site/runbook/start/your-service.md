# 10. Your own service

Everything so far ran against the Coffee Shelf. This last chapter is about the service you actually
want to test: pointing the suite at it, keeping one config for every place it runs, keeping secrets
out of files, and upgrading tflw.

## Starting a project of your own

`npx tflw init` in an empty directory writes a project with one test, against a service called
`tflw://demo`. That is a small server tflw starts for the run and stops after it, so the first run is
green before you have pointed anything anywhere. It answers `GET /health` and nothing else. Its job
is to prove the install works; the first edit you make is to replace it with your service:

```tflw-config
env local default
  api "http://localhost:3000"
  web "http://localhost:5173"
```

`api` is where `api GET /items` goes, and `web` is where `open "/"` goes. Leave out `web` if you have
no pages to test. A service with more than one API names each one: `api billing "…"` is reached with
`api billing GET /invoices`.

## One config, every place the suite runs

The same suite runs on your laptop, in CI and against staging. What changes between them is the
addresses and the secrets, and each place gets an `env` block. Add one for a staging copy of the
shop, which wants a token on every request:

```sh runbook
cat >> tflw.config <<'EOF'

require env SHOP_TOKEN

env staging
  api env STAGING_URL default "https://staging.coffee-shelf.example"
  web env STAGING_URL default "https://staging.coffee-shelf.example"
  header "Authorization" is env(SHOP_TOKEN)
EOF
```

`--env staging` picks it; with no `--env`, the block marked `default` runs. `doctor` shows what an
env resolves to without sending a request:

```sh runbook
npx tflw doctor --env staging
```

```text runbook-output
tflw 0.1.0 · Node v22.11.0
config    tflw.config · env staging (of local, staging)
services  api https://staging.coffee-shelf.example
web       https://staging.coffee-shelf.example
proxy     none set — requests go straight to each service
tls       certificates verified; no client certificate
suite     15 files, 41 tests, 19 in a browser
browsers  playwright 1.58.0: chromium

✓ nothing here stops a run
```

## Secrets

`env(SHOP_TOKEN)` reads a secret from the environment, so it is never written in a file under
review. `require env SHOP_TOKEN` says every run needs it, and is checked before anything is sent:
a run without it stops and names what is missing. It sits at the top of the config, outside any
`env` block, so it applies to every env, including `local`:

```sh runbook
npx tflw run --tag functional || echo "tflw exited $?"
```

```text runbook-output
error: missing required environment variable: SHOP_TOKEN
  set it in your environment or a local .env file (see `require env` in tflw.config).
tflw exited 2
```

On your machine, secrets go in a `.env` file in the project, one `NAME=value` per line. tflw reads
it, and the `.gitignore` the example wrote keeps it out of git. The local shop ignores the header, so
any value does here:

```sh runbook
echo "SHOP_TOKEN=local-only" > .env
npx tflw run --tag functional
```

```text runbook-output
…
09:43:30.288 PASS 39/39 passed · env local · seed 3321 · now 2026-10-01T09:43:28.000Z · 2541 ms
…
```

In CI, set secrets as the CI system's secrets, never in the workflow file. Wherever a value read
through `env()` appears, in the terminal, the report or a trace, it prints as `•••(SHOP_TOKEN)`.

## Upgrading tflw: `migrate`

When a new version of tflw renames something, `tflw check` warns about the old spelling and says
whether `tflw migrate` can rewrite it. Here is a file written when `test` was still spelled
`scenario`:

```sh runbook
cat > tests/old.tflw <<'EOF'
scenario "written before test was the keyword"
  api GET /health
  expect status equals 200
EOF
npx tflw migrate tests/old.tflw
```

```text runbook-output
migrated 1 file:
  tests/old.tflw
the rewritten suite checks clean.
```

```sh runbook
cat tests/old.tflw
```

```text runbook-output
test "written before test was the keyword"
  api GET /health
  expect status equals 200
```

After an upgrade, run `npx tflw migrate` once with no file to rewrite the whole suite, then
`npx tflw check`.

```sh runbook
rm tests/old.tflw
```

## You now have

A project that has run every kind of test tflw has, from a terminal, an editor and a CI job, with a
staging env waiting for its address, and its secret kept in `.env`. That is the whole walkthrough.

## Where to read next

- **Sign-ins, and testing as more than one user:** [Sessions](/guide/sessions) and
  [Authorization testing](/guide/authorization-testing).
- **The language, construct by construct:** [the Guide](/guide/first-test), starting with
  [Functional tests](/guide/functional).
- **The config, every key:** [Config and environments](/guide/config).
- **Setting up a larger project:** [Setting up a project](/runbook/project).
- **When something refuses:** [Troubleshooting](/runbook/troubleshoot).
- **Every command and flag:** [the CLI reference](/reference/cli).
