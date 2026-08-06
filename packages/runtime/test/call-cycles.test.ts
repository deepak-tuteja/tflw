// M97d (`PLAN_M97_CHECKER_CONTRACT.md`, D141) — `A4-13`'s runtime half.
//
// `TF044` rejects a cycle whose every action is declared in one file. This file is about the two
// things that leaves behind, and D141 calls the second of them the load-bearing one:
//
//   1. **The residue guard.** A cycle that leaves the file through an `import` and comes back is
//      invisible to the checker — `KnownAction` carries a name and an arity, not a body — and
//      always will be until that changes. Clause 2 of the contract (D137) is bounded by
//      decidability, so whatever the checker cannot reach is by construction the runtime's job.
//   2. **The bounded failure chain.** `execCall` used to prefix `action "x" failed: ` onto its
//      callee's already-prefixed message, once per level, with nothing bounding it.
//
// Measured on the built CLI before this milestone, on a two-line self-recursive action:
//
//   stderr:            Exception in PromiseRejectCallback … RangeError: Maximum call stack size
//   longest line:      14,505 characters
//   report/results.json: 32,279 bytes   report.html: 55,580 bytes   junit.xml: 42,708 bytes
//
// The numbers are the assertion. Every test below states its negative control.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSource } from '@tflw/lang';
import { runProgram } from '../src/interpreter.js';
import { startFixtureServer, testConfig, json } from './support.js';

/** The cross-file shape the checker structurally cannot see: `a` is here, `b` is imported, and `b`
 * calls back into `a`. `buildRegistry` resolves the import at run time, so the cycle is real. */
async function crossFileCycleDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-cycle-'));
  await writeFile(join(dir, 'other.tflw'), 'action b()\n  a()\n');
  return dir;
}

test('a cross-file cycle fails with a message naming it, not a RangeError', async () => {
  const server = await startFixtureServer({ '/x': (_req, res) => json(res, 200, { ok: true }) });
  const dir = await crossFileCycleDir();
  try {
    const source = 'import "./other.tflw"\n\naction a()\n  b()\n\ntest "t"\n  a()\n';
    const { program } = parseSource(source);
    const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir });

    assert.equal(report.ok, false);
    const error = report.tests[0]!.error ?? '';
    assert.match(error, /`a → b → a`/, 'the message must name the cycle it found');
    assert.match(error, /never terminates/);
    assert.doesNotMatch(error, /Maximum call stack/, 'the V8 overflow must never be what a user sees');
  } finally {
    await rm(dir, { recursive: true, force: true });
    await server.close();
  }
});

test('the whole report stays small — an end-to-end backstop, not a control', async () => {
  // Read the title literally. This assertion was written as *the* proof of the milestone's headline
  // numbers, and mutation testing says it is not: reverting either fix on its own leaves it green.
  // Restore the unbounded wrapping and the guard still stops the recursion at frame 2, so nothing
  // grows; remove the guard and the bounded render still keeps 671 frames to one short line. It
  // only fails against the *original* code, where both were broken at once.
  //
  // That is a good property of the fixes and a bad property of a control, so it is labelled rather
  // than trusted. The single-fault controls are elsewhere and each covers one half: the cycle guard
  // is pinned by "a cross-file cycle fails with a message naming it", the bounded chain by
  // "a multi-frame failure names the root once". This test's job is the end-to-end claim — what a
  // user actually receives — which is worth one assertion even when two mechanisms defend it.
  const server = await startFixtureServer({ '/x': (_req, res) => json(res, 200, { ok: true }) });
  const dir = await crossFileCycleDir();
  try {
    const source = 'import "./other.tflw"\n\naction a()\n  b()\n\ntest "t"\n  a()\n';
    const { program } = parseSource(source);
    const { report } = await runProgram(program, testConfig(server.baseUrl), { source, baseDir: dir });

    // Measured before M97d on this exact shape: 14,505 characters on one line, 32,279-byte
    // results.json, 55,580-byte report.html.
    assert.ok((report.tests[0]!.error ?? '').length < 500, `error message is ${(report.tests[0]!.error ?? '').length} chars`);
    assert.ok(JSON.stringify(report).length < 8000, `report is ${JSON.stringify(report).length} bytes`);
    for (const step of report.tests[0]!.steps) {
      assert.ok((step.detail ?? '').length < 500, `a step detail is ${(step.detail ?? '').length} chars`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
    await server.close();
  }
});

test('a deep acyclic chain still runs — the guard detects repeats, not depth', async () => {
  // NEGATIVE CONTROL, and the reason the guard checks the stack for the name instead of counting
  // to a limit. Twelve frames is legal; a depth-limited guard set anywhere near where a cycle
  // becomes obvious would break this, and this is a shape real suites write.
  const server = await startFixtureServer({ '/x': (_req, res) => json(res, 200, { ok: true }) });
  try {
    const chain = Array.from({ length: 11 }, (_, i) => `action f${i + 1}()\n  f${i + 2}()`).join('\n');
    const source = `${chain}\naction f12()\n  api GET /x\n  expect status equals 200\n\ntest "t"\n  f1()\n`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
    assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
  } finally {
    await server.close();
  }
});

test('the same action called twice in sequence is not a cycle', async () => {
  // NEGATIVE CONTROL. Two calls that never overlap are two frames, not a repeat — this is what a
  // suite does whenever it creates two of something, so a false positive here would be the
  // expensive kind.
  const server = await startFixtureServer({ '/x': (_req, res) => json(res, 200, { ok: true }) });
  try {
    const source = `action ping()
  api GET /x
  expect status equals 200

action twice()
  ping()
  ping()

test "t"
  twice()
  twice()
`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
    assert.equal(report.ok, true, JSON.stringify(report.tests[0], null, 2));
    assert.equal(server.received.get('/x')!.length, 4);
  } finally {
    await server.close();
  }
});

test('a single-frame failure message is unchanged by the rewrite', async () => {
  // The overwhelmingly common case: one action, one failure. It read `action "x" failed: <reason>`
  // before M97d and must read exactly that after, with no call-path suffix bolted on.
  const server = await startFixtureServer({ '/x': (_req, res) => json(res, 500, { ok: false }) });
  try {
    const source = `action fetch it()
  api GET /x
  expect status equals 200

test "t"
  fetch it()
`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
    const error = report.tests[0]!.error ?? '';
    assert.match(error, /^action "fetch it" failed: /);
    assert.doesNotMatch(error, /call path/, 'one frame names no path — there is nothing to disambiguate');
  } finally {
    await server.close();
  }
});

test('a multi-frame failure names the root once and elides the middle of the path', async () => {
  const server = await startFixtureServer({ '/x': (_req, res) => json(res, 500, { ok: false }) });
  try {
    const chain = Array.from({ length: 7 }, (_, i) => `action f${i + 1}()\n  f${i + 2}()`).join('\n');
    const source = `${chain}\naction f8()\n  api GET /x\n  expect status equals 200\n\ntest "t"\n  f1()\n`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
    const error = report.tests[0]!.error ?? '';

    // The root reason appears exactly once. Before M97d it appeared once and was preceded by eight
    // `action "fN" failed: ` prefixes; the count is the property, not the length.
    assert.equal(error.split('expected status').length - 1, 1);
    assert.equal(error.split('failed:').length - 1, 1);
    assert.match(error, /^action "f1" failed: /, 'the frame that surfaced it leads');
    assert.match(error, /\(call path f1 → f2 → f3 → f4 → … 3 more → f8\)$/, 'ends at the frame that actually failed');
  } finally {
    await server.close();
  }
});

test('an action failing softly still propagates as soft through a frame', async () => {
  // Regression guard, not a new rule. `check` accumulates instead of throwing, and that path does
  // not go through the rewritten hard-failure branch at all — but it is one line away from it.
  const server = await startFixtureServer({ '/x': (_req, res) => json(res, 500, { ok: false }) });
  try {
    const source = `action soft()
  api GET /x
  check status equals 200

test "t"
  soft()
  api GET /x
  expect status equals 500
`;
    const { program } = parseSource(source);
    const { report } = await runProgram(program, testConfig(server.baseUrl), { source });
    assert.equal(report.ok, false, 'the soft failure still fails the test');
    // Two requests: a hard failure would have aborted before the second.
    assert.equal(server.received.get('/x')!.length, 2);
    assert.doesNotMatch(report.tests[0]!.error ?? '', /call path/);
  } finally {
    await server.close();
  }
});
