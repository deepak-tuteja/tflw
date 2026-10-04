// Every URL the docs site has published still resolves — `M269` (`D1441`).
//
// The site moved from VitePress to Starlight, and README, CHANGELOG, the extension, the CLI and its
// diagnostics all link into it — to pages, and to headings on them. A generator swap that renamed
// `ui/index.html` to `ui.html`, or gave a heading Astro's slug instead of VitePress's, would have
// broken those links with every page still rendering. So the last VitePress build was recorded —
// every page it wrote and every heading id on each — in `fixtures/published-urls.json`, and this
// gate holds the built site to it:
//
//  - the set of pages is **exactly** the recorded set: a page lost breaks every link to it, and a
//    page added has to be recorded on purpose (`--write`), so the record keeps meaning "published";
//  - every recorded id is still an id on its page. An id can be added freely; one that disappears
//    is a heading a link may point at, renamed or deleted, and has to be released on purpose.
//
// It reads `dist/`, so it needs `npm run build -w @tflw/docs-site` first.
//
// Usage:  node scripts/verify-url-parity.mjs              check the build against the record
//         node scripts/verify-url-parity.mjs --write      re-record from the build (an intended change)
//         node scripts/verify-url-parity.mjs --self-test  the controls

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = process.env.TFLW_DOCS_DIST ?? fileURLToPath(new URL('../dist', import.meta.url));
const RECORD = fileURLToPath(new URL('fixtures/published-urls.json', import.meta.url));
// Starlight's own ids for its title and its table of contents, which no published link targets.
const THEME_IDS = new Set(['_top', 'starlight__on-this-page', 'starlight__on-this-page--mobile']);

/** Every `.html` under `dir`, relative and `/`-separated, skipping the build's asset directories. */
export function builtPages(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name !== '_astro' && e.name !== 'pagefind') walk(join(d, e.name));
      } else if (e.name.endsWith('.html')) out.push(relative(dir, join(d, e.name)).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

/** Every element id on a page. */
export const idsOf = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));

/** The ids a link can target: every heading's, plus the title's legacy id (`PageTitle.astro`). */
export function headingIds(html) {
  const ids = [...html.matchAll(/<h[1-6][^>]*\sid="([^"]+)"/g)].map((m) => m[1]);
  const title = /<h1[^>]*\sid="_top"[^>]*><span id="([^"]+)"/.exec(html);
  if (title) ids.unshift(title[1]);
  return ids.filter((id) => !THEME_IDS.has(id));
}

/** Every problem, as a sentence. `site` is `{ page: html }`; `record` is `{ page: [ids] }`. */
export function judge(record, site) {
  const problems = [];
  const built = Object.keys(site);
  if (built.length === 0) return ['the build has no pages — run `npm run build -w @tflw/docs-site` first'];
  for (const page of Object.keys(record)) {
    if (!(page in site)) {
      problems.push(`${page} is published and the build no longer writes it — every link to it would 404`);
      continue;
    }
    const ids = idsOf(site[page]);
    for (const id of record[page]) {
      if (!ids.has(id)) problems.push(`${page}#${id} is published and the page has no such id — a link to that heading would land at the top`);
    }
  }
  for (const page of built) {
    if (!(page in record)) problems.push(`${page} is built and not in the record — if it is meant to be published, record it with --write`);
  }
  return problems;
}

function readSite(dir) {
  if (!existsSync(dir)) return {};
  return Object.fromEntries(builtPages(dir).map((p) => [p, readFileSync(join(dir, p), 'utf8')]));
}

function run() {
  const record = JSON.parse(readFileSync(RECORD, 'utf8'));
  const site = readSite(DIST);
  if (process.argv.includes('--write')) {
    const pages = Object.fromEntries(Object.keys(site).map((p) => [p, headingIds(site[p])]));
    writeFileSync(RECORD, JSON.stringify({ ...record, pages }, null, 1) + '\n');
    console.log(`recorded ${Object.keys(pages).length} pages and ${Object.values(pages).flat().length} heading ids.`);
    return 0;
  }
  const problems = judge(record.pages, site);
  if (problems.length > 0) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error(`\n${problems.length} published URL${problems.length === 1 ? '' : 's'} broken.`);
    return 1;
  }
  const ids = Object.values(record.pages).flat().length;
  console.log(`✓ every published URL resolves — ${Object.keys(record.pages).length} pages, ${ids} heading ids.`);
  return 0;
}

// ---------------------------------------------------------------------------------------------------

function selfTest() {
  const record = { 'index.html': [], 'guide/a.html': ['intro', 'evidence-levels-—-how-much'], 'ui/index.html': ['the-ui'] };
  const page = (...ids) => `<html>${ids.map((id) => `<h2 id="${id}">x</h2>`).join('')}</html>`;
  const site = () => ({
    'index.html': page(),
    'guide/a.html': page('intro', 'evidence-levels-—-how-much'),
    'ui/index.html': `<h1 id="_top"><span id="the-ui"></span>The UI</h1>`,
  });
  const cases = [
    ['the recorded site passes', () => judge(record, site()).length === 0],
    ['a page the build stopped writing fails', () => {
      const s = site();
      delete s['ui/index.html'];
      s['ui.html'] = '';
      return judge(record, s).length === 2;
    }],
    ['a page built and not recorded fails', () => judge(record, { ...site(), 'guide/b.html': page() }).length === 1],
    ['a recorded heading id that is gone fails', () => judge(record, { ...site(), 'guide/a.html': page('intro', 'evidence-levels-how-much') }).length === 1],
    ['a new heading id passes', () => judge(record, { ...site(), 'guide/a.html': page('intro', 'evidence-levels-—-how-much', 'new') }).length === 0],
    ['an empty build fails as checking nothing', () => judge(record, {}).length === 1],
    ['the title\'s legacy id is recorded, and Starlight\'s own ids are not', () =>
      JSON.stringify(headingIds('<h1 id="_top"><span id="the-ui"></span>T</h1><h2 id="starlight__on-this-page">O</h2><h2 id="a">A</h2>')) === '["the-ui","a"]'],
  ];
  let bad = 0;
  for (const [name, fn] of cases) {
    let ok = false;
    try {
      ok = fn();
    } catch (e) {
      console.error(`    threw: ${e.message}`);
    }
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
    if (!ok) bad++;
  }
  console.log(bad === 0 ? `\n✓ ${cases.length} controls pass.` : `\n✗ ${bad} of ${cases.length} controls failed.`);
  return bad === 0 ? 0 : 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : run());
}
