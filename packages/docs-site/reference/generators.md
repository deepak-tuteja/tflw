---
title: Generators reference
---

<script setup>
import { GENERATORS } from '../../lang/src/spec-data.ts';
// Both markdown fences, doubled first — see reference/diagnostics.md for the failure a
// single-fence regex has on a span containing a backtick of its own. This manifest carries no
// doubled fence today, so the fix is pre-emptive: it is the same one line in four files.
const code = (s) => s.replace(/``\s?([\s\S]+?)\s?``|`([^`]+)`/g, (_, doubled, single) => `<code>${doubled ?? single}</code>`);
</script>

# Generators reference

Every `unique`/`random`/transform form — generated from
[`packages/lang/src/spec-data.ts`](https://github.com/deepak-tuteja/tflw/blob/main/packages/lang/src/spec-data.ts),
the same manifest that generates the
[SPEC.md §7.3.1 quick reference](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#731-generators-quick-reference-plan-decision-103-enterprise-arc-cluster-4).
See [Variables, generators & expressions](/guide/variables) for the `unique` vs. `random`
guarantees.

<table>
  <thead>
    <tr><th>Family</th><th>Generator</th><th>Notes</th><th>Example</th></tr>
  </thead>
  <tbody>
    <tr v-for="g in GENERATORS" :key="g.id">
      <td>{{ g.family }}</td>
      <td v-html="code(g.syntax)" />
      <td v-html="code(g.notes)" />
      <td v-html="code(g.example)" />
    </tr>
  </tbody>
</table>
