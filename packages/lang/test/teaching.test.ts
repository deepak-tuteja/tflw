// What the diagnostic teaches (M84, review cluster C11's second half — `A3-09`, `A2-05`,
// `A2-07b`, `A2-10`).
//
// C11 was filed as one defect and turned out to be two. `M83` fixed the first: recovery had no
// model of what it had discarded, so one mistake cost several diagnostics. The diagnostics now fire
// once each — and several of them still did not say what the mistake *was*. That is this file.
//
// The distinction that matters here is between naming the **grammar slot the parser was in** and
// naming the **mistake the author made**. ``expected end of line`` is the first: true, useless, and
// identical for an inline `within`, a tag on a `test` header, a per-step `timeout` on a UI wait, a
// conjoined `expect`, and a duration unit spaced off its number. Five unrelated errors, one hint.
//
// Every test below therefore asserts two things, and the second is the load-bearing one: that the
// hint names the mistake, and that **the source it recommends actually parses**. A hint is a
// promise about the language; C7 (`M61`) is the cluster of what happens when that promise is false.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource } from '../src/index.js';
import { DATE_OFFSET_UNITS, DURATION_UNITS, UNIT_SPELLINGS } from '../src/parser.js';

/** The one diagnostic `source` produces, as `{message, hint}`. The count assert is deliberate: a
 * better hint attached to a cascade is not an improvement, and `M83` is what makes it one. */
function only(source: string): { message: string; hint: string } {
  const { diagnostics } = parseSource(source);
  assert.equal(diagnostics.length, 1, `expected exactly one diagnostic from:\n${source}\ngot:\n${diagnostics.map((d) => d.message).join('\n')}`);
  return { message: diagnostics[0]!.message, hint: diagnostics[0]!.hint ?? '' };
}

/** Asserts `source` parses with nothing to report — used on every form a hint recommends. */
function clean(source: string, why: string): void {
  const { diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics.map((d) => `${d.code}: ${d.message}`), [], `${why}\n${source}`);
}

// -- `A3-09`: `endLine`'s single hint, split into the five mistakes it was standing in for --------

test('A3-09: an inline `within` is told that `within` opens a block', () => {
  const { hint } = only('test "a"\n  open "/x"\n  click button "Add to cart" within css ".inventory_item"\n');
  assert.match(hint, /`within` opens a block/);
  assert.match(hint, /own line/);
  clean('test "a"\n  open "/x"\n  within css ".inventory_item"\n    click button "Add to cart"\n', 'the block form the hint recommends must parse');
});

test('A3-09: a tag on the `test` header is told where tags go, and names the tag', () => {
  const { hint } = only('test "x" @smoke retry 1\n  api GET /o\n');
  assert.match(hint, /own line above `test`/);
  assert.match(hint, /@smoke/, 'the hint should show the tag the author actually wrote');
  clean('@smoke\ntest "x" retry 1\n  api GET /o\n', 'a tag on its own line above `test` must parse');
});

test('A3-09: a per-step `timeout` on a UI wait is told where per-step timeouts are accepted', () => {
  const { hint } = only('test "a"\n  open "/x"\n  wait until button "Go" is enabled timeout 30s\n');
  assert.match(hint, /only accepted on `api` requests/);
  assert.match(hint, /timeout wait/, 'the hint must name the config key that does cover this case');
  // The half of the hint that is a promise about the language: `timeout` *is* legal on an api
  // request, and the three config targets it names are all real.
  clean('test "a"\n  api GET /jobs timeout 30s\n  expect status equals 200\n', '`timeout` on an api request must parse');
  const cfg = parseConfigSource('defaults\n  timeout step 5s\n  timeout wait 30s\n  timeout expect 3s\n');
  assert.deepEqual(cfg.diagnostics.map((d) => d.message), [], 'all three timeout targets the hint names must be legal');
});

test('A3-09: a conjoined `expect` is told the language has one assertion per `expect`', () => {
  const { hint } = only('test "a"\n  api GET /o\n  expect status equals 200 and body.ok equals true\n');
  assert.match(hint, /one assertion per `expect`/);
  clean('test "a"\n  api GET /o\n  expect status equals 200\n  expect body.ok equals true\n', 'two `expect` lines must parse');
});

test('A3-09: a spaced duration unit is shown the exact correction, not the rule', () => {
  const { hint } = only('test "a"\n  api GET /o\n  expect duration is less than 500 ms\n');
  // The number is in `previous()` at the point of failure, so the hint can print the fix rather
  // than describe it. `500ms`, not "a unit must be adjacent to its number".
  assert.match(hint, /write `500ms`, not `500 ms`/);
  clean('test "a"\n  api GET /o\n  expect duration is less than 500ms\n', 'the adjacent form the hint recommends must parse');
});

test('A3-09: an unrecognized trailing token still gets the generic hint', () => {
  // This is a lookup table of known mistakes, not a claim to understand every one. What must not
  // happen is a confidently wrong explanation for a token the parser has no theory about.
  const { hint } = only('test "a"\n  api GET /o\n  expect status equals 200 zzz\n');
  assert.equal(hint, 'expected end of line');
});

// -- `A2-05`: which half of a `with each` table is quoted ----------------------------------------

test('A2-05: a quoted header cell is told that column names are bare, and shown the fix', () => {
  const { message, hint } = only('with each\n  | "name" | "qty" |\n  | "a"    | 2     |\ntest "quoted header"\n  api GET /o\n');
  assert.match(message, /expected a column name/);
  // The whole content of the mistake is the split between the header row and the data rows —
  // which the previous hint, ``expected a name``, never mentioned.
  assert.match(hint, /column names are bare words/);
  assert.match(hint, /write `name`, not `"name"`/);
  assert.match(hint, /data cells/);
  clean('with each\n  | name | qty |\n  | "a"  | 2   |\ntest "hdr"\n  api GET /o\n', 'the bare-header form the hint recommends must parse');
});

// -- `A2-10`: `step` and `spike` spell the same shapes differently -------------------------------

test('A2-10: each preposition mismatch names the jump/ramp distinction the two blocks encode', () => {
  // Whether the asymmetry survives at all is a grammar-freeze question, deferred to milestone B.
  // That the rejection explained nothing was not — a mismatch here is rarely a typo, it is an
  // author with the *other* block's grammar in mind.
  const over = only('test "load"\n  step users\n    to 50 over 10s\n  api GET /o\n');
  assert.match(over.hint, /`over` ramps/);
  assert.match(over.hint, /always jumps/);
  assert.match(over.hint, /`spike` block/, 'the hint should point at the block that does support a ramp');

  const forInSpike = only('test "load"\n  spike users\n    to 50 for 10s\n  api GET /o\n');
  assert.match(forInSpike.hint, /ramps in a `spike`/);
  assert.match(forInSpike.hint, /hold N for/, 'the hint should name the flat spike stage as the alternative');

  const hold = only('test "load"\n  step users\n    hold 50 for 10s\n  api GET /o\n');
  assert.match(hold.hint, /`hold` is a `spike` stage/);
  assert.match(hold.hint, /to N for/);
});

test('A2-10: every stage form the three hints recommend parses', () => {
  for (const [head, stage] of [
    ['step', 'to 50 for 10s'],
    ['spike', 'to 50 over 10s'],
    ['spike', 'hold 50 for 10s'],
  ] as const) {
    const { diagnostics } = parseSource(`test "load"\n  ${head} users\n    ${stage}\n  api GET /o\n`);
    assert.deepEqual(diagnostics.map((d) => d.message), [], `\`${head}\` + \`${stage}\` is recommended by a hint and must parse`);
  }
});

// -- `A2-07b`: a suggestion that respects which block it is in -----------------------------------

/** One legal line per config key — the worked examples the round-trip guard below is built on. */
const KEY_EXAMPLE: Record<string, string> = {
  header: 'header "Accept" is "application/json"',
  timeout: 'timeout step 5s',
  workers: 'workers 4',
  report: 'report "./report"',
  web: 'web "http://x"',
  api: 'api "http://x"',
  insecure: 'insecure true',
  cert: 'cert "./c.pem"',
  key: 'key "./k.pem"',
  allow: 'allow hosts "x.com"',
  evidence: 'evidence "full"',
  redact: 'redact header "X-Token"',
  viewport: 'viewport 1280 720',
  log: 'log level "info"',
};

/** A config with `line` in `defaults` or in an `env`, plus whatever the other block needs to be
 * valid on its own. */
function configWith(block: 'defaults' | 'env', line: string): string {
  return block === 'defaults' ? `defaults\n  ${line}\nenv local default\n  web "http://x"\n` : `defaults\n  workers 4\nenv local default\n  ${line}\n`;
}

test('A2-07b: a key that exists but belongs elsewhere is suggested *with* where it belongs', () => {
  const { diagnostics } = parseConfigSource(configWith('defaults', 'apii "http://localhost:3001"'));
  const unknown = diagnostics.filter((d) => d.code === 'TF020');
  assert.equal(unknown.length, 1);
  assert.match(unknown[0]!.hint ?? '', /did you mean `api`\?/, 'the nearest key is still the right guess at what was meant');
  assert.match(unknown[0]!.hint ?? '', /belongs in an `env` block, not `defaults`/);
});

test('A2-07b: following the old hint verbatim is exactly what the checker rejected', () => {
  // The reason the relocation clause had to be added, pinned as a test: without it the hint said
  // `api`, and `api` in `defaults` is `TF025`. The tool told you what to write and then refused it.
  const { diagnostics } = parseConfigSource(configWith('defaults', 'api "http://x"'));
  assert.deepEqual(diagnostics.map((d) => d.code), ['TF025']);
  // …and the block the hint now names accepts it.
  assert.deepEqual(parseConfigSource(configWith('env', 'api "http://x"')).diagnostics.map((d) => d.message), []);
});

test('A2-07b: no config-key suggestion, in either block, recommends something that block rejects', () => {
  // The round-trip guard, and the part that retires the class rather than the row. For every key,
  // in both blocks: take a near-miss spelling, read back what the parser suggests, then actually
  // write that key there and check the parser and the checker agree with the hint. A key added to
  // `CONFIG_KEYS` with a block restriction but no entry in the parser's block table fails here.
  for (const key of Object.keys(KEY_EXAMPLE)) {
    const nearMiss = key + key.slice(-1); // `api` -> `apii`, `web` -> `webb`
    for (const block of ['defaults', 'env'] as const) {
      const { diagnostics } = parseConfigSource(configWith(block, `${nearMiss} "x"`));
      const unknown = diagnostics.find((d) => d.code === 'TF020');
      assert.ok(unknown, `\`${nearMiss}\` in ${block} produced no unknown-key diagnostic`);
      const hint = unknown.hint ?? '';
      assert.match(hint, new RegExp(`did you mean \`${key}\``), `\`${nearMiss}\` in ${block} did not suggest \`${key}\`: ${hint}`);

      // What the hint claims about placement, checked against what actually happens there.
      const relocates = /belongs in/.test(hint);
      const rejected = parseConfigSource(configWith(block, KEY_EXAMPLE[key]!)).diagnostics.some((d) => d.code === 'TF025');
      assert.equal(
        relocates,
        rejected,
        relocates
          ? `the hint sends \`${key}\` out of ${block}, but ${block} accepts it: ${hint}`
          : `the hint recommends \`${key}\` in ${block}, and the checker rejects it there: ${hint}`,
      );
      if (relocates) {
        // Read the destination out of the `belongs in X, not Y` clause specifically — `Y` names a
        // block too, so a bare search for "`env` block" finds the wrong half of the sentence.
        const home = /belongs in an `env` block/.test(hint) ? 'env' : 'defaults';
        assert.notEqual(home, block, `the hint sends \`${key}\` to the block it is already in`);
        assert.ok(
          !parseConfigSource(configWith(home, KEY_EXAMPLE[key]!)).diagnostics.some((d) => d.code === 'TF025'),
          `the hint sends \`${key}\` to ${home}, which also rejects it`,
        );
      }
    }
  }
});

// -- `A1-07` (M98c/D160): the duration messages, made reachable from value position ---------------
// `A3-09` above fixed *one* of the five wrong-duration spellings, at `endLine`, via the trailing-
// token lookup. The other four never reached a duration message at all: `250ms` and `250 ms` lex
// identically, so `parseAtom` reconstructs adjacency from offsets, and when that check or the
// unit-set check failed it simply declined to build a duration and let the leftover word fall out of
// the step as ``unexpected `ms` at end of step``. Meanwhile `parseDuration` — the *other* duration
// path — had the right words the whole time.

test('A1-07: a spaced unit in value position keeps M84s exact wording, under a code that names durations', () => {
  // The regression this guards is a downgrade, not a bug: M84 already taught this one case from
  // `endLine`, so intercepting it earlier must not lose the sentence it shipped. What improves is
  // the code and the message — `TF023` and "a duration unit must touch its number", rather than
  // `TF010` and "unexpected `ms` at end of step".
  const { message, hint } = only('test "a"\n  api GET /o\n  expect duration is less than 500 ms\n');
  assert.match(message, /a duration unit must touch its number/);
  assert.match(hint, /write `500ms`, not `500 ms`/);
  clean('test "a"\n  api GET /o\n  expect duration is less than 500ms\n', 'the adjacent form the hint recommends must parse');
});

test('A1-07: a mis-cased unit is told it is the case, not merely that the unit is unknown', () => {
  // `250MS` lower-cases into a real unit. "unknown time unit `MS`" is true and leaves the reader to
  // spot the capitals themselves.
  const { hint } = only('test "a"\n  api GET /o\n  expect duration is less than 250MS\n');
  assert.match(hint, /time units are lowercase/);
  assert.match(hint, /write `250ms`/);
  clean('test "a"\n  api GET /o\n  expect duration is less than 250ms\n', 'the lowercase form must parse');
});

test('A1-07: a unit tflw spells differently is shown the spelling it uses', () => {
  for (const [src, fix] of [
    ['expect duration is less than 2sec', '`2s`'],
    ['expect duration is less than 2min', '`2m`'],
    ['expect duration is less than 2millis', '`2ms`'],
  ] as const) {
    const { message, hint } = only(`test "a"\n  api GET /o\n  ${src}\n`);
    assert.match(message, /unknown time unit/, src);
    assert.match(hint, new RegExp(`write ${fix.replace(/[`]/g, '`')}`), `${src} must name the spelling tflw uses`);
  }
  clean('test "a"\n  api GET /o\n  expect duration is less than 2s\n', 'the canonical spelling must parse');
});

test('A1-07: the same words give the same answer on the config path — that is why it is shared', () => {
  // `parseDuration` and `parseAtom` are different productions reached by different syntax. Before
  // D160 they disagreed about every spelling; a fix that improved only one would have replaced a
  // bad message with an inconsistent one.
  const { diagnostics } = parseConfigSource('defaults\n  timeout step 5sec\n');
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]!.hint ?? '', /write `5s`/);
});

test('A1-07: a word that was never a unit keeps the generic error — the control that bounds the rule', () => {
  // The whole design of D160 is the enumerated spelling table, and this is what it buys. Treating
  // any adjacent word as an attempted unit would put "unknown time unit `e3`" underneath `TF001`'s
  // correct explanation of `1e3`, and a second wrong answer under a right one is worse than none.
  const { hint } = only('test "a"\n  api GET /o\n  expect duration is less than 250xyz\n');
  assert.equal(hint, 'expected end of line');
  const { diagnostics } = parseSource('test "a"\n  let n = 1e3\n');
  assert.equal(diagnostics.filter((d) => d.code === 'TF023').length, 0, 'a numeric notation is not a duration');
  assert.match(diagnostics[0]!.message, /exponent notation is not supported/);
});

test('A1-07: the duration spellings and the date-offset words are disjoint vocabularies', () => {
  // Asserted structurally, and what that buys was re-measured in full (`scripts/mutate.mjs`, ids
  // `duration-table-gains-hours` / `date-check-before-duration` / `m98c-02-both-halves`) because the
  // first version of this comment got the reason wrong.
  //
  // Right: with disjoint tables, swapping the two branches changes no output. A spaced date word
  // fails the duration branch's adjacency test, an adjacent one fails its membership test, and an
  // adjacent duration is not a date word — so order cannot matter, and the swap is measurably a
  // no-op rather than half of a latent failure.
  //
  // Wrong: that `today + 3 days` is what the pair protects. It is not reachable from the duration
  // rule in any combination — `today + …` parses through the value path, where adjacency decides,
  // and `pause 3 hours` parses through `parseDuration`, a different function. Six configurations
  // (each property, the pair, the adjacency guard removed, and that with the tables overlapping)
  // all leave `today + 3 hours` clean.
  //
  // What disjointness actually protects is the *message*: with `hours` in both tables, `pause 3
  // hours` stops saying ``unknown time unit `hours` `` — true, tflw has no unit above `m` — and
  // starts saying `a duration unit must touch its number`, which points at a spelling that is still
  // not a unit. That is worth pinning, and it is pinned here, where the invariant lives.
  const dateWords = new Set<string>(DATE_OFFSET_UNITS);
  for (const spelling of Object.keys(UNIT_SPELLINGS)) {
    assert.ok(!dateWords.has(spelling), `\`${spelling}\` is a date-offset word and must not also be a duration spelling`);
  }
  for (const unit of DURATION_UNITS) assert.ok(!dateWords.has(unit), `\`${unit}\` is both a time unit and a date-offset word`);
  clean('test "a"\n  let d = today + 3 days\n  log "{d}"\n', '`today + 3 days` is a date offset');
  clean('test "a"\n  let d = today + 3days\n  log "{d}"\n', 'adjacency is not what makes a date offset');
});
