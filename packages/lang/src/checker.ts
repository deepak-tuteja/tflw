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
export function checkProgram(program: Program, opts: ProgramCheckOptions = {}): Diagnostic[] {
  return [
    ...(opts.knownServices ? checkServices(program, opts.knownServices) : []),
    ...checkDataTables(program),
    ...(opts.knownSessions ? checkSessions(program, opts.knownSessions) : []),
    ...checkActionDecls(program),
    ...checkUnknownVariables(program),
    ...checkRequestAssertions(program),
    ...checkValueSubjects(program),
    ...checkWorkloadTests(program),
    ...checkCalls(program, opts),
    ...checkResponseScopes(program),
  ];
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
export function checkActionDecls(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const seen = new Map<string, ActionDecl>();
  for (const action of program.actions) {
    const first = seen.get(action.name);
    if (!first) {
      seen.set(action.name, action);
      continue;
    }
    diags.push({
      code: Codes.DUPLICATE_ACTION,
      severity: 'error',
      message: `duplicate action "${action.name}"`,
      span: action.span,
      hint: `already declared at line ${first.span.start.line} — actions are file-scoped, so rename this one or delete it`,
    });
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

  const scope = (steps: readonly Step[]): void => {
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
          scope(step.body);
          break;
        default:
          break;
      }
    }
  };

  for (const test of program.tests) scope(test.body);
  for (const action of program.actions) scope(action.body);
  for (const hook of program.hooks) scope(hook.body);
  return diags;
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
  const walk = (steps: readonly Step[]): void => {
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
        walk(step.body); // M3a/M3b: these block-shaped steps can nest any step, incl. `api`/`expect`.
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
  };
  for (const test of program.tests) walk(test.body);
  for (const action of program.actions) walk(action.body);
  for (const hook of program.hooks) walk(hook.body);
  return diags;
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

  const checkExpect = (expect: ExpectStmt, inWaitUntil: boolean): void => {
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
  };

  const walk = (steps: readonly Step[]): void => {
    for (const step of steps) {
      switch (step.type) {
        case 'ExpectStmt':
          checkExpect(step, false);
          break;
        case 'WaitUntilApiStmt':
          for (const expect of step.expects) checkExpect(expect, true);
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

  for (const test of program.tests) walk(test.body);
  for (const action of program.actions) walk(action.body);
  for (const hook of program.hooks) walk(hook.body);
  return diags;
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
  const seen = new Set<string>();
  return diags.filter((d) => {
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
  // `matches snapshot "<name>"` (M4b) — interpolation-aware like `screenshot "<name>"`, unlike
  // `matchesSchema`/`matchesFile`'s deliberately-plain `schemaName`/`filePath` (ast.ts).
  if (step.matcher.snapshotName) checkStringLit(step.matcher.snapshotName, bound, diags);
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
