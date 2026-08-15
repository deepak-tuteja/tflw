// M135a (PLAN_M135_SARIF.md D406/D408/D409) — the remediation KB and the SARIF severity table.
//
// **What can go wrong here that a type cannot catch.** D409 makes a *missing* entry a compile error,
// so nothing below re-checks that. The other direction — an id in a tuple that no rule declares —
// is pinned one package down, in `runtime/test/scan-rule-ids.test.ts`, where the packs themselves
// are importable; `@tflw/runtime` exports its index and nothing else, and widening that export map
// to let a test reach three internal modules would be a real API change bought for a test's
// convenience.
//
// What is left here is the citation discipline `M135`'s risk 4 names: eighteen entries is eighteen
// opportunities to write plausible advice, and unlike a rule an entry has no test that can be wrong.
// The check that *is* available is that every entry carries the reference its fix has to be
// traceable to — a CWE id and at least one OWASP document — so an entry written without opening one
// cannot ship quietly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCAN_RULE_IDS } from '@tflw/runtime';
import { REMEDIATION_KB, remediationFor } from '../src/kb.js';
import { SARIF_SEVERITY, sarifSeverityOf } from '../src/sarif-severity.js';

test('the KB has exactly one entry per rule id, and no others', () => {
  assert.deepEqual(Object.keys(REMEDIATION_KB).sort(), [...SCAN_RULE_IDS].sort());
});

// ---------------------------------------------------------------------------
// The entries themselves
// ---------------------------------------------------------------------------

test('every entry cites a CWE and at least one OWASP document', () => {
  for (const id of SCAN_RULE_IDS) {
    const e = REMEDIATION_KB[id];
    assert.ok(Number.isInteger(e.cwe) && e.cwe > 0, `${id}: cwe must be a real id`);
    assert.ok(
      e.refs.some((r) => r.url.includes('cwe.mitre.org')),
      `${id}: the CWE id must be reachable as a link, not only as a number`,
    );
    assert.ok(
      e.refs.some((r) => r.url.includes('owasp.org')),
      `${id}: an entry whose fix cannot be traced to an OWASP reference should not ship`,
    );
    for (const r of e.refs) assert.ok(r.url.startsWith('https://'), `${id}: ${r.url} — references are https or they are not references`);
  }
});

test('every entry says all four things, and says them as prose', () => {
  for (const id of SCAN_RULE_IDS) {
    const e = REMEDIATION_KB[id];
    for (const [field, value] of Object.entries({ title: e.title, what: e.what, why: e.why, fixGeneric: e.fixGeneric, fixNest: e.fixNest })) {
      assert.ok(value.trim().length > 0, `${id}.${field} is empty`);
    }
    // A placeholder is the failure mode a length check catches and a presence check does not: an
    // entry stubbed as "TODO" during authoring reads as complete to every other assertion here.
    for (const field of [e.what, e.why, e.fixGeneric, e.fixNest]) {
      assert.ok(field.length >= 60, `${id}: "${field}" is too short to be an authored answer`);
      assert.doesNotMatch(field, /TODO|FIXME|TBD/i, `${id}: placeholder text`);
    }
  }
});

test('the KB does not carry severity (D408)', () => {
  // R9 said it should. Three homes for one value — the rule descriptor, the emitted finding, and
  // here — is how the rule that fails a build and the rule in the dashboard come to disagree
  // invisibly. This asserts the correction rather than trusting it to review.
  for (const id of SCAN_RULE_IDS) {
    assert.ok(!('severity' in REMEDIATION_KB[id]), `${id}: severity belongs to the rule module, not the KB`);
  }
});

test('an unknown rule id resolves to undefined rather than throwing', () => {
  // The path is a `results.json` from a newer build rendered by an older reporter. It must degrade
  // to a row without fixes, not to a crash in somebody's report.
  assert.equal(remediationFor('sec/not-a-rule'), undefined);
  assert.equal(remediationFor('sec/path-traversal-read')?.cwe, 22);
});

// ---------------------------------------------------------------------------
// D406 — the severity table
// ---------------------------------------------------------------------------

test('four tflw severities map to three SARIF levels', () => {
  assert.deepEqual(
    (['critical', 'serious', 'moderate', 'minor'] as const).map((s) => sarifSeverityOf(s).level),
    ['error', 'error', 'warning', 'note'],
  );
});

test('security-severity is a STRING and sits inside GitHub\'s band, not on its boundary', () => {
  // The trap this milestone is likeliest to ship: GitHub ignores a numeric `security-severity`
  // silently — the alert appears, ranked wrong, and nothing says so.
  const bands: Record<string, [number, number]> = { critical: [9.0, 10.0], serious: [7.0, 8.9], moderate: [4.0, 6.9], minor: [0.0, 3.9] };
  for (const [severity, [lo, hi]] of Object.entries(bands)) {
    const { securitySeverity } = SARIF_SEVERITY[severity as keyof typeof SARIF_SEVERITY];
    assert.equal(typeof securitySeverity, 'string', `${severity}: a number here is ignored, and ignored quietly`);
    const n = Number(securitySeverity);
    assert.ok(n > lo && n < hi, `${severity}: ${n} must sit inside ${lo}–${hi}, not on an edge a rounding difference can cross`);
  }
});
