// `M270` (`D-M270-2`) — the Grammar page: what you can write first, the formal grammar folded.
//
// `grammar.md` includes `packages/lang/GRAMMAR.md`, and until `M270` it rendered all 815 lines of it:
// thirty lines of the file's own history first, then eleven EBNF blocks a reader had to parse to find
// out what may follow `expect`. The record is still the source, and every production in it is still
// published; what changes is the order a reader meets them in. Each `##` section of the record opens
// with a few lines of real `tflw` (`src/grammar/<key>.tflw`; the config dialect's is
// `src/grammar/config/tflw.config`, apart, so it is no glance file's project config), one per form
// you can write, and the section's productions and rules follow in a fold.
//
// The pairing is by heading and it is closed in both directions: a section of the record with no
// entry here fails the build, and so does an entry that matches no section, so the glance cannot
// fall behind the record without somebody being told. `grammar.test.mjs` parses every glance and
// holds them to the parser's keyword set, the one `grammarCoverage.test.ts` holds the record to.
//
// What is not published is the record's preamble — its history ("current through M78", the
// freshening notes), which describes the file rather than the language. Its "Notation:" paragraph is
// kept, because the folded blocks cannot be read without it, and the id its `#` title had stays on
// the page so a link to it still lands.

import { readFileSync } from 'node:fs';
import { vitepressSlug } from './slug.mjs';

/** Each section of `GRAMMAR.md`, by the start of its `##` heading: the name the page shows, its glance,
 *  and how the glance is checked. */
export const GLANCES = [
  { heading: 'Lexical', title: 'Lexical', key: 'lexical', wrap: 'file' },
  { heading: 'Program structure', title: 'Program structure', key: 'program', wrap: 'file' },
  { heading: 'Tests & structure', title: 'Tests', key: 'tests', wrap: 'file' },
  { heading: 'Crawl', title: 'Crawl', key: 'crawl', wrap: 'file' },
  { heading: 'Load testing', title: 'Load testing', key: 'load', wrap: 'file' },
  { heading: 'API steps', title: 'API steps', key: 'api', wrap: 'file' },
  { heading: 'Assertions', title: 'Assertions', key: 'assertions', wrap: 'file' },
  { heading: 'Variables, data & expressions', title: 'Variables, data & expressions', key: 'variables', wrap: 'file' },
  { heading: 'Actions, imports', title: 'Actions, imports & JS helpers', key: 'actions', wrap: 'file' },
  { heading: 'UI / browser steps', title: 'Browser steps', key: 'browser', wrap: 'file' },
  { heading: 'The config dialect', title: 'The config dialect', key: 'config', file: 'config/tflw.config', wrap: 'config' },
  // Every diagnostic has its own entry, with the snippet that triggers it, on the reference page.
  { heading: 'Diagnostics', title: 'Diagnostics', key: null, pointer: '/reference/diagnostics' },
];

/**
 * A glance's text, as it is published. Every glance is a whole file a reader could paste — a `.tflw`
 * file, or a `tflw.config` — because the repository's `.tflw` corpus (`scripts/tflw-corpus.mjs`)
 * walks this directory too, and an editor opening a fragment would show it as broken.
 */
export const glance = (key) => {
  const entry = GLANCES.find((g) => g.key === key);
  return readFileSync(new URL(`../grammar/${entry?.file ?? `${key}.tflw`}`, import.meta.url), 'utf8').replace(/\n+$/, '');
};

/** The words of a heading, as the record wrote them. */
const words = (node) => (node.children ?? []).map((c) => c.value ?? words(c)).join('');

const html = (value) => ({ type: 'html', value });

/**
 * The record's nodes → the page's: the preamble cut to its notation paragraph, each section opened
 * by its glance with the record's own content folded under it. `record` names the file in errors.
 */
export function grammarPage(nodes, record = 'GRAMMAR.md') {
  const first = nodes.findIndex((n) => n.type === 'heading' && n.depth === 2);
  if (first === -1) throw new Error(`${record}: no \`##\` section to publish`);
  const preamble = nodes.slice(0, first);
  const notation = preamble.find((n) => n.type === 'paragraph' && /^Notation:/.test(words(n)));
  if (notation === undefined) throw new Error(`${record}: the preamble has no "Notation:" paragraph, and the folded productions cannot be read without one`);
  const title = preamble.find((n) => n.type === 'heading' && n.depth === 1);

  // The id the record's `#` title had (`testflow-grammar`), kept for links that already point at it.
  if (title !== undefined) notation.data = { ...notation.data, hProperties: { id: vitepressSlug(words(title)) } };
  const out = [notation];

  const used = new Set();
  let i = first;
  while (i < nodes.length) {
    const head = nodes[i];
    let end = i + 1;
    while (end < nodes.length && !(nodes[end].type === 'heading' && nodes[end].depth <= 2)) end++;
    const text = words(head);
    const entry = GLANCES.find((g) => text.startsWith(g.heading));
    if (entry === undefined) throw new Error(`${record}: the section "${text}" has no glance in src/lib/grammar.mjs — add one, so the Grammar page opens it with what a reader can write`);
    used.add(entry);
    // The record's heading carries its provenance (`Crawl — Tier 4's active crawl (SPEC §9.15,
    // M137c)`), which the rail would list verbatim; the page shows the section's name and keeps the
    // id the record's words gave it, so a link to the section still lands.
    out.push({ ...head, children: [{ type: 'text', value: entry.title }], data: { ...head.data, hProperties: { id: vitepressSlug(text) } } });
    if (entry.key !== null) {
      out.push(entry.wrap === 'config' ? { type: 'code', lang: 'tflw-config', meta: 'title="tflw.config"', value: glance(entry.key) } : { type: 'code', lang: 'tflw', meta: null, value: glance(entry.key) });
    } else {
      out.push(html(`<p>Every code, with the snippet that triggers it and what tflw prints: <a href="${entry.pointer}">Diagnostic codes</a>.</p>`));
    }
    out.push(html('<details class="tflw-formal">\n<summary>The formal grammar</summary>'), ...nodes.slice(i + 1, end), html('</details>'));
    i = end;
  }
  const unused = GLANCES.filter((g) => !used.has(g));
  if (unused.length > 0) throw new Error(`${record}: no section starts with ${unused.map((g) => `"${g.heading}"`).join(', ')} — the glance has outlived its section`);
  return out;
}
