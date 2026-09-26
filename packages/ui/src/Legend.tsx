// The legend — `M240` `C` (`D1292`): what the keyboard does here, and (from slice `D`) what each
// panel is for, one short entry with its docs link. Opened by `?` and by the door bar's `?`,
// closed by `Escape`, its ✕, or a click outside. One dialog for both because a reader who asks
// *what can I press* and one who asks *what is this panel* are the same reader five seconds apart.

import { useEffect, useRef } from 'react';
import { SHORTCUTS, spell } from './shortcuts';

export interface LegendEntry {
  readonly title: string;
  readonly text: string;
  readonly href?: string;
}

export function Legend({ open, onClose, entries = [] }: { readonly open: boolean; readonly onClose: () => void; readonly entries?: readonly LegendEntry[] }) {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    box.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="new-thing" data-legend onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="new-thing-card legend" role="dialog" aria-modal="true" aria-label="keys and panels" tabIndex={-1} ref={box}>
        <h2>keys</h2>
        <dl className="legend-keys" data-legend-keys={SHORTCUTS.length}>
          {SHORTCUTS.map((s) => (
            <div key={s.id} data-legend-key={s.id}>
              <dt><kbd>{spell(s.keys)}</kbd></dt>
              <dd>{s.label}</dd>
            </div>
          ))}
        </dl>
        {entries.length > 0 ? (
          <>
            <h2>panels</h2>
            <dl className="legend-panels" data-legend-panels={entries.length}>
              {entries.map((en) => (
                <div key={en.title} data-legend-panel={en.title}>
                  <dt>{en.title}</dt>
                  <dd>
                    {en.text}
                    {en.href ? (
                      <>
                        {' '}
                        <a href={en.href} target="_blank" rel="noreferrer">docs</a>
                      </>
                    ) : null}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}
        <div className="row">
          <button type="button" onClick={onClose} data-legend-close>
            close
          </button>
        </div>
      </div>
    </div>
  );
}
