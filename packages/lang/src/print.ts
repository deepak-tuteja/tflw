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
  ExpectStmt,
  FormField,
  LetStmt,
  LogStmt,
  Matcher,
  Node,
  ObjectLit,
  PathSegment,
  PauseStmt,
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
 * `RetryAfterClause` joined it in `A1-2` on the same ordinary grounds.
 *
 * Expect more of these as `A1`–`A4` widen the printer. The shape to watch for is a node whose
 * field was normalised on the way in, because a normalisation is a spelling decision the AST
 * stopped recording.
 */
export const CONTEXT_BOUND = new Set<string>(['Stage', 'Field', 'FormField', 'RetryAfterClause']);

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
    case 'TestDecl':
      return printTest(node as TestDecl, level);
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
    case 'StringLit':
    case 'NumberLit':
    case 'DurationLit':
    case 'BoolLit':
    case 'NullLit':
      return pad(level) + printValue(node as Value);
    default:
      return refuse(node.type);
  }
}

const pad = (level: number) => INDENT.repeat(level);

// ---- declarations ----------------------------------------------------------

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
  // `mask <locator>` is only meaningful on `matches snapshot`, and a locator is `A3`'s.
  if (e.masks.length > 0) refuse('ExpectStmt', '`mask` clauses need a locator, which is not printable yet');
  const keyword = e.soft ? 'check' : 'expect';
  // `A1-3`: the quantifier is emitted for real now. In `A0` this branch was a REFUSAL, because
  // `any`/`all` only ever quantify a body path and no body subject printed — a branch that could
  // not be reached, which the mutation run caught by surviving the deletion of it.
  const quantifier = e.quantifier ? e.quantifier + ' ' : '';
  return `${pad(level)}${keyword} ${quantifier}${printSubject(e.subject)} ${printMatcher(e.matcher)}`;
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
      return 'status' + networkRefRefusal(s.of, 'status');
    case 'DurationSubject':
      return 'duration';
    case 'RequestSubject':
      return 'request';
    case 'ResponseSubject':
      return 'response';
    case 'HeaderSubject':
      return `header ${printString(s.name)}` + networkRefRefusal(s.of, 'header "…"');
    case 'BodySubject':
      return 'body' + printBodyPath(s.path) + networkRefRefusal(s.of, 'body');
    case 'BodyTextSubject':
      return 'body text' + networkRefRefusal(s.of, 'body text');
    case 'BodyBytesSubject':
      return 'body bytes';
    case 'BodyCsvSubject':
      return 'body csv' + printBodyPath(s.path);
    case 'BodyPdfTextSubject':
      return 'body pdf text';
    case 'ValueSubject':
      return '{' + printRef(s.ref) + '}';
    default:
      return refuse(s.type, 'only the response subjects print in A1 — the browser’s are A3’s');
  }
}

function networkRefRefusal(of: { type: 'NetworkRequestRef' } | null, subject: string): string {
  if (of) refuse('NetworkRequestRef', `\`${subject} of request to "…"\` reads traffic observed on a live page, which is A3's`);
  return '';
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
