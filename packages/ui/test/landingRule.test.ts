// Where a door lands (`M240` `A`, `D1290`, `M239-09`) — the pure half, asked every shape here so
// the page gate only has to show that `App` calls it. Each case names the answer the old rule
// (`files[0]`, `declarations[0]`) would have given, so a regression to it is red by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { behindDoor, landingDecl, landingFor, landingKey, landingKeys, projectHash } from '../src/landingRule';
import { fileOutline } from '../src/outline';
import type { ProjectView } from '../src/contract';

const project = (files: ProjectView['files']): ProjectView => ({ root: '/p', version: { version: '0.0.0-test', source: 'dev', commit: null, dirty: null, builtAt: null }, envs: [], reportDir: './report', helpers: [], files, traceViewer: false, scratchPath: '.scratch.tflw', scratchIgnored: true, playScratch: '.play.tflw', playIgnored: true, scratchEtag: null, authorization: { envName: 'local', targets: [], apiBaseUrl: null, services: [], sessions: [] }, webBaseUrl: null });

const file = (path: string, tests: Array<readonly string[]>, crawls: Array<readonly string[]> = [], errors = 0): ProjectView['files'][number] => ({
  path,
  actions: [],
  imports: [],
  diagnostics: errors,
  errors,
  warnings: 0,
  tests: tests.map((lenses, i) => ({
    name: `${path}-t${i}`,
    tags: [],
    line: i + 1,
    workload: lenses.includes('load'),
    lenses: lenses as never,
    sessions: [],
    steps: { api: lenses.includes('api') ? 1 : 0, browser: lenses.includes('browser') ? 1 : 0, load: 0, scan: lenses.includes('scan') ? 1 : 0 },
  })),
  crawls: crawls.map((lenses, i) => ({ name: `${path}-c${i}`, line: 100 + i, lenses: lenses as never, sessions: [] })),
});

test('a door lands on the file with the most tests behind it, never on the first path', () => {
  const p = project([
    file('tests/actions/aaa.tflw', []), // sorts first, holds nothing — the dogfood's `_auth.tflw`
    file('tests/browser.tflw', [['browser'], ['browser'], ['browser']]),
    file('tests/mixed.tflw', [['api', 'browser'], ['api']]),
    file('tests/orders.tflw', [['api'], ['api'], ['api']]),
  ]);
  assert.deepEqual(landingFor('api', p, null), { path: 'tests/orders.tflw' }, 'three api tests beat two');
  assert.deepEqual(landingFor('browser', p, null), { path: 'tests/browser.tflw' }, 'three browser tests beat one');
  assert.notEqual(landingFor('api', p, null).path, 'tests/actions/aaa.tflw', 'the old rule’s answer');
});

test('a tie breaks by path, so the landing is stable across reloads', () => {
  const p = project([
    file('tests/z.tflw', [['api'], ['api']]),
    file('tests/a.tflw', [['api'], ['api']]),
  ].sort((x, y) => (x.path < y.path ? -1 : 1)));
  assert.deepEqual(landingFor('api', p, null), { path: 'tests/a.tflw' });
  // The mutation this reddens on: `>=` in place of `>` lands on the LAST of the tied files.
  const reversed = project([file('tests/b.tflw', [['api']]), file('tests/c.tflw', [['api']])]);
  assert.deepEqual(landingFor('api', reversed, null), { path: 'tests/b.tflw' });
});

test('a remembered file wins while it exists, and falls through when it is gone', () => {
  const p = project([file('tests/a.tflw', [['api'], ['api']]), file('tests/b.tflw', [['api']])]);
  assert.deepEqual(landingFor('api', p, 'tests/b.tflw'), { path: 'tests/b.tflw' }, 'the reader was on b last time');
  assert.deepEqual(landingFor('api', p, 'tests/renamed.tflw'), { path: 'tests/a.tflw' }, 'a memory of a file the project lacks is not a landing');
  assert.deepEqual(landingFor('api', p, null), { path: 'tests/a.tflw' });
});

test('a door with nothing behind it is empty, not the first file', () => {
  const p = project([file('tests/actions/aaa.tflw', []), file('tests/api.tflw', [['api'], ['api']])]);
  assert.deepEqual(landingFor('browser', p, null), { empty: true });
  assert.deepEqual(landingFor('load', p, null), { empty: true });
  assert.deepEqual(landingFor('browser', project([]), null), { empty: true }, 'and so is a project with no files');
  // A remembered file cannot make an empty door land: the reader opened it under this door once,
  // and it is still where they were, so it is the one memory an empty door honours.
  assert.deepEqual(landingFor('browser', p, 'tests/api.tflw'), { path: 'tests/api.tflw' });
});

test('a crawl counts for the door it is behind, and a file that did not parse counts for nothing', () => {
  const p = project([
    file('tests/one-scan-test.tflw', [['api', 'scan']]),
    file('tests/crawls.tflw', [], [['scan'], ['scan']]),
  ]);
  assert.equal(behindDoor(p.files[1]!, 'scan'), 2);
  assert.deepEqual(landingFor('scan', p, null), { path: 'tests/crawls.tflw' }, 'two crawls beat one scan-bearing test');
  const broken = project([file('tests/salvaged.tflw', [['api'], ['api'], ['api']], [], 1), file('tests/whole.tflw', [['api']])]);
  assert.equal(behindDoor(broken.files[0]!, 'api'), 0, 'a salvaged test list is not the project’s');
  assert.deepEqual(landingFor('api', broken, null), { path: 'tests/whole.tflw' });
});

test('the landing declaration is the first test, past any hook — and a file of hooks alone lands on its hook', () => {
  const hookFirst = fileOutline('h.tflw', 'before\n  api GET /a\n  expect status equals 200\n\ntest "one"\n  api GET /b\n  expect status equals 200\n\ntest "two"\n  api GET /c\n  expect status equals 200\n');
  const landed = landingDecl(hookFirst);
  assert.ok(landed && landed.kind === 'test' && landed.name === 'one', `landed on ${landed?.kind} — declarations[0] is the hook`);
  const hooksOnly = fileOutline('h.tflw', 'before\n  api GET /a\n  expect status equals 200\n\nafter file\n  api GET /z\n  expect status equals 200\n');
  const hook = landingDecl(hooksOnly);
  assert.ok(hook && hook.kind === 'hook' && hook.when === 'before', 'nothing better to land on, so the first hook');
  const crawlFirst = fileOutline('s.tflw', 'crawl "the site"\n  seed openapi "/openapi.json"\n');
  assert.equal(landingDecl(crawlFirst)?.kind, 'crawl', 'a file with no test lands on its crawl');
  assert.equal(landingDecl(fileOutline('e.tflw', '')), null);
});

test('the memory key names the project by an eight-hex hash of its root, one key per door', () => {
  const a = projectHash('/srv/shop');
  const b = projectHash('/srv/shop2');
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.notEqual(a, b, 'two roots, two namespaces');
  assert.equal(projectHash('/srv/shop'), a, 'and the same root hashes the same on every visit');
  assert.equal(landingKey(a, 'api'), `tflw.ui.${a}.lastFile.api`);
  assert.deepEqual(landingKeys(a), ['api', 'browser', 'load', 'scan'].map((d) => `tflw.ui.${a}.lastFile.${d}`));
});
