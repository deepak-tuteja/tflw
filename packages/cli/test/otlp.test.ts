// `M242` `F` (`D1331`) — a report as OTLP spans: the tree is run → file → test → step, the ids are
// stable across exports, a failure is an ERROR status carrying its message, and a skip is an
// outcome attribute rather than a failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunReport } from '@tflw/runtime';
import { parseHeader, reportToOtlp } from '../src/otlp.js';

const report: RunReport = {
  ok: false, env: 'local', startedAt: '2026-09-26T10:00:00.000Z', durationMs: 30, total: 3, passed: 1, failed: 1, skipped: 1, seed: 7, now: '2026-09-26T10:00:00.000Z', insecure: false,
  tests: [
    { kind: 'functional', name: 'a', file: 'x.tflw', ok: true, durationMs: 10, steps: [{ kind: 'api', source: 'api GET /a', line: 2, ok: true, durationMs: 10 }] },
    { kind: 'functional', name: 'b', file: 'x.tflw', ok: false, durationMs: 20, error: 'expected 200, got 500', steps: [{ kind: 'expect', source: 'expect status equals 200', line: 5, ok: false, durationMs: 20, detail: 'got 500' }] },
    { kind: 'functional', name: 'c', file: 'y.tflw', ok: true, durationMs: 0, steps: [], skipped: 'down' },
  ],
};

const spansOf = (r: RunReport) => reportToOtlp(r, '0.1.0').resourceSpans[0]!.scopeSpans[0]!.spans;

test('run → file → test → step, and the step of a later test starts where the earlier test ended', () => {
  const spans = spansOf(report);
  const byName = (n: string) => spans.find((s) => s.name === n)!;
  assert.equal(byName('x.tflw').parentSpanId, byName('tflw run').spanId);
  assert.equal(byName('b').parentSpanId, byName('x.tflw').spanId);
  assert.equal(byName('expect status equals 200').parentSpanId, byName('b').spanId);
  assert.equal(byName('b').startTimeUnixNano, byName('a').endTimeUnixNano, 'laid end to end');
  assert.equal(spans.length, 1 + 2 + 3 + 2);
});

test('a failure is ERROR with its message, and a skip is OK with an outcome saying so', () => {
  const spans = spansOf(report);
  const b = spans.find((s) => s.name === 'b')!;
  assert.deepEqual(b.status, { code: 2, message: 'expected 200, got 500' });
  const c = spans.find((s) => s.name === 'c')!;
  assert.equal(c.status.code, 1);
  assert.ok(c.attributes.some((a) => a.key === 'tflw.outcome' && a.value.stringValue === 'skipped'));
});

test('exporting the same run twice gives the same ids, so a collector sees one trace', () => {
  assert.deepEqual(spansOf(report).map((s) => s.spanId), spansOf(report).map((s) => s.spanId));
  assert.notEqual(spansOf({ ...report, seed: 8 })[0]!.traceId, spansOf(report)[0]!.traceId, 'and another run gets another trace');
});

test('`--header` is `name=value`', () => {
  assert.deepEqual(parseHeader('authorization=Bearer x=y'), ['authorization', 'Bearer x=y']);
  assert.match(parseHeader('nope') as string, /takes `name=value`/);
});
