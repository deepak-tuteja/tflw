// M152a (`D675`, `D676`, `D683`) — the citation index's gate, shown failing.
//
// THE THING BEING GUARDED is `DECISIONS.md`: the resolution target for a notation this repository
// is written in but does not contain. `SPEC.md`, `GRAMMAR.md`, `CHANGELOG.md` and the package
// READMEs cite `P#43`, `D318` and `M137d` roughly 730 times, and every one of those names a block
// in a file `.gitignore` excludes. The index lifts those blocks, verbatim, so the pointers resolve.
//
// WHY THE FIXTURES ARE REAL TREES rather than in-process calls. `gen-decisions.mjs` reads its inputs
// through `git ls-files` and resolves everything against its own `../`, so a unit test that calls
// `conformance()` with two hand-built Sets proves the set difference works and proves nothing about
// the gate. The failures this milestone owes a demonstration of are *process* failures — a non-zero
// exit on a tree in a particular state — and the only honest way to show one is to build the tree
// and read the exit code. `M133`'s carry-forward is the reason that sentence is here: two command
// shapes in this repo reported a false green because something downstream became the exit status.
//
// EACH FIXTURE MIRRORS THE REAL LAYOUT, including the part that makes this milestone necessary: the
// records are present on disk and **not tracked**, exactly as `.gitignore` lines 33-37 leave them.
// A fixture that tracked its own `PLAN.md` would quietly make the records visible to `git ls-files`,
// the generator would start reading its own sources as citation surfaces, and the test would pass
// against a tree shaped nothing like the one it is defending.
//
// THE TWO TIERS ARE TESTED SEPARATELY (`D683`), because the CI tier's defining property is a
// negative one: it must not print a bare green for the tier it could not run. That is asserted
// directly — a runner with no records has to say so in its output *and* still exit 0.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CITATION,
  PREAMBLE,
  collectAnchors,
  RANGE,
  byId,
  collectCitations,
  collectLegacy,
  conformance,
  expandsRanges,
  extractBlock,
  pickAnchor,
  publishedIds,
  scrub,
  scrubTracked,
  staleExemptions,
} from './gen-decisions.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const GENERATOR = join(ROOT, 'scripts', 'gen-decisions.mjs');

const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true }); });

/**
 * A miniature of this repository: tracked public prose that cites the notation, plus untracked
 * design records that define it. `withRecords: false` is a CI runner — the records simply are not
 * there, which is the condition `D683`'s second tier has to notice rather than skip past.
 */
function fixture({ withRecords = true, spec = null, sibling = {}, pin = undefined, code = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tflw-decisions-'));
  temps.push(dir);
  const write = (rel, text) => writeFileSync(join(dir, rel), text, 'utf8');

  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: dir });

  // Line-for-line the arrangement that creates the defect: the records are on disk, and invisible.
  write('.gitignore', 'PLAN*.md\nPROGRESS.md\n');

  write('SPEC.md', spec ?? [
    '# Spec',
    '',
    'The bundle is one publishable package (`P#43`), and sessions were reworked at `M7`.',
    'Percentiles are documented rather than changed (`D7`).',
    '',
  ].join('\n'));
  write('README.md', '# readme\n\nSee `SPEC.md`.\n');

  if (withRecords) {
    write('PLAN.md', [
      '# Plan',
      '',
      '42. **Something before it** — so the list has a neighbour to end against.',
      '',
      '43. **Packaging mechanism** — one publishable package, no runtime dependencies, so a corporate',
      '    install is one `npm i` and an audit of nothing.',
      '',
      '44. **Something after it** — likewise.',
      '',
    ].join('\n'));
    // The shape a real plan file has: the `#` heading names the milestone and the paragraph under
    // it is the milestone's statement, decisions are bold-led further down, and everything past the
    // first paragraph of a section is how the work went rather than what was decided (`D670`).
    write('PLAN_M7_SESSIONS.md', [
      '# M7 — sessions carry their own cookie jar',
      '',
      'A session is established once and reused across every step in the file that names it.',
      '',
      'Everything after the first paragraph is how the work went, not what was decided.',
      '',
      '## Decisions',
      '',
      '**`D7` — the percentile algorithm differs from the reference implementation.** Documented,',
      'not changed: the divergence is smaller than the sampling error at the run lengths anyone uses.',
      '',
    ].join('\n'));
  }

  // Tracked non-prose files, which are the demand corpus and nothing else (`D858`, `M169b`). Values
  // may be a string or a Buffer, because one test needs a NUL byte to be skipped on its content.
  for (const [rel, body] of Object.entries(code)) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }

  // The sibling's citation pin (`D710`). Tracked, and present in every fixture — the generator
  // treats a missing one as a broken tree rather than a smaller question, so a fixture without it
  // would be testing the error path in every test that is about something else.
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  write(join('scripts', 'sibling-citations.json'), `${JSON.stringify(pin ?? {
    repo: 'example/tflw-tests', ref: 'main', sha: '0'.repeat(40), files: [], citations: sibling,
  }, null, 2)}\n`);

  execFileSync('git', ['add', '-A'], { cwd: dir });
  cpSync(GENERATOR, join(dir, 'scripts', 'gen-decisions.mjs'), { recursive: false, force: true, mkdir: true });
  return dir;
}

/** Runs the generator inside a fixture and hands back the exit code with both streams. */
function run(dir, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [join(dir, 'scripts', 'gen-decisions.mjs'), ...args], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

const decisions = (dir) => readFileSync(join(dir, 'DECISIONS.md'), 'utf8');
const setDecisions = (dir, text) => writeFileSync(join(dir, 'DECISIONS.md'), text, 'utf8');

// --- the generated tree is the baseline -----------------------------------------------------------

test('a generated tree passes all three tiers, and says which it ran', () => {
  const dir = fixture();
  const gen = run(dir);
  assert.equal(gen.code, 0, `generation failed:\n${gen.stderr}`);
  assert.match(gen.stdout, /wrote 3 entries/, 'the fixture cites exactly P#43, D7 and M7');

  const check = run(dir, ['--check']);
  assert.equal(check.code, 0, `--check failed on a freshly generated tree:\n${check.stderr}`);
  assert.match(check.stdout, /match the design records/, 'with records present, the fidelity tier must actually run and say so');
});

test('the entry is the record\'s own bytes, and a heading yields its statement rather than its section', () => {
  const dir = fixture();
  run(dir);
  const text = decisions(dir);
  assert.match(text, /one publishable package, no runtime dependencies/, 'P#43 is lifted from PLAN.md verbatim');
  assert.match(text, /\*\*M7 — sessions carry their own cookie jar\*\*/, 'the heading is demoted to bold so the index keeps one outline');
  assert.doesNotMatch(text, /Everything after the first paragraph/, 'a heading entry takes the statement, not the whole section (D670)');
});

// --- where a block ends, which is the whole of whether an entry is readable ------------------------

test('a fenced statement is closed, and the sentence it illustrates comes with it', () => {
  // Found by proofing: two entries published an opening ``` and nothing that closed it, because the
  // scan ended at the first blank line and a fence is full of them. In a generated file that is not
  // one bad entry — every entry after it renders as code. The second half is the same defect one
  // step on: a fence is an illustration, so an entry that is only a fence says nothing.
  const record = [
    '### D330 — `probe mutating` is an optional indented sub-clause',
    '',
    '```',
    'authorized target "http://localhost:4001"',
    '',
    'authorized target "https://staging.example.com"',
    '```',
    '',
    'The config dialect already nests this way, so this is an existing shape on one more node.',
    '',
    'How the work went, which is not the decision.',
    '',
  ].join('\n');
  const body = extractBlock(record, { line: 1, kind: 'heading', headingLevel: 3 });
  assert.equal((body.match(/```/g) ?? []).length, 2, 'the fence is closed');
  assert.match(body, /staging\.example\.com/, 'the blank line inside the fence is content, not a terminator');
  assert.match(body, /an existing shape on one more node/, 'the sentence the fence illustrates is part of the statement');
  assert.doesNotMatch(body, /How the work went/, 'and it stops there — one sentence, not the section (D670)');
});

test('a colon takes the enumeration it introduces, and stops at a paragraph', () => {
  // 29 entries published a sentence with its object removed — `Three clauses:` and no clauses. The
  // object was in the record all along, one blank line down. Extending across a colon was tried once
  // before and reverted, because the blanket form took whatever came next and `M54` grew to 3.6 KB of
  // progress log. What survives the revert is grammatical, not dimensional: an enumeration is what
  // the sentence promised, a paragraph is the next thought.
  const list = [
    '### D295 — acceptance: a positive, a negative, and a not-applicable case',
    '',
    'Each rule must be demonstrated three ways against the real target:',
    '',
    '- **fires** against a response that genuinely violates it;',
    '- **stays silent** against a response that does not;',
    '- **reports not-applicable** where its precondition is unmet.',
    '',
    'How the work went, which is not the decision.',
    '',
  ].join('\n');
  const body = extractBlock(list, { line: 1, kind: 'heading', headingLevel: 3 });
  assert.match(body, /reports not-applicable/, 'the list the colon promised comes with it');
  assert.doesNotMatch(body, /How the work went/, 'and it stops there — the statement, not the section (D670)');

  // A loose list puts a blank line between its items, and a blank-line rule stops at the first one.
  // `D293` and `D317` are both loose, so that rule would have published item 1 and two lines of item
  // 2, cut off at its own colon. A truncated list is worse than the teaser: it looks complete.
  const loose = [
    '### D293 — the target',
    '',
    '`M128a` is therefore:',
    '',
    '1. **`env secureLocal`**, its own dedicated env.',
    '',
    '2. **A hygiene-only `vuln/` slice**, supplying the positives the clean app cannot produce:',
    '',
    '   ```',
    '   GET /vuln/cors-wildcard',
    '   ```',
    '',
    '3. **`VULNS.md`**, one row per planted flaw.',
    '',
    'A later paragraph that is not part of the list.',
    '',
  ].join('\n');
  const looseBody = extractBlock(loose, { line: 1, kind: 'heading', headingLevel: 3 });
  assert.match(looseBody, /VULNS\.md/, 'the blank lines between items are content, not a terminator');
  assert.equal((looseBody.match(/```/g) ?? []).length, 2, 'a fence nested in an item comes with the item');
  assert.doesNotMatch(looseBody, /A later paragraph/, 'the list ends at the first unindented non-item');

  // One step only. Item 2 above ends on a colon of its own; chaining would walk the section an item
  // at a time. And a paragraph after a colon is the next thought, not the sentence's object — that is
  // `M12`, whose colon introduced the first of six sub-parts and would have published one of them.
  const para = [
    '### M12 — Documentation site',
    '',
    'Six lettered sub-parts:',
    '',
    '**(a) a canonical structured manifest.**',
    '',
  ].join('\n');
  assert.doesNotMatch(
    extractBlock(para, { line: 1, kind: 'heading', headingLevel: 3 }),
    /canonical structured manifest/,
    'a paragraph after a colon is not taken',
  );
});

test('a heading that names an id outranks a table cell that only lists it', () => {
  // Found the moment this milestone's own proofing list was written: an index table naming 100+
  // identifiers made every one of them a candidate, and a cell in it beat the heading that took the
  // decision — `D5`, `D6`, `D9`, `D14` and 30 more resolved to a row of the list of their own
  // defects. A cell names; a heading is the section about the thing.
  const plan = ['## 1.1 Driver boundary (D5)', '', 'The real decision.', ''].join('\n');
  const index = ['| entry | note |', '|---|---|', '| `D5` | listed here, defined elsewhere |', ''].join('\n');
  const anchors = collectAnchors([{ path: 'PLAN_ARC.md', text: plan }, { path: 'PLAN_INDEX.md', text: index }]);
  assert.equal(pickAnchor('D5', anchors.get('D5')).file, 'PLAN_ARC.md');

  // But not above `PROGRESS.md`'s commit log, which IS the milestone's own account of what it
  // shipped (`D670`). Ranking the heading over that moved `M69` to a plan heading mentioning it in
  // passing, and `M77` to a review cluster's title.
  const log = ['| commit | what |', '|---|---|', '| `7d996ad` | **M69** — the strict half |', ''].join('\n');
  const mention = ['### Landed — step 2 and step 3 (`M69`, on a branch)', '', 'Prose about it.', ''].join('\n');
  const both = collectAnchors([{ path: 'PROGRESS.md', text: log }, { path: 'PLAN_MILESTONE_B.md', text: mention }]);
  assert.equal(pickAnchor('M69', both.get('M69')).file, 'PROGRESS.md');
});

test('a table row is published with the header it is a row of', () => {
  // 45 entries are one row of `PROGRESS.md`'s milestone table or of a plan's scope table. A lone
  // `| a | b |` line is not a table to any renderer — with no delimiter row it renders as literal
  // pipes — so those entries published a milestone as `| M18 — … | ✅ | 2026-07-23 | 2026-07-23 |`,
  // four unlabelled cells and a wall of punctuation.
  const record = [
    '| Milestone | Status | Started | Finished |',
    '|---|---|---|---|',
    '| M17 — CI ergonomics | ✅ | 2026-07-20 | 2026-07-20 |',
    '| M18 — gap #9 backfill | ✅ | 2026-07-23 | 2026-07-23 |',
    '',
  ].join('\n');
  const body = extractBlock(record, { line: 4, kind: 'progressTable', headingLevel: 0 });
  assert.match(body, /^\| Milestone \| Status \| Started \| Finished \|/, 'the header comes with the row');
  assert.match(body, /\n\|---\|/, 'and so does the delimiter, without which it is not a table');
  assert.match(body, /M18 — gap #9 backfill/);
  assert.doesNotMatch(body, /M17/, 'but not the neighbouring rows');
});

test('emphasis inside a heading is dropped, because bold does not nest', () => {
  // 38 headings emphasise a word against the rest of their title. Demoting the heading by wrapping
  // it in `**` produced `**a — **b** c**`, which renders as bold "a — ", plain "b", and a literal
  // `c**` — a uniform defect, one per affected entry, in a document whose whole claim is fidelity.
  const record = ['### D300 — a rule blocked by a **failed instrument** is announced', '', 'The statement.', ''].join('\n');
  const body = extractBlock(record, { line: 1, kind: 'heading', headingLevel: 3 });
  assert.equal(body.split('\n')[0], '**D300 — a rule blocked by a failed instrument is announced**');
});

test("a heading's own section number is dropped, because it addresses a contents page the reader lacks", () => {
  // 33 headings open with the record's internal numbering. It is not a location a reader of the
  // index can use, and it is not even unique across the corpus: `M98b` is section 3 of one plan and
  // `M99b` is section 3 of another, so published side by side the two numbers read as a
  // contradiction rather than as an address.
  const record = ['### 1.10 Extended UI capabilities (D14)', '', 'The statement.', ''].join('\n');
  assert.equal(
    extractBlock(record, { line: 1, kind: 'heading', headingLevel: 3 }).split('\n')[0],
    '**Extended UI capabilities (D14)**',
  );
  const numbered = ['## 3. M98b — the facts the lexer withholds', '', 'The statement.', ''].join('\n');
  assert.equal(
    extractBlock(numbered, { line: 1, kind: 'heading', headingLevel: 2 }).split('\n')[0],
    '**M98b — the facts the lexer withholds**',
  );
});

test("a ledger marker under a heading is stepped over, not published as the statement", () => {
  // `plan:closes-at` is `verify-ledger.mjs`'s, read from anywhere in the file and by convention put
  // directly under the title. It is a paragraph by every blank-line rule, so in four plans it won
  // the statement slot and the entry published a marker addressed to a script instead of the
  // opening paragraph sitting one blank line below it.
  const record = [
    '# `M128` — pentest arc Tier 1',
    '',
    '<!-- plan:closes-at M128c -->',
    '',
    'Opens the security arc, the last before `1.0.0`.',
    '',
  ].join('\n');
  assert.equal(
    extractBlock(record, { line: 1, kind: 'heading', headingLevel: 1 }),
    '**`M128` — pentest arc Tier 1**\n\nOpens the security arc, the last before `1.0.0`.',
  );

  // Two markers with no blank line between them are one paragraph, and `M144` has exactly that.
  const pair = [
    '# M144 — documentation that asserts false things',
    '',
    '<!-- plan:closes V4-12, A2-16 -->',
    '<!-- plan:closes-at M144b -->',
    '',
    '**Status: GRILLED 2026-08-19.** Order 4 of the ledger drawdown.',
    '',
  ].join('\n');
  assert.match(extractBlock(pair, { line: 1, kind: 'heading', headingLevel: 1 }), /Order 4 of the ledger drawdown\.$/);

  // Whole lines only. A comment that shares a line with prose is part of that prose's bytes, and
  // `D668` does not let the extractor edit a line it publishes.
  const inline = ['## M99', '', 'The statement. <!-- a note -->', ''].join('\n');
  assert.match(extractBlock(inline, { line: 1, kind: 'heading', headingLevel: 2 }), /The statement\. <!-- a note -->/);
});

test('a section heading ends the numbered item above it', () => {
  // `PLAN.md`'s founding list is interrupted by `### Round N` headings naming the sessions the
  // decisions were taken in. Spans that ran to the *next numbered item* carried the heading along,
  // and because the index renders each entry under its own `###`, five dates ended up in the
  // published outline looking like entries with no body.
  const plan = [
    '# Plan',
    '',
    '12. **Stack** — TypeScript/Node monorepo.',
    '',
    '### Round 2 (2026-07-05) — assertions, maintainability, structure',
    '',
    '13. **Assertion vocabulary** — one uniform form.',
    '',
  ].join('\n');
  const items = collectLegacy(plan);
  assert.doesNotMatch(items.get('12'), /Round 2/, 'the heading belongs to neither item');
  assert.match(items.get('12'), /TypeScript\/Node monorepo/);
  assert.match(items.get('13'), /one uniform form/, 'and the item after the heading still resolves');
});

// --- D686, the provenance line and the report it gave its detail to ---------------------------------

test('no published provenance line carries a line number', () => {
  const dir = fixture();
  run(dir);
  const subs = decisions(dir).split('\n').filter((ln) => ln.startsWith('<sub>cited from'));
  assert.ok(subs.length >= 3, 'the fixture publishes three entries, each with a provenance line');
  for (const ln of subs) {
    assert.doesNotMatch(ln, /\.md:\d/, `provenance must name files, not lines (D686): ${ln}`);
  }
});

test('--provenance names the anchor that was picked and the ones that lost', () => {
  const dir = fixture();
  // A second record anchors D7 as well. Nothing separates them — neither filename names a `D`,
  // both anchors are bold-led — so the ranking falls all the way through to its last tiebreak and
  // picks the alphabetically earlier file, which here is the *later* account. That is not a bug
  // and it is not right either; it is the arbitrary residue `D682`'s proofing pass exists to catch,
  // and it is only catchable because the report names the anchor that lost.
  writeFileSync(join(dir, 'PLAN_LATER.md'), [
    '# Later',
    '',
    '**`D7` — a second, later account of the same decision.** Kept deliberately different, so a',
    'wrong pick would be legible in the published text rather than invisible.',
    '',
  ].join('\n'), 'utf8');

  const report = run(dir, ['--provenance']);
  assert.equal(report.code, 0, `--provenance failed:\n${report.stderr}`);
  assert.match(report.stdout, /^D7\tPLAN_LATER\.md:\d+ \(boldLead\)$/m, 'the pick is named with its line and form');
  assert.match(report.stdout, /not picked {2}PLAN_M7_SESSIONS\.md:\d+ \(boldLead\)/, 'the losing anchor is named too');
  assert.match(report.stdout, /cited at {4}SPEC\.md:\d+/, 'and the citing sites keep the lines the published file dropped');

  // The report is a report: it must not have written anything.
  const check = run(dir, ['--check']);
  assert.equal(check.code, 1, '--provenance must not regenerate, so the new rival leaves the tree stale');
});

test('--provenance refuses where the records are absent, like generation does', () => {
  const dir = fixture({ withRecords: false });
  const report = run(dir, ['--provenance']);
  assert.equal(report.code, 1, 'a runner with no records cannot report on picks it cannot see');
  assert.match(report.stderr, /cannot report on DECISIONS\.md/);
});

// --- D675, both directions, shown failing ---------------------------------------------------------

test('deleting an entry fails the gate', () => {
  const dir = fixture();
  run(dir);
  const gutted = decisions(dir).replace(/### D7\n\n<sub>[^\n]*<\/sub>\n\n/, '');
  assert.notEqual(gutted, decisions(dir), 'the fixture edit must actually remove the entry heading');
  setDecisions(dir, gutted);

  const check = run(dir, ['--check']);
  assert.equal(check.code, 1, 'an index missing an entry its prose cites must not exit 0');
  assert.match(check.stderr, /D7/);
  assert.match(check.stderr, /no entry in DECISIONS\.md/);
});

test('adding a citation with no entry fails the gate', () => {
  const dir = fixture();
  run(dir);
  writeFileSync(join(dir, 'README.md'), '# readme\n\nAs decided in `D999`.\n', 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: dir });

  const check = run(dir, ['--check']);
  assert.equal(check.code, 1, 'a new citation with nothing to resolve to must go red');
  assert.match(check.stderr, /D999/);
});

test('an entry nothing cites fails the gate, in the other direction', () => {
  const dir = fixture();
  run(dir);
  const orphaned = decisions(dir).replace(
    '<!-- GENERATED:decisions:end -->',
    '### D404\n\n<sub>cited from nowhere · lifted from `PLAN.md`</sub>\n\nAn entry that grew on its own.\n\n<!-- GENERATED:decisions:end -->',
  );
  setDecisions(dir, orphaned);

  const check = run(dir, ['--check']);
  assert.equal(check.code, 1, 'the index publishes what the repo asks for and nothing else (D675)');
  assert.match(check.stderr, /D404/);
  assert.match(check.stderr, /cited by nothing/);
});

test('a missing DECISIONS.md fails rather than skipping', () => {
  const dir = fixture();
  run(dir);
  rmSync(join(dir, 'DECISIONS.md'));
  const check = run(dir, ['--check']);
  assert.equal(check.code, 1, 'a check whose subject is absent is green about nothing (`M131-03`)');
  assert.match(check.stderr, /does not exist/);
});

// --- D676, the scrub gate -------------------------------------------------------------------------

test('a planted build host fails the scrub gate end to end', () => {
  const dir = fixture();
  run(dir);
  setDecisions(dir, decisions(dir).replace('A session is established', 'Measured on fedora-box. A session is established'));

  const check = run(dir, ['--check']);
  assert.equal(check.code, 1, 'the internal build host must never reach a public commit');
  assert.match(check.stderr, /must not be published/);
  assert.match(check.stderr, /fedora-box/);
});

test('the scrub classes catch a host, a personal address and a home path', () => {
  assert.deepEqual(scrub('rendered on fedora-box overnight').map((d) => d.hit), ['fedora-box']);
  assert.deepEqual(scrub('reachable at fedora.local:8188').map((d) => d.hit), ['fedora.local']);
  assert.deepEqual(scrub('mail someone@gmail.com about it').map((d) => d.hit), ['someone@gmail.com']);
  assert.deepEqual(scrub('/Users/someone/Documents/testFlow').map((d) => d.hit), ['/Users/someone/']);
  assert.deepEqual(scrub('/home/someone/git/tflw').map((d) => d.hit), ['/home/someone/']);
});

test('the scrub gate allows the addresses that are legitimately public', () => {
  // A rule that fired on the repo's own contact address, or on the RFC example domains the docs are
  // written against, would be switched off within a week — and a gate nobody runs guards nothing.
  assert.deepEqual(scrub('reach the maintainers at hello@tflw.dev'), []);
  assert.deepEqual(scrub('post to https://api.example.com and mail user@example.org'), []);
});

// --- D875, the corpus each scrub rule declares ----------------------------------------------------
//
// THIS FILE IS THE ONE `SCRUB_EXEMPT` NAMES, and the tests below are why. The tracked sweep reads
// every tracked text file; the specimens a scrub test needs are, by construction, exactly the things
// the sweep must report. So the exemption is per-file and per-rule, it carries its reason in the
// declaration, and `staleExemptions` fails the gate if the specimens ever leave — an exemption that
// stops exempting anything is a line that blinds a whole file for a reason that is no longer true.

test('a rule runs over a region only when the region lies inside its declared corpus', () => {
  // The host rule's corpus is `generated`; the other two cover the whole tracked tree. `generated`
  // lies inside `tracked`, so the generated block is subject to all three and an ordinary tracked
  // file is subject to two. This is the entire content of `M164-09`'s repair, in one assertion.
  assert.deepEqual(scrub('measured on fedora-box', 'generated').map((d) => d.id), ['host']);
  assert.deepEqual(scrub('measured on fedora-box', 'tracked').map((d) => d.id), []);
  assert.deepEqual(scrub('mail someone@gmail.com', 'generated').map((d) => d.id), ['email']);
  assert.deepEqual(scrub('mail someone@gmail.com', 'tracked').map((d) => d.id), ['email']);
});

test('the default region is the narrower one, so an unannotated call runs more rules and not fewer', () => {
  // A default that widened the region would quietly disarm the host rule at every existing call
  // site. Failing closed is the only defensible direction for a default on a publication gate.
  assert.deepEqual(scrub('measured on fedora-box'), scrub('measured on fedora-box', 'generated'));
  assert.notDeepEqual(scrub('measured on fedora-box'), scrub('measured on fedora-box', 'tracked'));
});

test('an unknown region throws rather than matching nothing', () => {
  // `WITHIN[region]` would be `undefined` and the filter would return no rules at all — a clean
  // green over a corpus nobody declared, which is the failure this milestone is named after.
  assert.throws(() => scrub('measured on fedora-box', 'everything'), /unknown region/);
});

test('an npm coordinate is a version, not an address (`D877`)', () => {
  // Eleven of the 41 hits the email rule returned over the tracked corpus were these. No allow-list
  // separates them by domain, because what distinguishes them is that a version is not a hostname.
  assert.deepEqual(scrub('tflw-monorepo@0.1.0 depends on lang@0.1.0 and tflw@0.1.0', 'tracked'), []);
  assert.equal(scrub('sha512-Xg+M7w== is a hash tail', 'tracked').length, 0);
});

test('a fixture address on a reserved TLD is allowed and one on a registered domain is not (`D878`)', () => {
  // RFC 2606 reserves `.test` and `.invalid` precisely so a fixture need not borrow a real domain.
  assert.deepEqual(scrub('alice@example.test wrote to t@example.invalid', 'tracked'), []);
  assert.deepEqual(scrub('a@x.com wrote to g@y.com', 'tracked').map((d) => d.hit), ['a@x.com', 'g@y.com']);
});

test('the account the PR history already publishes is allowed, and a personal one is not', () => {
  assert.deepEqual(scrub('33311251+deepak-tuteja@users.noreply.github.com', 'tracked'), []);
  assert.deepEqual(scrub('someone@gmail.com', 'tracked').map((d) => d.hit), ['someone@gmail.com']);
});

test('a placeholder home directory names nobody; a real account does', () => {
  assert.deepEqual(scrub('/home/user/project and /home/runner/work/x', 'tracked'), []);
  assert.deepEqual(scrub('/home/deepaktuteja/git', 'tracked').map((d) => d.hit), ['/home/deepaktuteja/']);
  assert.deepEqual(scrub('/Users/someone/Documents', 'tracked').map((d) => d.hit), ['/Users/someone/']);
});

test('an exemption that no longer exempts anything is a failure, not a shrug (`D879`)', () => {
  const exempt = [{ file: 'a/b.mjs', rules: ['email', 'home'], why: 'x' }];
  const tracked = new Set(['a/b.mjs']);
  assert.equal(staleExemptions(new Map(), tracked, exempt).length, 2);
  assert.deepEqual(
    staleExemptions(new Map([['a/b.mjs email', 1]]), tracked, exempt),
    [{ file: 'a/b.mjs', rule: 'home' }],
  );
  // An exemption for a file this tree does not track is inapplicable to this sweep, not stale —
  // otherwise every fixture tree in this file would report the real repository's exemption list.
  assert.deepEqual(staleExemptions(new Map(), new Set(), exempt), []);
});

test('the tracked sweep says it could not run rather than reporting a clean tree (`D880`)', () => {
  // `git ls-files` is the only enumerator of this corpus, and the offload driver's tree has no
  // `.git` at all. An unenumerable corpus and an empty one otherwise print the same number.
  const notARepo = mkdtempSync(join(tmpdir(), 'tflw-not-a-repo-'));
  temps.push(notARepo);
  const r = scrubTracked(notARepo);
  assert.equal(r.ran, false);
  assert.match(r.why, /could not be enumerated/);
});

test('a personal address in a tracked file fails the check, though the generated block is clean', () => {
  const dir = fixture({ code: { 'src/mailer.ts': 'export const OWNER = "someone@gmail.com";\n' } });
  run(dir);
  const check = run(dir, ['--check']);
  assert.equal(check.code, 1, 'a tracked file is published as surely as the generated block is');
  assert.match(check.stderr, /tracked files must not be published/);
  assert.match(check.stderr, /src\/mailer\.ts/);
  assert.match(check.stderr, /someone@gmail\.com/);
});

test('a home path naming a real account in a tracked file fails the check', () => {
  const dir = fixture({ code: { 'src/paths.ts': 'export const ROOT = "/home/deepaktuteja/git/tflw";\n' } });
  run(dir);
  const check = run(dir, ['--check']);
  assert.equal(check.code, 1);
  assert.match(check.stderr, /\/home\/deepaktuteja\//);
});

test('the build host in a tracked file does NOT fail the check — that rule declares a narrower corpus (`D876`)', () => {
  // The load-bearing negative control for the narrowing half of `M171b`. Four provenance comments in
  // shipped `src` name the host on purpose: their job is to tell a reader *this number was not
  // measured on your machine*. A rule that fired on them would be deleted, and the generated block
  // — where a hostname arrives by lift rather than by someone typing it — would lose its only guard.
  const dir = fixture({ code: { 'src/perf.ts': '// measured on fedora-box, not on your machine\n' } });
  run(dir);
  const check = run(dir, ['--check']);
  assert.equal(check.code, 0, check.stderr);
  assert.match(check.stdout, /tracked files swept/);
});

test('a clean tree says how many tracked files it swept, so the green states what it read', () => {
  const dir = fixture();
  run(dir);
  const check = run(dir, ['--check']);
  assert.equal(check.code, 0, check.stderr);
  assert.match(check.stdout, /\d+ tracked files swept/);
});

// --- D683, the tier that must announce its own absence ---------------------------------------------

test('with no records present, the check runs the tracked tiers and exits 0', () => {
  const dir = fixture();
  run(dir);
  rmSync(join(dir, 'PLAN.md'));
  rmSync(join(dir, 'PLAN_M7_SESSIONS.md'));

  const check = run(dir, ['--check']);
  assert.equal(check.code, 0, 'conformance and scrub have both sides tracked, so a runner can and must still run them');
});

test('with no records present, the check names the tier it could not run', () => {
  const dir = fixture();
  run(dir);
  rmSync(join(dir, 'PLAN.md'));
  rmSync(join(dir, 'PLAN_M7_SESSIONS.md'));

  const { stdout } = run(dir, ['--check']);
  assert.match(stdout, /NOT CHECKED HERE/, 'a tier that silently does not run reads exactly like a tier that passed (`D527`)');
  assert.doesNotMatch(stdout, /match the design records/, 'and it must not borrow the wording of the tier it skipped');
});

test('conformance still fails on a runner with no records', () => {
  // The half that can run has to keep its teeth when the other half is absent, or the CI tier is
  // decorative — which is the failure mode `D683` was written to avoid rather than to introduce.
  const dir = fixture();
  run(dir);
  setDecisions(dir, decisions(dir).replace(/### D7\n/, '### D8\n'));
  rmSync(join(dir, 'PLAN.md'));
  rmSync(join(dir, 'PLAN_M7_SESSIONS.md'));

  const check = run(dir, ['--check']);
  assert.equal(check.code, 1);
  assert.match(check.stderr, /D7/);
});

test('generation refuses to run where the records are absent, instead of writing an empty index', () => {
  const dir = fixture({ withRecords: false });
  const gen = run(dir);
  assert.equal(gen.code, 1);
  assert.match(gen.stderr, /cannot generate/);
});

test('an identifier with no anchor is reported, not silently omitted', () => {
  const dir = fixture({ spec: '# Spec\n\nAs `D7` says, and also `D888`.\n' });
  const gen = run(dir);
  assert.equal(gen.code, 1, 'an unresolvable citation is a finding about the records');
  assert.match(gen.stderr, /D888/);
  assert.match(gen.stderr, /no anchor/);
});

test('a tree with no .git is diagnosed, not crashed through', () => {
  // Not hypothetical: `scripts/exec.mjs` rsyncs this repo to the box **excluding** `.git/`, so the
  // gate genuinely cannot run through the offload driver that the suite and the typecheck do run
  // through. Before this it died in an unhandled `execFileSync` throw, which reads as a broken gate
  // rather than as a gate that was handed a tree it cannot check. It still fails: a check that
  // cannot see its input has not passed (`M131-03`).
  const dir = fixture();
  run(dir);
  rmSync(join(dir, '.git'), { recursive: true, force: true });

  const check = run(dir, ['--check']);
  assert.equal(check.code, 1);
  assert.match(check.stderr, /cannot list the tracked files/);
  assert.doesNotMatch(check.stderr, /at Object\.execFileSync/, 'a stack trace is not a diagnosis');
});

// --- the citation grammar itself ------------------------------------------------------------------

test('the citation pattern reads the three spellings and refuses their near-misses', () => {
  const hits = (s) => [...s.matchAll(CITATION)].map((m) => m[1]);
  assert.deepEqual(hits('`P#43`, `D318` and `M137d` are cited'), ['P#43', 'D318', 'M137d']);
  assert.deepEqual(hits('the anchor #D12 and the variable xM4'), [], 'an anchor fragment and an identifier-like word are not citations');
  assert.deepEqual(hits('see P#43 alone'), ['P#43'], 'the `#` must stop `43` being re-read as a bare number');
  assert.deepEqual(hits('M9a2 is a sub-milestone'), ['M9a2']);
});

test('a range citation expands to its interior', () => {
  const spans = (s) => [...s.matchAll(RANGE)].map((m) => [m[1], Number(m[2]), Number(m[3])]);
  assert.deepEqual(spans('`D93-D122` covers the arc'), [['D', 93, 122]]);
  assert.deepEqual(spans('M9–M28 shipped'), [['M', 9, 28]], 'an en dash is the spelling CHANGELOG.md actually uses');
  const cited = collectCitations([{ path: 'SPEC.md', text: 'The arc `D5-D9` shipped.' }]);
  assert.deepEqual([...cited.keys()].sort(byId), ['D5', 'D6', 'D7', 'D8', 'D9']);
  assert.equal(cited.get('D7').viaRange, true, 'an interior identifier is reached only through the range');
  assert.equal(cited.get('D5').viaRange, false, 'an endpoint is cited directly');
});

// --- M169a: the five shapes the grammar invented when it was pointed at code (`D861`) ---------
//
// `M164-08` filed two of these. Pointing `collectCitations` at tracked code found three more, and
// the largest was not the one the row named. Every rule below was measured against the live corpus
// before it was written (D716) and `DECISIONS.md` is byte-identical across all five.

test('a base64 tail is not a citation, and a slash-separated list still is', () => {
  const hits = (s) => [...s.matchAll(CITATION)].map((m) => m[1]);
  assert.deepEqual(hits('"integrity": "sha512-Xg+M7w=="'), [], 'the `+` and `=` of base64 are not citation boundaries');
  // The two guards are asserted separately on purpose. The case above dies to either one, so on its
  // own it would pass with either reverted; each of these is reachable only through the guard it
  // names — `/` is not a boundary (see below), and a `-` before the body is not one either.
  assert.deepEqual(hits('sha512-Xg+M7w/Q=='), [], 'the lookbehind: a `+` in front of an identifier is base64, not prose');
  assert.deepEqual(hits('sha512-M137d+abc'), [], 'the lookahead: a `+` after one is base64 too');
  // The other half of the same rule, and the reason `M164-08`'s proposed `/` was NOT taken: measured
  // over the tracked markdown corpus it costs 288 real citations, of which these are three.
  assert.deepEqual(hits('the decisions 97/98/102 are `D97/D98/D102`'), ['D97', 'D98', 'D102'], 'a slash is how this corpus writes a list');
  assert.deepEqual(hits('`M130b/M134a` both apply'), ['M130b', 'M134a']);
});

test('a possessive cites the milestone it is possessive of', () => {
  const hits = (s) => [...s.matchAll(CITATION)].map((m) => m[1]);
  // `packages/lang/test/teaching.test.ts:223`, verbatim — the apostrophe was dropped when it was
  // written, and the old class read the `s` as a sub-milestone of a milestone that is anchored.
  assert.deepEqual(hits('keeps M84s exact wording'), ['M84'], 'the site cites M84; `M84s` is defined nowhere');
  assert.deepEqual(hits("keeps M84's exact wording"), ['M84'], 'and it reads the same with the apostrophe present');
  assert.deepEqual(hits('M9a2 and M137d and D427a survive'), ['M9a2', 'M137d', 'D427a'], 'every other sub-milestone form is untouched');
  assert.deepEqual(hits('the field M4sync'), [], 'a trailing `s` is a possessive, not a licence to match a longer word');
});

test('a range does not cross two sequences, and a dash with space around it is punctuation', () => {
  // `packages/lsp-server/test/protocol.test.ts` writes `M136b — D427`. Read as a span that is 290
  // invented identifiers out of two citations and a piece of sentence punctuation — the largest
  // single source of false demand in either repository, and it is not a range in any sense.
  const cited = collectCitations([{ path: 'SPEC.md', text: 'see `M136b` — `D427` for the reason' }]);
  assert.deepEqual([...cited.keys()].sort(byId), ['M136b', 'D427'].sort(byId));
  const spans = (s) => [...s.matchAll(RANGE)].map((m) => [m[1], Number(m[2]), Number(m[3])]);
  assert.deepEqual(spans('M136b — D427'), [], 'two sequences are not one span');
  assert.deepEqual(spans('D93 - D122'), [], 'a spaced dash is prose punctuation; every range in this corpus is tight');
  assert.deepEqual(spans('`D93-D122` covers the arc'), [['D', 93, 122]], 'and the form the corpus actually uses is unaffected');
});

test('a range-shaped string in code supplies no interior', () => {
  // `D861`: RANGE must not expand inside a corpus it did not author. `grammarCoverage.test.ts`
  // names a coverage span; expanding it manufactures 23 identifiers no site cites.
  const code = collectCitations([{ path: 'packages/lang/test/grammarCoverage.test.ts', text: "const span = 'M29-M53';" }]);
  assert.deepEqual([...code.keys()].sort(byId), ['M29', 'M53'], 'the two endpoints are cited; the interior is not');
  const prose = collectCitations([{ path: 'CHANGELOG.md', text: 'the arc `M29-M53` shipped' }]);
  assert.equal(prose.has('M40'), true, 'the same string in prose still expands — this is a corpus rule, not a grammar one');
  assert.equal(expandsRanges('SPEC.md'), true);
  assert.equal(expandsRanges('scripts/gen-decisions.mjs'), false);
});

test("the gate's own negative fixtures stay grammatical, because that is what makes them fixtures", () => {
  // The fifth shape, and the one the grammar must NOT solve. This file cites `D888`, `D999` and
  // `M9a2` precisely because they resolve to nothing — that is how the unresolved-citation report is
  // tested. A grammar rule that stopped reading them would delete the control instead of exempting
  // it, so the exclusion belongs to the corpus (`D860`, `M169b`) and is pinned here as a boundary.
  const hits = (s) => [...s.matchAll(CITATION)].map((m) => m[1]);
  assert.deepEqual(hits('`D888`, `D999` and `M9a2` resolve to nothing, on purpose'), ['D888', 'D999', 'M9a2']);
});

test('a reversed or degenerate range contributes no interior', () => {
  // `M137d–M137e` is two sub-milestones of one number, not a span; the endpoints are equal and
  // there is nothing between them to publish.
  const cited = collectCitations([{ path: 'SPEC.md', text: 'see `M137d-M137e` and `D9-D5`' }]);
  assert.deepEqual([...cited.keys()].filter((id) => cited.get(id).viaRange), []);
});

test('a citation inside a product fence is output, not prose', () => {
  const text = ['before `D1`', '', '```tflw', '# emitted by tflw M137d — a line the tool prints', '```', '', '```', '# D2, authored EBNF comment', '```', ''].join('\n');
  const cited = collectCitations([{ path: 'GRAMMAR.md', text }]);
  assert.ok(cited.has('D1'));
  assert.ok(!cited.has('M137d'), 'quoted tool output is not a citation (D673)');
  assert.ok(cited.has('D2'), 'an untagged fence carries authored prose — 89 of GRAMMAR.md\'s citations live in one');
});

test('DECISIONS.md is not a citation surface for itself', () => {
  const cited = collectCitations([{ path: 'DECISIONS.md', text: '### D7\n\nA decision citing `D8`.\n' }]);
  assert.equal(cited.size, 0, 'counting its own headings would let the index satisfy D675 by existing');
});

// --- reading the published file back ---------------------------------------------------------------

test('publishedIds reads entry headings and ignores headings inside a lifted block', () => {
  // This was a live case and is no longer one, which is worth saying rather than leaving the comment
  // to imply otherwise: five `### Round N (2026-07-05) — …` headings from `PLAN.md` used to arrive
  // inside lifted blocks, and a looser reader would have counted them as entries and reported them
  // as orphans — failing the gate over the index's own output. The extractor stopped emitting them
  // ('a section heading ends the numbered item above it'), so what this now defends is the general
  // property: a `###` line inside a block is not an identifier, whatever put it there.
  const text = [
    '<!-- GENERATED:decisions:start -->', '',
    '### P#43', '', 'body', '',
    '### D7', '', 'body which itself contains:', '',
    '### Round 2 (2026-07-05) — assertions, maintainability, structure', '', 'more body', '',
    '<!-- GENERATED:decisions:end -->', '',
  ].join('\n');
  assert.deepEqual([...publishedIds(text)].sort(byId), ['P#43', 'D7']);
});

test('conformance names both directions separately', () => {
  const { missing, orphan } = conformance(new Set(['D1', 'D2']), new Set(['D2', 'D3']));
  assert.deepEqual(missing, ['D1']);
  assert.deepEqual(orphan, ['D3']);
});

test('entries sort by namespace then number, so P#43 and D43 cannot interleave', () => {
  assert.deepEqual(['M2', 'D43', 'P#43', 'D7', 'P#9'].sort(byId), ['P#9', 'P#43', 'D7', 'D43', 'M2']);
});

// --- extraction shapes that cost something to get wrong ---------------------------------------------

test('a list item ends at its next sibling, not at the next blank line', () => {
  // `PLAN.md`'s roadmap is one unbroken list. A blank-line rule read `M1` as everything from the
  // API vertical slice to the end of the roadmap — 20 KB — and then the same 20 KB again under `M2`.
  const text = [
    '- **M1 — API vertical slice.** The first one.',
    '',
    '  A continuation paragraph that belongs to M1.',
    '',
    '- **M2 — the next one.** Not part of M1.',
  ].join('\n');
  const body = extractBlock(text, { line: 1, kind: 'listBold', headingLevel: 0 });
  assert.match(body, /A continuation paragraph/);
  assert.doesNotMatch(body, /M2 — the next one/);
});

test('filename affinity outranks anchor form when two records define the same milestone', () => {
  // A `### \`M137d\`` heading in a later plan reviewing the work is a citation wearing a heading.
  const chosen = pickAnchor('M137d', [
    { file: 'PLAN_M147_LAST_ORDER.md', line: 10, kind: 'heading', headingLevel: 3 },
    { file: 'PLAN_M137_PENTEST_TIER4.md', line: 900, kind: 'listBold', headingLevel: 0 },
  ]);
  assert.equal(chosen.file, 'PLAN_M137_PENTEST_TIER4.md', 'the plan that took the decision wins over a later mention');

  // And the letter is part of the name, not decoration. `M130b` has its own record and a number-only
  // affinity could not see it — after `PLAN_M130` comes `B`, not a separator — so the file scored as
  // unrelated and `M130b` was lifted from a caption inside its *parent* plan, four numbered items it
  // introduced published without them.
  const suffixed = pickAnchor('M130b', [
    { file: 'PLAN_M130_PENTEST_TIER2.md', line: 598, kind: 'boldLead', headingLevel: 0 },
    { file: 'PLAN_M130B_AUTHZ_ENGINE.md', line: 1, kind: 'h1', headingLevel: 1 },
  ]);
  assert.equal(suffixed.file, 'PLAN_M130B_AUTHZ_ENGINE.md', "the suffixed record beats its parent's");

  // The parent is still the second tier, not a tie with strangers: `M130` itself has no suffixed
  // record and must still land in `PLAN_M130_*`.
  const parent = pickAnchor('M130', [
    { file: 'PLAN_M136_ARC_DEBT.md', line: 40, kind: 'heading', headingLevel: 3 },
    { file: 'PLAN_M130_PENTEST_TIER2.md', line: 1, kind: 'h1', headingLevel: 1 },
  ]);
  assert.equal(parent.file, 'PLAN_M130_PENTEST_TIER2.md');
});

test('the legacy sequence indexes PLAN.md\'s ordered list, sub-items included', () => {
  const legacy = collectLegacy([
    '99. **Client certificates.** The outer item.',
    '',
    '    **(b) mTLS** — the lettered sub-feature that `P#99b` names.',
    '',
    '100. **The next item.**',
  ].join('\n'));
  assert.match(legacy.get('99'), /Client certificates/);
  assert.match(legacy.get('99b'), /mTLS/);
  assert.doesNotMatch(legacy.get('99'), /The next item/);
});

test('a ledger row id is not an anchor for the milestone whose number it starts with', () => {
  // `M133-01` is a row of the review ledger — the fourth citation namespace, which this index
  // publishes mentions of and never content from. Every anchor pattern ended `[—.:-]`, and that
  // trailing hyphen matched the row id's own, so `**\`M133-01\` stays at eleven words**` registered
  // as a definition of `M133`. It won, and `M133` was published as a sentence from `M135`'s plan
  // about what `M135` does *not* add. 56 anchors across 26 identifiers were this shape.
  const anchors = collectAnchors([
    {
      path: 'PLAN_M135_SARIF.md',
      text: [
        '**`M133-01` stays at eleven words** — this milestone adds nothing to the D24b catch-up.',
        '',
        '- **`M97d-01`** (nine config-only keywords absent from both wordlists) — Tier 3 adds two.',
      ].join('\n'),
    },
  ]);
  assert.equal(anchors.get('M133'), undefined, 'a row id does not define the milestone it is filed by');
  assert.equal(anchors.get('M97d'), undefined, 'nor does a lettered one');

  // The guard is one character wide, so the ordinary forms have to be shown still working.
  const real = collectAnchors([{ path: 'PLAN_M133_X.md', text: '**`M133` — the editor catch-up.**' }]);
  assert.equal(real.get('M133')?.[0].kind, 'boldLead');
});

test('the plan that documents the index is not a source for the entries it tabulates', () => {
  // `PLAN_M152_DECISION_PROVENANCE.md` has a proofing table with a row per entry, so 11 of its rows
  // became anchor candidates for identifiers they only discuss — including the row recording that
  // `M133` is published from the wrong record, which would then have been published *as* `M133`.
  // It is still where `D666`-`D688` are taken, and those are written the way every plan writes a
  // decision: the block's title is the identifier.
  const anchors = collectAnchors([
    {
      path: 'PLAN_M152_DECISION_PROVENANCE.md',
      text: [
        '### `D687` — the index\'s own citations are `M152b`\'s',
        '',
        'The decision itself.',
        '',
        '| `M133` | *(not a member)* — publishes a sentence from the wrong record | `§8.3` |',
      ].join('\n'),
    },
  ]);
  assert.equal(anchors.get('D687')?.[0].kind, 'heading', 'its own decisions still anchor');
  assert.equal(anchors.get('M133'), undefined, 'a row about an entry is not that entry');
});

test('an index table naming the id in its second column is the weakest anchor, and the only one M133 has', () => {
  // `M133` is the corpus's one milestone with neither a plan of its own nor a `PROGRESS.md` entry.
  // The single block that states it is a row of its arc's index, whose first column is the tier and
  // whose second is the milestone — a shape no pattern reached, because every table rule required
  // the id in the lead cell.
  const record = [
    '| | milestone | what |',
    '|---|---|---|',
    '| Tier 2 debt | `M132a`/`M132b` | D350-D363, the tier\'s own ledger cleared |',
    '| editors | `M133` | D24b\'s LSP/VS Code catch-up, batched across Tier 1 **and** Tier 2 grammar |',
  ].join('\n');
  const anchors = collectAnchors([{ path: 'PLAN_BROWSER_PERF_SECURITY.md', text: record }]);
  assert.equal(anchors.get('M133')?.[0].kind, 'tableSecond');

  // It ranks last, so it can never take an identifier that has any other block at all.
  const chosen = pickAnchor('M133', [
    { file: 'PLAN_BROWSER_PERF_SECURITY.md', line: 4, kind: 'tableSecond', headingLevel: 0 },
    { file: 'PLAN_M132_TIER2_DEBT.md', line: 9, kind: 'tableRow', headingLevel: 0 },
  ]);
  assert.equal(chosen.kind, 'tableRow', 'the lead-cell row still outranks it');

  // And the row publishes with the header it is a row of: on its own, `| a | b |` has no delimiter
  // line, so every renderer shows literal pipes.
  const body = extractBlock(record, { line: 4, kind: 'tableSecond', headingLevel: 0 });
  assert.match(body, /^\| \| milestone \| what \|\n\|---\|---\|---\|\n\| editors \| `M133`/);
});

test('every identifier the preamble names resolves in the index the preamble introduces', () => {
  // `D690`. The entries cannot drift from the records — `D668` regenerates them — but the preamble
  // is hand-written, and six of its claims had gone stale by the time `M152a` was proofed. This is
  // the one that misled hardest: it illustrated the `P#n`/`D<n>` collision with `P#43` and `D43`,
  // and `D43` is cited only from source comments, which `§6` excludes. The index the sentence sits
  // on top of therefore had no `D43`, so the worked example was the one example that did not work.
  //
  // Reads the real, tracked `DECISIONS.md` rather than a fixture: the claim under test is about
  // this repository's actual index, and a fixture would only re-assert the generator's own output.
  const entries = publishedIds(readFileSync(join(ROOT, 'DECISIONS.md'), 'utf8'));
  assert.ok(entries.size > 400, 'sanity: the index was located');

  const named = [...new Set([...PREAMBLE.matchAll(/`(P#\d{1,3}|D\d{1,3}[a-z]?|M\d{1,3}[a-z]?\d?)`/g)]
    .map((m) => m[1]))];
  assert.ok(named.length >= 8, 'sanity: the preamble names worked examples');

  const dangling = named.filter((id) => !entries.has(id));
  assert.deepEqual(dangling, [], `the preamble names ${dangling.join(', ')}, which the index does not resolve`);
});

// --- M152e: the sibling's citations (`D709`, `D710`) ----------------------------------------------

test('an identifier only the sibling cites gets an entry', () => {
  // `D709`'s defect, in one assertion. `D7` is defined in the fixture's records and cited by
  // nothing in the fixture's own prose — the exact shape of the 94 identifiers `testFlow-tests`
  // used against an index that published 491 of the 585 it needed.
  const bare = ['# Spec', '', 'Nothing here cites anything.', ''].join('\n');
  const without = fixture({ spec: bare });
  assert.equal(run(without).code, 0);
  assert.ok(!publishedIds(decisions(without)).has('D7'), 'sanity: local prose does not ask for D7');

  const with_ = fixture({ spec: bare, sibling: { D7: ['VULNS.md'] } });
  assert.equal(run(with_).code, 0);
  assert.ok(publishedIds(decisions(with_)).has('D7'), 'the pin did not reach the index');
});

test('a sibling file is named by its repository in the provenance line', () => {
  // Both repositories have a `README.md`. A provenance line reading `cited from README.md` for a
  // file in the other one is not a small imprecision: the reader is being told where to look.
  const dir = fixture({ sibling: { D7: ['README.md'] } });
  assert.equal(run(dir).code, 0);
  const entry = decisions(dir).split('### D7')[1].split('###')[0];
  assert.match(entry, /cited from [^\n]*tflw-tests\/README\.md/);
});

test('an identifier the sibling cites only inside a range says so, rather than naming no file', () => {
  // `collectCitations` distinguishes a citation with a site from one implied by `D40–D44`, and the
  // pin has to carry that distinction across: an empty file list is range-only, not absent. Without
  // it the entry would render `cited from ` with nothing after it.
  const dir = fixture({ spec: '# Spec\n\nNothing here cites anything.\n', sibling: { D7: [] } });
  assert.equal(run(dir).code, 0);
  const entry = decisions(dir).split('### D7')[1].split('###')[0];
  assert.match(entry, /cited inside a range only/);
});

test('a missing pin fails loudly, rather than publishing 94 fewer entries', () => {
  // The failure this refuses is the quiet one. Drop the file and the index simply stops asking for
  // the sibling's identifiers — and the very next `--check` calls them orphans, which reads as
  // *delete these* and is the opposite of what happened.
  const dir = fixture({ sibling: { D7: ['VULNS.md'] } });
  rmSync(join(dir, 'scripts', 'sibling-citations.json'));
  const gen = run(dir);
  assert.notEqual(gen.code, 0);
  assert.match(gen.stderr, /sibling-citations\.json/);
  assert.match(gen.stderr, /refresh-sibling-citations/);
});

test('a pin naming an identifier the records do not define is unresolved, exactly like a local citation', () => {
  // The pin is a citation source, not a bypass. An identifier with no anchor is a finding about the
  // records whichever repository asked for it.
  const dir = fixture({ sibling: { D999: ['VULNS.md'] } });
  const gen = run(dir);
  assert.notEqual(gen.code, 0);
  assert.match(gen.stderr, /D999/);
});

// --- M152e: a label is not a statement -------------------------------------------------------------

test('a bold label whose only content is the list under it publishes the list', () => {
  // Three plans introduce a milestone's work this way, and the entry published the label alone:
  // ``**`M138b` — testFlow-tests**``, 28 characters, naming a repository and a milestone the reader
  // had just looked up. The list is the whole statement there is.
  const record = [
    'x',
    '**`M138b` — testFlow-tests**',
    '',
    '5. `verify-contributing.mjs` — the same classification for §2.3\'s 11 sites.',
    '6. `CONTRIBUTING.md` — including the cross-repo section moved from README.',
    '',
    '## Something else',
    '',
  ].join('\n');
  const body = extractBlock(record, { line: 2, kind: 'boldLead', headingLevel: 0 });
  assert.match(body, /verify-contributing\.mjs/);
  assert.match(body, /cross-repo section/);
  assert.ok(!body.includes('Something else'), 'the list must end before the next heading');
});

test('a bold lead that already carries prose is left where it ends', () => {
  // The control, and the reason the rule is keyed on a *single-line* block. A lead with a sentence
  // of its own has said something; reaching forward from it would publish the next list as though
  // the decision had introduced it.
  const record = [
    'x',
    '**`D77` — fix directly, no isolation diagnostic.** Unlike M41\'s mechanism, this one is',
    'confirmed, so there is nothing a throwaway harness would establish.',
    '',
    '1. An unrelated list that belongs to the section, not to the decision.',
    '',
  ].join('\n');
  const body = extractBlock(record, { line: 2, kind: 'boldLead', headingLevel: 0 });
  assert.match(body, /nothing a throwaway harness would establish/);
  assert.ok(!body.includes('An unrelated list'), 'the reach-forward fired on a lead that was not a label');
});

test('a single-line label followed by a paragraph does not reach forward either', () => {
  // The other edge of the same rule. Reaching forward is for a label whose statement is the list
  // under it; a label followed by prose is a lead whose block `takeStatement` already ends
  // correctly, and taking the paragraph after it would attribute somebody else's sentence to the
  // identifier. Only a list triggers it, and this is the assertion that says so.
  const record = [
    'x',
    '**`M138b` — testFlow-tests**',
    '',
    'A paragraph belonging to the section, which this milestone did not decide.',
    '',
  ].join('\n');
  const body = extractBlock(record, { line: 2, kind: 'boldLead', headingLevel: 0 });
  assert.equal(body, '**`M138b` — testFlow-tests**');
});

// --- M169b (`D858`, `D859`, `D860`) — the demand half -------------------------------------------
//
// WHAT IS NEW HERE is not a rule about what a citation is — `M169a` settled that — but a rule about
// which corpus a citation is read from and what resolving in it buys. `D675` used to be one
// sentence: every citation must have an entry. `D858` splits it, so tracked prose keeps the whole
// contract (resolve *and* publish) and tracked code gets only the first half.
//
// THE CLAIM THAT NEEDS A TEST is the half that is invisible when it works. A gate that reports dead
// pointers is easy to see failing; a gate that reports them *without publishing anything* looks
// identical to one that publishes quietly, because `DECISIONS.md` moving is the only symptom and it
// moves for a dozen other reasons. So the publish-nothing property is asserted directly, against the
// generated index, in the case where the identifier resolves — which is the case where a widening
// would have published it.
//
// THE EXCLUSION IS TESTED FROM BOTH SIDES, which is the property `D860` was amended to have. An
// identifier declared unresolvable is excused, and an identifier declared unresolvable that has
// started resolving is a **failure** — a declared non-existence must not quietly become a lie. A
// file-scoped exclusion could only ever have been tested in the first direction.

test('an identifier cited only in code, resolving to nothing, fails the demand check', () => {
  const dir = fixture({ code: { 'src/thing.ts': '// the retry rule is `M77` (see the records)\n' } });
  assert.equal(run(dir).code, 0, 'the fixture should generate cleanly before the demand check reads it');
  const r = run(dir, ['--demand']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /M77\b/);
  assert.match(r.stderr, /src\/thing\.ts:1/, 'a dead pointer is only actionable with the site that carries it');
});

test('a citation in code resolves without publishing, which is the whole of D858', () => {
  // `M7` is anchored in the fixture's records and cited by nothing in tracked prose, so under the
  // old single-corpus contract it had no entry. Citing it from a `.ts` file must make it resolve and
  // must NOT give it one — the acceptance clause of the milestone, as an assertion rather than a
  // sentence. The control is the byte comparison: the index generated with the code file present is
  // identical to the index generated without it.
  const withCode = fixture({ code: { 'src/thing.ts': '// sessions were reworked at `M7` and `D7` explains the percentiles\n' } });
  const without = fixture();
  assert.equal(run(withCode).code, 0);
  assert.equal(run(without).code, 0);
  assert.equal(decisions(withCode), decisions(without), 'a citation in code moved DECISIONS.md, which is exactly what D858 declines to do');

  const r = run(withCode, ['--demand']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /demand \(D858\)/);
});

test('an identifier declared unresolvable is excused, and the declaration is printed every run', () => {
  // `D888` is cited by `gen-decisions.test.mjs` precisely because it resolves to nothing. Under a
  // widened demand that citation becomes a finding about the gate's own negative control, so the
  // five declarations exist — and they are printed rather than applied silently, because an
  // exclusion nobody can see reads as coverage (`D860`, `D-M164-06-1`'s form).
  const dir = fixture({ code: { 'src/thing.ts': '// asserts that `D888` is reported as unresolved\n' } });
  const r = run(dir, ['--demand']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /declared unresolvable \(D860\)/);
  assert.match(r.stdout, /D888/);
  assert.ok(!r.stderr.includes('D888'), 'a declared identifier was reported as a finding as well as excused');
});

test('a declared identifier that has started resolving fails, because the declaration has become a lie', () => {
  // The direction a file-scoped exclusion could not be checked in, and the reason `D860` was amended
  // from files to identifiers before it shipped. If `D888` acquires an anchor, the declaration stops
  // describing the tree and starts excusing a real citation from the check — so it fails on the
  // declaration rather than passing on the citation.
  const dir = fixture({ code: { 'src/thing.ts': '// asserts that `D888` is reported as unresolved\n' } });
  writeFileSync(join(dir, 'PLAN_LATER.md'), '# Later\n\n**`D888` — a decision that now exists.** Which makes the declaration stale.\n', 'utf8');
  const r = run(dir, ['--demand']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /declared unresolvable[\s\S]*now resolve/i);
  assert.match(r.stderr, /D888/);
});

test('the demand corpus is code: an image and a markdown file are not read, a script is', () => {
  // Two exclusions in one assertion because they are the same claim from opposite ends. An SVG path
  // is written in a language where `M<number>` means *moveto*, so the three tracked SVGs in this
  // repository carry `M4`, `M5`, `M9`, `M10`, `M20`, `M21`, `M30` and `M37` as coordinates; tracked
  // markdown is excluded for the opposite reason — it is read by the *publish* half, under the full
  // contract, and reading it here as well would report every finding twice.
  //
  // `M91` appears in all three files and must be reported from exactly one of them. Without the
  // pairing the test would pass against a corpus that read nothing at all.
  const dir = fixture({
    spec: '# Spec\n\nThe bundle is one publishable package (`P#43`), and the rule is `M91`.\n',
    code: {
      'public/logo.svg': '<svg><path d="M91 20 L30 40"/></svg>\n',
      'src/thing.ts': '// the rule this implements is `M91`\n',
    },
  });
  const r = run(dir, ['--demand']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /M91\b/);
  assert.match(r.stderr, /1 site\(s\)\s+src\/thing\.ts:1/, 'the SVG path data was read as a citation site');
  assert.match(r.stdout, /1 image and 0 binary file\(s\) not read/);
});

test('a binary file is skipped on its content, not on its name', () => {
  // `packages/docs-site/scripts/fixtures/suite/receipt.png` is ASCII text with a misleading name and
  // a real binary is what a NUL byte says it is, so the two rules answer different questions and the
  // corpus needs both. This asserts the content rule: a tracked file that cannot be read as text is
  // skipped even though its extension claims otherwise, and it is counted so the skip is visible.
  const dir = fixture({ code: { 'src/blob.ts': Buffer.from('// cites `M77`\n\0\0binary tail\n', 'utf8') } });
  const r = run(dir, ['--demand']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /0 image and 1 binary file\(s\) not read/);
});
