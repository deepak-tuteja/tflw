// The search rule as a pure function (`M209` `S5`, `D1064`/`D1065`).
//
// It is here rather than only in the browser gate for `doors.test.ts`'s reason: the page gate runs
// against `fixtures/project`, whose tags happen to be well behaved, and the claim that separates
// the two kinds of query is arithmetic about a corpus. The numbers below are the sibling's own
// shape in miniature — a tag carried by fewer tests than the files carrying it hold — because that
// gap is the whole of `D1064` and a fixture without it cannot falsify anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchingFiles, parseQuery, projectTags, taggedTestCount } from '../src/search';
import type { ProjectView } from '../src/contract';

const file = (path: string, tests: Array<{ name: string; tags: string[] }>): ProjectView['files'][number] => ({
  path,
  diagnostics: 0,
  crawls: [],
  tests: tests.map((t, i) => ({ name: t.name, tags: t.tags, line: i + 1, workload: false, lenses: ['api'] as const, sessions: [] })),
});

const project = (files: ProjectView['files']): ProjectView => ({
  root: '/p',
  envs: [],
  reportDir: './report',
  files,
  traceViewer: false,
  scratchPath: '.scratch.tflw',
  scratchIgnored: true,
  scratchEtag: null,
  authorization: { envName: 'local', targets: [], apiBaseUrl: null, services: [], sessions: [] },
  webBaseUrl: null,
});

/** Two files, three tests, one tag on two of them — `@crud` against 16 files holding 97 tests, at
 *  the scale a test can read. */
const p = project([
  file('tests/orders.tflw', [
    { name: 'a order is placed', tags: ['crud', 'smoke'] },
    { name: 'an order is read', tags: ['read'] },
  ]),
  file('tests/catalog.tflw', [{ name: 'the catalogue answers', tags: ['crud'] }]),
  file('shared/root.tflw', []),
]);

test('an empty query narrows nothing, which is not the same as matching nothing', () => {
  assert.deepEqual(parseQuery('', p), { kind: 'none' });
  assert.equal(matchingFiles(p, parseQuery('  ', p)), null);
});

test('a tag query runs the TESTS carrying the tag, not the tests in the files carrying it', () => {
  const q = parseQuery('@crud', p);
  assert.deepEqual(q, { kind: 'tag', typed: '@crud', tags: ['crud'] });
  // Two files light up, and those two files hold three tests between them.
  assert.deepEqual([...matchingFiles(p, q)!].sort(), ['tests/catalog.tflw', 'tests/orders.tflw']);
  assert.equal(taggedTestCount(p, q), 2);
  const inThoseFiles = p.files.filter((f) => matchingFiles(p, q)!.has(f.path)).reduce((n, f) => n + f.tests.length, 0);
  assert.equal(inThoseFiles, 3, 'running the files whole would run one test nobody asked for');
});

test('a tag query matches by prefix and expands only to tags the project has', () => {
  assert.deepEqual(parseQuery('@r', p).kind === 'tag' ? parseQuery('@r', p).tags : null, ['read']);
  // `--tag nope` is an error in the CLI, so a prefix nobody carries expands to nothing at all
  // rather than to the text somebody typed.
  const none = parseQuery('@zzz', p);
  assert.deepEqual(none.kind === 'tag' ? none.tags : null, []);
  assert.equal(matchingFiles(p, none)!.size, 0);
  // A bare `@` is every tag, which is what the completion list offers.
  assert.deepEqual(parseQuery('@', p).kind === 'tag' ? parseQuery('@', p).tags : null, projectTags(p));
});

test('a text query matches a path or a test name, case-insensitively, and never a tag', () => {
  assert.deepEqual([...matchingFiles(p, parseQuery('catalog', p))!].sort(), ['tests/catalog.tflw'], 'the path and the name agree here');
  assert.deepEqual([...matchingFiles(p, parseQuery('CATALOGUE', p))!], ['tests/catalog.tflw']);
  assert.deepEqual([...matchingFiles(p, parseQuery('order', p))!], ['tests/orders.tflw']);
  // `crud` is a tag and not a name: a text query does not reach it, which is why `@` is a fork and
  // not a convenience.
  assert.deepEqual([...matchingFiles(p, parseQuery('crud', p))!], []);
  assert.equal(taggedTestCount(p, parseQuery('crud', p)), 0);
});

test('a fragment file is never a match, and is never hidden for it', () => {
  // It declares nothing, so nothing in it can match a name or a tag — the tree dims it like any
  // other unmatched row, and `D1068`'s `—` is still what its count says.
  assert.equal(matchingFiles(p, parseQuery('@crud', p))!.has('shared/root.tflw'), false);
  assert.equal(matchingFiles(p, parseQuery('root', p))!.has('shared/root.tflw'), true, 'but its own path still matches');
});
