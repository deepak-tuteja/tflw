// `M211` `S6` (`M211-01`) — the findings list collapses rows that are equal in every field.
//
// The claim this file defends is narrow on purpose: **nothing that differs is ever merged.** The
// page groups so a reader is not handed the same sentence thirty thousand times; `results.json`
// keeps every judgement, because a scan rule is judged once per response and that is what the run
// did (`D1083`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ScanFinding } from '@tflw/runtime';
import { groupIdentical } from '../src/Findings.js';

const base: ScanFinding = {
  scan: 'security',
  rule: 'sec/cookie-not-httponly',
  severity: 'critical',
  description: 'cookie is readable by JavaScript (no HttpOnly)',
  detail: 'cookie `session` — any XSS on this origin can read it',
  endpoint: 'POST /login',
  location: 'cookie session',
  fingerprint: 'f9ea851f1285230b',
} as ScanFinding;

test('identical rows become one row carrying how many there were', () => {
  const grouped = groupIdentical(Array.from({ length: 29381 }, () => ({ ...base })));
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0]!.count, 29381);
  assert.deepEqual(grouped[0]!.f, base);
});

test('a single finding is one row with a count of one, so the ordinary case is untouched', () => {
  const grouped = groupIdentical([base]);
  assert.deepEqual(grouped, [{ f: base, count: 1 }]);
});

// The safety claim, and the reason the key is the whole row rather than the fingerprint. The
// fingerprint is `sha256(scan ∥ rule ∥ endpoint ∥ location ∥ invariant)` and deliberately excludes
// `detail`, so two findings can share one and still carry different evidence — tier 3's
// input-handling details name the payload and quote the response. A fingerprint-keyed collapse
// would discard that; this one cannot.
test('two rows sharing a fingerprint but differing in evidence stay two rows', () => {
  const a = { ...base, detail: 'carrying `sqli/1` answered 500 with a stack frame: at Object.<anonymous>' };
  const b = { ...base, detail: 'carrying `sqli/2` answered 500 with a stack frame: at Module._compile' };
  assert.equal(a.fingerprint, b.fingerprint);
  const grouped = groupIdentical([a, b, a]);
  assert.equal(grouped.length, 2);
  assert.deepEqual(grouped.map((g) => g.count), [2, 1]);
});

test('rows differing only in where they were found stay two rows', () => {
  const grouped = groupIdentical([
    { ...base, file: 'tests/a.tflw', line: 3 } as ScanFinding,
    { ...base, file: 'tests/b.tflw', line: 9 } as ScanFinding,
  ]);
  assert.equal(grouped.length, 2);
});

// `D369`'s seeded findings and the a11y scan's endpoint-less ones carry no fingerprint at all. A
// fingerprint-keyed collapse would have needed a rule for them; keying on the whole row does not.
test('rows with no fingerprint need no special rule — they merge when identical and not otherwise', () => {
  const seeded = { ...base, fingerprint: undefined, seeded: { seed: 7, payload: "'; DROP--" } } as unknown as ScanFinding;
  const other = { ...base, fingerprint: undefined, seeded: { seed: 7, payload: '<script>' } } as unknown as ScanFinding;
  assert.equal(groupIdentical([seeded, seeded]).length, 1);
  assert.equal(groupIdentical([seeded, other]).length, 2);
});

// This gates **group order**, not which occurrence is kept — and the difference matters, because
// the `S6` mutation sweep's one survivor was `keep the last occurrence instead of the first` and
// this test does not kill it. It cannot: two rows only group when their keys are equal, the key is
// the whole row, and equal keys mean equal `JSON.stringify` output — so the row that is dropped and
// the row that is kept are indistinguishable to every reader. The mutation is **equivalent over the
// only input this function has**, which is parsed `results.json`. It becomes observable exactly
// where JSON cannot go — `undefined` against `null`, `NaN`, `-0` — and a gate built on those would
// be asserting a shape the corpus cannot produce, which is the vacuity this repository keeps
// filing rather than the coverage it looks like. Recorded, not gated.
test('groups come out in first-appearance order, so the report\'s own order survives', () => {
  const first = { ...base, detail: 'first' };
  const second = { ...base, detail: 'second' };
  assert.deepEqual(groupIdentical([first, second, first]).map((g) => g.f.detail), ['first', 'second']);
});

// Key order is not identity: `results.json` is parsed JSON, and two objects with the same fields
// written in a different order are the same finding.
test('field order does not make two rows out of one', () => {
  const reordered = JSON.parse(JSON.stringify({ fingerprint: base.fingerprint, scan: base.scan, rule: base.rule, severity: base.severity, description: base.description, detail: base.detail, endpoint: base.endpoint, location: base.location })) as ScanFinding;
  assert.equal(groupIdentical([base, reordered]).length, 1);
});
