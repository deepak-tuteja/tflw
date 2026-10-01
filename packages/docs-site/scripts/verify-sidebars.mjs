// Every page renders the sidebar it belongs to (M125e, `FU-30`).
//
// `getting-started.md` lives at `/getting-started`, not under `/guide/`, so it matched no sidebar
// key but the `/` fallback and rendered the *More* rail — Grammar, Playground, Changelog — on the
// page the home page's primary CTA points at. The entrance to the guide showed everything except
// the guide.
//
// Checked against the **built** HTML, not against `config.ts`. The bug was invisible in the config
// — every key there is correct in isolation — and only appears once VitePress resolves a path
// against them. A check that read the config would be asking the wrong question in the same words.
//
// Deliberately a small allowlist rather than a general rule. "Which rail should this page show" is
// an editorial decision per page, and the only mechanical version of it would re-implement
// VitePress's longest-prefix resolution here — which is what shipped the bug.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.TFLW_DOCS_ROOT ?? fileURLToPath(new URL('..', import.meta.url));
const DIST = process.env.TFLW_DOCS_DIST ?? join(ROOT, '.vitepress/dist');

/** `page` → the sidebar group heading it must show, and the one it must not.
 *
 * `M149b` regrouped the rail by pillar and the heading `Guide` ceased to exist, so two of these
 * three rows named a string no page could render any more. They fail loudly rather than quietly —
 * `shows` went false, which is a failure, not a pass — and that failure was the demonstrated break
 * for the regrouping. Re-pointed at `Start here`, the group `getting-started` and `first-test` both
 * now belong to.
 *
 * Both halves of each row still matter, and the `hides` half is the load-bearing one: `shows` alone
 * would pass against a config that rendered every group on every page, which is the failure mode
 * a rail with five groups makes easier to reach than one with two.
 */
const EXPECTED = [
  // The funnel page. `Start here` present is `FU-30`'s fix; `More` absent is the proof it is not
  // merely showing both rails stacked.
  { page: 'getting-started.html', shows: 'Start here', hides: 'More' },
  // A page that was already correct, so a change that gave every page the guide rail fails here.
  // Unaffected by the regrouping: the `/` fallback rail is the one thing `M149b` did not touch.
  { page: 'grammar.html', shows: 'More', hides: 'Start here' },
  // The step the funnel page leads into — unchanged by `FU-30`, and the reference point its
  // markup was compared against when the bug was measured.
  { page: 'guide/first-test.html', shows: 'Start here', hides: 'More' },
  // The UI's own surface. `The UI` present is the `/ui/` key resolving; `More` absent is the proof
  // it beat the `/` fallback rather than stacking beside it — which is the failure the `hides`
  // half exists for, and the one a fifth rail makes easier to reach than a fourth did.
  //
  // **Three rows, and the third is a kind page.** The section grew from five pages to nine, and
  // the four kind pages are the ones a reader is most likely to arrive at from a search result
  // rather than from the index — so one of them is checked, not only the two that were here when
  // the rail had a single level.
  { page: 'ui/index.html', shows: 'The UI', hides: 'More' },
  { page: 'ui/kinds.html', shows: 'The UI', hides: 'More' },
  { page: 'ui/load.html', shows: 'The UI', hides: 'More' },
  // The adopter's runbook (`M253` `A`, `D1350`): its index and a page added with it.
  { page: 'runbook/index.html', shows: 'Runbook', hides: 'More' },
  { page: 'runbook/troubleshoot.html', shows: 'Runbook', hides: 'More' },
];

/** Each pillar overview is reachable from the rail, and it is the group's own title that reaches it.
 *
 * `D654`/`M149c`. An overview page nothing links to is the failure `FU-30` above is about, arrived
 * at from the other direction: there the rail was wrong, here the rail would be silently missing an
 * entry. Three pages are one config key away from being reachable only by the pager.
 *
 * Asserted against the built HTML for the same reason the rows above are: whether a sidebar group
 * carrying both `link` and `items` renders its title as an anchor at all is VitePress's decision,
 * not the config's. It does in 1.6.4 — `<a class="link" href="…"><h2 class="text">…</h2></a>` — and
 * a major upgrade that changed it would leave a config that still reads correctly.
 *
 * The href is matched by suffix, including the closing quote, so the check does not hardcode
 * `base` and `/guide/security"` cannot be satisfied by `/guide/security-scanning"`.
 */
const PILLAR_OVERVIEWS = [
  { page: 'guide/assertions.html', link: '/guide/functional', group: 'Functional testing' },
  { page: 'guide/load-testing.html', link: '/guide/performance', group: 'Performance testing' },
  // Both halves of `D655`'s split, not just the one that kept the URL. A new page added to an
  // existing group is exactly the edit that silently lands in the wrong rail, and the pre-split
  // row could not have caught it.
  { page: 'guide/load-results.html', link: '/guide/performance', group: 'Performance testing' },
  // A bare `&`, not `&amp;`: VitePress renders a sidebar label through `v-html`, so the config's
  // text reaches the HTML unescaped. Written `&amp;` first, and the demonstrated break for the row
  // above caught it — this row failed while nothing was wrong with the rail.
  { page: 'guide/crawling.html', link: '/guide/security', group: 'Security & vulnerability testing' },
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

for (const { page, link, group } of PILLAR_OVERVIEWS) {
  let html;
  try {
    html = await readFile(join(DIST, page), 'utf8');
  } catch {
    console.error(`✗ ${page} — not found in ${DIST}. Run \`npm run build -w @tflw/docs-site\` first.`);
    failures++;
    continue;
  }
  const sidebar = sidebarOf(html);
  const at = sidebar.indexOf(`${link}"`);
  if (at === -1) {
    console.error(`✗ ${page} — the rail has no link to the ${group} overview (${link})`);
    failures++;
  } else if (!sidebar.slice(at, at + 300).includes(`>${group}<`)) {
    // The link exists but something other than the group title carries it — an overview demoted to
    // an ordinary item beside the chapters it introduces, which is the other way `D654` can be
    // lost without breaking a link.
    console.error(`✗ ${page} — ${link} is in the rail, but not as the "${group}" group title`);
    failures++;
  } else {
    console.log(`✓ ${page} — ${group} → ${link}`);
  }
}

// `M253` `A`: every page in `runbook/` is in the runbook's rail. A section assembled one page per
// milestone is exactly where a page lands on disk and never in the sidebar — reachable only from a
// search result, which is the failure `FU-30` above describes from the reader's side. Read off the
// directory, so a new page is asked about the day it is written.
{
  const pages = (await readdir(join(ROOT, 'runbook'))).filter((f) => f.endsWith('.md') && f !== 'index.md').map((f) => f.replace(/\.md$/, ''));
  let rail = '';
  try {
    rail = sidebarOf(await readFile(join(DIST, 'runbook/index.html'), 'utf8'));
  } catch {
    // reported by the EXPECTED row above
  }
  const missing = pages.filter((p) => !rail.includes(`/runbook/${p}.html"`) && !rail.includes(`/runbook/${p}"`));
  if (pages.length === 0 || missing.length > 0) {
    console.error(`✗ runbook/ — ${missing.length > 0 ? `not in the rail: ${missing.join(', ')}` : 'no pages found'}`);
    failures++;
  } else {
    console.log(`✓ runbook/ — all ${pages.length} pages are in the rail`);
  }
}

// `M260` (`D1418`): the walkthrough's chapters are in the rail **in chapter order**. Both halves are
// read from somewhere other than `walkthrough.mjs`, which the rail is drawn from and which would
// agree with itself: the pages from the directory, and each one's number from its own `# N. Title`.
// A chapter left out of the order, or listed out of it, reddens here before a reader meets a
// "chapter 4" that sends them on to chapter 6.
{
  const dir = join(ROOT, 'runbook', 'start');
  const chapters = [];
  for (const f of (await readdir(dir)).filter((x) => x.endsWith('.md'))) {
    const number = /^# (\d+)\. /m.exec(await readFile(join(dir, f), 'utf8'))?.[1];
    if (number === undefined) {
      console.error(`✗ runbook/start/${f} — its title is not "# N. …", so its place in the walkthrough is unstated`);
      failures++;
      continue;
    }
    chapters.push({ page: f.replace(/\.md$/, ''), number: Number(number) });
  }
  let rail = '';
  try {
    rail = sidebarOf(await readFile(join(DIST, 'runbook/start/install.html'), 'utf8'));
  } catch {
    // no page to read the rail from — the missing list below says so
  }
  const at = (page) => [rail.indexOf(`/runbook/start/${page}.html"`), rail.indexOf(`/runbook/start/${page}"`)].filter((i) => i !== -1)[0] ?? -1;
  const placed = chapters.map((c) => ({ ...c, at: at(c.page) }));
  const missing = placed.filter((c) => c.at === -1).map((c) => c.page);
  const railOrder = placed.filter((c) => c.at !== -1).sort((a, b) => a.at - b.at);
  const outOfOrder = railOrder.filter((c, i) => i > 0 && c.number <= railOrder[i - 1].number).map((c) => `${c.number} after ${railOrder[railOrder.indexOf(c) - 1].number}`);
  if (chapters.length === 0 || missing.length > 0 || outOfOrder.length > 0) {
    console.error(`✗ runbook/start/ — ${chapters.length === 0 ? 'no chapters found' : missing.length > 0 ? `not in the rail: ${missing.join(', ')}` : `out of chapter order in the rail: ${outOfOrder.join(', ')}`}`);
    failures++;
  } else {
    console.log(`✓ runbook/start/ — all ${chapters.length} chapters are in the rail, in chapter order (${railOrder.map((c) => c.number).join(', ')})`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} sidebar assertion(s) failed.`);
  process.exit(1);
}
console.log(
  `\n${EXPECTED.length}/${EXPECTED.length} pages render the sidebar they belong to; ` +
    `${PILLAR_OVERVIEWS.length}/${PILLAR_OVERVIEWS.length} pillar overviews are reachable from it.`,
);
