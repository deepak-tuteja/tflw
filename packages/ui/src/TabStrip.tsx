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
// job wearing this one's clothes — and since `M209` `S4` that job has an owner, `Sidebar.tsx`,
// rather than being a name this comment used to delegate to.

import { useRef } from 'react';
import { STRIP_TABS, type TabId } from './doors';
import { useRovingFocus } from './useRovingFocus';

export interface TabStripProps {
  readonly tab: TabId;
  readonly onTab: (tab: TabId) => void;
  /** Tabs with something to say that you are not currently looking at. */
  readonly marked?: Readonly<Partial<Record<TabId, string>>>;
  /**
   * **The newest run's verdict, as a dot on Run** — `M255` `C` (`D1400`, `D1404`). A fact about the
   * project's last run, not this file's — the one exception to the rule above, and `D1400` names it:
   * the tab is where the run is read, so it is where *the last one failed* belongs. It reads the
   * verdict index, so it cannot disagree with the explorer's dots.
   */
  readonly runVerdict?: { readonly verdict: 'pass' | 'fail' | 'inconclusive'; readonly tip: string } | null;
}

export function TabStrip({ tab, onTab, marked = {}, runVerdict = null }: TabStripProps) {
  /* `M240` `C` (`D1311`) — the three stages are one Tab stop, ←/→ between them (`M254`, `D1400`:
     Auth and Config are the header's). */
  const strip = useRef<HTMLElement | null>(null);
  useRovingFocus(strip, { orientation: 'row', selector: ':scope > button' });
  return (
    <nav className="tabstrip" data-tabstrip={tab} aria-label="this file" ref={strip}>
      {STRIP_TABS.map((t) => (
        <button
          key={t.id}
          className={`tabstrip-tab${t.id === tab ? ' on' : ''}`}
          onClick={() => onTab(t.id)}
          data-tab={t.id}
          aria-pressed={t.id === tab}
          data-tip={t.blurb}
        >
          {t.label}
          {t.id === 'run' && runVerdict !== null ? (
            <span className={`vdot ${runVerdict.verdict}`} data-tab-verdict={runVerdict.verdict} data-tip={runVerdict.tip} role="img" aria-label={runVerdict.tip} />
          ) : null}
          {marked[t.id] ? (
            <span className="tabstrip-mark" data-tab-mark={t.id} data-tip={marked[t.id]}>
              •
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
