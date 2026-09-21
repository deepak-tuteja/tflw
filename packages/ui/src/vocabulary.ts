// A door's vocabulary, as a table — `M213` `S4` (`D1094`).
//
// WHAT THIS REPLACES, AND WHY IT IS A TABLE RATHER THAN A SECOND PANE. Compose was built for the
// API door and the BROWSER door had `BrowserForm`: a `<select>` asking which already-open test to
// append steps to, with the file as an argument rather than as the subject — the staging-form
// shape `D1088` retired from the API door one day before (`M213-08`). So *"add expectations to a
// recorded session in Compose"* had nowhere to land, because BROWSER had no Compose at all.
//
// **TWO IMPLEMENTATIONS OF ONE PICTURE IS THE FAILURE THIS PROJECT KEEPS RECORDING** (`D1094`).
// The fix is not a third pane; it is to notice that the two doors differ in **what words they
// know**, and in nothing else. A door's Compose draws the open file's declarations, groups the
// body, edits a row, writes through the builders and the printer, and refuses what it cannot
// address — all of that is one implementation already. What is per-door is: which statement kinds
// this door owns, which of them it can construct, and what its `+` gestures are.
//
// **AND IT IS EXTRACTED FROM A PANE THAT ALREADY WORKS, WHICH IS WHY `S4` LANDS AFTER `S2`–`S3`.**
// Extracting a table from a pane that holds everything the API door needs is mechanical.
// Extracting one from a guess about what it will need is a redesign done twice.
//
// The browser half is small, and measured rather than imagined: `BrowserForm` offered exactly
// three actions — `click`, `fill`, `expect` — plus an `open` and an optional `within` scope. So
// the vocabulary this table gives BROWSER is not a reduction of what the door could do; it is
// everything the retired form could do, in a pane that also draws the file.

import { STEP_LENS, type Lens, type Step } from '@tflw/lang';

/** One `+` gesture a door offers at the foot of a declaration's body. */
export interface AddGesture {
  /** The `data-seq-add-*` suffix, and the key a gate names it by. */
  readonly key: string;
  readonly label: string;
  readonly title: string;
}

/**
 * **What `+ new test` writes on this door** — `M222` (`D1189`, implementing `D1042`).
 *
 * `D1042` has read *"a door decides where you land and **what the new-test button scaffolds**, and
 * nothing else"* since `M200` `A0-3`, and the bold half was never built: `newSource` hardcoded
 * `buildApiStep` + `buildExpect(status equals 200)` for every door. On BROWSER that created a test
 * whose only step is an `ApiStep` — **not in this table's own `browser.constructs`** — so the
 * create gesture drew its own output as a dead code line with `data-stmt-editable="no"`, which is
 * exactly the 650 statements `M219` `C` spent a slice removing.
 *
 * A **tag, not a builder**: `newSource` still calls the same `build*` functions and
 * `insertIntoSource`, so `D1087`'s one construction path is untouched. What this row decides is
 * which of them.
 *
 * **THERE IS NO `null`, AND `D1190` SAID THERE WOULD BE.** That decision read *"a door that
 * constructs nothing scaffolds nothing"* — LOAD and SCAN would create a named test with an empty
 * body. Two measurements taken while building killed it, and both are facts about the language
 * rather than about this table:
 *
 *  1. **An empty body is a parse error.** `test "a new one"` with nothing under it is `TF015`,
 *     *this `test` has no steps*. The scoping probe reported it clean because it read
 *     `parsed.errors`, a property `ParsedSource` does not have, so `?? []` made every file legal
 *     — the probe was vacuous in the one direction it was written to check.
 *  2. **SCAN's own shape cannot be built at all.** A scan is a `crawl` declaration; there is no
 *     `buildCrawl`, and `insertIntoSource` splices a `test` and nothing else. Scaffolding one is
 *     a builder and an insertion member, which is a different round.
 *
 * So LOAD and SCAN keep `'api'` — **unchanged from before this round** — and that is not a
 * fallback: a workload-bearing test *is* an `api` step under a `ramp` with `threshold`s, so the
 * request the dialog writes is the thing `LoadForm` then attaches a workload to. What `D1190` was
 * protecting against — a door drawing its own create gesture's output dead — cannot happen on
 * these two, because **neither renders a Compose pane at all** (`App.tsx` gives them `LoadForm`
 * and `ScanForm`; `D1103`). Their `constructs` describes a pane that is not on the screen.
 */
export type Scaffold = 'api' | 'open';

export interface DoorVocabulary {
  /**
   * The kinds this door can **construct**, which is the only per-door fact this table holds about
   * statements.
   *
   * **Ownership is deliberately NOT here.** `outline.ts` already computes a step's lens from the
   * language's own `lenses.ts`, and `isForeign(lens, door)` is the answer; a second list of
   * *which kinds are whose* in this file would be a copy that can disagree with it, which is the
   * defect class this table exists to remove rather than to add one of. So `constructs` is about
   * a capability of the **pane** — what its controls can build — and `isForeign` stays the
   * authority on what belongs to whom.
   *
   * A kind this door owns and cannot construct is drawn, disabled, saying why; a pane that is
   * half live and silent about which half is what `D1082` refuses.
   */
  readonly constructs: ReadonlySet<Step['type']>;
  /** The `+` gestures at the foot of a test's body, in the order they are drawn. */
  readonly adds: readonly AddGesture[];
  /**
   * Whether this door's Compose offers `send` — a scoped run of one request (`D1075`).
   *
   * **API only, and it is a fact about the language rather than about effort.** `send` prints a
   * scratch program cut off after the selected request and runs it; a browser test's unit is a
   * *session* — a page opened, then a sequence of gestures against whatever state the previous
   * one left — so there is no prefix that can be cut at a statement and still mean anything. The
   * recorder (`S5`, `D1095`) is the browser's answer to the same question, and it is a different
   * mechanism because it is a different question.
   */
  readonly sends: boolean;
  /**
   * Whether this door's Compose offers **▶ on a declaration** — a play (`M220` `A`, `D1168`).
   *
   * **A play is a run, not a new mechanism**: ▶ runs *that test* through the same interpreter,
   * the same browser and the same report a terminal would, narrowed by `--only <name>` and the
   * file it is declared in. What is new is a gesture scoped to one declaration and a place to look
   * afterwards — `D1169`'s trace.
   *
   * **It is a table entry rather than `door === 'browser'` for the reason the header gives**, and
   * it is `false` on the other three this round rather than absent: LOAD and SCAN construct
   * nothing here yet (`D1103`), and the API door's answer to *run just this* is `send`, which is a
   * different question — a prefix of a test cut off after one request, against a whole declaration.
   * Offering both on one door would be two gestures that look alike and mean different things.
   */
  readonly plays: boolean;
  /**
   * **The assertion subjects this door offers** — `M214` `A3` (`D1114`).
   *
   * The API door's subject select carried `an element` and `page`, which are BROWSER subjects, on
   * every one of the corpus's 1736 assertion rows. That is not a vocabulary being complete; it is a
   * door offering a word that cannot be true about anything it can fetch, and the complaint it drew
   * was *"what is going on in this section?"*.
   *
   * **It is a list of what this door DROPS, not of what it keeps**, and the direction is the whole
   * safety of it: a subject the language gains lands on every door by default, which is the
   * over-offering failure rather than the silent-omission one. `D1076` refuses the second and
   * tolerates the first — a word that should not be here is visible and wrong, and a word that is
   * missing is invisible and wrong.
   *
   * `carried` is never dropped by anything: it is not a subject, it is *the one already written*,
   * offered only when it is already what the row says.
   */
  readonly dropsSubjects: ReadonlySet<string>;
  /**
   * **The opening statement `+ new test` scaffolds on this door** (`D1189`, `D1190` as amended).
   *
   * The invariant this row exists to keep is one line long and holds for every future door by
   * construction: **a door that draws a Compose sequence scaffolds only what that sequence can
   * construct.** A create gesture that writes a statement its own pane cannot edit is a pane half
   * live and silent about which half — `D1082` — and it is how this round started.
   *
   * The qualifier is load-bearing and is `adds.length > 0`, this table's own way of saying *this
   * door has a Compose sequence*. LOAD and SCAN have `adds: []` and render their own forms
   * instead, so their `constructs` is not a claim about anything drawn.
   */
  readonly scaffold: Scaffold;
}

/** The neutral kinds every door's Compose can already edit — `statementEditOf`'s own list. */
const NEUTRAL_CONSTRUCTS: readonly Step['type'][] = [
  'ExpectStmt', 'CaptureStmt', 'LetStmt', 'LogStmt', 'CallStmt', 'GiveStmt', 'PauseStmt',
];

export const VOCABULARY: Readonly<Record<Lens, DoorVocabulary>> = {
  api: {
    constructs: new Set<Step['type']>([...NEUTRAL_CONSTRUCTS, 'ApiStep', 'WaitUntilApiStmt']),
    adds: [
      { key: 'request', label: '+ request', title: 'an `api` step and the assertion that reads it, at the end of this test' },
      { key: 'let', label: '+ let', title: '`let name = value` — a binding the requests below can interpolate; it goes at the top of the body, where 97 of the corpus’ 100 preamble statements are' },
      { key: 'wait', label: '+ wait until', title: '`wait until api …` — re-issues a request until the assertions under it pass, instead of sleeping and hoping' },
    ],
    sends: true,
    plays: false,
    /* `an element` and `page` are things a browser has. An `api` request fetches bytes — and so
       are the three `M219` `G` added to the language's offer (`D1166`): a network request the page
       made, and the two subjects a native dialog has. `D1167` keeps this door's offer flat this
       round; keeping it flat is not the same as letting it widen, so they join the drop list under
       `D1114`'s own rule rather than appearing here by default. */
    dropsSubjects: new Set(['locator', 'page', 'networkRequest', 'dialogMessage', 'dialogType']),
    /* `ApiStep` + `expect status equals 200` — byte-identical to what every door got before
       `M222`, because this is the door that entry was written for. */
    scaffold: 'api',
  },
  browser: {
    /* **ALL TWENTY-TWO, FROM `M219` `C`** (`D1162`) — and the comment this replaces is worth
       keeping the shape of, because it was right about one kind and wrong about the family:

         > *"`WithinBlock` is NOT here, and the first draft of this table had it. `buildWithin`
         > exists, which is what made it look constructible."*

       Measured when `M219` was scoped: this set held **three** of the language's twenty-two
       browser kinds, and the other nineteen drew as a plain code line with `data-stmt-editable=
       "no"`, **no disabled control and no reason of any kind** — 650 statements, 27% of all
       browser steps in the two corpora. That is not a table being honest about a limit, it is the
       pane `D1082` refuses: half live and silent about which half. **Five of the nineteen already
       had builders** (`buildSelect`, `buildCheck`, `buildPress`, `buildWithin`), written and
       tested and reachable from nothing, which is the `M205`/`M209` shape a fourth time.

       The sharpest form of it: on the API door a `within` row carries a badge reading *"this is
       BROWSER's to edit — open that door"*, and the BROWSER door could not edit a `within` either.

       So the list is the language's, not a selection from it. `STEP_LENS` is the authority on
       which kinds those are, and `outline.ts` reads the same table — a second list here of
       *which kinds are browser's* would be the copy this file's own header refuses. */
    constructs: new Set<Step['type']>([
      ...NEUTRAL_CONSTRUCTS,
      ...(Object.keys(STEP_LENS) as Step['type'][]).filter((k) => STEP_LENS[k] === 'browser'),
    ]),
    adds: [
      { key: 'open', label: '+ open', title: '`open "/path"` — the page this test works against, resolved against the env’s `web` base' },
      { key: 'click', label: '+ click', title: '`click button "…"` — a gesture against an element on the open page' },
      { key: 'fill', label: '+ fill', title: '`fill field "…" with "…"` — type into an element on the open page' },
      { key: 'let', label: '+ let', title: '`let name = value` — a binding the steps below can interpolate' },
      /* **The tail, behind one press** — `M219` `E` (`D1164`). `click` (874), `fill` (493) and
         `open` (378) are 73% of the corpus's 2395 browser statements; the other eighteen kinds are
         217 occurrences between them. The column is 300 px and four `+` buttons already wrap to
         two rows in it, so the choice was never *all of them or some of them* — it was *two rows
         or six*. */
      { key: 'step', label: '+ step…', title: 'the rest of the browser vocabulary — select, press, tick, dialogs, tabs, stubs, waits' },
      /* **`record` is a `+` gesture and not a mode** (`M213` `S5`, `D1095`). It writes statements
         into the body it is pressed on, the same as the three above it — what is different is only
         that a browser supplies them instead of a default. A recorder that opened its own surface
         would be the staging form again, wearing a camera. */
      { key: 'record', label: '+ record', title: 'open the page and use it — every action becomes a step in this test. Expectations are yours to add afterwards' },
    ],
    sends: false,
    plays: true,
    dropsSubjects: new Set(),
    /* **`open` alone, and the absence of an assertion is `D1192` rather than an omission.** The
       API scaffold's `expect status equals 200` costs the author nothing because every response
       has a status and 200 is what a working one returns. A page's assertion has no universal:
       what is on the page is precisely what the author has not seen yet, and the language has no
       url or title matcher to fall back on — `PageSubject` carries only `hasNoA11yViolations`.
       Measured over what `discoverTests` can see, 58.3% of the corpora's `open`s and 66.7% of
       the ones that lead a test are followed by a *gesture*, not an assertion. A scaffold that
       guessed one would be `D1087`'s receipt again: the legacy form offering *"the orders
       endpoint answers"* for whatever file happened to be open. */
    scaffold: 'open',
  },
  /**
   * LOAD and SCAN keep their own forms this round (`D1103` rebuilds LOAD's in `S6`), so their
   * entries say what is true today rather than what a future slice will make true: they construct
   * nothing from Compose beyond the neutral vocabulary, and offer no `+` gestures there. **A table entry that lied here would be worse than no entry**, because the
   * pane reads it to decide what to draw as editable.
   */
  /* `scaffold: 'api'` on both — see `Scaffold`'s docblock. It is what they wrote before this
     round, and `D1190`'s `null` is refuted there rather than quietly dropped. */
  load: { constructs: new Set(NEUTRAL_CONSTRUCTS), adds: [], sends: false, plays: false, dropsSubjects: new Set(), scaffold: 'api' },
  scan: { constructs: new Set(NEUTRAL_CONSTRUCTS), adds: [], sends: false, plays: false, dropsSubjects: new Set(), scaffold: 'api' },
};
