<script setup>
// Parse+check only (decision 16.5) — no execution, no network calls, no backend. Parses the
// snippet with @tflw/lang (pure, no I/O — the same front-end a later LSP wraps, SPEC §14) and
// runs its config-independent semantic pass, `checkUnknownVariables`. `checkServices`/
// `checkSessions`/`checkDataTables` are deliberately skipped: they validate a step's references
// against a real `tflw.config`'s declared services/sessions, and a standalone playground snippet
// has none — running them here would flag `as admin`/a named service as "unknown" even when a
// real project's config would resolve it fine.
import { ref, computed } from 'vue';
import { parseSource, checkUnknownVariables } from '@tflw/lang';

const DEFAULT_SOURCE = `test "health check"
  api GET /health
  expect status equals 200
`;

const source = ref(DEFAULT_SOURCE);

const diagnostics = computed(() => {
  try {
    const parsed = parseSource(source.value);
    const variableDiags = checkUnknownVariables(parsed.program);
    return [...parsed.diagnostics, ...variableDiags];
  } catch (err) {
    return [{ code: 'TF-INTERNAL', message: String(err && err.message ? err.message : err), span: null }];
  }
});
</script>

<template>
  <div class="playground">
    <p class="hint">
      Parse + check only — <code>checkServices</code>/<code>checkSessions</code> are skipped since
      there's no real <code>tflw.config</code> here.
    </p>
    <textarea v-model="source" spellcheck="false" rows="10"></textarea>
    <div v-if="diagnostics.length === 0" class="ok">no diagnostics — this parses and checks clean</div>
    <ul v-else class="diagnostics">
      <li v-for="(d, i) in diagnostics" :key="i">
        <code>{{ d.code }}</code>
        <span>{{ d.message }}</span>
        <span v-if="d.span" class="span">line {{ d.span.start.line }}, col {{ d.span.start.column }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.playground {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  padding: 1rem;
}
.hint {
  margin-top: 0;
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
.ok {
  margin-top: 0.75rem;
  color: var(--vp-c-brand-1);
  font-weight: 600;
}
.diagnostics {
  margin-top: 0.75rem;
  padding-left: 1rem;
}
.diagnostics li {
  margin: 0.5rem 0;
}
.diagnostics .span {
  display: block;
  color: var(--vp-c-text-2);
  font-size: 0.8rem;
}
</style>
