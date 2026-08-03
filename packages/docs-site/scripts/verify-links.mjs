// Every internal anchor link on the docs site resolves to a real heading (M62, DT-07).
//
// M65 shipped three broken ones. VitePress keeps the em-dash when it generates a heading id —
// `## Evidence levels — how much lands in the report` becomes `#evidence-levels-—-how-much-…` —
// and two new links assumed it was stripped, while a renamed heading stale-ified a third. A broken
// anchor lands the reader at the top of a long page with no error and no clue, which is why this
// is a doc-truth check and not a nicety.
//
// Ids come from the **built** HTML rather than a slugifier reimplemented here. Guessing how
// VitePress slugifies is the exact mistake being guarded against — a local copy of that rule would
// have had the same em-dash bug, and agreed with itself.

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Both overridable so this script's own tests can run it against a fixture site (see DT-08).
const ROOT = process.env.TFLW_DOCS_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const DIST = process.env.TFLW_DOCS_DIST ?? join(ROOT, '.vitepress/dist');
const BASE = '/tflw'; // config.ts `base` — raw <a href> in markdown carries it, `](/…)` links don't.

async function walk(dir, keep, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === 'node_modules' || e.name === 'assets' || e.name.startsWith('.')) continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) await walk(path, keep, out);
    else if (keep(e.name)) out.push(path);
  }
  return out;
}

const pages = await walk(DIST, (n) => n.endsWith('.html'));
if (pages.length === 0) {
  console.error(
    `error: no built site at ${relative(process.cwd(), DIST)}.\n` +
      '       Run `npm run build -w @tflw/docs-site` first — this check reads heading ids out of\n' +
      '       the generated HTML, so it cannot run against the markdown alone.',
  );
  process.exit(1);
}

/** route ('/guide/config') → the set of element ids on that page. */
const ids = new Map();
for (const page of pages) {
  const route = '/' + relative(DIST, page).replace(/\.html$/, '').replace(/\/?index$/, '');
  const html = await readFile(page, 'utf8');
  ids.set(route === '/' ? '/' : route, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
}

const problems = [];
const sources = await walk(ROOT, (n) => n.endsWith('.md'));

for (const source of sources) {
  const rel = relative(ROOT, source);
  const lines = (await readFile(source, 'utf8')).split('\n');
  const self = '/' + rel.replace(/\.md$/, '').replace(/\/?index$/, '');
  for (let i = 0; i < lines.length; i++) {
    const links = [
      // Markdown links: `](/guide/x#frag)` and same-page `](#frag)`.
      ...[...lines[i].matchAll(/\]\((\/[^)\s]*#[^)\s]+|#[^)\s]+)\)/g)].map((m) => m[1]),
      // Raw anchors (index.md's feature cards) spell the `/tflw/` base out.
      ...[...lines[i].matchAll(/href="([^"]*#[^"]+)"/g)].map((m) => m[1]),
    ];
    for (const link of links) {
      if (/^(https?:)?\/\//.test(link)) continue;
      const withoutBase = link.startsWith(`${BASE}/`) ? link.slice(BASE.length) : link;
      const [path, fragment] = withoutBase.startsWith('#') ? [self, withoutBase.slice(1)] : withoutBase.split('#');
      const route = path === '' || path === '/' ? '/' : path.replace(/\/$/, '');
      const page = ids.get(route);
      if (page === undefined) problems.push(`${rel}:${i + 1}  ${link} — no such page (route ${route})`);
      else if (!page.has(decodeURIComponent(fragment))) problems.push(`${rel}:${i + 1}  ${link} — page has no heading with id \`${decodeURIComponent(fragment)}\``);
    }
  }
}

const total = [...ids.values()].reduce((n, s) => n + s.size, 0);
if (problems.length > 0) {
  for (const p of problems) console.error(`✗ ${p}`);
  console.error(`\n${problems.length} broken internal anchor${problems.length === 1 ? '' : 's'} across ${sources.length} pages.`);
  process.exit(1);
}
console.log(`every internal anchor resolves — ${sources.length} pages, ${total} heading ids.`);
