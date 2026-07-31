---
title: CLI flags reference
---

<script setup>
import { CLI_FLAGS } from '../../lang/src/spec-data.ts';
const code = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>');
const runFlags = CLI_FLAGS.filter((f) => f.command === 'run');
const loadFlags = CLI_FLAGS.filter((f) => f.command === 'load');
const checkFlags = CLI_FLAGS.filter((f) => f.command === 'check');
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
npx tflw run --env staging --workers 4 --seed 42 --now 2026-01-01T00:00:00.000Z --no-color
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

## `tflw load <file.tflw>`

<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in loadFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>

Runs every `scenario` declared in the file **concurrently** as a load test (see the
[load testing guide](/guide/load-testing)). `--workers N` (default 1) forks N generator
*processes* instead of running in one — each an equal striped share of every scenario's workload
target, merged back into one report; every run also self-diagnoses its own event-loop lag/CPU and
warns if tflw's own generator process was the bottleneck. A live ~1Hz console line tracks
iterations/rps/error-rate as the run goes (single-process or `--workers N>1`, forked workers relay
their own progress back over IPC); Ctrl-C stops new iterations and flushes a **partial** report
instead of losing the run. Writes `report/load-report.html` (charts, per-scenario breakdown),
`report/load-junit.xml` (one `<testcase>` per `threshold`), and `report/load-results.json`. Exit
`0` = every scenario's `threshold`s met (or none declared), `1` = a threshold breached in any
scenario, `2` = usage error, `3` = **inconclusive** (the generator itself saturated — the numbers
describe tflw contending with itself, not the system under test; every junit `<testcase>` is
`skipped`, not passed/failed), `130` = aborted via Ctrl-C (the standard "died from SIGINT" code).

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

`tflw check [files] [--env E] [--no-color]` shares `run`'s `--env`/`--no-color` flags too.

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
