---
title: Matchers reference
---

<script setup>
import { MATCHERS } from '../../lang/src/spec-data.ts';
// spec-data.ts's cell text uses markdown inline-code spans (`...`) — turn those into <code> tags
// for the plain HTML table below rather than duplicating the manifest as a second, HTML-flavored
// copy.
// Both markdown fences, doubled first — see reference/diagnostics.md for the failure a
// single-fence regex has on a span containing a backtick of its own. This manifest carries no
// doubled fence today, so the fix is pre-emptive: it is the same one line in four files.
const code = (s) => s.replace(/``\s?([\s\S]+?)\s?``|`([^`]+)`/g, (_, doubled, single) => `<code>${doubled ?? single}</code>`);
</script>

# Matchers reference

Every row of `tflw`'s closed matcher set — generated from
[`packages/lang/src/spec-data.ts`](https://github.com/deepak-tuteja/tflw/blob/main/packages/lang/src/spec-data.ts),
the same manifest that regenerates [SPEC.md §6.2](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#62-matcher-table).
`not` negates any of them, and `is` is an optional copula that may sit on either side of it — so
`is not visible`, `not is visible`, `is visible` and `not visible` all parse. Every matcher operand
below takes the full value grammar, not just literals: `has count {expected}` works exactly like
`equals {expected}`. See [Assertions in depth](/guide/assertions) for the full walkthrough.

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
