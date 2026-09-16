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

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { getFile, putFile, type FileView } from './api';
import { diagnose } from './diagnose';
import type { ProjectView } from './contract';

export interface ApiFormProps {
  readonly project: ProjectView;
  readonly onWritten: (path: string) => void;
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

const EMPTY_ROW: ExpectRow = { soft: false, quantifier: '', subject: 'status', argument: '', matcher: 'equals', operand: '200' };

interface HeaderRow {
  readonly name: string;
  readonly value: string;
}

export function ApiForm({ project, onWritten }: ApiFormProps) {
  const files = useMemo(() => project.files.map((f) => f.path), [project]);
  const [path, setPath] = useState(files[0] ?? '');
  const [file, setFile] = useState<FileView | null>(null);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [testName, setTestName] = useState('');
  const [name, setName] = useState('the orders endpoint answers');
  const [tags, setTags] = useState('api');

  const [service, setService] = useState('');
  const [method, setMethod] = useState<Method>('GET');
  const [requestPath, setRequestPath] = useState('/orders');
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

  return (
    <section className="authoring" data-api-form>
      <header className="authoring-head">
        <h2>write an API test</h2>
        <p className="muted">
          A request and the assertions that read it, in one edit — through the same printer and formatter{' '}
          <code>tflw fmt</code> uses, into the file <code>tflw run</code> reads.
        </p>
      </header>

      <div className="authoring-grid">
        <label>
          file
          <select value={path} onChange={(e) => setPath(e.target.value)} data-api-file>
            {files.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>

        <label>
          what
          <select value={mode} onChange={(e) => setMode(e.target.value as 'new' | 'existing')} data-api-mode>
            <option value="new">a new test</option>
            <option value="existing">add to a test already here</option>
          </select>
        </label>

        {mode === 'existing' ? (
          <label>
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
            <label>
              name
              <input value={name} onChange={(e) => setName(e.target.value)} data-api-name />
            </label>
            <label>
              tags
              <input value={tags} onChange={(e) => setTags(e.target.value)} data-api-tags placeholder="api orders" />
            </label>
          </>
        )}
      </div>

      <div className="request-line">
        <label>
          method
          <select value={method} onChange={(e) => setMethod(e.target.value as Method)} data-api-method>
            {METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <label>
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
        <button onClick={() => setHeaders([...headers, { name: '', value: '' }])} data-header-add>
          + header
        </button>
      </div>

      <div className="body-form">
        <label>
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
            <button onClick={() => setFormFields([...formFields, { name: '', value: '' }])} data-form-add>
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
        <button onClick={() => setRows([...rows, EMPTY_ROW])} data-expect-add>
          + assertion
        </button>
      </div>

      {pending.ok ? (
        <>
          <pre className="preview" data-api-preview>
            {pending.text}
          </pre>
          {/* `D1052` — what `tflw check` will say about these bytes. Shown, never blocking: the
              write route refuses what cannot be read (`D1049`), and an unbound `{'{'}token{'}'}` reads
              fine — it is just wrong, and the author should hear it here rather than in CI. */}
          {diagnostics.length > 0 ? (
            <ul className="preview-diagnostics" data-api-diagnostics={diagnostics.length}>
              {diagnostics.map((d, i) => (
                <li key={i} className={d.severity} data-diagnostic-code={d.code}>
                  <code>{d.code}</code> line {d.span.start.line} — {d.message}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="warn" data-api-problem>
          {pending.reason}
        </p>
      )}

      <div className="authoring-actions">
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
    </section>
  );
}
