# Installing tflw

tflw is one package with one optional peer: `playwright`, needed only when a test drives a browser.

## 1. Node 22 or newer

```sh
node --version   # v22.x or later
```

## 2. The package, and the browser if you need one

<Published :when="false">

tflw is pre-1.0 and **not published to npm yet**. Until it is, build and pack it from a clone and
install the tarball — [the walkthrough's first chapter](/runbook/start/install) has the commands:

```sh
npm install -D /path/to/tflw-0.1.0.tgz   # the file `npm pack -w tflw` wrote in the clone
npm install -D playwright                # only if a test opens a page
npx tflw install-browsers                # downloads Chromium into that playwright
```

</Published>

<Published>

```sh
npm install -D tflw
npm install -D playwright     # only if a test opens a page
npx tflw install-browsers     # downloads Chromium into that playwright
```

</Published>

`install-browsers --browser firefox` or `--browser webkit` downloads another engine. It never installs
`playwright` for you: without the peer it refuses and says how to add it, so the browser always lands
in the Playwright your project imports.

## 3. Ask the project what it will run with — `tflw doctor`

```sh
npx tflw doctor
```

```text
tflw 0.1.0 · Node v22.11.0
config    tflw.config · env local (of local, staging)
services  api http://localhost:4001/v1
          api inventory http://localhost:4002
proxy     none set — requests go straight to each service
tls       certificates verified; no client certificate
suite     42 files, 381 tests, 60 in a browser
browsers  playwright 1.62.0: chromium

✓ nothing here stops a run
```

It is read-only and sends no request. It resolves `tflw.config` the way `tflw run` would, for the env
`--env` names or the default one, and reports what stands between you and a run. It exits 1 for the
three things that stop every run: no `tflw.config`, Node older than 22, and browser tests with no
browser downloaded. Each problem line carries its fix. `tflw doctor --json` prints the same facts as
one object, which is the thing to paste into a bug report.

Two lines are worth reading even when doctor is green:

- **proxy** — tflw has no proxy setting of its own. When `HTTPS_PROXY` is set, Node's `fetch` uses it
  only with `NODE_USE_ENV_PROXY=1`, and never for a service reached with a client certificate.
- **tls** — `insecure true` in the env turns certificate checks off, and doctor says so in capitals.
  A client certificate that is *not on disk yet* is fine when a `before all` hook writes it.

## 4. Upgrading

<Published :when="false">

Before 1.0, an upgrade is a fresh tarball: `git pull` in the clone, `npm pack -w tflw` again, and
install the new file the way you installed the first. Then the same three commands as below.

</Published>

<Published>

```sh
npm install -D tflw@latest
```

</Published>

```sh
npx tflw migrate              # rewrites deprecated syntax in place and prints what changed
npx tflw check
npx tflw install-browsers     # again, if the upgrade moved your playwright
```

From `1.0.0` the language only grows: a file that checks today still checks after an upgrade. What
a release deprecates, `tflw check` warns about with the replacement, and `tflw migrate` rewrites
mechanically — `scenario` → `test`, `think` → `pause`, `uncheck` → `untick` today. Run it on a
clean working tree, so the diff it leaves is the migration and nothing else.

Next: [setting up a project](/runbook/project), or [running it](/runbook/running).
