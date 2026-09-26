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

/**
 * One entry in the Config tab's document switcher (`M208` `S2`).
 *
 * **The Config tab is the one tab whose subject is not the addressed file** — it renders
 * `tflw.config` while the hash names the `.tflw`. That is the strip's rule's second clause working
 * (*a project fact that file resolves against*), and until `M208` there was exactly one such fact,
 * so there was no pattern for *which* project document Config shows. `baseline` is the second, and
 * `@env` is that pattern: a document is named by the config block that declares it, because a
 * baseline **is** declared per env and an env name survives a rename of the JSON.
 */
export interface ConfigDocument {
  /** `null` is `tflw.config` itself — the address every link written before `M208` names. */
  readonly doc: string | null;
  /** What the switcher says. `tflw.config`, or the declared path. */
  readonly label: string;
  /** Where the declaration is, for the entries that have one — `defaults`, or `env <name>`. */
  readonly declaredIn: string | null;
}

/**
 * Every project document this config declares, `tflw.config` first.
 *
 * Read off the config's own **text**, not off a second server call, because the text is already
 * here and a list fetched separately is a list that can disagree with the file it describes. It is
 * read off the *disk* copy rather than the editor's: the switcher lists what the project declares,
 * and a `baseline` line somebody has typed but not saved is not yet a declaration — the server
 * would answer `404` for it, and a switcher entry that cannot be opened is worse than none.
 *
 * The **last** `baseline` in a block wins, which is what `resolveConfig` does with it; a block with
 * two is `TF081` and the page shows what a run would read.
 */
export function documentsOf(configOnDisk: string | null): readonly ConfigDocument[] {
  const out: ConfigDocument[] = [{ doc: null, label: 'tflw.config', declaredIn: null }];
  if (configOnDisk === null) return out;
  const { config } = parseConfigSource(configOnDisk);
  const blocks: { name: string; label: string; entries: readonly { type: string }[] }[] = [
    ...(config.defaults ? [{ name: 'defaults', label: 'defaults', entries: config.defaults.entries }] : []),
    ...config.envs.map((e) => ({ name: e.name, label: `env ${e.name}`, entries: e.entries })),
  ];
  for (const block of blocks) {
    const declared = [...block.entries].reverse().find((e) => e.type === 'BaselineDecl') as { path?: { value: string } } | undefined;
    if (declared?.path === undefined) continue;
    out.push({ doc: block.name, label: declared.path.value, declaredIn: block.label });
  }
  return out;
}

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
  /** Every document this project declares, `tflw.config` first (`M208` `S2`). */
  readonly documents: readonly ConfigDocument[];
  /** Which one the address names — `null` is `tflw.config`. */
  readonly doc: string | null;
  readonly onDoc: (doc: string | null) => void;
  /** The declared path of a `doc` that is not on disk yet, or `null` when there is nothing to say.
   *  A declared-but-unwritten baseline is the ordinary state of a project adopting triage, not a
   *  failure — see `getBaseline`. */
  readonly absentPath: string | null;
}

export function ConfigPanel({ text, disk, onChange, onSave, onReload, busy, problem, saved, focusLine, documents, doc, onDoc, absentPath }: ConfigPanelProps) {
  const area = useRef<HTMLTextAreaElement | null>(null);

  // The config dialect's diagnostics belong to the config dialect. A baseline document is JSON in
  // `D387`'s shape, and running the config parser over it would report a wall of `TF001`s about a
  // file that is not wrong — so the editor shows nothing here for a baseline and lets the server's
  // own `parseBaseline` be the bar, which is the strictest one in the project and the only one that
  // knows what a baseline is. `D1052` still holds for the config: shown, not blocking.
  const diagnostics = useMemo(() => (text === null || doc !== null ? [] : parseConfigSource(text).diagnostics), [text, doc]);
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

  const current = documents.find((d) => d.doc === doc) ?? documents[0];
  const switcher =
    documents.length < 2 ? null : (
      <nav className="doc-switcher" data-config-documents={documents.length} aria-label="project documents">
        {documents.map((d) => (
          <button
            key={d.doc ?? '@config'}
            className={d.doc === doc ? 'docpick on' : 'docpick'}
            onClick={() => onDoc(d.doc)}
            data-config-doc={d.doc ?? 'config'}
            aria-current={d.doc === doc ? 'true' : undefined}
            data-tip={d.declaredIn === null ? 'the project facts every file here resolves against' : `declared by \`baseline\` in ${d.declaredIn}`}
          >
            {d.label}
            {d.declaredIn === null ? null : <span className="muted"> · {d.declaredIn}</span>}
          </button>
        ))}
      </nav>
    );

  // A declared document that has never been written is not an error and does not look like one:
  // the declaration is really there, the file is not, and the repair is to accept a finding into
  // it. Shown as an editable empty document rather than as a refusal, so the author can also just
  // write one.
  if (text === null && absentPath !== null) {
    return (
      <div className="authoring config-panel" data-api-config="absent">
        {switcher}
        <header className="authoring-head">
          <h2>{absentPath}</h2>
          <p className="muted">
            Declared by <code>baseline</code> in {current?.declaredIn ?? 'this config'}, and not written yet — which is where every
            project adopting triage starts. <code>[accept]</code> on a finding writes the first entry; so does saving here.
          </p>
        </header>
        <textarea
          ref={area}
          className="config-text"
          value={''}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
          rows={20}
          data-api-config-text
          placeholder={'{\n  "version": 1,\n  "accepted": []\n}'}
          aria-label="the accepted-findings document"
          data-tip="the accepted-findings document — version 1, and an `accepted` array of fingerprints"
        />
      </div>
    );
  }

  if (text === null) {
    return (
      <div className="authoring config-panel" data-api-config="loading">
        <p className="muted">reading {current?.label ?? 'tflw.config'}…</p>
      </div>
    );
  }

  return (
    <div className="authoring config-panel" data-api-config={unsaved ? 'unsaved' : 'saved'} data-config-showing={doc ?? 'config'}>
      {switcher}
      <header className="authoring-head">
        <h2>{current?.label ?? 'tflw.config'}</h2>
        <p className="muted">
          {doc === null ? (
            <>
              The project facts every file here resolves against — the base URLs, the envs, the sessions, the authorized targets. This
              is the same file <code>tflw run</code> reads, written the same way; nothing on this page reformats it.
            </>
          ) : (
            <>
              The findings this project has accepted, declared by <code>baseline</code> in {current?.declaredIn ?? 'this config'}. A
              listed finding still appears in every report, badged <em>known/accepted</em> — it is deferred, not suppressed. Delete a
              line to un-accept it.
            </>
          )}
        </p>
      </header>

      {/* **The surface that can break every test in the project in one keystroke, and it had no
          accessible name at all** — `M229` `F` (`D1256`). Its own tab already says what this file
          is (*"the project facts every file here resolves against"*); the editor said nothing a
          screen reader could use, and said the rest in the OS's voice after a one-second hover,
          which is `M216` `B`'s whole finding on a surface that round did not reach. */}
      <textarea
        ref={area}
        className="config-text"
        value={text}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        rows={20}
        data-api-config-text
        aria-label={doc === null ? 'tflw.config' : 'the accepted-findings document'}
        data-tip={
          doc === null
            ? 'tflw.config — declarations only, read by `tflw check` as this page reads it'
            : 'the accepted-findings document — the match is on `fingerprint` alone, and `rule`/`endpoint` are there for you'
        }
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
        <button
          onClick={onSave}
          disabled={busy || !unsaved || errors.length > 0}
          data-api-config-save
          data-tip={`write ${current?.label ?? 'tflw.config'} back, under the version this page read`}
        >
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
          <button className="linkish" onClick={onReload} data-api-config-reload data-tip="read tflw.config again — this discards what is on this page">
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
