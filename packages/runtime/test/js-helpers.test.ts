// M2: the JS/TS escape hatch — `use "./helpers/x.ts"` + a call like `sign payload({body})`
// (P#11, SPEC §11). Calls camelCase the multi-word name (`sign payload` → `signPayload`) to find
// the export; the helper gets `(ctx, ...args)` — test context in, values out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

test('a `use`d TypeScript helper is called via camelCase and its return value flows into the test', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-use-'));
  await writeFile(
    join(dir, 'sign.ts'),
    `export function signPayload(ctx: { env: NodeJS.ProcessEnv }, orderId: number): string {
  return \`sig-\${ctx.env.SIGNING_SALT}-\${orderId}\`;
}
`,
  );

  const server = await startFixtureServer({ '/webhooks': (_req, res) => json(res, 200, { ok: true }) });
  const source = `use "./sign.ts"

test "signs a webhook payload"
  let sig = sign payload(42)
  api POST /webhooks body { orderId: 42, sig: {sig} }
  expect status equals 200
`;
  const { program } = parseSource(source);
  const environ = { ...process.env, SIGNING_SALT: 'pepper' };
  const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir, environ });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  const body = JSON.parse(server.received.get('/webhooks')![0]!.body);
  assert.equal(body.sig, 'sig-pepper-42');
  assert.match(report.tests[0]!.steps[0]!.detail ?? '', /sign payload\(42\) = "sig-pepper-42"/);

  await server.close();
  await rm(dir, { recursive: true, force: true });
});

test('an async helper export is awaited', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-use-async-'));
  await writeFile(
    join(dir, 'helpers.ts'),
    `export async function double(_ctx: unknown, n: number): Promise<number> {
  await new Promise((r) => setTimeout(r, 5));
  return n * 2;
}
`,
  );

  const source = `use "./helpers.ts"

test "async helper"
  let x = double(21)
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source, baseDir: dir });

  assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  assert.match(report.tests[0]!.steps[0]!.detail ?? '', /double\(21\) = 42/);

  await rm(dir, { recursive: true, force: true });
});

// A helper using a TS-only runtime construct (enum/namespace/parameter property) failing with a
// teaching error (P#43) can't be unit-tested here: this whole test file runs under
// `node --import tsx --test`, and tsx's own loader hook (registered process-wide by `--import
// tsx`) intercepts the helper's dynamic `import()` too, transforming the enum away before Node's
// native strip-only mode ever sees it. That case is instead covered by
// packages/cli/test/e2e.test.ts, which spawns a clean `node dist/cli.js` subprocess with no tsx
// loader — the same environment a real installed `tflw` runs in.

test('a `use`d module with no matching export is a clear runtime error', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-use-missing-'));
  await writeFile(join(dir, 'helpers.ts'), `export function somethingElse(): number { return 1; }\n`);

  const source = `use "./helpers.ts"

test "calls the wrong name"
  let x = do the thing()
`;
  const { program } = parseSource(source);
  const { report } = await runProgram(program, testConfig('http://127.0.0.1:1'), { source, baseDir: dir });

  assert.equal(report.ok, false);
  assert.match(report.tests[0]!.error ?? '', /unknown call `do the thing\(\.\.\.\)`/);

  await rm(dir, { recursive: true, force: true });
});
