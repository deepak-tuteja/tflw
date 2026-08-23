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
  // Live case, not hypothetical: five `### Round N (2026-07-05) — …` headings arrive inside blocks
  // lifted from `PLAN_PUBLISH.md`. A looser reader would count them as entries and then report them
  // as orphans, failing the gate over the index's own correct output.
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
