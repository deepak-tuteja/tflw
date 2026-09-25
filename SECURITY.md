# Security policy

tflw is a testing tool. It makes HTTP requests, drives browsers and loads JavaScript modules on the
machine it runs on, against the targets a project's `tflw.config` names. That is its purpose, and
it is also why a vulnerability report about it is worth reading carefully: a flaw here runs on a
developer's machine or a CI runner with that machine's credentials.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository (**Security → Report a
vulnerability**). A report goes to the maintainer and to nobody else; it is not an issue and is not
visible to other users.

You will get an acknowledgement within **72 hours**, and a decision — fixed, mitigated, or not a
vulnerability, with the reasoning — as soon as the report is understood. Before 1.0 there is no
embargo period to negotiate: a fix ships in the next release and the advisory names the report.

Please do not open a public issue for something you believe is exploitable. A report that turns out
to be a plain bug is moved to the issue tracker by the maintainer, with your consent.

## What is in scope

- `tflw` itself: the CLI, the runtime, the reporter, the language server and the VS Code extension.
- `tflw ui`, the local page. It binds to loopback only, requires a per-start token that is in the
  URL it prints and nowhere else, checks `Host` and `Origin` on every request, and serves every
  document under a Content-Security-Policy. A way past any of those from another page in the same
  browser, or from another process on the same machine, is in scope.
- The `use` escape hatch. A project's `tflw.config` names the directories a `use` may load a module
  from (`helpers`, default `./helpers` and `./tests/helpers`); a `use` that resolves outside them is
  refused by `tflw check` and by the run. A way to load a module from outside those directories is
  in scope.
- Redaction. Secrets a run resolves from the environment are redacted from every artefact tflw
  writes. A secret reaching `report.html`, `results.json`, `events.ndjson`, `junit.xml`, the SARIF
  file or the console is in scope.

## What is not

- The applications a suite tests. tflw reports what they do; it does not fix them.
- A `use`d module doing what it was written to do. `helpers` fences where code comes from, not
  what it does — that is the project author's, like any dependency.
- Reachability of `tflw ui` through a tunnel or a proxy the user set up. `ssh -L` is the documented
  way to reach a remote page, and what it forwards is the user's choice.

## Supported versions

tflw is pre-1.0. The latest release is the only one that receives fixes. It runs on Node 22 and
Node 24, which are the two versions CI tests on; a report against another Node version is welcome
but is triaged after those.

## What tflw does not do

- **No telemetry.** Nothing tflw runs reports anything to anyone. There is no usage collection, no
  update check, no crash reporting.
- **No network beyond the targets you name.** A run talks to the hosts a project's config and its
  tests name, and to nothing else. `allow hosts` in `tflw.config` narrows that further and refuses
  anything outside the list before a request is made. `tflw install-browsers` is the one command
  that downloads anything, and it says so.
- **No secrets in artefacts.** Values resolved from environment variables are redacted everywhere a
  run writes.

## Dependencies

CI runs `npm audit --audit-level=high` on every push and pull request, publishes a CycloneDX SBOM
of the workspace as a build artefact, and Dependabot opens a weekly grouped pull request for npm
and for GitHub Actions. A dependency advisory that affects a shipped path is handled like any other
report above.
