// The Config tab (`M205` S5b, Q5) — the one editor for `tflw.config`, closing `M205-03`.
//
// **THE FINDING THIS CLOSES IS THAT THE PRODUCT TOLD YOU TO MAKE AN EDIT ITS OWN PAGE REFUSED.**
// `tflw init`'s scaffold says *swap this one line for your service*, and the demo service's 404
// hint says the same thing in a terminal — while `resolveWritablePath` turned `tflw.config` away
// because *"a different capability wearing this one's clothes"*. That refusal was right and still
// is: this writes through `PUT /api/config`, a second route with its own validation, so `D1049`'s
// one-write-call-site property for `.tflw` is untouched and *may this page edit the project's
// configuration* stayed a separate question from *may it write tests*.
//
// A TEXTAREA AND NOT A FORM, ON PURPOSE. Every other authoring surface in this page is a form over
// the printer, because a `.tflw` file is generated from field values and shown back. A config is
// *read* by people far more often than it is written — it is the file a reviewer opens to find out
// what a scan was allowed to touch — and a form over it would have to round-trip comments, which
// is the whole of why `tflw fmt` is a token-stream formatter rather than a printer (`D994`).
// So the author's own bytes are the subject, nothing reformats them, and the etag the server hands
// back is computed over exactly what is on this page.
//
// `D1052` HOLDS HERE TOO: the diagnostics below are what `tflw check` will say, shown and never
// blocking. What blocks is only what the server refuses — text that does not parse — because a
// config that does not parse takes `GET /api/project` down with it, and a page allowed to write
// one could lock itself out of the project it is editing.

import { useEffect, useMemo, useRef } from 'react';
import { parseConfigSource } from '@tflw/lang';

export interface ConfigPanelProps {
  /** `null` while the first read is in flight. */
  readonly text: string | null;
  /** What is on disk as of the last read or write — what `text` is compared against to know
   *  whether there is anything to save. */
  readonly disk: string | null;
  readonly onChange: (text: string) => void;
  readonly onSave: () => void;
  /** Read `tflw.config` again, discarding what is on this page — the only repair for a `409`. */
  readonly onReload: () => void;
  readonly busy: boolean;
  readonly problem: string | null;
  readonly saved: string | null;
  /** The line an `[edit]` link asked for — the hash's third segment. */
  readonly focusLine: number | null;
}

export function ConfigPanel({ text, disk, onChange, onSave, onReload, busy, problem, saved, focusLine }: ConfigPanelProps) {
  const area = useRef<HTMLTextAreaElement | null>(null);

  const diagnostics = useMemo(() => (text === null ? [] : parseConfigSource(text).diagnostics), [text]);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const unsaved = text !== null && disk !== null && text !== disk;

  /**
   * Land on the line an `[edit]` link named.
   *
   * It selects the whole line rather than placing a caret at its start, because the promise Auth
   * makes is *"focused on that block"* — a caret in a 40-line file is not visibly anywhere, and a
   * reader who followed a link needs to see that they arrived. The scroll is computed from the
   * line height rather than from a DOM measurement: a textarea has no per-line boxes to measure.
   *
   * Keyed on the tab as well as the line (the parent remounts nothing, so this effect is the only
   * thing that fires) — which means clicking the same `[edit]` twice from Auth focuses twice, and
   * clicking it once and then scrolling away does not snatch the view back.
   */
  useEffect(() => {
    const el = area.current;
    if (el === null || focusLine === null || text === null) return;
    const lines = text.split('\n');
    const index = Math.min(Math.max(focusLine, 1), lines.length) - 1;
    const start = lines.slice(0, index).reduce((n, l) => n + l.length + 1, 0);
    el.focus();
    el.setSelectionRange(start, start + (lines[index]?.length ?? 0));
    const lineHeight = el.scrollHeight / Math.max(lines.length, 1);
    el.scrollTop = Math.max(0, lineHeight * index - el.clientHeight / 2);
  }, [focusLine, text]);

  if (text === null) {
    return (
      <div className="authoring config-panel" data-api-config="loading">
        <p className="muted">reading tflw.config…</p>
      </div>
    );
  }

  return (
    <div className="authoring config-panel" data-api-config={unsaved ? 'unsaved' : 'saved'}>
      <header className="authoring-head">
        <h2>tflw.config</h2>
        <p className="muted">
          The project facts every file here resolves against — the base URLs, the envs, the sessions, the authorized targets. This is
          the same file <code>tflw run</code> reads, written the same way; nothing on this page reformats it.
        </p>
      </header>

      <textarea
        ref={area}
        className="config-text"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        rows={20}
        data-api-config-text
        title="tflw.config — the declaration-only dialect; `tflw check` reads it the same way this page does"
      />

      {/* `D1052` — shown, not blocking. An error also stops the save, because the server refuses
          it anyway and a button that produces a 422 every time is a button that lies. A warning
          does not: `tflw check`'s warnings are advice, and a config you cannot save until the
          advice is taken is a config you edit in a terminal instead. */}
      {diagnostics.length > 0 ? (
        <ul className="preview-diagnostics" data-api-config-diagnostics={diagnostics.length}>
          {diagnostics.map((d, i) => (
            <li key={i} className={d.severity} data-diagnostic-code={d.code}>
              <code>{d.code}</code> line {d.span.start.line} — {d.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="authoring-actions">
        <button onClick={onSave} disabled={busy || !unsaved || errors.length > 0} data-api-config-save title="write tflw.config back, under the version this page read">
          save
        </button>
        <span className="muted" data-api-config-state>
          {errors.length > 0
            ? `${errors.length} error${errors.length === 1 ? '' : 's'} — fix ${errors.length === 1 ? 'it' : 'them'} and this saves`
            : unsaved
              ? 'unsaved changes'
              : 'nothing to save — this is what is on disk'}
        </span>
      </div>

      {/* A refusal, and the one gesture that repairs the refusal that cannot be repaired by typing.
          `409` means somebody else wrote this file since this page read it — a terminal, another
          tab, a `tflw init` — and there is no correct automatic answer, because re-reading throws
          away what you typed. So it is a button, next to the reason, and it says what it costs. */}
      {problem ? (
        <p className="error" data-api-config-problem>
          {problem}{' '}
          <button className="linkish" onClick={onReload} data-api-config-reload title="read tflw.config again — this discards what is on this page">
            [re-read from disk]
          </button>
        </p>
      ) : null}
      {saved ? (
        <p className="muted" data-api-config-saved>
          {saved}
        </p>
      ) : null}
    </div>
  );
}
