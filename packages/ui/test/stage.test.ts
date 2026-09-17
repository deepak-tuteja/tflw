// `M208` `S3` — what `[accept]` stages into a baseline document (`Q1`, `D387`).
//
// A pure function, tested here rather than only through the page, for `doors.test.ts`' reason: the
// browser gate can show that a fingerprint arrived and that nothing was written, and it cannot
// cheaply show what happens to a document with a trailing key, or with an entry already present,
// or with bytes that are not JSON at all. Those are the cases where a feature whose every failure
// mode makes a build **greener** can go quietly wrong.
//
// Every test states its negative control (`M92d`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageFingerprint } from '../src/baseline';

const FINDING = { fingerprint: 'a3f19c2e5b04d871', rule: 'sec/csp-missing', endpoint: 'GET /' };
const EMPTY = '{\n  "version": 1,\n  "accepted": []\n}\n';
const ONE = `{
  "version": 1,
  "accepted": [
    {
      "fingerprint": "d1a3ef65f88fb550",
      "rule": "sec/error-detail-disclosure",
      "endpoint": "GET /orders/{id}"
    }
  ]
}
`;

const parsed = (text: string) => JSON.parse(text) as { version: number; accepted: { fingerprint: string; rule: string; endpoint: string }[] };

test('an empty document gains the entry, and the line is the fingerprint the reader was sent to see', () => {
  const { text, line } = stageFingerprint(EMPTY, FINDING);
  assert.deepEqual(parsed(text), { version: 1, accepted: [{ fingerprint: FINDING.fingerprint, rule: FINDING.rule, endpoint: FINDING.endpoint }] });
  assert.match(text.split('\n')[line - 1] ?? '', /"fingerprint": "a3f19c2e5b04d871"/, 'the address must land on the entry, not near it');
  // Control: the input really was empty, so "gains" is a change and not a restatement.
  assert.deepEqual(parsed(EMPTY).accepted, []);
});

test('a document that already has entries keeps them, and the new one is last', () => {
  const { text } = stageFingerprint(ONE, FINDING);
  assert.deepEqual(parsed(text).accepted.map((a) => a.fingerprint), ['d1a3ef65f88fb550', FINDING.fingerprint]);
  // The `rule` and `endpoint` of the entry that was already there are untouched — this is somebody
  // else's accepted finding and a splice must not rewrite it.
  assert.deepEqual(parsed(text).accepted[0], parsed(ONE).accepted[0]);
});

test('accepting the same finding twice adds nothing, and still points at it', () => {
  // The entry is matched on the fingerprint alone, exactly as the gate matches it. A second
  // `[accept]` is an author checking what they already did, and a duplicate would be two lines
  // meaning one thing in a file people review.
  const once = stageFingerprint(EMPTY, FINDING);
  const twice = stageFingerprint(once.text, FINDING);
  assert.equal(twice.text, once.text, 'the document must not grow');
  assert.equal(twice.line, once.line, 'and it still opens on the entry that is there');
});

test('a document it cannot read comes back UNCHANGED rather than repaired', () => {
  // The honest failure for a feature whose only hazard is silently accepting something. An author
  // looking at the document is in a better position than any repair this function could invent —
  // and a repaired document would be a write the author never made.
  for (const broken of ['not json at all', '[]', '{"version": 1}', '{"version": 1, "accepted": {}}', '']) {
    const { text } = stageFingerprint(broken, FINDING);
    assert.equal(text, broken, `\`${broken}\` was rewritten`);
  }
  // Control: the same call against a readable document does change it, so the five above are a
  // refusal and not a function that never writes anything.
  assert.notEqual(stageFingerprint(EMPTY, FINDING).text, EMPTY);
});

test('a finding with no fingerprint stages nothing', () => {
  // It cannot be accepted at all — a baseline entry with no fingerprint matches nothing, which is
  // the one way this feature could make a build greener than the evidence. The button is not
  // rendered for one either; this is the second door on the same refusal.
  const { text } = stageFingerprint(EMPTY, { rule: 'sec/x', endpoint: 'GET /' });
  assert.equal(text, EMPTY);
});

test('the author’s own formatting survives, because this is a splice and not a re-serialisation', () => {
  // `ConfigPanel`'s argument for being a textarea, applied one level in: this is a file people read
  // in a review, and `JSON.parse` → mutate → `JSON.stringify` would silently reorder and reflow
  // everything they had. Four-space indentation and a key order that is not `--baseline-write`'s
  // are both things an author may have chosen.
  const custom = '{\n    "accepted": [\n        {\n            "endpoint": "GET /x",\n            "fingerprint": "beefbeefbeefbeef",\n            "rule": "sec/y"\n        }\n    ],\n    "version": 1\n}\n';
  const { text } = stageFingerprint(custom, FINDING);
  assert.ok(text.includes('            "endpoint": "GET /x",'), 'the existing entry was reformatted');
  assert.ok(text.indexOf('"accepted"') < text.indexOf('"version"'), 'the keys were reordered');
  assert.deepEqual(parsed(text).accepted.map((a) => a.fingerprint), ['beefbeefbeefbeef', FINDING.fingerprint]);
});
