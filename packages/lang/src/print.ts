// The printer — AST → `.tflw` source. `M200` `A0-1` (`D1046`, `D1048`),
// PLAN_M200_UI_AUTHORING.md.
//
// THIS IS THE DIRECTION THIS PROJECT HAS NEVER HAD. `parse` turns text into a tree; `format`
// reshapes the whitespace between a tree's *tokens*, so it can only ever rewrite text a person
// already typed; `applyMigrations`/`refactor apply` cut a span out of existing text and paste a
// new span in. Every `.tflw` byte this repository has ever produced from structure alone is a
// string constant in `tflw init`. A form in the UI has values and no text, so it needs this.
//
// IT PRINTS A NODE, NEVER A FILE (`D1046`). The write path stays a span splice — print the one
// node being inserted, splice its text into the source that already exists, run `format()` over
// the result. That is why there is no `printProgram` here and will not be one before `A4`: a
// whole-file printer has to know all 115 node kinds the corpus uses, and `A0` knows sixteen.
//
// IT REFUSES WHAT IT DOES NOT KNOW, LOUDLY. `ok: false` with the node type named. An
// approximation would be the worst possible failure here: a printer that silently drops a field
// emits source that still parses, still runs, still passes, and quietly tests something the
// author did not ask for. Refusing is the only safe default, so the support table below is
// exhaustive and everything absent from it is an error.
//
// ITS GATE IS PER NODE, OVER THE REAL CORPUS (`D1046` as amended 2026-09-15). For every node of
// a supported kind in all 652 `.tflw` files: print it, wrap it in its minimal enclosing context,
// re-parse, compare the trees with spans stripped. See `test/print.test.ts`. The gate reports
// how many nodes it checked, by kind, because the whole-file form of this property would have
// examined **zero of 652 files** during `A0` and reported success for doing it.
import { INDENT } from './format.js';
import type {
  CrawlDecl,
  CrawlSeed,
  ApiBody,
  ApiHeader,
  ApiRequestSpec,
  ApiStep,
  ArrayLit,
  BinaryExpr,
  CallExpr,
  CallStmt,
  CaptureStmt,
  DataTable,
  ClickStmt,
  ExpectStmt,
  FillStmt,
  Locator,
  OpenStmt,
  WithinBlock,
  FormField,
  LetStmt,
  LogStmt,
  Matcher,
  Node,
  ObjectLit,
  PathSegment,
  PauseStmt,
  Program,
  Step,
  MalformedStep,
  ActionDecl,
  AcceptDialogStmt,
  DownloadBlock,
  DragStmt,
  DropFileStmt,
  HoverStmt,
  NetworkRequestRef,
  PressStmt,
  ScreenshotStmt,
  ScrollStmt,
  StubStmt,
  SwitchToNewTabBlock,
  SwitchToTabStmt,
  WaitUntilUiStmt,
  FillFormStmt,
  SelectStmt,
  TickStmt,
  UntickStmt,
  GiveStmt,
  HookDecl,
  ImportDecl,
  UseDecl,
  Stage,
  StringLit,
  Subject,
  TestDecl,
  ThresholdDecl,
  Value,
  WaitUntilApiStmt,
  Workload,
} from './ast.js';

export interface PrintResult {
  /** The printed source, with no trailing newline. Empty when `ok` is false. */
  readonly text: string;
  readonly ok: boolean;
  /** Which node kind stopped it — always names the type, so a refusal is actionable. */
  readonly reason?: string;
}

/**
 * Node kinds this printer can emit, as of `A0`. `A1`–`A3` each add their modes' kinds and `A4`
 * closes the set at all 115 the corpus uses (`D1048`). Exported because the gate's coverage
 * count is computed from it — a gate that does not know what it is supposed to cover cannot
 * report having covered nothing.
 */
export const PRINTABLE = new Set<string>([
  'TestDecl',
  'ApiStep',
  'ApiHeader',
  'ExpectStmt',
  'Matcher',
  'StatusSubject',
  'PathExpr',
  'ThresholdDecl',
  'PauseStmt',
  'RampUsersWorkload',
  'RampRpsWorkload',
  'HoldUsersWorkload',
  'HoldRpsWorkload',
  'StepUsersWorkload',
  'StepRpsWorkload',
  'SpikeUsersWorkload',
  'SpikeRpsWorkload',
  'SharedIterationsWorkload',
  'PerVuIterationsWorkload',
  'StringLit',
  'NumberLit',
  'DurationLit',
  'BoolLit',
  'NullLit',
  // `A1-1` — the whole value grammar. Five positions read this one union (a request body, a
  // `let`, a header value, a matcher operand, a call argument), which is why it is a slice of its
  // own rather than a corner of each: `InlineBody` is one node kind and what lives under it is
  // thirty-one.
  'LetStmt',
  // `A1-2` — the request. The five body forms, the per-step retry clause, the polling form of an
  // api step, and `with each`.
  'InlineBody',
  'FileBody',
  'FormBody',
  'TextBody',
  'UploadBody',
  'WaitUntilApiStmt',
  'InlineDataTable',
  'FileDataTable',
  // `A2-2` — the crawl. A SECOND printable root: everything above is a step or a declaration
  // reached through `test`, and this is the first node that is neither.
  'CrawlDecl',
  'OpenApiSeed',
  'TrafficSeed',
  'SpiderSeed',
  // `A3-1` — the locator, and it is the keystone of the BROWSER round rather than a corner of it:
  // 2,296 occurrences across 235 of the corpus's 244 browser tests, and it **completes none of
  // them on its own** (`§4f`). That is the reason it is a slice — a kind that unblocks nothing
  // measurable is exactly the kind a round defers behind something that looks more productive,
  // and then everything else waits on it.
  'Locator',
  // `A3-2` — the three statements every browser test is made of: 766 clicks, 433 fills, 270
  // opens. Each is a locator (or a path) and nothing else, which is why they arrive together;
  // what they buy on their own is still small, because `within` holds 150 tests shut (`§4f`).
  'OpenStmt',
  'ClickStmt',
  'FillStmt',
  // `A3-3` — the assertion half. `PageSubject` is 17 occurrences and unblocks the **16 a11y
  // matchers** that have printed since `A2-1` and been unreachable because their only subject
  // would not (`§6o`).
  'LocatorSubject',
  'PageSubject',
  // `A3-4` — the capstone. 403 blocks sit across 150 tests and every statement inside one is
  // unreachable until the block itself prints, which is why this single kind takes BROWSER from
  // 32 round-tripping tests to 164 (`§4f`).
  'WithinBlock',
  // `A4-1` — the root, and the one kind no door could ever have asked for: every door prints a
  // *fragment*, so the node that holds fragments appeared on no worklist until the whole-file
  // property needed it. It is worth 133 of the corpus's 260 clean files on its own (`§4h`).
  'Program',
  // `A4-2` — the file header, and the reason it is one slice: these are what a file has ABOVE its
  // tests, and **no door writes any of them** (`§4h`). Every door inserts into a file that already
  // has a header, which is why `§4g`'s forecast — measured from BROWSER's refusals — named none of
  // them while they carry 100 of the whole-file gate's remaining 129 files.
  'ImportDecl',
  'UseDecl',
  'HookDecl',
  'ActionDecl',
  'GiveStmt',
  // `A4-3` — the form family, and the largest browser remnant. `FillFormStmt` is the only browser
  // statement in the language that is a BLOCK of rows rather than a line, which is why it sat at
  // the head of `§4g`'s tail and why it arrives with the three line-shaped kinds that finish a
  // form: choose an option, tick a box, untick it.
  // `FillFormRow` is NOT here — it is `CONTEXT_BOUND`, the fifth member, because `| "Email" | "x" |`
  // is not a step and there is no source a printed row could be re-parsed from. The two sets are
  // disjoint by convention: this one means *printable on its own*.
  'FillFormStmt',
  'SelectStmt',
  'TickStmt',
  'UntickStmt',
  // `A4-4` — the tail proper: twelve kinds, 19 files, nothing above 8 occurrences. Every spelling
  // here was lifted from the corpus at the node's own span rather than read off a docblock
  // (`.m200-scratch/probe-tail.mjs`), because `A4-1` and `A4-2` each paid for the other way.
  'ScreenshotStmt',
  'WaitUntilUiStmt',
  'StubStmt',
  'DropFileStmt',
  'HoverStmt',
  'DragStmt',
  'ScrollStmt',
  'PressStmt',
  'AcceptDialogStmt',
  'DismissDialogStmt',
  'DialogTypeSubject',
  'DialogMessageSubject',
  'NetworkRequestRef',
  'NetworkRequestSubject',
  'SwitchToTabStmt',
  'SwitchToNewTabBlock',
  'CloseTabStmt',
  'DownloadBlock',
  // `A1-3` — the assertion. The response subjects, the value matchers, `any`/`all`, and the three
  // statements that read or announce a response.
  'DurationSubject',
  'HeaderSubject',
  'BodySubject',
  'BodyTextSubject',
  'BodyBytesSubject',
  'BodyCsvSubject',
  'BodyPdfTextSubject',
  'RequestSubject',
  'ValueSubject',
  'ResponseSubject',
  'CaptureStmt',
  'CallStmt',
  'LogStmt',
  'VarRef',
  'Interp',
  'EnvRef',
  'ObjectLit',
  'ArrayLit',
  'BinaryExpr',
  'DateAtom',
  'DateOffsetLit',
  'FormatExpr',
  'TransformExpr',
  'CallExpr',
  'UniquePrefixExpr',
  'UniqueEmailExpr',
  'UniqueNumberExpr',
  'UniqueLikeExpr',
  'UniqueUuidExpr',
  'RandomNumberExpr',
  'RandomDecimalExpr',
  'RandomDateInPastExpr',
  'RandomDateInFutureExpr',
  'RandomDateBetweenExpr',
  'RandomOfExpr',
  'RandomStringExpr',
  'RandomLikeExpr',
  'RandomUuidExpr',
  'RandomPasswordExpr',
]);

/**
 * Kinds this printer can emit, but only through their parent — never on their own.
 *
 * `Stage` is the first and was found by the gate's first run (`M200` `A0-1`). It stores `mode:
 * 'jump' | 'ramp'` and not the keyword that spelled it, and `step` and `spike` spell the same two
 * shapes differently by deliberate design (`M84`, `C11`/`A2-10`, `parser.ts:1310`–`1391`): a jump
 * is `to N for <dur>` inside `step` and `hold N for <dur>` inside `spike`, and a `step` block
 * cannot express a ramp at all. So the node does not carry enough to print itself, and printing it
 * without asking its parent produces source that parses — into a different program.
 *
 * `Field` is the second and arrived with `A1-1`, for the ordinary reason rather than the
 * interesting one: `name: 1` is not a program, so there is no source a printed field could be
 * re-parsed from. It is printed by `printObject` and compared through its parent. `FormField` and
 * `RetryAfterClause` joined it in `A1-2` on the same ordinary grounds. `FillFormRow` joined
 * them in `A4-3`, likewise: `| "Email" | "x" |` is a row of a block, not a step.
 *
 * Expect more of these as `A1`–`A4` widen the printer. The shape to watch for is a node whose
 * field was normalised on the way in, because a normalisation is a spelling decision the AST
 * stopped recording.
 */
export const CONTEXT_BOUND = new Set<string>(['Stage', 'Field', 'FormField', 'RetryAfterClause', 'FillFormRow']);

/**
 * The kinds that refuse **by construction**, and will not gain a printer in any round (`A4-5`).
 *
 * `MalformedStep` is the whole set and is likely to stay it. It is what the parser leaves behind
 * where a step could not be read — `head` is the keyword it began with, and there is no second
 * field — so printing one would mean inventing the rest of a line the author never finished. It is
 * not part of `A4`'s tail and never was (`§4f`): it occurs 24 times across 20 files and **0 of
 * them reach either gate**, because a `MalformedStep` exists only where the parser has already
 * raised an error diagnostic and both gates skip such a file before they look at a node.
 *
 * It is declared rather than left to the `default` branch for the same reason `CONTEXT_BOUND` is:
 * a census that reads as a worklist needs its remainder to be **known-empty**. With these three
 * sets, every node kind the corpus contains is accounted for by name — which is what turns
 * `D1048`'s ratchet into a statement about the language rather than a running total.
 */
export const REFUSES_BY_CONSTRUCTION = new Set<string>(['MalformedStep']);

class Refusal extends Error {
  constructor(readonly nodeType: string, readonly detail?: string) {
    super(detail ? `no printer for ${nodeType}: ${detail}` : `no printer for ${nodeType}`);
  }
}

// A function declaration, not a `const` arrow: TypeScript's control-flow analysis only lets a
// never-returning call narrow at the call site when the callee is declared this way.
function refuse(type: string, detail?: string): never {
  throw new Refusal(type, detail);
}

/**
 * Print one AST node as tflw source. `indent` is the block level the node's first line sits at;
 * nested lines are emitted relative to it, so a caller splicing into an existing file passes the
 * level of the line it is replacing and needs to know nothing else about the printer.
 */
export function print(node: Node, options: { readonly indent?: number } = {}): PrintResult {
  const level = options.indent ?? 0;
  try {
    return { text: printNode(node, level), ok: true };
  } catch (e) {
    if (e instanceof Refusal) return { text: '', ok: false, reason: e.message };
    throw e;
  }
}

function printNode(node: Node, level: number): string {
  switch (node.type) {
    case 'Program':
      return printProgram(node as Program, level);
    case 'ImportDecl':
      return pad(level) + 'import ' + printString((node as ImportDecl).path);
    case 'UseDecl':
      return pad(level) + 'use ' + printString((node as UseDecl).path);
    case 'HookDecl':
      return printHook(node as HookDecl, level);
    case 'ActionDecl':
      return printAction(node as ActionDecl, level);
    case 'GiveStmt':
      return pad(level) + 'give ' + printValue((node as GiveStmt).value);
    case 'TestDecl':
      return printTest(node as TestDecl, level);
    case 'CrawlDecl':
      return printCrawl(node as CrawlDecl, level);
    case 'OpenApiSeed':
    case 'TrafficSeed':
    case 'SpiderSeed':
      return printSeed(node as CrawlSeed, level);
    case 'ApiStep':
      return printApiStep(node as ApiStep, level);
    case 'ExpectStmt':
      return printExpect(node as ExpectStmt, level);
    case 'ThresholdDecl':
      return pad(level) + printThreshold(node as ThresholdDecl);
    case 'PauseStmt':
      return pad(level) + printPause(node as PauseStmt);
    case 'LetStmt':
      return pad(level) + printLet(node as LetStmt);
    case 'WaitUntilApiStmt':
      return printWaitUntilApi(node as WaitUntilApiStmt, level);
    case 'CaptureStmt':
      return pad(level) + printCapture(node as CaptureStmt);
    case 'CallStmt':
      return pad(level) + printCallStmt(node as CallStmt);
    case 'LogStmt':
      return pad(level) + printLog(node as LogStmt);
    case 'Locator':
      return pad(level) + printLocator(node as Locator);
    case 'FillFormStmt':
      return printFillForm(node as FillFormStmt, level);
    case 'ScreenshotStmt':
      return pad(level) + 'screenshot ' + printString((node as ScreenshotStmt).name);
    case 'HoverStmt':
      return pad(level) + 'hover ' + printLocator((node as HoverStmt).locator);
    case 'ScrollStmt':
      return pad(level) + 'scroll to ' + printLocator((node as ScrollStmt).locator);
    case 'DragStmt': {
      const d = node as DragStmt;
      return pad(level) + `drag ${printLocator(d.from)} to ${printLocator(d.to)}`;
    }
    case 'DropFileStmt': {
      const d = node as DropFileStmt;
      return pad(level) + `drop file ${printString(d.filePath)} onto ${printLocator(d.locator)}`;
    }
    case 'PressStmt': {
      const pr = node as PressStmt;
      return pad(level) + 'press ' + printString(pr.keys) + (pr.locator ? ' on ' + printLocator(pr.locator) : '');
    }
    case 'AcceptDialogStmt': {
      const a = node as AcceptDialogStmt;
      // `with` is the language's argument-carrying preposition, and it is `accept`-only: there is
      // nothing to answer a dialog *with* while dismissing it (`D800`).
      return pad(level) + 'accept dialog' + (a.text ? ' with ' + printValue(a.text) : '');
    }
    case 'DismissDialogStmt':
      return pad(level) + 'dismiss dialog';
    case 'CloseTabStmt':
      return pad(level) + 'close tab';
    case 'SwitchToTabStmt':
      return pad(level) + 'switch to tab ' + num((node as SwitchToTabStmt).index);
    case 'SwitchToNewTabBlock':
      return printStepBlock('switch to new tab', (node as SwitchToNewTabBlock).body, 'SwitchToNewTabBlock', level);
    case 'DownloadBlock': {
      const d = node as DownloadBlock;
      if (!isBareIdent(d.name)) refuse('DownloadBlock', `\`${d.name}\` is not a name this language can bind`);
      return printStepBlock(`download as ${d.name}`, d.body, 'DownloadBlock', level);
    }
    case 'StubStmt':
      return printStub(node as StubStmt, level);
    case 'WaitUntilUiStmt':
      return printWaitUntilUi(node as WaitUntilUiStmt, level);
    case 'NetworkRequestRef':
      return pad(level) + printNetworkRef(node as NetworkRequestRef);
    case 'FillFormRow':
      // Printed by `printFillForm` and compared through it — `| "Email" | "x" |` is not a step, so
      // there is no source a printed row could be re-parsed from on its own (`CONTEXT_BOUND`).
      return refuse('FillFormRow', 'a form row is spelled by its `fill form` block, so it cannot be printed on its own');
    case 'SelectStmt': {
      const sel = node as SelectStmt;
      return pad(level) + `select ${printValue(sel.value)} from ${printLocator(sel.locator)}`;
    }
    case 'TickStmt':
      return pad(level) + 'tick ' + printLocator((node as TickStmt).locator);
    case 'UntickStmt':
      return pad(level) + 'untick ' + printLocator((node as UntickStmt).locator);
    case 'OpenStmt':
      return pad(level) + printOpen(node as OpenStmt);
    case 'ClickStmt':
      return pad(level) + printClick(node as ClickStmt);
    case 'FillStmt':
      return pad(level) + printFill(node as FillStmt);
    case 'WithinBlock':
      return printWithin(node as WithinBlock, level);
    case 'StatusSubject':
    case 'DurationSubject':
    case 'HeaderSubject':
    case 'BodySubject':
    case 'BodyTextSubject':
    case 'BodyBytesSubject':
    case 'BodyCsvSubject':
    case 'BodyPdfTextSubject':
    case 'RequestSubject':
    case 'ValueSubject':
    case 'ResponseSubject':
    case 'LocatorSubject':
    case 'PageSubject':
      return pad(level) + printSubject(node as Subject);
    case 'InlineBody':
    case 'FileBody':
    case 'FormBody':
    case 'TextBody':
    case 'UploadBody':
      return pad(level) + printBody(node as ApiBody);
    case 'InlineDataTable':
    case 'FileDataTable':
      return printTable(node as DataTable, level).join('\n');
    case 'Stage':
      return refuse('Stage', 'a stage is spelled by its block — `to N for <dur>` in a `step`, `hold N for <dur>` in a `spike` — so it cannot be printed on its own');
    case 'RampUsersWorkload':
    case 'RampRpsWorkload':
    case 'HoldUsersWorkload':
    case 'HoldRpsWorkload':
    case 'StepUsersWorkload':
    case 'StepRpsWorkload':
    case 'SpikeUsersWorkload':
    case 'SpikeRpsWorkload':
    case 'SharedIterationsWorkload':
    case 'PerVuIterationsWorkload':
      // Reachable on its own, not only through `TestDecl`: turning an existing functional test
      // into a workload-bearing one is the LOAD lens inserting exactly this one line (`D1044`).
      return printWorkload(node as Workload, level);
    case 'ApiHeader':
      return pad(level) + printHeader(node as ApiHeader);
    case 'Matcher':
      return pad(level) + printMatcher(node as Matcher);
    // **THE WHOLE VALUE GRAMMAR, NOT THE FIVE LITERALS** (`M210` `S3a`).
    //
    // `PRINTABLE` above lists thirty-one value kinds and says, in its own docblock, that
    // membership means *printable on its own*. This switch honoured five of them and sent the
    // other twenty-six to `default`, where they refused — so `print(objectLit)` answered `no
    // printer for ObjectLit` about a kind the exported set declares printable, and the module's
    // own `printObject` had been there the whole time.
    //
    // The gate could not see it, and the reason is worth keeping: `A1-1`'s value gate prints a
    // `let` line and then asserts each kind *occurs* somewhere under it. That is the right test
    // for the spelling and it says nothing at all about reachability, because every one of those
    // nodes is reached **through its parent**. `M201`'s lesson one round on — a property that
    // changes no verdict cannot be defended by a verdict — with the property here being the set's
    // own claim about itself.
    //
    // Found from the other end, by `M210` needing a matcher's operand as text for a form field:
    // **77 operands in the two corpora refuse** — 35 `ObjectLit`, 32 `Interp`, 7 `EnvRef`, 2
    // `TransformExpr`, 1 `DateOffsetLit` — every one of which the printer can already write.
    case 'StringLit':
    case 'NumberLit':
    case 'DurationLit':
    case 'BoolLit':
    case 'NullLit':
    case 'VarRef':
    case 'Interp':
    case 'EnvRef':
    case 'ObjectLit':
    case 'ArrayLit':
    case 'BinaryExpr':
    case 'DateAtom':
    case 'DateOffsetLit':
    case 'FormatExpr':
    case 'TransformExpr':
    case 'CallExpr':
    case 'UniquePrefixExpr':
    case 'UniqueEmailExpr':
    case 'UniqueNumberExpr':
    case 'UniqueLikeExpr':
    case 'UniqueUuidExpr':
    case 'RandomNumberExpr':
    case 'RandomDecimalExpr':
    case 'RandomDateInPastExpr':
    case 'RandomDateInFutureExpr':
    case 'RandomDateBetweenExpr':
    case 'RandomOfExpr':
    case 'RandomStringExpr':
    case 'RandomLikeExpr':
    case 'RandomUuidExpr':
    case 'RandomPasswordExpr':
      return pad(level) + printValue(node as Value);
    case 'MalformedStep':
      // `A4-5`. **Declared, not defaulted.** A `MalformedStep` is the parser's recovery node for a
      // step it could not read: it carries the keyword the step began with and nothing else, so
      // printing one would mean inventing the rest of a line the author never finished. It is the
      // one node kind in the language that must refuse forever, and saying so here — rather than
      // letting it fall through to the default — is what makes the gate's census read as a
      // worklist whose remainder is **known-empty** rather than as one with an unexplained entry.
      return refuse('MalformedStep', `\`${(node as MalformedStep).head} …\` is a step the parser could not read, so there is nothing to print`);
    default:
      return refuse(node.type);
  }
}

const pad = (level: number) => INDENT.repeat(level);

// ---- declarations ----------------------------------------------------------

/**
 * A whole file (`A4-1`).
 *
 * IT PRINTS IN THE FILE'S OWN ORDER, NOT IN THE AST'S ARRAY ORDER, and the reason is a
 * measurement. `Program` keeps `imports`/`uses`/`actions`/`hooks`/`tests`/`crawls` as six
 * separate arrays, so a printer that walked them in turn would emit one canonical order and lose
 * whatever interleaving the author wrote — a hook declared after the first test, a crawl among
 * the tests. That would have made file order the **sixth** member of the normalisation family
 * (`§6p`): a spelling the AST stopped recording.
 *
 * It does not have to be. Every node carries a span, and `build.ts` gives every node it makes the
 * same one (`SYNTHETIC`, `ORIGIN..ORIGIN`). So a **stable** sort on `span.start` is two rules in
 * one: a parsed program comes back in the order it was written, and a built program — whose spans
 * are all equal — is left exactly as the arrays had it, which is the only order it has. No flag,
 * no caller decision, and the two cases cannot drift apart.
 *
 * THE HAZARD IT LEAVES, named because nothing currently constructs it: a *mixed* program, built
 * nodes spliced into a parsed one, would sort every built node to the very top — ahead of the
 * imports — because `ORIGIN` precedes every real position. No path makes one today (`D1049`'s
 * write route splices **text** through `insertIntoSource` and never assembles a `Program`), and
 * the day one does, this is the line that has to learn about it.
 */
function printProgram(p: Program, level: number): string {
  const decls: ReadonlyArray<TestDecl | CrawlDecl | Node> = [
    ...p.imports, ...p.uses, ...p.actions, ...p.hooks, ...p.tests, ...(p.crawls ?? []),
  ];
  // By line alone, and deliberately with no column tiebreak: a declaration header must end its
  // line (`parseHookDecl`/`parseTest` all call `endLine()`), so two top-level declarations cannot
  // share one and a column term could never discriminate. It was written first and a mutation
  // survived it — an unreachable branch is not a defensive one, it is a line no gate can ever
  // hold to account.
  const ordered = [...decls].sort((a, b) => a.span.start.line - b.span.start.line);

  // One blank line between declarations, and consecutive ONE-LINE declarations grouped with none.
  // `format` preserves blank lines rather than imposing them (`format.ts:67`), so this is the
  // printer's own choice and neither gate in `print.test.ts` can see it — a tree comparison reads
  // two layouts as one program — which is why it has a test of its own, exactly as `printTest`'s
  // tags-on-one-line does.
  //
  // The grouping arrives with `A4-2` rather than `A4-1`, because until `import`/`use` had printers
  // the branch had no reachable input and its assertion could not have been written. Measured: of
  // the corpus's consecutive one-line declarations, **8 pairs are adjacent and 2 are separated**,
  // so grouping is the convention — and it is a convention rather than a fact, because the AST
  // records no blank line either way and there is nothing to preserve.
  const ONE_LINE = new Set<string>(['ImportDecl', 'UseDecl']);
  const out: string[] = [];
  let previous: string | null = null;
  for (const d of ordered) {
    if (previous !== null && !(ONE_LINE.has(d.type) && ONE_LINE.has(previous))) out.push('');
    out.push(printNode(d, level));
    previous = d.type;
  }
  return out.join('\n');
}

/**
 * `before` / `before file` / `after` / `after file` (`A4-2`).
 *
 * **`each` has no keyword, and that is not a normalisation** — it is the scope you get by writing
 * nothing. `HookDecl.scope` is `'file' | 'each'`, and `parseHookDecl` consumes an optional `file`
 * and defaults to `each`, so `before each` is not a second spelling of anything: it is `TF010`,
 * *unexpected `each` at end of declaration*. Measured directly, and the corpus agrees — 61
 * `before`, 15 `before file`, 4 `after`, 2 `after file`, and `before each` zero times.
 */
function printHook(h: HookDecl, level: number): string {
  // `TF015`/`EMPTY_BLOCK`, the rule `printCrawl` and `printWithin` already follow: never write a
  // line the parser will not read back.
  if (h.body.length === 0) {
    refuse('HookDecl', `a \`${h.when}\` with no steps does not parse — the block needs at least one`);
  }
  const lines = [pad(level) + h.when + (h.scope === 'file' ? ' file' : '')];
  for (const step of h.body) lines.push(printNode(step, level + 1));
  return lines.join('\n');
}

/**
 * `action create order(name)` (`A4-2`).
 *
 * The parameter list is **mandatory even when empty** — `parseActionDecl` calls
 * `expect('lparen', …)` unconditionally, so `action foo` is `TF010` and `action foo()` is the
 * spelling. That is also the commonest shape: 13 of the corpus's 22 actions take no parameters.
 *
 * The name is stored as `nameParts.join(' ')`, so a multi-word name — 16 of 22 — is a list of bare
 * identifiers with single spaces and cannot round-trip through anything else. Each word and each
 * parameter is checked the way `requestLine` checks a service name, because the AST holds a
 * `string` and a printer that trusted it would emit source that does not parse.
 */
function printAction(a: ActionDecl, level: number): string {
  if (a.body.length === 0) {
    refuse('ActionDecl', 'an `action` with no steps does not parse — the block needs at least one');
  }
  for (const word of a.name.split(' ')) {
    if (!isBareIdent(word)) refuse('ActionDecl', `\`${a.name}\` is not an action name this language can write`);
  }
  for (const param of a.params) {
    if (!isBareIdent(param)) refuse('ActionDecl', `\`${param}\` is not a parameter name this language can write`);
  }
  const lines = [pad(level) + `action ${a.name}(${a.params.join(', ')})`];
  for (const step of a.body) lines.push(printNode(step, level + 1));
  return lines.join('\n');
}

/**
 * `fill form` and its rows (`A4-3`).
 *
 * **The only browser statement that is a block rather than a line**, and it borrows `printTable`'s
 * layout rather than inventing one: each column padded to its widest cell, `| a | b |`, indented
 * one level under the header. That is what the corpus writes and what `with each` already prints,
 * and matching it is not cosmetic — every write path runs `format` over the spliced result and
 * `insertIntoSource` refuses rather than corrects when the printer's house style is not the
 * formatter's (`D1049`).
 *
 * A form with no rows is `TF015` — the parser answers `MalformedStep`, measured — so it refuses,
 * which is `printCrawl`'s, `printWithin`'s, `printHook`'s and `printAction`'s rule again.
 */
function printFillForm(f: FillFormStmt, level: number): string {
  if (f.rows.length === 0) {
    refuse('FillFormStmt', 'a `fill form` with no rows does not parse — the block needs at least one');
  }
  const cells = f.rows.map((r) => [printString(r.field), printValue(r.value)]);
  const width = [0, 1].map((i) => Math.max(...cells.map((r) => r[i]!.length)));
  const lines = [pad(level) + 'fill form'];
  for (const row of cells) {
    lines.push(pad(level + 1) + '| ' + row.map((c, i) => c.padEnd(width[i]!)).join(' | ') + ' |');
  }
  return lines.join('\n');
}

/**
 * `switch to new tab` and `download as <name>` (`A4-4`) — a header line and an indented block,
 * which is `printWithin`'s shape without a locator. Both refuse an empty body for the reason every
 * block in this printer does: `parseBlock` raises `TF015` and the bytes would not read back.
 */
function printStepBlock(header: string, steps: readonly Step[], kind: string, level: number): string {
  if (steps.length === 0) refuse(kind, `a \`${header}\` with no steps does not parse — the block needs at least one`);
  const lines = [pad(level) + header];
  for (const step of steps) lines.push(printNode(step, level + 1));
  return lines.join('\n');
}

/** `stub GET "…" respond status 200 [body { … }]` (`A4-4`). */
function printStub(s: StubStmt, level: number): string {
  let line = `stub ${s.method} ${printString(s.urlPattern)} respond status ${printValue(s.status)}`;
  if (s.body) line += ' body ' + printValue(s.body);
  return pad(level) + line;
}

/**
 * `wait until <subject> [not] <matcher> [for <hold>] [timeout wait <budget>]` (`A4-4`).
 *
 * The UI sibling of `wait until api`, and a single line rather than a block: there is no request
 * to re-issue, so the condition is the subject and matcher it already carries.
 */
function printWaitUntilUi(w: WaitUntilUiStmt, level: number): string {
  let line = `wait until ${printSubject(w.subject)} ${printMatcher(w.matcher)}`;
  if (w.holdMs !== null) line += ' for ' + duration(w.holdMs);
  if (w.waitMs !== null) line += ' timeout wait ' + duration(w.waitMs);
  return pad(level) + line;
}

function printTest(t: TestDecl, level: number): string {
  const lines: string[] = [];
  // All the tags on one line, which is what this corpus does: of 682 tag lines across both
  // repositories, **450 carry more than one tag** and none carries one per line. The per-node
  // gate cannot see this — it compares trees, and `tags` is the same array either way — so the
  // convention is asserted by a separate test, and was wrong here until one ran.
  if (t.tags.length > 0) lines.push(pad(level) + t.tags.map((tag) => '@' + tag).join(' '));

  let header = pad(level) + 'test ' + printString(t.name);
  if (t.sessions.length > 0) header += ' as ' + t.sessions.join(', ');
  if (t.retry > 0) header += ' retry ' + String(t.retry);
  if (t.concurrency === 'parallel') header += ' parallel';
  // `with each` sits between the tags and the header — outside the declaration it belongs to,
  // which is why it is emitted here and not from the body loop (`A1-2`).
  if (t.table) lines.push(...printTable(t.table, level));
  lines.push(header);

  const inner = level + 1;
  if (t.workload) lines.push(printWorkload(t.workload, inner));
  for (const step of t.body) lines.push(printNode(step, inner));
  for (const th of t.thresholds) lines.push(pad(inner) + printThreshold(th));
  return lines.join('\n');
}

/**
 * `crawl "name" [as s1, s2]` and its body (`M137e`/`M137f`, `D435`–`D442`, `D450`).
 *
 * **THE BODY ORDER IS A SPELLING THE AST STOPPED RECORDING — fourth instance, fourth answer.**
 * `parseCrawlBody` accepts `seed`, `exclude` and steps interleaved in any order and files them into
 * three separate arrays, so `seed / exclude / expect` and `expect / seed / exclude` are one node.
 * `Stage` REFUSED (its two spellings mean different programs), a JSON key is picked BARE, a `log`
 * level is picked OMITTED — and this is picked in the **declared order of the fields**: seeds, then
 * excludes, then body. Not arbitrarily: both real crawls in the corpus write exactly that order,
 * and it is the order the construct reads in — where the surface comes from, what is taken out of
 * it, then what is asserted about what is left.
 *
 * A crawl's steps are **not** restricted here. `parseCrawlBody`'s own comment says a crawl body
 * holding an `api GET /orders` line is a semantic error about a fully-formed node, which the
 * checker owns (`D96`/`D19`'s layering) — so a printer that refused one would be enforcing a rule
 * at the wrong layer and would refuse to print back a file the parser accepts.
 */
function printCrawl(c: CrawlDecl, level: number): string {
  const lines: string[] = [];
  // One line for all the tags, `printTest`'s convention and for its measured reason.
  if (c.tags.length > 0) lines.push(pad(level) + c.tags.map((tag) => '@' + tag).join(' '));

  let header = pad(level) + 'crawl ' + printString(c.name);
  // The same comma list `test` takes. Empty is legal and means the crawl sends no credential.
  if (c.sessions.length > 0) header += ' as ' + c.sessions.join(', ');
  lines.push(header);

  const inner = level + 1;
  for (const seed of c.seeds) lines.push(printSeed(seed, inner));
  for (const glob of c.excludes) lines.push(pad(inner) + 'exclude ' + printString(glob));
  for (const step of c.body) lines.push(printNode(step, inner));

  // A crawl with no body at all is `TF068`/`EMPTY_BLOCK` — the parser refuses to read one back, so
  // printing it would emit a header the language cannot take. `A1-2`'s rule: never write a line the
  // parser will not accept.
  if (c.seeds.length === 0 && c.excludes.length === 0 && c.body.length === 0) {
    refuse('CrawlDecl', 'a `crawl` with an empty body does not parse — it needs at least one `seed` line');
  }
  return lines.join('\n');
}

/**
 * `seed openapi [<service>] "<source>"` | `seed traffic` | `seed spider [<service>] "<root>"`.
 *
 * The spider's two caps are **sub-clauses indented beneath the seed line** — `authorized target`'s
 * idiom rather than a new one (`D450`) — and both are optional, defaulted by the runtime, so an
 * absent block and a block declaring neither are the same node and print the same way.
 */
function printSeed(seed: CrawlSeed, level: number): string {
  const p = pad(level);
  switch (seed.type) {
    case 'TrafficSeed':
      // The one seed that takes no argument at all: the traffic is whatever the run captured.
      return p + 'seed traffic';
    case 'OpenApiSeed':
      return `${p}seed openapi ${seedService(seed.service)}${printString(seed.source)}`;
    case 'SpiderSeed': {
      const lines = [`${p}seed spider ${seedService(seed.service)}${printString(seed.root)}`];
      const inner = pad(level + 1);
      // `raw`, not `num(value)`: both caps are `NumberLit`s and keep the text they were written
      // as, so nothing here is synthesised — unlike the workload fields, which store bare
      // milliseconds with no `raw` beside them and have to have a spelling chosen for them.
      if (seed.maxPages) lines.push(`${inner}max pages ${seed.maxPages.raw}`);
      if (seed.maxDepth) lines.push(`${inner}max depth ${seed.maxDepth.raw}`);
      return lines.join('\n');
    }
  }
}

/** `seed openapi root "/openapi.json"` — an ident before the string names the service (`D1030`),
 *  the same shape `api <service> GET /path` and `matches schema … from <service> "…"` use. */
function seedService(service: string | undefined): string {
  if (service === undefined) return '';
  if (!isBareIdent(service)) refuse('CrawlDecl', `\`${service}\` is not a service name this language can write`);
  return service + ' ';
}

function printWorkload(w: Workload, level: number): string {
  const p = pad(level);
  switch (w.type) {
    case 'RampUsersWorkload':
      return `${p}ramp to ${num(w.users)} users over ${duration(w.overMs)}`;
    case 'RampRpsWorkload':
      return `${p}ramp to ${num(w.rps)} rps over ${duration(w.overMs)}`;
    case 'HoldUsersWorkload':
      return `${p}hold ${num(w.users)} users for ${duration(w.forMs)}`;
    case 'HoldRpsWorkload':
      return `${p}hold ${num(w.rps)} rps for ${duration(w.forMs)}`;
    case 'SharedIterationsWorkload':
      return `${p}run ${num(w.iterations)} iterations across ${num(w.vus)} users`;
    case 'PerVuIterationsWorkload':
      return `${p}run ${num(w.iterationsPerVu)} iterations per user across ${num(w.vus)} users`;
    case 'StepUsersWorkload':
      return stageBlock(p, 'step', 'users', w.stages, level);
    case 'StepRpsWorkload':
      return stageBlock(p, 'step', 'rps', w.stages, level);
    case 'SpikeUsersWorkload':
      return stageBlock(p, 'spike', 'users', w.stages, level);
    case 'SpikeRpsWorkload':
      return stageBlock(p, 'spike', 'rps', w.stages, level);
    default:
      return refuse((w as Node).type);
  }
}

function stageBlock(p: string, host: 'step' | 'spike', unit: 'users' | 'rps', stages: readonly Stage[], level: number): string {
  if (stages.length === 0) refuse(`${host}/${unit} workload`, 'a stage list may not be empty');
  const inner = pad(level + 1);
  return [`${p}${host} ${unit}`, ...stages.map((s) => inner + printStage(s, host))].join('\n');
}

/**
 * A stage's spelling belongs to its block, not to the stage (`CONTEXT_BOUND` above):
 *
 *     step  + jump  ->  to N for <dur>          the only shape a `step` block has
 *     spike + jump  ->  hold N for <dur>
 *     spike + ramp  ->  to N over <dur>
 *     step  + ramp  ->  no such program
 *
 * The last row is a refusal rather than a best effort: the parser rejects `over` inside a `step`
 * outright (`parser.ts:1331`), so there is no text that would round-trip, and emitting the
 * `spike` spelling would silently move the stage into a block the author did not write.
 */
function printStage(s: Stage, host: 'step' | 'spike'): string {
  if (s.mode === 'ramp') {
    if (host === 'step') refuse('Stage', 'a `step` block cannot express a ramped stage — that shape only exists inside a `spike`');
    return `to ${num(s.target)} over ${duration(s.durationMs)}`;
  }
  return host === 'spike' ? `hold ${num(s.target)} for ${duration(s.durationMs)}` : `to ${num(s.target)} for ${duration(s.durationMs)}`;
}

function printThreshold(t: ThresholdDecl): string {
  const metric = t.metric.kind === 'duration' ? `p${t.metric.percentile} duration` : 'error rate';
  const scope = t.scope ? ` for ${printString(t.scope)}` : '';
  const op = t.op === 'lessThan' ? 'is less than' : 'is greater than';
  // An error-rate threshold is only ever written as a percentage and stored as a fraction
  // (`parser.ts` `parseThresholdDecl`), so the bound has to be multiplied back up — and a naive
  // `value * 100` reintroduces binary floating point into text a person reads (`0.029 * 100` is
  // `2.9000000000000004`). `percent()` is what keeps the printed bound the one that was parsed.
  const bound = t.metric.kind === 'duration' ? duration(t.value) : percent(t.value);
  return `threshold ${metric}${scope} ${op} ${bound}`;
}

/**
 * `let <name> = <value>` — opened in `A1-1` rather than `A1-3` where §4b put it, and the reason is
 * the arc's own: a value printer with no position that reaches it has a gate that examines zero
 * nodes, which is exactly the whole-file-gate failure §1 measured before `A0` began. `let` is the
 * cheapest position that reaches the vocabulary — the census puts **27 of the 31 value kinds**
 * behind it, against a request body's 12 — so it is what turns `A1-1` from a claim into a
 * measurement. `capture`, `call` and `log` stay in `A1-3`.
 */
function printLet(l: LetStmt): string {
  if (!isBareIdent(l.name)) refuse('LetStmt', `\`${l.name}\` is not a variable name this language can write`);
  return `let ${l.name} = ${printValue(l.value)}`;
}

function printPause(p: PauseStmt): string {
  return p.maxMs === null ? `pause ${duration(p.minMs)}` : `pause ${duration(p.minMs)} to ${duration(p.maxMs)}`;
}

// ---- steps -----------------------------------------------------------------

function printApiStep(a: ApiStep, level: number): string {
  const lines = [pad(level) + 'api ' + requestLine(a) + (a.tag ? ' as ' + printString(a.tag) : '')];
  lines.push(...apiBlock(a, a.retryAfter, level));
  return lines.join('\n');
}

/**
 * `[<service>] METHOD <path> [body] [timeout <dur>] [without redirects]` — the line
 * `parseApiRequestLine` reads, shared by `api` and `wait until api` exactly as it is there.
 *
 * THE CLAUSE ORDER IS THE GRAMMAR'S, NOT THE AST'S, and that is a correction rather than a
 * choice. `A0-1` wrote `as` immediately after the path because `tag` sits next to `path` in
 * `ApiRequestSpec`, and the parser takes `as` *last* — after `timeout` and `without redirects`.
 * A step carrying a tag AND a timeout therefore printed `api GET /x as "l" timeout 2s`, which
 * does not parse. No gate could see it: the corpus holds 10 `as` labels and 6 `timeout`s and the
 * two sets are disjoint, so the property held on every file that exists. Found by reading
 * `parseApiRequestLine` while scoping `A1-2`, and pinned by a test below.
 */
function requestLine(spec: ApiRequestSpec): string {
  let line = '';
  if (spec.service) {
    if (!isBareIdent(spec.service)) refuse('ApiStep', `\`${spec.service}\` is not a service name this language can write`);
    line += spec.service + ' ';
  }
  line += spec.method + ' ' + spec.path.raw;
  if (spec.body) line += ' ' + printBody(spec.body);
  if (spec.timeoutMs !== null) line += ' timeout ' + duration(spec.timeoutMs);
  if (!spec.followRedirects) line += ' without redirects';
  return line;
}

/** The indented block under an api step: `header "…" is <v>` lines, then the retry clause. Both
 *  live in the same block and `parseApiHeaders` accepts them in either order; the clause is
 *  printed last because that is where the corpus puts it. */
function apiBlock(spec: ApiRequestSpec, retryAfter: ApiStep['retryAfter'], level: number): string[] {
  const lines = spec.headers.map((h) => pad(level + 1) + printHeader(h));
  if (retryAfter) lines.push(`${pad(level + 1)}retry honoring "Retry-After" up to ${num(retryAfter.max)}`);
  return lines;
}

/**
 * `wait until api …` — the same request line, a `timeout wait <dur>` budget of its own, and a
 * block of `header` lines and `expect`s.
 *
 * `waitMs` is NOT `request.timeoutMs` and printing them into one clause would silently change the
 * program: `timeout` is how long one poll's HTTP request may take and `timeout wait` is the whole
 * poll budget (`ast.ts`'s note on `WaitUntilApiStmt.waitMs`). They are two clauses on one line and
 * the grammar puts them in that order, which `atWaitBudget` is what disambiguates.
 */
function printWaitUntilApi(w: WaitUntilApiStmt, level: number): string {
  let head = pad(level) + 'wait until api ' + requestLine(w.request);
  if (w.waitMs !== null) head += ' timeout wait ' + duration(w.waitMs);
  const lines = [head, ...apiBlock(w.request, null, level)];
  for (const e of w.expects) lines.push(printExpect(e, level + 1));
  if (w.expects.length === 0) refuse('WaitUntilApiStmt', 'a `wait until api` with no `expect` has no condition to wait for');
  return lines.join('\n');
}

/** The five request bodies (SPEC §5.2). Each is one keyword and its own shape; the values inside
 *  are `A1-1`'s. */
function printBody(b: ApiBody): string {
  switch (b.type) {
    case 'InlineBody':
      return 'body ' + printValue(b.value);
    case 'FileBody':
      return 'body from ' + printString(b.path);
    case 'TextBody':
      return 'body text ' + printString(b.value);
    case 'FormBody':
      return 'form ' + printFormFields(b.fields);
    case 'UploadBody': {
      let out = `upload ${printString(b.filePath)} as ${printString(b.fieldName)}`;
      if (b.contentType) out += ' type ' + printString(b.contentType);
      if (b.extra.length > 0) out += ' form ' + printFormFields(b.extra);
      return out;
    }
    default:
      return refuse((b as Node).type);
  }
}

/** `k=v, k=v` — keys are bare identifiers by grammar (`parseFormFields` takes an `ident` and
 *  nothing else), so unlike a JSON key there is no quoted spelling to fall back to. */
function printFormFields(fields: readonly FormField[]): string {
  if (fields.length === 0) refuse('FormBody', 'a form body needs at least one field');
  return fields
    .map((f, i) => {
      if (!isBareIdent(f.key)) refuse('FormField', `\`${f.key}\` is not a form field name this language can write — a form key is a bare identifier`);
      return `${f.key}=${printValue(f.value)}${openGuard(f.value, i === fields.length - 1, 'form field')}`;
    })
    .join(', ');
}

function printHeader(h: ApiHeader): string {
  return `header ${printString(h.name)} is ${printValue(h.value)}`;
}

/**
 * `with each` — the table sits ABOVE the `test` header and below the tags (`parseTest`), which is
 * the one construct in this language whose source position is outside the declaration it belongs
 * to.
 *
 * The inline form's cells are padded to the widest entry in their column, because that is what
 * `format` writes and the printer has to be a fixpoint of it.
 */
function printTable(t: DataTable, level: number): string[] {
  if (t.type === 'FileDataTable') return [pad(level) + 'with each from ' + printString(t.path)];
  if (t.columns.length === 0) refuse('InlineDataTable', 'a `with each` table needs at least one column');
  if (t.rows.length === 0) refuse('InlineDataTable', 'a `with each` table needs at least one data row');
  for (const c of t.columns) if (!isBareIdent(c)) refuse('InlineDataTable', `\`${c}\` is not a column name this language can write — column names are bare words`);
  const cells: string[][] = [[...t.columns]];
  for (const row of t.rows) {
    if (row.length !== t.columns.length) refuse('InlineDataTable', `a row has ${String(row.length)} cell(s) and the header has ${String(t.columns.length)}`);
    cells.push(row.map((v) => printValue(v)));
  }
  const width = t.columns.map((_, i) => Math.max(...cells.map((r) => r[i]!.length)));
  const line = (row: readonly string[]): string => pad(level + 1) + '| ' + row.map((c, i) => c.padEnd(width[i]!)).join(' | ') + ' |';
  return [pad(level) + 'with each', ...cells.map(line)];
}

function printExpect(e: ExpectStmt, level: number): string {
  const keyword = e.soft ? 'check' : 'expect';
  // `A1-3`: the quantifier is emitted for real now. In `A0` this branch was a REFUSAL, because
  // `any`/`all` only ever quantify a body path and no body subject printed — a branch that could
  // not be reached, which the mutation run caught by surviving the deletion of it.
  const quantifier = e.quantifier ? e.quantifier + ' ' : '';
  // `A4-4`: `mask <locator>` is a TRAILING clause on the same line, repeated once per mask —
  // `expect css "main" matches snapshot "x" mask field "A" mask css "B"`. It refused from `A0`
  // until now for want of a locator printer.
  const masks = e.masks.map((m) => ' mask ' + printLocator(m)).join('');
  return `${pad(level)}${keyword} ${quantifier}${printSubject(e.subject)} ${printMatcher(e.matcher)}${masks}`;
}

/**
 * The response subjects (SPEC §5.3). Everything here reads the last `api` step's response scope;
 * the locator, page, dialog and `request to "…"` subjects are the browser's and are `A3`'s.
 *
 * `of request to "…"` moves any of four of these off the response scope and onto traffic observed
 * on a live page, so the clause goes with the browser vocabulary that gives it meaning — refused
 * here by name rather than silently dropped, which would print an assertion against the wrong
 * response.
 */
function printSubject(s: Subject): string {
  switch (s.type) {
    case 'StatusSubject':
      return 'status' + networkRefClause(s.of);
    case 'DurationSubject':
      return 'duration';
    case 'RequestSubject':
      return 'request';
    case 'ResponseSubject':
      return 'response';
    case 'HeaderSubject':
      return `header ${printString(s.name)}` + networkRefClause(s.of);
    case 'BodySubject':
      return 'body' + printBodyPath(s.path) + networkRefClause(s.of);
    case 'BodyTextSubject':
      return 'body text' + networkRefClause(s.of);
    case 'BodyBytesSubject':
      return 'body bytes';
    case 'BodyCsvSubject':
      return 'body csv' + printBodyPath(s.path);
    case 'BodyPdfTextSubject':
      return 'body pdf text';
    case 'ValueSubject':
      return '{' + printRef(s.ref) + '}';
    // `A3-3` — the browser's two subjects. `LocatorSubject` is a locator and nothing else, and
    // `PageSubject` carries no data at all: `ast.ts` calls it and `ResponseSubject` deliberately
    // parallel, bare subjects whose meaning comes entirely from the matcher after them.
    case 'LocatorSubject':
      return printLocator(s.locator);
    case 'PageSubject':
      return 'page';
    // `A4-4` — the dialog pair carries no data either, for `PageSubject`'s reason, and the network
    // subject is its `ref` and nothing else.
    case 'DialogTypeSubject':
      return 'dialog type';
    case 'DialogMessageSubject':
      return 'dialog message';
    case 'NetworkRequestSubject':
      return printNetworkRef(s.ref);
  }
  // **EVERY SUBJECT IN THE LANGUAGE NOW PRINTS**, so there is no `default` here: TypeScript
  // narrows the switch to `never`, and adding a branch for it would be a line no input can reach —
  // the same call `A4-1` made on the column tiebreak and `A4-2` on the one-line grouping rule. If
  // a subject is added later, this function stops compiling, which is a better gate than a
  // refusal nobody would ever see.
}

/**
 * `status of request to "/health"` — the clause that points a response subject at traffic observed
 * on the page instead of at the last api response (`A4-4`; it refused from `A0` until now, because
 * a `NetworkRequestRef` had no printer).
 */
function networkRefClause(of: NetworkRequestRef | null): string {
  return of ? ' of ' + printNetworkRef(of) : '';
}

/** `request to "/v1/products" [with method "GET"]` — shared by the subject and the clause. */
function printNetworkRef(ref: NetworkRequestRef): string {
  return `request to ${printString(ref.urlPattern)}` + (ref.method ? ` with method ${printString(ref.method)}` : '');
}

/**
 * `body.items[0].price` — every property segment is dotted, including the first, because `body`
 * precedes it. That is the one difference from `printRef`, whose first segment IS the name and so
 * takes no dot; getting it wrong either way produces a path that still parses.
 */
function printBodyPath(path: readonly PathSegment[]): string {
  let out = '';
  for (const seg of path) {
    if (seg.kind === 'prop') {
      if (!isBareIdent(seg.name)) refuse('BodySubject', `\`${seg.name}\` is not a property name this language can write`);
      out += '.' + seg.name;
    } else if (seg.kind === 'index') {
      out += `[${num(seg.index)}]`;
    } else {
      refuse('PathSegment', `unknown segment kind \`${(seg as { kind: string }).kind}\``);
    }
  }
  return out;
}

/**
 * The scan phrase each `has no … violations` matcher is spelled with (`parser.ts`'s
 * `SCAN_MATCHER_NAMES`, read backwards). A `Record` keyed by the matcher name rather than a
 * lookup through the parser's own tuple, for the reason that tuple gives for being a `Record`:
 * a fifth scan becomes a type error here until it is given a phrase.
 */
const SCAN_PHRASES: Readonly<Record<'hasNoA11yViolations' | 'hasNoSecurityViolations' | 'hasNoAuthzViolations' | 'hasNoInputHandlingViolations', string>> = {
  hasNoA11yViolations: 'a11y',
  hasNoSecurityViolations: 'security',
  hasNoAuthzViolations: 'authorization',
  hasNoInputHandlingViolations: 'input handling',
};

/**
 * `[not] has no [<severity>] <phrase> violations` (`M3e`/`M128b`/`M130b`/`M134a`).
 *
 * **The `not` goes in front of `has`, not in front of `no`.** `parseMatcher` consumes the negation
 * prefix before it ever reaches `has`, so the only spelling that parses is `not has no …` — which
 * reads badly and is what all 57 negated assertions in the corpus write, because that is how an
 * acceptance test says *the scanner found something*. Writing the double negative the way it reads
 * would have produced a line the parser cannot take back.
 *
 * **The severity is a floor and is omitted more often than not** — 72 of 102 corpus assertions name
 * none. Unlike `log`'s level (`printLog`, the third normalisation instance) there is nothing to pick
 * here: `severityFloor` is `undefined` when the word was absent and a `FindingSeverity` when it was
 * present, so the AST still records the spelling and the printer just follows it.
 */
function printScanMatcher(m: Matcher, phrase: string): string {
  // Every scan matcher is a state matcher: `parseScanViolationsMatcher` builds it with `value: null`
  // and there is no spelling that supplies one. Same guard, and same reason, as `connects`.
  if (m.value) refuse('Matcher', `\`has no ${phrase} violations\` never takes an operand`);
  const not = m.negated ? 'not ' : '';
  const severity = m.severityFloor === undefined ? '' : m.severityFloor + ' ';
  return `${not}has no ${severity}${phrase} violations`;
}

/**
 * The value matchers (SPEC §6.2), plus the four scan families. The state matchers
 * (`visible`/`hidden`/…) are the browser's, so those still refuse here.
 *
 * `is` IS NOT RECORDED. `parseMatcher` consumes an optional `is` copula and discards it, so
 * `equals` and `is equals` are the same node — the `Field.key` situation again, and picked the
 * same way: the corpus writes `equals 200` bare and `is less than 500ms` with the copula, so that
 * is what this writes.
 */
function printMatcher(m: Matcher): string {
  const not = m.negated ? 'not ' : '';
  switch (m.name) {
    case 'equals':
      return `${not}equals ${operand(m)}`;
    case 'contains':
      return `${not}contains ${operand(m)}`;
    case 'matches':
      return `${not}matches ${operand(m)}`;
    case 'matchesSubset':
      return `${not}matches subset ${operand(m)}`;
    case 'matchesSchema': {
      if (!m.schemaName || !m.schemaSource) refuse('Matcher', '`matches schema` needs a schema name and a source');
      const service = m.schemaService === undefined ? '' : m.schemaService + ' ';
      if (m.schemaService !== undefined && !isBareIdent(m.schemaService)) refuse('Matcher', `\`${m.schemaService}\` is not a service name this language can write`);
      return `${not}matches schema ${printString(m.schemaName)} from ${service}${printString(m.schemaSource)}`;
    }
    case 'matchesFile':
      if (!m.filePath) refuse('Matcher', '`matches file` needs a path');
      return `${not}matches file ${printString(m.filePath)}`;
    case 'lessThan':
      return `is ${not}less than ${operand(m)}`;
    case 'greaterThan':
      return `is ${not}greater than ${operand(m)}`;
    case 'hasCount':
      return `${not}has count ${operand(m)}`;
    case 'hasValue':
      return `${not}has value ${operand(m)}`;
    // `A3-3` — the five state words, printed by one branch because the parser holds them in one
    // closed family (`STATE_WORDS` in `parser.ts`) with one spelling. Splitting them by frequency
    // — `visible` 585 against `disabled` 1 — would invent a distinction the grammar does not make
    // and leave `is disabled` refusing while `is hidden` printed, for no reason a reader could
    // recover.
    //
    // **`is` IS AN OPTIONAL COPULA AND THE AST DOES NOT RECORD IT** (`FS-08`), so `expect button
    // "Buy" visible` and `… is visible` parse to the identical node. That makes this the fifth
    // member of the normalisation family (`§6p`) — a spelling the tree stopped keeping — and it is
    // settled by measurement rather than taste: **623 of 623** state assertions in the corpus are
    // written with `is`, and `format` preserves whichever spelling it is given rather than
    // choosing, so the formatter had no answer to inherit. It also matches the two matchers above
    // that already emit the copula, `is less than` and `is greater than`.
    case 'visible':
    case 'hidden':
    case 'enabled':
    case 'disabled':
    case 'checked':
      // Operand-free like `connects`, and measured so: not one of the corpus's 622 state matchers
      // carries a value.
      if (m.value) refuse('Matcher', `\`${m.name}\` is a state, so it never takes an operand`);
      return `is ${not}${m.name}`;
    case 'connects':
      // The one matcher that never takes an operand at all (`ast.ts` on `Matcher.value`).
      if (m.value) refuse('Matcher', '`connects` never takes an operand');
      return `${not}connects`;
    case 'fails':
      // …and the one whose operand is optional, spelled with its own keyword.
      return m.value ? `${not}fails matching ${printValue(m.value)}` : `${not}fails`;
    case 'hasNoA11yViolations':
    case 'hasNoSecurityViolations':
    case 'hasNoAuthzViolations':
    case 'hasNoInputHandlingViolations':
      return printScanMatcher(m, SCAN_PHRASES[m.name]);
    // `A4-4`. The corpus spells the negation `not was made`, so it takes the same `not` prefix
    // every other matcher here does and needs no special case.
    // `A4-4`. `snapshotName` is optional on the type and required in practice — it is set only
    // when `name === 'matchesSnapshot'` — so the printer refuses rather than emitting
    // `matches snapshot` with nothing after it, which is the shape `matches schema` and
    // `matches file` already use two branches above.
    case 'matchesSnapshot':
      if (!m.snapshotName) refuse('Matcher', '`matches snapshot` needs a name');
      return `${not}matches snapshot ${printString(m.snapshotName)}`;
    case 'wasMade':
      if (m.value) refuse('Matcher', '`was made` never takes an operand');
      return `${not}was made`;
    default:
      return refuse('Matcher', `the \`${m.name}\` matcher is not printable yet`);
  }
}

/** `capture <subject> as <name>` — the subject vocabulary is `printSubject`'s, minus the value
 *  subject, which `parseCapture` rejects by name (`D130`: that statement is a `let` with a second
 *  name). Refusing it here keeps the printer from writing a step the parser will not read. */
function printCapture(c: CaptureStmt): string {
  if (c.subject.type === 'ValueSubject') refuse('CaptureStmt', '`capture` reads a value out of a response, so its subject cannot be a `{variable}` (`D130`)');
  if (!isBareIdent(c.name)) refuse('CaptureStmt', `\`${c.name}\` is not a variable name this language can write`);
  return `capture ${printSubject(c.subject)} as ${c.name}`;
}

/**
 * `log [level] "message" [to <destination>]`.
 *
 * THE LEVEL IS NORMALISED ON THE WAY IN, third instance of that shape and third different answer.
 * `parseLogStep` defaults an omitted level to `'info'`, so `log "x"` and `log info "x"` are one
 * node. `Stage` refused because its two spellings mean different programs; a JSON key is picked
 * bare; and this is picked *omitted*, because that is what all eight `log` lines in the corpus
 * write and because the shorter one is what a form should emit.
 */
function printLog(l: LogStmt): string {
  const level = l.level === 'info' ? '' : l.level + ' ';
  const to = l.destination === null ? '' : ' to ' + l.destination;
  return `log ${level}${printString(l.message)}${to}`;
}

/** A bare call as a statement (`M6`, `P#2`) — the same `CallExpr` a value position takes, with its
 *  result discarded, so its name is bound by the same rules. */
function printCallStmt(c: CallStmt): string {
  return printCall(c.call);
}

function operand(m: Matcher): string {
  if (!m.value) refuse('Matcher', `the \`${m.name}\` matcher needs an operand and has none`);
  return printValue(m.value);
}

// ---- values ----------------------------------------------------------------
//
// `A1-1`. Five positions in this language read one `Value` union — a request body, a `let`, a
// header value, a matcher operand and a call argument — so the union is printed once, here, and
// the four slices above it inherit the whole vocabulary rather than each opening a corner of it.
// Measured off the corpus (PLAN §4a): a request body reaches 12 of these kinds and a `let`
// reaches 27, of which 15 are generators.
//
// THREE WAYS A VALUE CAN BE UNPRINTABLE, AND NONE OF THEM IS A MISSING BRANCH.
//
//  1. *Precedence with no parentheses.* `BinaryExpr` is a closed `+ - * /` grammar with **no
//     parens** (P#25, the hard fence) and no parenthesised escape hatch, so a tree whose shape
//     disagrees with the grammar's own precedence has no source at all. `printBinary` refuses it.
//  2. *A word that means something else in value position.* `parseAtom` dispatches on the ident
//     itself — `today`, `random`, `unique`, `format`, `true`… — so a variable or an action named
//     one of them cannot be written down as a reference to itself. `RESERVED_IN_VALUE` refuses.
//  3. *A construct that absorbs what follows it.* `random of a, b` eats commas until they stop,
//     and `random password` takes an optional length, so both can swallow a sibling that was
//     meant to stand beside them. `endsOpenToComma`/`endsOpenToValue` decide where that is safe.
//
// Every one of the three is the `Stage` family from `A0-1` again — the grammar decided something
// the AST does not record — and every one is a refusal rather than a best effort, for the reason
// in this file's header: printed source that parses into a different program is the failure this
// printer exists to make impossible.

/** Words `parseAtom` claims before it will read an ident as a variable or a call name. A `VarRef`
 *  or `CallExpr` spelled with one of these prints source that means something else entirely —
 *  `today` becomes a `DateAtom`, `unique(x)` a generator — so it is refused instead.
 *
 *  `env` is deliberately absent for `VarRef` and present for `CallExpr`: the parser takes `env`
 *  only when an `(` follows it (`parser.ts:5051`), so a bare variable called `env` round-trips and
 *  a one-argument call to an action called `env` does not. */
const RESERVED_IN_VALUE = new Set(['unique', 'random', 'format', 'base64', 'hex', 'url', 'today', 'now', 'true', 'false', 'null']);

/** Binding power, matching `parseAddSub`/`parseMulDiv`. Left-associative, two levels, no parens. */
const BINDS: Readonly<Record<BinaryExpr['op'], number>> = { '+': 1, '-': 1, '*': 2, '/': 2 };
const ATOM = 3;

function printValue(v: Value, need = 1): string {
  switch (v.type) {
    case 'StringLit':
      return printString(v);
    case 'NumberLit':
      return v.raw;
    case 'DurationLit':
      return v.raw;
    case 'BoolLit':
      return v.value ? 'true' : 'false';
    case 'NullLit':
      return 'null';
    case 'VarRef':
      if (RESERVED_IN_VALUE.has(v.name)) refuse('VarRef', `\`${v.name}\` is a word the value grammar claims, so a variable of that name cannot be written as itself`);
      if (!isBareIdent(v.name)) refuse('VarRef', `\`${v.name}\` is not a name this language can write`);
      return v.name;
    case 'Interp':
      return '{' + printRef(v.ref) + '}';
    case 'EnvRef':
      if (!isBareIdent(v.name)) refuse('EnvRef', `\`${v.name}\` is not an environment-variable name this language can write`);
      return `env(${v.name})`;
    case 'ObjectLit':
      return printObject(v);
    case 'ArrayLit':
      return printArray(v);
    case 'BinaryExpr':
      return printBinary(v, need);
    case 'DateAtom':
      return v.which;
    case 'DateOffsetLit':
      return `${num(v.amount)} ${v.unit}`;
    case 'FormatExpr':
      // `format <value> as "<pattern>"` — the value is read by the full `parseValue`, so it
      // needs no bracketing, and the trailing pattern string closes the expression.
      return `format ${printValue(v.value)} as ${printString(v.pattern)}`;
    case 'TransformExpr':
      return `${v.kind} ${v.direction}(${printValue(v.value)})`;
    case 'CallExpr':
      return printCall(v);
    default:
      return printGenerator(v);
  }
}

/** `{ a: 1, b: "x" }` — on one line, which is what this corpus writes: of 1,823 inline request
 *  bodies **1,811 are single-line**, the longest 300 characters and the widest 7 fields. The
 *  twelve that were wrapped by hand come back joined; that is a text difference the per-node gate
 *  is right to ignore, because `ObjectLit` records fields and not line breaks. */
function printObject(o: ObjectLit): string {
  if (o.fields.length === 0) return '{}';
  const parts = o.fields.map((f, i) => `${printKey(f.key)}: ${printValue(f.value)}${openGuard(f.value, i === o.fields.length - 1, 'object field')}`);
  return `{ ${parts.join(', ')} }`;
}

function printArray(a: ArrayLit): string {
  if (a.elements.length === 0) return '[]';
  return '[' + a.elements.map((e, i) => printValue(e) + openGuard(e, i === a.elements.length - 1, 'array element')).join(', ') + ']';
}

function printCall(c: CallExpr): string {
  const first = c.name.split(' ')[0] ?? '';
  if (RESERVED_IN_VALUE.has(first) || first === 'env') refuse('CallExpr', `a call whose name starts with \`${first}\` would be read as the value grammar's own \`${first}\``);
  for (const word of c.name.split(' ')) if (!isBareIdent(word)) refuse('CallExpr', `\`${c.name}\` is not a call name this language can write`);
  const args = c.args.map((a, i) => printValue(a) + openGuard(a, i === c.args.length - 1, 'call argument'));
  return `${c.name}(${args.join(', ')})`;
}

/**
 * A field of a JSON object is written bare when it is an identifier and quoted when it is not —
 * `parseObject` accepts either (`parser.ts:5395`) and stores the same `string` for both, so the
 * spelling is the printer's to choose and the tree cannot tell which was written. Bare is the
 * corpus convention; quoting is what makes `{"user name": 1}` expressible at all.
 *
 * This is the `Stage` normalisation again with the opposite resolution: `Stage` refused because
 * the two spellings parse to *different* programs, and this one picks because they parse to the
 * same one.
 */
function printKey(key: string): string {
  if (isBareIdent(key)) return key;
  return '"' + escape(key) + '"';
}

function isBareIdent(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/**
 * Precedence, with the escape hatch this grammar has instead of parentheses.
 *
 * `-x` is sugar for `0 - x` and the parser records only the sugar's result (`parser.ts:4986`), so
 * a `BinaryExpr` subtracting from a literal `0` may be written either way — and the unary
 * spelling is an *atom*, which is the one way a subtraction can stand where a subtraction may not.
 * That covers every negative literal in the language. What it does not cover is an addition under
 * a multiplication, and there is no source for that at all, so it refuses.
 */
function printBinary(b: BinaryExpr, need: number): string {
  // `-x` binds as tightly as `x` does, but only while `x` is itself an atom: printing `-a * b`
  // for `(0 - (a * b))` re-parses as `((0 - a) * b)`, a different tree.
  if (b.op === '-' && b.left.type === 'NumberLit' && b.left.value === 0 && b.right.type !== 'BinaryExpr') {
    return '-' + printValue(b.right, ATOM);
  }
  const binds = BINDS[b.op];
  if (binds < need) {
    refuse('BinaryExpr', `\`${b.op}\` binds too loosely to stand here and this grammar has no parentheses (P#25), so no source expresses this tree`);
  }
  // The operator itself has to survive the operand in front of it.
  const tail = tailReads(b.left);
  if (tail === 'value' || (tail === 'minus' && b.op === '-')) {
    refuse('BinaryExpr', `the left operand ends in a generator that is still reading, so a following \`${b.op}\` would be swallowed into it rather than applied to it`);
  }
  return `${printValue(b.left, binds)} ${b.op} ${printValue(b.right, binds + 1)}`;
}

/**
 * WHERE A PRINTED VALUE STOPS, AND WHY THAT IS A CORRECTNESS QUESTION.
 *
 * Most values close themselves — a string ends on its quote, `unique(x)` and `base64 encode(x)`
 * on their `)`, `format x as "p"` on its pattern. Five generators do not: `random number … to
 * <v>`, `random decimal … to <v>`, `random date between … and <v>`, `random string <v>` and
 * `random password [<v>]` all end with a call into `parseValue`, and `random of a, b` reads
 * values until the commas stop. A value printed in front of one of those siblings is not beside
 * it, it is *inside* it.
 *
 * So `tailReads` says what the printed form is still willing to swallow:
 *
 *   'value'      an open `parseValue` — takes any following operator and any following operand
 *   'minus'      a bare `random password`, whose optional length is taken only when a
 *                value-shaped token follows (`looksLikeValueStart`, `parser.ts:5326`: a string,
 *                a number, `{` or `-`) — so `random password + 1` is safe and `- 1` is not
 *   'none'       closed
 *
 * and `commaGreedy` says the same thing about a comma, which only `random of` reads.
 *
 * None of these shapes occurs in the 671-file corpus, which is exactly why they are written down
 * rather than discovered: the per-node gate can only find defects in constructs somebody has
 * already written, and a form can build one of these on its first day.
 */
type Tail = 'value' | 'minus' | 'none';

function tailReads(v: Value): Tail {
  switch (v.type) {
    case 'RandomNumberExpr':
    case 'RandomDecimalExpr':
    case 'RandomDateBetweenExpr':
      return 'value';
    case 'RandomStringExpr':
      return 'value';
    case 'RandomPasswordExpr':
      return v.length === undefined ? 'minus' : 'value';
    case 'RandomOfExpr':
      return v.choices.length === 0 ? 'none' : tailReads(v.choices[v.choices.length - 1]!);
    case 'BinaryExpr':
      // The unary spelling prints `-<right>`, so its tail is the right operand's either way.
      return tailReads(v.right);
    default:
      return 'none';
  }
}

function commaGreedy(v: Value): boolean {
  if (v.type === 'RandomOfExpr') return true;
  if (v.type === 'BinaryExpr') return commaGreedy(v.right);
  return false;
}

/** Guard for a comma-separated position: everything but the last entry must close on its comma. */
function openGuard(v: Value, isLast: boolean, position: string): string {
  if (isLast || !commaGreedy(v)) return '';
  refuse(v.type, `\`random of\` reads values until the commas stop, so it can only be the last ${position}`);
}

function printGenerator(v: Value): string {
  switch (v.type) {
    case 'UniquePrefixExpr':
      return `unique(${printValue(v.prefix)})`;
    case 'UniqueEmailExpr':
      return 'unique email';
    case 'UniqueNumberExpr':
      return 'unique number';
    case 'UniqueLikeExpr':
      return `unique like ${printString(v.pattern)}`;
    case 'UniqueUuidExpr':
      return 'unique uuid';
    case 'RandomNumberExpr':
      return `random number ${printValue(v.from)} to ${printValue(v.to)}`;
    case 'RandomDecimalExpr':
      return `random decimal ${printValue(v.from)} to ${printValue(v.to)}`;
    case 'RandomDateInPastExpr':
      return 'random date in past';
    case 'RandomDateInFutureExpr':
      return 'random date in future';
    case 'RandomDateBetweenExpr':
      return `random date between ${printValue(v.from)} and ${printValue(v.to)}`;
    case 'RandomOfExpr': {
      if (v.choices.length === 0) refuse('RandomOfExpr', '`random of` needs at least one choice');
      const choices = v.choices.map((c, i) => printValue(c) + openGuard(c, i === v.choices.length - 1, 'choice'));
      return `random of ${choices.join(', ')}`;
    }
    case 'RandomStringExpr':
      return `random string ${printValue(v.length)}`;
    case 'RandomLikeExpr':
      return `random like ${printString(v.pattern)}`;
    case 'RandomUuidExpr':
      return 'random uuid';
    case 'RandomPasswordExpr':
      return v.length === undefined ? 'random password' : `random password ${printValue(v.length)}`;
    default:
      return refuse((v as Node).type);
  }
}

/** Rebuilt from `parts`, not from `value`: the decoded value has lost the difference between a
 *  literal `{` and an interpolation hole, and re-quoting `value` would turn `{id}` back into a
 *  reference the author never wrote. */
/**
 * `within [frame] <locator>` and its indented body — `M200` `A3-4`.
 *
 * **The first browser BLOCK, and the round's capstone: one kind, 32 round-tripping tests to 164.**
 * Nothing about the block is large; what it holds is. 403 of them sit across 150 tests, and every
 * statement inside one is unreachable until the block prints — measured, the corpus's `within`
 * bodies are `ClickStmt` 396, `ExpectStmt` 19 and `FillStmt` 14, all of which `A3-2` and `A3-3`
 * already print, so this slice adds a wrapper and collects everything under it.
 *
 * **`frame` is 4 of 404 and is a word, not a locator kind.** `within frame css "iframe[…]"` steps
 * into the frame that selector resolves to; `within css "…"` scopes to a subtree of the same
 * document. A boolean rather than a seventh `LocatorKind` because it is orthogonal — every locator
 * kind is legal after it — and at four occurrences it is `A3-1`'s `xpath` again: rare enough that
 * the corpus alone cannot be trusted to cover it.
 *
 * **It recurses, and the corpus cannot show that.** Every one of the 403 is at depth 1, but the
 * grammar accepts a `within` inside a `within` — verified against the parser rather than assumed —
 * so the body goes through `printNode` at `level + 1` like any other block and there is no
 * nesting case to get wrong. A printer written to the measured depth would have been a printer
 * written to a coincidence.
 *
 * An empty body refuses, for `printCrawl`'s reason: the parser rejects it outright (*this `within`
 * has no steps*), so a printer that emitted one would be writing a block nothing can read back.
 */
function printWithin(w: WithinBlock, level: number): string {
  if (w.body.length === 0) {
    refuse('WithinBlock', 'a `within` with no steps does not parse — the block needs at least one');
  }
  const frame = w.frame ? 'frame ' : '';
  const lines = [`${pad(level)}within ${frame}${printLocator(w.locator)}`];
  for (const step of w.body) lines.push(printNode(step, level + 1));
  return lines.join('\n');
}

/**
 * `open "/orders/{orderId}"` — `M200` `A3-2`.
 *
 * One `StringLit` and no clause of any kind. It goes through `printString` rather than being
 * quoted directly because **35 of the corpus's 281 opens carry an interpolation** — a path is
 * usually the first place a captured id is used — and `ast.ts` is explicit that this is a normal
 * interpolation-aware string rather than a bare api-style path token, precisely because `open`
 * has no method or service prefix to gate a contextual `/` on.
 */
function printOpen(o: OpenStmt): string {
  return `open ${printString(o.path)}`;
}

/**
 * `click button "Buy"` / `double click …` / `right click …` — `M200` `A3-2`.
 *
 * **The kind is a prefix, not a suffix or a flag**, and the parser says so in two functions:
 * `parseClickStep` consumes `click` while `parseDoubleOrRightClickStep` consumes `double`/`right`
 * and then *expects* `click`. So the printed word order is fixed by the grammar and there is no
 * spelling choice here to normalise away.
 *
 * `single` is **770 of 774** in the corpus against `double` 2 and `right` 2. That ratio is the
 * reason all three are named in a test rather than left to the corpus: a variant occurring twice
 * is one deleted fixture away from being untested, which is exactly what `A3-1` recorded about
 * `xpath`.
 */
function printClick(c: ClickStmt): string {
  const prefix = c.kind === 'single' ? '' : c.kind === 'double' ? 'double ' : 'right ';
  return `${prefix}click ${printLocator(c.locator)}`;
}

/**
 * `fill field "Email" with {email}` — `M200` `A3-2`.
 *
 * The value is a full `Value`, not a string, and that is load-bearing rather than incidental:
 * measured over the corpus, a fill takes `StringLit` 422 times, `EnvRef` 12 and `Interp` 3. So it
 * routes through `printValue` — `A1-1`'s slice, the one union five positions read — and a fill is
 * the sixth position rather than a new grammar.
 *
 * `fill form` is a different node (`FillFormStmt`, an indented table) and is `A4`'s.
 */
function printFill(f: FillStmt): string {
  return `fill ${printLocator(f.locator)} with ${printValue(f.value)}`;
}

/**
 * `button "Sign in"` / `field "Card number"` / `css "iframe[title='Payment']"` — `M200` `A3-1`.
 *
 * **The whole node is two fields, and that is a measurement rather than an impression**: `kind`
 * and `value` are present on all 2,296 instances in the corpus, with no optional clause, no
 * modifier and no third spelling anywhere. So the printer is the concatenation it looks like, and
 * the BROWSER form is a dropdown beside a text box.
 *
 * `kind` is a closed union of six, and four of them — `button` 803, `css` 516, `text` 498,
 * `field` 476 — are **99.9%** of the corpus. `list` (2) and `xpath` (1) are the entire remainder
 * and are printed by the same line rather than special-cased, because the grammar does not
 * distinguish them and a printer that did would be inventing a distinction to have an opinion
 * about.
 *
 * The value goes through `printString`, which is not a detail: a locator's value is
 * `{ref}`-interpolation-aware like any other `StringLit` (`ast.ts`), so `field "Card {n}"` has to
 * survive the round trip with its interpolation intact rather than as escaped text.
 */
function printLocator(l: Locator): string {
  return `${l.kind} ${printString(l.value)}`;
}

function printString(s: StringLit): string {
  let out = '"';
  for (const part of s.parts) {
    if (part.kind === 'text') out += escape(part.value);
    else out += '{' + printRef(part.ref) + '}';
  }
  return out + '"';
}

/** `{order.items[0].id}` — a property is dotted unless it opens the reference, an index is
 *  bracketed and never dotted. `PathSegment` has exactly these two kinds (`ast.ts:1005`); the
 *  wildcard lives in `RedactPathSegment`, a deliberately separate type, and cannot arrive here. */
function printRef(ref: readonly PathSegment[]): string {
  let out = '';
  for (const seg of ref) {
    if (seg.kind === 'prop') out += out === '' ? seg.name : '.' + seg.name;
    else if (seg.kind === 'index') out += `[${String(seg.index)}]`;
    else refuse('PathSegment', `unknown segment kind \`${(seg as { kind: string }).kind}\``);
  }
  if (out === '') refuse('StringLit', 'an interpolation with no path segments');
  return out;
}

function escape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

// ---- numbers, durations, percentages ---------------------------------------

function num(n: number): string {
  if (!Number.isFinite(n)) refuse('NumberLit', `${String(n)} is not a finite number`);
  return String(n);
}

/**
 * The workload nodes store bare milliseconds — `overMs`, `forMs`, `durationMs` — with no `raw`
 * beside them, unlike `DurationLit` and `NumberLit` which both keep the text they were written
 * as. So a duration in printed source is *synthesised*, and this picks the largest of the three
 * abbreviations that divides the value exactly — the spelling a person would have written.
 *
 * It can therefore print `2m` where the file said `120s`. That is a text difference and not a
 * lost field: both parse to the same `overMs`, which is all the node holds, and the per-node
 * gate compares trees rather than bytes for exactly this reason. There is no compound duration
 * in this grammar, so 90 seconds prints `90s` and never `1m30s`.
 */
function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) refuse('DurationLit', `${String(ms)} is not a duration`);
  if (ms === 0) return '0ms';
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1_000 === 0) return `${ms / 1_000}s`;
  return `${ms}ms`;
}

/**
 * `1%` parses to `0.01`, and `0.029 * 100` is `2.9000000000000004` in binary floating point, so
 * the multiplication has to be done in decimal. Round-tripping through the shortest decimal
 * representation of the fraction recovers the digits the author typed for every percentage the
 * parser can produce, because the parser produced the fraction by dividing that same decimal.
 */
function percent(fraction: number): string {
  if (!Number.isFinite(fraction)) refuse('ThresholdDecl', `${String(fraction)} is not an error-rate bound`);
  const scaled = Number((fraction * 100).toPrecision(15));
  return `${scaled}%`;
}
