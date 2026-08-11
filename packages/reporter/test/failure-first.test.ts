// M125d / `FU-16` (D249) — report.html is failure-first when the run failed, and byte-for-byte
// unchanged when it didn't. Plus the defect the probe for this milestone turned up: the final
// attempt badge was hard-coded to "passed" and read `test.attempts` alone, so a test that failed
// every attempt got a green `attempt N of N — passed` sitting inside a panel marked `fail`.
//
// `renderReportHtml` is a pure function of a RunReport (the pattern html.test.ts established), so
// the markup can be pinned exactly without a live run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RequestTrace, ResponseTrace, RunReport, StepResult } from '@tflw/runtime';
import { renderReportHtml, defaultStatusFilter } from '../src/html.js';

const request: RequestTrace = { method: 'GET', url: 'https://api.example.com/orders', headers: { accept: 'application/json' } };
const response: ResponseTrace = {
  status: 500,
  statusText: 'Internal Server Error',
  headers: { 'cf-ray': '8a1b2c3d4e5f', 'content-type': 'application/json' },
  bodyText: '{"error":"boom"}',
  bodyBytes: Buffer.from('{"error":"boom"}'),
};

const step = (over: Partial<StepResult> = {}): StepResult =>
  ({ kind: 'api', source: 'api GET /orders', ok: true, durationMs: 5, ...over }) as StepResult;

const reportWith = (over: Partial<RunReport>): RunReport => ({
  ok: false,
  env: 'local',
  startedAt: '2026-08-11T00:00:00.000Z',
  durationMs: 100,
  total: 2,
  passed: 1,
  failed: 1,
  seed: 7,
  now: '2026-08-11T00:00:00.000Z',
  insecure: false,
  tests: [],
  ...over,
});

const okResponse: ResponseTrace = {
  status: 200,
  statusText: 'OK',
  headers: { 'cf-ray': '11112222aaaa', 'content-type': 'application/json' },
  bodyText: '{"ok":true}',
  bodyBytes: Buffer.from('{"ok":true}'),
};

const failingRun = reportWith({
  tests: [
    // The passing step carries a request/response too — otherwise it has nothing to fold and the
    // collapse assertion below would pass against a step that was never a subject of this change.
    { kind: 'functional', name: 'passes', ok: true, durationMs: 3, steps: [step({ request, response: okResponse })], file: 'a.tflw' },
    { kind: 'functional', name: 'fails', ok: false, durationMs: 9, steps: [step({ ok: false, detail: 'expected 200, got 500', request, response })], file: 'b.tflw' },
  ],
});

const greenRun = reportWith({
  ok: true,
  total: 1,
  passed: 1,
  failed: 0,
  tests: [{ kind: 'functional', name: 'passes', ok: true, durationMs: 3, steps: [step({ request, response })], file: 'a.tflw' }],
});

// --- the filter default ------------------------------------------------------------------------

test('defaultStatusFilter is driven by the failure count, not by report.ok', () => {
  assert.equal(defaultStatusFilter(failingRun), 'fail');
  assert.equal(defaultStatusFilter(greenRun), 'all');
});

test('a failing run opens on Failed — the button and the script agree, because both come from one function', () => {
  const html = renderReportHtml(failingRun);
  assert.match(html, /<button type="button" data-status="fail" class="active">Failed<\/button>/);
  assert.doesNotMatch(html, /data-status="all" class="active"/);
  // The script's own variable must say the same thing. A highlighted button over an unfiltered
  // list is a label that lies, which is worse than the "All" default this replaced.
  assert.match(html, /var statusFilter = 'fail';/);
});

test('a green run is unchanged: All stays active and the script still starts on all', () => {
  const html = renderReportHtml(greenRun);
  assert.match(html, /<button type="button" data-status="all" class="active">All<\/button>/);
  assert.doesNotMatch(html, /data-status="fail" class="active"/);
  assert.match(html, /var statusFilter = 'all';/);
});

test('the initial filter is actually applied, not merely highlighted', () => {
  // Without this call the Failed button renders active over the full list. Asserting the call
  // exists is the only check available without a DOM, and it is the one that has teeth: the
  // mutant that deletes it leaves every other assertion in this file passing.
  const script = renderReportHtml(failingRun).match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  const activateAt = script.indexOf("activate('");
  const applyAt = script.indexOf('applyFilter();', activateAt);
  assert.ok(activateAt > 0, 'the script activates a default panel');
  assert.ok(applyAt > activateAt, 'applyFilter() runs on load, after the default panel is activated');
});

test('the page anchors to the failing step, scoped to the active panel', () => {
  const script = renderReportHtml(failingRun).match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
  assert.match(script, /\.test\.active \.step\.fail/);
  assert.match(script, /scrollIntoView/);
});

// --- step evidence collapse --------------------------------------------------------------------

test('a passing step folds its request/response away; a failing step leaves it open', () => {
  const html = renderReportHtml(failingRun);
  const passing = html.match(/<li class="step ok[\s\S]*?<\/li>/)?.[0] ?? '';
  const failing = html.match(/<li class="step fail[\s\S]*?<\/li>/)?.[0] ?? '';
  // `&amp;`, not `&` — the summary label goes through `esc` like every other rendered string, and
  // asserting the raw character would be asserting that it does not.
  assert.match(passing, /<details class="evidence"><summary>request &amp; response<\/summary>/);
  assert.doesNotMatch(passing, /<details class="evidence" open>/);
  assert.match(failing, /<details class="evidence" open><summary>/);
});

test('the failing assertion text stays outside the disclosure — it is the answer, not the evidence', () => {
  const failing = renderReportHtml(failingRun).match(/<li class="step fail[\s\S]*?<\/li>/)?.[0] ?? '';
  const detailAt = failing.indexOf('<div class="detail');
  const evidenceAt = failing.indexOf('<details class="evidence"');
  assert.ok(detailAt > 0, 'the failing step renders its detail');
  assert.ok(evidenceAt > detailAt, 'the detail comes before, and outside, the collapsed evidence');
  assert.match(failing, /<div class="detail baddetail">expected 200, got 500<\/div>/);
});

test('a step with nothing to show renders no empty disclosure', () => {
  const bare = reportWith({ tests: [{ kind: 'functional', name: 'bare', ok: true, durationMs: 1, steps: [step()], file: 'a.tflw' }] });
  assert.doesNotMatch(renderReportHtml(bare), /<details class="evidence"/);
});

test('the response body is still in the file when collapsed — folded away, never dropped', () => {
  // A disclosure hides content; it must not remove it. Ctrl-F in a browser and every grep-based
  // consumer downstream depends on this, testFlow-tests' redaction check among them.
  assert.match(renderReportHtml(failingRun), /cf-ray/);
});

// --- the cross-repo hazard, made checkable from this side -----------------------------------

test('the FIRST `.detail{` rule in the stylesheet is the wrapping one', () => {
  // testFlow-tests' verify-report-no-overflow.mjs matches the first `.detail{` in the embedded
  // stylesheet and asserts it sets overflow-wrap:anywhere. That regex is unanchored, so a new rule
  // whose selector merely *ends* in `.detail` (e.g. `.step.kind-log .detail{`) silently becomes the
  // one it grades if placed above. Nothing in the sibling repo can catch that; this can.
  const style = renderReportHtml(failingRun).match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  const first = style.slice(style.indexOf('.detail{'));
  assert.ok(style.includes('.detail{'), 'the stylesheet defines a .detail rule');
  assert.match(first.slice(0, first.indexOf('}')), /overflow-wrap:anywhere/);
});

// --- the final-attempt badge (found by M125d's probe, not filed as a row) ----------------------

test('a test that failed every attempt is not told its last attempt passed', () => {
  const attempt = (n: number, ok: boolean) => ({ attempt: n, ok, durationMs: 4, steps: [step({ ok })] });
  const allFailed = reportWith({
    tests: [{ kind: 'functional', name: 'always fails', ok: false, durationMs: 9, steps: [step({ ok: false })], file: 'b.tflw', attempts: [attempt(1, false), attempt(2, false)] }],
  });
  const html = renderReportHtml(allFailed);
  assert.match(html, /<span class="attempt-badge fail">attempt 2 of 2 — failed<\/span>/);
  assert.doesNotMatch(html, /attempt 2 of 2 — passed/);
});

test('a flaky pass still reads as a pass on its final attempt', () => {
  const attempt = (n: number, ok: boolean) => ({ attempt: n, ok, durationMs: 4, steps: [step({ ok })] });
  const flaky = reportWith({
    ok: true,
    failed: 0,
    tests: [{ kind: 'functional', name: 'eventually works', ok: true, durationMs: 9, steps: [step()], file: 'a.tflw', flaky: true, attempts: [attempt(1, false), attempt(2, true)] }],
  });
  assert.match(renderReportHtml(flaky), /<span class="attempt-badge ok">attempt 2 of 2 — passed<\/span>/);
});
