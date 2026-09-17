// The Source tab — the file itself, and, while you are composing, the bytes the write will produce.
//
// `M205` `S5a` built this inside `ApiForm`; `M206` `S2a` lifted it out unchanged in behaviour,
// because **every door's Source tab is the same tab**. The rule says a tab is a stage of one file's
// life, and *reading the file* is a stage that does not vary by the kind of work you came to do —
// only Compose does. So this module is what the strip's second tab is, on all four doors, and the
// duplicate it would otherwise have become in BROWSER, LOAD and SCANS never exists.
//
// THE ATTRIBUTES LOST THEIR `api-` PREFIX HERE, and that is the point of the move rather than tidying
// after it. `data-api-source` on the BROWSER door would be a name asserting something untrue about
// the thing it labels — the exact drift class this repository files findings against — and a gate
// reading it would go on passing while saying the wrong word.
import type { diagnose } from './diagnose';
import type { FileView } from './api';

export function SourcePanel({ file, pending, diagnostics }: {
  readonly file: FileView | null;
  readonly pending: { ok: true; text: string } | { ok: false; reason: string };
  readonly diagnostics: ReturnType<typeof diagnose>;
}) {
  const pendingText = pending.ok ? pending.text : null;
  const unwritten = pendingText !== null && file !== null && pendingText !== file.text;
  const shown = unwritten ? pendingText : (file?.text ?? '');
  return (
    <div className="authoring source-panel" data-source={unwritten ? 'pending' : 'written'}>
      <p className="muted" data-source-state>
        {file === null
          ? 'no file open'
          : unwritten
            ? <>what <code>{file.path}</code> becomes when you press <em>write</em> — not what is on disk yet</>
            : <>{file.path} — as it is on disk</>}
      </p>
      <pre className="preview" data-preview>
        {shown}
      </pre>
      {/* `D1052` — what `tflw check` will say about these bytes. Shown, never blocking: the write
          route refuses what cannot be read (`D1049`), and an unbound `{'{'}token{'}'}` reads fine — it is
          just wrong, and the author should hear it here rather than in CI. */}
      {unwritten && diagnostics.length > 0 ? (
        <ul className="preview-diagnostics" data-diagnostics={diagnostics.length}>
          {diagnostics.map((d, i) => (
            <li key={i} className={d.severity} data-diagnostic-code={d.code}>
              <code>{d.code}</code> line {d.span.start.line} — {d.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
