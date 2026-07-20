---
title: Diagnostic codes reference
---

<script setup>
import { DIAGNOSTICS } from '../../lang/src/spec-data.ts';
// spec-data.ts's cell text uses markdown inline-code spans (`...`) — turn those into <code> tags
// for the plain HTML table below rather than duplicating the manifest as a second, HTML-flavored
// copy (same approach reference/matchers.md already uses).
const code = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>');
</script>

# Diagnostic codes reference

Every stable `TF0xx` code tflw can print — generated from
[`packages/lang/src/spec-data.ts`](https://github.com/deepak-tuteja/tflw/blob/main/packages/lang/src/spec-data.ts),
the same manifest that regenerates [SPEC.md §17](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#17-diagnostic-codes-tf0xx)
and powers hover-on-error in the [editor](/editor). A shipped code is never renumbered or reused —
gaps in the numbering are reserved, not skipped by accident.

Codes print in every `error[TFxxx]: …` line, so they're what a CI grep filter, a bug report, or a
search anchors on. This page exists so looking one up doesn't require reading the source.

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
