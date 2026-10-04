---
title: Diagnostic codes reference
---

<script setup>
import { DIAGNOSTICS } from '../../lang/src/spec-data.ts';
// `code()` turns spec-data.ts's markdown inline-code spans into <code> tags for the plain HTML
// table below; it is one shared module because it used to be four identical copies (`M110b-02`).
import { code } from '../.vitepress/mdCode.ts';
</script>

# Diagnostic codes reference

Every stable `TF0xx` code tflw can print — generated from
[`packages/lang/src/spec-data.ts`](https://github.com/deepak-tuteja/tflw/blob/main/packages/lang/src/spec-data.ts),
the same manifest that regenerates [SPEC.md §17](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#17-diagnostic-codes-tf0xx-)
and powers hover-on-error in the [editor](/editor). A shipped code is never renumbered or reused —
gaps in the numbering are reserved, not skipped by accident.

Codes print in every `error[TFxxx]: …` line, so they're what a CI grep filter, a bug report, or a
search anchors on. This page exists so looking one up doesn't require reading the source.

**Reuse-hint `RF0xx` ids are deliberately not listed here.** The [reuse pass](/guide/actions)
numbers the hints `tflw check` prints `RF001`, `RF002`, … **in order of first occurrence within a
single scan** — add a file that sorts earlier and every id after it shifts. An `RF0xx` is a handle
you type straight back into `tflw refactor apply RF001` in the seconds after the scan that printed
it, not a stable identity, which is why `refactor apply` tells you to re-run `tflw check` for fresh
ids rather than trusting an old one. A lookup table of them would be wrong by the next scan, so
there isn't one — this page's promise is about `TF0xx`, and `TF0xx` alone.

<table>
  <thead>
    <tr><th>Code</th><th>Meaning</th><th>Example</th></tr>
  </thead>
  <tbody>
    <tr v-for="d in DIAGNOSTICS" :key="d.code">
      <td><code>{{ d.code }}</code></td>
      <td v-html="code(d.meaning)" />
      <td v-html="code(d.example)" />
    </tr>
  </tbody>
</table>
