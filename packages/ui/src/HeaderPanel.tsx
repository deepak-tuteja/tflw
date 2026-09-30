// A project fact over the pane — `M254` (`D1401`).
//
// Auth and Config were the strip's fourth and fifth tabs, and the strip's own rule says they were
// never stages of a file: they are *a project fact that file resolves against* (`doors.ts`). So they
// open from two words on the header and draw here, over the pane, with the close a panel owes: `✕`,
// `Esc`, and focus handed back to the word that opened it — a keyboard reader who closes a panel
// lands where they were, not at the top of the document. The panel keeps its address (`#/config`,
// `#/auth`), so a link still names it and the back button still walks out of it.

import { useEffect, useRef, type ReactNode } from 'react';
import { PANEL_TABS, type TabId } from './doors';

export function HeaderPanel({ which, onClose, children }: { readonly which: TabId; readonly onClose: () => void; readonly children: ReactNode }) {
  const self = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // An `Esc` a field inside the panel already spent (a completion popup, an open select) is not
      // a request to close the panel.
      const t = e.target as HTMLElement | null;
      if (t?.closest('.cm-tooltip, [role="listbox"]')) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const close = (): void => {
    onClose();
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-header-panel="${which}"]`)?.focus());
  };
  const label = PANEL_TABS.find((t) => t.id === which)?.label ?? which;
  return (
    <section className="header-panel" data-panel={which} aria-label={label} ref={self}>
      <p className="header-panel-bar">
        <strong>{label}</strong>
        <button type="button" className="header-panel-close" onClick={close} data-panel-close aria-label={`close ${label}`} data-tip="close — or press Esc">
          ✕
        </button>
      </p>
      {children}
    </section>
  );
}
