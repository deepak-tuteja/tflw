// The search rule as a pure function (`M209` `S5`, `D1064`/`D1065`).
//
// It is here rather than only in the browser gate for `doors.test.ts`'s reason: the page gate runs
// against `fixtures/project`, whose tags happen to be well behaved, and the claim that separates
// the two kinds of query is arithmetic about a corpus. The numbers below are the sibling's own
// shape in miniature — a tag carried by fewer tests than the files carrying it hold — because that
// gap is the whole of `D1064` and a fixture without it cannot falsify anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lensesInRun, matchingFiles, parseQuery, projectTags, taggedTestCount } from '../src/search';
import type { ProjectView } from '../src/contract';

const file = (path: string, tests: Array<{ name: string; tags: string[] }>): ProjectView['files'][number] => ({
  path,
  // `M219` — the file's own `action` declarations, and whether each opens a page (`D1161`).
  // Empty here for the same reason `imports` is: neither fixture declares one.
  actions: [],
  // `M218` — a file's own `import`/`use` targets. Empty here: these two fixtures are about the
  // tree and the search, and neither has ever had a file importing another.
  imports: [],
  diagnostics: 0,
  errors: 0,
  warnings: 0,
  crawls: [],
  tests: tests.map((t, i) => ({ name: t.name, tags: t.tags, line: i + 1, workload: false, lenses: ['api'] as const, sessions: [], steps: { api: 1, browser: 0, load: 0, scan: 0 } })),
});

const project = (files: ProjectView['files']): ProjectView => ({
  configured: true,
  root: '/p',
  version: { version: '0.0.0-test', source: 'dev', commit: null, dirty: null, builtAt: null },
  envs: [],
  reportDir: './report',
  helpers: [],
  runFlags: [],
  files,
  traceViewer: false,
  scratchPath: '.scratch.tflw',
  scratchIgnored: true, playScratch: '.play.tflw', playIgnored: true,
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
  const r = parseQuery('@r', p);
  assert.deepEqual(r.kind === 'tag' ? r.tags : null, ['read']);
  // `--tag nope` is an error in the CLI, so a prefix nobody carries expands to nothing at all
  // rather than to the text somebody typed.
  const none = parseQuery('@zzz', p);
  assert.deepEqual(none.kind === 'tag' ? none.tags : null, []);
  assert.equal(matchingFiles(p, none)!.size, 0);
  // A bare `@` is every tag, which is what the completion list offers.
  const every = parseQuery('@', p);
  assert.deepEqual(every.kind === 'tag' ? every.tags : null, projectTags(p));
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

// ── `lensesInRun` — what the run this page is about to start would reach (`M229` `B`, `D1250`) ──
//
// **THE FIXTURE ABOVE CANNOT STATE THIS CLAIM**, because every test in it is `lenses: ['api']` —
// which is the vacuity `M228` `F` filed: a gate can be green because the page has nothing to read.
// So this half gets its own corpus, shaped exactly like the defect: a file per lens, so that a
// narrowing which crosses them is expressible at all.
const lensed = (path: string, tests: Array<{ name: string; tags: string[]; lenses: ProjectView['files'][number]['tests'][number]['lenses'] }>): ProjectView['files'][number] => ({
  ...file(path, tests.map((t) => ({ name: t.name, tags: t.tags }))),
  tests: tests.map((t, i) => ({ name: t.name, tags: t.tags, line: i + 1, workload: t.lenses.includes('load'), lenses: t.lenses, sessions: [], steps: { api: 1, browser: 0, load: 0, scan: 0 } })),
});

const mixed = project([
  lensed('tests/catalog.tflw', [{ name: 'the catalogue answers', tags: ['smoke'], lenses: ['api'] }]),
  lensed('tests/shop.tflw', [{ name: 'the shop greets', tags: ['ui'], lenses: ['browser'] }]),
  lensed('tests/load.tflw', [{ name: 'the catalogue holds', tags: ['perf'], lenses: ['api', 'load'] }]),
]);

test('with nothing narrowing it, the run reaches every lens the project holds', () => {
  assert.deepEqual([...lensesInRun(mixed, [], parseQuery('', mixed))].sort(), ['api', 'browser', 'load']);
});

test('a selection is what narrows the run, and it is not the door', () => {
  // **The case no door-keyed rule survives, and the reason `PLAN_M229_UI_REVIEW.md`'s `D1250` was
  // amended.** A reader standing behind the API door who selects the load file is about to run a
  // workload, so `--workers` is theirs — and the plan's `VOCABULARY.api.takesWorkers` would have
  // hidden it. The door does not appear in this function's arguments at all, which is the point.
  assert.deepEqual([...lensesInRun(mixed, ['tests/load.tflw'], parseQuery('', mixed))].sort(), ['api', 'load']);
  assert.deepEqual([...lensesInRun(mixed, ['tests/catalog.tflw'], parseQuery('', mixed))], ['api']);
  assert.deepEqual([...lensesInRun(mixed, ['tests/shop.tflw'], parseQuery('', mixed))], ['browser']);
  // And the two flags are not one flag: this narrowing bears a workload and drives no browser.
  const both = lensesInRun(mixed, ['tests/load.tflw', 'tests/shop.tflw'], parseQuery('', mixed));
  assert.equal(both.has('load') && both.has('browser'), true);
});

test('a tag query narrows by TEST, a text query by FILE — the same fork `D1064` draws the label with', () => {
  assert.deepEqual([...lensesInRun(mixed, [], parseQuery('@perf', mixed))].sort(), ['api', 'load']);
  assert.deepEqual([...lensesInRun(mixed, [], parseQuery('@ui', mixed))], ['browser']);
  assert.deepEqual([...lensesInRun(mixed, [], parseQuery('shop', mixed))], ['browser']);
  // A tag nothing carries reaches nothing — the state the button already refuses to be pressed in.
  assert.equal(lensesInRun(mixed, [], parseQuery('@nope', mixed)).size, 0);
});

test('a selection outranks a query, because that is the order the button’s own label resolves in', () => {
  // Two answers to *what is about to run* is the failure `RunStrip`'s header names; this asserts
  // the controls resolve it the same way the label does rather than in their own order.
  assert.deepEqual([...lensesInRun(mixed, ['tests/shop.tflw'], parseQuery('@perf', mixed))], ['browser']);
});
