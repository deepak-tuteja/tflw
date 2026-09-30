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

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { menuTrigger, type MenuItem, type MenuRequest } from './ContextMenu';
import type { Lens, ProjectFile, ProjectView } from './contract';
import { countByDoor, countsHonestly, DOOR_BY_ID, DOORS, unparsedCount } from './doors';
import { matchingFiles, parseQuery, projectTags, taggedTestCount } from './search';
import { useRovingFocus } from './useRovingFocus';
import type { FileOutline, OutlineDecl } from './outline';
import { ageOf, markKey, VERDICT_WORDS, type TestVerdict, type VerdictIndex } from './verdicts';

/**
 * **A verdict as a dot** — `M255` `B` (`D1404`). The newest kept verdict of a test, or a file's
 * roll-up; `not-run` is hollow so an unrun project does not read as a wall of grey passes. The words
 * are the tip and the accessible name, because a colour alone is a fact some readers do not get.
 */
function VerdictDot({ verdict, tip, subject }: { readonly verdict: TestVerdict; readonly tip: string; readonly subject: string }) {
  return <span className={`vdot ${verdict}`} data-row-verdict={verdict} data-verdict-of={subject} data-tip={tip} role="img" aria-label={tip} />;
}

/**
 * **`+` on a row of the explorer** — `M217` `D` (`D1139`, `D1140`).
 *
 * **A sibling of the row and never inside it**, because both rows the explorer draws *are*
 * `<button>`s and a button cannot hold another one. So each becomes a flex pair, which is the
 * shape `.seq-row` has used for its `✕` since `M214`.
 *
 * **Revealed on hover and on focus, and in the row's menu** — `M255` (`D1404`), reopening `D1140`'s
 * *always drawn*. `D1140` was right that a hover-only control is one some readers do not have, so it
 * is not hover-only: it shows while the row is pointed at **or holds focus** (the tree's arrow keys
 * reach it), and every row's right-click menu carries the same gesture. What changed is the count:
 * with request rows gone the tree is files and tests, and a `+` on every one of them was a column of
 * 19 identical marks competing with the verdict dots `D1404` puts on the same rows.
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
  /** The kind chip (`M254`, `D1399`) — `null` is `all`. It is the count *and* the filter: the tree
   *  lists the files holding a test of the kind, and ▶ runs the rows of the kind (`D1403`). */
  readonly kind: Lens | null;
  readonly onKind: (kind: Lens | null) => void;
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
  /** `M255` (`D1404`) — every test's newest verdict, one index for every surface that draws one. */
  readonly marks: VerdictIndex;
  /** The `failed` chip — in the address beside the kind (`D1413`), and AND with it. */
  readonly failedOnly: boolean;
  readonly onFailedOnly: (on: boolean) => void;
  /** A test row outside the open file: open that file at the test's line, in one address write. */
  readonly onOpenTest: (path: string, line: number) => void;
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
  | { readonly kind: 'test'; readonly declIndex: number; readonly line: number; readonly name: string };

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

/** The row count past which the explorer is virtualised (`D1325`). */
export const VIRTUAL_AT = 300;

export function Sidebar({ project, kind, onKind, openFile, selection, onPick, query, onQuery, marks, failedOnly, onFailedOnly, onOpenTest, outline, unsaved, onNewIn, onAddRequest, focusLine, onLine, onNew, menuFor, onMenu }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  /* `M240` `C` (`D1311`) — the whole list is one Tab stop and ↑/↓ walk it, so the pane is not a
     row's-worth of presses away. Tab lands on the open file's row, else the first. */
  const treeRef = useRef<HTMLUListElement | null>(null);
  useRovingFocus(treeRef, { orientation: 'column', selector: 'button' });
  /* `M254` (`D1399`, `D1311`) — the chips are one Tab stop too, ←/→ between them, the way the door
     bar they replace was. Five stops in front of search would put the file list six presses away. */
  const chipsRef = useRef<HTMLDivElement | null>(null);
  useRovingFocus(chipsRef, { orientation: 'row', selector: ':scope > button' });
  /** Where a `shift` range starts. A gesture detail and not a fact about the project, so it is
   *  neither in the address nor anywhere durable — `D1066` addresses what changes a run. */
  const [anchor, setAnchor] = useState<string | null>(null);

  const fullTree = useMemo(() => buildTree(project.files), [project.files]);
  /**
   * **The chip is the filter** — `M254` (`D1399`), which retires `M241` `E`'s *this door only*
   * toggle (`D1325`) and reopens `D1063`'s *a badge, never a filter*. That toggle existed because the
   * door was a count that could not narrow; a chip is both, so the tree lists the files that hold a
   * test of the kind and ▶ runs exactly those tests (`D1403`). The open file stays listed whatever it
   * holds — hiding the row the pane is about would leave the page describing a file you cannot find.
   */
  /** A row of the kind (or any, under `all`), and — under the `failed` chip — one whose newest verdict
   *  failed. The two AND, as `--kind` and the failed narrowing do on the run (`D1403`). */
  const shown = (path: string, x: { readonly name: string; readonly lenses: readonly Lens[] }): boolean =>
    (kind === null || x.lenses.includes(kind)) && (!failedOnly || marks.failed.has(markKey(path, x.name)));
  const tree = useMemo(() => {
    if (kind === null && !failedOnly) return fullTree;
    const behindHere = (f: ProjectFile): boolean => f.tests.some((x) => shown(f.path, x)) || f.crawls.some((x) => shown(f.path, x));
    const prune = (nodes: readonly TreeNode[]): TreeNode[] =>
      nodes.flatMap((n) => {
        if (n.file) return behindHere(n.file) || n.path === openFile ? [n] : [];
        const children = prune(n.children);
        return children.length === 0 ? [] : [{ ...n, children }];
      });
    return prune(fullTree);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shown` reads exactly these
  }, [fullTree, kind, failedOnly, marks, openFile]);
  const dirsOf = (nodes: readonly TreeNode[]): string[] => nodes.flatMap((n) => (n.file ? [] : [n.path, ...dirsOf(n.children)]));

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

  /** The chips' numbers — `countByDoor`, the count the door bar carried (`D1043`: a test of two
   *  kinds is counted by both), and `all`, every test and crawl including the ones of no kind. Files
   *  that did not parse are left out of all five, for `countsHonestly`'s reason. */
  const byKind = useMemo(() => countByDoor(project), [project]);
  const unparsed = useMemo(() => unparsedCount(project), [project]);
  const allCount = useMemo(() => project.files.filter(countsHonestly).reduce((n, f) => n + f.tests.length + f.crawls.length, 0), [project]);

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

  /** A test's dot, its tip naming the verdict and, for a flaky one, that it flips (`M249`). */
  const testDot = (path: string, name: string): ReactElement => {
    const m = marks.test(path, name);
    return <VerdictDot verdict={m.verdict} subject={`${path}::${name}`} tip={`${VERDICT_WORDS[m.verdict]}${m.run === null ? '' : ' in its last run'}${m.flaky ? ' — flaky across runs' : ''}`} />;
  };

  /**
   * **A closed file's failing tests** — `M255` `B`. Under the `failed` chip every listed file opens
   * onto the rows that put it there, so the explorer answers *what failed* without opening Run (the
   * milestone's green condition). Elsewhere a closed file stays one row (`§6` prediction 5: the files
   * fold except the open one). A click opens the file at the test.
   */
  const renderTests = (f: ProjectFile): ReactElement | null => {
    const rows = [...f.tests, ...f.crawls].filter((t) => shown(f.path, t));
    if (rows.length === 0) return null;
    return (
      <ul className="tree outline" data-file-tests={f.path}>
        {rows.map((t) => (
          <li key={`${t.line}-${t.name}`} data-outline-decl="test" data-outline-line={t.line}>
            <div className="row-pair">
              <button type="button" className="outline-row" onClick={() => onOpenTest(f.path, t.line)} data-outline-goto={t.line} data-outline-name={t.name} data-tip-derived="">
                <span className="ln muted">{t.line}</span>
                <span className="seq-kind">test</span>
                <span className="outline-name" data-tip-text>{t.name}</span>
                {testDot(f.path, t.name)}
              </button>
            </div>
          </li>
        ))}
      </ul>
    );
  };

  /**
   * The open file's own tree (`D1081`) — its hooks, tests and crawls, each test with its verdict.
   *
   * **No request rows** (`M255`, `D1404`): a request belongs to the steps column and nowhere else. They
   * were about half the explorer's rows (12 of 54 buttons on the storefront with one file open) and a
   * second index of what Compose's own column lists.
   *
   * It is the SAME LIST `SourcePanel`'s index draws (`D1067`) and a different question: the index
   * answers *what does this file declare*, in the file's own order, for a reader of the text. This
   * answers *what can Compose put on screen*, which is one level lower, because `D1073`'s unit is a
   * request. Neither is derived from the other and both are derived from the file, so there is no
   * copy here to go stale — this one is parsed in the browser from the bytes the shell read.
   *
   * Every declaration gets a row, whatever it holds — a tree that listed only some would be a kind
   * filtering the file, and the chip already narrows the tree to files, never inside the open one.
   */
  const renderOutline = (o: FileOutline): ReactElement => (
    <ul className="tree outline" data-outline={o.declarations.length}>
      {o.declarations.map((decl: OutlineDecl) => (
        <li key={`${decl.kind}-${decl.line}`} data-outline-decl={decl.kind} data-outline-line={decl.line}>
          <div className="row-pair">
          <button
            type="button"
            className={`outline-row${decl.body.requests.some((r) => r.line === focusLine) || decl.line === focusLine ? ' on' : ''}`}
            data-outline-name={decl.kind === 'hook' ? undefined : decl.name}
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
            {decl.kind === 'hook' || openFile === null ? null : testDot(openFile, decl.name)}
          </button>
          {/* **A hook gets none, and that is the language rather than a gap** (`D1144`). The splice
              addresses a test BY NAME and a hook has none — the sequence column already says so
              where its own buttons would be, and saying nothing here is better than drawing a `+`
              that refuses. */}
          {onAddRequest === null || decl.kind !== 'test' ? null : (
            <RowPlus kind="request" onGo={() => { onLine(decl.line); onAddRequest(decl.index); }} label={`a new request in “${decl.name}”`} />
          )}
          </div>
        </li>
      ))}
    </ul>
  );

  const renderNode = (node: TreeNode, recurse = true): ReactElement => {
    if (node.file) {
      const f = node.file;
      const total = f.tests.length + f.crawls.length;
      const behind = kind === null ? total : f.tests.filter((t) => t.lenses.includes(kind)).length + f.crawls.filter((c) => c.lenses.includes(kind)).length;
      // `D1068`'s three states. `—` is not a zero: it says *declares nothing by nature*, which is
      // a different fact from *has tests, none of them of this kind* and must not be dimmed.
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
            {total === 0 ? null : (() => {
              const fm = marks.file(f);
              const parts = [fm.failed > 0 ? `${fm.failed} failed` : '', fm.passed > 0 ? `${fm.passed} passed` : '', fm.skipped > 0 ? `${fm.skipped} skipped` : '', fm.notRun > 0 ? `${fm.notRun} not run yet` : ''].filter((x) => x !== '');
              return <VerdictDot verdict={fm.verdict} subject={f.path} tip={`${parts.join(' · ')} — each test's last run`} />;
            })()}
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
              data-file-count={behind}
              data-file-count-state={state}
              data-tip={state === 'fragment' ? 'declares no test — a fragment other files resolve against' : `${behind}${kind === null ? '' : ` ${DOOR_BY_ID[kind].label}`} test${behind === 1 ? '' : 's'}`}
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
          {openFile === f.path && outline !== null ? renderOutline(outline) : failedOnly && openFile !== f.path ? renderTests(f) : null}
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
        {open && recurse ? <ul className="tree">{node.children.map((n) => renderNode(n))}</ul> : null}
      </li>
    );
  };

  /** The tree in reading order with each row's depth — what the virtualised list draws. */
  const rows = useMemo(() => {
    const out: { node: TreeNode; depth: number }[] = [];
    const walk = (nodes: readonly TreeNode[], depth: number): void => {
      for (const n of nodes) {
        out.push({ node: n, depth });
        if (!n.file && !collapsed.has(n.path)) walk(n.children, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree, collapsed]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scrollRef.current, estimateSize: () => 28, overscan: 12 });

  return (
    <div className="sidebar">
      <div className="project" data-project>
        {/* **The kinds, as chips** — `M254` (`D1399`). The four the door bar carried, plus `all`, each
            with its count; one pressed. A test of two kinds is under both (`D1043`), and `all` is
            every test, the ones of no kind among them. The project's name is the header's now. */}
        <div className="kind-chips" role="group" aria-label="kinds of test" data-kind-chips={kind ?? 'all'} ref={chipsRef}>
          <button type="button" className={`chip${kind === null ? ' on' : ''}`} aria-pressed={kind === null} onClick={() => onKind(null)} data-kind-chip="all" data-tip="every test in the project">
            all <span className="chip-count" data-kind-count={allCount}>{allCount}</span>
          </button>
          {DOORS.map((d) => (
            <button key={d.id} type="button" className={`chip${kind === d.id ? ' on' : ''}`} aria-pressed={kind === d.id} onClick={() => onKind(kind === d.id ? null : d.id)} data-kind-chip={d.id} data-tip={d.blurb}>
              {d.label} <span className="chip-count" data-kind-count={byKind[d.id]}>{byKind[d.id]}</span>
            </button>
          ))}
          {/* `M255` (`D1404`) — `failed` beside the kinds, AND with them: the tests whose newest
              verdict failed. Off and at zero it is disabled, because a filter that can only empty
              the tree is not a choice. */}
          <button
            type="button"
            className={`chip failed-chip${failedOnly ? ' on' : ''}`}
            aria-pressed={failedOnly}
            disabled={!failedOnly && marks.failed.size === 0}
            onClick={() => onFailedOnly(!failedOnly)}
            data-failed-chip={failedOnly ? 'on' : 'off'}
            data-tip="the tests whose last run failed"
          >
            failed <span className="chip-count" data-failed-count={marks.failed.size}>{marks.failed.size}</span>
          </button>
        </div>
        <div className="muted" data-project-counts>
          {project.files.length} file{project.files.length === 1 ? '' : 's'}
          {/* `M255` (`D1404`) — the head line: how old the dots are and how many are red. */}
          <span data-last-run={marks.newest?.id ?? ''}>
            {marks.newest === null
              ? ' · no run yet'
              : ` · last run${marks.newest.at === '' ? '' : ` ${ageOf(marks.newest.at)}`}${marks.failed.size > 0 ? ` · ${marks.failed.size} failed` : ''}`}
          </span>
          {/* `M211` `S2` (`M202-01`) — what the landing used to admit: the chips leave a file that did
              not parse out of every count, because what the parser recovered from it is not the
              project's, and the page says so rather than presenting a short total as the whole.
              Silent when zero, which is every healthy project. */}
          {unparsed > 0 ? (
            <span data-unparsed={unparsed}>
              {' '}· {unparsed} not counted — {unparsed === 1 ? 'it does' : 'they do'} not parse
            </span>
          ) : null}
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
          data-tip="a name narrows the run to whole files; @tag to the tests carrying the tag"
        />
        <datalist id="tflw-tags">
          {allTags.map((t) => (
            <option key={t} value={`@${t}`} />
          ))}
        </datalist>
        <p className="muted hint" data-search-hint data-search-kind={parsed.kind}>
          {parsed.kind === 'none'
            ? `${allTags.length} tag${allTags.length === 1 ? '' : 's'} · type @ to narrow the run`
            : parsed.kind === 'tag'
              ? parsed.tags.length === 0
                ? `no tag starts with ${parsed.typed} — nothing to run`
                : `${matched!.size} file${matched!.size === 1 ? '' : 's'} · runs --tag ${parsed.tags.join(',')}: ${taggedTestCount(project, parsed)} test${taggedTestCount(project, parsed) === 1 ? '' : 's'}`
              : `${matched!.size} file${matched!.size === 1 ? '' : 's'} match — a name has no flag, so this runs whole files`}
        </p>
      </div>

      {rows.length >= VIRTUAL_AT ? (
        /* **Past `VIRTUAL_AT` rows the tree is virtualised** — `D1325`, `@tanstack/react-virtual`. The
           rows are the same rows, flattened in tree order with their depth as an indent; only the
           ones near the scroll position are in the DOM. Below the threshold the tree stays the
           nested list every gate reads — a project that fits on a screen gains nothing from it. */
        <div className="tree-scroll" ref={scrollRef} data-tree-virtual={rows.length}>
          <ul className="files tree" data-files={project.files.length} ref={treeRef} style={{ height: virtual.getTotalSize(), position: 'relative' }}>
            {virtual.getVirtualItems().map((item) => {
              const row = rows[item.index]!;
              return (
                <li
                  key={row.node.path}
                  data-index={item.index}
                  ref={virtual.measureElement}
                  className="virtual-row"
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${item.start}px)`, paddingLeft: `${row.depth * 12}px` }}
                >
                  <ul className="tree">{renderNode(row.node, false)}</ul>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <ul className="files tree" data-files={project.files.length} ref={treeRef}>
          {tree.map((n) => renderNode(n))}
        </ul>
      )}

      {/* `M241` `E` (`D1325`) — the two view controls, at the foot beside `+ new file` for
          `D1118`'s reason: they are what you reach for after reading the list, and above it they would
          be two Tab stops between the search and the tree `D1311` puts next to each other. Neither
          changes a run. */}
      <div className="tree-tools" data-tree-tools>
        <button
          type="button"
          onClick={() => {
            // The open file's own folders stay open: collapsing the folder you are reading would
            // hide the row the page is about, and the address would re-open it on the next render.
            const parts = openFile === null ? [] : openFile.split('/').slice(0, -1);
            const keep = new Set(parts.map((_, i) => parts.slice(0, i + 1).join('/')));
            setCollapsed(new Set(dirsOf(fullTree).filter((d) => !keep.has(d))));
          }}
          data-collapse-all data-tip="fold every folder — the open file's own folders stay open">
          collapse all
        </button>
      </div>

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
    </div>
  );
}
