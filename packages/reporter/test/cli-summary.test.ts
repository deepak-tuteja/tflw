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

// -- `M111` (`FU-07`): an aborted run must not print `PASS` -------------------------------------
//
// The badge was `report.ok ? 'PASS' : 'FAIL'`, and `report.ok` means "nothing that ran failed" —
// which is true of a run Ctrl-C'd at 6s of a 30s plan and is not the same claim as "this run
// passed". The `⚠ aborted` line four rows below was the only signal, and a skimming human or a
// `grep -q PASS` CI step never reaches it. Exit code 130 was correct throughout; only what a reader
// sees was wrong.

const abortedWorkload: RunReport = {
  ...baseReport,
  // `M114` (`M111-01`) — `ok: false` beside `passed: 1, failed: 0` is not a typo, and this fixture
  // carried the tool's old `ok: true` until then. A run that reached no verdict did not pass; the
  // narrow "nothing that ran failed" is what `failed` says. `finalizeVerdict` makes `ok: true` here
  // a state the tool can no longer produce, so a fixture asserting against it would be asserting
  // against nothing.
  ok: false,
  aborted: true,
  abortedMessage: 'aborted at 6s of 30s planned',
  tests: [
    {
      kind: 'workload',
      name: 'burst',
      file: 'load/burst.tflw',
      workload: { shape: 'ramp', model: 'closed', target: 5, overMs: 30_000 },
      metrics: { iterations: 151_695, failures: 0, errorRate: 0, durations: { min: 0, max: 11, avg: 0, p50: 0, p90: 0, p95: 0, p99: 0 }, histogram: [], timeline: [] },
      thresholds: [{ label: 'error rate', op: 'lessThan', target: 0.5, actual: 0, ok: true }],
      ok: true,
      endpoints: [],
    },
  ],
};

test('an aborted run prints ABORTED, not PASS', () => {
  const out = renderCliSummary(abortedWorkload, false);
  assert.match(out, /^ABORTED 1\/1 passed/m);
  assert.doesNotMatch(out, /^PASS/m);
  // The ⚠ line stays — the badge says *that* the run was cut short, the line says *where*.
  assert.match(out, /⚠ aborted — aborted at 6s of 30s planned/);
});

test('an aborted run gives its thresholds no tick either way, because they measured a partial sample', () => {
  // The deepest form of `FU-07`, and the one a reader is most likely to act on. `TF033`'s own help
  // text says a workload-bearing test's verdict "comes only from its `threshold` lines against the
  // run's aggregate metrics" — so a green ✓ beside a threshold computed over 6s of a 30s plan is
  // not a lenient verdict, it is a verdict about a run that did not happen. `junit.xml` renders
  // this same case as `<skipped/>`; both sinks now ask one function, so they cannot drift apart.
  const out = renderCliSummary(abortedWorkload, false);
  assert.match(out, /– error rate < 50\.00% \(actual: 0\.00%\) — no verdict, run aborted/);
  assert.doesNotMatch(out, /✓ error rate/);
  // And the test's own mark, one line up, stops claiming a pass it cannot support — as a dash,
  // not an `✗`: the verdict was withdrawn, not decided against, and an `✗` would contradict the
  // `1/1 passed` tally that `report.passed` still reports on the badge line.
  assert.doesNotMatch(out, /✓ burst/);
  assert.match(out, /– burst \(workload/);
});

test('an inconclusive run prints INCONCLUSIVE, not PASS', () => {
  // `M114` (`M111-01`) — the sibling cause, and the one `M111` left behind. `runBadgeText`
  // special-cased `aborted` alone, so a run whose own generator saturated printed a green
  // `PASS 1/1 passed` while `junit.xml`, reading the same `noVerdictReason`, marked every one of its
  // thresholds `<skipped/>`: the two sinks `M111` unified disagreed about one of the two reasons it
  // unified them for. Found by running a saturating workload, not by re-reading the function.
  const out = renderCliSummary({ ...abortedWorkload, aborted: false, abortedMessage: undefined, inconclusive: true }, false);
  assert.match(out, /^INCONCLUSIVE 1\/1 passed/m);
  assert.doesNotMatch(out, /^PASS/m);
  assert.match(out, /– error rate < 50\.00% \(actual: 0\.00%\) — no verdict, run inconclusive/);
  assert.match(out, /⚠ inconclusive/);
});

test('a completed run still ticks its thresholds and still prints PASS', () => {
  // The control. A `noVerdict` that evaluated truthy for every run would satisfy both tests above
  // while deleting every threshold verdict tflw reports — this is what makes them mean something.
  const out = renderCliSummary({ ...abortedWorkload, ok: true, aborted: false, abortedMessage: undefined }, false);
  assert.match(out, /^PASS 1\/1 passed/m);
  assert.match(out, /✓ error rate < 50\.00% \(actual: 0\.00%\)$/m);
  assert.doesNotMatch(out, /no verdict/);
});

// --- `authorized target` (M128b, D291) --------------------------------------
//
// D291 requires that the reason travel with the evidence: whatever a run's security assertions
// found, the artifact also records the claim that permitted them to run at all. That is only true
// if the line is actually rendered, which is what these pin.

test('the summary prints each authorized target with its reason (D291)', () => {
  const out = renderCliSummary(
    { ...baseReport, authorizedTargets: [{ target: 'https://localhost:8443', reason: 'self-hosted test fixture' }] },
    false,
  );
  assert.match(out, /ℹ authorized target https:\/\/localhost:8443 — self-hosted test fixture/);
});

test('every declaration is printed, not just the first', () => {
  // They accumulate across `defaults` + `env`, so a suite scanning two hosts has two claims to
  // record — and recording one of two would be worse than recording neither.
  const out = renderCliSummary(
    {
      ...baseReport,
      authorizedTargets: [
        { target: 'https://a.test', reason: 'ours' },
        { target: 'https://b.test', reason: 'also ours' },
      ],
    },
    false,
  );
  assert.match(out, /authorized target https:\/\/a\.test — ours/);
  assert.match(out, /authorized target https:\/\/b\.test — also ours/);
});

test('an ordinary run says nothing about authorized targets', () => {
  // The overwhelming majority of suites never declare one; the line must not be ambient.
  assert.doesNotMatch(renderCliSummary(baseReport, false), /authorized target/);
  assert.doesNotMatch(renderCliSummary({ ...baseReport, authorizedTargets: [] }, false), /authorized target/);
});

// --- M130b/D331: the two blind-spot lines -------------------------------------------------------
//
// These exist so that a run's authorization *results* cannot be read as broader than they are.
// D316's own count could only ever have been zero (it named `TF062`/`TF063` sites, which are errors,
// so no run containing one executes), and what replaces it is two numbers with two different
// denominators — which is why they are two lines and not one percentage.

test('D331: the coverage line names the suite as its base, never this run', () => {
  const out = renderCliSummary({ ...baseReport, authzBlindSpot: { coverage: { apiSteps: 1035, withOwner: 41 } } }, false);
  assert.match(out, /authz coverage: 41 of 1035 api steps in the suite sit in a test that declares an owner/);
  // The census is computed before `--tags`/`--only` narrow anything, so a reader must not take it
  // for a statement about what just ran.
  assert.match(out, /in the suite/);
});

test('D331: the percentage floors, because rounding up is the one direction a blind spot must not move', () => {
  // 41/1035 is 3.96%. Rounded it reads 4%, which overstates coverage.
  const out = renderCliSummary({ ...baseReport, authzBlindSpot: { coverage: { apiSteps: 1035, withOwner: 41 } } }, false);
  assert.match(out, /\(3%\)/);
});

test('D331: declines are aggregated with their count and the principal named', () => {
  const out = renderCliSummary(
    { ...baseReport, authzBlindSpot: { declines: [{ principal: 'shopper', reason: 'a cookie-borne principal was refused on a DELETE', count: 5 }] } },
    false,
  );
  assert.match(out, /authz declined 5×: `shopper` — a cookie-borne principal was refused on a DELETE/);
});

test('D331: an ordinary run says nothing about authz at all', () => {
  // The field is omitted entirely for a suite with no `api` step and no decline, so the line is
  // never ambient — the same rule `authorized target` follows directly above.
  assert.doesNotMatch(renderCliSummary(baseReport, false), /authz /);
});

test('D330: `probe mutating` is shown on the target it was declared under', () => {
  const out = renderCliSummary(
    {
      ...baseReport,
      authorizedTargets: [
        { target: 'https://a.test', reason: 'ours', probeMutating: true },
        { target: 'https://b.test', reason: 'also ours', probeMutating: false },
      ],
    },
    false,
  );
  assert.match(out, /a\.test — ours \(probe mutating\)/);
  assert.doesNotMatch(out, /b\.test — also ours \(probe mutating\)/);
});
