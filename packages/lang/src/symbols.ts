// Symbol collection for the LSP (PLAN_M13_LSP.md, PLAN_ENTERPRISE.md decision 17): a lazily-built
// def/ref table that `packages/lsp-server` walks for hover, go-to-definition, autocomplete
// (symbol-name source), and rename. Kept in `@tflw/lang` alongside `checker.ts` — same "no I/O,
// single source of truth for language-level facts" invariant, and reuses `checkUnknownVariables`'s
// exact scope-walking rules (checker.ts:206-215): before/after-file hooks isolated; before/after-
// each hooks share the wrapped test's scope; each action isolated, seeded by its own params;
// inline table columns bound per-test; file-backed tables skipped statically (their columns aren't
// known until the file is read at runtime).
//
// `TestDecl.sessions`, `ActionDecl.params`, and `InlineDataTable.columns` are plain `string[]` with
// no per-element span (ast.ts) — closed here with `findIdentifierSpans`, a windowed re-lex of the
// original source text, rather than an AST/parser schema change (smaller blast radius: no existing
// consumer of these fields — `checker.ts`, `runtime/interpreter.ts` — needs to change). The same
// technique also recovers a precise span for `LetStmt.name`/`CaptureStmt.name`/`SessionDecl.name`,
// which have the identical no-per-name-span gap but weren't called out in the original research
// (needed for decision 17.5's rename-of-captured-variables scope). Each caller passes a *tight*
// window (the def's own header text, never the full body) so the identifier search can never
// wander into an unrelated later occurrence of the same text.

import type {
  ApiBody,
  ApiRequestSpec,
  ConfigFile,
  ExpectStmt,
  PathExpr,
  PathSegment,
  Program,
  Step,
  StringLit,
  StringPart,
  Subject,
  Value,
} from './ast.js';
import type { Position, Span, Token } from './token.js';
import { lex } from './lexer.js';
import { parseStringParts } from './parser.js';

export type SymbolKind = 'variable' | 'session' | 'action' | 'param' | 'importedAction';

export interface SymbolDef {
  readonly name: string;
  readonly kind: SymbolKind;
  /** Span of just the defining identifier (never the whole enclosing statement/decl). */
  readonly span: Span;
  readonly scopeId: string;
}

export interface SymbolRef {
  readonly name: string;
  readonly kind: SymbolKind;
  /** Span of just the referencing identifier/name portion. */
  readonly span: Span;
  readonly scopeId: string;
  /** The resolving def's span, when found within this same collection pass (same file, same
   * scope). Undefined for a call to an imported action / JS helper or an unresolved reference —
   * `packages/lsp-server`'s cross-file layer resolves those separately (PLAN_M13_LSP.md decision 5). */
  readonly defSpan?: Span;
}

export interface SymbolTable {
  readonly defs: readonly SymbolDef[];
  readonly refs: readonly SymbolRef[];
}

/**
 * Locate the spans of `names` (in order) inside `source.slice(parentSpan.start.offset,
 * parentSpan.end.offset)`, by re-lexing that substring and greedily matching identifier tokens by
 * value, left to right. Returns `null` for any name it can't find. Callers are responsible for
 * passing a window tight enough that the match can't be ambiguous (see call sites below) — this
 * is a deliberately simple, conservative helper, not a general-purpose scope resolver: a name that
 * coincidentally repeats *inside* an already-tight window (e.g. a parameter named the same as one
 * of the action's own name words) can still resolve to the wrong occurrence. Acceptable for v1,
 * same conservative-approximation spirit as `checker.ts`'s `checkUnknownVariables`.
 */
export function findIdentifierSpans(source: string, parentSpan: Span, names: readonly string[]): (Span | null)[] {
  if (names.length === 0) return [];
  const { tokens } = lex(source.slice(parentSpan.start.offset, parentSpan.end.offset));
  const idents = tokens.filter((t) => t.type === 'ident');
  const results: (Span | null)[] = [];
  let cursor = 0;
  for (const name of names) {
    let matchIndex = -1;
    for (let i = cursor; i < idents.length; i++) {
      if (idents[i]!.value === name) {
        matchIndex = i;
        break;
      }
    }
    if (matchIndex === -1) {
      results.push(null);
      continue;
    }
    cursor = matchIndex + 1;
    results.push(offsetSpan(idents[matchIndex]!.span, parentSpan.start));
  }
  return results;
}

/** Find the first token of `type` inside `span`'s source text, if any, translated back to absolute
 * source coordinates. Used to anchor a tighter window (e.g. "just after `(`") before an identifier
 * search, so the search text never includes unrelated words that could collide by value. */
function findTokenSpan(source: string, span: Span, type: Token['type']): Span | null {
  const { tokens } = lex(source.slice(span.start.offset, span.end.offset));
  const tok = tokens.find((t) => t.type === type);
  return tok ? offsetSpan(tok.span, span.start) : null;
}

function offsetSpan(span: Span, base: Position): Span {
  return { start: offsetPosition(span.start, base), end: offsetPosition(span.end, base) };
}

function offsetPosition(pos: Position, base: Position): Position {
  if (pos.line === 1) {
    return { offset: base.offset + pos.offset, line: base.line, column: base.column + pos.column - 1 };
  }
  return { offset: base.offset + pos.offset, line: base.line + pos.line - 1, column: pos.column };
}

// ---- program (test-file) symbols -------------------------------------------

/**
 * Collect every symbol def/ref reachable from `program`'s tests, hooks, and actions. `source` must
 * be the exact text `program` was parsed from (spans are offsets into it). Mirrors
 * `checker.ts#checkUnknownVariables`'s traversal, upgraded from a name-only `Set<string>` to a
 * `Map<string, Span>` so every reference can carry its resolving def's span.
 */
export function collectSymbols(program: Program, source: string): SymbolTable {
  const defs: SymbolDef[] = [];
  const refs: SymbolRef[] = [];
  const defKeys = new Set<string>();

  const pushDef = (def: SymbolDef): void => {
    const key = `${def.kind}:${def.span.start.offset}`;
    if (defKeys.has(key)) return;
    defKeys.add(key);
    defs.push(def);
  };

  // Action defs are collected up front (order-independent) so `CallExpr` refs anywhere in the file
  // — including inside another action's body, or a hook that runs before the action is "seen" in
  // declaration order — can resolve against them.
  const actionDefs = new Map<string, SymbolDef>();
  for (const action of program.actions) {
    const headerEnd = action.body[0]?.span.start ?? action.span.end;
    const nameSpans = findIdentifierSpans(source, { start: action.span.start, end: headerEnd }, action.name.split(' '));
    const first = nameSpans.find((s): s is Span => s !== null);
    const last = [...nameSpans].reverse().find((s): s is Span => s !== null);
    if (!first || !last) continue;
    const def: SymbolDef = { name: action.name, kind: 'action', span: { start: first.start, end: last.end }, scopeId: 'file' };
    pushDef(def);
    actionDefs.set(action.name, def);
  }

  const beforeEachHooks = program.hooks.filter((h) => h.scope === 'each' && h.when === 'before');
  const afterEachHooks = program.hooks.filter((h) => h.scope === 'each' && h.when === 'after');
  const fileHooks = program.hooks.filter((h) => h.scope === 'file');

  for (const hook of fileHooks) {
    const scopeId = `hook:${hook.when}:${hook.span.start.offset}`;
    walkSteps(hook.body, new Map(), scopeId, source, actionDefs, pushDef, refs);
  }

  for (const test of program.tests) {
    // Same skip as checkUnknownVariables: a file-backed table's columns aren't known statically.
    if (test.table && test.table.type === 'FileDataTable') continue;

    const scopeId = `test:${test.span.start.offset}`;
    const bound = new Map<string, Span>();

    if (test.table) {
      const table = test.table;
      const headerEnd = table.rows[0]?.[0]?.span.start ?? table.span.end;
      const colSpans = findIdentifierSpans(source, { start: table.span.start, end: headerEnd }, table.columns);
      table.columns.forEach((col, i) => {
        const span = colSpans[i] ?? table.span;
        bound.set(col, span);
        pushDef({ name: col, kind: 'variable', span, scopeId });
      });
    }

    if (test.sessions.length > 0) {
      const headerEnd = test.body[0]?.span.start ?? test.span.end;
      const sessionSpans = findIdentifierSpans(source, { start: test.name.span.end, end: headerEnd }, test.sessions);
      test.sessions.forEach((s, i) => {
        refs.push({ name: s, kind: 'session', span: sessionSpans[i] ?? test.span, scopeId });
      });
    }

    for (const hook of beforeEachHooks) walkSteps(hook.body, bound, scopeId, source, actionDefs, pushDef, refs);
    walkSteps(test.body, bound, scopeId, source, actionDefs, pushDef, refs);
    for (const hook of afterEachHooks) walkSteps(hook.body, bound, scopeId, source, actionDefs, pushDef, refs);
  }

  for (const action of program.actions) {
    const scopeId = `action:${action.span.start.offset}`;
    const bound = new Map<string, Span>();
    const headerEnd = action.body[0]?.span.start ?? action.span.end;
    const lparen = findTokenSpan(source, { start: action.span.start, end: headerEnd }, 'lparen');
    const paramWindow = { start: lparen ? lparen.end : action.span.start, end: headerEnd };
    const paramSpans = findIdentifierSpans(source, paramWindow, action.params);
    action.params.forEach((p, i) => {
      const span = paramSpans[i] ?? action.span;
      bound.set(p, span);
      pushDef({ name: p, kind: 'param', span, scopeId });
    });
    walkSteps(action.body, bound, scopeId, source, actionDefs, pushDef, refs);
  }

  return { defs, refs };
}

// ---- config (tflw.config) symbols ------------------------------------------

/**
 * Collect session defs (+ refs inside their bodies) from `tflw.config`. `source` must be the exact
 * text `config` was parsed from. A `TestDecl.sessions` ref (collected separately by
 * `collectSymbols`, since it lives in a different file) resolves against this table's `session`
 * defs — cross-file, so it's `packages/lsp-server`'s job to join the two, not this function's.
 */
export function collectConfigSymbols(config: ConfigFile, source: string): SymbolTable {
  const defs: SymbolDef[] = [];
  const refs: SymbolRef[] = [];
  const defKeys = new Set<string>();

  const pushDef = (def: SymbolDef): void => {
    const key = `${def.kind}:${def.span.start.offset}`;
    if (defKeys.has(key)) return;
    defKeys.add(key);
    defs.push(def);
  };

  for (const session of config.sessions) {
    const headerEnd = session.oauth2 ? session.oauth2.span.start : (session.body[0]?.span.start ?? session.span.end);
    const [nameSpan] = findIdentifierSpans(source, { start: session.span.start, end: headerEnd }, [session.name]);
    pushDef({ name: session.name, kind: 'session', span: nameSpan ?? session.span, scopeId: 'config' });

    const scopeId = `session:${session.span.start.offset}`;
    const bound = new Map<string, Span>();
    // Session bodies never call user actions (SPEC §3.3 — no `import`/`action` in the config
    // dialect), so `CallExpr`s here (rare — realistically none) never resolve to an in-file def.
    walkSteps(session.body, bound, scopeId, source, new Map(), pushDef, refs);
    if (session.oauth2) {
      walkValue(session.oauth2.tokenUrl, bound, scopeId, source, new Map(), refs);
      walkValue(session.oauth2.clientId, bound, scopeId, source, new Map(), refs);
      walkValue(session.oauth2.clientSecret, bound, scopeId, source, new Map(), refs);
      if (session.oauth2.scope) walkValue(session.oauth2.scope, bound, scopeId, source, new Map(), refs);
    }
  }

  return { defs, refs };
}

// ---- shared step/value walkers (mirror checker.ts's checkStepSequence/checkValue) -------------

function walkSteps(
  steps: readonly Step[],
  bound: Map<string, Span>,
  scopeId: string,
  source: string,
  actionDefs: Map<string, SymbolDef>,
  pushDef: (def: SymbolDef) => void,
  refs: SymbolRef[],
): void {
  for (const step of steps) {
    switch (step.type) {
      case 'ApiStep':
        walkApiRequestSpec(step, bound, scopeId, source, actionDefs, refs);
        break;
      case 'ExpectStmt':
        walkExpectStmt(step, bound, scopeId, source, actionDefs, refs);
        break;
      case 'LetStmt': {
        walkValue(step.value, bound, scopeId, source, actionDefs, refs);
        const window = { start: step.span.start, end: step.value.span.start };
        const [nameSpan] = findIdentifierSpans(source, window, [step.name]);
        const span = nameSpan ?? step.span;
        pushDef({ name: step.name, kind: 'variable', span, scopeId });
        bound.set(step.name, span);
        break;
      }
      case 'CaptureStmt': {
        walkSubject(source, step.subject, bound, scopeId, refs);
        const window = { start: step.subject.span.end, end: step.span.end };
        const [nameSpan] = findIdentifierSpans(source, window, [step.name]);
        const span = nameSpan ?? step.span;
        pushDef({ name: step.name, kind: 'variable', span, scopeId });
        bound.set(step.name, span);
        break;
      }
      case 'WaitUntilApiStmt':
        walkApiRequestSpec(step.request, bound, scopeId, source, actionDefs, refs);
        for (const expect of step.expects) walkExpectStmt(expect, bound, scopeId, source, actionDefs, refs);
        break;
      case 'GiveStmt':
        walkValue(step.value, bound, scopeId, source, actionDefs, refs);
        break;
      case 'HeaderStmt':
        walkStringLit(source, step.name, bound, scopeId, refs);
        walkValue(step.value, bound, scopeId, source, actionDefs, refs);
        break;
    }
  }
}

function walkExpectStmt(step: ExpectStmt, bound: Map<string, Span>, scopeId: string, source: string, actionDefs: Map<string, SymbolDef>, refs: SymbolRef[]): void {
  walkSubject(source, step.subject, bound, scopeId, refs);
  if (step.matcher.value) walkValue(step.matcher.value, bound, scopeId, source, actionDefs, refs);
}

function walkSubject(source: string, subject: Subject, bound: Map<string, Span>, scopeId: string, refs: SymbolRef[]): void {
  if (subject.type === 'HeaderSubject') walkStringLit(source, subject.name, bound, scopeId, refs);
}

function walkApiRequestSpec(spec: ApiRequestSpec, bound: Map<string, Span>, scopeId: string, source: string, actionDefs: Map<string, SymbolDef>, refs: SymbolRef[]): void {
  walkPathInterp(source, spec.path, bound, scopeId, refs);
  if (spec.body) walkApiBody(spec.body, bound, scopeId, source, actionDefs, refs);
  for (const header of spec.headers) {
    walkStringLit(source, header.name, bound, scopeId, refs);
    walkValue(header.value, bound, scopeId, source, actionDefs, refs);
  }
}

function walkApiBody(body: ApiBody, bound: Map<string, Span>, scopeId: string, source: string, actionDefs: Map<string, SymbolDef>, refs: SymbolRef[]): void {
  switch (body.type) {
    case 'InlineBody':
      for (const field of body.object.fields) walkValue(field.value, bound, scopeId, source, actionDefs, refs);
      break;
    case 'FileBody':
      walkStringLit(source, body.path, bound, scopeId, refs);
      break;
    case 'FormBody':
      for (const field of body.fields) walkValue(field.value, bound, scopeId, source, actionDefs, refs);
      break;
    case 'TextBody':
      walkStringLit(source, body.value, bound, scopeId, refs);
      break;
    case 'UploadBody':
      walkStringLit(source, body.filePath, bound, scopeId, refs);
      walkStringLit(source, body.fieldName, bound, scopeId, refs);
      if (body.contentType) walkStringLit(source, body.contentType, bound, scopeId, refs);
      for (const field of body.extra) walkValue(field.value, bound, scopeId, source, actionDefs, refs);
      break;
  }
}

function walkValue(value: Value, bound: Map<string, Span>, scopeId: string, source: string, actionDefs: Map<string, SymbolDef>, refs: SymbolRef[]): void {
  switch (value.type) {
    case 'StringLit':
      walkStringLit(source, value, bound, scopeId, refs);
      break;
    case 'VarRef':
      pushVarRef(value.name, value.span, bound, scopeId, refs);
      break;
    case 'Interp':
      walkRefPath(source, value.ref, value.span, bound, scopeId, refs);
      break;
    case 'ObjectLit':
      for (const field of value.fields) walkValue(field.value, bound, scopeId, source, actionDefs, refs);
      break;
    case 'ArrayLit':
      for (const el of value.elements) walkValue(el, bound, scopeId, source, actionDefs, refs);
      break;
    case 'BinaryExpr':
      walkValue(value.left, bound, scopeId, source, actionDefs, refs);
      walkValue(value.right, bound, scopeId, source, actionDefs, refs);
      break;
    case 'FormatExpr':
      walkValue(value.value, bound, scopeId, source, actionDefs, refs);
      walkStringLit(source, value.pattern, bound, scopeId, refs);
      break;
    case 'UniquePrefixExpr':
      walkValue(value.prefix, bound, scopeId, source, actionDefs, refs);
      break;
    case 'UniqueLikeExpr':
      walkStringLit(source, value.pattern, bound, scopeId, refs);
      break;
    case 'RandomNumberExpr':
    case 'RandomDecimalExpr':
    case 'RandomDateBetweenExpr':
      walkValue(value.from, bound, scopeId, source, actionDefs, refs);
      walkValue(value.to, bound, scopeId, source, actionDefs, refs);
      break;
    case 'RandomOfExpr':
      for (const choice of value.choices) walkValue(choice, bound, scopeId, source, actionDefs, refs);
      break;
    case 'RandomStringExpr':
      walkValue(value.length, bound, scopeId, source, actionDefs, refs);
      break;
    case 'RandomLikeExpr':
      walkStringLit(source, value.pattern, bound, scopeId, refs);
      break;
    case 'RandomPasswordExpr':
      if (value.length) walkValue(value.length, bound, scopeId, source, actionDefs, refs);
      break;
    case 'TransformExpr':
      walkValue(value.value, bound, scopeId, source, actionDefs, refs);
      break;
    case 'CallExpr': {
      const nameEndTok = findTokenSpan(source, value.span, 'lparen');
      const nameSpan = { start: value.span.start, end: nameEndTok ? nameEndTok.start : value.span.end };
      const def = actionDefs.get(value.name);
      refs.push({ name: value.name, kind: 'action', span: nameSpan, scopeId, ...(def ? { defSpan: def.span } : {}) });
      for (const arg of value.args) walkValue(arg, bound, scopeId, source, actionDefs, refs);
      break;
    }
    // NumberLit, DurationLit, BoolLit, NullLit, EnvRef, DateAtom, DateOffsetLit, UniqueEmailExpr,
    // UniqueNumberExpr, UniqueUuidExpr, RandomDateInPastExpr, RandomDateInFutureExpr,
    // RandomUuidExpr: no refs (mirrors checker.ts's checkValue).
  }
}

/**
 * A `{ref}` interpolation hole inside a quoted `StringLit` (`header "…" is "{csrf}"`) has no span
 * of its own — `StringPart`'s `interp` variant (ast.ts) is computed by `parseStringParts` from the
 * *decoded* string value, after the lexer has already collapsed the literal down to one `string`
 * token spanning the whole `"…"`. Using that whole-literal span as the ref's span (the pre-Phase-5
 * behavior) meant a rename replaced the entire quoted text — braces, quotes, and any surrounding
 * literal text like `"Bearer {token}"` — with the bare new name, and hover/go-to-def would
 * incorrectly trigger over that unrelated surrounding text too. Fixed by mapping each decoded
 * character back to its raw source offset (only escapes make the two diverge — a `\x` pair
 * collapses to one decoded char) to recover each hole's raw `{`/`}` bounds, then reusing
 * `findIdentifierSpans`'s real re-lex on just that isolated `{…}` substring (ordinary lexable
 * syntax once split off from the surrounding quotes) to find the first path segment's own span,
 * same as every other windowed lookup in this file.
 */
function walkStringLit(source: string, lit: StringLit, bound: Map<string, Span>, scopeId: string, refs: SymbolRef[]): void {
  resolveInterpRefs(source, lit.span, source.slice(lit.span.start.offset, lit.span.end.offset), lit.value, lit.parts, true, bound, scopeId, refs);
}

/** Same interpolation-hole resolution as `walkStringLit`, but for an unquoted `PathExpr`
 * (`api GET /orders/{orderId}`) — its `.raw` is the exact, undecoded source text (paths are never
 * escape-processed, unlike a quoted string literal), so raw and "decoded" text are identical and
 * the offset map is just the identity. */
function walkPathInterp(source: string, path: PathExpr, bound: Map<string, Span>, scopeId: string, refs: SymbolRef[]): void {
  resolveInterpRefs(source, path.span, path.raw, path.raw, parseStringParts(path.raw), false, bound, scopeId, refs);
}

/** Builds the decoded-character → raw-character offset map `resolveInterpRefs` needs: identity
 * (one raw char per decoded char) when `quoted` is false; skips the surrounding quote chars and
 * steps 2 raw chars per 1 decoded char across a `\x` escape pair when `quoted` is true — mirrors
 * `lexString`'s own stepping rule exactly, without needing its escape-substitution table, since
 * only offsets (never the substituted character) matter here. */
function buildRawOffsetMap(raw: string, quoted: boolean): number[] {
  const offsets: number[] = [];
  let i = quoted ? 1 : 0;
  const end = quoted ? raw.length - 1 : raw.length;
  while (i < end) {
    offsets.push(i);
    i += quoted && raw[i] === '\\' && i + 1 < end ? 2 : 1;
  }
  return offsets;
}

function resolveInterpRefs(
  source: string,
  regionSpan: Span,
  raw: string,
  decoded: string,
  parts: readonly StringPart[],
  quoted: boolean,
  bound: Map<string, Span>,
  scopeId: string,
  refs: SymbolRef[],
): void {
  if (!parts.some((p) => p.kind === 'interp')) return;
  const rawOffsetOfDecodedIndex = buildRawOffsetMap(raw, quoted);
  let vi = 0;
  for (const part of parts) {
    if (part.kind === 'text') {
      vi += part.value.length;
      continue;
    }
    const open = decoded.indexOf('{', vi);
    const close = open === -1 ? -1 : decoded.indexOf('}', open + 1);
    vi = close === -1 ? decoded.length : close + 1;
    const first = part.ref[0];
    if (!first || first.kind !== 'prop') continue;
    const rawOpen = open === -1 ? undefined : rawOffsetOfDecodedIndex[open];
    const rawClose = close === -1 ? undefined : rawOffsetOfDecodedIndex[close];
    if (rawOpen === undefined || rawClose === undefined) {
      pushVarRef(first.name, regionSpan, bound, scopeId, refs); // shouldn't happen for a hole parseStringParts already validated; stay safe
      continue;
    }
    const holeSpan: Span = {
      start: { offset: regionSpan.start.offset + rawOpen, line: regionSpan.start.line, column: regionSpan.start.column + rawOpen },
      end: { offset: regionSpan.start.offset + rawClose + 1, line: regionSpan.start.line, column: regionSpan.start.column + rawClose + 1 },
    };
    const [nameSpan] = findIdentifierSpans(source, holeSpan, [first.name]);
    pushVarRef(first.name, nameSpan ?? holeSpan, bound, scopeId, refs);
  }
}

/** A standalone `{ref}` in value position (`body { csrfToken: {csrf} }`, ast.ts's `Interp`, not
 * inside a string) — unlike a `StringPart` hole, `Interp.span` already covers real, freshly-parsed
 * `{`/`}` syntax (never decoded-value-derived), so no offset mapping is needed: `findIdentifierSpans`
 * can re-lex it directly to narrow past the braces to just the first path segment's own span. */
function walkRefPath(source: string, ref: readonly PathSegment[], parentSpan: Span, bound: Map<string, Span>, scopeId: string, refs: SymbolRef[]): void {
  const first = ref[0];
  if (!first || first.kind !== 'prop') return;
  const [nameSpan] = findIdentifierSpans(source, parentSpan, [first.name]);
  pushVarRef(first.name, nameSpan ?? parentSpan, bound, scopeId, refs);
}

function pushVarRef(name: string, span: Span, bound: Map<string, Span>, scopeId: string, refs: SymbolRef[]): void {
  const defSpan = bound.get(name);
  refs.push({ name, kind: 'variable', span, scopeId, ...(defSpan ? { defSpan } : {}) });
}
