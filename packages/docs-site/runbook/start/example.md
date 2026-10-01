# 2. The example

`tflw init` on its own writes a one-test project that talks to `tflw://demo`, a small service tflw
starts for the run and stops after it. It answers `GET /health` and nothing else, so it can give you
a first green run but cannot show you much more. This walkthrough uses a real shop instead:

```sh runbook
npx tflw init --example
```

```text runbook-output
wrote the Coffee Shelf: 18 files, and an `npm run shop` script, added to your package.json

next:
  npm run shop                 # the shop, on http://127.0.0.1:4720 — leave it running
  tflw run --tag functional    # in a second terminal: the suite, against it
  tflw ui                      # the same project, as a page
```

It refuses to write over a file that is already there, and names what is in the way. `--force`
overwrites.

## What it wrote

| file | what it is |
|---|---|
| `server.mjs` | the shop: one `node:http` server, no dependencies, no build |
| `order.html`, `order.js`, `shelf.css` | its order page, the part a browser test has something to do on |
| `tests/` | twelve files, 37 tests: API, browser, a workload and a scan, one subject per file |
| `payloads/purchase-order.csv` | a file a test drops on the order page |
| `tflw.config` | where the shop is, and what the suite may do to it |

`package.json` gained one script, `shop`, and `.gitignore` gained the lines a tflw project wants
(`report/` and `.env` among them).

## The config, line by line

```tflw-config
defaults
  timeout api 5s
  viewport 900 600
  authorized target env SHOP_URL default "http://127.0.0.1:4720" reason "the example storefront in this directory, on loopback"

env local default
  api env SHOP_URL default "http://127.0.0.1:4720"
  web env SHOP_URL default "http://127.0.0.1:4720"
```

- **`defaults`** apply to every env. `timeout api 5s` is how long one request may take;
  `viewport 900 600` is the browser window's size.
- **[`authorized target`](/runbook/glossary#authorized-target)** names the one origin a scan may send requests nobody wrote. `tests/scan.tflw`
  crawls the shop, and tflw refuses to crawl anything the config has not named, with a reason a
  reviewer can read. The chapter on load and scan comes back to it.
- **`env local default`** is the [env](/runbook/glossary#env) a plain `tflw run` uses. `api` is where `api GET /items`
  goes; `web` is where `open "/"` goes.
- **`env SHOP_URL default "…"`** reads the variable `SHOP_URL` and falls back to the address after
  `default`. The shop reads the same variable, so if something on your machine already has port
  4720, `export SHOP_URL=http://127.0.0.1:4721` before the next two commands moves both.

## Ask the project what it will run with

`tflw doctor` reads the config the way a run would, sends no request, and says what stands between
you and a run:

```sh runbook
npx tflw doctor
```

```text runbook-output
tflw 0.1.0 · Node v22.11.0
config    tflw.config · env local
services  api http://127.0.0.1:4720
web       http://127.0.0.1:4720
proxy     none set — requests go straight to each service
tls       certificates verified; no client certificate
suite     12 files, 37 tests, 18 in a browser
browsers  playwright 1.58.0: chromium

✓ nothing here stops a run
```

And `tflw check` reads every test without running one. It is the command an editor runs on every
keystroke, and the one to put first in CI:

```sh runbook
npx tflw check
```

```text runbook-output
12 files checked, no problems found.
```

## Start the shop, and run the suite against it

The shop is an ordinary server. The `&` starts it in the background of this terminal (`kill %1`
stops it), or run `npm run shop` in a second terminal and leave it there:

```sh runbook background
npm run shop &
```

```text runbook-output
…
the coffee shelf is on http://127.0.0.1:4720
```

Then the suite. `--tag functional` runs everything tagged `@functional` (35 tests once a data
table has expanded into its rows, the scan's crawl among them) and leaves out the workload, which a
later chapter runs on its own because it runs at a rate:

```sh runbook
npx tflw run --tag functional
```

```text runbook-output
…
09:30:12.004 PASS 35/35 passed · env local · seed 41027 · now 2026-10-01T09:30:12.000Z · 2712 ms
…
```

## You now have

The Coffee Shelf in `coffee-shelf/`, its shop running on 4720, and a `report/` directory from the
run you just made: `report.html` to open in a browser, `results.json`, `junit.xml`, and
`findings.sarif` from the scan.

## Next, or instead

- **Next:** [3. The first run and its report](/runbook/start/first-run).
- How a project grows past one directory: [Setting up a project](/runbook/project).
- The same project on the page: `npx tflw ui`, and [the page's own section](/ui/).
