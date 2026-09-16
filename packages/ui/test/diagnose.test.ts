// `diagnose`'s own contract — `M200` `A1-4` (`D1052`).
//
// WHY THIS FILE EXISTS RATHER THAN MORE BROWSER CASES. `diagnose` has one guard the forms can
// never reach: it returns nothing when the text does not parse, and `insertIntoSource` already
// refuses to hand back text that does not parse, so `pending.ok` implies a clean parse and that
// branch is dead from the page's side. The mutation deleting it SURVIVED the browser gate for
// exactly that reason — the same unreachable-branch shape `A0-1` found in the printer's
// quantifier, which is what the ledger keeps re-filing.
//
// The resolution is different from `A0-1`'s, because the situation is. There the branch could not
// be reached by ANY caller, so it became a refusal. Here the module is exported and its contract
// is "what would `tflw check` say about this text" — a question somebody may ask about text that
// does not parse — so the branch stays and is tested against the contract instead of through the
// only caller that exists today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProgram, parseSource } from '@tflw/lang';
import { diagnose } from '../src/diagnose';

test('diagnose reports what `tflw check` would say', () => {
  const unbound = 'test "t"\n  api GET /x\n    header "A" is "Bearer {token}"\n  expect status equals 200\n';
  const found = diagnose(unbound);
  assert.equal(found.length, 1, JSON.stringify(found));
  assert.equal(found[0]!.code, 'TF030');
  assert.match(found[0]!.message, /token/);
});

test('a file that already checks gets an empty list, not a reassurance', () => {
  const clean = 'test "t"\n  api GET /x\n  capture body.id as id\n  api GET /x/{id}\n  expect status equals 200\n';
  assert.deepEqual([...diagnose(clean)], []);
});

test('text that does not parse yields nothing, so one mistake is not reported twice', () => {
  // The write route's own `422` already names the parse error (`D1049`), and the form shows that
  // as its refusal. Running the checker over a recovery tree on top of it would report the same
  // mistake a second time, in worse words.
  //
  // THE FIXTURE HAS TO CARRY A CHECKER DIAGNOSTIC TOO, and the first draft did not. `api GET`
  // alone fails to parse and its recovery tree gives the checker **nothing to say**, so deleting
  // the guard changed no result and the mutation survived — the `A0-1` percentage finding again,
  // a fixture whose inputs cannot falsify its claim. This one also references a variable nothing
  // binds, which the checker reports as `TF030` **on the recovery tree**, so the guard is the
  // only thing between the author and hearing about line 3 while line 2 is what is broken.
  const broken = 'test "t"\n  api GET\n  expect body.id equals {nope}\n';
  const { program, diagnostics } = parseSource(broken);
  assert.ok(diagnostics.some((d) => d.severity === 'error'), 'the fixture itself must not parse');
  assert.ok(checkProgram(program).length > 0, 'the recovery tree must give the checker something to say');
  assert.deepEqual([...diagnose(broken)], []);
});

test('the worst diagnostic is first, because a panel is read from the top', () => {
  // One warning and one error, with the WARNING on the earlier line — so a list that kept source
  // order and a list that ranks by severity disagree, which is the only arrangement that can tell
  // them apart. An absolute URL is `TF057` (a warning: `--env` will not move this step) and the
  // unbound reference below it is `TF030` (an error).
  const mixed = 'test "t"\n  api GET https://example.com/x\n  expect body.id equals {nope}\n';
  const found = diagnose(mixed);
  assert.deepEqual(found.map((d) => `${d.severity}:${d.code}`), ['error:TF030', 'warning:TF057']);
  assert.ok(found[0]!.span.start.line > found[1]!.span.start.line, 'and that is not source order');
});

