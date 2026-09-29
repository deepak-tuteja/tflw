# Runbook

How to run a tflw project, in the order a day with one goes. The [Guide](/guide/first-test)
teaches the language; this section is the operator's: installing, setting a project up, running it
locally and in CI, working on it in the page and the editor, and what to do when something refuses.

| When | Page |
|---|---|
| Once per machine | [Installing tflw](/runbook/install) — Node, the package, the browsers, and upgrading |
| Once per project | [Setting up a project](/runbook/project) — `tflw.config`, envs, sessions, secrets |
| Every change | [Running a suite](/runbook/running) — locally, sharded, in CI, and what the report holds |
| Writing tests | [Working on the page](/runbook/page) — `tflw ui`, Compose and Source, a run followed live |
| Writing tests | [Working in the editor](/runbook/editor) — diagnostics, the Test Explorer, refactors |
| When it refuses | [Troubleshooting](/runbook/troubleshoot) — by what you see, not by error code |
| Any time | [Glossary](/runbook/glossary) — the words the page, the report and these pages use |

`npx tflw doctor` is the first command on any machine or project that is new to you: which tflw
and Node, which env and services, the proxy and TLS settings, how big the suite is and which
browsers are downloaded — read-only, before a run finds out.

For the language itself by example, the [worked examples](/guide/first-test#worked-examples) are
sixteen annotated files that run in tflw's own dogfood CI.
