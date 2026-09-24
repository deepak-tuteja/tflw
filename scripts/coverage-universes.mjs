#!/usr/bin/env node
// `M236` `G` (review `M236-01`) — one source file, two transpilations, one source map.
//
// ## THE DEFECT, MEASURED
//
// `M236-01` filed an impossibility: a full `npm run coverage` credited
// `packages/cli/src/ui-server.ts` with **84 fewer covered lines than
// `packages/cli/test/ui-server.test.ts` alone**, and filed seventeen helpers at
// `FNDA:0` in the very run whose `ok 478` proves the suite called them. Running more
// tests cannot subtract hits, so the report was wrong rather than low.
//
// It is not the merge. `mergeProcessCovs` was measured against a union computed
// independently over the same 1052-file tmp tree: **zero functions the union has and
// the merge does not**. `etagOf` merges to 676 in the same run the report files at 0.
//
// It is this. Node writes a V8 coverage record keyed by the script's **url**, and
// beside it a `source-map-cache` entry keyed by the same url. c8 folds every process's
// cache into one object — `Object.assign`, so **the last writer in readdir order wins**
// — and then remaps *every* script cov under that url through that one map.
//
// That is sound only while one url means one generated text. Here it does not. Tests
// run under `node --import tsx`, and tsx resolves its tsconfig from the **cwd of the
// process doing the loading** — a fact `ui-server.test.ts:23` already records for a
// different reason. A test process loads `ui-server.ts` from inside the repo; a CLI
// subprocess loads the same file with its cwd in a fixture project. Two transforms,
// measured 16 bytes apart (218 438 vs 218 422 generated chars, mappings 28 668 vs
// 28 664), from a byte-identical source.
//
// So 4 processes reported offsets in one generated text and 34 in another, all under
// `file:///…/packages/cli/src/ui-server.ts`. The merge keeps both — they have different
// root ranges, so they are different functions to it — and then one map is applied to
// both. The universe the map does not describe lands at fabricated positions:
// `etagOf` appears in the `fnMap` **twice at line 825**, once as 676 and once as 0.
//
// Measured, control against treatment by one instrument over the real tmp tree:
//
//   packages/cli/src/ui-server.ts   1619/1998 -> 1980/1998 statements   (+361)
//   packages/cli/src/cli.ts         1876/4229 -> 2541/4229 statements   (+665)
//
// Two files of the 218 the report covers, and they are the two that are both imported
// by a test and executed as the CLI entry. `ui-server.ts`'s function denominator was
// **75 where the file has 45** — thirty of those entries were the mis-mapped twin.
//
// ## THE REPAIR, AND WHY IT IS HERE AND NOT AT THE SPAWN SITES
//
// The divergence could be removed by pinning tsx's tsconfig on every spawned CLI
// subprocess. There are dozens of those across ten test files, so that is a rule
// enforced at every consumer — the thing `M235-09` was filed for. It also fixes only
// the cause we happen to have found: anything that transforms a file a second way
// re-opens it, silently, because the report stays green while it lies.
//
// This runs once, between the suite and the report, and does not care why a second
// transform exists. It gives each offset universe its **own url**, so c8 keeps a
// separate source map for each and remaps each through the map that describes it.
// Both maps name the same `sources`, and v8-to-istanbul files coverage by the source
// map's sources rather than by the path it is handed — measured, handing it a path
// that does not exist on disk still files the result under `ui-server.ts` — so the two
// land on one file record and istanbul merges them. That merge is keyed by source
// **location** (`istanbul-lib-coverage`'s `mergeProp` via `keyFromLoc`), not by index,
// which is why summing two universes is correct and summing them at the V8 level is not.
//
// The renamed url only ever reaches c8's `_getSourceMap` lookup and `resolve()`. It
// keeps the `.ts` extension so any extension filter still matches, and uses only
// characters that survive c8's `pathToFileURL(fileURLToPath(…))` round trip.
//
// One universe per url keeps the original name. That is not cosmetic: `all: true`
// backfills an empty record for every `src` file absent from the coverage index, and
// leaving the real path in the index keeps it out of that path.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A stable identity for a source map. Two processes that transformed a file the same
 * way share one; two that did not, do not. Keyed on the map alone — `lineLengths`
 * describes the same generated text and would only add ways to be equal-but-different.
 */
export function mapIdentity(entry) {
  if (!entry || !entry.data) return null;
  return createHash('sha1').update(JSON.stringify(entry.data)).digest('hex').slice(0, 12);
}

/** The url a non-canonical universe is moved to. Reversible by eye, and still a `.ts`. */
export function renamedUrl(url, identity) {
  const dot = url.lastIndexOf('.');
  return dot === -1 ? `${url}.__cov_${identity}__` : `${url.slice(0, dot)}.__cov_${identity}__${url.slice(dot)}`;
}

/** True for a report Node actually wrote. Same test c8 applies. */
export function isCoverageObject(report) {
  return Boolean(report) && Array.isArray(report.result);
}

/**
 * url -> Map<identity, count of script covs>, over reports in the order c8 reads them.
 * A script cov whose process carried no map for that url is counted under `null`; it
 * is left alone by `separate` below, because there is no second map to move it to.
 */
export function universesOf(reports) {
  const seen = new Map();
  for (const report of reports) {
    if (!isCoverageObject(report)) continue;
    const cache = report['source-map-cache'] ?? {};
    for (const script of report.result) {
      if (typeof script.url !== 'string') continue;
      const identity = mapIdentity(cache[script.url]);
      let byIdentity = seen.get(script.url);
      if (!byIdentity) { byIdentity = new Map(); seen.set(script.url, byIdentity); }
      byIdentity.set(identity, (byIdentity.get(identity) ?? 0) + 1);
    }
  }
  return seen;
}

/** The urls carrying more than one *mapped* universe — the ones the report gets wrong. */
export function splitUrls(universes) {
  const out = [];
  for (const [url, byIdentity] of universes) {
    const mapped = [...byIdentity.keys()].filter((k) => k !== null);
    if (mapped.length > 1) out.push(url);
  }
  return out;
}

/**
 * Decide, once, which identity keeps each split url: the first *mapped* one in c8's own
 * read order, so the choice is deterministic and does not depend on which universe is
 * larger. Derived from the census rather than from a second walk of the tree — the
 * census already visits reports in read order, and a `Map` keeps insertion order, so the
 * answer is sitting in it. That matters for more than tidiness: the tree this runs over
 * is gigabytes, and a pass that has to hold reports to answer this is a pass that cannot
 * be afforded (see the streaming note below).
 */
export function canonicalIdentities(universes, urls) {
  const plan = new Map();
  for (const url of urls) {
    for (const identity of universes.get(url).keys()) {
      if (identity !== null) { plan.set(url, identity); break; }
    }
  }
  return plan;
}

/**
 * Move this report's non-canonical universes onto their own urls, in place. Returns the
 * number of script covs moved, so a caller can tell a rewritten file from an untouched
 * one without diffing it.
 */
export function separateReport(report, plan) {
  if (!isCoverageObject(report)) return 0;
  const cache = report['source-map-cache'] ?? {};
  let moved = 0;
  for (const script of report.result) {
    const canonical = plan.get(script.url);
    if (canonical === undefined) continue;
    const identity = mapIdentity(cache[script.url]);
    if (identity === null || identity === canonical) continue;
    const to = renamedUrl(script.url, identity);
    // The map must travel with the coverage, or the moved universe arrives with no map
    // at all and is remapped through nothing — worse than the defect being repaired.
    cache[to] = cache[script.url];
    delete cache[script.url];
    script.url = to;
    moved++;
  }
  return moved;
}

// --------------------------------------------------------------------------------- CLI

// STREAMING, AND WHY IT IS NOT A DETAIL.
//
// The first draft of this read the whole tree into an array and died on the real one:
// `FATAL ERROR: Ineffective mark-compacts near heap limit` at 4 GB, over 1052 files and
// 3.4 GB of JSON. c8 can afford to hold that tree — it is doing the merge, and
// `coverage.mjs` gives its report phase 8 GB for exactly this reason — but this tool
// only ever needs a summary of each file plus, on the rewrite pass, one file at a time.
// So every walk below is a generator: one report is parsed, used and dropped before the
// next is read, and nothing but the census outlives the loop.
function* reportsIn(dir) {
  for (const name of readdirSync(dir)) {
    let report;
    try { report = JSON.parse(readFileSync(join(dir, name), 'utf8')); } catch { continue; }
    yield { name, report };
  }
}

/** The same walk, for the callers that want only the reports. */
function* justReports(dir) {
  for (const { report } of reportsIn(dir)) yield report;
}

function describe(universes, urls) {
  const lines = [];
  for (const url of urls) {
    const byIdentity = universes.get(url);
    const parts = [...byIdentity].map(([id, n]) => `${id ?? 'no-map'}x${n}`).join(' ');
    lines.push(`    ${url.replace(/^.*\/(packages|scripts)\//, '$1/')}  ${parts}`);
  }
  return lines;
}

function main(argv) {
  const dir = argv.find((a) => !a.startsWith('--')) ?? join('coverage', 'tmp');
  const censusOnly = argv.includes('--census');

  // pass 1 — the census. Nothing but the summary survives this loop.
  let seen = 0;
  const universes = universesOf((function* () { for (const r of justReports(dir)) { seen++; yield r; } })());
  const urls = splitUrls(universes);

  console.log(`> coverage universes: ${seen} V8 file(s), ${universes.size} url(s)`);
  if (urls.length === 0) {
    console.log('  every url carries one transpilation — nothing to separate');
    return 0;
  }
  console.log(`  ${urls.length} url(s) published under more than one transpilation:`);
  for (const line of describe(universes, urls)) console.log(line);
  if (censusOnly) return 0;

  // pass 2 — the rewrite, one file in memory at a time.
  const plan = canonicalIdentities(universes, urls);
  let movedScripts = 0;
  let rewrittenFiles = 0;
  for (const { name, report } of reportsIn(dir)) {
    const moved = separateReport(report, plan);
    if (moved === 0) continue;
    writeFileSync(join(dir, name), JSON.stringify(report));
    movedScripts += moved;
    rewrittenFiles++;
  }
  console.log(`  moved ${movedScripts} script coverage(s) across ${rewrittenFiles} file(s)`);

  // pass 3 — THE POST-CONDITION. Re-read from disk rather than trusting the objects just
  // mutated: the thing being asserted is what c8 will read next, not what this process
  // believes it wrote.
  const after = universesOf(justReports(dir));
  const stillSplit = splitUrls(after);
  if (stillSplit.length > 0) {
    console.error(
      `\n✗ ${stillSplit.length} url(s) still carry more than one transpilation after separation.\n` +
        `  c8 keeps ONE source map per url, so whichever it picks will be applied to a\n` +
        `  generated text it does not describe, and the report will understate those files\n` +
        `  without saying so. Do not read the coverage numbers until this is green.\n` +
        `${describe(after, stillSplit).join('\n')}`,
    );
    return 1;
  }
  console.log('  every url now carries one transpilation');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)));
}
