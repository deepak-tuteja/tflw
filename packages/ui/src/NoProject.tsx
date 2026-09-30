// The page before there is a project — `M254` (`D1402`), what is left of the landing.
//
// `D1402` retires the landing: a first visit to a project opens the shell. The landing was also the
// only place a directory with no `tflw.config` could become a project (`M200` `A0-5`), and that
// half has nowhere else to go — there is no shell without a project to show in it. So it stays, as
// the one question it can honestly ask: *what kind of test do you want to start with?* That is
// `D1399`'s scaffold choice, and it maps to `tflw init`'s own flag (`initArgv`) exactly as the door
// did — the page still makes nothing a terminal could not.

import { useState } from 'react';
import { DOORS } from './doors';
import { Wordmark } from './Wordmark';
import { initProject } from './api';
import type { Lens, UnconfiguredView } from './contract';

export interface NoProjectProps {
  readonly error: string | null;
  /**
   * `true` when this directory holds no `tflw.config`, and **`null` while the page has not yet
   * asked** (`M235-08`). The third state is not a nicety: `false` is *one of the two answers*, and a
   * page that defaulted to it painted open choices over a project that does not exist until the probe
   * returned — `M235` `E`'s sweep caught a click landing in that window at 1 of 56.
   */
  readonly noProject: boolean | null;
  /** The unconfigured answer (`D1310`): the directory's name and the build stamp. */
  readonly unconfigured?: UnconfiguredView | null;
  /** The project exists now; `made` is the kind it was scaffolded for, so the shell can open with
   *  that kind's chip on. */
  readonly onCreated: (made: Lens) => void;
}

export function NoProject({ unconfigured = null, error, noProject, onCreated }: NoProjectProps) {
  const [creating, setCreating] = useState<Lens | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const create = async (kind: Lens): Promise<void> => {
    setCreating(kind);
    setFailure(null);
    const result = await initProject(kind);
    setCreating(null);
    if (!result.ok) {
      setFailure(result.output || 'tflw init did not finish');
      return;
    }
    onCreated(kind);
  };
  const version = unconfigured?.version ?? null;
  return (
    /* The whole page when it is drawn, so it is the page's `<main>` (`M240` `E`). */
    <main className="landing" data-no-project={noProject === null ? 'asking' : noProject ? 'none' : 'read'}>
      <header className="landing-head">
        <h1>
          <Wordmark height={40} />
        </h1>
        <p className="muted">{noProject === null ? 'Reading this directory…' : 'No tflw project here yet · pick the kind of test to start with'}</p>
      </header>
      {error ? (
        <p className="error" data-error>
          {error}
        </p>
      ) : null}
      {failure ? (
        <pre className="error" data-init-error>
          {failure}
        </pre>
      ) : null}
      <div className="init-kinds" data-init-kinds>
        {DOORS.map((d) => (
          <button key={d.id} className="init-kind" onClick={() => void create(d.id)} disabled={creating !== null || noProject !== true} data-init-kind={d.id}>
            <span className="init-kind-label">{d.label}</span>
            <span className="init-kind-blurb">{d.blurb}</span>
            <span className="init-kind-note muted">
              {creating === d.id
                ? 'making it…'
                : noProject !== true
                  ? '…'
                  : // What `tflw init` scaffolds for this kind, named rather than implied.
                    d.id === 'load'
                    ? 'a project, with a load test to start from'
                    : d.id === 'scan'
                      ? 'a project, with a scan to start from — and an authorization to uncomment'
                      : 'a project'}
            </span>
          </button>
        ))}
      </div>
      {unconfigured ? (
        <footer className="landing-foot muted" data-landing-unconfigured={unconfigured.root}>
          <code>{unconfigured.root}</code> · no tflw.config here yet ·{' '}
          <a href="https://deepak-tuteja.github.io/tflw/" target="_blank" rel="noreferrer" data-version={version?.version}>
            tflw {version?.version}
          </a>
        </footer>
      ) : null}
    </main>
  );
}
