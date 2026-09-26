// The shell (`M192` U2, widened by `M200` `A0-3`): four doors, then the project on the left, the
// runs across the top, the selected run below. State is what the server said and nothing else —
// the page holds no truth of its own.
//
// The door lives in the URL hash and nowhere else (`D1045`). It is a view of a project rather
// than a fact about one, so there is no `.tflw-ui/` anything to remember it in, and a link to
// `#/load` is a link to the LOAD door of whatever project this server is serving.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cancelRun, getBaseline, getBaselineForEnv, getConfig, getFile, getProject, getReports, getResults, getRuns, getStderr, putBaseline, putConfig, putFile, reportFileUrl, startRun, subscribe } from './api';
import type { DocumentView, FileView } from './api';
import { EMPTY_BASELINE, stageFingerprint } from './baseline';
import type { EndEvent, Lens, ProjectView, ReportDir, RunRecord, RunReport, RunRequest, ScanFinding, UnconfiguredView } from './contract';
import { DEFAULT_TAB, docFromHash, doorFromHash, fileFromHash, focusFromHash, hashForDoor, hashForTab, paneTail, queryFromHash, selectionFromHash, tabFromHash, type TabId } from './doors';
import { Landing } from './Landing';
import { EmptyDoor } from './EmptyDoor';
import { Legend } from './Legend';
import { shortcutFor } from './shortcuts';
import { landingFor, projectHash, rememberLanding, rememberedLanding } from './landingRule';
import { Grip, SIDEBAR, storedSize } from './Grip';
import { TooltipLayer } from './Tooltip';
import { ContextMenuLayer, type MenuItem, type MenuRequest } from './ContextMenu';
import { FileAction, type FileActionKind } from './FileAction';
import { ThemePick } from './ThemePick';
import { DoorBar } from './DoorBar';
import { ComposeDoor } from './ComposeDoor';
import { VOCABULARY } from './vocabulary';
import { AuthPanel } from './AuthPanel';
import { ConfigPanel, documentsOf } from './ConfigPanel';
import { addNoise, EMPTY_LIVE, liveCounts, reduceLive, type LiveState } from './live';
import { exitExplained, reportIdOf } from './format';
import { LiveBody, ReportBody, ReportHeader } from './ReportView';
import { Findings } from './Findings';
import { RunList, type Selection } from './RunList';
import { RunStrip } from './RunStrip';
import { matchingFiles, parseQuery } from './search';
import { Sidebar } from './Sidebar';
import type { MenuTarget } from './Sidebar';
import { NewThing, type NewMode } from './NewThing';
import { fileOutline, pageOpeners } from './outline';

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
  /** The tab as of the last render, for a stream callback that outlives the render it was made in
   *  (`M239-08`: a run's end is announced only when the reader is not already looking at it). */
  const tabRef = useRef(tab);
  tabRef.current = tab;
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
  /** The project pane's width (`M216`). Read once from `localStorage` — it is the reader's, per
   *  served project, and belongs in neither the hash nor the server (`D1045`'s same argument). */
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => storedSize(SIDEBAR));
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
   * **`--headed` — show the browser instead of running it headless** (`M220` `D`, `D1173`).
   *
   * Run-level and not per-gesture, because that is what the flag is: `tflw run --headed` is about
   * the run, so a per-▶ variant would be a narrower control than the thing it maps to. Kept in
   * this component's state and not in the URL — `D1045` puts *where you are* in the address, and
   * this is not a place, it is how the next run is done.
   */
  const [headed, setHeaded] = useState(false);
  /**
   * **The trace the Run pane is showing, when it is showing one** — `M220` `C` (`D1179`).
   *
   * Not in the URL, and that is `D1045` applied rather than skirted: a trace is evidence of one
   * run in one report directory, and a hash naming it would outlive the directory the next run
   * clears. What *is* in the URL — the door, the file, the tab — still is.
   */
  const [traceOpen, setTraceOpen] = useState<{ readonly id: string; readonly path: string } | null>(null);
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
  /**
   * **What went wrong, as a list that expires** — `M240` `F` (`M239-06`).
   *
   * This was one `error: string | null` with seven `setError` sites and no clearing site, so a
   * failed read sat in the run pane under a later, healthy state until the same path happened to
   * succeed again (review U15). A notice is about what happened, not where you are: it draws
   * top-right, closes on its ✕ or after ten seconds, and a route change does not clear it. Two
   * failures are two notices — the second no longer overwrites the first.
   */
  const [notices, setNotices] = useState<readonly Notice[]>([]);
  const noticeSeq = useRef(0);
  const notify = useCallback((text: string, tone: Notice['tone'] = 'fail') => {
    noticeSeq.current += 1;
    setNotices((prev) => [...prev, { id: noticeSeq.current, text, at: Date.now(), tone }]);
  }, []);
  const dismiss = useCallback((id: number) => setNotices((prev) => prev.filter((n) => n.id !== id)), []);
  /** The one slot the landing and the sidebar's fallback still read: the newest notice's text. */
  const error = notices.length === 0 ? null : notices[notices.length - 1]!.text;
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

  /** `null` until the project probe has answered — `false` is one of the two answers, not a
   *  neutral default, and shipping it as the default is `M235-08`. */
  const [noProject, setNoProject] = useState<boolean | null>(null);
  /** The unconfigured answer, when that is what the probe got (`D1291`): the directory's name and
   *  the build stamp, for the landing to say where it is and which tflw this is. */
  const [unconfigured, setUnconfigured] = useState<UnconfiguredView | null>(null);

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
  /**
   * **An explorer `+` that has to be carried out by the pane** — `M217` `D` (`D1139`).
   *
   * The explorer builds nothing: `+` on a test row means *do what the sequence column's
   * `+ request` does, to that test*, and that gesture lives in `ComposeDoor` beside the buffer it
   * settles into. So the sidebar records an intent here and the door runs it once its outline is
   * the one being named.
   *
   * `n` is a counter for `landOn`'s reason one component over: pressing `+` twice on the same test
   * is two intents with the same path and index, and an effect keyed on the value alone would fire
   * once. The declaration is named by **index**, never by line, because a splice re-formats.
   */
  const [addIntent, setAddIntent] = useState<{ readonly path: string; readonly declIndex: number; readonly n: number } | null>(null);
  /**
   * The open right-click menu, or `null` (`M218` `A`, `D1145`).
   *
   * **One piece of state for the whole page**, which is what makes *at most one menu is open* a
   * property of the shape rather than a rule every opener has to remember. Rows do not own menus;
   * they hand one over and the shell holds it.
   */
  const [menu, setMenu] = useState<MenuRequest | null>(null);
  /** The open move/delete dialog, or `null` — `M218` `D`/`E`. */
  const [fileAction, setFileAction] = useState<{ readonly kind: FileActionKind; readonly path: string } | null>(null);
  /** The directory a `+ New file here` was opened from (`D1159`), or `null`. */
  const [creatingIn, setCreatingIn] = useState<string | null>(null);

  /** Open the create dialog, saying which directory it was asked for from (`D1159`). Every opener
   *  goes through this, so a `+ new file` at the foot cannot inherit the folder a menu last used. */
  const startCreating = useCallback((mode: NewMode, dir: string | null = null) => {
    setCreatingIn(dir);
    setCreating(mode);
  }, []);

  const [drafts, setDrafts] = useState<ReadonlyMap<string, string>>(() => new Map());

  /**
   * **A draft belongs to its file, and stops dying when you look at another one** — `M217` `C`
   * (`D1142`).
   *
   * This was one `string | null` for the whole page, and the effect that opens a file cleared it.
   * Measured before the change: pending edit on `checkout.tflw` (14 rows, dirty), click
   * `load.tflw` in the explorer — `data-compose-dirty` gone, **no prompt, nothing in the page text
   * matching `unsaved`/`pending`/`discard`** — click back, 8 rows. The work was gone, and the only
   * reason nobody had hit it hard is that the explorer was the only way to reach another file.
   * `M217` puts a `+` on every file row, which makes *cross a pending edit on the way to a create*
   * a one-click gesture, so the old behaviour could not be shipped under it.
   *
   * **In memory, for the life of the page, and that is a decision rather than an oversight**
   * (`D1142`). A draft that outlived a reload would outlive the etag it was read at, and would
   * need a staleness check, conflict handling and a way to abandon it — a round of its own. A
   * reload loses drafts today and goes on losing them. `D1045`'s rule is why nothing here reaches
   * `localStorage` or the server: this is a view of a project, not a fact about one.
   */


  /**
   * **Which create dialog is open** — `M214` `A6` (`D1118`), lifted here from `ComposeDoor`.
   *
   * `+ new file` belongs in the **explorer**, because creation lives where the thing is created and
   * the explorer is where files are. The sidebar and the compose pane are siblings, so a dialog
   * owned by either could not be opened from the other; it moved up to the one component that is
   * above both, which is also the one that owns the address a new file has to be opened at.
   *
   * It was in the Compose head before this — `+ new test` and `+ new file` as a toolbar over a
   * pane about a declaration — which is the fifth of the five complaints this round answers.
   */
  const [creating, setCreating] = useState<NewMode | null>(null);

  /**
   * **It reads the env the strip is pointing at** — `M228` `F` (`D1248`).
   *
   * `envPick` is in the dependency list, so every existing caller — a config write, a file write,
   * the landing's create — re-reads against the current pick without being told to, and the effect
   * below turns a change of pick into a re-read on its own. That is the whole wiring: there is no
   * second fetch path and no copy of `authorization` to keep in step.
   */
  /**
   * **Reads in flight** — `M229` `D` (`D1252`). A ref and not state, because nothing renders from
   * it: the only reader is the address normalisation below, which re-runs when the read lands
   * because the read lands by replacing `project`.
   *
   * What it buys is the one distinction that normalisation cannot make without it. An address
   * naming a file this project does not have is either a **contradiction** — a stale link, a
   * deleted file, `M228`'s `%2F` — or an address that is simply **ahead of a read already on its
   * way**, which is what `+ new file` produces: `onDone` starts the re-read and moves the address
   * in the same breath. Both look identical to a component that only knows the current project,
   * and correcting the second one throws away the file the user just made. The box found it; this
   * Mac had been winning the race.
   */
  const reading = useRef(0);
  const readProjectView = useCallback(() => {
    reading.current += 1;
    // **Cleared BEFORE the state update, not in a `finally` after it.** `setProject` is what
    // re-renders, and the normalisation effect reads this counter during that render: a `finally`
    // runs a microtask later, so the flag would still say *a read is on its way* on the one render
    // where the answer has already arrived. That is harmless when the read delivered the file and
    // wrong when it did not — the address would then keep naming a file nobody has, with no later
    // render to correct it.
    const settled = (): void => {
      reading.current -= 1;
    };
    return getProject(envPick).then(
      (p) => {
        settled();
        setProject(p.configured ? p : null);
        setUnconfigured(p.configured ? null : p);
        setNoProject(!p.configured);
      },
      (e: unknown) => {
        settled();
        notify(e instanceof Error ? e.message : String(e));
      },
    );
  }, [envPick]);

  /* Changing the env changes what the pane PREDICTS, not only what the next run grades — so the
     pick is a reason to re-read the project, the same way a config write is. `envPick` starts
     `null` and the mount effect already reads once, so this fires on a real change and not on
     arrival. */
  useEffect(() => {
    if (envPick === null) return;
    void readProjectView();
  }, [envPick, readProjectView]);

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
      .catch((e: unknown) => notify(e instanceof Error ? e.message : String(e)));
  }, [refreshLists, readProjectView]);

  // A selected report directory is read once — `results.json` is the merged `RunReport`.
  useEffect(() => {
    if (selected?.kind !== 'report') return;
    const id = selected.id;
    setCompareId(null);
    getResults(id)
      .then((data) => setReport({ id, data }))
      .catch((e: unknown) => notify(e instanceof Error ? e.message : String(e)));
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
      .catch((e: unknown) => notify(e instanceof Error ? e.message : String(e)));
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
          /* **A followed run that ends while another tab is open says so** — `M240` `F`
             (`M239-08`). The Run tab draws the verdict itself; anywhere else the only mark was the
             tab's `runMark` going quiet. One notice, naming the verdict (`M239-06`'s layer). */
          if (tabRef.current !== 'run') {
            const verdict = end.status === 'cancelled' ? 'cancelled' : end.exitCode === 0 ? 'passed' : end.exitCode === 1 ? 'failed' : `ended with exit ${end.exitCode}`;
            notify(`the run ${verdict}${end.kept ? ` — its report is on the Run tab` : ''}`, 'info');
          }
        },
      });
    },
    [refreshLists, notify],
  );

  /* A viewer is about one report; choosing another run is leaving it (`D1179`). */
  useEffect(() => setTraceOpen(null), [selected]);

  // Selecting a run row that is still in flight (re)attaches to its stream — the server replays
  // every line first, so a page opened mid-run sees the whole of it.
  useEffect(() => {
    if (selected?.kind === 'run' && live?.id !== selected.id) watch(selected.id);
  }, [selected, live?.id, watch]);

  const running = runs.some((r) => r.status === 'running');
  /**
   * **A run that appears is followed** — `M240` `F` (`M239-08`).
   *
   * A run started from a terminal, the API or a second tab drew a `● running` chip while the pane
   * said *select a run* (review U8): `running` is a fact the strip draws and the pane's selection
   * was a separate state nothing set when a run appeared. Now, whenever the list holds a running
   * run and nothing is being followed, that run is selected — and selection is what starts the
   * watch. A reader who is following one run is not moved to another.
   *
   * The list itself is re-read every five seconds while the page is visible, because nothing else
   * tells this page about a run it did not start: the stream is per run, and a run is only
   * announced by the list. One small `GET` per open tab per five seconds is the price of *a run
   * started elsewhere is followed*, and it is paid only while somebody can see the page.
   */
  useEffect(() => {
    const first = runs.find((r) => r.status === 'running');
    if (first === undefined) return;
    // *Being followed* is a live watch with no end yet; a watch that has ended is a run that is
    // over, and the next one that appears is followed the same way.
    if (live !== null && (live.end === null || live.id === first.id)) return;
    setSelected({ kind: 'run', id: first.id });
  }, [runs, live]);
  useEffect(() => {
    const every = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      refreshLists().catch(() => { /* a poll that fails is the next poll's problem, not a notice every five seconds */ });
    }, 5_000);
    return () => clearInterval(every);
  }, [refreshLists]);
  const onCancel = useCallback(() => {
    const r = runs.find((x) => x.status === 'running');
    if (r) void cancelRun(r.id).then(refreshLists);
  }, [runs, refreshLists]);

  const defaultEnv = project?.envs.find((e) => e.isDefault)?.name ?? project?.envs[0]?.name ?? '';
  const env = envPick ?? defaultEnv;
  /**
   * **The facts every run carries, whatever narrowed it** — `M220` `D` (`D1178`).
   *
   * Extracted from `request()` below when ▶ arrived, because ▶ builds its own narrowing — one
   * file, one `--only` — and would otherwise have run against the **default** env while the strip
   * two rows above it said another one. That is a page with two answers to *what is about to run*,
   * which is the one thing this strip's own header says it exists to prevent. So the run-level
   * half lives here and `onRun` applies it to every request that reaches it, from either gesture.
   */
  const runLevel = useCallback((): RunRequest => {
    const req: { -readonly [K in keyof RunRequest]: RunRequest[K] } = {};
    if (env) req.env = env;
    if (/^\d+$/.test(workers)) req.workers = Number(workers);
    /* `--headed` (`M220` `D`, `D1173`) — the escape hatch, and the only answer for firefox and
       webkit, which CDP cannot serve at all. Deliberately not the headline: a window that steals
       focus mid-run is a poor default, and `D1169`'s trace is the thing you actually read. */
    if (headed) req.headed = true;
    return req;
  }, [env, workers, headed]);

  const onRun = useCallback(
    async (request: RunRequest) => {
      try {
        /* **One funnel, and the run-level facts land here** (`D1178`). The strip's own request has
           already spread them and re-spreading identical values changes nothing; ▶'s has not, and
           this is what gives it the env, the workers and `--headed` the reader is looking at.
           **It sits below `runLevel` rather than above it** — this callback used to be the first
           thing after `watch`, and moving it four statements down was cheaper than a ref kept
           current by an effect. Nothing between the two positions calls it. */
        const record = await startRun({ ...runLevel(), ...request });
        setSelected({ kind: 'run', id: record.id });
        await refreshLists();
        watch(record.id);
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e));
      }
    },
    [refreshLists, watch, runLevel],
  );

  /** The request exactly as `tflw run` takes it — a field is present only when it narrows. */
  const request = useCallback((): RunRequest => {
    const req: { -readonly [K in keyof RunRequest]: RunRequest[K] } = { ...runLevel() };
    // `D1064` — the two kinds of query narrow a run by different mechanisms, and only one of them
    // is exact. `--tag` is the language's own narrowing, so a tag query runs *the tests carrying
    // the tag*; a name has no flag, so a text query can only run the files it lit up, whole. On the
    // sibling that gap is 59 tests against 97 — which is why this is a fork and not a filter.
    const parsed = project ? parseQuery(query, project) : { kind: 'none' as const };
    if (parsed.kind === 'tag' && parsed.tags.length > 0) req.tags = [...parsed.tags];
    const chosen = selection.length > 0 ? new Set(selection) : parsed.kind === 'text' && project ? matchingFiles(project, parsed)! : null;
    if (chosen !== null && chosen.size > 0 && project) req.files = project.files.map((f) => f.path).filter((p) => chosen.has(p));
    return req;
  }, [runLevel, query, selection, project]);


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
  /**
   * **Where this door lands when the address names no file** — `M240` `A` (`D1290`).
   *
   * This read `filePaths[0]` — the first path in sort order — which on the dogfood put the API door
   * on an action-only helper with no test in it and the BROWSER door on a file with nothing behind
   * BROWSER (review U1). `landingFor` is the rule: the file last opened under this door in this
   * browser for this project, else the file with the most of this door's kind of work, else
   * nothing — and nothing is drawn as `EmptyDoor` rather than as the wrong file. The memory is read
   * here, once per door change and per project read, and written by the effect below on every file
   * the pane draws; `landing.ts` says why the key carries a hash of the root.
   */
  const landing = useMemo(
    () => (door === null || project === null ? null : landingFor(door, project, rememberedLanding(door, projectHash(project.root)))),
    // `file` is a dependency although the rule never reads it: the memory is written by the effect
    // below on every file the pane draws, so a door change with the same door and project — the
    // address dropping its file — has to re-read what that effect wrote since the last landing.
    // Without it the memo handed back the previous landing, the effect wrote THAT over the memory,
    // and a reload lost the file the reader had opened (found by the page suite's own case).
    [door, project, file],
  );
  const landingPath = landing?.path ?? null;
  const path = file !== null && filePaths.includes(file) ? file : (landingPath ?? '');
  useEffect(() => {
    if (door === null || project === null || path === '') return;
    rememberLanding(door, projectHash(project.root), path);
  }, [door, project, path]);

  /**
   * **The address names what is drawn** — `M229` `D` (`D1252`).
   *
   * `doors.ts` answers an address it does not recognise by reporting a default and letting the
   * caller fall back, and says so in three places: *"a hash naming a file that has been renamed or
   * deleted is the same class as a hash naming a tab nobody has heard of"*. That tolerance is
   * right — a hand-typed hash is not an error worth a message — and it left the other half undone.
   * Measured: `#/api/bogus` draws **Compose** and the address bar goes on saying `#/api/bogus`,
   * with no notice; so does `#/api/runs`, and so does a hash naming a file that is not there, which
   * draws the project's first file instead. The address bar is this page's only shareable state
   * (`D1045`), and a link that reproduces a different page from the one it was copied off is worse
   * than a link that refuses.
   *
   * **This is `M228`'s own `%2F` lesson turned into a rule.** That round spent a whole measurement
   * pass reading numbers off the wrong declaration because `tests%2Fsignin.tflw` named no file, the
   * page fell back, and nothing said so. The carry was *a live-page measurement needs its own
   * control that the page is showing what you asked for*; this is that control, built into the page
   * rather than into each measurement.
   *
   * **Written with `hashForTab`, from the live hash — not from this component's state.** The
   * writer is the same one every other navigation on this page goes through, so there is no second
   * opinion about what an address means (`D1094`). The *input* is `window.location.hash` read at
   * the moment the effect runs, and that is not a detail: the first draft composed the canonical
   * out of `door`/`tab`/`file`, which lag the hash by one `hashchange`, and **it broke two standing
   * gates** — `M213` `S4` and `M217` `D2`, both of which write a hash ending in `L<n>` and then
   * read what the pane opened. An effect that renders between the assignment and the event composes
   * an address out of the previous state and replaces the one just written. Reading the hash makes
   * staleness impossible by construction: for an honest address the canonical is that address, so a
   * mid-flight run is a no-op rather than a race.
   *
   * **AN ADDRESS MAY BE LESS SPECIFIC THAN WHAT IS DRAWN; IT MAY NOT BE DIFFERENT FROM IT.** An
   * earlier draft wrote the whole drawn state back, which turned every `#/api` into
   * `#/api/compose/one.tflw` the moment the project loaded — and `#/api` was never a lie. It is
   * the bare door hash this page has written since `M200`, it draws the first file by design, and
   * a reader who typed it gets what they asked for. So a **file the address does not name** stays
   * unnamed, and only a file it names that the project does not have is replaced with the one on
   * screen. Omission is not a contradiction.
   *
   * The query tail is carried across **verbatim** for the same reason: a selection and a search are
   * the address's, this correction is about the path, and re-spelling them here would be a third
   * writer for a string `paneTail` already owns.
   *
   * **`replaceState`, not an assignment.** `window.location.hash = …` pushes a history entry, so a
   * normalisation would put the lying address behind the back button and a press would return you
   * to it. It also fires `hashchange`, which this effect would then answer again.
   *
   * **After the project has been read, and it cannot be sooner for the file.** Whether a hash names
   * a file this project has is a question only the project can answer, so the effect waits for one;
   * before then the address is left exactly as typed. The door and the tab are decided by the
   * grammar alone and are corrected on the same pass, which is the cheapest moment they are both
   * known.
   */
  useEffect(() => {
    if (project === null) return;
    const hash = window.location.hash;
    const at = doorFromHash(hash);
    const addressed = fileFromHash(hash);
    const known = project.files.map((f) => f.path);
    // `reading.current > 0` is *a project read is on its way*, and while one is the address is left
    // alone: it may be naming a file that read is about to deliver. The door and the tab are
    // corrected either way — those are decided by the grammar and no read can change them.
    // `M240` `A` — the file on screen for a named-but-missing file is the door's landing, not
    // `known[0]`; `landingPath` is what `path` above fell back to, so the address says what is drawn.
    const drawn = addressed === null || known.includes(addressed) || reading.current > 0 ? addressed : landingPath;
    const q = hash.indexOf('?');
    const canonical = at === null ? '#' : hashForTab(at, tabFromHash(hash), drawn, focusFromHash(hash) ?? undefined, docFromHash(hash)) + (q < 0 ? '' : hash.slice(q));
    // A URL with no fragment at all already names the landing; writing `#` onto it would be a
    // change with nothing behind it.
    if (hash === '' && canonical === '#') return;
    if (hash === canonical) return;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${canonical}`);
    // The state below is already the hash's — `onHash` set it — so nothing is re-read here. A
    // `replaceState` fires no `hashchange`, which is the other half of why this cannot loop.
  }, [project, door, tab, file, focusLine, doc, selection, query, landingPath]);

  /** **Does this door draw a Compose sequence** — `M224` `D` (`D1210`), read once and spent twice:
   *  the dispatch below and `main-fill`. `vocabulary.ts`'s `adds.length > 0` is the table's own way
   *  of saying so (`D1189`), so neither call site names a door. */
  const composes = door !== null && VOCABULARY[door].adds.length > 0;

  // ── `M218` `B` — what a right-clicked row can do ───────────────────────────────────────────────
  //
  // Built here and not in `Sidebar`, which is `D1148`: the explorer describes its row, the shell
  // decides what may be done to it, and every create item calls the callback its `+` already calls.
  // Nothing in this block constructs `.tflw` text.

  /** Copy, honestly. `navigator.clipboard` is absent outside a secure context, and a menu item that
   *  silently did nothing would be worse than one that says it cannot (`D1146`). */
  const canCopy = typeof navigator !== 'undefined' && navigator.clipboard !== undefined;
  const copy = useCallback((text: string) => { void navigator.clipboard?.writeText(text); }, []);

  /** Open a file at a given tab without going through `setFile` **then** `setTab` — the second of
   *  those reads `file` from its own closure and would write the hash for the file we just left.
   *  The hash is the source of truth and its listener moves the page, so one write does it. */
  const openAt = useCallback((p: string, at: TabId) => {
    if (door === null) return;
    window.location.hash = hashForTab(door, at, p, undefined, doc) + paneTail([p], query);
  }, [door, doc, query]);

  /**
   * **Run just this file** — explicit, and therefore not `D1149`'s rejected side effect.
   *
   * It overrides `files` on the request the strip would otherwise send and leaves the selection
   * alone: the narrowing in the address goes on meaning what it meant, and the item's own label is
   * what tells the reader this run is narrower than that.
   */
  const runJust = useCallback((p: string) => { void onRun({ ...request(), files: [p] }); }, [onRun, request]);

  /** A free `…-copy[-n].tflw` beside the original, decided against the project view rather than by
   *  asking the server and reading a `409` — the answer is already on the page. */
  const copyNameFor = useCallback((p: string): string => {
    const taken = new Set((project?.files ?? []).map((f) => f.path));
    const stem = p.replace(/\.tflw$/, '');
    for (let n = 1; ; n += 1) {
      const candidate = `${stem}-copy${n === 1 ? '' : `-${n}`}.tflw`;
      if (!taken.has(candidate)) return candidate;
    }
  }, [project]);

  /** Duplicate a file: read, write under a free name, open it. No new route — `PUT` with a `null`
   *  etag is already *this file should not exist yet*, which is exactly the claim being made. */
  const duplicateFile = useCallback(async (p: string) => {
    try {
      const src = await getFile(p);
      const target = copyNameFor(p);
      const put = await putFile(target, src.text, null);
      if (!put.ok) { notify(`could not duplicate ${p}: ${put.error}`); return; }
      await readProjectView();
      openAt(target, 'compose');
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e));
    }
  }, [copyNameFor, openAt, readProjectView]);

  /** Who imports this file, from the view the server already sent (`M218` `C`). One source, two
   *  deliveries: the page answers the menu instantly and the route answers the apply. */
  const importersOf = useCallback(
    (p: string): readonly string[] => (project?.files ?? []).filter((f) => f.path !== p && f.imports.includes(p)).map((f) => f.path),
    [project],
  );

  const menuFor = useCallback((t: MenuTarget): readonly MenuItem[] => {
    if (t.kind === 'dir') {
      return [
        { id: 'new-file-here', label: 'New file here…', run: () => startCreating('file', t.path) },
        { id: 'fold', label: t.expanded ? 'Collapse' : 'Expand', run: t.onToggle },
        t.files.length === 0
          ? { id: 'select', label: 'Select its files for the run', run: null, why: 'this folder holds no `.tflw` file' }
          : { id: 'select', label: `Select its ${t.files.length} file${t.files.length === 1 ? '' : 's'} for the run`, run: () => pick(t.files, null) },
      ];
    }
    if (t.kind === 'file') {
      return [
        { id: 'open', label: 'Open', run: () => pick([t.path], t.path) },
        { id: 'new-test', label: 'New test here…', run: () => { setFile(t.path); startCreating('test'); } },
        { id: 'duplicate', label: 'Duplicate', run: () => { void duplicateFile(t.path); } },
        { id: 'reveal-source', label: 'Show its source', run: () => openAt(t.path, 'source') },
        { id: 'run-file', label: 'Run just this file', run: () => runJust(t.path) },
        canCopy
          ? { id: 'copy-path', label: 'Copy path', run: () => copy(t.path) }
          : { id: 'copy-path', label: 'Copy path', run: null, why: 'the clipboard is only available over https or on localhost' },
        { id: 'rename', label: 'Move or rename…', run: () => setFileAction({ kind: 'move', path: t.path }) },
        /* **Disabled with its reason, never hidden** (`D1146`). The project view already carries
           every file's `import`/`use` targets, so the reverse index is a `filter` over what the
           page holds and the menu can refuse instantly — the route re-derives the same fact at
           apply time, which is the authority (`D1150`). */
        importersOf(t.path).length === 0
          ? { id: 'delete', label: 'Delete…', danger: true, run: () => setFileAction({ kind: 'delete', path: t.path }) }
          : {
              id: 'delete',
              label: 'Delete…',
              danger: true,
              run: null,
              why: `${importersOf(t.path).length} file${importersOf(t.path).length === 1 ? '' : 's'} import${importersOf(t.path).length === 1 ? 's' : ''} this: ${importersOf(t.path).join(', ')}`,
            },
      ];
    }
    if (t.kind === 'test') {
      return [
        { id: 'goto', label: 'Go to it', run: () => setTab('compose', t.line) },
        { id: 'new-request', label: 'New request here', run: () => { setTab('compose', t.line); setAddIntent((prev) => ({ path, declIndex: t.declIndex, n: (prev?.n ?? 0) + 1 })); } },
        canCopy
          ? { id: 'copy-name', label: 'Copy its name', run: () => copy(t.name) }
          : { id: 'copy-name', label: 'Copy its name', run: null, why: 'the clipboard is only available over https or on localhost' },
      ];
    }
    return [
      { id: 'goto', label: 'Go to it', run: () => setTab('compose', t.line) },
      canCopy
        ? { id: 'copy-request', label: 'Copy method and path', run: () => copy(`${t.method} ${t.path}`) }
        : { id: 'copy-request', label: 'Copy method and path', run: null, why: 'the clipboard is only available over https or on localhost' },
    ];
  }, [pick, setFile, setTab, duplicateFile, openAt, runJust, copy, canCopy, path, importersOf, startCreating]);

  /** `D1143` — what the explorer marks. A set rather than the map, because the explorer needs to
   *  know *which* files are unsaved and has no business with their bytes. */
  const unsavedPaths = useMemo(() => new Set(drafts.keys()), [drafts]);
  /**
   * **A draft is not lost to a reload or a closed tab without a word** — `M240` `F` (`M239-07`).
   *
   * `D1142` keeps drafts in memory and accepts the loss on reload; what it did not do was tell
   * anyone. Cmd-R or a closed tab dropped every unsaved row with no prompt, and the unsaved dot
   * in the explorer was the only signal (review U9). One `beforeunload` listener while any draft
   * is dirty, removed the moment there is none — so a clean page closes without a dialog, and a
   * dirty one asks. `returnValue` is the legacy half of the same contract, kept for the browsers
   * that still read it; the page's own text never reaches the dialog anyway.
   */
  useEffect(() => {
    if (unsavedPaths.size === 0) return;
    const ask = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [unsavedPaths]);

  /**
   * **The page's keys** — `M240` `C` (`D1292`). One table (`shortcuts.ts`), two listeners: this one
   * answers the five that are about the page, and `ComposeDoor` answers *save*, because the draft
   * and its etag live there. A shortcut already handled below (the legend's `Escape`, a roving
   * strip's arrows) arrives here prevented and is left alone.
   */
  const [legendOpen, setLegendOpen] = useState(false);
  const closeLegend = useCallback(() => setLegendOpen(false), []);
  useEffect(() => {
    if (project === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      const s = shortcutFor(e);
      if (s === null) return;
      switch (s.id) {
        case 'legend':
          e.preventDefault();
          setLegendOpen((o) => !o);
          return;
        case 'search':
          e.preventDefault();
          document.querySelector<HTMLElement>('[data-search]')?.focus();
          return;
        case 'open-file':
          e.preventDefault();
          (document.querySelector<HTMLElement>('.files.tree button[tabindex="0"]') ?? document.querySelector<HTMLElement>('.files.tree button'))?.focus();
          return;
        case 'run-file':
          e.preventDefault();
          if (path !== '' && !running) runJust(path);
          return;
        case 'run-selection':
          e.preventDefault();
          if (!running) void onRun(request());
          return;
        case 'save':
          return;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [project, path, running, runJust, onRun, request]);

  /** This file's unsaved bytes, or `null`. See `drafts` above for why it is keyed by path. */
  const draft = drafts.get(path) ?? null;
  const setDraft = useCallback(
    (next: string | null) => {
      setDrafts((prev) => {
        if (next === null && !prev.has(path)) return prev;
        if (next !== null && prev.get(path) === next) return prev;
        const map = new Map(prev);
        if (next === null) map.delete(path);
        else map.set(path, next);
        return map;
      });
    },
    [path],
  );

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
    // **The buffer is NOT dropped here any more** (`D1142`). A draft belongs to the file it was
    // typed into, and `drafts` is keyed by path — so opening another file simply reads another
    // key, and coming back reads this one again.
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
  /**
   * **Whether the bytes in hand are THIS file's** — `M217` `D`.
   *
   * `setFile` and the read that follows it are not the same tick: for one render `path` is the new
   * file while `openFileView` is still the old one, so anything reading `fileText` in between is
   * reading one file's bytes under another file's name. That was harmless while the only way to
   * open the dialog was from the file already open; `D1139`'s `+` opens a file **and** the dialog
   * in one gesture, and a `newSource` built on the wrong text would splice a test into the wrong
   * file — or, with `into: ''`, into an empty one.
   *
   * A draft counts as ready because a draft IS that path's text, by construction (`D1142`).
   */
  const fileReady = draft !== null || openFileView?.path === path;
  /**
   * **Which actions put a page on screen, project-wide** — `M219` `B` (`D1161`).
   *
   * The index computed it once, on the server, from the same parse every other index fact comes
   * from; this is the page flattening it into the one shape the fold asks for. It is names and not
   * paths because that is how a `call` names an action, and an action reached through a `use` is
   * declared in the file it came from — so the set has to span the project, not the open file.
   */
  const opensPage = useMemo(
    () => pageOpeners(project?.files ?? []),
    [project],
  );
  const outline = useMemo(
    () => (fileText === null || openFileView === null ? null : fileOutline(openFileView.path, fileText, opensPage)),
    [openFileView, fileText, opensPage],
  );

  if (door === null || noProject === true) {
    // A door onto nothing is not a door: until there is a `tflw.config`, every path leads back
    // to the landing, which is where a project can be made (`A0-5`).
    return <Landing project={project} unconfigured={unconfigured} error={error} noProject={noProject} onOpen={setDoor} onCreated={() => void readProjectView()} />;
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
      {selected?.kind === 'run' && live && live.id === selected.id ? <LivePane live={live} /> : null}
      {/* **The trace viewer, in the page** — `M220` `C` (`D1179`).
          It is an `<iframe>` and that is *not* §2.1's refused idea: the viewer is served by this
          same server under `/trace/`, so it is **same-origin**, and the thing §2.1 measured as
          unreachable was an iframe of the application *under test*, on another port.
          Measured: the viewer compresses to a floor of **606 px** and fits without overflow at
          704. This pane is the main area — ~1100 px at 1440 — and, unlike the editor column
          (460–860 px depending on where the reader has dragged `COMPOSE`'s grip), it is above that
          floor at every width the grip can produce. That measurement is what chose this placement
          over the column beside the sequence, and over a sixth tab, which `doors.ts`'s own rule
          refuses: a tab is a stage of one file's life, and Run is already that stage. */}
      {traceOpen && selected?.kind === 'report' && selected.id === traceOpen.id ? (
        <section className="trace-pane" data-trace-pane={traceOpen.path}>
          <p className="trace-pane-bar">
            <button type="button" className="linkish" onClick={() => setTraceOpen(null)} data-trace-close>
              ← back to the report
            </button>
            <a href={reportFileUrl(traceOpen.id, traceOpen.path)} download data-trace-download-pane>
              trace.zip
            </a>
            <code className="muted">{traceOpen.path}</code>
          </p>
          {/* **The viewer cannot be deep-linked to a step, measured.** Its bundle reads exactly
              four query parameters — `trace`, `ws`, `isUnderTest`, `configuration`; the
              `pointX`/`pointY`/`name`/`route` ones belong to the snapshot renderer and its service
              worker, not to the top-level page. `M220` §4 `C` named this the round's one
              unverified assumption and stated the fallback in advance: it opens at the top. */}
          <iframe
            className="trace-frame"
            data-trace-frame
            title="Playwright trace viewer"
            src={`/trace/index.html?trace=${encodeURIComponent(new URL(reportFileUrl(traceOpen.id, traceOpen.path), window.location.origin).toString())}`}
          />
        </section>
      ) : null}
      {selected?.kind === 'report' && report && report.id === selected.id && !traceOpen ? (
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
              ?.artefacts.map((f) => (
                <a key={f} href={reportFileUrl(report.id, f)} target="_blank" rel="noreferrer" data-report-file={f}>
                  {f}
                </a>
              ))}
          </p>
          <Findings report={report.data} compare={compare && compare.id === compareId ? compare : null} onAccept={door === null ? null : (f) => void acceptFinding(f)} />
          <ReportBody tests={report.data.tests} context={{ id: report.id, evidenceLevel: report.data.evidenceLevel, traceViewer: project?.traceViewer ?? false, compare: compare && compare.id === compareId ? compare : null, onOpenTrace: (p) => setTraceOpen({ id: report.id, path: p }) }} />
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
    /* The pane's width is the reader's (`M216`) — a grid column fed by a custom property so the
       grip moves one number and the media query below 900 px, where the pane stops being a column
       at all, goes on overriding it untouched. */
    <div className="app" style={{ ['--sidebar-w' as string]: `${sidebarWidth}px` }}>
      {/* `M240` `E` — the explorer and its grip are one landmark. The grip is a control, and a
          control outside every landmark is content a screen reader's landmark list never reaches;
          the column pair is laid out as a nested grid so the page's own tracks do not move. */}
      <aside className="sidebar-col" aria-label="the project">
      {project ? <Sidebar project={project} door={door} openFile={path === '' ? null : path} selection={selection} onPick={pick} query={query} onQuery={setQuery} outline={outline} unsaved={unsavedPaths}
          onNewIn={(p) => { setFile(p); startCreating('test'); }}
          onAddRequest={(declIndex) => setAddIntent((prev) => ({ path, declIndex, n: (prev?.n ?? 0) + 1 }))}
          focusLine={focusLine} onLine={(line) => setTab('compose', line)} onNew={(m) => startCreating(m)}
          menuFor={menuFor} onMenu={setMenu} /> : <div className="sidebar muted">{error ?? 'reading the project…'}</div>}
      <Grip spec={SIDEBAR} size={sidebarWidth} onSize={setSidebarWidth} />
      </aside>
      <Legend open={legendOpen} onClose={closeLegend} />
      {/* Moving and deleting, both through the server's own plan (`M218` `D`/`E`, `D1150`). */}
      {fileAction === null ? null : (
        <FileAction
          kind={fileAction.kind}
          path={fileAction.path}
          unsaved={unsavedPaths}
          onClose={() => setFileAction(null)}
          onDone={(to) => {
            const gone = fileAction.path;
            setFileAction(null);
            /* `D1155` — the draft follows its file, or dies with it. Keyed by path since `D1142`,
               so a rename that did not re-key would silently strand the reader's pending edits
               under a path nothing opens any more. */
            setDrafts((prev) => {
              const next = new Map(prev);
              const held = next.get(gone);
              next.delete(gone);
              if (to !== null && held !== undefined) next.set(to, held);
              return next;
            });
            void readProjectView();
            if (to !== null) openAt(to, tab);
            else if (door !== null) window.location.hash = hashForTab(door, tab, null) + paneTail([], query);
          }}
        />
      )}
      {/* **The create dialog is the shell's** (`D1118`) — one dialog, two places that ask for it:
          the explorer's `+ new file` and the sequence column's `+ new test`. */}
      {creating === null || project === null || (creating === 'test' && !fileReady) ? null : (
        <NewThing
          mode={creating}
          /* **The door decides what it scaffolds** (`M222`, `D1189`) — `D1042`'s own second
             clause, live for the first time. `door` is non-null here: the landing returns above
             whenever it is not. */
          door={door}
          inDir={creatingIn}
          openPath={path}
          /* **The file as the author has it** (`M217` `C`, `D1141`). This read `openFileView.text`
             — the bytes on disk — so with anything pending the dialog previewed and wrote a file
             that was not the one the author was looking at. */
          openText={fileText ?? ''}
          existing={project.files.map((f) => f.path)}
          onCancel={() => setCreating(null)}
          onStage={(text) => {
            setCreating(null);
            /* Into the buffer, like every other gesture on the pane. Nothing is written, so there
               is nothing to re-read: the outline is already derived from this text. */
            setDraft(text);
          }}
          onDone={(written) => {
            setCreating(null);
            // The same notification a save makes — the page is a projection of the file and not a
            // cache of it (`D985`), so the project is re-read rather than patched.
            void readProjectView();
            // **A new FILE moves the address to it.** A create that left you looking at the file
            // you were already on is a write with no visible consequence — the shape `M209` found
            // four times over. `onDone` is now the file mode's alone.
            setFile(written.path);
          }}
        />
      )}
      {/* `M214` `A1` (`D1110`) — Compose is three regions that each scroll inside themselves, so
          this column stops scrolling as one document and the page has no vertical overflow at any
          height. Every other tab is unchanged.

          **`M223` `A` (`D1193`) — the predicate is *where this pane is*, not which door.** It read
          `door === 'api'` from `M214` until that round, which is why the BROWSER door laid out by
          content and left **278 px of the window unclaimed below the stage** (measured, 1440x900)
          while the same pane on API filled.

          **`M224` `D` (`D1210`) — and now neither half names a door at all.** `M223` fixed the
          predicate by *listing the two doors that render `ComposeDoor`*, which put the same fact
          in two places and cost LOAD **190 px** the moment it became the third. The condition is
          *does this door draw a Compose sequence*, and `vocabulary.ts` already answers it —
          `adds.length > 0`, the qualifier `D1189`'s docblock calls this table's own way of saying
          so. `D1198`, one rule, no door conditional, held twice. */}
      <main className={`main${composes && tab === 'compose' ? ' main-fill' : ''}`}>
        {/* The floating layers — tip, notices, context menu — are `position: fixed`, so where they
            sit in the DOM moves nothing on screen; they sit HERE because content outside every
            landmark is content a landmark walk never reaches (`M240` `E`, axe `region`). One layer
            for the whole page (`M216` `B1`), and the shell owns the menu (`M218` `A`) because one
            opened from a sidebar row must be able to paint over the pane. */}
        <TooltipLayer />
        <Notices notices={notices} onDismiss={dismiss} />
        <ContextMenuLayer menu={menu} onClose={() => setMenu(null)} />
        {/* The theme is a fact about the reader and not about the project, so it is reachable from
            every door, from the landing, and from the pane that says the project could not be read
            (`M213` `S0`). It rides IN the doorbar rather than above it, because a row of its own
            cost every page ~20 px — see `DoorBar`'s own note. The second call site is the one case
            there is no doorbar to ride in. */}
        {project ? <DoorBar project={project} door={door} onDoor={setDoor} themePick={<ThemePick />} onLegend={() => setLegendOpen(true)} /> : <ThemePick />}
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
            headed={headed}
            onHeaded={setHeaded}
            selection={selection}
            query={query}
            running={running}
            onRun={onRun}
            onCancel={onCancel}
            request={request}
          />
        ) : null}
        {/* **All four doors are one pane** (`M213` `S4`, `D1094`; `D1210`; `M228` `B`, `D1237`).
            `vocabulary.ts` is the whole of the difference between them, and `ScanForm` has gone
            the way `BrowserForm` and `LoadForm` did: all three were the `<select>` that asked
            which test to append to. Four rounds, one door each, and the fork is now gone rather
            than narrowed — a narrowed fork is still two implementations of one picture.

            **The dispatch names no door**, which is the point rather than a tidy-up: `D1042` says
            a door decides where you land and what `+ new test` scaffolds, and a list of doors here
            is a second place that decision can be made — the one that left LOAD behind when the
            pane was rebuilt three times around it. */}
        {project && composes ? (
          <ComposeDoor
            /* `M240` `A` (`D1290`) — a door with nothing behind it draws its one sentence and
               `+ new file` where the file's stage would be, not a pane about whichever file sorted
               first. `path` is `''` exactly when `landingFor` answered empty and the address names
               no file the project has; the strip and the project-fact tabs stay. */
            empty={path === '' ? <EmptyDoor door={door} onNew={() => startCreating('file')} /> : undefined}
            door={door}
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
            onNew={(m) => startCreating(m)}
            onMenu={setMenu}
            addIntent={addIntent}
            onAddIntentDone={() => setAddIntent(null)}
            focusLine={focusLine}
            authPanel={authPanel}
            configPanel={configPanel}
            configMark={configMark}
            runPane={runPane}
            runMark={live && !live.end ? 'a run is going' : undefined}
            /* `M220` `A` — ▶ on a declaration is a run, so it goes through the shell's own
               `onRun` (`D1168`): selected, watched, and landing where every run's end lands. */
            onRun={(r: RunRequest) => void onRun(r)}
            running={running}
            /* `D1180` — the newest report's identity and its time. Either moving is a new run to
               read; neither moves when nothing has run, so the effect behind it stays quiet. */
            reportsStamp={`${reports.length}:${reports[0]?.id ?? ''}:${reports[0]?.at ?? ''}`}
          />
        ) : null}
      </main>
    </div>
  );
}

interface Notice {
  readonly id: number;
  readonly text: string;
  readonly at: number;
  /** `fail` is the red border; `info` is a run's end, which is news and not a failure. */
  readonly tone: 'fail' | 'info';
}

/** How long a notice stays before it goes on its own. Long enough to read, short enough that a
 *  page left open does not pile up a morning's worth of them. */
const NOTICE_MS = 10_000;

/**
 * The notices, top-right — `M239-06`. One timer per notice, cleared on unmount, so ten seconds is
 * ten seconds from each one's own arrival and a burst does not vanish together.
 */
function Notices({ notices, onDismiss }: { readonly notices: readonly Notice[]; readonly onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (notices.length === 0) return;
    const now = Date.now();
    const timers = notices.map((n) => setTimeout(() => onDismiss(n.id), Math.max(0, NOTICE_MS - (now - n.at))));
    return () => { for (const t of timers) clearTimeout(t); };
  }, [notices, onDismiss]);
  if (notices.length === 0) return null;
  return (
    <div className="notices" data-notices={notices.length} role="status" aria-live="polite">
      {notices.map((n) => (
        <div key={n.id} className={`notice ${n.tone === 'fail' ? 'error' : 'info'}`} data-notice={n.id} data-notice-tone={n.tone}>
          <span>{n.text}</span>
          <button type="button" onClick={() => onDismiss(n.id)} data-notice-close aria-label="dismiss this notice">
            ✕
          </button>
        </div>
      ))}
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
