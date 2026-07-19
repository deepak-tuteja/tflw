#!/usr/bin/env node
// Regenerates SPEC.md's matcher table (section 6.2) and generators quick-reference table (section
// 7, new) from `src/spec-data.ts` - the canonical structured manifest (PLAN decision 103,
// enterprise arc cluster 4, decision 16.4). SPEC.md's own hand-written table used to be the
// source of truth; this reverses the direction so it can never silently drift from what
// `packages/docs-site`'s Reference pages and a later LSP's hover text actually show. Marker
// comments (`<!-- GENERATED:<name>:start/end -->`) bound the regenerated region; everything
// outside them (intro prose, section headings) is untouched.
//
// `renderMatcherTable`/`renderGeneratorTable` are exported (pure, string-in/string-out) so a test
// can exercise them against small fixture arrays instead of the real manifest - same reasoning
// `gen-docs.mjs`'s `parseSpecToTopics` test already uses. The file's own top-level code only runs
// the read/write side when invoked directly, not when imported.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MATCHERS, GENERATORS } from '../src/spec-data.ts';

/** @param {import('../src/spec-data.js').MatcherEntry[]} matchers */
export function renderMatcherTable(matchers) {
  const header = '| Matcher | Applies to | Example |\n|---|---|---|';
  const rows = matchers.map((m) => `| ${m.syntax} | ${m.appliesTo} | ${m.example} |`);
  return [header, ...rows].join('\n');
}

/** @param {import('../src/spec-data.js').GeneratorEntry[]} generators */
export function renderGeneratorTable(generators) {
  const header = '| Family | Generator | Notes | Example |\n|---|---|---|---|';
  const rows = generators.map((g) => `| ${g.family} | ${g.syntax} | ${g.notes} | ${g.example} |`);
  return [header, ...rows].join('\n');
}

function replaceMarkerRegion(text, name, replacement) {
  const start = `<!-- GENERATED:${name}:start -->`;
  const end = `<!-- GENERATED:${name}:end -->`;
  const startIdx = text.indexOf(start);
  const endIdx = text.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(`gen-spec-tables: couldn't find marker pair "${name}" in SPEC.md`);
  }
  const before = text.slice(0, startIdx + start.length);
  const after = text.slice(endIdx);
  return `${before}\n${replacement}\n${after}`;
}

function main() {
  const specPath = fileURLToPath(new URL('../../../SPEC.md', import.meta.url));
  let text = readFileSync(specPath, 'utf8');
  text = replaceMarkerRegion(text, 'matchers', renderMatcherTable(MATCHERS));
  text = replaceMarkerRegion(text, 'generators', renderGeneratorTable(GENERATORS));
  writeFileSync(specPath, text, 'utf8');
  console.log(`gen-spec-tables: wrote ${MATCHERS.length} matcher rows + ${GENERATORS.length} generator rows to SPEC.md`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
