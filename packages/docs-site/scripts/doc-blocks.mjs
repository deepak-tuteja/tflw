// Fenced-block census for the docs site (M62, review finding OBS-01).
//
// One scanner, shared by `verify-samples.mjs` and its own tests. Its job is to make *silence
// impossible*: every fenced block in every page comes back classified, including the ones nothing
// can check, so the guard can report what it did not cover instead of omitting it.
//
// The old extractor recognised two tags and dropped everything else on the floor without counting
// it — 31 of 89 blocks checked behind a line reading `31/31 … parse cleanly`. See PLAN_DOC_TRUTH.md.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Fence tags whose contents are `.tflw` source, keyed to how a sample is made checkable. */
export const TFLW_LANGS = new Set(['tflw', 'tflw-config']);

/**
 * Tags declaring a block that no guard here can verify, and *why* it can't — the reason is the
 * point. `console` is a claim about what the tool prints (verifiable only by running it against a
 * live fixture; a follow-on milestone, not smuggled into this one); `text` is notation, not code.
 */
export const DECLARED_UNCHECKED = new Map([
  ['console', 'output the tool prints — verifying it means running the tool'],
  ['text', 'metasyntax, notation, or a file tree — not source'],
  ['sh', 'shell invocation — `tflw …` commands are checked against CLI_FLAGS'],
  ['ts', 'TypeScript helper source for the JS escape hatch'],
  ['json', 'a JSON artifact the tool reads or writes'],
  ['yaml', 'CI configuration'],
  ['xml', 'a junit.xml artifact'],
  ['csv', 'a data-table fixture'],
]);

export function findMarkdownFiles(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules' || name === '.vitepress' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) findMarkdownFiles(path, out);
    else if (name.endsWith('.md')) out.push(path);
  }
  return out;
}

/**
 * Every fenced block in one markdown document, with its 1-based opening-fence line.
 *
 * Handles what the old `^```(\w*)$` regex did not: an indented fence (inside a list item), a fence
 * opened with more than three backticks to contain one with three, and an info string carrying
 * directives after the language (`tflw fragment binds=orderId`). A block left unclosed at EOF is
 * returned with `unterminated: true` rather than silently swallowing the rest of the file.
 */
export function extractBlocks(text) {
  const lines = text.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const open = /^(\s*)(`{3,})(.*)$/.exec(lines[i]);
    if (!open) {
      i++;
      continue;
    }
    const [, indent, ticks, infoRaw] = open;
    const startLine = i + 1;
    const body = [];
    let closed = false;
    i++;
    while (i < lines.length) {
      const close = new RegExp(`^\\s*\`{${ticks.length},}\\s*$`).exec(lines[i]);
      if (close) {
        closed = true;
        i++;
        break;
      }
      body.push(lines[i].startsWith(indent) ? lines[i].slice(indent.length) : lines[i]);
      i++;
    }
    blocks.push({ ...parseInfoString(infoRaw), startLine, source: body.join('\n'), unterminated: !closed });
  }
  return blocks;
}

/**
 * `tflw fragment binds=orderId,email` → `{ lang: 'tflw', directives: {fragment: true, binds: [...]} }`.
 *
 * The taxonomy lives in the info string (DT-02) rather than an HTML comment above the block, so the
 * declaration travels with the fence in every diff — and Shiki keys highlighting off the first word
 * alone, so a `tflw fragment` block still highlights as `tflw`.
 */
export function parseInfoString(infoRaw) {
  const words = infoRaw.trim().split(/\s+/).filter(Boolean);
  const lang = words.shift() ?? '';
  const directives = {};
  for (const word of words) {
    const eq = word.indexOf('=');
    if (eq === -1) directives[word] = true;
    else directives[word.slice(0, eq)] = word.slice(eq + 1).split(',').filter(Boolean);
  }
  return { lang, directives };
}

/**
 * Assign one category to a block. `unclassified` is a hard failure, not a skip (DT-01): a new page
 * with an unlabelled sample must break the build, which is exactly what the old extractor's silent
 * `continue` prevented.
 */
export function classify(block) {
  if (block.unterminated) return { kind: 'unclassified', why: 'unterminated fence — no closing ```' };
  if (block.lang === 'tflw') {
    return block.directives.fragment
      ? { kind: 'fragment', binds: block.directives.binds === true ? [] : (block.directives.binds ?? []) }
      : { kind: 'file' };
  }
  if (block.lang === 'tflw-config') return block.directives.fragment ? { kind: 'config-fragment' } : { kind: 'config' };
  if (DECLARED_UNCHECKED.has(block.lang)) return { kind: 'declared', why: DECLARED_UNCHECKED.get(block.lang) };
  return {
    kind: 'unclassified',
    why: block.lang === '' ? 'untagged fence — every block must declare what it is' : `unknown fence tag \`${block.lang}\``,
  };
}

/** Every classified block under `root`, flattened, each carrying `file`/`startLine` for reporting. */
export function census(root) {
  const out = [];
  for (const file of findMarkdownFiles(root)) {
    for (const block of extractBlocks(readFileSync(file, 'utf8'))) {
      out.push({ ...block, ...classify(block), file: relative(root, file) });
    }
  }
  return out;
}
