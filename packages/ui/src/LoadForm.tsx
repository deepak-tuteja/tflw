// The LOAD door's authoring pane (`M200` `A0-4`) — the first form in tflw that writes a file.
//
// WHAT IT DOES IS ENTIRELY `@tflw/lang`'s. `buildWorkload`/`buildThreshold`/`buildTest` make the
// node, `insertIntoSource` prints it, splices it and formats the file, and `putFile` writes the
// result under the etag the source was read at. Every one of those runs **in this browser** —
// the language package has no dependencies and no Node builtins — so what this component holds
// is the field values and nothing else. There is no second implementation of any of it here to
// drift from the one the CLI uses, which is the whole point of putting them there.
//
// IT SHOWS THE SOURCE IT IS ABOUT TO WRITE, BEFORE IT WRITES IT. The file is the only truth
// (`D985`), so a form that hid its own output would be asking the author to trust a projection
// over the thing itself. The preview is the exact bytes the PUT will carry.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { buildThreshold, buildTest, buildWorkload, insertIntoSource, type Insertion, type StageSpec, type ThresholdSpec, type WorkloadSpec } from '@tflw/lang';
import { getFile, putFile, type FileView } from './api';
import { TabStrip } from './TabStrip';
import { SourcePanel } from './SourcePanel';
import type { TabId } from './doors';
import { diagnose } from './diagnose';
import type { ProjectView } from './contract';

export interface LoadFormProps {
  readonly project: ProjectView;
  /** Called after a successful write, so the shell can re-read the project it just changed. */
  readonly onWritten: (path: string) => void;
  /** The file this form is about (`M206` `Q4`) — from the address, resolved by the shell. */
  readonly filePath: string;
  readonly onFile: (path: string) => void;
  /** Which stage of this file's life is showing (`M205` §2, propagated by `M206` `S2b` and by
   *  `M207` `S1` to this door). It lives in the URL and nowhere else (`D1045`), so the shell owns
   *  it and hands it down. */
  readonly tab: TabId;
  readonly onTab: (tab: TabId, focusLine?: number) => void;
  /** The project's runs, rendered by the shell — so Run can be a tab of this file's strip without
   *  this form learning what a report directory is.
   *
   *  **THIS DOOR NEEDED NOTHING FOR IT TO BE RIGHT.** `ReportView` dispatches on
   *  `entry.kind === 'workload'` and renders charts, a histogram and an endpoint table — it is
   *  polymorphic by test kind, never by door — so a workload run's evidence was already correct
   *  here before the tab existed to show it in. */
  readonly runPane: ReactNode;
  /** Why Run has something to say while you are composing. */
  readonly runMark?: string;
  /** The strip's two project-fact tabs, built by the shell (`M206` `S2a`). */
  readonly authPanel: ReactNode;
  readonly configPanel: ReactNode;
  readonly configMark?: string;
}

type Shape = 'iterations' | 'iterations-per-user' | 'ramp' | 'hold' | 'step' | 'spike';

const SHAPES: ReadonlyArray<readonly [Shape, string]> = [
  ['iterations', 'run N iterations across M users'],
  ['iterations-per-user', 'run N iterations per user across M users'],
  ['ramp', 'ramp to N over a duration'],
  ['hold', 'hold N for a duration'],
  ['step', 'step — a staircase of levels'],
  ['spike', 'spike — levels and ramps mixed'],
];

interface ThresholdRow {
  readonly metric: 'duration' | 'errorRate';
  readonly percentile: number;
  readonly op: 'lessThan' | 'greaterThan';
  readonly bound: number;
  readonly scope: string;
}

const EMPTY_THRESHOLD: ThresholdRow = { metric: 'duration', percentile: 95, op: 'lessThan', bound: 500, scope: '' };

/** Seconds in the form, milliseconds in the language — one conversion, stated once. */
const secondsToMs = (s: number): number => Math.round(s * 1000);

export function LoadForm({ project, onWritten, filePath, onFile, tab, onTab, runPane, runMark, authPanel, configPanel, configMark }: LoadFormProps) {
  const loadFiles = useMemo(() => project.files.map((f) => f.path), [project]);
  const path = filePath;
  const [file, setFile] = useState<FileView | null>(null);
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [testName, setTestName] = useState('');
  // Off by default, deliberately: a threshold adds a judgement to a test, a workload line changes
  // how it RUNS — it stops being a single-shot functional test and becomes a per-VU loop. Doing
  // that implicitly because someone came through this door would be a much bigger change than the
  // one they asked for, so it is a thing to tick.
  const [alsoWorkload, setAlsoWorkload] = useState(false);
  const [name, setName] = useState('holds under load');
  const [tags, setTags] = useState('load');
  const [shape, setShape] = useState<Shape>('iterations');
  const [count, setCount] = useState(120);
  const [vus, setVus] = useState(4);
  const [target, setTarget] = useState(50);
  const [seconds, setSeconds] = useState(30);
  const [stages, setStages] = useState<readonly StageSpec[]>([{ mode: 'jump', target: 10, durationMs: 5000 }]);
  const [unit, setUnit] = useState<'users' | 'rps'>('users');
  const [thresholds, setThresholds] = useState<readonly ThresholdRow[]>([EMPTY_THRESHOLD]);
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

  /** The tests in the chosen file, for the "add to an existing test" mode. Every test, not only
   *  the ones already behind LOAD: `D1044` is exactly the case where an API test gains a
   *  threshold from this lens and becomes a load test by doing so. */
  const testsInFile = useMemo(() => project.files.find((f) => f.path === path)?.tests ?? [], [project, path]);

  const workloadSpec = useCallback((): WorkloadSpec => {
    switch (shape) {
      case 'iterations': return { kind: 'iterations', perUser: false, count, vus };
      case 'iterations-per-user': return { kind: 'iterations', perUser: true, count, vus };
      case 'ramp': return { kind: 'ramp', unit, target, overMs: secondsToMs(seconds) };
      case 'hold': return { kind: 'hold', unit, target, forMs: secondsToMs(seconds) };
      case 'step': return { kind: 'step', unit, stages };
      case 'spike': return { kind: 'spike', unit, stages };
    }
  }, [shape, count, vus, unit, target, seconds, stages]);

  const thresholdSpec = (row: ThresholdRow): ThresholdSpec => ({
    metric: row.metric === 'duration' ? { kind: 'duration', percentile: row.percentile } : { kind: 'errorRate' },
    op: row.op,
    bound: row.bound,
    scope: row.scope.trim() === '' ? null : row.scope.trim(),
  });

  /**
   * The source this form would write, computed from the current field values on every keystroke.
   *
   * It is the preview *and* the thing that gets PUT — one value, so what is shown and what is
   * written cannot differ. A refusal from any builder or from the splice lands here as text, not
   * as a thrown error, because every one of them is something the author can fix in a field.
   */
  const pending = useMemo((): { ok: true; text: string } | { ok: false; reason: string } => {
    if (!file) return { ok: false, reason: 'reading the file…' };
    const built: Array<{ ok: boolean; reason?: string }> = [];

    const rows = thresholds.map((r) => buildThreshold(thresholdSpec(r)));
    built.push(...rows);
    const badRow = rows.find((r) => !r.ok);
    if (badRow && !badRow.ok) return { ok: false, reason: badRow.reason };

    if (mode === 'existing') {
      if (testName === '') return { ok: false, reason: 'pick the test to add to' };
      const chosen = testsInFile.find((t) => t.name === testName);
      const insertions: Insertion[] = [];
      // Only when it was asked for, and only when there is not one already — the language allows
      // at most one workload line and `insertIntoSource` would refuse a second.
      if (alsoWorkload && chosen && !chosen.workload) {
        const w = buildWorkload(workloadSpec());
        if (!w.ok) return { ok: false, reason: w.reason };
        insertions.push({ kind: 'workload', testName, node: w.node });
      }
      for (const r of rows) if (r.ok) insertions.push({ kind: 'threshold', testName, node: r.node });
      let text = file.text;
      for (const insertion of insertions) {
        const result = insertIntoSource(text, insertion);
        if (!result.ok) return { ok: false, reason: result.reason };
        text = result.text;
      }
      return { ok: true, text };
    }

    const w = buildWorkload(workloadSpec());
    if (!w.ok) return { ok: false, reason: w.reason };
    const test = buildTest({
      name,
      tags: tags.split(/[\s,]+/).filter(Boolean),
      workload: w.node,
      thresholds: rows.flatMap((r) => (r.ok ? [r.node] : [])),
      body: [],
    });
    if (!test.ok) return { ok: false, reason: test.reason };
    const result = insertIntoSource(file.text, { kind: 'test', node: test.node });
    return result.ok ? { ok: true, text: result.text } : { ok: false, reason: result.reason };
  }, [file, mode, testName, testsInFile, alsoWorkload, name, tags, thresholds, workloadSpec]);

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

  const numberField = (label: string, value: number, set: (n: number) => void, key: string) => (
    <label key={key}>
      {label}
      <input type="number" value={value} min={1} onChange={(e) => set(Number(e.target.value))} data-load-field={key} />
    </label>
  );

  /**
   * What a tab you are not looking at has to say — the same three cases as API (`M205` S5) and
   * BROWSER (`M206` `S2b`), each a fact about what that tab's own subject is holding.
   *
   * **There is no `send` on this door either**, so `M206` `Q5`'s switching half never fires here:
   * a load run is started from the sidebar and marks Run rather than taking you to it. That is the
   * right behaviour for this door for a reason the other two do not have — a workload run is the
   * long one, so being moved off the form you are still filling in would cost more here than
   * anywhere else.
   */
  const marks: Partial<Record<TabId, string>> = {};
  if (pending.ok && file && pending.text !== file.text) marks.source = 'Compose is holding bytes this file does not have yet';
  if (runMark) marks.run = runMark;
  if (configMark) marks.config = configMark;

  return (
    <section className="doorpane" data-load-form>
      <TabStrip tab={tab} onTab={onTab} marked={marks} />

      {tab === 'source' ? <SourcePanel file={file} pending={pending} diagnostics={diagnostics} project={project} door="load" /> : null}
      {tab === 'run' ? <div className="runpane" data-load-run-tab>{runPane}</div> : null}
      {tab === 'auth' ? authPanel : null}
      {tab === 'config' ? configPanel : null}

      {tab !== 'compose' ? null : (
      <section className="authoring" data-load-compose>
      <header className="authoring-head">
        <h2>write a load test</h2>
        <p className="muted">
          Every byte below goes through the printer and the formatter, and lands in a real file — the same file{' '}
          <code>tflw run</code> reads from a terminal.
        </p>
      </header>

      <div className="authoring-grid">
        <label>
          file
          <select value={path} onChange={(e) => onFile(e.target.value)} data-load-file>
            {loadFiles.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>

        <label>
          what
          <select value={mode} onChange={(e) => setMode(e.target.value as 'new' | 'existing')} data-load-mode>
            <option value="new">a new test</option>
            <option value="existing">add to a test already here</option>
          </select>
        </label>

        {mode === 'existing' ? (
          <>
            <label>
              test
              <select value={testName} onChange={(e) => setTestName(e.target.value)} data-load-test>
                <option value="">— pick one —</option>
                {testsInFile.map((t) => (
                  <option key={`${t.line}-${t.name}`} value={t.name}>
                    {t.name}
                    {t.workload ? ' (already a workload test)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label title="a workload line makes this a load test — it stops running once and starts looping per user">
              also give it a workload line
              <input
                type="checkbox"
                checked={alsoWorkload}
                disabled={testsInFile.find((t) => t.name === testName)?.workload ?? false}
                onChange={(e) => setAlsoWorkload(e.target.checked)}
                data-load-also-workload
              />
            </label>
          </>
        ) : (
          <>
            <label>
              name
              <input value={name} onChange={(e) => setName(e.target.value)} data-load-name />
            </label>
            <label>
              tags
              <input value={tags} onChange={(e) => setTags(e.target.value)} data-load-tags placeholder="load smoke" />
            </label>
          </>
        )}

        <label hidden={mode === 'existing' && !alsoWorkload}>
          shape
          <select value={shape} onChange={(e) => setShape(e.target.value as Shape)} data-load-shape>
            {SHAPES.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>

        {shape === 'iterations' || shape === 'iterations-per-user' ? (
          <>
            {numberField('iterations', count, setCount, 'count')}
            {numberField('users', vus, setVus, 'vus')}
          </>
        ) : (
          <label>
            unit
            <select value={unit} onChange={(e) => setUnit(e.target.value as 'users' | 'rps')} data-load-unit>
              <option value="users">users — closed: each keeps looping</option>
              <option value="rps">rps — open: arrivals regardless of what finished</option>
            </select>
          </label>
        )}

        {shape === 'ramp' || shape === 'hold' ? (
          <>
            {numberField('target', target, setTarget, 'target')}
            {numberField('seconds', seconds, setSeconds, 'seconds')}
          </>
        ) : null}

        {shape === 'step' || shape === 'spike' ? (
          <div className="stages" data-load-stages={stages.length}>
            {stages.map((s, i) => (
              <div className="stage-row" key={i}>
                {shape === 'spike' ? (
                  <select
                    value={s.mode}
                    onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, mode: e.target.value as 'jump' | 'ramp' } : x)))}
                    data-stage-mode={i}
                  >
                    <option value="jump">hold at</option>
                    <option value="ramp">ramp to</option>
                  </select>
                ) : (
                  // A `step` block has no spelling for a ramp, so the form does not offer one —
                  // `buildWorkload` refuses it, and an option that is always refused is a trap.
                  <span className="muted">to</span>
                )}
                <input
                  type="number"
                  value={s.target}
                  min={1}
                  onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, target: Number(e.target.value) } : x)))}
                  data-stage-target={i}
                />
                <input
                  type="number"
                  value={s.durationMs / 1000}
                  min={1}
                  onChange={(e) => setStages(stages.map((x, j) => (j === i ? { ...x, durationMs: secondsToMs(Number(e.target.value)) } : x)))}
                  data-stage-seconds={i}
                />
                <span className="muted">s</span>
                <button onClick={() => setStages(stages.filter((_, j) => j !== i))} data-stage-remove={i} disabled={stages.length === 1}>
                  −
                </button>
              </div>
            ))}
            <button onClick={() => setStages([...stages, { mode: 'jump', target: 10, durationMs: 5000 }])} data-stage-add>
              + stage
            </button>
          </div>
        ) : null}
      </div>

      <div className="thresholds-form" data-load-thresholds={thresholds.length}>
        {thresholds.map((row, i) => (
          <div className="threshold-row" key={i}>
            <select value={row.metric} onChange={(e) => setThresholds(thresholds.map((x, j) => (j === i ? { ...x, metric: e.target.value as 'duration' | 'errorRate' } : x)))} data-threshold-metric={i}>
              <option value="duration">duration</option>
              <option value="errorRate">error rate</option>
            </select>
            {row.metric === 'duration' ? (
              <input type="number" value={row.percentile} min={1} max={99} onChange={(e) => setThresholds(thresholds.map((x, j) => (j === i ? { ...x, percentile: Number(e.target.value) } : x)))} data-threshold-percentile={i} />
            ) : null}
            <select value={row.op} onChange={(e) => setThresholds(thresholds.map((x, j) => (j === i ? { ...x, op: e.target.value as 'lessThan' | 'greaterThan' } : x)))} data-threshold-op={i}>
              <option value="lessThan">is less than</option>
              <option value="greaterThan">is greater than</option>
            </select>
            <input type="number" value={row.bound} min={0} step="any" onChange={(e) => setThresholds(thresholds.map((x, j) => (j === i ? { ...x, bound: Number(e.target.value) } : x)))} data-threshold-bound={i} />
            <span className="muted">{row.metric === 'duration' ? 'ms' : '%'}</span>
            <input value={row.scope} placeholder='for "label" (optional)' onChange={(e) => setThresholds(thresholds.map((x, j) => (j === i ? { ...x, scope: e.target.value } : x)))} data-threshold-scope={i} />
            <button onClick={() => setThresholds(thresholds.filter((_, j) => j !== i))} data-threshold-remove={i}>
              −
            </button>
          </div>
        ))}
        <button onClick={() => setThresholds([...thresholds, EMPTY_THRESHOLD])} data-threshold-add>
          + threshold
        </button>
      </div>

      {pending.ok ? (
        <>
          <pre className="preview" data-load-preview>
            {pending.text}
          </pre>
          {/* `D1052` — what `tflw check` will say about these bytes. Shown, never blocking: the
              write route refuses what cannot be read (`D1049`), and an unbound `{'{'}token{'}'}` reads
              fine — it is just wrong, and the author should hear it here rather than in CI. */}
          {diagnostics.length > 0 ? (
            <ul className="preview-diagnostics" data-load-diagnostics={diagnostics.length}>
              {diagnostics.map((d, i) => (
                <li key={i} className={d.severity} data-diagnostic-code={d.code}>
                  <code>{d.code}</code> line {d.span.start.line} — {d.message}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="warn" data-load-problem>
          {pending.reason}
        </p>
      )}

      <div className="authoring-actions">
        <button className="run" onClick={() => void save()} disabled={!pending.ok || busy} data-load-save>
          {busy ? 'writing…' : `write ${path}`}
        </button>
        {wrote ? (
          <span className="muted" data-load-wrote={wrote}>
            written — <code>{wrote}</code> is what <code>tflw run</code> will read
          </span>
        ) : null}
        {problem ? (
          <span className="error" data-load-error>
            {problem}
          </span>
        ) : null}
      </div>
      </section>
      )}
    </section>
  );
}
