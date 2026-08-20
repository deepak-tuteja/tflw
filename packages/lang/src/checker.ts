// Semantic checks that go beyond grammar — the `check*` passes `checkProgram` composes, plus the
// config-level ones `run`/`check`/the LSP call around it.
//
// The milestone names below are each pass's *origin*, not this file's current scope. M1 covered the
// config dialect (PLAN P#28): a key must appear in the right block, and env `default`/name
// conflicts are errors. M2 added named-service validation against the active env (P#29). M2.65
// added a conservative unknown-variable pass (decision 57). The list has grown through the
// enterprise, browser, perf and security arcs since, and no guard holds a prose scope note to it.
//
// **Matcher↔subject compatibility is no longer deferred** — M97b shipped it as `TF042`, over the
// subject's *kind* and no further, reading `MATCHERS` directly so §6.2's table and this checker are
// one statement rather than two. This header claimed the opposite for eleven milestones, and SPEC
// §1's own note — the thing it pointed at for authority — had already been corrected (`A4-19`).

import type {
  ActionDecl,
  ApiBody,
  ApiRequestSpec,
  CallExpr,
  ConfigEntry,
  ConfigFile,
  CrawlDecl,
  DataTable,
  DateOffsetUnit,
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
  TransformExpr,
  Value,
} from './ast.js';
import type { Span } from './token.js';
import { type Diagnostic, Codes, suggest } from './diagnostic.js';
import { isDecodable, regexCompileError } from './literalValidity.js';
import { hostMatchesAllowPattern } from './allowHostsPattern.js';
import { classifyAddress } from './addressClass.js';
import { absoluteUrlHost, isAbsoluteUrl } from './absoluteUrl.js';
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
  /**
   * The subset of `knownSessions` declared `privileged` (M130b, D307) — principals `has no
   * authorization violations` leaves out of its probe set because they are *meant* to reach other
   * principals' resources.
   *
   * A subset of the roster above rather than a second roster, so the two cannot disagree about
   * which sessions exist. Read only by `checkAuthzAssertions`, and only alongside `knownSessions`:
   * on its own it could not tell "every session is privileged" from "the one session I was told
   * about is privileged".
   */
  readonly privilegedSessions?: readonly string[];
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
  /**
   * Which of this file's `import` path literals name a file that **exists and does not parse**
   * (`M147c`, `M140-03`) — again the *answers*, computed by `@tflw/runtime`'s
   * `resolveImportedActions` on the same walk that produces `importedActions`.
   *
   * Deliberately disjoint from `missingFiles`: an import naming nothing is `TF043`'s, an import
   * naming something unparseable is `TF073`'s, and no path can be in both sets. The pair travels
   * together — whenever this is non-empty, `importedActions` is `undefined`, because a file that
   * did not parse contributed no actions and the world is therefore unknown. Nothing here depends
   * on that, but a caller that broke it would be describing a world it had not resolved.
   *
   * `undefined` skips the pass, on the docs-site editor demo's account, exactly like the option
   * above it: in a browser the question cannot be asked at all, and an empty set would say the
   * caller looked and found every import fine.
   */
  readonly importsWithErrors?: ReadonlySet<string>;
  /**
   * Which base URLs the active env declares (M116, D148) — see `EnvBaseUrls`.
   *
   * `undefined` skips `checkBaseUrls` entirely, for the same reason as every option above it: a
   * caller that resolved no config has not said "this env declares nothing", it has said nothing.
   * Getting that backwards here would be the worst false positive in the file, since it would
   * report every plain `api GET /path` in a suite the CLI had simply not been given a config for.
   */
  readonly envBaseUrls?: EnvBaseUrls;
  /**
   * The active env's resolved timeouts (M124, D236) — see `EnvTimeouts`. Only `wait` is read, by
   * `TF055`, and only to compare against a `for <duration>` hold window written in the file.
   *
   * The fifth field to carry the same `undefined` rule, and the one where getting it backwards is
   * cheapest to do and most embarrassing to ship: a default of `{ wait: 0 }` would make *every*
   * `for` clause in the language "longer than the budget", so a file the CLI was handed without a
   * config would light up entirely. `undefined` means nobody resolved an env, and the pass is
   * skipped rather than guessed at.
   */
  readonly envTimeouts?: EnvTimeouts;
  /**
   * The active env's accumulated `allow hosts` (M125b1, D263) — see `EnvAllowHosts`.
   *
   * The sixth field to carry the `undefined`-vs-empty rule, and the **only one where the empty case
   * is not a safety margin but the diagnostic itself**. Everywhere above, `[]` means "resolved, and
   * there is nothing to check against", so the pass goes quiet. Here `{ hosts: [] }` means "a config
   * was resolved and declares no allowlist", which is precisely the state that makes the runtime
   * refuse an absolute URL — so it is the state `TF058` exists to report, and going quiet on it
   * would lose the rule entirely.
   *
   * `undefined` still means nobody looked, and still skips. Collapsing the two in *that* direction
   * fires `TF058` on every absolute URL in the docs-site editor demo, which runs in a browser where
   * no `tflw.config` can exist even in principle.
   */
  readonly envAllowHosts?: EnvAllowHosts;
  /**
   * The active env's accumulated `authorized target` declarations and its default `api` base URL
   * (M128b, D291) — see `EnvAuthorizedTargets`.
   *
   * The seventh field to carry the `undefined`-vs-empty rule, and it sits on the same side of it as
   * `envAllowHosts`: `{ targets: [] }` is not "nothing to check against", it is "a config was read
   * and authorizes nothing", which is exactly the state `TF060` reports. `undefined` still means
   * nobody looked, and still skips — without which the docs-site editor demo, which runs in a
   * browser where no `tflw.config` can exist, would report every security assertion in every
   * example as unauthorized.
   */
  readonly envAuthorizedTargets?: EnvAuthorizedTargets;
  /**
   * Every `--allow-public-target <origin>` this invocation carried (M131a, D340) — D21 §3.2(3)'s
   * affirmation, which exists precisely so that it **cannot** come from `tflw.config`.
   *
   * The one option in this interface where `undefined` and `[]` mean the same thing, and the
   * exception is principled rather than sloppy: every field above describes a *config* that either
   * was or was not read, so conflating "nobody looked" with "there is nothing" invents a fact. This
   * one describes a *command line*, and a command line nobody passed is a command line with no
   * flags on it. The "nobody looked" rule still applies to the pass — it is carried by
   * `envAuthorizedTargets`, without which `checkPublicTargets` returns nothing at all.
   */
  readonly allowPublicTargets?: readonly string[];
}

/**
 * The active env's `authorized target` declarations, as `TF060` needs them (M128b, D291).
 *
 * **Accumulated across `defaults` + `env` by the caller**, for the reason `EnvAllowHosts` gives at
 * length: SPEC §3.7 makes the two additive, and a suite keeping its declaration in `defaults` — the
 * arrangement the SPEC recommends — would otherwise be reported here as authorizing nothing.
 *
 * `apiBaseUrl` is the *literal* default `api` base for this env, or `null` when the env declares
 * none or writes one containing an `{interpolation}`. Null skips the pass rather than failing it:
 * what an interpolated base URL's host will be is precisely what this pass cannot know, and the
 * same conservatism `TF030` states for variables applies. The narrowness is deliberate and matches
 * `checkAllowHostsCoversBaseUrls` — a URL a test composes at runtime is not decidable here.
 */
export interface EnvAuthorizedTargets {
  readonly envName: string;
  readonly targets: readonly { readonly target: string; readonly reason: string }[];
  readonly apiBaseUrl: string | null;
  /**
   * The env's named services and their base URLs (M131a, D343) — `api @billing "…"`.
   *
   * **Required, not optional, and that is the point.** `TF060` shipped reading only the default
   * `api` base, so a scan against a service origin was gated by nothing at all: no declaration
   * required, no affirmation required, a different host entirely. Making this field optional would
   * let a caller reopen that hole by forgetting a line, so the compiler asks every construction
   * site instead. `[]` is the honest answer for an env that declares no services.
   */
  readonly services: readonly { readonly name: string; readonly url: string }[];
}

/**
 * The active env's `allow hosts`, as `TF058` needs it (M125b1, D263).
 *
 * A list and the env's name, for the reasons `EnvTimeouts` gives: `lang` must not depend on the
 * runtime's config shape, and the diagnostic has to name *which* env declares nothing, since the
 * answer differs per env and the reader picked one.
 *
 * **Accumulated across `defaults` + `env` by the caller, not by this package.** SPEC §3.7 makes the
 * two additive, and `checkAllowHostsCoversBaseUrls` already does that accumulation for the config
 * half — a suite that keeps its baseline list in `defaults` (the arrangement SPEC recommends) would
 * otherwise be reported here as declaring nothing, which is the exact false positive that pass
 * exists to avoid.
 */
export interface EnvAllowHosts {
  readonly envName: string;
  /** Every pattern in force for this env — `defaults` first, then the env's own. Empty means a
   * config was read and declares none, which is a fact, not an absence. */
  readonly hosts: readonly string[];
}

/**
 * The active env's timeouts, as `TF055` needs them (M124, D236).
 *
 * A number and the env's name, not the `ResolvedConfig` object: the `lang` package must not depend
 * on the runtime's config shape, and the rule reads exactly one field. `envName` is here for the
 * same reason it is on `EnvBaseUrls` — the diagnostic has to say *which* env's budget the hold
 * window does not fit inside, since the answer differs per env and the reader picked one.
 */
export interface EnvTimeouts {
  readonly envName: string;
  /** `timeout wait` in milliseconds — the budget bounding a whole `wait until` step. */
  readonly wait: number;
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
  /**
   * The imported action's own steps (M109, review row `M97d-01`) — what lets `checkActionCycles`
   * follow a call out of this file and back in, which until now only the runtime could see.
   *
   * Optional, and the optionality is the same `undefined`-vs-`[]` doctrine as `importedActions`
   * itself one level up: a caller that hands over a name and an arity but no body has not said
   * "this action calls nothing", it has said nothing at all, and the cycle pass must treat that
   * action as a node it cannot look inside rather than as a leaf. `resolveImportedActions` has
   * always had the bodies — it ran a full `parseSource` on each imported file and then dropped
   * `program.actions[].body` on the floor — so the field costs a reference, not a re-parse.
   */
  readonly body?: readonly Step[];
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
    // `M147c` (`M140-03`) — `TF073`, wired beside `TF043` because they are one question asked of
    // one path literal: is the file there, and if it is, does it parse. Both are answered by the
    // caller and turned into diagnostics here.
    ...checkImportsParse(program, opts),
    ...checkBaseUrls(program, opts),
    ...checkSnapshotMasks(program),
    ...checkCapturableSubjects(program),
    // M124 (D232-D233) — the `'static-if-literal'` residue of the same enumeration M116 worked
    // through. `checkLiteralOperands` needs nothing from the caller; `checkHoldWindows` needs the
    // active env's `timeout wait` and skips itself without it.
    ...checkLiteralOperands(program),
    ...checkHoldWindows(program, opts),
    // M125b1 (`FU-18`, D245/D246/D266) — absolute URLs became legal this milestone; this says what
    // one costs. Unlike the two above it is wired unconditionally: `TF059` needs nothing from the
    // caller, and the `TF057`/`TF058` choice is made from `opts.envAllowHosts` inside the pass
    // rather than by skipping it, because "no config was resolved" is still a case with a
    // diagnostic to emit here.
    ...checkAbsoluteUrls(program, opts),
    // M128b (D291) — wired unconditionally for the same reason `checkAbsoluteUrls` is: the
    // skip-without-a-config decision is made *inside* the pass, from `opts.envAuthorizedTargets`,
    // because "a config was resolved and authorizes nothing" is a case with a diagnostic to emit.
    ...checkAuthorizedTargets(program, opts),
    // M131a (D340–D345) — D21 §3.2(3)'s static door. Wired next to the declaration pass because the
    // two are the two halves of one design and read as one message when both fire: `TF060` says
    // this origin is not declared, `TF065` says it is not affirmed for the command line. Neither
    // subsumes the other, which is why they are separate passes rather than one with two branches.
    ...checkPublicTargets(program, opts),
    // M130b (D315/D328/D329) — wired unconditionally, like the two above. Only its `every session
    // is privileged` door needs the caller's config; the rest are AST-only facts, and skipping the
    // whole pass without a config would lose them in exactly the editor where a first authorization
    // assertion is most likely to be written wrong.
    ...checkAuthzAssertions(program, opts),
    // M137c (D443/D464) — `crawl`'s own two rules. The construct's *other* rules are not here: they
    // are wired into the passes that already own them (`checkSessions`, `forEachExpect`,
    // `checkAuthzAssertions`), because a second walker is how two passes come to disagree about what
    // a crawl body is — the argument `checkAuthzAssertions` makes one function up about `within`.
    //
    // **`checkResponseScopes` is deliberately absent, and it is the one omission worth stating.**
    // `TF039` means *there is no response to assert about yet*, decided by whether a request-issuing
    // step precedes the assertion. A crawl body has none by construction: the crawl issues the
    // requests, and each `expect` judges every response it gets back. Wiring the pass would have put
    // `TF039` on every correct crawl in existence — a checker refusing the only shape the feature
    // has. Same for `checkBaseUrls`/`checkAbsoluteUrls`/`checkCapturableSubjects`/`checkDataTables`/
    // `checkWorkloadTests`/`checkCalls`: each is a rule about a step kind `TF070` refuses outright,
    // so wiring them would judge bodies that cannot be legal anyway.
    ...checkCrawls(program),
    ...checkWorkloadTests(program),
    ...checkCalls(program, opts),
    ...checkActionCycles(program, opts),
    ...checkResponseScopes(program),
  ]);
}

/**
 * `TF061` — an `authorized target` must name one origin, and must parse (M128b, D291).
 *
 * **Why a wildcard is rejected here when `allow hosts` accepts one.** The two declarations look
 * alike and mean opposite kinds of thing. `allow hosts` bounds where a suite may send *ordinary*
 * traffic, and a bound expressed as a pattern is still a bound — `*.example.com` genuinely narrows
 * the blast radius. This declaration is not a bound; it is an author affirming, in writing, that
 * they are permitted to point a security scanner at a named host. Nobody is authorized to scan
 * `*.com`, and nobody can know the scope of what a pattern will match at the moment they write it,
 * so accepting one would record a claim its author could not have made truthfully.
 *
 * An unparseable target is the same error one step earlier: `authorized target "staging.example.com"`
 * (no scheme) reads like a declaration and authorizes nothing, since `TF060` compares origins.
 */
/**
 * `TF071` — **`tflw://` is reserved and has exactly one address** (`M118-01`, `M118`/`FU-04`/D199,
 * SPEC §3.1).
 *
 * `api "tflw://dmeo"` parsed, checked green, and died at run time in `guardDemoUrl` with a perfectly
 * good sentence naming the only legal spelling. The set of legal hosts under this scheme has one
 * member, that member is known at check time, and the operand is a string literal in `tflw.config` —
 * so a typo here is decidable before the run starts, and D137 clause 2 says the checker decides it.
 *
 * **Why this shares `TF071` with `workers 0` rather than minting its own code.** The row was filed
 * predicting a new code, and it would have needed one against `TF054`, whose published meaning is an
 * operand *the step will reject the moment it evaluates*. `TF071` says something broader and true of
 * both: **a setting whose written value is not one this setting can act on.** `workers` cannot act
 * on `0`; `api` cannot act on any `tflw://` address but one. Same repair in both cases — write a
 * value the setting accepts — which is `D419`'s one-code-one-repair bar, and §6's rule says reuse
 * when the meaning is right. The suggestion in the hint is richer here because a closed set of one
 * *has* a nearest spelling; that is a better hint, not a different code.
 *
 * **The parse-time siblings are refused in `parser.ts`; this one is refused here**, and the split is
 * principled rather than incidental. `workers 0` is a fact about the *shape* of a number, which the
 * production that reads it already knows everything about. Which addresses a scheme reserves is a
 * fact about the *language's own semantics*, and it lives beside the other config semantics — the
 * same reason `TF033` is documented as "Parser/checker".
 *
 * **Interpolated values are skipped**, D147's line: `api "tflw://{TARGET}"` is a string nobody can
 * evaluate here, and a checker that guessed at it would refuse a config that runs.
 */
function checkReservedScheme(entry: ConfigEntry, diags: Diagnostic[]): void {
  if (entry.type !== 'ApiServiceDecl') return;
  const url = entry.url;
  // `value` has the holes flattened out, so an interpolated string can look like a literal one.
  // `parts` is the only field that can tell them apart, which is exactly why `M74`/`A2-12` fought to
  // keep the `StringLit` on these nodes rather than its `.value`.
  if (url.parts.some((part) => part.kind === 'interp')) return;
  if (!url.value.startsWith(DEMO_SCHEME) || url.value === DEMO_BASE_URL) return;
  diags.push({
    code: Codes.INVALID_SETTING_VALUE,
    severity: 'error',
    message: `\`${url.value}\` is not an address this setting can take`,
    span: url.span,
    hint: `\`${DEMO_SCHEME}\` is reserved and \`${DEMO_BASE_URL}\` is the only address under it — write \`${DEMO_BASE_URL}\` for tflw's bundled demo service, or a real \`http(s)://\` base URL`,
  });
}

function checkAuthorizedTargetLiteral(entry: ConfigEntry, diags: Diagnostic[]): void {
  if (entry.type !== 'AuthorizedTargetDecl') return;
  const raw = entry.target.value;
  if (raw.includes('*')) {
    diags.push({
      code: Codes.AUTHORIZED_TARGET_WILDCARD,
      severity: 'error',
      message: `\`authorized target\` cannot contain a wildcard ("${raw}")`,
      span: entry.target.span,
      hint: 'this declaration is an affirmation that you are permitted to scan one named host, not an allowlist pattern — name the origin in full, e.g. `authorized target "https://staging.example.com"`. (`allow hosts` is the one that takes patterns.)',
    });
    return;
  }
  if (literalOrigin(raw) === null) {
    diags.push({
      code: Codes.AUTHORIZED_TARGET_WILDCARD,
      severity: 'error',
      message: `\`authorized target\` must be an absolute URL with a scheme ("${raw}" is not)`,
      span: entry.target.span,
      // Naming the consequence matters more than naming the fix: silently authorizing nothing is
      // the failure mode, and it looks exactly like a working config until a scan is written.
      hint: 'it is compared against the env\'s base URL by origin (scheme + host + port), so a bare hostname authorizes nothing — write `https://staging.example.com` or `https://localhost:8443`',
    });
  }
}

/**
 * The one principal name the language owns (M130b, D306/D333).
 *
 * `anonymous` is in every authorization probe set without being declared, so it is the one session
 * name a config may not take. Defined here, in the lower package, and re-exported by
 * `@tflw/runtime`'s `authzProbe.ts` as `ANONYMOUS` — a second string literal in the package that
 * *sends* the probe is exactly how a checker comes to reserve a name the runtime does not use.
 */
export const RESERVED_PRINCIPAL = 'anonymous';

/** The one base URL the language reserves (`M118`/`FU-04`, D199), and the scheme it lives under.
 *
 * Defined **here**, in the lowest package, for `RESERVED_PRINCIPAL`'s reason and with a sharper
 * version of it: `packages/cli/src/demo-service.ts` owned this string, and `@tflw/lang` cannot
 * import from `@tflw/cli`, so the checker had no way to know the set of legal `tflw://` addresses
 * has exactly one member — which is the whole of `M118-01`. `demo-service.ts` re-exports both, so
 * every call site upstream is unchanged and there is still one spelling in the repo.
 *
 * A real URL with a reserved scheme, deliberately: `api` still takes a string and
 * `new URL('tflw://demo').hostname` still answers, so nothing in the grammar knows about this
 * feature. What is new is that the *checker* now does, in one place, for one question.
 */
export const DEMO_BASE_URL = 'tflw://demo';

/** Anything under the reserved scheme. Nothing but `DEMO_BASE_URL` resolves under it — SPEC §3.1,
 *  "`tflw://` is reserved; no other address under it resolves". */
export const DEMO_SCHEME = 'tflw://';

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
      checkAuthorizedTargetLiteral(entry, diags);
      checkReservedScheme(entry, diags);
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
      checkAuthorizedTargetLiteral(entry, diags);
      checkReservedScheme(entry, diags);
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
    // M130b/D333 — `anonymous` is a built-in principal, present in every authorization probe set
    // (D306). A declared session by that name is the same *kind* of mistake as a duplicate and gets
    // the same code: one name, two things behind it, and one repair — rename the session. The
    // failure it prevents is silent in both directions, since either the built-in shadows the
    // declaration or the declaration shadows the built-in, and neither says so.
    if (session.name === RESERVED_PRINCIPAL) {
      diags.push({
        code: Codes.CONFIG_SESSION_CONFLICT,
        severity: 'error',
        message: `\`${RESERVED_PRINCIPAL}\` is a reserved principal name`,
        span: session.span,
        hint: '`anonymous` is the built-in identity every `has no authorization violations` assertion probes with — a session by that name would either shadow it or be shadowed by it, in silence. Rename this session',
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
  const check = (sessions: readonly string[], span: Span): void => {
    for (const session of sessions) {
      if (knownSessions.includes(session)) continue;
      const hint = suggest(session, knownSessions);
      diags.push({
        code: Codes.UNKNOWN_SESSION,
        severity: 'error',
        message: `unknown session "${session}"`,
        span,
        hint: hint ? `did you mean \`${hint}\`?` : knownSessions.length ? `known sessions: ${knownSessions.join(', ')}` : 'tflw.config declares no `session` blocks',
      });
    }
  };
  for (const test of program.tests) check(test.sessions, test.span);
  // M137c (D464) — a crawl's `as` list is the same comma list, validated the same way, and it matters
  // more here than on a `test`: a typo'd principal on a test makes one test fail, while a typo'd
  // principal on a crawl silently removes an identity from the differential oracle across the entire
  // discovered surface. That is `M130-01`'s failure shape — a green run over an unjudged surface.
  for (const crawl of program.crawls ?? []) check(crawl.sessions, crawl.span);
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
export function checkSessionBody(
  sessions: readonly SessionDecl[],
  knownServices: readonly string[],
  /** M116/D152 — the active env's base URLs, for `checkBaseUrls`. Optional and `undefined`-skipped
   * like its `ProgramCheckOptions` twin, so a caller that has not resolved an env is not made to
   * invent one. */
  envBaseUrls?: EnvBaseUrls,
  /** M124/D236 — the active env's `timeout wait`, for `checkHoldWindows`. Same optionality, same
   * reason: a caller that resolved no env must not have one invented for it. */
  envTimeouts?: EnvTimeouts,
  /** M125b1/D263 — the active env's `allow hosts`, for `checkAbsoluteUrls`. Optional like the two
   * above, but the optionality means something different and the difference is worth the extra
   * sentence: omitting it does not skip the pass, it selects `TF057` over `TF058`. A caller that has
   * not resolved a config still gets the portability warning, which is true of an absolute URL
   * regardless of any config. */
  envAllowHosts?: EnvAllowHosts,
): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const session of sessions) {
    for (const step of session.body) checkStepService(step, knownServices, diags);
    checkStepSequence(session.body, new Set<string>(), diags);
    checkRequestAssertionsInSteps(session.body, diags);
    checkResponseScopeInSteps(session.body, diags);
    checkValueSubjectsInSteps(session.body, diags);
    checkMatcherSubjectsInSteps(session.body, diags);
    checkNoCallsInSteps(session.body, session.name, diags);
    // M116/D152 — the three new passes. `checkBaseUrls` is the one that matters most here: an
    // un-prefixed `api` step is the dominant shape in a `session`, and a session's failure takes
    // down every test that names it.
    if (envBaseUrls) checkBaseUrlsInSteps(session.body, envBaseUrls, diags);
    checkSnapshotMasksInSteps(session.body, diags);
    checkCapturableSubjectsInSteps(session.body, diags);
    // M124/D236's two. A session body binds with `let` and asserts with `expect` like any other
    // body, so `TF054` applies unchanged; `TF055` is the reachable-rather-than-load-bearing one,
    // wired for the reason D149's mask pass was — a wired pass costs nothing to keep wired.
    checkLiteralOperandsInSteps(session.body, diags);
    if (envTimeouts) checkHoldWindowsInSteps(session.body, envTimeouts, diags);
    // M125b1/D245 — and this one is load-bearing here rather than merely reachable: a `session`
    // exists to log in, and the identity provider a suite authenticates against is very often a
    // different host from the app under test, which is exactly what an absolute URL is for. Note
    // the missing `if` — unlike the two lines above, the pass runs whether or not the caller
    // resolved a config, because "no config" is a case with its own diagnostic here (`TF057`).
    checkAbsoluteUrlsInSteps(session.body, envAllowHosts ? { envAllowHosts } : {}, diags);
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
 *
 * M124 adds the file-backed form's one *static* property: its extension (`M97a-01`, `TF056`).
 */
export function checkDataTables(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const test of program.tests) {
    checkDataTableExtension(test.table, diags);
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
 * `M97a-01` (`TF056`) — `with each from "./rows.txt"`, a data table the loader will refuse (M124).
 *
 * `loadTableRows` accepts `.csv` and `.json` and throws on anything else, *after* reading the file
 * — so the run gets far enough to open the path and then dies on a property that was legible in the
 * source all along. Pure string inspection: no `stat`, no read, nothing the `lang` package is
 * forbidden from doing.
 *
 * **Why this is not `TF043`.** `TF043` is `MISSING_FILE`, and here the file is very likely *there* —
 * being there is what makes the extension the only thing wrong. They are also different tiers for
 * D147's reason: a missing file may be created by an earlier step, so `TF043` predicts and warns,
 * while an extension cannot change between check and run, so this observes and errors.
 *
 * The path is a `StringLit` that the grammar allows to be interpolated, so D237 applies here as
 * everywhere else — `with each from "{dir}/rows.csv"` is skipped rather than guessed at, since the
 * extension of a name nobody has resolved is not a fact.
 */
function checkDataTableExtension(table: DataTable | null | undefined, diags: Diagnostic[]): void {
  if (!table || table.type !== 'FileDataTable') return;
  if (table.path.parts.some((part) => part.kind !== 'text')) return;
  const path = table.path.value;
  const dot = path.lastIndexOf('.');
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  // `extname`'s rule without importing `node:path`: a dot must exist, follow the last separator,
  // and not *be* the first character of the basename (`.csvrc` has no extension, it is a dotfile).
  const ext = dot > slash + 1 ? path.slice(dot).toLowerCase() : '';
  if (ext === '.csv' || ext === '.json') return;
  diags.push({
    code: Codes.DATA_TABLE_EXTENSION,
    severity: 'error',
    message: `data table file "${path}" must be \`.csv\` or \`.json\` (got ${ext ? `"${ext}"` : 'no extension'})`,
    span: table.path.span,
    hint: 'a file-backed `with each` reads rows from CSV (header row) or JSON (array of row objects) — those are the two formats the loader knows, and the extension is how it picks (SPEC §4.3)',
  });
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
  collectEvaluatedCalls(program.tests.map((t) => t.body).concat(program.actions.map((a) => a.body), program.hooks.map((h) => h.body)), out);
  return out;
}

/** The same rule applied to bare step lists rather than a whole `Program` — an imported action's
 * body arrives as `Step[]` with no program around it (M109). Split out rather than duplicated:
 * `let x = f() + "y"` must be a non-edge on both sides of an `import`, and the day a new block
 * step joins the `WithinBlock` list below, one definition is what keeps them agreeing. */
function collectEvaluatedCalls(bodies: readonly (readonly Step[])[], out: Set<CallExpr>): void {
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
  for (const body of bodies) fromSteps(body);
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
  diags.push(...importedBodyCalls(program, known, closedWorld, opts.importedActions ?? []));

  return diags;
}

/**
 * `A4-21` (`M147c`) — the calls written inside an **imported** action's body, resolved against the
 * world of the file doing the importing.
 *
 * This is the exact case the rule above sets aside and it is set aside for a good reason that stops
 * applying here. Calls bind late, against the entry file's registry, so a call inside an `action`
 * body is undecidable *while checking the file that declares it* — `shared/root.tflw` in the
 * dogfood suite calls names only its importers define, and reporting there would fail every library
 * file in every suite. But one level up the same call is fully decidable: this is the registry it
 * will be resolved against, and `resolveImportedActions` already hands over each imported action's
 * `body` (M109, for `TF044`). The undecidable frame and the decidable one are the same code read
 * from two positions, which is why the answer is a second pass and not a loosened flag.
 *
 * What it catches is the row verbatim: **`import` does not recurse.** `main` imports
 * `lib/orders.tflw`, which imports `lib/helpers.tflw` and calls `makeId` — `buildRegistry` takes
 * only `program.actions` from an import, never its `imports` or its `uses`, so `makeId` is not in
 * the registry `createOrder` runs under. `tflw check .` said *3 files checked, no problems found*
 * and the run died on the first step with `unknown call \`makeId(...)\``. An extracted action could
 * not carry its own dependency, and nothing said so until the run.
 *
 * **`TF037`, not a new code** (D634's allocation rule): the call is genuinely unknown in the
 * registry it will be resolved against, so the code's published meaning is true here — only the
 * *location* differs, and location is what the message and the caret are for.
 *
 * Three narrowings, each of which would otherwise make this lie:
 *
 *  - **`closedWorld` only**, exactly as above. A `use` in this file can define the name.
 *  - **Evaluated positions only.** A call that never runs cannot fail, and `collectEvaluatedCalls`
 *    exists over bare `Step[]` for precisely this — an imported body arrives with no `Program`
 *    around it.
 *  - **Once per (import, name).** A helper called eleven times in a library is one missing import,
 *    and eleven diagnostics on one line is the cascade shape this milestone keeps deleting.
 *
 * The caret goes on the local `import` path literal, never into the imported file's text: that span
 * belongs to another file's coordinates and rendering it against this source underlines an
 * unrelated line. `TF044` already draws that line — a call inside an imported body can be *named*
 * in a message and never underlined — and `TF073` draws it again from the parse side.
 */
function importedBodyCalls(program: Program, known: Map<string, KnownAction>, closedWorld: boolean, imported: readonly KnownAction[]): Diagnostic[] {
  if (!closedWorld) return [];
  const diags: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const action of imported) {
    if (!action.body || action.from === null) continue;
    const imp = program.imports.find((i) => i.path.value === action.from);
    if (!imp) continue; // no local line to point at — silence beats a diagnostic with a wrong span
    const evaluated = new Set<CallExpr>();
    collectEvaluatedCalls([action.body], evaluated);
    for (const call of evaluated) {
      if (known.has(call.name)) continue;
      const key = `${action.from}\u0000${call.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const near = suggest(call.name, [...known.keys()]);
      diags.push({
        code: Codes.UNKNOWN_CALL,
        severity: 'error',
        message: `imported action "${action.name}" calls \`${call.name}(...)\`, which nothing in this file defines`,
        span: imp.path.span,
        hint: near
          ? `did you mean \`${near}\`? An imported action's calls resolve against *this* file's registry, not against its own file's`
          : `\`import\` brings in a file's \`action\`s and nothing else — not the \`import\`s or \`use\`s that file itself declares. Whatever "${action.from}" depends on has to be brought into this file too, or the run fails on the first step that reaches it`,
      });
    }
  }
  return diags;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Action call cycles (M97d, D141 — review row `A4-13`).
// ---------------------------------------------------------------------------

/** One node of the call graph a run would build: an action's steps, and where they were declared.
 * `from` is the `import "…"` path an action came in through, or `null` for one declared in the file
 * being checked — which is what decides whether a call inside it has a span this file can point
 * at. */
interface CycleNode {
  readonly body: readonly Step[];
  readonly from: string | null;
}

/** One call joining two nodes. `localSite` is the property the reporting turns on: a call written
 * inside an imported body has a span into *that* file's text, so it can be named in a message but
 * never underlined here. */
interface CallEdge {
  readonly to: string;
  readonly call: CallExpr;
  readonly localSite: boolean;
}

/** Every action a cycle passes through, in call order, ending back where it started (`a → b → a`),
 * paired with the calls that join them — the last of which closes the cycle. */
interface CallCycle {
  readonly path: readonly string[];
  readonly edges: readonly CallEdge[];
}

/** `A4-13`: an `action` that can reach itself. **tflw has no conditionals** — there is no `IfStmt`
 * in the AST and no branching keyword in the parser — so a cycle in the call graph is not
 * *potentially* infinite but unconditionally so: no input terminates it, and the only way such a
 * run can end is by failing. That is what makes rejecting it statically *sound*, which is the
 * checker contract's first clause (D137) and the reason this is an error rather than a warning.
 *
 * **Not gated on `checkCalls`' closed world.** A same-file name can never be shadowed by an imported
 * one: `buildRegistry` throws on a duplicate (`interpreter.ts:1759`) and `TF035` — widened to the
 * imported case in M97b — reports it statically. So the edge is real no matter what the file's
 * `use`s turn out to hold, and requiring a closed world would have skipped this check in every suite
 * that loads a JS helper.
 *
 * **Across `import`s too, when the caller resolved them (M109, `M97d-01`).** D141 shipped this
 * same-file only, on the true statement that `KnownAction` carried no body, and left the residue to
 * the runtime guard. The graph below is now the one a run would actually build: local actions, then
 * whatever `opts.importedActions` brought in, first declaration winning exactly as `buildRegistry`
 * and `checkCalls` have it. That merge *is* the reason the cross-file case is decidable at all —
 * calls bind late, against the entry file's registry, so an imported body's `a()` means this file's
 * `a` when this file declares one, and there is no second registry to disambiguate against.
 *
 * Two consequences worth stating, because both are limits rather than bugs:
 *
 *  - With `importedActions` `undefined` (imports present, unread or unparseable) the pass sees only
 *    local edges, as before. That is the `undefined`-vs-`[]` doctrine again: a body nobody read is
 *    not an empty body.
 *  - A cycle whose every call site sits inside imported files is **not reported here**, because
 *    there would be no span in this file to underline and a caret pointing into another file's text
 *    is the defect M106 closed. It is a same-file cycle *of that file*, reported when it is checked
 *    — `tflw check` and a bare `tflw run` both discover every `.tflw` under the cwd — and caught by
 *    the runtime guard regardless. */
export function checkActionCycles(program: Program, opts: ProgramCheckOptions = {}): Diagnostic[] {
  const graph = new Map<string, CycleNode>();
  // First declaration wins, as in `checkCalls`/`buildRegistry`; a second is `TF035`'s to report.
  for (const action of program.actions) if (!graph.has(action.name)) graph.set(action.name, { body: action.body, from: null });
  for (const imported of opts.importedActions ?? []) {
    if (imported.body !== undefined && !graph.has(imported.name)) graph.set(imported.name, { body: imported.body, from: imported.from });
  }

  // Only calls the interpreter actually evaluates are edges — `let x = f() + "y"` never runs `f`,
  // so treating it as one would reject a program the runtime is perfectly happy to complete. The
  // rule applies inside an imported body exactly as it does here, hence the second pass.
  const evaluated = evaluatedCalls(program);
  collectEvaluatedCalls([...graph.values()].filter((node) => node.from !== null).map((node) => node.body), evaluated);

  const edges = new Map<string, CallEdge[]>();
  for (const [name, node] of graph) {
    const out: CallEdge[] = [];
    eachCall(node.body, (call) => {
      if (evaluated.has(call) && graph.has(call.name)) out.push({ to: call.name, call, localSite: node.from === null });
    });
    edges.set(name, out);
  }

  const cycles: CallCycle[] = [];
  const reported = new Set<string>();
  const finished = new Set<string>();
  const stack: string[] = [];
  // Parallel to `stack`: the edge that pushed each frame, so a cycle can be reported at a call site
  // other than the closing one. Only the DFS root's slot is `undefined`, and it is at index 0.
  const stackEdges: (CallEdge | undefined)[] = [];
  const onStack = new Set<string>();

  const walk = (name: string, enteredBy: CallEdge | undefined): void => {
    stack.push(name);
    stackEdges.push(enteredBy);
    onStack.add(name);
    for (const edge of edges.get(name) ?? []) {
      if (onStack.has(edge.to)) {
        const at = stack.indexOf(edge.to);
        const path = [...stack.slice(at), edge.to];
        // One diagnostic per cycle, not one per member: `a → b → a` is reachable from both `a` and
        // `b`, and reporting it twice would make a two-line mistake look like two mistakes. The key
        // is the member *set*, so the same cycle entered at a different point is recognised.
        const key = [...new Set(path)].sort().join('\0');
        if (!reported.has(key)) {
          reported.add(key);
          // `at + 1 >= 1`, so the root's `undefined` slot is never in the slice.
          cycles.push({ path, edges: [...(stackEdges.slice(at + 1) as CallEdge[]), edge] });
        }
        continue;
      }
      if (!finished.has(edge.to)) walk(edge.to, edge);
    }
    onStack.delete(name);
    stack.pop();
    stackEdges.pop();
    finished.add(name);
  };
  // Declaration order, so which member of a cycle gets named first is stable across runs.
  for (const name of graph.keys()) if (!finished.has(name)) walk(name, undefined);

  return cycles.flatMap(({ path, edges: cycleEdges }) => {
    const closing = cycleEdges[cycleEdges.length - 1]!;
    // Where to point. The closing call is the one line a reader can delete to break the cycle, so
    // it stays the anchor whenever it is in this file — every same-file cycle reports exactly where
    // it did before M109. When the cycle closes inside an imported body there is no such line here,
    // and the first local call in the cycle is the next best thing: the step that hands control out
    // of this file. Neither: nothing to underline, so nothing to report (see the note above).
    const anchor = closing.localSite ? closing : cycleEdges.find((edge) => edge.localSite);
    if (anchor === undefined) return [];

    const provenance = [...new Set(path)]
      .map((name) => [name, graph.get(name)?.from] as const)
      .filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string')
      .map(([name, from]) => `\`${name}\` is imported from "${from}"`)
      .join(', ');

    if (anchor !== closing) {
      // The closing call is inside an imported body, so its source action is an imported one.
      const closingSource = path[path.length - 2]!;
      return [{
        code: Codes.CALL_CYCLE,
        severity: 'error' as const,
        message: `this call enters a cycle: \`${path.join(' → ')}\``,
        span: anchor.call.span,
        hint: `\`${closingSource}\` is imported from "${graph.get(closingSource)!.from}" and calls \`${closing.to}\` — tflw has no conditionals, so an action that can reach itself has no exit; break the chain here or in that file`,
      }];
    }

    const base = path.length === 2
      ? 'tflw has no conditionals, so an action that calls itself has no exit — extract the steps that should run once into a second action'
      : 'tflw has no conditionals, so an action that can reach itself has no exit — extract the shared steps into a third action that calls neither';
    return [{
      code: Codes.CALL_CYCLE,
      severity: 'error' as const,
      message: `this call completes a cycle: \`${path.join(' → ')}\``,
      span: anchor.call.span,
      // Provenance only when the cycle actually leaves the file — a wholly local cycle's hint is
      // unchanged, and appending an empty clause to it would be noise on the common case.
      hint: provenance === '' ? base : `${base} (${provenance})`,
    }];
  });
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
    // M128b — `response` reads the last `api` step's response the same way `status` does; it just
    // reads all of it. So it is on this side of the line and inherits `TF039` unchanged: `expect
    // response has no security violations` with no `api` step above it is the same authoring
    // mistake as `expect status equals 200` there, and gets the same diagnostic rather than a new
    // one. Note this is *not* D285 — that is about a scan whose rules all stood down, which is a
    // run-time verdict about a response that did arrive.
    case 'ResponseSubject':
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
      case 'MalformedStep':
        // `M147c`/`M140-01`. The user wrote an `api` step here and the parser could not finish
        // reading it, so this frame *does* have a response — saying otherwise on the next line is
        // not a redundant diagnostic, it is a false one, and it points at a line that is fine.
        //
        // Reached by six measured shapes, not the one the row named: a bad inline `body`, a bad
        // `form`, a bad duration after `timeout`, an unknown method, `without` not followed by
        // `redirects`, and a non-string after `as`. The row's discriminator — that a trailing-token
        // error like `api GET /o headerz "x"` does *not* cascade — is real but reads the wrong
        // joint. It is not the body branch; it is that `endLine()` reports after the node is built
        // while every one of those six returns `null` before it. So the repair belongs where the
        // node goes missing, not in `parseApiBody`.
        //
        // **Establishing on a malformed head loses nothing.** The only diagnostic it can suppress
        // is one that says no `api` step precedes this — and if the head is `api`, one does.
        if (step.head === 'api' || step.head === 'wait until api') established = true;
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
      case 'CsrfStmt':
        // M137b (D433/D456) — `csrf from body.csrfToken send as header "X-CSRF-Token"` reads the
        // establishment response through the same `resolveSubject` path `capture` does, so it lands
        // in the same case for the same reason. This is why D443's `TF069` was withdrawn: the code it
        // proposed would have said "this session issues no request" with the repair *run an `api`
        // step first*, which is this diagnostic's repair already — and this one is **positional**, so
        // it also catches the clause written above the login step, which a whole-body check could not
        // see. A second code here would have been D419's rejected shape: two rows, one repair.
        if (!established) diags.push(noResponse(step.subject, step.span, 'csrf from'));
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

function noResponse(subject: Subject, span: Span, kind: 'expect' | 'check' | 'capture' | 'csrf from'): Diagnostic {
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
  // M128b/D290 — a security scan needs an observed response: its status line, its headers, its
  // `Set-Cookie` lines and the request that produced them. A bound value carries none of that,
  // whatever its type, which is the same structural reason (not a type guess) every other row here
  // qualifies on.
  ['hasNoSecurityViolations', 'has no security violations'],
  // M130b/D304 — the same structural reason one line up, and one more besides: this scan does not
  // only read the observed response, it re-issues the observed *request* under other principals. A
  // bound value carries neither half.
  ['hasNoAuthzViolations', 'has no authorization violations'],
  // M134a/D366 — the same structural reason as its two siblings. This scan mutates the observed
  // *request* one input at a time and re-sends it, so it needs the request as well as the response;
  // a bound value carries neither.
  ['hasNoInputHandlingViolations', 'has no input handling violations'],
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
  // M137c (D464) — and this line is the one that carries the safety model onto the new construct.
  // Four passes read this walk, and two of them are D21 layers: `checkAuthorizedTargets` (`TF060`)
  // and `checkPublicTargets` (`TF065`/`TF066`). A crawl is the most traffic-originating thing in the
  // language, so a crawl body invisible here would have been a construct that scans an origin no
  // `authorized target` names and reaches a public host with no `--allow-public-target` — both gates
  // silently absent for exactly the case they were built for, and both silently *passing*. The other
  // two (`TF041`, `TF042`) are near-vacuous over a body restricted to three matchers and wired for
  // the reason this helper exists at all: one traversal, so there is one place to forget.
  for (const crawl of program.crawls ?? []) forEachExpectInSteps(crawl.body, visit);
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
  ResponseSubject: 'response',
  RequestSubject: 'request',
  NetworkRequestSubject: 'network-request',
} satisfies Record<Subject['type'], SubjectKind>;

/** How to say each kind in a diagnostic, in the words SPEC §6.2's table uses. */
const KIND_LABELS: Readonly<Record<SubjectKind, string>> = {
  value: 'a value',
  locator: 'a UI locator',
  page: '`page`',
  response: '`response`',
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
    case 'ResponseSubject':
      return 'response';
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

/** Whether this scope still knows what is bound in it (`M147c`, `M140-01`). Shared by reference
 * with the three nested-block cases below — `within`, `switch to new tab` and `download` all thread
 * the *same* `bound` set through, because they share their enclosing variable scope, so an unknown
 * binding above one of them is unknown inside it too. A fresh holder per top-level frame: an
 * abandoned `capture` in a `before each` hook says nothing about the test body it runs ahead of. */
interface BindingWorld {
  unknown: boolean;
}

/** Walk a step sequence in declaration order, checking each step's referenced variables against
 * `bound` *before* adding any new binding it introduces (`let`/`capture`) — a step can never see
 * its own not-yet-assigned name, and a later step correctly sees everything bound before it. */
function checkStepSequence(steps: readonly Step[], bound: Set<string>, diags: Diagnostic[], bindings: BindingWorld = { unknown: false }): void {
  for (const step of steps) {
    const before = diags.length;
    switch (step.type) {
      case 'MalformedStep':
        // `M147c`/`M140-01`, the second half of the same mechanism. Three step kinds add a name to
        // `bound` — `let`, `capture` and `download … as` — and when the parser abandons one of them
        // the name it would have bound is exactly what is missing. Measured: `capture body.id as`
        // reports `TF010` for the absent name and then `TF030` *"unknown variable"* on every later
        // `{{id}}`, about a variable the file does bind.
        //
        // So the world goes unknown for the rest of this scope, the same shape `M147c`'s import
        // work settled on (`resolveImportedActions` returning `actions: undefined`): once the
        // checker has failed to *look*, it stops answering negative questions. It costs the genuine
        // unknown-variable reports further down the same body — but the file has a parse error and
        // cannot run either way, and fixing that error gives every one of them back on the next
        // check. A false report costs more than a late one.
        if (step.head === 'let' || step.head === 'capture' || step.head === 'download') bindings.unknown = true;
        break;
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
        checkStepSequence(step.body, bound, diags, bindings);
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
        checkStepSequence(step.body, bound, diags, bindings);
        break;
      case 'SwitchToTabStmt':
      case 'CloseTabStmt':
        break;
      case 'DownloadBlock':
        checkStepSequence(step.body, bound, diags, bindings);
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
        if (step.body) checkValue(step.body, bound, diags);
        break;
      case 'PauseStmt':
        // `minMs`/`maxMs` are plain numbers (parser-level, ast.ts) — no `{var}` interpolation to check.
        break;
    }
    // Drop only `TF030` and only from here on. Filtering after the step, rather than gating each
    // `checkValue` call, keeps every other diagnostic this walk raises — `checkStepSequence` also
    // carries the `upload … type "…"` shape check, which is about a literal's format and has
    // nothing to do with whether a name is bound.
    if (bindings.unknown && diags.length > before) {
      const kept = diags.splice(before).filter((d) => d.code !== Codes.UNKNOWN_VARIABLE);
      diags.push(...kept);
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
      // `checkValue` already walks both `ObjectLit` and `ArrayLit`, so D639's widening needed no
      // new arm here — only the loop that assumed fields had to go.
      checkValue(body.value, bound, diags);
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
    case 'AuthorizedTargetDecl':
      return 'authorized target';
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
interface FileBearingNode {
  readonly node: string;
  readonly field: string;
  readonly syntax: string;
  readonly neededBy: 'check' | 'run';
}

const FILE_BEARING_NODES: readonly FileBearingNode[] = [
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
  return collectPathLiterals(program, FILE_BEARING_NODES);
}

/** The traversal both `collectFileReferences` and `collectConfigFileReferences` run — one walk,
 * two node tables, so the structural argument above holds for the config dialect too rather than
 * being re-derived (or forgotten) there. */
function collectPathLiterals(root: unknown, nodes: readonly FileBearingNode[]): FileReference[] {
  const byNode = new Map(nodes.map((e) => [e.node, e] as const));
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

  visit(root);
  return out;
}

/**
 * `cert`/`key` (SPEC §3.5), plus every path a `session` body names — the `ConfigFile` half of
 * `collectFileReferences` (M116, D151, closing `M97c-01`).
 *
 * **Why a second entry point rather than a wider `collectFileReferences`.** The two dialects are
 * two trees with no common root: `checkProgram` runs per test file and resolves paths against *that
 * file's* directory, while everything here resolves against `tflw.config`'s own directory. One
 * function returning both would hand the caller a list it cannot resolve without re-deriving which
 * half each entry came from. The walk itself is shared (`collectPathLiterals`); only the roots and
 * the node table differ.
 *
 * **This is the piece `checkReferencedFiles`' session verdict was waiting on.** That row read "not
 * yet reachable, not undecidable — the same missing piece `M97c-01` needs, so the two land together
 * or not at all." They land together here: a session body's `body from "./creds.json"` is found by
 * the same walk as `cert`, because both are objects with a `type` inside one `ConfigFile`.
 *
 * **Both tiers are `run` (D147).** `loadMtlsCreds` is called from `execApi` (`interpreter.ts:3125`),
 * i.e. at the first api step of the run, not while the config is resolved — so a `before all` hook
 * can create the file, the checker is *predicting*, and a prediction must not make a valid suite
 * unrunnable. M97c shipped an `A4-05` in the milestone whose thesis was that the checker must never
 * do that; this is the rule that says it does not happen twice.
 */
export function collectConfigFileReferences(config: ConfigFile): FileReference[] {
  return collectPathLiterals(config, CONFIG_FILE_BEARING_NODES);
}

/**
 * The config dialect's own path-bearing nodes (M116, D151) — `cert`/`key`, plus every run-tier node
 * a `session` body can contain.
 *
 * **A named constant, not an inline array, because `fileReferenceDrift` reads it.** The guard's
 * `known` set is the union of every table that claims a node; building this one inline made
 * `CertDecl`/`KeyDecl` look unclaimed the moment they left `NOT_A_CHECKABLE_FILE`, and the guard
 * said so on the first run — which is the third time in this cluster it has been right about
 * something the author was not thinking about.
 *
 * The `check` tier is filtered out on purpose: `import`/`use` are `.tflw` declarations and cannot
 * appear in `tflw.config` at all, so listing them here would claim coverage of a syntax that has no
 * way to occur.
 */
const CONFIG_FILE_BEARING_NODES: readonly FileBearingNode[] = [
  ...FILE_BEARING_NODES.filter((e) => e.neededBy === 'run'),
  { node: 'CertDecl', field: 'path', syntax: 'cert', neededBy: 'run' },
  { node: 'KeyDecl', field: 'path', syntax: 'key', neededBy: 'run' },
];

/**
 * Nodes whose `path`/`filePath` is a `StringLit` but is *not* a file this pass may check, each with
 * the reason — written out because "the guard found it and it was fine" has to be recorded
 * somewhere, or the next person re-derives it or, worse, adds the row and ships false positives.
 *
 * The drift guard found all three on its first run, which is the argument for having written it.
 * Two of those three have since been *fixed* rather than excused — see below.
 */
const NOT_A_CHECKABLE_FILE: Readonly<Record<string, string>> = {
  // `open "/orders/{id}"` is a URL path against the env's `web` base URL. Nothing is opened on disk.
  // Still the only genuine entry — and M116 gave it a rule of its own (`TF051`), so a bad `open` is
  // now caught for what it actually is: a missing `web` base URL, not a missing file.
  OpenStmt: 'a URL path, not a filesystem path',
  // `CertDecl`/`KeyDecl` were here, reading "a real gap, filed; needs the config check path". M116
  // (D151) built that path — `collectConfigFileReferences` — so they are checked now and this table
  // no longer excuses them. Left as a comment rather than deleted silently: the drift guard's value
  // is that an entry here is a decision, and *retiring* one is the outcome it was hoping for.
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
  // Every table that claims a node, not just the program one — M116 added `CONFIG_FILE_BEARING_NODES`
  // and this guard caught the omission the moment `CertDecl`/`KeyDecl` left `NOT_A_CHECKABLE_FILE`.
  const known = new Set([
    ...FILE_BEARING_NODES.map((e) => e.node),
    ...CONFIG_FILE_BEARING_NODES.map((e) => e.node),
    ...Object.keys(NOT_A_CHECKABLE_FILE),
  ]);
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

/**
 * `TF073` (`M147c`, `M140-03`) — an `import` naming a file that is there and does not parse.
 *
 * `tflw check a.tflw` printed `1 file checked, no problems found.` and exited 0 for a file whose
 * import target could not parse, and it had the diagnostics in hand when it said so: the resolver
 * ran a full `parseSource` on the imported file and kept only the verdict *world unknown*,
 * discarding every diagnostic it had just computed. The run then failed with `✗ a.tflw (crashed)`,
 * whose reason reached `report/results.json` and — until this milestone's `A4-18` half — no
 * console at all. So the information existed twice and reached the surface the docs tell people to
 * put in CI exactly never.
 *
 * **One diagnostic per broken import, and it names the file rather than underlining it.** The
 * imported file's own diagnostics carry spans in *that* file's coordinates; rendering them against
 * this file's source would draw a caret on an unrelated line, which is the `M106` stance and the
 * same line `TF044` draws when it names a call written inside an imported body and refuses to
 * underline it. The hint therefore hands over the one command that shows the real errors with
 * their real carets.
 *
 * **`tflw check` over a whole directory already reported those errors**, because it checks the
 * broken file directly — which is exactly why this went unnoticed for so long. The gap belongs to
 * the run that checks one entry file, and a `tflw check <entry>` in CI is the shape this language
 * recommends.
 */
export function checkImportsParse(program: Program, opts: ProgramCheckOptions = {}): Diagnostic[] {
  const broken = opts.importsWithErrors;
  if (!broken || broken.size === 0) return [];
  return program.imports
    .filter((imp) => broken.has(imp.path.value))
    .map((imp) => ({
      code: Codes.IMPORT_PARSE_ERRORS,
      severity: 'error' as const,
      message: `imported file "${imp.path.value}" does not parse`,
      span: imp.path.span,
      hint: `run \`tflw check ${imp.path.value}\` to see why — its line numbers belong to that file, so they are named here rather than underlined. Until it parses nothing it declares is in scope, and this file cannot run`,
    }));
}

// ---------------------------------------------------------------------------
// M116 (`PLAN_M97_CHECKER_CONTRACT.md`, D148-D150) — three rules the runtime enforced alone.
//
// All eight rows these close came out of `RUNTIME_RULES`, and every one was re-probed against the
// shipped CLI before a line was written: this cluster filed 21 rows and *withdrew three* for
// reading an unreachable `throw` as an unchecked gap (`M97a-07`/`-09`/`-10`). A row's wording is
// not evidence. What is: for each of the eight, a program the parser accepts, the checker reports
// `no problems found` on, and the runtime throws for.
// ---------------------------------------------------------------------------

/**
 * Which base URLs the *active* env declares (M116, D148) — the config half of `TF051`.
 *
 * Two booleans and a name rather than the URLs themselves, because the rule is only ever "is this
 * one declared": handing the checker a URL would invite it to reason about the URL, which is the
 * runtime's job and needs the network. `envName` is carried solely so the diagnostic can name the
 * env the user actually selected, which is the first thing they need to know.
 *
 * `undefined` on `ProgramCheckOptions` means no config was resolved at all and the pass is skipped
 * — the same `undefined`-vs-`[]` doctrine as `knownServices`, and the docs-site editor demo is
 * again the case that needs it.
 */
export interface EnvBaseUrls {
  /** The active env's name, for the message. */
  readonly envName: string;
  /** Does it declare a default `api` base URL (`api "…"` with no service name)? */
  readonly api: boolean;
  /** Does it declare a `web` base URL? */
  readonly web: boolean;
}

/**
 * `M97a-04` + `M97a-15` (`TF051`) — a step needing a base URL the active env does not declare.
 *
 * **One code for both halves, deliberately.** They are one rule with two operands: the AST says
 * which kind of base URL a step needs, `tflw.config` says which kinds the active env declares. Two
 * codes would make the checker say two different things about the same missing line in one file.
 *
 * **Severity `error`, and this is not the `TF043` case.** D147 split `TF043` on *who opens the file
 * and when*, because a path a step opens may be created by an earlier step — so the checker was
 * predicting, and a prediction must not block. Nothing predicts here: the config is resolved once,
 * before any step runs, and no step, hook or `use`d JS action can add a base URL to an env that is
 * already resolved. The checker is observing.
 *
 * The three sites, all of which reach the same two runtime throws:
 *   - `open` — `interpreter.ts:2497`. `open`'s path is *always* relative to the `web` base URL
 *     (`ast.ts:774`: no method/service prefix, so no absolute-URL form to exempt), which is why
 *     this half needs no operand inspection at all.
 *   - an api request line with no `<service>` prefix — `interpreter.ts:4025`, reached from both
 *     `api …` and `wait until api …`, which share `parseApiRequestLine`.
 *   - `matches schema "…" from "<relative>"` — the non-obvious third site. `contract.ts:45`
 *     resolves a non-absolute schema source against the *default* service, so it reaches the
 *     identical throw by a second path. `schemaSource` is a `StringLit` that is never interpolated
 *     (`ast.ts:726`), so absolute-vs-relative is a static test.
 */
export function checkBaseUrls(program: Program, opts: ProgramCheckOptions = {}): Diagnostic[] {
  const diags: Diagnostic[] = [];
  if (!opts.envBaseUrls) return diags;
  for (const test of program.tests) checkBaseUrlsInSteps(test.body, opts.envBaseUrls, diags);
  for (const action of program.actions) checkBaseUrlsInSteps(action.body, opts.envBaseUrls, diags);
  for (const hook of program.hooks) checkBaseUrlsInSteps(hook.body, opts.envBaseUrls, diags);
  return byPosition(diags);
}

/** One body's steps (D152) — what a `session` needs, and the shape it needs most: a session body's
 * `api` steps are overwhelmingly the un-prefixed kind, and its failure takes down every test that
 * names it. */
/** Whether an api request line's target is written absolutely (M125b1) — shared by the two api
 *  arms of `checkBaseUrlsInSteps`, which read the same `PathExpr` off two differently-shaped nodes. */
function apiTargetIsAbsolute(path: unknown): boolean {
  const raw = (path as { raw?: unknown } | undefined)?.raw;
  return typeof raw === 'string' && isAbsoluteUrl(raw);
}

function checkBaseUrlsInSteps(steps: readonly Step[], env: EnvBaseUrls, diags: Diagnostic[]): void {
  // The object-graph walk, for `collectFileReferences`' reason (see its comment): a step nested in
  // a block kind a hand-written walker had not been taught about is skipped *in silence*, and
  // silence is how this class of gap presents — `no problems found`. Dispatching on `node.type`
  // over every object cannot miss one, because a new block kind is just another object with
  // children.
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const node = value as Record<string, unknown>;
    // M125b1 (`FU-18`) — an absolute target needs no base URL, so `TF051` must not demand one.
    //
    // This is the interaction that makes D245 more than a lexer change, and it fails in the worst
    // available direction: `TF051` is an **error**, so without these guards `api GET https://x/y`
    // in an env declaring no default `api` base would be *blocked from running* by a rule
    // predicting a refusal the runtime does not make — `execApi` never calls `resolveBaseUrl` for an
    // absolute target, and `resolveWebUrl` returns before its `web` check. A checker reporting an
    // error on a program that runs is D137 clause 1, and it would have shipped invisibly, because
    // every existing `TF051` test uses a path and passes either way.
    switch (node['type']) {
      case 'OpenStmt': {
        const lit = node['path'] as { value?: unknown } | undefined;
        const absolute = typeof lit?.value === 'string' && isAbsoluteUrl(lit.value);
        if (!env.web && !absolute) diags.push(missingBaseUrl('web', 'open', node as unknown as { span: Span }, env));
        break;
      }
      case 'ApiStep':
        if (!env.api && node['service'] === null && !apiTargetIsAbsolute(node['path'])) {
          diags.push(missingBaseUrl('api', 'api', node as unknown as { span: Span }, env));
        }
        break;
      case 'WaitUntilApiStmt': {
        const request = node['request'] as ApiRequestSpec | undefined;
        if (!env.api && request && request.service === null && !apiTargetIsAbsolute((request as unknown as Record<string, unknown>)['path'])) {
          diags.push(missingBaseUrl('api', 'wait until api', node as unknown as { span: Span }, env));
        }
        break;
      }
      case 'ExpectStmt': {
        const expect = node as unknown as ExpectStmt;
        const source = expect.matcher.schemaSource;
        // Absolute sources pass through `resolveSchemaSourceUrl` untouched and need no base URL —
        // the same test `contract.ts:44` applies, kept identical on purpose.
        if (!env.api && expect.matcher.name === 'matchesSchema' && source && !/^https?:\/\//i.test(source.value)) {
          diags.push(missingBaseUrl('api', 'matches schema … from', source, env));
        }
        break;
      }
      default:
        break;
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(steps);
}

function missingBaseUrl(kind: 'api' | 'web', syntax: string, at: { span: Span }, env: EnvBaseUrls): Diagnostic {
  const declaration = kind === 'web' ? 'web "http://localhost:3000"' : 'api "http://localhost:3000"';
  return {
    code: Codes.NO_BASE_URL_FOR_STEP,
    severity: 'error',
    message: `\`${syntax}\` needs ${kind === 'api' ? 'an' : 'a'} \`${kind}\` base URL, and env "${env.envName}" declares none`,
    span: at.span,
    hint:
      kind === 'web'
        ? `add \`${declaration}\` to \`env ${env.envName}\` in \`tflw.config\` (SPEC §3.1, §9.1)`
        : `add \`${declaration}\` to \`env ${env.envName}\` in \`tflw.config\`, or address a named service (\`api <service> GET …\`) — SPEC §3.1, §5.1`,
  };
}

/**
 * `M97a-05` (`TF052`) — `mask <locator>` where the matcher is not `matches snapshot`.
 *
 * The whole rule is `masks.length > 0 && matcher.name !== 'matchesSnapshot'`, both operands in one
 * `ExpectStmt`. The parser cannot do it and should not: `parseSnapshotMasks` accepts a mask after
 * any matcher by design, so that a misplaced one gets a *semantic* message instead of a parse error
 * pointing at the wrong token. A transcription of `interpreter.ts:2582` into the checker — no new
 * judgement, which is exactly what D137 clause 2 asks for.
 */
export function checkSnapshotMasks(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  forEachExpect(program, (expect) => checkOneSnapshotMask(expect, diags));
  return diags;
}

/** One body's expects (D152) — vacuously reachable in a `session` rather than N/A: a session body
 * is a body of steps and `ExpectStmt` is one of them. Wiring it costs nothing and means the next
 * grammar change cannot quietly make it reachable while the pass is looking elsewhere. */
function checkSnapshotMasksInSteps(steps: readonly Step[], diags: Diagnostic[]): void {
  forEachExpectInSteps(steps, (expect) => checkOneSnapshotMask(expect, diags));
}

function checkOneSnapshotMask(expect: ExpectStmt, diags: Diagnostic[]): void {
  if (expect.masks.length === 0 || expect.matcher.name === 'matchesSnapshot') return;
  for (const mask of expect.masks) {
    diags.push({
      code: Codes.MASK_WITHOUT_SNAPSHOT,
      severity: 'error',
      message: '`mask <locator>` only applies alongside `matches snapshot "…"`',
      span: mask.span,
      hint: 'a mask blanks a region *of a snapshot* before comparing it; against any other matcher there is nothing for it to blank (SPEC §9.9)',
    });
  }
}

/**
 * `M97a-11` + `M97a-12` + `M97a-13` + `M97a-14` (`TF053`) — `capture` against a subject that can be
 * asserted about but not bound to a name.
 *
 * **Four rows, one code, and that is the design.** They were filed as four because they are four
 * `throw`s (`interpreter.ts:3947/3953/3992/3998/4002`), but every one of them is the same sentence:
 * *this subject supports `expect`/`check`, not `capture`*. Four codes would be four ways to say it,
 * and the fifth such subject would be a fifth row instead of one line in the set below.
 *
 * **The kind test alone would be unsound, and this is the subtle part.** `SUBJECT_KINDS` maps
 * `StatusSubject` to `'value'` — but `capture status of request to "/health" as x` is *also*
 * rejected by the runtime, because `of request to "…"` is not a subject type at all: it is an `of`
 * field on four otherwise ordinary value subjects (`ast.ts:582/635/643/651`). A kind-only rule
 * would pass it. So the test is `kind !== 'value' || of != null`, which is `subjectNetworkRef() ||
 * PageSubject || RequestSubject || LocatorSubject` — the runtime's own four guards, transcribed.
 *
 * `SUBJECT_KINDS`' `satisfies` is what keeps this sound as the grammar grows: a new subject type
 * fails to compile until it is classified, and then this pass already has an answer for it.
 */
export function checkCapturableSubjects(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const test of program.tests) checkCapturableSubjectsInSteps(test.body, diags);
  for (const action of program.actions) checkCapturableSubjectsInSteps(action.body, diags);
  for (const hook of program.hooks) checkCapturableSubjectsInSteps(hook.body, diags);
  return byPosition(diags);
}

/** One body's captures (D152) — a `session` body's entire job is `capture`, so this is the pass of
 * the three that a session most needs. */
function checkCapturableSubjectsInSteps(steps: readonly Step[], diags: Diagnostic[]): void {
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const node = value as Record<string, unknown>;
    if (node['type'] === 'CaptureStmt') {
      const capture = node as unknown as { subject: Subject; span: Span };
      const diag = uncapturableSubject(capture.subject);
      if (diag) diags.push(diag);
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(steps);
}

/** The one place the rule lives. Returns `null` for a subject `capture` accepts. */
function uncapturableSubject(subject: Subject): Diagnostic | null {
  // `of request to "…"` first: it rides on subjects whose own kind is `'value'`, so testing it
  // second would let `capture status of request to "…"` through. Same ordering the runtime uses
  // (`subjectNetworkRef` is checked before the subject-type switch, `interpreter.ts:3946`).
  const hasOfModifier = 'of' in subject && (subject as { of?: unknown }).of != null;
  if (subject.type === 'NetworkRequestSubject' || hasOfModifier) {
    return {
      code: Codes.SUBJECT_NOT_CAPTURABLE,
      severity: 'error',
      message: '`capture` does not support a `request to "…"` subject',
      span: subject.span,
      hint: 'an observed network request is something to assert about, not a value to bind — use `expect`/`check` against it (SPEC §9.7)',
    };
  }
  const kind = SUBJECT_KINDS[subject.type];
  if (kind === 'value') return null;
  return {
    code: Codes.SUBJECT_NOT_CAPTURABLE,
    severity: 'error',
    message: `\`capture\` does not support ${KIND_LABELS[kind]} as a subject`,
    span: subject.span,
    hint: UNCAPTURABLE_HINTS[kind],
  };
}

/**
 * `M97a-02` + `M97a-03` + `M97a-16` (`TF054`) — an operand *written in the file* that the runtime
 * inspects and refuses (M124, D232/D233/D237).
 *
 * Seven throw sites, one sentence: `random number 5 to 1` selects from an empty range,
 * `random password 2` has no room for the four character classes it guarantees, `hex decode("zz")`
 * decodes nothing, and `matches "("` never compiles. In every case the operand is a literal, so the
 * answer is the same on every run — which is the whole definition of a checker rule.
 *
 * **`'static-if-literal'`, and the "if" is the load-bearing half (D237).** `RandomNumberExpr.from`
 * and `.to` are typed `Value`, not `NumberLit`: `random number {lo} to {hi}` is legal, ordinary, and
 * unknowable until the run binds those names. Every rule below tests the node kind *first* and
 * reports only on a literal — an interpolated operand stays the runtime's, unchanged. That is not a
 * gap to apologise for in the hint text; it is the boundary that makes the rule sound, and the
 * `undefined`-vs-`[]` doctrine (D144) restated at the level of a single operand.
 *
 * **Why the tests are imported rather than restated.** `isDecodableHex` and its siblings live in
 * `literalValidity.ts` and are called by `eval.ts` too. Re-deriving "what counts as valid base64"
 * here would be a second copy of a rule with two non-obvious clauses (the length check, and the
 * URL-safe alphabet the runtime deliberately rejects), and any drift between the copies shows up as
 * a `TF054` on a program that runs fine — a D137 clause 1 violation, shipped by copy-paste. The
 * regex half needs no such module: both sides call `new RegExp` on the same string, so the engine
 * *is* the shared authority.
 *
 * **The one shipped test this must not break.** `packages/runtime/test/request-connects-fails.test.ts`
 * builds `expect request fails matching "("` on purpose and asserts on the thrown message. It never
 * calls `check`, so it is unaffected — but it is the canary for anything that starts checking source
 * on the way into the runtime, and it is written down here rather than discovered by a red suite.
 */
export function checkLiteralOperands(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const test of program.tests) checkLiteralOperandsInSteps(test.body, diags);
  for (const action of program.actions) checkLiteralOperandsInSteps(action.body, diags);
  for (const hook of program.hooks) checkLiteralOperandsInSteps(hook.body, diags);
  // An inline `with each` table's cells are full expressions (`ast.ts`: `readonly Value[]`), so a
  // generator lives there exactly as it does in a `let` — and it is evaluated once per row, which
  // makes a bad literal there N failures rather than one.
  for (const test of program.tests) {
    if (test.table?.type === 'InlineDataTable') checkLiteralOperandsInSteps(test.table.rows, diags);
  }
  return byPosition(diags);
}

/** One body's operands (D152) — a `session` body runs `let` bindings and `expect`s like any other,
 * so nothing here is test-specific. */
function checkLiteralOperandsInSteps(steps: unknown, diags: Diagnostic[]): void {
  // The object-graph walk, for `checkBaseUrlsInSteps`' reason: a `Value` can sit anywhere an
  // expression is legal — a `let`, a request body, a header, a table cell, a call argument — and a
  // hand-written walker that has not been taught about one of those skips it *in silence*.
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const node = value as Record<string, unknown>;
    switch (node['type']) {
      case 'RandomNumberExpr':
      case 'RandomDecimalExpr':
        checkRandomRange(node as unknown as RandomRangeNode, node['type'] === 'RandomNumberExpr' ? 'random number' : 'random decimal', diags);
        break;
      case 'RandomPasswordExpr':
        checkRandomPasswordLength(node as unknown as { length?: Value; span: Span }, diags);
        break;
      case 'RandomStringExpr':
        checkRandomStringLength(node as unknown as { length: Value; span: Span }, diags);
        break;
      case 'RandomDateBetweenExpr':
        checkRandomDateBounds(node as unknown as { from: Value; to: Value; span: Span }, diags);
        break;
      case 'TransformExpr':
        checkTransformOperand(node as unknown as TransformExpr, diags);
        break;
      case 'ExpectStmt':
        checkRegexOperand((node as unknown as ExpectStmt).matcher, diags);
        break;
      default:
        break;
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(steps);
}

/** The two `random` generators that take a range; identical rule, identical runtime throw. */
interface RandomRangeNode {
  readonly from: Value;
  readonly to: Value;
  readonly span: Span;
}

function checkRandomRange(node: RandomRangeNode, syntax: 'random number' | 'random decimal', diags: Diagnostic[]): void {
  // Both bounds, or nothing: `random number 5 to {hi}` is a range whose emptiness nobody can know.
  const from = literalNumber(node.from);
  const to = literalNumber(node.to);
  if (from === null || to === null || to.n >= from.n) return;
  diags.push({
    code: Codes.INVALID_LITERAL_OPERAND,
    severity: 'error',
    // The runtime's own sentence (`eval.ts`), so a reader who has seen one has seen both.
    message: `\`${syntax} ${from.text} to ${to.text}\`: \`to\` must be ≥ \`from\``,
    span: node.span,
    hint: `the bounds are the wrong way round — write \`${syntax} ${to.text} to ${from.text}\` (SPEC §7.3)`,
  });
}

/**
 * A number the author wrote, or `null` — D237's test for the numeric half.
 *
 * The `BinaryExpr` clause is not general constant folding and must not become it. A negative
 * literal has no unary-minus node in this grammar: the parser desugars `-5` to `0 - 5`, so a
 * `NumberLit`-only test silently skips *every* negative bound, and `random number -1 to -5` — a
 * range that is wrong in the obvious way — reads as unknowable. Measured, not assumed: this clause
 * exists because a test asserting `TF054` on that program failed.
 *
 * The clause is exactly as wide as that desugaring: `-` over two literals, nothing else. `{lo} - 5`
 * has an operand nobody has bound and returns `null`, which is the whole rule.
 */
function literalNumber(value: Value): { n: number; text: string } | null {
  if (value.type === 'NumberLit') return { n: value.value, text: value.raw };
  if (value.type === 'BinaryExpr' && value.op === '-' && value.left.type === 'NumberLit' && value.right.type === 'NumberLit') {
    const n = value.left.value - value.right.value;
    // `0 - 5` prints as `-5`, not as `0 - 5`: the message quotes what the author wrote back to them,
    // and nobody wrote a zero.
    return { n, text: value.left.value === 0 ? `-${value.right.raw}` : `${value.left.raw} - ${value.right.raw}` };
  }
  return null;
}

/** `random password` guarantees one upper, one lower, one digit and one symbol regardless of
 *  length (decision 98), so a length below 4 is a promise the generator cannot keep. */
function checkRandomPasswordLength(node: { length?: Value; span: Span }, diags: Diagnostic[]): void {
  // `random password` with no length at all defaults to 12 — nothing written, nothing to check.
  const length = node.length ? literalNumber(node.length) : null;
  if (length === null || length.n >= 4) return;
  diags.push({
    code: Codes.INVALID_LITERAL_OPERAND,
    severity: 'error',
    message: `\`random password ${length.text}\`: length must be at least 4`,
    span: node.span,
    hint: '`random password` always includes an uppercase letter, a lowercase letter, a digit and a symbol (SPEC §7.4), so it needs at least four characters to put them in — raise the length, or use `random string` if the character classes do not matter',
  });
}

/**
 * `random string n` (`M124-02`).
 *
 * The rule this applies is SPEC §7.3's: *a generator rejects a numeric operand when no value it
 * could produce satisfies the generator's own stated promise.* `random string` promises a random
 * string of length *n*, so **`0` keeps that promise** — the empty string is a string of length 0 —
 * and a negative length cannot be kept by any string at all. That asymmetry is the finding, not an
 * accident: the row asked whether `0` and `-3` were one defect and they are not, so only one of them
 * moves.
 *
 * `randomAlnum`'s `for (let i = 0; i < len; i++)` runs zero times for both, which is why both used
 * to return `""` and pass. `literalNumber` already folds the `0 - 3` desugaring a negative bound
 * arrives as, so this reads the operand the author wrote either way.
 */
function checkRandomStringLength(node: { length: Value; span: Span }, diags: Diagnostic[]): void {
  const length = literalNumber(node.length);
  if (length === null || length.n >= 0) return;
  diags.push({
    code: Codes.INVALID_LITERAL_OPERAND,
    severity: 'error',
    // The runtime's own sentence (`eval.ts`), for `checkRandomRange`'s reason.
    message: `\`random string ${length.text}\`: length must be 0 or more`,
    span: node.span,
    hint: '`random string 0` is legal and produces the empty string, but no string has a negative length (SPEC §7.3) — if the length is meant to vary, bind it with `let` and the checker will leave it to the run',
  });
}

/**
 * `random date between A and B` (`M140-05`).
 *
 * Not the ordering test — that one is `M124-01`'s and lives in the runtime, because `today` and
 * `now` resolve against the run clock and the checker has no clock. This is the narrower fact the
 * checker *can* settle: a bound written as a string, a number or a boolean can never be a date on
 * any run, so `asDate` will throw every time, and the operand is right there in the file. Exactly
 * `TF054`'s `static-if-literal` shape, a third construct in the same family as `M124-01`'s.
 *
 * Deliberately a **type** test rather than a content test, which is why it does not go through
 * `literalText`: `random date between "{start}" and "{end}"` interpolates to a string too, and a
 * string is the wrong kind of thing here however it was spelled.
 */
/** The literal forms that can never evaluate to a date, described in the words the language uses
 *  for them. One table, so membership and the message cannot disagree — the shape `M147b` put on
 *  the parser's refusals for the same reason. Anything absent is left to the run: a `VarRef` may
 *  well hold a date, and the checker has no way to know. */
const NEVER_A_DATE = {
  StringLit: 'a string',
  NumberLit: 'a number',
  BoolLit: 'a boolean',
  NullLit: '`null`',
  DurationLit: 'a duration',
} as const satisfies Partial<Record<Value['type'], string>>;

function checkRandomDateBounds(node: { from: Value; to: Value; span: Span }, diags: Diagnostic[]): void {
  let refused = false;
  for (const [side, bound] of [
    ['from', node.from],
    ['to', node.to],
  ] as const) {
    const described = (NEVER_A_DATE as Partial<Record<Value['type'], string>>)[bound.type];
    if (described === undefined) continue;
    refused = true;
    diags.push({
      code: Codes.INVALID_LITERAL_OPERAND,
      severity: 'error',
      message: `\`random date between\`: the \`${side}\` bound is ${described}, not a date`,
      span: bound.span,
      // `asDate`'s own sentence (`eval.ts`), so the check-time and run-time answers read alike.
      hint: 'a bound must be a date (`today`/`now`, optionally with a date-math offset such as `today - 10 days`) — a quoted date like `"2030-01-01"` is a string and is rejected on every run (SPEC §7.3)',
    });
  }
  // A bound that is not a date has no order, so asking about the range as well would be two
  // complaints about one mistake — `M140-01`'s shape, which this milestone also fixes elsewhere.
  if (!refused) checkRandomDateOrder(node, diags);
}

/**
 * The ordering half of `random date between` (`M124-01`).
 *
 * The runtime throws on an empty range, mirroring its two numeric siblings. This decides the case
 * that is settled before the run: **two bounds measured from the same anchor**. `today - 10 days`
 * is ten days before `today` whatever day it is, so the comparison needs no clock at all — only the
 * offsets, which `offsetToMs` turns into milliseconds by pure arithmetic with no calendar in it, so
 * the checker's answer and the runtime's cannot diverge across a DST boundary.
 *
 * **Different anchors are silence, and that is the interesting line.** `random date between now and
 * today` is empty on every run except one starting exactly at midnight, because `today` is the start
 * of the day and `now` is somewhere after it — so it is *almost* always wrong, and almost is not the
 * checker's to refuse (D147, and `A4-05` is what happens when it is).
 */
function checkRandomDateOrder(node: { from: Value; to: Value; span: Span }, diags: Diagnostic[]): void {
  const from = literalDateBound(node.from);
  const to = literalDateBound(node.to);
  if (from === null || to === null || from.anchor !== to.anchor || to.ms >= from.ms) return;
  diags.push({
    code: Codes.INVALID_LITERAL_OPERAND,
    severity: 'error',
    // The clause after the colon is the runtime's, word for word; the prefix cannot be, because the
    // runtime knows the two dates and the checker knows the two phrases the author typed.
    message: `\`random date between ${from.text} and ${to.text}\`: \`to\` must be ≥ \`from\``,
    span: node.span,
    hint: `the bounds are the wrong way round — write \`random date between ${to.text} and ${from.text}\` (SPEC §7.3)`,
  });
}

/** `offsetToMs`'s table (`eval.ts`), duplicated rather than imported: `@tflw/lang` does not depend
 *  on `@tflw/runtime` and must not start to. `conformance.test.ts` is what keeps the two honest. */
const DATE_OFFSET_MS: Readonly<Record<DateOffsetUnit, number>> = {
  seconds: 1000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 7 * 86_400_000,
};

/** A bound the checker can place on a timeline, or `null` — `literalNumber`'s test for dates, and
 *  exactly as narrow: an anchor, or an anchor plus one literal offset. `today - {n} days` has an
 *  operand nobody has bound and returns `null`, which is the whole rule. */
function literalDateBound(value: Value): { anchor: 'today' | 'now'; ms: number; text: string } | null {
  if (value.type === 'DateAtom') return { anchor: value.which, ms: 0, text: value.which };
  if (value.type === 'BinaryExpr' && (value.op === '+' || value.op === '-') && value.left.type === 'DateAtom') {
    // Both spellings of an offset, and the second one is why this reads two node types rather than
    // one (`M147d`, `A3-13`, D638). `today - 10 seconds` parses to a `DateOffsetLit` and `today -
    // 10s` to a `DurationLit`, because the value path builds an adjacent abbreviation as a duration
    // — so before this, the identical program was judged under one spelling and waved through under
    // the other. Measured: `random date between today and today - 10 seconds` raised `TF054` and
    // `... today - 10s` reached `no problems found`, hours after `M147c` shipped that rule.
    const offset = value.right;
    const measured =
      offset.type === 'DateOffsetLit'
        ? { ms: DATE_OFFSET_MS[offset.unit] * offset.amount, text: `${offset.amount} ${offset.unit}` }
        : offset.type === 'DurationLit'
          ? { ms: offset.ms, text: offset.raw }
          : null;
    if (measured === null) return null;
    return {
      anchor: value.left.which,
      ms: value.op === '-' ? -measured.ms : measured.ms,
      text: `${value.left.which} ${value.op} ${measured.text}`,
    };
  }
  return null;
}

/** `hex`/`base64`/`url` `decode(...)` over a literal that will not decode. `encode` never fails and
 *  is not inspected. */
function checkTransformOperand(node: TransformExpr, diags: Diagnostic[]): void {
  if (node.direction !== 'decode') return;
  const input = literalText(node.value);
  if (input === null || isDecodable(node.kind, input)) return;
  diags.push({
    code: Codes.INVALID_LITERAL_OPERAND,
    severity: 'error',
    message: `\`${node.kind} decode(...)\`: ${JSON.stringify(input)} is not ${DECODE_LABELS[node.kind]}`,
    span: node.span,
    hint: DECODE_HINTS[node.kind],
  });
}

/** The runtime's three phrasings, matched word for word (`eval.ts`'s `applyTransform`). */
const DECODE_LABELS: Readonly<Record<'base64' | 'hex' | 'url', string>> = {
  hex: 'valid hex',
  base64: 'valid base64',
  url: 'validly percent-encoded',
};

/** What is actually wrong, since "not valid hex" leaves a reader guessing at a rule with two
 *  clauses — and the odd-length one is the clause nobody remembers. */
const DECODE_HINTS: Readonly<Record<'base64' | 'hex' | 'url', string>> = {
  hex: 'hex is `0-9`/`a-f` in pairs — an odd number of digits is rejected too, since half a byte cannot be decoded (SPEC §7.6)',
  base64: 'standard base64 only: `A-Z`/`a-z`/`0-9`/`+`/`/`, padded to a multiple of 4 with `=`. The URL-safe alphabet (`-`/`_`) is a different encoding and is not accepted here (SPEC §7.6)',
  url: 'every `%` must start a well-formed escape — `%` alone, or `%zz`, is not percent-encoded text. If you meant a literal percent sign, write `%25` (SPEC §7.6)',
};

/** `matches "…"` and `fails matching "…"` — the two matchers whose operand is compiled as a regular
 *  expression (`matcher.ts`, both sites). */
function checkRegexOperand(matcher: ExpectStmt['matcher'], diags: Diagnostic[]): void {
  if (matcher.name !== 'matches' && matcher.name !== 'fails') return;
  const pattern = matcher.value ? literalText(matcher.value) : null;
  if (pattern === null) return;
  const why = regexCompileError(pattern);
  if (why === null) return;
  diags.push({
    code: Codes.INVALID_LITERAL_OPERAND,
    severity: 'error',
    message: `invalid regex in matcher: ${JSON.stringify(pattern)}`,
    span: matcher.value!.span,
    hint: `${why} — the operand of \`${matcher.name === 'matches' ? 'matches' : 'fails matching'}\` is a regular expression, so \`(\`, \`[\` and \`\\\` are syntax. To match one literally, escape it (SPEC §6.2)`,
  });
}

/** A string operand's text, or `null` when it is not a fully literal string — D237's test, in one
 *  place. An interpolated `StringLit` keeps its `{ref}` holes in `value`, so reading `.value` alone
 *  would check a pattern nobody wrote and report on a program that is fine. */
function literalText(value: Value): string | null {
  if (value.type !== 'StringLit') return null;
  if (value.parts.some((part) => part.kind !== 'text')) return null;
  return value.value;
}

/**
 * `M97a-06` (`TF055`) — a `for <duration>` hold window that cannot fit inside `timeout wait`
 * (M124, D232/D236).
 *
 * `wait until <locator> … for 60s` asks for a condition that stays true for a minute, inside a step
 * the runtime bounds at `timeout wait` (30s by default). The window can never close, so the step can
 * only ever end by timing out — and it times out saying the app was slow, which is the one thing
 * that was not wrong.
 *
 * **A warning, and this is D147's line, not a preference.** The comparison's second operand comes
 * from `tflw.config` and differs per env, so the checker is *predicting* what the run will do rather
 * than observing something already settled: a suite whose CI env raises `timeout wait` to 120s is
 * correct, and an error here would make it unrunnable with no override. `M97c` shipped exactly that
 * mistake once (`A4-05`) inside the milestone whose thesis forbade it, which is why the tier is
 * written down twice — here and in `spec-data.ts`.
 *
 * Skipped entirely without `opts.envTimeouts`: see `ProgramCheckOptions`.
 */
export function checkHoldWindows(program: Program, opts: ProgramCheckOptions = {}): Diagnostic[] {
  const diags: Diagnostic[] = [];
  if (!opts.envTimeouts) return diags;
  for (const test of program.tests) checkHoldWindowsInSteps(test.body, opts.envTimeouts, diags);
  for (const action of program.actions) checkHoldWindowsInSteps(action.body, opts.envTimeouts, diags);
  for (const hook of program.hooks) checkHoldWindowsInSteps(hook.body, opts.envTimeouts, diags);
  return byPosition(diags);
}

/** One body's `wait until` steps (D152) — reachable in a `session`, which may well wait for a login
 *  redirect to settle before capturing the token. */
function checkHoldWindowsInSteps(steps: readonly Step[], env: EnvTimeouts, diags: Diagnostic[]): void {
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const node = value as Record<string, unknown>;
    if (node['type'] === 'WaitUntilUiStmt') {
      const hold = node['holdMs'];
      // `>=`, not `>`, and the runtime's test is the same one: a window exactly as long as the
      // budget still cannot close, because the condition would have to survive past the deadline
      // that ends the step.
      if (typeof hold === 'number' && hold >= env.wait) {
        diags.push({
          code: Codes.HOLD_EXCEEDS_WAIT_TIMEOUT,
          severity: 'warning',
          message: `\`for ${hold}ms\` can never be satisfied — the whole step is bounded by \`timeout wait\` (${env.wait}ms in env "${env.envName}")`,
          span: (node as unknown as { span: Span }).span,
          hint: `the hold window has to be shorter than the budget the step runs inside — raise \`timeout wait\` in \`tflw.config\`, or shorten the hold (SPEC §9.5)`,
        });
      }
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(steps);
}

/**
 * M125b1 (`FU-18`, D245/D246/D266) — what an absolute URL costs, said at check time.
 *
 * `api GET https://x/y` and `open "https://x/y"` became legal in this milestone, and they are a
 * legitimate authoring choice with two real consequences. This pass names both.
 *
 * **One diagnostic per step, never two, and which one depends on what the caller resolved.** A step
 * that is going to be *refused* does not also need to be told it is unportable — that reads as two
 * problems where there is one, and the second is irrelevant until the first is fixed:
 *
 * | `opts.envAllowHosts` | means | emits |
 * | --- | --- | --- |
 * | `undefined` | nobody resolved a config — a browser demo, a bare `parse` | `TF057` |
 * | `{ hosts: [] }` | a config *was* resolved and declares no allowlist | `TF058` |
 * | `{ hosts: [...] }` | an allowlist exists; the runtime will apply it | `TF057` |
 *
 * The middle row is the one `ProgramCheckOptions` warns about in the abstract and this pass makes
 * concrete: `undefined` and `[]` are not interchangeable here, they select *different diagnostics*.
 * Reading `[]` as "not resolved" loses `TF058` entirely; reading `undefined` as `[]` fires `TF058`
 * on every absolute URL in the docs-site editor demo, which can have no `tflw.config` even in
 * principle.
 *
 * **D247 — nothing here looks at a URL pattern.** `stub GET "https://payments.example.test/…"` and
 * `expect request to "https://…" was made` are patterns matched against traffic, not addresses
 * anything is sent to; `testFlow-tests`' `storefront.tflw` writes both today. The visit below is
 * keyed on the three node types that *issue* a request, so a pattern is never reached — not
 * filtered out afterwards, which is the version of this that rots the first time a fourth
 * pattern-bearing node type is added.
 */
// ---------------------------------------------------------------------------
// `TF060` — a security assertion with no `authorized target` behind it (M128b, D291)
// ---------------------------------------------------------------------------

/** Whether a declared target covers a base URL. Origin equality — scheme, host and port — because
 * that is the granularity at which somebody is or is not authorized to scan something. A
 * declaration for `https://staging.example.com` does not authorize scanning
 * `https://staging.example.com:8443`, which is a different listener that may belong to a different
 * team; and it does not authorize `http://` either, which is a different conversation entirely.
 *
 * Deliberately *not* `hostMatchesAllowPattern`, the matcher `allow hosts` uses. That one accepts
 * `*.example.com` on purpose. Reusing it here would quietly make wildcards work, which is the one
 * thing D291 says this declaration must never do — `TF061` rejects them, and a matcher that
 * accepted them anyway would leave the two halves disagreeing. */
function targetCoversBaseUrl(target: string, baseUrl: string): boolean {
  const a = literalOrigin(target);
  const b = literalOrigin(baseUrl);
  return a !== null && b !== null && a === b;
}

function literalOrigin(url: string): string | null {
  // **An unresolved `{interpolation}` is not a literal origin, and `URL` will not tell you that.**
  // `{` and `}` are not forbidden host code points, so `new URL('https://{API_HOST}/v1').origin` is
  // the string `"https://{api_host}"` — a perfectly well-formed answer to the wrong question. Both
  // this file's doc comments have claimed since M128b that such a base URL is "skipped, not guessed
  // at", and until M131a that claim was false: `TF060` would demand an `authorized target` for an
  // origin nobody can declare. Nothing in production reached it, because `cli.ts` resolves
  // interpolations before it gets here — which is exactly why it went unnoticed, and exactly why it
  // is worth closing now: `TF065` would otherwise print `--allow-public-target https://{api_host}`,
  // a flag no one can type, as the repair for a suite that is entirely above board.
  if (url.includes('{') || url.includes('}')) return null;
  try {
    return new URL(url).origin.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * **D291 — Tier 1 requires the declaration, in the milestone that introduces it.**
 *
 * `expect`/`check response has no … security violations` is a checker error unless the active env's
 * `api` base URL is covered by an `authorized target` declaration. This is the whole point of
 * putting the declaration in `M128b` rather than `M128c`: the alternative — ship the grammar, and
 * enforce it in the milestone that first sends a probe — means shipping a safety control that
 * nothing exercises, which is the same criticism relocated. Making it load-bearing here means the
 * affirmation-plus-reason is already habitual before anything sends a packet, and D21 layer 2 is
 * tested rather than asserted.
 *
 * **No loopback or RFC1918 exemption.** D21 layer 3 does treat private addresses as lower-risk, and
 * exempting them was considered and rejected: it would exempt precisely the target this arc tests
 * against (`https://localhost:8443`), shipping the requirement untested.
 *
 * **M131a/D343 widens it from the default `api` base to every scannable origin.** A step naming a
 * service (`api @billing GET /invoices`) reaches a different host, and a scan there used to be
 * gated by nothing whatsoever — not by a declaration, and under a naive reading of D340 not by the
 * public-target flag either. Same affirmation, same class of destination, so the same code: the
 * repair is identical (add an `authorized target` naming the origin), and `SCAN_LABELS` below
 * already states this codebase's rule that one repair is one code.
 *
 * That widening is a **breaking change** for any config that declares services and writes security
 * assertions. It is the right kind of breaking — it refuses something that was silently
 * unprotected — and there is no additive predecessor, which is why it merges under the `M85`
 * discipline with its companion PR in the same sitting.
 *
 * Narrow, in exactly the ways `checkAllowHostsCoversBaseUrls` is narrow, and for the same reason —
 * being wrong here means refusing a suite that is entirely above board:
 * - **only origins the env itself declares**, never an absolute URL a step writes for itself. That
 *   needs a response-time answer this pass cannot give, which is what `authzProbe`'s door is for.
 * - **only fully literal base URLs.** `api "https://{API_HOST}/v1"` is skipped, not guessed at.
 * - **`undefined` options skip entirely**, so a `parse` with no config resolved reports nothing.
 */
export function checkAuthorizedTargets(program: Program, opts: ProgramCheckOptions = {}): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const declared = opts.envAuthorizedTargets;
  if (!declared) return diags;
  const scannable = scannableOrigins(declared);
  if (scannable.length === 0) return diags;
  const uncovered = scannable.filter((s) => !declared.targets.some((t) => targetCoversBaseUrl(t.target, s.url)));
  if (uncovered.length === 0) return diags;

  const shapes = uncovered.map((u) => `authorized target "${u.origin}" reason "<why you may scan it>"`);
  // The label rides along even when there is only one uncovered origin, because D343's widening is
  // exactly what makes "which one?" a real question: before it, the answer was always the default
  // `api` base and naming it would have been noise. A message that quotes a service's URL without
  // saying it is a service sends the reader to the wrong line of `tflw.config`.
  const reach = `against ${uncovered.map((u) => `"${u.url}" (${u.label})`).join(' and ')}`;
  const hint = declared.targets.length
    ? `env \`${declared.envName}\` authorizes ${declared.targets.map((t) => `"${t.target}"`).join(', ')}, which does not cover ${uncovered.length === 1 ? "this base URL's origin" : 'every origin this env can scan'}. Add ${shapes.map((s) => `\`${s}\``).join(' and ')} to \`tflw.config\` (SPEC §3.10)`
    : `env \`${declared.envName}\` declares no \`authorized target\`. Add ${shapes.map((s) => `\`${s}\``).join(' and ')} to \`tflw.config\` — the reason is printed in the run summary and embedded in the report, so the claim travels with the evidence (SPEC §3.10, D21)`;

  forEachExpect(program, (expect) => {
    // M130b/D315 — the gate covers every scan this declaration authorizes, and `authorization
    // violations` is the one that most obviously needs it: Tier 1 reads a response the suite
    // already asked for, while this one *originates* requests under identities the step never used.
    // Adding the matcher to the list is the whole change; a second pass would have been two copies
    // of one rule, drifting the first time either message was reworded.
    const scan = SCAN_LABELS[expect.matcher.name];
    if (scan === undefined) return;
    diags.push({
      code: Codes.SECURITY_ASSERTION_UNAUTHORIZED,
      severity: 'error',
      message: `${scan} ${reach} needs an \`authorized target\` declaration naming it`,
      span: expect.span,
      hint,
    });
  });
  return diags;
}

/**
 * Every origin a scan in this env could reach *and this pass can name*: the default `api` base plus
 * each declared service (D343).
 *
 * A service whose URL is interpolated or unparseable is dropped rather than guessed at, the same
 * conservatism the default base gets — `literalOrigin` returning `null` is this file's standing
 * signal for "not decidable here", and it is why the runtime half of `TF065` is the load-bearing
 * one rather than a belt to this pass's braces.
 */
function scannableOrigins(declared: EnvAuthorizedTargets): { readonly label: string; readonly url: string; readonly origin: string }[] {
  const out: { label: string; url: string; origin: string }[] = [];
  const add = (label: string, url: string | null): void => {
    if (url === null) return;
    const origin = literalOrigin(url);
    if (origin !== null) out.push({ label, url, origin });
  };
  add('the default `api` base', declared.apiBaseUrl);
  for (const s of declared.services) add(`service \`@${s.name}\``, s.url);
  return out;
}

/** The scans `TF060` gates, and what to call each one in its message (M128b D291; M130b D315). A
 *  lookup rather than an `||` chain so that a third gated scan is a row, and so the message can say
 *  which scan was refused instead of saying "a security scan" about an authorization one. */
const SCAN_LABELS: Partial<Record<MatcherName, string>> = {
  hasNoSecurityViolations: 'a security scan',
  hasNoAuthzViolations: 'an authorization scan',
  hasNoInputHandlingViolations: 'an input-handling scan',
};

// ---------------------------------------------------------------------------
// `TF065`/`TF066` — D21 §3.2(3)'s public-target affirmation (M131a, D340–D345)
// ---------------------------------------------------------------------------

/**
 * The scans that **originate traffic**, which is the set `--allow-public-target` gates (D341).
 *
 * A strict subset of `SCAN_LABELS`, and the difference is the whole of D341: `security violations`
 * inspects a response the suite already asked for under `allow hosts`, so there is no extra packet
 * to authorize, while `authorization violations` re-issues that request under every other declared
 * principal. Gating both uniformly would be one fewer sentence of rule and would predictably train
 * teams to park the flag in CI permanently — and a control everybody leaves on is not a control.
 *
 * `authorized target` stays unconditional for **both**, so D291's objection (ship the grammar,
 * enforce it later, and the control is one nothing exercises) stays unraisable. This is a second
 * gate on top of that one, never a replacement for it.
 */
const ORIGINATING_SCAN_LABELS: Partial<Record<MatcherName, string>> = {
  hasNoAuthzViolations: 'an authorization scan',
  // M134a/D372 — Tier 3 originates traffic by definition: it re-sends the observed request once per
  // payload per mutable input, carrying values the suite never wrote. It belongs here for exactly
  // the reason `security violations` does not — that one only inspects a response the suite already
  // asked for, so there is no extra packet to authorize.
  hasNoInputHandlingViolations: 'an input-handling scan',
};

/**
 * **D21 §3.2(3), the layer that says a committed config can never make CI scan the internet by
 * itself** — the static door of it (D342).
 *
 * `TF065`: this run would originate a scan against an origin that classifies `public` (D338/D339),
 * and no `--allow-public-target` on the command line names it. The repair is the flag.
 * `TF066`: a flag was passed naming an origin this run does not scan or does not declare. The
 * repair is the flag's *value*, which is a different mistake with a different fix, so it is a
 * different code — this codebase's rule that a code is one repair, not one topic.
 *
 * **This half is not the load-bearing one, and the docs say so.** `resolved.apiBaseUrl` is
 * interpolation-resolved against the local environment (`cli.ts:1084`), so `API_HOST` on a laptop
 * and `API_HOST` in CI can classify differently and this pass can be right on one machine and
 * silent on the other. The guarantee lives in `authzProbe`, which judges the origin the packet is
 * actually going to. What this buys is the pre-flight answer — refused with no server, no
 * credentials and no cross-identity request — which is the same trade `checkAuthzAssertions` makes
 * one function down.
 *
 * Gated on `envAuthorizedTargets` for the usual `undefined`-means-nobody-looked reason, which is
 * also why `allowPublicTargets` needs no such distinction of its own: it describes an
 * *invocation*, and an absent invocation is an empty one.
 */
export function checkPublicTargets(program: Program, opts: ProgramCheckOptions = {}): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const declared = opts.envAuthorizedTargets;
  if (!declared) return diags;

  const scannable = scannableOrigins(declared);
  const affirmed = (opts.allowPublicTargets ?? []).map((v) => ({ raw: v, origin: literalOrigin(v) }));

  const unaffirmed = scannable.filter((s) => classifyAddress(s.url) === 'public' && !affirmed.some((a) => a.origin === s.origin));
  // A flag matches when it names an origin this run scans **and** an `authorized target` declares
  // it. Both halves, because affirming an origin nothing here talks to is a typo, and affirming one
  // the config never declared is an affirmation with no declaration under it — D291's two-part
  // design says the flag is additive on top of the declaration, never a way around it.
  const unmatched = affirmed.filter(
    (a) =>
      a.origin === null ||
      // **`scannable.length > 0` is load-bearing and is the narrowness rule this whole file keeps
      // restating.** Without it, an env whose base URL this pass cannot name — an unresolved
      // `{interpolation}`, an unparseable literal — yields an *empty* origin list, and "matches
      // nothing this run would scan" then fires on a perfectly correct invocation. That is a false
      // **error**, so it refuses a suite that is entirely above board, which is the one direction a
      // checker is not allowed to be wrong in (`checkAllowHostsCoversBaseUrls` has the same
      // paragraph). Nothing to compare against is "not decidable here", never "no match".
      (scannable.length > 0 && !scannable.some((s) => s.origin === a.origin)) ||
      // Not guarded, and deliberately: whether the config declares this origin is decidable from
      // `targets` alone, whatever the base URL turned out to be. An affirmation with no declaration
      // under it is D340's error however little else is knowable.
      !declared.targets.some((t) => literalOrigin(t.target) === a.origin),
  );

  if (unaffirmed.length === 0 && unmatched.length === 0) return diags;

  forEachExpect(program, (expect) => {
    const scan = ORIGINATING_SCAN_LABELS[expect.matcher.name];
    if (scan === undefined) return;
    for (const s of unaffirmed) {
      diags.push({
        code: Codes.PUBLIC_TARGET_NOT_AFFIRMED,
        severity: 'error',
        message: `${scan} against "${s.url}" (${s.label}) needs \`--allow-public-target ${s.origin}\` on the command line`,
        span: expect.span,
        // The asymmetry is stated in the diagnostic rather than only in the docs, because the
        // reader most likely to ask "why does my *security* assertion not need this?" is the one
        // staring at this message.
        hint: `env \`${declared.envName}\` scans an address outside the private ranges, and D21 requires that affirmation to live on the command line where a committed \`tflw.config\` cannot supply it. ${AFFIRMATION_ASYMMETRY}`,
      });
    }
    for (const a of unmatched) {
      const why =
        a.origin === null
          ? 'that is not an absolute URL with an origin'
          : !scannable.some((s) => s.origin === a.origin)
            ? `env \`${declared.envName}\` scans ${scannable.length === 0 ? 'no origin this pass can name' : scannable.map((s) => `"${s.origin}"`).join(', ')}`
            : `env \`${declared.envName}\` declares no \`authorized target\` for it`;
      diags.push({
        code: Codes.PUBLIC_TARGET_AFFIRMATION_UNMATCHED,
        severity: 'error',
        message: `\`--allow-public-target ${a.raw}\` matches nothing this run would scan — ${why}`,
        span: expect.span,
        hint: 'the flag names one origin (scheme + host + port) and must match a target this env both scans and declares — repeat the flag to affirm more than one. Affirming an origin nobody scans is how a stale flag survives a config change and silently covers a host its author never read (SPEC §3.10)',
      });
    }
  });
  return diags;
}

/** Quoted into `TF065`'s hint, and into the docs, from one place — two wordings of an asymmetry are
 *  how the two come to disagree about which scans the flag covers. */
const AFFIRMATION_ASYMMETRY =
  'An authorization scan originates requests your suite did not write; a security scan only inspects a response you already asked for, which is why that one needs no flag.';

// ---------------------------------------------------------------------------
// M130b — `expect|check response has no [<severity>] authorization violations`.
// ---------------------------------------------------------------------------

/**
 * The three ways an authorization assertion can be written where it cannot do its job
 * (`TF062`/`TF063`/`TF064`, D328/D329/D315), plus the workload case, which belongs to `TF033`.
 *
 * **Every rule here is half of a pair, and the other half is in the interpreter.** Calls in this
 * language bind late — an `action` body is resolved against the *entry file's* registry, which is
 * why `checker.ts:885` already limits its call-resolution frames to "a `test` or hook body, never
 * an `action` body". So this pass deliberately stays silent inside an `action`, and `execAuthzExpect`
 * repeats each judgement at run time with the executing test in hand. Fighting that boundary into a
 * single static rule would either refuse a shared authorization check written once and reused — the
 * language's only unit of reuse — or answer confidently about a frame it cannot see.
 *
 * What each rule buys by *also* being here is the pre-flight answer: `tflw check` refuses a file it
 * can prove will fail, with no server, no credentials and no cross-identity packet.
 */
export function checkAuthzAssertions(program: Program, opts: ProgramCheckOptions = {}): Diagnostic[] {
  const diags: Diagnostic[] = [];

  // D307's second door into `TF063`, computed once. Only when a config was actually resolved:
  // `undefined` means nobody looked, the same rule every other option field in this file follows,
  // and guessing here would fire on every authorization assertion in the docs-site editor demo.
  const declared = opts.knownSessions;
  const privileged = new Set(opts.privilegedSessions ?? []);
  const noProbeablePrincipal = declared !== undefined && declared.length > 0 && declared.every((s) => privileged.has(s));

  for (const test of program.tests) {
    const frame: AuthzFrame = {
      kind: 'test',
      hasOwner: test.sessions.length > 0,
      workload: test.workload !== null,
      label: `test "${test.name.value}"`,
    };
    checkAuthzInSteps(test.body, frame, noProbeablePrincipal, declared, privileged, diags);
  }
  for (const hook of program.hooks) {
    // A bare `before`/`after` runs once per test and shares its scope (`each` in the AST; there is
    // no `before each` keyword — GRAMMAR.md § Tests), so the test's `as` is the hook's owner and
    // this pass cannot know it — silent here, judged at run time. `before file`/`after file` run in
    // their own scope (`ast.ts:57`) and can therefore never have one, which is a fact about the
    // construct rather than about the suite.
    const frame: AuthzFrame = {
      kind: 'hook',
      hasOwner: hook.scope === 'each',
      workload: false,
      label: `a \`${hook.when}${hook.scope === 'file' ? ' file' : ''}\` hook`,
      ownerUnknowable: hook.scope === 'each',
    };
    checkAuthzInSteps(hook.body, frame, noProbeablePrincipal, declared, privileged, diags);
  }
  for (const action of program.actions) {
    const frame: AuthzFrame = { kind: 'action', hasOwner: true, workload: false, label: `action \`${action.name}\``, ownerUnknowable: true };
    checkAuthzInSteps(action.body, frame, noProbeablePrincipal, declared, privileged, diags);
  }
  // M137c (D464) — a crawl is a fourth frame, and `TF063`'s owner door is the reason it is wired
  // rather than skipped: `expect response has no critical authorization violations` is `D450`'s own
  // headline example, and a crawl with no `as` has no owner to differentiate against, so the
  // assertion cannot fail whatever the application does. That is decidable from the header alone —
  // there is no `ownerUnknowable` case here, because unlike an `action` body or a `before each` hook a
  // crawl is never entered from a caller that could supply one.
  //
  // `workload: false` is a fact about the grammar, not a default: `crawl` has no workload clause and
  // is never nested inside a `test`, so `TF033`'s multiply-hostile-traffic-by-the-load-factor rule has
  // nothing to fire on. If a crawl ever gains a scheduling clause, this is the line that has to change.
  for (const crawl of program.crawls ?? []) {
    const frame: AuthzFrame = {
      kind: 'crawl',
      hasOwner: crawl.sessions.length > 0,
      workload: false,
      label: `crawl "${crawl.name.value}"`,
    };
    checkAuthzInSteps(crawl.body, frame, noProbeablePrincipal, declared, privileged, diags);
  }
  return diags;
}

interface AuthzFrame {
  readonly kind: 'test' | 'hook' | 'action' | 'crawl';
  readonly hasOwner: boolean;
  readonly workload: boolean;
  readonly label: string;
  /** True where the owner is a *runtime* fact — an `action` body, a `before each` hook. `TF063`'s
   *  owner door stays shut; the interpreter's backstop opens it with the real test in hand. */
  readonly ownerUnknowable?: boolean;
}

function checkAuthzInSteps(
  steps: readonly Step[],
  frame: AuthzFrame,
  noProbeablePrincipal: boolean,
  declared: readonly string[] | undefined,
  privileged: ReadonlySet<string>,
  diags: Diagnostic[],
): void {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    if (step.type === 'WaitUntilApiStmt') {
      for (const expect of step.expects) {
        // M134a — widened from `hasNoAuthzViolations` to both originating scans (`TF064` widened,
        // not duplicated: the repair is the same sentence for either, and what makes the construct
        // wrong is a property of `wait until api` that does not know which scan is asking).
        const label = REPEATED_REQUEST_SCAN_LABELS[expect.matcher.name];
        if (label === undefined) continue;
        diags.push({
          code: Codes.SCAN_ASSERTION_REPEATED_REQUEST,
          severity: 'error',
          message: `\`${label}\` can't be asserted inside \`wait until api\``,
          span: expect.span,
          // The sharp half is not the wasted traffic, it is what a real finding turns into: `wait
          // until api` re-polls until its expects pass, so a genuine finding would be re-probed on
          // every poll and then reported as a *wait timeout*.
          hint: '`wait until api` re-issues its request until its expects pass, so a real violation would be re-probed on every poll and finally reported as a timeout rather than as a finding — assert it on a plain `api` step after the block',
        });
      }
      continue;
    }
    if (step.type === 'WithinBlock' || step.type === 'SwitchToNewTabBlock' || step.type === 'DownloadBlock') {
      checkAuthzInSteps(step.body, frame, noProbeablePrincipal, declared, privileged, diags);
      continue;
    }
    if (step.type !== 'ExpectStmt') continue;

    // M134a — Tier 3's own two rules, before the authorization-only pass below. It shares this
    // walker rather than getting a second one because both scans are asking the same question of the
    // same construct (*can this assertion do its job where it is written?*), and a second walker is
    // how the two come to disagree about what a `within` block is.
    if (step.matcher.name === 'hasNoInputHandlingViolations') {
      if (frame.workload) {
        diags.push({
          code: Codes.LOAD_INVALID,
          severity: 'error',
          message: "`input handling violations` can't be asserted inside a workload-bearing `test`",
          span: step.span,
          // Worse than Tier 2's version of this, and by a wide margin: an authorization assertion
          // sends one probe per principal, while this one sends one per payload per mutable input.
          // Multiplying *that* by iterations × VUs points a mutation corpus at a target somebody
          // authorized for a scan, not for a scan times the load factor.
          hint: 'each assertion sends one probe per payload per mutable input, and a workload runs its body once per iteration per VU — so this multiplies hostile-input traffic by the load factor against a target you authorized for a scan, not for a scan times the VU count. Assert it in a functional test',
        });
      }
      const request = nearestPrecedingApiStep(steps, i);
      if (request && hasNoStaticallyMutableInput(request)) {
        diags.push({
          code: Codes.INPUT_ASSERTION_NO_MUTABLE_INPUT,
          severity: 'error',
          message: '`input handling violations` has nothing to mutate on this request',
          span: step.span,
          hint:
            'the oracle re-sends this request once per payload per mutable input, and this one carries none — its path has no identifier segment, it has no query string, and its body is not a JSON object. ' +
            'With nothing to mutate no rule can apply, so the assertion could not fail whatever the application did (SPEC §9.12, `TF067`, D285). Assert it on a step that takes an id, a query parameter or a JSON body',
        });
      }
      continue;
    }

    if (step.matcher.name !== 'hasNoAuthzViolations') continue;

    if (frame.workload) {
      diags.push({
        code: Codes.LOAD_INVALID,
        severity: 'error',
        message: "`authorization violations` can't be asserted inside a workload-bearing `test`",
        span: step.span,
        hint: 'each assertion sends one probe per declared principal, and a workload runs its body once per iteration per VU — so this multiplies cross-identity traffic by the load factor against a target you authorized for a scan, not for a scan times the VU count. Assert it in a functional test',
      });
    }
    if (!frame.hasOwner && !frame.ownerUnknowable) {
      diags.push({
        code: Codes.AUTHZ_ASSERTION_NO_PRINCIPAL,
        severity: 'error',
        message: `\`authorization violations\` needs an owner, and ${frame.label} declares none`,
        span: step.span,
        hint:
          frame.kind === 'hook'
            ? 'a `before file`/`after file` hook runs in its own scope, isolated from every test, so it can never have an owner — move the assertion into a test that declares one with `as <session>`, or into a bare `before`/`after` hook, which runs once per test and shares its scope (SPEC §3.3)'
            : 'the oracle is differential: it re-issues this request under every *other* declared principal and compares. With no `as <session>` there is no principal it is comparing against, so there is nothing to judge — add one, e.g. `test "…" as shopper` (SPEC §3.3)',
      });
    }
    if (noProbeablePrincipal && !frame.workload) {
      diags.push({
        code: Codes.AUTHZ_ASSERTION_NO_PRINCIPAL,
        severity: 'error',
        message: '`authorization violations` has no principal to probe with — every declared `session` is `privileged`',
        span: step.span,
        hint: `\`tflw.config\` declares ${declared!.map((s) => `\`${s}\``).join(', ')}, and marks all of them \`privileged\`, so the probe set holds only \`anonymous\` — which tests authentication, not authorization. \`privileged\` is a claim that a principal is *meant* to reach other principals' resources; drop it from the one you want probed`,
      });
    }

    const owner = nearestPrecedingApiStep(steps, i);
    const named = owner ? literalIdentityHeader(owner) : null;
    if (named) {
      diags.push({
        code: Codes.AUTHZ_STEP_NAMES_OWN_CREDENTIAL,
        severity: 'error',
        message: `the \`api\` step this asserts on names its own \`${named}\` header`,
        span: step.span,
        // Not a style objection. The probe strips the observed `Authorization`/`Cookie` and applies
        // the probing principal's own — so a credential written onto the step is one the *owner's*
        // sessions never supplied, and the differential comparison is then between two identities
        // the run cannot name. A finding from that is confidently wrong in either direction.
        hint: `the oracle compares this request re-issued under other principals against what the owner's \`as <session>\` actually contributed — a \`${named}\` written onto the step belongs to neither, so the comparison has no principal behind it. Move the credential into a \`session\` block and name it with \`as <session>\` (SPEC §3.3)`,
      });
    }
  }
}

/** The scans `TF064` refuses inside `wait until api`, and what to call each in its message. A
 *  lookup rather than an `||` chain, for `SCAN_LABELS`' reason: a third originating scan is a row,
 *  and the message says which one was refused instead of naming the wrong tier. */
const REPEATED_REQUEST_SCAN_LABELS: Partial<Record<MatcherName, string>> = {
  hasNoAuthzViolations: 'authorization violations',
  hasNoInputHandlingViolations: 'input handling violations',
};

/**
 * `TF067`'s static half (M134a, D382) — whether this request **provably** carries nothing Tier 3
 * could mutate.
 *
 * Mirrors `inputCorpus.ts`'s `mutationSites` exactly: an identifier path segment, a query parameter,
 * or a JSON body leaf. Two statements of one rule is a drift risk, and the way it is kept honest is
 * that the runtime holds the authoritative copy and re-decides the same question on the request that
 * actually went out — so a disagreement costs a duplicated message, never a wrong verdict.
 *
 * **Every uncertainty answers `false`**, which is the direction that refuses no correct file:
 *
 *  - a `{var}` anywhere in the path — interpolation can produce an id segment or a whole query
 *    string, and this pass cannot know which;
 *  - `body from "…"` — the file's contents are not this pass's to read;
 *  - `body "…"` raw text — it may well be JSON, and guessing from a content-type header would be a
 *    guess about a header that may itself be interpolated.
 *
 * What is left is the case worth catching and the one a reader actually writes by mistake:
 * `api GET /health` with an input-handling assertion under it.
 */
function hasNoStaticallyMutableInput(spec: ApiRequestSpec): boolean {
  const raw = spec.path.raw;
  if (raw.includes('{')) return false;

  const [pathPart, queryPart] = raw.split('?', 2);
  // A query string with at least one named parameter is a mutation site by itself.
  if (queryPart !== undefined && queryPart.length > 0 && queryPart.split('&').some((p) => p.length > 0)) return false;
  // `inputCorpus.isIdentifierSegment`'s rule, restated: a UUID, a run of digits, or a long hex
  // string. A route word is not a site — mutating it exercises the router, not the handler.
  const identifier = (pathPart ?? '')
    .split('/')
    .some((seg) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(seg) || /^\d+$/.test(seg) || /^[0-9a-fA-F]{24,}$/.test(seg));
  if (identifier) return false;

  if (spec.body === null) return true;
  // Only the two shapes that provably cannot produce a JSON leaf. `InlineBody` has leaves by
  // construction; the other two are the uncertainties named above.
  return spec.body.type === 'FormBody' || spec.body.type === 'UploadBody';
}

/** The nearest preceding `api` step **in the same body** — the request this assertion will judge.
 *  Deliberately not a search that crosses into a call or out of a block: `checkResponseScopeInSteps`
 *  already establishes that a response never crosses those boundaries, and a rule that reached
 *  further would be answering about a request this frame cannot see. */
function nearestPrecedingApiStep(steps: readonly Step[], from: number): ApiRequestSpec | null {
  for (let i = from - 1; i >= 0; i--) {
    const step = steps[i]!;
    if (step.type === 'ApiStep') return step;
    if (step.type === 'WaitUntilApiStmt') return step.request;
  }
  return null;
}

/** The identity header this step writes for itself, or null (D328's check-time half).
 *
 *  Case-insensitive, because a header map keeps the case its author typed — the assumption `M128`'s
 *  `sec/authenticated-response-cacheable` got wrong, where it cost a rule that fired for nobody.
 *  An **interpolated header name** is skipped rather than guessed at: `header "{h}" is …` may or may
 *  not be `Authorization`, and this rule refuses a file, so being wrong here refuses a correct one.
 *  The value is not read at all — a credential is a credential whether it is a literal or a
 *  `{token}`, and D328's runtime half compares the actual bytes anyway. */
function literalIdentityHeader(step: ApiRequestSpec): string | null {
  for (const header of step.headers) {
    if (header.name.parts.some((p) => p.kind === 'interp')) continue;
    const name = header.name.value.toLowerCase();
    if (name === 'authorization') return 'Authorization';
    if (name === 'cookie') return 'Cookie';
  }
  return null;
}

/**
 * D331 — the suite's identity census: how many `api` steps sit in a test that declares an owner.
 *
 * **This exists because D316's blind-spot count, as specified, could only ever be zero.** It asked
 * the run to count `api` steps it could not attribute to a principal and named the `TF062`/`TF063`
 * sites — but those are *errors*, so no run containing one ever executes. The intent survives as a
 * static fact about the suite, printed once beside the `authorized target` reason, and it is the
 * sentence that stops *we probed everything we asserted on* being read as *we probed everything*.
 *
 * The denominator is every `api`/`wait until api` step in the file, including those in `action` and
 * hook bodies; the numerator counts only steps lexically inside a test that declares an owner. A
 * step inside an `action` runs under whichever test called it, which is knowable at run time and not
 * here — so it lands in the denominator and not the numerator, and the census under-claims rather
 * than over-claims. That is the correct direction for a number whose whole job is to state a bound.
 */
export interface IdentityCensus {
  readonly apiSteps: number;
  readonly withOwner: number;
}

export function identityCensus(program: Program): IdentityCensus {
  let apiSteps = 0;
  let withOwner = 0;
  const count = (steps: readonly Step[], owned: boolean): void => {
    for (const step of steps) {
      if (step.type === 'ApiStep' || step.type === 'WaitUntilApiStmt') {
        apiSteps++;
        if (owned) withOwner++;
      }
      if (step.type === 'WithinBlock' || step.type === 'SwitchToNewTabBlock' || step.type === 'DownloadBlock') count(step.body, owned);
    }
  };
  for (const test of program.tests) count(test.body, test.sessions.length > 0);
  for (const action of program.actions) count(action.body, false);
  for (const hook of program.hooks) count(hook.body, false);
  return { apiSteps, withOwner };
}

export function checkAbsoluteUrls(program: Program, opts: ProgramCheckOptions = {}): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const test of program.tests) checkAbsoluteUrlsInSteps(test.body, opts, diags);
  for (const action of program.actions) checkAbsoluteUrlsInSteps(action.body, opts, diags);
  for (const hook of program.hooks) checkAbsoluteUrlsInSteps(hook.body, opts, diags);
  return byPosition(diags);
}

function checkAbsoluteUrlsInSteps(steps: readonly Step[], opts: ProgramCheckOptions, diags: Diagnostic[]): void {
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const node = value as Record<string, unknown>;
    const kind = node['type'];
    if (kind === 'ApiStep') {
      checkOneAbsoluteTarget(pathRaw(node['path']), node['service'], spanOf(node), 'api', opts, diags);
    } else if (kind === 'WaitUntilApiStmt') {
      const request = node['request'] as Record<string, unknown> | undefined;
      if (request) checkOneAbsoluteTarget(pathRaw(request['path']), request['service'], spanOf(node), 'wait until api', opts, diags);
    } else if (kind === 'OpenStmt') {
      // `open` carries a `StringLit`, not a `PathExpr` — the same address written in the other of
      // the language's two spellings for one.
      const lit = node['path'] as Record<string, unknown> | undefined;
      const raw = typeof lit?.['value'] === 'string' ? (lit['value'] as string) : null;
      checkOneAbsoluteTarget(raw, null, spanOf(node), 'open', opts, diags);
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(steps);
}

function pathRaw(path: unknown): string | null {
  const node = path as Record<string, unknown> | undefined;
  return typeof node?.['raw'] === 'string' ? (node['raw'] as string) : null;
}

function spanOf(node: Record<string, unknown>): Span {
  return node['span'] as Span;
}

function checkOneAbsoluteTarget(
  target: string | null,
  service: unknown,
  span: Span,
  keyword: string,
  opts: ProgramCheckOptions,
  diags: Diagnostic[],
): void {
  // `null` is not "relative" — it is "the AST did not hand us a literal to read", and the two must
  // not collapse. An interpolated `{base}/orders` reaches here as a string that does not start with
  // a scheme and is correctly silent: whether it resolves absolutely is a runtime fact.
  if (target === null || !isAbsoluteUrl(target)) return;

  // D266 — a named service selects a base URL, and an absolute URL replaces it. Both cannot be
  // load-bearing, so one of the two is dead text the author believes is doing something. An
  // **error**, not a warning, and the tier is not a judgement call: both operands are written in
  // this file, so there is no config that makes the combination meaningful and nothing for the
  // checker to predict. That is exactly `M124`'s line.
  if (typeof service === 'string') {
    diags.push({
      code: Codes.SERVICE_WITH_ABSOLUTE_URL,
      severity: 'error',
      message: `\`${keyword} ${service}\` names a service and an absolute URL ("${target}") on the same step`,
      span,
      hint: `a service names the base URL to send to, and an absolute URL already is one — so one of the two would be silently ignored. Drop \`${service}\` to send to the URL as written, or write a path (\`/orders\`) to send to the service`,
    });
    return;
  }

  const declared = opts.envAllowHosts;
  if (declared && declared.hosts.length === 0) {
    const host = absoluteUrlHost(target);
    diags.push({
      code: Codes.ABSOLUTE_URL_NEEDS_ALLOW_HOSTS,
      severity: 'warning',
      message: `this \`${keyword}\` step names an absolute URL and env "${declared.envName}" declares no \`allow hosts\` — the run will refuse to send it`,
      span,
      // Says what the *runtime* will do, because that is the fact the author needs and it is not
      // guessable from the config: an allowlist is opt-in and its absence means no enforcement
      // everywhere else in the language. This is the one place absence means refusal.
      hint: host
        ? `an absolute URL can reach a host \`tflw.config\` never mentions, so writing one opts the suite into declaring where it may reach — add \`allow hosts "${host}"\` to env "${declared.envName}" or to \`defaults\` (SPEC §3.7)`
        : `add an \`allow hosts\` entry covering this URL's host to env "${declared.envName}" or to \`defaults\` (SPEC §3.7)`,
    });
    return;
  }

  diags.push({
    code: Codes.ABSOLUTE_URL_NOT_PORTABLE,
    severity: 'warning',
    message: `this \`${keyword}\` step names an absolute URL, so \`--env\` will not move it`,
    span,
    // Not phrased as a mistake, because it frequently is not one — a one-off request to a second
    // host is the case `FU-18` was filed about. The warning exists so that "this step ignores the
    // env" is a thing the file says out loud rather than a thing a reader has to notice.
    hint: `every other request follows the active env's base URL; this one is fixed wherever it points. That is a fine thing to want for a one-off — if it is not, move the host into \`tflw.config\` as a base URL or a named service and write a path (SPEC §3.1)`,
  });
}

/** What each non-capturable kind *does* support, in the runtime's own words — the part a reader
 * needs, since "not capturable" alone leaves them nowhere to go. */
const UNCAPTURABLE_HINTS: Readonly<Record<Exclude<SubjectKind, 'value'>, string>> = {
  locator: 'a UI locator is something to assert about — use `expect`/`check` against it, or `capture text "…"`-style value subject if you want its content (SPEC §9.4)',
  page: '`page` is only ever an a11y subject — `expect`/`check page has no … a11y violations` (SPEC §9.8)',
  // Deliberately points at the addressable subjects rather than only naming the restriction: a user
  // who wrote `capture response as r` almost certainly wanted the body, and `response` is the one
  // subject in the language whose name makes that the obvious guess.
  response: '`response` is only ever a security-scan subject — `expect`/`check response has no … security violations` (SPEC §9.10). To bind part of the response, name it: `capture body.…`, `capture status`, `capture header "…"`',
  request: '`request` reports whether the last api step connected — `expect`/`check request connects`/`fails` (SPEC §6.2.2)',
  'network-request': 'an observed network request is something to assert about, not a value to bind — use `expect`/`check` against it (SPEC §9.7)',
};

// ---------------------------------------------------------------------------
// `TF068`/`TF070` — the `crawl` declaration's two structural rules (M137c, D443/D463/D464)
// ---------------------------------------------------------------------------

/**
 * The three `violations` matchers a `crawl` body may assert, which is `D450`'s whole claim about the
 * construct made checkable: Tier 4 adds a **source of requests**, not a kind of judgement, so the
 * families it can use are exactly the ones the arc already ships.
 *
 * Shaped as a lookup over `MatcherName` rather than a `Set<string>` for the reason `SCAN_LABELS` is:
 * a fourth `violations` family added to the language has to come here to be legal in a crawl, and a
 * misspelling in this list is a type error rather than a rule that silently rejects everything.
 */
const CRAWL_BODY_MATCHERS: Partial<Record<MatcherName, true>> = {
  hasNoSecurityViolations: true,
  hasNoAuthzViolations: true,
  hasNoInputHandlingViolations: true,
};

/**
 * **`TF068`** — a `crawl` that declares no `seed`, so its surface is empty before the run starts.
 *
 * `D285`'s no-power-to-fail shape on the new construct, refused at check time for `TF067`'s stated
 * reason: an assertion that could not have failed whatever the application did must be *speakable*
 * rather than reported as a green, and the cheapest place to say it is before anything executes.
 *
 * Decided here **only where it provably can be**, which is the same line `TF067`'s static half draws.
 * Zero `seed` clauses is a fact about the file. *An OpenAPI document that answers 404*, *a run whose
 * tests captured no traffic*, and *an `exclude` list that happens to cover every discovered route*
 * are facts about the run, and those belong to the runtime door — reusing this code, not minting
 * one, because the repair a reader has to make is the same sentence from either door. That door
 * lands with the crawler itself (`D436`); this one is what makes the code buildable at all, which is
 * `D456`'s lesson from `M137b` stated as sequencing rather than as a withdrawal.
 *
 * **`TF070`** — a step in a crawl body that is not one of `CRAWL_BODY_MATCHERS`. The grammar admits
 * any `Step` on purpose (`ast.ts`'s `CrawlDecl.body`), so that `api GET /products` inside a crawl
 * gets this sentence instead of `expected an expect`.
 */
export function checkCrawls(program: Program): Diagnostic[] {
  const diags: Diagnostic[] = [];
  for (const crawl of program.crawls ?? []) {
    if (crawl.seeds.length === 0) {
      diags.push({
        code: Codes.CRAWL_NO_SURFACE,
        severity: 'error',
        message: `crawl "${crawl.name.value}" has nothing to crawl — it declares no \`seed\``,
        // The span is the header rather than the body: the missing thing is a header clause, and
        // pointing at the first assertion would send the reader to the line that is correct.
        span: crawl.span,
        hint:
          'a crawl discovers its surface from its seeds, and with none it issues no request — so every assertion in its body could not have failed whatever the application did (SPEC §9.15, `TF068`, D285). ' +
          'Give it something to crawl: `seed openapi "/openapi.json"` for the documented surface, `seed traffic` for the requests this run\'s own tests made',
      });
    }
    checkCrawlBodyInSteps(crawl, crawl.body, diags);
  }
  return byPosition(diags);
}

/**
 * `TF070`, walked **flat, on purpose** — the one place in this file where not recursing is the
 * decision rather than the omission.
 *
 * Every other body-walking pass here descends into `within`/`switch to new tab`/`download` because
 * those blocks are legal containers whose children still need judging. Here the block *itself* is
 * already refused: it is not an `ExpectStmt`, so it takes a `TF070` of its own. Descending would then
 * report the block and every step inside it — several diagnostics for one mistake, which is the
 * cascade `parseCrawl`'s duplicate-`as` recovery is also written to avoid. One misplaced construct,
 * one line to fix, one diagnostic.
 */
function checkCrawlBodyInSteps(crawl: CrawlDecl, steps: readonly Step[], diags: Diagnostic[]): void {
  for (const step of steps) {
    if (step.type === 'ExpectStmt' && CRAWL_BODY_MATCHERS[step.matcher.name]) continue;
    diags.push({
      code: Codes.CRAWL_BODY_INVALID,
      severity: 'error',
      message: `a \`crawl\` body takes only \`violations\` assertions, and this is ${describeCrawlOffender(step)}`,
      span: step.span,
      hint: `\`crawl "${crawl.name.value}"\` is a source of requests, not a place to write them (SPEC §9.15, D450): it issues one request per discovered route, per declared principal, and each \`expect\` in its body judges every one of those responses. A step that sends its own request, binds a value, or asserts about \`response\` in the singular belongs in a \`test\`. The three families a crawl body accepts are \`security\`, \`authorization\` and \`input handling\` violations`,
    });
  }
}

/** Names the offender the way its author would recognise it. A step type is an AST word — `ApiStep`
 *  in a message sends a reader looking for the word `ApiStep` in their file — so the two shapes
 *  people actually write get their own sentence, and everything else falls back to the keyword the
 *  message can be sure of. */
function describeCrawlOffender(step: Step): string {
  if (step.type === 'ExpectStmt') {
    return `\`${step.soft ? 'check' : 'expect'}\` about one response — a crawl has many`;
  }
  if (step.type === 'ApiStep' || step.type === 'WaitUntilApiStmt') return 'a step that sends its own request';
  return 'not one';
}
