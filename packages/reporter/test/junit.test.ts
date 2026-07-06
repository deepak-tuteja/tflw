// M2.5: junit.xml is a pure function of a RunReport (SPEC §13, P#23) — a synthetic report is
// enough to pin the exact shape without needing a live run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunReport } from '@tflw/runtime';
import { renderJunitXml } from '../src/junit.js';

const report: RunReport = {
  ok: false,
  env: 'local',
  startedAt: '2026-07-05T00:00:00.000Z',
  durationMs: 1234,
  total: 3,
  passed: 2,
  failed: 1,
  seed: 42,
  now: '2026-07-05T00:00:00.000Z',
  insecure: false,
  tests: [
    { name: 'health check', ok: true, durationMs: 12, steps: [] },
    { name: 'eventually works', ok: true, durationMs: 45, steps: [], flaky: true },
    { name: 'broken <thing> & "stuff"', ok: false, durationMs: 8, steps: [], error: 'expected status to equal 200, but got 500' },
  ],
};

test('renderJunitXml produces a standard testsuite with properties, a plain pass, a flaky pass, and a failure', () => {
  const xml = renderJunitXml(report);

  assert.equal(
    xml,
    `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="tflw" tests="3" failures="1" errors="0" time="1.234" timestamp="2026-07-05T00:00:00.000Z">
  <properties>
    <property name="env" value="local"/>
    <property name="seed" value="42"/>
    <property name="now" value="2026-07-05T00:00:00.000Z"/>
  </properties>
  <testcase name="health check" time="0.012"/>
  <testcase name="eventually works" time="0.045">
    <system-out>flaky: passed after a retry</system-out>
  </testcase>
  <testcase name="broken &lt;thing&gt; &amp; &quot;stuff&quot;" time="0.008">
    <failure message="expected status to equal 200, but got 500">expected status to equal 200, but got 500</failure>
  </testcase>
</testsuite>
`,
  );
});

test('renderJunitXml strips XML-invalid C0 control characters from a test name/error, keeping tab/LF/CR intact (decision 73)', () => {
  // e.g. a garbled/binary response body echoed into an error message could carry a raw \x01 or
  // \x1F — XML 1.0 forbids these outright (unlike & < > ", which entity-escaping already handles),
  // so leaving them in would hand some CI JUnit parsers a document that isn't well-formed XML.
  const dirtyReport: RunReport = {
    ...report,
    tests: [{ name: 'name with a \x01 control char', ok: false, durationMs: 3, steps: [], error: 'bad byte: \x1F end' }],
  };
  const xml = renderJunitXml(dirtyReport);

  assert.doesNotMatch(xml, /[\x00-\x08\x0B\x0C\x0E-\x1F]/, 'no XML-invalid control character may survive into the document');
  assert.match(xml, /name with a � control char/);
  assert.match(xml, /bad byte: � end/);

  const tabNewlineReport: RunReport = {
    ...report,
    tests: [{ name: 'has\ttab and\nnewline', ok: true, durationMs: 1, steps: [] }],
  };
  assert.match(renderJunitXml(tabNewlineReport), /has\ttab and\nnewline/, 'tab/LF/CR are XML-legal and must survive untouched');
});

test('renderJunitXml on an all-passing report has zero failures and no <failure>/<system-out> elements', () => {
  const cleanReport: RunReport = { ...report, ok: true, failed: 0, tests: [{ name: 'ok', ok: true, durationMs: 1, steps: [] }] };
  const xml = renderJunitXml(cleanReport);
  assert.match(xml, /failures="0"/);
  assert.doesNotMatch(xml, /<failure/);
  assert.doesNotMatch(xml, /<system-out>/);
});
