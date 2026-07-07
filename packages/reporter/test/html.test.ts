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
  const mainSection = html.match(/<section class="test ok"[\s\S]*?<\/section>/)?.[0];
  const expected = [
    '<section class="test ok" id="t0" data-file="(no file)">',
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

// Track 1 (grill-me, 2026-07-07): report.html groups tests by source file into a collapsible
// sidebar tree, with one <section> per test toggled via a shared `active` class.
test('renderReportHtml groups tests into one <details class="filegroup"> per file, in first-appearance order, with per-file test links', () => {
  const report: RunReport = {
    ...baseReport,
    total: 3,
    passed: 2,
    failed: 1,
    tests: [
      { name: 'first in b', ok: true, durationMs: 1, steps: [], file: 'b.tflw' },
      { name: 'first in a', ok: true, durationMs: 1, steps: [], file: 'a.tflw' },
      { name: 'second in b', ok: false, durationMs: 1, steps: [], file: 'b.tflw' },
    ],
  };
  const html = renderReportHtml(report);
  const groupOrder = [...html.matchAll(/data-file="([^"]+)"/g)].map((m) => m[1]);
  // 'b.tflw' appears first (its first test is first in the report), 'a.tflw' second — file-group
  // order follows first-appearance, not alphabetical; each <section> also carries its own
  // data-file, so every match after the first 2 groups belongs to a <section>, not a new group.
  assert.equal(groupOrder[0], 'b.tflw');
  assert.equal(groupOrder[1], 'a.tflw');

  const bGroup = html.match(/<details class="filegroup[^>]*data-file="b\.tflw">[\s\S]*?<\/details>/)?.[0];
  assert.ok(bGroup, 'expected a filegroup for b.tflw');
  assert.match(bGroup!, /first in b/);
  assert.match(bGroup!, /second in b/);
  assert.doesNotMatch(bGroup!, /first in a/, "a.tflw's test must not leak into b.tflw's group");
});

test('a file group with a failing test is open and marked "fail"; an all-passing group stays collapsed and marked "ok"', () => {
  const report: RunReport = {
    ...baseReport,
    total: 2,
    passed: 1,
    failed: 1,
    tests: [
      { name: 'passes', ok: true, durationMs: 1, steps: [], file: 'clean.tflw' },
      { name: 'fails', ok: false, durationMs: 1, steps: [], file: 'dirty.tflw' },
    ],
  };
  const html = renderReportHtml(report);
  const clean = html.match(/<details class="filegroup[^"]*"[^>]*data-file="clean\.tflw">/)?.[0];
  const dirty = html.match(/<details class="filegroup[^"]*"[^>]*data-file="dirty\.tflw">/)?.[0];
  assert.match(clean!, /class="filegroup ok"/);
  assert.doesNotMatch(clean!, /\bopen\b/);
  assert.match(dirty!, /class="filegroup fail"/);
  assert.match(dirty!, /\bopen\b/);
});

test('the first failing test\'s section is active by default; an all-passing report defaults to the first test', () => {
  const withFailure: RunReport = {
    ...baseReport,
    total: 2,
    passed: 1,
    failed: 1,
    tests: [
      { name: 'passes', ok: true, durationMs: 1, steps: [], file: 'a.tflw' },
      { name: 'fails', ok: false, durationMs: 1, steps: [], file: 'b.tflw' },
    ],
  };
  const html1 = renderReportHtml(withFailure);
  assert.match(html1, /<section class="test fail active" id="t1" data-file="b\.tflw">/);
  assert.doesNotMatch(html1, /<section class="test ok active"/);

  const allGreen: RunReport = {
    ...baseReport,
    total: 2,
    passed: 2,
    failed: 0,
    tests: [
      { name: 'first', ok: true, durationMs: 1, steps: [], file: 'a.tflw' },
      { name: 'second', ok: true, durationMs: 1, steps: [], file: 'b.tflw' },
    ],
  };
  const html2 = renderReportHtml(allGreen);
  assert.match(html2, /<section class="test ok active" id="t0" data-file="a\.tflw">/);
});

test('a TestResult with no `file` groups under "(no file)" — old fixtures without the field keep rendering', () => {
  const html = renderReportHtml(baseReport);
  assert.match(html, /data-file="\(no file\)"/);
});

test('the sidebar carries a filter input, a status-filter toggle, and one <script> that wires them up — the report is no longer JS-free but stays a single file', () => {
  const html = renderReportHtml(baseReport);
  assert.match(html, /<input type="search" id="tf-filter"/);
  assert.match(html, /data-status="all"/);
  assert.match(html, /data-status="fail"/);
  assert.match(html, /data-status="ok"/);
  assert.match(html, /<script>[\s\S]*applyFilter[\s\S]*<\/script>/);
  assert.doesNotMatch(html, /<script src=/, 'must stay self-contained — no external script reference');
});
