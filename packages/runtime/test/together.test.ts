// `G1` (`D1381`) and `G3` (`D1382`). The barrier is proved by a COUNT, the way `concurrently.test.ts`
// proves overlap: each row's setup is held for a different time, and the racing request records how
// many setups had finished when it arrived. With `together` every race arrives after every setup;
// without it the fast row's race arrives while the slow row is still setting up. No timing is
// asserted, so `M243-17`'s timer coin has nothing to land on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';
import { asEntry } from './__helpers__/entry.js';

async function raceServer() {
  let setupsDone = 0;
  const seenAtRace: number[] = [];
  const server = await startFixtureServer({
    '/setup': (req, res) => {
      const params = new URL(req.url ?? '/', 'http://x').searchParams;
      const ms = Number(params.get('ms') ?? 0);
      const code = Number(params.get('code') ?? 200);
      setTimeout(() => {
        setupsDone += 1;
        json(res, code, {});
      }, ms);
    },
    '/race': (_req, res) => {
      seenAtRace.push(setupsDone);
      json(res, 201, {});
    },
  });
  return { server, seenAtRace };
}

function race(withBarrier: boolean, rows: readonly [ms: number, code: number][]): string {
  return [
    'with each concurrently',
    '  | ms | code |',
    ...rows.map(([ms, code]) => `  | ${ms} | ${code} |`),
    'test "row {ms}"',
    '  api GET /setup?ms={ms}&code={code}',
    '  expect status equals 200',
    ...(withBarrier ? ['  together'] : []),
    '  api GET /race',
    '  expect status equals 201',
    '',
  ].join('\n');
}

test('G1: `together` holds every row until all have set up, then the race leaves at once', async () => {
  const { server, seenAtRace } = await raceServer();
  const source = race(true, [[0, 200], [300, 200], [150, 200]]);
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.deepEqual(seenAtRace, [3, 3, 3], 'every race arrived after all three setups');
  const barrier = asEntry(report.tests[0], 'functional').steps.find((s) => s.kind === 'together')!;
  assert.equal(barrier.detail, 'together: 3 of 3 row(s) went on at once');

  await server.close();
});

test('G1 control: without `together` the fast row races while the slow one is still setting up', async () => {
  const { server, seenAtRace } = await raceServer();
  const source = race(false, [[0, 200], [300, 200]]);
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.equal(seenAtRace[0], 1, `the first race saw ${seenAtRace[0]} setup(s) done — the barrier-less rows did not overlap as expected`);

  await server.close();
});

test('G1: a row that fails before the barrier does not hold the others, and the step says so', async () => {
  const { server, seenAtRace } = await raceServer();
  const source = race(true, [[0, 500], [100, 200], [200, 200]]);
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.deepEqual(report.tests.map((t) => t.ok), [false, true, true], 'row order kept; only the failed row fails');
  assert.equal(seenAtRace.length, 2);
  const barrier = asEntry(report.tests[1], 'functional').steps.find((s) => s.kind === 'together')!;
  assert.equal(barrier.detail, 'together: 2 of 3 row(s) went on at once, 1 had ended before reaching it');

  await server.close();
});

test('G3: a value `before file` makes is read by every test, row, each-scope hook and `after file`', async () => {
  const seen: string[] = [];
  const server = await startFixtureServer({
    '/coupons': (_req, res) => json(res, 201, { code: 'RACE-7' }),
    '/use': (req, res) => {
      seen.push(new URL(req.url ?? '/', 'http://x').searchParams.get('c') ?? '');
      json(res, 200, {});
    },
  });
  const source = [
    'before file',
    '  api POST /coupons',
    '  capture body.code as coupon',
    'before',
    '  api GET /use?c=hook-{coupon}',
    'with each concurrently',
    '  | who |',
    '  | "a" |',
    '  | "b" |',
    'test "{who} redeems {coupon}"',
    '  api GET /use?c={who}-{coupon}',
    '  expect status equals 200',
    'test "a later test reads it too"',
    '  api GET /use?c=later-{coupon}',
    'after file',
    '  api GET /use?c=after-{coupon}',
    '',
  ].join('\n');
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.deepEqual(report.tests.map((t) => t.name), ['a redeems RACE-7', 'b redeems RACE-7', 'a later test reads it too']);
  assert.deepEqual([...seen].sort(), ['a-RACE-7', 'after-RACE-7', 'b-RACE-7', 'hook-RACE-7', 'hook-RACE-7', 'hook-RACE-7', 'later-RACE-7']);

  await server.close();
});
