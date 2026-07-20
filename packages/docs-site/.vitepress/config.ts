import { defineConfig } from 'vitepress';

// Decision 16.3 (PLAN_ENTERPRISE.md): Home · Getting Started · Guide (9 sub-topics) · Reference ·
// Grammar · Changelog. `appearance` is intentionally left unset — VitePress's default (`true`)
// already shows a light/dark toggle that respects the reader's OS preference (decision 16.12);
// overriding it would be the wrong direction.
export default defineConfig({
  title: 'tflw',
  description: 'A testing-only DSL for API tests — reports first, syntax second.',
  // Deployed to https://deepak-tuteja.github.io/tflw/ (a project subpath, not the domain root),
  // so asset/link URLs must be prefixed with /tflw/ or the built CSS/JS 404 on GitHub Pages.
  base: '/tflw/',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['**/README.md'],

  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/first-test' },
      { text: 'Reference', link: '/reference/matchers' },
      { text: 'Grammar', link: '/grammar' },
      { text: 'Editor', link: '/editor' },
      { text: 'Playground', link: '/playground' },
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
            { text: '7. Data-driven tests & hooks', link: '/guide/data-and-hooks' },
            { text: '8. Retry, polling & flaky handling', link: '/guide/retry-and-polling' },
            { text: '9. CI, reporting & safety', link: '/guide/ci-and-reporting' },
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
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/deepak-tuteja/tflw' }],

    search: { provider: 'local' },
  },
});
