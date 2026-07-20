<script setup>
// Live rename demo (decision 107): the real `findRenameTargets` (@tflw/lsp-server/pure) resolves
// every occurrence of the clicked name — including inside string/path interpolation holes
// (`"total is {total}"`, `/orders/{total}`), the exact case a real span bug (fixed this session,
// PLAN.md decision 105a) used to mangle. Typing a new name live-substitutes every target span at
// once, the same multi-span edit a real rename applies.
import { ref, computed } from 'vue';
import { analyze, splitAtSpans } from './analysis.js';
import { findRenameTargets } from '@tflw/lsp-server/pure';

const SOURCE = `test "checkout charges the right total"
  let total = 59.97
  api POST /orders/{total} body { note: "total is {total}" }
  expect status equals 201
`;

const { symbols } = analyze(SOURCE);
const clickable = [...symbols.defs, ...symbols.refs].map((s) => ({
  start: s.span.start.offset,
  end: s.span.end.offset,
}));
const originalChunks = computed(() => splitAtSpans(SOURCE, clickable));

const target = ref(null);
const newName = ref('');

function onClick(range) {
  const result = findRenameTargets(symbols, range.start + 1);
  if (!result) return;
  target.value = result;
  newName.value = result.name;
}

function reset() {
  target.value = null;
  newName.value = '';
}

const preview = computed(() => {
  if (!target.value) return null;
  const spans = [...target.value.spans].map((s) => ({ start: s.start.offset, end: s.end.offset })).sort((a, b) => a.start - b.start);
  let text = '';
  let pos = 0;
  const renamed = [];
  for (const s of spans) {
    text += SOURCE.slice(pos, s.start);
    const start = text.length;
    text += newName.value;
    renamed.push({ start, end: text.length });
    pos = s.end;
  }
  text += SOURCE.slice(pos);
  return splitAtSpans(text, renamed);
});
</script>

<template>
  <div class="rename-demo">
    <div class="toolbar">
      <template v-if="target">
        <label>Rename <code>{{ target.name }}</code> to:</label>
        <input v-model="newName" spellcheck="false" />
        <button type="button" @click="reset">choose a different name</button>
      </template>
      <p v-else class="hint">Click a highlighted name to rename it — every occurrence, including inside interpolation holes, updates together.</p>
    </div>
    <pre v-if="!target" class="code"><code><span
      v-for="(chunk, i) in originalChunks"
      :key="i"
      :class="chunk.range ? 'clickable' : null"
      @click="chunk.range && onClick(chunk.range)"
    >{{ chunk.text }}</span></code></pre>
    <pre v-else class="code"><code><span
      v-for="(chunk, i) in preview"
      :key="i"
      :class="chunk.range ? 'renamed' : null"
    >{{ chunk.text }}</span></code></pre>
  </div>
</template>

<style scoped>
.rename-demo {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1rem;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-code-block-bg);
  font-size: 0.85rem;
  min-height: 1.5rem;
}
.hint {
  margin: 0;
  color: var(--vp-c-text-2);
}
.toolbar input {
  font-family: var(--vp-font-family-mono);
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
}
.toolbar button {
  margin-left: auto;
  font-size: 0.8rem;
  color: var(--vp-c-brand-1);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: underline;
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
.clickable {
  cursor: pointer;
  color: #9cdcfe;
  border-radius: 3px;
}
.clickable:hover {
  text-decoration: underline;
}
.renamed {
  background: rgba(255, 215, 0, 0.25);
  outline: 1px solid #ffd700;
  border-radius: 2px;
}
</style>
