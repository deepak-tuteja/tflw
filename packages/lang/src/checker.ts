// Semantic checks that go beyond grammar. M1 covers the config dialect (PLAN P#28): a key must
// appear in the right block, and env `default`/name conflicts are errors. M2 adds named-service
// validation against the active env (P#29). M2.65 adds a conservative unknown-variable pass
// (decision 57); full matcher↔subject compatibility checking is still deferred to a later
// milestone (SPEC §1's "static scope" note).

import type {
  ActionDecl,
  ApiBody,
  ApiRequestSpec,
  ConfigEntry,
  ConfigFile,
  ExpectStmt,
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
    ...checkWorkloadTests(program),
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
        // traffic, and `PageSubject` (M3e, `page has no … a11y violations`) reads the page's DOM —
        // neither is this `api` step's own response/connection state, so both are orthogonal to the
        // connects/fails restriction below and excluded from both buckets entirely rather than
        // being misclassified as an incompatible response-based assertion.
        if (expect.subject.type !== 'NetworkRequestSubject' && expect.subject.type !== 'PageSubject') {
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
 * name), `think` legal only inside a workload-bearing body (D18), no browser step inside one
 * (D19 — a browser VU is ~50-100MB, infeasible at load-test scale; checker-enforced rather than
 * left to surface as a runtime crash), and `retry`/`with each` rejected alongside a workload
 * (D96 — a load test's own iterations already provide repetition; it has no per-row cases, only
 * per-VU ones), and a workload-bearing test carries at least one `threshold` (M60, A4-01 — without
 * one there is nothing to decide a verdict from, so the test can never fail).
 *
 * The `think`/browser-step bans resolve through the call graph (`reachableOffender`), not just a
 * test's directly-written steps. Until M60 they did not, and the comment that used to sit here
 * claimed a call into an `action` "still fails loudly at runtime instead of silently doing the
 * wrong thing" — it does not, in either direction (A4-02): a workload test calling an action
 * containing `click` ran 57 384 iterations at a 100 % error rate and reported `PASS`, and a
 * functional test calling an action containing `think 2s` slept for two seconds and reported
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
  }

  const actionsByName = new Map<string, ActionDecl>();
  for (const action of program.actions) if (!actionsByName.has(action.name)) actionsByName.set(action.name, action);

  const isThink = (step: Step): boolean => step.type === 'ThinkStmt';
  const isBrowserStep = (step: Step): boolean =>
    BROWSER_STEP_TYPES.has(step.type) ||
    (step.type === 'ExpectStmt' &&
      (step.subject.type === 'LocatorSubject' || step.subject.type === 'PageSubject' || step.subject.type === 'NetworkRequestSubject'));

  const walkForThink = (steps: readonly Step[]): void => {
    for (const step of steps) {
      if (isThink(step)) {
        diags.push({
          code: Codes.LOAD_INVALID,
          severity: 'error',
          message: '`think` is only legal inside a workload-bearing `test`',
          span: step.span,
          hint: 'a functional `test`/`before`/`after` body uses `wait until …` for eventual consistency, never a fixed sleep — this `test` needs a workload line (`ramp`/`hold`/`step`/`spike`/`run`) for `think` to be meaningful',
        });
      } else if (step.type === 'WithinBlock' || step.type === 'SwitchToNewTabBlock' || step.type === 'DownloadBlock') {
        walkForThink(step.body);
      }
    }
  };
  for (const test of program.tests) {
    if (!test.workload) walkForThink(test.body);
  }
  for (const hook of program.hooks) walkForThink(hook.body);

  // The same two bans, one level of indirection out (M60, A4-02): a call whose callee reaches the
  // banned construct is reported at the call site, since only the caller knows which of the two
  // rules applies.
  const callsIntoThink = (steps: readonly Step[]): void => {
    for (const call of directCalls(steps)) {
      const found = reachableOffender(call.name, actionsByName, isThink);
      if (!found) continue;
      diags.push({
        code: Codes.LOAD_INVALID,
        severity: 'error',
        message: '`think` is only legal inside a workload-bearing `test`',
        span: call.span,
        hint: `\`${found.action.name}\` (line ${found.step.span.start.line}) contains a \`think\`, so calling it from a body with no workload line is a fixed sleep in a functional test — use \`wait until …\` for eventual consistency, or give this \`test\` a workload (\`ramp\`/\`hold\`/\`step\`/\`spike\`/\`run\`)`,
      });
    }
  };
  for (const test of program.tests) {
    if (!test.workload) callsIntoThink(test.body);
  }
  for (const hook of program.hooks) callsIntoThink(hook.body);

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
 * `walkForThink`'s own recursion. */
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
 * `think` or a browser step in the first place, those being tflw steps. `seen` makes a recursive
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
 * recursion `walkForThink` uses) — a `call` into an `action` isn't resolved, a known, accepted
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
  }
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
      case 'ThinkStmt':
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
