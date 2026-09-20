// **Where a new request goes** — `M217` `B` (`D1138`).
//
// The decision this file gates is one sentence: *after* a request means after the request **and
// the statements attached to it**, never on the literal next line. It is worth its own pure test
// because it is the only place in the round where a wrong answer is silent — the file still
// parses, the run still goes green, and an assertion is simply reading a different response than
// the one it names.
//
// **The measurement that forced it.** `body` means the last response. Parsed over
// `examples/storefront`: 19 `api` steps, **19 of them with statements attached**, 49 attached
// statements of which **47 read the response**. There is no request in that project where the next
// line is a safe place to put another one — so a rule of *insert here, warn when it is unsafe*
// would have fired on every single case, which is a rule written the wrong way round.
//
// This is in `@tflw/ui` and not in the browser gate because `anchorAfter` is a function of an
// outline and nothing else. A browser can only show that the bytes came out right; this shows
// *why*, and it is the half that reddens when the walk is wrong rather than when the splice is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorAfter, fileOutline, type OutlineTest } from '../src/outline';

const outlineOf = (source: string): OutlineTest => {
  const decl = fileOutline('x.tflw', source).declarations[0];
  assert.ok(decl !== undefined && decl.kind === 'test', 'the fixture declares a test');
  return decl;
};

test('`M217`: the anchor is the request’s LAST attachment, not the request', () => {
  const decl = outlineOf([
    'test "a chain"',
    '  api POST /baskets',
    '  expect status equals 201',
    '  capture body.id as basketId',
    '  api POST /orders/checkout',
    '  expect status equals 201',
    '',
  ].join('\n'));

  const first = decl.body.requests[0]!;
  assert.equal(first.attached.length, 2, 'the fixture has readers to protect');
  // The anchor is the `capture`'s address and not the request's — which is the whole decision. A
  // step spliced at the request's own address would land above `expect status equals 201`, and
  // that `expect` would then be asserting about the new response.
  assert.deepEqual(anchorAfter(first), first.attached[1]!.stepPath);
  assert.notDeepEqual(anchorAfter(first), first.stepPath);
});

test('`M217`: a request with nothing attached anchors on itself', () => {
  const decl = outlineOf([
    'test "bare"',
    '  api GET /a',
    '  api GET /b',
    '  expect status equals 200',
    '',
  ].join('\n'));
  const bare = decl.body.requests[0]!;
  assert.equal(bare.attached.length, 0);
  assert.deepEqual(anchorAfter(bare), bare.stepPath, 'with no attachments there is nothing to go after but the request');
});

test('`M217`: the last request anchors on its own last attachment, which is the end of the body', () => {
  // The claim that makes `+` on the last row and the foot's `+ request` the same edit. If these
  // two addresses ever disagree the two controls produce different files, which is what the
  // browser gate `B3` asserts from the other end.
  const decl = outlineOf([
    'test "tail"',
    '  api GET /a',
    '  expect status equals 200',
    '  api GET /b',
    '  expect status equals 200',
    '  expect body.ok equals true',
    '',
  ].join('\n'));
  const last = decl.body.requests.at(-1)!;
  assert.deepEqual(anchorAfter(last), last.attached.at(-1)!.stepPath);
});

test('`M217`: a row that no index pair can name is skipped, and the request is the fallback', () => {
  // **The filter is load-bearing, not defensive.** The `expect`s nested inside a `wait until api`
  // block are not steps of the body, so `outline.ts` gives them a null `stepPath` — handing one to
  // `insertIntoSource` would be an undefined address. Measured here rather than asserted in a
  // comment, because this is the branch a reader would delete as dead.
  const decl = outlineOf([
    'test "polling"',
    '  wait until api GET /jobs/1',
    '    expect body.state equals "done"',
    '',
  ].join('\n'));
  const poll = decl.body.requests[0]!;
  assert.ok(poll.attached.every((a) => a.stepPath === null), 'every attachment here is unaddressable');
  assert.deepEqual(anchorAfter(poll), poll.stepPath, 'so the anchor falls back to the request');
});
