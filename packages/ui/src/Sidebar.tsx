// The project pane (`M192` U2, narrowed to a door by `M200` `A0-3`, freed of the run controls by
// `M209` `S1`). What is shown is what `GET /api/project` read from the files — names, tags, lines.
//
// IT LISTS THE PROJECT AND DOES NOT ASSEMBLE A COMMAND. `env`, `workers` and the run button moved
// to `RunStrip` (`M205` Q12), because a pane doing both jobs is a pane that cannot become a file
// tree. What is left here is the narrowing itself — which files, which tags — and the narrowing is
// a fact about the *project* that the strip reads back as a label.
//
// THE DOOR NARROWS THE LIST, NOT THE TEST. A test is listed here when its own constructs put it
// behind the door you came through (`D1043`), and a test behind three doors is listed under all
// three. What it *shows* when opened is decided by its constructs and never by the door
// (`D1044`), so nothing below hides a line of a file.
//
// AND IT STILL SHOWS WHAT IT IS NOT LISTING. A file whose tests are all behind other doors is
// named with a count rather than dropped, because a project pane that silently omits two thirds
// of a project is how someone concludes the tool lost their tests.

import { useMemo } from 'react';
import type { Lens, ProjectView } from './contract';
import { DOOR_BY_ID } from './doors';

export interface SidebarProps {
  readonly project: ProjectView;
  /** The door the reader came through — which tests this pane lists. */
  readonly door: Lens;
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

export function Sidebar({ project, door, files, onFiles, tags, onTags }: SidebarProps) {
  /** The project as this door sees it: each file with only the tests and crawls behind the door,
   *  plus how many of its tests are behind some other one. */
  const inDoor = useMemo(
    () =>
      project.files
        .map((f) => ({
          file: f,
          tests: f.tests.filter((t) => t.lenses.includes(door)),
          crawls: f.crawls.filter((c) => c.lenses.includes(door)),
          elsewhere: f.tests.filter((t) => !t.lenses.includes(door)).length,
        }))
        .filter((e) => e.tests.length > 0 || e.crawls.length > 0 || e.elsewhere > 0),
    [project, door],
  );

  const allTags = useMemo(() => {
    const seen = new Set<string>();
    for (const e of inDoor) for (const t of e.tests) for (const tag of t.tags) seen.add(tag);
    return [...seen].sort();
  }, [inDoor]);

  const toggle = <T,>(set: ReadonlySet<T>, v: T): Set<T> => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  const testCount = inDoor.reduce((n, e) => n + e.tests.length + e.crawls.length, 0);
  const otherCount = project.files.reduce((n, f) => n + f.tests.length, 0) - project.files.reduce((n, f) => n + f.tests.filter((t) => t.lenses.includes(door)).length, 0);

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

      <ul className="files" data-files>
        {inDoor.map(({ file: f, tests, crawls, elsewhere }) => (
          <li key={f.path} data-file={f.path}>
            <label className="file-row">
              <input type="checkbox" checked={files.has(f.path)} onChange={() => onFiles(toggle(files, f.path))} data-file-check={f.path} />
              <code>{f.path}</code>
              {f.diagnostics > 0 ? (
                <span className="badge fail" data-diagnostics={f.diagnostics}>
                  {f.diagnostics} diagnostic{f.diagnostics === 1 ? '' : 's'}
                </span>
              ) : null}
            </label>
            <ul className="tests-in-file">
              {crawls.map((c) => (
                <li key={`crawl-${c.line}`} data-project-crawl={c.name} data-line={c.line}>
                  <span className="muted ln">{c.line}</span> {c.name}
                  <span className="badge">crawl</span>
                </li>
              ))}
              {tests.map((t) => (
                <li key={`${t.line}-${t.name}`} data-project-test={t.name} data-line={t.line} data-test-lenses={t.lenses.join(' ')}>
                  <span className="muted ln">{t.line}</span> {t.name}
                  {t.workload ? <span className="badge">workload</span> : null}
                  {/* Every OTHER door this test is behind, named on the test itself — `D1043`'s
                      "a test carrying several appears in several", made visible where it matters
                      rather than asserted in a plan. */}
                  {t.lenses
                    .filter((l) => l !== door)
                    .map((l) => (
                      <span key={l} className="badge also" data-also={l}>
                        {DOOR_BY_ID[l].label}
                      </span>
                    ))}
                  {t.tags.map((tag) => (
                    <span key={tag} className="tag">
                      @{tag}
                    </span>
                  ))}
                </li>
              ))}
              {elsewhere > 0 ? (
                <li className="muted elsewhere" data-file-elsewhere={elsewhere}>
                  {elsewhere} more behind {elsewhere === 1 ? 'another door' : 'other doors'}
                </li>
              ) : null}
            </ul>
          </li>
        ))}
      </ul>
    </aside>
  );
}
