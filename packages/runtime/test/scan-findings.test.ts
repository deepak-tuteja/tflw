// M134b (PLAN_M134_PENTEST_TIER3.md D376/D385/D386/D387) — the report-facing finding, R8's
// fingerprint, the baseline document and the gate. Pure unit tests: no interpreter, no network, no
// clock.
//
// **The property under test throughout is that the gate can only ever RELAX** (D386). A gate that
// could tighten would let a command-line flag turn a green suite red for a reason not visible in the
// source, and the one place that could happen by accident — the negated matcher, where findings
// cause success — has its own test rather than a comment.
//
// The fingerprint tests are written as *stability* and *distinctness* pairs, because a fingerprint
// fails in two opposite directions and only one of them is loud. A fingerprint that moves between
// runs makes a baseline churn, which somebody notices immediately. A fingerprint that collides makes
// two weaknesses share one baseline entry, so accepting the first silently accepts the second — and
// nothing announces that at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Finding } from '../src/finding.js';
import {
  BASELINE_VERSION,
  OPEN_GATE,
  fingerprintOf,
  judge,
  parseBaseline,
  renderBaseline,
  staleBaselineEntries,
  toScanFinding,
  withheldNote,
  type ScanFinding,
  type ScanGate,
} from '../src/scanFindings.js';

const ENDPOINT = 'GET /orders/{id}';

function finding(over: Partial<Finding> = {}): Finding {
  return { id: 'sec/error-detail-disclosure', severity: 'serious', description: 'd', detail: 'x', ...over };
}

function scan(over: Partial<ScanFinding> = {}): ScanFinding {
  return {
    scan: 'input-handling',
    rule: 'sec/error-detail-disclosure',
    severity: 'serious',
    description: 'd',
    detail: 'x',
    endpoint: ENDPOINT,
    fingerprint: 'aaaaaaaaaaaaaaaa',
    ...over,
  };
}

function gate(over: Partial<ScanGate> = {}): ScanGate {
  return { failOn: null, accepted: new Map(), ...over };
}

// ---------------------------------------------------------------------------
// R8's fingerprint
// ---------------------------------------------------------------------------

test('the same weakness fingerprints identically across runs', () => {
  const a = fingerprintOf('input-handling', 'sec/path-traversal-read', { endpoint: ENDPOINT, location: 'body.status' });
  const b = fingerprintOf('input-handling', 'sec/path-traversal-read', { endpoint: ENDPOINT, location: 'body.status' });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{16}$/);
});

test('two weaknesses on one endpoint stay distinct — location is what separates them', () => {
  const body = fingerprintOf('input-handling', 'sec/error-detail-disclosure', { endpoint: ENDPOINT, location: 'body.status' });
  const query = fingerprintOf('input-handling', 'sec/error-detail-disclosure', { endpoint: ENDPOINT, location: 'query.sort' });
  assert.notEqual(body, query);
});

test('one rule violated two ways on one site stays distinct — the invariant separates them', () => {
  const stack = fingerprintOf('input-handling', 'sec/error-detail-disclosure', { endpoint: ENDPOINT, location: 'body.status', invariant: 'a stack frame' });
  const sql = fingerprintOf('input-handling', 'sec/error-detail-disclosure', { endpoint: ENDPOINT, location: 'body.status', invariant: 'an SQL error' });
  assert.notEqual(stack, sql);
});

test('the same rule under two scans does not collide', () => {
  const one = fingerprintOf('security', 'sec/x', { endpoint: ENDPOINT });
  const two = fingerprintOf('authorization', 'sec/x', { endpoint: ENDPOINT });
  assert.notEqual(one, two);
});

// The detail carries the concrete payload and a response excerpt, so hashing it would move the
// fingerprint every time an error message was reworded — invalidating a baseline for a change that
// fixed nothing. This is R8's exclusion list asserted rather than described.
test('rewording a finding detail does not move its fingerprint', () => {
  const before = toScanFinding('input-handling', finding({ detail: 'answered 500 with a stack frame: Error…' }), ENDPOINT);
  const after = toScanFinding('input-handling', finding({ detail: 'a completely different sentence' }), ENDPOINT);
  assert.equal(before.fingerprint, after.fingerprint);
});

test('a finding with no endpoint gets no fingerprint, and is therefore not baselinable', () => {
  const f = toScanFinding('security', finding(), null);
  assert.equal(f.fingerprint, undefined);
  // The a11y scan's case. Hashing an empty string here would give every a11y violation in a suite
  // one shared identity, so accepting one would accept all of them.
  assert.equal(judge([f], gate({ accepted: new Map([['', { fingerprint: '', rule: '', endpoint: '' }]]) })).gating.length, 1);
});

test('a seeded finding carries its payload and seed and never carries a fingerprint (D369)', () => {
  const f = toScanFinding('input-handling', finding(), ENDPOINT, { seeded: { seed: 7, payload: "tflw'" } });
  assert.equal(f.fingerprint, undefined);
  assert.deepEqual(f.seeded, { seed: 7, payload: "tflw'" });
});

// `M137c` (D437/D461) — provenance is carried and is **not** identity. Unlike `seeded` above, `via`
// does not suppress the fingerprint: a crawl-found weakness is as baselinable as a hand-found one, it
// just also records how it was reached. Both halves are asserted here because each fails silently in a
// different direction — a `via` that moved the hash would churn a baseline on every re-seed, and a
// `via` that suppressed it would make every crawl finding un-acceptable.
test('D437: `via` is carried, and it does not touch the fingerprint', () => {
  const withVia = toScanFinding('security', finding(), ENDPOINT, { via: 'openapi' });
  const otherVia = toScanFinding('security', finding(), ENDPOINT, { via: 'traffic' });
  const without = toScanFinding('security', finding(), ENDPOINT);
  assert.equal(withVia.via, 'openapi');
  assert.equal(without.via, undefined, 'absent for a finding no crawl produced');
  assert.equal(withVia.fingerprint, without.fingerprint);
  assert.equal(withVia.fingerprint, otherVia.fingerprint, 'the same weakness found by two seeds is one weakness');
  assert.ok(withVia.fingerprint, 'and it is a real fingerprint — `via` must not suppress it the way `seeded` does');
  // The structural reason, stated as a test: `fingerprintOf` takes its three arguments explicitly, so a
  // field added to `ScanFinding` cannot reach the hash however the object is later shaped. That is why
  // `D437`'s exclusion needed no code — only this.
  assert.equal(withVia.fingerprint, fingerprintOf('security', finding().id, { endpoint: ENDPOINT }));
});

// ---------------------------------------------------------------------------
// D386 — the gate relaxes, and says so
// ---------------------------------------------------------------------------

test('the open gate lets every finding fail its assertion — the pre-M134b behaviour, unchanged', () => {
  const v = judge([scan(), scan({ severity: 'minor', fingerprint: 'b'.repeat(16) })], OPEN_GATE);
  assert.equal(v.gating.length, 2);
  assert.equal(withheldNote(v), '');
});

test('--fail-on withholds findings below the floor and keeps the rest', () => {
  const v = judge(
    [scan({ severity: 'minor', fingerprint: '1'.repeat(16) }), scan({ severity: 'critical', fingerprint: '2'.repeat(16) })],
    gate({ failOn: 'serious' }),
  );
  assert.equal(v.gating.length, 1);
  assert.equal(v.gating[0]!.severity, 'critical');
  assert.equal(v.withheldByFloor, 1);
});

// The whole feature rests on this: a withheld finding is still reported. A report that agreed with
// the gate would describe the gate rather than the run, and a baseline whose contents you cannot see
// is not reviewable.
test('a withheld finding still reaches the report, stamped with why', () => {
  const v = judge([scan({ severity: 'minor' })], gate({ failOn: 'critical' }));
  assert.equal(v.all.length, 1);
  assert.equal(v.all[0]!.withheld, 'fail-on');
  assert.equal(v.gating.length, 0);
});

test('a baselined finding is withheld, and the note names it as accepted rather than as below a floor', () => {
  const fp = 'c'.repeat(16);
  const v = judge([scan({ fingerprint: fp })], gate({ accepted: new Map([[fp, { fingerprint: fp, rule: 'sec/x', endpoint: ENDPOINT }]]) }));
  assert.equal(v.withheldByBaseline, 1);
  assert.equal(v.all[0]!.withheld, 'baseline');
  assert.match(withheldNote(v), /known\/accepted/);
});

// Order matters for the counts: the more specific statement wins, and it is the one whose entry a
// reader can go and delete.
test('a finding that is both accepted and below the floor reports as accepted', () => {
  const fp = 'd'.repeat(16);
  const v = judge([scan({ fingerprint: fp, severity: 'minor' })], gate({ failOn: 'critical', accepted: new Map([[fp, { fingerprint: fp, rule: 'r', endpoint: ENDPOINT }]]) }));
  assert.equal(v.withheldByBaseline, 1);
  assert.equal(v.withheldByFloor, 0);
});

test('a seeded finding never gates, whatever the gate says (D369)', () => {
  const v = judge([scan({ fingerprint: undefined, seeded: { seed: 1, payload: 'x' } })], OPEN_GATE);
  assert.equal(v.gating.length, 0);
  assert.equal(v.withheldAsSeeded, 1);
  assert.match(withheldNote(v), /seeded/);
});

test('withheldNote is empty when nothing was withheld, so no existing message moves', () => {
  assert.equal(withheldNote(judge([scan()], OPEN_GATE)), '');
});

// ---------------------------------------------------------------------------
// D387 — the baseline document
// ---------------------------------------------------------------------------

test('a written baseline round-trips, is sorted, and omits seeded findings', () => {
  const text = renderBaseline([
    scan({ fingerprint: 'ffff000000000000' }),
    scan({ fingerprint: '0000ffff00000000' }),
    scan({ fingerprint: undefined, seeded: { seed: 3, payload: 'p' } }),
  ]);
  const parsed = parseBaseline(text, 'baseline.json');
  assert.equal(parsed.version, BASELINE_VERSION);
  assert.deepEqual(
    parsed.accepted.map((e) => e.fingerprint),
    ['0000ffff00000000', 'ffff000000000000'],
  );
});

test('re-writing an unchanged baseline produces an identical document', () => {
  const findings = [scan({ fingerprint: 'aaaa111100000000' }), scan({ fingerprint: 'bbbb222200000000' })];
  assert.equal(renderBaseline(findings), renderBaseline([...findings].reverse()));
});

test('one weakness found twice in a run yields one baseline entry', () => {
  const text = renderBaseline([scan({ fingerprint: 'eeee000000000000' }), scan({ fingerprint: 'eeee000000000000' })]);
  assert.equal(parseBaseline(text, 'b.json').accepted.length, 1);
});

// Every failure mode of a baseline file makes a build *greener*, so each one throws rather than
// degrading to "accepted nothing" — which looks exactly like a codebase that fixed its findings.
test('a malformed baseline is refused rather than silently accepting nothing', () => {
  assert.throws(() => parseBaseline('{', 'b.json'), /not valid JSON/);
  assert.throws(() => parseBaseline('[]', 'b.json'), /must be a JSON object/);
  assert.throws(() => parseBaseline('{"version":99,"accepted":[]}', 'b.json'), /version/);
  assert.throws(() => parseBaseline('{"version":1}', 'b.json'), /"accepted" array/);
  assert.throws(() => parseBaseline('{"version":1,"accepted":[{}]}', 'b.json'), /no "fingerprint"/);
});

// A rule renamed upstream must not silently un-accept every entry that mentioned it: the match is on
// the fingerprint alone, and `rule`/`endpoint` are there for the human reading the file.
test('the baseline matches on fingerprint alone, not on the rule name beside it', () => {
  const fp = '9'.repeat(16);
  const doc = parseBaseline(JSON.stringify({ version: 1, accepted: [{ fingerprint: fp, rule: 'sec/OLD-NAME', endpoint: 'GET /x' }] }), 'b.json');
  const v = judge([scan({ fingerprint: fp, rule: 'sec/new-name' })], gate({ accepted: new Map(doc.accepted.map((e) => [e.fingerprint, e])) }));
  assert.equal(v.withheldByBaseline, 1);
});

test('stale baseline entries are reported, not removed', () => {
  const doc = parseBaseline(JSON.stringify({ version: 1, accepted: [{ fingerprint: 'live000000000000' }, { fingerprint: 'dead000000000000' }] }), 'b.json');
  const stale = staleBaselineEntries(doc, new Set(['live000000000000']));
  assert.deepEqual(stale.map((e) => e.fingerprint), ['dead000000000000']);
  // The document is untouched — a `--tags` run legitimately produces a subset of the suite's
  // findings, so pruning on absence would delete acceptances the next full run still needs.
  assert.equal(doc.accepted.length, 2);
});
