// `M242` `D` (`D1329`) — the string forms run: `length of` agrees with `.length`, `joined with`
// joins scalars and refuses anything else by name, and `capture … matching` takes the first group.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';
import { asEntry } from './__helpers__/entry.js';

async function run(baseUrl: string, ...steps: string[]) {
  const src = `test "t"\n${steps.map((s) => `  ${s}\n`).join('')}`;
  const { program, diagnostics } = parseSource(src);
  assert.deepEqual(diagnostics, [], src);
  const { report } = await runProgram(program, testConfig(baseUrl), { source: src });
  return { ok: report.ok, error: asEntry(report.tests[0], 'functional').error ?? '' };
}

test('`length of` reads what `.length` reads, on a list and on a string', async () => {
  const server = await startFixtureServer({ '/': (_req, res) => json(res, 200, { items: [1, 2, 3], name: 'ada' }) });
  const r = await run(server.baseUrl, 'api GET /', 'capture body.items as xs', 'capture body.name as n',
    'let a = length of {xs}', 'expect {a} equals 3', 'let b = length of {n}', 'expect {b} equals 3',
    'let c = length of {xs} + 1', 'expect {c} equals 4');
  assert.equal(r.ok, true, r.error);
  const bad = await run(server.baseUrl, 'let x = 5', 'let y = length of {x}');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /`length of` expects a string or a list, got (a )?number/);
  await server.close();
});

test('`joined with` joins scalars, and refuses a non-list, a non-string separator and an object element', async () => {
  const server = await startFixtureServer({ '/': (_req, res) => json(res, 200, { tags: ['a', 'b', 1], rows: [{ id: 1 }] }) });
  const ok = await run(server.baseUrl, 'api GET /', 'capture body.tags as tags', 'let s = {tags} joined with ", "', 'expect {s} equals "a, b, 1"');
  assert.equal(ok.ok, true, ok.error);
  for (const [steps, why] of [
    [['let x = "s"', 'let y = {x} joined with ","'], /expects a list on its left, got (a )?string/],
    [['api GET /', 'capture body.tags as tags', 'let y = {tags} joined with 1'], /expects a string separator, got (a )?number/],
    [['api GET /', 'capture body.rows as rows', 'let y = {rows} joined with ","'], /joins strings and numbers, and the list holds/],
  ] as const) {
    const r = await run(server.baseUrl, ...steps);
    assert.equal(r.ok, false, steps.join(' / '));
    assert.match(r.error, why);
  }
  await server.close();
});

test('`capture … matching` takes the first group, the whole match without one, and fails on no match', async () => {
  const server = await startFixtureServer({ '/': (_req, res) => { res.setHeader('location', '/orders/4711'); json(res, 201, { code: 'AB-12' }); } });
  const r = await run(server.baseUrl, 'api GET /', 'capture header "location" matching "/orders/(\\\\d+)" as id', 'expect {id} equals "4711"',
    'capture body.code matching "[A-Z]+" as prefix', 'expect {prefix} equals "AB"');
  assert.equal(r.ok, true, r.error);
  const miss = await run(server.baseUrl, 'api GET /', 'capture body.code matching "^\\\\d+$" as n');
  assert.equal(miss.ok, false);
  assert.match(miss.error, /nothing to capture at .* matching/);
  await server.close();
});
