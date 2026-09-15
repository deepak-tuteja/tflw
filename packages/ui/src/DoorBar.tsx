// The mode switcher (`D1042`/`D1043`, `M200` `A0-3`) — the strip that says which door you came
// through and lets you change it without leaving the project.
//
// It is a *lens* switch, not a filter over folders: the counts beside each name are derived from
// the same constructs the page reads, and a test appears behind every door it qualifies for. The
// door you are in narrows what the project pane lists and what "new test" will scaffold; it never
// narrows what a test shows (`D1044`).

import { DOORS, countByDoor } from './doors';
import type { Lens, ProjectView } from './contract';

export interface DoorBarProps {
  readonly project: ProjectView;
  readonly door: Lens;
  readonly onDoor: (door: Lens | null) => void;
}

export function DoorBar({ project, door, onDoor }: DoorBarProps) {
  const counts = countByDoor(project);
  return (
    <nav className="doorbar" data-doorbar={door}>
      <button className="doorbar-home" onClick={() => onDoor(null)} data-door-home title="back to the four doors">
        tflw
      </button>
      {DOORS.map((d) => (
        <button
          key={d.id}
          className={`doorbar-tab${d.id === door ? ' on' : ''}`}
          onClick={() => onDoor(d.id)}
          data-door-tab={d.id}
          aria-pressed={d.id === door}
          title={d.blurb}
        >
          {d.label}
          <span className="muted doorbar-count" data-door-tab-count={counts[d.id]}>
            {counts[d.id]}
          </span>
        </button>
      ))}
    </nav>
  );
}
