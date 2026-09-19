// **Creating a test, and creating a file** (`M212` `S4`, `D1087`).
//
// `PUT /api/file` with no `If-Match` creates the file, and has since the route was written — the
// server says so in its own refusal text (*"no such file — omit If-Match to create it"*). **The
// page offered no control for it anywhere**, in Compose or in the explorer, so the only way to
// start a second file in a project was to leave the page. That is the third occurrence of this
// exact class: `M205` found project creation built and held unreachable by one `existsSync`, and
// `M209` found four shipped sites delegating to an explorer nobody had written.
//
// **ONE CONSTRUCTION PATH, AND IT IS THE WHOLE REASON THIS IS SAFE** (`D1087`). A dialog is a
// second authoring surface, and this repository already has the receipt for what those cost: the
// legacy form drifted until it was offering `/orders/{orderId}` and *"the orders endpoint answers"*
// as placeholders for whatever file happened to be open. So this builds its AST through
// `buildApiStep`/`buildExpect`/`buildTest` and splices it with `insertIntoSource` — the same
// functions Compose's own controls call — and writes it with the same `putFile`. There is no
// printer here, no template string of `.tflw` source, and nothing that could render a test one way
// while the pane renders it another.
//
// **The two modes differ in exactly one thing: where the test goes.** A new test is spliced into
// the open file under its current etag; a new file is the same test printed into an empty source
// and PUT with **no** etag, which is the create the route already supported. A file needs a name
// before it can exist, so that is the one extra field, and the test fields are shared — a guided
// start is worth more to a newcomer than an empty shell, which is what `D1087` chose over an
// in-place *add a declaration* gesture.
import { useEffect, useRef, useState } from 'react';
import { buildApiStep, buildExpect, buildTest, insertIntoSource, type ApiStepSpec } from '@tflw/lang';
import { putFile } from './api';

export type NewMode = 'test' | 'file';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

/** What the dialog would write, or why it cannot — recomputed on every keystroke, so the preview
 *  and the bytes cannot differ. Exported because every interesting case here is a refusal, and a
 *  refusal is cheaper to gate as a function than as a dialog. */
export function newSource(input: {
  readonly mode: NewMode;
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly into: string;
}): { ok: true; text: string } | { ok: false; reason: string } {
  if (input.name.trim() === '') return { ok: false, reason: 'the test needs a name — it is how a run reports it' };
  if (input.path.trim() === '') return { ok: false, reason: 'the request needs a path' };
  const step = buildApiStep({
    method: input.method as ApiStepSpec['method'],
    path: input.path.trim(),
    service: null,
    label: null,
    headers: [],
    body: null,
  });
  if (!step.ok) return { ok: false, reason: step.reason };
  // **The assertion is not optional and is not a preference.** `B3-17`: an `api` step with no
  // assertion can never fail, so a guided start that produced one would be teaching the shape the
  // checker warns about. `expect status equals 200` is the assertion 1,112 of the two corpora's
  // requests already carry.
  const expect = buildExpect({ soft: false, quantifier: null, subject: { kind: 'status' }, matcher: 'equals', operand: '200' });
  if (!expect.ok) return { ok: false, reason: expect.reason };
  const test = buildTest({ name: input.name.trim(), tags: [], workload: null, thresholds: [], body: [step.node, expect.node] });
  if (!test.ok) return { ok: false, reason: test.reason };
  const result = insertIntoSource(input.into, { kind: 'test', node: test.node });
  return result.ok ? { ok: true, text: result.text } : { ok: false, reason: result.reason };
}

/** A `.tflw` path the server will take, or why it will not. Checked here rather than left to the
 *  route, because *the file already exists* and *that is not a path* are different mistakes and the
 *  second one should never cost a round trip. */
export function newPathProblem(path: string, existing: readonly string[]): string | null {
  const p = path.trim();
  if (p === '') return 'the file needs a name';
  if (!p.endsWith('.tflw')) return 'a test file ends in .tflw';
  if (p.startsWith('/') || p.includes('..')) return 'the path is relative to the project, and cannot climb out of it';
  if (existing.includes(p)) return `${p} already exists — open it and add a test to it instead`;
  return null;
}

export function NewThing({ mode, openPath, openText, openEtag, existing, onDone, onCancel }: {
  readonly mode: NewMode;
  /** The file a new **test** goes into. */
  readonly openPath: string;
  readonly openText: string;
  readonly openEtag: string | null;
  readonly existing: readonly string[];
  readonly onDone: (written: { path: string; text: string; etag: string }) => void;
  readonly onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [method, setMethod] = useState<string>('GET');
  const [path, setPath] = useState('/');
  const [file, setFile] = useState('tests/new.tflw');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const first = useRef<HTMLInputElement | null>(null);

  // The first field takes focus when the dialog opens. A modal that opens with focus still behind
  // it is one where the next keystroke goes to the page underneath.
  useEffect(() => {
    first.current?.focus();
  }, []);

  const pathProblem = mode === 'file' ? newPathProblem(file, existing) : null;
  const built = newSource({ mode, name, method, path, into: mode === 'file' ? '' : openText });
  const problem = pathProblem ?? (built.ok ? null : built.reason);

  const create = async (): Promise<void> => {
    if (!built.ok || pathProblem !== null) return;
    setBusy(true);
    setFailed(null);
    // `null` is the create: the route reads a missing `If-Match` as *make this file*. A new
    // **test** goes into the open file under the etag it was read at, so a file changed by another
    // terminal surfaces as the `409` that guard exists for rather than being overwritten.
    const target = mode === 'file' ? file.trim() : openPath;
    const put = await putFile(target, built.text, mode === 'file' ? null : openEtag);
    setBusy(false);
    if (put.ok) onDone({ path: target, text: built.text, etag: put.etag });
    else setFailed(put.error);
  };

  return (
    <div className="new-thing" role="dialog" aria-modal="true" aria-label={mode === 'file' ? 'a new test file' : 'a new test'} data-new-thing={mode}>
      <div className="new-thing-card">
        <h3>{mode === 'file' ? 'a new test file' : `a new test in ${openPath}`}</h3>
        {mode === 'file' ? (
          <label className="field">
            file
            <input value={file} onChange={(e) => setFile(e.target.value)} data-new-file aria-label="file path" />
          </label>
        ) : null}
        <label className="field">
          name
          <input
            ref={mode === 'file' ? undefined : first}
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-new-name
            aria-label="test name"
            placeholder="it answers"
          />
        </label>
        <div className="row">
          <label className="field">
            method
            <select value={method} onChange={(e) => setMethod(e.target.value)} data-new-method aria-label="method">
              {METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="field">
            path
            <input value={path} onChange={(e) => setPath(e.target.value)} data-new-path aria-label="request path" />
          </label>
        </div>

        {/* **The bytes, before the button.** Not a courtesy — it is the same value `create` writes,
            so the preview cannot describe a different file from the one that lands. */}
        <pre className="preview" data-new-preview>{built.ok ? built.text : ''}</pre>
        {problem === null ? null : (
          <p className="muted" data-new-problem>
            {problem}
          </p>
        )}
        {failed === null ? null : (
          <p className="error" data-new-failed>
            {failed}
          </p>
        )}
        <div className="row">
          <button className="run" onClick={() => void create()} disabled={problem !== null || busy} data-new-create>
            {busy ? 'writing…' : mode === 'file' ? `create ${file.trim()}` : `add to ${openPath}`}
          </button>
          <button onClick={onCancel} data-new-cancel>
            cancel
          </button>
        </div>
      </div>
    </div>
  );
}
