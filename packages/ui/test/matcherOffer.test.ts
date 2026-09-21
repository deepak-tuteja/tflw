// **What the matcher select offers, and what it greys out** — `M228` `D` (`D1243`).
//
// `parts.tsx`'s `MATCHERS` is the language's whole matcher set and the select drew all 23 on every
// subject, because `D1114` dropped *subjects* per door and nothing ever filtered *matchers* per
// subject. Measured on the live page at 1440x900, a `status` row offered `has no a11y violations`.
//
// **Filtering was refused and disabling chosen**, and the reason is `D1076` held rather than
// traded: *over-offering beats silent omission — a word that should not be here is visible and
// wrong, and a word that is missing is invisible and wrong.*
//
// This file is the **table** half of that rule; the browser gate in `ui-page.test.ts` is the
// rendering half. Both are needed and neither substitutes: a select that read the rule correctly
// and forgot to pass `disabled` would pass this file, and a select that hard-coded four ids would
// pass the browser one against today's corpus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProgram, matcherSubjectRefusal, parseSource, type MatcherName } from '@tflw/lang';
import { MATCHERS, SUBJECTS, SUBJECT_NODE } from '../src/parts.tsx';

/** Every option the subject select offers, minus `carried` — which is not a subject but *the one
 *  already written*, and so has no node type of its own. */
const OFFERED = SUBJECTS.map(([id]) => id);

test('`M228` `D`: every subject the select offers has a node type, and it is the one the language round-trips to', () => {
  for (const id of OFFERED) {
    const node = SUBJECT_NODE[id];
    assert.ok(node !== undefined, `the subject select offers \`${id}\` and \`SUBJECT_NODE\` has no entry for it, so its matchers cannot be judged`);
    /* **Inverse-consistency, not just totality.** A table with the right keys and one wrong value
       would ask `TF042` about the wrong node and grey out the wrong words — silently, because
       every answer it gives is a well-formed answer. `subjectKindOf` is `parts.tsx`'s own
       AST → id direction, so a round trip through both is the check. */
    assert.ok(node.endsWith('Subject'), `\`${id}\` maps to \`${node}\`, which is not a subject node type`);
  }
  assert.equal(Object.keys(SUBJECT_NODE).length, OFFERED.length, '`SUBJECT_NODE` carries an entry for something the select does not offer');
});

test('`M228` `D`: `TF042` refuses the pairings the checker refuses, and abstains where `TF041` owns them', () => {
  const status = SUBJECT_NODE.status!;
  const response = SUBJECT_NODE.response!;
  const value = SUBJECT_NODE.value!;

  // GATE 13's table half — the scan families and the UI ones are refused on a value-bearing subject.
  for (const m of ['hasNoA11yViolations', 'hasNoSecurityViolations', 'visible', 'wasMade'] as MatcherName[]) {
    assert.ok(matcherSubjectRefusal(m, status) !== null, `\`${m}\` is offered live on a \`status\` subject`);
  }
  // …and the positive control beside it, without which "refused" is satisfied by refusing all 23.
  for (const m of ['equals', 'contains', 'greaterThan'] as MatcherName[]) {
    assert.equal(matcherSubjectRefusal(m, status), null, `\`${m}\` is greyed out on \`status\`, which is the subject it exists for`);
  }
  assert.equal(matcherSubjectRefusal('hasNoSecurityViolations', response), null, 'a security scan is refused on `response`, which is the only subject it takes');
  assert.ok(matcherSubjectRefusal('equals', response) !== null, '`equals` is live on `response`, which carries no value to compare');

  /* GATE 14 — **`{value}` abstains, and it is not an oversight.** `checkOneMatcherSubject` skips
     `ValueSubject` because `TF041` owns that pairing and says it better; a select that greyed a
     matcher out here would report one mistake twice, once as an unreachable control and once as a
     diagnostic the author cannot act on from the row. */
  for (const [id] of MATCHERS) {
    assert.equal(matcherSubjectRefusal(id, value), null, `\`${id}\` is greyed out on \`{value}\` — \`TF041\` owns that pairing (${id})`);
  }
});

test('`M228` `D`: the refusal is the checker’s own sentence, so the greyed option and the terminal agree', () => {
  const said = matcherSubjectRefusal('hasNoSecurityViolations', SUBJECT_NODE.status!);
  assert.ok(said !== null);
  assert.match(said, /TF042/, 'the option does not name the rule it is refused by');
  assert.match(said, /response/, 'the option does not say what the matcher wants instead, which is the half an author acts on');

  /* **And the rule really is the one the checker runs**, asserted by running it: the same pairing
     the option greys out raises `TF042` from `checkProgram`. Without this the two could be one
     implementation *today* and two after the next edit, and nothing would notice. */
  const { program, diagnostics } = parseSource('test "t"\n  api GET /x\n  expect status has no serious security violations\n');
  assert.equal(diagnostics.filter((d) => d.severity === 'error').length, 0, 'the fixture must parse for the checker to judge it');
  const codes = checkProgram(program).map((d) => d.code);
  assert.ok(codes.includes('TF042'), `the checker does not refuse what the select greys out — got ${JSON.stringify(codes)}`);

  // The control: swap the subject for the one the matcher takes and the diagnostic goes.
  const ok = parseSource('test "t"\n  api GET /x\n  expect response has no serious security violations\n');
  assert.ok(!checkProgram(ok.program).map((d) => d.code).includes('TF042'), 'TF042 fires on the pairing the language allows, so its absence above proves nothing');
});
