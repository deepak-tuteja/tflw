// M125e / `FU-24` (D277) — `STEP_KEYWORDS` is held to the lists the parser actually dispatches on.
//
// `MATCHERS` and `GENERATORS` answer to nothing but SPEC prose, because there is no runtime list of
// matchers to compare them against. Step keywords are different: `STATEMENT_KEYWORDS` *is* the
// parser's own vocabulary, so the manifest can be checked against the thing it documents instead of
// against a description of it. An entry for a word the parser rejects is a lie in the editor; a word
// the parser accepts with no entry is the gap `FU-24` was filed for.
//
// This test starts green — measured today, the two lists agree exactly. That is the point: it is
// here so the next keyword added to the grammar cannot ship without the sentence that explains it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATEMENT_KEYWORDS, RETIRED_STATEMENT_KEYWORDS, STEP_KEYWORDS, WORKLOAD_DIRECTIVES } from '../src/index.js';

const ids = STEP_KEYWORDS.map((k) => k.id);
const documented = new Set(ids);
const expected = [...STATEMENT_KEYWORDS.filter((k) => !RETIRED_STATEMENT_KEYWORDS.includes(k)), ...WORKLOAD_DIRECTIVES];

test('every keyword the parser dispatches on has a manifest entry', () => {
  const missing = expected.filter((k) => !documented.has(k));
  assert.deepEqual(missing, [], `no STEP_KEYWORDS entry for: ${missing.join(', ')}`);
});

test('every manifest entry is a keyword the parser dispatches on', () => {
  const extra = ids.filter((id) => !expected.includes(id));
  assert.deepEqual(extra, [], `STEP_KEYWORDS documents words the parser does not accept: ${extra.join(', ')}`);
});

test('retired spellings are absent — documenting one would teach an error', () => {
  // `think` and `uncheck` stay in `STATEMENT_KEYWORDS` purely so the parser can reject them by name
  // (FS-04/FS-05). A manifest entry would put them in completion and in hover as if they were valid.
  for (const retired of RETIRED_STATEMENT_KEYWORDS) {
    assert.ok(!documented.has(retired), `\`${retired}\` is retired and must not be documented as a step`);
  }
});

test('ids are unique', () => {
  assert.equal(new Set(ids).size, ids.length);
});

test('every entry carries all four of its fields', () => {
  for (const entry of STEP_KEYWORDS) {
    for (const field of ['syntax', 'summary', 'example'] as const) {
      assert.ok(entry[field].length > 0, `\`${entry.id}\` has an empty \`${field}\``);
    }
  }
});

test('no syntax or example cell contains an unescaped pipe', () => {
  // These strings are rendered straight into a SPEC.md table by `gen-spec-tables.mjs`, where a bare
  // `|` silently becomes a column break — the row still renders, just with its meaning cut in half.
  // Alternatives are written with ` / `, the form GENERATORS already uses.
  for (const entry of STEP_KEYWORDS) {
    assert.ok(!entry.syntax.includes('|'), `\`${entry.id}\`'s syntax would break the SPEC table`);
    assert.ok(!entry.example.includes('|'), `\`${entry.id}\`'s example would break the SPEC table`);
  }
});

test('the example is an instance of the keyword it documents', () => {
  // Cheap, but it is the assertion that catches a copy-paste — an entry whose example demonstrates
  // the row above it teaches the wrong word with total confidence.
  for (const entry of STEP_KEYWORDS) {
    assert.match(entry.example, new RegExp(`^\`${entry.id}\\b`), `\`${entry.id}\`'s example does not start with it`);
  }
});
