// `M270` (`D-M270-2`) — the Grammar page: each section of `packages/lang/GRAMMAR.md` opened by a few
// lines of real `tflw` (`src/grammar/*.tflw`), its productions folded under them.
//
// The glance is the part a reader reads, so it carries the two claims the record carries: it is the
// language (every glance parses, as its section says it is checked), and it is all of the language
// (every keyword `grammarCoverage.test.ts` holds the record to appears in some glance). And the
// record is still published whole, which is the promise `grammar.md` makes: what moved into a fold
// is still on the page, and what is not on the page is the record's history and nothing else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import { lex, parseConfigSource, parseSource, REFUSED_SPELLINGS } from '@tflw/lang';
import { glance, GLANCES, grammarPage } from '../src/lib/grammar.mjs';
import { rehypeTflwLinks, remarkTflwPages } from '../src/lib/markdown.mjs';

const RECORD = readFileSync(new URL('../../lang/GRAMMAR.md', import.meta.url), 'utf8');
const PARSER = readFileSync(new URL('../../lang/src/parser.ts', import.meta.url), 'utf8');
const PUBLISHED = JSON.parse(readFileSync(new URL('./fixtures/published-urls.json', import.meta.url), 'utf8')).pages['grammar.html'];

/** A glance as the file it is checked as: a `step` glance is the body of a test. */
const asChecked = (g) => (g.wrap === 'step' ? `test "example"\n${glance(g.key).split('\n').map((l) => (l === '' ? l : `  ${l}`)).join('\n')}` : glance(g.key));
const shown = GLANCES.filter((g) => g.key !== null);

test('every glance is tflw that parses, checked as its section says', () => {
  assert.equal(shown.length, 11, 'a glance was added or dropped; the count is part of what is reviewed');
  for (const g of shown) {
    const source = `${asChecked(g)}\n`;
    const { diagnostics } = g.wrap === 'config' ? parseConfigSource(source) : parseSource(source);
    assert.deepEqual(diagnostics.map((d) => `${d.code} ${d.message}`), [], `src/grammar/${g.key}.tflw`);
  }
});

/** Every keyword the parser tests a token against — `grammarCoverage.test.ts`'s derivation. */
const parserKeywords = () => {
  const found = new Set(REFUSED_SPELLINGS);
  for (const m of PARSER.matchAll(/\b(?:isKw\([^,]+,\s*|expectKw\(|matchKw\()'([a-z][a-z0-9]*)'/g)) found.add(m[1]);
  return [...found];
};

/** Keywords no glance can show, each because writing it is an error. */
const REFUSED = new Map([
  ['scenario', 'removed in D103; parsed only to say `test`'],
  ['think', 'renamed to `pause`'],
  ['uncheck', 'renamed to `untick`'],
  ['tests', 'not a construct: a did-you-mean for `test`'],
  // GRAMMAR.md still writes a `CleanupDecl` production, but the parser refuses the word as removed
  // (`TF033`); found by writing this glance. The record is the language team's to amend.
  ['cleanup', 'removed: teardown runs by default under load (`TF033`)'],
]);

/** The parser keywords missing from a set of glances, judged on the lexer's own identifier tokens. */
const missingFrom = (glances) => {
  const words = new Set(glances.flatMap((g) => lex(`${asChecked(g)}\n`).tokens.filter((t) => t.type === 'ident').map((t) => t.value)));
  return parserKeywords().filter((k) => !REFUSED.has(k) && !words.has(k)).sort();
};

test('the glances use every keyword the parser recognises', () => {
  // A word inside a string does not count — `"{method}"` is not the `method` clause — which is why
  // this reads identifier tokens rather than searching the text.
  assert.deepEqual(missingFrom(shown), []);
});

test('the keyword gate can fire: drop one glance and its words are reported', () => {
  const missing = missingFrom(shown.filter((g) => g.key !== 'crawl'));
  for (const k of ['spider', 'openapi', 'traffic', 'depth']) assert.ok(missing.includes(k), `${k} was not reported: ${missing.join(' ')}`);
});

test('each keyword the glance leaves out is still refused, so its reason still holds', () => {
  for (const word of ['scenario', 'think', 'uncheck']) assert.ok([...REFUSED_SPELLINGS].includes(word), word);
  const { diagnostics } = parseSource('test "x"\n  ramp to 5 users over 1s\n  api GET /a\n  cleanup\n');
  assert.ok(diagnostics.some((d) => d.code === 'TF033'), '`cleanup` parses again; give it a glance line and drop it from REFUSED');
});

// ---- the page --------------------------------------------------------------------------------------

const processor = await createMarkdownProcessor({ remarkPlugins: [remarkTflwPages], rehypePlugins: [rehypeTflwLinks], smartypants: false, syntaxHighlight: false });
const PAGE = new URL('../src/content/docs/grammar.md', import.meta.url);
// Astro strips the frontmatter before the page reaches these plugins; so does this.
const body = readFileSync(PAGE, 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
const html = (await processor.render(body, { fileURL: pathToFileURL(fileURLToPath(PAGE)) })).code;
/** The serializer writes `&#x3C;` as often as `&lt;`; decode both kinds of reference. */
const unescape = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

test('every production in GRAMMAR.md is on the page, folded under its section', () => {
  const blocks = [...RECORD.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1].replace(/\n$/, ''));
  assert.ok(blocks.length >= 11, `only ${blocks.length} production blocks read from the record`);
  const page = unescape(html);
  for (const b of blocks) assert.ok(page.includes(b), `a production block is not on the page: ${b.split('\n')[0]}`);
  assert.equal((html.match(/<details class="tflw-formal">/g) ?? []).length, GLANCES.length, 'one fold per section');
});

test("the record's history is not published, and every id the page had still resolves", () => {
  assert.doesNotMatch(html, /Freshening note|load-testing catch-up|current through M78/);
  assert.match(html, /<p id="testflow-grammar">Notation:/, "the notation paragraph, carrying the record title's id");
  for (const id of PUBLISHED.filter((id) => id !== 'grammar')) assert.match(html, new RegExp(`id="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), id);
  // The sections show their names, not the record's provenance.
  // Their ids keep the record's words on purpose; it is the text a reader sees that drops them.
  const headings = [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);
  assert.equal(headings.length, GLANCES.length);
  assert.doesNotMatch(headings.join(' | '), /M137c|P#6|§/);
});

test('a section with no glance, and a glance with no section, each fail the build', () => {
  const section = (words) => ({ type: 'heading', depth: 2, children: [{ type: 'text', value: words }] });
  const notation = { type: 'paragraph', children: [{ type: 'text', value: 'Notation: x' }] };
  const all = GLANCES.map((g) => section(g.heading));
  assert.doesNotThrow(() => grammarPage([notation, ...all]));
  assert.throws(() => grammarPage([notation, ...all, section('Plugins (§19)')]), /the section "Plugins \(§19\)" has no glance/);
  assert.throws(() => grammarPage([notation, ...all.filter((s) => s.children[0].value !== 'Crawl')]), /no section starts with "Crawl"/);
  assert.throws(() => grammarPage(all), /no "Notation:" paragraph/);
});
