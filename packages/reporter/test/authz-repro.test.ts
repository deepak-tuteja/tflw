// D332 — the repro emitter. What these pin is not "a file was written" but the two properties that
// make a written file worth more than an evidence dump:
//
//   1. **The assertion is right for the rule.** D314's sketch always asserts `403`. That is correct
//      for an object leak and wrong for a collection leak, where the correct behaviour is a filtered
//      `200` — so one template would hand whoever fixes the bug a regression that goes red the
//      moment they succeed. The `expect all body.id not equals` form is, line for line, what
//      `authz.tflw` hand-writes, so the generator and the control converge on the same *spelling*.
//   2. **No body ever reaches the file.** An id is an identifier; a body is contents.
//      `PLAN_REPORTS_PERF_SECURITY.md` R10's prove-without-reproducing rule is that split.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderAuthzRepro, reproFileName, writeAuthzRepros, AUTHZ_REPRO_DIR } from '../src/authz-repro.js';
import type { AuthzFinding } from '@tflw/runtime';

const objectLeak: AuthzFinding = {
  rule: 'sec/authz-object-leak',
  principal: 'peer',
  method: 'GET',
  url: 'http://localhost:4001/orders/a1e3-9f',
  ids: ['a1e3-9f'],
  owners: ['shopper'],
};

const collectionLeak: AuthzFinding = { ...objectLeak, rule: 'sec/authz-collection-leak', url: 'http://localhost:4001/orders' };

test('an object leak emits `expect status equals 403`', () => {
  const src = renderAuthzRepro(objectLeak);
  assert.match(src, /test "peer must not read shopper's \/orders\/a1e3-9f" as peer/);
  assert.match(src, /api GET \/orders\/a1e3-9f/);
  assert.match(src, /expect status equals 403/);
});

test('a collection leak asserts on contents, never on status — the whole reason there are two templates', () => {
  // Control: if this ever becomes `expect status equals 403`, the emitted regression is red against
  // a correctly-fixed app, because a filtered `200` is the right answer for a non-owner here.
  const src = renderAuthzRepro(collectionLeak);
  assert.match(src, /expect all body\.id not equals "a1e3-9f"/);
  assert.doesNotMatch(src, /expect status/);
});

test('every repro names the rule that produced it and the principal it was served to', () => {
  for (const f of [objectLeak, collectionLeak]) {
    const src = renderAuthzRepro(f);
    assert.match(src, /^# emitted by tflw M130 — sec\/authz-/);
    assert.match(src, /served `shopper`'s resource to `peer`/);
  }
});

test('the emitted file runs as the *probing* principal, not as the owner', () => {
  // The finding is that `peer` could read it. A repro that ran as `shopper` would pass forever.
  assert.match(renderAuthzRepro(objectLeak), /as peer\n/);
  assert.doesNotMatch(renderAuthzRepro(objectLeak), /as shopper/);
});

test('the name is deterministic from rule + method + path + principal', () => {
  assert.equal(reproFileName(objectLeak), 'object-leak--get--orders-a1e3-9f--peer.tflw');
  assert.equal(reproFileName(collectionLeak), 'collection-leak--get--orders--peer.tflw');
});

test('two identical findings collide into one identical file rather than racing', () => {
  // The reason the name is derived rather than counted: under `--workers N` the same finding can
  // arrive twice, and two files differing only by a sequence number is not evidence of two bugs.
  assert.equal(reproFileName(objectLeak), reproFileName({ ...objectLeak }));
});

test('two principals leaking the same resource are two files, because that is the whole output', () => {
  const other = { ...objectLeak, principal: 'oauthLong' };
  assert.notEqual(reproFileName(objectLeak), reproFileName(other));
});

test('an unparseable URL still yields a named file rather than a silent skip', () => {
  const broken = { ...objectLeak, url: 'not a url' };
  assert.match(reproFileName(broken), /\.tflw$/);
  assert.match(renderAuthzRepro(broken), /api GET not a url/);
});

test('no finding writes no directory — an ordinary run\'s report dir is unchanged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tflw-repro-'));
  try {
    assert.deepEqual(await writeAuthzRepros([], dir), []);
    assert.equal(existsSync(join(dir, AUTHZ_REPRO_DIR)), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('findings are written one file each, in stable name order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tflw-repro-'));
  try {
    const written = await writeAuthzRepros([objectLeak, collectionLeak, { ...objectLeak }], dir);
    assert.equal(written.length, 2, 'the duplicate collapses into the same file');
    const names = readdirSync(join(dir, AUTHZ_REPRO_DIR)).sort();
    assert.deepEqual(names, ['collection-leak--get--orders--peer.tflw', 'object-leak--get--orders-a1e3-9f--peer.tflw']);
    assert.match(readFileSync(join(dir, AUTHZ_REPRO_DIR, names[1]!), 'utf8'), /expect status equals 403/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R10: a repro carries the leaked id and never a response body', async () => {
  // The finding type has no body field to leak — this asserts the *shape* stays that way, since the
  // cheapest future "improvement" here is to paste the response in for context.
  const src = renderAuthzRepro(objectLeak);
  assert.match(src, /a1e3-9f/);
  assert.doesNotMatch(src, /\{|\}/, 'a repro is four lines of tflw, not a transcript');
});
