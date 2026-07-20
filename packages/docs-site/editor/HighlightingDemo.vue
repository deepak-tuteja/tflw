<script setup>
// Live semantic-highlighting demo (decision 107): colors a real sample using the actual
// `collectSemanticTokens` classifier the LSP serves over `textDocument/semanticTokens/full` — not
// a screenshot, and not a re-implementation. The palette below is illustrative (picked for
// legibility, not to match any specific VS Code theme) since real rendered colors depend on the
// reader's own theme, as the surrounding page text explains.
import { computed } from 'vue';
import { collectSemanticTokens } from '@tflw/lang';
import { analyze, splitAtSpans } from './analysis.js';

const SOURCE = `action create widget(name, price)
  api POST /widgets body { name: {name}, price: {price} }
  expect status equals 201
  capture body.id as id
  give id

test "checkout totals are correct"
  let widgetId = create widget("Gadget", 12.5)
  api GET /widgets/{widgetId}
  expect status equals 200
  check duration is less than 500ms
  check body.price equals 12.5
`;

const LEGEND = [
  ['keyword', 'statement keywords, HTTP methods'],
  ['operator', 'matcher/comparison words'],
  ['type', 'subject words (status, duration, …)'],
  ['function', 'generators + action calls'],
  ['number', 'numeric literals'],
  ['variable', 'let/capture names'],
  ['parameter', 'action parameter names'],
  ['property', 'object-literal field keys'],
];

const { symbols } = analyze(SOURCE);
const ranges = collectSemanticTokens(SOURCE, symbols).map((t) => ({
  start: t.span.start.offset,
  end: t.span.end.offset,
  type: t.type,
}));
const chunks = computed(() => splitAtSpans(SOURCE, ranges));
</script>

<template>
  <div class="highlighting-demo">
    <pre class="code"><code><span
      v-for="(chunk, i) in chunks"
      :key="i"
      :class="chunk.range ? `tok-${chunk.range.type}` : null"
    >{{ chunk.text }}</span></code></pre>
    <ul class="legend">
      <li v-for="[type, label] in LEGEND" :key="type">
        <span class="swatch" :class="`tok-${type}`"></span>
        <code>{{ type }}</code>
        <span class="label">{{ label }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.highlighting-demo {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
}
.code {
  margin: 0;
  padding: 1rem;
  overflow-x: auto;
  background: #1e1e1e;
  color: #d4d4d4;
  font-family: var(--vp-font-family-mono);
  font-size: 0.85rem;
  line-height: 1.6;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.25rem;
  margin: 0;
  padding: 0.75rem 1rem;
  list-style: none;
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-code-block-bg);
}
.legend li {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.8rem;
}
.legend .label {
  color: var(--vp-c-text-2);
}
.swatch {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 2px;
  flex-shrink: 0;
}
.tok-keyword {
  color: #569cd6;
}
.tok-operator {
  color: #c586c0;
}
.tok-type {
  color: #4ec9b0;
}
.tok-function {
  color: #dcdcaa;
}
.tok-number {
  color: #b5cea8;
}
.tok-variable {
  color: #9cdcfe;
}
.tok-parameter {
  color: #e5c07b;
}
.tok-property {
  color: #e06c75;
}
.swatch.tok-keyword {
  background: #569cd6;
}
.swatch.tok-operator {
  background: #c586c0;
}
.swatch.tok-type {
  background: #4ec9b0;
}
.swatch.tok-function {
  background: #dcdcaa;
}
.swatch.tok-number {
  background: #b5cea8;
}
.swatch.tok-variable {
  background: #9cdcfe;
}
.swatch.tok-parameter {
  background: #e5c07b;
}
.swatch.tok-property {
  background: #e06c75;
}
</style>
