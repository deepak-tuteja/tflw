// Moving a file, and deleting one — `M218` `D`/`E` (`D1150`-`D1155`).
//
// **One component for both**, because they are the same dialog with different verbs: ask the
// server what would happen, show it, and do it only if the reader says so. The server is the
// authority in both halves — the preview here and the apply behind it call the same function
// (`D1150`) — so this file holds no rule about what may be moved or deleted. It shows an answer.
//
// ── THE TWO PROMISES ARE NOT THE SAME PROMISE ─────────────────────────────────────────────────
//
// A **move** repairs its own blast radius: the importers are rewritten in the same edit, and the
// dialog names them before the reader commits (`D1151`, `D1152`). A **delete** cannot — there is
// nothing to rewrite an importer *to* — so it is refused outright when anything imports the file
// (`D1153`), and when it is allowed the dialog says what git can and cannot give back about
// **this** file (`D1154`).
import { useCallback, useEffect, useState } from 'react';
import { deleteFile, moveFile, planDelete, planMove, type RefactorPlan } from './api';

export type FileActionKind = 'move' | 'delete';

export interface FileActionProps {
  readonly kind: FileActionKind;
  readonly path: string;
  /** The paths holding unsaved edits — `D1155`. A draft is not on disk, so no plan and no git
   *  answer can see it, and it is the one thing at risk that the server cannot report. */
  readonly unsaved: ReadonlySet<string>;
  readonly onClose: () => void;
  /** Applied. `to` is the new path for a move, `null` for a delete. */
  readonly onDone: (to: string | null) => void;
}

/** `tests/checkout.tflw` → the offset of `checkout`, so the dialog opens with the name selected
 *  and the directory left alone — `D1152`'s field is a path, but the common edit is the name. */
function basenameRange(p: string): [number, number] {
  const slash = p.lastIndexOf('/');
  return [slash + 1, p.length];
}

export function FileAction({ kind, path, unsaved, onClose, onDone }: FileActionProps) {
  const [to, setTo] = useState(path);
  const [plan, setPlan] = useState<RefactorPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // The plan is re-asked as the path is typed, so the preview describes what the field currently
  // says rather than what it said when the dialog opened.
  useEffect(() => {
    let live = true;
    const ask = kind === 'delete' ? planDelete(path) : planMove(path, to);
    void ask.then((p) => { if (live) setPlan(p); }).catch(() => { if (live) setPlan(null); });
    return () => { live = false; };
  }, [kind, path, to]);

  useEffect(() => {
    const esc = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const go = useCallback(async () => {
    setBusy(true);
    setFailed(null);
    const out = kind === 'delete' ? await deleteFile(path) : await moveFile(path, to);
    setBusy(false);
    if (!out.ok) { setFailed(out.error); return; }
    onDone(kind === 'delete' ? null : to);
  }, [kind, path, to, onDone]);

  const refused = plan !== null && plan.refusals.length > 0;
  const unchanged = kind === 'move' && to.trim() === path;
  const draft = unsaved.has(path);

  return (
    <div className="new-thing" role="dialog" aria-modal="true" aria-label={kind === 'delete' ? `delete ${path}` : `move ${path}`} data-file-action={kind}>
      <div className="new-thing-card">
        <h2>{kind === 'delete' ? `delete ${path}?` : `move or rename ${path}`}</h2>

        {kind === 'move' ? (
          <label className="field">
            new path
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-action-to
              aria-label="the file’s new path"
              autoFocus
              onFocus={(e) => { const [a, b] = basenameRange(e.target.value.replace(/\.tflw$/, '')); e.target.setSelectionRange(a, b); }}
            />
          </label>
        ) : null}

        {/* `D1155` — the bytes no plan and no `git` can see. Said before the verdict, because it is
            true whatever the verdict turns out to be. */}
        {draft ? (
          <p className="warn" data-action-draft>
            {kind === 'delete'
              ? 'this file has unsaved edits in the page — they are not on disk and deleting it loses them'
              : 'this file has unsaved edits in the page — they move with it'}
          </p>
        ) : null}

        {refused ? (
          <div data-action-refused>
            {plan!.refusals.map((r) => <p className="warn" key={r} data-action-refusal>{r}</p>)}
            {/* `D1153` names them so the reader knows what to fix first, rather than being told no. */}
            {kind === 'delete' && plan!.importers.length > 0 ? (
              <p className="muted">delete or re-point those first, or rename this file instead — a rename rewrites them for you.</p>
            ) : null}
          </div>
        ) : null}

        {/* The preview: what would be written, and why. `D1150` — this is the plan the apply runs,
            not a second description of it. */}
        {!refused && plan !== null && plan.edits.length > 1 ? (
          <div data-action-preview>
            <p className="muted">this also rewrites {plan.edits.length - 1} other file{plan.edits.length === 2 ? '' : 's'}:</p>
            <ul className="plan-edits">
              {plan.edits.slice(1).map((e) => <li key={e.path} data-action-edit={e.path}><code>{e.path}</code> — {e.why}</li>)}
            </ul>
          </div>
        ) : null}

        {!refused && kind === 'delete' && plan !== null ? (
          <p className={plan.recovery === 'tracked' ? 'muted' : 'warn'} data-action-recovery={plan.recovery ?? 'unknown'}>
            {plan.recovery === 'tracked'
              ? 'git has this file committed — `git checkout` brings it back.'
              : plan.recovery === 'untracked'
                ? 'this file has never been committed. Deleting it is permanent.'
                : 'this cannot be undone.'}
          </p>
        ) : null}

        {failed === null ? null : <p className="warn" data-action-failed>{failed}</p>}

        <div className="row">
          <button type="button" onClick={onClose} data-action-cancel>cancel</button>
          <button
            type="button"
            className={kind === 'delete' ? 'danger' : ''}
            disabled={busy || refused || plan === null || unchanged}
            onClick={() => { void go(); }}
            data-action-go={kind}
          >
            {busy ? 'working…' : kind === 'delete' ? 'delete it' : 'move it'}
          </button>
        </div>
      </div>
    </div>
  );
}
