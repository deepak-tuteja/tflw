// M3c (D12): resolveReportAssets is a pure function of a RunReport — synthetic reports are enough
// to pin the inline-budget threshold, hashing/dedup, and "traces are always external" behavior
// without needing a live browser run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunReport, TestResult } from '@tflw/runtime';
import { resolveReportAssets } from '../src/assets.js';

function baseReport(tests: readonly TestResult[]): RunReport {
  return {
    ok: true,
    env: 'local',
    startedAt: '2026-07-05T00:00:00.000Z',
    durationMs: 100,
    total: tests.length,
    passed: tests.filter((t) => t.ok).length,
    failed: tests.filter((t) => !t.ok).length,
    seed: 42,
    now: '2026-07-05T00:00:00.000Z',
    insecure: false,
    tests,
  };
}

const SMALL_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'); // 3 bytes decoded
const bigPngBase64 = (bytes: number) => Buffer.alloc(bytes, 1).toString('base64');

test('a screenshot under the inline budget produces no file and no href — stays inline', () => {
  const report = baseReport([{ name: 't', ok: true, durationMs: 1, steps: [{ kind: 'screenshot', source: 'screenshot "x"', line: 1, ok: true, durationMs: 1, screenshot: { base64: SMALL_PNG } }] }]);
  const { files, hrefs } = resolveReportAssets(report, 1024);
  assert.deepEqual(files, []);
  assert.equal(hrefs.size, 0);
});

test('a screenshot at/over the inline budget is written to assets/screenshots/ and gets an href', () => {
  const big = bigPngBase64(2048);
  const report = baseReport([{ name: 't', ok: false, durationMs: 1, steps: [{ kind: 'click', source: 'click button "x"', line: 1, ok: false, durationMs: 1, screenshot: { base64: big } }] }]);
  const { files, hrefs } = resolveReportAssets(report, 1024);
  assert.equal(files.length, 1);
  assert.match(files[0]!.relPath, /^assets\/screenshots\/[0-9a-f]{16}\.png$/);
  assert.equal(files[0]!.base64, big);
  assert.equal(hrefs.size, 1);
  assert.equal([...hrefs.values()][0], files[0]!.relPath);
});

test('two identical (byte-for-byte) over-budget screenshots dedupe into one file', () => {
  const big = bigPngBase64(2048);
  const report = baseReport([
    {
      name: 't',
      ok: false,
      durationMs: 1,
      steps: [
        { kind: 'click', source: 'click a', line: 1, ok: false, durationMs: 1, screenshot: { base64: big } },
        { kind: 'click', source: 'click b', line: 2, ok: false, durationMs: 1, screenshot: { base64: big } },
      ],
    },
  ]);
  const { files } = resolveReportAssets(report, 1024);
  assert.equal(files.length, 1);
});

test('a trace is always written externally regardless of size, even well under the inline budget', () => {
  const tinyZip = Buffer.from('PK').toString('base64');
  const report = baseReport([{ name: 't', ok: false, durationMs: 1, steps: [], trace: { base64: tinyZip } }]);
  const { files, hrefs } = resolveReportAssets(report, 1_000_000);
  assert.equal(files.length, 1);
  assert.match(files[0]!.relPath, /^assets\/traces\/[0-9a-f]{16}\.zip$/);
  assert.equal(hrefs.size, 1);
});

test('a clean run with no screenshots or traces produces no files and no hrefs at all', () => {
  const report = baseReport([{ name: 't', ok: true, durationMs: 1, steps: [{ kind: 'api', source: 'api GET /x', line: 1, ok: true, durationMs: 1 }] }]);
  const { files, hrefs } = resolveReportAssets(report);
  assert.deepEqual(files, []);
  assert.equal(hrefs.size, 0);
});

test('walks retry attempts too, not just the kept final steps/trace', () => {
  const big = bigPngBase64(2048);
  const tinyZip = Buffer.from('PK\x03\x04').toString('base64');
  const report = baseReport([
    {
      name: 't',
      ok: true,
      durationMs: 1,
      flaky: true,
      steps: [],
      trace: { base64: tinyZip },
      attempts: [
        { attempt: 1, ok: false, durationMs: 1, steps: [{ kind: 'click', source: 'click a', line: 1, ok: false, durationMs: 1, screenshot: { base64: big } }], trace: { base64: tinyZip } },
        { attempt: 2, ok: true, durationMs: 1, steps: [] },
      ],
    },
  ]);
  const { files } = resolveReportAssets(report, 1024);
  const relPaths = files.map((f) => f.relPath).sort();
  assert.equal(relPaths.length, 2); // one screenshot (attempt 1) + one trace (deduped: same bytes on the test and on attempt 1)
  assert.ok(relPaths.some((p) => p.startsWith('assets/screenshots/')));
  assert.ok(relPaths.some((p) => p.startsWith('assets/traces/')));
});
