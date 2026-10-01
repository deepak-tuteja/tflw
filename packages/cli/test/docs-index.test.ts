// M125e / `FU-29` (D252/D281), `M263` — `tflw docs` groups its topics and says what each one is.
//
// Before `M125e` the listing was sixty slugs in one alphabetical run with no descriptions. Since
// `M263` the topics are the docs site's pages and the grouping is the site's sidebar, read off it by
// `gen-docs.mjs`, so there is still no authored taxonomy here that could fall out of step. Tested
// against the real generated topics, since the listing's whole job is the shape of the real list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTopicIndex } from '../src/docs-index.js';
import { DOCS_TOPICS } from '../src/docs-topics.js';

const slugs = Object.keys(DOCS_TOPICS);
const rendered = renderTopicIndex([...slugs].sort());

/** The slug a topic line names — the first column, split on the two-space gutter. Deliberately not
 * a `startsWith` prefix test: `load-testing` prefixes nothing today, but a prefix match counts one
 * topic as two the day one does. */
const listedSlugs = rendered
  .split('\n')
  .filter((l) => l.startsWith('  '))
  .map((l) => l.trim().split(/\s{2,}/)[0]!);
const groups = rendered.split('\n').filter((l) => l.length > 0 && !l.startsWith(' '));

test('every topic appears exactly once, and nothing else appears', () => {
  assert.deepEqual([...listedSlugs].sort(), [...slugs].sort());
});

test('the list is grouped the way the site\'s sidebar is, in its order', () => {
  // The order a caller passes is ignored: `docsCommand` passes the slugs sorted, and the listing is
  // still the sidebar's, which is written to be read from the top.
  assert.deepEqual(groups, ['Start here', 'Functional testing', 'Performance testing', 'Security & vulnerability testing', 'Running & reporting', 'Reference']);
  assert.deepEqual(listedSlugs, slugs);
});

test('a topic line carries the sidebar\'s name for the page', () => {
  assert.match(rendered, /^ {2}matchers\s+Matchers$/m);
  assert.match(rendered, /^ {2}security-scanning\s+Hygiene scanning$/m);
});

test('a group\'s overview page does not repeat the group heading beside itself', () => {
  // The heading is printed directly above it; saying the identical thing twice is not a description.
  const lines = rendered.split('\n');
  const at = lines.findIndex((l) => l.trim() === 'functional');
  assert.ok(at > 0, 'expected `functional` on a line of its own');
  assert.equal(lines[at - 1], 'Functional testing');
});

test('column alignment is per group, not across the whole list', () => {
  // `findings-and-baselines` would open a 22-character gutter on every line if the width were global.
  const line = rendered.split('\n').find((l) => l.trim().startsWith('cli '))!;
  assert.ok(line.length < 30, `a short slug's line is ${line.length} chars — the gutter is global`);
});
