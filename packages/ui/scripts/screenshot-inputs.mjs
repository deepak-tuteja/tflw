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
export const DOCS_PAGE_DIR = join(REPO, 'packages', 'docs-site', 'public', 'page');
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
  'landing', // page/index.md — the four doors, counted against a real project
  'spine', //  page/spine.md — explorer, doorbar, tab strip, all at once
  'doors', //  page/doors.md — the doorbar with its per-door counts
  'compose', // page/doors.md — the authoring surface itself
  'run', //    page/a-run.md — a run read in place
]);

/** Every shot, by file name: one per view per theme. */
export const SHOTS = VIEWS.flatMap((view) => THEMES.map(([theme]) => `${view}-${theme}.png`));

/** The appearance a shot belongs to, for the `.light-only` / `.dark-only` class the markdown uses. */
export function appearanceOf(shot) {
  const found = THEMES.find(([theme]) => shot.endsWith(`-${theme}.png`));
  return found === undefined ? null : found[1];
}

function walk(dir, out) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
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
    ...walk(join(UI_ROOT, 'fixtures'), []),
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
