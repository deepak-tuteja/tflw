// M147d (`A3-13`, D627, D638) — one time vocabulary, and the rule that keeps the two spellings apart
// without keeping them in different positions.
//
// The row survived as its second clause: three constructs, three unit vocabularies, `pause 2
// seconds` a `TF023` while `today + 3 seconds` checks clean. Measuring the whole surface before
// changing it turned up two consequences the row did not name, and both are worse than the
// ergonomics:
//
//  1. `expect duration is less than 2 seconds` reached `no problems found` and then failed **every**
//     run with ``\`is less than\` expects a number, got object``. The value path built a
//     `DateOffsetLit` — the tagged shape `today + 2 seconds` needs — and no numeric matcher had ever
//     been taught to read it. A statically decidable type error, delivered at run time.
//  2. `random date between today and today - 10s` reached `no problems found`, while `today - 10
//     seconds` raised `TF054`. `M147c` shipped that reversed-bounds rule the same day; it was blind
//     to half the programs it is about, because `literalDateBound` matched one node type and the
//     adjacent abbreviation parses to the other.
//
// So the union is not a convenience. It is the repair for a checker rule that only reached half its
// subject, and for a type error the checker could see.
//
// **What did not change is asserted as hard as what did.** `today + 3 s` is still `TF023: a duration
// unit must touch its number`, because D638 widened the adjacency test to apply to abbreviations
// only rather than removing it — and a union that also dropped adjacency would have made `250 ms`
// legal, undoing D170. `2sec` still gets its typo hint. `null` is still not a number.
//
// The blunt control: delete `seconds` from `TIME_UNIT_MS` and the duration-position tests fail;
// drop the `DurationLit` arm of `literalDateBound` and the `10s` bound test fails; drop the unwrap
// in `matcher.ts` and the runtime half fails in `@tflw/runtime`. All three are registered `m147d`
// mutations (D636).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, parseConfigSource, checkLiteralOperands, Codes } from '../src/index.js';

/** Diagnostic codes from parsing a whole file. */
const codes = (source: string): string[] => parseSource(source).diagnostics.map((d) => d.code);

/** The same, in the config dialect — `defaults`/`env` are not test-file grammar. */
const cfg = (source: string): string[] => parseConfigSource(source).diagnostics.map((d) => d.code);

/** A step body wrapped in a minimal test. */
const stepCodes = (body: string): string[] => codes(`test "t"\n  ${body}\n`);

/** The first diagnostic's message and hint, for the messages that had to stay put. */
const said = (source: string): string => {
  const d = parseSource(source).diagnostics[0];
  return d ? `${d.message} | ${d.hint ?? ''}` : '';
};

/** The same, in the config dialect. */
const saidCfg = (source: string): string => {
  const d = parseConfigSource(source).diagnostics[0];
  return d ? `${d.message} | ${d.hint ?? ''}` : '';
};

/** `TF054`'s reversed-bounds pass, which is where the second consequence showed. */
const operandCodes = (body: string): string[] => {
  const source = `test "t"\n  ${body}\n`;
  const { program, diagnostics } = parseSource(source);
  assert.deepEqual(diagnostics, [], `fixture did not parse:\n${source}`);
  return checkLiteralOperands(program).map((d) => d.code);
};

test('a duration position takes a spelled-out unit', () => {
  assert.deepEqual(cfg('defaults\n  timeout step 2 minutes\n'), []);
  assert.deepEqual(cfg('defaults\n  timeout wait 90 seconds\n'), []);
  assert.deepEqual(stepCodes('api GET /a timeout 30 seconds'), []);
});

test('a duration position still takes an abbreviation', () => {
  assert.deepEqual(cfg('defaults\n  timeout step 2m\n'), []);
  assert.deepEqual(stepCodes('api GET /a timeout 30s'), []);
});

test('the units above `m` are legal as durations, since the vocabulary is one vocabulary', () => {
  assert.deepEqual(cfg('defaults\n  timeout wait 2 hours\n'), []);
  assert.deepEqual(cfg('defaults\n  timeout wait 1 days\n'), []);
  assert.deepEqual(cfg('defaults\n  timeout wait 1 weeks\n'), []);
});

test('a word may touch its number or not; an abbreviation must touch it', () => {
  assert.deepEqual(cfg('defaults\n  timeout wait 2 seconds\n'), []);
  assert.deepEqual(cfg('defaults\n  timeout wait 2seconds\n'), []);
  assert.deepEqual(cfg('defaults\n  timeout wait 2s\n'), []);
  assert.deepEqual(cfg('defaults\n  timeout wait 2 s\n'), [Codes.UNKNOWN_DURATION_UNIT]);
});

// NEGATIVE — D170's rule, which the union must not undo. A spaced abbreviation is still the mistake
// it was, and it is still taught with the closed-up spelling rather than with a unit list.
test('a spaced abbreviation is still `must touch its number`, in every position', () => {
  assert.equal(said('test "t"\n  let d = today + 3 s\n'), 'a duration unit must touch its number | write `3s`, not `3 s`');
  assert.equal(saidCfg('defaults\n  timeout wait 250 ms\n'), 'a duration unit must touch its number | write `250ms`, not `250 ms`');
});

// NEGATIVE — the typo table still fires, and its hint still names the abbreviation it means. The
// sentence gained one word (`abbreviated`), because the old one listed three units as the whole
// vocabulary and that is now false; the advice it carries is unchanged.
test('a word that was reaching for an abbreviation still gets the typo hint', () => {
  assert.equal(saidCfg('defaults\n  timeout wait 2sec\n'), 'unknown time unit `sec` | tflw\'s abbreviated time units are `ms`, `s` and `m` — write `2s`.');
  assert.equal(saidCfg('defaults\n  timeout wait 250MS\n'), 'unknown time unit `MS` | time units are lowercase — write `250ms`.');
  // The spaced form of the same typo keeps its second clause, which is the part of the hint that
  // names *two* mistakes rather than one.
  assert.equal(saidCfg('defaults\n  timeout wait 2 sec\n'), 'unknown time unit `sec` | tflw\'s abbreviated time units are `ms`, `s` and `m` — write `2s` with no space.');
});

// NEGATIVE — a word that was never a unit still gets the generic message, now listing all eight.
test('a word that is not a unit at all is still refused, and the help lists the vocabulary', () => {
  assert.equal(
    saidCfg('defaults\n  timeout wait 5 fortnights\n'),
    'unknown time unit `fortnights` | expected `ms`, `s`, `m`, `seconds`, `minutes`, `hours`, `days`, or `weeks`',
  );
});

test('date arithmetic takes both spellings, as it always did', () => {
  assert.deepEqual(stepCodes('let d = today + 3 days'), []);
  assert.deepEqual(stepCodes('let d = today + 3s'), []);
  assert.deepEqual(stepCodes('let d = today + 3seconds'), []);
});

// The second consequence: one rule, both spellings. Before D638 the abbreviated bound was invisible
// to `TF054` and the identical program checked clean.
test('a reversed date bound is caught in either spelling', () => {
  assert.deepEqual(operandCodes('let a = random date between today and today - 10 seconds'), [Codes.INVALID_LITERAL_OPERAND]);
  assert.deepEqual(operandCodes('let a = random date between today and today - 10s'), [Codes.INVALID_LITERAL_OPERAND]);
});

test('the reversed-bounds hint quotes the spelling the author wrote', () => {
  const source = 'test "t"\n  let a = random date between today and today - 10s\n';
  const { program } = parseSource(source);
  const hint = checkLiteralOperands(program)[0]?.hint ?? '';
  assert.match(hint, /today - 10s and today/, 'the hint must not rewrite `10s` as a millisecond count');
});

// NEGATIVE — an ordered pair stays silent in both spellings, so the widened bound reader cannot be
// mistaken for a rule that fires on any date arithmetic it can now see.
test('an ordered date bound is silent in either spelling', () => {
  assert.deepEqual(operandCodes('let a = random date between today - 10 seconds and today'), []);
  assert.deepEqual(operandCodes('let a = random date between today - 10s and today'), []);
});
