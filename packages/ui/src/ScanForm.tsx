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
// error unless the env's `api` base is covered by an `authorized target` in `tflw.config`. So this
// is the one form whose output can be perfect and still not check, for a reason that lives in
// another file — and saying so before the write, with the line to add, is the whole difference
// between a signpost and a dead end.
//
// **THE REASON IS `D291`, AND IT WAS STATED AS TWO REASONS UNTIL `M207` `S4` (`M207-02`).** The old
// sentence said the target lives in a file *"this page does not write (`D1049`) and must not
// (`D291`)"*. `M205` `Q5` made the first half false the day before: `ConfigPanel` writes
// `tflw.config` through `PUT /api/config`, a second route with its own validation, chosen so that
// `D1049`'s one-write-call-site property for `.tflw` stayed untouched — *may this page edit the
// configuration* was always a separate question from *may it write tests*, and it was answered yes.
//
// That is worse than a wholly stale comment, which is why it was filed rather than quietly fixed. A
// reader who checks the claim finds the page **can** write `tflw.config` and may conclude the whole
// refusal is obsolete — removing a safeguard whose basis never moved. And it had a live consequence
// pointing the other way: `D291` says the affirmation must be the author's, and **typing it into the
// Config tab is the author making it**, so the repair was reachable from this page while the prose
// sent the reader somewhere else to do it by hand.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { buildApiStep, buildExpect, buildTest, insertIntoSource, type ExpectSpec, type HttpMethod, type Insertion, type MatcherName } from '@tflw/lang';
import { getFile, putFile, type FileView } from './api';
import { TabStrip } from './TabStrip';
import { SourcePanel } from './SourcePanel';
import type { TabId } from './doors';
import { diagnose } from './diagnose';
import type { ProjectView } from './contract';

export interface ScanFormProps {
  readonly project: ProjectView;
  readonly onWritten: (path: string) => void;
  /** The file this form is about (`M206` `Q4`) — from the address, resolved by the shell. */
  readonly filePath: string;
  readonly onFile: (path: string) => void;
  /** Which stage of this file's life is showing (`M205` §2). It lives in the URL and nowhere else
   *  (`D1045`), so the shell owns it and hands it down. */
  readonly tab: TabId;
  readonly onTab: (tab: TabId, focusLine?: number) => void;
  /** The project's runs, rendered by the shell. With this door the **last** inline placement goes
   *  away: after `S2` no door renders the run pane under its form. */
  readonly runPane: ReactNode;
  /** Why Run has something to say while you are composing. */
  readonly runMark?: string;
  /** The strip's two project-fact tabs, built by the shell (`M206` `S2a`). */
  readonly authPanel: ReactNode;
  readonly configPanel: ReactNode;
  readonly configMark?: string;
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

export function ScanForm({ project, onWritten, filePath, onFile, tab, onTab, runPane, runMark, authPanel, configPanel, configMark }: ScanFormProps) {
  const paths = useMemo(() => project.files.map((f) => f.path), [project]);
  const path = filePath;
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

  /** What a tab you are not looking at has to say — `M205` S5's three cases, unchanged by being
   *  the fourth door to say them. */
  const marks: Partial<Record<TabId, string>> = {};
  if (pending.ok && file && pending.text !== file.text) marks.source = 'Compose is holding bytes this file does not have yet';
  if (runMark) marks.run = runMark;
  if (configMark) marks.config = configMark;

  return (
    <section className="doorpane" data-scan-form>
      <TabStrip tab={tab} onTab={onTab} marked={marks} />

      {tab === 'source' ? <SourcePanel file={file} pending={pending} diagnostics={diagnostics} project={project} door="scan" /> : null}
      {tab === 'run' ? <div className="runpane" data-scan-run-tab>{runPane}</div> : null}
      {tab === 'auth' ? authPanel : null}
      {tab === 'config' ? configPanel : null}

      {tab !== 'compose' ? null : (
      <section className="authoring" data-scan-compose>
      <header className="authoring-head">
        <h2>write a security assertion</h2>
        <p className="muted">
          <code>has no … violations</code> grades the <em>last response</em> against a family of rules. The severity is a
          floor, so <code>serious</code> also counts <code>critical</code>.
        </p>
      </header>

      {/* The one notice no other door needs. `authorized target` lives in `tflw.config`, and the
          reason this form will not write one for you is `D291` alone: it is an affirmation only its
          author can make. The page CAN write that file — Config does, through `PUT /api/config`
          (`M205` `Q5`) — so the notice sends you to the tab where you make the affirmation yourself,
          which is what `D291` asks for, rather than to a text editor outside the product.

          `M207` `Q1` DIVIDED THIS FROM AUTH RATHER THAN DEDUPLICATING IT. Both surfaces describe
          `authorized target` out of one `tflw.config`, one tab apart, and they are not the same
          claim: **Auth answers *what is in force*, this answers *what your next write will hit***,
          which is a prediction about an assertion that does not exist yet. So the notice keeps only
          the forward-looking sentence and LINKS to Auth; Auth stays the only place that enumerates
          targets. Neither lists them twice, which is the duplicate-over-one-file class `M205`
          refused for the config editor and `S2a` caught in `M206` before it was written. */}
      {/* `M207` `S5` — THE REASON, AND IT IS SAID IN BOTH STATES BECAUSE OF WHAT THE MEASUREMENT
          SAID. The notice below renders only when the env declares **no** target, and all three
          projects on this machine declare one — `testFlow-tests` 2, `packages/ui/fixtures/project`
          1, `examples/storefront` 1. So moving Auth's justification into this branch as it stood
          would have put the explanation somewhere that renders in **none** of them, deleting it
          from the healthy case while every gate stayed green, because no corpus reaches the branch
          that would have shown the loss.

          Hence two states and one reason. The warning below is the unauthorized one; this is the
          authorized one, and it is the commoner by every corpus measured. */}
      <p className="muted" data-scan-why data-scan-why-targets={project.authorization.targets.length}>
        A scan issues requests nobody wrote, so the language makes you name what it may be pointed at, with a reason, in the file a
        reviewer reads (<code>TF060</code>). The reason is not optional and not a courtesy — it is printed in the run summary and
        embedded in every report.{' '}
        {authorized ? (
          <>
            <strong>
              {project.authorization.targets.length} authorized {project.authorization.targets.length === 1 ? 'target is' : 'targets are'} in
              force
            </strong>{' '}
            in env <code>{project.authorization.envName}</code>, and every assertion this form writes is gated by them.{' '}
          </>
        ) : null}
        {/* `Q1`'s link, and it is outside the branch above on purpose: Auth answers *what is in
            force*, and **none** is an answer to that question. A link that appeared only once
            something was authorized would be missing in exactly the state a reader most needs to go
            and look. */}
        <button className="linkish" onClick={() => onTab('auth')} data-scan-auth-link>
          what is in force here
        </button>
      </p>

      {!authorized ? (
        <p className="warn" data-scan-unauthorized>
          env <code>{project.authorization.envName}</code> declares no <code>authorized target</code>, so every assertion
          this form writes will be <code>TF060</code> until <code>tflw.config</code> declares one. That line is an affirmation that you are permitted
          to scan this host, so nobody but you can write it (<code>D291</code>) — <code>tflw init --scan</code> leaves it
          commented out for exactly that reason. Making it is what the <em>Config</em> tab is for; this form will not do it
          on your behalf.{' '}
          <button className="linkish" onClick={() => onTab('config')} data-scan-config-link>
            add it in Config
          </button>
        </p>
      ) : null}

      <div className="authoring-grid">
        <label>
          file
          <select value={path} onChange={(e) => onFile(e.target.value)} data-scan-file>
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
      )}
    </section>
  );
}
