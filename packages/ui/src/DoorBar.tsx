// The mode switcher (`D1042`/`D1043`, `M200` `A0-3`) — the strip that says which door you came
// through and lets you change it without leaving the project.
//
// It is a *lens* switch, not a filter over folders: the counts beside each name are derived from
// the same constructs the page reads, and a test appears behind every door it qualifies for. The
// door you are in narrows what the project pane lists and what "new test" will scaffold; it never
// narrows what a test shows (`D1044`).

import type { ReactNode } from 'react';
import { DOORS, countByDoor } from './doors';
import type { Lens, ProjectView } from './contract';

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
}

export function DoorBar({ project, door, onDoor, themePick }: DoorBarProps) {
  const counts = countByDoor(project);
  return (
    <nav className="doorbar" data-doorbar={door}>
      <button className="doorbar-home" onClick={() => onDoor(null)} data-door-home data-tip="back to the four doors">
        tflw
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
      {themePick}
    </nav>
  );
}
