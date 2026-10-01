// `M234` — browser coverage for `packages/ui/src`, so the page gate counts toward the floor.
//
// ## The defect this repairs
//
// `.c8rc.json`'s floor is 94/88/94, and on this branch it went red at 92.81/91.44/91.04 with every
// test green. The number that moved was `packages/ui/src`: **92.76% → 65.36%**, and nothing in that
// package got worse. Eighteen more of its 55 files simply *entered the report* — 8 reported on
// `main`, 26 here — because `M212`–`M228` added unit tests that `import` them, and c8 reports any
// file a test loads whether or not the floor was ever measured against it. `packages/ui/src` is not
// in `.c8rc.json`'s `src` list at all.
//
// The deeper half is that the suite which actually exercises this code **cannot be seen by the
// instrument**. `ui-page.test.ts` is 203 tests that drive the real page in real Chromium; the page
// is one minified bundle served out of `dist/ui`, `.c8rc.json` excludes `**/dist/**`, and c8's
// `NODE_V8_COVERAGE` only ever reaches Node processes — a browser's V8 is not one. So the number
// read *the UI is 65% covered* while meaning *the UI modules a unit test happens to import are 65%
// covered by unit tests alone, with the 203 tests that drive them excluded by construction*.
//
// This is `M86`'s defect in a second package, and `M86`'s sentence is still the right one: the
// defect was not a low number, it was **a number about the wrong thing**.
//
// ## The mechanism, and why it is not the CLI's
//
// `M86` bought the CLI's number with a source map and `exclude-after-remap`, because `cli.cjs` runs
// in a Node subprocess that inherits `NODE_V8_COVERAGE`. Nothing inherits anything here. So this
// collects Chromium's own V8 coverage through Playwright (`page.coverage`), rewrites each entry to
// point at the bundle on disk, and writes it into c8's temp directory in the shape c8 reads. c8
// then remaps through the bundle's `.map` exactly as it does for the CLI — measured working before
// a line of this was written: a single page load with no interaction attributed real line numbers
// in `ComposePane.tsx`, `Findings.tsx` and `AddStep.tsx`.
//
// **A source map is positional, and moving the bundle moves what it points at.** Vite writes
// `sources` relative to the directory it built into — a `mkdtemp` scratch — so the copy below would
// resolve them somewhere that does not exist, and c8 files every remapped line under that
// non-existent path instead of `packages/ui/src`. It does not fail: with `all: true` the report
// still lists all 55 UI files, at **0%**, from the backfill, while the real numbers sit in rows
// nobody is looking at. Measured exactly that way before this was written — 641 of 2425 functions
// non-zero in the coverage file, `ui/src` reading zero in the report. So the sources are rewritten
// to absolute paths against the directory they were built in, which makes the copy positionless.
//
// **The bundle has to outlive the test.** Both gates build into a `mkdtemp` scratch they delete in
// `after()`, and c8 remaps minutes later when every workspace has finished — by which time the file
// the coverage entry names is gone and the entry silently contributes nothing. So the assets are
// copied into `coverage/.ui-bundle/` (inside the already-gitignored `coverage/`, dot-prefixed so
// the corpus walkers skip it) and the entry's `url` names that copy. Vite's hashed filenames mean
// two gates' bundles never collide.
//
// **Each document is its own file** (`M257`), taken before the page leaves it — see
// `startUiCoverage`. The first version merged one collection at the end, and that collection held
// only the last document.
//
// **It refuses rather than under-reporting.** Running under c8 with no source map emitted would
// produce a bundle c8 cannot remap — coverage lands on `coverage/.ui-bundle/index-HASH.js`, which
// `exclude-after-remap` then drops, and the report comes back *lower* than before with nothing
// saying why. That is `D527`'s shape: a check that could not look must not answer zero. So the
// absence of the map is an assertion failure here, not a quiet skip.

import assert from 'node:assert/strict';
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CDPSession, Page } from 'playwright';

type Range = { startOffset: number; endOffset: number; count: number };
type Fn = { functionName: string; isBlockCoverage: boolean; ranges: Range[] };
type Entry = { url: string; functions: Fn[] };

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

/** Where the built bundle is kept so c8 can still read it when it remaps, long after `after()`. */
export const BUNDLE_HOME = join(repoRoot, 'coverage', '.ui-bundle');

/** c8 sets this for every process it spawns. Absent means a plain `npm test`, and this is inert. */
const v8Dir = (): string | undefined => process.env.NODE_V8_COVERAGE || undefined;

/** True when this run is under `npm run coverage` and the page's lines are wanted. */
export const uiCoverageWanted = (): boolean => v8Dir() !== undefined;

/**
 * The extra `vite build` flags a coverage run needs, and **why they are flags and not config**.
 *
 * `packages/ui/vite.config.ts` is one of the five files `screenshotInputs()` hashes by name
 * (`screenshot-inputs.mjs:119`), so editing it invalidates every committed shot — `D1283` working
 * as designed. Gating the two settings inside the config therefore reddened
 * `verify-page-screenshots.test.mjs` over a change that **cannot reach the shipped bundle**, since
 * it only applies when this variable is set. A gate should not be taught to reason about which
 * config edits matter; the honest move is to leave the file alone. So the coverage build states its
 * own difference here, next to the thing that needs it.
 *
 * `--sourcemap` is what lets c8 attribute the bundle back to `packages/ui/src` at all.
 *
 * `--minify false` is the one that took a measurement to find. Minified, `RunStrip.tsx` reported
 * **99.29% of lines and 0% of functions** — impossible together, since a file none of whose
 * functions ran can only execute its top-level statements. `api.ts` said 100%/5.88% and
 * `ConfigPanel.tsx` 100%/5.26%, the same shape. Renaming, inlining and merging make one emitted
 * range remap onto source positions belonging to code that never ran, so line coverage comes back
 * optimistic while function coverage stays roughly honest. Unminified moved `api.ts` to
 * **60.78/29.62** and `depends.ts` from 91.66 to **38.88** — the package as a whole from 73.89 to
 * 68.44 on lines. A number wrong in a known direction is worse than no number, because a floor set
 * against it is unfalsifiable.
 */
export const coverageBuildArgs = (): string[] =>
  uiCoverageWanted() ? ['--sourcemap', '--minify', 'false'] : [];

/**
 * **One file per document, written before the document is left** (`M257`).
 *
 * The first version started Playwright's collector once with `resetOnNavigation: false` and stopped
 * it in `after()`, on the reading that *not resetting* meant *keeping*. It does not: Chromium's
 * precise coverage answers for the scripts of the document that is live when it is asked, and a
 * document navigated away from takes its counts with it. Measured with a probe page — a function
 * called five times, then a reload: **0**; the same calls in the document still on screen: **5**.
 * So each gate's figure was the coverage of whatever its LAST test left on screen. `M256` measured
 * `packages/ui` at 68.38% because its last test ended mid-interaction, and `M257`'s ended on a
 * reload and measured **61.58%** with nothing in the page covered any less — `ComposePane` read
 * zero calls in both gates while 200 tests drove it. A number about the wrong thing again, in
 * `M86`'s and `M234`'s own words.
 *
 * Now the page's `goto`, `reload`, `goBack` and `goForward` take the live document's coverage
 * first, over the DevTools protocol (`Profiler.takePreciseCoverage`, which also zeroes the
 * counters, so no call is counted twice), and each document becomes its own file in c8's
 * directory. c8 merges files from many processes already — the CLI's subprocesses write over a
 * thousand — so a few hundred more is the arrangement it was built for, and no merge is written
 * here. What it still cannot see: a navigation the page makes by itself (a full-page link), and
 * every test that drives a page of its own rather than the shared one.
 */
type Collector = { readonly cdp: CDPSession; readonly tag: string; n: number; written: number };
const collectors = new WeakMap<Page, Collector>();

async function snapshot(page: Page): Promise<void> {
  const c = collectors.get(page);
  if (c === undefined) return;
  const { result } = (await c.cdp.send('Profiler.takePreciseCoverage')) as unknown as { result: (Entry & { scriptId: string })[] };
  const mine = result.flatMap((e) => {
    const asset = e.url.split('/assets/')[1];
    if (asset === undefined || !asset.endsWith('.js')) return []; // the index.html inline script, about:blank
    return [{ scriptId: '0', url: pathToFileURL(join(BUNDLE_HOME, asset)).href, functions: e.functions }];
  });
  c.n += 1;
  if (mine.length === 0) return;
  c.written += 1;
  await writeFile(join(v8Dir()!, `coverage-ui-${c.tag}-${c.n}.json`), JSON.stringify({ result: mine, timestamp: Date.now() }));
}

/** Start collecting on the gate's shared page. Inert unless this run is under `npm run coverage`. */
export async function startUiCoverage(page: Page, tag: string): Promise<void> {
  if (!uiCoverageWanted()) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  collectors.set(page, { cdp, tag, n: 0, written: 0 });
  for (const method of ['goto', 'reload', 'goBack', 'goForward'] as const) {
    const original = page[method].bind(page) as (...args: unknown[]) => Promise<unknown>;
    (page as unknown as Record<string, unknown>)[method] = async (...args: unknown[]) => {
      await snapshot(page);
      return original(...args);
    };
  }
}

/**
 * Take the last document's coverage and persist the bundle c8 will remap it through.
 *
 * `staticDir` is the directory the gate ran `vite build --outDir` into — it is read here and may be
 * deleted by the caller the moment this returns.
 */
export async function stopUiCoverage(page: Page, staticDir: string): Promise<void> {
  const c = collectors.get(page);
  if (c === undefined) return;
  await snapshot(page);
  await c.cdp.send('Profiler.stopPreciseCoverage');

  const assetDir = join(staticDir, 'assets');
  const assets = await readdir(assetDir);
  const maps = assets.filter((f) => f.endsWith('.js.map'));
  assert.ok(
    maps.length > 0,
    `${c.tag}: running under c8 (NODE_V8_COVERAGE is set) and the page bundle in ${assetDir} carries no ` +
      `source map, so every line the browser ran would be attributed to the bundle and then dropped by ` +
      `exclude-after-remap — the report would fall with nothing saying why. ` +
      `\`vite.config.ts\` emits one when TFLW_BUNDLE_SOURCEMAP=1; \`scripts/coverage.mjs\` sets it.`,
  );

  await mkdir(BUNDLE_HOME, { recursive: true });
  await cp(assetDir, BUNDLE_HOME, { recursive: true });
  // Absolutise against where vite built, before the caller deletes it. See the docblock.
  for (const name of maps) {
    const map = JSON.parse(await readFile(join(BUNDLE_HOME, name), 'utf8')) as { sources: string[] };
    map.sources = map.sources.map((src) => resolve(assetDir, src));
    await writeFile(join(BUNDLE_HOME, name), JSON.stringify(map));
  }
  assert.ok(c.written > 0, `${c.tag}: the page was driven under c8 and Chromium reported no bundle script at all`);
  console.log(`# ui coverage: ${c.tag} — ${c.written} document(s) of ${c.n} snapshot(s), one file each`);
}
