// The four doors (`D1042`), and the rule that a door decides a landing surface and nothing else.
//
// A DOOR IS A KIND OF WORK, NOT A KIND OF TEST. It answers *what am I here to do* — the only
// surface tflw has ever had that tells a newcomer what the tool is for — and then it offers a
// project. What it decides is where you land and what "new test" scaffolds. It decides nothing
// about what a test may contain and nothing about which panels a test shows (`D1044`): a test
// carrying a workload line shows its workload panel in every door, because the panel is earned by
// the construct and not granted by the door you came through.
//
// A TEST IS NOT FILED UNDER ONE. `lensesOfTest` derives every lens a test qualifies for from its
// own constructs (`D1043`), so a test appears behind every door whose work it does. Measured over
// both repositories: **231 of 761 tests — 30.4% — appear behind more than one**, which is the
// whole of why the doors are not four folders.
//
// THE CHOICE LIVES IN THE URL, NOT IN THE PROJECT. `D1045` forbids sidecar state, and a door is a
// view of a project rather than a fact about one. The hash carries it, so a door is shareable and
// survives a reload without a byte being written anywhere.
import type { Lens, ProjectView } from './contract';

export interface Door {
  readonly id: Lens;
  readonly label: string;
  /** What this door is for, in the words a newcomer needs before they have a vocabulary. */
  readonly blurb: string;
  /** The reference the grilling named for this door's surface — kept because it is the fastest
   *  way to say what the pane will feel like, and because each was the user's own word. */
  readonly like: string;
}

export const DOORS: readonly Door[] = [
  { id: 'api', label: 'API', blurb: 'call an endpoint, assert what comes back, chain one call into the next', like: 'like Bruno — files on disk, git-friendly, no cloud' },
  { id: 'browser', label: 'BROWSER', blurb: 'drive a real page: click, fill, and assert what a person would see', like: "like Playwright's inspector" },
  { id: 'load', label: 'LOAD', blurb: 'run the work you already wrote at a rate, and hold it to a threshold', like: 'like JMeter, minus the tree' },
  { id: 'scan', label: 'SCANS', blurb: 'crawl a surface and judge every response against a severity bar', like: 'a scanner' },
];

export const DOOR_BY_ID: Readonly<Record<Lens, Door>> = Object.fromEntries(DOORS.map((d) => [d.id, d])) as Readonly<Record<Lens, Door>>;

/**
 * The tabs over one file, `M205` §2 — and the rule they are kept to:
 *
 * > **A tab is a stage of one file's life — read it, write it, run it — or a project fact that
 * > file resolves against. A tab never changes which file it is.**
 *
 * It earns its place the way `D1042` does, by refusing rather than describing: a tab that opens a
 * different file (that is the explorer's job), a tab per kind of test (that is a door), and a tab
 * that is neither a stage nor a dependency — *History*, *Docs*, *Coverage* — are all refused by
 * it. Adopted **provisionally** for the API door and reopened if BROWSER, LOAD or SCANS cannot be
 * accommodated, because a rule carrying exceptions from the start is a description.
 *
 * The strip faces the **file**, never the door and never the run: two of the five are
 * project-scoped whatever you choose, and a file-scoped strip needs no new state because the
 * selected file already exists.
 *
 * **The set is five and three of them are here.** Source, Compose and Run are the file's three
 * stages and land together because each is meaningless without the others; **Auth** and **Config**
 * are the rule's second clause — a project fact the file resolves against — and land with the
 * `PUT /api/config` route they need (`M205` Q5, `M205-03`). This list is what is built, not what
 * is decided, so a reader counting three here is reading the truth rather than a stale sentence.
 */
export const TABS = [
  { id: 'compose', label: 'Compose', blurb: 'the request and the assertions that read it' },
  { id: 'source', label: 'Source', blurb: 'the file itself — and, while you are composing, the bytes the write will produce' },
  { id: 'run', label: 'Run', blurb: 'what happened when this project last ran' },
] as const;

export type TabId = (typeof TABS)[number]['id'];

/** Where the strip opens. Compose, because arriving at a door is arriving to write something —
 *  the door's whole promise (`D1042`) is the surface its "new test" button lands you on. */
export const DEFAULT_TAB: TabId = 'compose';

/**
 * The door named by a location hash, or null for the landing page. Anything unrecognised is the
 * landing page too — a hand-typed hash is not an error worth a message.
 *
 * `#/api` and `#/api/source` are the same door: the tab is a second segment, so adding the strip
 * did not change what any existing link means. That is checked rather than asserted — `M205` S5's
 * gate re-reads every pre-strip hash.
 */
export function doorFromHash(hash: string): Lens | null {
  const id = hash.replace(/^#\/?/, '').split('/')[0] ?? '';
  return DOORS.some((d) => d.id === id) ? (id as Lens) : null;
}

/** The tab named by a location hash. `#/api` is `compose`, and so is a tab nobody has heard of —
 *  the same tolerance `doorFromHash` has, for the same reason. */
export function tabFromHash(hash: string): TabId {
  const id = hash.replace(/^#\/?/, '').split('/')[1] ?? '';
  return TABS.some((t) => t.id === id) ? (id as TabId) : DEFAULT_TAB;
}

export const hashForDoor = (id: Lens | null): string => (id === null ? '#' : `#/${id}`);

/** A door and a tab as one address, so a jump between tabs is linkable and the back button works
 *  (`D1045` again — the choice lives in the URL and nowhere else). The default tab writes the bare
 *  door hash, so the commonest address stays the short one. */
export const hashForTab = (door: Lens, tab: TabId): string => (tab === DEFAULT_TAB ? `#/${door}` : `#/${door}/${tab}`);

/** Every test and crawl behind each door, derived. A test behind two doors is counted by both —
 *  that is `D1043` working, not a double count to be corrected. */
export function countByDoor(project: ProjectView | null): Readonly<Record<Lens, number>> {
  const counts: Record<Lens, number> = { api: 0, browser: 0, load: 0, scan: 0 };
  for (const file of project?.files ?? []) {
    for (const t of file.tests) for (const lens of t.lenses) counts[lens] += 1;
    for (const c of file.crawls) for (const lens of c.lenses) counts[lens] += 1;
  }
  return counts;
}

/** Tests carrying no construct any door is about. Counted so the landing can say so: a test that
 *  is behind no door is a test nobody will find again unless the page admits it exists. */
export function lenslessCount(project: ProjectView | null): number {
  let n = 0;
  for (const file of project?.files ?? []) for (const t of file.tests) if (t.lenses.length === 0) n += 1;
  return n;
}
