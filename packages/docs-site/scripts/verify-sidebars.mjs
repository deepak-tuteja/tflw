// Every page renders the sidebar it belongs to (M125e, `FU-30`).
//
// `getting-started.md` lives at `/getting-started`, not under `/guide/`, so it matched no sidebar
// key but the `/` fallback and rendered the *More* rail — Grammar, Playground, Changelog — on the
// page the home page's primary CTA points at. The entrance to a thirteen-step guide showed
// everything except the guide.
//
// Checked against the **built** HTML, not against `config.ts`. The bug was invisible in the config
// — every key there is correct in isolation — and only appears once VitePress resolves a path
// against them. A check that read the config would be asking the wrong question in the same words.
//
// Deliberately a small allowlist rather than a general rule. "Which rail should this page show" is
// an editorial decision per page, and the only mechanical version of it would re-implement
// VitePress's longest-prefix resolution here — which is what shipped the bug.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.TFLW_DOCS_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const DIST = process.env.TFLW_DOCS_DIST ?? join(ROOT, '.vitepress/dist');

/** `page` → the sidebar group heading it must show, and the one it must not. */
const EXPECTED = [
  // The funnel page. Both halves matter: `Guide` present is the fix, `More` absent is the proof it
  // is not merely showing both rails stacked.
  { page: 'getting-started.html', shows: 'Guide', hides: 'More' },
  // A page that was already correct, so a change that gave every page the guide rail fails here.
  { page: 'grammar.html', shows: 'More', hides: 'Guide' },
  // The step the funnel page leads into — unchanged by `FU-30`, and the reference point its
  // markup was compared against when the bug was measured.
  { page: 'guide/first-test.html', shows: 'Guide', hides: 'More' },
];

/**
 * The rendered `<aside class="VPSidebar">` alone.
 *
 * Counting `>Guide<` across the whole page is how the bug was first *measured* (`getting-started`
 * had one occurrence, `guide/first-test` two — the difference being the nav's own copy), but it is
 * the wrong thing to *assert*: it only works for a heading the nav also names, and `More` is not in
 * the nav, so a page-wide count reports the correct page as broken. Read the region the claim is
 * actually about.
 */
function sidebarOf(html) {
  const start = html.indexOf('<aside class="VPSidebar"');
  if (start === -1) return '';
  const end = html.indexOf('</aside>', start);
  return html.slice(start, end === -1 ? undefined : end);
}

let failures = 0;
for (const { page, shows, hides } of EXPECTED) {
  let html;
  try {
    html = await readFile(join(DIST, page), 'utf8');
  } catch {
    console.error(`✗ ${page} — not found in ${DIST}. Run \`npm run build -w @tflw/docs-site\` first.`);
    failures++;
    continue;
  }
  const sidebar = sidebarOf(html);
  if (!sidebar) {
    console.error(`✗ ${page} — renders no sidebar at all`);
    failures++;
    continue;
  }
  const shown = sidebar.includes(`>${shows}<`);
  const hidden = sidebar.includes(`>${hides}<`);
  if (shown && !hidden) {
    console.log(`✓ ${page} — ${shows} rail`);
  } else {
    console.error(`✗ ${page} — expected the ${shows} rail, not ${hides} (${shows}: ${shown}, ${hides}: ${hidden})`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} page(s) render the wrong sidebar.`);
  process.exit(1);
}
console.log(`\n${EXPECTED.length}/${EXPECTED.length} pages render the sidebar they belong to.`);
