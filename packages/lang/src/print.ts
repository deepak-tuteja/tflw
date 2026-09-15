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
  ApiHeader,
  ApiStep,
  ExpectStmt,
  Matcher,
  Node,
  PathSegment,
  PauseStmt,
  Stage,
  StringLit,
  Subject,
  TestDecl,
  ThresholdDecl,
  Value,
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
 * Expect more of these as `A1`–`A4` widen the printer. The shape to watch for is a node whose
 * field was normalised on the way in, because a normalisation is a spelling decision the AST
 * stopped recording.
 */
export const CONTEXT_BOUND = new Set<string>(['Stage']);

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
  // `with each` is a table, and a table is `A1`'s: refusing here is cheaper than emitting a test
  // whose rows silently vanished.
  if (t.table) refuse('TestDecl', '`with each` tables are not printable yet');
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

function printPause(p: PauseStmt): string {
  return p.maxMs === null ? `pause ${duration(p.minMs)}` : `pause ${duration(p.minMs)} to ${duration(p.maxMs)}`;
}

// ---- steps -----------------------------------------------------------------

function printApiStep(a: ApiStep, level: number): string {
  if (a.body) refuse('ApiStep', `a request body (${a.body.type}) is not printable yet`);
  if (a.retryAfter) refuse('ApiStep', '`retry honoring "Retry-After"` is not printable yet');
  let head = pad(level) + 'api ';
  if (a.service) head += a.service + ' ';
  head += a.method + ' ' + a.path.raw;
  if (a.tag) head += ' as ' + printString(a.tag);
  if (a.timeoutMs !== null) head += ' timeout ' + duration(a.timeoutMs);
  if (!a.followRedirects) head += ' without redirects';
  const lines = [head];
  for (const h of a.headers) lines.push(pad(level + 1) + printHeader(h));
  return lines.join('\n');
}

function printHeader(h: ApiHeader): string {
  return `header ${printString(h.name)} is ${printValue(h.value)}`;
}

function printExpect(e: ExpectStmt, level: number): string {
  if (e.masks.length > 0) refuse('ExpectStmt', '`mask` clauses are not printable yet');
  // `any`/`all` quantify a body path and nothing else, and body subjects are `A1`'s — so a branch
  // that emitted the quantifier here could never be reached, which is exactly how the mutation run
  // found it: the mutation that deletes the quantifier SURVIVED, because no printable expect has
  // one. Unreachable code in a printer is untested code in a printer.
  if (e.quantifier) refuse('ExpectStmt', `the \`${e.quantifier}\` quantifier needs a body path, which is not printable yet`);
  const keyword = e.soft ? 'check' : 'expect';
  return `${pad(level)}${keyword} ${printSubject(e.subject)} ${printMatcher(e.matcher)}`;
}

function printSubject(s: Subject): string {
  if (s.type !== 'StatusSubject') refuse(s.type, 'only the `status` subject prints in A0');
  if (s.of) refuse('StatusSubject', '`of request to "…"` is not printable yet');
  return 'status';
}

function printMatcher(m: Matcher): string {
  const not = m.negated ? 'not ' : '';
  switch (m.name) {
    case 'equals':
      return `${not}equals ${operand(m)}`;
    case 'contains':
      return `${not}contains ${operand(m)}`;
    case 'lessThan':
      return `is ${not}less than ${operand(m)}`;
    case 'greaterThan':
      return `is ${not}greater than ${operand(m)}`;
    default:
      return refuse('Matcher', `the \`${m.name}\` matcher is not printable yet`);
  }
}

function operand(m: Matcher): string {
  if (!m.value) refuse('Matcher', `the \`${m.name}\` matcher needs an operand and has none`);
  return printValue(m.value);
}

// ---- values ----------------------------------------------------------------

function printValue(v: Value): string {
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
    default:
      return refuse(v.type);
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
