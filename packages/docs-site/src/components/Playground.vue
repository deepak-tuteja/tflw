<script setup>
// The Playground (`M270`, `D-M270-5`): a small editor over the language's own front end, with no
// editor dependency. Nothing here runs a test, sends a request or talks to a server.
//
// What it is made of, each piece the one the CLI and the language server use:
//  - `analyze()` (`editor/analysis.js`) — `parseSource` plus `checkProgram` with no options, which is
//    every check `tflw check` judges a single file by. The checks that need a project are skipped
//    by omitting their options, never by passing an empty list: there is no `tflw.config` and no
//    filesystem here, and an empty list would claim every service, session and file is missing.
//  - `collectSemanticTokens` — the classifier behind the editor extension's colours — plus the
//    lexer's own string tokens, drawn in a layer under a transparent textarea.
//
// Which codes this page cannot show is derived, not written: a code whose every probe in
// `spec-data.ts` needs project context (`needs`) or is a `tflw.config`, and the codes only a run
// reports. `playground.test.mjs` holds that both ways — every other code's probe is reported here.
//
// The overlay is the classic failure of this technique, so its layout rules are few and shared:
// the textarea and the layer take the same font, line height, padding and tab size, neither wraps,
// and the layer follows the textarea's scroll. The browser gate measures that alignment.
import { computed, ref } from 'vue';
import { collectSemanticTokens, DIAGNOSTICS, lex } from '@tflw/lang';
import { inline } from '../lib/mdCode.ts';
import { analyze } from './editor/analysis.js';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

const STARTERS = [
  {
    id: 'api',
    label: 'API',
    source: `test "creates an order and reads it back"
  api POST /orders body { name: "Widget", qty: 2 }
  expect status equals 201
  capture body.id as orderId
  api GET /orders/{orderId}
  expect status equals 200
  expect body.qty equals 2
`,
  },
  {
    id: 'browser',
    label: 'Browser',
    source: `test "adds a widget to the cart"
  open "/shop"
  click button "Add to cart"
  expect text "1 item" is visible
  fill field "Email" with "a@b.c"
  click button "Checkout"
  wait until text "Order placed" is visible
`,
  },
  {
    id: 'load',
    label: 'Load',
    source: `test "the catalogue under load"
  ramp to 50 users over 30s
  api GET /products
  expect status equals 200
  threshold p95 duration is less than 800ms
  threshold error rate is less than 1%
`,
  },
  {
    id: 'mistakes',
    label: 'With mistakes',
    source: `test "three mistakes"
  api GET /orders
  expct status equals 200
  expect body.total equals {totl}
  check field "Terms"
`,
  },
];

/** The codes this page cannot report, and why, derived from the manifest (see the header). */
const PROJECT_CODES = DIAGNOSTICS.filter((d) => d.probes?.length && d.probes.every((p) => p.wrap === 'config' || p.needs !== undefined)).map((d) => d.code);
const RUN_CODES = DIAGNOSTICS.filter((d) => !d.probes?.length).map((d) => d.code);

const source = ref(STARTERS[0].source);
const starter = ref(STARTERS[0].id);
const textarea = ref(null);
const layer = ref(null);
const gutter = ref(null);

const choose = (s) => {
  starter.value = s.id;
  source.value = s.source;
};

const analysis = computed(() => {
  try {
    const { symbols, diagnostics } = analyze(source.value);
    const ranges = collectSemanticTokens(source.value, symbols, 'test').map((t) => ({ start: t.span.start.offset, end: t.span.end.offset, type: t.type }));
    const strings = lex(source.value).tokens.filter((t) => t.type === 'string').map((t) => ({ start: t.span.start.offset, end: t.span.end.offset, type: 'string' }));
    return { ranges: [...ranges, ...strings], diagnostics };
  } catch (err) {
    return { ranges: [], diagnostics: [{ code: 'TF-INTERNAL', message: String(err?.message ?? err), span: null }] };
  }
});

const diagnostics = computed(() => analysis.value.diagnostics);

/**
 * The source as lines of segments, each segment carrying its colour and whether a diagnostic
 * covers it. Boundaries are every token's and every diagnostic's start and end, so a squiggle can
 * start inside a coloured word without the colour being lost.
 */
const lines = computed(() => {
  const text = source.value;
  const colour = new Array(text.length).fill(null);
  for (const r of analysis.value.ranges) for (let i = r.start; i < r.end && i < text.length; i++) colour[i] ??= r.type;
  const flagged = new Array(text.length).fill(false);
  for (const d of analysis.value.diagnostics) {
    if (!d.span) continue;
    const end = Math.max(d.span.end.offset, d.span.start.offset + 1);
    for (let i = d.span.start.offset; i < end && i < text.length; i++) flagged[i] = true;
  }
  const out = [];
  let line = [];
  let seg = null;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (i === text.length || ch === '\n') {
      if (seg) line.push(seg);
      out.push(line);
      line = [];
      seg = null;
      continue;
    }
    if (seg && seg.type === colour[i] && seg.flagged === flagged[i]) seg.text += ch;
    else {
      if (seg) line.push(seg);
      seg = { text: ch, type: colour[i], flagged: flagged[i] };
    }
  }
  return out;
});

/** Lines that carry a diagnostic, for the gutter's marker. */
const marked = computed(() => new Set(analysis.value.diagnostics.filter((d) => d.span).map((d) => d.span.start.line)));

const rows = computed(() => Math.min(Math.max(lines.value.length + 1, 10), 28));

const follow = () => {
  const t = textarea.value;
  if (!t) return;
  if (layer.value) {
    layer.value.scrollTop = t.scrollTop;
    layer.value.scrollLeft = t.scrollLeft;
  }
  if (gutter.value) gutter.value.scrollTop = t.scrollTop;
};

/** Put the caret where a diagnostic starts. */
const go = (d) => {
  const t = textarea.value;
  if (!t || !d.span) return;
  t.focus();
  t.setSelectionRange(d.span.start.offset, Math.max(d.span.end.offset, d.span.start.offset));
};

const checkedLink = `${BASE}/reference/diagnostics`;
</script>

<template>
  <!-- `not-content`: Starlight's content rules (a 1rem margin between any two blocks, among others)
       would push the text layer off the gutter's lines. The component styles itself. -->
  <div class="playground not-content">
    <div class="pg-bar">
      <span class="pg-label" id="pg-starters-label">Start from</span>
      <div class="pg-starters" role="group" aria-labelledby="pg-starters-label">
        <button
          v-for="s in STARTERS"
          :key="s.id"
          type="button"
          :data-starter="s.id"
          :aria-pressed="starter === s.id"
          @click="choose(s)"
        >{{ s.label }}</button>
      </div>
    </div>

    <div class="pg-editor">
      <pre ref="gutter" class="pg-gutter" aria-hidden="true"><span
        v-for="(_, i) in lines"
        :key="i"
        class="pg-num"
        :class="{ 'pg-marked': marked.has(i + 1) }"
        :data-line="i + 1"
      >{{ i + 1 }}</span></pre>
      <div class="pg-text">
        <pre ref="layer" class="pg-layer" aria-hidden="true"><span
          v-for="(segs, i) in lines"
          :key="i"
          class="pg-line"
          :data-line="i + 1"
        ><span
          v-for="(seg, j) in segs"
          :key="j"
          :class="[seg.type ? `tok-${seg.type}` : null, seg.flagged ? 'pg-flagged' : null]"
        >{{ seg.text }}</span></span></pre>
        <textarea
          id="pg-source"
          ref="textarea"
          v-model="source"
          :rows="rows"
          wrap="off"
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          aria-label="tflw source"
          @scroll="follow"
          @input="follow"
        ></textarea>
      </div>
    </div>

    <div class="pg-result" aria-live="polite">
      <p v-if="diagnostics.length === 0" class="pg-ok">No diagnostics: this file parses and passes every check that runs here.</p>
      <ul v-else class="pg-diagnostics">
        <li v-for="(d, i) in diagnostics" :key="i">
          <a v-if="/^TF\d{3}$/.test(d.code)" class="pg-code" :href="`${BASE}/reference/diagnostics#${d.code.toLowerCase()}`">{{ d.code }}</a>
          <code v-else class="pg-code">{{ d.code }}</code>
          <span class="pg-message" v-html="inline(d.message)"></span>
          <button v-if="d.span" type="button" class="pg-where" @click="go(d)">line {{ d.span.start.line }}, col {{ d.span.start.column }}</button>
        </li>
      </ul>
    </div>

    <details class="pg-scope">
      <summary>What is checked here</summary>
      <p>
        The parser and every check <code>tflw check</code> judges a single file by. Not the
        {{ PROJECT_CODES.length }} codes that need your project — its <code>tflw.config</code>, its
        files or its helpers:
        <template v-for="(c, i) in PROJECT_CODES" :key="c"><a :href="`${checkedLink}#${c.toLowerCase()}`">{{ c }}</a>{{ i < PROJECT_CODES.length - 1 ? ', ' : '' }}</template>.
        And not the {{ RUN_CODES.length }} only a run can report:
        <template v-for="(c, i) in RUN_CODES" :key="c"><a :href="`${checkedLink}#${c.toLowerCase()}`">{{ c }}</a>{{ i < RUN_CODES.length - 1 ? ', ' : '' }}</template>.
      </p>
    </details>
  </div>
</template>

<style scoped>
.playground {
  --pg-font: var(--sl-font-mono, var(--sl-font-system-mono));
  --pg-size: 0.875rem;
  --pg-line: 1.6;
  --pg-pad: 0.75rem;
  --pg-keyword: #c792ea;
  --pg-operator: #ff9cac;
  --pg-type: #82aaff;
  --pg-function: #ffcb6b;
  --pg-number: #f78c6c;
  --pg-variable: #eeffff;
  --pg-parameter: #f07178;
  --pg-property: #89ddff;
  --pg-string: #c3e88d;
  --pg-error: #ff5370;
  display: grid;
  gap: 0.75rem;
}

.pg-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem 0.75rem;
}

.pg-label {
  font-size: var(--sl-text-sm);
  color: var(--sl-color-gray-3);
}

.pg-starters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.pg-starters button {
  font: inherit;
  font-size: var(--sl-text-sm);
  padding: 0.25rem 0.75rem;
  border: 1px solid var(--sl-color-gray-5);
  border-radius: 999px;
  background: transparent;
  color: var(--sl-color-gray-2);
  cursor: pointer;
}

.pg-starters button[aria-pressed='true'] {
  border-color: var(--sl-color-text-accent);
  color: var(--sl-color-text-accent);
}

.pg-starters button:focus-visible,
.pg-where:focus-visible {
  outline: 2px solid var(--sl-color-text-accent);
  outline-offset: 2px;
}

.pg-editor {
  display: flex;
  border: 1px solid var(--sl-color-gray-5);
  border-radius: 6px;
  background: var(--sl-color-gray-6);
  overflow: hidden;
}

.pg-editor:focus-within {
  border-color: var(--sl-color-text-accent);
}

/* One rule for every layer that holds text, so the overlay cannot drift from the textarea. */
.pg-gutter,
.pg-layer,
.pg-editor textarea {
  margin: 0;
  font-family: var(--pg-font);
  font-size: var(--pg-size);
  line-height: var(--pg-line);
  letter-spacing: normal;
  tab-size: 2;
  white-space: pre;
  padding: var(--pg-pad);
  border: 0;
  box-sizing: border-box;
}

.pg-gutter {
  flex: none;
  overflow: hidden;
  min-width: 3rem;
  text-align: right;
  color: var(--sl-color-gray-4);
  background: transparent;
  border-right: 1px solid var(--sl-color-hairline);
  user-select: none;
  padding-bottom: calc(var(--pg-pad) + 1.5rem);
}

.pg-num {
  display: block;
  position: relative;
}

.pg-marked {
  color: var(--pg-error);
  font-weight: 700;
}

.pg-marked::before {
  content: '';
  position: absolute;
  left: -0.5rem;
  top: 50%;
  width: 0.375rem;
  height: 0.375rem;
  margin-top: -0.1875rem;
  border-radius: 50%;
  background: var(--pg-error);
}

.pg-text {
  position: relative;
  flex: 1;
  min-width: 0;
}

.pg-layer {
  position: absolute;
  inset: 0;
  overflow: hidden;
  color: var(--sl-color-white);
  background: transparent;
  pointer-events: none;
  /* Room to scroll as far as the textarea can, scrollbar included. */
  padding-bottom: calc(var(--pg-pad) + 1.5rem);
  padding-right: calc(var(--pg-pad) + 1.5rem);
}

.pg-line {
  display: block;
  /* An empty line has no text to give it a line box; without this it would collapse and every line
     below it would sit one line too high. */
  min-height: calc(var(--pg-line) * 1em);
}

.pg-editor textarea {
  position: relative;
  display: block;
  width: 100%;
  resize: vertical;
  overflow: auto;
  color: transparent;
  background: transparent;
  caret-color: var(--sl-color-white);
  outline: none;
}

.pg-editor textarea::selection {
  background: color-mix(in srgb, var(--sl-color-text-accent) 30%, transparent);
  color: transparent;
}

.tok-keyword { color: var(--pg-keyword); }
.tok-operator { color: var(--pg-operator); }
.tok-type { color: var(--pg-type); }
.tok-function { color: var(--pg-function); }
.tok-number { color: var(--pg-number); }
.tok-variable { color: var(--pg-variable); }
.tok-parameter { color: var(--pg-parameter); }
.tok-property { color: var(--pg-property); }
.tok-string { color: var(--pg-string); }

.pg-flagged {
  text-decoration: underline wavy var(--pg-error);
  text-decoration-skip-ink: none;
  text-underline-offset: 3px;
}

.pg-result {
  min-height: 2rem;
}

.pg-ok {
  margin: 0;
  color: var(--sl-color-text-accent);
  font-weight: 600;
}

.pg-diagnostics {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 0.5rem;
}

.pg-diagnostics li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.75rem;
}

.pg-code {
  font-family: var(--pg-font);
  font-size: var(--sl-text-sm);
  font-weight: 600;
  color: var(--pg-error);
}

.pg-message {
  flex: 1 1 16rem;
}

.pg-where {
  font: inherit;
  font-size: var(--sl-text-xs);
  padding: 0;
  border: 0;
  background: none;
  color: var(--sl-color-gray-3);
  text-decoration: underline dotted;
  cursor: pointer;
}

.pg-scope {
  font-size: var(--sl-text-sm);
  color: var(--sl-color-gray-2);
}

.pg-scope summary {
  cursor: pointer;
}

.pg-scope p {
  margin: 0.5rem 0 0;
}

.playground a {
  color: var(--sl-color-text-accent);
}

.pg-message :deep(code) {
  font-family: var(--pg-font);
  font-size: 0.9em;
  padding: 0.0625rem 0.25rem;
  border-radius: 3px;
  background: var(--sl-color-gray-6);
}

@media (prefers-reduced-motion: no-preference) {
  .pg-starters button {
    transition: border-color 120ms, color 120ms;
  }
}
</style>

<style>
/* The light palette. Unscoped on purpose: Vue compiles a scoped `:global(:root[…]) .playground` down
   to the `:global` part alone, so these landed on `:root` and the component's own dark values won. */
:root[data-theme='light'] .playground {
  --pg-keyword: #7c3aed;
  --pg-operator: #be185d;
  --pg-type: #1d4ed8;
  --pg-function: #92400e;
  --pg-number: #c2410c;
  --pg-variable: #1f2937;
  --pg-parameter: #b91c1c;
  --pg-property: #0e7490;
  --pg-string: #15803d;
  --pg-error: #dc2626;
}
</style>
