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

import type { Lens, Step } from '@tflw/lang';

/** One `+` gesture a door offers at the foot of a declaration's body. */
export interface AddGesture {
  /** The `data-seq-add-*` suffix, and the key a gate names it by. */
  readonly key: string;
  readonly label: string;
  readonly title: string;
}

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
    /* `an element` and `page` are things a browser has. An `api` request fetches bytes. */
    dropsSubjects: new Set(['locator', 'page']),
  },
  browser: {
    /* **`WithinBlock` is NOT here, and the first draft of this table had it.** `buildWithin`
       exists, which is what made it look constructible — but nothing in this pane offers a gesture
       that produces one and no row edits one, so listing it would make the table claim a
       capability the controls do not have. That is the exact failure this file exists to remove.
       A scoped block is `§6`-owed; `BrowserForm`'s scope checkbox is not carried forward, because
       its `within` wrapped *the form's own rows* and there are no such rows any more. */
    constructs: new Set<Step['type']>([...NEUTRAL_CONSTRUCTS, 'OpenStmt', 'ClickStmt', 'FillStmt']),
    adds: [
      { key: 'open', label: '+ open', title: '`open "/path"` — the page this test works against, resolved against the env’s `web` base' },
      { key: 'click', label: '+ click', title: '`click button "…"` — a gesture against an element on the open page' },
      { key: 'fill', label: '+ fill', title: '`fill field "…" with "…"` — type into an element on the open page' },
      { key: 'let', label: '+ let', title: '`let name = value` — a binding the steps below can interpolate' },
      /* **`record` is a `+` gesture and not a mode** (`M213` `S5`, `D1095`). It writes statements
         into the body it is pressed on, the same as the three above it — what is different is only
         that a browser supplies them instead of a default. A recorder that opened its own surface
         would be the staging form again, wearing a camera. */
      { key: 'record', label: '+ record', title: 'open the page and use it — every action becomes a step in this test. Expectations are yours to add afterwards' },
    ],
    sends: false,
    dropsSubjects: new Set(),
  },
  /**
   * LOAD and SCAN keep their own forms this round (`D1103` rebuilds LOAD's in `S6`), so their
   * entries say what is true today rather than what a future slice will make true: they construct
   * nothing from Compose beyond the neutral vocabulary, and offer no `+` gestures there. **A table entry that lied here would be worse than no entry**, because the
   * pane reads it to decide what to draw as editable.
   */
  load: { constructs: new Set(NEUTRAL_CONSTRUCTS), adds: [], sends: false, dropsSubjects: new Set() },
  scan: { constructs: new Set(NEUTRAL_CONSTRUCTS), adds: [], sends: false, dropsSubjects: new Set() },
};
