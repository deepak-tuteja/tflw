// `M269` (`D1440`–`D1443`) — the docs site on Astro Starlight.
//
// VitePress 1.x is pinned to vite 5, which carries advisories with no fix in that line, and
// VitePress 2 has been an alpha for over a year. Starlight runs on the vite major `packages/ui`
// already uses. What moved is the generator; the pages, their URLs and their anchors did not
// (`D1441`): `src/lib/markdown.mjs` renders the constructs the pages were written in, and
// `scripts/verify-url-parity.mjs` holds the built page set and every heading id to the record of
// the last VitePress build.
import { mkdirSync, readdirSync, renameSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import vue from '@astrojs/vue';
import tflwGrammar from '../vscode/syntaxes/tflw.tmLanguage.json' with { type: 'json' };
import { rehypeTflwLinks, remarkTflwPages } from './src/lib/markdown.mjs';
import { starlightSidebar } from './src/lib/navigation.mjs';

const PAGES = fileURLToPath(new URL('./src/content/docs/', import.meta.url));

/** Every directory under the pages that holds an `index.md`/`index.mdx`, the root's excluded. */
function indexDirs(dir = PAGES, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) indexDirs(join(dir, e.name), out);
    else if (/^index\.mdx?$/.test(e.name) && dir !== PAGES) out.push(relative(PAGES, dir).split('\\').join('/'));
  }
  return out;
}

/**
 * `D1441`: an index page ships at `<dir>/index.html`, where VitePress put it. `build.format:
 * 'preserve'` writes `ui/index.md` as `ui.html`, because Starlight routes the page by its slug
 * (`ui`), not its file. GitHub Pages serves `/tflw/ui/` from `ui/index.html` and nothing else, so
 * the three section front pages — `/ui/`, `/runbook/` and `/playground/` — move after the build.
 * Listed before Starlight so it runs before Pagefind indexes what the build wrote.
 */
function indexPagesInPlace() {
  return {
    name: 'tflw:index-pages-in-place',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const out = fileURLToPath(dir);
        for (const d of indexDirs()) {
          mkdirSync(join(out, d), { recursive: true });
          renameSync(join(out, `${d}.html`), join(out, d, 'index.html'));
        }
      },
    },
  };
}

export default defineConfig({
  // Deployed to https://deepak-tuteja.github.io/tflw/ (a project subpath, not the domain root).
  site: 'https://deepak-tuteja.github.io',
  base: '/tflw/',
  // `D1441`: `guide/x.md` is served as `guide/x.html` and `ui/index.md` as `ui/index.html` — the
  // files VitePress's `cleanUrls` build wrote, which GitHub Pages serves at `/tflw/guide/x` and
  // `/tflw/ui/`. `preserve` mirrors the source tree, which is that shape exactly.
  build: { format: 'preserve' },
  trailingSlash: 'ignore',

  markdown: {
    // The unified (remark/rehype) pipeline rather than Astro 7's default, because the page
    // constructs above are remark plugins. `smartypants` off: VitePress never curled a quote or
    // turned `--` into a dash, and a flag's spelling is the one thing a CLI page must not retype.
    processor: unified({
      smartypants: false,
      remarkPlugins: [remarkTflwPages],
      rehypePlugins: [rehypeTflwLinks],
    }),
  },

  integrations: [
    indexPagesInPlace(),
    starlight({
      title: 'tflw',
      description: 'A testing DSL for API and browser tests — reports first, syntax second.',
      // The brand mark (`npm run brand` owns the path data; edit the script, never these files).
      // `replacesTitle`: the wordmark already spells the name, and rendering both says it twice.
      logo: { light: './public/logo-light.svg', dark: './public/logo-dark.svg', replacesTitle: true },
      favicon: '/favicon.svg',
      // `favicon.svg` carries its own `prefers-color-scheme`, because a browser tab cannot see the
      // site's theme. The PNGs are a raster fallback for clients that ignore SVG favicons.
      head: [
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/tflw/favicon-32.png' } },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/tflw/favicon-16.png' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/tflw/apple-touch-icon.png' } },
      ],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/deepak-tuteja/tflw' }],
      lastUpdated: true,
      sidebar: starlightSidebar(),
      routeMiddleware: './src/route-data.ts',
      customCss: ['./src/styles/custom.css'],
      components: {
        Hero: './src/components/Hero.astro',
        MarkdownContent: './src/components/MarkdownContent.astro',
        PageTitle: './src/components/PageTitle.astro',
        SocialIcons: './src/components/HeaderNav.astro',
      },
      // `tflw` and `tflw-config` fences are highlighted by the grammar the VS Code extension ships,
      // so a sample colours here the way it does in the editor (M22).
      expressiveCode: {
        themes: ['github-dark', 'github-light'],
        shiki: { langs: [{ ...tflwGrammar, aliases: ['tflw-config'] }] },
      },
    }),
    // `D1442`: the playground and the six editor demos stay Vue, as islands.
    vue(),
  ],
});
