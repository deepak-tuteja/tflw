# Setting up a project

The guide teaches the language one construct at a time. This runbook is the other direction: a
project in front of you, and the order to set it up in. Each step names the file it touches and the
command that tells you it worked.

## 1. One config, one directory of tests

```text
tflw.config          # environments, sessions, the rules a run obeys
.env                 # local secrets, never committed
tests/               # the tests, in as many subdirectories as you like
shared/
  elements.tflw      # named locators — `element` lines
  orders.tflw        # actions more than one file calls
payloads/            # request bodies and files a test sends
report/              # what each run writes; not committed
```

`npx tflw init --example` writes this layout, and `tflw refactor apply` writes what it extracts into
`shared/`. Plain `npx tflw init` starts smaller, with a `tflw.config` and one passing
`example.tflw`; the layout above is where a project grows from there. `npx tflw check` reads every `.tflw` file under the directory and
says nothing when all is well. Run it before every commit; it needs no secrets and sends no
request.

## 2. One `env` block per place the suite runs

Everything that differs between your laptop, CI and staging is either a base URL or a secret. Base
URLs live in the config, each naming the variable that overrides it, so the same file serves every
environment:

```tflw-config
env local default
  api env API_BASE default "http://localhost:4001/v1"
  web env WEB_BASE default "http://localhost:5173"

env ci
  api env API_BASE default "http://app.ci:4001/v1"
  web env WEB_BASE default "http://app.ci:5173"
```

Secrets are never written down. `require env ADMIN_EMAIL, ADMIN_PW` makes a run without them stop
before its first request, and `env(ADMIN_PW)` reads one where it is needed. `tflw check` tells you
which are unset here without failing.

**Name the same host in `api` and `web`.** A browser treats `localhost`, `127.0.0.1` and `::1` as
three different sites, so a session that signs in against one does not sign the page in at another
(step 3). Ports do not matter; hosts do.

## 3. Sessions: sign in once, on both sides

A `session` in the config signs in once per run and every test that says `as <name>` starts signed
in. It covers the page too: the session's cookies are handed to the test's browser, so a test can
seed data over the API and check it on the page with no form login in between.

```tflw-config fragment
require env SHOPPER_EMAIL, SHOPPER_PW

session shopper
  api POST /auth/login body { email: env(SHOPPER_EMAIL), password: env(SHOPPER_PW) }
  expect status equals 200
```

```tflw
test "the orders page lists what I just ordered" as shopper
  api POST /orders body { productId: 1, qty: 1 }
  expect status equals 201
  open "/orders"
  expect text "Your orders" is visible
```

The first browser step in the report says what the page was given — *browser signed in from session
"shopper": 1 cookie for localhost:4001*. If it says *carries headers only*, the session signs in
with a token header, which a browser cannot hold; that page needs its own form login. See [a
session signs the browser in](/guide/sessions#a-session-signs-the-browser-in).

When the identity provider's only way in is a person signing in on its page, declare the session
`oauth2 code`: its steps are that sign-in, run in a browser tflw opens, and the token comes back on a
loopback redirect. See [signing in through a browser](/guide/sessions#oauth2-code).

## 4. Share what more than one file uses

Three things get written once and imported:

- **Locators** the page owns — an id, a `data-test` attribute — as `element` lines in
  `shared/elements.tflw`. `tflw check` offers one whenever the same `css` or `xpath` string appears
  in two files, and `tflw refactor apply <id>` writes it and rewrites every site.
- **Setup** more than one test repeats — create a product, place an order — as an `action` in a
  shared file. `tflw check` offers these too, from repeated step sequences.
- **Rows** of test data longer than a few lines, as a `.csv` or `.json` beside the tests:
  `with each from "./data/orders.csv"`.

A file says `import "../shared/elements.tflw"` to use what another declares; the path is relative
to the importing file, so a test under `tests/` reaches `shared/` with `../`. Imports are one level
deep: a shared file's own imports are not followed, so a test imports everything it names.

## 5. Tests that do not run everywhere

A test that cannot run in one environment says so on its header, and the report shows it as
skipped there with the reason:

```tflw
test "refunds settle" skip "no payments sandbox in CI" on env ci
  api POST /refunds body { orderId: 7 }
  expect status equals 202
```

A test that belongs in some CI jobs and not others is a tag instead — `@slow` above the test, and
`npx tflw run --tag !slow` in the job that leaves it out. A skip is a fact about an environment; a
tag is a choice about a job.

## 6. The first green run

```sh
npx tflw check                 # every file parses and checks, no secrets needed
npx tflw run --env local       # the whole suite, report in report/
```

`report/report.html` is the run to read; `report/junit.xml` is the one to hand to CI. A red run's
first failing step carries the request, the response and — for a browser step — a screenshot and a
trace. [Running & debugging tests](/guide/debugging) is where to go from there.
