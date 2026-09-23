import { readFileSync } from 'node:fs';
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
    // `D1307` — foldable, open by default.
    collapsed: false,
    text: 'Start here',
    items: [
      { text: 'Install & quickstart', link: '/getting-started' },
      { text: 'Writing your first test', link: '/guide/first-test' },
      { text: 'Config & environments', link: '/guide/config' },
      { text: 'Sessions & auth', link: '/guide/sessions' },
    ],
  },
  {
    // `D1307` — foldable, open by default.
    collapsed: false,
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
    // `D1307` — foldable, open by default.
    collapsed: false,
    // `D655` split the one 434-line page at the workload/threshold seam: the first chapter is how
    // you generate load, the second is how you judge it. The labels are each page's own H1 — the
    // rail promising workloads and delivering thresholds too was the reason the pre-split label
    // could not be renamed ahead of the split.
    text: 'Performance testing',
    link: '/guide/performance',
    items: [
      { text: 'Load testing: workloads & scenarios', link: '/guide/load-testing' },
      { text: 'Thresholds, results & validation', link: '/guide/load-results' },
    ],
  },
  {
    // `D1307` — foldable, open by default.
    collapsed: false,
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
    // `D1307` — foldable, open by default.
    collapsed: false,
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
    /**
     * **Every `/ui/` shot carries the size it was cut at** — `M234` `G` (`D1306`).
     *
     * 34 `<img>` in `/ui/` carried no `width`, so each section reflowed as its pictures arrived and
     * the text under them jumped. The numbers are not guessed and not read from the page: they are
     * the observed sizes `make-screenshots.mjs` reads back off each PNG's IHDR and records in
     * `manifest.json` (`M234` `E`). Divided by `deviceScaleFactor`, because the file is cut at 2x
     * and the page lays it out in css pixels.
     *
     * **A shot the manifest does not name fails the build**, loudly, by name. Without that this
     * rule quietly stops applying the first time a view is added — which is the failure mode the
     * rule exists to prevent, one level up: a picture whose dimensions nobody stamped looks exactly
     * like a picture whose dimensions nobody needed.
     *
     * `loading="lazy"` on all but the first pair. A view ships as a light/dark pair (`D1282`), so
     * the first two images on a page are the one above the fold and everything after them is not.
     * That is a proxy for "below the fold" rather than a measurement of it — markdown-it has no
     * layout — and it is stated here rather than implied by the number 2.
     */
    config(md) {
      const manifest = JSON.parse(readFileSync(new URL('../public/ui/manifest.json', import.meta.url), 'utf8')) as {
        shots: { name: string; width: number; height: number }[];
        deviceScaleFactor: number;
      };
      const cut = new Map(manifest.shots.map((s) => [s.name, s]));
      const scale = manifest.deviceScaleFactor || 1;
      const fallback = md.renderer.rules.image;
      md.renderer.rules.image = (tokens, idx, options, env, self) => {
        const token = tokens[idx]!;
        const named = /\/ui\/([A-Za-z0-9._-]+\.png)$/.exec(token.attrGet('src') ?? '');
        if (named !== null) {
          const shot = cut.get(named[1]!);
          if (shot === undefined) {
            throw new Error(
              `${named[1]} is embedded in the docs and is not in public/ui/manifest.json — ` +
                'run: node --import tsx packages/ui/scripts/make-screenshots.mjs (D1306)',
            );
          }
          token.attrSet('width', String(Math.round(shot.width / scale)));
          token.attrSet('height', String(Math.round(shot.height / scale)));
          const seen = ((env.__uiShots as number | undefined) ?? 0) + 1;
          env.__uiShots = seen;
          if (seen > 2) {
            token.attrSet('loading', 'lazy');
            token.attrSet('decoding', 'async');
          }
        }
        return fallback === undefined ? self.renderToken(tokens, idx, options) : fallback(tokens, idx, options, env, self);
      };
    },
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
      // `tflw ui` is a surface, not a chapter — this nav names surfaces, which is why Editor and
      // Playground are here and `Assertions` is not. An authoring environment the size of the
      // language, filed under a sub-bullet of a guide chapter, would be the navigation asserting
      // something false.
      //
      // **Named `The UI` here and `the page` inside it** (`M233` `I`, `D1293`). "The page" is the
      // term `D1042`-`D1045` argue in and it stays the section's own voice; it fails *here*,
      // where a reader scanning `Guide · Reference · Grammar · Editor · The page · Playground`
      // has nothing telling them one of those is an application. Second in the nav rather than
      // fifth, because it is a peer of the Guide and 80.7% of this site being prose about the
      // language was the whole of the complaint that moved it.
      { text: 'The UI', link: '/ui/' },
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
      // The UI's own rail, in the order a reader meets the surface: what it is, the shape every
      // surface shares, then one page per door, then reading a run and what it will not do.
      //
      // **The four doors are four pages, not one** (`D1294`). They were one page with one
      // screenshot, and the screenshot was cut at a door its caption did not name. The doors are
      // the axis this UI is organised on, and a reader who wants the LOAD door does not want the
      // other three first.
      '/ui/': [
        {
          text: 'The UI',
          link: '/ui/',
          items: [
            { text: 'The spine', link: '/ui/spine' },
            { text: 'The four doors', link: '/ui/doors' },
            { text: 'The API door', link: '/ui/api' },
            { text: 'The BROWSER door', link: '/ui/browser' },
            { text: 'The LOAD door', link: '/ui/load' },
            { text: 'The SCANS door', link: '/ui/scans' },
            { text: 'Reading a run', link: '/ui/a-run' },
            { text: 'What it will not do', link: '/ui/limits' },
          ],
        },
      ],
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
