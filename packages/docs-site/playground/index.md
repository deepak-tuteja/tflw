---
title: Playground
---

<script setup>
// `ClientOnly` is a default-theme global component — no import needed.
import Playground from './Playground.vue';
</script>

# Playground

Type a `.tflw` snippet and see live parse + check diagnostics — the same front-end
`packages/lang` gives the CLI and the real [`tflw lsp`](/editor) (SPEC §14). This is parse+check
only: nothing here sends a real request, and there's no backend behind this page at all.

<ClientOnly>
  <Playground />
</ClientOnly>
