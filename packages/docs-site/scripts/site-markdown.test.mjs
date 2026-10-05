// `M269` — the markdown the pages were written in, rendered on Starlight (`src/lib/markdown.mjs`),
// and the navigation and titles around it (`src/lib/navigation.mjs`, `src/lib/title.mjs`).
//
// The built site is graded by `verify-url-parity.mjs`, `verify-links.mjs` and `verify-sidebars.mjs`,
// which read `dist/`. Those say the output is right *today*; these say which construct produces
// which output, through the same unified pipeline Astro runs, so a change to one rule reddens a
// named case rather than a page count. Each construct is asserted in both directions where it has
// two: a `<Published>` block kept and one dropped, a known screenshot sized and an unknown one
// refused, an explicit anchor and a derived one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { MATCHERS } from '@tflw/lang';
import { rehypeTflwLinks, remarkTflwPages } from '../src/lib/markdown.mjs';
import { sectionFor, starlightSidebar } from '../src/lib/navigation.mjs';
import { vitepressSlug } from '../src/lib/slug.mjs';
import { firstH1, titleFrom } from '../src/lib/title.mjs';

const processor = await createMarkdownProcessor({
  remarkPlugins: [remarkTflwPages],
  rehypePlugins: [rehypeTflwLinks],
  smartypants: false,
  syntaxHighlight: false,
});
const render = async (md, path = join(tmpdir(), 'page.md')) => (await processor.render(md, { fileURL: pathToFileURL(path) })).code;

test('an @include splices the record in, parsed like the page, relative to the page', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tflw-include-'));
  try {
    writeFileSync(join(dir, 'RECORD.md'), '## From the record\n\n| a | b |\n| - | - |\n| 1 | 2 |\n');
    const html = await render('# Page\n\n<!--@include: ./RECORD.md-->\n', join(dir, 'page.md'));
    assert.match(html, /<h2 id="from-the-record">From the record<\/h2>/);
    assert.match(html, /<table>/, 'the record is parsed with GFM, like the page itself');
    assert.doesNotMatch(html, /@include/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('<Published :when="false"> is kept before 1.0 and <Published> is dropped, tags and all', async () => {
  const html = await render('# P\n\n<Published :when="false">\n\nNot on npm yet.\n\n</Published>\n\n<Published>\n\nnpm install tflw\n\n</Published>\n');
  assert.match(html, /Not on npm yet\./);
  assert.doesNotMatch(html, /npm install tflw/);
  assert.doesNotMatch(html, /Published/);
});

test('an unclosed <Published> is refused, not rendered half-open', async () => {
  await assert.rejects(render('# P\n\n<Published>\n\nx\n'), /unclosed <Published>/);
});

test('a reference table is drawn from the live manifest as entries (`M270`), one heading per row', async () => {
  const page = [
    '# Matchers',
    '',
    '<script setup>',
    "import { MATCHERS } from '../../lang/src/spec-data.ts';",
    '</script>',
    '',
    '<table>',
    '  <thead><tr><th>Matcher</th><th>Example</th><th>Status</th></tr></thead>',
    '  <tbody>',
    '    <tr v-for="m in MATCHERS" :key="m.id">',
    '      <td v-html="code(m.syntax)" />',
    '      <td v-html="code(m.example)" />',
    "      <td>{{ m.status === 'shipped' ? '✅' : '🔮' }}</td>",
    '    </tr>',
    '  </tbody>',
    '</table>',
    '',
  ].join('\n');
  const html = await render(page);
  assert.equal((html.match(/<h3 /g) ?? []).length, MATCHERS.length, 'one entry heading per matcher');
  for (const m of MATCHERS) assert.match(html, new RegExp(`<h3 id="${m.id}"`), `${m.id} has its own anchor`);
  assert.equal((html.match(/<pre><code class="language-tflw">/g) ?? []).length, MATCHERS.length, 'each example is a tflw block');
  assert.doesNotMatch(html, /<table|v-for|v-html|\{\{|<script/);
});

test('a reference column the entries do not draw fails the build, by name', async () => {
  // The terminal's table and the site's entries read one declaration. A column added for the
  // terminal must not vanish from the site without anyone being told.
  const page = [
    '# Matchers',
    '',
    '<script setup>',
    "import { MATCHERS } from '../../lang/src/spec-data.ts';",
    '</script>',
    '',
    '<table>',
    '  <thead><tr><th>Matcher</th><th>Subjects</th></tr></thead>',
    '  <tbody>',
    '    <tr v-for="m in MATCHERS" :key="m.id">',
    '      <td v-html="code(m.syntax)" />',
    '      <td>{{ m.subjects }}</td>',
    '    </tr>',
    '  </tbody>',
    '</table>',
    '',
  ].join('\n');
  await assert.rejects(render(page), /declares subjects, which its entries do not draw/);
});

test('headings: VitePress ids, an explicit {#id}, `-1` for a repeat, and the # H1 counted then dropped', async () => {
  const html = await render('# Sessions & auth\n\n## `junit.xml` — what CI reads\n\n## Redact {#redact}\n\n## Again\n\n## Again\n\n## Sessions & auth\n');
  assert.doesNotMatch(html, /<h1/, 'Starlight draws the title; the body does not repeat it');
  assert.match(html, /<h2 id="junit-xml-—-what-ci-reads">/);
  assert.match(html, /<h2 id="redact">Redact<\/h2>/);
  assert.match(html, /<h2 id="again">Again<\/h2>[\s\S]*<h2 id="again-1">Again<\/h2>/);
  assert.match(html, /<h2 id="sessions-auth-1">/, 'the dropped H1 still owns its slug, as it did on VitePress');
});

test('a repeated explicit {#id} is refused', async () => {
  await assert.rejects(render('# P\n\n## A {#x}\n\n## B {#x}\n'), /not unique/);
});

test('a picture: its {.class}, the base on its src, and a /ui/ shot sized from the manifest', async () => {
  const html = await render('# P\n\n![The run](/ui/run-paper.png){.light-only}\n\n[the guide](/guide/config) and [elsewhere](https://example.com/x)\n');
  assert.match(html, /<img src="\/tflw\/ui\/run-paper\.png" alt="The run" class="light-only" width="\d+" height="\d+">/);
  assert.match(html, /href="\/tflw\/guide\/config"/);
  assert.match(html, /href="https:\/\/example\.com\/x"/);
  assert.doesNotMatch(html, /\{\.light-only\}/);
});

test('a /ui/ shot the manifest does not name fails the build, by name (D1306)', async () => {
  await assert.rejects(render('# P\n\n![x](/ui/never-cut.png)\n'), /never-cut\.png is embedded in the docs and is not in public\/ui\/manifest\.json/);
});

test('the slug keeps an em-dash and drops an ellipsis, as VitePress did', () => {
  assert.equal(vitepressSlug('Scaling across processes — `--workers N`'), 'scaling-across-processes-—-workers-n');
  assert.equal(vitepressSlug('1st place'), '_1st-place');
});

test('a page title is its first # H1 outside a fence, and inline code is kept apart from the words', () => {
  assert.equal(firstH1('```md\n# not this\n```\n\n# Patterns: `if`\n\n# Second\n'), 'Patterns: `if`');
  assert.equal(firstH1('no title\n'), undefined);
  assert.deepEqual(titleFrom('Patterns: `if`'), { title: 'Patterns: if', titleSource: 'Patterns: `if`' });
});

test('navigation: one group per section, a pillar overview first, and the longest prefix wins', () => {
  const groups = starlightSidebar();
  const guide = groups.find((g) => g.label === '/guide/');
  const functional = guide.items.find((g) => g.label === 'Functional testing');
  assert.deepEqual(functional.items[0], { label: 'Overview', link: '/guide/functional' });
  assert.equal(sectionFor('/guide/assertions'), '/guide/');
  assert.equal(sectionFor('/getting-started'), '/getting-started');
  assert.equal(sectionFor('/ui/'), '/ui/');
  assert.equal(sectionFor('/grammar'), '/');
});
