// M2.5: `with each` data tables (SPEC §4.3). Inline rows are unevaluated expressions — generators
// draw a fresh value per row, at that case's own execution time. File-backed rows (.csv/.json)
// are already-resolved literals. Either way: one reported case per row, and `{col}` interpolates
// into that case's display name from the SAME evaluated values used to run the case (no double
// evaluation of generators between "name" and "scope").

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('an inline `with each` table runs one case per row, interpolating `{col}` into the test name', async () => {
  const server = await startFixtureServer({
    '/invites': (_req, res) => json(res, 201, { ok: true }),
  });

  const source = `with each
  | role  |
  | "admin" |
  | "guest" |
test "invite a {role}"
  api POST /invites body { role: {role} }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.total, 2);
  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.deepEqual(
    report.tests.map((t) => t.name),
    ['invite a admin', 'invite a guest'],
  );
  const bodies = server.received.get('/invites')!.map((r) => JSON.parse(r.body).role);
  assert.deepEqual(bodies, ['admin', 'guest']);

  await server.close();
});

test('inline table cells are full expressions — a generator draws a fresh value per row', async () => {
  const server = await startFixtureServer({
    '/invites': (_req, res) => json(res, 201, { ok: true }),
  });

  const source = `with each
  | role  |
  | "admin" |
  | "admin" |
test "invite {role}"
  let email = unique email
  api POST /invites body { role: {role}, email: {email} }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const emails = server.received.get('/invites')!.map((r) => JSON.parse(r.body).email);
  assert.notEqual(emails[0], emails[1]); // same row data, distinct generator draws

  await server.close();
});

test('a file-backed `with each from "./x.csv"` table binds one case per data row', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-table-csv-'));
  await writeFile(join(dir, 'invites.csv'), 'role,email\nadmin,a@x.test\nguest,g@x.test\n');
  const server = await startFixtureServer({ '/invites': (_req, res) => json(res, 201, { ok: true }) });

  const source = `with each from "./invites.csv"
test "invite {role} ({email})"
  api POST /invites body { role: {role}, email: {email} }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir });

  assert.equal(report.total, 2);
  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.deepEqual(
    report.tests.map((t) => t.name),
    ['invite admin (a@x.test)', 'invite guest (g@x.test)'],
  );

  await rm(dir, { recursive: true, force: true });
  await server.close();
});

test('a file-backed `with each from "./x.json"` table binds one case per array element', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-table-json-'));
  await writeFile(join(dir, 'invites.json'), JSON.stringify([{ role: 'admin', email: 'a@x.test' }, { role: 'guest', email: 'g@x.test' }]));
  const server = await startFixtureServer({ '/invites': (_req, res) => json(res, 201, { ok: true }) });

  const source = `with each from "./invites.json"
test "invite {role} ({email})"
  api POST /invites body { role: {role}, email: {email} }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir });

  assert.equal(report.total, 2);
  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.deepEqual(
    report.tests.map((t) => t.name),
    ['invite admin (a@x.test)', 'invite guest (g@x.test)'],
  );

  await rm(dir, { recursive: true, force: true });
  await server.close();
});

test('a CSV field with a comma survives when quoted, instead of desyncing later columns (decision 65)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-table-csv-quoted-'));
  await writeFile(join(dir, 'invites.csv'), 'name,age\n"Smith, John",30\nguest,22\n');
  const server = await startFixtureServer({ '/invites': (_req, res) => json(res, 201, { ok: true }) });

  const source = `with each from "./invites.csv"
test "invite {name}, age {age}"
  api POST /invites body { name: {name}, age: {age} }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  const bodies = server.received.get('/invites')!.map((r) => JSON.parse(r.body));
  assert.deepEqual(bodies[0], { name: 'Smith, John', age: 30 });
  assert.deepEqual(bodies[1], { name: 'guest', age: 22 });

  await rm(dir, { recursive: true, force: true });
  await server.close();
});

test('a numeric-looking CSV cell is coerced to a real number, so `equals` matches a real JSON number (decision 65)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-table-csv-numeric-'));
  await writeFile(join(dir, 'orders.csv'), 'qty\n3\n');
  const server = await startFixtureServer({ '/orders': (_req, res) => json(res, 200, { qty: 3 }) });

  const source = `with each from "./orders.csv"
test "qty {qty} matches the real JSON number"
  api GET /orders
  expect body.qty equals {qty}
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));

  await rm(dir, { recursive: true, force: true });
  await server.close();
});

test('a CSV row with the wrong cell count is a clear runtime error, not silent padding/truncation (decision 65)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-table-csv-badrow-'));
  await writeFile(join(dir, 'invites.csv'), 'role,email\nadmin,a@x.test\nguest\n');
  const server = await startFixtureServer({ '/invites': (_req, res) => json(res, 201, { ok: true }) });

  const source = `with each from "./invites.csv"
test "invite {role} ({email})"
  api POST /invites body { role: {role}, email: {email} }
  expect status equals 201
`;
  const { program } = parseSource(source);
  await assert.rejects(
    runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir }),
    /row 3 has 1 cell, expected 2/,
  );

  await rm(dir, { recursive: true, force: true });
  await server.close();
});

test('a missing/unreadable data table file is a clear runtime error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-table-missing-'));
  const source = `with each from "./nope.csv"
test "invite {role}"
  api GET /health
`;
  const { program } = parseSource(source);
  await assert.rejects(runProgram(program, testConfig('http://127.0.0.1:1'), { source, baseDir: dir }), /could not read data table file/);

  await rm(dir, { recursive: true, force: true });
});

test('`test:start`/`test:end` events fire once per row with the interpolated name', async () => {
  const server = await startFixtureServer({ '/invites': (_req, res) => json(res, 201, { ok: true }) });
  const source = `with each
  | role  |
  | "admin" |
  | "guest" |
test "invite a {role}"
  api POST /invites body { role: {role} }
  expect status equals 201
`;
  const { program } = parseSource(source);
  const events: string[] = [];
  await runProgram(program, testConfig(server.baseUrl), {
    source,
    emit: (ev) => {
      if (ev.type === 'test:start') events.push(`start:${ev.name}`);
      if (ev.type === 'test:end') events.push(`end:${ev.result.name}`);
    },
  });

  assert.deepEqual(events, ['start:invite a admin', 'end:invite a admin', 'start:invite a guest', 'end:invite a guest']);

  await server.close();
});

test('a plain test with no table still runs as a single case (unaffected by the table feature)', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = `test "health check"
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.total, 1);
  assert.equal(report.tests[0]!.name, 'health check');

  await server.close();
});

// ---------------------------------------------------------------------------
// `M147c` (`A4-18`) — the remedy a mistyped column gets.
//
// A row-case's *name* is evaluated in a scope holding the row's cells and nothing else. So when a
// `{col}` in it fails to resolve, the general unbound-variable sentence — *"is it defined with
// `let` or `capture` earlier?"* — names two keywords that could not have helped, in the one scope
// where the header is the only thing that can bind anything. The row was filed on that: not a
// missing error, a **wrong remedy**.
//
// `checkDataTables` raises `TF027` for the identical mistake on an *inline* table and cannot reach
// the file-backed one: those columns are not known until the file is read and `@tflw/lang` does no
// I/O (SPEC §4.3, D144). The runtime holds the loaded row, so it says `TF027`'s sentence — the same
// words, the same "did you mean", no code, because the runtime carries none (`V4-12`).
//
// The blunt control: delete the `checkNameColumns` call and the three positives below fail while
// the last two — the ones asserting the general message is still general — keep passing. That
// asymmetry is the point of including them.

test('a mistyped column in a file-backed table names the column, not `let` and `capture` (A4-18)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-table-typo-'));
  await writeFile(join(dir, 'rows.csv'), 'name\nalice\n');
  const source = `with each from "./rows.csv"
test "row {nmae}"
  api GET /health
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source, baseDir: dir });

  assert.equal(report.ok, false);
  const error = report.tests[0]!.error!;
  assert.match(error, /unknown table column "nmae" referenced in the test name/);
  assert.match(error, /did you mean `name`\?/);
  // The half the row is actually about — the old remedy pointed at two keywords that cannot bind a
  // table column, and a fix that only *added* words would have left it there.
  assert.doesNotMatch(error, /`let` or `capture`/);

  await rm(dir, { recursive: true, force: true });
});

test('with no near spelling, it lists the row\'s columns and names the file they came from', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-table-far-'));
  await writeFile(join(dir, 'rows.csv'), 'name,email\nalice,a@x.test\n');
  const source = `with each from "./rows.csv"
test "row {quantity}"
  api GET /health
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source, baseDir: dir });

  const error = report.tests[0]!.error!;
  assert.match(error, /this row from ".\/rows.csv" has: name, email/);

  await rm(dir, { recursive: true, force: true });
});

test('an inline table reaching the runtime unchecked gets the same sentence `TF027` gives', async () => {
  // Not dead code behind `TF027`: this is what `tflw run` says to anyone who never ran
  // `tflw check`, and saying it differently would be two remedies for one mistake.
  const source = `with each
  | name |
  | "alice" |
test "row {nmae}"
  api GET /health
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error!, /unknown table column "nmae" referenced in the test name/);
});

test('a correctly spelled column is silent — the check does not fire on a name it can resolve', async () => {
  const server = await startFixtureServer({ '/health': (_req, res) => json(res, 200, { ok: true }) });
  const source = `with each
  | name |
  | "alice" |
test "row {name}"
  api GET /health
  expect status equals 200
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source });

  assert.equal(report.ok, true, JSON.stringify(report.tests, null, 2));
  assert.deepEqual(report.tests.map((t) => t.name), ['row alice']);

  await server.close();
});

test('the general unbound-variable remedy survives where it is still the right one', async () => {
  // `lookupVar` is reached from every expression in the language and knows nothing about tables.
  // Widening *it* instead of checking at the one site that knows the scope is a table row would
  // have made this message wrong: here `let` and `capture` are exactly what is missing.
  // A `log` step so the reference is evaluated on its own, with no request in front of it to fail
  // first — the first draft used a header and measured the blocked-port error instead.
  const source = `test "t"
  log "{traceId}"
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source });

  assert.equal(report.ok, false);
  const error = report.tests[0]!.error!;
  assert.match(error, /unknown variable "traceId" — is it defined with `let` or `capture` earlier\?/);
  assert.doesNotMatch(error, /unknown table column/);
});
