// The terminal half of review finding `A12-01`. `renderCliSummary` is a pure function of a
// `RunReport` (same approach as `html.test.ts`/`junit.test.ts`), so a synthetic report pins the
// exact line without a live run.
//
// The warning sits directly beneath `insecure: true`'s, and for the same stated reason: a run that
// declines to protect a value it was told to treat as a secret must not do so silently. Decision
// 64's `MIN_REDACTABLE_LENGTH` floor is not in question here — substring-replacing a 4-character
// value would corrupt unrelated report text rather than hide a credential — only its audibility.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunReport } from '@tflw/runtime';
import { renderCliSummary } from '../src/cli-summary.js';

const baseReport: RunReport = {
  ok: true,
  env: 'local',
  startedAt: '2026-08-06T00:00:00.000Z',
  durationMs: 100,
  total: 1,
  passed: 1,
  failed: 0,
  seed: 42,
  now: '2026-08-06T00:00:00.000Z',
  insecure: false,
  tests: [{ kind: 'functional', name: 'health check', ok: true, durationMs: 12, steps: [] }],
};

test('the summary names every var that was too short to mask (A12-01)', () => {
  const out = renderCliSummary({ ...baseReport, unmaskableSecrets: ['SHORTPW', 'PIN'] }, false);
  assert.match(out, /⚠ unmasked secrets: SHORTPW, PIN/);
  assert.match(out, /shorter than 6 characters/);
  assert.match(out, /their values appear in full/i);
});

test('the summary is singular for a single var (A12-01)', () => {
  const out = renderCliSummary({ ...baseReport, unmaskableSecrets: ['PIN'] }, false);
  assert.match(out, /⚠ unmasked secret: PIN/);
  assert.match(out, /its value appears in full/i);
});

test('a run with nothing unmaskable says nothing — the warning must not be ambient (A12-01)', () => {
  assert.doesNotMatch(renderCliSummary(baseReport, false), /unmasked secret/);
  assert.doesNotMatch(renderCliSummary({ ...baseReport, unmaskableSecrets: [] }, false), /unmasked secret/);
});

test('the warning sits with `insecure`, below the PASS/FAIL tally, not buried among the tests (A12-01)', () => {
  const lines = renderCliSummary({ ...baseReport, insecure: true, unmaskableSecrets: ['PIN'] }, false).split('\n');
  const tally = lines.findIndex((l) => l.startsWith('PASS'));
  const insecure = lines.findIndex((l) => l.includes('insecure: true'));
  const unmasked = lines.findIndex((l) => l.includes('unmasked secret'));
  assert.ok(tally >= 0 && insecure === tally + 1 && unmasked === insecure + 1, `expected tally → insecure → unmasked to be adjacent, got ${tally}/${insecure}/${unmasked}`);
});

test('colour is applied to the warning the same way `insecure`’s is (A12-01)', () => {
  const out = renderCliSummary({ ...baseReport, unmaskableSecrets: ['PIN'] }, true);
  assert.match(out, /\x1b\[31m\x1b\[1m⚠ unmasked secret: PIN/, 'red + bold, matching the security warning above it');
});
