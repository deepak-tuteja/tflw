---
title: CLI flags reference
---

<script setup>
import { CLI_FLAGS } from '../../lang/src/spec-data.ts';
const code = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>');
const runFlags = CLI_FLAGS.filter((f) => f.command === 'run');
const checkFlags = CLI_FLAGS.filter((f) => f.command === 'check');
const initFlags = CLI_FLAGS.filter((f) => f.command === 'init');
const installFlags = CLI_FLAGS.filter((f) => f.command === 'install-browsers');
const pickFlags = CLI_FLAGS.filter((f) => f.command === 'pick');
const watchFlags = CLI_FLAGS.filter((f) => f.command === 'watch');
const migrateFlags = CLI_FLAGS.filter((f) => f.command === 'migrate');
const globalFlags = CLI_FLAGS.filter((f) => f.command === 'global');
</script>

# CLI flags reference

Generated from
[`packages/lang/src/spec-data.ts`](https://github.com/deepak-tuteja/tflw/blob/main/packages/lang/src/spec-data.ts)
(this table used to live in README.md — it moved here as part of the docs-site cluster, decision
16.10). For the subcommands themselves (`init`/`run`/`check`/`docs`), see
[SPEC.md §12](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#12-cli-).

```sh
npx tflw run --env staging --parallel 4 --seed 42 --now 2026-01-01T00:00:00.000Z --no-color
```

## `tflw run`

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in runFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

`tflw run` drives functional and workload-bearing `test`s alike in one pass — a `test` becomes
workload-bearing the moment it contains a `ramp`/`hold`/`step`/`spike`/`run … iterations` line (see
the [load testing guide](/guide/load-testing)); there's no separate `load` command (folded into
`run` in M53). `parallel`/`sequential` (a test-header modifier, not a flag) controls which tests in
a file run concurrently with each other; `--workers N` is the unrelated, workload-only axis above —
it scales *one* workload-bearing test's own generated load across `N` forked processes, never files.
Every run with at least one workload-bearing test also self-diagnoses its own generator process's
event-loop lag/CPU and warns if tflw itself was the bottleneck. A live ~1Hz console line tracks
iterations/rps/error-rate for the workload-bearing tests currently in flight; Ctrl-C stops new
iterations and flushes a **partial** report instead of losing the run. Everything — functional and
workload-bearing test results alike — renders into the one `report/report.html`/`junit.xml`/
`results.json` (M56), in file-declaration order; there are no separate `load-*` artifacts. Exit `0`
= every test passed and every `threshold` was met (or none declared), `1` = a test failed or a
threshold was breached, `2` = usage error, `3` = **inconclusive** (a workload-bearing test ran and
tflw's own generator process saturated — the numbers describe tflw contending with itself, not the
system under test; every threshold's junit `<testcase>` comes back `skipped`, not passed/failed),
`130` = aborted via Ctrl-C (the standard "died from SIGINT" code).

::: tip A flag that takes a value must be given one
`tflw run --evidence` with nothing after it — or with another `--flag` in the value slot — exits
`2` with a usage error rather than quietly falling back to the default. That default is `full`,
the least protective evidence level, so a flag that lost its argument to a CI YAML fold used to
produce a full-detail artifact and a green pipeline. Use `--flag=value` for a value that really
does start with `--`.
:::

::: warning An empty value is not "no filter"
`--tag ""` and `--tag=` exit `2` as well. An empty value asks for *nothing*, so tflw refuses it
rather than running everything: `--tag` and `--only` narrow a run, and an empty one used to be
indistinguishable from leaving the flag off — widening the run to the whole suite, at exit `0`,
while `--tag nope` correctly failed. You will not type this by hand; a shell writes it for you,
from `tflw run --tag "$SUITE_TAGS"` with the variable unset. A value made only of separators
(`--tag=,,`) names no tags and is refused for the same reason.
:::

## `tflw check`

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in checkFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

Validate-only: the same parse + checker pipeline `run` executes before it does anything, with no
HTTP traffic and no secrets required. Exit `0` when every file is clean, `2` otherwise.

## `tflw init`

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in initFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

Scaffolds `tflw.config`, `example.tflw`, `.env.example`, and a `.gitignore` covering `.env` and
`report/` — appending to an existing `.gitignore` rather than duplicating entries.

## `tflw install-browsers`

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in installFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

One-time browser binary download for UI steps — `playwright` is an optional peer, so this only
works once the consuming project installs it.

## `tflw pick <url>`

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in pickFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

Opens a real, visible browser at `<url>` and prints one verified locator per click; runs until the
window is closed or Ctrl+C. `<url>` must be absolute — no `tflw.config` involved.

## `tflw watch`

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in watchFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

`tflw watch [files] [--env E] [--seed S] [--browser engine] [--no-color]` re-runs headed on every
save, one shared browser window for the whole session; saving `tflw.config` re-runs everything.
Runs until Ctrl+C.

## `tflw migrate [files]`

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in migrateFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

Mechanically rewrites checker-flagged deprecations (a warning-severity diagnostic carrying its own
exact replacement text) in place, then prints which files changed. No live deprecation exists in
the grammar yet — it's been additive-only since the first internal milestone — so today this
always reports `no deprecated syntax found — nothing to migrate.` and touches no files.

## `tflw refactor apply <id>`

Extracts one reuse-pass hint (an `RF0xx` id from `tflw check`'s output) into a shared `action`,
writing a new file and rewriting every matched call site. Takes exactly one positional argument —
no flags — and always scans the whole default suite (no `[files]`/`--env` selection, since the
hint ids it consumes come from that same whole-suite scan). Re-run `tflw check`/`tflw run`
afterward to confirm the rewritten suite is still clean and green.

## Global

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in globalFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>
