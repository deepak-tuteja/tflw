// M125b2, `FU-15`, D259. Following the documented `.ts` escape hatch (SPEC §11) in a project with
// no `"type": "module"` printed four raw lines of Node warning *above* the results — the only
// stack-trace-flavoured output that got past the diagnostics layer.
//
// Three interception shapes were measured before any code was written, and only one is safe:
//
//   · `process.on('warning', …)`                    — handler fires AND Node still prints. No good.
//   · `removeAllListeners('warning')` then add      — suppresses, but tflw now owns every warning.
//   · capture the listeners, remove, delegate back  — suppresses, and nothing else changes.
//
// The second row is the trap, and `delegates-every-other-warning` below is the test that exists
// entirely to keep the implementation off it: with a "remove and print our own" handler, a
// `DeprecationWarning` or an `ExperimentalWarning` from a dependency reaches the user only if tflw
// remembered to re-implement Node's format for it. Delegation makes "don't eat a warning you
// needed" a property of the code rather than a promise in a review comment — and nothing else in
// the suite would notice its loss.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { interceptTypelessModuleWarning, resetTypelessModuleRestatement } from '../src/helpers.js';
import { startFixtureServer, testConfig, json } from './support.js';

/** Run `fn` with stderr collected rather than printed, and give the warning queue a chance to
 * drain — `process.emitWarning` defers to `nextTick`, so an assertion made synchronously after the
 * emit is asserting about nothing. */
async function captureStderr(fn: () => void | Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  (process.stderr as { write: unknown }).write = (chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
  try {
    await fn();
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    (process.stderr as { write: unknown }).write = original;
  }
  return chunks.join('');
}

test('the raw MODULE_TYPELESS_PACKAGE_JSON warning is replaced by one tflw line', async () => {
  resetTypelessModuleRestatement();
  const restore = interceptTypelessModuleWarning();
  const out = await captureStderr(() => {
    const warning = new Error('Module type of file:///x/helpers.ts is not specified …');
    (warning as Error & { code?: string }).code = 'MODULE_TYPELESS_PACKAGE_JSON';
    process.emitWarning(warning);
  });
  restore();

  assert.match(out, /⚠ tflw:/);
  assert.match(out, /"type": "module"/);
  assert.doesNotMatch(out, /MODULE_TYPELESS_PACKAGE_JSON/);
  assert.doesNotMatch(out, /trace-warnings/);
});

test('it is restated once per run, not once per helper', async () => {
  resetTypelessModuleRestatement();
  const restore = interceptTypelessModuleWarning();
  const out = await captureStderr(() => {
    for (let i = 0; i < 3; i++) {
      const warning = new Error('Module type of file:///x/helper.ts is not specified …');
      (warning as Error & { code?: string }).code = 'MODULE_TYPELESS_PACKAGE_JSON';
      process.emitWarning(warning);
    }
  });
  restore();

  assert.equal(out.match(/⚠ tflw:/g)?.length, 1, out);
});

test('delegates every other warning back to Node, in Node’s own voice (D259)', async () => {
  // The one that stops "remove and print our own". A deprecation from a dependency must arrive
  // byte-identical, `(Use \`node --trace-deprecation …\`)` tail included — none of which tflw
  // formats itself.
  resetTypelessModuleRestatement();
  const restore = interceptTypelessModuleWarning();
  const out = await captureStderr(() => {
    process.emitWarning('the old way is going away', 'DeprecationWarning', 'DEP9999');
  });
  restore();

  assert.match(out, /DEP9999/, out);
  assert.match(out, /the old way is going away/, out);
  assert.match(out, /DeprecationWarning/, out);
  assert.doesNotMatch(out, /⚠ tflw:/, out);
});

test('a bare string warning with no code is delegated too', async () => {
  resetTypelessModuleRestatement();
  const restore = interceptTypelessModuleWarning();
  const out = await captureStderr(() => {
    process.emitWarning('something worth knowing');
  });
  restore();

  assert.match(out, /something worth knowing/, out);
  assert.doesNotMatch(out, /⚠ tflw:/, out);
});

test('the uninstaller restores exactly the listener set that was there before', () => {
  // `tflw watch` is a long-lived process that loads helpers on every save. A handler left behind,
  // or a captured listener not put back, accumulates silently across a session.
  const before = process.listeners('warning');
  const restore = interceptTypelessModuleWarning();
  assert.equal(process.listeners('warning').length, 1, 'ours should be the only listener while installed');
  restore();
  const after = process.listeners('warning');
  assert.deepEqual(after, before);
});

test('the interception is installed around the helper-loading loop, and gone once it finishes (D259 scoping)', async () => {
  // **The real end-to-end lives in `packages/cli/test/e2e.test.ts`, and has to.** These tests run
  // under `node --import tsx`, and tsx resolves `.ts` itself — so Node never reaches its own
  // detect-module path and never emits the warning at all, no matter how the fixture project is
  // shaped. The first draft of this test asserted against an empty stderr and would have "passed"
  // three `doesNotMatch`es while proving nothing; the harness suppresses the condition the row is
  // about. Same lesson as the row's own withdrawn correction: an observation is only as good as
  // the instrument that made it.
  //
  // What *is* checkable here, and is not checkable anywhere else, is the scoping decision — that
  // the handler is live for the duration of the loop and not one moment longer. A helper that emits
  // the warning from its own module body proves both halves, because the module body runs inside
  // the loop.
  const dir = await mkdtemp(join(tmpdir(), 'tflw-fu15-scope-'));
  await writeFile(
    join(dir, 'noisy.ts'),
    `const w = new Error('Module type of file://noisy.ts is not specified …');
(w as Error & { code?: string }).code = 'MODULE_TYPELESS_PACKAGE_JSON';
process.emitWarning(w);
export function makeLabel(_ctx: { env: NodeJS.ProcessEnv }, n: number): string {
  return \`n-\${n}\`;
}
`,
    'utf8',
  );
  const server = await startFixtureServer({ '/echo': (_req, res) => json(res, 200, { ok: true }) });
  try {
    const source = `use "./noisy.ts"

test "x"
  let l = make label(1)
  api POST /echo body { label: {l} }
  expect status equals 200
`;
    const { program } = parseSource(source);

    resetTypelessModuleRestatement();
    let report: Awaited<ReturnType<typeof runProgram>>['report'] | undefined;
    const during = await captureStderr(async () => {
      ({ report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir }));
    });

    assert.equal(report?.ok, true, report?.tests[0]?.error ?? '');
    assert.match(during, /⚠ tflw:/, during);
    assert.doesNotMatch(during, /MODULE_TYPELESS_PACKAGE_JSON/, during);

    // …and afterwards the process is Node's again. A handler that outlived the loop would restate
    // this one too, which is the accumulation `tflw watch` would suffer a save at a time.
    resetTypelessModuleRestatement();
    const after = await captureStderr(() => {
      const w = new Error('Module type of file://elsewhere.ts is not specified …');
      (w as Error & { code?: string }).code = 'MODULE_TYPELESS_PACKAGE_JSON';
      process.emitWarning(w);
    });
    assert.match(after, /MODULE_TYPELESS_PACKAGE_JSON/, after);
    assert.doesNotMatch(after, /⚠ tflw:/, after);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
