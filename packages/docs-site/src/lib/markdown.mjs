// `M269` (`D1440`, `D1441`) — what the site's pages ask of their markdown, on Starlight.
//
// The pages were written for VitePress, and five constructs in them are VitePress's rather than
// markdown's. They are rendered here rather than rewritten in 61 pages, because each one is also
// read by something other than the site: `gen-docs.mjs` turns the reference tables into
// `tflw docs` output, `published.test.mjs` and `doc-blocks.mjs` read `<Published>` and
// `@include` from the source, and the URL-parity gate holds every heading id to what VitePress
// gave it. Moving the site changed the renderer and nothing those readers see.
//
//  - `<!--@include: path-->` — a repo record (CHANGELOG.md, GRAMMAR.md) spliced in, path relative
//    to the page.
//  - `<Published>…</Published>` and `<Published :when="false">…</Published>` (`M253` `F`) — kept or
//    dropped by `PUBLISHED`, at build time, the way the Vue component did it at render time.
//  - `<script setup>` + `<table>` with a `v-for` row — the reference tables, parsed by the same
//    `parseScript`/`parseTable` that `gen-docs.mjs` uses for the terminal, and drawn from
//    `spec-data.ts` with the same `code()` the Vue pages called.
//  - `![…](…){.light-only}` — a class on a picture (`M233` `I`).
//  - `## Heading {#id}` — an explicit anchor.
//
// Two more things are VitePress's behaviour rather than its syntax, and both are about URLs:
//
//  - **Heading ids use VitePress's slug rule** (`@mdit-vue/shared`'s `slugify`, de-duplicated the
//    way `markdown-it-anchor` does it: `x`, `x-1`, `x-2`). Astro's own rule is `github-slugger`,
//    which differs on exactly the characters this site's headings are full of (an em-dash, `&`,
//    `.`, a leading digit), so every in-page link from README, the extension and the CLI would
//    have moved. The page's `# H1` is counted first, as VitePress counted it, and then removed:
//    Starlight draws the title itself.
//  - **A root-relative link gets the site's base.** VitePress prefixed `/tflw/` to `/guide/x`;
//    Astro leaves markdown links alone, so every internal link would 404 on GitHub Pages.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseScript, parseTable } from '../../../cli/scripts/gen-docs.mjs';
import * as SPEC from '../../../lang/src/spec-data.ts';
import { code } from './mdCode.ts';
import { PUBLISHED } from './published.ts';
import { vitepressSlug } from './slug.mjs';

const BASE = '/tflw';

// ---- helpers ------------------------------------------------------------------------------------

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Every node under `node`, depth first, with its parent. */
function* walk(node, parent = null) {
  yield [node, parent];
  for (const child of node.children ?? []) yield* walk(child, node);
}

/** `markdown-it-anchor`'s `getTokensText`: the text and inline code under a heading, not its HTML. */
function headingText(node) {
  let out = '';
  for (const [n] of walk(node)) if (n.type === 'text' || n.type === 'inlineCode') out += n.value;
  return out;
}

// ---- the reference tables -----------------------------------------------------------------------

function renderCell(col, row) {
  const v = row[col.key];
  if (col.form === 'markdown') return `<td>${code(v ?? '')}</td>`;
  if (col.form === 'code') return `<td><code>${escapeHtml(v ?? '')}</code></td>`;
  if (col.form === 'status') return `<td>${escapeHtml(v === col.when ? col.yes : col.no)}</td>`;
  return `<td>${escapeHtml(v ?? '')}</td>`;
}

/** A `parseTable` description → the table, drawn from the live manifest. */
export function renderTable({ table }) {
  const rows = (SPEC[table.source] ?? []).filter((r) => !table.where || r[table.where.key] === table.where.value);
  if (rows.length === 0) throw new Error(`a reference table over ${table.source} has no rows — the page would draw an empty table`);
  const head = table.cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('');
  const body = rows.map((r) => `<tr>${table.cols.map((c) => renderCell(c, r)).join('')}</tr>`).join('\n');
  return `<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
}

// ---- remark: the page constructs ----------------------------------------------------------------

const INCLUDE = /^<!--\s*@include:\s*(.+?)\s*-->$/;
const PUBLISHED_OPEN = /^<Published(\s+:when="(true|false)")?\s*>$/;

/** The constructs above, on one page's tree. `this` is the processor, so an included record is
 * parsed with every syntax extension the page itself is. */
export function remarkTflwPages() {
  const processor = this;
  return (tree, file) => {
    const page = file.path ?? file.history?.[0];

    // 1. Includes first, so what they bring is treated like the page's own text.
    tree.children = tree.children.flatMap((node) => {
      const m = node.type === 'html' ? INCLUDE.exec(node.value.trim()) : null;
      if (!m) return [node];
      if (!page) throw new Error(`@include: ${m[1]} in a page with no path`);
      const target = resolve(dirname(page), m[1]);
      return processor.parse(readFileSync(target, 'utf8')).children;
    });

    // 2. `<Published>` blocks: kept (the tags dropped) or removed whole.
    const kept = [];
    let open = null;
    for (const node of tree.children) {
      const value = node.type === 'html' ? node.value.trim() : '';
      const opening = PUBLISHED_OPEN.exec(value);
      if (opening) {
        if (open !== null) throw new Error(`${page}: a <Published> inside a <Published>`);
        open = { shown: PUBLISHED === (opening[2] !== 'false') };
        continue;
      }
      if (value === '</Published>') {
        if (open === null) throw new Error(`${page}: a </Published> that closes nothing`);
        open = null;
        continue;
      }
      if (open === null || open.shown) kept.push(node);
    }
    if (open !== null) throw new Error(`${page}: an unclosed <Published>`);
    tree.children = kept;

    // 3. `<script setup>` filters, then each `v-for` table drawn from them.
    let consts = {};
    tree.children = tree.children.flatMap((node) => {
      if (node.type !== 'html') return [node];
      const value = node.value.trim();
      if (value.startsWith('<script setup>')) {
        consts = { ...consts, ...parseScript(value) };
        return [];
      }
      if (value.startsWith('<table>') && value.includes('v-for=')) {
        return [{ type: 'html', value: renderTable(parseTable(value, consts)) }];
      }
      return [node];
    });

    // 4. Headings: an explicit `{#id}`, else VitePress's slug; the first `# H1` counted, then dropped.
    const seen = new Set();
    const unique = (slug, explicit) => {
      if (explicit && seen.has(slug)) throw new Error(`${page}: the heading id \`${slug}\` is not unique`);
      let id = slug;
      for (let i = 1; seen.has(id); i++) id = `${slug}-${i}`;
      seen.add(id);
      return id;
    };
    let title = null;
    for (const [node] of walk(tree)) {
      if (node.type !== 'heading') continue;
      const last = node.children.at(-1);
      let id = null;
      if (last?.type === 'text') {
        const m = /\s*\{#([\w-]+)\}\s*$/.exec(last.value);
        if (m) {
          last.value = last.value.slice(0, m.index);
          id = unique(m[1], true);
        }
      }
      id ??= unique(vitepressSlug(headingText(node)), false);
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id } };
      if (node.depth === 1 && title === null) title = node;
    }
    if (title !== null) tree.children = tree.children.filter((n) => n !== title);

    // 5. `{.class}` straight after a picture.
    for (const [node] of walk(tree)) {
      if (node.type !== 'paragraph') continue;
      node.children.forEach((child, i) => {
        const next = node.children[i + 1];
        if (child.type !== 'image' || next?.type !== 'text') return;
        const m = /^\{((?:\.[\w-]+\s*)+)\}/.exec(next.value);
        if (!m) return;
        const classes = m[1].trim().split(/\s+/).map((c) => c.slice(1));
        child.data = { ...child.data, hProperties: { ...child.data?.hProperties, className: classes } };
        next.value = next.value.slice(m[0].length);
      });
    }
  };
}

// ---- rehype: links and pictures -----------------------------------------------------------------

const MANIFEST = fileURLToPath(new URL('../../public/ui/manifest.json', import.meta.url));

/**
 * **A root-relative link or picture gets the base**, and **every `/ui/` shot carries the size it was
 * cut at** — `M234` `G` (`D1306`), moved here from VitePress's markdown-it image rule unchanged in
 * what it decides.
 *
 * 34 `<img>` in `/ui/` carried no `width`, so each section reflowed as its pictures arrived and the
 * text under them jumped. The numbers are the observed sizes `make-screenshots.mjs` reads back off
 * each PNG's IHDR and records in `manifest.json`, divided by `deviceScaleFactor`, because the file is
 * cut at 2x and the page lays it out in css pixels. **A shot the manifest does not name fails the
 * build**, by name. `loading="lazy"` on all but the first pair: a view ships as a light/dark pair
 * (`D1282`), so the first two images on a page are the one above the fold.
 */
export function rehypeTflwLinks() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const cut = new Map(manifest.shots.map((s) => [s.name, s]));
  const scale = manifest.deviceScaleFactor || 1;
  const based = (url) => (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') && !url.startsWith(`${BASE}/`) ? `${BASE}${url}` : url);
  return (tree) => {
    let shots = 0;
    for (const [node] of walk(tree)) {
      if (node.type !== 'element') continue;
      if (node.tagName === 'a') node.properties.href = based(node.properties.href);
      if (node.tagName !== 'img') continue;
      const src = node.properties.src;
      const named = /\/ui\/([A-Za-z0-9._-]+\.png)$/.exec(typeof src === 'string' ? src : '');
      node.properties.src = based(src);
      if (named === null) continue;
      const shot = cut.get(named[1]);
      if (shot === undefined) {
        throw new Error(`${named[1]} is embedded in the docs and is not in public/ui/manifest.json — run: node --import tsx packages/ui/scripts/make-screenshots.mjs (D1306)`);
      }
      node.properties.width = String(Math.round(shot.width / scale));
      node.properties.height = String(Math.round(shot.height / scale));
      shots += 1;
      if (shots > 2) {
        node.properties.loading = 'lazy';
        node.properties.decoding = 'async';
      }
    }
  };
}
