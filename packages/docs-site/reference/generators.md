---
title: Generators reference
---

<script setup>
import { GENERATORS } from '../../lang/src/spec-data.ts';
// `code()` turns spec-data.ts's markdown inline-code spans into <code> tags for the plain HTML
// table below; it is one shared module because it used to be four identical copies (`M110b-02`).
import { code } from '../.vitepress/mdCode.ts';
</script>

# Generators reference

Every `unique`/`random`/transform form — generated from
[`packages/lang/src/spec-data.ts`](https://github.com/deepak-tuteja/tflw/blob/main/packages/lang/src/spec-data.ts),
the same manifest that generates the
[SPEC.md §7.3.1 quick reference](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#731-generators-quick-reference-p103-enterprise-arc-cluster-4).
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
