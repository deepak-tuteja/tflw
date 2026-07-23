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
