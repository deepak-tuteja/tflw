// PLAN decision 86: report.html now shows every `retry` attempt's evidence, not just the final
// one. renderReportHtml is a pure function of a RunReport (mirrors junit.test.ts's approach), so a
// synthetic report is enough to pin the exact markup without needing a live run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunReport } from '@tflw/runtime';
import { renderReportHtml } from '../src/html.js';

const baseReport: RunReport = {
  ok: true,
  env: 'local',
  startedAt: '2026-07-05T00:00:00.000Z',
  durationMs: 100,
  total: 2,
  passed: 2,
  failed: 0,
  seed: 42,
  now: '2026-07-05T00:00:00.000Z',
  insecure: false,
  tests: [
    { name: 'health check', ok: true, durationMs: 12, steps: [] },
    { name: 'plain failure', ok: false, durationMs: 8, steps: [], error: 'expected 200, got 500' },
  ],
};

test('renderReportHtml renders a non-retried test identically whether or not the type could carry `attempts` — no attempt markup appears for a plain pass/fail', () => {
  const html = renderReportHtml(baseReport);
  // Note: the embedded <style> block always defines `.attempt`/`.attempt-badge` CSS rules
  // regardless of whether any test used retries — assert on the actual element markup, not a
  // bare substring, so this test isn't fooled by the ever-present stylesheet.
  assert.doesNotMatch(html, /<details class="attempt"/);
  assert.doesNotMatch(html, /<span class="attempt-badge/);
  const mainSection = html.match(/<section class="test ok">[\s\S]*?<\/section>/)?.[0];
  const expected = [
    '<section class="test ok">',
    '  <h2><span class="dot ok"></span>health check <span class="tms">12 ms</span></h2>',
    '  ',
    '  ',
    '  ',
    '  <ol class="steps">',
    '',
    '  </ol>',
    '</section>',
  ].join('\n');
  assert.equal(mainSection, expected);
});

test('renderReportHtml shows a collapsed <details> per failed prior attempt, in order, above the final attempt\'s steps', () => {
  const flakyReport: RunReport = {
    ...baseReport,
    tests: [
      {
        name: 'eventually works',
        ok: true,
        durationMs: 45,
        steps: [{ kind: 'expect', source: 'expect status equals 200', line: 3, ok: true, durationMs: 5, detail: 'status = 200' }],
        flaky: true,
        attempts: [
          {
            attempt: 1,
            ok: false,
            durationMs: 10,
            error: 'expected status to equal 200, but got 500',
            steps: [{ kind: 'expect', source: 'expect status equals 200', line: 3, ok: false, durationMs: 5, detail: 'status = 500' }],
          },
          {
            attempt: 2,
            ok: false,
            durationMs: 10,
            error: 'expected status to equal 200, but got 500',
            steps: [{ kind: 'expect', source: 'expect status equals 200', line: 3, ok: false, durationMs: 5, detail: 'status = 500' }],
          },
          {
            attempt: 3,
            ok: true,
            durationMs: 5,
            steps: [{ kind: 'expect', source: 'expect status equals 200', line: 3, ok: true, durationMs: 5, detail: 'status = 200' }],
          },
        ],
      },
    ],
  };

  const html = renderReportHtml(flakyReport);
  const detailsBlocks = [...html.matchAll(/<details class="attempt">/g)];
  assert.equal(detailsBlocks.length, 2, 'exactly the 2 failed prior attempts get a <details> block, not the final passed one');

  const firstIdx = html.indexOf('attempt 1 — failed');
  const secondIdx = html.indexOf('attempt 2 — failed');
  const finalLabelIdx = html.indexOf('attempt 3 of 3 — passed');
  assert.ok(firstIdx > -1 && secondIdx > -1 && finalLabelIdx > -1, 'all three labels must appear');
  assert.ok(firstIdx < secondIdx, 'attempt 1 renders before attempt 2');
  assert.ok(secondIdx < finalLabelIdx, 'both prior attempts render before the final-attempt label');

  assert.doesNotMatch(html, /<details class="attempt"[^>]* open/, 'prior attempts must be collapsed by default');

  // The final attempt's steps render in the unwrapped <ol>, after both prior-attempt blocks.
  const lastDetailsClose = html.lastIndexOf('</details>');
  const unwrappedOl = html.indexOf('<ol class="steps">', lastDetailsClose);
  assert.ok(unwrappedOl > lastDetailsClose, 'the final unwrapped steps list must come after the last collapsed attempt');
});

test('renderReportHtml escapes an attempt\'s error the same way a top-level test error is escaped', () => {
  const report: RunReport = {
    ...baseReport,
    tests: [
      {
        name: 'flaky with nasty error',
        ok: true,
        durationMs: 20,
        steps: [],
        flaky: true,
        attempts: [
          { attempt: 1, ok: false, durationMs: 5, error: '<script>alert("x")</script> & stuff', steps: [] },
          { attempt: 2, ok: true, durationMs: 5, steps: [] },
        ],
      },
    ],
  };
  const html = renderReportHtml(report);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; stuff/);
  assert.doesNotMatch(html, /<script>alert/);
});
