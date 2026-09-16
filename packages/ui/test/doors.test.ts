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
import { countByDoor, lenslessCount, doorFromHash, hashForDoor, DOORS } from '../src/doors';
import type { ProjectView } from '../src/contract';

const project = (files: ProjectView['files']): ProjectView => ({ root: '/p', envs: [], reportDir: './report', files, traceViewer: false, scratchPath: 'scratch.tflw', scratchIgnored: true, authorization: { envName: 'local', targets: [], apiBaseUrl: null, services: [] }, webBaseUrl: null });

const file = (path: string, tests: Array<readonly string[]>, crawls: Array<readonly string[]> = []): ProjectView['files'][number] => ({
  path,
  diagnostics: 0,
  tests: tests.map((lenses, i) => ({ name: `${path}-t${i}`, tags: [], line: i + 1, workload: lenses.includes('load'), lenses: lenses as never })),
  crawls: crawls.map((lenses, i) => ({ name: `${path}-c${i}`, line: 100 + i, lenses: lenses as never })),
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

test('the hash names the door, and anything else is the landing', () => {
  for (const door of DOORS) {
    assert.equal(doorFromHash(hashForDoor(door.id)), door.id);
    assert.equal(doorFromHash(`#${door.id}`), door.id, 'the slash is optional');
  }
  assert.equal(hashForDoor(null), '#');
  for (const hash of ['', '#', '#/', '#/nope', '#/API', '#/scan/extra']) {
    assert.equal(doorFromHash(hash), null, `\`${hash}\` is the landing`);
  }
});
