---
title: Matchers reference
---

<script setup>
import { MATCHERS } from '../../lang/src/spec-data.ts';
// spec-data.ts's cell text uses markdown inline-code spans (`...`) — turn those into <code> tags
// for the plain HTML table below rather than duplicating the manifest as a second, HTML-flavored
// copy.
const code = (s) => s.replace(/`([^`]+)`/g, '<code>$1</code>');
</script>

# Matchers reference

Every row of `tflw`'s closed matcher set — generated from
[`packages/lang/src/spec-data.ts`](https://github.com/deepak-tuteja/tflw/blob/main/packages/lang/src/spec-data.ts),
the same manifest that regenerates [SPEC.md §6.2](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#62-matcher-table).
`not` negates any of them. See [Assertions in depth](/guide/assertions) for the full walkthrough.

<table>
  <thead>
    <tr><th>Matcher</th><th>Applies to</th><th>Example</th><th>Status</th></tr>
  </thead>
  <tbody>
    <tr v-for="m in MATCHERS" :key="m.id">
      <td v-html="code(m.syntax)" />
      <td v-html="code(m.appliesTo)" />
      <td v-html="code(m.example)" />
      <td>{{ m.status === 'shipped' ? '✅' : '🔮' }}</td>
    </tr>
  </tbody>
</table>
