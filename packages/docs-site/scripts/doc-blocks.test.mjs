// The block scanner and its taxonomy (M62, DT-01/DT-02).
//
// The predecessor's extractor was a single `^```(\w*)$` regex, and everything it failed to match
// vanished without being counted. These tests pin the cases that silence used to swallow.

import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, extractBlocks, parseInfoString } from './doc-blocks.mjs';

const one = (md) => {
  const blocks = extractBlocks(md);
  assert.equal(blocks.length, 1, 'expected exactly one block');
  return { ...blocks[0], ...classify(blocks[0]) };
};

test('an untagged fence is unclassified, not skipped — the whole point of DT-01', () => {
  const block = one('intro\n\n```\nopen "/checkout"\n```\n');
  assert.equal(block.kind, 'unclassified');
  assert.match(block.why, /untagged/);
  assert.equal(block.startLine, 3);
  assert.equal(block.source, 'open "/checkout"');
});

test('an unknown fence tag is unclassified — a new tag must be a decision, not a default', () => {
  assert.equal(one('```rust\nfn main() {}\n```\n').kind, 'unclassified');
});

test('a fence indented inside a list item is found (the old `^```` regex missed it)', () => {
  const block = one('- a step:\n\n  ```tflw fragment\n  open "/checkout"\n  ```\n');
  assert.equal(block.kind, 'fragment');
  assert.equal(block.source, 'open "/checkout"', 'the list indentation is stripped, not baked into the sample');
});

test('a four-backtick fence containing a three-backtick one is one block, not three', () => {
  const block = one('````text\n```tflw\nnot really a sample\n```\n````\n');
  assert.equal(block.kind, 'declared');
  assert.equal(block.source, '```tflw\nnot really a sample\n```');
});

test('an unterminated fence fails instead of silently swallowing the rest of the page', () => {
  const block = one('```tflw\ntest "x"\n');
  assert.equal(block.kind, 'unclassified');
  assert.match(block.why, /unterminated/);
});

test('directives parse: bare flags and comma lists', () => {
  assert.deepEqual(parseInfoString('tflw fragment binds=orderId,email'), {
    lang: 'tflw',
    directives: { fragment: true, binds: ['orderId', 'email'] },
  });
  assert.deepEqual(parseInfoString('tflw-config'), { lang: 'tflw-config', directives: {} });
});

test('a fragment with no `binds` still gets an empty list, never undefined', () => {
  assert.deepEqual(one('```tflw fragment\nopen "/x"\n```\n').binds, []);
});

test('`tflw` and `tflw fragment` are different kinds — the tag decides how a block is verified', () => {
  assert.equal(one('```tflw\ntest "x"\n```\n').kind, 'file');
  assert.equal(one('```tflw fragment\napi GET /x\n```\n').kind, 'fragment');
  assert.equal(one('```tflw-config\nenv e default\n```\n').kind, 'config');
  assert.equal(one('```tflw-config fragment\nrequire env A\n```\n').kind, 'config-fragment');
});

test('every block on a page comes back, in source order', () => {
  const blocks = extractBlocks('```sh\na\n```\n\ntext\n\n```tflw\nb\n```\n\n```\nc\n```\n');
  assert.deepEqual(
    blocks.map((b) => [b.lang, b.startLine]),
    [['sh', 1], ['tflw', 7], ['', 11]],
  );
});
