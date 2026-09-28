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

// --- `skip … on env` (`M247` `B`, `D1353`) ---

test('`skip "…" on env a, b` parses to the env list, in any header position, and prints back', () => {
  for (const header of ['test "t" skip "no sandbox in CI" on env ci', 'test "t" as shopper skip "x" on env ci, staging retry 2', 'test "t" skip "x" on env ci parallel']) {
    const { program, diagnostics } = parseSource(`${header}\n${body}`);
    assert.deepEqual(diagnostics, [], header);
    assert.ok((program.tests[0]!.skipOn?.length ?? 0) > 0, header);
  }
  const t = parseSource('test "t" skip "x" on env ci, staging\n' + body).program.tests[0]!;
  assert.deepEqual(t.skipOn?.map((e) => e.name), ['ci', 'staging']);
  assert.equal(t.skipOn?.[1]?.span.start.column, 'test "t" skip "x" on env ci, '.length + 1, 'each name carries its own span');
  const printed = print(t);
  assert.ok(printed.ok);
  assert.equal(printed.text.split('\n')[0], 'test "t" skip "x" on env ci, staging');
  assert.ok(!('skipOn' in parseSource('test "t" skip "x"\n' + body).program.tests[0]!), 'absent when not written');
});

test('`on` must be followed by `env`, and `on env` needs a name', () => {
  assert.match(parseSource('test "t" skip "x" on ci\n' + body).diagnostics[0]!.message, /followed by `env`/);
  assert.ok(parseSource('test "t" skip "x" on env\n' + body).diagnostics.length > 0);
});

test('`TF088`: an env the config does not declare, one diagnostic per name, on that name', () => {
  const src = 'test "t" skip "x" on env ci, stagin, qa\n' + body;
  const diags = checkProgram(parseSource(src).program, { knownEnvs: ['local', 'ci', 'staging'] }).filter((d) => d.code === Codes.SKIP_ENV_UNKNOWN);
  assert.deepEqual(diags.map((d) => d.message), ['unknown env "stagin" in `skip … on env`', 'unknown env "qa" in `skip … on env`']);
  assert.equal(diags[0]!.hint, 'did you mean `staging`?');
  assert.match(diags[1]!.hint ?? '', /the skip holds nowhere and the test runs everywhere/);
  assert.equal(diags[0]!.span.start.column, 'test "t" skip "x" on env ci, '.length + 1);
  // Negative controls: declared names are clean, and with no config the pass does not run at all.
  assert.deepEqual(checkProgram(parseSource('test "t" skip "x" on env ci\n' + body).program, { knownEnvs: ['ci'] }).filter((d) => d.code === Codes.SKIP_ENV_UNKNOWN), []);
  assert.deepEqual(checkProgram(parseSource(src).program).filter((d) => d.code === Codes.SKIP_ENV_UNKNOWN), []);
});

test('a rebuilt header keeps its env list, and an env list without a reason writes none', () => {
  const kept = buildTest({ name: 't', tags: [], workload: null, thresholds: [], body: [], skip: 'down', skipOn: ['ci'] });
  assert.ok(kept.ok && kept.node.skipOn?.[0]?.name === 'ci');
  const none = buildTest({ name: 't', tags: [], workload: null, thresholds: [], body: [], skip: '', skipOn: ['ci'] });
  assert.ok(none.ok && !('skipOn' in none.node));
});

// `M247-04` (`G7`): a test `skip … on env X` does not run under X, so a service only another env
// declares is not an error there — the skip exists for exactly that. Found by the sibling's
// `secure-local.tflw`, which names `api plain` (an `env secureLocal` service) and is skipped on `local`.
test('`M247-04`: an env-scoped name in a test skipped on the checked env is not an error there, and is everywhere else', () => {
  const source = [
    'test "through the sidecar" skip "only the sidecar has it" on env local',
    '  api plain GET /x',
    '  expect status equals 200',
    '',
    'test "runs everywhere"',
    '  api plain GET /y',
    '  expect status equals 200',
    '',
  ].join('\n');
  const { program } = parseSource(source);
  const under = (envName: string) =>
    checkProgram(program, { knownServices: ['root'], outOfScopeSessions: { envName, declaredElsewhere: new Map() } })
      .filter((d) => d.code === 'TF026')
      .map((d) => d.span.start.line);
  // Under `local`: the skipped test's line is spared; the test that runs there is still judged.
  assert.deepEqual(under('local'), [6]);
  // Under an env the skip does not name, both are judged — the control that the spare is the skip.
  assert.deepEqual(under('ci'), [2, 6]);
});
