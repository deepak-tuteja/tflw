// `M242` `B` (`D1327`) — `skip "reason"` on a test header, and `TF084` when the reason says nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, print, Codes, buildTest } from '../src/index.js';
import { checkProgram } from '../src/checker.js';

const body = '  api GET /health\n  expect status equals 200\n';

test('`skip` is a header clause, beside the others and in any order, and prints back', () => {
  for (const header of ['test "t" skip "sandbox down until the 3rd"', 'test "t" as shopper retry 2 skip "flaky upstream"', 'test "t" skip "x" parallel']) {
    const { program, diagnostics } = parseSource(`${header}\n${body}`);
    assert.deepEqual(diagnostics, [], header);
    assert.ok(program.tests[0]!.skip !== undefined, header);
  }
  const src = 'test "t" retry 2 skip "flaky upstream"\n' + body;
  const printed = print(parseSource(src).program.tests[0]!);
  assert.ok(printed.ok);
  assert.equal(printed.text.split('\n')[0], 'test "t" retry 2 skip "flaky upstream"');
  assert.ok(!('skip' in parseSource('test "t"\n' + body).program.tests[0]!), 'absent when not written');
});

test('a second `skip` is refused, and the first reason stands', () => {
  const { program, diagnostics } = parseSource('test "t" skip "a" skip "b"\n' + body);
  assert.match(diagnostics[0]!.message, /already skipped/);
  assert.equal(program.tests[0]!.skip?.value, 'a');
});

test('`TF084`: a blank reason, whitespace included, and not an interpolated or written one', () => {
  const codes = (h: string) => checkProgram(parseSource(`${h}\n${body}`).program).map((d) => d.code);
  assert.ok(codes('test "t" skip ""').includes(Codes.SKIP_REASON_EMPTY));
  assert.ok(codes('test "t" skip "   "').includes(Codes.SKIP_REASON_EMPTY));
  assert.ok(!codes('test "t" skip "x"').includes(Codes.SKIP_REASON_EMPTY));
});

test('a rebuilt header keeps its skip, and a blank one writes none', () => {
  const kept = buildTest({ name: 't', tags: [], workload: null, thresholds: [], body: [], skip: 'down' });
  assert.ok(kept.ok && kept.node.skip?.value === 'down');
  const none = buildTest({ name: 't', tags: [], workload: null, thresholds: [], body: [], skip: '  ' });
  assert.ok(none.ok && !('skip' in none.node));
});
