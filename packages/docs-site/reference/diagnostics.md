---
title: Diagnostic codes reference
---

<script setup>
import { DIAGNOSTICS } from '../../lang/src/spec-data.ts';
// spec-data.ts's cell text uses markdown inline-code spans — turn those into <code> tags for the
// plain HTML table below rather than duplicating the manifest as a second, HTML-flavored copy
// (same approach reference/matchers.md already uses).
//
// **Both fences, and the doubled one first.** A cell whose code span contains a backtick of its own
// is fenced ``like this``, which markdown reads as one span with literal inner backticks. The
// single-fence-only regex this replaced read it as *two* spans starting one character in, so
// ``did you mean `expect`?`` rendered as "<code> did you mean </code>expect<code>? </code>" with a
// stray backtick either side. That was already wrong on 13 of the 41 rows before M110b, which
// generated the cells from probes and took it to 35 — a pre-existing bug found only because
// something downstream started leaning on it harder.
const code = (s) => s.replace(/``\s?([\s\S]+?)\s?``|`([^`]+)`/g, (_, doubled, single) => `<code>${doubled ?? single}</code>`);
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
