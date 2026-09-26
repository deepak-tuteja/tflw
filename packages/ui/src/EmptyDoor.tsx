// A door with nothing behind it — `M240` `A` (`D1309`).
//
// `landingFor` answers `{ empty: true }` when no file in the project holds a test or crawl this
// door is about, and this is what the pane shows in place of a file nobody asked for. It used to
// draw `project.files[0]` — whatever sorted first — which on the dogfood's BROWSER door was a file
// with nothing behind BROWSER, so the first thing a reader saw was a Compose pane about the wrong
// kind of work. One sentence and the one gesture that changes the answer: `+ new file`, which opens
// the same create dialog the explorer's own footer does, and that dialog scaffolds for the door
// (`D1189`). The explorer is still beside it, so every file the project does have is one click away.

import { DOOR_BY_ID } from './doors';
import type { Lens } from './contract';

export function EmptyDoor({ door, onNew }: { readonly door: Lens; readonly onNew: () => void }) {
  return (
    <section className="empty-door" data-empty-door={door}>
      <p>No test in this project does this yet — {DOOR_BY_ID[door].blurb}.</p>
      <button type="button" className="empty-door-new" data-empty-door-new onClick={onNew}>
        + new file
      </button>
    </section>
  );
}
