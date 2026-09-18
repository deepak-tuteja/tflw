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
// EXPANSION IS INFERRED AND IS NOT IN THE ADDRESS (`D1066`). The tree opens whole — 84 rows is the
// measurement above, not a problem to be folded away — and what a reader collapses is theirs for
// the session. The one thing that is forced is the open file's own path: an address naming a file
// inside a folder somebody collapsed must still show it, or the link is broken.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { Lens, ProjectFile, ProjectView } from './contract';
import { DOOR_BY_ID } from './doors';
import { matchingFiles, parseQuery, projectTags, taggedTestCount } from './search';

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
}

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

export function Sidebar({ project, door, openFile, selection, onPick, query, onQuery }: SidebarProps) {
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
          <button
            type="button"
            className={`file-row${state === 'none' ? ' muted' : ''}${unmatched ? ' unmatched' : ''}${chosen.has(f.path) ? ' on' : ''}${openFile === f.path ? ' open' : ''}`}
            title={f.path}
            onClick={(e) => pick(e, [f.path], f.path)}
            data-file-row={f.path}
            data-selected={chosen.has(f.path) ? 'yes' : 'no'}
            data-match={matched === null ? 'all' : unmatched ? 'no' : 'yes'}
            data-open={openFile === f.path ? 'yes' : 'no'}
            aria-pressed={chosen.has(f.path)}
          >
            <code>{node.name}</code>
            <span
              className={`count${state === 'none' ? ' muted' : ''}`}
              data-door-count={behind}
              data-door-count-state={state}
              title={state === 'fragment' ? 'declares no test — a fragment other files resolve against' : `${behind} behind ${DOOR_BY_ID[door].label}`}
            >
              {state === 'fragment' ? '—' : behind}
            </span>
            {f.diagnostics > 0 ? (
              <span className="badge fail" data-diagnostics={f.diagnostics}>
                {f.diagnostics} diagnostic{f.diagnostics === 1 ? '' : 's'}
              </span>
            ) : null}
          </button>
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
          title={`${node.path} — click to fold, cmd-click to select its ${under.length} file${under.length === 1 ? '' : 's'}`}
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
        <div className="root" title={project.root}>
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
    </aside>
  );
}
