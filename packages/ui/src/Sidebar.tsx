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
// EXPANSION IS INFERRED AND IS NOT IN THE ADDRESS (`D1066`). The tree opens whole — 84 rows is the
// measurement above, not a problem to be folded away — and what a reader collapses is theirs for
// the session. The one thing that is forced is the open file's own path: an address naming a file
// inside a folder somebody collapsed must still show it, or the link is broken.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { Lens, ProjectFile, ProjectView } from './contract';
import { DOOR_BY_ID } from './doors';

export interface SidebarProps {
  readonly project: ProjectView;
  /** The door the reader came through — which counts this pane shows. It narrows nothing. */
  readonly door: Lens;
  /** The file the tabs are facing, from the address. Its folders are open whatever else is not. */
  readonly openFile: string | null;
  /** The narrowing, owned by the shell so the strip can label the run it is about to start. */
  readonly files: ReadonlySet<string>;
  readonly onFiles: (files: ReadonlySet<string>) => void;
  readonly tags: ReadonlySet<string>;
  readonly onTags: (tags: ReadonlySet<string>) => void;
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

export function Sidebar({ project, door, openFile, files, onFiles, tags, onTags }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

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

  const allTags = useMemo(() => {
    const seen = new Set<string>();
    for (const f of project.files) for (const t of f.tests) if (t.lenses.includes(door)) for (const tag of t.tags) seen.add(tag);
    return [...seen].sort();
  }, [project.files, door]);

  const toggle = <T,>(set: ReadonlySet<T>, v: T): Set<T> => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  const testCount = project.files.reduce((n, f) => n + f.tests.filter((t) => t.lenses.includes(door)).length + f.crawls.filter((c) => c.lenses.includes(door)).length, 0);
  const otherCount = project.files.reduce((n, f) => n + f.tests.length, 0) - project.files.reduce((n, f) => n + f.tests.filter((t) => t.lenses.includes(door)).length, 0);

  const renderNode = (node: TreeNode): ReactElement => {
    if (node.file) {
      const f = node.file;
      const total = f.tests.length + f.crawls.length;
      const behind = f.tests.filter((t) => t.lenses.includes(door)).length + f.crawls.filter((c) => c.lenses.includes(door)).length;
      // `D1068`'s three states. `—` is not a zero: it says *declares nothing by nature*, which is
      // a different fact from *has tests, none of them behind this door* and must not be dimmed.
      const state = total === 0 ? 'fragment' : behind === 0 ? 'none' : 'some';
      return (
        <li key={f.path} data-file={f.path}>
          <label className={`file-row${state === 'none' ? ' muted' : ''}`} title={f.path}>
            <input type="checkbox" checked={files.has(f.path)} onChange={() => onFiles(toggle(files, f.path))} data-file-check={f.path} />
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
          </label>
        </li>
      );
    }
    const open = !collapsed.has(node.path);
    const under = filesUnder(node);
    return (
      <li key={node.path} data-dir={node.path} data-dir-files={under.length}>
        <button className="dir-row" onClick={() => setCollapsed(toggle(collapsed, node.path))} data-dir-toggle={node.path} aria-expanded={open} title={node.path}>
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

      {allTags.length > 0 ? (
        <details className="tags-fold" open={allTags.length <= FOLD_TAGS_ABOVE} data-tags-fold={allTags.length}>
          <summary className="muted">
            {allTags.length} tag{allTags.length === 1 ? '' : 's'}
            {tags.size > 0 ? ` · ${tags.size} picked` : ''}
          </summary>
          <div className="tags" data-tags>
            {allTags.map((t) => (
              <button key={t} className={`chip${tags.has(t) ? ' on' : ''}`} onClick={() => onTags(toggle(tags, t))} data-tag={t} aria-pressed={tags.has(t)}>
                @{t}
              </button>
            ))}
          </div>
        </details>
      ) : null}

      <ul className="files tree" data-files={project.files.length}>
        {tree.map(renderNode)}
      </ul>
    </aside>
  );
}
