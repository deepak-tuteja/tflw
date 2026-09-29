// `M249` `F` (R2) — `results.schema.json` and `events.schema.json` describe what the writers write.
//
// The schemas are generated from the types (`scripts/gen-schemas.mjs`, drift-checked by
// `schemas:check` in `typecheck`), so what this file adds is the other half: the **files** the
// writers produce validate against them — every entry kind, a scan with findings, a merge — and a
// document that is wrong in a way the types forbid does not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv2020Module from 'ajv/dist/2020.js';
import type { RunEvent, RunReport, TestResult } from '@tflw/runtime';
import { writeResultsJson, RESULTS_SCHEMA_URL } from '../src/index.js';
import { writeEventsNdjson } from '../src/events-ndjson.js';
import { mergeRuns } from '../src/merge.js';

const load = (name: string): object => JSON.parse(readFileSync(new URL(`../schema/${name}`, import.meta.url), 'utf8')) as object;
// The same CJS interop `sarif.test.ts` explains: the class may sit on `.default` or be the module.
const Ajv2020 = ((Ajv2020Module as unknown as { default?: unknown }).default ?? Ajv2020Module) as unknown as typeof import('ajv/dist/2020.js').default;
const ajv = new Ajv2020({ strict: false, allErrors: true });
const validResults = ajv.compile(load('results.schema.json'));
const validEvent = ajv.compile(load('events.schema.json'));

const step = { kind: 'api', source: 'api GET /a', line: 2, ok: false, durationMs: 3, detail: 'expected 200, got 500', request: { method: 'GET', url: 'http://x/a', headers: {} }, response: { status: 500, statusText: 'Internal', headers: {}, bodyText: '{}', bodyBytes: Buffer.alloc(0), durationMs: 3, finalUrl: 'http://x/a', cookieEvents: [] } } as const;
const functional = (name: string, ok: boolean): TestResult => ({ kind: 'functional', name, ok, durationMs: 5, steps: ok ? [] : [step as never], file: 'a.tflw', sourceHash: '0123456789abcdef', ...(ok ? {} : { error: 'expected 200, got 500' }) });
const base = (tests: RunReport['tests'], extra: Partial<RunReport> = {}): RunReport =>
  ({ ok: tests.every((t) => t.ok), env: 'local', startedAt: '2026-09-29T10:00:00.000Z', durationMs: 9, total: tests.length, passed: tests.filter((t) => t.ok).length, failed: tests.filter((t) => !t.ok).length, tests, seed: 7, now: '2026-09-29T10:00:00.000Z', insecure: false, ...extra }) as RunReport;

const REPORTS: [string, RunReport][] = [
  ['a pass and a failure with a real request and response', base([functional('passes', true), functional('fails', false)])],
  ['a skipped test', base([{ ...functional('later', true), skipped: 'the sandbox is down' }], { skipped: 1 })],
  ['a scan with findings', base([functional('scanned', true)], { findings: [{ scan: 'security', rule: 'sec/csp-missing', severity: 'serious', description: 'no CSP', detail: 'no Content-Security-Policy header', endpoint: 'GET /', fingerprint: 'abc' }] as RunReport['findings'] })],
];

async function written(report: RunReport): Promise<unknown> {
  const dir = await mkdtemp(join(tmpdir(), 'tflw-schema-'));
  try {
    await writeResultsJson(report, dir);
    return JSON.parse(await readFile(join(dir, 'results.json'), 'utf8'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

for (const [what, report] of REPORTS) {
  test(`results.json validates — ${what}`, async () => {
    const doc = (await written(report)) as { $schema?: string };
    assert.equal(doc.$schema, RESULTS_SCHEMA_URL, 'the file names its schema');
    assert.equal(validResults(doc), true, JSON.stringify(validResults.errors, null, 2));
  });
}

test('a merged results.json validates, and a document the types forbid does not', async () => {
  const merged = mergeRuns(REPORTS.map(([what, report]) => ({ dir: what, report })));
  assert.equal(validResults(await written(merged)), true, JSON.stringify(validResults.errors, null, 2));
  // The control: the same document with `ok` a string. Without it, a schema of `{}` passes everything.
  const wrong = { ...((await written(REPORTS[0]![1])) as object), ok: 'yes' };
  assert.equal(validResults(wrong), false);
  assert.match(JSON.stringify(validResults.errors), /\/ok|must be boolean/);
});

test('every line of events.ndjson validates, and the first names the schema', async () => {
  const report = REPORTS[0]![1];
  const events: RunEvent[] = [
    { type: 'run:start', total: 2, env: 'local' },
    { type: 'test:start', name: 'fails', file: 'a.tflw' },
    { type: 'step:end', test: 'fails', step: step as never, file: 'a.tflw' },
    { type: 'test:end', result: report.tests[1]!, file: 'a.tflw' },
    { type: 'run:end', report },
  ];
  const dir = await mkdtemp(join(tmpdir(), 'tflw-schema-events-'));
  try {
    await writeEventsNdjson(events, dir);
    const lines = (await readFile(join(dir, 'events.ndjson'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as { $schema?: string });
    assert.match(lines[0]!.$schema ?? '', /events\.schema\.json$/);
    for (const line of lines) assert.equal(validEvent(line), true, JSON.stringify(validEvent.errors, null, 2));
    assert.equal(validEvent({ type: 'run:bogus' }), false, 'an event type the union does not have is refused');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
