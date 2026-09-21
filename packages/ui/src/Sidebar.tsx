// The project pane — a **file tree** since `M209` `S3`, after three rounds of being a list of tests
// with the files as headings (`M192` U2, narrowed to a door by `M200` `A0-3`, freed of the run
// controls by `M209` `S1`).
//
// IT LISTS THE PROJECT AND DOES NOT ASSEMBLE A COMMAND. `env`, `workers` and the run button moved
// to `RunStrip` (`M205` Q12). What is left here is the narrowing itself — which files, which tags —
// and the narrowing is a fact about the *project* that the strip reads back as a label.
//
// A ROW IS A FILE (`D1061`). The sibling's 84 files at ~22 px are two screens with nothing
// engineered; the 389 rows and 20,726 px this pane used to measure were entirely the test rows
// spliced under each file, and per-test running never existed — `data-file-check` has been on
// files since `M192` U2, so moving those rows to Source's index (`S2`, `D1067`) cost display and
// not capability.
//
// EVERY `.tflw` FILE IS HERE, TESTS OR NOT (`D1062`). Six files in the sibling declare nothing —
// they are the fragments every other file resolves against — and until this slice they were in no
// list, so they could not be opened, read or edited anywhere on the page. A list of *tests* may
// omit them. A *file tree* that omits them is lying about the project.
//
// THE DOOR IS A COUNT, NOT A FILTER (`D1063`). Rows are files now, so there is nothing left for a
// door to narrow: the shape is byte-identical behind all four. What changes is the number on the
// row and whether the row is dimmed — and dimming rather than hiding means a file never vanishes
// under you, and *nothing here does load testing* stays a readable fact about a project rather
// than an empty pane.
//
// THREE COUNTS, NOT TWO (`D1068`). `n` is *this many behind this door*, `0` is *has tests, none of
// them here* and is dimmed, and `—` is *declares nothing by nature* and is not. Without the third,
// `D1062` and `D1063` together would have greyed out the six most-depended-on files in the project
// on every screen forever. A file that is **broken** keeps its `data-diagnostics` badge and is not
// mistaken for a fragment.
//
// CLICK OPENS **AND** SELECTS (`M205` Q13/Q13a, built by `M209` `S4`). A plain click is the whole
// gesture: it points the tabs at the file and makes the selection that one file. `cmd`/`ctrl`
// extends by one and `shift` extends to a range, and **neither changes which file the tabs are
// facing** — extending a selection is a statement about what will run, and moving the subject out
// from under a reader who is mid-range is not part of it. That is also why a folder's plain click
// expands and its `cmd`-click selects its files (`D1069`): `tflw run` refuses a directory by
// decision (`cli.ts:281`), so a folder can only ever *mean* the files under it.
//
// SEARCH IS ONE BOX AND TWO KINDS OF QUERY (`M209` `S5`, `D1064`). The 84 tag chips this pane used
// to carry are folded into it (`M205` Q12). A `@tag` query narrows the tree **and** the run,
// because `--tag` is the language's own narrowing; a plain-text query narrows the tree only and
// runs whole files, because no flag matches a name. The page says which of the two it is doing —
// that sentence is `D1064`'s accepted cost, and `search.ts` is where the rule lives.
//
// THE OPEN FILE'S ROW OPENS ONTO ITS OUTLINE (`M210` `S1`, `D1081`). Under one file — the one the
// tabs are facing — the tree goes on: its hooks and tests, and under each of those its requests.
// The outline lives here rather than in a column of its own because the Compose pane is 1080 px
// and its expectation row already uses 1046 of them, and because clicking a request then IS the
// gesture that clicks a file. Its cost was forecast in the plan's §1 and then **measured on the
// built page**, which is the version worth keeping: on `tests/mixed/storefront.tflw` at 1440×900,
// a request label has at most 184 px and **2 of 36 are ellipsised**, while **16 of 17 declaration
// labels are** — the forecast said request rows fit and test rows truncate, and both halves hold.
// That is `M205`'s already-measured wrapping problem (378 of 389 rows at 647 px tall) arriving in a
// new place rather than a new one, and it is ellipsised rather than wrapped for the same reason:
// the full name is on the row's `title` and in the band above the card, so nothing is lost but
// width. Nothing overflows the pane horizontally at any depth.
//
// ONLY THE OPEN FILE EXPANDS, and that is what keeps it affordable: an outline under all 84 rows is
// the 26-screen sidebar this pane spent three rounds escaping.
//
// EXPANSION IS INFERRED AND IS NOT IN THE ADDRESS (`D1066`). The tree opens whole — 84 rows is the
// measurement above, not a problem to be folded away — and what a reader collapses is theirs for
// the session. The one thing that is forced is the open file's own path: an address naming a file
// inside a folder somebody collapsed must still show it, or the link is broken.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { menuTrigger, type MenuItem, type MenuRequest } from './ContextMenu';
import type { Lens, ProjectFile, ProjectView } from './contract';
import { DOOR_BY_ID } from './doors';
import { matchingFiles, parseQuery, projectTags, taggedTestCount } from './search';
import type { FileOutline, OutlineCrawl, OutlineHook, OutlineTest } from './outline';

/**
 * **`+` on a row of the explorer** — `M217` `D` (`D1139`, `D1140`).
 *
 * **A sibling of the row and never inside it**, because both rows the explorer draws *are*
 * `<button>`s and a button cannot hold another one. So each becomes a flex pair, which is the
 * shape `.seq-row` has used for its `✕` since `M214`.
 *
 * **Always drawn, never revealed on hover** (`D1140`). The declaration rows are the most starved
 * text on the page — `.outline-name` gets 182 px for names whose natural width is 361–596 px — and
 * this takes about 20 px of exactly that. Measured, it costs almost nothing that was not already
 * gone: **5 of 5** names in `tests/checkout.tflw` are cut at 182 px and all five are still cut at
 * 162, so the count of names going from whole to truncated is **zero**, and what is lost is about
 * two characters on names that already ended in an ellipsis. Since `M216` the reader can drag the
 * pane to 720 px and buy back far more than the 20 px ever cost.
 *
 * The alternative was a hover reveal, which fails twice here and both failures are already written
 * down in this repository: `Grip.tsx`'s own docstring says *a control that only a mouse can reach
 * is a control some readers do not have*, and the whole reason this exists is that nobody could
 * find where a test comes from — a `+` invisible until you are already pointing at the row
 * announces nothing.
 */
function RowPlus({ onGo, label, kind }: {
  readonly onGo: () => void;
  readonly label: string;
  readonly kind: string;
}) {
  return (
    <button type="button" className="row-plus" onClick={onGo} data-row-plus={kind} data-tip={label} aria-label={label}>
      +
    </button>
  );
}

export interface SidebarProps {
  readonly project: ProjectView;
  /** The door the reader came through — which counts this pane shows. It narrows nothing. */
  readonly door: Lens;
  /** The file the tabs are facing, from the address. Its folders are open whatever else is not. */
  readonly openFile: string | null;
  /** What will run, in the order the address names it (`D1066`). */
  readonly selection: readonly string[];
  /**
   * One gesture, one call: the next selection, and the file to open or `null` for *leave the
   * subject where it is*. Two callbacks would be two writes to the address, and the second would
   * rebuild it from the state it closed over — which is exactly how the first draft of this slice
   * emptied the selection on every plain click.
   */
  readonly onPick: (selection: readonly string[], open: string | null) => void;
  /** What the search box holds — in the address, like the selection (`D1066`). */
  readonly query: string;
  readonly onQuery: (query: string) => void;
  /** The open file, read (`D1081`). `null` while the shell is reading it, or when the address
   *  names no file — the row then draws as it always has. */
  readonly outline: FileOutline | null;
  /**
   * **Which files have unsaved edits** — `M217` `C` (`D1143`).
   *
   * Empty until `D1142`, because there was nothing to say: a draft died the moment you looked at
   * another file, so *unsaved* was a property of the open pane and of nothing else. Now a reader
   * can hold pending edits in three files at once and only the open one would say so, which is how
   * work gets left behind — and a draft left long enough eventually meets a file somebody else
   * changed and becomes a `409` a long way from where it was made.
   */
  readonly unsaved: ReadonlySet<string>;
  /**
   * **`+` on a file row: another test in THAT file** — `M217` `D` (`D1139`).
   *
   * **It builds nothing.** It opens the file and opens the dialog the sequence column's
   * `+ new test` opens, which is what keeps `D1087`'s one construction path intact: the explorer
   * knows nothing about `.tflw` and holds no form. It carries you to the place and presses the
   * button.
   *
   * `D1118` said *creation where the thing is created* and put `+ new file` in this very pane, so
   * the explorer already creates; what it forbade was a **toolbar**, a row of create buttons at
   * the top of Compose detached from what they make. A `+` welded to `checkout.tflw`'s own row is
   * the opposite of that. `D1139` adds one sentence to `D1118`: a create gesture may live on the
   * row that represents its subject.
   *
   * Measured before it was built: `+ new test` is two clicks away from any file, and its top sits
   * at **y = 853 in a 900 px window** — visible in the sense that a footer is visible. This saves
   * one click; what it buys is that the gesture is where a reader looks for it.
   */
  readonly onNewIn: ((path: string) => void) | null;
  /**
   * **`+` on a test row: another request in THAT test** — `M217` `D` (`D1139`).
   *
   * Addressed by the declaration's **index**, not its line, for the reason every other edit on this
   * project is: `insertIntoSource` formats before it splices and a line moves under `format`.
   *
   * The outline is spliced under the **open file only** (measured: `checkout.tflw` 6 declaration
   * rows, every other file 0), so this never has to navigate between files — which is also why its
   * honest justification is symmetry with the row above it and proximity to the list a reader is
   * actually scanning, and not the cross-file shortcut the first framing claimed.
   */
  readonly onAddRequest: ((declIndex: number) => void) | null;
  /** Which request the address is pointing at (`D1080`) — a line, not an identity. */
  readonly focusLine: number | null;
  /** Clicking a request writes `L<line>` and nothing else: it does not change the file, because
   *  the request is *in* the file the tabs already face. */
  readonly onLine: (line: number) => void;
  /**
   * **`+ new file`** — `M214` `A6` (`D1118`).
   *
   * *"Why no option to add a new file in this sidebar/project explorer"* was the fifth of the five
   * complaints, and the answer was that the button existed — in the **Compose head**, a toolbar
   * over a pane about one declaration, two regions away from the list of files it makes another of.
   * Creation lives where the thing is created. The dialog itself is the shell's, because this pane
   * and Compose are siblings and both ask for it.
   */
  readonly onNew: ((mode: 'test' | 'file') => void) | null;
  /**
   * **What this row can do** — `M218` `B` (`D1148`, `D1149`).
   *
   * Called at open time, never on render: a project with 275 files renders 275 rows and builds
   * zero item lists until somebody right-clicks one.
   */
  readonly menuFor: ((t: MenuTarget) => readonly MenuItem[]) | null;
  /** Hand the built menu to the shell, which owns the single open-menu slot (`D1145`). */
  readonly onMenu: ((r: MenuRequest) => void) | null;
}

/**
 * What a right-clicked row *is* — `M218` `B`.
 *
 * The explorer describes its row and hands it over; the shell decides what can be done to it. That
 * split is `D1148` in the type system: this pane knows nothing about `.tflw`, holds no form and
 * builds no source, so a menu item can never become a second construction path by being added
 * here. It is the same division `M217` already drew for `+` — *"it carries you to the place and
 * presses the button"*.
 *
 * A `dir` carries its own `onToggle` because folding is this pane's local state and nothing
 * outside it can perform that one.
 */
export type MenuTarget =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'dir'; readonly path: string; readonly files: readonly string[]; readonly expanded: boolean; readonly onToggle: () => void }
  | { readonly kind: 'test'; readonly declIndex: number; readonly line: number; readonly name: string }
  | { readonly kind: 'request'; readonly line: number; readonly method: string; readonly path: string };

/** Above this many tags the cloud opens folded: `M192` U7 found the dogfood's 90 tags pushing all
 * 84 files below the first screen, and a file list nobody can see is not a project view. The
 * fixture has five, so the fold's threshold is exercised only by the dogfood (§10). */
export const FOLD_TAGS_ABOVE = 24;

/** One node of the tree. A directory has children and no file; a file has a file and no children. */
interface TreeNode {
  readonly name: string;
  readonly path: string;
  readonly children: TreeNode[];
  file?: ProjectFile;
}

/**
 * The paths as a tree. Sorted directories first, then files, each alphabetically — the order a
 * file manager uses, and the one that keeps a folder's contents together on the screen.
 *
 * `path` on a directory node is its own path, because that is what a collapse is remembered by and
 * what `D1069` will pass to a run: a folder means its files, expanded by the page, since `tflw run`
 * refuses a directory by decision (`cli.ts:281`).
 */
export function buildTree(files: readonly ProjectFile[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', children: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let at = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join('/');
      let next = at.children.find((c) => c.path === path && c.file === undefined);
      if (!next) {
        next = { name: parts[i]!, path, children: [] };
        at.children.push(next);
      }
      at = next;
    }
    at.children.push({ name: parts[parts.length - 1]!, path: f.path, children: [], file: f });
  }
  const sort = (n: TreeNode): void => {
    n.children.sort((a, b) => {
      const dirA = a.file === undefined ? 0 : 1;
      const dirB = b.file === undefined ? 0 : 1;
      return dirA !== dirB ? dirA - dirB : a.name.localeCompare(b.name);
    });
    for (const c of n.children) sort(c);
  };
  sort(root);
  return root.children;
}

/** Every file under a node, in tree order — what a folder *means* (`D1069`). */
export function filesUnder(node: TreeNode): string[] {
  return node.file ? [node.path] : node.children.flatMap(filesUnder);
}

export function Sidebar({ project, door, openFile, selection, onPick, query, onQuery, outline, unsaved, onNewIn, onAddRequest, focusLine, onLine, onNew, menuFor, onMenu }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  /** Where a `shift` range starts. A gesture detail and not a fact about the project, so it is
   *  neither in the address nor anywhere durable — `D1066` addresses what changes a run. */
  const [anchor, setAnchor] = useState<string | null>(null);

  const tree = useMemo(() => buildTree(project.files), [project.files]);

  /** The address wins over a collapse: opening a file inside a folder somebody closed opens it. */
  useEffect(() => {
    if (openFile === null) return;
    const parts = openFile.split('/').slice(0, -1);
    const ancestors = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
    setCollapsed((prev) => {
      if (!ancestors.some((a) => prev.has(a))) return prev;
      const next = new Set(prev);
      for (const a of ancestors) next.delete(a);
      return next;
    });
  }, [openFile]);

  const parsed = useMemo(() => parseQuery(query, project), [query, project]);
  const matched = useMemo(() => matchingFiles(project, parsed), [project, parsed]);
  const allTags = useMemo(() => projectTags(project), [project]);

  const toggle = <T,>(set: ReadonlySet<T>, v: T): Set<T> => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  const testCount = project.files.reduce((n, f) => n + f.tests.filter((t) => t.lenses.includes(door)).length + f.crawls.filter((c) => c.lenses.includes(door)).length, 0);
  const otherCount = project.files.reduce((n, f) => n + f.tests.length, 0) - project.files.reduce((n, f) => n + f.tests.filter((t) => t.lenses.includes(door)).length, 0);

  /** Every file in tree order — what `shift` ranges over. The WHOLE tree, not the visible part:
   *  a range that skipped a collapsed folder would select a different set depending on what
   *  somebody had disclosed, and the selection is in the address while the disclosure is not. */
  const order = useMemo(() => tree.flatMap(filesUnder), [tree]);
  const chosen = useMemo(() => new Set(selection), [selection]);

  /** One call per row kind — `null` props mean the shell has not wired a menu, and the rows then
   *  behave exactly as they did before `M218`. */
  const rowMenu = (t: MenuTarget, subject: string) =>
    menuFor === null || onMenu === null
      ? {}
      : menuTrigger(onMenu, () => ({ kind: t.kind, subject, items: menuFor(t) }));

  /** Keep the address's order stable: a selection is rewritten in tree order every time, so the
   *  same set of files is always the same link. */
  const inOrder = (paths: Iterable<string>): string[] => {
    const set = new Set(paths);
    return order.filter((p) => set.has(p));
  };

  const pick = (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }, paths: readonly string[], subject: string | null): void => {
    if (e.shiftKey && anchor !== null) {
      const from = order.indexOf(anchor);
      const to = order.indexOf(paths[paths.length - 1] ?? anchor);
      if (from >= 0 && to >= 0) {
        const [lo, hi] = from <= to ? [from, to] : [to, from];
        onPick(inOrder([...selection, ...order.slice(lo, hi + 1)]), null);
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selection);
      const adding = paths.some((p) => !next.has(p));
      for (const p of paths) {
        if (adding) next.add(p);
        else next.delete(p);
      }
      onPick(inOrder(next), null);
      setAnchor(paths[paths.length - 1] ?? null);
      return;
    }
    // A plain click is the whole gesture: this is the selection, and this is what the tabs face.
    onPick(inOrder(paths), subject);
    setAnchor(paths[0] ?? null);
  };

  /**
   * The open file's own tree (`D1081`) — its hooks and tests, and under each the requests.
   *
   * It is the SAME LIST `SourcePanel`'s index draws (`D1067`) and a different question: the index
   * answers *what does this file declare*, in the file's own order, for a reader of the text. This
   * answers *what can Compose put on screen*, which is one level lower, because `D1073`'s unit is a
   * request. Neither is derived from the other and both are derived from the file, so there is no
   * copy here to go stale — this one is parsed in the browser from the bytes the shell read.
   *
   * A declaration with no request still gets a row. A browser test seen from here is exactly that,
   * and a tree that listed only the declarations with requests in them would be the door filtering
   * the project, which `D1063` settled one round ago: the door is a count, never a filter.
   */
  const renderOutline = (o: FileOutline): ReactElement => (
    <ul className="tree outline" data-outline={o.declarations.length}>
      {o.declarations.map((decl: OutlineHook | OutlineTest | OutlineCrawl) => (
        <li key={`${decl.kind}-${decl.line}`} data-outline-decl={decl.kind} data-outline-line={decl.line}>
          <div className="row-pair">
          <button
            type="button"
            className={`outline-row${decl.body.requests.some((r) => r.line === focusLine) || decl.line === focusLine ? ' on' : ''}`}
            onClick={() => onLine(decl.line)}
            data-outline-goto={decl.line}
            data-tip-derived=""
            {...(decl.kind === 'test'
              ? rowMenu({ kind: 'test', declIndex: decl.index, line: decl.line, name: decl.name }, decl.name)
              : {})}
          >
            <span className="ln muted">{decl.line}</span>
            {/* **The kind is a chip, not a guess from the prose** (`M216`). A request row under this
                one has read `POST` + path since `D1081` — a coloured word for what it is and the
                rest in code font — and the declaration row above it carried neither, so the one row
                a reader scans for was the only row with no shape. It is the SAME `seq-kind` class
                the Compose sequence already draws, deliberately: three surfaces now show a
                declaration and a fourth spelling of the same idea is how they drift apart. */}
            {/* `M228` `C` (`D1238`) — a crawl is a declaration this tree draws now. It had been
                counted by the badge above and drawn by nothing, so `scan.tflw` read **1** and
                listed **2**, and only on the door the crawl is the whole point of. */}
            <span className="seq-kind">{decl.kind === 'hook' ? decl.label : decl.kind}</span>
            {decl.kind === 'hook' ? <em className="outline-name" /> : <span className="outline-name" data-tip-text>{decl.name}</span>}
          </button>
          {/* **A hook gets none, and that is the language rather than a gap** (`D1144`). The splice
              addresses a test BY NAME and a hook has none — the sequence column already says so
              where its own buttons would be, and saying nothing here is better than drawing a `+`
              that refuses. */}
          {onAddRequest === null || decl.kind !== 'test' ? null : (
            <RowPlus kind="request" onGo={() => { onLine(decl.line); onAddRequest(decl.index); }} label={`a new request in “${decl.name}”`} />
          )}
          </div>
          {decl.body.requests.length === 0 ? null : (
            <ul className="tree">
              {decl.body.requests.map((r) => (
                <li key={r.line} data-outline-request={r.line}>
                  <button
                    type="button"
                    className={`outline-row request${focusLine === r.line ? ' on' : ''}`}
                    onClick={() => onLine(r.line)}
                    data-outline-goto={r.line}
                    data-tip-derived=""
                    data-outline-method={r.method}
                    aria-pressed={focusLine === r.line}
                    {...rowMenu({ kind: 'request', line: r.line, method: r.method, path: r.path }, `${r.method} ${r.path}`)}
                  >
                    <span className={`method m-${r.method.toLowerCase()}`}>{r.method}</span>
                    <code className="outline-name" data-tip-text>{r.path}</code>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );

  const renderNode = (node: TreeNode): ReactElement => {
    if (node.file) {
      const f = node.file;
      const total = f.tests.length + f.crawls.length;
      const behind = f.tests.filter((t) => t.lenses.includes(door)).length + f.crawls.filter((c) => c.lenses.includes(door)).length;
      // `D1068`'s three states. `—` is not a zero: it says *declares nothing by nature*, which is
      // a different fact from *has tests, none of them behind this door* and must not be dimmed.
      const state = total === 0 ? 'fragment' : behind === 0 ? 'none' : 'some';
      // Dimmed rather than hidden, for `D1063`'s reason a second time: a file that vanishes as you
      // type is a file you cannot be sure is still there.
      //
      // **Its own class, not `muted`.** *Nothing here is behind this door* and *this is not what
      // you searched for* are two different facts, and a row can be absent from both questions at
      // once — which is a row that should read as dim twice rather than once.
      const unmatched = matched !== null && !matched.has(f.path);
      return (
        <li key={f.path} data-file={f.path}>
          <div className="row-pair">
          <button
            type="button"
            className={`file-row${state === 'none' ? ' muted' : ''}${unmatched ? ' unmatched' : ''}${chosen.has(f.path) ? ' on' : ''}${openFile === f.path ? ' open' : ''}`}
            data-tip={f.path}
            onClick={(e) => pick(e, [f.path], f.path)}
            data-file-row={f.path}
            data-selected={chosen.has(f.path) ? 'yes' : 'no'}
            data-match={matched === null ? 'all' : unmatched ? 'no' : 'yes'}
            data-open={openFile === f.path ? 'yes' : 'no'}
            aria-pressed={chosen.has(f.path)}
            {...rowMenu({ kind: 'file', path: f.path }, f.path)}
          >
            <code>{node.name}</code>
            {/* `D1143` — a dot, drawn before the count so it reads as a property of the file
                rather than of the number. It says *not written yet*, which is the one thing the
                count cannot: the count is a fact about the copy on disk, and by design it does not
                move until a Save does. */}
            {unsaved.has(f.path) ? (
              <span className="unsaved-dot" data-file-unsaved={f.path} data-tip="unsaved edits — not written to this file yet" aria-label="has unsaved edits">
                ●
              </span>
            ) : null}
            <span
              className={`count${state === 'none' ? ' muted' : ''}`}
              data-door-count={behind}
              data-door-count-state={state}
              data-tip={state === 'fragment' ? 'declares no test — a fragment other files resolve against' : `${behind} behind ${DOOR_BY_ID[door].label}`}
            >
              {state === 'fragment' ? '—' : behind}
            </span>
            {/* `M211` `S2` (`M202-01`/`M202-02`) — an error and a warning say different things about
                the rows under this file, so they are two badges and not one count.

                **An error means the list is a salvage, and the page now says which.** The row used
                to read `N diagnostics` in the failure hue whatever the severity, beside a test list
                the parser had merely recovered — measured on a 12-test corpus file, an unterminated
                `{` leaves 1 of those 12 and the row looked identical to a stray `}` that lost
                nothing.

                **It says "recovered" and never "incomplete", and that wording is the finding.**
                `PLAN_M202_IMPORTERS.md` §2 Fork A asked for a disclosure that fires only where
                recovery actually lost a test — amended by `M211` `S2`, because nothing the parser
                emits distinguishes the cases: over nine break shapes the lossy and lossless ones
                agree on error count, span width and whether they reach EOF. The view has no ground
                truth for what the file would have held, so the only honest claim is the one that is
                true in both cases. */}
            {f.errors > 0 ? (
              <span className="badge fail" data-diagnostics={f.diagnostics} data-recovered={f.errors} data-tip={`this file does not parse — ${f.errors} error${f.errors === 1 ? '' : 's'}; the tests listed under it are what the parser recovered, and it cannot say what it lost`}>
                does not parse · {f.errors} error{f.errors === 1 ? '' : 's'} · recovered
              </span>
            ) : f.warnings > 0 ? (
              <span className="badge" data-diagnostics={f.diagnostics} data-warnings={f.warnings} data-tip="this file parses — the list below is the file's">
                {f.warnings} warning{f.warnings === 1 ? '' : 's'}
              </span>
            ) : null}
          </button>
          {onNewIn === null ? null : <RowPlus kind="test" onGo={() => onNewIn(f.path)} label={`a new test in ${f.path}`} />}
          </div>
          {openFile === f.path && outline !== null ? renderOutline(outline) : null}
        </li>
      );
    }
    const open = !collapsed.has(node.path);
    const under = filesUnder(node);
    return (
      <li key={node.path} data-dir={node.path} data-dir-files={under.length}>
        <button
          className="dir-row"
          onClick={(e) => (e.metaKey || e.ctrlKey || e.shiftKey ? pick(e, under, null) : setCollapsed(toggle(collapsed, node.path)))}
          data-dir-toggle={node.path}
          aria-expanded={open}
          {...rowMenu({ kind: 'dir', path: node.path, files: under.map((u) => u), expanded: open, onToggle: () => setCollapsed(toggle(collapsed, node.path)) }, node.path)}
          data-tip={`${node.path} — click to fold, cmd-click to select its ${under.length} file${under.length === 1 ? '' : 's'}`}
        >
          <span className="twisty" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          {node.name}
        </button>
        {open ? <ul className="tree">{node.children.map(renderNode)}</ul> : null}
      </li>
    );
  };

  return (
    <aside className="sidebar">
      <div className="project" data-project>
        <div className="root" data-tip-derived="">
          {project.root.split('/').filter(Boolean).pop() ?? project.root}
        </div>
        <div className="muted" data-project-counts>
          {project.files.length} file{project.files.length === 1 ? '' : 's'} · {testCount} behind {DOOR_BY_ID[door].label}
          {otherCount > 0 ? <span data-project-elsewhere={otherCount}> · {otherCount} behind another door</span> : null}
        </div>
      </div>

      {/* `D1064`: one box, two kinds of query, and the page says which. The hint is not decoration —
          a reader has to know whether what they typed narrowed the RUN or only the picture. */}
      <div className="search">
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="a name, or @tag"
          aria-label="search this project"
          list="tflw-tags"
          data-search
        />
        <datalist id="tflw-tags">
          {allTags.map((t) => (
            <option key={t} value={`@${t}`} />
          ))}
        </datalist>
        <p className="muted hint" data-search-hint data-search-kind={parsed.kind}>
          {parsed.kind === 'none'
            ? `${allTags.length} tag${allTags.length === 1 ? '' : 's'} in this project — type @ to narrow the run by one`
            : parsed.kind === 'tag'
              ? parsed.tags.length === 0
                ? `no tag starts with ${parsed.typed} — nothing to run`
                : `${matched!.size} file${matched!.size === 1 ? '' : 's'} · runs --tag ${parsed.tags.join(',')}: ${taggedTestCount(project, parsed)} test${taggedTestCount(project, parsed) === 1 ? '' : 's'}`
              : `${matched!.size} file${matched!.size === 1 ? '' : 's'} match — a name has no flag, so this runs whole files`}
        </p>
      </div>

      <ul className="files tree" data-files={project.files.length}>
        {tree.map(renderNode)}
      </ul>

      {/* At the FOOT of the list and not above it (`D1118`). The list is what the pane is for and a
          create is what you reach for after reading it; a button above 84 file rows is chrome
          between the reader and the project. */}
      {onNew === null ? null : (
        <div className="explorer-new" data-explorer-new>
          <button type="button" onClick={() => onNew('file')} data-compose-new-file data-tip="a new `.tflw` file in this project">
            + new file
          </button>
        </div>
      )}
    </aside>
  );
}
