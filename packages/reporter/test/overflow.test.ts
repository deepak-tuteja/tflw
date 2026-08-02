// PLAN_REPORT_OVERFLOW.md: a real report (JWTs in step details/header tables — nothing synthetic
// about that, every browser-arc/auth test produces them) was scrolling the *whole page*, sidebar
// included, because `.detail`/`.error`/`.phead`/`table.headers td` had no `overflow-wrap` — an
// unbroken token doesn't wrap under `white-space:pre-wrap` alone. `overflow-wrap:anywhere` is
// unambiguous, universally-supported CSS, so a string check that it landed on the right selectors
// is a reasonable, cheap proxy for the real layout fix — same style as every other assertion in
// html.test.ts (a generated-HTML string check, no layout engine involved anywhere in this
// package). `pre.body` (the raw response-body dump) is deliberately excluded: it needs to stay
// unwrapped-and-locally-scrollable, not wrapped, since it's formatted JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunReport } from '@tflw/runtime';
import { renderReportHtml } from '../src/html.js';

const baseReport: RunReport = {
  ok: true,
  env: 'local',
  startedAt: '2026-07-05T00:00:00.000Z',
  durationMs: 100,
  total: 1,
  passed: 1,
  failed: 0,
  seed: 42,
  now: '2026-07-05T00:00:00.000Z',
  insecure: false,
  tests: [{ kind: 'functional', name: 'health check', ok: true, durationMs: 12, steps: [] }],
};

test('the embedded stylesheet wraps every free-form-text container that can carry an unbroken long token', () => {
  const html = renderReportHtml(baseReport);
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
  assert.ok(style.length > 0, 'expected an embedded <style> block');

  for (const selector of ['.detail', '.error', '.phead', 'table.headers td']) {
    const rule = style.match(new RegExp(`${selector.replace(/[.[\]]/g, '\\$&')}\\{([^}]*)\\}`));
    assert.ok(rule, `expected a CSS rule for ${selector}`);
    assert.match(rule[1], /overflow-wrap:anywhere/, `${selector} should set overflow-wrap:anywhere so an unbroken token wraps instead of overflowing`);
  }

  // pre.body is the one container that must NOT get this — it's formatted JSON with its own
  // overflow-x:auto scroll, wrapping it would break the intentional raw formatting.
  const preBodyRule = style.match(/pre\.body\{([^}]*)\}/);
  assert.ok(preBodyRule, 'expected a CSS rule for pre.body');
  assert.doesNotMatch(preBodyRule[1], /overflow-wrap/, 'pre.body must stay unwrapped (overflow-x:auto instead) — it renders formatted JSON verbatim');
  assert.match(preBodyRule[1], /overflow-x:auto/);
});
