# Runbook

How to run a tflw project. The [Guide](/guide/first-test) teaches the language; this section is the
operator's side: installing, setting a project up, running it locally and in CI, and working on it
in the editor and the page.

## Start here: the walkthrough

One project, the **Coffee Shelf**, from an empty directory to a green run in CI, in the order a
first day goes. Each chapter starts where the one before it stopped, and every command in it is run
on every change to tflw, exactly as written.

| | Chapter | What you do |
|---|---|---|
| 1 | [Install](/runbook/start/install) | Node, the package, a browser |
| 2 | [The example](/runbook/start/example) | write the Coffee Shelf, read its config, start the shop, run the suite |
| 3 | [The first run and its report](/runbook/start/first-run) | the terminal, `report/`, a failure on purpose, exit codes, `--failed` |
| 4 | [An API test of your own](/runbook/start/api-test) | `capture`, `expect`, `fmt`, `check`, `refactor apply`, `docs`, `spec` |
| 5 | [A browser test](/runbook/start/browser-test) | `pick`, `record`, `watch`, a trace |
| 6 | [Load and scan](/runbook/start/load-and-scan) | a test at a rate, exit 3, a `crawl`, `authorized target` |
| 7 | [The page](/runbook/start/page) | `tflw ui`: a test changed in Compose, run with ▶, its failure read on Run, Config |
| 8 | [The editor](/runbook/start/editor) | the VS Code extension, the Test Explorer, `tflw lsp` |
| 9 | [CI](/runbook/start/ci) | the four lines, `--shard` and `merge`, `export` |
| 10 | [Your own service](/runbook/start/your-service) | `api` and `web`, envs, secrets, `migrate` |

## How-tos, by topic

For when you know what you want to do and need the page for it.

| When | Page |
|---|---|
| Once per machine | [Installing tflw](/runbook/install): Node, the package, the browsers, and upgrading |
| Once per project | [Setting up a project](/runbook/project): `tflw.config`, envs, sessions, secrets |
| Every change | [Running a suite](/runbook/running): locally, sharded, in CI, and what the report holds |
| Writing tests | [Working on the page](/runbook/page): `tflw ui`, Compose and Source, a run followed live |
| Writing tests | [Working in the editor](/runbook/editor): diagnostics, the Test Explorer, refactors |
| When it refuses | [Troubleshooting](/runbook/troubleshoot): by what you see, not by error code |
| Any time | [Glossary](/runbook/glossary): the words the page, the report and these pages use |

`npx tflw doctor` is the first command on any machine or project that is new to you: which tflw
and Node, which env and services, the proxy and TLS settings, how big the suite is and which
browsers are downloaded. It reads all of that without sending a request.

Every command and every flag is in [the CLI reference](/reference/cli), and the page has
[its own section](/ui/). For the language by example, the
[worked examples](/guide/first-test#worked-examples) are sixteen annotated files that run in tflw's
own CI.
