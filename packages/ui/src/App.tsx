// The shell (`M192` U2, widened by `M200` `A0-3`): four doors, then the project on the left, the
// runs across the top, the selected run below. State is what the server said and nothing else —
// the page holds no truth of its own.
//
// The door lives in the URL hash and nowhere else (`D1045`). It is a view of a project rather
// than a fact about one, so there is no `.tflw-ui/` anything to remember it in, and a link to
// `#/load` is a link to the LOAD door of whatever project this server is serving.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cancelRun, getBaseline, getBaselineForEnv, getConfig, getFile, getProject, getReports, getResults, getRuns, getStderr, putBaseline, putConfig, reportFileUrl, startRun, subscribe } from './api';
import type { DocumentView, FileView } from './api';
import { EMPTY_BASELINE, stageFingerprint } from './baseline';
import type { EndEvent, Lens, ProjectView, ReportDir, RunRecord, RunReport, RunRequest, ScanFinding } from './contract';
import { DEFAULT_TAB, docFromHash, doorFromHash, fileFromHash, focusFromHash, hashForDoor, hashForTab, paneTail, queryFromHash, selectionFromHash, tabFromHash, type TabId } from './doors';
import { Landing } from './Landing';
import { DoorBar } from './DoorBar';
import { LoadForm } from './LoadForm';
import { ApiForm } from './ApiForm';
import { AuthPanel } from './AuthPanel';
import { ConfigPanel, documentsOf } from './ConfigPanel';
import { ScanForm } from './ScanForm';
import { BrowserForm } from './BrowserForm';
import { addNoise, EMPTY_LIVE, liveCounts, reduceLive, type LiveState } from './live';
import { exitExplained, reportIdOf } from './format';
import { LiveBody, ReportBody, ReportHeader } from './ReportView';
import { Findings } from './Findings';
import { RunList, type Selection } from './RunList';
import { RunStrip } from './RunStrip';
import { matchingFiles, parseQuery } from './search';
import { Sidebar } from './Sidebar';
import { fileOutline } from './outline';

interface LiveRun {
  readonly id: string;
  readonly state: LiveState;
  readonly end: EndEvent | null;
  readonly stderr: string | null;
}

/**
 * One project document as the shell holds it (`M208` `S2`) — `tflw.config` or a declared baseline.
 *
 * `disk` is the oracle for *is there anything to save*, and it is deliberately separate from `text`:
 * a page that compared its own text against itself could never tell an edit from a read.
 *
 * `absentPath` is the declared path of a document that is **declared but not written yet**, which
 * is the ordinary state of a project adopting triage rather than a failure — the declaration is
 * really there, the file is not, and `[accept]` is the gesture that ends it.
 */
interface DocState {
  readonly text: string | null;
  readonly disk: string | null;
  readonly etag: string | null;
  readonly absentPath: string | null;
}

const EMPTY_DOC: DocState = { text: null, disk: null, etag: null, absentPath: null };

export function App() {
  const [door, setDoorState] = useState<Lens | null>(() => doorFromHash(window.location.hash));
  /** Which stage of the selected file is showing (`M205` §2). It is the hash's second segment, so
   *  a tab is linkable and the back button walks it — the same rule `D1045` makes for the door. */
  const [tab, setTabState] = useState<TabId>(() => tabFromHash(window.location.hash));
  /** The file every tab is about (`M206` `Q4`). It lives in the hash for `D1045`'s reason and is
   *  held here rather than in each form, which is where it used to live **twice** — `ApiForm` and
   *  `BrowserForm` each kept their own `useState(files[0] ?? '')`, so a door change reset it. */
  const [file, setFileState] = useState<string | null>(() => fileFromHash(window.location.hash));
  /** The line Config was asked to land on (`M205` S5b), read off the end of the hash. `null` for
   *  every address that does not name one, which is every address anybody had before `S5b`. */
  const [focusLine, setFocusLine] = useState<number | null>(() => focusFromHash(window.location.hash));
  /** Which project **document** Config shows — `null` is `tflw.config` (`M208` `S2`, `Q2`). In the
   *  hash for `D1045`'s reason a fourth time: `[accept]` has to be a link, so the document is part
   *  of the address rather than a callback the findings list carries. */
  const [doc, setDocState] = useState<string | null>(() => docFromHash(window.location.hash));
  const [project, setProject] = useState<ProjectView | null>(null);
  /**
   * The run request, held by the shell since `M209` `S1`.
   *
   * It used to live inside `Sidebar`, which is why the sidebar could not become a file tree: the
   * pane that lists a project was also the pane that assembled a command. The four pieces are what
   * `tflw run` takes and nothing more — env, workers, `--tag`, files — and they are held together
   * because `request()` reads all four in one place. The **narrowing** is still edited in the
   * sidebar and the **run** is started from the strip; both read this.
   *
   * `env` is `null` until somebody picks one, not `''`: the project is not read yet at mount, so a
   * state initialised from `project.envs` would freeze the empty default the first render saw.
   * `null` means *whatever the config calls default*, which is the answer that keeps up.
   */
  const [envPick, setEnvPick] = useState<string | null>(null);
  const [workers, setWorkers] = useState('');
  /**
   * The selection — the explorer's own gesture (`M209` `S4`, `M205` Q13) and, since `D1066`, part
   * of the address. It is an ORDER and not a set on the wire, because the address has to be stable:
   * a link that reorders its own files every time somebody clicks is a link that never compares
   * equal to itself.
   */
  const [selection, setSelectionState] = useState<readonly string[]>(() => selectionFromHash(window.location.hash));
  /** What the search box holds (`M209` `S5`, `D1064`). In the address for `D1066`'s reason: it is
   *  the other thing that changes what a run does. */
  const [query, setQueryState] = useState<string>(() => queryFromHash(window.location.hash));
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<readonly RunRecord[]>([]);
  const [reports, setReports] = useState<readonly ReportDir[]>([]);
  const [selected, setSelected] = useState<Selection>(null);
  const [report, setReport] = useState<{ id: string; data: RunReport } | null>(null);
  // U4 — a second directory opened beside the selected one (§2 q6). Chosen per selection: it
  // is dropped when the selection changes, so a comparison is always between two named runs.
  const [compareId, setCompareId] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ id: string; data: RunReport } | null>(null);
  const [live, setLive] = useState<LiveRun | null>(null);
  // U7 — the process behind a kept directory, when its exit is not the report's own verdict.
  const [exitNote, setExitNote] = useState<{ id: string; run: RunRecord; stderr: string } | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);

  // The hash is the source of truth for the door, so the back button works and a pasted link
  // opens where it says. `setDoor` writes the hash; the listener is what actually moves the page.
  useEffect(() => {
    const onHash = () => {
      setDoorState(doorFromHash(window.location.hash));
      setTabState(tabFromHash(window.location.hash));
      setFileState(fileFromHash(window.location.hash));
      setFocusLine(focusFromHash(window.location.hash));
      setDocState(docFromHash(window.location.hash));
      setSelectionState(selectionFromHash(window.location.hash));
      setQueryState(queryFromHash(window.location.hash));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const setDoor = useCallback(
    (next: Lens | null) => {
      // A door change **keeps the file and resets the tab** (`M206` `Q4`).
      //
      // The reset is unchanged; its reason is not. This used to read "the door decides which file
      // you land on", which stopped being true the moment the file moved into the address — the
      // address decides, and the door is a view of it. What survives is the narrower claim: a tab
      // is a stage of *this* file's life, and the stage you were at in one kind of work says
      // nothing about the stage you are at in another. Landing on BROWSER's Source because you
      // were reading API's is a guess; landing on Compose is the door's own promise (`D1042`).
      // The **document** is dropped with the tab, and for the tab's own reason: it is a choice made
      // inside Config, and a door change lands on Compose where there is no document to be showing.
      const next_hash = next === null ? hashForDoor(null) : hashForTab(next, DEFAULT_TAB, file) + paneTail(selection, query);
      window.location.hash = next_hash;
      setDoorState(next);
      setTabState(DEFAULT_TAB);
      setFocusLine(null);
      setDocState(null);
    },
    [file, selection, query],
  );
  const setTab = useCallback(
    (next: TabId, focus?: number, nextDoc?: string | null) => {
      // `nextDoc` is `undefined` for every caller that does not care, and that is not the same as
      // `null`: `[edit]` from Auth means *tflw.config, at this line* and must clear a baseline the
      // reader was looking at, while an ordinary tab click should not silently switch documents
      // under them. So an omitted argument keeps the current document and an explicit `null` names
      // `tflw.config`.
      const wanted = nextDoc === undefined ? doc : nextDoc;
      /**
       * **An omitted focus keeps the line, on the tabs the line belongs to** (`M210` `S2`).
       *
       * `D1080` puts the selected request in the address as `L<n>`, and a plain tab click passes no
       * focus — so a glance at Source and back silently dropped it and the card fell to the file's
       * first request. Measured on the served page while driving an edit.
       *
       * It is carried only onto Compose and Source, and that qualifier is `setDoc`'s own rule one
       * tab along: **a line number is an offset into the document that named it.** Those two tabs
       * are stages of the `.tflw` file, so the line still means something there; Config's subject is
       * `tflw.config`, and carrying a test's line into it would scroll a different document to a
       * number that is about this one. An explicit focus — which is what `[edit]` passes — always
       * wins, so the jump that needed this qualifier in the first place is unaffected.
       */
      const fileStage = next === 'compose' || next === 'source';
      const carried = focus ?? (fileStage ? (focusLine ?? undefined) : undefined);
      if (door !== null) window.location.hash = hashForTab(door, next, file, carried, wanted) + paneTail(selection, query);
      setTabState(next);
      setFocusLine(carried ?? null);
      setDocState(wanted);
    },
    [door, file, doc, selection, query, focusLine],
  );
  /** Choosing a different document inside Config. It drops the focus line for `setFile`'s reason:
   *  a line number is an offset into the document that named it. */
  const setDoc = useCallback(
    (next: string | null) => {
      if (door !== null) window.location.hash = hashForTab(door, tab, file, undefined, next) + paneTail(selection, query);
      setDocState(next);
      setFocusLine(null);
    },
    [door, tab, file, selection, query],
  );
  /** Choosing a different file. It drops the focus line, because a line number is an offset into
   *  the file that named it and means nothing in the next one. */
  const setFile = useCallback(
    (next: string) => {
      if (door !== null) window.location.hash = hashForTab(door, tab, next, undefined, doc) + paneTail(selection, query);
      setFileState(next);
      setFocusLine(null);
    },
    [door, tab, doc, selection, query],
  );

  /**
   * One gesture in the explorer, one write to the address (`M209` `S4`).
   *
   * **It has to be one call.** The first draft had the sidebar call `onSelect` and then `onOpen`
   * for a plain click, and each of those writes the whole hash from the state it closed over — so
   * the second write rebuilt the address with the *previous* selection and silently emptied it.
   * A plain click changes two things at once, which makes it one change and not two.
   *
   * `open` is `null` for `cmd` and `shift`: extending a selection is a statement about what will
   * run and must not move the subject (`M205` Q13a), so the file and its focus line stay exactly
   * where they were.
   */
  const pick = useCallback(
    (nextSelection: readonly string[], open: string | null) => {
      const nextFile = open ?? file;
      const line = open === null ? (focusLine ?? undefined) : undefined;
      if (door !== null) window.location.hash = hashForTab(door, tab, nextFile, line, doc) + paneTail(nextSelection, query);
      setSelectionState(nextSelection);
      if (open !== null) {
        setFileState(open);
        setFocusLine(null);
      }
    },
    [door, tab, file, focusLine, doc, query],
  );

  /** Typing in the search box. It changes the address's tail and nothing else — the door, the tab
   *  and the file it names stay where they are, because a search is a narrowing and not a move. */
  const setQuery = useCallback(
    (next: string) => {
      if (door !== null) window.location.hash = hashForTab(door, tab, file, focusLine ?? undefined, doc) + paneTail(selection, next);
      setQueryState(next);
    },
    [door, tab, file, focusLine, doc, selection],
  );

  const refreshLists = useCallback(async () => {
    const [r, p] = await Promise.all([getRuns(), getReports()]);
    setRuns(r);
    setReports(p);
    return p;
  }, []);

  const [noProject, setNoProject] = useState(false);

  /**
   * The open file's bytes, read **once for the page** (`M210` `S1`).
   *
   * All four doors ran this identical read into their own `useState` — the same four-way duplicate
   * `M206` `S1` removed for the *path* and left behind for the *text*. `D1081` is what made it
   * untenable rather than merely untidy: the explorer draws the open file's outline, so the shell
   * needs the bytes too, and adding a fifth copy of one `GET` is the outcome worth refusing.
   *
   * It is the shell's for `S5a`'s reason as well — the strip unmounts panels, so a read living
   * inside one is re-issued on every tab trip, and the file is the same file across all five.
   */
  const [openFileView, setOpenFileView] = useState<FileView | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  /**
   * The pending buffer — `M210` `S2` (`D1079`).
   *
   * `null` is *nothing unsaved*; a string is what the file becomes when you press write. It lives
   * **here**, beside the bytes it is a version of, for the same reason the read does: the explorer
   * draws this file's outline and Source shows this file's text, so a buffer held inside the door's
   * pane would leave both of them describing the copy on disk while the author edits another one.
   *
   * It is text and not a list of edits, because `D1049` makes a write one `PUT` of the whole file
   * and `replaceInSource` returns a finished file: keeping the finished text is keeping exactly
   * what the write will carry, so there is no second representation to disagree with it.
   */
  const [draft, setDraft] = useState<string | null>(null);

  const readProjectView = useCallback(() => {
    return getProject()
      .then((p) => {
        setProject(p);
        setNoProject(p === null);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  /**
   * The Config tab's editor state — **held in the shell**, which is `S5a`'s finding applied a
   * second time and one level higher (`M206` `S2a`).
   *
   * The strip swaps panels by unmounting them, so state inside a panel is lost on a tab trip. The
   * Compose fields survive that only because they are `useState` in *this* component, which the
   * strip never unmounts — a fact `S5a` discovered by mutating `hidden` to unmounted and watching
   * a green gate stay green. A half-edited `tflw.config` thrown away by a glance at Auth would be
   * exactly the failure the Compose fields were saved from, and the fix is the same fix: the state
   * lives above the panel.
   *
   * `S5a` put it in `ApiForm`, which was the right height while one door had a strip. It is wrong
   * the moment a second door gets one: `tflw.config` is a **project** fact, so a copy per door
   * would be four editors over one file, disagreeing about what is unsaved. That is the same
   * duplicate `S1` removed for the selected file, caught before it was written rather than after.
   */
  /**
   * **Keyed by document** since `M208` `S2`, and it is one map rather than a second set of
   * variables beside the first. `tflw.config` and a baseline are the same kind of thing to this
   * shell — a project document with text, a disk copy and an etag — and the moment that is written
   * twice the two copies can disagree about what is unsaved, which is the duplicate `S1` removed
   * for the selected file and `S2a` removed for the config itself.
   *
   * Keeping a per-document entry is what makes switching documents non-destructive: an author who
   * types into a baseline, glances at `tflw.config` and comes back still has their edit. That is
   * the same property the shell already guarantees across *tabs*, for the same reason — the strip
   * unmounts panels, so nothing below this component may hold an edit.
   */
  const [docs, setDocs] = useState<Readonly<Record<string, DocState>>>({});
  const [configBusy, setConfigBusy] = useState(false);
  const [configProblem, setConfigProblem] = useState<string | null>(null);
  const [configSaved, setConfigSaved] = useState<string | null>(null);
  /** `tflw.config` under its own key, so the map has no `null` in it — a `Record` key cannot be
   *  `null`, and `@` cannot begin an env name, so nothing can collide with it. */
  const docKey = doc ?? '@config';
  const cur: DocState = docs[docKey] ?? EMPTY_DOC;
  const configText = cur.text;
  const configDisk = cur.disk;
  const configEtag = cur.etag;
  const patchDoc = useCallback((key: string, patch: Partial<DocState>) => {
    setDocs((prev) => ({ ...prev, [key]: { ...(prev[key] ?? EMPTY_DOC), ...patch } }));
  }, []);
  /**
   * The switcher's entries, derived from the config's **disk** copy — see `documentsOf`.
   *
   * **Up here with the other hooks, not down beside the panel it feeds**, and that placement is not
   * tidiness: `App` returns the landing early when no door is open, so a `useMemo` written next to
   * `configPanel` sits below that return and changes the hook count between the two renders. It was
   * written there first and the page gate caught it at once — every door test timed out waiting for
   * a file list that React never got to render.
   */
  const documents = useMemo(() => documentsOf(docs['@config']?.disk ?? null), [docs]);

  /**
   * Read `tflw.config` the first time Config is opened, and never otherwise.
   *
   * Lazily, because the project view is re-read after every write and a config carried on it would
   * be re-fetched on every one of those for a tab most authors will never open — and eagerly here
   * would also mean choosing what to do when the page's unsaved text disagrees with a fresher
   * read. Once is the honest answer: the etag is what detects a config changed underneath, and it
   * detects it at the moment it matters, as the `409` that guard exists for.
   */
  const readConfig = useCallback(
    (which: string | null) => {
      const key = which ?? '@config';
      setConfigProblem(null);
      setConfigSaved(null);
      const read = which === null
        ? getConfig().then((c) => ({ text: c.text as string | null, etag: c.etag as string | null, absentPath: null }))
        : getBaseline(which).then((d) => ({ text: d.text, etag: d.etag, absentPath: d.text === null ? d.path : null }));
      return read
        .then(({ text, etag, absentPath }) => patchDoc(key, { text, disk: text, etag, absentPath }))
        .catch((e: unknown) => setConfigProblem(e instanceof Error ? e.message : String(e)));
    },
    [patchDoc],
  );

  useEffect(() => {
    if (tab !== 'config') return;
    // `tflw.config` is read whenever Config is open, **even when the address names a baseline**.
    // The switcher's list is a fact about the config — which blocks declare a `baseline`, and where
    // — so a page that read only the addressed document could not draw the switcher that got it
    // there. Landing directly on `#/scan/config/@headers` did exactly that, and the page gate
    // caught it: one entry in the list, so the switcher rendered nothing at all and the document
    // could be reached only by the address it was already at.
    if (docs['@config'] === undefined) void readConfig(null);
    if (docKey !== '@config' && docs[docKey] === undefined) void readConfig(doc);
  }, [tab, docs, docKey, doc, readConfig]);

  const saveConfig = useCallback(async () => {
    // A baseline may be saved with **no etag**, because a declared document that has never been
    // written is created by this save (`writeBaselineDoc`). `tflw.config` may not: a project with
    // no config is not a project, so an absent etag there means the page has not read the file it
    // is claiming to edit.
    if (configText === null) return;
    if (doc === null && configEtag === null) return;
    setConfigBusy(true);
    setConfigProblem(null);
    setConfigSaved(null);
    try {
      const put = doc === null ? await putConfig(configText, configEtag!) : await putBaseline(doc, configText, configEtag);
      if (!put.ok) {
        // A `409` is the one refusal with no repair inside this page, so it gets a gesture rather
        // than a sentence: `re-read from disk` is offered beside it, and it is a button because
        // taking it throws away what you typed. The first draft said *reopen this tab to read it
        // again*, which was false — the read fires once, when the text is still `null`, so
        // leaving and coming back returns the same stale bytes and the same 409. Found by reading
        // the advice against the effect that would have to honour it.
        setConfigProblem(put.error);
        return;
      }
      patchDoc(docKey, { etag: put.etag, disk: configText, absentPath: null });
      setConfigSaved(`saved — ${doc === null ? 'tflw.config' : 'the baseline'} is what you see here`);
      // The project view carries the sessions and the authorized targets Auth reads, and both
      // just changed. `D985` again: the page is a projection of the files, so it re-reads rather
      // than patching what it thinks it wrote.
      void readProjectView();
    } finally {
      setConfigBusy(false);
    }
  }, [configText, configEtag, doc, docKey, patchDoc, readProjectView]);

  /**
   * `[accept]` — stage a finding's fingerprint into the baseline and open it, unsaved (`M208` `S3`,
   * `Q1`).
   *
   * **Three properties, and each one is a refusal of an easier shape.**
   *
   * *It does not write.* `M206` `Q6` refused a bare `[accept]` button on `M205`'s one-editor
   * finding, and `Q1` answered the gap it left with the shape Auth's `[edit]` already uses: show
   * the fact, link into the editor. The affirmation stays the author's (`D291`), and an author who
   * changes their mind navigates away and nothing happened.
   *
   * *It asks the server which document.* A `prod` run may grade against `defaults`' baseline, and
   * deriving that fallback here would be the second implementation of a rule the runtime already
   * has — `M169d5`'s shape, where a parity check agreed with itself. The server answers with the
   * **block**, which is the half a URL can name.
   *
   * *It edits the document's own text, not a model of it.* The panel is a text editor over the
   * author's bytes (`D985` again), so the entry is spliced into the JSON the page is holding and
   * the address points at the line it landed on. A structured edit would have to re-serialise, and
   * the first thing it would destroy is whatever ordering or comment-shaped formatting the author
   * chose.
   */
  const acceptFinding = useCallback(
    async (finding: ScanFinding) => {
      if (door === null || report === null || finding.fingerprint === undefined) return;
      setConfigProblem(null);
      setConfigSaved(null);
      let view: DocumentView;
      try {
        view = await getBaselineForEnv(report.data.env);
      } catch (e: unknown) {
        // The ordinary case here is *no `baseline` is declared for this env*, and the server's
        // message says exactly that and what to do. Shown on the Config tab rather than swallowed,
        // because a button that does nothing visible is worse than one that is not there.
        setConfigProblem(e instanceof Error ? e.message : String(e));
        setTab('config', undefined, null);
        return;
      }
      const key = view.declaredIn;
      const held = docs[key];
      // What the editor already holds wins over what is on disk: an author who staged one
      // fingerprint and then accepted a second must end with both, not with the first one lost.
      const base = held?.text ?? view.text ?? EMPTY_BASELINE;
      const staged = stageFingerprint(base, finding);
      patchDoc(key, {
        text: staged.text,
        // `''` and not `null` when the document is not on disk yet, so *is there anything to save*
        // is `true` for the entry just staged. `null` there means **not read**, which would leave
        // the save button disabled on the one document the whole feature exists to create — the
        // same distinction the panel's own absent branch makes on its first keystroke.
        disk: held?.disk ?? view.text ?? '',
        etag: held?.etag ?? view.etag,
        absentPath: null,
      });
      setTab('config', staged.line, key);
    },
    [door, report, docs, patchDoc, setTab],
  );



  useEffect(() => {
    void readProjectView();
    refreshLists()
      .then((p) => {
        // Only when nothing was chosen meanwhile — a run started before the list arrived (U7's
        // gate did exactly that) would otherwise be unselected by the page's own first load.
        if (p[0]) setSelected((s) => s ?? { kind: 'report', id: p[0]!.id });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [refreshLists, readProjectView]);

  // A selected report directory is read once — `results.json` is the merged `RunReport`.
  useEffect(() => {
    if (selected?.kind !== 'report') return;
    const id = selected.id;
    setCompareId(null);
    getResults(id)
      .then((data) => setReport({ id, data }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [selected]);

  useEffect(() => {
    if (!report) return;
    const run = runs.find((r) => r.kept !== null && reportIdOf(r.kept) === report.id);
    if (!run || run.status === 'running' || exitExplained(run, report.data)) {
      setExitNote(null);
      return;
    }
    const id = report.id;
    getStderr(run.id)
      .then((stderr) => setExitNote({ id, run, stderr }))
      .catch(() => setExitNote({ id, run, stderr: '' }));
  }, [report, runs]);

  useEffect(() => {
    if (compareId === null) {
      setCompare(null);
      return;
    }
    const id = compareId;
    getResults(id)
      .then((data) => setCompare({ id, data }))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [compareId]);

  const watch = useCallback(
    (id: string) => {
      unsubscribe.current?.();
      setLive({ id, state: EMPTY_LIVE, end: null, stderr: null });
      unsubscribe.current = subscribe(id, {
        event: (e) => setLive((l) => (l && l.id === id ? { ...l, state: reduceLive(l.state, e) } : l)),
        noise: (line) => setLive((l) => (l && l.id === id ? { ...l, state: addNoise(l.state, line) } : l)),
        end: (end) => {
          setLive((l) => (l && l.id === id ? { ...l, end } : l));
          void refreshLists();
          if (end.kept) setSelected({ kind: 'report', id: reportIdOf(end.kept) });
          else getStderr(id).then((stderr) => setLive((l) => (l && l.id === id ? { ...l, stderr } : l)));
        },
      });
    },
    [refreshLists],
  );

  const onRun = useCallback(
    async (request: RunRequest) => {
      try {
        const record = await startRun(request);
        setSelected({ kind: 'run', id: record.id });
        await refreshLists();
        watch(record.id);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refreshLists, watch],
  );

  // Selecting a run row that is still in flight (re)attaches to its stream — the server replays
  // every line first, so a page opened mid-run sees the whole of it.
  useEffect(() => {
    if (selected?.kind === 'run' && live?.id !== selected.id) watch(selected.id);
  }, [selected, live?.id, watch]);

  const running = runs.some((r) => r.status === 'running');
  const onCancel = useCallback(() => {
    const r = runs.find((x) => x.status === 'running');
    if (r) void cancelRun(r.id).then(refreshLists);
  }, [runs, refreshLists]);

  const defaultEnv = project?.envs.find((e) => e.isDefault)?.name ?? project?.envs[0]?.name ?? '';
  const env = envPick ?? defaultEnv;
  /** The request exactly as `tflw run` takes it — a field is present only when it narrows. */
  const request = useCallback((): RunRequest => {
    const req: { -readonly [K in keyof RunRequest]: RunRequest[K] } = {};
    if (env) req.env = env;
    if (/^\d+$/.test(workers)) req.workers = Number(workers);
    // `D1064` — the two kinds of query narrow a run by different mechanisms, and only one of them
    // is exact. `--tag` is the language's own narrowing, so a tag query runs *the tests carrying
    // the tag*; a name has no flag, so a text query can only run the files it lit up, whole. On the
    // sibling that gap is 59 tests against 97 — which is why this is a fork and not a filter.
    const parsed = project ? parseQuery(query, project) : { kind: 'none' as const };
    if (parsed.kind === 'tag' && parsed.tags.length > 0) req.tags = [...parsed.tags];
    const chosen = selection.length > 0 ? new Set(selection) : parsed.kind === 'text' && project ? matchingFiles(project, parsed)! : null;
    if (chosen !== null && chosen.size > 0 && project) req.files = project.files.map((f) => f.path).filter((p) => chosen.has(p));
    return req;
  }, [env, workers, query, selection, project]);

  /**
   * The file the strip is about, resolved once (`M206` `S1`, `S2a`).
   *
   * `fileFromHash` reports what the address says and never asks the project whether it is true, so
   * somebody has to fall back when a hash names a file that has been renamed or deleted. That was
   * each form's job in `S1` — the same expression in two places, which is the shape `S1` was
   * removing — and it is the shell's now, because the shell is what hands the file to the panels.
   *
   * **It sits above the landing's early return since `M210` `S1`**, and that placement is the
   * hook rule rather than a preference: the read below is an effect, and an effect written under a
   * conditional `return` changes the hook count between two renders. `configPanel`'s own `useMemo`
   * was written below one and every door test timed out at once (`M208` `S2`); this is the same
   * trap with a longer fuse, because the landing renders first on a cold page.
   */
  const filePaths = project?.files.map((f) => f.path) ?? [];
  const path = file !== null && filePaths.includes(file) ? file : (filePaths[0] ?? '');

  /** One read per open file, for the whole page — see `openFileView`. A path of `''` is *no
   *  project yet*, which is a wait rather than a failure and asks for nothing. */
  useEffect(() => {
    if (!path) return;
    let live = true;
    setOpenFileView(null);
    setFileProblem(null);
    getFile(path)
      .then((f) => { if (live) setOpenFileView(f); })
      .catch((e: unknown) => { if (live) setFileProblem(e instanceof Error ? e.message : String(e)); });
    // A buffer belongs to the file it was typed into. Opening another one drops it rather than
    // carrying it across, which would be an edit to a file nobody made.
    setDraft(null);
    return () => { live = false; };
  }, [path]);

  /**
   * The open file, read (`D1081`). **One parse for the page**, beside the one read.
   *
   * The explorer and the API door's Compose pane are both readers of it; deriving it twice would be
   * two answers to *what does this file hold*, which is the duplicate class this shell has removed
   * three times already (the path in `M206` `S1`, the config in `S2a`, the bytes above).
   */
  const fileText = draft ?? openFileView?.text ?? null;
  const outline = useMemo(() => (fileText === null || openFileView === null ? null : fileOutline(openFileView.path, fileText)), [openFileView, fileText]);

  if (door === null || noProject) {
    // A door onto nothing is not a door: until there is a `tflw.config`, every path leads back
    // to the landing, which is where a project can be made (`A0-5`).
    return <Landing project={project} error={error} noProject={noProject} onOpen={setDoor} onCreated={() => void readProjectView()} />;
  }

  /**
   * The runs, as one node — and since `M207` `S2` there is exactly **one** place it is put.
   *
   * `M205` S5 built this with two placements: API's strip held it in a Run tab and the other three
   * doors stacked it under their form, where it had been since `M192`. That was the round's scope
   * showing in the code rather than only in a plan, and it was always meant to end — `M206` `S2b`
   * took BROWSER, `M207` `S1` took LOAD and this slice takes SCANS. **Every door now reaches its
   * runs through Run and no door renders them inline**, so the conditional that chose between the
   * two placements is gone rather than narrowed to a door that no longer needs it.
   *
   * It is still built once and handed down, which is what kept two placements from becoming two
   * renderings for the three rounds they coexisted.
   */
  const runPane = (
    <>
      <RunList runs={runs} reports={reports} selected={selected} onSelect={setSelected} />
      {error ? (
        <p className="error" data-error>
          {error}
        </p>
      ) : null}
      {selected?.kind === 'run' && live && live.id === selected.id ? <LivePane live={live} /> : null}
      {selected?.kind === 'report' && report && report.id === selected.id ? (
        <article className="report" data-report={report.id}>
          <ReportHeader report={report.data} />
          {exitNote && exitNote.id === report.id ? (
            <div className="warn run-exit" data-run-exit={exitNote.run.exitCode ?? ''} data-run-status={exitNote.run.status}>
              ⚠ the run behind this directory {exitNote.run.status === 'cancelled' ? 'was cancelled from this page' : 'ended'} with{' '}
              {exitNote.run.exitCode !== null ? `exit ${exitNote.run.exitCode}` : `signal ${exitNote.run.signal}`} — the report is what it had written by then, and its verdict does not say so.
              {exitNote.stderr ? (
                <pre className="stderr" data-run-stderr>
                  {exitNote.stderr}
                </pre>
              ) : null}
            </div>
          ) : null}
          <p className="muted files-line">
            {reports.length > 1 ? (
              <label className="compare">
                compare with{' '}
                <select value={compareId ?? ''} onChange={(e) => setCompareId(e.target.value === '' ? null : e.target.value)} data-compare>
                  <option value="">— nothing —</option>
                  {reports
                    .filter((r) => r.id !== report.id)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            {reports
              .find((r) => r.id === report.id)
              ?.files.map((f) => (
                <a key={f} href={reportFileUrl(report.id, f)} target="_blank" rel="noreferrer" data-report-file={f}>
                  {f}
                </a>
              ))}
          </p>
          <Findings report={report.data} compare={compare && compare.id === compareId ? compare : null} onAccept={door === null ? null : (f) => void acceptFinding(f)} />
          <ReportBody tests={report.data.tests} context={{ id: report.id, evidenceLevel: report.data.evidenceLevel, traceViewer: project?.traceViewer ?? false, compare: compare && compare.id === compareId ? compare : null }} />
        </article>
      ) : null}
      {selected === null && !error ? <p className="muted empty">select a run</p> : null}
    </>
  );


  /**
   * The strip's two **project-fact** tabs, built here and handed to whichever door is open.
   *
   * This is the rule's own split showing up in the code (`M205` §2): a tab is *a stage of one
   * file's life* — Compose and Source, which each door owns because Compose is the only thing that
   * varies by the kind of work — or *a project fact that file resolves against*, which is Auth and
   * Config, and a project fact has no business being built four times. `Run` was already here for
   * the same reason.
   */
  const authPanel = project ? <AuthPanel project={project} path={path} onEdit={(line) => setTab('config', line)} door={door} /> : null;
  const configPanel = (
    <ConfigPanel
      documents={documents}
      doc={doc}
      onDoc={setDoc}
      absentPath={cur.absentPath}
      text={configText}
      disk={configDisk}
      onChange={(next) => {
        patchDoc(docKey, { text: next, ...(cur.disk === null && cur.absentPath !== null ? { disk: '' } : {}) });
        // The `saved` line is a claim about the bytes on disk, and one keystroke makes it false.
        // It goes the moment the text moves, rather than sitting under an edit it no longer
        // describes.
        setConfigSaved(null);
      }}
      onSave={() => void saveConfig()}
      onReload={() => void readConfig(doc)}
      busy={configBusy}
      problem={configProblem}
      saved={configSaved}
      focusLine={focusLine}
    />
  );
  /**
   * Config has something to say while you are elsewhere only when it is holding an unsaved edit —
   * in **any** of its documents since `M208` `S2`, not only in `tflw.config`. A mark that watched
   * one document would go quiet the moment an author switched away from the one they had edited,
   * which is the same silence the mark exists to prevent.
   */
  const unsavedDocs = Object.entries(docs).filter(([, d]) => d.text !== null && d.disk !== null && d.text !== d.disk);
  const configMark =
    unsavedDocs.length === 0
      ? undefined
      : unsavedDocs.length === 1 && unsavedDocs[0]![0] === '@config'
        ? 'tflw.config has an edit nobody has saved'
        : `${unsavedDocs.length} project document${unsavedDocs.length === 1 ? '' : 's'} ${unsavedDocs.length === 1 ? 'has' : 'have'} an edit nobody has saved`;

  return (
    <div className="app">
      {project ? <Sidebar project={project} door={door} openFile={file} selection={selection} onPick={pick} query={query} onQuery={setQuery} outline={outline} focusLine={focusLine} onLine={(line) => setTab('compose', line)} /> : <aside className="sidebar muted">{error ?? 'reading the project…'}</aside>}
      <main className="main">
        {project ? <DoorBar project={project} door={door} onDoor={setDoor} /> : null}
        {/* Above the tabs and below the doorbar (`M205` Q12): one strip per page, so every control
            it carries is reachable from all five tabs and all four doors rather than from whichever
            pane happened to own it. */}
        {project ? (
          <RunStrip
            project={project}
            env={env}
            onEnv={setEnvPick}
            workers={workers}
            onWorkers={setWorkers}
            selection={selection}
            query={query}
            running={running}
            onRun={onRun}
            onCancel={onCancel}
            request={request}
          />
        ) : null}
        {/* `D1042`: the door decides what the "new test" surface is, and nothing else. LOAD's is
            `A0-4`'s form and API's is `A1-4`'s; BROWSER and SCANS have theirs in `A2`–`A3`. */}
        {project && door === 'load' ? (
          <LoadForm
            project={project}
            onWritten={() => {
              // The page is a projection of the file (`D985`), so after a write the projection is
              // re-read rather than patched — the server is what says what the file now holds.
              void readProjectView();
            }}
            filePath={path}
            file={openFileView}
            fileProblem={fileProblem}
            onFileWritten={setOpenFileView}
            tab={tab}
            onTab={setTab}
            runPane={runPane}
            runMark={live && !live.end ? 'a run is going' : undefined}
            authPanel={authPanel}
            configPanel={configPanel}
            configMark={configMark}
          />
        ) : null}
        {project && door === 'api' ? (
          <ApiForm
            project={project}
            onWritten={() => void readProjectView()}
            tab={tab}
            onTab={setTab}
            path={path}
            file={openFileView}
            outline={outline}
            draft={draft}
            onDraft={setDraft}
            fileProblem={fileProblem}
            onFileWritten={setOpenFileView}
            onOpenFile={setFile}
            focusLine={focusLine}
            authPanel={authPanel}
            configPanel={configPanel}
            configMark={configMark}
            runPane={runPane}
            runMark={live && !live.end ? 'a run is going' : undefined}
          />
        ) : null}
        {project && door === 'scan' ? (
          <ScanForm
            project={project}
            onWritten={() => void readProjectView()}
            filePath={path}
            file={openFileView}
            fileProblem={fileProblem}
            onFileWritten={setOpenFileView}
            tab={tab}
            onTab={setTab}
            runPane={runPane}
            runMark={live && !live.end ? 'a run is going' : undefined}
            authPanel={authPanel}
            configPanel={configPanel}
            configMark={configMark}
          />
        ) : null}
        {project && door === 'browser' ? (
          <BrowserForm
            project={project}
            onWritten={() => void readProjectView()}
            filePath={path}
            file={openFileView}
            fileProblem={fileProblem}
            onFileWritten={setOpenFileView}
            tab={tab}
            onTab={setTab}
            runPane={runPane}
            runMark={live && !live.end ? 'a run is going' : undefined}
            authPanel={authPanel}
            configPanel={configPanel}
            configMark={configMark}
          />
        ) : null}
      </main>
    </div>
  );
}

function LivePane({ live }: { live: LiveRun }) {
  const { done, failed } = liveCounts(live.state);
  return (
    <article className="report live" data-live={live.id} data-live-status={live.end ? live.end.status : 'running'}>
      <header className="report-head">
        <span className={`verdict ${live.end ? (live.end.status === 'cancelled' ? 'warn' : live.end.exitCode === 0 ? 'ok' : 'fail') : 'running'}`}>
          {live.end ? (live.end.status === 'cancelled' ? 'CANCELLED' : `exit ${live.end.exitCode}`) : 'RUNNING'}
        </span>
        <span data-live-counts>
          {done} of {live.state.announced || '?'} done · {failed} failed
        </span>
      </header>
      {live.stderr ? <pre className="stderr" data-stderr>{live.stderr}</pre> : null}
      {live.state.noise.length > 0 ? <pre className="stderr">{live.state.noise.join('\n')}</pre> : null}
      <LiveBody tests={live.state.tests} />
    </article>
  );
}
