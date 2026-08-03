import { defineConfig } from 'vitepress';
import tflwGrammar from '../../vscode/syntaxes/tflw.tmLanguage.json' with { type: 'json' };

// Decision 16.3 (PLAN_ENTERPRISE.md): Home · Getting Started · Guide (12 sub-topics, 2 added for
// the browser arc — see PLAN.md decision 112) · Reference · Grammar · Changelog. `appearance` is
// intentionally left unset — VitePress's default (`true`)
// already shows a light/dark toggle that respects the reader's OS preference (decision 16.12);
// overriding it would be the wrong direction.
export default defineConfig({
  title: 'tflw',
  description: 'A testing DSL for API and browser tests — reports first, syntax second.',
  // Deployed to https://deepak-tuteja.github.io/tflw/ (a project subpath, not the domain root),
  // so asset/link URLs must be prefixed with /tflw/ or the built CSS/JS 404 on GitHub Pages.
  base: '/tflw/',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['**/README.md'],

  // PLAN_DOCS_SITE_UPDATE.md decision 6: no logo/mark existed anywhere in the repo before this —
  // a checkmark, the exact glyph tflw already prints on every passing test (`✓ health check`, see
  // getting-started.md's own sample), not an invented mark. Path is base-prefixed manually: head
  // tags aren't rewritten for a custom `base` the way markdown links are.
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/tflw/favicon.svg' }]],

  // Real syntax highlighting for ```tflw / ```tflw-config fences (M22, root test-coverage audit
  // follow-up) — reuses the same TextMate grammar the VS Code extension ships, so a code sample
  // colors identically to the editor rather than falling back to shiki's plain-text default for
  // an unregistered language.
  markdown: {
    languages: [{ ...(tflwGrammar as object), aliases: ['tflw-config'] }],
  },

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/first-test' },
      { text: 'Reference', link: '/reference/matchers' },
      { text: 'Grammar', link: '/grammar' },
      { text: 'Editor', link: '/editor' },
      { text: 'Playground', link: '/playground' },
      { text: "What's new", link: '/whats-new' },
      { text: 'Changelog', link: '/changelog' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting started',
          items: [{ text: 'Install & quickstart', link: '/getting-started' }],
        },
        {
          text: 'Guide',
          items: [
            { text: '1. Writing your first test', link: '/guide/first-test' },
            { text: '2. Config & environments', link: '/guide/config' },
            { text: '3. Sessions & auth', link: '/guide/sessions' },
            { text: '4. Assertions in depth', link: '/guide/assertions' },
            { text: '5. Variables, generators & expressions', link: '/guide/variables' },
            { text: '6. Actions, imports & the JS escape hatch', link: '/guide/actions' },
            { text: '7. Browser testing: interacting with a UI', link: '/guide/browser-basics' },
            { text: '8. Browser testing: advanced scenarios', link: '/guide/browser-advanced' },
            { text: '9. Data-driven tests & hooks', link: '/guide/data-and-hooks' },
            { text: '10. Retry, polling & flaky handling', link: '/guide/retry-and-polling' },
            { text: '11. CI, reporting & safety', link: '/guide/ci-and-reporting' },
            { text: '12. Running & debugging tests', link: '/guide/debugging' },
            { text: '13. Load testing: scenarios & thresholds', link: '/guide/load-testing' },
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
      // editor.md, playground/index.md, whats-new.md, changelog.md) — without this, those pages
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
            { text: "What's new", link: '/whats-new' },
            { text: 'Changelog', link: '/changelog' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/deepak-tuteja/tflw' }],

    search: { provider: 'local' },
  },
});
