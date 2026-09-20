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
import type { AcceptDialogStmt, ApiBody, ApiHeader, ApiStep, ArrayLit, CallExpr, CallStmt, CaptureStmt, ClickKind, ClickStmt, CloseTabStmt, CsrfStmt, DataTable, DismissDialogStmt, DownloadBlock, DragStmt, DropFileStmt, ExpectStmt, FillFormRow, FillFormStmt, FillStmt, FindingSeverity, GiveStmt, HeaderStmt, HoverStmt, HttpMethod, LetStmt, Locator, LocatorKind, LogDestination, LogLevel, LogStmt, Matcher, MatcherName, NumberLit, ObjectLit, OpenStmt, PathSegment, PauseStmt, ScreenshotStmt, ScrollStmt, Stage, Step, StringLit, StubStmt, Subject, SwitchToNewTabBlock, SwitchToTabStmt, TestDecl, ThresholdDecl, ThresholdMetric, ThresholdOp, SelectStmt, TickStmt, UntickStmt, PressStmt, Value, WaitUntilApiStmt, WaitUntilUiStmt, WithinBlock, Workload } from './ast.js';
import { pollable, quantifiable } from './ast.js';
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
  /**
   * `as peer, shopper` — the principals the test runs under (`M200` `A2-3`).
   *
   * The comment below has said since `A0-4` that *a form that grows one of those sets it here*,
   * and the SCANS door is the first that must: `has no authorization violations` re-issues the
   * request under **other** principals, so a test with no owner gives it nothing to compare
   * against and the assertion reports *not probed* rather than passing or failing. Optional,
   * because the other two families read the response the test already fetched.
   */
  readonly sessions?: readonly string[];
  /**
   * THE THREE THAT WERE DEFAULTS UNTIL SOMETHING READ A TEST BACK (`M210` `S5a`).
   *
   * `retry`, `table` and `concurrency` were hardcoded here — `retry 0`, no table, `sequential` —
   * for the same reason `negated` was in `buildExpect`: a form that only ever *appends* a new test
   * never carries them, because nobody writes a new test retried, tabled or parallel. Reading one
   * back is the other direction, and the corpus says what that costs: **9 tests carry a retry, 12
   * carry a `with each` table and 2 are parallel**, and a rebuild without these fields drops each
   * one silently — a file that still parses and runs a different number of times.
   *
   * Absent still means the default, so every caller written before this means what it meant.
   */
  readonly retry?: number;
  readonly table?: DataTable | null;
  readonly concurrency?: TestDecl['concurrency'];
}

/** A whole `test`. `sessions` stopped being a hardcoded default in `A2-3`, and `retry`, `table` and
 *  `concurrency` in `M210` `S5a` — see `TestSpec`. */
export function buildTest(spec: TestSpec): BuildResult<TestDecl> {
  if (spec.name.trim().length === 0) return bad('a test needs a name');
  for (const tag of spec.tags) {
    if (!/^[A-Za-z][\w-]*$/.test(tag)) return bad(`\`@${tag}\` is not a tag — a tag starts with a letter and holds letters, digits, \`_\` or \`-\``);
  }
  if (spec.retry !== undefined && (!Number.isInteger(spec.retry) || spec.retry < 0)) {
    return bad('a retry count is a whole number of extra attempts — 0 is no retry at all');
  }
  for (const session of spec.sessions ?? []) {
    // Same rule the parser reads a session name by (`expect('ident')`), stated here so the refusal
    // lands in the field rather than as a file the parser rejects.
    if (!/^[A-Za-z_][\w]*$/.test(session)) return bad(`\`${session}\` is not a session name — it starts with a letter or \`_\` and holds letters, digits or \`_\``);
  }
  return {
    ok: true,
    node: {
      type: 'TestDecl',
      name: stringLit(spec.name),
      tags: spec.tags,
      sessions: spec.sessions ?? [],
      retry: spec.retry ?? 0,
      table: spec.table ?? null,
      workload: spec.workload,
      thresholds: spec.thresholds,
      concurrency: spec.concurrency ?? 'sequential',
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

/**
 * What the API form holds: a method, a path, header rows, one of the body forms, and — since
 * `M214` `A2` — the three clauses this interface used to have no room for.
 *
 * **THE THREE OPTIONAL FIELDS ARE WHY `M214` EXISTS, AND THE APOLOGY THEY REPLACE WAS FALSE.**
 * `ApiRequestSpec` (`ast.ts`) has carried `timeoutMs`, `followRedirects` and `retryAfter` since the
 * enterprise arc, and `print()` has written all three for just as long. What stopped at six fields
 * was **this** interface — the builder's input — and the pane said so 1058 times, on every request
 * in the corpus, as three permanently-disabled menu rows each repeating *"the request spec has no
 * room for it yet; it is carried across an edit, not rebuilt"*. That sentence described one
 * interface in one file and read as a statement about the language. Measured over the corpus the
 * three clauses are used **five times in a thousand requests** combined, which is what made three
 * dead rows on every request the worst trade in the pane.
 *
 * **THEY ARE OPTIONAL RATHER THAN REQUIRED, AND THE DEFAULTS ARE THE LANGUAGE'S OWN.** A spec that
 * omits them builds the node the six-field spec always built — `timeoutMs: null`,
 * `followRedirects: true`, `retryAfter: null` — so every existing caller that constructs a *fresh*
 * request (`+ request`, `+ wait until`, the importers) keeps its exact behaviour and needed no
 * edit. The hazard that shape carries is real and is stated here rather than discovered later: a
 * caller that **rebuilds an existing request** from a spec it filled in by hand, and forgets one of
 * these, silently drops that clause from the file. The one caller that does that is Compose's
 * request editor, and it fills all three from `RequestEdit`, which reads them off the node.
 */
export interface ApiStepSpec {
  readonly service: string | null;
  readonly method: HttpMethod;
  /** `/orders/{orderId}?q=x` — raw, exactly as `PathExpr` stores it. */
  readonly path: string;
  readonly headers: readonly { readonly name: string; readonly value: string }[];
  readonly body: ApiBodySpec | null;
  /** `as "checkout"` — the load-report label, null for the automatic identity. */
  readonly label: string | null;
  /** `timeout <dur>` for this request alone, in milliseconds. Absent and `null` both mean *the
   *  env's*, which is what 1057 of the corpus's 1058 requests say. */
  readonly timeoutMs?: number | null;
  /** `without redirects` is `false` here. Absent means `true` — the language's own default, and
   *  what every request in both corpora but one writes. */
  readonly followRedirects?: boolean;
  /** `retry honoring "Retry-After" up to N` — the N. Absent and `null` both mean the clause is not
   *  written. Three requests in the corpus carry one. */
  readonly retryAfter?: number | null;
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
  // Absent is not wrong (`M205` Q9/Q11). The API form opens with this field EMPTY — a default
  // request is a guess about somebody's project, and the one that shipped guessed `/orders`
  // against a scaffold whose service answers `/health` and nothing else (`M205-02`). So this
  // message is the first thing the door says, and it is a next step rather than a complaint.
  // Telling a blank field it does not start with a slash is true, unhelpful, and reads as a
  // refusal of something the author has not done yet.
  if (raw.length === 0) return 'a request path, like `/orders` or `/orders/{orderId}` — it is joined to the service’s base URL';
  if (!raw.startsWith('/')) return 'a request path starts with `/` — it is joined to the service’s base URL';
  if (/\s/.test(raw)) return 'a request path cannot contain a space';
  return null;
}

export function buildApiStep(spec: ApiStepSpec): BuildResult<ApiStep> {
  const pathProblem = apiPath(spec.path);
  if (pathProblem) return bad(pathProblem);
  if (spec.service !== null && !/^[A-Za-z_]\w*$/.test(spec.service)) return bad(`\`${spec.service}\` is not a service name — it is a bare word naming an \`api\` service in tflw.config`);
  if (spec.label !== null && spec.label.trim().length === 0) return bad('a label is the name this request reports under, so it cannot be blank');
  /* The three `M214` `A2` clauses, each refused rather than rounded. A timeout is a duration the
     lexer reads as a whole number of milliseconds, so a fractional one is not expressible and a
     zero one is a request that has already run out of time before it is sent. */
  if (spec.timeoutMs !== undefined && spec.timeoutMs !== null) {
    const problem = duration(spec.timeoutMs, 'a request timeout');
    if (problem) return bad(problem);
  }
  if (spec.retryAfter !== undefined && spec.retryAfter !== null) {
    const problem = positive(spec.retryAfter, 'a `Retry-After` attempt count');
    if (problem) return bad(problem);
  }

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
      /* Absent is the language's default and not a missing value — see `ApiStepSpec`. */
      timeoutMs: spec.timeoutMs ?? null,
      followRedirects: spec.followRedirects ?? true,
      retryAfter:
        spec.retryAfter === undefined || spec.retryAfter === null
          ? null
          : { type: 'RetryAfterClause', max: spec.retryAfter, span: SYNTHETIC },
      tag: spec.label === null ? null : stringLit(spec.label),
      span: SYNTHETIC,
    },
  };
}

/**
 * `wait until api <request>` and the expects it polls against — `M213` `S3` (`D1102`).
 *
 * **IT IS BUILT OUT OF THE TWO BUILDERS THAT ALREADY EXIST, WHICH IS THE WHOLE REASON IT IS
 * CHEAP.** A `WaitUntilApiStmt` is an `ApiRequestSpec` and a list of `ExpectStmt` — the same two
 * shapes `buildApiStep` and `buildExpect` produce — so this validates nothing of its own beyond
 * the one thing neither of them can see: **a poll with no expects never stops early.** `expects`
 * is what the loop is waiting *for*, and an empty list makes the statement mean *issue this
 * request until the wait budget runs out*, which is a sleep spelled as a poll and is never what
 * anybody meant. The parser admits it (an empty block is a block), so refusing here is the form
 * declining to write a statement the language would accept and the author would not want.
 *
 * `ApiStep`'s own clauses that `ApiStepSpec` cannot carry — `timeoutMs`, `followRedirects`,
 * `retryAfter` — are dropped rather than invented, because `ApiRequestSpec` is the shared shape
 * and a `wait until` written from a form has none of them. `waitMs` is this step's own poll
 * budget (`D640`), `null` for the env's.
 */
export function buildWaitUntilApi(spec: { readonly request: ApiStepSpec; readonly expects: readonly ExpectSpec[]; readonly waitMs: number | null }): BuildResult<WaitUntilApiStmt> {
  const request = buildApiStep(spec.request);
  if (!request.ok) return request;
  if (spec.expects.length === 0) {
    return bad('`wait until api` polls until something is true — give it at least one assertion, or it is a sleep with a request in it');
  }
  if (spec.waitMs !== null && (!Number.isFinite(spec.waitMs) || spec.waitMs <= 0)) {
    return bad('a wait budget is a duration — leave it blank for the env\'s own `timeout wait`');
  }
  const expects: ExpectStmt[] = [];
  for (const e of spec.expects) {
    const built = buildExpect(e);
    if (!built.ok) return built;
    expects.push(built.node);
  }
  const { type: _ignored, span: _span, ...shared } = request.node;
  return {
    ok: true,
    node: { type: 'WaitUntilApiStmt', request: shared, expects, waitMs: spec.waitMs, span: SYNTHETIC },
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
  /**
   * `has no [<severity>] … violations`'s optional floor (`M200` `A2-3`).
   *
   * A **floor**, not an exact-match filter: `serious` also counts `critical`. Omitted means every
   * severity counts, and that is the commoner spelling — 72 of the corpus' 102 scan assertions name
   * none. Meaningful only for the scan matchers; supplying it with any other is a refusal rather
   * than a silent drop, because a form that ignored it would show a severity the file does not have.
   */
  readonly severityFloor?: FindingSeverity;
  /**
   * `not equals` — the one field whose absence **inverts an assertion** (`M210` `S3a`).
   *
   * It was not here at all until `M210` came to edit an expect that already exists, and until then
   * that was harmless: `A1-3`'s form only ever *appended* a new assertion, and nobody writes a new
   * one negated. Reading one back is the other direction. **82 of the sibling's expects and 10 of
   * this repository's are negated**, so a card that rebuilt a statement from a spec with no room
   * for this would turn `expect status not equals 500` into `expect status equals 500` — a file
   * that still parses, still runs, and asserts the opposite of what its author wrote.
   *
   * Absent means `false`, which is what every caller before `M210` meant by saying nothing.
   */
  readonly negated?: boolean;
  /**
   * `matches schema "Order" from [<service>] "openapi.json"` — the operand this matcher spells as a
   * trailing clause instead of as a value (`M210` `S3a`).
   *
   * Three matchers do that, and until now the builder could construct none of them: each fell
   * through to the *"compares against something — give it a value"* refusal, which is a true
   * sentence about a matcher that takes its operand somewhere else. 25 assertions across the two
   * corpora, all of them API-door work in the case of `matches schema` and `matches file`.
   */
  readonly schema?: { readonly name: string; readonly source: string; readonly service?: string };
  /** `matches file "<path>"` — see `schema` above. */
  readonly filePath?: string;
  /** `matches snapshot "<name>"` — see `schema` above. Its `mask` clauses are **not** here: a mask
   *  is a locator list, and a caller that holds one holds the nodes already. */
  readonly snapshotName?: string;
}

export type SubjectSpec =
  | { readonly kind: 'status' }
  | { readonly kind: 'duration' }
  | { readonly kind: 'request' }
  | { readonly kind: 'header'; readonly name: string }
  | { readonly kind: 'body'; readonly path: string }
  | { readonly kind: 'bodyText' }
  | { readonly kind: 'bodyBytes' }
  | { readonly kind: 'value'; readonly ref: string }
  /** `expect response has no … violations` (`M200` `A2-3`). The whole-response subject, which only
   *  the scan matchers take — every other matcher wants a part of it. */
  | { readonly kind: 'response' }
  /** `expect button "Buy" is visible` (`M200` `A3-5`). The browser's subject — 641 of them in the
   *  corpus, more than every response subject but `status`. */
  | { readonly kind: 'locator'; readonly locator: LocatorSpec }
  /** `expect page has no a11y violations` (`M200` `A3-5`). Carries no data of its own; `ast.ts`
   *  calls it and `response` deliberately parallel. */
  | { readonly kind: 'page' }
  /* ── The three browser subjects no form has ever offered — `M219` `G` (`D1166`) ───────────────
   *
   * Measured when `M219` was scoped: the language has **16** assertion subjects and every door's
   * select offered **11**. These three are browser-only, appear **26 times** across the two
   * corpora, and had never been offered anywhere — not dropped by a table, simply never listed.
   * That is the silent-omission failure `D1076` refuses, which is why they land here rather than
   * behind a decision about which door deserves them. */
  /** `expect request to "<url>" [with method "<M>"] was made` — a request the page itself made. */
  | { readonly kind: 'networkRequest'; readonly urlPattern: string; readonly method: string }
  /** `expect dialog message equals "…"` — what the native dialog said. */
  | { readonly kind: 'dialogMessage' }
  /** `expect dialog type equals "prompt"` — which kind of native dialog it was. */
  | { readonly kind: 'dialogType' };

/**
 * A locator, as a form holds it — `M200` `A3-5`.
 *
 * **Two fields, because the node has two**, on all 2,296 corpus instances with no optional clause
 * anywhere (`§4f`). That is why the BROWSER form is a dropdown beside a text box rather than a
 * panel: there is nothing else to offer.
 */
export interface LocatorSpec {
  readonly kind: LocatorKind;
  readonly value: string;
}

/** Matchers the forms offer: every one that takes an operand or takes none, minus the state and
 *  snapshot families, which belong to doors that can actually produce them. **The scan family was
 *  in that list until `A2-3`, which is the door that can** — so it is below rather than excluded. */
const OPERANDLESS: ReadonlySet<MatcherName> = new Set<MatcherName>([
  'connects', 'fails',
  'hasNoSecurityViolations', 'hasNoAuthzViolations', 'hasNoInputHandlingViolations',
  // `A3-5` — `hasNoA11yViolations` joins its three siblings now that `page` is reachable, and the
  // five state words join for the reason `A3-3` gave: `parser.ts` holds them in one closed
  // `STATE_WORDS` family, and 0 of the corpus' 622 carries a value.
  'hasNoA11yViolations',
  'visible', 'hidden', 'enabled', 'disabled', 'checked',
  // `M210` `S3a` — four more, and none of them is a new capability: each is a matcher the corpus
  // writes and this builder refused. `was made` takes nothing at all (**13 occurrences, 0 with a
  // value**); the other three take their operand as a trailing clause, which `CLAUSE_OF` below is
  // where that is said. The name of this set is what it has always meant — *may omit the value* —
  // and the three clause matchers are refused **below** if a value is given anyway.
  'wasMade',
  'matchesSchema', 'matchesFile', 'matchesSnapshot',
]);

/** The five state words, as one closed family — `parser.ts`'s `STATE_WORDS` (`A3-3`). */
const STATE_MATCHERS: ReadonlySet<MatcherName> = new Set<MatcherName>(['visible', 'hidden', 'enabled', 'disabled', 'checked']);

/**
 * The scan families, each with the subject it grades — `M200` `A2-3`, completed in `A3-5`.
 *
 * **A map rather than a set, because `a11y` does not take the same subject as the other three.**
 * `hasNoA11yViolations` grades the live `page`; the other three grade the last `response`. That
 * asymmetry is the whole reason `A2-3` had to leave a11y out — its subject did not exist yet —
 * and writing it as a set with one subject rule would have made `expect response has no a11y
 * violations` buildable, which `parseExpect` does not accept.
 */
const SCAN_SUBJECT: ReadonlyMap<MatcherName, Subject['type']> = new Map<MatcherName, Subject['type']>([
  ['hasNoSecurityViolations', 'ResponseSubject'],
  ['hasNoAuthzViolations', 'ResponseSubject'],
  ['hasNoInputHandlingViolations', 'ResponseSubject'],
  ['hasNoA11yViolations', 'PageSubject'],
]);

/**
 * The three matchers whose operand is a **trailing clause** rather than a value (`M210` `S3a`).
 *
 * `printMatcher` refuses each of them without its clause — `\`matches schema\` needs a schema name
 * and a source` — so a builder that could not supply one could never produce a node the printer
 * would take. That is why these three were unreachable from every form until now rather than
 * merely awkward, and it is the shape to watch for: a field that is optional on the *type* and
 * required by the *spelling*.
 */
const CLAUSE_OF: ReadonlyMap<MatcherName, 'schema' | 'filePath' | 'snapshotName'> = new Map<MatcherName, 'schema' | 'filePath' | 'snapshotName'>([
  ['matchesSchema', 'schema'],
  ['matchesFile', 'filePath'],
  ['matchesSnapshot', 'snapshotName'],
]);

export function buildExpect(spec: ExpectSpec): BuildResult<ExpectStmt> {
  const subject = buildSubject(spec.subject);
  if (!subject.ok) return subject;

  if (spec.quantifier !== null && !quantifiable(subject.node)) {
    // **`quantifiable()` in `ast.ts` IS the rule, and this used to only name one of its three
    // members** (`M210` `S3a`). That was true of what a form could *reach* and false of the
    // language, and the corpus says so: **3 of the 85 quantified assertions quantify a `body csv`
    // path**, which this refused. A caller that substitutes a subject the spec cannot spell — the
    // way `M210`'s card carries a `body csv` subject across an edit — would have met a refusal
    // about a file that parses. The predicate the language publishes is the one to ask.
    return bad('`any` and `all` quantify a list — pick a `body` path, a `body csv` path or a `{value}`, or drop the quantifier');
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

  // The scan family (`M200` `A2-3`). Three rules, each of them a refusal the form can show in a
  // field rather than a file the parser would reject:
  //   - it never takes an operand, like `connects`;
  //   - its only subject here is `response` — `page` is `A3`'s, and `parseExpect` takes no other;
  //   - the severity floor belongs to it and to nothing else.
  const scanSubject = SCAN_SUBJECT.get(spec.matcher);
  const isScan = scanSubject !== undefined;
  if (isScan && value !== null) return bad(`\`${spec.matcher}\` grades a whole subject against a rule family and takes no value`);
  if (isScan && subject.node.type !== scanSubject) {
    return bad(
      scanSubject === 'PageSubject'
        ? 'a11y findings are read off the live page — pick the `page` subject'
        : 'a `has no … violations` matcher grades the whole response — pick the `response` subject',
    );
  }
  if (spec.severityFloor !== undefined && !isScan) return bad('a severity floor belongs to `has no … violations`, which is the only matcher that grades findings');
  // The state family takes no operand and this is where that is said, but its SUBJECT is
  // deliberately unrestricted — the grammar puts no rule there and the corpus proves it, carrying
  // `expect status is visible` and one on a `{value}`. `A3-3`'s printer made the same call: a
  // builder that invented a locator-only rule would refuse two files that exist.
  if (value !== null && STATE_MATCHERS.has(spec.matcher)) return bad(`\`${spec.matcher}\` is a state, so it is true or false on its own and takes no value`);

  // The trailing-clause family (`M210` `S3a`), checked the way the severity floor above is: a
  // clause offered to a matcher that does not take one is a refusal rather than a silent drop,
  // because a form that ignored it would show a schema name the file does not have.
  const clause = CLAUSE_OF.get(spec.matcher);
  const given = { schema: spec.schema, filePath: spec.filePath, snapshotName: spec.snapshotName };
  for (const [key, held] of Object.entries(given)) {
    if (held === undefined || key === clause) continue;
    return bad(`\`${key === 'schema' ? 'matches schema' : key === 'filePath' ? 'matches file' : 'matches snapshot'}\`'s clause belongs to that matcher, not to \`${spec.matcher}\``);
  }
  if (clause !== undefined && value !== null) return bad(`\`${spec.matcher}\` takes its operand as the clause after it, not as a value`);
  let extra: Partial<Matcher> = {};
  if (clause === 'schema') {
    if (spec.schema === undefined || spec.schema.name.trim() === '' || spec.schema.source.trim() === '') {
      return bad('`matches schema` names a schema and the document it lives in — give it both');
    }
    extra = {
      schemaName: stringLit(spec.schema.name),
      schemaSource: stringLit(spec.schema.source),
      ...(spec.schema.service === undefined || spec.schema.service.trim() === '' ? {} : { schemaService: spec.schema.service.trim() }),
    };
  } else if (clause === 'filePath') {
    if (spec.filePath === undefined || spec.filePath.trim() === '') return bad('`matches file` compares against a file — give it a path');
    extra = { filePath: stringLit(spec.filePath) };
  } else if (clause === 'snapshotName') {
    if (spec.snapshotName === undefined || spec.snapshotName.trim() === '') return bad('`matches snapshot` names the baseline it compares against — give it a name');
    extra = { snapshotName: stringLit(spec.snapshotName) };
  }

  const matcher: Matcher = { type: 'Matcher', name: spec.matcher, negated: spec.negated === true, value, span: SYNTHETIC, ...extra, ...(spec.severityFloor === undefined ? {} : { severityFloor: spec.severityFloor }) };
  return { ok: true, node: { type: 'ExpectStmt', soft: spec.soft, quantifier: spec.quantifier, subject: subject.node, matcher, masks: [], span: SYNTHETIC } };
}

/**
 * THE SCRIPT STATEMENTS (`M210` `S4a`) — the six a test body has that are not a request and not an
 * assertion, and that no builder existed for at all.
 *
 * They are what a test does *between* its requests, and the corpus is mostly made of them: **793
 * `capture`, 321 `let`, 184 `call`, 71 `log`, 8 `give`, 4 `pause`** across the two corpora — more
 * statements than there are requests.
 *
 * **`header` AND `csrf` ARE NOT HERE, AND THE REASON IS A FACT ABOUT THE GRAMMAR RATHER THAN A
 * SCOPE DECISION.** `M210`'s plan lists both under this slice and they have **0 occurrences in
 * either corpus's `.tflw` files** — because the parser dispatches them only inside a `session`
 * block of a `tflw.config`, and says so where it does: `header "X" is "Y"` means something
 * different for a credential than for a request, and `csrf from …` "means nothing at all outside a
 * session". A builder for a node no test body can hold would be a branch nothing can reach, which
 * is the shape this repository refuses. `STEP_LENS` calling both the api door's is right about the
 * *lens* and misleading read as a list of what a body may contain.
 *
 * **THE NAMING RULE IS NOT RE-STATED HERE, DELIBERATELY.** `let`, `capture` and a call's name must
 * be words this language can write back, and `print` already refuses each with a sentence naming
 * the offending word. A second copy of that rule in this file is the drift this repository files
 * findings against — so these builders validate what is *theirs* (a value that will not parse, a
 * duration that is not one, a subject that does not fit) and leave the spelling to the printer,
 * whose refusal reaches the same field either way.
 */
/**
 * `select`, `tick`/`untick` and `press` — `M213` `S5` (`D1095`).
 *
 * **THE RECORDER IS WHAT NEEDED THEM, AND IT NEEDED THEM FOR A REASON WORTH STATING.** `D1095`
 * says the recorder emits **actions only** and that every one goes through a builder and the
 * printer rather than through string concatenation — which is not fastidiousness: a recorder
 * writes whatever the page gave it, and a page's `<option>` text is arbitrary user content. One
 * apostrophe in a product name turns a concatenated `select … with 'Women's'` into a file that
 * does not lex, and the recording is lost after the session is closed. A builder is where the
 * value becomes a `StringLit` that the printer knows how to quote.
 *
 * `buildClick`, `buildFill` and `buildOpen` already existed for `M200` `A3-5`'s BROWSER form. These
 * four are the rest of what a person does to a page that is not a click or a keystroke into a text
 * field, and they carry no options between them: a `select` takes one value, a tick takes none, and
 * a press takes a key and optionally the control it is typed into.
 */
export interface SelectSpec {
  readonly locator: LocatorSpec;
  /** As typed or as recorded, parsed as a **value** — `buildFill`'s rule, for its reason. */
  readonly value: string;
}

export function buildSelect(spec: SelectSpec): BuildResult<SelectStmt> {
  const locator = buildLocator(spec.locator);
  if (!locator.ok) return locator;
  const value = parseValueText(spec.value);
  if (!value.ok) return bad(value.reason);
  return { ok: true, node: { type: 'SelectStmt', locator: locator.node, value: value.node, span: SYNTHETIC } };
}

/** `tick`/`untick` — one builder, because the two nodes differ in exactly their type and a caller
 *  that has a checkbox's state has a boolean rather than a choice of two functions. */
export function buildCheck(spec: { readonly locator: LocatorSpec; readonly ticked: boolean }): BuildResult<TickStmt | UntickStmt> {
  const locator = buildLocator(spec.locator);
  if (!locator.ok) return locator;
  return { ok: true, node: { type: spec.ticked ? 'TickStmt' : 'UntickStmt', locator: locator.node, span: SYNTHETIC } };
}

export interface PressSpec {
  /** A key name or a chord — `"Enter"`, `"Control+A"`. Playwright's own spelling, which the
   *  runtime passes through, so this validates that it is *something* rather than which key it is:
   *  a list here would be a second copy of a table the browser owns. */
  readonly keys: string;
  /** The control the key is typed into, or `null` for the page. 
   *
   *  **Preferred when there is one**, which is why a recorder records it: `press "Enter"` at page
   *  level goes to whatever has focus, and *whatever has focus* is a fact about the moment rather
   *  than about the test. */
  readonly locator: LocatorSpec | null;
}

export function buildPress(spec: PressSpec): BuildResult<PressStmt> {
  if (spec.keys.trim().length === 0) return bad('`press` needs a key — `"Enter"`, `"Tab"`, or a chord like `"Control+A"`');
  let locator: Locator | null = null;
  if (spec.locator !== null) {
    const built = buildLocator(spec.locator);
    if (!built.ok) return built;
    locator = built.node;
  }
  return { ok: true, node: { type: 'PressStmt', keys: stringLit(spec.keys), locator, span: SYNTHETIC } };
}

export interface CaptureSpec {
  readonly subject: SubjectSpec;
  /** The variable this binds. */
  readonly name: string;
}

export function buildCapture(spec: CaptureSpec): BuildResult<CaptureStmt> {
  const subject = buildSubject(spec.subject);
  if (!subject.ok) return subject;
  // `D130` — a capture reads a response, so a `{variable}` is not a thing it can read. The printer
  // says so too; saying it here means the form can show it before the write rather than after.
  if (subject.node.type === 'ValueSubject') return bad('`capture` reads a value out of a response — a `{variable}` is already a value');
  return { ok: true, node: { type: 'CaptureStmt', subject: subject.node, name: spec.name, span: SYNTHETIC } };
}

export interface LetSpec {
  readonly name: string;
  /** As typed, and parsed as a value — which is the whole value grammar: **23 different kinds**
   *  across the corpus's 321 `let`s, more generators and transforms than literals. A structured
   *  editor for that is a second parser; a text field beside the language's own is not. */
  readonly value: string;
}

export function buildLet(spec: LetSpec): BuildResult<LetStmt> {
  const value = parseValueText(spec.value);
  if (!value.ok) return bad(value.reason);
  return { ok: true, node: { type: 'LetStmt', name: spec.name, value: value.node, span: SYNTHETIC } };
}

export interface LogSpec {
  readonly level: LogLevel;
  readonly message: string;
  readonly destination: LogDestination | null;
}

export function buildLog(spec: LogSpec): BuildResult<LogStmt> {
  return { ok: true, node: { type: 'LogStmt', level: spec.level, message: stringLit(spec.message), destination: spec.destination, span: SYNTHETIC } };
}

export interface CallSpec {
  readonly name: string;
  /** Each argument as typed — 160 of the corpus's 184 calls take two, 16 take none. */
  readonly args: readonly string[];
}

export function buildCall(spec: CallSpec): BuildResult<CallStmt> {
  const args: Value[] = [];
  for (const [i, arg] of spec.args.entries()) {
    const parsed = parseValueText(arg);
    if (!parsed.ok) return bad(`argument ${i + 1}: ${parsed.reason}`);
    args.push(parsed.node);
  }
  const call: CallExpr = { type: 'CallExpr', name: spec.name, args, span: SYNTHETIC };
  return { ok: true, node: { type: 'CallStmt', call, span: SYNTHETIC } };
}

export function buildGive(value: string): BuildResult<GiveStmt> {
  const parsed = parseValueText(value);
  if (!parsed.ok) return bad(parsed.reason);
  return { ok: true, node: { type: 'GiveStmt', value: parsed.node, span: SYNTHETIC } };
}

export interface PauseSpec {
  /** A duration as the language writes one (`500ms`, `2s`) — read by the value parser rather than
   *  by a number field and a unit, so `pause 1m` is one thing to type and one thing to store. */
  readonly min: string;
  /** The upper bound of `pause A to B`, or blank for a fixed pause — which all 4 in the corpus are. */
  readonly max: string;
}

export function buildPause(spec: PauseSpec): BuildResult<PauseStmt> {
  const ms = (text: string): number | string => {
    const parsed = parseValueText(text);
    if (!parsed.ok) return parsed.reason;
    if (parsed.node.type !== 'DurationLit') return `\`${text.trim()}\` is not a length of time — write it as \`500ms\`, \`2s\` or \`1m\``;
    return parsed.node.ms;
  };
  const min = ms(spec.min);
  if (typeof min === 'string') return bad(min);
  if (spec.max.trim() === '') return { ok: true, node: { type: 'PauseStmt', minMs: min, maxMs: null, span: SYNTHETIC } };
  const max = ms(spec.max);
  if (typeof max === 'string') return bad(max);
  if (max < min) return bad('a pause counts up — its second length cannot be shorter than its first');
  return { ok: true, node: { type: 'PauseStmt', minMs: min, maxMs: max, span: SYNTHETIC } };
}

/**
 * `with each` — `M210` `S5`.
 *
 * Twelve tests in the two corpora carry one, **nine inline** (the largest 3 rows by 3 columns) and
 * three reading a file. The cells are the whole value grammar, same as a `let`, so each is parsed
 * rather than quoted: a table's column of ids is `1`, `2`, `3` and not `"1"`, `"2"`, `"3"`.
 */
export type DataTableSpec =
  | { readonly kind: 'inline'; readonly columns: readonly string[]; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: 'file'; readonly path: string };

export function buildDataTable(spec: DataTableSpec): BuildResult<DataTable> {
  if (spec.kind === 'file') {
    if (spec.path.trim() === '') return bad('a `with each from` needs a path to read the rows from');
    return { ok: true, node: { type: 'FileDataTable', path: stringLit(spec.path.trim()), span: SYNTHETIC } };
  }
  if (spec.columns.length === 0) return bad('a `with each` table needs at least one column');
  if (spec.rows.length === 0) return bad('a `with each` table needs at least one row of values');
  const rows: Value[][] = [];
  for (const [r, row] of spec.rows.entries()) {
    if (row.length !== spec.columns.length) return bad(`row ${r + 1} has ${row.length} cell(s) and the header has ${spec.columns.length}`);
    const cells: Value[] = [];
    for (const [c, cell] of row.entries()) {
      const parsed = parseValueText(cell);
      if (!parsed.ok) return bad(`row ${r + 1}, ${spec.columns[c]}: ${parsed.reason}`);
      cells.push(parsed.node);
    }
    rows.push(cells);
  }
  return { ok: true, node: { type: 'InlineDataTable', columns: spec.columns, rows, span: SYNTHETIC } };
}

/** Every locator kind the grammar has, for a form's dropdown — the parser's own list, re-exported
 *  rather than re-typed, so a seventh kind reaches the form the day it reaches the language. */
export const LOCATOR_KINDS: readonly LocatorKind[] = ['button', 'field', 'text', 'list', 'css', 'xpath'];

/**
 * `button "Sign in"` — `M200` `A3-5`.
 *
 * The only refusal is an empty value, and it is worth one because the parser accepts `button ""`
 * happily: a locator matching nothing is a test that fails at run time for a reason the file does
 * not show. A form can say so in the field instead.
 */
export function buildLocator(spec: LocatorSpec): BuildResult<Locator> {
  if (spec.value.trim().length === 0) {
    return bad(`a \`${spec.kind}\` locator needs something to match — the accessible name, the text, or the selector`);
  }
  return { ok: true, node: { type: 'Locator', kind: spec.kind, value: stringLit(spec.value), span: SYNTHETIC } };
}

/** `open "/checkout"` — `M200` `A3-5`. The path is a plain interpolation-aware string, so unlike
 *  `buildApiStep`'s it carries no method or service to gate a contextual `/` on, and is resolved
 *  against the env's `web` base rather than its `api` one. */
export function buildOpen(path: string): BuildResult<OpenStmt> {
  if (path.trim().length === 0) return bad('`open` needs a path — the page to navigate to, resolved against the env’s `web` base');
  return { ok: true, node: { type: 'OpenStmt', path: stringLit(path), span: SYNTHETIC } };
}

export interface ClickSpec {
  readonly locator: LocatorSpec;
  /** `single` is 770 of the corpus's 774 clicks; the other two are two each. */
  readonly kind: ClickKind;
}

/** `click button "Buy"` / `double click …` / `right click …` — `M200` `A3-5`. */
export function buildClick(spec: ClickSpec): BuildResult<ClickStmt> {
  const locator = buildLocator(spec.locator);
  if (!locator.ok) return locator;
  return { ok: true, node: { type: 'ClickStmt', kind: spec.kind, locator: locator.node, span: SYNTHETIC } };
}

export interface FillSpec {
  readonly locator: LocatorSpec;
  /** As typed, parsed as a **value** — so `"text"`, `{captured}` and `env(NAME)` all work. The
   *  corpus fills with `StringLit` 422 times, `EnvRef` 12 and `Interp` 3, so a field that only
   *  accepted a string would be right 96% of the time and unable to express the rest. */
  readonly value: string;
}

/** `fill field "Email" with {email}` — `M200` `A3-5`. */
export function buildFill(spec: FillSpec): BuildResult<FillStmt> {
  const locator = buildLocator(spec.locator);
  if (!locator.ok) return locator;
  if (spec.value.trim() === '') return bad('`fill` needs a value — what to type into the field');
  const parsed = parseValueText(spec.value);
  if (!parsed.ok) return bad(parsed.reason);
  return { ok: true, node: { type: 'FillStmt', locator: locator.node, value: parsed.node, span: SYNTHETIC } };
}

export interface WithinSpec {
  readonly locator: LocatorSpec;
  /** `within frame …` steps into the frame the selector resolves to, rather than scoping to a
   *  subtree of the same document. 4 of the corpus's 404 blocks. */
  readonly frame: boolean;
  readonly body: readonly Step[];
}

/**
 * `within [frame] <locator>` and its body — `M200` `A3-5`.
 *
 * The empty body is refused here as well as in the printer, and deliberately in both: the printer
 * refuses because the bytes would not parse back, and this refuses because a form that let you
 * build one would only find out at the write. Same rule, two surfaces, because they answer to
 * different callers.
 */
export function buildWithin(spec: WithinSpec): BuildResult<WithinBlock> {
  const locator = buildLocator(spec.locator);
  if (!locator.ok) return locator;
  if (spec.body.length === 0) return bad('a `within` scopes the steps inside it, so it needs at least one');
  return { ok: true, node: { type: 'WithinBlock', locator: locator.node, frame: spec.frame, body: spec.body, span: SYNTHETIC } };
}

/* ── The rest of the browser vocabulary — `M219` `C` (`D1162`) ──────────────────────────────────
 *
 * **Measured before it was written: the BROWSER door could construct three of the language's
 * twenty-two browser kinds**, and drew the other nineteen as a plain code line with no disabled
 * control and no reason — 650 statements, 27% of all browser steps in the two corpora, which is
 * exactly the pane `D1082` refuses. Five of the nineteen already had builders sitting here
 * unreachable (`buildSelect`, `buildCheck`, `buildPress`, `buildWithin`), which is the `M205` /
 * `M209` shape a fourth time: written, tested, and offered by nothing.
 *
 * **They are cheap because the AST says so.** Four take a locator and nothing else, two take no
 * fields at all, three take one scalar, four take a locator and one more field, three are blocks
 * whose head is a locator or a name, and three have a form of their own. The expensive half was
 * never the building.
 *
 * **A BLOCK'S BODY IS CARRIED, NEVER REBUILT.** `within`, `switch to new tab` and `download` hold
 * statements; an edit to the head of one is an edit to its locator or its name, and the body goes
 * back on untouched. That is `S2`'s rule — *what the spec cannot say is carried* — and here it is
 * not a nicety: rebuilding a body from a form would be a second authoring surface for every
 * statement inside it, which is the whole of what `D1087` refuses.
 */

/** `hover`/`scroll to` — a locator and nothing else. */
export function buildHover(spec: LocatorSpec): BuildResult<HoverStmt> {
  const locator = buildLocator(spec);
  return locator.ok ? { ok: true, node: { type: 'HoverStmt', locator: locator.node, span: SYNTHETIC } } : locator;
}

export function buildScroll(spec: LocatorSpec): BuildResult<ScrollStmt> {
  const locator = buildLocator(spec);
  return locator.ok ? { ok: true, node: { type: 'ScrollStmt', locator: locator.node, span: SYNTHETIC } } : locator;
}

/** `dismiss dialog` and `close tab` — no fields, so no refusal. They are builders rather than
 *  literals at the call site for the reason the module header gives: a span this file owns, and
 *  one construction path the pane cannot step around (`D1087`). */
export function buildDismissDialog(): BuildResult<DismissDialogStmt> {
  return { ok: true, node: { type: 'DismissDialogStmt', span: SYNTHETIC } };
}

export function buildCloseTab(): BuildResult<CloseTabStmt> {
  return { ok: true, node: { type: 'CloseTabStmt', span: SYNTHETIC } };
}

/** `accept dialog [with "<text>"]` — the answer typed into a `prompt` (`D800`). Blank means the
 *  bare form, which accepts with the empty string; it is a real spelling and not a missing value,
 *  which is why this takes a string rather than a `string | null`. */
export function buildAcceptDialog(text: string): BuildResult<AcceptDialogStmt> {
  if (text.trim() === '') return { ok: true, node: { type: 'AcceptDialogStmt', span: SYNTHETIC } };
  const value = parseValueText(text);
  if (!value.ok) return bad(value.reason);
  return { ok: true, node: { type: 'AcceptDialogStmt', text: value.node, span: SYNTHETIC } };
}

/** `switch to tab <n>` — an index, and the language counts from 0. A non-integer is refused here
 *  rather than at the write, because `switch to tab 1.5` lexes as a number and means nothing. */
export function buildSwitchToTab(index: string): BuildResult<SwitchToTabStmt> {
  const n = Number(index.trim());
  if (index.trim() === '' || !Number.isInteger(n) || n < 0) return bad('`switch to tab` takes a whole tab number, counting from 0');
  return { ok: true, node: { type: 'SwitchToTabStmt', index: n, span: SYNTHETIC } };
}

/** `screenshot "<name>"` — the name the file is written under, so an empty one is refused for the
 *  same reason an empty locator is: it produces an artefact nobody can find. */
export function buildScreenshot(name: string): BuildResult<ScreenshotStmt> {
  if (name.trim() === '') return bad('`screenshot` needs a name — it is what the image is filed under');
  return { ok: true, node: { type: 'ScreenshotStmt', name: stringLit(name.trim()), span: SYNTHETIC } };
}

export interface DropFileSpec {
  readonly filePath: string;
  readonly locator: LocatorSpec;
}

/** `drop file "<path>" on <locator>`. The path is a plain string literal, never interpolated —
 *  the same choice `matches file` makes, and for the same reason: it is read from disk directly. */
export function buildDropFile(spec: DropFileSpec): BuildResult<DropFileStmt> {
  if (spec.filePath.trim() === '') return bad('`drop file` needs a path — the file to drop, relative to this test file');
  const locator = buildLocator(spec.locator);
  if (!locator.ok) return locator;
  return { ok: true, node: { type: 'DropFileStmt', filePath: stringLit(spec.filePath.trim()), locator: locator.node, span: SYNTHETIC } };
}

export interface DragSpec {
  readonly from: LocatorSpec;
  readonly to: LocatorSpec;
}

/** `drag <locator> to <locator>` — two locators, each refused on its own terms so the field that
 *  is empty is the field the message names. */
export function buildDrag(spec: DragSpec): BuildResult<DragStmt> {
  const from = buildLocator(spec.from);
  if (!from.ok) return from;
  const to = buildLocator(spec.to);
  if (!to.ok) return to;
  return { ok: true, node: { type: 'DragStmt', from: from.node, to: to.node, span: SYNTHETIC } };
}

/** `switch to new tab` and its body. The body is the caller's — see the family note above. */
export function buildSwitchToNewTab(body: readonly Step[]): BuildResult<SwitchToNewTabBlock> {
  if (body.length === 0) return bad('`switch to new tab` scopes the steps inside it, so it needs at least one');
  return { ok: true, node: { type: 'SwitchToNewTabBlock', body, span: SYNTHETIC } };
}

export interface DownloadSpec {
  /** The variable the downloaded file is bound to — `download as receipt`. */
  readonly name: string;
  readonly body: readonly Step[];
}

export function buildDownload(spec: DownloadSpec): BuildResult<DownloadBlock> {
  if (!/^[A-Za-z_]\w*$/.test(spec.name.trim())) return bad('`download as` binds a name — a word, starting with a letter or `_`');
  if (spec.body.length === 0) return bad('a `download` block holds the step that starts the download, so it needs at least one');
  return { ok: true, node: { type: 'DownloadBlock', name: spec.name.trim(), body: spec.body, span: SYNTHETIC } };
}

export interface FillFormSpec {
  readonly rows: readonly { readonly field: string; readonly value: string }[];
}

/** `fill form` and its rows — the repeated-row shape the request editor's headers already have.
 *  Each value is parsed as a **value**, `buildFill`'s rule and for its reason. */
export function buildFillForm(spec: FillFormSpec): BuildResult<FillFormStmt> {
  if (spec.rows.length === 0) return bad('a `fill form` needs at least one field to fill');
  const rows: FillFormRow[] = [];
  for (const row of spec.rows) {
    if (row.field.trim() === '') return bad('every `fill form` row names a field');
    const value = parseValueText(row.value);
    if (!value.ok) return bad(`\`${row.field.trim()}\`: ${value.reason}`);
    rows.push({ type: 'FillFormRow', field: stringLit(row.field.trim()), value: value.node, span: SYNTHETIC });
  }
  return { ok: true, node: { type: 'FillFormStmt', rows, span: SYNTHETIC } };
}

export interface StubSpec {
  readonly method: HttpMethod;
  readonly urlPattern: string;
  readonly status: string;
  /** The stubbed document, as typed — an object or a top-level array (`D639`), or blank for none. */
  readonly body: string;
}

/** `stub <METHOD> "<url pattern>" with <status> [body …]`. */
export function buildStub(spec: StubSpec): BuildResult<StubStmt> {
  if (spec.urlPattern.trim() === '') return bad('`stub` needs a URL pattern — the requests it stands in for');
  const status = Number(spec.status.trim());
  if (spec.status.trim() === '' || !Number.isInteger(status) || status < 100 || status > 599) {
    return bad('`stub` answers with an HTTP status — a whole number between 100 and 599');
  }
  let body: ObjectLit | ArrayLit | null = null;
  if (spec.body.trim() !== '') {
    const parsed = parseValueText(spec.body);
    if (!parsed.ok) return bad(parsed.reason);
    if (parsed.node.type !== 'ObjectLit' && parsed.node.type !== 'ArrayLit') {
      return bad('a stubbed body is a JSON object or a top-level array');
    }
    body = parsed.node;
  }
  return {
    ok: true,
    node: {
      type: 'StubStmt',
      method: spec.method,
      urlPattern: stringLit(spec.urlPattern.trim()),
      status: { type: 'NumberLit', value: status, raw: String(status), span: SYNTHETIC } as NumberLit,
      body,
      span: SYNTHETIC,
    },
  };
}

export interface WaitUntilUiSpec {
  /** The condition, built through `buildExpect` so there is one assertion builder and not two. */
  readonly expect: ExpectSpec;
  /** `for <duration>` — how long it must hold continuously. Blank for the original semantics. */
  readonly hold: string;
  /** `timeout wait <duration>` — this step's own poll budget. Blank for the env's. */
  readonly wait: string;
}

/**
 * `wait until <pollable subject> …` — `M219` `C`.
 *
 * **It goes through `buildExpect`**, which is what keeps the browser's polling assertion and the
 * ordinary one spelling a subject and a matcher the same way. What this adds is the two clauses an
 * `expect` has no room for, and the one refusal that is its own: `pollable()` is the parser's own
 * predicate, so a subject this accepts is a subject the file will parse back.
 */
export function buildWaitUntilUi(spec: WaitUntilUiSpec): BuildResult<WaitUntilUiStmt> {
  const built = buildExpect(spec.expect);
  if (!built.ok) return built;
  if (!pollable(built.node.subject)) {
    return bad('`wait until` re-reads its subject until it comes true, so it needs one that can change — an element, the page, a network request, or a response’s status, header or body');
  }
  const ms = (text: string, what: string): number | null | string => {
    if (text.trim() === '') return null;
    const parsed = parseValueText(text);
    if (!parsed.ok) return parsed.reason;
    if (parsed.node.type !== 'DurationLit') return `\`${what}\` is a length of time — write it as \`500ms\`, \`2s\` or \`1m\``;
    return parsed.node.ms;
  };
  const holdMs = ms(spec.hold, 'for');
  if (typeof holdMs === 'string') return bad(holdMs);
  const waitMs = ms(spec.wait, 'timeout wait');
  if (typeof waitMs === 'string') return bad(waitMs);
  /* `TF055`'s two operands are now both in the file, which is the whole reason `timeout wait` was
     added to this step — so the refusal can be made here rather than left to a run. */
  if (holdMs !== null && waitMs !== null && holdMs >= waitMs) {
    return bad('the hold has to fit inside the budget — `for` must be shorter than `timeout wait`');
  }
  return {
    ok: true,
    node: { type: 'WaitUntilUiStmt', subject: built.node.subject, matcher: built.node.matcher, holdMs, waitMs, span: SYNTHETIC },
  };
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
    case 'response':
      return { ok: true, node: { type: 'ResponseSubject', span: SYNTHETIC } };
    case 'page':
      return { ok: true, node: { type: 'PageSubject', span: SYNTHETIC } };
    case 'locator': {
      const locator = buildLocator(spec.locator);
      if (!locator.ok) return locator;
      return { ok: true, node: { type: 'LocatorSubject', locator: locator.node, span: SYNTHETIC } };
    }
    case 'networkRequest':
      if (spec.urlPattern.trim().length === 0) return bad('a network-request subject needs a URL pattern — it is matched as a substring of the request’s full URL');
      return {
        ok: true,
        node: {
          type: 'NetworkRequestSubject',
          ref: {
            type: 'NetworkRequestRef',
            urlPattern: stringLit(spec.urlPattern.trim()),
            method: spec.method.trim() === '' ? null : stringLit(spec.method.trim().toUpperCase()),
            span: SYNTHETIC,
          },
          span: SYNTHETIC,
        },
      };
    case 'dialogMessage':
      return { ok: true, node: { type: 'DialogMessageSubject', span: SYNTHETIC } };
    case 'dialogType':
      return { ok: true, node: { type: 'DialogTypeSubject', span: SYNTHETIC } };
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
  /**
   * **A bracketed literal may span lines; nothing else may** (`M215` `B1`, `D1120`).
   *
   * This used to refuse every newline outright, and that refusal was wrong about exactly one
   * value: the lexer emits no `newline`/`indent`/`dedent` while a `{` or `[` is open (`lexer.ts`,
   * the comment at its `openers` counter), so an object or array literal written across lines is
   * already one logical line to the parser and already parses. Measured: `{\n  "id": 4021,\n
   * "ok": true\n}` returns a clean `ObjectLit`.
   *
   * It mattered because a JSON body is the one value a person **pastes**, and pasted JSON is
   * pretty-printed. The form refused it with *a value is written on one line*, which is a true
   * sentence about a scalar and a wall in front of the commonest gesture the Body tab has.
   *
   * A scalar keeps the old rule, and keeps it for the old reason: `expect status equals 200\nfoo`
   * is two lines of intent in a field that writes one, and the language cannot carry the second.
   */
  const bracketed = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (!bracketed && /[\n\r]/.test(trimmed)) return { ok: false, reason: 'a value is written on one line' };
  const lexed = lex(`test "_"\n  let _v = ${trimmed}\n`);
  const parsed = parseTokens(lexed.tokens);
  const error = [...lexed.diagnostics, ...parsed.diagnostics].find((d) => d.severity === 'error');
  if (error) return { ok: false, reason: error.message };
  const step: Step | undefined = parsed.program.tests[0]?.body[0];
  if (!step || step.type !== 'LetStmt') return { ok: false, reason: `\`${trimmed}\` is not a value this language can read` };
  return { ok: true, node: step.value };
}
