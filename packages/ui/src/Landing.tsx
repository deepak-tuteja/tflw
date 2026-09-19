// The landing (`D1042`, `M200` `A0-3`): four doors, each carrying what this project actually holds
// behind it — counted by derivation, never by tag.
//
// The count is the honest part. A door showing "12 tests" that the project does not have would be
// a brochure; these numbers are `lensesOfTest` run over the same files `tflw run` would run, so a
// door with nothing behind it says so and stays open anyway — an empty LOAD door is exactly where
// someone goes to write their first workload test.

import { useState } from 'react';
import { DOORS, countByDoor, lenslessCount, unparsedCount } from './doors';
import { initProject } from './api';
import type { Lens, ProjectView } from './contract';

export interface LandingProps {
  readonly project: ProjectView | null;
  readonly error: string | null;
  /** True when this directory holds no `tflw.config` — the landing then offers to create one
   *  rather than showing four doors onto nothing (`M200` `A0-5`). */
  readonly noProject: boolean;
  readonly onOpen: (door: Lens) => void;
  readonly onCreated: () => void;
}

export function Landing({ project, error, noProject, onOpen, onCreated }: LandingProps) {
  const [creating, setCreating] = useState<Lens | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /**
   * Creating a project *is* choosing a door: `tflw init --load` and `tflw init` write different
   * files, so the question "what am I here to do" is answered before anything exists, which is
   * the only moment it can steer what gets written (`D1042`, `D1051`).
   */
  const create = async (door: Lens): Promise<void> => {
    setCreating(door);
    setFailure(null);
    const result = await initProject(door);
    setCreating(null);
    if (!result.ok) {
      setFailure(result.output || 'tflw init did not finish');
      return;
    }
    onCreated();
    onOpen(door);
  };

  const counts = countByDoor(project);
  const lensless = lenslessCount(project);
  const unparsed = unparsedCount(project);
  const name = project ? (project.root.split('/').filter(Boolean).pop() ?? project.root) : null;

  return (
    <div className="landing" data-landing>
      <header className="landing-head">
        <h1>tflw</h1>
        <p className="muted">{noProject ? 'There is no project here yet. Pick what you are here to do, and one will be made for it.' : 'What are you here to do?'}</p>
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

      <div className="doors" data-doors>
        {DOORS.map((door) => (
          <button
            key={door.id}
            className="door"
            onClick={() => void (noProject ? create(door.id) : onOpen(door.id))}
            disabled={creating !== null}
            data-door={door.id}
            data-door-count={counts[door.id]}
          >
            <span className="door-label">{door.label}</span>
            <span className="door-blurb">{door.blurb}</span>
            <span className="muted door-like">{door.like}</span>
            <span className="door-count muted" data-door-state={noProject ? 'create' : 'open'}>
              {creating === door.id
                ? 'making it…'
                : noProject
                  ? // What this door's `tflw init` actually scaffolds, named rather than implied
                    // (`D1051`, amended by `D1053`). **This said BROWSER and SCANS had no scaffold
                    // until `A2-6`, four commits after `A2-4` gave SCANS one** — the argv, the
                    // scaffold and their tests all landed and the one string an author reads did
                    // not, because every gate asserted the behaviour and none asserted the label.
                    // BROWSER genuinely has none, and still says so.
                    door.id === 'load'
                    ? 'create a project, with a load test to start from'
                    : door.id === 'scan'
                      ? 'create a project, with a scan to start from — and an authorization to uncomment'
                      : 'create a project'
                  : project === null
                    ? '—'
                    : counts[door.id] === 0
                      ? 'nothing here yet'
                      : `${counts[door.id]} here`}
            </span>
          </button>
        ))}
      </div>

      {project ? (
        <footer className="landing-foot muted" data-landing-project>
          <code>{name}</code> · {project.files.length} file{project.files.length === 1 ? '' : 's'}
          {lensless > 0 ? (
            <span data-lensless={lensless}>
              {' '}
              · {lensless} test{lensless === 1 ? '' : 's'} behind no door — {lensless === 1 ? 'it carries' : 'they carry'} no construct any door is about
            </span>
          ) : null}
          {/* `M211` `S2` (`M202-01`) — the counts above leave out files that did not parse, and this
              is the page admitting it. The sentence four lines above this component's own docblock is
              the reason: *"A door showing 12 tests that the project does not have would be a
              brochure."* A recovered test list is not the file's, and both directions of the error
              are measured — an unterminated `{` leaves 1 of a file's 12 tests, an unterminated test
              name leaves 13 with the extra one carrying an empty name. Neither number is safe to
              add, and there is no third number to add instead. Silent when zero, which is every
              healthy project. */}
          {unparsed > 0 ? (
            <span data-unparsed={unparsed}>
              {' '}
              · {unparsed} file{unparsed === 1 ? '' : 's'} not counted — {unparsed === 1 ? 'it does' : 'they do'} not parse, so what the parser recovered from {unparsed === 1 ? 'it is' : 'them is'} not a count of this project
            </span>
          ) : null}
        </footer>
      ) : null}
    </div>
  );
}
