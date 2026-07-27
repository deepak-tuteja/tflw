---
title: CLI flags reference
---

<script setup>
import { CLI_FLAGS } from '../../lang/src/spec-data.ts';
const code = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>');
const runFlags = CLI_FLAGS.filter((f) => f.command === 'run');
const checkFlags = CLI_FLAGS.filter((f) => f.command === 'check');
const pickFlags = CLI_FLAGS.filter((f) => f.command === 'pick');
const watchFlags = CLI_FLAGS.filter((f) => f.command === 'watch');
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
