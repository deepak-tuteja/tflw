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
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CITATION,
  collectAnchors,
  RANGE,
  byId,
  collectCitations,
  collectLegacy,
  conformance,
  extractBlock,
  pickAnchor,
  publishedIds,
  scrub,
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
function fixture({ withRecords = true, spec = null } = {}) {
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
