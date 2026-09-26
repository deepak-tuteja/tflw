// `M242` `D` (`D1329`) — the three string forms: `length of x`, `x joined with y`, and
// `capture <subject> matching "<regex>" as n`. The runtime half is `runtime/test/strings.test.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource, print } from '../src/index.js';
import { checkProgram } from '../src/checker.js';

const inTest = (...steps: string[]): string => `test "t"\n${steps.map((s) => `  ${s}\n`).join('')}`;
const errors = (src: string): string[] => {
  const { program, diagnostics } = parseSource(src);
  return [...diagnostics, ...checkProgram(program)].filter((d) => d.severity === 'error').map((d) => d.message);
};

test('`length of` is a value, and binds tighter than arithmetic', () => {
  const { program, diagnostics } = parseSource(inTest('let n = length of {xs} + 1'));
  assert.deepEqual(diagnostics, []);
  const step = program.tests[0]!.body[0]!;
  assert.equal(step.type, 'LetStmt');
  const v = (step as { value: { type: string; op?: string; left?: { type: string } } }).value;
  assert.equal(v.type, 'BinaryExpr', 'the length plus one, not the length of a sum');
  assert.equal(v.left?.type, 'LengthExpr');
});

test('`joined with` binds loosest, so each side is a whole expression', () => {
  const { program, diagnostics } = parseSource(inTest('let s = {xs} joined with ", "'));
  assert.deepEqual(diagnostics, []);
  const v = (program.tests[0]!.body[0] as unknown as { value: { type: string; list: { type: string }; separator: { type: string } } }).value;
  assert.equal(v.type, 'JoinExpr');
  assert.equal(v.list.type, 'Interp');
  assert.equal(v.separator.type, 'StringLit');
});

test('`capture … matching` carries its pattern, and a plain capture carries none', () => {
  const src = inTest('api GET /x', 'capture header "location" matching "/orders/(\\\\d+)" as id', 'capture body.a as a');
  const { program, diagnostics } = parseSource(src);
  assert.deepEqual(diagnostics, []);
  const [, withPattern, plain] = program.tests[0]!.body as unknown as { pattern?: { value: string } }[];
  assert.equal(withPattern!.pattern?.value, '/orders/(\\d+)');
  assert.ok(!('pattern' in plain!), 'every earlier tree keeps its shape');
});

test('each form prints back to itself', () => {
  for (const line of [
    'let n = length of {xs}',
    'let s = {xs} joined with ", "',
    'let t = length of {xs} + 1',
    'capture header "location" matching "/orders/(\\\\d+)" as id',
  ]) {
    const src = inTest('api GET /x', line);
    const { program } = parseSource(src);
    const printed = print(program.tests[0]!.body[1]!);
    assert.ok(printed.ok, line);
    assert.equal(printed.text, line);
  }
});

test('an unbound name inside either form is still TF030, and a bad capture regex is refused', () => {
  assert.ok(errors(inTest('let n = length of {nope}')).some((m) => /nope/.test(m)));
  assert.ok(errors(inTest('let s = {nope} joined with ","')).some((m) => /nope/.test(m)));
  assert.ok(errors(inTest('api GET /x', 'capture body.a matching "(" as a')).some((m) => /invalid regex in `capture … matching`/.test(m)));
});
