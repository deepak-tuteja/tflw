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
import { countByDoor, lenslessCount, doorFromHash, hashForDoor, tabFromHash, hashForTab, focusFromHash, DOORS, TABS, DEFAULT_TAB } from '../src/doors';
import type { ProjectView } from '../src/contract';

const project = (files: ProjectView['files']): ProjectView => ({ root: '/p', envs: [], reportDir: './report', files, traceViewer: false, scratchPath: '.scratch.tflw', scratchIgnored: true, scratchEtag: null, authorization: { envName: 'local', targets: [], apiBaseUrl: null, services: [], sessions: [] }, webBaseUrl: null });

const file = (path: string, tests: Array<readonly string[]>, crawls: Array<readonly string[]> = []): ProjectView['files'][number] => ({
  path,
  diagnostics: 0,
  tests: tests.map((lenses, i) => ({ name: `${path}-t${i}`, tags: [], line: i + 1, workload: lenses.includes('load'), lenses: lenses as never, sessions: [] })),
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

test('the hash names the door, the second segment names a tab, and anything else is the landing', () => {
  for (const door of DOORS) {
    assert.equal(doorFromHash(hashForDoor(door.id)), door.id);
    assert.equal(doorFromHash(`#${door.id}`), door.id, 'the slash is optional');
  }
  assert.equal(hashForDoor(null), '#');
  for (const hash of ['', '#', '#/', '#/nope', '#/API']) {
    assert.equal(doorFromHash(hash), null, `\`${hash}\` is the landing`);
  }

  // **`#/scan/extra` USED TO BE THE LANDING AND IS NOW THE SCANS DOOR**, and this line is the
  // change `M205` S5 made rather than an oversight it left. A second segment is a tab
  // (`M205` §2), so the door is the first segment and a trailing word it does not recognise is
  // tolerated the same way `#/nope` is — by falling back, not by refusing.
  //
  // The cost of getting this wrong is why it is pinned from both sides below: `#/api` meant
  // something before the strip existed and every link anyone has pasted is of that shape, so the
  // bare door hash must keep resolving, and a tab must not be able to steal the door.
  assert.equal(doorFromHash('#/scan/extra'), 'scan', 'a second segment is a tab, not a wrong door');
  assert.equal(doorFromHash('#/api/source'), 'api');
  assert.equal(doorFromHash('#/nope/source'), null, 'a tab cannot rescue a door that is not one');
});

test('the tab is the hash’s second segment, and the default tab writes the bare door hash', () => {
  // `D1045` extended to the strip: the choice lives in the URL and nowhere else, so these two
  // functions are the whole of what the page remembers about which tab you are on.
  for (const tab of TABS) {
    assert.equal(tabFromHash(hashForTab('api', tab.id)), tab.id, `${tab.id} did not survive a round trip`);
  }

  // The bare door hash is Compose, which is what lets `#/api` keep meaning what it meant before
  // the strip — and `hashForTab` writes that short form rather than `#/api/compose`, so the
  // commonest address stays the one that was already in circulation.
  assert.equal(hashForTab('api', DEFAULT_TAB), '#/api');
  assert.equal(tabFromHash('#/api'), DEFAULT_TAB);
  assert.equal(tabFromHash('#'), DEFAULT_TAB);

  // An unrecognised tab is Compose rather than an error, the same tolerance `doorFromHash` has —
  // and the case that matters is a tab the rule REFUSES, because `M205` §2 names *History*,
  // *Docs* and *Coverage* as the things a strip facing one file may not grow.
  assert.equal(tabFromHash('#/api/coverage'), DEFAULT_TAB);
  assert.equal(tabFromHash('#/api/source/extra'), 'source', 'a third segment is not a tab and does not unseat one');
});

test('the hash’s third segment is a line for Config to land on, and only that', () => {
  // `M205` S5b. Auth shows a session and an authorized target as facts and sends you to Config to
  // change one; *"lands in Config focused on that block"* is the promise, and putting the target
  // in the address rather than in a callback is `D1045` a third time — the jump is linkable, the
  // back button walks back out of it, and nothing new remembers where you were going.
  assert.equal(hashForTab('api', 'config', 11), '#/api/config/L11');
  assert.equal(focusFromHash('#/api/config/L11'), 11);

  // A focus forces the long form even for the default tab, because the third segment has nowhere
  // else to sit — and the bare form still wins when nobody asked for a line, which is what keeps
  // `#/api` the commonest address.
  assert.equal(hashForTab('api', DEFAULT_TAB, 3), `#/api/${DEFAULT_TAB}/L3`);
  assert.equal(hashForTab('api', DEFAULT_TAB), '#/api');

  // `L`-prefixed so a third segment cannot be read as a fourth tab, and so an address that names
  // no line reads as one — every hash anybody had before `S5b` is of that shape.
  for (const hash of ['#/api', '#/api/config', '#/api/config/session', '#/api/config/11', '#/api/config/L', '#/api/config/Lx', '#']) {
    assert.equal(focusFromHash(hash), null, `\`${hash}\` names no line`);
  }

  // And the two rules do not interfere: a line does not unseat the tab, and a tab is still not a
  // door. Pinned here because the three functions read the same string and a change to one
  // regexp is a change to all three.
  assert.equal(tabFromHash('#/api/config/L11'), 'config');
  assert.equal(doorFromHash('#/api/config/L11'), 'api');
});
