// `DETECTOR_PATTERNS` (M137d, PLAN_M137_PENTEST_TIER4.md D472) — the join that lets an emitted repro
// assert an input-handling finding *without* re-using the matcher that found it.
//
// **Why this file exists at all is D471.** Both detector-backed rules subtract the control by label
// (`inputRules.ts` lines 269 and 351), and in a repro the mutated request *is* the observed request —
// so re-asserting `expect response has no input handling violations` would find the leak in the
// control, subtract it from itself, and pass against an unfixed application. A repro that goes green
// on a live vulnerability is the artifact a maintainer closes the ticket with, so the repro names the
// leak directly and this map is what it names it from.
//
// **The tests below are a table over every label, not a sample of them.** `M137c` shipped a guide
// chapter publishing seven reachability rows with three of them tested, and the four untested ones
// included the row a reader most needs to be true. The same failure is available here and would be
// quieter: a label whose pattern does not actually match its own evidence produces a repro that is
// green on a real finding, which is indistinguishable from a fixed application.
//
// What these tests do NOT prove: that the emitted *file* parses. A pattern is a regex here and a tflw
// string literal in the repro, and `\s` unescaped there is a `TF047` error — that is
// `input-repro.test.ts`'s object, because it is a property of the emitter's escaping and not of the
// detector.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INPUT_CORPUS, INPUT_RULE_IDS, type MutationSite, type Payload } from '../src/inputCorpus.js';
import { DETECTOR_PATTERNS, runInputScan, type InputObservation, type MutationOutcome, type MutationResult } from '../src/inputRules.js';
import type { Finding } from '../src/finding.js';
import type { RequestTrace, ResponseTrace } from '../src/types.js';

const { errorDetailDisclosure, pathTraversalRead } = INPUT_RULE_IDS;

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

/** The finding a leaking body produces, with a **clean control** — so nothing is subtracted and the
 *  label under test is the one that reaches `where.invariant`. */
function findingFor(payloadId: string, leakBody: string, ruleId: string): Finding {
  const leak = res({ status: 500, bodyText: leakBody });
  const o = bundle({ probes: [probe(payloadId, { kind: 'answered', status: 500 }, leak)] });
  const hits = runInputScan(o).findings.filter((f) => f.id === ruleId);
  assert.equal(hits.length, 1, `expected exactly one ${ruleId} finding for ${JSON.stringify(leakBody)}`);
  return hits[0]!;
}

// Every label the two detector families define, each with a body that leaks precisely that thing and
// nothing else. `injection/sql-quote` for the disclosure rows and `traversal/relative` for the
// filesystem ones: which payload was sent is irrelevant to which detector matches, and holding it
// fixed keeps each row about the detector.
//
// The bodies are written the way a real server serves them — the stack frame inside a JSON envelope,
// the passwd entry at the start of a line — because a detector written against a shape nobody serves
// is `M128`'s fired-for-nobody defect, and these samples are the only place that shape is pinned.
const DISCLOSURE_SAMPLES: ReadonlyArray<readonly [label: string, body: string]> = [
  ['a stack frame', '{"message":"Error: bad\\n    at OrderService.find (/usr/src/app/order.service.js:42:11)"}'],
  ['a stack trace header', 'Traceback (most recent call last):\n  File "app.py", line 3'],
  ['a SQL error fragment', '{"message":"syntax error at or near \\"tflw\\""}'],
  ['an ORM exception name', '{"name":"QueryFailedError","message":"could not execute"}'],
  ['an absolute source path', 'compilation failed in /app/dist/order.service.js:41'],
  ['a framework error page', '<html><body><h1>Whitelabel Error Page</h1></body></html>'],
];

const FILESYSTEM_SAMPLES: ReadonlyArray<readonly [label: string, body: string]> = [
  ['a Unix passwd entry', 'root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:'],
  ['a Unix shadow entry', 'root:$6$saltsalt$hashhash:19000:0:99999:7:::'],
  ['a private key header', '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXk'],
  ['a Windows ini section', '; for 16-bit app support\n[fonts]\n[extensions]'],
];

const ALL_SAMPLES = [
  ...DISCLOSURE_SAMPLES.map(([label, body]) => ({ label, body, payloadId: 'injection/sql-quote', ruleId: errorDetailDisclosure })),
  ...FILESYSTEM_SAMPLES.map(([label, body]) => ({ label, body, payloadId: 'traversal/relative', ruleId: pathTraversalRead })),
];

// --- the property the repro emitter rests on ---------------------------------------------------

for (const { label, body, payloadId, ruleId } of ALL_SAMPLES) {
  test(`${label}: the pattern matches the very evidence the rule fired on`, () => {
    // Direction 1 — the rule really does attribute this body to this label. Without this the row
    // could be testing a pattern against a body no rule would have reported.
    const finding = findingFor(payloadId, body, ruleId);
    assert.equal(finding.where?.invariant, label, 'the finding must carry the label this row indexes');

    // Direction 2 — and the pattern that label maps to matches it. This is the one that makes the
    // emitted repro RED on an unfixed application. `new RegExp(...).test(...)` is exactly what
    // `matcher.ts` does for `matches`, so this is the assertion the repro will run, run here.
    const pattern = DETECTOR_PATTERNS[label];
    assert.ok(pattern, `no pattern for ${label}`);
    assert.ok(new RegExp(pattern!).test(body), `pattern ${JSON.stringify(pattern)} did not match its own evidence`);
  });
}

test('every label a finding can carry has a pattern, and no pattern is orphaned', () => {
  // The completeness half. A label present in `inputRules.ts` but absent from the table above would
  // otherwise be an emitter that throws — or worse, omits the assertion — on a finding type that
  // fires in the field but never in this file.
  const tabled = new Set(ALL_SAMPLES.map((s) => s.label));
  const exported = new Set(Object.keys(DETECTOR_PATTERNS));

  const untested = [...exported].filter((l) => !tabled.has(l));
  assert.deepEqual(untested, [], 'a detector gained a label with no sample body here — add a row, do not delete this assertion');

  const orphaned = [...tabled].filter((l) => !exported.has(l));
  assert.deepEqual(orphaned, [], 'a sample body names a label no detector defines any more');
});

test('a label is unique across BOTH detector families', () => {
  // `DETECTOR_PATTERNS` refuses a duplicate at construction, so importing this module at all is most
  // of the proof. What this pins is the count: a silent `Object.fromEntries`-style collapse would keep
  // the last of a colliding pair and leave the map one entry short, giving one rule's finding the
  // other rule's pattern — a repro asserting the wrong leak, still green.
  assert.equal(Object.keys(DETECTOR_PATTERNS).length, ALL_SAMPLES.length);
});

test('every detector pattern is a valid regex on its own', () => {
  // The emitter writes these into a `.tflw` string and the runtime compiles them with `new RegExp`.
  // A pattern that only works as part of a larger expression would fail at *repro-run* time, in a
  // file whose whole purpose is to be handed to somebody else.
  for (const [label, pattern] of Object.entries(DETECTOR_PATTERNS)) {
    assert.doesNotThrow(() => new RegExp(pattern), `${label}'s pattern is not independently compilable`);
  }
});

test('a literal detector quotes its needles rather than letting them mean regex', () => {
  // `[fonts]` unquoted is a character class matching one of five letters, which would fire on very
  // nearly any prose — the exact opposite of these detectors' zero-false-positive bar, and invisible
  // because the *positive* row above would keep passing.
  const ini = DETECTOR_PATTERNS['a Windows ini section']!;
  assert.match(ini, /\\\[fonts\\\]/, 'the brackets must be escaped in the emitted pattern');
  assert.ok(!new RegExp(ini).test('a body mentioning notes, fonts and other things'), 'must not match prose containing those letters');
});
