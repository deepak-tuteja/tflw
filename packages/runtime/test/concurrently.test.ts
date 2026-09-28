// `M247` `E` (`D1359`) — `with each concurrently` runs a table's rows at once. The proof is a COUNT,
// not a timing: the fixture holds every request open until as many as the table has rows are in
// flight (or a short deadline passes), and records the most it ever saw at once. Sequential rows can
// never have two in flight; concurrent ones reach the table's size. `M243-17`'s Windows timer coin is
// the shape a timing assertion would take, and this avoids it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

const ROWS = 10;

async function counterServer() {
  let inFlight = 0;
  let most = 0;
  const waiters: (() => void)[] = [];
  const server = await startFixtureServer({
    '/reserve': (req, res) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      const release = (): void => {
        inFlight -= 1;
        const sku = new URL(req.url ?? '/', 'http://x').searchParams.get('sku');
        json(res, sku === 'bad' ? 409 : 201, { sku });
      };
      if (inFlight >= ROWS) {
        for (const w of waiters.splice(0)) w();
        release();
        return;
      }
      const timer = setTimeout(() => {
        const i = waiters.indexOf(go);
        if (i >= 0) waiters.splice(i, 1);
        release();
      }, 400);
      const go = (): void => {
        clearTimeout(timer);
        release();
      };
      waiters.push(go);
    },
  });
  return { server, most: () => most };
}

function table(concurrently: boolean, skus: readonly string[]): string {
  return [
    `with each${concurrently ? ' concurrently' : ''}`,
    '  | sku |',
    ...skus.map((s) => `  | "${s}" |`),
    'test "reserve {sku}"',
    '  api GET /reserve?sku={sku}',
    '  expect status equals 201',
    '',
  ].join('\n');
}

test('ten rows marked `concurrently` are all in flight at once, and each is still its own case in row order', async () => {
  const { server, most } = await counterServer();
  const skus = Array.from({ length: ROWS }, (_, i) => `S-${i}`);
  const src = table(true, skus);
  const { report } = await runProgram(parseSource(src).program, testConfig(server.baseUrl), { source: src });
  assert.equal(most(), ROWS, 'every row was in flight together');
  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.deepEqual(report.tests.map((t) => t.name), skus.map((s) => `reserve ${s}`), 'reported in row order, whatever finished first');
  await server.close();
});

test('control: the same table without `concurrently` never has two in flight', async () => {
  const { server, most } = await counterServer();
  const src = table(false, ['S-0', 'S-1', 'S-2']);
  const { report } = await runProgram(parseSource(src).program, testConfig(server.baseUrl), { source: src });
  assert.equal(most(), 1);
  assert.equal(report.ok, true);
  await server.close();
});

test('a failing row cancels nothing: the others run to their end and pass', async () => {
  const { server } = await counterServer();
  const src = table(true, ['S-0', 'bad', 'S-2']);
  const events: string[] = [];
  const { report } = await runProgram(parseSource(src).program, testConfig(server.baseUrl), { source: src, emit: (e) => { if (e.type === 'test:end') events.push(e.result.name); } });
  assert.deepEqual(report.tests.map((t) => t.ok), [true, false, true]);
  assert.equal(events.length, 3, 'every row streams its own end');
  await server.close();
});
