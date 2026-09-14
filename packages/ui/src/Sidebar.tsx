// The project and the run controls (`M192` U2). What is shown is what `GET /api/project` read
// from the files — names, tags, lines, envs — and what can be asked is exactly what `tflw run`
// takes: files, `--tag`, `--env`, `--workers`. Nothing here edits a file (`D985`).

import { useMemo, useState } from 'react';
import type { ProjectView, RunRequest } from './contract';

export interface SidebarProps {
  readonly project: ProjectView;
  readonly running: boolean;
  readonly onRun: (request: RunRequest) => void;
  readonly onCancel: () => void;
}

/** Above this many tags the cloud opens folded: `M192` U7 found the dogfood's 90 tags pushing all
 * 84 files below the first screen, and a file list nobody can see is not a project view. The
 * fixture has five, so the fold's threshold is exercised only by the dogfood (§10). */
export const FOLD_TAGS_ABOVE = 24;

export function Sidebar({ project, running, onRun, onCancel }: SidebarProps) {
  const defaultEnv = project.envs.find((e) => e.isDefault)?.name ?? project.envs[0]?.name ?? '';
  const [env, setEnv] = useState(defaultEnv);
  const [workers, setWorkers] = useState('');
  const [files, setFiles] = useState<ReadonlySet<string>>(new Set());
  const [tags, setTags] = useState<ReadonlySet<string>>(new Set());

  const allTags = useMemo(() => {
    const seen = new Set<string>();
    for (const f of project.files) for (const t of f.tests) for (const tag of t.tags) seen.add(tag);
    return [...seen].sort();
  }, [project]);

  const toggle = <T,>(set: ReadonlySet<T>, v: T): Set<T> => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    return next;
  };

  const request = (): RunRequest => {
    const req: { -readonly [K in keyof RunRequest]: RunRequest[K] } = {};
    if (env) req.env = env;
    if (/^\d+$/.test(workers)) req.workers = Number(workers);
    if (tags.size > 0) req.tags = [...tags].sort();
    if (files.size > 0) req.files = project.files.map((f) => f.path).filter((p) => files.has(p));
    return req;
  };

  const testCount = project.files.reduce((n, f) => n + f.tests.length, 0);

  return (
    <aside className="sidebar">
      <div className="project" data-project>
        <div className="root" title={project.root}>
          {project.root.split('/').filter(Boolean).pop() ?? project.root}
        </div>
        <div className="muted" data-project-counts>
          {project.files.length} file{project.files.length === 1 ? '' : 's'} · {testCount} test{testCount === 1 ? '' : 's'}
        </div>
      </div>

      <div className="controls">
        <label>
          env
          <select value={env} onChange={(e) => setEnv(e.target.value)} data-env-select disabled={running}>
            {project.envs.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
                {e.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label>
          workers
          <input type="number" min={1} placeholder="default" value={workers} onChange={(e) => setWorkers(e.target.value)} data-workers disabled={running} />
        </label>
        {running ? (
          <button className="cancel" onClick={onCancel} data-cancel>
            cancel
          </button>
        ) : (
          <button className="run" onClick={() => onRun(request())} data-run>
            run {files.size > 0 ? `${files.size} file${files.size === 1 ? '' : 's'}` : 'all'}
            {tags.size > 0 ? ` · ${[...tags].sort().map((t) => `@${t}`).join(' ')}` : ''}
          </button>
        )}
      </div>

      {allTags.length > 0 ? (
        <details className="tags-fold" open={allTags.length <= FOLD_TAGS_ABOVE} data-tags-fold={allTags.length}>
          <summary className="muted">
            {allTags.length} tag{allTags.length === 1 ? '' : 's'}
            {tags.size > 0 ? ` · ${tags.size} picked` : ''}
          </summary>
          <div className="tags" data-tags>
            {allTags.map((t) => (
              <button key={t} className={`chip${tags.has(t) ? ' on' : ''}`} onClick={() => setTags(toggle(tags, t))} data-tag={t} aria-pressed={tags.has(t)}>
                @{t}
              </button>
            ))}
          </div>
        </details>
      ) : null}

      <ul className="files" data-files>
        {project.files.map((f) => (
          <li key={f.path} data-file={f.path}>
            <label className="file-row">
              <input type="checkbox" checked={files.has(f.path)} onChange={() => setFiles(toggle(files, f.path))} data-file-check={f.path} />
              <code>{f.path}</code>
              {f.diagnostics > 0 ? (
                <span className="badge fail" data-diagnostics={f.diagnostics}>
                  {f.diagnostics} diagnostic{f.diagnostics === 1 ? '' : 's'}
                </span>
              ) : null}
            </label>
            <ul className="tests-in-file">
              {f.tests.map((t) => (
                <li key={`${t.line}-${t.name}`} data-project-test={t.name} data-line={t.line}>
                  <span className="muted ln">{t.line}</span> {t.name}
                  {t.workload ? <span className="badge">workload</span> : null}
                  {t.tags.map((tag) => (
                    <span key={tag} className="tag">
                      @{tag}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </aside>
  );
}
