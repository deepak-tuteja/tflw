<script setup>
// Live go-to-definition demo (decision 107): click any highlighted name and the real
// `findDefinition` (@tflw/lsp-server/pure) resolves it — same function the LSP's `onDefinition`
// handler calls. Sample stays single-file so only the `'local'` case fires; a real project's
// session/imported-action refs resolve into `tflw.config`/another file the same way (Phase 3's I/O
// layer, not this pure function's job) — noted below rather than faked here.
import { ref, computed } from 'vue';
import { analyze, splitAtSpans } from './analysis.js';
import { findDefinition } from '@tflw/lsp-server/pure';

const SOURCE = `test "checkout charges the right total"
  let total = 59.97
  api POST /orders body { total: total }
  expect status equals 201
  check body.total equals total
`;

const { program, symbols } = analyze(SOURCE);
const clickable = [...symbols.defs, ...symbols.refs].map((s) => ({
  start: s.span.start.offset,
  end: s.span.end.offset,
}));
const chunks = computed(() => splitAtSpans(SOURCE, clickable));

const defSpan = ref(null);
const status = ref('Click a highlighted name.');

function onClick(range) {
  const result = findDefinition(program, symbols, range.start + 1);
  if (!result) {
    status.value = 'No resolvable definition here.';
    defSpan.value = null;
    return;
  }
  if (result.kind === 'local') {
    defSpan.value = { start: result.span.start.offset, end: result.span.end.offset };
    status.value = 'Jumped to the local definition, highlighted below.';
  } else if (result.kind === 'config-session') {
    defSpan.value = null;
    status.value = `In a real project, this jumps into tflw.config's "${result.name}" session.`;
  } else {
    defSpan.value = null;
    status.value = `In a real project, this jumps into the file that declares "${result.name}".`;
  }
}
</script>

<template>
  <div class="godef-demo">
    <p class="hint">{{ status }}</p>
    <pre class="code"><code><span
      v-for="(chunk, i) in chunks"
      :key="i"
      :class="[chunk.range ? 'clickable' : null, defSpan && chunk.range && chunk.range.start === defSpan.start ? 'target' : null]"
      @click="chunk.range && onClick(chunk.range)"
    >{{ chunk.text }}</span></code></pre>
  </div>
</template>

<style scoped>
.godef-demo {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
}
.hint {
  margin: 0;
  padding: 0.6rem 1rem;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-code-block-bg);
  min-height: 1.2em;
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
.target {
  background: rgba(255, 215, 0, 0.25);
  outline: 1px solid #ffd700;
}
</style>
