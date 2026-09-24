// `M236` `G` (review `M236-01`) — the separation, over trees whose defect is known.
//
// The tool exists because one url carried two transpilations and c8 kept one source map
// for it. The fixtures are process coverages by hand, in the shape Node writes: a
// `result` array of script coverages and a `source-map-cache` keyed by the same urls.
// Built by hand rather than captured, because a captured tree would make this test
// depend on how *this* repository happens to be transpiled today — which is the very
// thing that varies.
//
// Two of the properties asserted here are not visible from reading the tool, and both
// were live hazards while it was written. A moved universe must take **its own map with
// it** — moving the coverage alone leaves it remapped through nothing, which is worse
// than the defect being repaired. And a url carrying one map plus a process that
// reported no map at all must NOT be split: there is no second map to move it to, so
// splitting it would file real coverage under a name with no map behind it.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalIdentities, mapIdentity, renamedUrl, separateReport, splitUrls, universesOf,
} from './coverage-universes.mjs';

const URL = 'file:///repo/packages/cli/src/ui-server.ts';
const OTHER = 'file:///repo/packages/cli/src/project.ts';

/** Two maps for one file, differing the way the real ones did: one elided import. */
const MAP_A = { version: 3, sources: [URL], names: ['a', 'b'], mappings: 'AAAA,CAAC,EAAE' };
const MAP_B = { version: 3, sources: [URL], names: ['a', 'b'], mappings: 'AAAA,CAAC' };

const fn = (name, count) => ({ functionName: name, isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: 50, count }] });
const proc = (url, map, ...fns) => ({
  result: [{ scriptId: '1', url, functions: fns }],
  'source-map-cache': map ? { [url]: { lineLengths: [10, 20], data: map } } : {},
});

test('a source map identifies its transpilation, and an absent map identifies nothing', () => {
  assert.equal(mapIdentity({ data: MAP_A }), mapIdentity({ data: { ...MAP_A } }));
  assert.notEqual(mapIdentity({ data: MAP_A }), mapIdentity({ data: MAP_B }));
  assert.equal(mapIdentity(undefined), null);
  assert.equal(mapIdentity({ lineLengths: [1, 2] }), null);
});

test('the census counts script coverages per url per transpilation', () => {
  const universes = universesOf([
    proc(URL, MAP_A, fn('etagOf', 676)),
    proc(URL, MAP_B, fn('etagOf', 0)),
    proc(URL, MAP_B, fn('etagOf', 0)),
    proc(OTHER, MAP_A, fn('x', 3)),
  ]);
  assert.equal(universes.get(URL).get(mapIdentity({ data: MAP_A })), 1);
  assert.equal(universes.get(URL).get(mapIdentity({ data: MAP_B })), 2);
  assert.equal(universes.get(OTHER).size, 1);
});

test('only a url with two MAPPED transpilations is split', () => {
  const twoMaps = universesOf([proc(URL, MAP_A, fn('etagOf', 676)), proc(URL, MAP_B, fn('etagOf', 0))]);
  assert.deepEqual(splitUrls(twoMaps), [URL]);

  // one map and one process that reported none. There is no second map to move the
  // unmapped coverage to, so splitting would file it under a url with nothing behind it.
  const oneMap = universesOf([proc(URL, MAP_A, fn('etagOf', 676)), proc(URL, null, fn('etagOf', 0))]);
  assert.deepEqual(splitUrls(oneMap), []);

  const agreed = universesOf([proc(URL, MAP_A, fn('etagOf', 676)), proc(URL, MAP_A, fn('etagOf', 12))]);
  assert.deepEqual(splitUrls(agreed), []);
});

test('the canonical transpilation is the first one c8 would read, not the commonest', () => {
  // B outnumbers A four to one, exactly as it did in the measured tree. A is still
  // canonical, because the choice has to be deterministic rather than data-dependent.
  const reports = [proc(URL, MAP_A, fn('etagOf', 676)), ...Array.from({ length: 4 }, () => proc(URL, MAP_B, fn('etagOf', 0)))];
  const plan = canonicalIdentities(universesOf(reports), [URL]);
  assert.equal(plan.get(URL), mapIdentity({ data: MAP_A }));
});

test('a process that carried no map cannot become the canonical transpilation', () => {
  // Read order puts the unmapped process first. Nothing can be remapped through "no map",
  // so canonical has to skip it — and if it did not, every mapped universe would be moved
  // off the real url and `all: true` would backfill the file at zero behind them.
  const reports = [proc(URL, null, fn('etagOf', 1)), proc(URL, MAP_A, fn('etagOf', 676)), proc(URL, MAP_B, fn('etagOf', 0))];
  const plan = canonicalIdentities(universesOf(reports), splitUrls(universesOf(reports)));
  assert.equal(plan.get(URL), mapIdentity({ data: MAP_A }));
});

test('a moved universe takes its own source map with it', () => {
  const plan = new Map([[URL, mapIdentity({ data: MAP_A })]]);
  const report = proc(URL, MAP_B, fn('etagOf', 0));

  assert.equal(separateReport(report, plan), 1);

  const moved = renamedUrl(URL, mapIdentity({ data: MAP_B }));
  assert.equal(report.result[0].url, moved);
  assert.equal(report.result[0].url.endsWith('.ts'), true, 'the extension must survive, or an extension filter drops it');
  // the assertion this test exists for: the map travelled, and nothing was left behind
  // under the old key for c8 to apply to somebody else's offsets.
  assert.deepEqual(report['source-map-cache'][moved].data, MAP_B);
  assert.equal(report['source-map-cache'][URL], undefined);
});

test('the canonical universe is left exactly as it was', () => {
  const plan = new Map([[URL, mapIdentity({ data: MAP_A })]]);
  const report = proc(URL, MAP_A, fn('etagOf', 676));
  const before = structuredClone(report);
  assert.equal(separateReport(report, plan), 0);
  assert.deepEqual(report, before);
});

test('a tree with one transpilation per url is not touched at all', () => {
  const reports = [proc(URL, MAP_A, fn('etagOf', 676)), proc(OTHER, MAP_B, fn('x', 3))];
  const before = structuredClone(reports);
  const plan = canonicalIdentities(universesOf(reports), splitUrls(universesOf(reports)));
  assert.equal(plan.size, 0);
  for (const r of reports) assert.equal(separateReport(r, plan), 0);
  assert.deepEqual(reports, before);
});

test('after separation every url carries one transpilation, which is the whole point', () => {
  const reports = [
    proc(URL, MAP_A, fn('etagOf', 676)),
    proc(URL, MAP_B, fn('etagOf', 0)),
    proc(URL, MAP_B, fn('etagOf', 0)),
  ];
  const plan = canonicalIdentities(universesOf(reports), splitUrls(universesOf(reports)));
  for (const r of reports) separateReport(r, plan);

  const after = universesOf(reports);
  assert.deepEqual(splitUrls(after), [], 'nothing may still be sharing a url');
  assert.equal(after.size, 2, 'the two transpilations are two urls now');
  // and the counts are still there to be merged — separation moves coverage, never drops it
  const counts = [...after.keys()].map((u) =>
    reports.filter((r) => r.result[0].url === u).reduce((n, r) => n + r.result[0].functions[0].ranges[0].count, 0));
  assert.deepEqual(counts.sort((a, b) => a - b), [0, 676]);
});
