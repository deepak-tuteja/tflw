// The API door's authoring pane (`M200` `A1-4`) — the second form in tflw that writes a file,
// and the first that writes *work* rather than a policy about work.
//
// IT IS `LoadForm`'s SHAPE AND NOT ITS COPY. Both hold field values and nothing else: the nodes
// come from `@tflw/lang`'s builders, the splice and the format from `insertIntoSource`, the write
// from `putFile` under the etag the source was read at. All of it runs in this browser, because
// the language package has no dependencies and no Node builtins — so there is no second
// implementation here for the CLI's to drift from.
//
// WHAT IT ADDS TO THE LOAD FORM IS THE `steps` INSERTION. A LOAD form can only ever write a
// policy — a workload line, a threshold — because `api` steps are this door's vocabulary, which
// is the gap `A0-5`'s green-condition test had to work around and said so where it did. This is
// `D1044` from the writing side: a door adds the work it knows how to describe, to a test any
// door may have started.
//
// A REQUEST AND ITS ASSERTIONS ARE ONE EDIT. They are built together and spliced together,
// because `D1049` makes each write a real PUT — and a file that, between two of them, asserts
// against a response nothing fetched is a file somebody's CI can catch mid-edit.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  buildApiStep,
  buildExpect,
  buildTest,
  insertIntoSource,
  type ApiBodySpec,
  type ApiStepSpec,
  type ExpectSpec,
  type SubjectSpec,
} from '@tflw/lang';
import { getFile, putFile, dropScratch, startRun, subscribe, getResults, type FileView } from './api';
import { diagnose } from './diagnose';
import { TabStrip } from './TabStrip';
import type { TabId } from './doors';
import type { EndEvent, ProjectView, RunReport, StepResult } from './contract';

export interface ApiFormProps {
  readonly project: ProjectView;
  readonly onWritten: (path: string) => void;
  /** Which stage of this file's life is showing (`M205` §2). It lives in the URL and nowhere else
   *  (`D1045`), so the shell owns it and hands it down — this form does not remember a tab. */
  readonly tab: TabId;
  readonly onTab: (tab: TabId) => void;
  /** The project's runs, rendered by the shell. Passed in rather than imported so that `Run` can
   *  be a tab of this file's strip without this form learning what a report directory is. */
  readonly runPane: ReactNode;
  /** Why Run has something to say while you are composing — the shell knows about live runs and
   *  this form does not. */
  readonly runMark?: string;
}

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
type Method = (typeof METHODS)[number];

type BodyKind = 'none' | 'json' | 'text' | 'file' | 'form';

/** The subjects this form offers, in the words the language uses for them. `body` and `header`
 *  carry an argument; the rest are bare. Locators, `page` and the scan subjects are other doors'. */
const SUBJECTS = [
  ['status', 'status'],
  ['body', 'body …'],
  ['bodyText', 'body text'],
  ['bodyBytes', 'body bytes'],
  ['header', 'header "…"'],
  ['duration', 'duration'],
  ['request', 'request'],
  ['value', '{value}'],
] as const;
type SubjectKind = (typeof SUBJECTS)[number][0];

/** Matchers, split by whether they need an operand — the split the form has to know to disable a
 *  field, and the same one `buildExpect` enforces so the two cannot disagree silently. */
const MATCHERS = [
  ['equals', 'equals'],
  ['contains', 'contains'],
  ['matches', 'matches (regex)'],
  ['matchesSubset', 'matches subset'],
  ['greaterThan', 'is greater than'],
  ['lessThan', 'is less than'],
  ['hasCount', 'has count'],
  ['hasValue', 'has value'],
  ['connects', 'connects'],
  ['fails', 'fails'],
] as const;
type MatcherKind = (typeof MATCHERS)[number][0];
const OPERANDLESS: ReadonlySet<MatcherKind> = new Set<MatcherKind>(['connects', 'fails']);

interface ExpectRow {
  readonly soft: boolean;
  readonly quantifier: '' | 'any' | 'all';
  readonly subject: SubjectKind;
  /** The header name, or the body path — one field, because only one subject at a time uses it. */
  readonly argument: string;
  readonly matcher: MatcherKind;
  readonly operand: string;
}

/** The one test name Send writes. Fixed, because `--only` has to name it and an exploration
 *  that renamed itself on every press would leave a file nobody could re-run by hand. */
const SCRATCH_TEST = 'scratch';

const EMPTY_ROW: ExpectRow = { soft: false, quantifier: '', subject: 'status', argument: '', matcher: 'equals', operand: '200' };

interface HeaderRow {
  readonly name: string;
  readonly value: string;
}

export function ApiForm({ project, onWritten, tab, onTab, runPane, runMark }: ApiFormProps) {
  const files = useMemo(() => project.files.map((f) => f.path), [project]);
  const [path, setPath] = useState(files[0] ?? '');
  const [file, setFile] = useState<FileView | null>(null);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [testName, setTestName] = useState('');
  /**
   * **The form opens empty** — `M205` Q9, closing `M205-02`.
   *
   * It used to open on `@api test "the orders endpoint answers"` / `api GET /orders`, and a
   * project `tflw init` scaffolds points `api` at tflw's own demo service, which answers
   * `GET /health` and nothing else. So the first gesture a new author made — press `send`,
   * unchanged — returned **404**, out of the box, with nothing broken: two halves of one product
   * shipping defaults that disagreed, met on the first click.
   *
   * A default request is a guess about somebody's project, and an empty field cannot contradict
   * one. What the guess was worth is kept where it belongs: as a **placeholder**, which shows the
   * shape of an answer and never becomes a test the author did not write.
   *
   * `method` and the one `expect status equals 200` row are deliberately NOT emptied, and neither
   * is a guess about the project. `GET` is the identity choice of a control that must hold some
   * value. The assertion is load-bearing: `B3-17` records that an `api` step with no assertions
   * **can never fail**, so a form that opened with no assertion row would make the shortest path
   * through this page a test that passes for having claimed nothing.
   */
  const [name, setName] = useState('');
  const [tags, setTags] = useState('');

  const [service, setService] = useState('');
  const [method, setMethod] = useState<Method>('GET');
  const [requestPath, setRequestPath] = useState('');
  const [label, setLabel] = useState('');
  const [headers, setHeaders] = useState<readonly HeaderRow[]>([]);
  const [bodyKind, setBodyKind] = useState<BodyKind>('none');
  const [bodyText, setBodyText] = useState('{ }');
  const [formFields, setFormFields] = useState<readonly HeaderRow[]>([{ name: 'email', value: '' }]);
  const [rows, setRows] = useState<readonly ExpectRow[]>([EMPTY_ROW]);

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

  /** Every test in the file, not only the ones behind this door — `D1044` again: an API step is
   *  legal in a test a LOAD form started, and that is the case this form exists to reach. */
  const testsInFile = useMemo(() => project.files.find((f) => f.path === path)?.tests ?? [], [project, path]);

  const bodySpec = useCallback((): ApiBodySpec | null => {
    switch (bodyKind) {
      case 'none': return null;
      case 'json': return { kind: 'json', text: bodyText };
      case 'text': return { kind: 'text', text: bodyText };
      case 'file': return { kind: 'file', path: bodyText };
      case 'form': return { kind: 'form', fields: formFields.map((f) => ({ key: f.name, value: f.value })) };
    }
  }, [bodyKind, bodyText, formFields]);

  const stepSpec = useCallback((): ApiStepSpec => ({
    service: service.trim() === '' ? null : service.trim(),
    method,
    path: requestPath,
    headers: headers.map((h) => ({ name: h.name, value: h.value })),
    body: bodySpec(),
    label: label.trim() === '' ? null : label.trim(),
  }), [service, method, requestPath, headers, bodySpec, label]);

  const subjectSpec = (row: ExpectRow): SubjectSpec => {
    switch (row.subject) {
      case 'header': return { kind: 'header', name: row.argument };
      case 'body': return { kind: 'body', path: row.argument };
      case 'value': return { kind: 'value', ref: row.argument };
      default: return { kind: row.subject };
    }
  };

  const expectSpec = (row: ExpectRow): ExpectSpec => ({
    soft: row.soft,
    quantifier: row.quantifier === '' ? null : row.quantifier,
    subject: subjectSpec(row),
    matcher: row.matcher,
    operand: OPERANDLESS.has(row.matcher) && row.operand.trim() === '' ? null : row.operand,
  });

  /**
   * The source this form would write, recomputed on every keystroke — the preview *and* the bytes
   * the PUT carries, so the two cannot differ. A refusal from any builder arrives here as text
   * rather than as an error, because every one of them names a field somebody can fix.
   */
  const pending = useMemo((): { ok: true; text: string } | { ok: false; reason: string } => {
    if (!file) return { ok: false, reason: 'reading the file…' };

    const step = buildApiStep(stepSpec());
    if (!step.ok) return { ok: false, reason: step.reason };

    const built = rows.map((r) => buildExpect(expectSpec(r)));
    const bad = built.find((b) => !b.ok);
    if (bad && !bad.ok) return { ok: false, reason: bad.reason };
    const nodes = [step.node, ...built.flatMap((b) => (b.ok ? [b.node] : []))];

    if (mode === 'existing') {
      if (testName === '') return { ok: false, reason: 'pick the test to add to' };
      const result = insertIntoSource(file.text, { kind: 'steps', testName, nodes });
      return result.ok ? { ok: true, text: result.text } : { ok: false, reason: result.reason };
    }

    const test = buildTest({
      name,
      tags: tags.split(/[\s,]+/).filter(Boolean),
      workload: null,
      thresholds: [],
      body: nodes,
    });
    if (!test.ok) return { ok: false, reason: test.reason };
    const result = insertIntoSource(file.text, { kind: 'test', node: test.node });
    return result.ok ? { ok: true, text: result.text } : { ok: false, reason: result.reason };
  }, [file, mode, testName, name, tags, rows, stepSpec]);

  /**
   * `D1047`'s Send: write a scratch file, run it for real, read the response out of the report.
   *
   * THERE IS NO SECOND EXECUTION PATH, and that is the whole decision. The rejected alternative
   * was a pane that fires the request through tflw's own HTTP client with no run and no report —
   * Postman's actual feel, and a place where a request could succeed unsaved and fail saved. So
   * Send writes `scratch.tflw` through the same `PUT /api/file` the save button uses, starts the
   * same `tflw run` the sidebar starts, and reads `results.json` — one execution path, one
   * artefact kind, and a page that cannot disagree with a terminal or with CI.
   *
   * `--evidence full` is what makes it a response pane at all: below that level a step record
   * carries no `request`/`response` (`D987`), so the level is asked for explicitly rather than
   * hoped for from the project's config.
   */
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ request: StepResult['request']; response: StepResult['response']; ok: boolean; detail?: string } | null>(null);

  /**
   * The scratch file's hash as this page last knew it — `M205` S3, closing `M205-05`.
   *
   * Send and Discard both need it, and both used to fetch it: `getFile(scratchPath).catch(() =>
   * null)` before each one. On a project nobody has explored yet that is a request whose only
   * possible answer is `404`, and the browser logs a failed request as a console error **whether
   * or not the caller catches it** — so the first Send in any project printed one. A page that
   * logs a benign error by routine is a page whose next real error is invisible.
   *
   * Seeded from the project view, which reads the file the server already has in hand, and moved
   * forward by each write's own response. Deliberately **not** re-seeded when `project` refreshes:
   * this page's own last write is the fresher fact, and a scratch changed by another terminal is
   * supposed to surface as the `409` that guard exists for rather than be silently re-read.
   */
  const [scratchEtag, setScratchEtag] = useState<string | null>(project.scratchEtag);

  /** The scratch file's whole contents: one test, this request, these assertions. Not spliced
   *  into anything — an exploration replaces the file rather than joining it. */
  const scratchText = useMemo((): { ok: true; text: string } | { ok: false; reason: string } => {
    const step = buildApiStep(stepSpec());
    if (!step.ok) return { ok: false, reason: step.reason };
    const built = rows.map((r) => buildExpect(expectSpec(r)));
    const bad = built.find((b) => !b.ok);
    if (bad && !bad.ok) return { ok: false, reason: bad.reason };
    const test = buildTest({ name: SCRATCH_TEST, tags: [], workload: null, thresholds: [], body: [step.node, ...built.flatMap((b) => (b.ok ? [b.node] : []))] });
    if (!test.ok) return { ok: false, reason: test.reason };
    const result = insertIntoSource('', { kind: 'test', node: test.node });
    return result.ok ? { ok: true, text: result.text } : { ok: false, reason: result.reason };
  }, [stepSpec, rows]);

  const send = useCallback(async () => {
    if (!scratchText.ok) return;
    setSending(true);
    setProblem(null);
    setSent(null);
    try {
      // `null` when there is no scratch yet, which the write route reads as "create it"; the hash
      // this page last wrote otherwise. No read precedes the write — see `scratchEtag` above.
      const put = await putFile(project.scratchPath, scratchText.text, scratchEtag);
      if (!put.ok) {
        setProblem(put.code ? `${put.code} at line ${put.line}: ${put.error}` : put.error);
        setSending(false);
        return;
      }
      setScratchEtag(put.etag);
      const record = await startRun({ files: [project.scratchPath], only: SCRATCH_TEST, evidence: 'full' });
      const end = await new Promise<EndEvent>((resolve) => {
        const stop = subscribe(record.id, { event: () => undefined, noise: () => undefined, end: (e) => { stop(); resolve(e); } });
      });
      if (!end.kept) {
        setProblem('the run wrote no report — nothing to read a response from');
        setSending(false);
        return;
      }
      const report: RunReport = await getResults(end.kept.split('/').pop() ?? end.kept);
      // Narrowed on `kind`, not duck-typed on `.steps` — `ReportEntry` has three members and
      // `D462` exists because thirteen sites in this repository read it as two. A scratch run is
      // always functional (Send writes no workload line and no crawl), so anything else here is a
      // mistake worth being unable to compile past rather than worth guessing through.
      const functional = report.tests.filter((t): t is Extract<typeof t, { kind: 'functional' }> => t.kind === 'functional');
      const step = functional.flatMap((t) => t.steps).find((x) => x.kind === 'api');
      if (!step) {
        setProblem('the run reported no api step — check the request above');
        setSending(false);
        return;
      }
      setSent({ request: step.request, response: step.response, ok: step.ok, detail: step.detail });
      // `M205` Q4: `send` is a request/response loop and the response IS the point, so the page
      // goes where the response is. `run all` deliberately does not — it is background work, and
      // it marks the tab instead of taking you off the form you are in the middle of.
      onTab('run');
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
    setSending(false);
  }, [scratchText, project.scratchPath, scratchEtag, onTab]);

  /**
   * `[Discard]` — the scratch file is removed and *then* the pane goes.
   *
   * THE ORDER IS THE POINT, and the first draft had it backwards: clearing the pane first made it
   * vanish while the write was still in flight, so the disappearance said nothing about the file
   * and a refused discard was invisible. Written this way, the pane going is the removal having
   * landed, and a failure keeps the pane and says why — which is also what lets the gate assert
   * the file is gone the moment the pane detaches.
   *
   * **`A1-5` emptied it; `A2-6` removes it (`D1054`).** An emptied scratch is still a file, so the
   * landing went on counting it forever — measured `2 files` on a one-test project after a single
   * explore-and-change-your-mind. The etag is still read first for the same reason it always was:
   * a scratch that moved under this page belongs to another terminal.
   */
  const discard = useCallback(async () => {
    if (scratchEtag !== null) {
      const res = await dropScratch(scratchEtag);
      if (!res.ok) {
        setProblem(res.status === 409 ? `${res.error} — the scratch file changed under this page` : res.error);
        return;
      }
      setScratchEtag(null);
    }
    setSent(null);
  }, [scratchEtag]);

  /** `D1052` — recomputed with the preview, from the same bytes, so what is shown and what is
   *  judged cannot be two different files. */
  const diagnostics = useMemo(() => (pending.ok ? diagnose(pending.text) : []), [pending]);

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

  const patchRow = (i: number, patch: Partial<ExpectRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  /** What a tab you are not looking at has to say (`M205` S5). Two cases only, and both are facts
   *  about THIS file: Compose is holding bytes the file does not have yet, and a run is going. */
  const marks: Partial<Record<TabId, string>> = {};
  if (pending.ok && file && pending.text !== file.text) marks.source = 'Compose is holding bytes this file does not have yet';
  if (runMark) marks.run = runMark;

  return (
    <section className="doorpane" data-api-form>
      <TabStrip tab={tab} onTab={onTab} marked={marks} />

      {tab === 'source' ? <SourcePanel file={file} pending={pending} diagnostics={diagnostics} /> : null}
      {tab === 'run' ? (
        <div className="runpane" data-api-run-tab>
          {sent ? <ResponsePane sent={sent} onDiscard={() => void discard()} /> : null}
          {runPane}
        </div>
      ) : null}

      {/* **What you typed survives a trip to another tab**, and it is not this line that provides
          it: every field is `useState` in THIS component, and the strip swaps a panel rather than
          unmounting the form, so the values come back whether the panel is unmounted or merely
          hidden. The first draft used `hidden` and said in a comment that it was load-bearing —
          the mutation to an unmounted panel left the gate green, which is how that got caught.
          Unmounted is the better of two equal choices: no hidden `[data-api-send]` sitting in the
          DOM for a selector on another tab to find. */}
      {tab !== 'compose' ? null : (
        <div className="authoring">
      <header className="authoring-head">
        <h2>write an API test</h2>
        <p className="muted">
          A request and the assertions that read it, in one edit — through the same printer and formatter{' '}
          <code>tflw fmt</code> uses, into the file <code>tflw run</code> reads.
        </p>
      </header>

      <div className="authoring-grid">
        <label title="which .tflw file this is written into — every file the project discovered">
          file
          <select value={path} onChange={(e) => setPath(e.target.value)} data-api-file>
            {files.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>

        <label title="write a new test, or add this request to a test already in the file">
          what
          <select value={mode} onChange={(e) => setMode(e.target.value as 'new' | 'existing')} data-api-mode>
            <option value="new">a new test</option>
            <option value="existing">add to a test already here</option>
          </select>
        </label>

        {mode === 'existing' ? (
          <label title="every test in the file, not only the ones behind this door — an api step is legal inside a test the LOAD door started">
            test
            <select value={testName} onChange={(e) => setTestName(e.target.value)} data-api-test>
              <option value="">— pick one —</option>
              {testsInFile.map((t) => (
                <option key={`${t.line}-${t.name}`} value={t.name}>
                  {t.name}
                  {t.workload ? ' (a workload test)' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label title="what this test is called — it is what a failure reports, and what `--only` selects">
              name
              <input value={name} onChange={(e) => setName(e.target.value)} data-api-name placeholder="the orders endpoint answers" />
            </label>
            <label title="space-separated words for `--tag`. A door is derived from the constructs a test carries, never from a tag (`D1043`), so these are your own vocabulary and nothing here reads them">
              tags
              <input value={tags} onChange={(e) => setTags(e.target.value)} data-api-tags placeholder="api orders" />
            </label>
          </>
        )}
      </div>

      <div className="request-line">
        <label title="the HTTP method this request is sent with">
          method
          <select value={method} onChange={(e) => setMethod(e.target.value as Method)} data-api-method>
            {METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label title="the part after the service's base URL. `{name}` interpolates a variable the test captured earlier">
          path
          <input value={requestPath} onChange={(e) => setRequestPath(e.target.value)} data-api-path placeholder="/orders/{orderId}" />
        </label>
        <label title="the name in tflw.config of a second api service — blank means the default one">
          service
          <input value={service} onChange={(e) => setService(e.target.value)} data-api-service placeholder="(default)" />
        </label>
        <label title="the label this request reports under, for thresholds scoped to it">
          label
          <input value={label} onChange={(e) => setLabel(e.target.value)} data-api-label placeholder="(automatic)" />
        </label>
      </div>

      <div className="headers-form" data-api-headers={headers.length}>
        {headers.map((h, i) => (
          <div className="row" key={i}>
            <input value={h.name} onChange={(e) => setHeaders(headers.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} data-header-name={i} placeholder="Authorization" />
            <input value={h.value} onChange={(e) => setHeaders(headers.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} data-header-value={i} placeholder="Bearer {token}" />
            <button onClick={() => setHeaders(headers.filter((_, j) => j !== i))} data-header-remove={i}>
              remove
            </button>
          </div>
        ))}
        <button onClick={() => setHeaders([...headers, { name: '', value: '' }])} data-header-add title="a header on this request alone. The env's `api` defaults and a session's token are added on top of it at run time">
          + header
        </button>
      </div>

      <div className="body-form">
        <label title="what this request sends. JSON is parsed here, not trusted — a body that is not JSON is refused before the write">
          body
          <select value={bodyKind} onChange={(e) => setBodyKind(e.target.value as BodyKind)} data-api-body-kind>
            <option value="none">none</option>
            <option value="json">JSON</option>
            <option value="text">raw text</option>
            <option value="file">from a file</option>
            <option value="form">form fields</option>
          </select>
        </label>
        {bodyKind === 'json' || bodyKind === 'text' || bodyKind === 'file' ? (
          <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} data-api-body rows={3} />
        ) : null}
        {bodyKind === 'form' ? (
          <div className="fields" data-api-form-fields={formFields.length}>
            {formFields.map((f, i) => (
              <div className="row" key={i}>
                <input value={f.name} onChange={(e) => setFormFields(formFields.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} data-form-key={i} />
                <input value={f.value} onChange={(e) => setFormFields(formFields.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} data-form-value={i} />
                <button onClick={() => setFormFields(formFields.filter((_, j) => j !== i))} data-form-remove={i} disabled={formFields.length === 1}>
                  remove
                </button>
              </div>
            ))}
            <button onClick={() => setFormFields([...formFields, { name: '', value: '' }])} data-form-add title="one `name=value` pair of the form body this request sends">
              + field
            </button>
          </div>
        ) : null}
      </div>

      <div className="expects-form" data-api-expects={rows.length}>
        {rows.map((row, i) => (
          <div className="row" key={i}>
            <select value={row.soft ? 'check' : 'expect'} onChange={(e) => patchRow(i, { soft: e.target.value === 'check' })} data-expect-kind={i}>
              <option value="expect">expect</option>
              <option value="check">check</option>
            </select>
            <select value={row.quantifier} onChange={(e) => patchRow(i, { quantifier: e.target.value as ExpectRow['quantifier'] })} data-expect-quantifier={i}>
              <option value="">—</option>
              <option value="any">any</option>
              <option value="all">all</option>
            </select>
            <select value={row.subject} onChange={(e) => patchRow(i, { subject: e.target.value as SubjectKind })} data-expect-subject={i}>
              {SUBJECTS.map(([id, labelText]) => (
                <option key={id} value={id}>{labelText}</option>
              ))}
            </select>
            {row.subject === 'body' || row.subject === 'header' || row.subject === 'value' ? (
              <input
                value={row.argument}
                onChange={(e) => patchRow(i, { argument: e.target.value })}
                data-expect-argument={i}
                placeholder={row.subject === 'header' ? 'content-type' : row.subject === 'value' ? 'orderId' : 'items[0].price'}
              />
            ) : null}
            <select value={row.matcher} onChange={(e) => patchRow(i, { matcher: e.target.value as MatcherKind })} data-expect-matcher={i}>
              {MATCHERS.map(([id, labelText]) => (
                <option key={id} value={id}>{labelText}</option>
              ))}
            </select>
            <input
              value={row.operand}
              onChange={(e) => patchRow(i, { operand: e.target.value })}
              data-expect-operand={i}
              disabled={OPERANDLESS.has(row.matcher)}
              placeholder={OPERANDLESS.has(row.matcher) ? '(none)' : '200'}
            />
            <button onClick={() => setRows(rows.filter((_, j) => j !== i))} data-expect-remove={i} disabled={rows.length === 1}>
              remove
            </button>
          </div>
        ))}
        <button onClick={() => setRows([...rows, EMPTY_ROW])} data-expect-add title="what has to be true of the response. `expect` fails the test at once; `check` records the failure and carries on">
          + assertion
        </button>
      </div>

      {/* `D985` — the bytes this form is about to write are shown, never hidden behind a
          projection of them. They moved to **Source** (`M205` §2): the tab set is the file's
          stages, and "what this file is about to be" is the same subject as "what this file is",
          so two panes showing one file's text was the duplication the strip exists to remove.
          Compose keeps the SENTENCE — what is wrong, or what to type next — because that is about
          the form rather than about the file. */}
      {pending.ok ? null : (
        /* `M205` Q11. This is the first sentence the door says on a form that now opens empty, so
           it is a hint until there is something to be wrong about. A blank field rendered as a
           warning teaches a new author that the tool is annoyed at them for not having typed
           anything yet, which is the opposite of what an empty form is for. */
        <p className={requestPath.trim() === '' ? 'muted' : 'warn'} data-api-problem>
          {pending.reason}
        </p>
      )}

      <div className="authoring-actions">
        {/* `D1047` — Send writes `scratch.tflw` and runs it for real, so what comes back is a
            report and not a second execution path. */}
        <button onClick={() => void send()} disabled={!scratchText.ok || sending || busy} data-api-send>
          {sending ? 'sending…' : 'send'}
        </button>
        <button className="run" onClick={() => void save()} disabled={!pending.ok || busy} data-api-save>
          {busy ? 'writing…' : `write ${path}`}
        </button>
        {wrote ? (
          <span className="muted" data-api-wrote={wrote}>
            written — <code>{wrote}</code> is what <code>tflw run</code> will read
          </span>
        ) : null}
        {problem ? (
          <span className="error" data-api-error>
            {problem}
          </span>
        ) : null}
      </div>

      {/* An exploration is not a suite, so the file it uses is one path, overwritten, and not
          something to commit. A project `tflw init` made ignores it; an older one is told rather
          than edited behind the author's back (`A1-5`). */}
      {!project.scratchIgnored ? (
        <p className="muted" data-api-scratch-unignored={project.scratchPath}>
          send writes <code>{project.scratchPath}</code>, and this project's <code>.gitignore</code> does not list it —
          add that line, or expect it in <code>git status</code>.
        </p>
      ) : null}

        </div>
      )}
    </section>
  );
}

/**
 * **Source** — the file, and while you are composing, the bytes the write will produce.
 *
 * `D985` says the `.tflw` file is the only truth and that a form shows the source it is about to
 * write. Before the strip those were two panes: an always-on preview of the pending bytes inside
 * the form, and no view of the file at all. One subject, so one tab — and the panel says which of
 * the two it is showing, because "this is the file" and "this is what the file is about to be"
 * are claims a reader must be able to tell apart.
 */
function SourcePanel({ file, pending, diagnostics }: {
  readonly file: FileView | null;
  readonly pending: { ok: true; text: string } | { ok: false; reason: string };
  readonly diagnostics: ReturnType<typeof diagnose>;
}) {
  const pendingText = pending.ok ? pending.text : null;
  const unwritten = pendingText !== null && file !== null && pendingText !== file.text;
  const shown = unwritten ? pendingText : (file?.text ?? '');
  return (
    <div className="authoring source-panel" data-api-source={unwritten ? 'pending' : 'written'}>
      <p className="muted" data-api-source-state>
        {file === null
          ? 'no file open'
          : unwritten
            ? <>what <code>{file.path}</code> becomes when you press <em>write</em> — not what is on disk yet</>
            : <>{file.path} — as it is on disk</>}
      </p>
      <pre className="preview" data-api-preview>
        {shown}
      </pre>
      {/* `D1052` — what `tflw check` will say about these bytes. Shown, never blocking: the write
          route refuses what cannot be read (`D1049`), and an unbound `{'{'}token{'}'}` reads fine — it is
          just wrong, and the author should hear it here rather than in CI. */}
      {unwritten && diagnostics.length > 0 ? (
        <ul className="preview-diagnostics" data-api-diagnostics={diagnostics.length}>
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

/** What `send` came back with. It lives in **Run** rather than under the form (`M205` Q4): a send
 *  is a run, and the tab set is the file's stages rather than a list of panels. */
function ResponsePane({ sent, onDiscard }: {
  readonly sent: { request: StepResult['request']; response: StepResult['response']; ok: boolean; detail?: string };
  readonly onDiscard: () => void;
}) {
  return (
    <div className="response" data-api-response={sent.response?.status ?? ''} data-api-response-ok={String(sent.ok)}>
      <header className="response-head">
        <span className={`verdict ${sent.ok ? 'ok' : 'fail'}`}>{sent.response ? `${sent.response.status} ${sent.response.statusText}` : 'no response'}</span>
        {sent.request ? (
          <code data-api-response-url>
            {sent.request.method} {sent.request.url}
          </code>
        ) : null}
        <button onClick={onDiscard} data-api-discard>
          discard
        </button>
      </header>
      {sent.detail ? <p className="muted" data-api-response-detail>{sent.detail}</p> : null}
      {sent.response ? (
        <>
          <ul className="response-headers" data-api-response-headers={Object.keys(sent.response.headers).length}>
            {Object.entries(sent.response.headers).map(([k, v]) => (
              <li key={k}>
                <code>{k}</code>: {v}
              </li>
            ))}
          </ul>
          <pre className="preview" data-api-response-body>
            {sent.response.bodyText}
          </pre>
        </>
      ) : null}
    </div>
  );
}
