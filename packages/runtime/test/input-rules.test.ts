// The Tier 3 input-handling pack (M134a, PLAN_M134_PENTEST_TIER3.md D373) — pure unit tests over
// hand-built bundles, independent of the prober, of the interpreter wiring, and of any network.
//
// **Every rule is tested in both directions, and the negative is the one that matters.** Tier 1
// shipped at *zero false positives* and this plan does not renegotiate that bar, so for each rule
// there is a positive (the app really did the thing) and a **named falsifier** — the nearest
// correct behaviour that must not fire. A scanner is trusted or ignored on the strength of its
// negatives, and a rule with only positive tests is a rule nobody has measured against a healthy
// application.
//
// The `M128` lesson is deliberately not re-learned: a pure test can agree with the code about a
// fact the rest of the system contradicts, so these tests bound what they prove. They prove the
// oracle's arithmetic; `input-assert.test.ts` drives the same pack through a real `tflw run`
// against a fixture server, which is what proves it fires for anybody.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INPUT_CORPUS, INPUT_RULE_IDS, type MutationSite, type Payload } from '../src/inputCorpus.js';
import { INPUT_RULES, judgeable, MUTATION_OUTCOME_LABEL, runInputScan, type InputObservation, type MutationOutcome, type MutationResult } from '../src/inputRules.js';
import type { RequestTrace, ResponseTrace } from '../src/types.js';

const { errorDetailDisclosure, reflectedInputUnescaped, pathTraversalRead, oversizedInputAccepted } = INPUT_RULE_IDS;

function res(over: Partial<ResponseTrace> = {}): ResponseTrace {
  const bodyText = over.bodyText ?? '{"ok":true}';
  return {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    bodyText,
    bodyBytes: Buffer.from(bodyText),
    durationMs: 1,
    finalUrl: 'https://api.test/v1/orders/7',
    cookieEvents: [],
    ...over,
  };
}

function req(over: Partial<RequestTrace> = {}): RequestTrace {
  return { method: 'GET', url: 'https://api.test/v1/orders/7', headers: {}, ...over };
}

const site: MutationSite = { kind: 'query', key: 'q', location: 'query `q`', observed: 'shoes' };

function payload(id: string): Payload {
  const p = INPUT_CORPUS.find((c) => c.id === id);
  assert.ok(p, `no payload ${id}`);
  return p;
}

function probe(payloadId: string, outcome: MutationOutcome, response?: ResponseTrace): MutationResult {
  return { site, payload: payload(payloadId), outcome, ...(response ? { response } : {}) };
}

function bundle(over: Partial<InputObservation> = {}): InputObservation {
  return {
    observed: { request: req(), response: res() },
    probes: [],
    sites: [site],
    disabledClasses: [],
    ...over,
  };
}

function findings(o: InputObservation, ruleId: string): string[] {
  return runInputScan(o).findings.filter((f) => f.id === ruleId).map((f) => f.detail);
}

function because(o: InputObservation, ruleId: string): string | undefined {
  return runInputScan(o).notApplicable.find((n) => n.rule.id === ruleId)?.because;
}

// --- sec/error-detail-disclosure --------------------------------------------------------------

test('a 500 carrying a stack frame is a finding', () => {
  const leak = res({ status: 500, bodyText: 'Error: bad\n    at OrderService.find (/usr/src/app/order.service.js:42:11)' });
  const o = bundle({ probes: [probe('injection/sql-quote', { kind: 'answered', status: 500 }, leak)] });
  assert.equal(findings(o, errorDetailDisclosure).length, 1);
});

test('THE FALSIFIER — a bare 500 with a clean JSON envelope is NOT a finding (D373)', () => {
  // The single most important negative in this file. Most APIs 500 on genuinely malformed input,
  // and against a strict-validation stack most of those 500s are tflw's own doing. A rule that
  // scored status would report a wall of findings on a correct application.
  const clean = res({ status: 500, bodyText: '{"statusCode":500,"message":"Internal server error"}' });
  const o = bundle({ probes: [probe('injection/sql-quote', { kind: 'answered', status: 500 }, clean)] });
  assert.deepEqual(findings(o, errorDetailDisclosure), []);
});

test('a validation message naming a database is not a finding — only machinery leaking is', () => {
  const polite = res({ status: 400, bodyText: '{"message":"could not save your order to the database, please retry"}' });
  const o = bundle({ probes: [probe('injection/sql-quote', { kind: 'answered', status: 400 }, polite)] });
  assert.deepEqual(findings(o, errorDetailDisclosure), []);
});

test('a SQL syntax error is a finding, and the detail names the payload and the evidence', () => {
  const leak = res({ status: 500, bodyText: '{"message":"syntax error at or near \\"tflw\\""}' });
  const o = bundle({ probes: [probe('injection/sql-quote', { kind: 'answered', status: 500 }, leak)] });
  const [detail] = findings(o, errorDetailDisclosure);
  assert.match(detail!, /injection\/sql-quote/);
  assert.match(detail!, /query `q`/);
  assert.match(detail!, /a SQL error fragment/);
});

test('disclosure the OBSERVED response already contained is subtracted, not attributed to the payload', () => {
  // An application that discloses on every request has a defect this tier did not find and must not
  // claim: the finding is *this payload caused it*, which is only true of something new.
  const leaky = res({ status: 500, bodyText: 'Error\n    at boot (/usr/src/app/main.js:1:1)' });
  const o = bundle({
    observed: { request: req(), response: leaky },
    probes: [probe('injection/sql-quote', { kind: 'answered', status: 500 }, leaky)],
  });
  assert.deepEqual(findings(o, errorDetailDisclosure), []);
});

// --- sec/reflected-input-unescaped ---------------------------------------------------------------

test('raw metacharacters echoed into an HTML body are a finding', () => {
  const html = res({ headers: { 'content-type': 'text/html; charset=utf-8' }, bodyText: '<p>no results for <tflw></p>' });
  const o = bundle({ probes: [probe('injection/html-metacharacters', { kind: 'answered', status: 200 }, html)] });
  assert.equal(findings(o, reflectedInputUnescaped).length, 1);
});

test('THE FALSIFIER — the same echo in a JSON body is NOT a finding (D373)', () => {
  // JSON has no markup semantics; the browser that renders it is where the escaping belongs.
  // Without this line the rule would fire on the overwhelming majority of correct APIs.
  const json = res({ bodyText: '{"query":"<tflw>","results":[]}' });
  const o = bundle({ probes: [probe('injection/html-metacharacters', { kind: 'answered', status: 200 }, json)] });
  assert.deepEqual(findings(o, reflectedInputUnescaped), []);
  assert.match(because(o, reflectedInputUnescaped)!, /a JSON echo is not a reflection finding/);
});

test('an HTML body that escaped the metacharacters is not a finding', () => {
  const escaped = res({ headers: { 'content-type': 'text/html' }, bodyText: '<p>no results for &lt;tflw&gt;</p>' });
  const o = bundle({ probes: [probe('injection/html-metacharacters', { kind: 'answered', status: 200 }, escaped)] });
  assert.deepEqual(findings(o, reflectedInputUnescaped), []);
});

// --- sec/path-traversal-read ----------------------------------------------------------------------

test('a passwd-shaped body is a critical finding', () => {
  const leak = res({ bodyText: 'root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1::/usr/sbin:/usr/sbin/nologin' });
  const o = bundle({ probes: [probe('traversal/relative', { kind: 'answered', status: 200 }, leak)] });
  const scan = runInputScan(o);
  const hit = scan.findings.find((f) => f.id === pathTraversalRead);
  assert.ok(hit);
  assert.equal(hit.severity, 'critical');
});

test('THE FALSIFIER — an app that echoes the traversal payload back has not read a file (D373)', () => {
  // Signature, never a path echo. A rule matching the *payload* would fire on every application
  // whose 404 message quotes what you asked for, which is most of them.
  const echo = res({ status: 404, bodyText: '{"message":"no such file: ../../../../etc/passwd"}' });
  const o = bundle({ probes: [probe('traversal/relative', { kind: 'answered', status: 404 }, echo)] });
  assert.deepEqual(findings(o, pathTraversalRead), []);
});

test('a signature the observed response already carried is subtracted', () => {
  const both = res({ bodyText: 'root:x:0:0:root:/root:/bin/bash' });
  const o = bundle({
    observed: { request: req(), response: both },
    probes: [probe('traversal/relative', { kind: 'answered', status: 200 }, both)],
  });
  assert.deepEqual(findings(o, pathTraversalRead), []);
});

// --- sec/oversized-input-accepted ------------------------------------------------------------------

test('an oversized value accepted with 2xx is a finding', () => {
  const o = bundle({ probes: [probe('oversized/64kib-string', { kind: 'answered', status: 201 }, res({ status: 201 }))] });
  assert.equal(findings(o, oversizedInputAccepted).length, 1);
});

test('THE FALSIFIER — a 413 or a 400 is the application behaving correctly (D373)', () => {
  // The rule most at risk of being written the other way round: "it errored, so it mishandled it"
  // is both tempting and exactly the bare-5xx finding this tier refuses.
  for (const status of [400, 413, 422, 500]) {
    const o = bundle({ probes: [probe('oversized/64kib-string', { kind: 'answered', status }, res({ status }))] });
    assert.deepEqual(findings(o, oversizedInputAccepted), [], `status ${status} must not be a finding`);
  }
});

// --- D285: not-applicable is a failure, and it says which kind ---------------------------------------

test('a request with no mutable input makes every rule not applicable, and cites TF067', () => {
  const o = bundle({ sites: [], probes: [] });
  const scan = runInputScan(o);
  assert.equal(scan.applicable.length, 0);
  assert.equal(scan.notApplicable.length, INPUT_RULES.length);
  for (const na of scan.notApplicable) assert.match(na.because, /no mutable input.*TF067/s);
});

test('a class withheld for want of an opt-in says so by name, not "found nothing"', () => {
  // The distinction `M128-01` is filed about: *this rule found nothing* and *this rule was never
  // given anything to look at* are different facts, and only one of them is reassuring.
  const o = bundle({ disabledClasses: ['traversal', 'oversized'], probes: [probe('injection/sql-quote', { kind: 'answered', status: 200 }, res())] });
  assert.match(because(o, pathTraversalRead)!, /`probe traversal`/);
  assert.match(because(o, oversizedInputAccepted)!, /`probe oversized`/);
});

test('a probe set that was entirely rate-limited applies no rule and tallies why', () => {
  const o = bundle({ probes: [probe('injection/sql-quote', { kind: 'inconclusive', reason: 'the host answered 429 (rate limited), so it never processed the payload' })] });
  const scan = runInputScan(o);
  assert.equal(scan.applicable.length, 0);
  assert.match(because(o, errorDetailDisclosure)!, /none was answered \(1 inconclusive\)/);
});

test('a probe that was never sent is not an answer', () => {
  const o = bundle({ probes: [probe('injection/sql-quote', { kind: 'not-probed', reason: 'no `probe mutating`' })] });
  assert.equal(runInputScan(o).applicable.length, 0);
});

// --- the severity floor ------------------------------------------------------------------------------

test('the floor narrows the pack before applicability, so the denominator moves with it (D296)', () => {
  const o = bundle({ probes: [probe('injection/sql-quote', { kind: 'answered', status: 200 }, res())] });
  assert.equal(runInputScan(o, null).considered, 4);
  // `minor` keeps all four; `serious` drops the moderate and minor rules; `critical` keeps one.
  assert.equal(runInputScan(o, 'minor').considered, 4);
  assert.equal(runInputScan(o, 'serious').considered, 2);
  assert.equal(runInputScan(o, 'critical').considered, 1);
});

test('a floor is a floor, not an exact match — `serious` keeps the critical rule', () => {
  const o = bundle({ probes: [probe('traversal/relative', { kind: 'answered', status: 200 }, res({ bodyText: 'root:x:0:0:root:/root:/bin/bash' }))] });
  const scan = runInputScan(o, 'serious');
  assert.ok(scan.findings.some((f) => f.id === pathTraversalRead), 'a critical finding must survive a serious floor');
});

// --- the taxonomy ---------------------------------------------------------------------------------------

test('only an answered probe is judgeable — a 5xx IS answered, unlike Tier 2 (D373)', () => {
  assert.equal(judgeable({ kind: 'answered', status: 500 }), true);
  assert.equal(judgeable({ kind: 'inconclusive', reason: 'x' }), false);
  assert.equal(judgeable({ kind: 'not-probed', reason: 'x' }), false);
});

test('every outcome kind has a label, so the reporter and the pack cannot spell one two ways', () => {
  assert.deepEqual(Object.keys(MUTATION_OUTCOME_LABEL).sort(), ['answered', 'inconclusive', 'not-probed']);
});
