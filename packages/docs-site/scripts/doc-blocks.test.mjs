// The block scanner and its taxonomy (M62, DT-01/DT-02).
//
// The predecessor's extractor was a single `^```(\w*)$` regex, and everything it failed to match
// vanished without being counted. These tests pin the cases that silence used to swallow.

import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, extractBlocks, parseInfoString, roadmapFiles, scanRoadmapClaims, scanConstructCoverage, scanPrivateNotation, grammarPhrases, NOTATION, ROADMAP_PHRASES } from './doc-blocks.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const one = (md) => {
  const blocks = extractBlocks(md);
  assert.equal(blocks.length, 1, 'expected exactly one block');
  return { ...blocks[0], ...classify(blocks[0]) };
};

test('an untagged fence is unclassified, not skipped — the whole point of DT-01', () => {
  const block = one('intro\n\n```\nopen "/checkout"\n```\n');
  assert.equal(block.kind, 'unclassified');
  assert.match(block.why, /untagged/);
  assert.equal(block.startLine, 3);
  assert.equal(block.source, 'open "/checkout"');
});

test('an unknown fence tag is unclassified — a new tag must be a decision, not a default', () => {
  assert.equal(one('```rust\nfn main() {}\n```\n').kind, 'unclassified');
});

test('a fence indented inside a list item is found (the old `^```` regex missed it)', () => {
  const block = one('- a step:\n\n  ```tflw fragment\n  open "/checkout"\n  ```\n');
  assert.equal(block.kind, 'fragment');
  assert.equal(block.source, 'open "/checkout"', 'the list indentation is stripped, not baked into the sample');
});

test('a four-backtick fence containing a three-backtick one is one block, not three', () => {
  const block = one('````text\n```tflw\nnot really a sample\n```\n````\n');
  assert.equal(block.kind, 'declared');
  assert.equal(block.source, '```tflw\nnot really a sample\n```');
});

test('an unterminated fence fails instead of silently swallowing the rest of the page', () => {
  const block = one('```tflw\ntest "x"\n');
  assert.equal(block.kind, 'unclassified');
  assert.match(block.why, /unterminated/);
});

test('directives parse: bare flags and comma lists', () => {
  assert.deepEqual(parseInfoString('tflw fragment binds=orderId,email'), {
    lang: 'tflw',
    directives: { fragment: true, binds: ['orderId', 'email'] },
  });
  assert.deepEqual(parseInfoString('tflw-config'), { lang: 'tflw-config', directives: {} });
});

test('a fragment with no `binds` still gets an empty list, never undefined', () => {
  assert.deepEqual(one('```tflw fragment\nopen "/x"\n```\n').binds, []);
});

test('`tflw` and `tflw fragment` are different kinds — the tag decides how a block is verified', () => {
  assert.equal(one('```tflw\ntest "x"\n```\n').kind, 'file');
  assert.equal(one('```tflw fragment\napi GET /x\n```\n').kind, 'fragment');
  assert.equal(one('```tflw-config\nenv e default\n```\n').kind, 'config');
  assert.equal(one('```tflw-config fragment\nrequire env A\n```\n').kind, 'config-fragment');
});

test('every block on a page comes back, in source order', () => {
  const blocks = extractBlocks('```sh\na\n```\n\ntext\n\n```tflw\nb\n```\n\n```\nc\n```\n');
  assert.deepEqual(
    blocks.map((b) => [b.lang, b.startLine]),
    [['sh', 1], ['tflw', 7], ['', 11]],
  );
});

// --- roadmap truth (M149b, `D657`/`D663`/`D664`) -----------------------------
//
// The allowlist is the half that decides what this guard tolerates, so it is the half worth
// testing. Every case below injects its own, because asserting against the real one would pin the
// site's current prose rather than the rule.

const scan = (text, opts) => scanRoadmapClaims([{ key: 'index.md', text }], { checkStale: false, ...opts });

test('an undeclared forward-looking claim is a problem — the class that shipped twice', () => {
  const { problems, claims } = scan('# x\n\nFour pillars share one grammar. Security testing is next.\n');
  assert.equal(claims, 1);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].where, 'index.md:3');
  assert.match(problems[0].message, /undeclared forward-looking claim/);
  assert.match(problems[0].message, /`is next`/);
});

test('frontmatter is scanned, not skipped — the hero tagline is where it actually shipped', () => {
  // `index.md`'s tagline lives in YAML, above the first markdown heading. It carried "Security
  // testing is next" past two sweeps of *prose*, because a hero tagline does not look like prose
  // that describes behaviour. It is, and it is the first sentence a reader sees.
  const { problems } = scan('---\ntagline: One grammar for four pillars. Security testing is next.\n---\n\n# x\n');
  assert.equal(problems.length, 1);
  assert.equal(problems[0].where, 'index.md:2');
});

test('a declared claim passes, and only for the line it names', () => {
  const allowlist = new Map([['index.md', [{ includes: 'Pre-1.0, not yet published', why: 'true' }]]]);
  const ok = scan('# x\n\nPre-1.0, not yet published.\n', { allowlist });
  assert.equal(ok.claims, 1);
  assert.deepEqual(ok.problems, []);

  // A *second* line in the same file, using the same idiom, is not covered by the first line's
  // exemption. A phrase-keyed allowlist would have waved this through.
  const two = scan('# x\n\nPre-1.0, not yet published.\n\nThe LSP is not yet published either.\n', { allowlist });
  assert.equal(two.problems.length, 1);
  assert.equal(two.problems[0].where, 'index.md:5');
});

test('rewording a declared line loses its exemption — `D664`, and the point of the substring key', () => {
  const allowlist = new Map([['index.md', [{ includes: 'Pre-1.0, not yet published', why: 'true' }]]]);
  const { problems } = scan('# x\n\nPre-1.0 and not yet published.\n', { allowlist });
  assert.equal(problems.length, 1, 'the sentence changed, so the declaration has to be made again');
});

test('an exemption that matches nothing is a problem — an excuse that outlived its subject', () => {
  const allowlist = new Map([['index.md', [{ includes: 'security testing is next', why: 'was true once' }]]]);
  const stale = scanRoadmapClaims([{ key: 'index.md', text: '# x\n\nAll four pillars ship.\n' }], { allowlist });
  assert.equal(stale.problems.length, 1);
  assert.equal(stale.problems[0].where, 'DECLARED_ROADMAP index.md');
  assert.match(stale.problems[0].message, /no line matches/);

  // Off for a scratch corpus: `DT-08`'s fixtures name their page `index.md` too, so this check
  // would report the real home page's tagline as deleted by every fixture in the suite.
  assert.deepEqual(scanRoadmapClaims([{ key: 'index.md', text: '# x\n' }], { allowlist, checkStale: false }).problems, []);
});

test('an exemption for a file the corpus does not contain is not reported as stale', () => {
  const allowlist = new Map([['editor.md', [{ includes: 'a listing is planned for later', why: 'true' }]]]);
  assert.deepEqual(scanRoadmapClaims([{ key: 'index.md', text: '# x\n' }], { allowlist }).problems, []);
});

test('`will be` is deliberately not an idiom — `D663`, pinned so it is not added back as an oversight', () => {
  // It is tense, not roadmap: "the report will be written to `report/`" describes a capability that
  // shipped long ago. Adding it needs an exemption per sentence of ordinary prose, and an exemption
  // list that grows with sentences nobody is worried about is how a guard gets deleted.
  assert.ok(!ROADMAP_PHRASES.includes('will be'));
  assert.deepEqual(scan('# x\n\nThe report will be written to `report/report.html`.\n').problems, []);
});

// ---------------------------------------------------------------------------
// Construct coverage (`M149f`, `D659`) — the positive dual, and the break it has to demonstrate.
// ---------------------------------------------------------------------------

const GRAMMAR = [
  '```',
  "CrawlSeed := 'seed' 'openapi' STRING NEWLINE   # the documented surface",
  "           | 'seed' 'spider' STRING NEWLINE",
  "CsrfStmt  := 'csrf' 'from' Subject 'send' 'as' 'header' STRING NEWLINE",
  "Step      := 'api' METHOD Target NEWLINE",
  '```',
].join('\n');

const cover = (pages, opts = {}) =>
  scanConstructCoverage({
    files: Object.entries(pages).map(([key, text]) => ({ key, text })),
    grammarText: GRAMMAR,
    ...opts,
  });

test('a construct on no page fails — the half a denylist cannot see', () => {
  // `seed spider` shipped in `M137f` and appeared nowhere on the site for two milestones. No phrase
  // list could have found it: an absent page matches no grep, which is why this check is a set
  // difference against a manifest rather than a scan of the prose.
  const page = '# Crawling\n\n```tflw\ncrawl "x"\n  seed openapi "/openapi.json"\n```\n\nSessions carry a `csrf from body.t send as header "X"` clause.\n';
  const { problems } = cover({ 'guide/crawling.md': page });
  assert.deepEqual(problems.map((p) => p.message), ['a shipped construct that appears on no page: `seed spider`']);
});

test('only the leading run of literals becomes a phrase — a search key, not a re-statement', () => {
  // `'csrf' 'from'` then a `Subject`: the words after the non-literal are not part of the key, so a
  // page writing `csrf from body.token send as header "X"` matches and a stricter key would not.
  assert.deepEqual(grammarPhrases(GRAMMAR), ['csrf from', 'seed openapi', 'seed spider']);
});

test('a fence blanks before inline spans are scanned — otherwise its backticks re-pair the page', () => {
  // Three backticks are an odd number, so every span after a fence pairs with the wrong neighbour.
  // The symptom is a construct the page plainly shows being reported as documented nowhere.
  const page = '# P\n\n```console\n✓ ok\n```\n\nUse `seed spider "/admin"` and `seed openapi "/o.json"` for a crawl.\n\n```console\n✓ ok\n```\n\nAnd `csrf from body.t send as header "X"`.\n';
  assert.deepEqual(cover({ 'guide/crawling.md': page }).problems, []);
});

test('an inline span may cross a line break — two real pages write one', () => {
  // ``a `body\nfrom` file`` in `input-handling.md`, and `log destination …` split across two lines
  // in `ci-and-reporting.md`. A per-line scanner reads neither and calls both undocumented.
  const page = '# P\n\n```tflw\napi GET /x\n```\n\nA `seed\nopenapi` document, a `seed spider "/admin"` walk, and `csrf\nfrom body.t`.\n';
  assert.deepEqual(cover({ 'guide/crawling.md': page }).problems, []);
});

test('a `v-for` row counts as on the page — and is reported as tabulated, not explained', () => {
  // `reference/matchers.md` and its three siblings render `spec-data.ts` straight through Vue, so
  // those strings are on the page at runtime and in no `.md` source. Counting them is `D659`'s bar
  // met; saying they are only tabulated is the next prose pass's worklist.
  const page = [
    '<script setup>',
    "import { SEEDS } from '../../lang/src/spec-data.ts';",
    '</script>',
    '',
    '<tr v-for="s in SEEDS" :key="s.id"><td>{{ s.syntax }}</td></tr>',
    '',
    'A crawl can `seed openapi "/o.json"`.',
  ].join('\n');
  const manifests = { SEEDS: [{ id: 'spider', syntax: 'seed spider "/admin"' }, { id: 'csrf', syntax: 'csrf from body.t' }] };
  const result = cover({ 'reference/seeds.md': page }, { manifests });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.onlyGenerated, ['csrf from', 'seed spider']);
});

test('an undocumented construct may be declared, with the reason it is not a gap', () => {
  const allowlist = new Map([['seed spider', 'deliberately withheld while the walk is behind a flag']]);
  const page = '# P\n\nA crawl can `seed openapi "/o.json"` and `csrf from body.t`.\n';
  assert.deepEqual(cover({ 'guide/crawling.md': page }, { allowlist }).problems, []);
});

test('a declaration that is documented now fails — an exemption that exempts nothing', () => {
  // The reverse direction, and the half that keeps the map from becoming a list of old beliefs.
  const allowlist = new Map([['seed spider', 'deliberately withheld while the walk is behind a flag']]);
  const page = '# P\n\nA crawl can `seed openapi "/o.json"`, `seed spider "/admin"` and `csrf from body.t`.\n';
  const { problems } = cover({ 'guide/crawling.md': page }, { allowlist });
  assert.deepEqual(problems.map((p) => p.message), ['`seed spider` is documented now, or is no longer a construct']);
});

test('two manifests naming one absent construct report one problem, not two', () => {
  // `probe ciphers` is in `CONFIG_KEYWORDS` and in `GRAMMAR.md`. Two manifests agreeing it is
  // missing is one absence; reporting it twice reads as two repairs.
  const grammarText = ["```", "Probe := 'probe' 'ciphers' NEWLINE", '```'].join('\n');
  const manifests = { CONFIG_KEYWORDS: [{ id: 'ciphers', slot: 'probe', summary: 'x' }] };
  const { problems } = scanConstructCoverage({
    files: [{ key: 'guide/config.md', text: '# Config\n' }],
    grammarText,
    manifests,
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0].where, /CONFIG_KEYWORDS \(probe\) \+ GRAMMAR\.md `probe ciphers`/);
});


// ---------------------------------------------------------------------------
// The private notation on a user-facing page (`M152d`, `D673`/`D706`).
// ---------------------------------------------------------------------------
//
// Two things decide what this guard is worth, and neither is whether it can spot `M60`: what it
// **excludes**, and whether the exclusions are decisions or accidents. So every exclusion below is
// tested as a pair — the excluded form beside the near-identical form that must still be caught —
// the same discipline `verify-anchors.test.mjs` uses, and for the same reason: an exclusion that
// swallowed the real defect too would pass silently.

const notation = (text, key = 'guide/load-testing.md', opts) =>
  scanPrivateNotation([{ key, text }], opts).problems.map((p) => p.where);

test('a page with no notation on it produces nothing', () => {
  // The cheapest way to be accidentally green is to be accidentally red.
  const { problems, scanned } = scanPrivateNotation([
    { key: 'guide/config.md', text: '# Config\n\nSet `baseUrl` in `tflw.config`. Run `tflw check`.\n' },
  ]);
  assert.deepEqual(problems, []);
  assert.equal(scanned, 1);
});

test('every notation shape is recognised, and each says what it names', () => {
  const { problems } = scanPrivateNotation([
    { key: 'x.md', text: '# x\n\nM60 did it.\n\nD657 says so.\n\nP#101a too.\n\nSee decision 94.\n\nAnd V4-02.\n' },
  ]);
  assert.deepEqual(problems.map((p) => p.where), ['x.md:3', 'x.md:5', 'x.md:7', 'x.md:9', 'x.md:11']);
  assert.deepEqual(
    problems.map((p) => p.message.replace(/^`[^`]+` names /, '')),
    [
      "a milestone in this project's private design record",
      "a decision in this project's private design record",
      "a plan item in this project's private design record",
      "a bare decision citation in this project's private design record",
      "a review-ledger row in this project's private design record",
    ],
  );
});

test('a review-ledger row is caught, and it is the worst of the five rather than the mildest', () => {
  // `DECISIONS.md` resolves `M60`, `D657` and `P#101a` for anyone who finds one. Nothing resolves
  // `V4-02` — the ledger it indexes is gitignored — so a reader who tries to follow it cannot,
  // even in principle. `D673` names the three; leaving this one out would have published the only
  // shape with no possible destination.
  assert.deepEqual(notation('# x\n\nfails the build if one is added without one (M110, `V4-02`).\n'),
    ['guide/load-testing.md:3', 'guide/load-testing.md:3']);
});

test('notation inside a fence is tflw output; the same line outside one is prose', () => {
  // `# emitted by tflw M137d — sec/error-detail-disclosure` is a real line on the security pages:
  // the tool's own output, reproduced verbatim. Checking it would be the guard objecting to a
  // transcript. `D697` paid for this distinction in the citation gate; it is the same one.
  const line = '# emitted by tflw M137d — sec/error-detail-disclosure';
  assert.deepEqual(notation(['# x', '', '```sh', line, '```', ''].join('\n')), []);
  assert.deepEqual(notation(['# x', '', line, ''].join('\n')), ['guide/load-testing.md:3']);
});

test('a comment in a <script> block never renders; the same text in prose does', () => {
  // Every reference page opens with `<script setup>` to pull in a generated table, and those
  // carry ordinary source comments. A Vue SFC comment reaches no reader at all.
  const comment = '// one shared module because it used to be four identical copies (`M110b-02`).';
  assert.deepEqual(notation(['<script setup>', comment, '</script>', '', '# x', ''].join('\n')), []);
  assert.deepEqual(notation(['# x', '', comment.slice(3), ''].join('\n')), ['guide/load-testing.md:3']);
  // One finding, not two: `M110b-02` is a ledger row, but the row pattern wants `-\d+` straight
  // after the digits and this one carries a letter, so it is the MILESTONE pattern that catches it
  // on the `M110b` prefix. The line is flagged either way — only the label differs — and the
  // overlap is left alone rather than widened, because widening would make both patterns fire on
  // one token and report the same defect twice.
});

test('a lowercase GitHub anchor does not trip, and this is case doing the work, not an exclusion', () => {
  // `D691` clause 4 scoped a URL-fragment exclusion, reasoning that `D677`'s anchor gate needs the
  // very fragments this rule would flag. Measured against the real site that exclusion matches
  // NOTHING: GitHub lowercases its anchors, so `…-p2731-` and `…-d105` are already not the
  // notation. No exclusion was added, because a guard that never fires is one nobody can evaluate.
  //
  // THIS TEST IS THE EXCLUSION. Widen any pattern to `/i` and it goes red here, with this comment
  // attached, instead of the rule quietly starting to flag every SPEC.md link on the site.
  // A real anchor off this site, carrying a lowercase `d105` and a lowercase `p2731`: with `/i`
  // on the decision pattern this line reports a defect on every SPEC.md link the docs carry.
  const link = '[SPEC.md §4.5](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#45-retries-d105-and-the-config-dialect-p2731-)';
  assert.deepEqual(notation(`# x\n\n${link}\n`), []);
  for (const { re } of NOTATION) assert.ok(!re.flags.includes('i'), `${re} is case-insensitive — see the test above this one`);

  // And the capitalised form on the same page is still caught, so the pass above is about case
  // rather than about the line being a link.
  assert.deepEqual(notation('# x\n\nsee [the dialect](/guide/config) — P#27 covers it\n'), ['guide/load-testing.md:3']);
});

test('an @include shim is skipped by name, and a shim that grew a body is reported', () => {
  // `D706`. `CHANGELOG.md` and `GRAMMAR.md` render onto the site verbatim and publish 284
  // citations between them; the rule stops at them because each record is declared and resolves.
  // The exemption is by NAME rather than by the file walk on purpose — `findMarkdownFiles` sees a
  // 233-byte stub and would skip the body accidentally, producing this scope with none of this
  // reasoning.
  const included = new Map([['changelog.md', { include: '../../CHANGELOG.md', why: 'CHANGELOG.md' }]]);
  const shim = '# Changelog\n\nIncluded from CHANGELOG.md — decision 94 lives in there.\n\n<!--@include: ../../CHANGELOG.md-->\n';
  assert.deepEqual(notation(shim, 'changelog.md', { included }), []);

  // If the page stops being a stub, the exemption stops describing it — and saying so is the
  // difference between an exclusion and a blind spot.
  const grown = '# Changelog\n\nHand-written now, and decision 94 is still here.\n';
  const { problems } = scanPrivateNotation([{ key: 'changelog.md', text: grown }], { included });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].where, 'INCLUDED_RECORDS changelog.md');
  assert.match(problems[0].message, /no longer includes/);
});

test('a third @include shim reaches both guards, and neither guard holds a list of its own', () => {
  // `D719`, and the acceptance clause it was written for. The two guards want **opposite** answers
  // about an `@include` — the notation rule skips the record's body because its citations are
  // declared provenance (`D706`), the roadmap rule must read it because a forward-looking claim
  // renders onto the page either way. `D706` decided that and left it standing. What it could not
  // fix is that one guard derived its set and the other named two files inline, so a third shim
  // would have updated exactly one of them without saying so.
  //
  // The proof is a shim NEITHER guard has ever heard of, declared in one place: both must change
  // behaviour, in their own opposite directions, with no edit to either.
  const root = mkdtempSync(join(tmpdir(), 'tflw-shim-registry-'));
  try {
    mkdirSync(join(root, 'site'));
    writeFileSync(join(root, 'THIRD.md'), '# Third\n\nThis is `not yet implemented`, and P#27 explains why.\n');
    const stub = '# Third\n\n<!--@include: ../THIRD.md-->\n';
    writeFileSync(join(root, 'site', 'third.md'), stub);
    const included = new Map([['third.md', { include: '../THIRD.md', why: 'THIRD.md, declared at its head' }]]);

    // The roadmap guard reads THROUGH the shim: the claim lives in the record, not the stub.
    const files = roadmapFiles(join(root, 'site'), included);
    const record = files.find((f) => f.key.endsWith('THIRD.md'));
    assert.ok(record, 'the record the site @includes is in the roadmap corpus');
    const { claims } = scanRoadmapClaims([record], { allowlist: new Map(), checkStale: false });
    assert.equal(claims, 1, 'the claim inside the included record is visible to the roadmap rule');

    // The notation guard stops AT the shim, from the same one registry entry.
    const { problems, scanned } = scanPrivateNotation([{ key: 'third.md', text: stub }], { included });
    assert.deepEqual(problems, [], 'the shim keeps its declared citations');
    assert.equal(scanned, 0, 'and is not counted as a page this rule covered');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an excluded page is not counted as scanned, so the report cannot overstate coverage', () => {
  const included = new Map([['changelog.md', { include: '../../CHANGELOG.md', why: 'CHANGELOG.md' }]]);
  const { scanned } = scanPrivateNotation(
    [{ key: 'changelog.md', text: '<!--@include: ../../CHANGELOG.md-->\n' }, { key: 'index.md', text: '# x\n' }],
    { included },
  );
  assert.equal(scanned, 1, 'the shim is excluded, and the count says 1 page rather than 2');
});
