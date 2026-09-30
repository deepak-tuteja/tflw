// Where the shell opens — `M240` `A` (`D1309`), closing `M239-09`; re-keyed by `M254` (`D1402`).
//
// **THE SHELL OPENS ON THE FILE YOU WERE ON, ELSE ON THE FILE WITH THE MOST TESTS IN IT.** Until
// `M240` the file a door opened on was `project.files[0]` — the first path in sort order, whatever it
// held. Measured on the dogfood (`REVIEW_ENTERPRISE_READINESS.md` U1): that was an action-only helper
// with **no test in it**. `M240` answered it per door; `M254` has no doors (`D1399`: a kind is a
// filter), so the rule is the same rule with the door's lens taken out of it.
//
// Everything here is a pure function of the project view and one remembered string, so
// `landingRule.test.ts` can ask it every shape without a browser. `App.tsx` is the one caller.
//
// **Two rules, in order.** A remembered file — the last one opened, in this browser, for this
// project — wins when it still exists. Otherwise the file with the most tests and crawls; ties break
// by path, so the answer is stable across reloads. A file that did not parse is left out, for
// `countsHonestly`'s reason: its test list is a salvage. A project whose every file declares nothing
// opens on its first file; only a project with no file at all opens on nothing. `D1402` also names
// *the first failed test of the newest run* between the two: that reads the verdict index, which is
// `M255`'s (`D1404`), and lands there.
//
// **The memory is per project, and the project is named by its root.** The key carries an eight-hex
// hash of `ProjectView.root` — computed synchronously (FNV-1a), because a landing that resolves on a
// later tick paints the rule's file and then jumps to the remembered one. `M240` kept one key per
// door; those four are read once as a fallback (in `api`, `browser`, `load`, `scan` order — which of
// them was written last is not knowable) and not written again.

import type { Lens, ProjectFile, ProjectView } from './contract';
import { countsHonestly } from './doors';
import type { FileOutline, OutlineDecl } from './outline';

/** Where the shell opens: a path, or nothing — a project with no file. */
export type Landing = { readonly path: string; readonly empty?: undefined } | { readonly empty: true; readonly path?: undefined };

/** How much a file declares: its tests and crawls, or `0` for a file that did not parse. */
export function declaredIn(file: ProjectFile): number {
  return countsHonestly(file) ? file.tests.length + file.crawls.length : 0;
}

/**
 * The file the shell opens on when the address names none — the remembered one when it still
 * exists, else the one declaring the most, else the first. `project.files` is in path order, which
 * is the tiebreak.
 */
export function landingFor(project: ProjectView, remembered: string | null): Landing {
  if (remembered !== null && project.files.some((f) => f.path === remembered)) return { path: remembered };
  let best: ProjectFile | null = null;
  let most = 0;
  for (const file of project.files) {
    const n = declaredIn(file);
    if (n > most) {
      most = n;
      best = file;
    }
  }
  const first = project.files[0];
  return best !== null ? { path: best.path } : first !== undefined ? { path: first.path } : { empty: true };
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

/** The one key a project's memory lives under (`M254`, `D1402`). */
export const landingKey = (hash: string): string => `tflw.ui.${hash}.lastFile`;

/** `M240`'s per-door keys — read once as a fallback, never written. */
const legacyKeys = (hash: string): readonly string[] => (['api', 'browser', 'load', 'scan'] as const satisfies readonly Lens[]).map((d) => `tflw.ui.${hash}.lastFile.${d}`);

/** Every key one project's memory may be under — what a test clears to see the rule instead. */
export const landingKeys = (hash: string): readonly string[] => [landingKey(hash), ...legacyKeys(hash)];

/** The last file opened for this project, or `null`. Storage is wrapped: a browser that refuses it
 *  (a private window, a policy) still gets the rule, never an exception. */
export function rememberedLanding(hash: string): string | null {
  try {
    const own = window.localStorage.getItem(landingKey(hash));
    if (own !== null) return own;
    for (const k of legacyKeys(hash)) {
      const v = window.localStorage.getItem(k);
      if (v !== null) return v;
    }
    return null;
  } catch {
    return null;
  }
}

export function rememberLanding(hash: string, path: string): void {
  try {
    window.localStorage.setItem(landingKey(hash), path);
  } catch {
    // Nothing to do: the rule answers next time, which is what a browser without storage gets anyway.
  }
}
