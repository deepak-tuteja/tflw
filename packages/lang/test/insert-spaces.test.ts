// `M241` `B`/`C` (`D1322`, `D1323`) — an action and a crawl are declarations with an address.
//
// `StepPath` indexed `[...hooks, ...tests]` until this milestone, so the page could draw an action's
// body and a crawl's statements and could edit neither (`M228` `C`, `D1238`, gave the crawl rows a
// null path on purpose). A path now names its space. What these tests hold still is the one hazard
// `D1238` refused over: **an address in one space must never reach a declaration in another**, so
// the fixture puts an action, a crawl and a test at the same index 0 and asks each edit where it
// landed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAction, buildCrawl, declarationsIn, format, insertIntoSource, parseSource, replaceInSource, type ActionDecl, type CrawlDecl } from '../src/index.js';

const FILE = [
  '# the file header',
  '',
  'action sign in(email, password)',
  '  # why the action posts twice',
  '  api POST /login body { email: "{email}", password: "{password}" }',
  '  expect status equals 200',
  '',
  '@scan',
  'crawl "the storefront" as shopper',
  '  seed traffic',
  '  exclude "/admin/**"',
  '  # the one assertion a crawl needs',
  '  expect response has no serious security violations',
  '',
  'test "a test at index zero"',
  '  api GET /health',
  '  expect status equals 200',
  '',
].join('\n');

const settled = (text: string): string => {
  const f = format(text);
  assert.ok(f.ok, 'the fixture formats');
  return f.formatted;
};

/** One statement, as the parser reads it — the node a form would build. */
const stepOf = (source: string) => {
  const { program } = parseSource(`test "t"\n  ${source}\n`);
  const step = program.tests[0]?.body[0];
  assert.ok(step, `\`${source}\` parses as a statement`);
  return step;
};
const expectStatus = (n: number) => stepOf(`expect status equals ${n}`);

test('each space counts its own declarations, in file order, and the default space is unchanged', () => {
  const { program } = parseSource(settled(FILE));
  assert.deepEqual(declarationsIn(program, 'action').map((d) => (d as ActionDecl).name), ['sign in']);
  assert.deepEqual(declarationsIn(program, 'crawl').map((d) => (d as CrawlDecl).name.value), ['the storefront']);
  assert.deepEqual(declarationsIn(program).map((d) => d.type), ['TestDecl'], 'hooks and tests only, as before this milestone');
});

test('one index, three spaces: a step replaced at {decl 0, step 1} lands in the declaration its space names', () => {
  const text = settled(FILE);
  const node = expectStatus(201);
  const inAction = replaceInSource(text, { kind: 'step', path: { decl: 0, step: 1, space: 'action' }, node });
  const inTest = replaceInSource(text, { kind: 'step', path: { decl: 0, step: 1 }, node });
  assert.ok(inAction.ok && inTest.ok);
  const changed = (after: string): number[] =>
    after.split('\n').flatMap((line, i) => (line === text.split('\n')[i] ? [] : [i + 1]));
  assert.deepEqual(changed(inAction.text), [6], 'the action\'s second statement, and nothing else');
  assert.deepEqual(changed(inTest.text), [17], 'the test\'s — the path with no space still means what it always meant');
  // The crawl's one statement is its step 0; step 1 does not exist there, and saying so is the
  // refusal rather than a landing somewhere else.
  const inCrawl = replaceInSource(text, { kind: 'step', path: { decl: 0, step: 1, space: 'crawl' }, node });
  assert.equal(inCrawl.ok, false);
});

test('a crawl statement is editable, and its note stays with it', () => {
  const text = settled(FILE);
  const node = stepOf('expect response has no critical security violations');
  const out = replaceInSource(text, { kind: 'step', path: { decl: 0, step: 0, space: 'crawl' }, node });
  assert.ok(out.ok, out.ok ? '' : out.reason);
  assert.match(out.text, /# the one assertion a crawl needs\n {2}expect response has no critical security violations/);
});

test('steps are inserted beside a statement in an action and removed from a crawl', () => {
  const text = settled(FILE);
  const step = stepOf('api GET /me');
  const added = insertIntoSource(text, { kind: 'stepsAfter', path: { decl: 0, step: 1, space: 'action' }, nodes: [step] });
  assert.ok(added.ok, added.ok ? '' : added.reason);
  assert.match(added.text, /expect status equals 200\n {2}api GET \/me\n\n@scan/, 'under the action\'s last statement, inside the action');

  const removed = replaceInSource(text, { kind: 'remove', decl: 0, steps: [0], space: 'crawl' });
  // A crawl whose only assertion is gone still parses — its seed is what the grammar needs.
  assert.ok(removed.ok, removed.ok ? '' : removed.reason);
  assert.doesNotMatch(removed.text, /no serious security violations/);
  assert.doesNotMatch(removed.text, /the one assertion a crawl needs/, 'a note goes with the statement it explains');
  assert.match(removed.text, /test "a test at index zero"\n {2}api GET \/health/, 'and the test is untouched');
});

test('an action header renames and re-parameters, keeping its body and its body\'s note', () => {
  const text = settled(FILE);
  const built = buildAction({ name: 'log in', params: ['email', 'password', 'otp'], body: parseSource(text).program.actions[0]!.body });
  assert.ok(built.ok, built.ok ? '' : built.reason);
  const out = replaceInSource(text, { kind: 'header', decl: 0, node: built.node, space: 'action' });
  assert.ok(out.ok, out.ok ? '' : out.reason);
  assert.match(out.text, /^action log in\(email, password, otp\)\n {2}# why the action posts twice\n {2}api POST \/login/m);
  assert.equal(out.text.split('\n').length, text.split('\n').length, 'one line for one line');
  // A header node of another kind is refused rather than spliced over the wrong declaration.
  const wrong = replaceInSource(text, { kind: 'header', decl: 0, node: built.node });
  assert.equal(wrong.ok, false);
});

test('a crawl header rewrites its principals, seeds and excludes, and leaves its statements alone', () => {
  const text = settled(FILE);
  const body = parseSource(text).program.crawls![0]!.body;
  const built = buildCrawl({
    name: 'the storefront',
    tags: ['scan'],
    sessions: ['shopper', 'peer'],
    seeds: [{ kind: 'spider', root: '/', maxDepth: 2 }],
    excludes: [],
    body,
  });
  assert.ok(built.ok, built.ok ? '' : built.reason);
  const out = replaceInSource(text, { kind: 'header', decl: 0, node: built.node, space: 'crawl' });
  assert.ok(out.ok, out.ok ? '' : out.reason);
  assert.match(out.text, /@scan\ncrawl "the storefront" as shopper, peer\n {2}seed spider "\/"\n {4}max depth 2\n {2}# the one assertion a crawl needs\n {2}expect response/);
  assert.doesNotMatch(out.text, /seed traffic|exclude/);
});

test('a new action and a new crawl append as whole declarations, and the file still parses', () => {
  const text = settled(FILE);
  const body = [expectStatus(200)];
  const action = buildAction({ name: 'check out', params: [], body });
  const crawl = buildCrawl({ name: 'walked as nobody', tags: [], sessions: [], seeds: [{ kind: 'traffic' }], excludes: [], body: [] });
  assert.ok(action.ok && crawl.ok);
  const a = insertIntoSource(text, { kind: 'action', node: action.node });
  assert.ok(a.ok, a.ok ? '' : a.reason);
  assert.match(a.text, /\n\naction check out\(\)\n {2}expect status equals 200\n$/);
  const c = insertIntoSource(a.text, { kind: 'crawl', node: crawl.node });
  assert.ok(c.ok, c.ok ? '' : c.reason);
  assert.match(c.text, /\n\ncrawl "walked as nobody"\n {2}seed traffic\n$/);
  const { program, diagnostics } = parseSource(c.text);
  assert.deepEqual(diagnostics.filter((d) => d.severity === 'error'), []);
  assert.equal(program.actions.length, 2);
  assert.equal(program.crawls?.length, 2);
});

test('an action and a crawl are refused by the rules the printer refuses them by', () => {
  const body = [expectStatus(200)];
  assert.equal(buildAction({ name: '', params: [], body }).ok, false);
  assert.equal(buildAction({ name: 'sign-in', params: [], body }).ok, false, 'a hyphen is not a word of a name');
  assert.equal(buildAction({ name: 'sign in', params: ['a', 'a'], body }).ok, false, 'a parameter twice');
  assert.equal(buildAction({ name: 'sign in', params: [], body: [] }).ok, false, 'an action with no statement does not parse');
  const ok = buildAction({ name: '  sign   in ', params: [], body });
  assert.ok(ok.ok && ok.node.name === 'sign in', 'the words are the name; the spacing is not');
  assert.equal(buildCrawl({ name: 'x', tags: [], sessions: [], seeds: [], excludes: [], body: [] }).ok, false, 'no seed is TF068');
  assert.equal(buildCrawl({ name: 'x', tags: [], sessions: [], seeds: [{ kind: 'spider', root: '/', maxDepth: 0 }], excludes: [], body: [] }).ok, false);
  assert.equal(buildCrawl({ name: 'x', tags: [], sessions: ['a-b'], seeds: [{ kind: 'traffic' }], excludes: [], body: [] }).ok, false);
});

test('a statement appended by address lands at the end of the declaration its space names', () => {
  const text = settled(FILE);
  const node = stepOf('api GET /appended');
  const action = insertIntoSource(text, { kind: 'stepsAtEnd', decl: 0, space: 'action', nodes: [node] });
  assert.ok(action.ok, action.ok ? '' : action.reason);
  assert.match(action.text, /expect status equals 200\n {2}api GET \/appended\n\n@scan/, 'under the action\'s last statement');
  const crawl = insertIntoSource(text, { kind: 'stepsAtEnd', decl: 0, space: 'crawl', nodes: [stepOf('expect response has no security violations')] });
  assert.ok(crawl.ok, crawl.ok ? '' : crawl.reason);
  assert.match(crawl.text, /serious security violations\n {2}expect response has no security violations\n\ntest/, 'under the crawl\'s last statement');
  // The same index with no space is the test — the default never moves.
  const inTest = insertIntoSource(text, { kind: 'stepsAtEnd', decl: 0, nodes: [node] });
  assert.ok(inTest.ok);
  assert.match(inTest.text, /api GET \/health\n {2}expect status equals 200\n {2}api GET \/appended\n$/);
});

test('a crawl with no statement takes its first one under its seeds', () => {
  const bare = settled('crawl "bare"\n  seed traffic\n  exclude "/x"\n');
  const out = insertIntoSource(bare, { kind: 'stepsAtEnd', decl: 0, space: 'crawl', nodes: [stepOf('expect response has no security violations')] });
  assert.ok(out.ok, out.ok ? '' : out.reason);
  assert.equal(out.text, 'crawl "bare"\n  seed traffic\n  exclude "/x"\n  expect response has no security violations\n');
});
