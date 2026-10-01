// `M263`: what `tflw docs` prints is user prose. Asserted on the real generated topics, since the
// claim is about what a user gets: every page renders, nothing the renderer does not know reaches the
// terminal, no design-record id reaches it from the pages' own text, the tables are the manifests'
// rows, and a word finds the section a reader meant.
//
// **One exclusion, stated rather than hidden:** the reference tables' cells are `spec-data.ts`'s own
// strings (a flag's effect, a diagnostic's meaning), and today 106 of their rows carry 342 milestone
// and decision ids — the site's reference pages, `--help` and LSP hover print the same strings. Those
// are cleaned at their source in `M264`, which deletes this exclusion; until then the id check reads
// the pages' prose and the unrendered-construct check reads everything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLI_FLAGS, MATCHERS } from '@tflw/lang';
import { DOCS_PAGES } from '../src/docs-data.generated.js';
import { DOCS_TOPICS, findSections, renderTable } from '../src/docs-topics.js';

/** Code spans and URLs carry literal text on purpose (`{{7*7}}` is an injection payload). */
const prose = (s: string): string =>
  s
    .replace(/`[^`\n]*`/g, '')
    // "Full reference: SPEC.md §3.3, §3.6 (mTLS)": the one place a page points into SPEC by number,
    // and pointing there is the link's job. Each SPEC link is marked first, then a § leading to a
    // mark is dropped — a regex from § to the URL cannot step over the `(mTLS)` in between.
    .replace(/\(https:\/\/github\.com\/deepak-tuteja\/tflw\/blob\/main\/SPEC\.md[^)]*\)/g, '⟨SPEC⟩')
    .replace(/§[\d.]+[^§⟨\n]*⟨SPEC⟩/g, '')
    .replace(/SPEC(?:\.md)?\s+§[\d.]+/g, '')
    .replace(/⟨SPEC⟩/g, '')
    .replace(/\(https?:\/\/[^)\s]+\)/g, '');

const UNRENDERED = /:::|<table|<\/?t[rdh][\s>]|v-for|v-html|\{#[\w-]+\}|\]\(\/|<script|\{\{|&[a-z]+;|<[A-Z][a-z]+[\s>/]/;
const DESIGN_ID = /P#\d|\bD\d{3,}\b|\bM\d{2,}[a-z]?\d*\b|§\d/;

test('every page renders to a title and a non-empty body', () => {
  assert.ok(Object.keys(DOCS_TOPICS).length > 20);
  for (const [slug, t] of Object.entries(DOCS_TOPICS)) {
    assert.ok(t.title.length > 0, slug);
    assert.ok(t.body.trim().length > 200, `${slug} printed almost nothing`);
  }
});

test('nothing the renderer does not know reaches the terminal, tables included', () => {
  for (const [slug, t] of Object.entries(DOCS_TOPICS)) {
    for (const [n, line] of prose(t.body).split('\n').entries()) {
      assert.doesNotMatch(line, UNRENDERED, `tflw docs ${slug}, line ${n + 1}: ${line.trim()}`);
    }
  }
});

test('no design-record id reaches the terminal from a page\'s own prose (the tables are `M264`\'s)', () => {
  for (const p of DOCS_PAGES) {
    const texts = [...p.intro, ...p.sections.flatMap((s) => [s.title, ...s.body])].filter((s): s is string => typeof s === 'string');
    for (const text of texts) {
      const m = DESIGN_ID.exec(prose(text.replace(/\s*\n\s*/g, ' ')));
      assert.equal(m, null, `tflw docs ${p.slug}: ${m?.[0]} in "${text.slice(0, 120)}"`);
    }
  }
});

test('a table is the manifest\'s rows: every `run` flag, every matcher, and a status only where it is the exception', () => {
  const run = renderTable({ source: 'CLI_FLAGS', where: { key: 'command', value: 'run' }, cols: [{ label: 'Flag', key: 'flag' }, { label: 'Effect', key: 'effect' }] });
  const runFlags = CLI_FLAGS.filter((f) => f.command === 'run');
  assert.equal(run.split('\n\n').length, runFlags.length);
  for (const f of runFlags) assert.ok(run.includes(`  ${f.flag}\n      `), `${f.flag} missing`);
  const matchers = renderTable({ source: 'MATCHERS', cols: [{ label: 'Matcher', key: 'syntax' }, { label: 'Status', key: 'status', when: 'shipped', yes: '✅', no: '🔮' }] });
  assert.equal(matchers.split('\n\n').length, MATCHERS.length);
  assert.equal((matchers.match(/Status: 🔮/g) ?? []).length, MATCHERS.filter((m) => m.status !== 'shipped').length);
  assert.doesNotMatch(matchers, /✅/);
});

test('the CLI reference prints every flag of every command it has a table for', () => {
  const cli = DOCS_TOPICS['cli']!.body;
  for (const f of CLI_FLAGS) assert.ok(cli.includes(`  ${f.flag}\n`), `tflw docs cli does not print ${f.command} ${f.flag}`);
});

test('a word finds the section a reader meant: a whole title first, then a title it opens', () => {
  const unique = findSections('unique');
  assert.deepEqual(unique.map((m) => `${m.topic} ${m.section.slug}`), ['variables unique-vs-random']);
  assert.deepEqual(findSections('run', 'cli').map((m) => m.section.slug), ['tflw-run']);
  assert.deepEqual(findSections('nothing like this at all'), []);
});

test('the listing\'s groups are the site sidebar\'s, in its order', () => {
  const groups = [...new Set(Object.values(DOCS_TOPICS).map((t) => t.group))];
  assert.deepEqual(groups, ['Start here', 'Functional testing', 'Performance testing', 'Security & vulnerability testing', 'Running & reporting', 'Reference']);
});
