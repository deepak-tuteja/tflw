<script setup>
// Live autocomplete demo (decision 107): edit the snippet (or just move the cursor) and the real
// `getCompletionContext` (@tflw/lang) + `getCompletions` (@tflw/lsp-server/pure) run against your
// exact cursor position — the same two functions the LSP's `onCompletion` handler calls.
import { ref, computed } from 'vue';
import { getCompletionContext } from '@tflw/lang';
import { getCompletions } from '@tflw/lsp-server/pure';

const DEFAULT_SOURCE = `test "checkout charges the right total"
  api POST /orders
  expect status eq`;

const source = ref(DEFAULT_SOURCE);
const cursor = ref(DEFAULT_SOURCE.length);
const textareaRef = ref(null);

function syncCursor() {
  cursor.value = textareaRef.value?.selectionStart ?? source.value.length;
}

const candidates = computed(() => {
  const ctx = getCompletionContext(source.value, cursor.value);
  return ctx ? getCompletions(ctx) : [];
});
</script>

<template>
  <div class="autocomplete-demo">
    <p class="hint">Type — completion recomputes at your real cursor position.</p>
    <div class="editor-wrap">
      <textarea
        ref="textareaRef"
        v-model="source"
        spellcheck="false"
        rows="4"
        @input="syncCursor"
        @click="syncCursor"
        @keyup="syncCursor"
      ></textarea>
      <ul v-if="candidates.length" class="dropdown">
        <li v-for="c in candidates" :key="c.label">
          <span class="label">{{ c.label }}</span>
          <span v-if="c.detail" class="detail">{{ c.detail }}</span>
        </li>
      </ul>
      <p v-else class="none">no completions at the current cursor position</p>
    </div>
  </div>
</template>

<style scoped>
.autocomplete-demo {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 1rem;
}
.hint {
  margin: 0 0 0.75rem;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
}
textarea {
  width: 100%;
  box-sizing: border-box;
  font-family: var(--vp-font-family-mono);
  font-size: 0.9rem;
  padding: 0.75rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-code-block-bg);
  color: var(--vp-c-text-1);
}
.dropdown {
  margin: 0.5rem 0 0;
  padding: 0.25rem;
  list-style: none;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
}
.dropdown li {
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
  padding: 0.35rem 0.5rem;
  border-radius: 4px;
}
.dropdown li:hover {
  background: var(--vp-c-default-soft);
}
.dropdown .label {
  font-family: var(--vp-font-family-mono);
  font-weight: 600;
  color: var(--vp-c-brand-1);
}
.dropdown .detail {
  font-size: 0.8rem;
  color: var(--vp-c-text-2);
}
.none {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: var(--vp-c-text-2);
}
</style>
