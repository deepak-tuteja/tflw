// The SCANS door's authoring pane (`M200` `A2-3`).
//
// WHAT THIS DOOR WRITES IS AN ASSERTION, NOT A DECLARATION, and that is a measurement rather than
// a preference. `A2`'s census (PLAN §4c) counted **102 scan matchers across 51 files** against
// **11 `crawl` declarations in 4 files, 6 of them `.checkonly` fixtures written to be rejected** —
// three real crawls in the whole corpus. So the common act is *grade the response this test
// already fetched*, and the crawl is the specialist. A door leading with the specialist would
// teach the rarer half first.
//
// IT SHOWS THE AUTHORIZATION STATE, WHICH NO OTHER DOOR HAS TO. `TF060` makes a scan assertion an
// error unless the env's `api` base is covered by an `authorized target` in `tflw.config` — a file
// this page deliberately cannot write (`D1049`, `D1053`). So this is the one form whose output can
// be perfect and still not check, for a reason that lives somewhere the author has to go and edit
// by hand. Saying so before the write, with the exact line to uncomment, is the whole difference
// between a signpost and a dead end.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildApiStep, buildExpect, buildTest, insertIntoSource, type ExpectSpec, type HttpMethod, type Insertion, type MatcherName } from '@tflw/lang';
import { getFile, putFile, type FileView } from './api';
import { diagnose } from './diagnose';
import type { ProjectView } from './contract';

export interface ScanFormProps {
  readonly project: ProjectView;
  readonly onWritten: (path: string) => void;
}

/** The three families this door can write. `a11y` is absent because its only subject is `page`,
 *  which belongs to BROWSER — the same reason `A2-1`'s printer prints the matcher and not one
 *  a11y assertion. */
const FAMILIES: ReadonlyArray<readonly [MatcherName, string, string]> = [
  ['hasNoSecurityViolations', 'security', 'headers, cookies and CORS on the response itself'],
  ['hasNoAuthzViolations', 'authorization', 're-issues the request as other principals — needs `as <session>`'],
  ['hasNoInputHandlingViolations', 'input handling', 'sends oversized and traversal-shaped values — needs `probe` opt-ins'],
];

/** A **floor**, not a filter: `serious` also counts `critical`. Omitted is the commoner spelling —
 *  72 of the corpus' 102 scan assertions name none — so it leads the list. */
const FLOORS = ['', 'minor', 'moderate', 'serious', 'critical'] as const;
type Floor = (typeof FLOORS)[number];

export function ScanForm({ project, onWritten }: ScanFormProps) {
  const paths = useMemo(() => project.files.map((f) => f.path), [project]);
  const [path, setPath] = useState(paths[0] ?? '');
  const [file, setFile] = useState<FileView | null>(null);
  const [mode, setMode] = useState<'new' | 'existing'>('existing');
  const [testName, setTestName] = useState('');
  const [family, setFamily] = useState<MatcherName>('hasNoSecurityViolations');
  const [floor, setFloor] = useState<Floor>('');
  // `check` records the failure and carries on; `expect` stops the test. The corpus writes both,
  // and `crawl.tflw` explains why a crawl reaches for the soft form — so it is a choice, not a
  // default nobody sees.
  const [soft, setSoft] = useState(false);
  const [name, setName] = useState('the response gives nothing away');
  const [tags, setTags] = useState('security');
  const [method, setMethod] = useState<HttpMethod>('GET');
  const [reqPath, setReqPath] = useState('/health');
  const [session, setSession] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [wrote, setWrote] = useState<string | null>(null);

  useEffect(() => {
    if (!path) return;
    setFile(null);
    getFile(path)
      .then(setFile)
      .catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  }, [path]);

  const testsInFile = useMemo(() => project.files.find((f) => f.path === path)?.tests ?? [], [project, path]);

  const expectSpec = useCallback(
    (): ExpectSpec => ({
      soft,
      quantifier: null,
      subject: { kind: 'response' },
      matcher: family,
      operand: null,
      ...(floor === '' ? {} : { severityFloor: floor }),
    }),
    [soft, family, floor],
  );

  const pending = useMemo((): { ok: true; text: string } | { ok: false; reason: string } => {
    if (!file) return { ok: false, reason: 'reading the file…' };
    const assertion = buildExpect(expectSpec());
    if (!assertion.ok) return { ok: false, reason: assertion.reason };

    if (mode === 'existing') {
      if (testName === '') return { ok: false, reason: 'pick the test whose response you want graded' };
      const result = insertIntoSource(file.text, { kind: 'steps', testName, nodes: [assertion.node] });
      return result.ok ? { ok: true, text: result.text } : { ok: false, reason: result.reason };
    }

    // A new test needs a request for the assertion to be about: a scan grades the LAST response,
    // so a test that asserts one without fetching anything is a file `tflw check` rejects
    // (`assert-before-any-request`). The two are one edit for the same reason `A1-4` made a
    // request and its assertions one edit.
    const step = buildApiStep({ method, path: reqPath, headers: [], body: null, service: null, label: null });
    if (!step.ok) return { ok: false, reason: step.reason };
    const test = buildTest({
      name,
      tags: tags.split(/[\s,]+/).filter(Boolean),
      workload: null,
      thresholds: [],
      body: [step.node, assertion.node],
      ...(session.trim() === '' ? {} : { sessions: [session.trim()] }),
    });
    if (!test.ok) return { ok: false, reason: test.reason };
    const insertion: Insertion = { kind: 'test', node: test.node };
    const result = insertIntoSource(file.text, insertion);
    return result.ok ? { ok: true, text: result.text } : { ok: false, reason: result.reason };
  }, [file, mode, testName, expectSpec, method, reqPath, name, tags, session]);

  /**
   * `D1052`, with the options that make it true for this door.
   *
   * The other forms call `diagnose(text)`; a scan assertion's commonest fault is `TF060`, which
   * `checkProgram` cannot raise without the env's declarations — so the server's `authorization`
   * block is passed straight through. Without it this panel would have shown a clean file and the
   * author would have met the error in a terminal, which is the exact surprise `D1052` exists to
   * prevent, on the one door where it is guaranteed rather than possible.
   */
  const diagnostics = useMemo(
    () => (pending.ok ? diagnose(pending.text, { envAuthorizedTargets: project.authorization }) : []),
    [pending, project.authorization],
  );

  /** Whether this env can authorize a scan at all, and what to say when it cannot. Derived from
   *  the same block the checker reads, so the notice and the diagnostics cannot disagree. */
  const authorized = useMemo(() => project.authorization.targets.length > 0, [project.authorization]);

  const save = useCallback(async () => {
    if (!file || !pending.ok) return;
    setBusy(true);
    setProblem(null);
    const res = await putFile(path, pending.text, file.etag);
    setBusy(false);
    if (!res.ok) {
      setProblem(res.status === 409 ? `${res.error} — reopen the file and apply this again` : res.code ? `${res.code} at line ${res.line}: ${res.error}` : res.error);
      return;
    }
    setFile({ path, text: pending.text, etag: res.etag });
    setWrote(path);
    onWritten(path);
  }, [file, pending, path, onWritten]);

  return (
    <section className="authoring" data-scan-form>
      <header className="authoring-head">
        <h2>write a security assertion</h2>
        <p className="muted">
          <code>has no … violations</code> grades the <em>last response</em> against a family of rules. The severity is a
          floor, so <code>serious</code> also counts <code>critical</code>.
        </p>
      </header>

      {/* The one notice no other door needs. `authorized target` lives in `tflw.config`, which this
          page does not write (`D1049`) and must not (`D291`: it is an affirmation only its author
          can make) — so the door names the file, the line and the reason instead. */}
      {!authorized ? (
        <p className="warn" data-scan-unauthorized>
          env <code>{project.authorization.envName}</code> declares no <code>authorized target</code>, so every assertion
          this form writes will be <code>TF060</code> until you add one to <code>tflw.config</code>. That line is an
          affirmation that you are permitted to scan this host, so nobody but you can write it —{' '}
          <code>tflw init --scan</code> leaves it commented out for exactly that reason.
        </p>
      ) : null}

      <div className="authoring-grid">
        <label>
          file
          <select value={path} onChange={(e) => setPath(e.target.value)} data-scan-file>
            {paths.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>

        <label>
          what
          <select value={mode} onChange={(e) => setMode(e.target.value as 'new' | 'existing')} data-scan-mode>
            <option value="existing">grade a response a test already fetches</option>
            <option value="new">a new test, with its own request</option>
          </select>
        </label>

        {mode === 'existing' ? (
          <label>
            test
            <select value={testName} onChange={(e) => setTestName(e.target.value)} data-scan-test>
              <option value="">…</option>
              {testsInFile.map((t) => (
                <option key={t.name} value={t.name}>{t.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>
              name
              <input value={name} onChange={(e) => setName(e.target.value)} data-scan-name />
            </label>
            <label>
              tags
              <input value={tags} onChange={(e) => setTags(e.target.value)} data-scan-tags />
            </label>
            <label>
              request
              <span className="request-row">
                <select value={method} onChange={(e) => setMethod(e.target.value as HttpMethod)} data-scan-method>
                  {(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const).map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <input value={reqPath} onChange={(e) => setReqPath(e.target.value)} data-scan-path />
              </span>
            </label>
            <label>
              as (session)
              <input value={session} onChange={(e) => setSession(e.target.value)} placeholder="optional" data-scan-session />
            </label>
          </>
        )}

        <label>
          family
          <select value={family} onChange={(e) => setFamily(e.target.value as MatcherName)} data-scan-family>
            {FAMILIES.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>

        <label>
          severity floor
          <select value={floor} onChange={(e) => setFloor(e.target.value as Floor)} data-scan-floor>
            {FLOORS.map((f) => (
              <option key={f} value={f}>{f === '' ? 'every severity' : f}</option>
            ))}
          </select>
        </label>

        <label className="tick">
          <input type="checkbox" checked={soft} onChange={(e) => setSoft(e.target.checked)} data-scan-soft />
          <code>check</code> instead of <code>expect</code> — record the failure and carry on
        </label>
      </div>

      <p className="muted" data-scan-note>
        {FAMILIES.find(([id]) => id === family)?.[2]}
      </p>

      {pending.ok ? (
        <>
          <pre className="preview" data-scan-preview>
            {pending.text}
          </pre>
          {diagnostics.length > 0 ? (
            <ul className="preview-diagnostics" data-scan-diagnostics={diagnostics.length}>
              {diagnostics.map((d, i) => (
                <li key={i} className={d.severity} data-diagnostic-code={d.code}>
                  <code>{d.code}</code> line {d.span.start.line} — {d.message}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="warn" data-scan-problem>
          {pending.reason}
        </p>
      )}

      <div className="authoring-actions">
        <button className="run" onClick={() => void save()} disabled={!pending.ok || busy} data-scan-save>
          {busy ? 'writing…' : `write ${path}`}
        </button>
        {wrote ? (
          <span className="muted" data-scan-wrote={wrote}>
            written — <code>{wrote}</code> is what <code>tflw run</code> will read
          </span>
        ) : null}
        {problem ? (
          <span className="error" data-scan-error>
            {problem}
          </span>
        ) : null}
      </div>
    </section>
  );
}
