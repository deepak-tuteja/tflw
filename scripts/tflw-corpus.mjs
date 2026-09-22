// The `.tflw` corpus walk — `M215-01`, `M232` (`D1274`).
//
// **THIS EXISTS BECAUSE IT WAS WRITTEN EIGHT TIMES**, and the row that says so was filed as three,
// corrected to four, counted at five, and is **understated a third time by the build that closes
// it** — five recursive walks and three flat reads, in a row whose whole subject is that nobody
// knows how many copies there are. The flat three are `tflwIn` below; see its docblock for the two
// that carry the defect the guard exists for. The five were `lenses.test.ts`,
// `print.test.ts`, `outline.test.ts`, `highlight.test.ts` and `verify-fmt-roundtrip.mjs`, each
// with its own `readdirSync`, its own skip list and its own dot-prefix guard — and the guards had
// already drifted: four skipped dot-prefixed *entries* and the fifth (`highlight.test.ts`) skipped
// dot-prefixed *files* only, so that one descended into dot-directories the other four refused.
//
// **Unifying them was measured to move nothing**: all three distinct legacy shapes return the same
// 22 files as this walker, set-identical. That is worth stating because it is the reason this is a
// refactor and not a change — and because the drift above could have been a difference and was
// not, which is luck rather than design.
//
// The same measurement found `verify-fmt-roundtrip.mjs`'s `.checkonly/` counter unreachable twice
// over: no such directory exists anywhere in this repository, and the dot-prefix rule would skip
// it if one did. See `M232-01`.
//
// **A DOT-PREFIXED `.tflw` IS NOT PART OF THE AUTHORED CORPUS** (`M215`). `tflw ui`'s send writes
// `.scratch.tflw` into the project it is serving — that is what the button is FOR — and
// `examples/storefront` is both a served project and a root of this walk, so a person driving the
// page changed the census by pressing it. It cost three corpus failures and five `test:scripts`
// failures once, repaired by deleting the file; deleting a file the product writes on purpose is
// not a repair.
//
// **IT WALKS THE FILESYSTEM AND NOT `git ls-files`** (`D1275`). `scripts/exec.mjs` rsyncs this
// tree to the box **without `.git/`**, and `verify:fmt-roundtrip` runs there — a corpus declared
// over the tracked set has to be skipped by name on that machine, not resolved to zero, which is
// what `verify-corpora.mjs`'s `repoOrNull` already says. The dot-entry rule is what does the work
// `tracked` was being asked to do.
//
// A shared helper nobody is required to use does not answer *the day a sixth walk appears it will
// not have the guard*, so `scripts/corpus-walk.test.mjs` scans this repository's own source for a
// `readdirSync` reaching for `.tflw` outside this file — with a planted sixth walk as its negative
// control, because a source-scanning gate with no plant is a vacuity in a new costume.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Directories that hold copies rather than sources: dependencies, build output, pulled run
 * artefacts, coverage and scratch.
 *
 * The union of what the five walks skipped between them, which is safe in both directions and was
 * measured rather than assumed: `runs`/`coverage` sit at the repository root and never appear
 * under `packages/` or `examples/`, and no `report/` directory holds a `.tflw` file.
 */
export const SKIP_DIR = /^(node_modules|dist|runs|coverage|report)$/;

/**
 * Every authored `.tflw` file **directly in** `dir`, sorted, as absolute paths — no recursion.
 *
 * **THIS IS THE HALF THE ROW DID NOT COUNT.** `M215-01` was filed as three copies of the walk,
 * corrected to four, and counted at five; building it found **eight** places that read `.tflw` by
 * directory, because beside the five recursive walks sat three flat reads — `lenses.test.ts`'s
 * doors corpus and example, and `insert.test.ts`'s example — and none of them had the dot guard.
 *
 * Two of the three are exposed to exactly the defect the guard exists for. They read
 * `examples/storefront/tests`, and `playScratchOf` puts `▶`'s `.play.tflw` in **the file's own
 * directory** (`D1184`) — so pressing ▶ on an example test drops a `.tflw` into the corpus of two
 * gates, one of which (`insert.test.ts`) pins an **equality**. `SCRATCH_PATH` lands at the project
 * root and is what `M215` was written about; `PLAY_SCRATCH` lands deeper and arrived later.
 *
 * @param {string} dir
 * @returns {string[]}
 */
export function tflwIn(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.tflw') && !e.name.startsWith('.'))
    .map((e) => join(dir, e.name))
    .sort();
}

/**
 * Every authored `.tflw` file under `roots`, sorted, as absolute paths.
 *
 * Unreadable directories are skipped rather than thrown on: `print.test.ts` and `outline.test.ts`
 * point one of their roots at the sibling repository, which is **pressure and never a number**
 * (`D1056`) and is simply absent on a machine that has not checked it out.
 *
 * @param {readonly string[] | string} roots
 * @returns {string[]}
 */
export function tflwFiles(roots) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      // One guard, applied to directories and files alike — which is the drift this replaces.
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIR.test(entry.name)) continue;
        walk(join(dir, entry.name));
      } else if (entry.name.endsWith('.tflw')) {
        out.push(join(dir, entry.name));
      }
    }
  };
  for (const root of typeof roots === 'string' ? [roots] : roots) walk(root);
  return out.sort();
}
