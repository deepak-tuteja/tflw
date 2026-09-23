// What a docs picture of the page is cut from, and the hash that says whether it still describes
// this page (`M233` `A`, `D1283`).
//
// A screenshot is the one artefact that goes on describing a build that no longer exists without
// anyone touching it. Every other claim the docs site makes is checked against something —
// a construct against the manifest, an invocation against `CLI_FLAGS`, a sample against the
// shipped checker — and a PNG is checked against nothing at all. So the pictures are held by their
// *inputs*: this module hashes everything the generator reads, and the docs site's gate refuses a
// manifest whose hash has moved.
//
// THE HASH IS WIDER THAN IT LOOKS, ON PURPOSE. `M192` U8's draft hashed `ui/src`, `index.html`,
// two `results.json` and the two scripts — while its generator also read the whole fixture project,
// both report directories in full, and imported `ui-server.ts`. That is §0's first defect: **an
// input hash narrower than the picture it guards is a gate that goes green on a stale shot**, which
// is `M167`'s family and the exact failure this file exists to prevent. Everything the generator
// touches is here, and where a choice was available it was made wide:
//
//   - **all of `packages/cli/src`, not `ui-server.ts` alone.** The server is a module graph, and a
//     graph can grow a dependency without a hand-maintained list noticing. Nine files is cheap;
//     a list that silently stops covering the server is not.
//   - **all of `fixtures/`, not the two `results.json`.** The pictures render the project tree, the
//     config, the `.tflw` files and both runs. Every byte of that is in a picture somewhere.
//   - **`vite.config.ts` and `package.json`**, because the generator builds the bundle it shoots.
//
// The cost is stated rather than discovered: a change anywhere in `packages/cli/src` reddens the
// docs suite until the pictures are re-cut. `D1283` prices that against a picture that is wrong
// while every gate is green, and takes it.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
export const UI_ROOT = join(here, '..');
export const REPO = join(UI_ROOT, '..', '..');
/** Where the shots land. `public/ui/`, not `public/page/` — `D1293` moved the section, and
 *  leaving its pictures behind would re-create the two-names problem one directory down. */
export const DOCS_PAGE_DIR = join(REPO, 'packages', 'docs-site', 'public', 'ui');
export const MANIFEST = join(DOCS_PAGE_DIR, 'manifest.json');

/**
 * `D1282` — a picture ships as a light/dark pair, and the pair is two of the page's own four
 * themes rather than an invented pair. VitePress swaps them natively off the reader's appearance,
 * so the site documents the theme switcher by showing it.
 *
 * `terminal` is the page's default (`D1107`) and `paper` is the light one `M229` `A` re-solved
 * against a contrast floor. `instrument` and `ribbon` are not shot: they are dark like `terminal`,
 * so a third and fourth set would double the artefacts to say the same thing twice.
 */
export const THEMES = /** @type {const} */ ([
  ['terminal', 'dark'],
  ['paper', 'light'],
]);

/**
 * The views the `/page/` surface embeds, in the order its five pages use them. A view is named for
 * the question its page answers, not for the component it frames — `spine` is the shell, not
 * `App.tsx`, and it stays `spine` if the component is renamed.
 */
export const VIEWS = /** @type {const} */ ([
  'landing', //         ui/index.md   — the four doors, counted against a real project
  'spine', //           ui/spine.md   — explorer, doorbar, tab strip, all at once
  'doors', //           ui/spine.md   — the doorbar with its per-door counts
  'compose-api', //     ui/api.md     — an API test: request, assertions, response
  'compose-browser', // ui/browser.md — a browser test: steps a person would take
  'browser-menu', //    ui/browser.md — `+ step…`, where the 23 browser kinds are enumerated
  'compose-load', //    ui/load.md    — a load test: the plan panel its workload earned
  'compose-scan', //    ui/scans.md   — a scan test: the targets block its declaration earned
  'run', //             ui/a-run.md   — a run read in place
]);

/**
 * The window a view is shot in — `D1304`, built in `M234` `E`.
 *
 * `M233` `I` §6 named this and deferred it without the numbers. The numbers are now measured, and
 * they want the window moved in **opposite directions** for the two views that need it, which is
 * why one global constant could never have served both.
 *
 *   - **The four Compose views, shorter.** `[data-compose-pane]` is 705 css tall because the window
 *     is 900, and the door's `+` gestures are pinned to the pane's *bottom edge* — so the ink-trim
 *     in `cut()` correctly finds ink near the bottom and declines to crop, and the picture keeps
 *     ~300px of empty pane between the last statement and the gestures. Measured after `M234` `D`
 *     re-pointed the shoot at the example: **four of four** Compose shots come out at the full
 *     1060x690, where before `D` it was three of four. A shorter window is the only thing that
 *     closes that gap, because the gap is not something a crop can reach.
 *   - **`browser-menu`, taller.** `+ step…` enumerates **23** kinds
 *     (`ui-page.test.ts` pins `data-add-step-count` at exactly that). At 900 the dialog crops.
 *     `D1303` puts the completeness claim on this surface precisely because a file covering all 22
 *     browser kinds is ~23 rows and therefore too tall to photograph — so a cropped menu would
 *     lose the one picture that carries the claim, which is the whole point of shooting it.
 *
 * A view not named here is shot at `DEFAULT_VIEWPORT`. `spine` deliberately stays there: its scale
 * on the page is set by its **width** (1440 into VitePress's 688px column = 47.8%), and a shorter
 * window crops the shell rather than enlarging its type. `D1305`'s zoom is that view's answer.
 */
export const DEFAULT_VIEWPORT = { width: 1440, height: 900 };

export const VIEW_VIEWPORT = /** @type {const} */ ({
  'compose-api': { width: 1440, height: 560 },
  'compose-browser': { width: 1440, height: 560 },
  'compose-load': { width: 1440, height: 560 },
  'compose-scan': { width: 1440, height: 560 },
  'browser-menu': { width: 1440, height: 1220 },
});

/** The window `view` is shot in. */
export function viewportFor(view) {
  return VIEW_VIEWPORT[view] ?? DEFAULT_VIEWPORT;
}

/** The view a shot's file name belongs to — `browser-menu-paper.png` → `browser-menu`. */
export function viewOf(shot) {
  const found = THEMES.find(([theme]) => shot.endsWith(`-${theme}.png`));
  return found === undefined ? null : shot.slice(0, -`-${found[0]}.png`.length);
}

/**
 * The file each door's Compose shot opens, and **the reason there is a map here at all** (`M233`
 * `I`, `D1294` as amended).
 *
 * A door grants no panels — `D1044`, measured: `[data-compose]` reads `"request"` and the pane is
 * 1072 × 705 in all four doors, whichever one you arrive through. What differs is the *file*: a
 * workload line earns the plan panel, an authorized-target declaration earns the targets block,
 * and both show up behind every door once the file carrying them is open. So "the LOAD door's
 * Compose" is not a thing that can be photographed, and "a load test seen through the LOAD door"
 * is.
 *
 * Fallbacks rather than one name each, so a fixture rename degrades to a neighbour instead of
 * crashing the cut — the same reason `PREFERRED` exists, and the chosen file is printed for the
 * same reason: a picture of a different file is a picture of a different thing.
 */
/* `M234` `D-1` — **the corpus moved to `examples/storefront` and this is not a rename.** The four
   names here were the fixture project's, and the example has none of them, so the fallback chains
   above — written so that "a fixture rename degrades to a neighbour rather than to a crash" —
   could not have covered it: three of four doors would simply have thrown.

   Chosen on **legibility over completeness**, which is `D1303`'s own rule pointed at the shot
   instead of at the corpus. `fulfilment.tflw` and `receipt.tflw` fit the pane un-scrolled, so the
   api and browser pictures are of a *whole test*. `checkout.tflw` is the example's richest API file
   at 99 lines and was refused for exactly the reason `D1303` refused a 22-kind browser file: the
   file that shows the most is the one too tall to photograph.

   The lenses are the language's, derived with `lensesOfTest` **and `lensesOfCrawl`**. That second
   one matters: `scan.tflw`'s scan-ness lives in a `crawl`, in `program.crawls`, and a first pass
   that walked `program.tests` alone reported it as `api` — which would have filed the SCANS door's
   own declaration file behind the API door. It was implausible enough to check. A census that had
   answered *plausibly* would have been believed. */
export const DOOR_FILES = /** @type {const} */ ([
  ['api', ['tests/fulfilment.tflw', 'tests/checkout.tflw']], //    api            1 test,  20 lines
  ['browser', ['tests/receipt.tflw', 'tests/shelf.tflw']], //      browser        2 tests, 23 lines
  ['load', ['tests/load.tflw']], //                                api,load,scan  4 tests, 98 lines
  ['scan', ['tests/scan.tflw']], //                                api,scan       2 tests + a crawl
]);

/** Every shot, by file name: one per view per theme. */
export const SHOTS = VIEWS.flatMap((view) => THEMES.map(([theme]) => `${view}-${theme}.png`));

/** The appearance a shot belongs to, for the `.light-only` / `.dark-only` class the markdown uses. */
export function appearanceOf(shot) {
  const found = THEMES.find(([theme]) => shot.endsWith(`-${theme}.png`));
  return found === undefined ? null : found[1];
}

/* Names `walk` must not descend into or hash — `M234` `D-1`.
   `fixtures/` needed no such list; `examples/storefront` does, and every entry is a file that is
   **gitignored and machine-local**, so hashing it would make the manifest's input hash differ
   between two checkouts of the same commit. `report/` is the loudest: `npm run example` writes it
   on every local run, and the page's own `report/runs/` accumulates a timestamped directory per
   `tflw ui` session — nine of them on the machine this was written on. */
const NOT_AN_INPUT = new Set(['report', 'node_modules', '.scratch.tflw']);

function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (NOT_AN_INPUT.has(entry.name)) continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Every file the pictures depend on, repo-relative and sorted, so the hash is stable across machines. */
export function screenshotInputs() {
  const files = [
    ...walk(join(UI_ROOT, 'src'), []),
    /* `M234` `D-1` — **`fixtures/` left this list because the generator stopped reading it.**
       The shoot now copies `examples/storefront` and `fixtures/example-reports`; `fixtures/project`
       and `fixtures/reports` remain the page gate's corpus and are untouched by this round, but
       they are no longer in any picture. Keeping them here would be the *inverse* of the defect the
       docblock above describes: not a hash narrower than the picture, which goes green on a stale
       shot, but wider than it, which reddens the docs suite for an edit no picture can show. The
       cheaper mistake of the two, still a mistake. */
    ...walk(join(UI_ROOT, 'fixtures', 'example-reports'), []),
    ...walk(join(REPO, 'examples', 'storefront'), []),
    ...walk(join(REPO, 'packages', 'cli', 'src'), []),
    join(UI_ROOT, 'index.html'),
    join(UI_ROOT, 'vite.config.ts'),
    join(UI_ROOT, 'package.json'),
    join(here, 'make-screenshots.mjs'),
    join(here, 'screenshot-inputs.mjs'),
  ];
  return [...new Set(files.map((f) => relative(REPO, f).split('\\').join('/')))].sort();
}

export function screenshotInputsHash() {
  const h = createHash('sha256');
  for (const rel of screenshotInputs()) {
    h.update(rel + '\n');
    h.update(readFileSync(join(REPO, rel)));
    h.update('\n');
  }
  return h.digest('hex');
}

export function shotExists(name) {
  try {
    return statSync(join(DOCS_PAGE_DIR, name)).isFile();
  } catch {
    return false;
  }
}
