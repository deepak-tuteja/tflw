// The landing (`D1042`, `M200` `A0-3`): four doors, each carrying what this project actually holds
// behind it — counted by derivation, never by tag.
//
// The count is the honest part. A door showing "12 tests" that the project does not have would be
// a brochure; these numbers are `lensesOfTest` run over the same files `tflw run` would run, so a
// door with nothing behind it says so and stays open anyway — an empty LOAD door is exactly where
// someone goes to write their first workload test.

import { useState } from 'react';
import { DOORS, countByDoor, lenslessCount, unparsedCount } from './doors';
import { Wordmark } from './Wordmark';
import { initProject } from './api';
import type { Lens, ProjectView, UnconfiguredView } from './contract';

export interface LandingProps {
  readonly project: ProjectView | null;
  readonly error: string | null;
  /**
   * `true` when this directory holds no `tflw.config` — the landing then offers to create one
   * rather than showing four doors onto nothing (`M200` `A0-5`) — and **`null` while the page has
   * not yet asked** (`M235-08`).
   *
   * The third state is not a nicety. `App` held this as `useState(false)`, and `false` is not a
   * neutral default here: it is *one of the two answers*. So a directory that is not a project
   * painted four `open` doors and *"What are you here to do?"* until the probe returned, and a
   * click inside that window called `onOpen` on a project that does not exist. `M235` `E`'s sweep
   * caught it at 1 of 56.
   *
   * It also gives a test a predicate that is not the assertion it is making: *the landing has
   * finished asking* is measurable, and *what it answered* is the claim (`M141`).
   */
  readonly noProject: boolean | null;
  /** `D1291` — the unconfigured answer, when that is what the page got: the directory's name and
   *  the build stamp, said on the landing that offers to make a project there. */
  readonly unconfigured?: UnconfiguredView | null;
  readonly onOpen: (door: Lens) => void;
  readonly onCreated: () => void;
}

export function Landing({ project, unconfigured = null, error, noProject, onOpen, onCreated }: LandingProps) {
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
  const name = project ? (project.root.split('/').filter(Boolean).pop() ?? project.root) : (unconfigured?.root ?? null);
  const version = project?.version ?? unconfigured?.version ?? null;

  return (
    <div className="landing" data-landing>
      <header className="landing-head">
        {/* `M233` `H` (`D1288`/`D1289`) — the drawn mark, not the word set in the theme's own face.
            It was `<h1>tflw</h1>` at 28px/700, measuring 66.1 × 37 of ink; the mark is asked for at
            height 40 and takes 66.25 by its own viewBox aspect, so the `<h1>`'s 40.6px box does not
            move. The heading keeps its text for anything that reads the document rather than looks
            at it — `Wordmark` carries `aria-label="tflw"`, and the two would announce the name
            twice, so the element is the picture and the name lives on it. */}
        <h1><Wordmark height={40} /></h1>
        <p className="muted">
          {noProject === null
            ? 'Reading this directory…'
            : noProject
              ? 'There is no project here yet. Pick what you are here to do, and one will be made for it.'
              : 'What are you here to do?'}
        </p>
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
            // A door cannot be pressed before the page knows what pressing it means — the same
            // press is *create* or *open* depending on the answer that has not arrived yet.
            disabled={creating !== null || noProject === null}
            data-door={door.id}
            data-door-count={counts[door.id]}
          >
            <span className="door-label">{door.label}</span>
            <span className="door-blurb">{door.blurb}</span>
            <span className="door-count muted" data-door-state={noProject === null ? 'asking' : noProject ? 'create' : 'open'}>
              {creating === door.id
                ? 'making it…'
                : noProject === null
                  ? '…'
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

      {/* `D1291` — a directory that is not a project yet still says where it is and which tflw
          this is, in the same footer a project gets; the absolute path is nobody's business. */}
      {unconfigured ? (
        <footer className="landing-foot muted" data-landing-unconfigured={unconfigured.root}>
          <code>{name}</code> · no tflw.config here yet ·{' '}
          <a href="https://deepak-tuteja.github.io/tflw/" target="_blank" rel="noreferrer" data-version={version?.version}>
            tflw {version?.version}
          </a>
        </footer>
      ) : null}
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
