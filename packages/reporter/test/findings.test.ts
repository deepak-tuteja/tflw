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
import { readFileSync } from 'node:fs';
import type { RunReport, ScanFinding, ScanRuleCensus } from '@tflw/runtime';
import { findingsSummaryLine, renderFindings, renderScanCoverage, sortFindings } from '../src/findings.js';
import { REMEDIATION_KB } from '../src/kb.js';
import { renderReportHtml } from '../src/html.js';

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

/** A whole `RunReport` rather than the cast partial above, because `renderReportHtml` reads the
 *  header fields too. Carries one gating finding and one withheld one, so both row states exist in
 *  the document the D429 guards below read. */
function reportWithFindings(): RunReport {
  return {
    ok: true,
    env: 'local',
    startedAt: '2026-08-16T00:00:00.000Z',
    durationMs: 100,
    total: 1,
    passed: 1,
    failed: 0,
    seed: 42,
    now: '2026-08-16T00:00:00.000Z',
    insecure: false,
    tests: [{ kind: 'functional', name: 'scan', ok: true, durationMs: 12, steps: [] }],
    findings: [f({ severity: 'critical', fingerprint: 'c'.repeat(16) }), f({ severity: 'minor', withheld: 'baseline', fingerprint: 'd'.repeat(16) })],
    scanCoverage: census,
  } as unknown as RunReport;
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

// ---------------------------------------------------------------------------
// M135a (D402/D408) — the remediation block inside a finding row
// ---------------------------------------------------------------------------

test('a finding renders its rule\'s remediation, collapsed', () => {
  const html = renderFindings(report([f()]));
  assert.match(html, /<details class="finding-fix"><summary>possible fixes<\/summary>/);
  assert.match(html, /A hostile input made the application disclose its own internals/);
  // The generic fix and the concrete one are both present, and the concrete one is labelled as
  // NestJS rather than presented as the fix — a reader on another framework has to be able to tell
  // which half is advice about their system.
  assert.match(html, /<strong>Fix<\/strong>/);
  assert.match(html, /<strong>In NestJS<\/strong>/);
  assert.match(html, /CWE-209/);
  assert.match(html, /cwe\.mitre\.org\/data\/definitions\/209\.html/);
});

test('a withheld finding still gets its fixes', () => {
  // Same argument as the fingerprint's: a relaxation nobody can see is indistinguishable from a
  // scan that found nothing, and a baselined finding is precisely one somebody may come back to.
  const html = renderFindings(report([f({ withheld: 'baseline' })]));
  assert.match(html, /finding-fix/);
});

test('a rule the KB does not know renders the row without fixes rather than throwing', () => {
  const html = renderFindings(report([f({ rule: 'sec/from-a-newer-build' })]));
  assert.doesNotMatch(html, /finding-fix/);
  assert.match(html, /sec\/from-a-newer-build/);
});

test('KB prose is escaped before its code spans are formed', () => {
  // The entries are authored with markdown backticks because their other consumer is SARIF's
  // `help.markdown`. Here they become `<code>` — **after** escaping, so nothing in an entry can open
  // a tag, and a `<` in prose stays a `<`.
  //
  // **The rule is chosen, not arbitrary.** `sec/csp-missing`'s prose contains a literal
  // `` `<script>` `` — it is the one entry that talks about markup — and it is therefore the only
  // one on which dropping `esc` changes the output at all. Written against any other rule this test
  // passes with the escape removed, which is precisely what the `kb-prose-rendered-unescaped`
  // mutation demonstrated: a control that cannot see the defect it names.
  const entry = REMEDIATION_KB['sec/csp-missing'];
  assert.match(`${entry.what} ${entry.why} ${entry.fixGeneric} ${entry.fixNest}`, /</, 'this test is vacuous unless the entry it reads still contains markup');

  const html = renderFindings(report([f({ rule: 'sec/csp-missing' })]));
  assert.match(html, /<code>&lt;script&gt;<\/code>/);
  assert.doesNotMatch(html, /<script>/, 'an unescaped entry would put a live tag in the one report that renders attacker-shaped findings');
});

// --- M136a (D429, `M135a-01`) — the classes are emitted AND styled ---------------------------------
//
// The row this closes: `findings.ts` emitted eleven class names and `html.ts`'s stylesheet matched
// none of them, so the one section a reader scans by severity rendered as a default browser table.
// It survived M134b and M135a because nothing connects the two files — one emits strings, the other
// holds a string, and neither knows the other exists.
//
// So the guard is the connection: every class this module emits must have a rule somewhere in the
// rendered stylesheet. It is a string check rather than a layout assertion, exactly as
// `overflow.test.ts` is and for the same stated reason — no layout engine is involved anywhere in
// this package, and "the selector is present" is the cheap proxy that would have caught the row.

test('D429: every class the findings block emits is styled', () => {
  const emitted = [...readFileSync(new URL('../src/findings.ts', import.meta.url), 'utf8').matchAll(/class="([^"$]*)"/g)]
    .flatMap((m) => m[1]!.split(/\s+/))
    .filter((c) => c.length > 0);
  // The two interpolated ones, which the literal scan above cannot see: `sev-${severity}` and the
  // `finding-on`/`finding-off` pair. Listed explicitly rather than parsed out of a template, because
  // a regex that tried would be a second thing to get wrong.
  const interpolated = ['sev-critical', 'sev-serious', 'sev-moderate', 'sev-minor', 'finding-on', 'finding-off'];
  const html = renderReportHtml(reportWithFindings());
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

  // 'finding-on' is the only exemption, and it is one on purpose: it is the *default* row state, so
  // the styling that applies to it is the table's own. Adding a rule to satisfy this test would be
  // styling for the test. An exemption list of one, named with its reason, is the honest form — and
  // it still fails the moment a twelfth class is emitted without a rule.
  const NEEDS_NO_RULE = new Set(['finding-on']);
  const unstyled = [...new Set([...emitted, ...interpolated])].filter((c) => !NEEDS_NO_RULE.has(c) && !style.includes(`.${c}`));
  assert.deepEqual(unstyled, [], `emitted with no stylesheet rule: ${unstyled.join(', ')}`);
});

test('D429: severity carries colour, which is the axis the row is actually about', () => {
  const style = renderReportHtml(reportWithFindings());
  // Not merely "a rule exists" — a `.sev-critical` that set only a margin would pass the test above
  // while leaving the report exactly as unreadable as the row describes.
  for (const [cls, token] of [['sev-critical', '--fail'], ['sev-moderate', '--warn'], ['sev-minor', '--mut']] as const) {
    const rule = new RegExp(`\\.${cls}\\{[^}]*var\\(${token}\\)`);
    assert.match(style, rule, `${cls} must take its colour from the report's existing palette`);
  }
});

test('D429: a withheld row is dimmed, never hidden', () => {
  // D386's rule at the stylesheet layer: a finding withheld from the verdict is still a finding, so
  // `display:none` here would make a green run that judged less render identically to one that
  // judged more — which is the defect the whole withheld-reason mechanism exists to prevent.
  const style = renderReportHtml(reportWithFindings());
  const rule = /\.finding-off\{([^}]*)\}/.exec(style);
  assert.ok(rule, 'a withheld row needs a rule of its own or it reads as an ordinary one');
  assert.doesNotMatch(rule[1]!, /display\s*:\s*none|visibility\s*:\s*hidden/);
  assert.match(rule[1]!, /opacity/);
});
