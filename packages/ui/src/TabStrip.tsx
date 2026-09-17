// The strip over one file (`M205` §2) — Source, Compose, Run, and the rule in `doors.ts` that says
// what may join them.
//
// IT FACES THE FILE, NOT THE DOOR AND NOT THE RUN. `DoorBar` above it answers *what am I here to
// do*; this answers *what am I doing with this file right now*. The two are different questions
// about different subjects, which is why they are two strips rather than one longer one.
//
// A tab carries a MARK, never a different file. Source is marked while the form holds bytes the
// file on disk does not, and Run while a run is going — the two cases where the tab you are not
// looking at has something to say. That is the whole of what a mark may mean here: it is a fact
// about this file's state, so a mark that meant "3 other files failed" would be the explorer's
// job wearing this one's clothes.

import { TABS, type TabId } from './doors';

export interface TabStripProps {
  readonly tab: TabId;
  readonly onTab: (tab: TabId) => void;
  /** Tabs with something to say that you are not currently looking at. */
  readonly marked?: Readonly<Partial<Record<TabId, string>>>;
}

export function TabStrip({ tab, onTab, marked = {} }: TabStripProps) {
  return (
    <nav className="tabstrip" data-tabstrip={tab}>
      {TABS.map((t) => (
        <button
          key={t.id}
          className={`tabstrip-tab${t.id === tab ? ' on' : ''}`}
          onClick={() => onTab(t.id)}
          data-tab={t.id}
          aria-pressed={t.id === tab}
          title={t.blurb}
        >
          {t.label}
          {marked[t.id] ? (
            <span className="tabstrip-mark" data-tab-mark={t.id} title={marked[t.id]}>
              •
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
