// The doors' arithmetic (`M200` `A0-3`, `D1042`/`D1043`) — the part of the shell that is a pure
// function and therefore does not belong in the Playwright gate.
//
// It is here for a measured reason rather than a tidy one. The browser gate runs against
// `fixtures/project`, and that project contains **no `crawl`** — so the mutation that stopped
// crawls counting toward the SCANS door survived a full page run. The door's count was green
// because three `api`+`scan` tests were carrying it, and the declaration the door is actually
// named for was never exercised. Regenerating the fixture corpus to add one would have rewritten
// two checked-in report directories that a dozen other assertions read as their oracle; a unit
// test costs nothing and asserts the thing itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countByDoor, lenslessCount, unparsedCount, countsHonestly, kindFromHash, legacyKind, docFromHash, fileFromHash, tabFromHash, hashFor, focusFromHash, paneTail, failedFromHash, selectionFromHash, queryFromHash, DOORS, TABS, DEFAULT_TAB } from '../src/doors';
import type { ProjectView } from '../src/contract';

const project = (files: ProjectView['files']): ProjectView => ({ configured: true, root: '/p', version: { version: '0.0.0-test', source: 'dev', commit: null, dirty: null, builtAt: null }, envs: [], reportDir: './report', helpers: [], runFlags: [], files, traceViewer: false, scratchPath: '.scratch.tflw', scratchIgnored: true, playScratch: '.play.tflw', playIgnored: true, scratchEtag: null, authorization: { envName: 'local', targets: [], apiBaseUrl: null, services: [], sessions: [] }, webBaseUrl: null });

const file = (path: string, tests: Array<readonly string[]>, crawls: Array<readonly string[]> = []): ProjectView['files'][number] => ({
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
  // `steps` is derived from the lenses the case asked for rather than defaulted to zero: a fixture
  // that quietly fills a field with a value no real project produces is how a construct hides from
  // the gate that covers it (`M168-02`). These cases are about the door arithmetic and never read
  // it, but a test carrying the `browser` lens and zero browser steps is not a project state.
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

test('a test behind two doors is counted by both — the arithmetic D1043 asks for', () => {
  const counts = countByDoor(project([file('a.tflw', [['api'], ['api', 'load'], ['browser']])]));
  assert.deepEqual(counts, { api: 2, browser: 1, load: 1, scan: 0 });
  // Not a double count to be corrected: three tests, four placements, and the totals are what the
  // four doors will each show.
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 4);
});

test('a crawl counts toward its door — the declaration the SCANS door is named for', () => {
  const counts = countByDoor(project([file('s.tflw', [['api', 'scan']], [['scan']])]));
  assert.equal(counts.scan, 2, 'one scan-bearing test and one crawl');
  assert.equal(counts.api, 1);
  // And the control: with the crawl gone, the door drops to the test alone. Without this line the
  // assertion above passes on any implementation that ignores crawls entirely.
  assert.equal(countByDoor(project([file('s.tflw', [['api', 'scan']])])).scan, 1);
});

test('a project with nothing in it counts zero everywhere, and so does no project at all', () => {
  assert.deepEqual(countByDoor(project([])), { api: 0, browser: 0, load: 0, scan: 0 });
  assert.deepEqual(countByDoor(null), { api: 0, browser: 0, load: 0, scan: 0 });
  assert.equal(lenslessCount(null), 0);
});

test('a test behind no door is counted as such, so the landing can admit it exists', () => {
  // Measured over both repositories: 22 of 761 tests carry no construct any door is about, and
  // three of those are empty because their whole body is one `call` into an imported action.
  assert.equal(lenslessCount(project([file('x.tflw', [[], ['api'], []])])), 2);
});

test('the kind rides in the query, and an address from before `M254` reads its door as the kind (`D1413`)', () => {
  // `M254` (`D1399`): a kind is a filter, so it sits with the other narrowings after the `?` and the
  // path is only where you are. `all` is the absence of the key.
  for (const d of DOORS) {
    assert.equal(kindFromHash(`#/${paneTail([], '', d.id)}`), d.id);
    assert.equal(kindFromHash(`#/compose/shop.tflw${paneTail([], '', d.id)}`), d.id);
  }
  assert.equal(paneTail([], '', null), '', 'the `all` chip writes nothing, so an address that narrows nothing is byte-identical to one written before `M254`');
  assert.equal(paneTail(['a.tflw'], '@smoke', 'api'), '?kind=api&files=a.tflw&q=%40smoke', 'the kind first, then what `D1066` already put there');
  for (const hash of ['', '#', '#/', '#/compose', '#/?kind=nope', '#/?kind=API', '#/nope']) {
    assert.equal(kindFromHash(hash), null, `\`${hash}\` has every kind shown`);
  }

  // **EVERY LINK ANYBODY HAS STILL OPENS.** No tab id is a lens id, so a first segment that is one
  // can only be a door, and it is read as the kind while the rest of the path is read as it always
  // was. `App`'s canonicalising effect then rewrites it — `legacyRewrite` below is that effect's
  // arithmetic, pinned here where no browser is needed.
  for (const d of DOORS) {
    assert.equal(kindFromHash(`#/${d.id}`), d.id);
    assert.equal(kindFromHash(`#${d.id}`), d.id, 'the slash was optional, and still is');
    assert.equal(legacyKind(`#/${d.id}/source/shop.tflw`), d.id);
  }
  assert.equal(legacyKind('#/compose/shop.tflw'), null, 'a tab is never read as a door');
  assert.equal(legacyKind('#/source/api/x.tflw'), null, 'nor is a file segment that happens to be called `api`');
  assert.equal(kindFromHash('#/scan/extra'), 'scan', 'a door with a word after it is still that door');
  assert.equal(kindFromHash('#/nope/source'), null, 'a tab cannot rescue a door that is not one');
  // The query wins over a legacy door, so an address half-rewritten by hand says what its query says.
  assert.equal(kindFromHash('#/api/compose?kind=load'), 'load');
});

test('a legacy address canonicalises to the same tab, file, document and line with its door as the kind', () => {
  const canonical = (hash: string): string =>
    hashFor(tabFromHash(hash), fileFromHash(hash), focusFromHash(hash) ?? undefined, docFromHash(hash)) + paneTail(selectionFromHash(hash), queryFromHash(hash), kindFromHash(hash));
  const cases: [string, string][] = [
    ['#/api', '#/?kind=api'],
    ['#/browser/compose/shop.tflw', '#/compose/shop.tflw?kind=browser'],
    ['#/scan/config/tests/ui/login.tflw/@local/L7', '#/config/tests/ui/login.tflw/@local/L7?kind=scan'],
    ['#/load/run/load.tflw?files=load.tflw&q=%40smoke', '#/run/load.tflw?kind=load&files=load.tflw&q=%40smoke'],
    ['#/api/source/L11.tflw', '#/source/L11.tflw?kind=api'],
  ];
  for (const [legacy, now] of cases) {
    assert.equal(canonical(legacy), now, `${legacy} rewrites to ${now}`);
    assert.equal(canonical(now), now, `${now} is already canonical — the rewrite is a fixed point, so it cannot loop`);
  }
  // A new-grammar address is its own canonical form, the ordinary case and the reason the effect is
  // a no-op on every navigation the page makes itself.
  for (const hash of ['#/', '#/compose/shop.tflw', '#/source/tests/a.tflw/L3', '#/run/a.tflw?kind=browser', '#/auth/a.tflw']) {
    assert.equal(canonical(hash), hash);
  }
});

test('the tab is the hash’s second segment, and the default tab writes the bare door hash', () => {
  // `D1045` extended to the strip: the choice lives in the URL and nowhere else, so these two
  // functions are the whole of what the page remembers about which tab you are on.
  for (const tab of TABS) {
    assert.equal(tabFromHash(hashFor(tab.id)), tab.id, `${tab.id} did not survive a round trip`);
  }

  // The bare door hash is Compose, which is what lets `#/api` keep meaning what it meant before
  // the strip — and `hashFor` writes that short form rather than `#/compose`, so the
  // commonest address stays the one that was already in circulation.
  assert.equal(hashFor(DEFAULT_TAB), '#/');
  assert.equal(tabFromHash('#/api'), DEFAULT_TAB);
  assert.equal(tabFromHash('#'), DEFAULT_TAB);

  // An unrecognised tab is Compose rather than an error, the same tolerance `kindFromHash` has —
  // and the case that matters is a tab the rule REFUSES, because `M205` §2 names *History*,
  // *Docs* and *Coverage* as the things a strip facing one file may not grow.
  assert.equal(tabFromHash('#/api/coverage'), DEFAULT_TAB);
  assert.equal(tabFromHash('#/api/source/extra'), 'source', 'a third segment is not a tab and does not unseat one');
});

test('the file rides in the address, and a path with slashes still parses', () => {
  // `M206` `Q4`. Until this the file lived in each form's own `useState(files[0] ?? '')`, so a door
  // change silently reset it — worst on the 145 tests the census found behind more than one door,
  // which are exactly the ones you walk between doors to look at.
  assert.equal(hashFor('compose', 'shop.tflw'), '#/compose/shop.tflw');
  assert.equal(fileFromHash('#/browser/compose/shop.tflw'), 'shop.tflw');

  // **A FILE PATH HAS SLASHES, SO "THE FILE IS SEGMENT THREE" IS NOT A RULE THIS GRAMMAR CAN HOLD.**
  // `tests/ui/storefront/login.tflw` is four segments on its own. The line is read off the END and
  // the file is everything between the tab and it, which is the only reading that survives a real
  // corpus path — more than half the sibling's files are nested at least two deep.
  const nested = 'tests/ui/storefront/login.tflw';
  assert.equal(hashFor('source', nested), `#/source/${nested}`);
  assert.equal(fileFromHash(`#/browser/source/${nested}`), nested);
  assert.equal(focusFromHash(`#/browser/source/${nested}`), null, 'a nested path names no line');

  // A file and a line together, which is what an `[edit]` link writes once Auth is file-scoped.
  assert.equal(hashFor('config', nested, 11), `#/config/${nested}/L11`);
  assert.equal(fileFromHash(`#/api/config/${nested}/L11`), nested);
  assert.equal(focusFromHash(`#/api/config/${nested}/L11`), 11);

  // With a file present the tab must be spelled even when it is the default — otherwise the file
  // would be read as the tab. The bare form still wins when nothing follows it.
  assert.equal(hashFor(DEFAULT_TAB, 'shop.tflw'), `#/${DEFAULT_TAB}/shop.tflw`);
  assert.equal(tabFromHash(`#/api/${DEFAULT_TAB}/shop.tflw`), DEFAULT_TAB);
  assert.equal(hashFor(DEFAULT_TAB), '#/');

  // EVERY ADDRESS THAT EXISTED BEFORE THIS SLICE STILL MEANS WHAT IT MEANT. That is `S5a`'s own
  // gate run wider, and it is the whole cost `Q4` accepted: `#/api/config/L11` names a line and NO
  // file, because a bare `L11` is the line and there is nothing left over to be a file.
  assert.equal(focusFromHash('#/api/config/L11'), 11);
  assert.equal(fileFromHash('#/api/config/L11'), null, 'a lone line segment is not a file');
  for (const hash of ['#', '#/api', '#/api/source', '#/browser', '#/scan/compose']) {
    assert.equal(fileFromHash(hash), null, `\`${hash}\` names no file`);
  }
  assert.equal(kindFromHash(`#/browser/source/${nested}`), 'browser', 'a file cannot unseat the door');
  assert.equal(tabFromHash(`#/browser/source/${nested}`), 'source', 'a file cannot unseat the tab');

  // No `.tflw` path can collide with the line pattern, because every one of them ends in `.tflw`.
  // The near-misses are pinned so a future loosening of the regexp is a red test rather than a
  // file that silently becomes a line number.
  assert.equal(fileFromHash('#/api/source/L11.tflw'), 'L11.tflw');
  assert.equal(focusFromHash('#/api/source/L11.tflw'), null);
});

test('the hash’s third segment is a line for Config to land on, and only that', () => {
  // `M205` S5b. Auth shows a session and an authorized target as facts and sends you to Config to
  // change one; *"lands in Config focused on that block"* is the promise, and putting the target
  // in the address rather than in a callback is `D1045` a third time — the jump is linkable, the
  // back button walks back out of it, and nothing new remembers where you were going.
  assert.equal(hashFor('config', null, 11), '#/config/L11');
  assert.equal(focusFromHash('#/api/config/L11'), 11);

  // A focus forces the long form even for the default tab, because the third segment has nowhere
  // else to sit — and the bare form still wins when nobody asked for a line, which is what keeps
  // `#/api` the commonest address.
  assert.equal(hashFor(DEFAULT_TAB, null, 3), `#/${DEFAULT_TAB}/L3`);
  assert.equal(hashFor(DEFAULT_TAB), '#/');

  // `L`-prefixed so a third segment cannot be read as a fourth tab, and so an address that names
  // no line reads as one — every hash anybody had before `S5b` is of that shape.
  for (const hash of ['#/api', '#/api/config', '#/api/config/session', '#/api/config/11', '#/api/config/L', '#/api/config/Lx', '#']) {
    assert.equal(focusFromHash(hash), null, `\`${hash}\` names no line`);
  }

  // And the two rules do not interfere: a line does not unseat the tab, and a tab is still not a
  // door. Pinned here because the three functions read the same string and a change to one
  // regexp is a change to all three.
  assert.equal(tabFromHash('#/api/config/L11'), 'config');
  assert.equal(kindFromHash('#/api/config/L11'), 'api');
});

test('a `@name` segment names which project document Config shows, and only that', () => {
  // `M208` `S2` (`Q2`). Config is the one tab whose subject is not the addressed file — it renders
  // `tflw.config` while the hash names the `.tflw` — and `M208` gives it a second document to show.
  // The document is named by its **env**, because a baseline is declared per env, the env is
  // already a word in the config, and an env name survives a rename of the JSON. A filename would
  // not, and a filename may itself contain slashes, which is the problem the file slot already
  // solved and must not solve twice.
  const nested = 'tests/ui/storefront/login.tflw';
  assert.equal(hashFor('config', nested, 7, 'local'), `#/config/${nested}/@local/L7`);
  assert.equal(fileFromHash(`#/scan/config/${nested}/@local/L7`), nested, 'the document must not eat the file');
  assert.equal(docFromHash(`#/scan/config/${nested}/@local/L7`), 'local');
  assert.equal(focusFromHash(`#/scan/config/${nested}/@local/L7`), 7, 'the document must not eat the line');

  // `@defaults` is the `defaults` block's document and is spelled like any other, because
  // `defaults` is a block of the config exactly as an env is.
  assert.equal(docFromHash('#/scan/config/@defaults'), 'defaults');
  assert.equal(fileFromHash('#/scan/config/@defaults'), null, 'a lone document segment is not a file');

  // EVERY ADDRESS THAT EXISTED BEFORE THIS SLICE STILL MEANS WHAT IT MEANT — `S5b`'s and `Q4`'s
  // gate run a third time. `null` is `tflw.config`, so the absence of the segment is the default
  // rather than a spelled `@config`; spelling it would have made every existing link ambiguous
  // about which document it named.
  for (const hash of ['#', '#/api', '#/api/config', '#/api/config/L11', `#/api/config/${nested}`, `#/api/config/${nested}/L11`]) {
    assert.equal(docFromHash(hash), null, `\`${hash}\` names no document`);
  }
  assert.equal(hashFor('config', nested, 11), `#/config/${nested}/L11`, 'an omitted document writes no segment');
  assert.equal(hashFor(DEFAULT_TAB), '#/', 'and the bare form still wins when nothing follows it');

  // A `.tflw` PATH CONTAINING AN `@` IS STILL A PATH. The document pattern forbids a dot and every
  // test file's last segment ends in `.tflw`, so the two can never be confused — and the near-miss
  // is pinned, so a future loosening of the regexp is a red test rather than a file that silently
  // becomes a document selector.
  assert.equal(fileFromHash('#/api/source/tests/@local/login.tflw'), 'tests/@local/login.tflw');
  assert.equal(docFromHash('#/api/source/tests/@local/login.tflw'), null);
  assert.equal(fileFromHash('#/api/source/@local.tflw'), '@local.tflw', 'a file that merely starts with `@` is a file');
  assert.equal(docFromHash('#/api/source/@local.tflw'), null);

  // And the four rules do not interfere. Pinned together because all four read the same string.
  assert.equal(kindFromHash(`#/scan/config/${nested}/@local/L7`), 'scan');
  assert.equal(tabFromHash(`#/scan/config/${nested}/@local/L7`), 'config');

  // Round trip over every tab, so a document is not a thing only Config can carry in the address.
  // It is only *meaningful* there, which is a different claim and is the panel's to make.
  for (const tab of TABS) {
    const hash = hashFor(tab.id, 'a.tflw', undefined, 'prod');
    assert.equal(docFromHash(hash), 'prod', `${tab.id} lost the document`);
    assert.equal(tabFromHash(hash), tab.id, `${tab.id} did not survive a round trip with a document`);
    assert.equal(fileFromHash(hash), 'a.tflw', `${tab.id} lost the file`);
  }
});

// `M211` `S2` (`M202-01`) — a file that did not parse is left out of the landing's counts.
//
// `Landing.tsx`'s own docblock is the criterion: *"A door showing 12 tests that the project does
// not have would be a brochure."* Both directions of that were measured on one 12-test corpus file
// before this was written — an unterminated `{` leaves **1 of 12**, and an unterminated test name
// leaves **13**, the thirteenth carrying an empty name. Neither is a count of the project, so the
// file is excluded rather than approximated: there is no honest number to fold in.

const broken = (path: string, tests: Array<readonly string[]>, errors: number, warnings = 0): ProjectView['files'][number] => ({
  ...file(path, tests),
  diagnostics: errors + warnings,
  errors,
  warnings,
});

test('a file with an error is left out of every door count, and `unparsedCount` says how many', () => {
  const p = project([file('ok.tflw', [['api'], ['api', 'scan']]), broken('bad.tflw', [['api'], ['browser']], 2)]);
  assert.deepEqual(countByDoor(p), { api: 2, browser: 0, load: 0, scan: 1 });
  assert.equal(unparsedCount(p), 1);
});

test('a file with only warnings parsed, so it counts like any other', () => {
  const p = project([broken('warn.tflw', [['api'], ['load']], 0, 3)]);
  assert.deepEqual(countByDoor(p), { api: 1, browser: 0, load: 1, scan: 0 });
  assert.equal(unparsedCount(p), 0, 'a warning is not a failure to parse');
});

test('`lenslessCount` makes the same exclusion — a recovered test behind no door is not a project fact', () => {
  const p = project([file('ok.tflw', [[]]), broken('bad.tflw', [[], []], 1)]);
  assert.equal(lenslessCount(p), 1);
});

test('a healthy project says nothing — `unparsedCount` is zero, which is what makes the disclosure readable', () => {
  assert.equal(unparsedCount(project([file('a.tflw', [['api']]), file('b.tflw', [['scan']])])), 0);
});

// The predicate is exported and asserted directly, because it is the one place the rule lives and
// three call sites read it. Severity is the whole of it: a count of diagnostics cannot answer this.
test('`countsHonestly` reads errors and nothing else', () => {
  assert.equal(countsHonestly({ errors: 0 }), true);
  assert.equal(countsHonestly({ errors: 1 }), false);
});

test('the `failed` chip is `failed=1` after the kind, and an address without it has it off (`M255`, `D1413`)', () => {
  assert.equal(paneTail([], '', null, true), '?failed=1');
  assert.equal(paneTail(['a.tflw'], '', 'api', true), '?kind=api&failed=1&files=a.tflw', 'the two chips first, then what `D1066` already put there');
  assert.equal(paneTail([], '', 'api', false), '?kind=api', 'off writes nothing, so every address from before `M255` is unchanged');
  assert.equal(failedFromHash(`#/compose/shop.tflw${paneTail([], '@smoke', 'load', true)}`), true);
  assert.equal(kindFromHash(`#/compose/shop.tflw${paneTail([], '', 'load', true)}`), 'load', 'and the kind still reads through it');
  for (const hash of ['#/', '#/compose/shop.tflw?kind=api', '#/?failed=0', '#/?failed']) assert.equal(failedFromHash(hash), false, hash);
});
