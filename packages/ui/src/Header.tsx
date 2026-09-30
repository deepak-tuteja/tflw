// The header — `M254` (`D1400`, `D1401`, `D1403`): one row where there were two.
//
// `tflw · <project> · env [ ] · [▶ run … · n] · Auth · Config · ? · theme`
//
// IT MERGES THE DOOR BAR AND THE RUN STRIP, AND THE DOOR BAR'S HALF WAS MOSTLY EMPTY. Measured before
// the re-cut (`PLAN_M254` §0): 193 px of chrome stood between the top of the window and the first
// line of Compose, in four bands, and the top one — four doors and a home mark — decided almost
// nothing once `D1044` had taken panels away from it. A kind is a filter now (`D1399`) and it lives
// where filters live, at the head of the explorer; what was left of the door bar is the name, the
// version, `?` and the theme, and those fit on the run strip's row.
//
// THE RUN HALF FACES THE RUN, AS THE STRIP DID. It renders the part of `tflw run`'s vocabulary this
// run can spend and nothing else: `workers` when a row ▶ would run carries a workload, `headed` when
// one opens a page (`D1250`: the lens set of the RUN, never the chip — `run all` with the API chip on
// is still only the API rows, and those are what decide). The button's label is the command read
// back (`D1064`), now with its count: `▶ run all · 36`, `▶ run checkout.tflw · 7`, `▶ run API · 12`.
// The count and the request are one derivation, `runRows`, so they cannot disagree.
//
// AUTH AND CONFIG ARE WORDS HERE, NOT TABS (`D1401`). They are project facts a file resolves against,
// never a stage of one file's life, so they left the strip under the header; each opens its panel
// over the pane and keeps its place in the address (`#/config`, `#/auth`).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Lens, ProjectView, RunRequest } from './contract';
import { DOOR_BY_ID, PANEL_TABS, type TabId } from './doors';
import { Wordmark } from './Wordmark';
import { parseQuery, runRows } from './search';
import { useRovingFocus } from './useRovingFocus';

export interface HeaderProps {
  readonly project: ProjectView;
  /** The env the run is graded against — a name from the project's own config, never free text. */
  readonly env: string;
  readonly onEnv: (env: string) => void;
  /** Raw, because the control is a text field until it parses: `tflw run` takes an integer or
   *  nothing at all, and a half-typed `1` must not become a request. `request()` is what decides. */
  readonly workers: string;
  readonly onWorkers: (workers: string) => void;
  /** **`--headed`** (`M220` `D`, `D1173`) — run-level, like the two above it. */
  readonly headed: boolean;
  readonly onHeaded: (headed: boolean) => void;
  /** The narrowing, for the label only — each lives with the control that edits it. */
  readonly kind: Lens | null;
  readonly selection: readonly string[];
  readonly query: string;
  readonly running: boolean;
  readonly onRun: (request: RunRequest) => void;
  readonly onCancel: () => void;
  readonly request: () => RunRequest;
  /** Which tab the address names — the panel words are pressed when it is theirs. */
  readonly tab: TabId;
  readonly onPanel: (which: TabId) => void;
  /** Config holds an unsaved edit in one of its documents — the mark the strip's tab used to carry. */
  readonly configMark?: string | undefined;
  readonly themePick?: ReactNode;
  readonly onLegend?: () => void;
}

/** `checkout.tflw` for `tests/api/checkout.tflw` — the label names the file the way the tree does. */
const base = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

export function Header({ project, env, onEnv, workers, onWorkers, headed, onHeaded, kind, selection, query, running, onRun, onCancel, request, tab, onPanel, configMark, themePick, onLegend }: HeaderProps) {
  const parsed = parseQuery(query, project);
  const rows = runRows(project, selection, parsed, kind);
  const lenses = new Set(rows.flatMap((r) => r.lenses));
  const takesWorkers = lenses.has('load');
  const takesHeaded = lenses.has('browser');

  /* **`more…` — the rest of what `tflw run` takes, for what this run holds** (`M241` `D`, `D1324`).
     Kept per project in this browser, because a flag like `--bail` is a habit, not a place (`D1045`
     keeps the address for where you are). */
  const storeKey = `tflw.runFlags:${project.root}`;
  const [flags, setFlags] = useState<Record<string, string | boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem(storeKey) ?? '{}') as Record<string, string | boolean>;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(flags));
    } catch {
      // A browser that refuses storage still runs; the flags just do not outlive the page.
    }
  }, [storeKey, flags]);
  const spends = (subject: string): boolean =>
    subject === 'always' || (subject === 'scan' && lenses.has('scan')) || (subject === 'browser' && lenses.has('browser')) || (subject === 'workload' && lenses.has('load'));
  const flagRows = project.runFlags.filter((f) => spends(f.subject));
  const sent: Record<string, string | boolean> = {};
  for (const row of flagRows) {
    const v = flags[row.flag];
    if (v !== undefined && v !== false && v !== '') sent[row.flag] = v;
  }
  const setCount = Object.keys(sent).length;
  /** What `more…` says is set — its own rows, plus `workers` and `headed` when this run can spend
   *  them. A flag the run cannot spend is not sent, so it is not counted either. */
  const shown = setCount + (takesWorkers && workers.trim() !== '' ? 1 : 0) + (takesHeaded && headed ? 1 : 0);

  /* The label is the command read back (`D1064`): the subject — the selection, else the tag query,
     else the text query, else `all` — then the chip, then how many rows that is. A tag query that
     names no tag the project has is `nothing matches`, and a narrowing that leaves no row is `nothing
     to run`; both disable the button, because `tflw run` would refuse either with exit 2. */
  const nothingTagged = parsed.kind === 'tag' && parsed.tags.length === 0;
  const subject =
    selection.length === 1
      ? base(selection[0]!)
      : selection.length > 1
        ? `${selection.length} files`
        : parsed.kind === 'tag'
          ? parsed.tags.map((t) => `@${t}`).join(' ')
          : parsed.kind === 'text'
            ? `“${parsed.typed}”`
            : null;
  const narrowing = [subject, kind === null ? null : DOOR_BY_ID[kind].label].filter((x) => x !== null).join(' ');
  const label = nothingTagged ? `nothing matches ${parsed.typed}` : rows.length === 0 ? 'nothing to run' : `▶ run ${narrowing === '' ? 'all' : narrowing} · ${rows.length}`;
  const disabled = nothingTagged || rows.length === 0;

  /* `M240` `C` (`D1311`) — the right-hand words are one Tab stop, arrows inside, as the door bar's
     were. The theme picker is not in it: a `<select>` answers the arrows itself. */
  const facts = useRef<HTMLElement | null>(null);
  useRovingFocus(facts, { orientation: 'row', selector: ':scope > button, :scope > a' });

  const name = project.root.split('/').filter(Boolean).pop() ?? project.root;

  return (
    <header className="header" data-header>
      {/* `M233` `H` (`D1288`) — the same mark as the docs site's. `aria-label` is not optional: the
          link's only child is a graphic (`D1289`). It goes to the docs, which is what a stranger
          clicking a product's mark expects; there is no landing to go back to (`D1402`). */}
      <a className="header-mark" href="https://deepak-tuteja.github.io/tflw/" target="_blank" rel="noreferrer" aria-label="tflw — the docs open in a new tab" data-header-mark>
        <Wordmark height={18} />
      </a>
      {/* `M240` `E` — the project's name is the page's one `<h1>`: it is what every view is about. It
          moved here from the explorer's head with `M254` (`D1400`), which gave that place to the
          kinds. */}
      <h1 className="header-project" data-header-project={name} data-tip={project.root}>
        {name}
      </h1>
      <div className="header-run" data-runstrip>
        <label data-tip="the `env` block of tflw.config this run reads — base URLs, timeouts, credentials">
          env
          <select value={env} onChange={(e) => onEnv(e.target.value)} data-env-select disabled={running}>
            {project.envs.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name}
                {e.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
        {running ? (
          <button className="cancel" onClick={onCancel} data-cancel>
            cancel
          </button>
        ) : (
          <button
            className="run"
            onClick={() => onRun(setCount === 0 ? request() : { ...request(), flags: sent })}
            data-run
            data-run-count={rows.length}
            disabled={disabled}
            data-tip="runs and grades exactly the rows the explorer shows, and keeps the run as a report you can reopen"
            data-run-narrowing={disabled ? 'none' : selection.length > 0 ? 'selection' : parsed.kind === 'none' ? (kind === null ? 'none' : 'kind') : parsed.kind}
          >
            {label}
          </button>
        )}
        {/* **`more…` — the rest of what `tflw run` takes, for what this run holds** (`D1324`), and since
            `M254` `workers` and `headed` with it: the header is one row (`D1400`), and those two are
            run flags like the others. Each is still drawn only when a row ▶ would run can spend it
            (`D1250`). The tips keep what no condition can say: file concurrency is the config's, and
            the trace is the better answer than a visible window. */}
        {flagRows.length === 0 && !takesWorkers && !takesHeaded ? null : (
          <details className="run-more" data-run-more={flagRows.map((r) => r.flag).join(' ')}>
            <summary data-tip="the rest of what `tflw run` takes, for what this run holds">more…{shown === 0 ? '' : ` (${shown})`}</summary>
            <div className="run-more-rows">
              {takesWorkers ? (
                <label data-tip="processes forked to generate load for workload tests — files at once is the config's">
                  workers
                  <input type="number" min={1} placeholder="default" value={workers} onChange={(e) => onWorkers(e.target.value)} data-workers disabled={running} />
                </label>
              ) : null}
              {takesHeaded ? (
                <label className="check" data-tip="a visible browser window instead of headless — to watch it move; the trace keeps more">
                  <input type="checkbox" checked={headed} onChange={(e) => onHeaded(e.target.checked)} data-headed disabled={running} />
                  headed
                </label>
              ) : null}
              {flagRows.map((row) =>
                row.shape === 'bool' ? (
                  <label key={row.flag} className="check" data-tip={row.hint}>
                    <input type="checkbox" checked={flags[row.flag] === true} onChange={(e) => setFlags({ ...flags, [row.flag]: e.target.checked })} data-run-flag={row.flag} disabled={running} />
                    {row.label}
                  </label>
                ) : (
                  <label key={row.flag} data-tip={row.hint}>
                    {row.label}
                    <input value={typeof flags[row.flag] === 'string' ? (flags[row.flag] as string) : ''} onChange={(e) => setFlags({ ...flags, [row.flag]: e.target.value })} data-run-flag={row.flag} disabled={running} placeholder="default" />
                  </label>
                ),
              )}
            </div>
          </details>
        )}
      </div>
      <nav className="header-facts" aria-label="project" ref={facts}>
        {PANEL_TABS.map((t) => (
          <button key={t.id} type="button" className={`header-panel-word${tab === t.id ? ' on' : ''}`} onClick={() => onPanel(t.id)} data-header-panel={t.id} aria-pressed={tab === t.id} data-tip={t.blurb}>
            {t.label}
            {t.id === 'config' && configMark ? (
              <span className="tabstrip-mark" data-tab-mark="config" data-tip={configMark}>
                •
              </span>
            ) : null}
          </button>
        ))}
        {/* **Which tflw this is** — `M240` `F` (`M239-10`). The version is the wire's
            (`ProjectView.version`, the stamp `tflw spec` prints), and the link is the docs site. */}
        <a
          className="header-version muted"
          href="https://deepak-tuteja.github.io/tflw/"
          target="_blank"
          rel="noreferrer"
          data-version={project.version.version}
          data-tip={`tflw ${project.version.version}${project.version.commit ? ` · ${project.version.commit.slice(0, 7)}${project.version.dirty ? ' (uncommitted changes)' : ''}` : ''}${project.version.builtAt ? ` · built ${project.version.builtAt}` : ' · a dev build'} — the docs site opens in a new tab`}
        >
          tflw {project.version.version}
        </a>
        {onLegend ? (
          <button type="button" className="header-legend muted" onClick={onLegend} data-legend-open aria-label="keys and panels" data-tip="what the keys do here, and what each panel is for — or press ?">
            ?
          </button>
        ) : null}
        {/* The theme is in the facts group, not after it: the group is what `margin-left: auto`
            seats, and a picker outside it is the one item that wraps alone near the floor. */}
        {themePick}
      </nav>
    </header>
  );
}
