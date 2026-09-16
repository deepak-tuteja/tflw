// Form values → AST nodes — `M200` `A0-4` (`D1046`).
//
// The printer's input. A form holds numbers and words; `print` needs a node; these build one.
// They exist rather than letting the page write AST literals for two reasons. Every node carries
// a `span` it has no business inventing at each call site, and — the load-bearing one — **the
// parser refuses things a form can produce**, so a builder is where a refusal can be phrased in
// the form's own words instead of arriving later as a `422` from a write route about text the
// author never saw.
//
// The spans are `SYNTHETIC`. A node built here has never been in a file, which is the whole case
// for a printer (`D994`: "a printer is needed only to *insert* a node with no span"). `print`
// reads no spans at all, and `insertIntoSource` re-parses the formatted result, so the position
// a node is eventually diagnosed at is the one it really lands on.
import type { Position, Span } from './token.js';
import type { ApiBody, ApiHeader, ApiStep, ExpectStmt, HttpMethod, Matcher, MatcherName, PathSegment, Stage, Step, StringLit, Subject, TestDecl, ThresholdDecl, ThresholdMetric, ThresholdOp, Value, Workload } from './ast.js';
import { parse as parseTokens, parseStringParts } from './parser.js';
import { lex } from './lexer.js';

const ORIGIN: Position = { line: 1, column: 1, offset: 0 };
/** Every node built here carries this. It says "not from a file" rather than pretending to a
 *  position, which a zero-width span at the origin is the honest spelling of. */
export const SYNTHETIC: Span = { start: ORIGIN, end: ORIGIN };

export type BuildResult<T> = { readonly ok: true; readonly node: T } | { readonly ok: false; readonly reason: string };

const bad = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

/**
 * A string literal, **broken into interpolation parts the way the parser breaks one** — which is
 * `A1-4` paying off a note this function carried since `A0-4` ("interpolated text is `A1`'s").
 *
 * It mattered less than it looks and more than it seems. The BYTES were already right: `print`
 * rebuilds a string from its `parts`, and `escape` does not touch braces, so a text-only part
 * holding `Bearer {token}` printed `"Bearer {token}"` and the file meant interpolation. But the
 * NODE did not — the thing the form previewed and reasoned about was one text blob where the file
 * says text-plus-reference — so the two agreed by accident rather than by construction, and
 * anything that read the built node (a form saying which variables a step uses, a check that a
 * reference is bound) read a fiction. `parseStringParts` is the parser's own splitter, exported
 * already, so this is now the same function producing the same parts on both sides.
 */
export function stringLit(value: string): StringLit {
  return { type: 'StringLit', value, parts: parseStringParts(value), span: SYNTHETIC };
}

export interface StageSpec {
  readonly mode: 'jump' | 'ramp';
  readonly target: number;
  readonly durationMs: number;
}

export type WorkloadSpec =
  | { readonly kind: 'ramp'; readonly unit: 'users' | 'rps'; readonly target: number; readonly overMs: number }
  | { readonly kind: 'hold'; readonly unit: 'users' | 'rps'; readonly target: number; readonly forMs: number }
  | { readonly kind: 'step' | 'spike'; readonly unit: 'users' | 'rps'; readonly stages: readonly StageSpec[] }
  | { readonly kind: 'iterations'; readonly perUser: boolean; readonly count: number; readonly vus: number };

/**
 * The five workload shapes, as a form offers them.
 *
 * Every bound the parser enforces is enforced here, in the form's words rather than the parser's:
 * a positive target (`LOAD_INVALID`, `parser.ts:1323`), a positive duration, at least one stage
 * in a `step`/`spike` block, and — the one that is not a parser rule — **no ramped stage inside a
 * `step`**, because a `step` block has no spelling for one (`print.ts`'s `CONTEXT_BOUND`) and the
 * form would otherwise build a node nothing can write down.
 */
export function buildWorkload(spec: WorkloadSpec): BuildResult<Workload> {
  switch (spec.kind) {
    case 'ramp': {
      const e = positive(spec.target, 'a target') ?? duration(spec.overMs, 'the ramp');
      if (e) return bad(e);
      return spec.unit === 'users'
        ? { ok: true, node: { type: 'RampUsersWorkload', users: spec.target, overMs: spec.overMs, span: SYNTHETIC } }
        : { ok: true, node: { type: 'RampRpsWorkload', rps: spec.target, overMs: spec.overMs, span: SYNTHETIC } };
    }
    case 'hold': {
      const e = positive(spec.target, 'a target') ?? duration(spec.forMs, 'the hold');
      if (e) return bad(e);
      return spec.unit === 'users'
        ? { ok: true, node: { type: 'HoldUsersWorkload', users: spec.target, forMs: spec.forMs, span: SYNTHETIC } }
        : { ok: true, node: { type: 'HoldRpsWorkload', rps: spec.target, forMs: spec.forMs, span: SYNTHETIC } };
    }
    case 'step':
    case 'spike': {
      if (spec.stages.length === 0) return bad(`a \`${spec.kind}\` needs at least one stage`);
      const stages: Stage[] = [];
      for (const [i, s] of spec.stages.entries()) {
        const e = positive(s.target, `stage ${i + 1}'s target`) ?? duration(s.durationMs, `stage ${i + 1}`);
        if (e) return bad(e);
        if (spec.kind === 'step' && s.mode === 'ramp') {
          return bad(`a \`step\` block has no way to write a ramped stage — every stage jumps to its level. Use \`spike\` for a ramp.`);
        }
        stages.push({ type: 'Stage', mode: s.mode, target: s.target, durationMs: s.durationMs, span: SYNTHETIC });
      }
      const type = `${spec.kind === 'step' ? 'Step' : 'Spike'}${spec.unit === 'users' ? 'Users' : 'Rps'}Workload` as
        | 'StepUsersWorkload' | 'StepRpsWorkload' | 'SpikeUsersWorkload' | 'SpikeRpsWorkload';
      return { ok: true, node: { type, stages, span: SYNTHETIC } };
    }
    case 'iterations': {
      const e = positive(spec.count, 'an iteration count') ?? positive(spec.vus, 'a user count');
      if (e) return bad(e);
      return spec.perUser
        ? { ok: true, node: { type: 'PerVuIterationsWorkload', iterationsPerVu: spec.count, vus: spec.vus, span: SYNTHETIC } }
        : { ok: true, node: { type: 'SharedIterationsWorkload', iterations: spec.count, vus: spec.vus, span: SYNTHETIC } };
    }
  }
}

export interface ThresholdSpec {
  readonly metric: ThresholdMetric;
  readonly op: ThresholdOp;
  /** Milliseconds for a `duration` metric; a **percentage** for `errorRate` — the number the
   *  author types beside the `%`, not the fraction the AST stores. The conversion is here so the
   *  form never has to know that `1%` is `0.01` on the inside. */
  readonly bound: number;
  readonly scope: string | null;
}

export function buildThreshold(spec: ThresholdSpec): BuildResult<ThresholdDecl> {
  if (!Number.isFinite(spec.bound) || spec.bound < 0) return bad('a threshold needs a bound of zero or more');
  if (spec.metric.kind === 'duration') {
    if (!Number.isInteger(spec.metric.percentile) || spec.metric.percentile < 1 || spec.metric.percentile > 99) {
      return bad('a percentile is p1 to p99');
    }
  } else if (spec.bound > 100) {
    return bad('an error-rate bound is a percentage, so it cannot exceed 100');
  }
  const value = spec.metric.kind === 'duration' ? spec.bound : spec.bound / 100;
  return { ok: true, node: { type: 'ThresholdDecl', metric: spec.metric, op: spec.op, value, scope: spec.scope === null ? null : stringLit(spec.scope), span: SYNTHETIC } };
}

export interface TestSpec {
  readonly name: string;
  readonly tags: readonly string[];
  readonly workload: Workload | null;
  readonly thresholds: readonly ThresholdDecl[];
  readonly body: TestDecl['body'];
}

/** A whole `test`, with the fields a form does not offer left at the parser's own defaults —
 *  `retry 0`, `sequential`, no sessions, no table. A form that grows one of those sets it here. */
export function buildTest(spec: TestSpec): BuildResult<TestDecl> {
  if (spec.name.trim().length === 0) return bad('a test needs a name');
  for (const tag of spec.tags) {
    if (!/^[A-Za-z][\w-]*$/.test(tag)) return bad(`\`@${tag}\` is not a tag — a tag starts with a letter and holds letters, digits, \`_\` or \`-\``);
  }
  return {
    ok: true,
    node: {
      type: 'TestDecl',
      name: stringLit(spec.name),
      tags: spec.tags,
      sessions: [],
      retry: 0,
      table: null,
      workload: spec.workload,
      thresholds: spec.thresholds,
      concurrency: 'sequential',
      body: spec.body,
      span: SYNTHETIC,
    },
  };
}

function positive(n: number, what: string): string | null {
  if (!Number.isFinite(n)) return `${what} must be a number`;
  if (!Number.isInteger(n)) return `${what} must be a whole number`;
  return n > 0 ? null : `${what} must be greater than zero`;
}

function duration(ms: number, what: string): string | null {
  if (!Number.isFinite(ms)) return `${what} needs a duration`;
  if (!Number.isInteger(ms)) return `${what}'s duration must be a whole number of milliseconds`;
  return ms > 0 ? null : `${what} must last longer than zero`;
}


// ---- `A1-4` — the API form's nodes ------------------------------------------

/** What the API form holds: a method, a path, header rows, and one of the body forms. */
export interface ApiStepSpec {
  readonly service: string | null;
  readonly method: HttpMethod;
  /** `/orders/{orderId}?q=x` — raw, exactly as `PathExpr` stores it. */
  readonly path: string;
  readonly headers: readonly { readonly name: string; readonly value: string }[];
  readonly body: ApiBodySpec | null;
  /** `as "checkout"` — the load-report label, null for the automatic identity. */
  readonly label: string | null;
}

/** The four body shapes a form can offer. `upload` is deliberately absent: it names a file on the
 *  runner's disk, and a browser form has no way to say which. */
export type ApiBodySpec =
  | { readonly kind: 'json'; readonly text: string }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'form'; readonly fields: readonly { readonly key: string; readonly value: string }[] };

/**
 * A path is validated here rather than at the write route, because the parser reads it with a
 * **dedicated `path` token** and a form field is the one place a person can type something that
 * is not one. It must start with `/` — a relative path has no meaning against a base URL — and it
 * may hold no whitespace, because the lexer ends the token there and the rest of the line would
 * be read as clauses of the step.
 */
function apiPath(raw: string): string | null {
  if (!raw.startsWith('/')) return 'a request path starts with `/` — it is joined to the service’s base URL';
  if (/\s/.test(raw)) return 'a request path cannot contain a space';
  return null;
}

export function buildApiStep(spec: ApiStepSpec): BuildResult<ApiStep> {
  const pathProblem = apiPath(spec.path);
  if (pathProblem) return bad(pathProblem);
  if (spec.service !== null && !/^[A-Za-z_]\w*$/.test(spec.service)) return bad(`\`${spec.service}\` is not a service name — it is a bare word naming an \`api\` service in tflw.config`);
  if (spec.label !== null && spec.label.trim().length === 0) return bad('a label is the name this request reports under, so it cannot be blank');

  const headers: ApiHeader[] = [];
  for (const h of spec.headers) {
    if (h.name.trim().length === 0) return bad('a header needs a name');
    headers.push({ type: 'ApiHeader', name: stringLit(h.name), value: stringLit(h.value), span: SYNTHETIC });
  }

  let body: ApiBody | null = null;
  if (spec.body) {
    const built = buildBody(spec.body);
    if (!built.ok) return built;
    body = built.node;
  }

  return {
    ok: true,
    node: {
      type: 'ApiStep',
      service: spec.service,
      method: spec.method,
      path: { type: 'PathExpr', raw: spec.path, span: SYNTHETIC },
      body,
      headers,
      timeoutMs: null,
      followRedirects: true,
      retryAfter: null,
      tag: spec.label === null ? null : stringLit(spec.label),
      span: SYNTHETIC,
    },
  };
}

/**
 * A JSON body is **parsed, not trusted**. The form gives a textarea, and what a person types there
 * has to become an `ObjectLit`/`ArrayLit` before it can be printed — so it is run through the
 * language's own value parser, in the one position where the form's input is a *program fragment*
 * rather than a value. Refusing here names the line; letting it through would surface as a `422`
 * about text the author never saw, which is exactly what this module exists to prevent.
 */
function buildBody(spec: ApiBodySpec): BuildResult<ApiBody> {
  switch (spec.kind) {
    case 'text':
      return { ok: true, node: { type: 'TextBody', value: stringLit(spec.text), span: SYNTHETIC } };
    case 'file':
      if (spec.path.trim().length === 0) return bad('`body from` needs a file path');
      return { ok: true, node: { type: 'FileBody', path: stringLit(spec.path), span: SYNTHETIC } };
    case 'form': {
      if (spec.fields.length === 0) return bad('a form body needs at least one field');
      const fields = [];
      for (const f of spec.fields) {
        if (!/^[A-Za-z_]\w*$/.test(f.key)) return bad(`\`${f.key}\` is not a form field name — a form key is a bare word`);
        fields.push({ type: 'FormField' as const, key: f.key, value: stringLit(f.value), span: SYNTHETIC });
      }
      return { ok: true, node: { type: 'FormBody', fields, span: SYNTHETIC } };
    }
    case 'json': {
      const parsed = parseValueText(spec.text);
      if (!parsed.ok) return bad(parsed.reason);
      if (parsed.node.type !== 'ObjectLit' && parsed.node.type !== 'ArrayLit') {
        return bad('a `body` is a JSON object or array — for anything else, use the raw-text body');
      }
      return { ok: true, node: { type: 'InlineBody', value: parsed.node, span: SYNTHETIC } };
    }
  }
}

/** What the API form's assertion rows hold. The subject is named by the same words the language
 *  uses, so the form's vocabulary and the file's are one list. */
export interface ExpectSpec {
  readonly soft: boolean;
  readonly quantifier: 'any' | 'all' | null;
  readonly subject: SubjectSpec;
  readonly matcher: MatcherName;
  /** The operand as typed; parsed as a value, so `200`, `"json"` and `{ id: 1 }` all work. */
  readonly operand: string | null;
}

export type SubjectSpec =
  | { readonly kind: 'status' }
  | { readonly kind: 'duration' }
  | { readonly kind: 'request' }
  | { readonly kind: 'header'; readonly name: string }
  | { readonly kind: 'body'; readonly path: string }
  | { readonly kind: 'bodyText' }
  | { readonly kind: 'bodyBytes' }
  | { readonly kind: 'value'; readonly ref: string };

/** Matchers the API form offers: every one that takes an operand or takes none, minus the state,
 *  snapshot and scan families, which belong to doors that can actually produce them. */
const OPERANDLESS: ReadonlySet<MatcherName> = new Set<MatcherName>(['connects', 'fails']);

export function buildExpect(spec: ExpectSpec): BuildResult<ExpectStmt> {
  const subject = buildSubject(spec.subject);
  if (!subject.ok) return subject;

  if (spec.quantifier !== null && subject.node.type !== 'BodySubject') {
    // `quantifiable()` in `ast.ts` is the rule; the form can only reach one of its three members,
    // so this names the one it can.
    return bad('`any` and `all` quantify a body path — pick the `body` subject or drop the quantifier');
  }

  let value: Value | null = null;
  if (spec.operand !== null && spec.operand.trim() !== '') {
    const parsed = parseValueText(spec.operand);
    if (!parsed.ok) return bad(parsed.reason);
    value = parsed.node;
  } else if (!OPERANDLESS.has(spec.matcher)) {
    return bad(`\`${spec.matcher}\` compares against something — give it a value`);
  }
  if (value !== null && spec.matcher === 'connects') return bad('`connects` is true or false on its own and takes no value');

  const matcher: Matcher = { type: 'Matcher', name: spec.matcher, negated: false, value, span: SYNTHETIC };
  return { ok: true, node: { type: 'ExpectStmt', soft: spec.soft, quantifier: spec.quantifier, subject: subject.node, matcher, masks: [], span: SYNTHETIC } };
}

function buildSubject(spec: SubjectSpec): BuildResult<Subject> {
  switch (spec.kind) {
    case 'status':
      return { ok: true, node: { type: 'StatusSubject', of: null, span: SYNTHETIC } };
    case 'duration':
      return { ok: true, node: { type: 'DurationSubject', span: SYNTHETIC } };
    case 'request':
      return { ok: true, node: { type: 'RequestSubject', span: SYNTHETIC } };
    case 'bodyText':
      return { ok: true, node: { type: 'BodyTextSubject', of: null, span: SYNTHETIC } };
    case 'bodyBytes':
      return { ok: true, node: { type: 'BodyBytesSubject', span: SYNTHETIC } };
    case 'header':
      if (spec.name.trim().length === 0) return bad('a header subject needs a header name');
      return { ok: true, node: { type: 'HeaderSubject', name: stringLit(spec.name), of: null, span: SYNTHETIC } };
    case 'body': {
      const path = bodyPath(spec.path);
      if (typeof path === 'string') return bad(path);
      return { ok: true, node: { type: 'BodySubject', path, of: null, span: SYNTHETIC } };
    }
    case 'value': {
      const path = bodyPath(spec.ref);
      if (typeof path === 'string') return bad(path);
      if (path.length === 0) return bad('a `{value}` subject names a variable — write the name the `let` or `capture` bound');
      return { ok: true, node: { type: 'ValueSubject', ref: path, span: SYNTHETIC } };
    }
  }
}

/**
 * `items[0].price` → segments. Typed by a person, so it is validated rather than assumed: an
 * index must be a whole number and a property must be a bare word, because both are what the
 * parser's own `parseBodyPath` will demand when the file is read back.
 */
function bodyPath(raw: string): PathSegment[] | string {
  const trimmed = raw.trim().replace(/^\./, '');
  if (trimmed === '') return [];
  const segments: PathSegment[] = [];
  for (const piece of trimmed.split('.')) {
    const m = /^([A-Za-z_]\w*)((?:\[\d+\])*)$/.exec(piece);
    if (!m) return `\`${piece}\` is not a path segment — write a name, then optional \`[0]\` indexes`;
    segments.push({ kind: 'prop', name: m[1]! });
    for (const idx of m[2]!.matchAll(/\[(\d+)\]/g)) segments.push({ kind: 'index', index: Number(idx[1]) });
  }
  return segments;
}

/** Run one form field through the language's value parser. Wrapped in a `let` because that is the
 *  shortest program with a value in it, and unwrapped by reading the node back out. */
function parseValueText(text: string): { ok: true; node: Value } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, reason: 'this field is empty' };
  if (/[\n\r]/.test(trimmed)) return { ok: false, reason: 'a value is written on one line' };
  const lexed = lex(`test "_"\n  let _v = ${trimmed}\n`);
  const parsed = parseTokens(lexed.tokens);
  const error = [...lexed.diagnostics, ...parsed.diagnostics].find((d) => d.severity === 'error');
  if (error) return { ok: false, reason: error.message };
  const step: Step | undefined = parsed.program.tests[0]?.body[0];
  if (!step || step.type !== 'LetStmt') return { ok: false, reason: `\`${trimmed}\` is not a value this language can read` };
  return { ok: true, node: step.value };
}
