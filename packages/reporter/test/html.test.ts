// PLAN decision 86: report.html now shows every `retry` attempt's evidence, not just the final
// one. renderReportHtml is a pure function of a RunReport (mirrors junit.test.ts's approach), so a
// synthetic report is enough to pin the exact markup without needing a live run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunReport, WorkloadTestResult } from '@tflw/runtime';
import { resolveReportAssets } from '../src/assets.js';
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
    { kind: 'functional', name: 'health check', ok: true, durationMs: 12, steps: [] },
    { kind: 'functional', name: 'plain failure', ok: false, durationMs: 8, steps: [], error: 'expected 200, got 500' },
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
        kind: 'functional',
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
        kind: 'functional',
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
      { kind: 'functional', name: 'first in b', ok: true, durationMs: 1, steps: [], file: 'b.tflw' },
      { kind: 'functional', name: 'first in a', ok: true, durationMs: 1, steps: [], file: 'a.tflw' },
      { kind: 'functional', name: 'second in b', ok: false, durationMs: 1, steps: [], file: 'b.tflw' },
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
      { kind: 'functional', name: 'passes', ok: true, durationMs: 1, steps: [], file: 'clean.tflw' },
      { kind: 'functional', name: 'fails', ok: false, durationMs: 1, steps: [], file: 'dirty.tflw' },
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
      { kind: 'functional', name: 'passes', ok: true, durationMs: 1, steps: [], file: 'a.tflw' },
      { kind: 'functional', name: 'fails', ok: false, durationMs: 1, steps: [], file: 'b.tflw' },
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
      { kind: 'functional', name: 'first', ok: true, durationMs: 1, steps: [], file: 'a.tflw' },
      { kind: 'functional', name: 'second', ok: true, durationMs: 1, steps: [], file: 'b.tflw' },
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

// ---- M3c: screenshots + trace links (D12) ----------------------------------

test('a screenshot with no matching assetHrefs entry (the default empty map) renders as an inline data: URI', () => {
  const withShot: RunReport = {
    ...baseReport,
    tests: [{ kind: 'functional', name: 'ui test', ok: false, durationMs: 5, steps: [{ kind: 'click', source: 'click button "x"', line: 1, ok: false, durationMs: 5, screenshot: { base64: 'aGVsbG8=' } }] }],
  };
  const html = renderReportHtml(withShot);
  assert.match(html, /<img src="data:image\/png;base64,aGVsbG8="/);
});

test('a screenshot whose hash IS in assetHrefs renders the external href instead of inlining', () => {
  const withShot: RunReport = {
    ...baseReport,
    tests: [{ kind: 'functional', name: 'ui test', ok: false, durationMs: 5, steps: [{ kind: 'click', source: 'click button "x"', line: 1, ok: false, durationMs: 5, screenshot: { base64: 'aGVsbG8=' } }] }],
  };
  const { hrefs } = resolveReportAssets(withShot, 0); // budget 0 forces every screenshot external
  const html = renderReportHtml(withShot, hrefs);
  assert.match(html, /<img src="assets\/screenshots\/[0-9a-f]{16}\.png"/);
  assert.doesNotMatch(html, /data:image\/png;base64/);
});

test('a test/attempt trace renders a download link + `npx playwright show-trace` hint when resolved via resolveReportAssets', () => {
  const withTrace: RunReport = {
    ...baseReport,
    tests: [{ kind: 'functional', name: 'ui test', ok: false, durationMs: 5, steps: [], trace: { base64: 'UEsDBA==' } }],
  };
  const { hrefs } = resolveReportAssets(withTrace);
  const html = renderReportHtml(withTrace, hrefs);
  assert.match(html, /<a href="assets\/traces\/[0-9a-f]{16}\.zip" download>trace\.zip<\/a>/);
  assert.match(html, /npx playwright show-trace assets\/traces\//);
});

test('a trace with no matching assetHrefs entry renders no link at all (safe degrade, never a broken href)', () => {
  const withTrace: RunReport = {
    ...baseReport,
    tests: [{ kind: 'functional', name: 'ui test', ok: false, durationMs: 5, steps: [], trace: { base64: 'UEsDBA==' } }],
  };
  const html = renderReportHtml(withTrace); // default empty map — resolveReportAssets never ran
  // Note: the embedded <style> block always defines `.trace-link` CSS regardless of any actual
  // link (same caveat as the `.attempt`/`.attempt-badge` test above) — assert on the element, not
  // a bare substring.
  assert.doesNotMatch(html, /<p class="trace-link"/);
});

// ---- M4b: `matches snapshot` before/after/diff triptych (D15) --------------

test('a snapshotDiff with baseline+actual+diff renders all three figures, inline when no assetHrefs match', () => {
  const withDiff: RunReport = {
    ...baseReport,
    tests: [
      {
        kind: 'functional',
        name: 'visual test',
        ok: false,
        durationMs: 5,
        steps: [{ kind: 'expect', source: 'expect page matches snapshot "x"', line: 1, ok: false, durationMs: 5, snapshotDiff: { baseline: 'YmFzZQ==', actual: 'YWN0', diff: 'ZGlmZg==' } }],
      },
    ],
  };
  const html = renderReportHtml(withDiff);
  assert.match(html, /<div class="snapshot-diff">/);
  assert.match(html, /<figcaption>baseline<\/figcaption><img src="data:image\/png;base64,YmFzZQ=="/);
  assert.match(html, /<figcaption>actual<\/figcaption><img src="data:image\/png;base64,YWN0"/);
  assert.match(html, /<figcaption>diff<\/figcaption><img src="data:image\/png;base64,ZGlmZg=="/);
});

test('a snapshotDiff with only `actual` (a brand-new baseline) renders just the actual figure', () => {
  const withDiff: RunReport = {
    ...baseReport,
    tests: [{ kind: 'functional', name: 'visual test', ok: true, durationMs: 5, steps: [{ kind: 'expect', source: 'expect page matches snapshot "x"', line: 1, ok: true, durationMs: 5, snapshotDiff: { actual: 'YWN0' } }] }],
  };
  const html = renderReportHtml(withDiff);
  assert.match(html, /<figcaption>actual<\/figcaption>/);
  assert.doesNotMatch(html, /<figcaption>baseline<\/figcaption>/);
  assert.doesNotMatch(html, /<figcaption>diff<\/figcaption>/);
});

test('a step with no snapshotDiff at all (a clean pass) renders no snapshot-diff div', () => {
  const html = renderReportHtml(baseReport);
  assert.doesNotMatch(html, /<div class="snapshot-diff">/);
});

test('a snapshotDiff image whose hash IS in assetHrefs renders the external href instead of inlining', () => {
  const withDiff: RunReport = {
    ...baseReport,
    tests: [{ kind: 'functional', name: 'visual test', ok: false, durationMs: 5, steps: [{ kind: 'expect', source: 's', line: 1, ok: false, durationMs: 5, snapshotDiff: { baseline: 'YmFzZQ==', actual: 'YWN0dWFs' } }] }],
  };
  const { hrefs } = resolveReportAssets(withDiff, 0); // budget 0 forces every image external
  const html = renderReportHtml(withDiff, hrefs);
  assert.match(html, /<figcaption>baseline<\/figcaption><img src="assets\/screenshots\/[0-9a-f]{16}\.png"/);
  assert.doesNotMatch(html, /data:image\/png;base64/);
});

test('report.browserEngine renders a small header badge; its absence renders nothing', () => {
  const withEngine: RunReport = { ...baseReport, browserEngine: 'firefox' };
  assert.match(renderReportHtml(withEngine), /<div class="engine-badge">browser <code>firefox<\/code><\/div>/);
  assert.doesNotMatch(renderReportHtml(baseReport), /<div class="engine-badge">/);
});

// -- M56 (Phase 3, D120): a WorkloadTestResult entry, folded in from the old load-html.ts --------

const zeroDurations = { min: 0, max: 0, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
// M89a — `successful` is the successful-only duration population every `LoadMetrics` now carries.
const emptyMetrics = { iterations: 0, failures: 0, errorRate: 0, durations: zeroDurations, histogram: [], timeline: [], successful: { iterations: 0, durations: zeroDurations, histogram: [] } };
const metricsWithData = {
  iterations: 10,
  failures: 1,
  errorRate: 0.1,
  durations: { min: 5, max: 500, avg: 80, p50: 50, p90: 200, p95: 300, p99: 480 },
  histogram: [{ value: 5, count: 3 }],
  timeline: [{ offsetSeconds: 0, count: 5, failures: 1, rps: 5, errorRate: 0.2, min: 5, mean: 50, max: 100, p50: 40, p95: 90, p99: 100 }],
  // 10 iterations, 1 failure -> 9 successful, and their percentiles are the ones the threshold read.
  successful: { iterations: 9, durations: { min: 5, max: 500, avg: 82, p50: 52, p90: 205, p95: 300, p99: 480 }, histogram: [{ value: 5, count: 3 }] },
};

const workloadTest: WorkloadTestResult = {
  kind: 'workload',
  name: 'checkout burst',
  workload: { shape: 'ramp', model: 'closed', target: 10, overMs: 1000 },
  metrics: metricsWithData,
  thresholds: [{ label: 'p95 duration', op: 'lessThan', target: 800, actual: 300, ok: true }],
  ok: true,
  endpoints: [],
};

const healthyDiagnosis = { avgEventLoopLagMs: 1, maxEventLoopLagMs: 2, cpuPercent: 5, saturated: false };

test('a workload entry renders its own panel with PASS/FAIL, the workload description, metrics table, and thresholds', () => {
  const report: RunReport = { ...baseReport, tests: [workloadTest] };
  const html = renderReportHtml(report);
  assert.match(html, /<section class="test ok active"/);
  assert.match(html, /checkout burst/);
  assert.match(html, /ramp to 10 users over 1000ms \(closed\)/);
  assert.match(html, /<tr class="ok"><td>✓<\/td><td>p95 duration &lt; 800ms<\/td>/);
});

// M89b (`B3-03`) — the panel used to open-code `ramp to N users over Tms` for every kind, so a
// `hold`/`step`/`spike`/`iterations` workload's own report described a run that did not happen.
test('a non-ramp workload panel describes the workload it actually declared', () => {
  const held: WorkloadTestResult = { ...workloadTest, workload: { shape: 'hold', model: 'open', target: 40, forMs: 5000 } };
  const html = renderReportHtml({ ...baseReport, tests: [held] });
  assert.match(html, /<p class="workload">hold 40 rps for 5000ms \(open\)<\/p>/);
  assert.ok(!/<p class="workload">ramp/.test(html), 'a `hold` still renders as a ramp');
});

test('a count-based workload panel does not claim a zero-millisecond span', () => {
  const counted: WorkloadTestResult = { ...workloadTest, workload: { shape: 'iterations', iterations: 50, vus: 2, perVu: false } };
  const html = renderReportHtml({ ...baseReport, tests: [counted] });
  assert.match(html, /<p class="workload">run 50 iterations across 2 users<\/p>/);
  assert.ok(!/over 0ms/.test(html), 'a count-based workload still reports a span of 0ms');
});

test('a failing workload threshold marks the panel fail and the threshold row fail', () => {
  const failing: WorkloadTestResult = { ...workloadTest, ok: false, thresholds: [{ label: 'p95 duration', op: 'lessThan', target: 800, actual: 900, ok: false }] };
  const html = renderReportHtml({ ...baseReport, ok: false, tests: [failing] });
  assert.match(html, /<section class="test fail active"/);
  assert.match(html, /<tr class="fail"><td>✗<\/td>/);
});

test('a workload entry with zero iterations renders "no iterations recorded" chart placeholders instead of crashing', () => {
  const empty: WorkloadTestResult = { ...workloadTest, metrics: emptyMetrics, thresholds: [] };
  assert.match(renderReportHtml({ ...baseReport, tests: [empty] }), /no iterations recorded/);
});

test('a workload entry with concurrency: parallel shows the parallel badge; a functional entry does too', () => {
  const html = renderReportHtml({ ...baseReport, tests: [{ ...workloadTest, concurrency: 'parallel' }] });
  assert.match(html, /<span class="parallel">parallel<\/span>/);
  const functionalParallel = renderReportHtml({ ...baseReport, tests: [{ kind: 'functional', name: 'a', ok: true, durationMs: 1, steps: [], concurrency: 'parallel' }] });
  assert.match(functionalParallel, /<span class="parallel">parallel<\/span>/);
  assert.doesNotMatch(renderReportHtml(baseReport), /class="parallel"/);
});

test('a workload entry with backOff.warning shows the coordinated-omission banner with its ratio', () => {
  const backedOff: WorkloadTestResult = { ...workloadTest, backOff: { ratio: 0.41, warning: true } };
  const html = renderReportHtml({ ...baseReport, tests: [backedOff] });
  assert.match(html, /class="backoff-warning"/);
  assert.match(html, /41%/);
});

test('a workload entry with endpoints renders one collapsed <details> per identity', () => {
  const withEndpoints: WorkloadTestResult = {
    ...workloadTest,
    endpoints: [
      { identity: 'GET /products', metrics: emptyMetrics },
      { identity: 'checkout <fast>', metrics: metricsWithData },
    ],
  };
  const html = renderReportHtml({ ...baseReport, tests: [withEndpoints] });
  assert.match(html, /class="endpoints"/);
  assert.match(html, /<details class="endpoint"><summary>GET \/products/);
  assert.match(html, /<h4>checkout &lt;fast&gt;<\/h4>/);
  assert.doesNotMatch(html, /checkout <fast>/);
});

test('report.selfDiagnosis renders a generator line on the workload panel; saturated shows a warning', () => {
  const html = renderReportHtml({ ...baseReport, tests: [workloadTest], selfDiagnosis: healthyDiagnosis });
  assert.match(html, /class="generator-line "/);
  const saturated = renderReportHtml({ ...baseReport, tests: [workloadTest], selfDiagnosis: { ...healthyDiagnosis, saturated: true }, inconclusive: true });
  assert.match(saturated, /generator-line saturated/);
  assert.match(saturated, /tflw itself was the bottleneck/);
});

test('report.inconclusive/aborted render header banners', () => {
  const inconclusive = renderReportHtml({ ...baseReport, inconclusive: true });
  assert.match(inconclusive, /generator process saturated/);
  const aborted = renderReportHtml({ ...baseReport, aborted: true, abortedMessage: 'aborted at 12s of 30s planned' });
  assert.match(aborted, /aborted at 12s of 30s planned/);
});

test('a mixed file (functional + workload) renders both, in declaration order, sharing one sidebar', () => {
  const report: RunReport = {
    ...baseReport,
    total: 2,
    tests: [
      { kind: 'functional', name: 'functional', ok: true, durationMs: 1, steps: [], file: 'mix.tflw' },
      { ...workloadTest, file: 'mix.tflw' },
    ],
  };
  const html = renderReportHtml(report);
  const order = [...html.matchAll(/<h2><span class="dot[^>]*><\/span>([^<]+)/g)].map((m) => m[1]!.trim());
  assert.deepEqual(order, ['functional', 'checkout burst']);
  assert.equal([...html.matchAll(/data-file="mix\.tflw"/g)].length > 0, true);
});

// ---- FS-01 (review findings V2-01 / FU-01): the footer ----------------------
//
// The footer used to be the string literal `report.html is self-contained and safe to attach to a
// ticket.` Both halves could be false at once: "safe" was false whenever the run captured anything
// (the fresh-user pass found 24 live JWTs sitting directly above that sentence), and
// "self-contained" was false whenever an asset was large enough to be written out to `assets/`
// instead of inlined. It now describes what the file contains and makes no promise at all.

function footerOf(html: string): string {
  return html.match(/<footer>([\s\S]*?)<\/footer>/)![1]!;
}

test('the footer never claims the report is safe to attach — that was a promise the file could not keep', () => {
  assert.doesNotMatch(footerOf(renderReportHtml(baseReport)), /safe to attach/);
});

test('a run that captured nothing says so positively', () => {
  const footer = footerOf(renderReportHtml({ ...baseReport, evidenceLevel: 'none' }));
  assert.match(footer, /evidence <code>none<\/code>/);
  assert.match(footer, /contains no request\/response bodies, screenshots or traces/);
  assert.doesNotMatch(footer, /Review it before attaching/, 'there is nothing to review');
});

test('a run that captured bodies and screenshots lists both and asks the reader to review', () => {
  const report: RunReport = {
    ...baseReport,
    evidenceLevel: 'full',
    tests: [
      {
        kind: 'functional',
        name: 'checkout',
        ok: false,
        durationMs: 5,
        steps: [
          { kind: 'api', source: 'api GET /orders', line: 2, ok: true, durationMs: 1, request: { method: 'GET', url: 'http://x/orders', headers: {} } },
          { kind: 'click', source: 'click button "Pay"', line: 3, ok: false, durationMs: 1, screenshot: { base64: 'iVBORw0KGgo=' } },
        ],
      },
    ],
  };
  const footer = footerOf(renderReportHtml(report));
  assert.match(footer, /evidence <code>full<\/code>/);
  assert.match(footer, /request and response bodies and page screenshots/);
  assert.match(footer, /Review it before attaching to a ticket/);
});

test('the evidence level renames what an api step contributed — at `none` a URL is nearly all that survives', () => {
  const withApi = (evidenceLevel: RunReport['evidenceLevel']): string =>
    footerOf(
      renderReportHtml({
        ...baseReport,
        evidenceLevel,
        tests: [
          {
            kind: 'functional',
            name: 'orders',
            ok: true,
            durationMs: 5,
            steps: [{ kind: 'api', source: 'api GET /orders', line: 2, ok: true, durationMs: 1, request: { method: 'GET', url: 'http://x/orders', headers: {} } }],
          },
        ],
      }),
    );
  assert.match(withApi('full'), /request and response bodies/);
  assert.match(withApi('headers-only'), /request and response headers/);
  assert.match(withApi('none'), /request URLs and status codes/);
});

test('a report whose assets were written out beside it stops calling itself one file', () => {
  // The `self-contained` half of the old sentence: past the inline-size threshold `report.html`
  // alone is incomplete, and a reader who attaches just this file loses the evidence.
  // A trace archive is always written externally regardless of size (assets.ts's module doc) —
  // multi-hundred-KB binary zips are not meaningfully embeddable — so it is the cheapest fixture
  // that genuinely leaves `report.html` incomplete on its own.
  const report: RunReport = {
    ...baseReport,
    evidenceLevel: 'full',
    tests: [
      {
        kind: 'functional',
        name: 'checkout',
        ok: false,
        durationMs: 5,
        steps: [{ kind: 'click', source: 'click button "Pay"', line: 3, ok: false, durationMs: 1, screenshot: { base64: 'iVBORw0KGgo=' } }],
        trace: { base64: 'UEsDBAoAAAAAAA==' },
      },
    ],
  };
  const { hrefs } = resolveReportAssets(report);
  assert.ok(hrefs.size > 0, 'fixture must actually cross the inline threshold for this test to mean anything');
  assert.match(footerOf(renderReportHtml(report, hrefs)), /copy the whole report directory, not just this file/);
  assert.doesNotMatch(footerOf(renderReportHtml(report)), /copy the whole report directory/, 'an inlined-only report really is one file');
});

// A12-01. `report.html` is the artifact that gets attached to a ticket, which makes it the one
// sink where "a value you told me was a secret is sitting in this page in the clear" has to be
// said in the header rather than left for the reader to discover. Modelled on `insecure: true`'s
// banner, and asserted the same way — on the element, not a bare substring, since the embedded
// stylesheet mentions `.insecure-warning` unconditionally.
test('report.html warns in its header when a declared secret was too short to mask, naming the vars (A12-01)', () => {
  const html = renderReportHtml({ ...baseReport, unmaskableSecrets: ['SHORTPW', 'PIN'] });
  const banner = html.match(/<div class="insecure-warning">⚠ unmasked secrets[\s\S]*?<\/div>/)?.[0];
  assert.ok(banner, 'the header must carry an unmasked-secret banner');
  assert.match(banner, /<code>SHORTPW<\/code> and <code>PIN<\/code>/, 'every named var, not just the first');
  assert.match(banner, /shorter than 6 characters/);
  // The value itself must never appear here — printing it would be the very leak being warned about.
  assert.doesNotMatch(banner, /hunt2/);
});

test('report.html says nothing about unmasked secrets when there are none (A12-01)', () => {
  assert.doesNotMatch(renderReportHtml(baseReport), /unmasked secret/);
  assert.doesNotMatch(renderReportHtml({ ...baseReport, unmaskableSecrets: [] }), /unmasked secret/);
});

test('the unmasked-secret banner is singular for one var (A12-01)', () => {
  const html = renderReportHtml({ ...baseReport, unmaskableSecrets: ['PIN'] });
  assert.match(html, /⚠ unmasked secret: <code>PIN<\/code>/);
  assert.match(html, /Its value appears below in full/);
});

test('a var name with HTML metacharacters is escaped in the banner, not injected (A12-01)', () => {
  const html = renderReportHtml({ ...baseReport, unmaskableSecrets: ['<img src=x onerror=alert(1)>'] });
  assert.doesNotMatch(html, /<img src=x/, 'a name reaching the header must be escaped like every other value in this document');
  assert.match(html, /&lt;img src=x/);
});
