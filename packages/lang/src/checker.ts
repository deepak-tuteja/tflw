// Semantic checks that go beyond grammar. M1 covers the config dialect (PLAN P#28): a key must
// appear in the right block, and env `default`/name conflicts are errors. M2 adds named-service
// validation against the active env (P#29). M2.65 adds a conservative unknown-variable pass
// (decision 57); full matcher↔subject compatibility checking is still deferred to a later
// milestone (SPEC §1's "static scope" note).

import type {
  ActionDecl,
  ApiBody,
  ApiRequestSpec,
  CallExpr,
  ConfigEntry,
  ConfigFile,
  EnvBlock,
  ExpectStmt,
  MatcherName,
  NetworkRequestRef,
  PathSegment,
  Program,
  SessionDecl,
  Step,
  StringLit,
  StringPart,
  Subject,
  TestDecl,
  Value,
} from './ast.js';
import type { Span } from './token.js';
import { type Diagnostic, Codes, suggest } from './diagnostic.js';
import { hostMatchesAllowPattern } from './allowHostsPattern.js';
import { MATCHERS, MATCHER_ROW_BY_NAME, type SubjectKind } from './spec-data.js';
import { parseStringParts } from './parser.js';

/** What a caller of `checkProgram` knows about the project around the file being checked. Each
 * field is `undefined` when the caller could not resolve a config at all — distinct from `[]`,
 * which means a config *was* resolved and declares none. The distinction matters: with `[]`,
 * `api users GET /x` is a real error ("the active env declares no named services"); with
 * `undefined` there is nothing to check it against, so the pass is skipped rather than guessed at.
 * The docs-site editor demo is the case that needs it: it runs in a browser, where no `tflw.config`
 * can exist even in principle. The CLI and the language server both always pass a list. */
export interface ProgramCheckOptions {
  readonly knownServices?: readonly string[];
  readonly knownSessions?: readonly string[];
  /** Actions this file's `import` lines bring into scope (M87), resolved by the caller because the
   * checker itself never touches the filesystem. Same `undefined`-vs-`[]` distinction as the two
   * above, and it carries more weight here than anywhere else: with `[]` a call matching no local
   * action is provably unresolvable, while with `undefined` the file's imports were simply not
   * read, and `checkCalls` must not claim a name is unknown when it never looked. A file with no
   * `import` line at all is closed either way — see `checkCalls` for the full closed-world rule. */
  readonly importedActions?: readonly KnownAction[];
  /**
   * Which of this file's path literals name a file that is not there (M97c, D144, `A4-07`) — the
   * *answers*, resolved and stat'd by the caller, keyed by the literal's own text.
   *
   * Shaped exactly like `importedActions`, and for the same reason: the filesystem work happens in
   * `@tflw/runtime` (`resolveMissingFiles`), and the pure pass here turns the answers into
   * diagnostics. Keying by literal text rather than by absolute path is what keeps this file free
   * of `resolve`/`dirname` entirely — `checkProgram` runs on one file, so one literal has one
   * resolution and there is nothing to disambiguate.
   *
   * The `undefined`-vs-empty-set distinction is the docs-site editor demo's, again: it runs in a
   * browser, where the question cannot be asked at all. `undefined` skips the pass; an empty set
   * says the caller looked and everything was there.
   */
  readonly missingFiles?: ReadonlySet<string>;
}

/** One action a call could resolve to: its name, how many arguments it takes, and where it was
 * declared. `from` is the `import "…"` path it came in through, or `null` for one declared in the
 * file being checked — a diagnostic reads very differently depending on which ("declared at line
 * 3" vs. "imported from ./shared/orders.tflw"). */
export interface KnownAction {
  readonly name: string;
  readonly arity: number;
  readonly from: string | null;
  /** Declaration line, for a local action only (`from === null`). */
  readonly line?: number;
}

/**
 * Every semantic pass a single `.tflw` file gets, composed once (M60).
 *
 * Before this existed each consumer assembled its own list, and they had drifted: the CLI ran six
 * passes, the language server ran four (no `checkRequestAssertions`, no `checkWorkloadTests`), and
 * the docs-site editor demo ran one — while `packages/docs-site/editor.md` told the reader the
 * demos run "the exact same resolver code the language server does" and that the squiggles are
 * "the same teaching-quality errors the CLI prints". Both claims were false, and quietly: the
 * missing passes are the ones that report load-testing and connection-assertion mistakes, so an
 * editor showed a clean file that `tflw run` then refused. Adding a pass and forgetting one of
 * three call sites was the standing failure mode; there is now one call site to forget.
 *
 * Cross-file checks that need the *config* tree rather than a program (`validateConfig`,
 * `checkSessionServices`) stay separate — they run once per project, not once per test file.
 */
/**
 * Order a pass's worth of diagnostics the way a reader reads the file (`A4-14`, M97b).
 *
 * Composed output is grouped by *check function*, which is an implementation detail of this file
 * leaking into every consumer: `tflw check` prints a line-9 error above a line-8 one, and the LSP's
 * problem panel lists them the same way. It was cheap to leave alone while one milestone touched
 * one pass; M97b adds a pass and rewires two composition points, so the alternative was re-touching
 * this same output later purely to reorder it.
 *
 * Sorted by offset only, and `sort` is stable — so two diagnostics on the same span keep the pass
 * order they were composed in, which is the one place that order still carries meaning (`TF037` is
 * suppressed alongside `TF040`, `TF041` before `TF042`).
 */
function byPosition(diags: Diagnostic[]): Diagnostic[] {
  return diags.sort((a, b) => a.span.start.offset - b.span.start.offset);
}

export function checkProgram(program: Program, opts: ProgramCheckOptions = {}): Diagnostic[] {
  return byPosition([
    ...(opts.knownServices ? checkServices(program, opts.knownServices) : []),
    ...checkDataTables(program),
    ...(opts.knownSessions ? checkSessions(program, opts.knownSessions) : []),
    ...checkActionDecls(program, opts),
    ...checkUnknownVariables(program),
    ...checkRequestAssertions(program),
    ...checkValueSubjects(program),
    ...checkMatcherSubjects(program),
    ...checkReferencedFiles(program, opts),
    ...checkWorkloadTests(program),
    ...checkCalls(program, opts),
    ...checkActionCycles(program),
    ...checkResponseScopes(program),
  ]);
}

/** Keys valid only in `defaults`, only in `env`, or in both. */
const DEFAULTS_ONLY = new Set(['WorkersDecl', 'ReportDecl', 'ViewportDecl']);
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

/** The **active** env's own base URLs, checked against its own `allow hosts` list (M85, review
 * finding `A4-10`, `TF036`).
 *
 * Both values are literals, in the same file, available in one pass — and an allowlist that
 * excludes the env's own `api` base URL is not a subtle mistake, it is a config in which *every
 * request in the suite* fails identically:
 *
 *     env local default
 *       api "http://127.0.0.1:9099"
 *       allow hosts "example.com"
 *
 * `tflw check` used to say "no problems found" over that, and `tflw run` then produced one
 * excellent runtime message per step — thousands of times in a large suite, for one config line
 * that could have been read once.
 *
 * **Why this takes an `EnvBlock` and not the whole `ConfigFile`.** The first cut checked every env
 * and ran once inside `validateConfig`; the cross-repo gate is what showed that to be wrong.
 * `testFlow-tests` declares `env allowHostsBlocked` whose list deliberately excludes its own base
 * URL — it is the negative-case fixture proving a real, reachable host gets refused — so one
 * intentional env reddened `tflw check` for that whole suite whichever env you actually selected.
 * Env-scoping isn't a concession to that fixture: it is how the rest of the checker already works
 * (`checkServices`, `checkSessionServices` and the `knownServices` opt all validate against the
 * *active* env), so checking every env was the inconsistent choice. The cost is that a
 * contradiction in an env nobody selects ships quietly until someone selects it — at which point
 * this fires, before any request is sent.
 *
 * The rule is otherwise deliberately narrow, because being wrong here means refusing a config that
 * works:
 * - **Only base URLs declared in the config itself** (`api`, `api <service>`, `web`). A URL a test
 *   composes at runtime is not decidable here and is left to the runtime, where it belongs.
 * - **Only fully literal URLs.** `api "https://{API_HOST}/v1"` interpolates an env var; what its
 *   hostname will be is exactly what this pass cannot know, so it is skipped rather than guessed
 *   at (the same conservatism `TF030` states for variables).
 * - **`allow hosts` accumulates across `defaults` + `env`** (SPEC §3.7). Checking an env against
 *   only its own block would flag every config that keeps its baseline list in `defaults` — the
 *   arrangement the SPEC actually recommends.
 *
 * The matcher is `hostMatchesAllowPattern`, imported from the same module the runtime enforces
 * with. Two copies of a matching rule is how a checker comes to bless a config the runtime then
 * refuses — which is this finding, one level down. */
export function checkAllowHostsCoversBaseUrls(config: ConfigFile, env: EnvBlock): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const baseline = config.defaults ? allowHostPatterns(config.defaults.entries) : [];
  const patterns = [...baseline, ...allowHostPatterns(env.entries)];
  if (patterns.length === 0) return diags; // never declared anywhere: no enforcement at all (SPEC §3.7)

  for (const entry of env.entries) {
    const url = baseUrlLiteral(entry);
    if (!url) continue;
    const hostname = literalHostname(url.lit);
    if (hostname === null) continue; // interpolated or unparseable — not decidable here
    if (patterns.some((p) => hostMatchesAllowPattern(hostname, p))) continue;
    diags.push({
      code: Codes.ALLOW_HOSTS_EXCLUDES_BASE_URL,
      severity: 'error',
      message: `env \`${env.name}\`'s \`${url.key}\` base URL is "${url.lit.value}", whose host "${hostname}" is not in its own \`allow hosts\` (${patterns.join(', ')})`,
      span: url.lit.span,
      // Which of the two lines is the wrong one is genuinely the author's call — the allowlist
      // may be the typo, or the base URL may be. Naming both, and the consequence, is the honest
      // shape (C7/M84: say what happened, and don't recommend an edit that isn't obviously the
      // intended one).
      hint: `${url.consequence} — add "${hostname}" to \`allow hosts\`, or point \`${url.key}\` at a host that is already on the list`,
    });
  }
  return diags;
}

function allowHostPatterns(entries: readonly ConfigEntry[]): string[] {
  return entries.flatMap((e) => (e.type === 'AllowHostsDecl' ? e.hosts.map((h) => h.value) : []));
}

/** The config's own declared base URLs, with the key name to quote back at the author and the
 * consequence *that key* actually has.
 *
 * The three differ and the hint must not flatten them: only the default `api` base makes it true
 * that every request in the suite is refused. A named service takes its own calls down and leaves
 * the rest of the suite running, and `web` takes the browser half. Saying "every request" for all
 * three would be the C7 failure — a diagnostic asserting more than it knows — on the one line the
 * author is meant to act on. */
function baseUrlLiteral(entry: ConfigEntry): { readonly key: string; readonly lit: StringLit; readonly consequence: string } | null {
  if (entry.type === 'WebDecl') {
    return { key: 'web', lit: entry.url, consequence: 'every browser step in this env would be refused before it navigates' };
  }
  if (entry.type === 'ApiServiceDecl') {
    return entry.service === null
      ? { key: 'api', lit: entry.url, consequence: 'every request against this env would be refused before it is sent' }
      : { key: `api ${entry.service}`, lit: entry.url, consequence: `every \`api ${entry.service}\` request would be refused before it is sent` };
  }
  return null;
}

/** The hostname of a *fully literal* URL, or `null` if any part of it interpolates or it doesn't
 * parse as a URL at all. Both cases mean "this pass cannot decide", never "this is wrong". */
function literalHostname(lit: StringLit): string | null {
  if (lit.parts.some((p) => p.kind !== 'text')) return null;
  try {
    return new URL(lit.value).hostname || null;
  } catch {
    return null;
  }
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

/**
 * `A4-04` (M97b, D142) — every step-level pass a `session` body gets, composed once.
 *
 * A `session` body is a body of steps: it makes requests, captures out of them, asserts on them.
 * At run time it is one `execSteps` frame, exactly like a hook. But it lives in `tflw.config`
 * rather than a `.tflw` file, so it never reached `checkProgram`, and the only thing anyone had
 * ever wired to it was `checkSessionServices`. `expect status is visible`, a `{typo}`, an
 * assertion before the first request — all silent, in the one block whose failure takes every test
 * that names it down with it.
 *
 * **Not a synthetic `Program`.** Wrapping the body in a fake `TestDecl` would make it visible to
 * `checkWorkloadTests` (which reasons about `workload`/`table`, neither of which a session has)
 * and would give `TF039` a test's framing rather than a hook's. That trades a missing check for a
 * wrong one — a false positive in config, which every run reads.
 *
 * Every pass, triaged one at a time (`sessionPassCoverage.test.ts` holds this list to the source,
 * so the next pass added cannot skip the question — and proves each row below actually fires,
 * because a manifest claiming coverage nothing exercises is worse than no manifest):
 *
 *  - `checkServices` — already covered, via `checkSessionServices`; folded in here so there is one
 *    entry point rather than two things a caller must remember.
 *  - `checkUnknownVariables` — the row's own repro. A session body is its own scope: it can bind
 *    with `let`/`capture` and read those back, and nothing from a test reaches it.
 *  - `checkRequestAssertions` — it runs `api` steps followed by `expect`s, so both halves apply.
 *  - `checkResponseScopes` — `runSession` is one `execSteps` frame, so `TF039` applies exactly as
 *    it does to a hook.
 *  - `checkMatcherSubjects` — the pass added by this same milestone, and the reason the coverage
 *    test earns its place: it would otherwise have shipped with sessions out of scope.
 *  - `checkValueSubjects` — a session captures and then asserts on what it captured, so `TF041`
 *    applies here exactly as in a test. This one was nearly filed N/A on the assumption that
 *    sessions do not use value subjects; being made to write the *reason* is what caught it.
 *  - `checkCalls` — **inverted**. In a test file a call resolves against the file's `action`s; the
 *    config dialect has no `action` declarations at all (`TF021` bans `test`, and there is nothing
 *    to declare one against), so a call here can *never* resolve. It is not "unknown", it is
 *    impossible, and the hint has to say the second thing.
 *  - `checkDataTables`, `checkSessions`, `checkActionDecls`, `checkWorkloadTests` — N/A: they walk
 *    `program.tests`/`program.actions`, which a session has none of. Recorded as N/A with that
 *    reason rather than silently omitted.
 */
export function checkSessionBody(sessions: readonly SessionDecl[], knownServices: readonly string[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const session of sessions) {
    for (const step of session.body) checkStepService(step, knownServices, diags);
    checkStepSequence(session.body, new Set<string>(), diags);
    checkRequestAssertionsInSteps(session.body, diags);
    checkResponseScopeInSteps(session.body, diags);
    checkValueSubjectsInSteps(session.body, diags);
    checkMatcherSubjectsInSteps(session.body, diags);
    checkNoCallsInSteps(session.body, session.name, diags);
  }
  return byPosition(diags);
}

/** `checkCalls` inverted for a session body (M97b, D142) — see `checkSessionBody`. */
function checkNoCallsInSteps(steps: readonly Step[], sessionName: string, diags: Diagnostic[]): void {
  for (const step of steps) {
    if (step.type === 'CallStmt') {
      diags.push({
        code: Codes.UNKNOWN_CALL,
        severity: 'error',
        message: `\`${step.call.name}\` can't be called from a \`session\` block`,
        span: step.span,
        hint: `\`action\`s are declared in \`.tflw\` files, and \`tflw.config\` has no access to them — so no call from \`session ${sessionName}\` can ever resolve. Write the steps out here, or move them into a \`before file\` hook in the test file that needs them`,
      });
    } else if (step.type === 'WithinBlock' || step.type === 'SwitchToNewTabBlock' || step.type === 'DownloadBlock') {
      checkNoCallsInSteps(step.body, sessionName, diags);
    }
  }
}

function checkStepService(step: Step, knownServices: readonly string[], diags: Diagnostic[]): void {
  if (step.type === 'ApiStep') checkService(step.service, step.span, knownServices, diags);
  else if (step.type === 'WaitUntilApiStmt') checkService(step.request.service, step.span, knownServices, diags);
  else if (step.type === 'WithinBlock' || step.type === 'SwitchToNewTabBlock' || step.type === 'DownloadBlock') {
    for (const s of step.body) checkStepService(s, knownServices, diags);
  }
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
 * Action names are unique within a file (M60, A2-01). `env` (`TF024`) and `session` (`TF029`) have
 * always had this rule; `action` did not, so two same-named `action`s passed `tflw check` with "no
 * problems found" and then aborted the whole file at run time — the interpreter throws
 * (`runtime/src/interpreter.ts`, `duplicate action "…"`), the console reporter renders the file as
 * `(crashed)`, and the thrown message survives only in `results.json`. A statically decidable
 * condition that the checker declares clean and the runtime kills the run over is exactly what
 * `tflw check` exists to prevent, so the rule lives here and the interpreter's throw becomes the
 * unreachable backstop it should always have been.
 *
 * Reported at the *second* declaration, pointing back at the first: the first one is not the
 * mistake, and a rename/delete happens at the duplicate.
 */
export function checkActionDecls(program: Program, opts: ProgramCheckOptions = {}): Diagnostic[] {
  const diags: Diagnostic[] = [];
  /** Where a name was first claimed, phrased for a hint — mirrors `buildRegistry`'s insertion
   *  order exactly: this file's own actions in declaration order, then each import in turn. */
  const seen = new Map<string, string>();

  for (const action of program.actions) {
    const first = seen.get(action.name);
    if (!first) {
      seen.set(action.name, `at line ${action.span.start.line}`);
      continue;
    }
    diags.push({
      code: Codes.DUPLICATE_ACTION,
      severity: 'error',
      message: `duplicate action "${action.name}"`,
      span: action.span,
      hint: `already declared ${first} — actions are file-scoped, so rename this one or delete it`,
    });
  }

  // `B5-02`, half 1 (M97b, D143): the imported case. `buildRegistry` has always refused a name that
  // arrives twice — including once locally and once through an `import` — while `TF035` saw only
  // the same-file half. So the manifest, the checker and its test all agreed with each other and
  // all missed what the runtime enforces, which is the finding that stated D138's thesis before it
  // was adopted.
  //
  // Gated on `importedActions !== undefined`, the same `undefined`-vs-`[]` distinction `checkCalls`
  // turns on: `[]` means the imports were read and brought nothing, `undefined` means they were
  // never read, and a name cannot be called a duplicate of something nobody looked at. (`use` is
  // irrelevant here — it brings JS helpers, whose own duplicate rule is a separate throw.)
  if (opts.importedActions !== undefined) {
    const importSpan = new Map(program.imports.map((imp) => [imp.path.value, imp.span]));
    for (const imported of opts.importedActions) {
      const first = seen.get(imported.name);
      const where = imported.from ?? 'an import';
      if (!first) {
        seen.set(imported.name, `by \`import "${where}"\``);
        continue;
      }
      const span = importSpan.get(imported.from ?? '');
      if (!span) continue; // no line to point at — silence beats a diagnostic with a wrong span
      diags.push({
        code: Codes.DUPLICATE_ACTION,
        severity: 'error',
        message: `duplicate action "${imported.name}" (imported from "${where}")`,
        span,
        hint: `already declared ${first} — actions are file-scoped and an \`import\` shares that one namespace, so rename one of them. This is what \`tflw run\` refuses to start on`,
      });
    }
  }

  return diags;
}

// ---------------------------------------------------------------------------
// Call resolution (M87, review cluster C6 — `A4-03`, `FU-08`).
// ---------------------------------------------------------------------------

/**
 * Every `CallExpr` in the program, found structurally rather than by walking the step grammar.
 *
 * The obvious implementation is a switch over `Step`, and it is the wrong one: `directCalls` (M60)
 * is exactly that, and it misses `api POST /x body { id: f() }` because `ApiStep` isn't in its
 * list. A pass that answers "is this call legal *here*" cannot afford to be blind to a position —
 * silence would read as approval. So this recurses over the AST's own object graph and reports
 * every node whose `type` is `CallExpr`, wherever it sits. A step or value shape added later is
 * covered the day it parses, with nothing to remember — which is the property §15's additive-only
 * grammar freeze needs from a check like this.
 *
 * `span` is skipped only to avoid walking position records that can never hold a node.
 */
function eachCall(node: unknown, visit: (call: CallExpr) => void): void {
  if (Array.isArray(node)) {
    for (const el of node) eachCall(el, visit);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const rec = node as Record<string, unknown>;
  if (rec.type === 'CallExpr') visit(rec as unknown as CallExpr);
  for (const key of Object.keys(rec)) {
    if (key === 'span') continue;
    eachCall(rec[key], visit);
  }
}

/** The calls the interpreter actually evaluates: a bare call step, and the *whole* right-hand side
 * of a `let`. Collected by node identity rather than by shape, so `let x = f() + "y"` — where the
 * call is a sub-expression of a `BinaryExpr` and never runs — is correctly excluded. */
function evaluatedCalls(program: Program): Set<CallExpr> {
  const out = new Set<CallExpr>();
  const fromSteps = (steps: readonly Step[]): void => {
    for (const step of steps) {
      switch (step.type) {
        case 'CallStmt':
          out.add(step.call);
          break;
        case 'LetStmt':
          if (step.value.type === 'CallExpr') out.add(step.value);
          break;
        case 'WithinBlock':
        case 'SwitchToNewTabBlock':
        case 'DownloadBlock':
          fromSteps(step.body);
          break;
        default:
          break;
      }
    }
  };
  for (const test of program.tests) fromSteps(test.body);
  for (const action of program.actions) fromSteps(action.body);
  for (const hook of program.hooks) fromSteps(hook.body);
  return out;
}

/**
 * Resolve every call against the actions in scope (M87, `A4-03`/`FU-08` and `TF040`).
 *
 * Until this existed the checker walked a call's *arguments* and never looked at its callee, so a
 * wrong-arity call to an action declared three lines above lint-passed, and so did a typo'd name.
 * Both die at the first step of a real run — `FU-08` filed the typo; `A4-03` is the root cause and
 * covers the arity case too.
 *
 * Three questions, deliberately answered under different amounts of certainty:
 *
 *  - **Is a call legal here at all** (`TF040`) — always answerable, since it is about position, not
 *    names. Reported alone: a call in a dead position gets no `TF037`/`TF038` piled on top, because
 *    its position is the thing to fix and the rest may well evaporate with it.
 *  - **Does this call pass the right number of arguments** (`TF038`) — answerable whenever the name
 *    matches a known action, and sound even when the rest of the world is murky: the interpreter
 *    resolves actions before helpers (`execCall`), and an action name is unique across the whole
 *    registry (`TF035` here, `buildRegistry` at run time both refuse a duplicate), so a name that
 *    matches a declared action *is* that action.
 *  - **Does this call resolve to anything** (`TF037`) — a negative, and the only one of the three
 *    that has to earn the right to be asked. Two conditions, and both were found the hard way:
 *
 *    *A closed world*: every `import` resolved by the caller, and no `use` at all. Enumerating a JS
 *    helper module's exports means importing it, and the checker does not execute the code it
 *    checks, so a single `use` line makes this undecidable for that file. It stays useful
 *    regardless — 124 of the dogfood suite's 155 files have neither an `import` nor a `use`.
 *
 *    *A frame whose registry is knowable*: a `test` or hook body, never an `action` body. Calls are
 *    resolved **late, against the entry file's registry** — an action's body can call a name that
 *    only the file importing it defines, and that runs (verified against a real run, not inferred).
 *    A `test` is safe because an imported file's tests never execute — `buildRegistry` takes only
 *    `actions` from an import — so a test body always runs under its own file's registry. An
 *    `action` body is not, and reporting there would fail every shared library file in a suite.
 *    `shared/root.tflw` in the dogfood repo is exactly that shape, and the day this rule was
 *    written it was the *only* thing in 155 files this pass had to say — see the note in PROGRESS
 *    for why it is a language gap and not that file's mistake.
 */
export function checkCalls(program: Program, opts: ProgramCheckOptions = {}): Diagnostic[] {
  const diags: Diagnostic[] = [];

  const known = new Map<string, KnownAction>();
  for (const action of program.actions) {
    // First declaration wins, matching `buildRegistry`'s insertion order; a second one is
    // `TF035`'s to report, and re-reporting it here as an arity mismatch would be noise.
    if (!known.has(action.name)) {
      known.set(action.name, { name: action.name, arity: action.params.length, from: null, line: action.span.start.line });
    }
  }
  for (const imported of opts.importedActions ?? []) {
    if (!known.has(imported.name)) known.set(imported.name, imported);
  }

  const importsResolved = program.imports.length === 0 || opts.importedActions !== undefined;
  const closedWorld = importsResolved && program.uses.length === 0;

  const evaluated = evaluatedCalls(program);
  const visit = (root: unknown, registryKnowable: boolean): void => eachCall(root, (call) => {
    if (!evaluated.has(call)) {
      diags.push({
        code: Codes.CALL_NOT_EVALUATED,
        severity: 'error',
        message: 'a call in this position is never evaluated',
        span: call.span,
        hint: `bind it first — \`let result = ${call.name}(…)\` — then use \`{result}\` here; a call only runs as its own step or as the whole value of a \`let\``,
      });
      return;
    }

    const action = known.get(call.name);
    if (action) {
      if (call.args.length !== action.arity) {
        diags.push({
          code: Codes.CALL_ARITY,
          severity: 'error',
          message: `action "${call.name}" expects ${plural(action.arity, 'argument')}, got ${call.args.length}`,
          span: call.span,
          hint: action.from === null ? `declared at line ${action.line}` : `imported from "${action.from}"`,
        });
      }
      return;
    }

    if (!closedWorld || !registryKnowable) return;
    const near = suggest(call.name, [...known.keys()]);
    diags.push({
      code: Codes.UNKNOWN_CALL,
      severity: 'error',
      message: `unknown call \`${call.name}(...)\` — no \`action\` or JS helper (\`use\`) defines it`,
      span: call.span,
      ...(near
        ? { hint: `did you mean \`${near}\`?` }
        : known.size > 0
          ? { hint: `this file can call: ${[...known.keys()].map((n) => `\`${n}\``).join(', ')}` }
          : { hint: 'declare it with `action` here, `import "…"` an action from another file, or `use "…"` a JS helper' }),
    });
  });

  for (const test of program.tests) visit(test, true);
  for (const hook of program.hooks) visit(hook, true);
  for (const action of program.actions) visit(action, false);

  return diags;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Action call cycles (M97d, D141 — review row `A4-13`).
// ---------------------------------------------------------------------------

/** Every action a cycle passes through, in call order, ending back where it started (`a → b → a`),
 * paired with the call site that closes it — which is where the diagnostic points, because that is
 * the one line a reader can delete to break the cycle. */
interface CallCycle {
  readonly path: readonly string[];
  readonly closedBy: CallExpr;
}

/** `A4-13`: an `action` that can reach itself. **tflw has no conditionals** — there is no `IfStmt`
 * in the AST and no branching keyword in the parser — so a cycle in the call graph is not
 * *potentially* infinite but unconditionally so: no input terminates it, and the only way such a
 * run can end is by failing. That is what makes rejecting it statically *sound*, which is the
 * checker contract's first clause (D137) and the reason this is an error rather than a warning.
 *
 * **Same-file only, and deliberately not gated on `checkCalls`' closed world.** An edge here joins
 * two actions declared in *this* file, and a same-file name can never be shadowed by an imported
 * one: `buildRegistry` throws on a duplicate (`interpreter.ts:1759`) and `TF035` — widened to the
 * imported case in M97b — reports it statically. So the edge is real no matter what the file's
 * `import`s or `use`s turn out to hold, and requiring a closed world would have skipped this check
 * in every suite that loads a JS helper. Cross-file cycles are a filed follow-up; they need
 * `KnownAction` to carry a body, and until then they are the runtime guard's job (D141). */
export function checkActionCycles(program: Program): Diagnostic[] {
  const declared = new Map<string, ActionDecl>();
  // First declaration wins, as in `checkCalls`/`buildRegistry`; a second is `TF035`'s to report.
  for (const action of program.actions) if (!declared.has(action.name)) declared.set(action.name, action);

  // Only calls the interpreter actually evaluates are edges — `let x = f() + "y"` never runs `f`,
  // so treating it as one would reject a program the runtime is perfectly happy to complete.
  const evaluated = evaluatedCalls(program);
  const edges = new Map<string, CallExpr[]>();
  for (const [name, action] of declared) {
    const out: CallExpr[] = [];
    eachCall(action, (call) => {
      if (evaluated.has(call) && declared.has(call.name)) out.push(call);
    });
    edges.set(name, out);
  }

  const cycles: CallCycle[] = [];
  const reported = new Set<string>();
  const finished = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();

  const walk = (name: string): void => {
    stack.push(name);
    onStack.add(name);
    for (const call of edges.get(name) ?? []) {
      if (onStack.has(call.name)) {
        const path = [...stack.slice(stack.indexOf(call.name)), call.name];
        // One diagnostic per cycle, not one per member: `a → b → a` is reachable from both `a` and
        // `b`, and reporting it twice would make a two-line mistake look like two mistakes. The key
        // is the member *set*, so the same cycle entered at a different point is recognised.
        const key = [...new Set(path)].sort().join('\0');
        if (!reported.has(key)) {
          reported.add(key);
          cycles.push({ path, closedBy: call });
        }
        continue;
      }
      if (!finished.has(call.name)) walk(call.name);
    }
    onStack.delete(name);
    stack.pop();
    finished.add(name);
  };
  // Declaration order, so which member of a cycle gets named first is stable across runs.
  for (const name of declared.keys()) if (!finished.has(name)) walk(name);

  return cycles.map(({ path, closedBy }) => ({
    code: Codes.CALL_CYCLE,
    severity: 'error' as const,
    message: `this call completes a cycle: \`${path.join(' → ')}\``,
    span: closedBy.span,
    hint: path.length === 2
      ? 'tflw has no conditionals, so an action that calls itself has no exit — extract the steps that should run once into a second action'
      : 'tflw has no conditionals, so an action that can reach itself has no exit — extract the shared steps into a third action that calls neither',
  }));
}

// ---------------------------------------------------------------------------
// Response scoping (M87, review cluster C6 — `A4-16`, `FU-12`).
// ---------------------------------------------------------------------------

/** Subjects that read the last `api` step's response, and so require one to exist. The complement
 * is not "everything else": the interpreter routes UI locator subjects, the `page` a11y subject and
 * `request to "…"` network observations away from the response path entirely (`execSteps`'s
 * `ExpectStmt` case), so those are legal with no `api` step anywhere in sight. */
function readsResponse(subject: Subject): boolean {
  switch (subject.type) {
    case 'StatusSubject':
    case 'DurationSubject':
    case 'HeaderSubject':
    case 'BodySubject':
    case 'BodyTextSubject':
    case 'BodyBytesSubject':
    case 'BodyCsvSubject':
    case 'BodyPdfTextSubject':
    case 'RequestSubject':
      return true;
    case 'NetworkRequestSubject':
    case 'LocatorSubject':
    case 'PageSubject':
      return false;
    // M96/`FU-11` — a value subject reads a `let`/`capture` binding out of the variable scope, not
    // the response, so `TF039` has nothing to say about it. `expect {x} equals 1` as a test's very
    // first step is legal and must stay legal. The exemption is only sound because an *unbound*
    // `{x}` is already `TF030` (`checkUnknownVariables`), and because a `capture` that would have
    // bound it is itself flagged here — so exempting the read cannot silently exempt the write.
    case 'ValueSubject':
      return false;
  }
}

/**
 * An assertion or `capture` that runs before any response exists (M87, `A4-16`; `FU-12` is the same
 * defect seen from the caller's side). Statically decidable, and it currently costs a whole run to
 * find out.
 *
 * The unit is a **response scope**, which is narrower than a test. `lastResponse` is a local of the
 * interpreter's `execSteps`, so every frame that function opens starts with no response and cannot
 * see its caller's — and it opens one for each `test`/`action`/hook body *and* for each nested
 * `within` / `switch to new tab` / `download` body. Three consequences, all verified against a real
 * run rather than read off the source:
 *
 *  - Calling an `action` that performs an `api` step does **not** give the caller a response
 *    (`FU-12`). The action's own steps assert against it; the caller's next `expect status` does not.
 *  - A `before` hook's `api` step is invisible to the test body, and `before file`'s doubly so.
 *  - `wait until api` *does* establish one (`execSteps` assigns `lastResponse` from its result),
 *    so it counts alongside `api` here.
 *
 * Only the steps *preceding* the first establishing step in a scope are flagged; the check has
 * nothing to say about anything after it, which is `A4-06`/`A4-15`'s territory.
 */
export function checkResponseScopes(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const scope = (steps: readonly Step[]): void => checkResponseScopeInSteps(steps, diags);
  for (const test of program.tests) scope(test.body);
  for (const action of program.actions) scope(action.body);
  for (const hook of program.hooks) scope(hook.body);
  return diags;
}

/** One response scope — one `execSteps` frame — walked in isolation (M97b, D142). Lifted out of
 *  `checkResponseScopes` so a `session` body, which is exactly one such frame at run time, can be
 *  checked without inventing a synthetic `TestDecl` to wrap it in. */
function checkResponseScopeInSteps(steps: readonly Step[], diags: Diagnostic[]): void {
  let established = false;
  for (const step of steps) {
    switch (step.type) {
      case 'ApiStep':
      case 'WaitUntilApiStmt':
        established = true;
        break;
      case 'ExpectStmt':
        if (!established && readsResponse(step.subject)) {
          diags.push(noResponse(step.subject, step.span, step.soft ? 'check' : 'expect'));
        }
        break;
      case 'CaptureStmt':
        // Every `capture` reads the response — `resolveSubject` rejects the two subjects that
        // don't (`page`, `request to "…"`) outright as uncapturable, so there is no subject for
        // which a `capture` before an `api` step is meaningful.
        if (!established) diags.push(noResponse(step.subject, step.span, 'capture'));
        break;
      case 'WithinBlock':
      case 'SwitchToNewTabBlock':
      case 'DownloadBlock':
        // Its own `execSteps` frame, so its own response scope — an `api` step *outside* the
        // block does not carry into it, and one inside does not carry back out.
        checkResponseScopeInSteps(step.body, diags);
        break;
      default:
        break;
    }
  }
}

function noResponse(subject: Subject, span: Span, kind: 'expect' | 'check' | 'capture'): Diagnostic {
  return {
    code: Codes.NO_RESPONSE_YET,
    severity: 'error',
    message: 'no response yet — an `api` step must run before this assertion/capture',
    span,
    hint: `\`${subjectKeyword(subject)}\` reads the last \`api\` step's response, and no \`api\`/\`wait until api\` step runs before this \`${kind}\` in this body — a response never crosses out of an \`action\` or a hook into the body that called it`,
  };
}

/**
 * `expect`/`check request connects`/`fails` validity (SPEC §6.2.2, PLAN decision 18, enterprise
 * arc cluster 5.5): the one piece of matcher↔subject compatibility checking that *is* static
 * (everything else stays a runtime concern, per the module doc above), because this one has a
 * structural reason a response-based assertion can never coexist with it — a connection-level
 * failure means there is no response for `status`/`header`/`body`/`duration` to read.
 *
 *  - Inside a plain `test`/`action`/`hook` body: for each `api` step, the contiguous run of
 *    `expect`/`check` steps immediately following it (until the next `api` step, `wait until
 *    api`, or end of body) may not mix a `request` assertion with any other subject — flags every
 *    non-`request` assertion in a run that contains at least one `request` assertion.
 *  - Inside `wait until api`'s nested expects: a `request` assertion is rejected outright. `wait
 *    until api` polls a response and re-issues the request on every failed attempt; it never
 *    opts into catching a connection failure the way a plain `api` step does when paired with
 *    `expect request connects`/`fails` (`runtime/src/interpreter.ts`), so a `request` assertion
 *    there would either always report itself as unmet (nothing ever populates a connection error
 *    for it to read) or, if a real connection failure did occur, crash the whole run exactly like
 *    today's unconditional fail-fast — neither is the passing-green behavior this feature exists
 *    to provide.
 */
export function checkRequestAssertions(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const test of program.tests) checkRequestAssertionsInSteps(test.body, diags);
  for (const action of program.actions) checkRequestAssertionsInSteps(action.body, diags);
  for (const hook of program.hooks) checkRequestAssertionsInSteps(hook.body, diags);
  return diags;
}

/** One body's worth of `request`-assertion rules (M97b, D142). Lifted out of
 *  `checkRequestAssertions` for the same reason as `checkResponseScopeInSteps`: a `session` body
 *  runs the same `api`-then-`expect` sequences and was getting none of these checks. */
function checkRequestAssertionsInSteps(steps: readonly Step[], diags: Diagnostic[]): void {
  {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      if (step.type === 'WaitUntilApiStmt') {
        for (const expect of step.expects) {
          if (expect.subject.type === 'RequestSubject') {
            diags.push({
              code: Codes.REQUEST_ASSERTION_INVALID,
              severity: 'error',
              message: '`request` assertions are not supported inside `wait until api`',
              span: expect.span,
              hint: '`wait until api` polls a response and never opts into catching a connection failure — use a plain `api` step followed by `expect request connects`/`fails` instead',
            });
          }
        }
        continue;
      }
      if (step.type === 'WithinBlock' || step.type === 'SwitchToNewTabBlock' || step.type === 'DownloadBlock') {
        checkRequestAssertionsInSteps(step.body, diags); // M3a/M3b: these block-shaped steps can nest any step, incl. `api`/`expect`.
        continue;
      }
      if (step.type !== 'ApiStep') continue;
      let j = i + 1;
      const requestExpects: ExpectStmt[] = [];
      const otherExpects: ExpectStmt[] = [];
      while (j < steps.length && steps[j]!.type === 'ExpectStmt') {
        const expect = steps[j] as ExpectStmt;
        // `NetworkRequestSubject` (M3d, `request to "…"`) reads the browser's observed network
        // traffic, `PageSubject` (M3e, `page has no … a11y violations`) reads the page's DOM, and
        // `ValueSubject` (M96) reads a `let`/`capture` binding — none is this `api` step's own
        // response/connection state, so all three are orthogonal to the connects/fails restriction
        // below and excluded from both buckets entirely rather than being misclassified as an
        // incompatible response-based assertion. `expect request fails` followed by `expect
        // {expectedCode} equals 7` is a perfectly coherent pair.
        if (expect.subject.type !== 'NetworkRequestSubject' && expect.subject.type !== 'PageSubject' && expect.subject.type !== 'ValueSubject') {
          (expect.subject.type === 'RequestSubject' ? requestExpects : otherExpects).push(expect);
        }
        j++;
      }
      if (requestExpects.length > 0 && otherExpects.length > 0) {
        for (const expect of otherExpects) {
          diags.push({
            code: Codes.REQUEST_ASSERTION_INVALID,
            severity: 'error',
            message: `\`expect ${subjectKeyword(expect.subject)}\` can't be combined with \`request connects\`/\`fails\` on the same request`,
            span: expect.span,
            hint: 'there is no response to check once a connection-level failure is being asserted on — move this assertion to a separate `api` call',
          });
        }
      }
    }
  }
}

/**
 * Matchers that need a **live handle** — a browser element, a page, a connection attempt, an
 * observed network request — rather than a value (M96/D132, SPEC §6.2).
 *
 * This is the line the matcher table already draws, read off its "Applies to" column: everything
 * *not* listed here is constrained by the value's **type** (`equals`, `contains`, `is greater
 * than`, `has count`, `matches subset`/`schema`/`file`, `matches "<regex>"`), and a type mismatch
 * has always been a runtime error — `expect body.name is greater than 3` on a string throws at run
 * time today. A captured value must not be stricter than the response it came from, so the
 * type-constrained half is deliberately *not* checked here.
 *
 * The live-handle half passes the admission test `checkRequestAssertions` states above: a
 * structural reason, not a type guess. `expect {x} is visible` is not wrong-for-this-value; it is
 * wrong for anything that is not a browser handle, whatever its type turns out to be.
 *
 * `matches file "<path>"` is pointedly **absent** — its "Applies to" reads `body bytes`, which looks
 * browser-ish but is an ordinary capturable subject (SPEC §5.3). Allowing it is what lets a binary
 * body outlive its request: `capture body bytes as receipt` … three requests later … `expect
 * {receipt} matches file "expected.pdf"`.
 */
const LIVE_HANDLE_MATCHERS: ReadonlyMap<MatcherName, string> = new Map([
  ['hasValue', 'has value'],
  ['visible', 'is visible'],
  ['hidden', 'is hidden'],
  ['enabled', 'is enabled'],
  ['disabled', 'is disabled'],
  ['checked', 'is checked'],
  ['connects', 'connects'],
  ['fails', 'fails'],
  ['wasMade', 'was made'],
  ['hasNoA11yViolations', 'has no a11y violations'],
  ['matchesSnapshot', 'matches snapshot'],
]);

/**
 * Where a `{variable}` subject (M96, `FU-11`) may **not** stand. Two rules, one code (`TF041`):
 *
 *  - **A live-handle matcher** (`LIVE_HANDLE_MATCHERS` above, D132). Deliberately its own code
 *    rather than folded into `TF014`: `TF014`'s registered meaning is an *unrecognised* matcher,
 *    and `is visible` is recognised — it is misplaced. Reusing it would make the generated
 *    codes-reference row false, which is the exact defect class `M92` spent a milestone on.
 *  - **Inside `wait until api`** (D136a). That block re-issues its request and re-evaluates its
 *    nested expects on every poll; a value subject is *constant across polls*, since nothing in the
 *    loop can change `{orderId}`. So it is either true on the first attempt — a no-op dressed as a
 *    wait condition — or false forever, timing out and blaming an endpoint for a condition it never
 *    controlled. Same structural shape `checkRequestAssertions` already uses to reject
 *    `RequestSubject` there.
 */
export function checkValueSubjects(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  forEachExpect(program, (expect, inWaitUntil) => checkOneValueSubject(expect, inWaitUntil, diags));
  return diags;
}

function checkOneValueSubject(expect: ExpectStmt, inWaitUntil: boolean, diags: Diagnostic[]): void {
  {
    if (expect.subject.type !== 'ValueSubject') return;
    const name = refLabel(expect.subject.ref);
    if (inWaitUntil) {
      diags.push({
        code: Codes.VALUE_SUBJECT_INVALID,
        severity: 'error',
        message: `\`{${name}}\` can't be asserted inside \`wait until api\``,
        span: expect.span,
        hint: `\`wait until api\` re-checks its expects on every poll, and \`{${name}}\` cannot change between polls — so this either passes immediately or times out. Assert it before or after the \`wait until api\` block`,
      });
      return;
    }
    const matcher = LIVE_HANDLE_MATCHERS.get(expect.matcher.name);
    if (matcher) {
      diags.push({
        code: Codes.VALUE_SUBJECT_INVALID,
        severity: 'error',
        message: `\`${matcher}\` needs a live browser element, page, or request — not a value`,
        span: expect.span,
        hint: `\`{${name}}\` is a value you bound with \`let\`/\`capture\`; it has no on-screen or on-the-wire state to observe. Value matchers (\`equals\`, \`contains\`, \`is greater than\`, \`has count\`, \`matches …\`) do apply to it (SPEC §6.2)`,
      });
    }
  }
}

/** One body's `{variable}` subjects (M97b, D142) — a `session` can `capture` and then assert on
 *  what it captured, so `TF041` applies there exactly as it does in a test. */
function checkValueSubjectsInSteps(steps: readonly Step[], diags: Diagnostic[]): void {
  forEachExpectInSteps(steps, (expect, inWaitUntil) => checkOneValueSubject(expect, inWaitUntil, diags));
}

/**
 * Every `expect`/`check` in a program, including the ones nested inside `within`/`switch to new
 * tab`/`download` bodies and the ones `wait until api` re-evaluates each poll (`inWaitUntil`).
 *
 * Extracted (M97b) because `checkValueSubjects` and `checkMatcherSubjects` are two views of one
 * rule — see `checkMatcherSubjects` — and were about to hold two copies of this traversal. A block
 * type added to the AST and to only one copy is the drift this milestone exists to make impossible;
 * spending a helper to have one place to forget is cheaper than a test proving two walks agree.
 */
function forEachExpect(program: Program, visit: (expect: ExpectStmt, inWaitUntil: boolean) => void): void {
  for (const test of program.tests) forEachExpectInSteps(test.body, visit);
  for (const action of program.actions) forEachExpectInSteps(action.body, visit);
  for (const hook of program.hooks) forEachExpectInSteps(hook.body, visit);
}

/** The same traversal over one body — what a `session` needs (M97b, D142). */
function forEachExpectInSteps(steps0: readonly Step[], visit: (expect: ExpectStmt, inWaitUntil: boolean) => void): void {
  const walk = (steps: readonly Step[]): void => {
    for (const step of steps) {
      switch (step.type) {
        case 'ExpectStmt':
          visit(step, false);
          break;
        case 'WaitUntilApiStmt':
          for (const expect of step.expects) visit(expect, true);
          break;
        case 'WithinBlock':
        case 'SwitchToNewTabBlock':
        case 'DownloadBlock':
          walk(step.body);
          break;
        default:
          break;
      }
    }
  };
  walk(steps0);
}

/** Which `SubjectKind` an AST subject is (M97b, D140). Exhaustive over `Subject` by construction —
 *  the `satisfies` on the map means a new subject type fails to compile until it is classified,
 *  which is the only way this stays sound as the grammar grows. */
const SUBJECT_KINDS = {
  StatusSubject: 'value',
  DurationSubject: 'value',
  HeaderSubject: 'value',
  BodySubject: 'value',
  BodyTextSubject: 'value',
  BodyBytesSubject: 'value',
  BodyCsvSubject: 'value',
  BodyPdfTextSubject: 'value',
  ValueSubject: 'value',
  LocatorSubject: 'locator',
  PageSubject: 'page',
  RequestSubject: 'request',
  NetworkRequestSubject: 'network-request',
} satisfies Record<Subject['type'], SubjectKind>;

/** How to say each kind in a diagnostic, in the words SPEC §6.2's table uses. */
const KIND_LABELS: Readonly<Record<SubjectKind, string>> = {
  value: 'a value',
  locator: 'a UI locator',
  page: '`page`',
  request: '`request`',
  'network-request': '`request to "…"`',
};

const MATCHER_ROWS = new Map(MATCHERS.map((m) => [m.id, m]));

/**
 * `A4-15` and `A4-11` (M97b, D140) — a matcher standing against a subject kind it cannot read, and
 * an `any`/`all` quantifier on a matcher that cannot be applied per element. One code (`TF042`),
 * because both say the same thing: *this matcher does not belong here*.
 *
 * SPEC §1 and §17 called this "a documented gap … a post-v0.1 item" and pointed at the runtime.
 * That was honest but expensive: `expect status is visible` linted green, ran, and failed with
 * `matcher \`visible\` is not supported on an API subject` — after the request, in the middle of a
 * suite, for a mistake visible in the source text. Both SPEC statements are updated with this pass.
 *
 * **The rule is over subject *kind*, never value shape**, and the distinction is the whole design.
 * `contains`' documented "strings, arrays" is not decidable here — `body.msg` could be either, or
 * neither, and only the response says which. Reading `subjects` as a whitelist over shape as well
 * would start rejecting correct programs, which is `A4-05`'s false-positive failure arriving as the
 * fix for `A4-11`. So every value-bearing subject is one kind, and shape stays a runtime error.
 *
 * **Value subjects are `TF041`'s, not this pass's.** `checkValueSubjects` already rejects exactly
 * the matchers whose rows exclude `value`, with a message written for that case
 * (`` `{orderId}` is a value you bound with `let`/`capture` ``). The two are one rule with two
 * presentations, and `matcherSubjects.test.ts` asserts the sets are identical rather than leaving
 * that a coincidence M96 and M97b happened to share.
 */
export function checkMatcherSubjects(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  forEachExpect(program, (expect) => checkOneMatcherSubject(expect, diags));
  return diags;
}

/** One body's expects (M97b, D142) — a `session` asserts too, and got none of this. */
function checkMatcherSubjectsInSteps(steps: readonly Step[], diags: Diagnostic[]): void {
  forEachExpectInSteps(steps, (expect) => checkOneMatcherSubject(expect, diags));
}

function checkOneMatcherSubject(expect: ExpectStmt, diags: Diagnostic[]): void {
  {
    const row = MATCHER_ROWS.get(MATCHER_ROW_BY_NAME[expect.matcher.name] ?? '');
    if (!row) return;

    // `TF041` owns this pairing, and says it better. Skipping is what keeps one mistake to one
    // diagnostic — the alternative is every misplaced value subject reported twice.
    if (expect.subject.type !== 'ValueSubject') {
      const kind = SUBJECT_KINDS[expect.subject.type];
      if (!(row.subjects as readonly SubjectKind[]).includes(kind)) {
        diags.push({
          code: Codes.MATCHER_SUBJECT_MISMATCH,
          severity: 'error',
          message: `${row.syntax} can't be used on ${KIND_LABELS[kind]}`,
          span: expect.span,
          hint: `${row.syntax} applies to ${row.appliesTo}. Either change the subject, or pick a matcher that reads ${KIND_LABELS[kind]} (SPEC §6.2)`,
        });
        return;
      }
    }

    if (expect.quantifier && !row.quantifiable) {
      diags.push({
        code: Codes.MATCHER_SUBJECT_MISMATCH,
        severity: 'error',
        message: `\`${expect.quantifier}\` can't be combined with ${row.syntax}`,
        span: expect.span,
        hint: `${row.syntax} reads an external document, so it judges the subject whole rather than element by element. Drop the \`${expect.quantifier}\`, or assert on one element (SPEC §6.3)`,
      });
    }
  }
}

const BROWSER_STEP_TYPES = new Set<Step['type']>([
  'OpenStmt',
  'ClickStmt',
  'FillStmt',
  'FillFormStmt',
  'SelectStmt',
  'TickStmt',
  'UntickStmt',
  'PressStmt',
  'HoverStmt',
  'ScrollStmt',
  'WithinBlock',
  'AcceptDialogStmt',
  'DismissDialogStmt',
  'SwitchToNewTabBlock',
  'SwitchToTabStmt',
  'CloseTabStmt',
  'DownloadBlock',
  'DragStmt',
  'DropFileStmt',
  'ScreenshotStmt',
  'StubStmt',
  'WaitUntilUiStmt',
]);

/**
 * Load-arc (M29/M30/M50) semantic checks, now phrased against workload-bearing `test` blocks
 * (`test.workload !== null`) rather than a separate `scenario` node (M50, D93-D96,
 * PLAN_UNIFIED_TEST_WORKLOAD.md): workload-bearing test names unique within a file (M30, D29 — a
 * concurrent multi-load-test run keys each one's own metrics/threshold breakdown by name, so a
 * collision would silently merge two distinct runs' results — this rule is scoped to
 * workload-bearing tests only, since two functional tests have always been allowed to share a
 * name), `pause` legal only inside a workload-bearing body (D18, FS-05), no browser step inside one
 * (D19 — a browser VU is ~50-100MB, infeasible at load-test scale; checker-enforced rather than
 * left to surface as a runtime crash), and `retry`/`with each` rejected alongside a workload
 * (D96 — a load test's own iterations already provide repetition; it has no per-row cases, only
 * per-VU ones), and a workload-bearing test carries at least one `threshold` (M60, A4-01 — without
 * one there is nothing to decide a verdict from, so the test can never fail).
 *
 * The `pause`/browser-step bans resolve through the call graph (`reachableOffender`), not just a
 * test's directly-written steps. Until M60 they did not, and the comment that used to sit here
 * claimed a call into an `action` "still fails loudly at runtime instead of silently doing the
 * wrong thing" — it does not, in either direction (A4-02): a workload test calling an action
 * containing `click` ran 57 384 iterations at a 100 % error rate and reported `PASS`, and a
 * functional test calling an action containing `pause 2s` slept for two seconds and reported
 * `PASS`. Actions are the reuse unit shared by every kind of test (D16) and so still can't be
 * judged on their own — the same action is legal under a workload and illegal outside one — which
 * is why the diagnostic lands on the *call site*, the one place the caller's context is known.
 */
export function checkWorkloadTests(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];

  const seenNames = new Map<string, TestDecl>();
  for (const test of program.tests) {
    if (!test.workload) continue;
    const name = test.name.value;
    const first = seenNames.get(name);
    if (first) {
      diags.push({
        code: Codes.LOAD_INVALID,
        severity: 'error',
        message: `duplicate load test name "${name}"`,
        span: test.span,
        hint: `already declared at ${first.span.start.line}:${first.span.start.column} — workload-bearing test names must be unique within a file, they key its metrics/threshold breakdown in the report`,
      });
    } else {
      seenNames.set(name, test);
    }

    if (test.retry > 0) {
      diags.push({
        code: Codes.LOAD_INVALID,
        severity: 'error',
        message: "`retry` can't be combined with a workload (D96)",
        span: test.span,
        hint: "a load test's own iterations already provide repetition — drop `retry`",
      });
    }
    if (test.table) {
      diags.push({
        code: Codes.LOAD_INVALID,
        severity: 'error',
        message: "`with each` can't be combined with a workload (D96)",
        span: test.span,
        hint: 'a load test has no per-row cases, only per-VU iterations — drop `with each`',
      });
    }
    // M60, A4-01. A workload-bearing test's verdict is decided once, after the run, by its
    // `threshold` lines against the aggregate metrics (SPEC §4.5) — with none there is nothing to
    // decide, so the verdict is unconditionally pass: a 100 %-error-rate run printed `✓`, `PASS`,
    // and exit 0. That is the one thing a testing tool must never ship, it is decidable from a
    // field `checkThresholdScopes` already reads, and it costs one `if`. An error rather than a
    // warning because a warning changes no exit code, and "a CI job that can never fail" is
    // precisely a CI-visible problem.
    if (test.thresholds.length === 0) {
      diags.push({
        code: Codes.LOAD_INVALID,
        severity: 'error',
        message: `workload-bearing test "${name}" has no \`threshold\`, so it can never fail`,
        span: test.span,
        hint: "a workload's verdict comes only from its `threshold` lines against the run's aggregate metrics (SPEC §4.5) — with none, a 100% error rate still reports PASS. Add at least one, e.g. `threshold error rate is less than 1%`",
      });
    }
    // M89c, `B3-14` (D-M89-6). The arm above catches a workload with *no* threshold; this one
    // catches the far commoner shape it lets through — a workload whose only thresholds are on
    // duration. Since M89a those percentiles read the iterations that **succeeded** (SPEC §12), so
    // a service failing half its requests fast and serving the rest in 12ms satisfies
    // `p95 duration is less than 5000ms` with `error rate: 50.00%` printed on the line directly
    // above the `✓`. M60's rule asked for *a* threshold; a duration threshold alone is one that
    // structurally cannot observe failure, which is what `B3-14` means by "not meaningful".
    //
    // The error-rate threshold must be **unscoped**. `threshold error rate for "ok" is less than 1%`
    // constrains one endpoint's own bucket, so a scenario whose *other* endpoint fails half the time
    // passes with both thresholds green — probed live, not assumed. Accepting a scoped one here
    // would be covering one side of the branch, the mistake `M77`→`B3-11`→`M89a` has now made three
    // times; the whole-scenario form is the one that actually decides the verdict.
    //
    // Honest limit, unchanged from D-M89-6 and widened by `B3-17`: this makes an error-rate
    // threshold *present*, not *meaningful*. `is less than 100%` still satisfies it vacuously, and
    // an `api` step with no assertions can never fail at all, so the error rate it bounds is
    // structurally 0.00%. Both are recorded rather than fixed — see `B3-17`.
    const durationThreshold = test.thresholds.find((t) => t.metric.kind === 'duration');
    const scopedErrorRate = test.thresholds.filter((t) => t.metric.kind === 'errorRate' && t.scope);
    const hasScenarioErrorRate = test.thresholds.some((t) => t.metric.kind === 'errorRate' && !t.scope);
    if (durationThreshold && !hasScenarioErrorRate) {
      diags.push({
        code: Codes.LOAD_INVALID,
        severity: 'error',
        message: `workload-bearing test "${name}" thresholds duration but not error rate, so a fast failure passes it`,
        span: durationThreshold.span,
        hint: scopedErrorRate.length
          ? `\`error rate for ${scopedErrorRate.map((t) => `"${t.scope!.value}"`).join('`/`')}\` only bounds that endpoint's own bucket — the rest of the scenario can fail freely. A duration threshold reads only the iterations that succeeded (SPEC §12), so add the whole-scenario form too: \`threshold error rate is less than 1%\``
          : 'a duration threshold reads only the iterations that *succeeded* (SPEC §12), so an endpoint that fails fast and succeeds slowly passes it with a 50% error rate. Pair it with `threshold error rate is less than 1%`',
      });
    }
  }

  const actionsByName = new Map<string, ActionDecl>();
  for (const action of program.actions) if (!actionsByName.has(action.name)) actionsByName.set(action.name, action);

  const isPause = (step: Step): boolean => step.type === 'PauseStmt';
  const isBrowserStep = (step: Step): boolean =>
    BROWSER_STEP_TYPES.has(step.type) ||
    (step.type === 'ExpectStmt' &&
      (step.subject.type === 'LocatorSubject' || step.subject.type === 'PageSubject' || step.subject.type === 'NetworkRequestSubject'));

  // FS-05 rewrote both hints below. They used to send every reader to `wait until …`, which is only
  // half the truth: `wait until` polls a condition, and the two situations that most often make
  // someone reach for a sleep — a cache TTL, a token expiry — have no condition to poll, because
  // elapsed time *is* the thing under test. Naming the escape hatch for those is honest; naming
  // only `wait until` sent them toward a construct that structurally cannot express it.
  const PAUSE_HINT =
    'waiting for something to *become* true is `wait until …` (and `wait until … for <dur>` if it must *stay* true); ' +
    'when elapsed time is genuinely the thing under test — a cache TTL, a token expiry — there is no condition to poll, so use the JS escape hatch (`use "./helpers/…"`, SPEC §11)';

  const walkForPause = (steps: readonly Step[]): void => {
    for (const step of steps) {
      if (isPause(step)) {
        diags.push({
          code: Codes.LOAD_INVALID,
          severity: 'error',
          message: '`pause` is only legal inside a workload-bearing `test`',
          span: step.span,
          hint: `${PAUSE_HINT}. Give this \`test\` a workload line (\`ramp\`/\`hold\`/\`step\`/\`spike\`/\`run\`) and \`pause\` becomes per-iteration pacing, which is what it is for`,
        });
      } else if (step.type === 'WithinBlock' || step.type === 'SwitchToNewTabBlock' || step.type === 'DownloadBlock') {
        walkForPause(step.body);
      }
    }
  };
  for (const test of program.tests) {
    if (!test.workload) walkForPause(test.body);
  }
  for (const hook of program.hooks) walkForPause(hook.body);

  // The same two bans, one level of indirection out (M60, A4-02): a call whose callee reaches the
  // banned construct is reported at the call site, since only the caller knows which of the two
  // rules applies.
  const callsIntoPause = (steps: readonly Step[]): void => {
    for (const call of directCalls(steps)) {
      const found = reachableOffender(call.name, actionsByName, isPause);
      if (!found) continue;
      diags.push({
        code: Codes.LOAD_INVALID,
        severity: 'error',
        message: '`pause` is only legal inside a workload-bearing `test`',
        span: call.span,
        hint: `\`${found.action.name}\` (line ${found.step.span.start.line}) contains a \`pause\`, so calling it from a body with no workload line is a fixed sleep in a functional test — ${PAUSE_HINT}, or give this \`test\` a workload (\`ramp\`/\`hold\`/\`step\`/\`spike\`/\`run\`)`,
      });
    }
  };
  for (const test of program.tests) {
    if (!test.workload) callsIntoPause(test.body);
  }
  for (const hook of program.hooks) callsIntoPause(hook.body);

  for (const test of program.tests) {
    if (!test.workload) continue;
    for (const step of test.body) {
      if (isBrowserStep(step)) {
        diags.push({
          code: Codes.LOAD_INVALID,
          severity: 'error',
          message: "browser steps aren't supported inside a workload-bearing `test` in this milestone (D19)",
          span: step.span,
          hint: 'load tests are API-only in v1 — a browser VU is ~50-100MB, infeasible at load-test scale',
        });
      }
    }
    for (const call of directCalls(test.body)) {
      const found = reachableOffender(call.name, actionsByName, isBrowserStep);
      if (!found) continue;
      diags.push({
        code: Codes.LOAD_INVALID,
        severity: 'error',
        message: "browser steps aren't supported inside a workload-bearing `test` in this milestone (D19)",
        span: call.span,
        hint: `\`${found.action.name}\` (line ${found.step.span.start.line}) contains a browser step — load tests are API-only in v1, a browser VU is ~50-100MB and infeasible at load-test scale, so this call can't run under a workload`,
      });
    }
    checkThresholdScopes(test, diags);
  }

  return diags;
}

/** One call written in a body, by call name and the span to point a diagnostic at (M60, A4-02). */
interface CallSite {
  readonly name: string;
  readonly span: Span;
}

/** Every call written *directly* in `steps` — as a `CallStmt`, or as a `CallExpr` anywhere inside a
 * value (`let x = create order(...)`, an argument to another call, a field of an inline body).
 * Both forms execute the callee's body, and only the statement form was ever considered a call by
 * anything in this file, so both are collected here. Nested block-shaped steps are walked, matching
 * `walkForPause`'s own recursion. */
function directCalls(steps: readonly Step[]): CallSite[] {
  const out: CallSite[] = [];

  const fromValue = (value: Value): void => {
    switch (value.type) {
      case 'CallExpr':
        out.push({ name: value.name, span: value.span });
        for (const arg of value.args) fromValue(arg);
        break;
      case 'ObjectLit':
        for (const field of value.fields) fromValue(field.value);
        break;
      case 'ArrayLit':
        for (const element of value.elements) fromValue(element);
        break;
      case 'BinaryExpr':
        fromValue(value.left);
        fromValue(value.right);
        break;
      case 'FormatExpr':
      case 'TransformExpr':
        fromValue(value.value);
        break;
      default:
        // Every other `Value` is a literal, a `{var}`/`env()` reference, or a generator — none of
        // them can contain a call.
        break;
    }
  };

  for (const step of steps) {
    switch (step.type) {
      case 'CallStmt':
        fromValue(step.call);
        break;
      case 'LetStmt':
      case 'GiveStmt':
        fromValue(step.value);
        break;
      case 'WithinBlock':
      case 'SwitchToNewTabBlock':
      case 'DownloadBlock':
        out.push(...directCalls(step.body));
        break;
      default:
        break;
    }
  }
  return out;
}

/** Depth-first search from a call name for the first step matching `predicate`, anywhere in the
 * callee's body or the bodies it calls in turn (M60, A4-02). Returns the action that *directly*
 * contains the offending step, so the diagnostic can name a specific declaration and line rather
 * than "somewhere below this call".
 *
 * A name that resolves to no `action` in this file is a `use`d JS/TS helper (SPEC §11) or a typo —
 * either way there is no tflw body to inspect, so it is skipped; a `use`d helper cannot contain a
 * `pause` or a browser step in the first place, those being tflw steps. `seen` makes a recursive
 * or mutually recursive action terminate instead of hanging the checker. */
function reachableOffender(
  name: string,
  byName: ReadonlyMap<string, ActionDecl>,
  predicate: (step: Step) => boolean,
  seen: Set<string> = new Set(),
): { action: ActionDecl; step: Step } | undefined {
  if (seen.has(name)) return undefined;
  seen.add(name);
  const action = byName.get(name);
  if (!action) return undefined;

  const scan = (steps: readonly Step[]): Step | undefined => {
    for (const step of steps) {
      if (predicate(step)) return step;
      if (step.type === 'WithinBlock' || step.type === 'SwitchToNewTabBlock' || step.type === 'DownloadBlock') {
        const nested = scan(step.body);
        if (nested) return nested;
      }
    }
    return undefined;
  };
  const direct = scan(action.body);
  if (direct) return { action, step: direct };

  for (const call of directCalls(action.body)) {
    const found = reachableOffender(call.name, byName, predicate, seen);
    if (found) return found;
  }
  return undefined;
}

/** M43 (D70/D72), TF034: a `threshold … for "label"` clause must resolve to at least one `api`
 * step's own identity within the same workload-bearing test — either that step's explicit `as
 * "label"` tag, or its automatically-derived `METHOD path.raw` identity when untagged (mirrors
 * the interpreter's own fallback, `interpreter.ts`'s per-endpoint accumulator). Only walks the
 * test's own body (including into `within`/`switch to new tab`/`download` sub-blocks, same
 * recursion `walkForPause` uses) — a `call` into an `action` isn't resolved, a known, accepted
 * conservative limit shared with `checkUnknownVariables`'s own scope model, since actions aren't
 * required to appear at most once and their own api steps aren't statically visible here without
 * call-graph analysis. */
function checkThresholdScopes(test: TestDecl, diags: Diagnostic[]): void {
  const identities = new Set<string>();
  const collect = (steps: readonly Step[]): void => {
    for (const step of steps) {
      if (step.type === 'ApiStep') {
        identities.add(step.tag ? step.tag.value : `${step.method} ${step.path.raw}`);
      } else if (step.type === 'WithinBlock' || step.type === 'SwitchToNewTabBlock' || step.type === 'DownloadBlock') {
        collect(step.body);
      }
    }
  };
  collect(test.body);

  for (const threshold of test.thresholds) {
    if (!threshold.scope) continue;
    if (!identities.has(threshold.scope.value)) {
      diags.push({
        code: Codes.THRESHOLD_SCOPE_UNKNOWN,
        severity: 'error',
        message: `threshold \`for "${threshold.scope.value}"\` matches no step in this test`,
        span: threshold.scope.span,
        hint: identities.size
          ? `known identities in "${test.name.value}": ${[...identities].map((id) => `"${id}"`).join(', ')}`
          : `"${test.name.value}" has no \`api\` steps to scope a threshold to`,
      });
    }
  }
}

function subjectKeyword(subject: Subject): string {
  switch (subject.type) {
    case 'StatusSubject':
      return 'status';
    case 'DurationSubject':
      return 'duration';
    case 'HeaderSubject':
      return 'header';
    case 'BodySubject':
    case 'BodyTextSubject':
    case 'BodyBytesSubject':
    case 'BodyCsvSubject':
    case 'BodyPdfTextSubject':
      return 'body';
    case 'RequestSubject':
      return 'request';
    case 'NetworkRequestSubject':
      return 'request';
    case 'LocatorSubject':
      return subject.locator.kind;
    case 'PageSubject':
      return 'page';
    case 'ValueSubject':
      return `{${refLabel(subject.ref)}}`;
  }
}

/** `orderId` / `items[2].price` — a value subject's path as the user wrote it inside the braces. */
function refLabel(ref: readonly PathSegment[]): string {
  return ref
    .map((s) => (s.kind === 'prop' ? `.${s.name}` : `[${s.index}]`))
    .join('')
    .replace(/^\./, '');
}

/**
 * Conservative unknown-`{var}` pass (decision 57): flags a bare-identifier value (`VarRef`) or a
 * `{ref}` interpolation whose *base* name is provably never bound anywhere reachable in its scope
 * — a `let`, a `capture`, an action's own parameter, or (for a test with an *inline* `with each`
 * table) a declared column. File-backed tables are skipped (their columns aren't known statically
 * — SPEC §4.3) — this only catches the single most common authoring slip, a typo'd variable name,
 * as a compile-time squiggle instead of a runtime surprise. (Matcher↔subject compatibility used to
 * be disclaimed here as a runtime concern; `checkMatcherSubjects` decides it as of M97b.)
 *
 * Scope model (mirrors the interpreter, `runtime/src/interpreter.ts`):
 *  - `before file` hooks share one scope in declaration order, and `after file` hooks share a
 *    second — mirroring `runFileHooks`, which threads one scope through every hook of one label
 *    and is called twice with nothing carried between the two. A `let` in the first `before file`
 *    is visible to the second; one bound in `before file` is *not* visible in `after file`
 *    (`A4-05`, D139).
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

  // `A4-05` (M97b, D139) — file hooks are grouped by `when`, not lumped together by `scope`.
  //
  // This used to be `hooks.filter(h => h.scope === 'file')` handing each member a fresh empty set,
  // which differs from the interpreter in two ways at once: `runFileHooks` threads *one* scope
  // through every hook of one label, and is called twice with nothing shared between the two. So a
  // second `before file` reading the first's `let` was reported as an unknown variable — a false
  // positive on code that runs correctly, which under clause 1 of the checker's contract is the
  // one thing a checker must never do.
  //
  // The fix is deliberately **not** one shared set for all four hooks. That would trade this false
  // positive for a false negative: a `let` bound in `before file` and read in `after file` really
  // is unresolvable at run time, and the over-strict version catches it today by accident. Two
  // accumulating sets keep that true positive and drop the false one. The each-scope path below
  // was already right, and is the pattern here rather than the exception.
  for (const when of ['before', 'after'] as const) {
    const bound = new Set<string>();
    for (const hook of program.hooks) {
      if (hook.scope === 'file' && hook.when === when) checkStepSequence(hook.body, bound, diags);
    }
  }

  for (const test of program.tests) {
    // A file-backed table's columns aren't known statically (SPEC §4.3 — same reason
    // `checkDataTables` only checks inline tables), and a bare `{col}` in the body is
    // indistinguishable from a genuine typo without that information — so skip this test (and its
    // each-hooks, which share its scope) entirely rather than risk flagging a legitimate column
    // reference as unknown.
    if (test.table && test.table.type === 'FileDataTable') continue;
    // A workload-bearing test (D96 already forbids `table` alongside `workload`, so this branch
    // is mutually exclusive with the table check above) has no data table/session and doesn't
    // share scope with `before`/`after each` hooks the way a functional test does (D26's
    // `cleanup` flag governs whether those hooks *run* under load, not whether their bindings are
    // statically visible here — a distinct, narrower concern deliberately left unaddressed in
    // M29 rather than threading hook scope through a second execution model; carried over
    // unchanged by M50's collapse).
    if (test.workload) {
      checkStepSequence(test.body, new Set<string>(), diags);
      continue;
    }
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
  //
  // The same filter drops any reference the *parser* already diagnosed and left a recovery node
  // behind at (M99a, D168b). `let a = create order` parses to `VarRef(create)` purely so the parser
  // could keep going after reporting ``\`create\` looks like the start of a call``; reporting
  // ``unknown variable "create"`` underneath it is the same mistake told twice, the second time
  // wrongly. Matched by span rather than by name, so a real `create` bound elsewhere in the file is
  // untouched. `recoveredSpans` is empty for every program that parses, so this costs nothing on
  // the path that matters.
  const recovered = new Set((program.recoveredSpans ?? []).map((s) => s.start.offset));
  const seen = new Set<string>();
  return diags.filter((d) => {
    if (d.code === Codes.UNKNOWN_VARIABLE && recovered.has(d.span.start.offset)) return false;
    const key = `${d.code}:${d.span.start.offset}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Every variable a flat step sequence references but does not itself bind — i.e. everything it
 * would need handed to it from an enclosing scope. Seeded with an empty bound-set, this asks
 * exactly the question `checkUnknownVariables` asks of an `action` body, whose scope holds only its
 * own parameters and never the caller's bindings (P#17): *would this sequence still resolve if it
 * were lifted out on its own?*
 *
 * Exported for the reuse pass (`reuse.ts`), which must never propose extracting a window that
 * references something only the caller binds. Until M81 it answered that question with its own
 * hand-written scan for `{name}`-shaped text in a step's structural shape — which saw exactly one
 * of the five channels a reference actually arrives through, and so proposed extractions that
 * turned a clean suite into a non-compiling one (B5-01, S1). Sharing this walk instead is the
 * point: "what counts as a variable reference" now has one definition, and a reference syntax
 * added to the grammar later cannot be understood by the checker and missed by reuse.
 */
export function freeVariableRefs(steps: readonly Step[]): Diagnostic[] {
  const diags: Diagnostic[] = [];
  checkStepSequence(steps, new Set(), diags);
  // `checkStepSequence` also carries the `upload … type "…"` shape check, which is about a
  // literal's format rather than a name's scope — filter to the one code this answers for.
  return diags.filter((d) => d.code === Codes.UNKNOWN_VARIABLE);
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
        // `A4-06` (M95): the subject is checked *before* the name is bound, for the same reason
        // `LetStmt` above does it in that order — a step can never see its own not-yet-assigned
        // name. Until M95 this case was the two lines without the first one, so a `capture` was
        // the one statement in the language whose subject nothing inspected: `capture header
        // "X-{typo}" as v` lint-checked clean while `expect header "X-{typo}" …` — the same
        // `Subject` node, the same `checkSubject` call, three cases up — reported `TF030`.
        checkSubject(step.subject, bound, diags);
        bound.add(step.name);
        break;
      case 'LogStmt':
        checkStringLit(step.message, bound, diags);
        break;
      case 'WaitUntilApiStmt':
        checkApiRequestSpec(step.request, bound, diags);
        for (const expect of step.expects) checkExpectStmt(expect, bound, diags);
        break;
      case 'GiveStmt':
        checkValue(step.value, bound, diags);
        break;
      case 'CallStmt':
        checkValue(step.call, bound, diags);
        break;
      case 'HeaderStmt':
        checkStringLit(step.name, bound, diags);
        checkValue(step.value, bound, diags);
        break;
      case 'OpenStmt':
        checkStringLit(step.path, bound, diags);
        break;
      case 'ClickStmt':
      case 'HoverStmt':
      case 'ScrollStmt':
      case 'UntickStmt':
        checkStringLit(step.locator.value, bound, diags);
        break;
      case 'TickStmt':
        checkStringLit(step.locator.value, bound, diags);
        break;
      case 'FillStmt':
        checkStringLit(step.locator.value, bound, diags);
        checkValue(step.value, bound, diags);
        break;
      case 'FillFormStmt':
        for (const row of step.rows) {
          checkStringLit(row.field, bound, diags);
          checkValue(row.value, bound, diags);
        }
        break;
      case 'SelectStmt':
        checkStringLit(step.locator.value, bound, diags);
        checkValue(step.value, bound, diags);
        break;
      case 'PressStmt':
        checkStringLit(step.keys, bound, diags);
        if (step.locator) checkStringLit(step.locator.value, bound, diags);
        break;
      case 'WithinBlock':
        checkStringLit(step.locator.value, bound, diags);
        // A `within` block shares its enclosing scope (it's a resolution-scoping construct, not a
        // new variable scope) — `bound` is threaded through, not copied, so a `let` above the block
        // is visible inside it and (deliberately, same as any other nested block in this checker) a
        // `let` inside it stays visible to steps after the block too. Same sharing for `within
        // frame` (M3b) — `frame` only changes *where* nested locators resolve, not variable scope.
        checkStepSequence(step.body, bound, diags);
        break;
      case 'AcceptDialogStmt':
      case 'DismissDialogStmt':
        break;
      case 'WaitUntilUiStmt':
        checkSubject(step.subject, bound, diags);
        if (step.matcher.value) checkValue(step.matcher.value, bound, diags);
        break;
      case 'SwitchToNewTabBlock':
        // Shares scope with its enclosing sequence, same as `within` (M3b) — the block exists to
        // let the runtime catch a popup event around its trigger step(s), not to isolate variables.
        checkStepSequence(step.body, bound, diags);
        break;
      case 'SwitchToTabStmt':
      case 'CloseTabStmt':
        break;
      case 'DownloadBlock':
        checkStepSequence(step.body, bound, diags);
        bound.add(step.name);
        break;
      case 'DragStmt':
        checkStringLit(step.from.value, bound, diags);
        checkStringLit(step.to.value, bound, diags);
        break;
      case 'DropFileStmt':
        checkStringLit(step.filePath, bound, diags);
        checkStringLit(step.locator.value, bound, diags);
        break;
      case 'ScreenshotStmt':
        checkStringLit(step.name, bound, diags);
        break;
      case 'StubStmt':
        checkStringLit(step.urlPattern, bound, diags);
        if (step.body) for (const field of step.body.fields) checkValue(field.value, bound, diags);
        break;
      case 'PauseStmt':
        // `minMs`/`maxMs` are plain numbers (parser-level, ast.ts) — no `{var}` interpolation to check.
        break;
    }
  }
}

function checkExpectStmt(step: ExpectStmt, bound: Set<string>, diags: Diagnostic[]): void {
  checkSubject(step.subject, bound, diags);
  if (step.matcher.value) checkValue(step.matcher.value, bound, diags);
  // `matches snapshot "<name>"` (M4b) — interpolation-aware like `screenshot "<name>"`.
  if (step.matcher.snapshotName) checkStringLit(step.matcher.snapshotName, bound, diags);
  // `matches file "<path>"` joined them in M101/D174. Until then the path was read literally at run
  // time, so a `{var}` in it named nothing and checking it would have been checking a brace; now it
  // is a variable reference like any other and an unbound name in it has to be caught here. Adding
  // `evalValue` in the runtime without this line would have made `matches file "{typo}.bin"` the one
  // interpolating operand in the language whose typos survive `check` — the M97 contract (D137-D146)
  // is two-way, so a runtime that starts reading a value obliges the checker to start binding it.
  //
  // `schemaName`/`schemaSource` stay plain and stay unchecked, together — see `A4-OS-10`.
  if (step.matcher.filePath) checkStringLit(step.matcher.filePath, bound, diags);
  for (const mask of step.masks) checkStringLit(mask.value, bound, diags);
}

function checkSubject(subject: Subject, bound: Set<string>, diags: Diagnostic[]): void {
  // `status`/`duration`/`body`/`body text` all reference response data, never a user `{var}`;
  // only a header *name* can itself be interpolated.
  if (subject.type === 'HeaderSubject') checkStringLit(subject.name, bound, diags);
  if (subject.type === 'LocatorSubject') checkStringLit(subject.locator.value, bound, diags);
  if (subject.type === 'NetworkRequestSubject') checkNetworkRequestRef(subject.ref, bound, diags);
  // M96 — the value subject is the one subject that *is* a `{var}`, so it is the one that can be
  // unbound. Without this, `expect {typo} equals 1` would parse, check clean, and fail at run time
  // with the very diagnostic (`TF030`) this pass exists to move earlier.
  if (subject.type === 'ValueSubject') checkRefPath(subject.ref, subject.span, bound, diags);
  // `of request to "…"` (M3d) — carried on the ordinary response subjects; check it the same way
  // regardless of which subject it's attached to.
  if ((subject.type === 'StatusSubject' || subject.type === 'HeaderSubject' || subject.type === 'BodySubject' || subject.type === 'BodyTextSubject') && subject.of) {
    checkNetworkRequestRef(subject.of, bound, diags);
  }
}

function checkNetworkRequestRef(ref: NetworkRequestRef, bound: Set<string>, diags: Diagnostic[]): void {
  checkStringLit(ref.urlPattern, bound, diags);
  if (ref.method) checkStringLit(ref.method, bound, diags);
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
      if (body.contentType) {
        checkStringLit(body.contentType, bound, diags);
        checkContentTypeShape(body.contentType, diags);
      }
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

/** `upload … type "…"` shape check (decision 22/M19) — only for a literal with no `{var}` holes;
 * an interpolated value is a runtime concern, not a static-checker one (mirrors `checkStringLit`'s
 * general split between what's known at check time vs. run time). */
const CONTENT_TYPE_SHAPE = /^[\w.+-]+\/[\w.+-]+$/;

function checkContentTypeShape(lit: StringLit, diags: Diagnostic[]): void {
  const isPureLiteral = lit.parts.length === 1 && lit.parts[0]?.kind === 'text';
  if (!isPureLiteral) return;
  if (CONTENT_TYPE_SHAPE.test(lit.value)) return;
  diags.push({
    code: Codes.INVALID_CONTENT_TYPE,
    severity: 'error',
    message: `invalid content type "${lit.value}", expected a "type/subtype" shape like "image/png"`,
    span: lit.span,
  });
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
    case 'ViewportDecl':
      return 'viewport';
    case 'LogDestinationDecl':
      return 'log destination';
    case 'LogLevelDecl':
      return 'log level';
  }
}

// ---------------------------------------------------------------------------
// `TF043` — a referenced file that is not there (M97c, D144, `A4-07`)
// ---------------------------------------------------------------------------

/** One statically-known path literal in a program, tagged with the syntax that wrote it. The tag
 * only ever phrases the diagnostic, so a reader is told `body from` rather than "a file". */
export interface FileReference {
  readonly syntax: string;
  readonly path: StringLit;
  /** Whether `tflw check` **opens** this file to do its own job, or merely predicts that the run
   * will. Sets the diagnostic's severity — see `checkReferencedFiles` (D147). */
  readonly neededBy: 'check' | 'run';
}

/**
 * Every AST node type that carries a file path, and the field it carries it in.
 *
 * Data rather than a `switch`, because this list is the thing that goes stale: the eighth entry
 * arrives with whatever step reads a file next, and `fileReferenceDrift()` below fails the suite
 * when it does. Same machine-checked-ledger shape as `M97a`'s runtime-rules scan and `M86`'s
 * `Codes`↔`DIAGNOSTICS` guard — the third and fourth times one omission has cost a milestone here.
 *
 * `Matcher` is the odd row: `Matcher.filePath` is set only when `name === 'matchesFile'`, so the
 * entry keys on the node type like every other and simply finds the field absent elsewhere.
 *
 * Two path-shaped things are deliberately *not* rows. `matches schema … from "src"` takes a URL or
 * a path and cannot be told apart statically. `Locator`'s `css`/`xpath` values are selectors that
 * merely look like paths. Neither is a file the runtime opens.
 *
 * **`neededBy` is the severity, and the split is not a matter of taste** (D147). `import`/`use` are
 * read by `resolveImportedActions` *during the check itself*: absent, the checker's own analysis is
 * degraded and it will go on to report the calls they declare as unknown. The other five it never
 * opens — it only `stat`s them, on behalf of a step that has not run yet. A step that has not run
 * yet is one an earlier step, a hook, a `use`d JS action, or a fixture-build between `check` and
 * `run` may be about to create, which makes "not there now" a prediction rather than a fact.
 */
const FILE_BEARING_NODES: readonly { readonly node: string; readonly field: string; readonly syntax: string; readonly neededBy: 'check' | 'run' }[] = [
  { node: 'ImportDecl', field: 'path', syntax: 'import', neededBy: 'check' },
  { node: 'UseDecl', field: 'path', syntax: 'use', neededBy: 'check' },
  { node: 'FileDataTable', field: 'path', syntax: 'with each from', neededBy: 'run' },
  { node: 'FileBody', field: 'path', syntax: 'body from', neededBy: 'run' },
  { node: 'UploadBody', field: 'filePath', syntax: 'upload', neededBy: 'run' },
  { node: 'Matcher', field: 'filePath', syntax: 'matches file', neededBy: 'run' },
  { node: 'DropFileStmt', field: 'filePath', syntax: 'drop file', neededBy: 'run' },
];

/**
 * Collects the path literals a program names, wherever they sit — in declaration order, then in
 * whatever order the walk reaches them (`checkProgram` sorts by position afterwards, so this
 * function owes no ordering of its own).
 *
 * **A structural walk, deliberately, not a per-statement-kind one.** `symbols.ts` and this file
 * both hand-roll a `walkSteps` that must name every block-bearing statement — `within`, `switch to
 * new tab`, `download as`, `fill form`, `wait until` — to reach the steps inside it. A path literal
 * nested inside a block kind such a walker had not been taught about is skipped in silence, and
 * silence is exactly how `A4-07` presents to a user: `no problems found`. Walking the object graph
 * and dispatching on `node.type` cannot miss one, because a new block kind is just another object
 * with children. The cost is one traversal of an already-parsed tree, per file, at check time.
 *
 * **Interpolated paths are skipped, not reported.** `upload "./fixtures/{name}.png"` names no file
 * until the run picks a `name`. That is `ProgramCheckOptions`' own `undefined`-vs-`[]` doctrine
 * stated over a literal — *not knowable* is not *known-bad* — and inverting it would trade a
 * checker that misses real errors for one that invents them, which is the strictly worse of the
 * two under D137 clause 1.
 */
export function collectFileReferences(program: Program): FileReference[] {
  const byNode = new Map(FILE_BEARING_NODES.map((e) => [e.node, e] as const));
  const out: FileReference[] = [];
  const seen = new Set<object>();

  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    const nodeType = record['type'];
    const entry = typeof nodeType === 'string' ? byNode.get(nodeType) : undefined;
    if (entry) {
      const lit = record[entry.field] as StringLit | null | undefined;
      // `parts` is the interpolation-aware breakdown, so "every part is literal text" is the whole
      // test for "this path is known statically".
      if (lit && lit.parts.every((p) => p.kind === 'text')) out.push({ syntax: entry.syntax, path: lit, neededBy: entry.neededBy });
    }
    for (const child of Object.values(record)) visit(child);
  };

  visit(program);
  return out;
}

/**
 * Nodes whose `path`/`filePath` is a `StringLit` but is *not* a file this pass may check, each with
 * the reason — written out because "the guard found it and it was fine" has to be recorded
 * somewhere, or the next person re-derives it or, worse, adds the row and ships false positives.
 *
 * The drift guard found all three on its first run, which is the argument for having written it.
 */
const NOT_A_CHECKABLE_FILE: Readonly<Record<string, string>> = {
  // `open "/orders/{id}"` is a URL path against the env's `web` base URL. Nothing is opened on disk.
  OpenStmt: 'a URL path, not a filesystem path',
  // `cert "…"` / `key "…"` (SPEC §3.5) *are* real files the runtime reads, and they are genuinely
  // unchecked — but they live in `tflw.config`, which is the config dialect: `collectFileReferences`
  // walks a `Program` and never sees a `ConfigFile`. Checking them means the config stage of
  // `loadAndValidate`, not this pass. Filed rather than bolted on here (D144 scoped the test dialect).
  CertDecl: 'config dialect — a real gap, filed; needs the config check path, not `checkProgram`',
  KeyDecl: 'config dialect — a real gap, filed; needs the config check path, not `checkProgram`',
};

/**
 * Node types declared in `ast.ts` that carry a `path`/`filePath` `StringLit` and appear in neither
 * `FILE_BEARING_NODES` nor `NOT_A_CHECKABLE_FILE`. Returns the names it found, so the drift test can
 * say *what* drifted instead of only that something did.
 *
 * Takes `ast.ts`'s source as an argument rather than reading it: `@tflw/lang` does no I/O (that is
 * the invariant this whole milestone turns on), so the test supplies the bytes.
 */
export function fileReferenceDrift(astSource: string): string[] {
  const known = new Set([...FILE_BEARING_NODES.map((e) => e.node), ...Object.keys(NOT_A_CHECKABLE_FILE)]);
  const drift: string[] = [];
  for (const m of astSource.matchAll(/export interface (\w+) extends Node \{\n([\s\S]*?)\n\}/g)) {
    const [, name = '', body = ''] = m;
    if (known.has(name)) continue;
    if (/^\s*readonly (path|filePath)\??: StringLit\b/m.test(body)) drift.push(name);
  }
  return drift;
}

/**
 * `TF043` — a path literal naming a file that is not there.
 *
 * The pass is pure: `opts.missingFiles` already holds the answers, resolved and stat'd by
 * `@tflw/runtime`'s `resolveMissingFiles` against the same `dirname(<test file>)` base the
 * interpreter uses. That last part is the load-bearing one — a checker that resolved a path
 * differently from the runtime would report files as missing that the run finds, which is D137
 * clause 1's failure mode, not a stricter check.
 *
 * Reports the literal, not the resolved path, in the message: the user wrote the literal. The
 * resolution goes in the hint, because the single most common cause of this error is believing
 * paths are relative to the working directory.
 *
 * **Severity is `ref.neededBy`, and that is D147 repairing a D137 clause 1 violation this very
 * milestone shipped.** M97c emitted `'error'` for all seven syntaxes, which makes a valid suite
 * unrunnable with no override — clause 1's exact failure mode, and the one `A4-05` was the worst
 * row in the review for. The proof came from clause 1's own declared evidence, testFlow-tests'
 * corpus, on the first CI run after the stack landed:
 *
 * ```
 *   capture body bytes as receiptBytes
 *   let scratchPath = save temp file(receiptBytes)      # a `use`d JS action; writes the file
 *   …
 *   expect body bytes matches file "../../.scratch/receipt-roundtrip.bin"
 * ```
 *
 * That program runs, and ran for eleven milestones. The path is statically *known* — every part is
 * literal text — and still names nothing at check time, because the run creates it. D144 drew the
 * line at knowable-vs-unknowable and stopped one step short: a literal can be perfectly knowable
 * and name a file that does not exist **yet**. The five run-tier syntaxes therefore warn — printed,
 * caret and all, and the file still runs — while `import`/`use`, which the checker opens itself and
 * no step can conjure, stay errors. The typo coverage D144 was built for survives in both tiers;
 * only the exit code moves, and only where the checker was guessing.
 */
export function checkReferencedFiles(program: Program, opts: ProgramCheckOptions = {}): Diagnostic[] {
  const missing = opts.missingFiles;
  if (!missing || missing.size === 0) return [];
  const diags: Diagnostic[] = [];
  for (const ref of collectFileReferences(program)) {
    if (!missing.has(ref.path.value)) continue;
    const openedByTheChecker = ref.neededBy === 'check';
    diags.push({
      code: Codes.MISSING_FILE,
      severity: openedByTheChecker ? 'error' : 'warning',
      message: `\`${ref.syntax}\` names a file that does not exist: "${ref.path.value}"`,
      span: ref.path.span,
      hint: openedByTheChecker
        ? 'paths resolve against the directory of the file that names them, not the directory `tflw` runs in'
        : 'paths resolve against the directory of the file that names them, not the directory `tflw` runs in — a warning, not an error, because this file is opened during the run, so an earlier step or hook may still create it',
    });
  }
  return diags;
}
