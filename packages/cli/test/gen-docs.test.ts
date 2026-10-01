// `M263`: `tflw docs` prints the docs site's Guide and Reference pages, rendered by
// `scripts/gen-docs.mjs`. The renderer is closed over the constructs those pages use, so each one is
// asserted here against a small fixture, each refusal is asserted to refuse, and the real sidebar is
// asserted to list exactly the real pages.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain .mjs script, no type declarations
import { SITE, buildPages, parseSidebar, parseTable, renderLinks, renderPage, slugify } from '../scripts/gen-docs.mjs';

const DOCS = fileURLToPath(new URL('../../docs-site/', import.meta.url));
const CONFIG = readFileSync(`${DOCS}.vitepress/config.ts`, 'utf8');
const TOPICS = new Set(['sessions', 'cli', 'variables']);

const render = (md: string) => renderPage(md, TOPICS, 'fixture.md');
const allText = (page: { intro: unknown[]; sections: { title: string; body: unknown[] }[] }): string =>
  [...page.intro, ...page.sections.flatMap((s) => [s.title, ...s.body])].filter((s) => typeof s === 'string').join('\n');

const SIDEBAR = `
const GUIDE_SIDEBAR = [
  {
    collapsed: false,
    text: 'Start here',
    items: [
      { text: 'Install & quickstart', link: '/getting-started' },
      { text: 'Sessions & auth', link: '/guide/sessions' },
    ],
  },
  {
    text: 'Functional testing',
    link: '/guide/functional',
    items: [
      { text: 'Patterns: what to write instead of an \`if\`', link: '/guide/patterns' },
    ],
  },
];
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'CLI flags', link: '/reference/cli' },
          ],
        },
      ],
`;

test('the sidebar is read in order, with each group overview first and pages outside guide/reference left out', () => {
  assert.deepEqual(parseSidebar(SIDEBAR), [
    { group: 'Start here', pages: [{ slug: 'sessions', dir: 'guide', text: 'Sessions & auth', overview: false }] },
    {
      group: 'Functional testing',
      pages: [
        { slug: 'functional', dir: 'guide', text: 'Functional testing', overview: true },
        { slug: 'patterns', dir: 'guide', text: 'Patterns: what to write instead of an `if`', overview: false },
      ],
    },
    { group: 'Reference', pages: [{ slug: 'cli', dir: 'reference', text: 'CLI flags', overview: false }] },
  ]);
});

test('frontmatter and <script setup> are not printed; the # title is the title and each ## a section', () => {
  const page = render('---\ntitle: X\n---\n\n<script setup>\nconst a = 1;\n</script>\n\n# The page\n\nIntro text.\n\n## `unique` vs. `random` {#uvr}\n\nBody.\n');
  assert.equal(page.title, 'The page');
  assert.deepEqual(page.intro, ['Intro text.']);
  assert.deepEqual(page.sections, [{ slug: 'unique-vs-random', title: '`unique` vs. `random`', body: ['Body.'] }]);
  assert.doesNotMatch(allText(page), /title: X|const a|\{#uvr\}/);
});

test('a code fence loses its fence lines and info string and is indented; nothing inside it is rewritten', () => {
  const page = render('# P\n\n```tflw fragment\ntest "x"\n  open "[a](/guide/sessions)"\n```\n');
  assert.equal(page.intro[0], '    test "x"\n      open "[a](/guide/sessions)"');
});

test('a ::: tip or warning prints its kind and title and indents its body; the closing ::: is gone', () => {
  const page = render('# P\n\n::: tip Before you start\nRead [this](/guide/sessions).\n:::\n\n::: warning\nCareful.\n:::\n');
  assert.equal(page.intro[0], 'Tip: Before you start\n  Read this (tflw docs sessions).\n\nWarning:\n  Careful.');
});

test('links: a printed page is a `tflw docs` command, a site page is its URL, an anchor is its text, the web is itself', () => {
  assert.equal(renderLinks('see [Sessions](/guide/sessions#csrf)', TOPICS), 'see Sessions (tflw docs sessions)');
  assert.equal(renderLinks('see [flags](../reference/cli)', TOPICS), 'see flags (tflw docs cli)');
  assert.equal(renderLinks('see [the page](/ui/spine)', TOPICS), `see the page (${SITE}/ui/spine)`);
  assert.equal(renderLinks('see [below](#later)', TOPICS), 'see below');
  assert.equal(renderLinks('see [k6](https://k6.io)', TOPICS), 'see k6 (https://k6.io)');
});

test('a link whose text wraps onto the next line is still rendered', () => {
  const page = render('# P\n\nRead [Sessions\nand auth](/guide/sessions) first.\n');
  assert.equal(page.intro[0], 'Read Sessions\nand auth (tflw docs sessions) first.');
});

test('a reference table becomes a description of its rows, resolved through the page\'s own filter', () => {
  const consts = { runFlags: { source: 'CLI_FLAGS', where: { key: 'command', value: 'run' } } };
  const html = `<table>
  <thead><tr><th>Flag</th><th>Effect</th></tr></thead>
  <tbody>
    <tr v-for="f in runFlags" :key="f.flag">
      <td v-html="code(f.flag)" />
      <td v-html="code(f.effect)" />
    </tr>
  </tbody>
</table>`;
  assert.deepEqual(parseTable(html, consts), {
    table: { source: 'CLI_FLAGS', where: { key: 'command', value: 'run' }, cols: [{ label: 'Flag', key: 'flag' }, { label: 'Effect', key: 'effect' }] },
  });
  const status = parseTable(`<table><thead><tr><th>M</th><th>S</th></tr></thead><tbody>
    <tr v-for="m in MATCHERS" :key="m.id">
      <td><code>{{ m.syntax }}</code></td>
      <td>{{ m.status === 'shipped' ? '✅' : '🔮' }}</td>
    </tr></tbody></table>`, {});
  assert.deepEqual(status.table.cols[1], { label: 'S', key: 'status', when: 'shipped', yes: '✅', no: '🔮' });
});

test('every construct the renderer does not know is refused, not printed', () => {
  const refusals: [string, RegExp][] = [
    ['# P\n\n::: details\nx\n:::\n', /::: details container/],
    ['# P\n\n![a picture](/x.png)\n', /a picture/],
    ['# P\n\n<Published>\nx\n</Published>\n', /Vue component/],
    ['# P\n\n```sh\nnpm test\n', /unclosed code fence/],
    ['# P\n\n::: tip\nx\n', /unclosed ::: container/],
    ['No title at all.\n', /no # title/],
    ['# P\n\n<table><tr v-for="r in ROWS"><td>{{ r.x }}</td></tr></table>\n'.replace('<table>', '<table>\n').replace('</table>', '\n</table>'), /neither a manifest nor a filter/],
  ];
  for (const [md, why] of refusals) assert.throws(() => render(md), why, md);
  assert.throws(
    () => parseTable('<table><tr v-for="f in MATCHERS"><td v-html="f.syntax"/></tr></table>', {}),
    /a table cell tflw docs cannot render/,
  );
});

test('slugify drops backticks and punctuation', () => {
  assert.equal(slugify('`tflw run`'), 'tflw-run');
  assert.equal(slugify('Retry, polling & flaky handling'), 'retry-polling-flaky-handling');
});

test('the real sidebar lists every Guide and Reference page exactly once, in the site\'s order', () => {
  const pages = buildPages(DOCS, CONFIG);
  const slugs = pages.map((p: { slug: string }) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.equal(slugs[0], 'first-test');
  assert.deepEqual(slugs.slice(-4), ['matchers', 'generators', 'cli', 'diagnostics']);
  const onDisk = ['guide', 'reference'].flatMap((d) => readdirSync(`${DOCS}${d}`).filter((f) => f.endsWith('.md')));
  assert.equal(pages.length, onDisk.length);
});
