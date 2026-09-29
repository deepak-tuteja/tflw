// `M214` `A4` (`D1117`) — what holds what: a removal is refused while a line below still reads a
// name the removed lines bind, the refusal names that line, and removing a request takes what is
// attached to it. Written in `M241` `E`, which found the module read by the page and by no unit test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindsName, holds, lineOfStep, moveOf, moveUnits, orderedOf, readsNames, requestRemoval, statementRemoval } from '../src/depends';
import { fileOutline, type OutlineTest } from '../src/outline';

const FILE = [
  'test "t"',
  '  let who = "ada"',
  '  api POST /orders body { name: "{who}" }',
  '  capture body.id as orderId',
  '  api GET /orders/{orderId}',
  '  expect status equals 200',
  '',
].join('\n');

const t = fileOutline('x.tflw', FILE).declarations[0] as OutlineTest;
const [post, get] = t.body.requests;
const letRow = t.body.preamble[0]!;
const capture = post!.attached.find((s) => s.node.type === 'CaptureStmt')!;

test('a `let` and a `capture` bind their name, and a read is any `{name}` the print carries', () => {
  assert.equal(bindsName(letRow.node), 'who');
  assert.equal(bindsName(capture.node), 'orderId');
  assert.equal(bindsName(get!.node), null);
  assert.deepEqual([...readsNames(get!.node)], ['orderId']);
  assert.deepEqual([...readsNames(letRow.node)], [], 'a string literal with no braces reads nothing');
});

test('the body is one list in line order, requests and their attachments interleaved', () => {
  const lines = orderedOf(t.body).map((r) => r.line);
  assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
  assert.equal(lines.length, 1 + t.body.requests.reduce((n, r) => n + 1 + r.attached.length, 0));
});

test('a binding still read below is held, and the refusal names the line reading it', () => {
  const held = holds(t.body, [capture.line]);
  assert.equal(held?.name, 'orderId');
  assert.equal(held?.line, get!.line);
  assert.match(held?.text ?? '', /\/orders\/\{orderId\}/);
});

test('a line that binds nothing, or whose binding goes with it, is free to remove', () => {
  assert.equal(holds(t.body, [get!.line]), null, 'the GET binds nothing');
  const whole = requestRemoval(post!);
  const withReader = holds(t.body, [...whole.lines, get!.line, ...get!.attached.map((s) => s.line)]);
  assert.equal(withReader, null, 'removing the reader along with the binder is not a dependency');
});

test('removing a request takes its attachments; a statement removes itself alone', () => {
  const r = requestRemoval(post!);
  assert.deepEqual(r.lines, [post!.line, ...post!.attached.map((s) => s.line)]);
  assert.equal(r.steps.length, r.lines.length);
  assert.deepEqual(statementRemoval(capture), { lines: [capture.line], steps: [capture.stepPath!.step] });
});

test('`M250` `G13` (`D1391`): the rows a move trades are the rows the sequence draws, and the ends offer nothing', () => {
  const text = [
    'test "t"',
    '  let who = "a"',
    '  log "before"',
    '  api GET /a',
    '  expect status equals 200',
    '  log "under the request"',
    '  api GET /b',
    '',
  ].join('\n');
  const body = (fileOutline('m.tflw', text).declarations[0] as OutlineTest).body;
  // A request carries every statement under it until the next request; a lone statement is its own row.
  const units = moveUnits(body);
  assert.deepEqual(units.map((u) => [...u]), [[0], [1], [2, 3, 4], [5]]);
  assert.equal(moveOf(units, 0, -1), null, 'the first row has no up');
  assert.equal(moveOf(units, 5, 1), null, 'the last row has no down');
  assert.deepEqual(moveOf(units, 5, -1), { steps: [5], over: [2, 3, 4] }, 'a row passes the whole request above it');
  // A statement under a request heads no body row, so it offers no body move of its own.
  assert.equal(moveOf(units, 3, -1), null);
  assert.equal(lineOfStep(body, 5), 7);
  assert.equal(lineOfStep(body, 4), 6);
});
