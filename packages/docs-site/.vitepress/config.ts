import { defineConfig } from 'vitepress';
import tflwGrammar from '../../vscode/syntaxes/tflw.tmLanguage.json' with { type: 'json' };

// The top nav is Home · Guide · Reference · Grammar · Editor · Playground · Changelog. `appearance`
// is intentionally left unset — VitePress's default (`true`) already shows a light/dark toggle that
// respects the reader's OS preference; overriding it would be the wrong direction.
//
// The nav names *surfaces*, not chapters. The guide's own shape lives in `GUIDE_SIDEBAR` below,
// which is the only place the reading order is written down.

/** The guide rail, hoisted to a `const` so the two sidebar keys that need it (`/guide/` and
 * `/getting-started`, `M125e`/`FU-30`) name one array instead of holding two copies of it.
 *
 * Grouped by pillar (`M149b`/`D649`/`D650`), not numbered. Two properties here are deliberate and
 * are the kind that get undone by accident:
 *
 *  - **Every URL stays flat.** A pillar is a sidebar group, never a path segment —
 *    `/guide/assertions` does not become `/guide/functional/assertions`. Grouping delivers the whole
 *    navigational benefit at zero link breakage, and nesting would charge every external link to
 *    eighteen pages, forever, to fix a left rail. That is the trade `M125e`/`D282` already made for
 *    `getting-started.md` and rejected, and nothing about it is weaker for eighteen pages.
 *  - **No label carries a number.** A number in a heading is a fact that goes wrong on every
 *    insertion: nine chapters were added to this guide after the old numbering was set, and the
 *    browser arc's two insertions renumbered eight pages. Sequence is carried by the order of this
 *    array and nowhere else, so a page can be inserted without renaming its neighbours.
 *
 * Browser testing sits under *Functional*, not in a pillar of its own: a browser test is a
 * functional test whose subject is a UI, and the site's thesis is that the two share one grammar.
 * Giving UI its own top-level pillar would argue the opposite in the navigation.
 */
const GUIDE_SIDEBAR = [
  {
    text: 'Start here',
    items: [
      { text: 'Install & quickstart', link: '/getting-started' },
      { text: 'Writing your first test', link: '/guide/first-test' },
      { text: 'Config & environments', link: '/guide/config' },
      { text: 'Sessions & auth', link: '/guide/sessions' },
    ],
  },
  {
    // `D654`. A pillar's overview is the group's own `text` link, not a first item inside it. The
    // two renderings differ in what they say about the page: an item is a sibling of the chapters,
    // a linked group title is the thing the chapters are under — which is what an overview is.
    text: 'Functional testing',
    link: '/guide/functional',
    items: [
      { text: 'Assertions in depth', link: '/guide/assertions' },
      { text: 'Variables, generators & expressions', link: '/guide/variables' },
      { text: 'Data-driven tests & hooks', link: '/guide/data-and-hooks' },
      { text: 'Retry, polling & flaky handling', link: '/guide/retry-and-polling' },
      // "JS/TS", matching the page's own H1. The sidebar said "JS escape hatch" and the H1 said
      // "JS/TS escape hatch" for eleven milestones — two names for one thing, which is the drift
      // `D650` exists to remove rather than carry through a rename.
      { text: 'Actions, imports & the JS/TS escape hatch', link: '/guide/actions' },
      { text: 'Browser testing: interacting with a UI', link: '/guide/browser-basics' },
      { text: 'Browser testing: advanced scenarios', link: '/guide/browser-advanced' },
    ],
  },
  {
    // One entry until `D655` splits the page at the workload/threshold seam. The label is the
    // page's current title rather than the post-split "Workloads & scenarios": a rail that
    // promised workloads and delivered thresholds too would be this milestone shipping a false
    // claim in the act of removing four of them.
    text: 'Performance testing',
    link: '/guide/performance',
    items: [{ text: 'Load testing: scenarios & thresholds', link: '/guide/load-testing' }],
  },
  {
    // Findings & baselines goes last, not first: it is the machinery for what you do with what the
    // four scans find, and it reads as procedure before there is anything to apply it to.
    text: 'Security & vulnerability testing',
    link: '/guide/security',
    items: [
      { text: 'Hygiene scanning', link: '/guide/security-scanning' },
      { text: 'Authorization testing', link: '/guide/authorization-testing' },
      { text: 'Input-handling testing', link: '/guide/input-handling' },
      { text: 'Crawling an undocumented surface', link: '/guide/crawling' },
      { text: 'Findings, baselines & the gate', link: '/guide/findings-and-baselines' },
    ],
  },
  {
    text: 'Running & reporting',
    items: [
      { text: 'Running & debugging tests', link: '/guide/debugging' },
      { text: 'CI, reporting & safety', link: '/guide/ci-and-reporting' },
    ],
  },
];

export default defineConfig({
  title: 'tflw',
  description: 'A testing DSL for API and browser tests — reports first, syntax second.',
  // Deployed to https://deepak-tuteja.github.io/tflw/ (a project subpath, not the domain root),
  // so asset/link URLs must be prefixed with /tflw/ or the built CSS/JS 404 on GitHub Pages.
  base: '/tflw/',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['**/README.md'],

  // The brand mark (PLAN_BRAND_MARK.md) — supersedes the placeholder checkmark that
  // PLAN_DOCS_SITE_UPDATE.md decision 6 shipped as a stand-in. Every file below is generated by
  // `npm run brand`, which owns the path data; edit the script, never these outputs.
  //
  // `favicon.svg` carries its own `@media (prefers-color-scheme: dark)` because a browser tab
  // can't see this site's theme toggle — only the OS preference. The PNGs are a raster fallback
  // for the handful of clients that still ignore SVG favicons. Paths are base-prefixed by hand:
  // head tags aren't rewritten for a custom `base` the way markdown links are.
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/tflw/favicon.svg' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/tflw/favicon-32.png' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/tflw/favicon-16.png' }],
    ['link', { rel: 'apple-touch-icon', href: '/tflw/apple-touch-icon.png' }],
  ],

  // Real syntax highlighting for ```tflw / ```tflw-config fences (M22, root test-coverage audit
  // follow-up) — reuses the same TextMate grammar the VS Code extension ships, so a code sample
  // colors identically to the editor rather than falling back to shiki's plain-text default for
  // an unregistered language.
  markdown: {
    languages: [{ ...(tflwGrammar as object), aliases: ['tflw-config'] }],
  },

  themeConfig: {
    // Two files rather than one self-switching SVG: VitePress's dark mode is a manual class flip
    // on <html>, which a `prefers-color-scheme` query inside the file can't see. `siteTitle: false`
    // drops the text "tflw" beside it — the wordmark already spells the name, and rendering both
    // says it twice. `title` above still drives the document <title>.
    //
    // NOT base-prefixed, unlike the `head` links above — themeConfig paths *are* rewritten for
    // `base`, so writing `/tflw/logo-light.svg` here yields `/tflw/tflw/logo-light.svg` and 404s.
    logo: { light: '/logo-light.svg', dark: '/logo-dark.svg' },
    siteTitle: false,

    nav: [
      { text: 'Guide', link: '/guide/first-test' },
      { text: 'Reference', link: '/reference/matchers' },
      { text: 'Grammar', link: '/grammar' },
      { text: 'Editor', link: '/editor' },
      { text: 'Playground', link: '/playground' },
      { text: 'Changelog', link: '/changelog' },
    ],

    sidebar: {
      // `M125e`/`FU-30`/D282. `getting-started.md` lives at `/getting-started`, not under
      // `/guide/`, so before this it matched no key but the `/` fallback and the page the home
      // page's primary CTA points at rendered the *More* rail — Grammar, Playground, Changelog —
      // instead of the guide it is the entrance to.
      //
      // Two keys naming ONE array, not two copies. VitePress resolves the longest matching path
      // prefix, so `/getting-started` beats `/` with no effect on any other page. Moving the file
      // under `guide/` was the other repair and was rejected: it changes a published URL that the
      // home CTA, the README and the npm page all point at, to fix a left rail.
      '/guide/': GUIDE_SIDEBAR,
      '/getting-started': GUIDE_SIDEBAR,
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Matchers', link: '/reference/matchers' },
            { text: 'Generators', link: '/reference/generators' },
            { text: 'CLI flags', link: '/reference/cli' },
            { text: 'Diagnostic codes', link: '/reference/diagnostics' },
          ],
        },
      ],
      // Fallback for every standalone page with no more-specific key above (grammar.md,
      // editor.md, playground/index.md, changelog.md) — without this, those pages
      // render with no left sidebar at all (`hasSidebar` false), which reads as inconsistent
      // chrome next to guide/reference's sidebar + "On this page" two-column layout. VitePress
      // resolves the longest matching path prefix, so this never overrides the more specific keys
      // above.
      '/': [
        {
          text: 'More',
          items: [
            { text: 'Grammar', link: '/grammar' },
            { text: 'Editor support', link: '/editor' },
            { text: 'Playground', link: '/playground' },
            { text: 'Changelog', link: '/changelog' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/deepak-tuteja/tflw' }],

    search: { provider: 'local' },
  },
});
