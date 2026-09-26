// `M241` `B`/`C` (`D1322`, `D1323`) — the page's half of *an action and a crawl have addresses*: the
// outline counts each kind in its own space, every path it hands out says which, and every key the
// pane holds an edit under carries the space so two declarations at index 0 never share one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendInto, fileOutline, resolveImport, spaceOfDecl, type OutlineAction, type OutlineCrawl, type OutlineTest } from '../src/outline';
import { crawlEditOf, declKey, rowKey, stepKey } from '../src/parts.tsx';

const FILE = [
  'action warm()',
  '  api GET /warm',
  '  expect status equals 200',
  '',
  'crawl "walk" as shopper',
  '  seed spider "/"',
  '    max depth 2',
  '  seed openapi "/openapi.json"',
  '  exclude "/admin/**"',
  '  expect response has no serious security violations',
  '',
  'test "t"',
  '  api GET /t',
  '  expect status equals 200',
  '',
].join('\n');

const outline = fileOutline('x.tflw', FILE);
const kinds = (k: string) => outline.declarations.filter((d) => d.kind === k);
const action = kinds('action')[0] as OutlineAction;
const crawl = kinds('crawl')[0] as OutlineCrawl;
const testDecl = kinds('test')[0] as OutlineTest;

test('each kind is index 0 in its own space, and its statements carry that space', () => {
  assert.deepEqual(outline.declarations.map((d) => d.kind), ['action', 'crawl', 'test'], 'drawn in line order');
  assert.equal(action.index, 0);
  assert.equal(crawl.index, 0);
  assert.equal(testDecl.index, 0);
  assert.deepEqual(action.body.requests[0]!.stepPath, { decl: 0, step: 0, space: 'action' });
  assert.deepEqual(testDecl.body.requests[0]!.stepPath, { decl: 0, step: 0 }, 'the default space writes no `space` at all');
  const crawlRows = crawl.body.preamble;
  assert.ok(crawlRows.length > 0 && crawlRows.every((s) => s.stepPath?.space === 'crawl'), 'a crawl statement has a real address now');
  assert.deepEqual([spaceOfDecl(action), spaceOfDecl(crawl), spaceOfDecl(testDecl)], ['action', 'crawl', undefined]);
});

test('keys carry the space, so index 0 in three spaces is three keys', () => {
  assert.deepEqual([declKey(action), declKey(crawl), declKey(testDecl)], ['action:0', 'crawl:0', 'decl:0']);
  assert.equal(stepKey({ decl: 0, step: 1 }), '0:1', 'the default space keeps the key every earlier round wrote');
  assert.equal(stepKey({ decl: 0, step: 1, space: 'action' }), 'action:0:1');
  assert.equal(stepKey(null), null);
  assert.equal(rowKey({ stepPath: { decl: 0, step: 1, space: 'crawl' }, inner: 2 }), 'crawl:0:1#2');
});

test('a statement is appended to a test by its name and to an action or a crawl by its address', () => {
  const node = testDecl.node.body[0]!;
  assert.deepEqual(appendInto(testDecl, [node]), { kind: 'steps', testName: 't', nodes: [node] });
  assert.deepEqual(appendInto(action, [node]), { kind: 'stepsAtEnd', decl: 0, space: 'action', nodes: [node] });
  assert.deepEqual(appendInto(crawl, [node]), { kind: 'stepsAtEnd', decl: 0, space: 'crawl', nodes: [node] });
});

test('a crawl\'s band starts from what the file says, every seed kind spelled as typed text', () => {
  assert.deepEqual(crawlEditOf(crawl), {
    name: 'walk',
    tags: '',
    sessions: 'shopper',
    seeds: [
      { kind: 'spider', target: '/', service: '', depth: '2', pages: '' },
      { kind: 'openapi', target: '/openapi.json', service: '', depth: '', pages: '' },
    ],
    excludes: ['/admin/**'],
  });
});

test('an import resolves from the importing file\'s own directory, and refuses to climb out', () => {
  assert.equal(resolveImport('tests/a.tflw', './lib/auth.tflw'), 'tests/lib/auth.tflw');
  assert.equal(resolveImport('tests/api/a.tflw', '../shared/x.tflw'), 'tests/shared/x.tflw');
  assert.equal(resolveImport('a.tflw', 'lib/./x.tflw'), 'lib/x.tflw');
  assert.equal(resolveImport('a.tflw', '../outside.tflw'), null);
});
