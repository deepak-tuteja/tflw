// Track 3b (grill-me, 2026-07-07): `tflw docs [topic]` reads a static module generated from
// SPEC.md by scripts/gen-docs.mjs. `parseSpecToTopics` is a pure function of a markdown string, so
// this tests it against a small fixture instead of the real ~800-line SPEC.md — fast, and stable
// against future SPEC.md edits (a wording change there shouldn't break this test).

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error — plain .mjs script, no type declarations
import { parseSpecToTopics, slugify } from '../scripts/gen-docs.mjs';

const FIXTURE = `# testFlow SPEC (fixture)

## 1. Principles (P#1, P#4, P#5) ✅

Some intro text about principles.

## 3. The config dialect — \`tflw.config\` (P#27–31) ✅

Config intro text.

### 3.1 \`defaults\` + \`env\` blocks (P#28)

Defaults and env block details.

### 6.3 Array quantifiers (P#14)

any/all quantifier details.

### 6.3.1 Partial-object matching — \`matches subset {...}\` (P#14)

Subset matcher details.

## 16. Out of v1 (parking lot) 🔮

No body text follows before the file ends? Actually this one does have body text.
`;

test('parseSpecToTopics extracts one topic per heading, title cleaned of numbering/status/parens', () => {
  const topics = parseSpecToTopics(FIXTURE);
  assert.equal(topics['principles']?.title, 'Principles');
  assert.match(topics['principles']!.body, /Some intro text about principles\./);
});

test('parseSpecToTopics applies the alias table for headings whose literal slug would be unguessable', () => {
  const topics = parseSpecToTopics(FIXTURE);
  // "The config dialect — `tflw.config`" would literal-slug to "the-config-dialect" without the
  // alias table's "config" mapping.
  assert.ok(topics['config'], 'expected the "config" alias to apply');
  assert.equal(topics['the-config-dialect'], undefined);
  // The slug drops everything after the em-dash for readability, but the display title keeps it —
  // same behavior confirmed against the real SPEC.md output (`tflw docs subset`'s title keeps its
  // "— `matches subset {...}`" suffix).
  assert.equal(topics['config']!.title, 'The config dialect — `tflw.config`');

  // "6.3.1 Partial-object matching — `matches subset {...}`" aliases to "subset".
  assert.ok(topics['subset']);
  assert.match(topics['subset']!.body, /Subset matcher details\./);

  // "6.3 Array quantifiers" aliases to "quantifiers".
  assert.ok(topics['quantifiers']);
  assert.match(topics['quantifiers']!.body, /any\/all quantifier details\./);
});

test('parseSpecToTopics splits a ## section\'s body at its first ### child — the parent heading only gets its own intro text', () => {
  const topics = parseSpecToTopics(FIXTURE);
  assert.match(topics['config']!.body, /Config intro text\./);
  assert.doesNotMatch(topics['config']!.body, /Defaults and env block details\./);
  assert.ok(topics['defaults-env-blocks']);
  assert.match(topics['defaults-env-blocks']!.body, /Defaults and env block details\./);
});

test('parseSpecToTopics accepts a custom alias table (used by the real gen-docs.mjs run against real SPEC.md)', () => {
  const topics = parseSpecToTopics('## 1. Widgets (P#1)\n\nWidget body text.\n', { widgets: 'gadgets' });
  assert.ok(topics['gadgets']);
  assert.equal(topics['widgets'], undefined);
});

test('a heading with no body text of its own (only child subsections follow immediately) produces no topic', () => {
  const topics = parseSpecToTopics('## 1. Empty Parent\n### 1.1 Child\n\nChild body.\n');
  assert.equal(topics['empty-parent'], undefined);
  assert.ok(topics['child']);
});

test('slugify lowercases, strips backticks/punctuation, and collapses whitespace to single hyphens', () => {
  assert.equal(slugify('Array quantifiers'), 'array-quantifiers');
  assert.equal(slugify('`retry`'), 'retry');
  assert.equal(slugify('Events, report, CI outputs'), 'events-report-ci-outputs');
});
