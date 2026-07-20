<script setup>
// Live signature help demo (decision 107): edit the call (or move the cursor) and the real
// `getSignatureHelp` (@tflw/lsp-server/pure) re-resolves the active parameter against this file's
// own action declaration — the same function the LSP's `onSignatureHelp` handler calls.
import { ref, computed, onMounted } from 'vue';
import { parseSource } from '@tflw/lang';
import { getSignatureHelp } from '@tflw/lsp-server/pure';

const DEFAULT_SOURCE = `action create widget(name, price)
  api POST /widgets body { name: {name}, price: {price} }
  expect status equals 201

test "checkout"
  let widgetId = create widget("Gadget", 12.5)`;

// Defaults to sitting right after the comma, inside the (closed) call's 2nd argument — an
// unclosed call at the very end of the source has no CallExpr node yet (panic-mode recovery bails
// before wrapping it), so this deliberately isn't cursor-at-EOF.
const DEFAULT_CURSOR = DEFAULT_SOURCE.indexOf('12.5');

const source = ref(DEFAULT_SOURCE);
const cursor = ref(DEFAULT_CURSOR);
const textareaRef = ref(null);

function syncCursor() {
  cursor.value = textareaRef.value?.selectionStart ?? source.value.length;
}

// Lines up the textarea's actual caret with DEFAULT_CURSOR — otherwise the browser places it at
// the end by default, out of sync with the parameter this demo highlights on load.
onMounted(() => {
  textareaRef.value?.setSelectionRange(DEFAULT_CURSOR, DEFAULT_CURSOR);
});

const help = computed(() => {
  const { program } = parseSource(source.value);
  return getSignatureHelp(program, cursor.value);
});
</script>

<template>
  <div class="sighelp-demo">
    <p class="hint">Type inside the call — the active parameter tracks your real cursor position.</p>
    <div class="editor-wrap">
      <textarea
        ref="textareaRef"
        v-model="source"
        spellcheck="false"
        rows="6"
        @input="syncCursor"
        @click="syncCursor"
        @keyup="syncCursor"
      ></textarea>
      <div v-if="help" class="popup">
        <template v-for="(param, i) in help.parameters" :key="i">
          <span v-if="i > 0">, </span><span :class="i === help.activeParameter ? 'active' : null">{{ param }}</span>
        </template>
      </div>
      <p v-else class="none">no active call at the current cursor position</p>
    </div>
  </div>
</template>

<style scoped>
.sighelp-demo {
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
.popup {
  margin-top: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  background: #252526;
  border: 1px solid #454545;
  color: #cccccc;
  font-family: var(--vp-font-family-mono);
  font-size: 0.85rem;
}
.popup .active {
  color: #dcdcaa;
  font-weight: 600;
}
.none {
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: var(--vp-c-text-2);
}
</style>
