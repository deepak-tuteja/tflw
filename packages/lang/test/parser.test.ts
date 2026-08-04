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

test('`retry N` and `parallel`/`sequential` compose on the same header line (D105-D107)', () => {
  const { program, diagnostics } = parseSource('test "ok" retry 2 parallel\n  api GET /health\n');
  assert.deepEqual(diagnostics, []);
  assert.equal(program.tests[0]!.retry, 2);
  assert.equal(program.tests[0]!.concurrency, 'parallel');
});

// -- A2-06: the header modifiers are order-independent (M72) ------------------------------------
//
// They used to have a hard-coded sequence — `as`, then `retry`, then `parallel`/`sequential` — and
// anything else fell through to `endLine()`, so `test "x" retry 2 as admin` reported "unexpected
// `as` at end of step": a valid keyword called invalid, a header called a step, and the hint
// "expected end of line" on a line that was not finished. Nothing documented the order, which made
// it exactly the sort of arbitrary rule §15's freeze would have made permanent.

test('A2-06: the three header modifiers parse in any order', () => {
  const orders = [
    'as admin retry 2 parallel',
    'as admin parallel retry 2',
    'retry 2 as admin parallel',
    'retry 2 parallel as admin',
    'parallel as admin retry 2',
    'parallel retry 2 as admin',
  ];
  for (const modifiers of orders) {
    const { program, diagnostics } = parseSource(`test "ok" ${modifiers}\n  api GET /health\n`);
    assert.deepEqual(diagnostics, [], `expected \`test "ok" ${modifiers}\` to parse`);
    const t = program.tests[0]!;
    assert.deepEqual(
      { sessions: t.sessions, retry: t.retry, concurrency: t.concurrency },
      { sessions: ['admin'], retry: 2, concurrency: 'parallel' },
      `\`${modifiers}\` must describe the same test as every other order`,
    );
  }
});

test('A2-06: a multi-session `as` list still composes with the others in any order', () => {
  for (const modifiers of ['retry 3 as admin, userA sequential', 'sequential as admin, userA retry 3']) {
    const { program, diagnostics } = parseSource(`test "ok" ${modifiers}\n  api GET /health\n`);
    assert.deepEqual(diagnostics, [], `expected \`${modifiers}\` to parse`);
    assert.deepEqual(program.tests[0]!.sessions, ['admin', 'userA']);
    assert.equal(program.tests[0]!.retry, 3);
    assert.equal(program.tests[0]!.concurrency, 'sequential');
  }
});

test('A2-06: repeating a modifier is an error that names it, not last-one-wins', () => {
  for (const [header, message, hint] of [
    ['test "ok" as admin as userA', 'this test already has an `as` clause', 'comma-separated'],
    ['test "ok" retry 1 retry 2', 'this test already has a `retry` count', 'silently win'],
    ['test "ok" parallel parallel', 'this test is already `parallel`', 'one way or the other'],
    ['test "ok" parallel sequential', 'this test is already `parallel`, so it cannot also be `sequential`', 'one way or the other'],
  ] as const) {
    const { diagnostics } = parseSource(`${header}\n  api GET /health\n`);
    const errs = diagnostics.filter((d) => d.severity !== 'warning');
    assert.equal(errs.length, 1, `expected exactly one diagnostic for \`${header}\`, got ${JSON.stringify(errs.map((d) => d.message))}`);
    assert.equal(errs[0]!.code, 'TF010');
    assert.equal(errs[0]!.message, message);
    assert.match(errs[0]!.hint ?? '', new RegExp(hint));
  }
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
