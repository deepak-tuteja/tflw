// Verifies every ```tflw / ```tflw-config fenced code block in packages/docs-site/**/*.md is a
// real, currently-parseable sample — not stale prose that's drifted from the language it's
// documenting. Runs the exact same lex→parse(→check) pipeline the CLI/checker use (M22, root
// test-coverage audit follow-up). Exits non-zero and prints every offending block on failure.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseSource, parseConfigSource } from '@tflw/lang';

const root = new URL('..', import.meta.url).pathname;

function findMarkdownFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.vitepress' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) findMarkdownFiles(path, out);
    else if (name.endsWith('.md')) out.push(path);
  }
  return out;
}

/** Extracts fenced code blocks tagged `tflw` or `tflw-config`, with their 1-based start line. */
function extractSamples(text) {
  const lines = text.split('\n');
  const samples = [];
  let i = 0;
  while (i < lines.length) {
    const match = /^```([a-zA-Z0-9_-]*)$/.exec(lines[i].trim());
    if (!match) {
      i++;
      continue;
    }
    const tag = match[1];
    const startLine = i + 1;
    i++;
    const body = [];
    while (i < lines.length && lines[i].trim() !== '```') {
      body.push(lines[i]);
      i++;
    }
    i++; // consume closing fence
    if (tag === 'tflw' || tag === 'tflw-config') {
      samples.push({ tag, startLine, source: body.join('\n') });
    }
  }
  return samples;
}

let checked = 0;
let failed = 0;

for (const file of findMarkdownFiles(root)) {
  const text = readFileSync(file, 'utf8');
  for (const sample of extractSamples(text)) {
    checked++;
    const result = sample.tag === 'tflw' ? parseSource(sample.source) : parseConfigSource(sample.source);
    if (result.diagnostics.length === 0) continue;
    failed++;
    console.error(`\n✗ ${relative(root, file)}:${sample.startLine} (\`\`\`${sample.tag})`);
    for (const d of result.diagnostics) {
      console.error(`  ${d.span.start.line}:${d.span.start.column} ${d.message}`);
    }
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${checked} docs-site \`.tflw\` sample(s) failed to parse cleanly.`);
  process.exit(1);
}

console.log(`${checked}/${checked} docs-site \`.tflw\` samples parse cleanly.`);
