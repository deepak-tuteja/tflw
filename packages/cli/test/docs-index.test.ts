// M125e / `FU-29` (D252/D281) — `tflw docs` groups its topics and says what each one is.
//
// Sixty slugs in one alphabetical run, no descriptions, `the-one-form`/`subset`/`quantifiers`
// opaque to anyone who had not already read SPEC. Both halves of the fix were already in the data:
// `title` was carried and never printed, and the enclosing `##` heading is the grouping — so there
// is no authored taxonomy here that could fall out of step with the language.
//
// `parseSpecToTopics` is tested against a fixture (gen-docs.test.ts's convention); `renderTopicIndex`
// is tested against the real generated `DOCS_TOPICS`, since its whole job is the shape of the real
// list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — plain .mjs script, no type declarations
import { parseSpecToTopics, headingSection } from '../scripts/gen-docs.mjs';
import { renderTopicIndex } from '../src/docs-index.js';
import { DOCS_TOPICS } from '../src/docs-data.generated.js';

const FIXTURE = `# fixture

## 4. Tests & structure ✅

Intro.

### 4.4 \`retry\` (P#10)

Retry details.

## 6. Assertions (P#13–16) ✅

Assertion intro.

### 6.1 The one form

The one form details.

### 6.2.1 Contract validation — \`matches schema\` (PLAN decision 102a,

A heading whose trailing parenthetical wrapped onto the next SPEC line.
`;

// --- the generator side --------------------------------------------------------------------

test('every topic carries the `##` section it sits under', () => {
  const topics = parseSpecToTopics(FIXTURE);
  assert.equal(topics['retry'].group, 'Tests & structure');
  assert.equal(topics['the-one-form'].group, 'Assertions');
  // A `##` with body text of its own is its own topic, and belongs to itself.
  assert.equal(topics['tests-structure'].group, 'Tests & structure');
});

test('a heading whose parenthetical wrapped is not left cut off mid-clause', () => {
  // `### 6.2.1 Contract validation — … (PLAN decision 102a,` — harmless while `title` was only a
  // lookup key, visible the moment the listing started printing it. An unclosed `(` at the end of a
  // heading is a wrap by construction: headings do not open groups they never close.
  const title = parseSpecToTopics(FIXTURE)['contract-validation'].title;
  assert.equal(title, 'Contract validation — `matches schema`');
  assert.ok(!title.includes('PLAN decision'));
});

test('headingSection reads the top-level number, which headingTitle strips', () => {
  assert.equal(headingSection('4.4 `retry` (P#10)'), '4');
  assert.equal(headingSection('12. CLI 🔧'), '12');
  assert.equal(headingSection('Something unnumbered'), '');
});

// --- the listing side ----------------------------------------------------------------------

const slugs = Object.keys(DOCS_TOPICS).sort();
const rendered = renderTopicIndex(slugs);

/** The slug a topic line names — the first column, split on the two-space gutter. Deliberately not
 * a `startsWith` prefix test: `cli` prefixes `client-certificates`, so a prefix match counts one
 * topic as two. (Written that way first; the count was 2 and the code was fine.) */
const listedSlugs = rendered
  .split('\n')
  .filter((l) => l.startsWith('  '))
  .map((l) => l.trim().split(/\s{2,}/)[0]!);

test('every topic appears exactly once, and nothing else appears', () => {
  assert.deepEqual([...listedSlugs].sort(), [...slugs].sort());
});

test('the list is grouped, not one flat run', () => {
  const groups = rendered.split('\n').filter((l) => l.length > 0 && !l.startsWith(' '));
  assert.ok(groups.length > 5, `expected several group headings, got ${groups.length}`);
  assert.ok(groups.includes('Assertions'));
});

test('groups appear in SPEC order, not alphabetically', () => {
  // The document is written to be read from the top; sorting the groups would replace an argued
  // order with an arbitrary one. `Principles` is SPEC §1 and sorts nowhere near first.
  const groups = rendered.split('\n').filter((l) => l.length > 0 && !l.startsWith(' '));
  assert.equal(groups[0], 'Principles');
  assert.notDeepEqual(groups, [...groups].sort());
});

test('slugs are sorted inside their group', () => {
  // Inside a group there is no argued order, so alphabetical is the useful one.
  let current: string[] = [];
  for (const line of `${rendered}\n`.split('\n')) {
    if (line.startsWith('  ')) current.push(line.trim().split(/\s{2,}/)[0]!);
    else {
      assert.deepEqual(current, [...current].sort());
      current = [];
    }
  }
});

test('a topic line carries its title', () => {
  const line = rendered.split('\n').find((l) => l.trim().startsWith('the-one-form'));
  assert.ok(line, '`the-one-form` is missing from the listing');
  assert.match(line!, /the-one-form\s+The one form/);
});

test("a `##` section's own topic does not repeat the group heading beside itself", () => {
  // The heading is printed directly above it; saying the identical thing twice is not a description.
  const lines = rendered.split('\n');
  const at = lines.findIndex((l) => l.trim() === 'principles');
  assert.ok(at > 0, 'expected `principles` on a line of its own');
  assert.equal(lines[at - 1], 'Principles');
});

test('column alignment is per group, not across the whole list', () => {
  // One 45-character outlier (`frames-tabs-downloads-drag-drop-wait-until-ui`) would open a gutter
  // that wide on all sixty lines if the width were global.
  const line = rendered.split('\n').find((l) => l.trim().startsWith('retry '))!;
  assert.ok(line.length < 60, `a short slug's line is ${line.length} chars — the gutter is global`);
});
