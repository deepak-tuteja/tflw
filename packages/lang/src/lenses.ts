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
export const STEP_LENS: Readonly<Record<Step['type'], Lens | null>> = {
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
export const SUBJECT_LENS: Readonly<Record<Subject['type'], Lens | null>> = {
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
export const MATCHER_LENS: Partial<Readonly<Record<MatcherName, Lens>>> = {
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

function collectStep(step: Step, found: Set<Lens>): void {
  const lens = STEP_LENS[step.type];
  if (lens) found.add(lens);
  if (step.type === 'ExpectStmt') {
    const subject = SUBJECT_LENS[step.subject.type];
    if (subject) found.add(subject);
    const matcher = MATCHER_LENS[step.matcher.name];
    if (matcher) found.add(matcher);
    return;
  }
  // The two block steps carry their own bodies, and a `within` full of clicks is still browser
  // evidence however it is nested.
  if (step.type === 'WithinBlock' || step.type === 'SwitchToNewTabBlock' || step.type === 'DownloadBlock') {
    for (const inner of step.body) collectStep(inner, found);
    return;
  }
  if (step.type === 'WaitUntilApiStmt') {
    for (const inner of step.expects) collectStep(inner, found);
  }
}
