// Where a door lands — `M240` `A` (`D1309`), closing `M239-09`.
//
// **A DOOR LANDS ON THE FILE WITH THE MOST OF WHAT THE DOOR IS ABOUT, AND REMEMBERS WHERE YOU WERE.**
// Until this round the file a door opened on was `project.files[0]` — the first path in sort order,
// whatever it held. Measured on the dogfood (`REVIEW_ENTERPRISE_READINESS.md` U1): the API door
// landed on `tests/api/admin/_auth.tflw`, an action-only helper with **no test in it**, and the
// BROWSER door on a file with **0** tests behind BROWSER. A door whose whole promise is *what am I
// here to do* (`D1042`) answered it with the first thing the filesystem sorted.
//
// Everything here is a pure function of the project view, the door and one remembered string, so
// `landingRule.test.ts` can ask it every shape without a browser. `App.tsx` is the one caller.
//
// Named `landingRule` and not `landing`: `Landing.tsx` is the landing *page*, and on a
// case-insensitive filesystem `./landing` resolves to it — `tsc` on the Mac reported `Landing` as a
// type where `App.tsx` uses the component, which is the collision made visible.
//
// **Two rules, in order.** A remembered file — the last one opened under this door, in this
// browser, for this project — wins when it still exists. Otherwise the file with the most tests
// whose derivation (`lensesOfTest`, carried on the wire as `ProjectTest.lenses`) includes the door's
// lens; a crawl counts for the door it is behind the same way; ties break by path, so the answer is
// stable across reloads. A file that did not parse is left out, for `countsHonestly`'s reason: its
// test list is a salvage and the landing must not be decided by a number that is not the project's.
//
// **The memory is per project, and the project is named by its root.** Two projects served on one
// browser would otherwise share `lastFile.api`, and the second would land on a path the first has.
// The key carries an eight-hex hash of `ProjectView.root` — computed synchronously (FNV-1a), which
// is the reason it is not SHA-256 through `crypto.subtle`: that call is asynchronous, and a landing
// that resolves on a later tick paints the rule's file and then jumps to the remembered one. The
// hash is a namespace and not a secret; a collision would share a memory between two roots, which
// the first rule already tolerates (a path the other project lacks falls through to the second).
//
// Not taken: deterministic-only landing (a reload drops you off your file, and the review measured
// that as the cost of every door change), and a door index page (a list of files is what the
// explorer already is).

import type { Lens, ProjectFile, ProjectView } from './contract';
import { countsHonestly, DOOR_BY_ID } from './doors';
import type { FileOutline, OutlineDecl } from './outline';

/** Where a door lands: a path, or nothing — a door with no test or crawl behind it in this project. */
export type Landing = { readonly path: string; readonly empty?: undefined } | { readonly empty: true; readonly path?: undefined };

/** How much of this door's kind of work a file holds: its tests and crawls behind the door's lens.
 *  Zero for a file that did not parse, whatever recovery salvaged — `countsHonestly`. */
export function behindDoor(file: ProjectFile, door: Lens): number {
  if (!countsHonestly(file)) return 0;
  let n = 0;
  for (const t of file.tests) if (t.lenses.includes(door)) n += 1;
  for (const c of file.crawls) if (c.lenses.includes(door)) n += 1;
  return n;
}

/**
 * The file a door opens on.
 *
 * `remembered` is what `rememberedLanding` read for this door, or `null`; it is a parameter rather
 * than a read inside so the rule is a function of its arguments. A remembered path that the project
 * no longer has (renamed, deleted, or another project's) falls through to the rule.
 */
export function landingFor(door: Lens, project: ProjectView, remembered: string | null): Landing {
  if (remembered !== null && project.files.some((f) => f.path === remembered)) return { path: remembered };
  let best: ProjectFile | null = null;
  let most = 0;
  for (const file of project.files) {
    const n = behindDoor(file, door);
    // `>` and not `>=`: `project.files` is in path order (`discoverTests` sorts), so the first of
    // two equals is the one that sorts first, and the tie rule costs no second comparison.
    if (n > most) {
      most = n;
      best = file;
    }
  }
  return best === null ? { empty: true } : { path: best.path };
}

/**
 * The declaration a file lands on when the address names no line (`M239-09`).
 *
 * **The first `test`, not the first declaration.** A file that opens with `before` or `after` used
 * to land on the hook — `addressed()` took `declarations[0]` — and the pane's first words were *a
 * request cannot be added to a hook from here*. A hook is reachable (its own row in the explorer,
 * its own line in the address) and is not where anyone arrives. A file with no test lands on its
 * first crawl, which the SCANS door draws; a file of hooks alone lands on its first hook, because
 * landing on nothing in a file that holds something would be the worse answer.
 */
export function landingDecl(outline: FileOutline): OutlineDecl | null {
  const decls = outline.declarations;
  return decls.find((d) => d.kind === 'test') ?? decls.find((d) => d.kind === 'crawl') ?? decls[0] ?? null;
}

/** Eight hex characters naming a project root — FNV-1a 32-bit over its UTF-16 code units. See the
 *  header for why this is not SHA-256. */
export function projectHash(root: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < root.length; i++) {
    h ^= root.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export const landingKey = (hash: string, door: Lens): string => `tflw.ui.${hash}.lastFile.${door}`;

/** The four keys one project holds — what a test clears to see the rule instead of the memory. */
export const landingKeys = (hash: string): readonly string[] => (Object.keys(DOOR_BY_ID) as Lens[]).map((d) => landingKey(hash, d));

/** The last file opened under this door for this project, or `null`. Storage is wrapped for
 *  `storedSize`'s reason: a browser set to block site data throws on access, and a page that cannot
 *  land because it cannot remember is the worse failure. */
export function rememberedLanding(door: Lens, hash: string): string | null {
  try {
    return window.localStorage.getItem(landingKey(hash, door));
  } catch {
    return null;
  }
}

export function rememberLanding(door: Lens, hash: string, path: string): void {
  try {
    window.localStorage.setItem(landingKey(hash, door), path);
  } catch {
    // a browser that will not remember still lands by the rule next time
  }
}
