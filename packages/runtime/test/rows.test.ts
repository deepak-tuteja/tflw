// `G10` (`D1384`) — a `rows` block judges a table's rows together, after the last one ends. The
// fixture is the race the sibling could not move off its helper: one email registered by five rows
// at once, where exactly one may win and the rest must be refused cleanly. Each row sees only its
// own answer; the block is the one place that sees all five.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';
import { asEntry } from './__helpers__/entry.js';

async function registerServer(winners: number) {
  let taken = 0;
  return startFixtureServer({
    '/register': (_req, res) => {
      taken += 1;
      if (taken <= winners) json(res, 201, { id: taken, result: 'created' });
      else json(res, 409, { error: 'email already registered', result: 'taken' });
    },
  });
}

const race = (lines: readonly string[]): string => [
  'with each concurrently',
  '  | n |',
  '  | 1 |', '  | 2 |', '  | 3 |', '  | 4 |', '  | 5 |',
  'test "register attempt {n}"',
  '  api POST /register',
  '  expect status is less than 500',
  'rows',
  ...lines,
  '',
].join('\n');

test('G10: the rows block counts rows by what their last response said, and reports after the rows', async () => {
  const server = await registerServer(1);
  const source = race(['  expect exactly 1 row status equals 201', '  expect 4 rows status equals 409', '  expect no rows status equals 500']);
  const { program } = parseSource(source);
  const events: string[] = [];
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, emit: (e) => { if (e.type === 'run:start') events.push(`total ${e.total}`); } });
  assert.deepEqual(events, ['total 6'], 'the forecast counts the rows entry, so a consumer is told about it before it arrives');

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.deepEqual(report.tests.map((t) => t.name), ['register attempt 1', 'register attempt 2', 'register attempt 3', 'register attempt 4', 'register attempt 5', 'register attempt {n} — rows']);
  const judged = asEntry(report.tests[5], 'functional');
  assert.deepEqual(judged.steps.map((s) => s.ok), [true, true, true]);
  assert.match(judged.steps[0]!.detail ?? '', /^1 of 5 row\(s\) matched \(row \d\) — exactly 1 asked$/);

  await server.close();
});

test('G10 control: a server that lets two win fails the count, naming the rows that matched', async () => {
  const server = await registerServer(2);
  const source = race(['  expect exactly 1 row status equals 201', '  check every row status is less than 500']);
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, false);
  assert.deepEqual(report.tests.slice(0, 5).map((t) => t.ok), [true, true, true, true, true], 'every row on its own passed — only the count across them can see the race was lost');
  const judged = asEntry(report.tests[5], 'functional');
  assert.equal(judged.ok, false);
  assert.match(judged.steps[0]!.detail ?? '', /^expected exactly 1 of 5 row\(s\) to match, but 2 did \(rows \d, \d\)$/);
  assert.equal(judged.steps.length, 1, 'a failed `expect` stops the block');

  await server.close();
});

test('G10: a value subject counts what each row captured, and a failed `check` lets the block go on', async () => {
  const server = await registerServer(1);
  const source = [
    'with each',
    '  | n |', '  | 1 |', '  | 2 |', '  | 3 |',
    'test "attempt {n}"',
    '  api POST /register',
    '  capture body.result as outcome',
    'rows',
    '  check every row {outcome} equals "created"',
    '  expect exactly 2 rows {outcome} equals "taken"',
    '',
  ].join('\n');
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  const judged = asEntry(report.tests[3], 'functional');
  assert.deepEqual(judged.steps.map((s) => s.ok), [false, true], 'the soft line failed and the next still ran');
  assert.equal(judged.ok, false);

  await server.close();
});
