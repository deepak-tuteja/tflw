<script setup>
// Live diagnostics + hover demo (decision 107): a real unknown-variable typo, caught by the
// actual `checkUnknownVariables` pass the CLI/LSP both run — same TF0xx code, message, and
// "did you mean" hint a real editor would show, not sample copy.
import { computed } from 'vue';
import { analyze, splitAtSpans } from './analysis.js';

const SOURCE = `test "checkout charges the right total"
  api POST /orders body { total: 59.97 }
  expect status equals 201
  capture body.total as total
  check body.total equals {totl}
`;

const { diagnostics } = analyze(SOURCE);
const ranges = diagnostics.map((d) => ({ start: d.span.start.offset, end: d.span.end.offset, diagnostic: d }));
const chunks = computed(() => splitAtSpans(SOURCE, ranges));
</script>

<template>
  <div class="diagnostics-demo">
    <p class="hint">Hover (or tab to) the underlined text for the real diagnostic.</p>
    <pre class="code"><code><template v-for="(chunk, i) in chunks" :key="i"><span
      v-if="chunk.range"
      class="diag"
      tabindex="0"
    >{{ chunk.text }}<span class="popover">
        <code>{{ chunk.range.diagnostic.code }}</code> {{ chunk.range.diagnostic.message }}<br />
        <span v-if="chunk.range.diagnostic.hint" class="popover-hint">= help: {{ chunk.range.diagnostic.hint }}</span>
      </span></span><span v-else>{{ chunk.text }}</span></template></code></pre>
  </div>
</template>

<style scoped>
.diagnostics-demo {
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
.diag {
  position: relative;
  text-decoration: underline wavy #f14c4c;
  text-underline-offset: 3px;
  cursor: default;
  outline: none;
}
.popover {
  display: none;
  position: absolute;
  bottom: 1.5em;
  left: 0;
  z-index: 1;
  width: max-content;
  max-width: 22rem;
  padding: 0.6rem 0.75rem;
  border-radius: 6px;
  background: #252526;
  border: 1px solid #454545;
  color: #cccccc;
  font-size: 0.8rem;
  line-height: 1.5;
  text-decoration: none;
  white-space: normal;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
}
.diag:hover .popover,
.diag:focus .popover {
  display: block;
}
.popover code {
  color: #f14c4c;
}
.popover-hint {
  color: #9cdcfe;
}
</style>
