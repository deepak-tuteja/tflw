# Troubleshooting

By what you see. Every message tflw prints names its likely cause and a fix; this page is for when
that was not enough, or when the symptom is not a message at all. A diagnostic code you do not
recognise — `TF036`, `TF083` — is in [the diagnostics reference](/reference/diagnostics), one row
per code with what it means and an example.

Start with `npx tflw doctor`: it reports the config, env, services, proxy, TLS, secrets, suite and
browsers a run would use, and exits 1 with the fix for anything that would stop `tflw run` before
its first test.

<Published :when="false">

## Installing

**`npm install -D tflw` answers `404`.** tflw is not on npm yet. Build the package from a clone and
install the `.tgz` it writes, as [chapter 1](/runbook/start/install) does.

</Published>

## A request fails before it reaches the service

**A certificate error** on a staging host with a self-signed or expired certificate: prefer adding
your organisation's CA with `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`, which keeps verification on.
`insecure true` in the env turns verification off for the run, and the CLI summary and the report
say so in a banner. See [Corporate networks](/guide/config#corporate-networks).

**It hangs, or times out, behind a corporate proxy.** Node's `fetch` ignores `HTTP_PROXY` unless
`NODE_USE_ENV_PROXY=1` is set, on Node 24 or a current Node 22 — and never for a service reached with a client certificate. `tflw doctor`'s `proxy` line says
whether a proxy will be used.

**`ECONNREFUSED`** — nothing is listening where the env's base URL points: the service is down, or
the port is wrong. **`ENOTFOUND`** — the host name does not resolve.

**Refused before any connection — the host is not allowed.** The config's `allow hosts` does not list
the host a step, a redirect or the browser tried to reach, so the request was never sent. Add the
host (or a `*.domain` pattern) to `allow hosts` in `defaults` or the env; `tflw check` reports an
env whose own base URL is missing from its list as `TF036`.

**A required variable is missing.** `require env A, B` refuses the run and names every variable not
set; one that only the selected env requires says so, as `B (required by env staging)`. Set them in
the shell, or in `.env` at the project root for local work — a real environment variable wins over
`.env`. `tflw doctor --env <name>` lists what an env requires and which are set.

## A run

**It ends `INCONCLUSIVE` and exits 3.** A load test's own generator was the bottleneck: the service
answered faster than tflw could send, which is usual for a service on the same machine, so tflw
reports no verdict rather than numbers about itself. It is not a pass. Run the load tests from
another machine, or leave them out of a functional run with `--tag` or `--kind`. See
[Load results](/guide/load-results).

**A test passes once and fails the next time.** The first run left data the second collides with:
an order under the same idempotency key, a user with the same email. Make the values that must not
repeat with `unique`, which never repeats within a run or across runs. A literal repeats every run,
and so does a `random` value under the same `--seed`. See [`unique` vs. `random`](/guide/variables#unique-vs-random).

**`tflw check` does not offer a reuse hint for steps you can see repeated.** A test whose next step
captures from a response inside those steps is left out of the hint, because an extracted `action`
would keep that response to itself. The other tests that repeat them are still offered it, as in
[chapter 4](/runbook/start/api-test#check-everything-except-running).

**A scan or a crawl is refused with `TF060`.** `tflw.config` does not name the address it would
send requests to. Add an `authorized target` line with a reason, and only for a service you are
allowed to scan. See [`authorized target`](/guide/config#authorized-target-—-what-this-suite-may-scan).

## A browser test cannot start

**No browser is downloaded.** `npx tflw install-browsers` downloads the ones the suite's UI steps use;
`--browser firefox` or `--browser webkit` for another. On Linux a fresh machine may also lack the
browser's system libraries: `npx playwright install --with-deps chromium` installs both.

**It passes headed and fails in CI.** A CI machine has no display for a headed browser; tflw runs
headless unless `--headed` is given, so a CI job that passes `--headed` needs `xvfb-run -a` in front.

**`pick`, `record` or `watch` cannot open a window.** They open a visible browser, so they need a
display: on a machine you reach over SSH, or in a container, run them under `xvfb-run -a` on Linux,
or on your own desktop.

**`tflw pick /order` is refused with *has no `web` line*.** A path is opened against the `web` of
the env in `tflw.config`. Add `web` to that env, or give an absolute URL. Run it from the project's
directory: with no `tflw.config` there, a path has nothing to be opened against.

## The page

**The page refuses to load, or every request answers `401`.** The URL is from an earlier start: each
`tflw ui` mints a new token and prints a new URL. Use the one just printed.

**A save is refused.** The file changed on disk since the page read it — another editor, or a
`git checkout`. The page never overwrites it; **re-read from disk** beside the refusal shows the file
as it is now.

## A helper, an import or a path

**`TF083` — a `use` module is outside the allowed directories.** A helper runs as code, so a project
says where helpers may live: `./helpers` and `./tests/helpers` by default, or the directories its
`helpers` line names. Move the module, or name its directory. See
[Where a `use` may load from](/guide/config#where-a-use-may-load-from-helpers).

**Windows.** Reports, diagnostics and the page name files with `/` on every platform, so a report
reads the same whoever produced it. In PowerShell, quote a test name with spaces for `--only`:
`npx tflw run --only "adds to cart"`.

## Still stuck

`tflw run --verbose` prints a line per step rather than per test, and `report.html` keeps every
request and response (at the default evidence level) with the failing step open. [Debugging](/guide/debugging) walks
through reading a failure; an issue on the
[repository](https://github.com/deepak-tuteja/tflw/issues) with the `tflw doctor` output attached is
the fastest way to an answer.
