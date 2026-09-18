// The BROWSER door's authoring pane (`M200` `A3-5`).
//
// **BROWSER IS THE LARGEST DOOR BY USAGE AND THE SMALLEST BY VOCABULARY**, and both halves are
// measured (PLAN §4f). 244 of the corpus' 893 tests are browser tests, across 51 files — more than
// any other door. And what they are made of is three statements and one wrapper: `click` 766,
// `fill` 433, `open` 270, `within` 403, with an assertion whose subject is a locator 641 times.
//
// A LOCATOR IS TWO FIELDS, ON ALL 2,296 INSTANCES IN THE CORPUS — a `kind` and a `value`, with no
// optional clause, modifier or second spelling anywhere. So every locator in this form is a
// dropdown beside a text box, and there is nothing else to offer. Four of the six kinds are 99.9%
// of real use (`button` 803, `css` 516, `text` 498, `field` 476); `list` and `xpath` are three
// occurrences between them and are still listed, because the grammar does not rank them and a form
// that did would be inventing a rule the language does not have.
//
// `within` DOES NOT NEST HERE, AND THAT IS THE FORM'S DECISION RATHER THAN THE GRAMMAR'S. The
// grammar accepts a `within` inside a `within` — `A3-4` verified it against the parser and the
// printer recurses — but all 403 blocks in the corpus are at depth 1, so the form offers **one**
// optional scope. A second level is reachable by editing the file, which is where `D985` says the
// truth lives anyway.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  buildClick,
  buildExpect,
  buildFill,
  buildOpen,
  buildTest,
  buildWithin,
  insertIntoSource,
  LOCATOR_KINDS,
  type ExpectSpec,
  type Insertion,
  type LocatorSpec,
  type MatcherName,
  parseSource,
  type Step,
} from '@tflw/lang';
import { pickLocators, putFile, type FileView } from './api';
import { TabStrip } from './TabStrip';
import { SourcePanel } from './SourcePanel';
import type { TabId } from './doors';
import { diagnose } from './diagnose';
import type { ProjectView } from './contract';

export interface BrowserFormProps {
  /**
   * The file every tab here is about, **read by the shell** (`M210` `S1`).
   *
   * All four doors used to run this identical read — `getFile(path)` into a `useState`, refreshed
   * on a path change — which is the four-way duplicate `M206` `S1` removed for the *path* and left
   * in place for the *bytes*. `D1081` is what forced it: the explorer draws the open file's
   * outline, so the shell needs the text too, and a fifth copy of the same read was the one
   * outcome worth refusing outright.
   */
  readonly file: FileView | null;
  /** Why there is no file, when there is no file — a read failure has to be sayable somewhere. */
  readonly fileProblem: string | null;
  /** A write lands here: the shell's copy moves forward so every reader of it agrees at once. */
  readonly onFileWritten: (file: FileView) => void;
  readonly project: ProjectView;
  readonly onWritten: (path: string) => void;
  /** The file this form is about (`M206` `Q4`) — from the address, resolved by the shell. */
  readonly filePath: string;
  /** Which stage of this file's life is showing (`M205` §2, propagated by `M206` `S2b`). It lives
   *  in the URL and nowhere else (`D1045`), so the shell owns it and hands it down. */
  readonly tab: TabId;
  readonly onTab: (tab: TabId, focusLine?: number) => void;
  /** The project's runs, rendered by the shell — so Run can be a tab of this file's strip without
   *  this form learning what a report directory is. */
  readonly runPane: ReactNode;
  /** Why Run has something to say while you are composing. */
  readonly runMark?: string;
  /** The strip's two project-fact tabs, built by the shell (`M206` `S2a`). */
  readonly authPanel: ReactNode;
  readonly configPanel: ReactNode;
  readonly configMark?: string;
}

/** What a row of this form does. Ordered by how often the corpus does it — `click` 766, `fill`
 *  433 — rather than alphabetically or by the order the AST happens to declare. */
const ACTIONS = ['click', 'fill', 'expect'] as const;
type Action = (typeof ACTIONS)[number];

/**
 * The state words a form can assert, all five of them.
 *
 * `A3-3` found `§4g`'s two-of-five line was drawn on frequency where the grammar draws none:
 * `parser.ts` holds these in one closed `STATE_WORDS` family with one spelling. The form inherits
 * that — offering `visible` and `hidden` alone would leave `is disabled` writable only by hand for
 * no reason a reader could recover.
 */
const STATES: readonly MatcherName[] = ['visible', 'hidden', 'enabled', 'disabled', 'checked'];

/** One authored row, before it is built. */
interface Row {
  readonly action: Action;
  readonly locator: LocatorSpec;
  /** `fill`'s value, or `expect`'s operand when the matcher is `equals`. */
  readonly value: string;
  /** `expect`'s matcher: one of the five states, or `equals` for a text assertion. */
  readonly matcher: MatcherName;
}

const EMPTY_ROW: Row = { action: 'click', locator: { kind: 'button', value: '' }, value: '', matcher: 'visible' };

/**
 * Read one line of `tflw pick`'s output as a locator, or `null` if it is not one — `M200` `A3-6`.
 *
 * **CLASSIFIED BY THE GRAMMAR, NOT BY EXCLUDING THE BANNERS.** `pick` prints `opening <url> …` and
 * `ready — click any element …` before the first locator, so the obvious filter is to skip those
 * two sentences — and it would break the day either is reworded, silently, by turning a banner
 * into a suggestion. Asking the parser whether `click <line>` is a click step is the same question
 * asked of the only thing entitled to answer it, and it is immune to wording.
 *
 * This is also why the route streams lines unclassified: the server has no parser and should not
 * grow one to do this (`D1049`).
 */
export function locatorFromPickLine(line: string): LocatorSpec | null {
  const text = line.trim();
  if (text === '') return null;
  const { program, diagnostics } = parseSource(`test "pick"\n  click ${text}\n`);
  if (diagnostics.some((d) => d.severity === 'error')) return null;
  const step = program.tests[0]?.body[0];
  if (!step || step.type !== 'ClickStmt') return null;
  return { kind: step.locator.kind, value: step.locator.value.value };
}

export function BrowserForm({ project, onWritten, filePath, file, fileProblem, onFileWritten, tab, onTab, runPane, runMark, authPanel, configPanel, configMark }: BrowserFormProps) {
  const path = filePath;
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [testName, setTestName] = useState('');
  const [name, setName] = useState('the checkout page works');
  const [tags, setTags] = useState('web');
  const [openPath, setOpenPath] = useState('/');
  const [scoped, setScoped] = useState(false);
  const [scope, setScope] = useState<LocatorSpec>({ kind: 'css', value: '' });
  const [frame, setFrame] = useState(false);
  const [rows, setRows] = useState<readonly Row[]>([EMPTY_ROW]);
  const [busy, setBusy] = useState(false);
  const [ownProblem, setProblem] = useState<string | null>(null);
  /** A read failure is the shell's to discover and this pane's to say — there is no third place a
   *  reader looks, and a form that stayed silent about it would show an empty file as an empty
   *  form, which is the `M210` §0 defect wearing a different hat. */
  const problem = ownProblem ?? fileProblem;
  const [wrote, setWrote] = useState<string | null>(null);
  /** Which field a running pick session will fill — a row index as a string, or `'scope'`. */
  const [picking, setPicking] = useState<string | null>(null);
  const [picked, setPicked] = useState<readonly LocatorSpec[]>([]);
  const [stopPick, setStopPick] = useState<{ stop: () => void } | null>(null);

  const testsInFile = useMemo(() => project.files.find((f) => f.path === path)?.tests ?? [], [project, path]);

  const patchRow = useCallback((i: number, patch: Partial<Row>) => {
    setRows((current) => current.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }, []);

  /** Where a picked locator lands: `'scope'` is the `within` field, anything else a row index. */
  const applyPicked = useCallback((locator: LocatorSpec) => {
    if (picking === null) return;
    if (picking === 'scope') setScope(locator);
    else patchRow(Number(picking), { locator });
  }, [picking, patchRow]);

  /**
   * Open a `tflw pick` session for one field.
   *
   * The session opens against the path this form is already writing, so what the author picks from
   * is the page the test will open — not a URL typed twice. When a test is being *extended* rather
   * than written, the form has no `open` of its own, so the path falls back to the site root; the
   * author can still navigate in the real browser `pick` opened, and every click keeps reporting.
   */
  const startPick = useCallback((field: string) => {
    stopPick?.stop();
    setPicked([]);
    setPicking(field);
    setProblem(null);
    const unsubscribe = pickLocators(mode === 'new' ? openPath : '/', {
      line: (text) => {
        const locator = locatorFromPickLine(text);
        if (locator) setPicked((current) => [locator, ...current]);
      },
      problem: (text) => setProblem(text.trim()),
      end: () => setPicking(null),
    });
    setStopPick({ stop: unsubscribe });
  }, [mode, openPath, stopPick]);

  const endPick = useCallback(() => {
    stopPick?.stop();
    setStopPick(null);
    setPicking(null);
  }, [stopPick]);

  // A pick session is a browser process; leaving this door must not leave it running.
  useEffect(() => () => stopPick?.stop(), [stopPick]);

  /**
   * The steps this form is currently describing, or the first refusal that stops it.
   *
   * Built through `@tflw/lang`'s builders rather than assembled here, so the rules a step has to
   * satisfy live in one place and this form finds out about them the same way `tflw check` does.
   */
  const steps = useMemo((): { ok: true; nodes: Step[] } | { ok: false; reason: string } => {
    const built: Step[] = [];
    for (const row of rows) {
      if (row.action === 'click') {
        const r = buildClick({ locator: row.locator, kind: 'single' });
        if (!r.ok) return r;
        built.push(r.node);
      } else if (row.action === 'fill') {
        const r = buildFill({ locator: row.locator, value: row.value });
        if (!r.ok) return r;
        built.push(r.node);
      } else {
        const spec: ExpectSpec = {
          soft: false,
          quantifier: null,
          subject: { kind: 'locator', locator: row.locator },
          matcher: row.matcher,
          operand: row.matcher === 'equals' ? row.value : null,
        };
        const r = buildExpect(spec);
        if (!r.ok) return r;
        built.push(r.node);
      }
    }
    if (built.length === 0) return { ok: false, reason: 'add a step — a browser test that opens a page and does nothing asserts nothing' };

    if (!scoped) return { ok: true, nodes: built };
    const block = buildWithin({ locator: scope, frame, body: built });
    return block.ok ? { ok: true, nodes: [block.node] } : block;
  }, [rows, scoped, scope, frame]);

  const pending = useMemo((): { ok: true; text: string } | { ok: false; reason: string } => {
    if (!file) return { ok: false, reason: 'reading the file…' };
    if (!steps.ok) return steps;

    if (mode === 'existing') {
      if (testName === '') return { ok: false, reason: 'pick the test to add these steps to' };
      // NO `open` WHEN ADDING TO AN EXISTING TEST: that test already navigated, and a second
      // `open` would reload the page out from under whatever it had set up. The corpus agrees —
      // 270 opens across 244 browser tests, so a browser test opens roughly once.
      const result = insertIntoSource(file.text, { kind: 'steps', testName, nodes: steps.nodes });
      return result.ok ? { ok: true, text: result.text } : { ok: false, reason: result.reason };
    }

    // A new browser test opens a page first, for the reason a new SCANS test fetches first
    // (`A2-3`): the steps are about a page, so a test that asserts against one without navigating
    // is a file `tflw check` rejects.
    const opened = buildOpen(openPath);
    if (!opened.ok) return opened;
    const test = buildTest({
      name,
      tags: tags.split(/[\s,]+/).filter(Boolean),
      workload: null,
      thresholds: [],
      body: [opened.node, ...steps.nodes],
    });
    if (!test.ok) return { ok: false, reason: test.reason };
    const insertion: Insertion = { kind: 'test', node: test.node };
    const result = insertIntoSource(file.text, insertion);
    return result.ok ? { ok: true, text: result.text } : { ok: false, reason: result.reason };
  }, [file, mode, testName, steps, openPath, name, tags]);

  /** `D1052` — what `tflw check` would say about these exact bytes. The env's authorization block
   *  travels for the same reason it does in SCANS: it costs nothing here and a door that passed a
   *  narrower view would be two accounts of one config. */
  const diagnostics = useMemo(
    () => (pending.ok ? diagnose(pending.text, { envAuthorizedTargets: project.authorization }) : []),
    [pending, project.authorization],
  );

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
    onFileWritten({ path, text: pending.text, etag: res.etag });
    setWrote(path);
    onWritten(path);
  }, [file, pending, path, onWritten]);

  const locatorFields = (value: LocatorSpec, onChange: (next: LocatorSpec) => void, key: string) => (
    <span className="request-row">
      <select value={value.kind} onChange={(e) => onChange({ ...value, kind: e.target.value as LocatorSpec['kind'] })} data-browser-kind={key}>
        {LOCATOR_KINDS.map((k) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>
      <input value={value.value} onChange={(e) => onChange({ ...value, value: e.target.value })} data-browser-value={key} />
      {/* `D1055` — the one field in this arc nobody can type without looking at the page. Disabled
          where there is no page to look at, rather than hidden: a control that vanishes teaches
          nothing, and the reason is one `web` line in `tflw.config`. */}
      <button
        className="ghost"
        onClick={() => (picking === key ? endPick() : startPick(key))}
        disabled={project.webBaseUrl === null || (picking !== null && picking !== key)}
        title={project.webBaseUrl === null ? 'this env declares no `web` base, so there is no page to pick from' : undefined}
        data-browser-pick={key}
      >
        {picking === key ? 'stop' : 'pick…'}
      </button>
    </span>
  );

  /**
   * What a tab you are not looking at has to say — the same three cases as API (`M205` S5), each a
   * fact about what that tab's own subject is holding.
   *
   * **There is no `send` on this door**, so `Q5`'s other half never fires here: every run on
   * BROWSER starts from the sidebar, which marks Run rather than taking you to it. The switching
   * half of that rule is exercised on API, where a `send` is a request/response loop and the
   * response is the point. Said here rather than left to look like an omission.
   */
  const marks: Partial<Record<TabId, string>> = {};
  if (pending.ok && file && pending.text !== file.text) marks.source = 'Compose is holding bytes this file does not have yet';
  if (runMark) marks.run = runMark;
  if (configMark) marks.config = configMark;
  // `M206` `S3` — the one mark on this door that names a **live process** rather than unsaved
  // bytes. A pick session outlives a tab switch by construction (its state is `useState` here, and
  // the strip unmounts only the panels), so an author can leave Compose with a real browser open
  // and nothing on the page saying so. The mark is what closes that: the `.picking` pane lives
  // inside Compose and goes with it, and a browser you have forgotten is the one you will not
  // close. It still fits the rule's wording — *a fact about what that tab's own subject is
  // holding* — because the session belongs to a Compose field and fills it.
  if (picking !== null) marks.compose = `a browser is open at ${project.webBaseUrl ?? 'this env’s web base'} — it closes when you leave this door`;

  return (
    <section className="doorpane" data-browser-form>
      <TabStrip tab={tab} onTab={onTab} marked={marks} />

      {tab === 'source' ? <SourcePanel file={file} pending={pending} diagnostics={diagnostics} project={project} door="browser" /> : null}
      {tab === 'run' ? <div className="runpane" data-browser-run-tab>{runPane}</div> : null}
      {tab === 'auth' ? authPanel : null}
      {tab === 'config' ? configPanel : null}

      {tab !== 'compose' ? null : (
      <section className="authoring" data-browser-compose>
      <header className="authoring-head">
        <h2>write a browser test</h2>
        <p className="muted">
          A locator is a <em>kind</em> and a <em>value</em> — <code>button "Sign in"</code>,{' '}
          <code>css "#cart"</code>. Every step here takes one.
        </p>
      </header>

      <div className="authoring-grid">
        {/* **The `file` control is gone (`M205` Q7, deleted by `M209` `S4`).** The explorer names
            the file: clicking a row in the tree opens it and the address carries it, so a second
            control stating the same fact is the duplication Q7 was written to end. The file this
            form writes into is `path`, from the hash, and the pane says which one it is. */}

        <label>
          what
          <select value={mode} onChange={(e) => setMode(e.target.value as 'new' | 'existing')} data-browser-mode>
            <option value="new">a new test, opening a page</option>
            <option value="existing">more steps for a test that already opened one</option>
          </select>
        </label>

        {mode === 'existing' ? (
          <label>
            test
            <select value={testName} onChange={(e) => setTestName(e.target.value)} data-browser-test>
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
              <input value={name} onChange={(e) => setName(e.target.value)} data-browser-name />
            </label>
            <label>
              tags
              <input value={tags} onChange={(e) => setTags(e.target.value)} data-browser-tags />
            </label>
            <label>
              open
              <input value={openPath} onChange={(e) => setOpenPath(e.target.value)} data-browser-open />
            </label>
          </>
        )}

        <label className="tick">
          <input type="checkbox" checked={scoped} onChange={(e) => setScoped(e.target.checked)} data-browser-scoped />
          scope these steps to one element — <code>within</code>
        </label>

        {scoped ? (
          <>
            <label>
              inside
              {locatorFields(scope, setScope, 'scope')}
            </label>
            <label className="tick">
              <input type="checkbox" checked={frame} onChange={(e) => setFrame(e.target.checked)} data-browser-frame />
              it is an <code>iframe</code> — step into it rather than scoping within this document
            </label>
          </>
        ) : null}
      </div>

      {picking !== null ? (
        <div className="picking" data-browser-picking={picking}>
          <p className="muted">
            a browser is open at <code>{project.webBaseUrl}</code> — click any element and its locator appears here. Every
            one is <em>verified</em> to resolve to exactly the element you clicked, which is why this is worth spawning a
            real browser for rather than guessing from a selector.
          </p>
          {picked.length === 0 ? (
            <p className="muted" data-browser-picked={0}>
              nothing picked yet.
            </p>
          ) : (
            <ul className="picked" data-browser-picked={picked.length}>
              {picked.map((p, i) => (
                <li key={`${p.kind}:${p.value}:${i}`}>
                  <button className="ghost" onClick={() => applyPicked(p)} data-browser-apply={i}>
                    {p.kind} &quot;{p.value}&quot;
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      <div className="authoring-rows" data-browser-rows={rows.length}>
        {rows.map((row, i) => (
          <div className="authoring-row" key={i} data-browser-row={i}>
            <select value={row.action} onChange={(e) => patchRow(i, { action: e.target.value as Action })} data-browser-action={i}>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            {locatorFields(row.locator, (next) => patchRow(i, { locator: next }), String(i))}
            {row.action === 'expect' ? (
              <select value={row.matcher} onChange={(e) => patchRow(i, { matcher: e.target.value as MatcherName })} data-browser-matcher={i}>
                {STATES.map((m) => (
                  <option key={m} value={m}>is {m}</option>
                ))}
                <option value="equals">equals</option>
              </select>
            ) : null}
            {row.action === 'fill' || (row.action === 'expect' && row.matcher === 'equals') ? (
              <input
                value={row.value}
                onChange={(e) => patchRow(i, { value: e.target.value })}
                placeholder={row.action === 'fill' ? 'text, {captured} or env(NAME)' : 'expected text'}
                data-browser-operand={i}
              />
            ) : null}
            <button
              className="ghost"
              onClick={() => setRows((current) => current.filter((_, j) => j !== i))}
              disabled={rows.length === 1}
              data-browser-drop={i}
            >
              drop
            </button>
          </div>
        ))}
        <button className="ghost" onClick={() => setRows((current) => [...current, EMPTY_ROW])} data-browser-add>
          add a step
        </button>
      </div>

      {pending.ok ? (
        <>
          <pre className="preview" data-browser-preview>
            {pending.text}
          </pre>
          {diagnostics.length > 0 ? (
            <ul className="preview-diagnostics" data-browser-diagnostics={diagnostics.length}>
              {diagnostics.map((d, i) => (
                <li key={i} className={d.severity} data-diagnostic-code={d.code}>
                  <code>{d.code}</code> line {d.span.start.line} — {d.message}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <p className="warn" data-browser-problem>
          {pending.reason}
        </p>
      )}

      <div className="authoring-actions">
        <button className="run" onClick={() => void save()} disabled={!pending.ok || busy} data-browser-save>
          {busy ? 'writing…' : `write ${path}`}
        </button>
        {wrote ? (
          <span className="muted" data-browser-wrote={wrote}>
            written — <code>{wrote}</code> is what <code>tflw run</code> will read
          </span>
        ) : null}
        {problem ? (
          <span className="error" data-browser-error>
            {problem}
          </span>
        ) : null}
      </div>
      </section>
      )}
    </section>
  );
}
