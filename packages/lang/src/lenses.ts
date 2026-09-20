// Which lenses a test appears in — `D1043`, `M200` `A0-3`. PLAN_M200_UI_AUTHORING.md.
//
// A MODE IS DERIVED, NEVER DECLARED. The page's four doors — API, BROWSER, LOAD, SCANS — are
// kinds of *work*, and a test belongs to every lens whose constructs it actually carries. Nothing
// labels a test; nothing may. `@load` and `@security` are ordinary user tags with no runtime
// meaning at all, sitting beside `@orders` and `@flaky` in the same corpus, and the fixture files
// settle why the alternative fails: `load.tflw`'s tests *are* functional tests with a workload
// line wrapped round them, and `security.tflw`'s third test is an `api POST /login` with one
// severity gate. A mode meaning *a kind of test* would leave those with no home.
//
// WHY THIS LIVES IN THE LANGUAGE PACKAGE. It is a pure function of the AST, and **both** the
// server and the page must compute it identically — the server to index a project, the page to
// re-derive a test's lenses the moment a form edits it, with no round trip. `@tflw/lang` has no
// dependencies and no Node builtins, so it is the one place both can import. Two implementations
// of one rule is the shape `M169d5` is filed under, where a parity check agreed with itself while
// 43 wrong sites published.
//
// ITS EXHAUSTIVENESS IS THE TYPE'S, NOT A GREP'S. The tables below are `Record<Step['type'], …>`
// and `Record<Subject['type'], …>`, so a node kind added to either union and not filed here is a
// **compile error**, not a test that might notice. That matters more than usual: an unclassified
// step does not crash, it silently belongs to no lens, and a test can then be missing from every
// door in the product with nothing red anywhere.
import type { CrawlDecl, MatcherName, Step, Subject, TestDecl } from './ast.js';

/** The four doors (`D1042`), as the language sees them: families of construct, not kinds of test. */
export type Lens = 'api' | 'browser' | 'load' | 'scan';

export const LENSES: readonly Lens[] = ['api', 'browser', 'load', 'scan'];

/**
 * Which lens a step is evidence of, or `null` for one that is evidence of none.
 *
 * `null` is a real answer and not a gap. `let`, `capture`, `log`, `give`, `call` and `pause` are
 * carried by tests of every kind, so counting them toward a lens would put every test in every
 * door. `expect` is `null` here and classified through its subject and matcher instead, which is
 * where its evidence actually is. `MalformedStep` is the parser's recovery node: it is the absence
 * of a construct, so it can be evidence of nothing by definition.
 */
/**
 * The lenses a **statement** can carry, which is not every lens (`M207-01`, `M207` `S3`).
 *
 * `load` is absent, and its absence is the point rather than an omission. No step, subject or
 * matcher maps to it — `STEP_LENS`, `SUBJECT_LENS` and `MATCHER_LENS` contain no entry that yields
 * `load`, and they cannot, because the LOAD lens is not carried by statements at all: it comes from
 * `test.workload !== null` or `test.thresholds.length > 0`, both of which are properties of the
 * test and neither of which is in its body.
 *
 * So `stepLensCounts(...).load` was **structurally incapable of being non-zero**. It shipped on the
 * wire in `M206` `S4` and nothing read it, so nothing was wrong — but a LOAD panel built by copying
 * that slice's pattern would have said *"0 statements do load work"* on a workload test, which is
 * the wrong-number class `S4` corrected mid-slice arriving one door later. A field that can only
 * ever be wrong is removed rather than fixed, and it is removed **here**, in the type, so that a
 * future reader cannot reintroduce it by writing `counts.load` and having it compile.
 */
export type StepLens = Exclude<Lens, 'load'>;

export const STEP_LENS: Readonly<Record<Step['type'], StepLens | null>> = {
  // The request itself, and the two header-shaped declarations that only exist to modify one.
  ApiStep: 'api',
  WaitUntilApiStmt: 'api',
  HeaderStmt: 'api',
  CsrfStmt: 'api',
  // Everything that drives a browser.
  OpenStmt: 'browser',
  ClickStmt: 'browser',
  FillStmt: 'browser',
  FillFormStmt: 'browser',
  SelectStmt: 'browser',
  TickStmt: 'browser',
  UntickStmt: 'browser',
  PressStmt: 'browser',
  HoverStmt: 'browser',
  ScrollStmt: 'browser',
  WithinBlock: 'browser',
  AcceptDialogStmt: 'browser',
  DismissDialogStmt: 'browser',
  SwitchToNewTabBlock: 'browser',
  SwitchToTabStmt: 'browser',
  CloseTabStmt: 'browser',
  DownloadBlock: 'browser',
  DragStmt: 'browser',
  DropFileStmt: 'browser',
  ScreenshotStmt: 'browser',
  StubStmt: 'browser',
  WaitUntilUiStmt: 'browser',
  // Evidence of nothing — see the note above.
  ExpectStmt: null,
  LetStmt: null,
  CaptureStmt: null,
  LogStmt: null,
  GiveStmt: null,
  CallStmt: null,
  PauseStmt: null,
  MalformedStep: null,
};

/**
 * Which lens an `expect`'s subject is evidence of.
 *
 * The response-reading subjects are `api`: `expect status equals 200` is an assertion about a
 * request somebody made, and a file of them with no `api` step is not a thing that can run. The
 * two dialog subjects are `browser` because a native modal only exists in a page. `ValueSubject`
 * reads back a `let` or a `capture`, which either kind of test can produce, so it is evidence of
 * neither.
 */
export const SUBJECT_LENS: Readonly<Record<Subject['type'], StepLens | null>> = {
  StatusSubject: 'api',
  DurationSubject: 'api',
  HeaderSubject: 'api',
  BodySubject: 'api',
  BodyTextSubject: 'api',
  BodyBytesSubject: 'api',
  BodyCsvSubject: 'api',
  BodyPdfTextSubject: 'api',
  RequestSubject: 'api',
  NetworkRequestSubject: 'browser',
  ResponseSubject: 'api',
  LocatorSubject: 'browser',
  PageSubject: 'browser',
  DialogMessageSubject: 'browser',
  DialogTypeSubject: 'browser',
  ValueSubject: null,
};

/**
 * The matchers that are evidence on their own, whatever they stand against.
 *
 * The three scan families are what makes a test a security test (`D1043`) — a severity gate is
 * the construct, not the `@security` tag beside it. **Accessibility is deliberately not among
 * them**: `expect page has no [critical] a11y violations` takes the `page` subject and a crawl
 * body cannot hold it, so it is a browser assertion and a11y is not a fifth door. Resolved by
 * measurement during the grilling and recorded in §1 rather than argued.
 */
export const MATCHER_LENS: Partial<Readonly<Record<MatcherName, StepLens>>> = {
  hasNoSecurityViolations: 'scan',
  hasNoAuthzViolations: 'scan',
  hasNoInputHandlingViolations: 'scan',
  hasNoA11yViolations: 'browser',
};

/** Every lens the test carries evidence of, in `LENSES` order. Empty is possible and honest: a
 *  test of nothing but `let` and `log` is in no door until it does something. */
export function lensesOfTest(test: TestDecl): readonly Lens[] {
  const found = new Set<Lens>();
  // The workload line is the whole of what makes a test workload-bearing (`D99`/`D19`,
  // `interpreter.ts`) — never the `@load` tag, which the runtime has never read.
  if (test.workload !== null) found.add('load');
  // A threshold is the other half of the same evidence, and it can be the only half: `D1044`
  // means the LOAD lens may add one to a test whose workload line is not written yet.
  if (test.thresholds.length > 0) found.add('load');
  for (const step of test.body) collectStep(step, found);
  return LENSES.filter((l) => found.has(l));
}

/** A `crawl` is the SCANS door's own declaration and is never anything else: its body issues
 *  requests nobody wrote, and an `api` step inside one is `TF070`. */
export function lensesOfCrawl(_crawl: CrawlDecl): readonly Lens[] {
  return ['scan'];
}

/**
 * Every step in a body, the nested ones included — **one walk, however many readers**.
 *
 * `M206` `S4` lifted this out of `collectStep`, which had been the only thing that knew a `within`
 * full of clicks is still browser evidence however deep it sits. The Auth tab needs to *count* what
 * the doors only need to *detect*, and a second traversal beside this one is the drift class this
 * repository files findings about: the day a block type is added, one of the two would learn about
 * it. The block list lives here and nowhere else.
 */
function eachStep(step: Step, visit: (step: Step) => void): void {
  visit(step);
  if (step.type === 'WithinBlock' || step.type === 'SwitchToNewTabBlock' || step.type === 'DownloadBlock') {
    for (const inner of step.body) eachStep(inner, visit);
    return;
  }
  if (step.type === 'WaitUntilApiStmt') {
    for (const inner of step.expects) eachStep(inner, visit);
  }
}

/**
 * **Does this body put a page on screen, and what does it call to find out** — `M219` `B` (`D1161`).
 *
 * A browser test's group is the **session**, and a session starts at an `open` — except that 17 of
 * the corpus's 258 browser tests have no `open` at all and reach their page through a `call`
 * instead (`action login(email, password)`'s own first statement is `open "/login"`). So the
 * question a fold has to answer about a `call` is *does this action open a page*, and the only
 * honest answer comes from the action's body.
 *
 * **Measured, the cheap heuristic is right and unsound.** Treating every `call` as a session start
 * is correct in all 167 calls inside browser-bearing tests — and it is correct by luck: **18 of the
 * corpus's 22 declared actions are api-only**, they simply are never called from a browser test.
 * One seeding helper called from a browser test breaks it, silently, by opening a session group
 * around statements that never met a page.
 *
 * This returns the two halves and folds nothing, because the fold is transitive across a whole
 * project — `readProject` runs it to a fixpoint over every action it indexed, where every other
 * index fact is computed. The walk is `eachStep`'s, so an `open` inside a `within` counts, which
 * is the same reason `lensesOfTest` shares it.
 */
export function pageOpening(body: readonly Step[]): { readonly opens: boolean; readonly calls: readonly string[] } {
  let opens = false;
  const calls: string[] = [];
  for (const step of body) {
    eachStep(step, (s) => {
      if (s.type === 'OpenStmt') opens = true;
      if (s.type === 'CallStmt') calls.push(s.call.name);
    });
  }
  return { opens, calls };
}

function collectStep(step: Step, found: Set<Lens>): void {
  eachStep(step, (s) => {
    const lens = STEP_LENS[s.type];
    if (lens) found.add(lens);
    if (s.type === 'ExpectStmt') {
      const subject = SUBJECT_LENS[s.subject.type];
      if (subject) found.add(subject);
      const matcher = MATCHER_LENS[s.matcher.name];
      if (matcher) found.add(matcher);
    }
  });
}

/**
 * How many statements of a test's body do each kind of work — `M206` `S4`, and the Auth tab is its
 * only reader.
 *
 * **It classifies a statement exactly as `lensesOfTest` does** — the step's own kind, plus an
 * `expect`'s subject and matcher — because a second, subtly narrower classification beside that one
 * is the drift this module exists to prevent. The first draft here counted a step's own kind alone,
 * on the argument that *a session's headers fold into requests, not into assertions about them*.
 * True, and it produced a number no reader would accept: `expect text "Signed in" is visible` is
 * page work by any account, and an `ExpectStmt`'s own lens is `null`, so a login flow read as three
 * page statements instead of four. The row labels carry that nuance instead — see `AuthPanel`.
 *
 * A statement is counted **once per lens it hits**, never twice for the same one, so
 * `expect response has no serious security violations` adds one to `api` and one to `scan`: it is
 * genuinely both, and that is the same answer the doors give about the test that contains it.
 *
 * `header` and `csrf` count as api deliberately: they exist only to modify a request, and for an
 * **auth** panel a `header` line is exactly where a credential gets written by hand.
 */
export function stepLensCounts(test: TestDecl): Readonly<Record<StepLens, number>> {
  const counts: Record<StepLens, number> = { api: 0, browser: 0, scan: 0 };
  for (const step of test.body) {
    eachStep(step, (s) => {
      // `StepLens`, not `Lens`: the three maps below cannot yield `load` and the set is not
      // allowed to pretend they might. Written this way so the narrowing is a compile error at the
      // point a fourth map is added, rather than a silently-zero bucket downstream.
      const hit = new Set<StepLens>();
      const own = STEP_LENS[s.type];
      if (own) hit.add(own);
      if (s.type === 'ExpectStmt') {
        const subject = SUBJECT_LENS[s.subject.type];
        if (subject) hit.add(subject);
        const matcher = MATCHER_LENS[s.matcher.name];
        if (matcher) hit.add(matcher);
      }
      for (const l of hit) counts[l] += 1;
    });
  }
  return counts;
}
