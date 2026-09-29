<script setup lang="ts">
// `M253` `F` — renders its slot only when the site's `PUBLISHED` flag equals `when`.
// `<Published>` is the text for after 1.0; `<Published :when="false">` the text for before it.
import { PUBLISHED } from '../published';
const props = withDefaults(defineProps<{ when?: boolean }>(), { when: true });
const shown = PUBLISHED === props.when;
</script>

<template>
  <div v-if="shown" class="published-block"><slot /></div>
</template>
