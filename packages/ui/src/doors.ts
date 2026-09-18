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
 * **The set is five, and all five are here** (`S5b`). Source, Compose and Run are the file's three
 * stages; **Auth** and **Config** are the rule's second clause — *a project fact that file
 * resolves against* — and they landed together with the `PUT /api/config` route they need
 * (`M205` Q5, closing `M205-03`).
 *
 * **Auth reads and Config writes, and that split is the rule's second clause doing work rather
 * than decorating it.** Both face `tflw.config`, so a naive reading makes them one tab; they are
 * two because they answer different questions about it. Auth answers *what is in force for this
 * file* — which sessions its tests run as, what each adds to a request, the targets a scan is
 * permitted to reach — which is a view **scoped to the selected file** and mostly not present in
 * the config's text at all. Config answers *what does this project declare*, which is the file.
 * There is still exactly **one editor** (the user's own refinement during the grilling: two
 * editors over one file is the drift class this codebase files most often), so everything
 * editable in Auth is a link into Config rather than a field.
 */
export const TABS = [
  { id: 'compose', label: 'Compose', blurb: 'the request and the assertions that read it' },
  { id: 'source', label: 'Source', blurb: 'the file itself — and, while you are composing, the bytes the write will produce' },
  { id: 'run', label: 'Run', blurb: 'what happened when this project last ran' },
  { id: 'auth', label: 'Auth', blurb: 'who this file’s tests run as, and what they are permitted to reach' },
  { id: 'config', label: 'Config', blurb: 'tflw.config — the project facts every file here resolves against' },
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
  const id = withoutQuery(hash).replace(/^#\/?/, '').split('/')[0] ?? '';
  return DOORS.some((d) => d.id === id) ? (id as Lens) : null;
}

/** The tab named by a location hash. `#/api` is `compose`, and so is a tab nobody has heard of —
 *  the same tolerance `doorFromHash` has, for the same reason. */
export function tabFromHash(hash: string): TabId {
  const id = withoutQuery(hash).replace(/^#\/?/, '').split('/')[1] ?? '';
  return TABS.some((t) => t.id === id) ? (id as TabId) : DEFAULT_TAB;
}

export const hashForDoor = (id: Lens | null): string => (id === null ? '#' : `#/${id}`);

/**
 * The address after the tab: the **file**, then optionally the line — `#/api/config/shop.tflw/L11`.
 *
 * `M206` `Q4`. Until this, a door change silently reset which file you were on: each form held its
 * own `useState(files[0] ?? '')`, so walking BROWSER → API → BROWSER returned you to the first file
 * in the project rather than the one you were reading. That is worst on the **145** tests the census
 * found behind more than one door, which are exactly the ones you walk between doors to look at.
 *
 * A file is a choice, so `D1045` covers it for the reason it already covers the door and the tab —
 * and it makes *this file's Auth tab* a link, which is what `S5b`'s `[edit]` buttons already promise
 * inside one door.
 *
 * **THE LINE IS READ OFF THE END, NOT OFF A FIXED INDEX, BECAUSE A FILE PATH HAS SLASHES.**
 * `tests/ui/storefront/login.tflw` is four segments, so "the file is segment three" is not a rule
 * this grammar can hold. The last segment is the line when it is `L` followed by digits, and
 * everything between the tab and it is the file. No `.tflw` path can collide with that pattern —
 * every one of them ends in `.tflw`. Encoding the slashes was the alternative and was refused: an
 * address a person cannot read is an address nobody will paste.
 */
/**
 * `@defaults` / `@<env>` — the **document** segment (`M208` `S2`, `Q2`).
 *
 * The Config tab is the one tab whose subject is not the addressed file: it renders `tflw.config`
 * while the hash names the `.tflw`. That is the rule's second clause working — Config is *a project
 * fact that file resolves against* — but it left no pattern for *which* project document Config
 * shows, and `M208` gives it a second one to show.
 *
 * **Named by env, not by filename.** A baseline is declared per env, the env is already a word in
 * the config, and an env name survives a rename of the JSON. A filename would not survive it, and
 * — worse — a filename may itself contain slashes, which is the exact problem the file slot below
 * had to solve and should not solve twice.
 *
 * **It cannot collide with a `.tflw` path**, which is what makes it readable off a position the
 * grammar cannot otherwise hold. `@` is not in the identifier class *and* the pattern forbids a
 * dot, while every test file's last segment ends in `.tflw` — so `tests/@local/login.tflw` has
 * `login.tflw` last and is a file, whole. Nor can it collide with `L<n>`, which is stripped first
 * and begins with a letter.
 */
const DOC_SEGMENT = /^@([A-Za-z_][A-Za-z0-9_-]*)$/;

/**
 * **The selection lives in the address too (`M209` `S4`, `D1066`)** — after a `?`, because it is a
 * *set* and the slash-separated part of this grammar is a path through one thing.
 *
 * Two things change what a run does: which files are selected and, from `S5`, what is searched for.
 * Both are addressable, so a link reproduces a run and a reload never silently empties the button —
 * which is the failure mode `D1066` is written against. Expansion is *not* here: it changes what
 * you can see and nothing about what runs, so every disclosure click would otherwise land in the
 * URL.
 *
 * A path is written as it is, with only `%` and `,` escaped — the separator and the escape. An
 * address a person cannot read is an address nobody will paste, and `%2F` on every segment of
 * every path would have made this one of those.
 */
export const SELECTION_KEY = 'files';

const withoutQuery = (hash: string): string => hash.split('?')[0] ?? '';

const escapePath = (p: string): string => p.replaceAll('%', '%25').replaceAll(',', '%2C');
const unescapePath = (p: string): string => p.replaceAll('%2C', ',').replaceAll('%25', '%');

/** The selected files an address names, in the order it names them. Empty for every address
 *  written before this slice, which is what *nothing selected* has always meant. */
export function selectionFromHash(hash: string): readonly string[] {
  const query = hash.split('?')[1];
  if (query === undefined) return [];
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq) !== SELECTION_KEY) continue;
    return part
      .slice(eq + 1)
      .split(',')
      .filter((x) => x !== '')
      .map(unescapePath);
  }
  return [];
}

/** The query the search box is holding (`M209` `S5`, `D1066`'s second half). `''` for an address
 *  that names none, which is every address written before that slice. */
export const QUERY_KEY = 'q';

export function queryFromHash(hash: string): string {
  const query = hash.split('?')[1];
  if (query === undefined) return '';
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq) !== QUERY_KEY) continue;
    return decodeURIComponent(part.slice(eq + 1).replaceAll('+', ' '));
  }
  return '';
}

/**
 * The `?files=…&q=…` tail — empty when neither is set, so an address that narrows nothing is
 * byte-identical to the address every link written before `S4` carries.
 *
 * The two things in it are the two things that change what runs (`D1066`). Everything else the
 * pane holds — which folders are open, which tab is marked — changes what you can *see*, and a
 * URL that moved on every disclosure click would be a URL nobody could compare to another.
 */
export const paneTail = (selection: readonly string[], query = ''): string => {
  const parts: string[] = [];
  if (selection.length > 0) parts.push(`${SELECTION_KEY}=${selection.map(escapePath).join(',')}`);
  if (query !== '') parts.push(`${QUERY_KEY}=${encodeURIComponent(query)}`);
  return parts.length === 0 ? '' : `?${parts.join('&')}`;
};


const afterTab = (hash: string): { file: string | null; doc: string | null; line: number | null } => {
  const rest = withoutQuery(hash).replace(/^#\/?/, '').split('/').slice(2).filter((s) => s !== '');
  const last = rest[rest.length - 1] ?? '';
  const m = /^L(\d+)$/.exec(last);
  const withoutLine = m ? rest.slice(0, -1) : rest;
  const docMatch = DOC_SEGMENT.exec(withoutLine[withoutLine.length - 1] ?? '');
  const parts = docMatch ? withoutLine.slice(0, -1) : withoutLine;
  return {
    file: parts.length === 0 ? null : parts.join('/'),
    doc: docMatch ? (docMatch[1] ?? null) : null,
    line: m ? Number(m[1]) : null,
  };
};

/**
 * A door, a tab, a file, a document and a line as one address (`D1045`; `M206` `Q4` added the file,
 * `M208` `S2` the document). The default tab writes the bare door hash **only when nothing follows
 * it** — with anything present the tab has to be spelled, or the next segment would be read as the
 * tab.
 *
 * The document sits between the file and the line because that is the order the address is read in:
 * *this file, in this project document, at this line*. A line is an offset into the document, not
 * into the file, the moment a document is named — which is why `[accept]` can send you to
 * `#/scan/config/shop.tflw/@local/L7` and mean line 7 of the baseline.
 */
export const hashForTab = (door: Lens, tab: TabId, file?: string | null, focusLine?: number, doc?: string | null): string => {
  const tail = `${file ? `/${file}` : ''}${doc ? `/@${doc}` : ''}${focusLine === undefined ? '' : `/L${focusLine}`}`;
  return tail === '' && tab === DEFAULT_TAB ? `#/${door}` : `#/${door}/${tab}${tail}`;
};

/**
 * The file a door is pointed at, or `null` for an address that names none — which is every address
 * anybody had before `M206`.
 *
 * It is deliberately **not** validated against the project here. A hash naming a file that has been
 * renamed or deleted is the same class as a hash naming a tab nobody has heard of, and `doors.ts`
 * answers that class the same way everywhere: report what the address says and let the caller fall
 * back. A module that returned `null` for an unknown file would need the project to answer, and
 * then the address's meaning would depend on what happens to be on disk.
 */
export const fileFromHash = (hash: string): string | null => afterTab(hash).file;

/**
 * The line a tab is asked to focus — `#/api/config/L12`, or `#/api/config/shop.tflw/L12`.
 *
 * `S5b`'s `[edit]` links are what need it: Auth shows a session and an authorized target as facts
 * and sends you to Config to change one, and *"lands in Config focused on that block"* is the
 * whole promise. Putting the target in the address rather than in a callback is `D1045` a third
 * time — the jump is linkable, the back button walks back out of it, and nothing new remembers
 * where you were going.
 *
 * `L`-prefixed so it cannot be read as a tab or a file, and a line number rather than a block name
 * because the declaration a reader wants is the one they are looking at: `tflw.config` may hold
 * two `authorized target` lines that differ only in their reason, and a name would send you to
 * whichever came first.
 */
export const focusFromHash = (hash: string): number | null => afterTab(hash).line;

/**
 * The project **document** the Config tab is asked to show — `defaults`, an env name, or `null` for
 * `tflw.config` itself (`M208` `S2`, `Q2`).
 *
 * `null` is what every address written before `M208` says, and it has to keep meaning what it meant:
 * `#/api/config/shop.tflw/L11` is `tflw.config` at line 11, exactly as it was. So the default is the
 * absence of the segment and not a spelled `@config`, which would have made every existing link
 * ambiguous about which document it named.
 *
 * Not validated against the config here, for `fileFromHash`'s reason: an env that has been renamed
 * is the same class as a tab nobody has heard of, and a module that answered `null` for an
 * undeclared env would need the project to answer, which would make an address's meaning depend on
 * what happens to be on disk.
 */
export const docFromHash = (hash: string): string | null => afterTab(hash).doc;

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
