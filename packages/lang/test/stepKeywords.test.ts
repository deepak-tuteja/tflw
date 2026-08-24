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
import { STATEMENT_KEYWORDS, RETIRED_STATEMENT_KEYWORDS, REFUSED_SPELLINGS, REFUSED_WORDS, STEP_KEYWORDS, WORKLOAD_DIRECTIVES, specConstructs } from '../src/index.js';
import { DELIBERATELY_UNCOLOURED, REFUSED_ON_PURPOSE, COLOURED_VOCABULARY } from '../src/semanticTokens.js';

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

test('…and the emitter carries the parity forward — `tflw spec --json` offers exactly these words', () => {
  // M154a. The two tests above hold `STEP_KEYWORDS` to the parser; this holds `specConstructs()` to
  // `STEP_KEYWORDS`, which is what makes the published manifest inherit the parity rather than merely
  // resemble it. Without this the fold in `spec-data.ts` could quietly drop a keyword and both tests
  // above would stay green — a construct the parser accepts, that no conformance gate ever demands.
  const emitted = specConstructs().filter((c) => c.family === 'step').map((c) => c.name);
  assert.deepEqual(emitted.slice().sort(), expected.slice().sort());
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

// -- `M147b` / `M142-01` — the refusal table, held to the four things it claims -------------------
//
// `REFUSED_WORDS` replaced three unrelated mechanisms with one, so what has to be true of a refusal
// can be *asserted* instead of restated in three comments. Each test below is one sentence the old
// arrangement could only make in prose.

test('a step-position refusal stays in STATEMENT_KEYWORDS, or dispatch never reaches it', () => {
  // The retention these words exist for. Drop one from `STATEMENT_KEYWORDS` and its careful
  // migration diagnostic becomes `TF011: unknown statement`, whose did-you-mean is an edit-distance
  // search that will never reach `pause` from `think`.
  for (const word of REFUSED_SPELLINGS) {
    if (REFUSED_WORDS[word].position !== 'step') continue;
    assert.ok(
      (STATEMENT_KEYWORDS as readonly string[]).includes(word),
      `\`${word}\` is refused in step position but is not a statement keyword, so the refusal is unreachable`,
    );
  }
});

test('RETIRED_STATEMENT_KEYWORDS is derived from the table, and holds exactly the step refusals', () => {
  const expectedRetired = REFUSED_SPELLINGS.filter((w) => REFUSED_WORDS[w].position === 'step');
  assert.deepEqual([...RETIRED_STATEMENT_KEYWORDS].sort(), [...expectedRetired].sort());
});

test('a migrate payload is a spelling the language still has — migrate terminates because of this', () => {
  // `migrateCommand` repeats until a pass finds nothing left to rewrite, and argues termination
  // structurally: no rewrite can introduce a retired spelling. That argument is only as good as its
  // premise, which was a comment naming three words. This is the premise, checked.
  const live = new Set<string>([...STATEMENT_KEYWORDS, 'test', 'crawl', 'action', 'import', 'use', 'before', 'after']);
  for (const word of REFUSED_SPELLINGS) {
    const replacement = REFUSED_WORDS[word].replacement;
    if (replacement === undefined) continue;
    assert.ok(live.has(replacement), `\`${word}\` migrates to \`${replacement}\`, which is not current grammar`);
    assert.ok(!REFUSED_SPELLINGS.includes(replacement as never), `\`${word}\` migrates to a spelling that is itself refused`);
  }
});

test('a replacement needs a diagnostic to splice into, and a row without one has no payload', () => {
  // `tflw migrate` splices the *diagnostic's* span. A row carrying a replacement but no diagnostic
  // of its own would be a payload with nowhere to land — silently doing nothing, which is the shape
  // of failure this milestone exists to stop being possible to write.
  for (const word of REFUSED_SPELLINGS) {
    const row = REFUSED_WORDS[word];
    if (row.replacement !== undefined) assert.ok(row.diagnostic, `\`${word}\` has a replacement but owns no diagnostic`);
  }
});

test('every row says something — an empty hint is a refusal that teaches nothing', () => {
  for (const word of REFUSED_SPELLINGS) {
    assert.ok(REFUSED_WORDS[word].hint.trim().length > 0, `\`${word}\` has no hint, which is the only thing the table is for`);
  }
});

test('the colouring pass accounts for every refused word, one way or the other', () => {
  // The reconciliation `M142-01` names: two lists of the same words, kept for different purposes,
  // and *no two of them checked against each other*. `semanticTokens.ts` has to decide about each of
  // these — paint it (`think`/`uncheck` are statement keywords and are painted, per `M142`) or name
  // it as a word the language does not have. Unaccounted-for is the only wrong answer.
  //
  // Asserted in this direction only, and deliberately: `REFUSED_ON_PURPOSE` is *wider*, because a
  // highlighter must decide about a word in any position, including the matcher-position words
  // (`empty`, `at`, `least`, …) that no dispatch refuses. See the note on `REFUSED_WORDS`.
  for (const word of REFUSED_SPELLINGS) {
    const accounted = REFUSED_ON_PURPOSE.has(word) || DELIBERATELY_UNCOLOURED.has(word) || COLOURED_VOCABULARY.has(word);
    assert.ok(accounted, `\`${word}\` is refused by the parser and semanticTokens.ts says nothing about it`);
  }
});
