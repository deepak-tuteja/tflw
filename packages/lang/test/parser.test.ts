// AST golden tests + invariants for valid M0 sources.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '../src/index.js';
import { VALID } from './fixtures.js';
import { assertGolden, astJson } from './helpers.js';

for (const fixture of VALID) {
  test(`valid: ${fixture.name} parses with no diagnostics`, () => {
    const { diagnostics } = parseSource(fixture.source);
    assert.deepEqual(
      diagnostics.map((d) => `${d.code}: ${d.message}`),
      [],
      `expected clean parse for ${fixture.name}`,
    );
  });

  test(`valid: ${fixture.name} AST snapshot`, () => {
    const { program } = parseSource(fixture.source);
    assertGolden(`ast/${fixture.name}.json`, astJson(program));
  });
}

test('parses every top-level test', () => {
  const src = VALID.map((f) => f.source).join('\n');
  const { program, diagnostics } = parseSource(src);
  assert.equal(diagnostics.length, 0);
  assert.equal(program.tests.length, VALID.length);
});

test('parses `HEAD`/`OPTIONS` as valid HTTP methods (gap #16)', () => {
  for (const verb of ['HEAD', 'OPTIONS']) {
    const { program, diagnostics } = parseSource(`test "ok"\n  api ${verb} /health\n`);
    assert.deepEqual(diagnostics, [], `unexpected diagnostics for verb ${verb}`);
    const step = program.tests[0]!.body[0]!;
    assert.equal(step.type, 'ApiStep');
    assert.equal((step as { method: string }).method, verb);
  }
});

test('`test` defaults to `concurrency: "sequential"` when no modifier is written (D107)', () => {
  const { program, diagnostics } = parseSource('test "ok"\n  api GET /health\n');
  assert.deepEqual(diagnostics, []);
  assert.equal(program.tests[0]!.concurrency, 'sequential');
});

test('`test "…" parallel` sets concurrency to "parallel" (D105-D107)', () => {
  const { program, diagnostics } = parseSource('test "ok" parallel\n  api GET /health\n');
  assert.deepEqual(diagnostics, []);
  assert.equal(program.tests[0]!.concurrency, 'parallel');
});

test('`test "…" sequential` sets concurrency to "sequential" explicitly (D105-D107)', () => {
  const { program, diagnostics } = parseSource('test "ok" sequential\n  api GET /health\n');
  assert.deepEqual(diagnostics, []);
  assert.equal(program.tests[0]!.concurrency, 'sequential');
});

test('`retry N` and `parallel`/`sequential` compose on the same header line, retry first (D105-D107)', () => {
  const { program, diagnostics } = parseSource('test "ok" retry 2 parallel\n  api GET /health\n');
  assert.deepEqual(diagnostics, []);
  assert.equal(program.tests[0]!.retry, 2);
  assert.equal(program.tests[0]!.concurrency, 'parallel');
});

test('`as <session>` and `parallel`/`sequential` compose on the same header line (D105-D107)', () => {
  const { program, diagnostics } = parseSource('test "ok" as admin parallel\n  api GET /health\n');
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(program.tests[0]!.sessions, ['admin']);
  assert.equal(program.tests[0]!.concurrency, 'parallel');
});

test('`parallel`/`sequential` is legal alongside a workload clause (D112 — orthogonal to D96)', () => {
  const { program, diagnostics } = parseSource(
    'test "ok" parallel\n  ramp to 1 users over 1s\n  api GET /health\n',
  );
  assert.deepEqual(diagnostics, []);
  assert.equal(program.tests[0]!.concurrency, 'parallel');
  assert.ok(program.tests[0]!.workload);
});

test('parses `upload … type "…"` into UploadBody.contentType (decision 22/M19)', () => {
  const { program, diagnostics } = parseSource(
    `test "ok"\n  api POST /uploads upload "./img.png" as "avatar" type "image/png"\n`,
  );
  assert.deepEqual(diagnostics, []);
  const step = program.tests[0]!.body[0]!;
  assert.equal(step.type, 'ApiStep');
  const body = (step as { body: unknown }).body as { type: string; contentType: { value: string } | null };
  assert.equal(body.type, 'UploadBody');
  assert.equal(body.contentType?.value, 'image/png');
});

test('parses `upload … as "…"` with no `type` clause as UploadBody.contentType: null', () => {
  const { program, diagnostics } = parseSource(`test "ok"\n  api POST /uploads upload "./img.png" as "avatar"\n`);
  assert.deepEqual(diagnostics, []);
  const step = program.tests[0]!.body[0]!;
  const body = (step as { body: unknown }).body as { type: string; contentType: unknown };
  assert.equal(body.type, 'UploadBody');
  assert.equal(body.contentType, null);
});

test('parses `upload … type "…" form k=v` — `type` before `form`, both present (decision 22/M19)', () => {
  const { program, diagnostics } = parseSource(
    `test "ok"\n  api POST /uploads upload "./img.png" as "avatar" type "image/png" form owner="bob"\n`,
  );
  assert.deepEqual(diagnostics, []);
  const step = program.tests[0]!.body[0]!;
  const body = (step as { body: unknown }).body as {
    type: string;
    contentType: { value: string } | null;
    extra: readonly { key: string }[];
  };
  assert.equal(body.contentType?.value, 'image/png');
  assert.equal(body.extra.length, 1);
  assert.equal(body.extra[0]!.key, 'owner');
});

// ---- M6: `CallStmt` — a bare action/helper call as a standalone step ----

test('parses a single-word bare call as CallStmt', () => {
  const { program, diagnostics } = parseSource(`test "ok"\n  login("alice", "secret1")\n`);
  assert.deepEqual(diagnostics, []);
  const step = program.tests[0]!.body[0]!;
  assert.equal(step.type, 'CallStmt');
  const call = (step as { call: { name: string; args: readonly unknown[] } }).call;
  assert.equal(call.name, 'login');
  assert.equal(call.args.length, 2);
});

test('parses a multi-word bare call as CallStmt', () => {
  const { program, diagnostics } = parseSource(`test "ok"\n  create order("Widget")\n`);
  assert.deepEqual(diagnostics, []);
  const step = program.tests[0]!.body[0]!;
  assert.equal(step.type, 'CallStmt');
  assert.equal((step as { call: { name: string } }).call.name, 'create order');
});

test('a bare multi-word name with no `(` ever in sight is just an unknown step (CallStmt lookahead requires `(`)', () => {
  const { diagnostics } = parseSource(`test "ok"\n  create order\n`);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]!.code, 'TF011');
});

test('inside `let`, a multi-word name that never reaches `(` is still the pre-existing clear error', () => {
  const { diagnostics } = parseSource(`test "ok"\n  let x = create order\n`);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0]!.message, /looks like the start of a call but never reaches `\(`/);
});

test('a genuinely unknown single-word step keyword still errors (CallStmt lookahead does not swallow typos)', () => {
  const { diagnostics } = parseSource(`test "ok"\n  expct status equals 200\n`);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]!.code, 'TF011');
});
