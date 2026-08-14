// M134b (PLAN_M134_PENTEST_TIER3.md D385/D386/D389) — the report's security-findings block and the
// rule census beside it.
//
// **What these pin is that the report describes the *run*, not the gate.** The gate's whole design
// (D386) is that it can only relax, and a relaxation nobody can see is indistinguishable from a scan
// that found nothing. So a withheld finding must render, must say which relaxation withheld it, and
// must still carry the fingerprint somebody copies into a baseline. A renderer that filtered on
// `withheld` would pass every test about *failing* findings and quietly turn `--fail-on minor` into
// a way to make a report look clean.
//
// The census half is `M128-01`'s fix (D389). Its own failure mode is the opposite one: a rule that
// stood down produces no finding at all, so the only evidence it ever existed is a block that lists
// it *on a run where nothing failed* — which is precisely the run nobody is reading a failure
// message on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunReport, ScanFinding, ScanRuleCensus } from '@tflw/runtime';
import { findingsSummaryLine, renderFindings, renderScanCoverage, sortFindings } from '../src/findings.js';

function f(over: Partial<ScanFinding> = {}): ScanFinding {
  return {
    scan: 'input-handling',
    rule: 'sec/error-detail-disclosure',
    severity: 'serious',
    description: 'an error response disclosed internal detail',
    detail: 'answered 500 with a stack frame',
    endpoint: 'GET /orders/{id}',
    fingerprint: 'aaaaaaaaaaaaaaaa',
    ...over,
  };
}

function report(findings: readonly ScanFinding[]): RunReport {
  return { findings } as unknown as RunReport;
}

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

test('gating findings sort above withheld ones, whatever their severities', () => {
  // A baselined `critical` matters, but it is not what the reader opened the report for: the rows
  // failing the build right now are the ones they can act on this minute.
  const sorted = sortFindings([
    f({ severity: 'critical', withheld: 'baseline', fingerprint: '1'.repeat(16) }),
    f({ severity: 'minor', fingerprint: '2'.repeat(16) }),
  ]);
  assert.equal(sorted[0]!.withheld, undefined);
  assert.equal(sorted[1]!.severity, 'critical');
});

test('within a bucket the worst severity comes first', () => {
  const sorted = sortFindings([f({ severity: 'minor', fingerprint: 'a' }), f({ severity: 'critical', fingerprint: 'b' }), f({ severity: 'moderate', fingerprint: 'c' })]);
  assert.deepEqual(
    sorted.map((x) => x.severity),
    ['critical', 'moderate', 'minor'],
  );
});

// Two runs of one suite must produce a byte-identical block, or a diff of two reports shows a
// hash-order shuffle and a reader learns to ignore it.
test('the order is fully determined — no ties left to input order', () => {
  const a = f({ endpoint: 'GET /a', location: 'query.q', fingerprint: '1' });
  const b = f({ endpoint: 'GET /a', location: 'body.status', fingerprint: '2' });
  const c = f({ endpoint: 'GET /b', location: 'query.q', fingerprint: '3' });
  assert.deepEqual(sortFindings([a, b, c]), sortFindings([c, b, a]));
});

// ---------------------------------------------------------------------------
// The summary line
// ---------------------------------------------------------------------------

test('the summary counts what fails separately from what was withheld, and names each reason', () => {
  const line = findingsSummaryLine([
    f({ fingerprint: '1' }),
    f({ withheld: 'baseline', fingerprint: '2' }),
    f({ withheld: 'fail-on', fingerprint: '3' }),
    f({ withheld: 'seeded', fingerprint: undefined, seeded: { seed: 7, payload: 'x' } }),
  ]);
  assert.match(line, /4 findings/);
  assert.match(line, /1 failing/);
  assert.match(line, /known\/accepted/);
  assert.match(line, /seeded/);
});

test('one finding reads as one finding', () => {
  assert.match(findingsSummaryLine([f()]), /^1 finding —/);
});

// ---------------------------------------------------------------------------
// The block itself
// ---------------------------------------------------------------------------

test('a run with no findings renders no section at all', () => {
  // Not an empty table: a heading over nothing invites the reading that the scan ran and is the
  // reason `renderAuthzBlindSpot` next door returns '' too.
  assert.equal(renderFindings(report([])), '');
  assert.equal(renderFindings({} as RunReport), '');
});

test('a withheld finding is rendered, badged with why, and keeps its fingerprint', () => {
  // The single most important assertion in this file. If a withheld finding vanished, `--fail-on`
  // and `--baseline` would be ways to make a report look clean rather than ways to stage adoption,
  // and a baseline whose contents you cannot see is not reviewable.
  const html = renderFindings(report([f({ withheld: 'baseline', fingerprint: 'deadbeefdeadbeef' })]));
  assert.match(html, /known\/accepted/);
  assert.match(html, /deadbeefdeadbeef/);
});

test('a finding with no fingerprint says so rather than rendering an empty cell', () => {
  const html = renderFindings(report([f({ fingerprint: undefined })]));
  assert.match(html, /not baselinable/);
});

test('a seeded finding renders its payload and the call to action that liquidates the layer', () => {
  const html = renderFindings(report([f({ fingerprint: undefined, withheld: 'seeded', seeded: { seed: 42, payload: "tflw';" } })]));
  assert.match(html, /seed 42/);
  assert.match(html, /promote this payload/i);
  assert.match(html, /tflw&#39;;/, 'the payload must be escaped — it is attacker-shaped by construction');
});

// The payload is an attacker-controlled string by definition, and it is rendered into a page. R10
// governs what evidence may be reproduced; this governs that whatever is reproduced cannot execute.
test('every attacker-controlled field is escaped', () => {
  const html = renderFindings(report([f({ detail: '<script>alert(1)</script>', location: '"><img src=x>', endpoint: 'GET /<b>' })]));
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.equal(html.includes('<img src=x>'), false);
  assert.match(html, /&lt;script&gt;/);
});

test('the endpoint, location and invariant all reach the row', () => {
  const html = renderFindings(report([f({ endpoint: 'GET /orders/{id}', location: 'query.sort', invariant: 'a stack frame' })]));
  assert.match(html, /GET \/orders\/\{id\}/);
  assert.match(html, /query\.sort/);
  assert.match(html, /a stack frame/);
});

// ---------------------------------------------------------------------------
// D389 — the census, `M128-01`'s fix
// ---------------------------------------------------------------------------

const census: ScanRuleCensus[] = [
  {
    scan: 'input-handling',
    applied: ['sec/error-detail-disclosure'],
    notApplicable: [{ rule: 'sec/path-traversal-read', because: ['`traversal` payloads need `probe traversal` under this `authorized target`'] }],
  },
];

test('the census names both halves — what applied and what stood down, with the reason', () => {
  const html = renderScanCoverage(census);
  assert.match(html, /sec\/error-detail-disclosure/);
  assert.match(html, /sec\/path-traversal-read/);
  assert.match(html, /probe traversal/);
});

// The row is filed about a report that can only name its not-applicable rules inside D285's *no power
// to fail* message, which prints when **zero** rules applied. On a run where something applied and
// everything passed, the information used to vanish entirely — and that is the commonest run.
test('the census renders on a passing run, which is where the information used to disappear', () => {
  const html = renderScanCoverage(census);
  assert.notEqual(html, '');
  assert.match(html, /did not apply/);
});

test('a pack where every rule applied says so rather than rendering an empty list', () => {
  const html = renderScanCoverage([{ scan: 'security', applied: ['sec/a'], notApplicable: [] }]);
  assert.match(html, /every rule in this pack applied/);
});

test('a scan where nothing applied says none rather than rendering a blank', () => {
  const html = renderScanCoverage([{ scan: 'authorization', applied: [], notApplicable: [{ rule: 'sec/b', because: ['no principal could answer'] }] }]);
  assert.match(html, /<em>none<\/em>/);
});

test('no census means no section, so a run with no scans is not told about scans', () => {
  assert.equal(renderScanCoverage(undefined), '');
  assert.equal(renderScanCoverage([]), '');
});

test('every reason a rule gave is listed, not just the first', () => {
  const html = renderScanCoverage([
    { scan: 'input-handling', applied: [], notApplicable: [{ rule: 'sec/x', because: ['no mutable input was observed', 'the response was not JSON'] }] },
  ]);
  assert.match(html, /no mutable input was observed/);
  assert.match(html, /the response was not JSON/);
});
