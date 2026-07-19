// Semantic checks that go beyond grammar. M1 covers the config dialect (PLAN P#28): a key must
// appear in the right block, and env `default`/name conflicts are errors. M2 adds named-service
// validation against the active env (P#29). M2.65 adds a conservative unknown-variable pass
// (decision 57); full matcher↔subject compatibility checking is still deferred to a later
// milestone (SPEC §1's "static scope" note).

import type {
  ApiBody,
  ApiRequestSpec,
  ConfigEntry,
  ConfigFile,
  ExpectStmt,
  PathSegment,
  Program,
  SessionDecl,
  Step,
  StringLit,
  StringPart,
  Subject,
  Value,
} from './ast.js';
import type { Span } from './token.js';
import { type Diagnostic, Codes, suggest } from './diagnostic.js';
import { parseStringParts } from './parser.js';

/** Keys valid only in `defaults`, only in `env`, or in both. */
const DEFAULTS_ONLY = new Set(['WorkersDecl', 'ReportDecl']);
const ENV_ONLY = new Set(['WebDecl', 'ApiServiceDecl']);

export function validateConfig(config: ConfigFile): Diagnostic[] {
  const diags: Diagnostic[] = [];

  if (config.defaults) {
    for (const entry of config.defaults.entries) {
      if (ENV_ONLY.has(entry.type)) {
        diags.push(contextError(entry, 'defaults', 'an `env` block'));
      }
    }
  }

  const seen = new Set<string>();
  let defaultCount = 0;
  for (const env of config.envs) {
    if (seen.has(env.name)) {
      diags.push({
        code: Codes.CONFIG_ENV_CONFLICT,
        severity: 'error',
        message: `duplicate env \`${env.name}\``,
        span: env.span,
        hint: 'env names must be unique',
      });
    }
    seen.add(env.name);
    if (env.isDefault) defaultCount++;
    for (const entry of env.entries) {
      if (DEFAULTS_ONLY.has(entry.type)) {
        diags.push(contextError(entry, `env ${env.name}`, 'the `defaults` block'));
      }
    }
  }

  if (defaultCount > 1) {
    for (const env of config.envs.filter((e) => e.isDefault)) {
      diags.push({
        code: Codes.CONFIG_ENV_CONFLICT,
        severity: 'error',
        message: 'more than one env is marked `default`',
        span: env.span,
        hint: 'exactly one env may be the `default`',
      });
    }
  }

  const seenSessions = new Set<string>();
  for (const session of config.sessions) {
    if (seenSessions.has(session.name)) {
      diags.push({
        code: Codes.CONFIG_SESSION_CONFLICT,
        severity: 'error',
        message: `duplicate session \`${session.name}\``,
        span: session.span,
        hint: 'session names must be unique',
      });
    }
    seenSessions.add(session.name);
  }

  return diags;
}

/**
 * Validate `test "…" as <session>[, <session>...]` references against the sessions declared in
 * `tflw.config` (SPEC §3.3, P#42). Called by the CLI once the config is parsed — like
 * `checkServices`, this check is cross-file (config vs. test file) so it can't live inside
 * `validateConfig`. One diagnostic per unknown name, not one aggregated diagnostic per test — so
 * `test "..." as admin, gohst` (one typo among several valid names) still points precisely at the
 * bad one instead of a single-message-lists-everything wall of text.
 */
export function checkSessions(program: Program, knownSessions: readonly string[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const test of program.tests) {
    for (const session of test.sessions) {
      if (knownSessions.includes(session)) continue;
      const hint = suggest(session, knownSessions);
      diags.push({
        code: Codes.UNKNOWN_SESSION,
        severity: 'error',
        message: `unknown session "${session}"`,
        span: test.span,
        hint: hint ? `did you mean \`${hint}\`?` : knownSessions.length ? `known sessions: ${knownSessions.join(', ')}` : 'tflw.config declares no `session` blocks',
      });
    }
  }
  return diags;
}

/**
 * Validate `api <service>` references (in `api` steps and `wait until api`) against the named
 * services declared in the active env (P#29). Called by the CLI once the config is resolved —
 * the lang package itself has no notion of "the active env", only the checker rule.
 */
export function checkServices(program: Program, knownServices: readonly string[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const test of program.tests) {
    for (const step of test.body) checkStepService(step, knownServices, diags);
  }
  for (const action of program.actions) {
    for (const step of action.body) checkStepService(step, knownServices, diags);
  }
  for (const hook of program.hooks) {
    for (const step of hook.body) checkStepService(step, knownServices, diags);
  }
  return diags;
}

/**
 * Validate `api <service>` references inside `session` blocks (decision 66) — `checkServices`
 * only walks `program.tests`/`actions`/`hooks`; a `SessionDecl`'s body lives on `ConfigFile.sessions`,
 * a separate tree the CLI never ran this check against, so a typo'd service name inside `session
 * admin` was invisible until the session actually executed at runtime. Called by the CLI once the
 * config is resolved, alongside `checkServices` for test files.
 */
export function checkSessionServices(sessions: readonly SessionDecl[], knownServices: readonly string[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const session of sessions) {
    for (const step of session.body) checkStepService(step, knownServices, diags);
  }
  return diags;
}

function checkStepService(step: Step, knownServices: readonly string[], diags: Diagnostic[]): void {
  if (step.type === 'ApiStep') checkService(step.service, step.span, knownServices, diags);
  else if (step.type === 'WaitUntilApiStmt') checkService(step.request.service, step.span, knownServices, diags);
}

function checkService(service: string | null, span: Span, knownServices: readonly string[], diags: Diagnostic[]): void {
  if (service === null || knownServices.includes(service)) return;
  const hint = suggest(service, knownServices);
  diags.push({
    code: Codes.UNKNOWN_SERVICE,
    severity: 'error',
    message: `unknown api service "${service}"`,
    span,
    hint: hint ? `did you mean \`${hint}\`?` : knownServices.length ? `known services: ${knownServices.join(', ')}` : 'the active env declares no named services',
  });
}

/**
 * Validate `{col}` references in an inline `with each` test's name against its declared columns
 * (SPEC §4.3, P#10/24). Only the inline form is checked: file-backed tables (`with each from
 * "…"`) don't have known columns until the file is read at runtime, so a mismatched column there
 * surfaces as an ordinary "unknown variable" runtime error instead — this is purely static
 * analysis, no I/O (the `lang` package never touches the filesystem).
 */
export function checkDataTables(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const test of program.tests) {
    if (!test.table || test.table.type !== 'InlineDataTable') continue;
    const columns = test.table.columns;
    for (const part of test.name.parts) {
      if (part.kind !== 'interp' || part.ref.length === 0) continue;
      const first = part.ref[0]!;
      if (first.kind !== 'prop' || columns.includes(first.name)) continue;
      const hint = suggest(first.name, columns);
      diags.push({
        code: Codes.UNKNOWN_TABLE_COLUMN,
        severity: 'error',
        message: `unknown table column "${first.name}" referenced in the test name`,
        span: test.name.span,
        hint: hint ? `did you mean \`${hint}\`?` : `declared columns: ${columns.join(', ')}`,
      });
    }
  }
  return diags;
}

/**
 * Conservative unknown-`{var}` pass (decision 57): flags a bare-identifier value (`VarRef`) or a
 * `{ref}` interpolation whose *base* name is provably never bound anywhere reachable in its scope
 * — a `let`, a `capture`, an action's own parameter, or (for a test with an *inline* `with each`
 * table) a declared column. File-backed tables are skipped (their columns aren't known statically
 * — SPEC §4.3) and matcher↔subject compatibility stays a runtime concern (SPEC §1's "static scope"
 * note) — this only catches the single most common authoring slip, a typo'd variable name, as a
 * compile-time squiggle instead of a runtime surprise.
 *
 * Scope model (mirrors the interpreter, `runtime/src/interpreter.ts`):
 *  - `before file`/`after file` hooks run in their own isolated scope — checked independently.
 *  - `before`(each)/`after`(each) hooks share one scope with every test in the file; a `let` in
 *    `before` carries into that test's body and its `after` (P#10/19) — so, conservatively, every
 *    `before`(each) hook is checked (and its bindings accumulated) before each test, and every
 *    `after`(each) hook is checked with everything the test body could have bound, regardless of
 *    which step a real run might fail at.
 *  - Each `action` gets its own scope seeded with just its own parameters (P#17) — a caller's
 *    variables never leak in, and an action's own `let`s never leak out.
 */
export function checkUnknownVariables(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];

  const beforeEachHooks = program.hooks.filter((h) => h.scope === 'each' && h.when === 'before');
  const afterEachHooks = program.hooks.filter((h) => h.scope === 'each' && h.when === 'after');
  const fileHooks = program.hooks.filter((h) => h.scope === 'file');

  for (const hook of fileHooks) checkStepSequence(hook.body, new Set(), diags);

  for (const test of program.tests) {
    // A file-backed table's columns aren't known statically (SPEC §4.3 — same reason
    // `checkDataTables` only checks inline tables), and a bare `{col}` in the body is
    // indistinguishable from a genuine typo without that information — so skip this test (and its
    // each-hooks, which share its scope) entirely rather than risk flagging a legitimate column
    // reference as unknown.
    if (test.table && test.table.type === 'FileDataTable') continue;
    const bound = new Set<string>();
    if (test.table) for (const col of test.table.columns) bound.add(col);
    for (const hook of beforeEachHooks) checkStepSequence(hook.body, bound, diags);
    checkStepSequence(test.body, bound, diags);
    for (const hook of afterEachHooks) checkStepSequence(hook.body, bound, diags);
  }

  for (const action of program.actions) {
    const bound = new Set<string>(action.params);
    checkStepSequence(action.body, bound, diags);
  }

  // Each-scope hooks are checked once per test (their bound-set can legitimately differ test to
  // test, e.g. a different inline table's columns), so a genuinely broken reference *inside* such
  // a hook — as opposed to the test body — would otherwise get reported once per test in the file.
  // Dedupe by (code, source offset): every one of those repeats points at the exact same span.
  const seen = new Set<string>();
  return diags.filter((d) => {
    const key = `${d.code}:${d.span.start.offset}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Walk a step sequence in declaration order, checking each step's referenced variables against
 * `bound` *before* adding any new binding it introduces (`let`/`capture`) — a step can never see
 * its own not-yet-assigned name, and a later step correctly sees everything bound before it. */
function checkStepSequence(steps: readonly Step[], bound: Set<string>, diags: Diagnostic[]): void {
  for (const step of steps) {
    switch (step.type) {
      case 'ApiStep':
        checkApiRequestSpec(step, bound, diags);
        break;
      case 'ExpectStmt':
        checkExpectStmt(step, bound, diags);
        break;
      case 'LetStmt':
        checkValue(step.value, bound, diags);
        bound.add(step.name);
        break;
      case 'CaptureStmt':
        bound.add(step.name);
        break;
      case 'WaitUntilApiStmt':
        checkApiRequestSpec(step.request, bound, diags);
        for (const expect of step.expects) checkExpectStmt(expect, bound, diags);
        break;
      case 'GiveStmt':
        checkValue(step.value, bound, diags);
        break;
      case 'HeaderStmt':
        checkStringLit(step.name, bound, diags);
        checkValue(step.value, bound, diags);
        break;
    }
  }
}

function checkExpectStmt(step: ExpectStmt, bound: Set<string>, diags: Diagnostic[]): void {
  checkSubject(step.subject, bound, diags);
  if (step.matcher.value) checkValue(step.matcher.value, bound, diags);
}

function checkSubject(subject: Subject, bound: Set<string>, diags: Diagnostic[]): void {
  // `status`/`duration`/`body`/`body text` all reference response data, never a user `{var}`;
  // only a header *name* can itself be interpolated.
  if (subject.type === 'HeaderSubject') checkStringLit(subject.name, bound, diags);
}

function checkApiRequestSpec(spec: ApiRequestSpec, bound: Set<string>, diags: Diagnostic[]): void {
  checkRawPath(spec.path.raw, spec.path.span, bound, diags);
  if (spec.body) checkApiBody(spec.body, bound, diags);
  for (const header of spec.headers) {
    checkStringLit(header.name, bound, diags);
    checkValue(header.value, bound, diags);
  }
}

function checkApiBody(body: ApiBody, bound: Set<string>, diags: Diagnostic[]): void {
  switch (body.type) {
    case 'InlineBody':
      for (const field of body.object.fields) checkValue(field.value, bound, diags);
      break;
    case 'FileBody':
      checkStringLit(body.path, bound, diags);
      break;
    case 'FormBody':
      for (const field of body.fields) checkValue(field.value, bound, diags);
      break;
    case 'TextBody':
      checkStringLit(body.value, bound, diags);
      break;
    case 'UploadBody':
      checkStringLit(body.filePath, bound, diags);
      checkStringLit(body.fieldName, bound, diags);
      for (const field of body.extra) checkValue(field.value, bound, diags);
      break;
  }
}

function checkValue(value: Value, bound: Set<string>, diags: Diagnostic[]): void {
  switch (value.type) {
    case 'StringLit':
      checkStringLit(value, bound, diags);
      break;
    case 'VarRef':
      checkRef(value.name, value.span, bound, diags);
      break;
    case 'Interp':
      checkRefPath(value.ref, value.span, bound, diags);
      break;
    case 'ObjectLit':
      for (const field of value.fields) checkValue(field.value, bound, diags);
      break;
    case 'ArrayLit':
      for (const el of value.elements) checkValue(el, bound, diags);
      break;
    case 'BinaryExpr':
      checkValue(value.left, bound, diags);
      checkValue(value.right, bound, diags);
      break;
    case 'FormatExpr':
      checkValue(value.value, bound, diags);
      checkStringLit(value.pattern, bound, diags);
      break;
    case 'UniquePrefixExpr':
      checkValue(value.prefix, bound, diags);
      break;
    case 'UniqueLikeExpr':
      checkStringLit(value.pattern, bound, diags);
      break;
    case 'RandomNumberExpr':
    case 'RandomDecimalExpr':
    case 'RandomDateBetweenExpr':
      checkValue(value.from, bound, diags);
      checkValue(value.to, bound, diags);
      break;
    case 'RandomOfExpr':
      for (const choice of value.choices) checkValue(choice, bound, diags);
      break;
    case 'RandomStringExpr':
      checkValue(value.length, bound, diags);
      break;
    case 'RandomLikeExpr':
      checkStringLit(value.pattern, bound, diags);
      break;
    case 'RandomPasswordExpr':
      if (value.length) checkValue(value.length, bound, diags);
      break;
    case 'TransformExpr':
      checkValue(value.value, bound, diags);
      break;
    case 'CallExpr':
      for (const arg of value.args) checkValue(arg, bound, diags);
      break;
    // NumberLit, DurationLit, BoolLit, NullLit, EnvRef, DateAtom, DateOffsetLit,
    // UniqueEmailExpr, UniqueNumberExpr, UniqueUuidExpr, RandomDateInPastExpr,
    // RandomDateInFutureExpr, RandomUuidExpr: no refs.
  }
}

function checkStringLit(lit: StringLit, bound: Set<string>, diags: Diagnostic[]): void {
  checkStringParts(lit.parts, lit.span, bound, diags);
}

function checkRawPath(raw: string, span: Span, bound: Set<string>, diags: Diagnostic[]): void {
  checkStringParts(parseStringParts(raw), span, bound, diags);
}

function checkStringParts(parts: readonly StringPart[], span: Span, bound: Set<string>, diags: Diagnostic[]): void {
  for (const part of parts) {
    if (part.kind === 'interp') checkRefPath(part.ref, span, bound, diags);
  }
}

function checkRefPath(ref: readonly PathSegment[], span: Span, bound: Set<string>, diags: Diagnostic[]): void {
  const first = ref[0];
  if (first && first.kind === 'prop') checkRef(first.name, span, bound, diags);
}

function checkRef(name: string, span: Span, bound: Set<string>, diags: Diagnostic[]): void {
  if (bound.has(name)) return;
  const hint = suggest(name, [...bound]);
  diags.push({
    code: Codes.UNKNOWN_VARIABLE,
    severity: 'error',
    message: `unknown variable "${name}"`,
    span,
    hint: hint ? `did you mean \`${hint}\`?` : 'is it defined with `let`, `capture`, a table column, or an action parameter?',
  });
}

function contextError(entry: ConfigEntry, inBlock: string, belongsIn: string): Diagnostic {
  return {
    code: Codes.CONFIG_KEY_CONTEXT,
    severity: 'error',
    message: `\`${keyName(entry)}\` is not allowed in ${inBlock}`,
    span: entry.span,
    hint: `move it to ${belongsIn}`,
  };
}

function keyName(entry: ConfigEntry): string {
  switch (entry.type) {
    case 'WebDecl':
      return 'web';
    case 'ApiServiceDecl':
      return 'api';
    case 'WorkersDecl':
      return 'workers';
    case 'ReportDecl':
      return 'report';
    case 'HeaderDecl':
      return 'header';
    case 'TimeoutDecl':
      return 'timeout';
    case 'InsecureDecl':
      return 'insecure';
    case 'CertDecl':
      return 'cert';
    case 'KeyDecl':
      return 'key';
    case 'AllowHostsDecl':
      return 'allow hosts';
    case 'EvidenceDecl':
      return 'evidence';
    case 'RedactDecl':
      return 'redact';
  }
}
