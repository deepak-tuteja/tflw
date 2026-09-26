// The mode switcher (`D1042`/`D1043`, `M200` `A0-3`) — the strip that says which door you came
// through and lets you change it without leaving the project.
//
// It is a *lens* switch, not a filter over folders: the counts beside each name are derived from
// the same constructs the page reads, and a test appears behind every door it qualifies for. The
// door you are in narrows what the project pane lists and what "new test" will scaffold; it never
// narrows what a test shows (`D1044`).

import { useRef, type ReactNode } from 'react';
import { DOORS, countByDoor } from './doors';
import { Wordmark } from './Wordmark';
import type { Lens, ProjectView } from './contract';
import { useRovingFocus } from './useRovingFocus';

export interface DoorBarProps {
  readonly project: ProjectView;
  readonly door: Lens;
  readonly onDoor: (door: Lens | null) => void;
  /** The theme switcher (`M213` `S0`), as an opaque node — the same arrangement `ApiForm` gets
   * `runPane` through. It is seated here rather than above because **this bar is a row that already
   * exists**: given its own row it cost every page ~20 px of height, and the page gate caught that
   * immediately — LOAD's Compose is the one form measured at exactly one screen, and it went to 920
   * while BROWSER's stayed at 900. Chrome that pushes the product down the page is not free, and
   * the cheapest place to put a control is a row that is already there. */
  readonly themePick?: ReactNode;
  /** Opens the legend (`M240` `C`, `D1292`) — the same list the `?` key opens. */
  readonly onLegend?: () => void;
}

export function DoorBar({ project, door, onDoor, themePick, onLegend }: DoorBarProps) {
  const counts = countByDoor(project);
  /* `M240` `C` (`D1292`) — one Tab stop, arrows inside: the home mark, the four doors, the version
     and `?` are one strip. The theme picker is not in it — a `<select>` answers the arrows itself. */
  const strip = useRef<HTMLElement | null>(null);
  useRovingFocus(strip, { orientation: 'row', selector: ':scope > button, :scope > a' });
  return (
    <nav className="doorbar" data-doorbar={door} aria-label="doors" ref={strip}>
      {/* `M233` `H` (`D1288`) — the same mark as the landing's, at 18 rather than a second asset.
          The glyph was the alternative and is deliberately not used: its heavier strokes (3.0/3.4
          against the wordmark's 2.6/3.0) exist for a 16px favicon, where the generator's own note
          says "a stroke loses proportionally more to antialiasing", and at 18px in a nav that
          margin is not being spent. Ink is `currentColor`, so the button's own `--muted` and its
          `:hover` `--fg` reach the mark with no rule here mentioning it.
          `aria-label` is NOT optional now (`D1289`): the button's accessible name used to be its
          text, and a control whose only child is a graphic otherwise announces as unlabelled. */}
      <button
        className="doorbar-home"
        onClick={() => onDoor(null)}
        data-door-home
        data-tip="back to the four doors"
        aria-label="tflw — back to the four doors"
      >
        <Wordmark height={18} />
      </button>
      {DOORS.map((d) => (
        <button
          key={d.id}
          className={`doorbar-tab${d.id === door ? ' on' : ''}`}
          onClick={() => onDoor(d.id)}
          data-door-tab={d.id}
          aria-pressed={d.id === door}
          data-tip={d.blurb}
        >
          {d.label}
          <span className="muted doorbar-count" data-door-tab-count={counts[d.id]}>
            {counts[d.id]}
          </span>
        </button>
      ))}
      {/* **Which tflw this is, and where the docs are** — `M240` `F` (`M239-10`). The spare corner
          held nothing; a stranger comparing this page to a docs page had no way to know which
          tflw they were on (review U16). The version is the wire's (`ProjectView.version`, the same
          stamp `tflw spec` prints), and the link is the docs site. `rel="noreferrer"` is belt and
          braces beside the page's own `Referrer-Policy` (`D1277`). */}
      <a
        className="doorbar-version muted"
        href="https://deepak-tuteja.github.io/tflw/"
        target="_blank"
        rel="noreferrer"
        data-version={project.version.version}
        data-tip={`tflw ${project.version.version}${project.version.commit ? ` · ${project.version.commit.slice(0, 7)}${project.version.dirty ? ' (uncommitted changes)' : ''}` : ''}${project.version.builtAt ? ` · built ${project.version.builtAt}` : ' · a dev build'} — the docs site opens in a new tab`}
      >
        tflw {project.version.version}
      </a>
      {onLegend ? (
        <button type="button" className="doorbar-legend muted" onClick={onLegend} data-legend-open aria-label="keys and panels" data-tip="what the keys do here, and what each panel is for — or press ?">
          ?
        </button>
      ) : null}
      {themePick}
    </nav>
  );
}
