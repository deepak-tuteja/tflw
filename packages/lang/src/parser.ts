// Recursive-descent parser for the testFlow M0 surface (GRAMMAR.md § Syntactic). Consumes the
// token stream from the lexer, produces a typed AST (ast.ts), and collects structured
// diagnostics with panic-mode recovery (skip to the next NEWLINE/DEDENT) so a single file can
// surface many errors. No parser generator (PLAN P#12); no I/O.

import type { Position, Span, Token } from './token.js';
import { describeToken, describeTokenType } from './token.js';
import { type Diagnostic, Codes, suggest } from './diagnostic.js';
import type {
  FindingSeverity,
  AcceptDialogStmt,
  ActionDecl,
  AllowHostsDecl,
  AuthorizedTargetDecl,
  ApiBody,
  ApiHeader,
  ApiRequestSpec,
  ApiServiceDecl,
  ArrayLit,
  BinaryExpr,
  BodyBytesSubject,
  BodyCsvSubject,
  BodyPdfTextSubject,
  BodySubject,
  BodyTextSubject,
  CallExpr,
  CaptureStmt,
  CsrfStmt,
  CertDecl,
  ClickKind,
  ClickStmt,
  CloseTabStmt,
  ConfigEntry,
  ConfigFile,
  DataTable,
  DateAtom,
  DateOffsetLit,
  DateOffsetUnit,
  DefaultsBlock,
  DismissDialogStmt,
  DownloadBlock,
  DragStmt,
  DropFileStmt,
  DurationLit,
  EnvBlock,
  EnvRef,
  EvidenceDecl,
  EvidenceLevel,
  ExcludeDecl,
  ExpectStmt,
  Field,
  FieldValue,
  FileBody,
  FillFormRow,
  FillFormStmt,
  FillStmt,
  FormatExpr,
  FormBody,
  FormField,
  GiveStmt,
  HeaderDecl,
  HeaderStmt,
  HookDecl,
  HoverStmt,
  HttpMethod,
  ImportDecl,
  InlineBody,
  InsecureDecl,
  Interp,
  KeyDecl,
  LetStmt,
  Locator,
  LocatorKind,
  LocatorSubject,
  LogDestination,
  LogDestinationDecl,
  LogLevel,
  LogLevelDecl,
  LogStmt,
  MalformedStep,
  Matcher,
  MatcherName,
  NetworkRequestRef,
  NumberLit,
  Oauth2SessionConfig,
  ObjectLit,
  OpenStmt,
  PathExpr,
  PauseStmt,
  PathSegment,
  PressStmt,
  Program,
  RandomDateBetweenExpr,
  RandomDateInFutureExpr,
  RandomDateInPastExpr,
  RandomDecimalExpr,
  RandomLikeExpr,
  RandomNumberExpr,
  RandomOfExpr,
  RandomPasswordExpr,
  RandomStringExpr,
  RandomUuidExpr,
  RedactDecl,
  RedactPathSegment,
  RedactPattern,
  ReportDecl,
  RequireDecl,
  RampRpsWorkload,
  RampUsersWorkload,
  HoldRpsWorkload,
  HoldUsersWorkload,
  PerVuIterationsWorkload,
  SharedIterationsWorkload,
  Stage,
  StepRpsWorkload,
  StepUsersWorkload,
  SpikeRpsWorkload,
  SpikeUsersWorkload,
  RetryAfterClause,
  ScrollStmt,
  SelectStmt,
  SessionDecl,
  Step,
  StringLit,
  StringPart,
  Subject,
  SwitchToNewTabBlock,
  SwitchToTabStmt,
  TestDecl,
  CrawlDecl,
  CrawlSeed,
  TextBody,
  ThresholdDecl,
  ThresholdMetric,
  ThresholdOp,
  TickStmt,
  TimeoutDecl,
  TimeoutTarget,
  TransformExpr,
  UniqueEmailExpr,
  UniqueLikeExpr,
  UniqueNumberExpr,
  UniquePrefixExpr,
  UniqueUuidExpr,
  UntickStmt,
  UploadBody,
  UseDecl,
  Value,
  ViewportDecl,
  WaitUntilApiStmt,
  WaitUntilUiStmt,
  WebDecl,
  WithinBlock,
  Workload,
  WorkersDecl,
} from './ast.js';
import { pollable, quantifiable } from './ast.js';
import { type ConfigDirective, listConfigDirectives } from './spec-data.js';

export interface ParseResult {
  readonly program: Program;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ConfigResult {
  readonly config: ConfigFile;
  readonly diagnostics: readonly Diagnostic[];
}

/** Which of the seven instrumented grammar productions the cursor sat in (PLAN_M13_LSP.md decision
 * 17.6; `transform` added decision 22/M18) — `packages/lsp-server` maps this to a candidate list
 * (symbol names from `symbols.ts` for `session`/`step`'s action-call case, `spec-data.ts` entries
 * for `subject`/`matcher`/`unique`/`random`/`transform`, and the fixed statement-keyword set for
 * `step`). Autocomplete has no case for a value position (`parseAtom`'s broad dispatch, decision
 * 17.6) — too large a candidate set, low payoff; `unique`/`random`/`transform` are each instrumented
 * only for the sub-keyword right after their entry word (`email`/`number`/…, `encode`/`decode`).
 *
 * **The last five are the config dialect's, added by `M137a` (D444).** They are separate kinds
 * rather than one kind carrying a block/position field because `CompletionContext` is a two-field
 * record every consumer switches on exhaustively, and a field that only some kinds read is how a
 * consumer silently handles a case it never considered. `defaults-key` and `env-key` differ because
 * six of the fifteen config keys are legal in only one of the two blocks (`configKeyAllowedIn`);
 * `probe` and `probe-class` differ because the two are typed from different positions and a person
 * at the second one must not be offered a label beginning with the word they just typed. */
export type CompletionKind =
  | 'step'
  | 'subject'
  | 'matcher'
  | 'session'
  | 'unique'
  | 'random'
  | 'transform'
  | 'config-directive'
  | 'defaults-key'
  | 'env-key'
  | 'probe'
  | 'probe-class';

export interface CompletionContext {
  readonly kind: CompletionKind;
  /** Partial identifier text already typed at the cursor (e.g. `"ex"` mid-typing `expect`), or
   * `''` when the cursor sits right after a completed token (e.g. right after a space). */
  readonly prefix: string;
}

export const STATEMENT_KEYWORDS = [
  'api',
  'expect',
  'check',
  'let',
  'capture',
  'log',
  'wait',
  'give',
  'open',
  'click',
  'double',
  'right',
  'fill',
  'select',
  // FS-04: `tick`/`untick` are the checkbox actions. `uncheck` is retired (below) — it stays a
  // statement keyword only so dispatch reaches it and can name `untick` outright.
  'tick',
  'untick',
  'uncheck',
  'press',
  'hover',
  'scroll',
  'within',
  'accept',
  'dismiss',
  'switch',
  'close',
  'download',
  'drag',
  'drop',
  'screenshot',
  'stub',
  'pause',
  // FS-05: `think` was renamed to `pause`. It stays a statement keyword purely so the migration
  // diagnostic below can fire — dropping it outright would surface as `TF011: unknown statement`,
  // whose did-you-mean is an edit-distance search that will never reach `pause` from `think`.
  'think',
] as const;
/**
 * One word the language deliberately refuses, and everything its refusal has to say (`M142-01`).
 *
 * Before this interface there were **three unrelated mechanisms and no way to ask the question**: a
 * statement-scoped array holding `think` and `uncheck`, a `removedKeyword()` call at `scenario`'s
 * top-level dispatch case carrying a migration diagnostic, and a bare did-you-mean hint for `tests`
 * with no list behind it at all. They differed in *kind* rather than in spelling, so `scenario` was
 * a retired keyword that was **not in the retired-keyword list**, and nothing anywhere would have
 * noticed a fourth added in a fourth way. `semanticTokens.ts` had already written that down as a
 * hazard beside `REFUSED_ON_PURPOSE`, which is a *second* list of the same words kept for a
 * different purpose and never checked against the first.
 */
export interface RefusedWord {
  /** Which dispatch reaches the word: `parseProgram`'s top level or `parseStep`'s switch. A `step`
   * word must also stay in `STATEMENT_KEYWORDS` — dispatch is how the refusal is reached at all,
   * and dropping the word would surface as `TF011: unknown statement`, whose did-you-mean is an
   * edit-distance search that will never reach `pause` from `think`. Held by `stepKeywords.test.ts`. */
  readonly position: 'top-level' | 'step';
  /** The sentence that names the replacement. Every row has one — it is what the table is for. */
  readonly hint: string;
  /** Present when the refusal owns its whole diagnostic. Absent for a word refused *inside* a
   * broader "unexpected …" error, where the surrounding site already says what was expected and
   * this row contributes only the hint. */
  readonly diagnostic?: { readonly code: string; readonly message: string };
  /** What `tflw migrate` splices over the word's own span. Only ever alongside `diagnostic`, since
   * a splice needs a span and the span is the diagnostic's — asserted, not merely intended. The
   * replacement is itself live grammar, which is what makes `migrateCommand`'s termination
   * structural rather than hopeful; that too is asserted rather than argued. */
  readonly replacement?: string;
}

/** The refused spellings, as an **array literal** as well as as the record's keys — for `M142-02`'s
 * reason, met a second time while fixing `M142-01`. `vocabulary.test.ts` reads array literals,
 * `isKw`/`expectKw` arguments and `.value === '…'` comparisons; object keys are the fourth
 * mechanism it cannot see, and moving these four words out of their inline `isKw` calls and into a
 * record would have removed them from the corpus that asks whether the editor accounts for every
 * word the parser knows. `grammarCoverage.test.ts` reads this constant for the same reason. */
export const REFUSED_SPELLINGS = ['scenario', 'tests', 'think', 'uncheck'] as const;

/** The spellings `refuse()` accepts, derived from the tuple above so the lookup inside it is total:
 * a call naming a word with no row is a type error, not a silent no-op. */
export type RefusedSpelling = (typeof REFUSED_SPELLINGS)[number];

/**
 * Every word the parser recognises **only in order to refuse it** — the answer to *which words does
 * this language deliberately refuse*, asked by a program instead of by hand.
 *
 * **Where the boundary is, and why it is not further out.** These are words refused by *dispatch*:
 * the parser has a case for the word and the case is an error. Words refused *by construction* are
 * not here and could not be — `empty`, `at`, `least`, `most`, `more` and `fewer` are not matchers,
 * and the site that answers them (`:3441`) tests one word list that also holds `greater` and
 * `less`, which are live matchers. A row for those would be a row for "not being in a list", which
 * is true of every word in every language. `REFUSED_ON_PURPOSE` in `semanticTokens.ts` is wider on
 * purpose, because a highlighter has to decide about a word in *any* position; the assertion that
 * reconciles the two lives in `stepKeywords.test.ts` and runs in the direction that holds.
 */
export const REFUSED_WORDS: Readonly<Record<RefusedSpelling, RefusedWord>> = {
  scenario: {
    // M50/D93. The block is now just `test "…"`, kind inferred from the workload clause it already
    // contains.
    //
    // The hint used to read ``write `test "…" { ramp to … }` instead`` (`A3-01`, D-M90-5). That
    // brace form is a *parse error* in an indentation-based language — following the advice
    // literally earns a `TF010` — and the `ramp to …` line it told the user to write is already in
    // their file: `parseScenarioDecl` made a workload line mandatory (verified at `a2c457c^`), so
    // no legal old `scenario` ever lacked one. The instruction was noise on top of a syntax error.
    // It is a one-word rename, and the payload says so.
    //
    // That mandatory workload line is also why the splice is *total* rather than approximate: every
    // legal old `scenario` becomes a workload-bearing `test`, never a functional one, so a silent
    // load-test→functional-test demotion is structurally impossible. All three body constructs the
    // old block allowed (`as admin, userA`, `threshold …`, `cleanup`) still parse inside `parseTest`.
    position: 'top-level',
    diagnostic: { code: Codes.LOAD_INVALID, message: '`scenario` was removed — write `test` instead' },
    hint: 'a `test` block is a load test whenever it contains a workload line (`ramp to …`); there is no longer a separate keyword',
    replacement: 'test',
  },
  tests: {
    // Never a keyword, so there is no removal to report and nothing to migrate *from* — the word is
    // simply a plural nobody warned the user about. It earns a row because the parser recognises it
    // by name, which is the property this table enumerates; the `tests`-shaped hole in the old
    // arrangement was that this refusal lived nowhere but an inline ternary.
    position: 'top-level',
    hint: 'did you mean `test`?',
  },
  think: {
    // FS-05, D103 teaching style: name the replacement outright rather than leaving a did-you-mean
    // to bridge two words that share no letters.
    position: 'step',
    diagnostic: { code: Codes.LOAD_INVALID, message: '`think` was renamed to `pause` — write `pause 2s` / `pause 1s to 3s` instead' },
    hint: 'same semantics and the same workload-only restriction; `pause` describes the statement rather than the modelled user, and stays unambiguous against `wait until …`',
    replacement: 'pause',
  },
  uncheck: {
    // FS-04. `uncheck`→`untick` is 3 edits, past `suggest`'s threshold, so it is named outright for
    // the same reason `think` is.
    position: 'step',
    diagnostic: { code: Codes.UNKNOWN_STATEMENT, message: '`uncheck` was renamed to `untick` — write `untick field "…"` instead' },
    hint: 'same step, same semantics; it moved with `check <locator>` → `tick <locator>`, which had to stop being a checkbox action so `check` means only the soft assertion (SPEC §9.1)',
    replacement: 'untick',
  },
};

/** Retired *step* spellings, derived rather than restated — the list `SUGGESTABLE_STATEMENT_KEYWORDS`
 * subtracts and `stepKeywords.test.ts` holds undocumented. They are not steps anyone may write, so
 * the "expected one of" fallback must not advertise them and did-you-mean must not route a typo
 * through a spelling that is itself an error. */
export const RETIRED_STATEMENT_KEYWORDS: readonly string[] = REFUSED_SPELLINGS.filter((w) => REFUSED_WORDS[w].position === 'step');
const SUGGESTABLE_STATEMENT_KEYWORDS = STATEMENT_KEYWORDS.filter((k) => !RETIRED_STATEMENT_KEYWORDS.includes(k));
const SUBJECT_KEYWORDS = ['status', 'duration', 'header', 'body', 'request', 'button', 'field', 'text', 'list', 'css', 'xpath', 'page', 'response'] as const;
/** What may stand in subject position, for the "expected …" half of every `TF013`. `{variable}` is
 * *not* a keyword (M96/`FU-11`, D129 — one token of lookahead distinguishes it), so it cannot be
 * appended to the joined list; it is named separately here so the two error sites can't drift. */
const SUBJECT_EXPECTATION = `expected a subject (${SUBJECT_KEYWORDS.join(', ')}) or a \`{variable}\``;
const LOCATOR_KEYWORDS = ['button', 'field', 'text', 'list', 'css', 'xpath'] as const;
const MATCHER_KEYWORDS = ['equals', 'contains', 'matches', 'has', 'connects', 'fails', 'was'] as const;
const STATE_WORDS = ['visible', 'hidden', 'enabled', 'disabled', 'checked'] as const;
/** `is` and `not` sit in *front* of a matcher; neither is one. `parseMatcher`'s prefix loop consumes
 * both before the switch below ever sees a token, so a word that reaches the unknown-matcher error
 * is standing in the matcher slot — and offering "did you mean `not`?" there recommends a spelling
 * that cannot complete the statement (M61, review finding A3-20: `expect status nut 200` suggested
 * `not`, and `expect status not 200` is a fresh error). Same shape as `RETIRED_STATEMENT_KEYWORDS`
 * above — a word the grammar knows, deliberately held out of the did-you-mean pool, and named in
 * the fallback help line instead, where saying it is true. */
const MATCHER_PREFIX_KEYWORDS = ['is', 'not'] as const;
/** Every word that may legally *complete* a matcher, for `suggest`. After FS-08 made `is` an
 * optional copula, `greater`/`less` and the state words can appear with no `is` in front of them, so
 * a typo'd `vissible` has to be reachable from the same list as a typo'd `equalz` — there is no
 * longer an `is` branch with its own narrower vocabulary. */
const MATCHER_VOCABULARY = [...MATCHER_KEYWORDS, 'greater', 'less', ...STATE_WORDS] as const;
/** The last word on an unknown matcher, when `suggest` finds nothing close enough — so it has to
 * name the whole vocabulary, and name it *completely*. Built from the constants rather than written
 * out, because the hand-written version drifted: it omitted `equals`, the most-used matcher in the
 * language, from a line that presents itself as the option set (review finding OBS-04). */
const MATCHER_VOCABULARY_HELP =
  `expected a value matcher (${MATCHER_KEYWORDS.join(', ')}), \`greater than\`/\`less than\`, or a state ` +
  `(${STATE_WORDS.join('/')}) — any of them optionally prefixed with \`${MATCHER_PREFIX_KEYWORDS.join('`/`')}\``;
/** FU-09 — the two spellings that actually assert a collection's size, named wherever a user
 * reaches for one of the three that don't (`is not empty`, `has at least 1`,
 * `has count greater than 0`). Both work in both directions at runtime; the gap was never
 * capability, it was that no diagnostic pointed at either one. */
const COUNT_BOUND_HELP =
  'write `not has count 0` for "at least one" (`has count 0` for the empty case), or put the ' +
  'comparison on the length instead — `expect body.items.length is greater than 0`, which takes ' +
  '`greater than`/`less than`/`equals` alike';
/**
 * The size comparisons a user writes after `has count`/`has value`, where the grammar wants a value.
 * `at` takes `least`/`most`; the rest take `than`. Rendered back as the whole phrase the user typed,
 * so the message quotes their own words rather than one token of them (FU-09).
 *
 * **The first words are an array as well as the record's keys** (`M142-02`).
 *
 * `vocabulary.test.ts` walks `parser.ts` for the three shapes that recognise a word — a string in
 * an array literal, a string argument to `expectKw`/`isKw`, and a `<expr>.value === '…'` comparison
 * (`D550`). An object literal's **keys** are a fourth, and the walk saw only the words in the arrays
 * that were this record's values. It was harmless only because every key happened to be reachable
 * another way, which is the kind of coincidence the guard exists to stop depending on.
 *
 * Reading object keys *in general* was the rejected alternative: it floods the golden with `type`,
 * `kind`, `span` and every other property name in a 4700-line file, and picking the vocabulary-
 * bearing literals by name is the hand-selection that lost words in three of the seven earlier
 * extractions. So the record is restated instead — the keys are a tuple the walk already reads, and
 * the record is keyed *by* that tuple, so a sixth first-word cannot be added to one and not the
 * other without a type error.
 */
const BOUND_FIRST_WORDS = ['greater', 'less', 'more', 'fewer', 'at'] as const;
const BOUND_SECOND_WORDS: Readonly<Record<(typeof BOUND_FIRST_WORDS)[number], readonly string[]>> = {
  greater: ['than'],
  less: ['than'],
  more: ['than'],
  fewer: ['than'],
  at: ['least', 'most'],
};

/** `greater than` / `at least` / … when a size comparison sits where a value belongs, else
 * `undefined`. `tok` is the word itself and `after` the one behind it, so a partial phrase
 * (`has count greater 0`) still reports the word rather than inventing the missing one. */
function boundPhrase(tok: Token, after: Token): string | undefined {
  if (tok.type !== 'ident') return undefined;
  if (!(BOUND_FIRST_WORDS as readonly string[]).includes(tok.value)) return undefined;
  const seconds = BOUND_SECOND_WORDS[tok.value as (typeof BOUND_FIRST_WORDS)[number]];
  return after.type === 'ident' && seconds.includes(after.value) ? `${tok.value} ${after.value}` : tok.value;
}

/** The negation morphemes a user reaches for when they want the *absence* of a state — `invisible`,
 * `unchecked`, `unhidden`, `notvisible`. There are no negated state words in this grammar: negation
 * is the `not` prefix, once, in front of the positive word. See `negatedStateWord`. */
const NEGATION_PREFIXES = ['not', 'non', 'un', 'in', 'im', 'dis'] as const;
/** The severity floor every scan matcher accepts — `has no [<severity>] a11y violations` (M3e, SPEC
 * §9.8), `has no [<severity>] security violations` (M128b, SPEC §9.10) and `has no [<severity>]
 * authorization violations` (M130b, SPEC §9.11). Increasing severity, matching axe-core's own
 * `impact` scale (`FindingSeverity`, ast.ts). */
const SEVERITY_FLOOR_WORDS = ['minor', 'moderate', 'serious', 'critical'] as const;
/** Which scan `has no … violations` is asking for (M128b, D290; M130b, D304). Three words, one
 * construct — see `parseScanViolationsMatcher`. */
/**
 * Which scan `has no … violations` is asking for (M128b, D290; M130b, D304; M134a, D366).
 *
 * **Phrases, not words, as of `M134a` — and the hyphen D366 wrote is not spellable here.** The plan
 * names the third scan `input-handling`, but `isIdentCont` is `/[A-Za-z0-9_]/` and `-` lexes as
 * `minus`, so `input-handling` arrives as three tokens and could never match a keyword. Measured
 * before choosing the alternative: this language has **zero** hyphenated bare keywords — every
 * multi-word construct it has is space-separated (`allow hosts`, `authorized target`, `wait until
 * api`, `switch to new tab`), and the one hyphenated string in the grammar (`headers-only`) is a
 * quoted *value*, never a lexeme. So the scan is two bare words, which is the language's own
 * convention rather than a compromise, and the documentation id keeps the hyphen because a spec id
 * is a doc anchor and not something anybody types.
 */
const SCAN_KIND_PHRASES = ['a11y', 'security', 'authorization', 'input handling'] as const;
/** The scan phrase → `MatcherName` mapping, as a total record rather than a ternary chain. The chain
 * was fine for two words and would have made a third one silently parse as the second — a `Record`
 * over the same `as const` tuple makes adding a phrase to `SCAN_KIND_PHRASES` a type error until it
 * is given a matcher, which is where a completeness rule belongs. */
const SCAN_MATCHER_NAMES: Readonly<Record<(typeof SCAN_KIND_PHRASES)[number], MatcherName>> = {
  a11y: 'hasNoA11yViolations',
  security: 'hasNoSecurityViolations',
  authorization: 'hasNoAuthzViolations',
  'input handling': 'hasNoInputHandlingViolations',
};
/** The first word of every scan phrase — the candidate pool a misspelling is suggested against, and
 * the only thing the parser can match before it knows which phrase it is reading. */
const SCAN_FIRST_WORDS: readonly string[] = [...new Set(SCAN_KIND_PHRASES.map((p) => p.split(' ')[0]!))];
/** As `MATCHER_VOCABULARY_HELP`, for the `<scan> violations` construct (review finding A3-15) —
 * every one of its failure modes used to be a bare `expectKw`, naming one keyword of three and never
 * the severity vocabulary sitting in the constant directly above. Built from the constant so a fifth
 * scan cannot leave this message naming three of four. */
const SCAN_MATCHER_HELP =
  `expected ${SCAN_KIND_PHRASES.map((p) => `\`${p} violations\``).join(', ')}, optionally ` +
  `with a severity floor in front (${SEVERITY_FLOOR_WORDS.join('/')}) — e.g. \`has no serious a11y violations\``;

/**
 * The state word hiding behind a negation prefix (`invisible` → `visible`), or `undefined`.
 *
 * Every negated state word a user is likeliest to reach for lands, by edit distance, on its own
 * positive twin — so `expect button "Go" is invisible` answered "did you mean `visible`?", and a
 * user who took the suggestion shipped a green test asserting the exact **opposite** of what they
 * wrote (M61, review finding A3-02, the sharp one in this cluster). Edit distance cannot see
 * meaning; a morpheme it can. Detecting the prefix lets the parser say what is actually true —
 * write `not visible` — instead of letting a spelling metric answer a question about negation.
 */
function negatedStateWord(word: string): string | undefined {
  const w = word.toLowerCase();
  for (const prefix of NEGATION_PREFIXES) {
    const rest = w.startsWith(prefix) ? w.slice(prefix.length) : undefined;
    if (rest !== undefined && (STATE_WORDS as readonly string[]).includes(rest)) return rest;
  }
  return undefined;
}
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] as const;
/** Exported since `M137a` (D444) so config completion offers *this* list rather than a fourth copy
 * of it. `B5-09` is what a fourth copy becomes, and this milestone is repairing the third instance. */
export const CONFIG_KEYS = ['header', 'timeout', 'workers', 'report', 'web', 'api', 'insecure', 'cert', 'key', 'allow', 'authorized', 'evidence', 'redact', 'viewport', 'log'] as const;
/** Which block a config key belongs in — the parser's view of the rule the checker enforces as
 * `TF025` (checker.ts `DEFAULTS_ONLY`/`ENV_ONLY`, keyed there on AST node type rather than on the
 * word). The parser needs it only to keep a *suggestion* from naming a key the checker will then
 * turn around and reject (M84, C11/`A2-07b`). Two statements of one rule is a drift risk, so
 * `teaching.test.ts`'s round-trip guard walks every key in both blocks and fails if what a hint
 * claims about placement is not what the checker then does. */
const DEFAULTS_ONLY_KEYS: readonly string[] = ['workers', 'report', 'viewport'];
const ENV_ONLY_KEYS: readonly string[] = ['web', 'api'];
export type ConfigBlockKind = 'defaults' | 'env';
/** Exported alongside `CONFIG_KEYS` (`M137a`, D444) so completion filters by the same predicate the
 * did-you-mean hint uses. `A2-07b` is the row that made this rule load-bearing: a tool that offers
 * a key and then refuses it is worse than one that offers nothing, and a candidate list is the
 * loudest possible place to make that mistake. */
export function configKeyAllowedIn(key: string, block: ConfigBlockKind): boolean {
  return block === 'defaults' ? !ENV_ONLY_KEYS.includes(key) : !DEFAULTS_ONLY_KEYS.includes(key);
}
/** Where a key that is barred from the current block does belong, phrased to drop into a hint. */
function configKeyHome(key: string): string {
  return ENV_ONLY_KEYS.includes(key) ? 'an `env` block' : 'the `defaults` block';
}
/** The `probe …` sub-clauses an `authorized target` accepts (M130b, D330; M134a, D372), and the
 * `AuthorizedTargetDecl` field each one sets. A total record over the same `as const` tuple, for
 * `SCAN_MATCHER_NAMES`' reason: a fourth word is then a type error until somebody says what it
 * grants, rather than a word the parser accepts and nothing reads. */
export const PROBE_SUB_CLAUSES = ['mutating', 'oversized', 'traversal', 'ciphers'] as const;
const PROBE_SUB_CLAUSE_FIELDS: Readonly<
  Record<(typeof PROBE_SUB_CLAUSES)[number], 'probeMutating' | 'probeOversized' | 'probeTraversal' | 'probeCiphers'>
> = {
  mutating: 'probeMutating',
  oversized: 'probeOversized',
  traversal: 'probeTraversal',
  ciphers: 'probeCiphers',
};
/** The `AuthorizedTargetDecl` fields the sub-clauses set, as one name. Written once so the parser's
 * default state, its return type and the decl cannot disagree — `M137g` found them disagreeing in
 * three places at once when it added the fourth clause. */
export type ProbeSubClauseField = (typeof PROBE_SUB_CLAUSE_FIELDS)[(typeof PROBE_SUB_CLAUSES)[number]];
const PROBE_SUB_CLAUSE_HELP = `an \`authorized target\` takes ${PROBE_SUB_CLAUSES.map((w) => `\`probe ${w}\``).join(', ')}, each on its own indented line`;
/**
 * What a user writes after `evidence` (§13, PLAN decision 101c) — **bare keywords as of `M147b`**
 * (`A2-14`, `D623`), and two words rather than a hyphen (`D628`).
 *
 * The level was a quoted string precisely because of the hyphen: SPEC §13 said so outright —
 * *"`evidence "headers-only"` — a string literal, since the lexer has no hyphen in identifiers"*.
 * That reason was real and its conclusion is the one the language has since overruled elsewhere.
 * `M134a`/`D366` met the identical problem naming the fourth scan `input-handling`, measured that
 * this language has **zero** hyphenated bare keywords, and answered it with two space-separated
 * words. `evidence headers only` is that same answer, so the hyphen buys a quoted spelling for one
 * value of one directive and a rule with an exception in it.
 *
 * The **AST value keeps the hyphen** (`EvidenceLevel` is `'headers-only'`), because it is an
 * internal enum reaching `report.html`, `ResolvedConfig` and `--evidence LEVEL`, none of which is
 * lexed by this lexer. What a user types and what the tree carries are allowed to differ; the
 * record below is where they are reconciled, exactly as `SCAN_MATCHER_NAMES` does it.
 */
const EVIDENCE_PHRASES = ['full', 'headers only', 'none'] as const;
/** Phrase → the `EvidenceLevel` the tree carries. A total record over the tuple, so a fourth level
 * cannot be added to the vocabulary without being given a value. */
const EVIDENCE_LEVEL_OF: Readonly<Record<(typeof EVIDENCE_PHRASES)[number], EvidenceLevel>> = {
  full: 'full',
  'headers only': 'headers-only',
  none: 'none',
};
/** `log [<level>] "…" [to <destination>]` (M27, PLAN_LOG.md) — bare-keyword enums, same shape as
 * `SEVERITY_FLOOR_WORDS`/`LOCATOR_KEYWORDS`. As of `M147b` the config dialect reads them the same
 * way: `log level warn` and `log destination console`, not `log level "warn"`. One vocabulary
 * spelled one way — before `A2-14` closed, `LOG_LEVELS` was doing both at once, `log warn "hi"`
 * bare in the statement dialect against `log level "warn"` quoted in the config dialect. */
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
const LOG_DESTINATIONS = ['console', 'html', 'both'] as const;
const RETRY_AFTER_HEADERS = ['Retry-After'] as const;
const TIMEOUT_TARGETS = ['step', 'expect', 'wait'] as const;
export const DURATION_UNITS = ['ms', 's', 'm'] as const;
export const DATE_OFFSET_UNITS = ['seconds', 'minutes', 'hours', 'days', 'weeks'] as const;

/** **One time vocabulary** (`M147d`, `A3-13`, D638). Every unit the language has, abbreviations and
 * words alike, in milliseconds — and the single table both duration positions and date arithmetic
 * resolve through.
 *
 * The two arrays above stay because they still name a real distinction, but it is a distinction of
 * *spelling*, not of meaning: **an abbreviation must touch its number, a word need not.** That rule
 * was already true in the two positions that accepted both spellings (`today + 3s` parses, `today +
 * 3 s` is `TF023: a duration unit must touch its number`, `today + 3 seconds` and `today +
 * 3seconds` both parse); it simply had nowhere to be written down, because the third position —
 * `parseDuration`, which `pause`/`timeout`/`for`/`over`/`within` all use — accepted no word at all.
 *
 * What that cost was measured before this table existed, and it was more than `pause 2 seconds`
 * being refused:
 *
 *  - `expect duration is less than 2 seconds` reached `no problems found` and then failed every run
 *    with ``\`is less than\` expects a number, got object`` — the value path built a
 *    `DateOffsetLit`, which no numeric matcher had ever been taught to read.
 *  - `random date between today and today - 10s` escaped `TF054`'s reversed-bounds rule entirely,
 *    while `today - 10 seconds` was caught. Same program, two spellings, one judged.
 *
 * So the vocabulary split was not an ergonomic complaint. It halved the reach of a checker rule and
 * left a statically decidable type error to be discovered at run time.
 *
 * There is no `h` and no `milliseconds` on purpose. The union makes the spellings the language
 * *has* work in every position; inventing the two it lacks is a separate decision with no row
 * behind it, and `B5-10` is the record of what a fourth unit nobody implemented costs. */
export const TIME_UNIT_MS: Readonly<Record<string, number>> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 7 * 86_400_000,
};

/** The `expected …` half of every unknown-unit hint, so the eight spellings are listed once. */
const TIME_UNITS_HELP = 'expected `ms`, `s`, `m`, `seconds`, `minutes`, `hours`, `days`, or `weeks`';

type DurationUnit = (typeof DURATION_UNITS)[number];

/** Spellings that can only have been meant as one of tflw's three time units, mapped to the one
 * they meant (M98c, `A1-07`, D160).
 *
 * Enumerated rather than inferred, and that is the whole design. The alternative — treat *any* word
 * adjacent to a number as an attempted unit — would claim `1e3` and `0xff` are durations, and the
 * lexer already teaches those as numeric notations (`TF001`, M98b/D158): a second, wrong explanation
 * underneath a correct one is worse than none. Anything outside this table keeps the generic
 * "unexpected token", which is the right answer there.
 *
 * Every entry can name its replacement, which is what makes the diagnostic worth having: `2sec` is
 * told to write `2s`, not merely that `sec` is unknown. Case is handled separately — `250MS`
 * lower-cases into a *real* unit, so it is a spelling of `ms` and not a member of this table.
 *
 * The hour/day/week family is deliberately absent. tflw has no unit above `m`, and `2h` after a
 * number is at least as likely to be a reach for `today + 2 hours` (`DATE_OFFSET_UNITS`, checked
 * first) as for a duration — a confident "write `2m`" would be advice in the wrong construction. */
export const UNIT_SPELLINGS: Record<string, DurationUnit> = {
  msec: 'ms',
  msecs: 'ms',
  milli: 'ms',
  millis: 'ms',
  millisec: 'ms',
  millisecs: 'ms',
  millisecond: 'ms',
  sec: 's',
  secs: 's',
  second: 's',
  min: 'm',
  mins: 'm',
  minute: 'm',
};

/** The unit a mis-cased or mis-spelled unit word was reaching for, or `null` if it was not reaching
 * for one at all. `MS` → `ms` (case), `sec` → `s` (spelling), `xyz` → `null`. */
function nearestDurationUnit(word: string): DurationUnit | null {
  const lower = word.toLowerCase();
  if ((DURATION_UNITS as readonly string[]).includes(lower)) return lower as DurationUnit;
  return UNIT_SPELLINGS[lower] ?? null;
}
const QUANTIFIERS = ['any', 'all'] as const;

/**
 * Every closed vocabulary a `did you mean` in this file draws from, keyed by the position it
 * belongs to. Exported solely for `suggestions.test.ts`'s round-trip guard (M61): **whatever the
 * parser offers as a suggestion, typing it must not produce a fresh error where it was offered.**
 *
 * That property is what `A3-20` broke — `not` sat in the matcher pool, so `expect status nut 200`
 * answered "did you mean `not`?", and `expect status not 200` is a fresh error. It is not a
 * property any single fixture can hold, because the bug is a *word in a list*, not a code path: the
 * guard has to walk the whole list, and it has to fail when a word is added to one of these without
 * a worked example proving it can complete a statement. Hence the exported map rather than a
 * hand-copied one in the test, which would drift the moment the two disagreed — precisely the way
 * `M81`'s round-trip stopped one layer short of the checker and let `B5-01` through.
 */
export const SUGGESTION_VOCABULARIES = {
  matcher: MATCHER_VOCABULARY,
  locator: LOCATOR_KEYWORDS,
  logLevel: LOG_LEVELS,
  logDestination: LOG_DESTINATIONS,
  severityFloor: SEVERITY_FLOOR_WORDS,
  // Phrases as of `M134a`, not words. What the parser *offers* is always a whole phrase — a bare
  // `input` is not something a user can write, so a hint that offered it would send the reader to
  // the next error rather than past it — and this guard's property is about what is offered.
  scanKind: SCAN_KIND_PHRASES,
  statement: SUGGESTABLE_STATEMENT_KEYWORDS,
} as const satisfies Record<string, readonly string[]>;

class Parser {
  private pos = 0;
  private readonly diagnostics: Diagnostic[] = [];
  /** Token index the last diagnostic was reported at, for the panic-mode guard in `error()`. */
  private lastErrorPos = -1;
  /** Set only by `runCompletion()`. When on, the six guarded production entry points below check
   * `atCompletionPoint()` before doing their normal work and, on a hit, record `completionResult`
   * and return `null` instead of erroring — no behavior change to `diagnostics`/the returned
   * `program` otherwise (ordinary `parse()`/`parseConfig()` never sets this). */
  private completionMode = false;
  private completionResult: CompletionContext | null = null;

  constructor(private readonly tokens: readonly Token[]) {}

  /** Parse `tokens` (already truncated at the cursor by `completion.ts`) purely to discover which
   * grammar production the cursor sits in. Reuses `parse()` itself — panic-mode recovery carries
   * parsing forward past anything already resolved, so only the one production actually active at
   * the truncated end of input ever reaches its `atCompletionPoint()` guard (PLAN_M13_LSP.md
   * decision 17.9/architecture: full reparse, no incremental state). */
  runCompletion(): CompletionContext | null {
    this.completionMode = true;
    this.parse();
    return this.completionResult;
  }

  /** The same trick against the other dialect (`M137a`, D444). A `tflw.config` buffer has never had
   * completion, and the reason it could not simply share `runCompletion()` is one line: that method
   * calls `this.parse()`, so a config file was parsed as a test file, produced `TF021`-shaped
   * nonsense, and reached none of the guards below. Two entry points, mirroring `parse()`/
   * `parseConfig()` and `parseSource()`/`parseConfigSource()` — the split this codebase has always
   * made, and the one `M136b` had to reach for again when a grammar needed a language to bind to. */
  runConfigCompletion(): CompletionContext | null {
    this.completionMode = true;
    this.parseConfig();
    return this.completionResult;
  }

  /** True when the parser has nothing left to consume (`eof`) or is sitting on the last
   * identifier of the truncated source — i.e. the user has either just typed a delimiter
   * (space/newline) or is mid-word on the token the cursor sits in. The lexer always closes out
   * whatever's on the last physical line as if it were complete (a synthetic trailing `newline`,
   * then a `dedent` per still-open indentation level, then `eof` — lexer.ts's `lex()`), so "the
   * last real token" isn't literally followed by `eof`; skip over that synthetic closing tail to
   * find out. `completionPrefix()` below extracts what's typed so far. */
  private atCompletionPoint(): boolean {
    // First answer wins (`M137a`, D444). A guard that fires does not stop the parse — it returns
    // `null`/breaks and its caller recovers — so the cursor's token can be offered to a *second*
    // guard further out, which then overwrites the more specific answer with a less specific one.
    // Nothing exercised that before: the test dialect's guards sit at productions whose enclosing
    // loops run out of input immediately afterwards. The config dialect's do not — a `probe` line
    // under `authorized target` is inside `parseConfigEntries`' loop, so the sub-clause answer was
    // being replaced by the config-key answer one frame up, and every `probe …` completion came
    // back as the list of `defaults` keys. Innermost is the production the cursor is actually in.
    if (this.completionResult) return false;
    if (this.atEof()) return true;
    if (!this.check('ident')) return false;
    for (let k = 1; ; k++) {
      const t = this.peek(k);
      if (t.type === 'eof') return true;
      if (t.type !== 'newline' && t.type !== 'dedent') return false;
    }
  }

  private completionPrefix(): string {
    return this.check('ident') ? this.peek().value : '';
  }

  parse(): ParseResult {
    const tests: TestDecl[] = [];
    const crawls: CrawlDecl[] = [];
    const imports: ImportDecl[] = [];
    const uses: UseDecl[] = [];
    const actions: ActionDecl[] = [];
    const hooks: HookDecl[] = [];
    const startPos = this.peek().span.start;
    this.skipNewlines();
    while (!this.atEof()) {
      // A `dedent` at the top level is never a mistake the user made — it is the tail of a block
      // whose header already failed, and the file has no enclosing block for it to close. Reporting
      // it produced the worst message the parser could emit (`A2-03`): a caret on a line beginning
      // with `test`, saying a `test` was expected.
      if (this.check('dedent')) {
        this.advance();
        this.skipNewlines();
        continue;
      }
      const before = this.pos;
      const tok = this.peek();
      if (this.check('tag') || this.isKw(tok, 'with') || this.isKw(tok, 'test') || this.isKw(tok, 'crawl')) {
        // A tag line is shared prefix: `@vuln` can introduce either a `test` or a `crawl` (D450), and
        // which one is only knowable past the tags. So the tag-led branch peeks rather than committing,
        // and `tagsContinue()` — which decides whether a *newline* after a tag is a continuation —
        // has to know about `crawl` too, or the loop stops at the newline and `expectKw('test')`
        // reports "expected a test name" on the `crawl` line.
        if (this.crawlAhead()) {
          const crawl = this.parseCrawl();
          if (crawl) crawls.push(crawl);
          else this.recoverTopLevel();
        } else {
          const test = this.parseTest();
          if (test) tests.push(test);
          else this.recoverTopLevel();
        }
      } else if (this.isKw(tok, 'import')) {
        const imp = this.parseImportDecl();
        if (imp) imports.push(imp);
        else this.recoverTopLevel();
      } else if (this.isKw(tok, 'use')) {
        const u = this.parseUseDecl();
        if (u) uses.push(u);
        else this.recoverTopLevel();
      } else if (this.isKw(tok, 'action')) {
        const a = this.parseActionDecl();
        if (a) actions.push(a);
        else this.recoverTopLevel();
      } else if (this.isKw(tok, 'before') || this.isKw(tok, 'after')) {
        const h = this.parseHookDecl(tok.value as 'before' | 'after');
        if (h) hooks.push(h);
        else this.recoverTopLevel();
      } else if (this.isKw(tok, 'scenario')) {
        // D103 migration diagnostic: `scenario` was removed in M50 (D93) — a workload-bearing
        // block is now just `test "…"`, kind inferred from the workload clause it already contains.
        // What this refusal says, and why the payload is a total rewrite rather than an
        // approximation, is written once beside its row in `REFUSED_WORDS`.
        this.refuse('scenario', tok.span);
        this.recoverTopLevel();
      } else {
        // `scenario` is answered by its own branch above, so a row still matching here is one refused
        // *inside* this broader error — contributing a hint and no removal of its own. Reading the
        // row rather than restating it is the point of `M142-01`: this line was the third mechanism.
        const refused = REFUSED_SPELLINGS.find((w) => {
          const row = REFUSED_WORDS[w];
          return row.position === 'top-level' && !row.diagnostic && this.isKw(tok, w);
        });
        const hint = refused
          ? REFUSED_WORDS[refused].hint
          : 'only `test`, `crawl`, `action`, `import`, `use`, `before`, or `after` declarations are allowed at the top level';
        this.error(Codes.UNEXPECTED_TOP_LEVEL, `expected a \`test\`, \`crawl\`, \`action\`, \`import\`, \`use\`, \`before\`, or \`after\`, found ${describeToken(tok)}`, tok.span, hint);
        // The offending token may itself be the `indent` opening an orphaned body, in which case
        // `synchronize()` would step *into* the block and report it line by line all over again.
        if (this.check('indent')) this.skipBlock();
        else this.recoverTopLevel();
      }
      // `synchronize()` deliberately won't cross a `dedent` (nested blocks consume their own), so
      // stray recovery landing exactly on one here — nothing left to close it — would otherwise
      // spin forever. Guarantee progress, same pattern as parseBlock/parseConfigEntries.
      if (this.pos === before) this.advance();
      this.skipNewlines();
    }
    const program: Program = {
      type: 'Program',
      imports,
      uses,
      actions,
      hooks,
      tests,
      // Spread rather than assigned, for the same reason `recoveredSpans` is below: a
      // program that declares no crawl must serialise exactly as it always has.
      ...(crawls.length > 0 ? { crawls } : {}),
      // Spread rather than assigned: see `Program.recoveredSpans` — a healthy program's AST must
      // stay byte-identical, and every parser golden file is the assertion that it does.
      ...(this.recoveredSpans.length > 0 ? { recoveredSpans: this.recoveredSpans } : {}),
      span: this.spanFrom(startPos),
    };
    return { program, diagnostics: this.diagnostics };
  }

  /** Top-level recovery: discard the failed header line *and the indented body it was meant to
   * introduce* (M83, C11/`A2-03`).
   *
   * Without the second half, `parse()`'s loop re-feeds an orphaned body to the top-level dispatcher
   * one line at a time, and every one of those lines is reported as a declaration that isn't allowed
   * at the top level. A single missing `(` on an `action` header cost seven diagnostics — six of
   * them noise, two of those at the same position — and the `scenario` migration path, the one place
   * built to hold a migrating user's hand, buried its own carefully-written D103 message under six
   * wrong ones. `parseConfig` has done `synchronize(); skipBlock();` since it was written; the top
   * level never got it. */
  private recoverTopLevel(): void {
    this.synchronize();
    this.skipBlock();
  }

  // -- hooks (P#10, P#19) ------------------------------------------------------

  private parseHookDecl(when: 'before' | 'after'): HookDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `before` or `after`
    let scope: 'file' | 'each' = 'each';
    if (this.isKw(this.peek(), 'file')) {
      this.advance();
      scope = 'file';
    }
    this.endLine();
    const body = this.parseBlock(scope === 'file' ? `${when} file` : when);
    return { type: 'HookDecl', when, scope, body, span: this.spanFrom(start) };
  }

  // -- import / use / action (P#11, P#17) -------------------------------------

  private parseImportDecl(): ImportDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `import`
    const path = this.expectString('an import path string, e.g. `import "./shared/orders.tflw"`');
    if (!path) return null;
    this.endLine();
    return { type: 'ImportDecl', path, span: this.spanFrom(start) };
  }

  private parseUseDecl(): UseDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `use`
    const path = this.expectString('a helper module path string, e.g. `use "./helpers/sign.ts"`');
    if (!path) return null;
    this.endLine();
    return { type: 'UseDecl', path, span: this.spanFrom(start) };
  }

  private parseActionDecl(): ActionDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `action`
    const nameParts: string[] = [];
    while (this.check('ident')) {
      nameParts.push(this.advance().value);
      if (this.check('lparen')) break;
    }
    if (nameParts.length === 0) {
      this.error(Codes.UNEXPECTED_TOKEN, `expected an action name after \`action\`, found ${describeToken(this.peek())}`, this.peek().span);
      return null;
    }
    if (!this.expect('lparen', '`(` after the action name')) return null;
    const params: string[] = [];
    if (!this.check('rparen')) {
      for (;;) {
        const p = this.expect('ident', 'a parameter name');
        if (!p) return null;
        params.push(p.value);
        if (this.check('comma')) {
          this.advance();
          if (this.check('rparen')) break; // trailing comma — D637
          continue;
        }
        break;
      }
    }
    if (!this.expect('rparen', '`)` to close the parameter list')) return null;
    this.endLine();
    const body = this.parseBlock('action');
    return { type: 'ActionDecl', name: nameParts.join(' '), params, body, span: this.spanFrom(start) };
  }

  private parseGive(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `give`
    const value = this.parseValue();
    if (!value) return null;
    this.endLine();
    const stmt: GiveStmt = { type: 'GiveStmt', value, span: this.spanFrom(start) };
    return stmt;
  }

  // -- load testing: workload/threshold/think (M29, M50, D16-D19/D24a/D26/D93-D96) -------------

  /** A `test` body: an indented block mixing zero-or-one `ramp to …` workload line, zero or more
   * `threshold …` lines, an optional bare `cleanup` line (D26), and ordinary steps — in any order
   * (M50: this used to be `parseScenarioDecl`'s own body loop, since only `scenario` recognized
   * these clauses; now every `test` body does, and `workload === null` at the end is what makes
   * it an ordinary functional test rather than a load test, D94). Checker-enforced (D96): a
   * non-null workload can't coexist with `retry`/`with each` (`parseTest` reports those before
   * calling this). */
  private parseTestBody(context: string): { workload: Workload | null; thresholds: ThresholdDecl[]; cleanup: boolean; body: Step[] } {
    if (!this.check('indent')) {
      this.error(Codes.EMPTY_BLOCK, `this \`${context}\` has no steps`, this.peek().span, `indent at least one step under the \`${context}\` line`);
      return { workload: null, thresholds: [], cleanup: false, body: [] };
    }
    this.advance(); // indent
    let workload: Workload | null = null;
    let cleanup = false;
    const thresholds: ThresholdDecl[] = [];
    const body: Step[] = [];
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      const tok = this.peek();
      const maybeWorkload = this.tryParseWorkloadLine(tok);
      if (maybeWorkload !== undefined) {
        if (maybeWorkload) {
          if (workload) {
            this.error(
              Codes.LOAD_INVALID,
              'a `test` has at most one workload line (`ramp`/`hold`/`step`/`spike`/`run`)',
              maybeWorkload.span,
              `already declared at ${workload.span.start.line}:${workload.span.start.column}`,
            );
          } else {
            workload = maybeWorkload;
          }
        } else {
          this.recover(before);
        }
      } else if (this.isKw(tok, 'threshold')) {
        const t = this.parseThresholdDecl();
        if (t) thresholds.push(t);
        else this.recover(before);
      } else if (this.isKw(tok, 'cleanup')) {
        this.advance();
        this.endLine();
        cleanup = true;
      } else {
        const step = this.parseStep();
        if (step) body.push(step);
        else {
          const gap = this.malformedStepAt(before);
          if (gap) body.push(gap);
          this.recover(before);
        }
      }
      if (this.pos === before) this.advance(); // guarantee progress
    }
    if (this.check('dedent')) this.advance();
    return { workload, thresholds, cleanup, body };
  }

  /** `ramp to N users over <dur>` (closed, D17) / `ramp to N rps over <dur>` (open, D17). */
  private parseWorkload(): Workload | null {
    const start = this.peek().span.start;
    this.advance(); // `ramp`
    if (!this.expectKw('to')) return null;
    const num = this.expect('number', 'a target number, e.g. `ramp to 50 users over 30s`');
    if (!num) return null;
    const n = Number(num.value);
    if (n <= 0) {
      this.error(Codes.LOAD_INVALID, `a workload target must be positive, found ${num.value}`, num.span);
      return null;
    }
    const unitTok = this.peek();
    let kind: 'users' | 'rps';
    if (this.isKw(unitTok, 'users')) {
      this.advance();
      kind = 'users';
    } else if (this.isKw(unitTok, 'rps')) {
      this.advance();
      kind = 'rps';
    } else {
      this.error(Codes.UNEXPECTED_TOKEN, `expected \`users\` or \`rps\`, found ${describeToken(unitTok)}`, unitTok.span);
      return null;
    }
    if (!this.expectKw('over')) return null;
    const overMs = this.parseDuration();
    if (overMs === null) return null;
    this.endLine();
    const span = this.spanFrom(start);
    return kind === 'users' ? { type: 'RampUsersWorkload', users: n, overMs, span } : { type: 'RampRpsWorkload', rps: n, overMs, span };
  }

  // -- load testing: the 4 new D97 workload kinds (Phase 1b, PLAN_UNIFIED_TEST_WORKLOAD.md) -----

  /** Dispatches a `test` body line that might start a workload clause. Returns `undefined` when
   * `tok` doesn't start one of the 5 workload keywords (so the caller falls through to threshold/
   * cleanup/step parsing); returns `null` on a parse error inside a recognized keyword (caller
   * synchronizes); otherwise returns the parsed `Workload`. */
  private tryParseWorkloadLine(tok: Token): Workload | null | undefined {
    const isWorkloadKw =
      this.isKw(tok, 'ramp') || this.isKw(tok, 'hold') || this.isKw(tok, 'step') || this.isKw(tok, 'spike') || this.isKw(tok, 'run');
    // FS-06: a leading keyword never reserves that word for a user action name — disambiguation is
    // always by what follows. Before this, `run checkout("1")` failed with "expected an iteration
    // count" (A2-02) purely because `run` led the line, while `let x = run checkout("1")` in value
    // position called cleanly, and `action run checkout(id)` declared cleanly.
    if (!isWorkloadKw || this.startsActionCall()) return undefined;
    if (this.isKw(tok, 'ramp')) return this.parseWorkload();
    if (this.isKw(tok, 'hold')) return this.parseHoldWorkload();
    if (this.isKw(tok, 'step')) return this.parseStepOrSpikeWorkload('step');
    if (this.isKw(tok, 'spike')) return this.parseStepOrSpikeWorkload('spike');
    return this.parseIterationsWorkload();
  }

  /** Does the line starting at the *current* token (a workload keyword) actually continue as a call
   * to a user action — `run checkout("1")`, `step users(3)` — rather than a workload clause?
   *
   * Amended at implementation time (B1, 2026-08-04). `FS-06` specifies "one token of lookahead",
   * which is enough for `run`/`hold`, whose workload forms take a *number* next and so can never
   * collide with an ident action name. It is not enough for `ramp to …`, `step users …` and
   * `spike rps …`, whose second token is an ident: under a strict one-token rule an action named
   * `ramp to` or `step users` would still be uncallable, and `FS-06`'s SPEC promise is written
   * without exceptions. So the discriminator is the same ident-run-then-`(` scan `parseIdentOrCall`
   * already uses — still "disambiguation by what follows", just not capped at one token. Action
   * names are multi-word and calls always parenthesise (P#11, P#17), so the scan is exact. */
  private startsActionCall(): boolean {
    let k = 1;
    while (this.peek(k).type === 'ident') k++;
    return this.peek(k).type === 'lparen';
  }

  /** `hold N users for <dur>` (closed) / `hold N rps for <dur>` (open) — D97: a constant target
   * for the whole duration, no ramp-up. */
  private parseHoldWorkload(): Workload | null {
    const start = this.peek().span.start;
    this.advance(); // `hold`
    const num = this.expect('number', 'a target number, e.g. `hold 50 users for 30s`');
    if (!num) return null;
    const n = Number(num.value);
    if (n <= 0) {
      this.error(Codes.LOAD_INVALID, `a workload target must be positive, found ${num.value}`, num.span);
      return null;
    }
    const unitTok = this.peek();
    let kind: 'users' | 'rps';
    if (this.isKw(unitTok, 'users')) {
      this.advance();
      kind = 'users';
    } else if (this.isKw(unitTok, 'rps')) {
      this.advance();
      kind = 'rps';
    } else {
      this.error(Codes.UNEXPECTED_TOKEN, `expected \`users\` or \`rps\`, found ${describeToken(unitTok)}`, unitTok.span);
      return null;
    }
    if (!this.expectKw('for')) return null;
    const forMs = this.parseDuration();
    if (forMs === null) return null;
    this.endLine();
    const span = this.spanFrom(start);
    return kind === 'users' ? { type: 'HoldUsersWorkload', users: n, forMs, span } : { type: 'HoldRpsWorkload', rps: n, forMs, span };
  }

  /** `step users` / `step rps` / `spike users` / `spike rps` (D97) — a keyword+unit header line
   * followed by an indented block of stage lines. */
  private parseStepOrSpikeWorkload(headKind: 'step' | 'spike'): Workload | null {
    const start = this.peek().span.start;
    this.advance(); // `step`/`spike`
    const unitTok = this.peek();
    let unit: 'users' | 'rps';
    if (this.isKw(unitTok, 'users')) {
      this.advance();
      unit = 'users';
    } else if (this.isKw(unitTok, 'rps')) {
      this.advance();
      unit = 'rps';
    } else {
      this.error(Codes.UNEXPECTED_TOKEN, `expected \`users\` or \`rps\`, found ${describeToken(unitTok)}`, unitTok.span);
      return null;
    }
    // Captured before `endLine()` so a diagnostic about the block as a whole can point at the line
    // that opened it, rather than wherever the cursor happens to be once the block is consumed.
    const headerSpan: Span = { start, end: this.previous().span.end };
    this.endLine();
    const stages = this.parseStageBlock(headKind, unit, headerSpan);
    if (!stages) return null;
    const span = this.spanFrom(start);
    if (headKind === 'step') {
      return unit === 'users' ? { type: 'StepUsersWorkload', stages, span } : { type: 'StepRpsWorkload', stages, span };
    }
    return unit === 'users' ? { type: 'SpikeUsersWorkload', stages, span } : { type: 'SpikeRpsWorkload', stages, span };
  }

  /** The indented stage block under a `step`/`spike` header. */
  private parseStageBlock(headKind: 'step' | 'spike', unit: 'users' | 'rps', headerSpan: Span): Stage[] | null {
    if (!this.check('indent')) {
      // `headerSpan`, not `peek()`: by here the header's newline is consumed, so the cursor is on
      // the *next* line and the caret would land on a step that has nothing wrong with it (`A2-04`).
      this.error(
        Codes.EMPTY_BLOCK,
        `this \`${headKind} ${unit}\` has no stages`,
        headerSpan,
        `indent at least one stage line under \`${headKind} ${unit}\``,
      );
      return null;
    }
    this.advance(); // indent
    const stages: Stage[] = [];
    const diagnosticsBefore = this.diagnostics.length;
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      const stage = headKind === 'step' ? this.parseStepStage() : this.parseSpikeStage();
      if (stage) stages.push(stage);
      else this.synchronize();
      if (this.pos === before) this.advance(); // guarantee progress
    }
    if (this.check('dedent')) this.advance();
    if (stages.length === 0) {
      // Only news if nothing *inside* the block already failed (M83, C11/`A2-04`, `A2-10`). A single
      // mistyped preposition — `to 50 over 10s` in a `step` block, where the spelling is `for` —
      // used to cost this summary as well, with its caret on the line *after* the block, so the one
      // typo read as two unrelated problems in two unrelated places.
      if (this.diagnostics.length === diagnosticsBefore) {
        this.error(Codes.LOAD_INVALID, `a \`${headKind} ${unit}\` workload needs at least one stage line`, headerSpan);
      }
      return null;
    }
    return stages;
  }

  /** `to N for <dur>` — a `step` stage: an instant jump to a new level, held for `<dur>`. */
  private parseStepStage(): Stage | null {
    const start = this.peek().span.start;
    // The cross-hints (M84, C11/`A2-10`). `step` and `spike` spell the same two shapes differently,
    // and a mismatch is not a typo — it is someone who has the *other* block's grammar in mind. The
    // bare ``expected `for`, found `over` `` restates the slot and leaves them to guess whether
    // `over` is misspelled, unsupported, or in the wrong place. Naming the distinction the two
    // prepositions carry — a jump versus a ramp — answers that in one line, and points at the block
    // that does support what they were reaching for.
    if (!this.expectKw('to', this.isKw(this.peek(), 'hold') ? '`hold` is a `spike` stage — a `step` stage is written `to N for <duration>`' : undefined)) return null;
    const num = this.expect('number', 'a target number, e.g. `to 50 for 10s`');
    if (!num) return null;
    const n = Number(num.value);
    if (n <= 0) {
      this.error(Codes.LOAD_INVALID, `a workload target must be positive, found ${num.value}`, num.span);
      return null;
    }
    if (
      !this.expectKw(
        'for',
        this.isKw(this.peek(), 'over')
          ? '`over` ramps to the new level; a `step` stage always jumps to it — use `for`, or write this stage in a `spike` block'
          : undefined,
      )
    ) {
      return null;
    }
    const durationMs = this.parseDuration();
    if (durationMs === null) return null;
    this.endLine();
    return { type: 'Stage', mode: 'jump', target: n, durationMs, span: this.spanFrom(start) };
  }

  /** `hold N for <dur>` (flat) / `to N over <dur>` (ramped) — a `spike` stage. */
  private parseSpikeStage(): Stage | null {
    const start = this.peek().span.start;
    const tok = this.peek();
    if (this.isKw(tok, 'hold')) {
      this.advance();
      const num = this.expect('number', 'a target number, e.g. `hold 50 for 10s`');
      if (!num) return null;
      const n = Number(num.value);
      if (n <= 0) {
        this.error(Codes.LOAD_INVALID, `a workload target must be positive, found ${num.value}`, num.span);
        return null;
      }
      if (!this.expectKw('for')) return null;
      const durationMs = this.parseDuration();
      if (durationMs === null) return null;
      this.endLine();
      return { type: 'Stage', mode: 'jump', target: n, durationMs, span: this.spanFrom(start) };
    }
    if (this.isKw(tok, 'to')) {
      this.advance();
      const num = this.expect('number', 'a target number, e.g. `to 200 over 10s`');
      if (!num) return null;
      const n = Number(num.value);
      if (n <= 0) {
        this.error(Codes.LOAD_INVALID, `a workload target must be positive, found ${num.value}`, num.span);
        return null;
      }
      if (
        !this.expectKw(
          'over',
          this.isKw(this.peek(), 'for')
            ? '`to N` ramps in a `spike`, and a ramp takes `over` — use `over`, or write `hold N for <duration>` to jump straight to N'
            : undefined,
        )
      ) {
        return null;
      }
      const durationMs = this.parseDuration();
      if (durationMs === null) return null;
      this.endLine();
      return { type: 'Stage', mode: 'ramp', target: n, durationMs, span: this.spanFrom(start) };
    }
    this.error(
      Codes.UNEXPECTED_TOKEN,
      `expected \`hold\` or \`to\`, found ${describeToken(tok)}`,
      tok.span,
      'a `spike` stage is either `hold N for <dur>` or `to N over <dur>`',
    );
    return null;
  }

  /** `run N iterations across M users` (shared pool) / `run N iterations per user across M users`
   * (each VU runs its own N) — D97: count-bounded, no duration at all. */
  private parseIterationsWorkload(): Workload | null {
    const start = this.peek().span.start;
    this.advance(); // `run`
    const countTok = this.expect('number', 'an iteration count, e.g. `run 500 iterations across 20 users`');
    if (!countTok) return null;
    const count = Number(countTok.value);
    if (count <= 0) {
      this.error(Codes.LOAD_INVALID, `an iteration count must be positive, found ${countTok.value}`, countTok.span);
      return null;
    }
    if (!this.expectKw('iterations')) return null;
    let perVu = false;
    if (this.isKw(this.peek(), 'per')) {
      this.advance();
      if (!this.expectKw('user')) return null;
      perVu = true;
    }
    if (!this.expectKw('across')) return null;
    const vusTok = this.expect('number', 'a user count, e.g. `across 20 users`');
    if (!vusTok) return null;
    const vus = Number(vusTok.value);
    if (vus <= 0) {
      this.error(Codes.LOAD_INVALID, `a user count must be positive, found ${vusTok.value}`, vusTok.span);
      return null;
    }
    if (!this.expectKw('users')) return null;
    this.endLine();
    const span = this.spanFrom(start);
    return perVu
      ? { type: 'PerVuIterationsWorkload', iterationsPerVu: count, vus, span }
      : { type: 'SharedIterationsWorkload', iterations: count, vus, span };
  }

  /** `threshold p95 duration is less than 800ms` / `threshold error rate is less than 1%` (D24a). */
  private parseThresholdDecl(): ThresholdDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `threshold`
    const metricTok = this.peek();
    let metric: ThresholdMetric;
    if (metricTok.type === 'ident' && /^p([1-9][0-9]?)$/.test(metricTok.value)) {
      const percentile = Number(metricTok.value.slice(1));
      this.advance();
      if (!this.expectKw('duration')) return null;
      metric = { kind: 'duration', percentile };
    } else if (this.isKw(metricTok, 'error')) {
      this.advance();
      if (!this.expectKw('rate')) return null;
      metric = { kind: 'errorRate' };
    } else {
      this.error(
        Codes.UNEXPECTED_TOKEN,
        `expected a threshold metric (\`p50 duration\`, \`p90 duration\`, \`p95 duration\`, \`p99 duration\`, or \`error rate\`), found ${describeToken(metricTok)}`,
        metricTok.span,
      );
      return null;
    }
    // `for "checkout"` (M43, D70) — scopes this threshold to one endpoint's own histogram
    // instead of the whole scenario's. Optional; absence keeps today's whole-iteration meaning.
    let scope: StringLit | null = null;
    if (this.isKw(this.peek(), 'for')) {
      this.advance();
      scope = this.expectString('a label string after `for`, e.g. `threshold p95 duration for "checkout" is less than 250ms`');
      if (!scope) return null;
    }
    if (!this.expectKw('is')) return null;
    let op: ThresholdOp;
    if (this.isKw(this.peek(), 'less')) {
      this.advance();
      if (!this.expectKw('than')) return null;
      op = 'lessThan';
    } else if (this.isKw(this.peek(), 'greater')) {
      this.advance();
      if (!this.expectKw('than')) return null;
      op = 'greaterThan';
    } else {
      this.error(Codes.UNEXPECTED_TOKEN, `expected \`less than\` or \`greater than\`, found ${describeToken(this.peek())}`, this.peek().span);
      return null;
    }
    let value: number;
    if (metric.kind === 'duration') {
      const ms = this.parseDuration();
      if (ms === null) return null;
      value = ms;
    } else {
      const num = this.expect('number', 'a percentage, e.g. `threshold error rate is less than 1%`');
      if (!num) return null;
      if (!this.expect('percent', 'a `%` sign after the number, e.g. `1%`')) return null;
      value = Number(num.value) / 100;
    }
    this.endLine();
    return { type: 'ThresholdDecl', metric, op, value, scope, span: this.spanFrom(start) };
  }

  /** `pause 2s` / `pause 1s to 3s` (D18, FS-05) — legal anywhere a step is (parser-level),
   * restricted to workload-bearing bodies by the checker (`TF033`) since only there does
   * per-iteration pacing mean anything (SPEC's `sleep` ban is aimed at `test`/`before`/`after`). */
  private parsePause(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `pause`
    const minMs = this.parseDuration();
    if (minMs === null) return null;
    let maxMs: number | null = null;
    if (this.isKw(this.peek(), 'to')) {
      this.advance();
      maxMs = this.parseDuration();
      if (maxMs === null) return null;
      if (maxMs < minMs) {
        this.error(Codes.LOAD_INVALID, `\`pause\` range's upper bound (${maxMs}ms) is less than its lower bound (${minMs}ms)`, this.spanFrom(start));
        return null;
      }
    }
    this.endLine();
    const stmt: PauseStmt = { type: 'PauseStmt', minMs, maxMs, span: this.spanFrom(start) };
    return stmt;
  }

  // -- config dialect (tflw.config) ------------------------------------------

  parseConfig(): ConfigResult {
    const startPos = this.peek().span.start;
    let defaults: DefaultsBlock | null = null;
    const envs: EnvBlock[] = [];
    const requires: RequireDecl[] = [];
    const excludes: ExcludeDecl[] = [];
    const sessions: SessionDecl[] = [];
    this.skipNewlines();
    // M110 (`V4-04`) — the branch chain below and `TF022`'s message are the same list, and the
    // message is now built from `CONFIG_DIRECTIVES`. This makes the *other* half of that pair
    // checkable too: a directive added to the manifest with no branch here fails to compile, so
    // the message can never promise to accept something this loop drops into the `else`.
    const HANDLED: Record<ConfigDirective, true> = { defaults: true, env: true, session: true, require: true, exclude: true };
    void HANDLED;
    while (!this.atEof()) {
      const before = this.pos;
      const tok = this.peek();
      // `M137a`/D444. Declaration position, which the *test* dialect deliberately does not answer
      // at (D278: a blank line at the left margin is not one of the instrumented productions, and
      // answering there would be inventing a result). The asymmetry is intended: here the left
      // margin *is* an instrumented production — this loop — so the answer is derived exactly as
      // every other kind's is. A wholly empty line still gets nothing, because `completion.ts`'s
      // blank-line probe only fires on a line of pure indentation.
      if (this.completionMode && this.atCompletionPoint()) {
        this.completionResult = { kind: 'config-directive', prefix: this.completionPrefix() };
        break;
      }
      if (this.isKw(tok, 'defaults')) {
        const d = this.parseDefaultsBlock();
        if (d) {
          if (defaults) this.error(Codes.CONFIG_UNEXPECTED, 'duplicate `defaults` block', tok.span, 'a config has at most one `defaults` block');
          else defaults = d;
        }
      } else if (this.isKw(tok, 'env')) {
        const e = this.parseEnvBlock();
        if (e) envs.push(e);
        else this.synchronize();
      } else if (this.isKw(tok, 'require')) {
        const r = this.parseRequire();
        if (r) requires.push(r);
        else this.synchronize();
      } else if (this.isKw(tok, 'exclude')) {
        const ex = this.parseExclude();
        if (ex) excludes.push(ex);
        else this.synchronize();
      } else if (this.isKw(tok, 'session')) {
        const s = this.parseSessionDecl();
        if (s) sessions.push(s);
        else this.synchronize();
      } else if (this.isKw(tok, 'test')) {
        this.error(Codes.CONFIG_TEST_NOT_ALLOWED, '`test` is not allowed in tflw.config', tok.span, 'the config dialect is declaration-only; put tests in `.tflw` files');
        this.synchronize();
        this.skipBlock();
      } else {
        this.error(
          Codes.CONFIG_UNEXPECTED,
          `expected ${listConfigDirectives()}, found ${describeToken(tok)}`,
          tok.span,
        );
        this.synchronize();
        this.skipBlock();
      }
      // Same guarantee as `parse()`'s top-level loop (see its comment): `synchronize()`
      // deliberately won't cross a `dedent` it's already sitting on (nested blocks consume their
      // own), so recovery from a malformed entry — e.g. a `require env` list with a dangling
      // trailing comma, whose orphaned continuation line leaves a stray `dedent` here once
      // `synchronize()`/`skipBlock()` run out of things to consume — could otherwise spin forever,
      // re-erroring on the same token every iteration until the diagnostics array exhausts the
      // heap. This loop had no such guard; every other recovery loop in this file does.
      if (this.pos === before) this.advance();
      this.skipNewlines();
    }
    const config: ConfigFile = { type: 'ConfigFile', defaults, envs, requires, excludes, sessions, span: this.spanFrom(startPos) };
    return { config, diagnostics: this.diagnostics };
  }

  // -- session blocks (SPEC §3.3, P#20/31/42) --------------------------------

  private parseSessionDecl(): SessionDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `session`
    const name = this.expect('ident', 'a session name, e.g. `session admin`');
    if (!name) return null;
    // `session <name> privileged oauth2` — one order is legal (below) and this is the other one.
    // Reported here, before anything else reads the header, and then *recovered from by reading
    // the header the way it was plainly meant*: left to `endLine()` it produced one honest error
    // about `oauth2` followed by a wholly misleading second one, ``unknown step `token` … did you
    // mean `open`?``, because the oauth2 body was then parsed as ordinary session steps. A rejected
    // ordering should cost one diagnostic, not a cascade through a block the author wrote correctly.
    const early = this.peek();
    const misordered = this.isKw(early, 'privileged') && this.isKw(this.peek(1), 'oauth2');
    if (misordered) {
      this.error(
        Codes.UNEXPECTED_TOKEN,
        '`privileged` comes after `oauth2` on a `session` header',
        early.span,
        'write `session ' + name.value + ' oauth2 privileged` — the modifier is read last so that `oauth2` stays next to the indented block it introduces',
      );
      this.advance(); // `privileged`
    }
    if (this.isKw(this.peek(), 'oauth2')) {
      this.advance(); // `oauth2`
      const privileged = this.parsePrivilegedModifier() || misordered;
      this.endLine();
      const oauth2 = this.parseOauth2SessionConfig(start);
      if (!oauth2) return null;
      return { type: 'SessionDecl', name: name.value, oauth2, body: [], privileged, span: this.spanFrom(start) };
    }
    const privileged = this.parsePrivilegedModifier();
    this.endLine();
    const body = this.parseSessionBlock();
    return { type: 'SessionDecl', name: name.value, oauth2: null, body, privileged, span: this.spanFrom(start) };
  }

  /** The optional trailing `privileged` on a `session` header (M130b, D307/D310) — read after
   * `oauth2` when both are present, so `session svc oauth2 privileged` is the one spelling.
   *
   * A modifier rather than an indented sub-clause, unlike `probe mutating`: it is a property of the
   * *name*, it takes no operand, and an `oauth2` session's indented block is a fixed sugar shape
   * (`token url`/`client id`/…) that a stray keyword would have to be threaded through. */
  private parsePrivilegedModifier(): boolean {
    if (!this.isKw(this.peek(), 'privileged')) return false;
    this.advance();
    return true;
  }

  /** `session <name> oauth2` body — a fixed sugar shape, not ordinary steps (SPEC §3.3, decision
   * 3c): `token url`, `client id`, `client secret` are required; `scope` is optional. Each is a
   * full `Value` (so `env(...)`/interpolation work, matching every other config value). */
  private parseOauth2SessionConfig(start: Position): Oauth2SessionConfig | null {
    if (!this.check('indent')) {
      this.error(
        Codes.EMPTY_BLOCK,
        'this `session … oauth2` has no config',
        this.peek().span,
        'indent `token url`, `client id`, and `client secret` under the `session … oauth2` line',
      );
      return null;
    }
    this.advance(); // indent
    let tokenUrl: Value | null = null;
    let clientId: Value | null = null;
    let clientSecret: Value | null = null;
    let scope: Value | null = null;
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      const tok = this.peek();
      if (this.isKw(tok, 'token')) {
        this.advance();
        if (this.expectKw('url')) {
          const v = this.parseValue();
          if (v) {
            tokenUrl = v;
            this.endLine();
          } else this.synchronize();
        } else this.synchronize();
      } else if (this.isKw(tok, 'client')) {
        this.advance();
        const kindTok = this.peek();
        if (this.isKw(kindTok, 'id')) {
          this.advance();
          const v = this.parseValue();
          if (v) {
            clientId = v;
            this.endLine();
          } else this.synchronize();
        } else if (this.isKw(kindTok, 'secret')) {
          this.advance();
          const v = this.parseValue();
          if (v) {
            clientSecret = v;
            this.endLine();
          } else this.synchronize();
        } else {
          this.error(Codes.UNEXPECTED_TOKEN, `expected \`id\` or \`secret\` after \`client\`, found ${describeToken(kindTok)}`, kindTok.span);
          this.synchronize();
        }
      } else if (this.isKw(tok, 'scope')) {
        this.advance();
        const v = this.parseValue();
        if (v) {
          scope = v;
          this.endLine();
        } else this.synchronize();
      } else {
        this.error(
          Codes.UNEXPECTED_TOKEN,
          `expected \`token url\`, \`client id\`, \`client secret\`, or \`scope\` in an oauth2 session, found ${describeToken(tok)}`,
          tok.span,
        );
        this.synchronize();
      }
      if (this.pos === before) this.advance(); // guarantee progress
    }
    if (this.check('dedent')) this.advance();
    if (!tokenUrl || !clientId || !clientSecret) {
      this.error(
        Codes.CONFIG_UNEXPECTED,
        'an oauth2 session needs `token url`, `client id`, and `client secret`',
        this.spanFrom(start),
        'e.g.\n  session admin oauth2\n    token url "https://api.example.com/oauth/token"\n    client id env(CLIENT_ID)\n    client secret env(CLIENT_SECRET)',
      );
      return null;
    }
    return { type: 'Oauth2SessionConfig', tokenUrl, clientId, clientSecret, scope, span: this.spanFrom(start) };
  }

  /** Like `parseBlock`, but also accepts a bare `header "…" is …` line (only valid inside a
   * session — SPEC §3.3). */
  private parseSessionBlock(): Step[] {
    if (!this.check('indent')) {
      this.error(Codes.EMPTY_BLOCK, 'this `session` has no steps', this.peek().span, 'indent at least one step under the `session` line');
      return [];
    }
    this.advance(); // indent
    const steps: Step[] = [];
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      const head = this.peek();
      // `header` and `csrf` are both dispatched here rather than from `parseStep`, and for opposite
      // reasons. `header "X" is "Y"` means something different in a session (a header this
      // credential always sends) than in a test body (a header this one request sends), so it needs
      // its own production in this position. `csrf from …` (M137b, D433) means nothing at all
      // outside a session, so `parseStep` deliberately never learns it: written in a `.tflw` test
      // body it is an unknown step, which is an existing code with an existing "did you mean" rather
      // than a new checker pass and a new code to say the same thing.
      const step = this.isKw(head, 'header') ? this.parseHeaderStmt() : this.isKw(head, 'csrf') ? this.parseCsrfStmt() : this.parseStep();
      if (step) steps.push(step);
      else {
        const gap = this.malformedStepAt(before);
        if (gap) steps.push(gap);
        this.synchronize();
      }
      if (this.pos === before) this.advance(); // guarantee progress
    }
    if (this.check('dedent')) this.advance();
    return steps;
  }

  /**
   * `csrf from <subject> send as header "<name>"` (M137b, D433) — session bodies only, dispatched
   * from `parseSessionBlock`.
   *
   * **`send as`, not a bare `as`.** `as` already means two other things a reader meets nearby:
   * opting a test into a credential (`test "…" as shopper`) and naming a capture (`capture body.id
   * as orderId`). This statement does neither — it names a *destination* for a value on requests
   * that have not been written yet — so the verb earns its word.
   *
   * The `ValueSubject` refusal is `parseCapture`'s, for `parseCapture`'s reason: this reads a value
   * out of the establishment response, and `csrf from {token} …` would be a way of spelling "attach
   * a value I already have", which is what `header "X-CSRF-Token" is "{token}"` says one line up.
   */
  private parseCsrfStmt(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `csrf`
    if (!this.expectKw('from')) return null;
    const subject = this.parseSubject();
    if (!subject) return null;
    if (subject.type === 'ValueSubject') {
      this.error(
        Codes.UNKNOWN_SUBJECT,
        '`csrf from` reads a token out of this session\'s own establishment response, so its subject cannot be a `{variable}`',
        subject.span,
        'to send a token you already hold, write `header "X-CSRF-Token" is "{token}"` — `csrf from` is for a token the application issues during login (SPEC §3.3)',
      );
      return null;
    }
    if (!this.expectKw('send')) return null;
    if (!this.expectKw('as')) return null;
    if (!this.expectKw('header')) return null;
    const header = this.expectString('a header name string, e.g. `send as header "X-CSRF-Token"`');
    if (!header) return null;
    this.endLine();
    const stmt: CsrfStmt = { type: 'CsrfStmt', subject, header, span: this.spanFrom(start) };
    return stmt;
  }

  private parseHeaderStmt(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `header`
    const name = this.expectString('a header name string, e.g. `header "Authorization"`');
    if (!name) return null;
    if (!this.expectKw('is')) return null;
    const value = this.parseValue();
    if (!value) return null;
    this.endLine();
    const stmt: HeaderStmt = { type: 'HeaderStmt', name, value, span: this.spanFrom(start) };
    return stmt;
  }

  private parseDefaultsBlock(): DefaultsBlock | null {
    const start = this.peek().span.start;
    this.advance(); // `defaults`
    this.endLine();
    const entries = this.parseConfigEntries('defaults');
    return { type: 'DefaultsBlock', entries, span: this.spanFrom(start) };
  }

  private parseEnvBlock(): EnvBlock | null {
    const start = this.peek().span.start;
    this.advance(); // `env`
    const name = this.expect('ident', 'an environment name, e.g. `env local`');
    if (!name) return null;
    let isDefault = false;
    if (this.isKw(this.peek(), 'default')) {
      this.advance();
      isDefault = true;
    }
    this.endLine();
    const entries = this.parseConfigEntries('env');
    return { type: 'EnvBlock', name: name.value, isDefault, entries, span: this.spanFrom(start) };
  }

  private parseConfigEntries(block: ConfigBlockKind): ConfigEntry[] {
    const entries: ConfigEntry[] = [];
    if (!this.check('indent')) {
      this.error(Codes.EMPTY_BLOCK, 'this block has no entries', this.peek().span, 'indent at least one entry under the block header');
      return entries;
    }
    this.advance(); // indent
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      const parsed = this.parseConfigEntry(block);
      if (parsed) entries.push(...parsed);
      else this.synchronize();
      if (this.pos === before) this.advance();
    }
    if (this.check('dedent')) this.advance();
    return entries;
  }

  private parseConfigEntry(block: ConfigBlockKind): ConfigEntry[] | null {
    // `M137a`/D444 — the block decides the candidate list, so it decides the kind (see
    // `CompletionKind`). Guarded here rather than in `parseConfigEntries`' loop for the reason every
    // other guard sits at a production entry point: this is the function whose job is "read one
    // config key", and the loop above it has already committed to there being one.
    if (this.completionMode && this.atCompletionPoint()) {
      this.completionResult = { kind: block === 'defaults' ? 'defaults-key' : 'env-key', prefix: this.completionPrefix() };
      return null;
    }
    const tok = this.peek();
    if (tok.type !== 'ident') {
      this.error(Codes.CONFIG_UNKNOWN_KEY, `expected a config key, found ${describeToken(tok)}`, tok.span);
      return null;
    }
    switch (tok.value) {
      case 'header':
        return this.wrap(this.parseHeaderDecl());
      case 'timeout':
        return this.parseTimeoutDecls();
      case 'workers':
        return this.wrap(this.parseWorkersDecl());
      case 'report':
        return this.wrap(this.parseReportDecl());
      case 'web':
        return this.wrap(this.parseWebDecl());
      case 'api':
        return this.wrap(this.parseApiServiceDecl());
      case 'insecure':
        return this.wrap(this.parseInsecureDecl());
      case 'cert':
        return this.wrap(this.parseCertDecl());
      case 'key':
        return this.wrap(this.parseKeyDecl());
      case 'allow':
        return this.wrap(this.parseAllowHostsDecl());
      case 'authorized':
        return this.wrap(this.parseAuthorizedTargetDecl());
      case 'evidence':
        return this.wrap(this.parseEvidenceDecl());
      case 'log':
        return this.wrap(this.parseLogConfigDecl());
      case 'redact':
        return this.wrap(this.parseRedactDecl());
      case 'viewport':
        return this.wrap(this.parseViewportDecl());
      default: {
        // Suggest with the block in mind (M84, C11/`A2-07b`). The nearest key by edit distance is
        // still the right guess at what was *meant* — but half a dozen of the fourteen are legal in
        // only one of the two blocks, and recommending one of those into the wrong block produced a
        // tool that tells you what to write and then refuses it: `apii` in `defaults` drew ``did you
        // mean `api`?``, and following it exactly drew the checker's ``\`api\` is not allowed in
        // defaults``. So keep the guess and add the half that was missing — where the key lives.
        const best = suggest(tok.value, CONFIG_KEYS);
        const allowed = CONFIG_KEYS.filter((k) => configKeyAllowedIn(k, block));
        const where = block === 'defaults' ? '`defaults`' : 'an `env` block';
        const hint = best
          ? configKeyAllowedIn(best, block)
            ? `did you mean \`${best}\`?`
            : `did you mean \`${best}\`? it belongs in ${configKeyHome(best)}, not ${where}`
          : `expected one of: ${allowed.join(', ')}`;
        this.error(Codes.CONFIG_UNKNOWN_KEY, `unknown config key \`${tok.value}\``, tok.span, hint);
        return null;
      }
    }
  }

  private wrap(entry: ConfigEntry | null): ConfigEntry[] | null {
    return entry ? [entry] : null;
  }

  private parseHeaderDecl(): HeaderDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `header`
    const name = this.expectString('a header name string, e.g. `header "Accept"`');
    if (!name) return null;
    if (!this.expectKw('is')) return null;
    const value = this.parseValue();
    if (!value) return null;
    let service: string | null = null;
    if (this.isKw(this.peek(), 'for')) {
      this.advance();
      const s = this.expect('ident', 'a service name after `for`');
      if (s) service = s.value;
    }
    this.endLine();
    return { type: 'HeaderDecl', name, value, service, span: this.spanFrom(start) };
  }

  private parseTimeoutDecls(): ConfigEntry[] | null {
    this.advance(); // `timeout`
    const decls: TimeoutDecl[] = [];
    for (;;) {
      const start = this.peek().span.start;
      const targetTok = this.peek();
      if (targetTok.type !== 'ident' || !(TIMEOUT_TARGETS as readonly string[]).includes(targetTok.value)) {
        this.error(Codes.UNEXPECTED_TOKEN, `expected a timeout target (${TIMEOUT_TARGETS.join('/')}), found ${describeToken(targetTok)}`, targetTok.span);
        return decls.length ? decls : null;
      }
      this.advance();
      const durStart = this.peek().span.start;
      const ms = this.parseDuration();
      if (ms === null) return decls.length ? decls : null;
      const target = targetTok.value as TimeoutTarget;
      // **Only `step`.** `timeout step 0s` hands `setTimeout(abort, 0)` to every request, so the
      // whole suite fails before a single byte is sent; `timeout expect 0s` and `timeout wait 0s`
      // are *meaningful* — both poll loops are `for (;;)` bodies that evaluate once and test the
      // deadline afterwards, so zero there means "evaluate once, don't poll" and is a setting
      // someone may genuinely want. Measured in `interpreter.ts`/`http.ts`, not assumed, and the
      // asymmetry is kept rather than flattened for the same reason `random string 0` is legal.
      // Durations skip the whole-number test: `parseDuration` multiplies, so `1.5s` is 1500ms and
      // fractional milliseconds are odd rather than impossible.
      if (target === 'step' && !this.settingValue(ms, this.spanFrom(durStart), `timeout step ${ms}ms`, 1, '`timeout step 0s` aborts every request before it is sent, so every api step in the suite fails identically — give it a real budget, or drop the line to take the default. `timeout expect 0s`/`timeout wait 0s` are different and stay legal: they mean "evaluate once, don\'t poll"', false)) {
        return decls.length ? decls : null;
      }
      decls.push({ type: 'TimeoutDecl', target, ms, span: this.spanFrom(start) });
      if (this.check('comma')) {
        this.advance();
        continue;
      }
      break;
    }
    this.endLine();
    return decls;
  }

  private parseDuration(): number | null {
    const num = this.expect('number', 'a duration, e.g. `10s` or `500ms`');
    if (!num) return null;
    const unitTok = this.peek();
    if (unitTok.type !== 'ident') {
      this.error(Codes.UNKNOWN_DURATION_UNIT, `expected a time unit (ms/s/m or seconds/minutes/hours/days/weeks) after ${num.value}, found ${describeToken(unitTok)}`, unitTok.span);
      return null;
    }
    const n = Number(num.value);
    // D170 (`M98c-03`) — one duration rule, both positions. `M98c` shipped the adjacency rule in
    // *value* position only, so `expect duration is less than 250 ms` was an error while `pause
    // 250 ms` was accepted; this function had the right words all along and simply never asked the
    // question, passing `adjacent: true` unconditionally below.
    //
    // `M98c-03` recorded the asymmetry as unfixable — *"the rejection is the correct rule; the
    // acceptance is the old one, and removing it is a breaking change under the 1.0 freeze"* — and
    // that premise was never measured. It is now: **66 closed-up durations in the corpus, 0 spaced
    // ones.** The single grep hit for a spaced duration is inside a comment. There are no programs
    // to break, so the narrowing costs nothing and the two positions stop disagreeing.
    //
    // D638 widens the adjacency test rather than removing it: it applies to an **abbreviation**,
    // which is what makes `250 ms` a mistake worth teaching, and not to a **word**, which the other
    // two positions have always accepted with a space (`today + 3 days`). Asking it of words would
    // have made `pause 2 seconds` legal only as `pause 2seconds`, which is the union arriving with
    // a new rule attached.
    const adjacent = num.span.end.offset === unitTok.span.start.offset;
    const spelledOut = (DATE_OFFSET_UNITS as readonly string[]).includes(unitTok.value);
    if (!spelledOut && !adjacent && this.reportBadDurationUnit(num, unitTok, adjacent)) return null;
    const perUnit = TIME_UNIT_MS[unitTok.value];
    if (perUnit !== undefined) {
      this.advance();
      return n * perUnit;
    }
    // D160: shared with the value path, so `pause 2sec` and `expect duration is less than 2sec`
    // give the same answer. `reportBadDurationUnit` returns false only for a word that was never
    // reaching for a unit, which in *this* position — a duration is the only thing the grammar
    // allows — is still a wrong unit, so the old message stays as the fallback.
    if (!this.reportBadDurationUnit(num, unitTok, adjacent)) {
      this.error(Codes.UNKNOWN_DURATION_UNIT, `unknown time unit \`${unitTok.value}\``, unitTok.span, TIME_UNITS_HELP);
    }
    return null;
  }

  /**
   * M98c (`A1-07`, D160): the duration diagnostics that already existed, made reachable from the
   * value path.
   *
   * `250ms` and `250 ms` lex to the *identical* token sequence — the lexer has no duration token, so
   * `parseAtom` reconstructs adjacency from offsets. When that check or the unit-set check failed it
   * simply declined to build a `DurationLit` and let the leftover `ms` fall out of the step, so
   * every wrong duration in value position arrived as ``TF010: unexpected `ms` at end of step`` /
   * `= help: expected end of line`. `250 ms` (a space) and `250MS` (case) are the two likeliest
   * first attempts and both were told the problem was the end of the line — while the *other*
   * duration path, `parseDuration`, had the right words all along.
   *
   * Three cases, three different fixes, kept apart on purpose: a real unit written with a space, a
   * word that means a unit tflw spells differently, and (returning `false`) a word that was never a
   * unit at all.
   *
   * Returns whether it reported anything; the caller keeps its own error for `false`.
   */
  private reportBadDurationUnit(numTok: Token, unitTok: Token, adjacent: boolean): boolean {
    const canonical = nearestDurationUnit(unitTok.value);
    if (canonical === null) return false;
    const span = { start: numTok.span.start, end: unitTok.span.end };
    if (unitTok.value === canonical) {
      // Only reachable when the two are *not* adjacent — an adjacent real unit is a duration.
      //
      // The hint is deliberately M84's wording verbatim (`trailingHint`, C11/`A3-09`), which already
      // taught this one case from `endLine` and has a test asserting the exact sentence. Intercepting
      // the case earlier moves it to a code and a message that name a duration instead of "end of
      // step" — it must not quietly downgrade the hint M84 shipped.
      this.error(
        Codes.UNKNOWN_DURATION_UNIT,
        'a duration unit must touch its number',
        span,
        `write \`${numTok.value}${canonical}\`, not \`${numTok.value} ${unitTok.value}\``,
      );
      return true;
    }
    const spacing = adjacent ? '' : ' with no space';
    // `250MS` lower-cases into a real unit, so the mistake is the case and nothing else — saying
    // "unknown time unit" and leaving the reader to spot the capitals is the hint doing half its job.
    const why =
      unitTok.value.toLowerCase() === canonical
        ? 'time units are lowercase'
        : `tflw's abbreviated time units are \`ms\`, \`s\` and \`m\``;
    this.error(
      Codes.UNKNOWN_DURATION_UNIT,
      `unknown time unit \`${unitTok.value}\``,
      span,
      `${why} — write \`${numTok.value}${canonical}\`${spacing}.`,
    );
    return true;
  }

  /** **The setting-value rule** (`M147c`, `A2-09`, D631) — `TF071`.
   *
   * *A setting is refused when the value written cannot configure anything: when no run could act
   * on it.* Five slots take a bare number and none of them looked at it, so `workers 0`,
   * `viewport 0 0`, `timeout step 0s` and `retry 2.5` each reached "no problems found" and then ran
   * something nobody wrote — zero workers, a viewport with no area, a timeout that aborts every
   * request before it is sent, and two retries where two-and-a-half was asked for.
   *
   * **Negatives were never the gap and this does not handle them.** The lexer emits `-` as its own
   * token, so `workers -1` fails `expect('number')` and has always been `TF010` — measured, not
   * assumed. What is new here is *zero where zero cannot configure anything* and *a fraction where
   * only whole things exist*.
   *
   * **The `min` is per-slot on purpose, and the zeros that survive are the point.** `retry 0` and
   * `retry honoring "…" up to 0` are the defaults spelled out loud; `timeout expect 0s` and
   * `timeout wait 0s` mean *evaluate once, do not poll*, because both loops test their deadline
   * only after the first evaluation. Same line `random string 0` draws in SPEC §4.1: the question
   * is never whether the number is zero, it is whether the setting can still keep its promise.
   *
   * Returns `false` when it reported, so a caller can stop rather than build a node around a value
   * it has just called impossible.
   */
  private settingValue(n: number, span: Span, written: string, min: number, hint: string, integer = true): boolean {
    if (integer && !Number.isInteger(n)) {
      this.error(
        Codes.INVALID_SETTING_VALUE,
        `\`${written}\` is not a whole number`,
        span,
        hint,
      );
      return false;
    }
    if (n < min) {
      this.error(
        Codes.INVALID_SETTING_VALUE,
        `\`${written}\` is below the smallest value this setting can take (${min})`,
        span,
        hint,
      );
      return false;
    }
    return true;
  }

  private parseWorkersDecl(): WorkersDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `workers`
    const num = this.expect('number', 'a worker count, e.g. `workers 4`');
    if (!num) return null;
    // The same sentence `--workers` has always printed for the same value ("expects a positive
    // integer", `cli.ts`). One rule, two doors — the flag refused `0` and the config door accepted
    // it, which is the whole of `A2-09`'s first line.
    const count = Number(num.value);
    if (!this.settingValue(count, num.span, `workers ${num.value}`, 1, 'a run needs at least one worker — `workers 1` runs the suite sequentially, which is the default when `workers` is omitted')) {
      this.endLine();
      return null;
    }
    this.endLine();
    return { type: 'WorkersDecl', count, span: this.spanFrom(start) };
  }

  private parseInsecureDecl(): InsecureDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `insecure`
    const tok = this.peek();
    if (tok.type !== 'ident' || (tok.value !== 'true' && tok.value !== 'false')) {
      this.error(Codes.UNEXPECTED_TOKEN, `expected \`true\` or \`false\` after \`insecure\`, found ${describeToken(tok)}`, tok.span);
      return null;
    }
    this.advance();
    this.endLine();
    return { type: 'InsecureDecl', value: tok.value === 'true', span: this.spanFrom(start) };
  }

  private parseCertDecl(): CertDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `cert`
    const path = this.expectString('a client certificate file path, e.g. `cert "./certs/client.pem"`');
    if (!path) return null;
    this.endLine();
    return { type: 'CertDecl', path, span: this.spanFrom(start) };
  }

  private parseKeyDecl(): KeyDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `key`
    const path = this.expectString('a client private key file path, e.g. `key "./certs/client.key"`');
    if (!path) return null;
    this.endLine();
    return { type: 'KeyDecl', path, span: this.spanFrom(start) };
  }

  private parseAllowHostsDecl(): AllowHostsDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `allow`
    if (!this.expectKw('hosts')) return null;
    const hosts: StringLit[] = [];
    for (;;) {
      const host = this.expectString('a host string, e.g. `allow hosts "api.example.com"`');
      if (!host) return null;
      hosts.push(host);
      if (this.check('comma')) {
        this.advance();
        continue;
      }
      break;
    }
    this.endLine();
    return { type: 'AllowHostsDecl', hosts, span: this.spanFrom(start) };
  }

  /** `authorized target "<url>" reason "<text>"` (M128b, D291, SPEC §3.10) — a compound key, the same
   * `allow hosts` shape: `authorized` alone disambiguates on the next bare word, leaving room for
   * whatever else D21's later layers need to authorize without a second top-level keyword.
   *
   * `reason` is parsed as required rather than optional. Making it optional would be one character
   * of grammar and would quietly turn the declaration into a checkbox — the thing D21 was written
   * instead of — so the omission is a parse error with the whole form in the message.
   *
   * **M130b/D330 adds an optional indented sub-clause, and adds nothing to the line above it.**
   * `probe mutating` grants this host permission to receive a `POST`/`PUT`/`PATCH`/`DELETE`
   * re-issued under another principal. The declaration itself keeps its single-line spelling —
   * `tflw-acceptance/security/tflw.config:33` and `:40` are on `main` written that way — so this is
   * a line beneath, never a reformatting. Sub-clauses are how the config dialect already nests
   * (`session`, `defaults`, `env`), and Tier 3's later per-class opt-ins land as siblings here
   * instead of lengthening a line whose most important word would end up last. */
  private parseAuthorizedTargetDecl(): AuthorizedTargetDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `authorized`
    if (!this.expectKw('target')) return null;
    const target = this.expectString('a target base URL, e.g. `authorized target "https://staging.example.com"`');
    if (!target) return null;
    if (!this.expectKw('reason')) return null;
    const reason = this.expectString('why you are permitted to scan this target, e.g. `reason "self-hosted test fixture"`');
    if (!reason) return null;
    this.endLine();
    const probes = this.parseAuthorizedTargetSubClauses();
    return { type: 'AuthorizedTargetDecl', target, reason, ...probes, span: this.spanFrom(start) };
  }

  /** The optional indented block under an `authorized target` (M130b, D330; M134a, D372). An absent
   * block is the same answer as a block that declares nothing, so the caller has one shape to
   * handle. Unknown sub-clauses are an error *here* rather than in the enclosing config loop: by the
   * time the loop sees an `indent` it has lost which declaration it belongs under, and the message
   * would name a config key that is not what the author was writing.
   *
   * **`M134a` adds two siblings and no grammar** — D311 predicted exactly this (*"Tier 3's further
   * per-class opt-ins land as sibling lines instead of needing a second grammar"*), which is why
   * D21 layer 4 is discharged and stays discharged: `probe mutating` was its first tenant and these
   * are the second and third tenants of a working mechanism, not a reopening of the layer.
   *
   * **`M137g` adds the fourth (`probe ciphers`, D485) and still no grammar** — the same prediction
   * holding a third time. It also found that "no grammar" had quietly cost four hand-kept copies of
   * the field list: the tuple, the field map, this method's return type and its default literal. The
   * last two are now derived from the first two, so a fifth clause is one line. */
  private parseAuthorizedTargetSubClauses(): Record<ProbeSubClauseField, boolean> {
    // Derived from `PROBE_SUB_CLAUSE_FIELDS` rather than written out, so the default state cannot
    // fall behind the vocabulary. It was a hand-kept literal until `M137g` added a fourth clause and
    // tsc pointed at this line — the same "how many places is this number written?" question
    // `M137a` had to ask of `--of=6`, arriving in a file that had already answered it correctly
    // twice (the tuple above, and the reporter's word table).
    const probes = Object.fromEntries(PROBE_SUB_CLAUSES.map((w) => [PROBE_SUB_CLAUSE_FIELDS[w], false])) as Record<ProbeSubClauseField, boolean>;
    if (!this.check('indent')) return probes;
    this.advance(); // indent
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      const tok = this.peek();
      // `M137a`/D444, the case that decision is named for: `probe mutating` shipped in `M130b` and
      // was never completable, in either of the two positions a person types it from. This is the
      // first — the start of a sub-clause line, where the whole phrase is what has to land in the
      // buffer.
      if (this.completionMode && this.atCompletionPoint()) {
        this.completionResult = { kind: 'probe', prefix: this.completionPrefix() };
        break;
      }
      if (this.isKw(tok, 'probe')) {
        this.advance();
        // The second position: `probe ` is already typed, so the candidate is the bare class word.
        // Offering the phrase here would complete to `probe probe mutating`, which is why these are
        // two kinds and not one.
        if (this.completionMode && this.atCompletionPoint()) {
          this.completionResult = { kind: 'probe-class', prefix: this.completionPrefix() };
          break;
        }
        const word = this.peek();
        const known = PROBE_SUB_CLAUSES.find((w) => this.isKw(word, w));
        if (known) {
          this.advance();
          probes[PROBE_SUB_CLAUSE_FIELDS[known]] = true;
          this.endLine();
        } else {
          // Names the whole vocabulary rather than one word of it — the A3-15 rule, applied to a
          // list that just went from one member to three and will grow again.
          const near = word.type === 'ident' ? suggest(word.value, [...PROBE_SUB_CLAUSES]) : undefined;
          this.error(
            Codes.UNEXPECTED_TOKEN,
            `expected one of ${PROBE_SUB_CLAUSES.map((w) => `\`probe ${w}\``).join(', ')}, found ${describeToken(word)}`,
            word.span,
            near ? `did you mean \`probe ${near}\`?` : PROBE_SUB_CLAUSE_HELP,
          );
          this.synchronize();
        }
      } else {
        const hint = tok.type === 'ident' && suggest(tok.value, ['probe']) ? 'did you mean `probe mutating`?' : PROBE_SUB_CLAUSE_HELP;
        this.error(Codes.UNEXPECTED_TOKEN, `expected a \`probe …\` sub-clause under \`authorized target\`, found ${describeToken(tok)}`, tok.span, hint);
        this.synchronize();
      }
      // Same non-advance guard every recovery loop in this file carries.
      if (this.pos === before) this.advance();
    }
    if (this.check('dedent')) this.advance();
    return probes;
  }

  /**
   * One config directive whose value comes from a closed set the language defines, read as a **bare
   * keyword** — `A2-14`, `D623`.
   *
   * The rule the language never had: *a directive whose value is drawn from a closed set the
   * language defines is written as a bare keyword; a directive whose value is a boolean or an open
   * string is written as a literal.* Measured before it was written, three of the four closed-set
   * directives were backwards — `evidence`, `log destination` and `log level` all took quoted
   * strings, while `timeout <target>` and `insecure <bool>` were already right. The plan named two;
   * `log destination` is the third and was simply never measured, being nowhere in the row that
   * filed the defect.
   *
   * **The retired spelling is answered, not merely rejected** (`SPEC.md` §15). A quoted value gets
   * a migration diagnostic naming the bare form, and — when the quoted text names a real member —
   * a `deprecation.replacement` payload, so `tflw migrate` rewrites the file. When it does not name
   * one there is no single right answer to splice, so the payload is withheld and the hint names
   * the vocabulary instead: the same discipline `D-M90-3` applies to a bare `check <locator>`,
   * where guessing writes a mutation into a test that keeps passing.
   *
   * Phrases rather than words, longest first, for `SCAN_KIND_PHRASES`' reason — a one-word phrase
   * must not shadow a two-word one starting with the same token. `evidence headers only` is the
   * only multi-word member today (`D628`).
   *
   * `what` carries its own article (`an evidence level`), because the three directives do not agree
   * on one and a message that reads *"expected a evidence level"* teaches carelessness about the
   * rest of the sentence.
   */
  private parseClosedSetDirective(directive: string, phrases: readonly string[], what: string): string | null {
    const vocabulary = phrases.map((p) => `\`${p}\``).join(', ');
    const tok = this.peek();
    if (tok.type === 'string') {
      // `headers-only` was the spelling of the quoted era, so the hyphen is what a migrating file
      // actually contains — matched here rather than left to a did-you-mean that would have to
      // bridge a punctuation change.
      const wanted = phrases.find((p) => p === tok.value || p.replace(/ /g, '-') === tok.value);
      this.error(
        Codes.UNEXPECTED_TOKEN,
        wanted
          ? `\`${directive}\` takes a bare keyword — write \`${directive} ${wanted}\` instead of \`${directive} "${tok.value}"\``
          : `\`${directive}\` takes a bare keyword, and "${tok.value}" is not ${what}`,
        tok.span,
        wanted
          ? `a quoted value here was retired in favour of one spelling per directive; \`tflw migrate\` rewrites this for you`
          : `expected one of ${vocabulary}, written without quotes`,
        undefined,
        wanted ? { replacement: wanted } : undefined,
      );
      return null;
    }
    const phrase = [...phrases]
      .sort((a, b) => b.split(' ').length - a.split(' ').length)
      .find((p) => p.split(' ').every((word, i) => this.isKw(this.peek(i), word)));
    if (phrase === undefined) {
      // Suggested against the *first* words, since that is all the parser has read — and the hint
      // offers the whole phrase, because `headers` alone is not something a user can write.
      const firsts = [...new Set(phrases.map((p) => p.split(' ')[0]!))];
      const near = tok.type === 'ident' ? suggest(tok.value, firsts) : undefined;
      const whole = near === undefined ? undefined : (phrases.find((p) => p.startsWith(`${near} `)) ?? near);
      this.error(
        Codes.UNEXPECTED_TOKEN,
        `expected ${what} after \`${directive}\`, found ${describeToken(tok)}`,
        tok.span,
        whole ? `did you mean \`${whole}\`?` : `expected one of ${vocabulary}`,
      );
      return null;
    }
    for (let i = 0; i < phrase.split(' ').length; i++) this.advance();
    return phrase;
  }

  private parseEvidenceDecl(): EvidenceDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `evidence`
    const phrase = this.parseClosedSetDirective('evidence', EVIDENCE_PHRASES, 'an evidence level');
    if (phrase === null) return null;
    this.endLine();
    return { type: 'EvidenceDecl', level: EVIDENCE_LEVEL_OF[phrase as (typeof EVIDENCE_PHRASES)[number]], span: this.spanFrom(start) };
  }

  /** `log destination console|html|both` / `log level debug|info|warn|error` (M27, PLAN_LOG.md
   * decisions 116/122; bare keywords as of `M147b`/`D623`) — a compound key, same shape as
   * `allow hosts`: `log` alone disambiguates on the next bare word, and now so does its value. */
  private parseLogConfigDecl(): ConfigEntry | null {
    const start = this.peek().span.start;
    this.advance(); // `log`
    const sub = this.peek();
    if (this.isKw(sub, 'destination')) {
      this.advance();
      const phrase = this.parseClosedSetDirective('log destination', LOG_DESTINATIONS, 'a log destination');
      if (phrase === null) return null;
      this.endLine();
      return { type: 'LogDestinationDecl', destination: phrase as LogDestination, span: this.spanFrom(start) };
    }
    if (this.isKw(sub, 'level')) {
      this.advance();
      const phrase = this.parseClosedSetDirective('log level', LOG_LEVELS, 'a log level');
      if (phrase === null) return null;
      this.endLine();
      return { type: 'LogLevelDecl', level: phrase as LogLevel, span: this.spanFrom(start) };
    }
    this.error(Codes.UNEXPECTED_TOKEN, `expected \`destination\` or \`level\` after \`log\`, found ${describeToken(sub)}`, sub.span);
    return null;
  }

  private parseRedactDecl(): RedactDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `redact`
    const patterns: RedactPattern[] = [];
    for (;;) {
      const pattern = this.parseRedactPattern();
      if (!pattern) return null;
      patterns.push(pattern);
      if (this.check('comma')) {
        this.advance();
        continue;
      }
      break;
    }
    this.endLine();
    return { type: 'RedactDecl', patterns, span: this.spanFrom(start) };
  }

  /** One `redact` target: `body.<path>`, `header "<name>"` or `query "<name>"` (FS-03). The header
   * and query names are quoted strings, matching every other header-name site in the language
   * (`header "Accept" is …`) — and necessarily so, since identifiers can't contain the hyphen that
   * `X-Api-Key`/`Set-Cookie` need. */
  private parseRedactPattern(): RedactPattern | null {
    const head = this.peek();
    if (this.isKw(head, 'header') || this.isKw(head, 'query')) {
      const root = head.value as 'header' | 'query';
      this.advance();
      const example = root === 'header' ? 'Authorization' : 'token';
      const name = this.expect('string', `a quoted ${root} name, e.g. \`redact ${root} "${example}"\``);
      if (!name) return null;
      return { root, name: name.value };
    }
    if (!this.isKw(head, 'body')) {
      this.error(
        Codes.UNEXPECTED_TOKEN,
        `expected \`body\`, \`header\` or \`query\` after \`redact\`, found ${describeToken(head)}`,
        head.span,
        'e.g. `redact body.password`, `redact header "Authorization"`, `redact query "token"`',
      );
      return null;
    }
    this.advance(); // `body`
    const segments: RedactPathSegment[] = [];
    while (this.check('dot')) {
      this.advance();
      if (this.check('star')) {
        this.advance();
        segments.push({ kind: 'wildcard' });
      } else {
        const name = this.expect('ident', 'a property name or `*` after `.`');
        if (!name) return null;
        segments.push({ kind: 'prop', name: name.value });
      }
    }
    if (segments.length === 0) {
      const tok = this.peek();
      this.error(Codes.UNEXPECTED_TOKEN, `expected a field path after \`body\`, e.g. \`redact body.email\``, tok.span);
      return null;
    }
    return { root: 'body', segments };
  }

  private parseViewportDecl(): ViewportDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `viewport`
    const width = this.expect('number', 'a viewport width in px, e.g. `viewport 1280 720`');
    if (!width) return null;
    // **Both dimensions, and each checked the moment it is read.** `viewport 0 0` is two mistakes on
    // one line, and reporting only the first sends someone back for a second `check` to be told the
    // other half. Getting both out is not a matter of avoiding `&&`: M83's panic mode drops any
    // diagnostic raised without the cursor having moved since the last one (`this.pos ===
    // this.lastErrorPos`), so checking both values *after* reading both tokens silently loses the
    // second one — measured, it reported width and swallowed height. Interleaving read-then-check
    // puts a consumed token between the two calls, which is the condition panic mode actually
    // tests. Any future setting that takes two numbers on one line inherits this ordering
    // requirement.
    const px = 'a viewport is measured in whole pixels and needs area to render anything — `viewport 1280 720` is Playwright\'s own default, which is what applies when `viewport` is omitted';
    const w = Number(width.value);
    const okW = this.settingValue(w, width.span, `viewport width ${width.value}`, 1, px);
    const height = this.expect('number', 'a viewport height in px, e.g. `viewport 1280 720`');
    if (!height) return null;
    const h = Number(height.value);
    const okH = this.settingValue(h, height.span, `viewport height ${height.value}`, 1, px);
    this.endLine();
    if (!okW || !okH) return null;
    return { type: 'ViewportDecl', width: w, height: h, span: this.spanFrom(start) };
  }

  private parseReportDecl(): ReportDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `report`
    const dir = this.expectString('a report directory string, e.g. `report "./report"`');
    if (!dir) return null;
    this.endLine();
    return { type: 'ReportDecl', dir, span: this.spanFrom(start) };
  }

  private parseWebDecl(): WebDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `web`
    const url = this.expectString('a base URL string, e.g. `web "http://localhost:5173"`');
    if (!url) return null;
    this.endLine();
    return { type: 'WebDecl', url, span: this.spanFrom(start) };
  }

  private parseApiServiceDecl(): ApiServiceDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `api`
    let service: string | null = null;
    if (this.check('ident')) service = this.advance().value; // named service before the URL
    const url = this.expectString('a base URL string, e.g. `api "http://localhost:3001"`');
    if (!url) return null;
    this.endLine();
    return { type: 'ApiServiceDecl', service, url, span: this.spanFrom(start) };
  }

  private parseRequire(): RequireDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `require`
    if (!this.expectKw('env')) return null;
    const names: string[] = [];
    const first = this.expect('ident', 'a variable name, e.g. `require env API_KEY`');
    if (!first) return null;
    names.push(first.value);
    while (this.check('comma')) {
      this.advance();
      const n = this.expect('ident', 'a variable name');
      if (n) names.push(n.value);
    }
    this.endLine();
    return { type: 'RequireDecl', names, span: this.spanFrom(start) };
  }

  /** `exclude "<path>"[, "<path>"...]` (D127) — top-level, same comma-list shape as `require env`
   * but string-literal paths (like `allow hosts`) rather than bare identifiers. */
  private parseExclude(): ExcludeDecl | null {
    const start = this.peek().span.start;
    this.advance(); // `exclude`
    const paths: StringLit[] = [];
    const first = this.expectString('a path string, e.g. `exclude "tflw-acceptance"`');
    if (!first) return null;
    paths.push(first);
    while (this.check('comma')) {
      this.advance();
      const p = this.expectString('a path string');
      if (p) paths.push(p);
    }
    this.endLine();
    return { type: 'ExcludeDecl', paths, span: this.spanFrom(start) };
  }

  /** Skip an indented block wholesale (recovery after a bad block header). */
  private skipBlock(): void {
    if (!this.check('indent')) return;
    this.advance(); // indent
    this.skipBlockBody();
  }

  /** The other half of `skipBlock()`, for a caller that has already consumed the opening `indent`
   * and then failed part-way through the block — discard the rest of it, matching `dedent` included. */
  private skipBlockBody(): void {
    let depth = 0;
    while (!this.atEof()) {
      const t = this.peek();
      if (t.type === 'indent') {
        depth++;
        this.advance();
      } else if (t.type === 'dedent') {
        this.advance();
        if (depth === 0) return;
        depth--;
      } else this.advance();
    }
  }

  /** Recover from a failed construct *without eating the next line* (M83, C11/`A2-04`).
   *
   * `synchronize()` discards to end of line. That is right when a production failed part-way through
   * a line, and wrong when it failed *after* already consuming its own trailing newline or its own
   * indented block. `step users` with an unparseable stage block is the second kind: by the time
   * `parseStageBlock` returns `null` the block's `dedent` is consumed and the cursor sits on the
   * next, perfectly good step — which `synchronize()` then deleted from the surviving `TestDecl`, so
   * a load test came back as a functional one, missing its only request, still asserting a status
   * against nothing.
   *
   * `startPos` is where the failed construct began. Both halves of the test are load-bearing: a
   * production that consumed *nothing* also leaves `previous()` on the previous line's newline, and
   * skipping the sync there would leave its whole line to be re-parsed a token at a time — which is
   * the cascade this milestone is about, just one scope down. */
  /**
   * The placeholder left behind when a step was identified and then abandoned (`M147c`,
   * `M140-01`). See `MalformedStep` in `ast.ts` for why the body keeps a node here rather than
   * closing the gap: every pass that answers a question by looking at what *precedes* a step was
   * answering it from a body the user did not write.
   *
   * `before` is the token index the step started at — the same `before` the four call sites already
   * hold for their progress guard, so no site has to remember a second position.
   *
   * **Only a word starts a step**, so a failure that begins on punctuation or a string gets no
   * placeholder. Those are not abandoned steps; they are the parser landing mid-line after some
   * other production gave up, and inventing a step there would put a node in the body at a
   * position the user wrote nothing at.
   *
   * **Silent in completion mode.** `parseStep` returns `null` at a completion point without
   * reporting anything — that null means "the cursor is here", not "this failed" — and a
   * placeholder built from it would be a step the editor's own keystroke invented.
   *
   * `wait` is the one head that needs more than its first word: `wait until api …` establishes a
   * response and `wait until <ui condition>` does not, and by the time `parseWaitUntilApiRest`
   * fails that distinction is gone. Read from the tokens rather than reported by the production,
   * so the phrase recorded is the one the user typed.
   */
  private malformedStepAt(before: number): MalformedStep | null {
    if (this.completionMode) return null;
    const first = this.tokens[before];
    if (!first || first.type !== 'ident') return null;
    let head = first.value;
    const second = this.tokens[before + 1];
    const third = this.tokens[before + 2];
    if (head === 'wait' && second && this.isKw(second, 'until')) {
      head = third && this.isKw(third, 'api') ? 'wait until api' : 'wait until';
    }
    return { type: 'MalformedStep', head, span: this.spanFrom(first.span.start) };
  }

  private recover(startPos: number): void {
    if (this.pos === startPos) {
      this.synchronize();
      return;
    }
    const prev = this.previous();
    if (prev.type === 'newline' || prev.type === 'dedent') return;
    this.synchronize();
  }

  // -- tests -----------------------------------------------------------------

  private parseTest(): TestDecl | null {
    const start = this.peek().span.start;
    const tags: string[] = [];
    // Tags may sit on their own line(s) above `test` (and above a `with each` table, if present).
    while (this.check('tag') || (this.check('newline') && tags.length > 0 && this.tagsContinue())) {
      if (this.check('tag')) tags.push(this.advance().value);
      else this.advance(); // newline between a tag line and the next tag/table/test line
    }
    let table: DataTable | null = null;
    if (this.isKw(this.peek(), 'with')) {
      table = this.parseDataTable();
    }
    if (!this.expectKw('test')) return null;
    const name = this.expectString('a test name string, e.g. `test "logs in"`');
    if (!name) return null;
    // Header modifiers — `as <session>[, <session>]`, `retry N`, `parallel`/`sequential`. They are
    // independent attributes of the test, so they parse **in any order** (M72, review finding
    // A2-06). Each used to have a fixed slot, in that sequence, and anything else fell through to
    // `endLine()`: `test "x" retry 2 as admin` reported "unexpected `as` at end of step" — telling
    // the author a valid keyword was invalid, calling a header a step, and hinting "expected end of
    // line" when the line was not finished. Nothing documented the legal order, and an arbitrary
    // one is exactly the kind of rule §15's freeze would have made permanent.
    //
    // Repeating a modifier is still an error, and now says so by name instead of by position: a
    // second `as` is a repeat, not a continuation (`as admin, userA` is the comma form), and
    // `parallel sequential` contradicts itself. Every header that parsed before still parses —
    // this only ever accepts more.
    //
    // A repeat reports once and then *keeps parsing*: the clause is consumed normally and the
    // first occurrence's value stands. Bailing out of the header would abandon the whole test, and
    // the body's indentation would then be reported twice more as stray tokens — three diagnostics
    // for one typo, two of them about something the author did not do.
    const sessions: string[] = [];
    let retry = 0;
    let concurrency: 'parallel' | 'sequential' | null = null;
    let sawAs = false;
    let sawRetry = false;
    for (;;) {
      const tok = this.peek();
      if (this.isKw(tok, 'as')) {
        const duplicate = sawAs;
        if (duplicate) {
          this.error(Codes.UNEXPECTED_TOKEN, 'this test already has an `as` clause', tok.span, 'list every session in one clause, comma-separated: `as admin, userA`');
        }
        sawAs = true;
        this.advance();
        // `as admin, userA` — independent, unrelated sessions a test can opt into together (P#42
        // extended); same comma-loop shape as `require env A, B, C` (parseRequire).
        if (this.completionMode && this.atCompletionPoint()) {
          this.completionResult = { kind: 'session', prefix: this.completionPrefix() };
          return null;
        }
        const first = this.expect('ident', 'a session name after `as`');
        if (first && !duplicate) sessions.push(first.value);
        while (this.check('comma')) {
          this.advance();
          if (this.completionMode && this.atCompletionPoint()) {
            this.completionResult = { kind: 'session', prefix: this.completionPrefix() };
            return null;
          }
          const s = this.expect('ident', 'a session name');
          if (s && !duplicate) sessions.push(s.value);
        }
        continue;
      }
      if (this.isKw(tok, 'retry')) {
        const duplicate = sawRetry;
        if (duplicate) {
          this.error(Codes.UNEXPECTED_TOKEN, 'this test already has a `retry` count', tok.span, 'write one `retry N` — the last one would silently win otherwise');
        }
        sawRetry = true;
        this.advance();
        const n = this.expect('number', 'a retry count, e.g. `retry 2`');
        // `retry 0` is legal and is the default — no retry. `retry 2.5` was not: the interpreter
        // computes `1 + Math.max(0, test.retry)` attempts, so two-and-a-half retries silently ran
        // three attempts, which is `retry 2`. A count of attempts is whole or it is a typo.
        if (n && !duplicate && this.settingValue(Number(n.value), n.span, `retry ${n.value}`, 0, 'a retry count is a whole number of re-runs — `retry 2` runs the test up to three times, and `retry 0` (the default) never re-runs it')) {
          retry = Number(n.value);
        }
        continue;
      }
      // `parallel`/`sequential` (D105-D107) — contextual keyword; defaults to `'sequential'` when
      // omitted (D107: the parser resolves the default itself, never left implicit downstream).
      if (this.isKw(tok, 'parallel') || this.isKw(tok, 'sequential')) {
        const word = this.advance().value as 'parallel' | 'sequential';
        if (concurrency === null) concurrency = word;
        else {
          this.error(
            Codes.UNEXPECTED_TOKEN,
            concurrency === word ? `this test is already \`${word}\`` : `this test is already \`${concurrency}\`, so it cannot also be \`${word}\``,
            tok.span,
            'a test runs one way or the other — keep the one you meant',
          );
        }
        continue;
      }
      break;
    }
    this.endLine();
    // D96 (`retry`/`with each` vs. a workload clause) is checker-enforced, not parser-enforced —
    // same layering as D19's browser-step rejection (checker.ts's `checkWorkloadTests`), since
    // it's a semantic rule about the fully-formed node, not a grammar ambiguity.
    const { workload, thresholds, cleanup, body } = this.parseTestBody('test');
    return { type: 'TestDecl', name, tags, sessions, retry, table, workload, thresholds, cleanup, concurrency: concurrency ?? 'sequential', body, span: this.spanFrom(start) };
  }

  private tagsContinue(): boolean {
    const next = this.peek(1);
    return next.type === 'tag' || this.isKw(next, 'with') || this.isKw(next, 'test') || this.isKw(next, 'crawl');
  }

  /** Is the declaration after this tag run a `crawl` rather than a `test`? (D450)
   *
   * Pure lookahead — consumes nothing — because the tags themselves belong to whichever production
   * wins, and a tag line is the one prefix the two share. `with` is not scanned past: a `with each`
   * table only ever precedes a `test`, so meeting one answers the question by itself. */
  private crawlAhead(): boolean {
    for (let i = 0; ; i++) {
      const tok = this.peek(i);
      if (tok.type === 'tag' || tok.type === 'newline') continue;
      return this.isKw(tok, 'crawl');
    }
  }

  // -- crawl (M137c, D432/D450) -------------------------------------------------

  /**
   * `crawl "the v1 API surface" as peer, shopperBearer` + an indented body of `seed`/`exclude` lines
   * and `expect …` assertions.
   *
   * Every element is taken from something the language already does — the tag lines, the quoted name
   * `--only` matches, `as`'s comma list, the indentation-based body — so what is genuinely new here is
   * two body directives and nothing else (`D450`).
   */
  private parseCrawl(): CrawlDecl | null {
    const start = this.peek().span.start;
    const tags: string[] = [];
    while (this.check('tag') || (this.check('newline') && tags.length > 0 && this.tagsContinue())) {
      if (this.check('tag')) tags.push(this.advance().value);
      else this.advance();
    }
    if (!this.expectKw('crawl')) return null;
    const name = this.expectString('a crawl name string, e.g. `crawl "the v1 API surface"`');
    if (!name) return null;
    const sessions: string[] = [];
    let sawAs = false;
    while (this.isKw(this.peek(), 'as')) {
      const tok = this.peek();
      const duplicate = sawAs;
      // Same message and same keep-parsing recovery as `test`'s (`A2-06`): bailing out of the header
      // would abandon the declaration and report its whole body as stray top-level lines.
      if (duplicate) {
        this.error(Codes.UNEXPECTED_TOKEN, 'this crawl already has an `as` clause', tok.span, 'list every session in one clause, comma-separated: `as peer, shopperBearer`');
      }
      sawAs = true;
      this.advance();
      if (this.completionMode && this.atCompletionPoint()) {
        this.completionResult = { kind: 'session', prefix: this.completionPrefix() };
        return null;
      }
      const first = this.expect('ident', 'a session name after `as`');
      if (first && !duplicate) sessions.push(first.value);
      while (this.check('comma')) {
        this.advance();
        if (this.completionMode && this.atCompletionPoint()) {
          this.completionResult = { kind: 'session', prefix: this.completionPrefix() };
          return null;
        }
        const s = this.expect('ident', 'a session name');
        if (s && !duplicate) sessions.push(s.value);
      }
    }
    this.endLine();
    const { seeds, excludes, body } = this.parseCrawlBody();
    return { type: 'CrawlDecl', name, tags, sessions, seeds, excludes, body, span: this.spanFrom(start) };
  }

  /** A crawl body: `seed …` / `exclude …` directives interleaved with ordinary steps, the same shape
   * `parseTestBody` uses for `workload`/`threshold`/`cleanup`. The steps are **not** restricted here —
   * a crawl body holding an `api GET /orders` line is a semantic error about a fully-formed node, so
   * the checker owns it, the same layering `D96` and `D19` already use. */
  private parseCrawlBody(): { seeds: CrawlSeed[]; excludes: StringLit[]; body: Step[] } {
    const seeds: CrawlSeed[] = [];
    const excludes: StringLit[] = [];
    const body: Step[] = [];
    if (!this.check('indent')) {
      this.error(Codes.EMPTY_BLOCK, 'this `crawl` has no body', this.peek().span, 'indent at least one `seed` line and one `expect` under the `crawl` line');
      return { seeds, excludes, body };
    }
    this.advance(); // indent
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      const tok = this.peek();
      if (this.isKw(tok, 'seed')) {
        const seed = this.parseCrawlSeed();
        if (seed) seeds.push(seed);
        else this.recover(before);
      } else if (this.isKw(tok, 'exclude')) {
        this.advance();
        const glob = this.expectString('a path glob to exclude, e.g. `exclude "/vuln/**"`');
        if (glob) {
          excludes.push(glob);
          this.endLine();
        } else this.recover(before);
      } else {
        const step = this.parseStep();
        if (step) body.push(step);
        else {
          const gap = this.malformedStepAt(before);
          if (gap) body.push(gap);
          this.recover(before);
        }
      }
      if (this.pos === before) this.advance(); // guarantee progress
    }
    if (this.check('dedent')) this.advance();
    return { seeds, excludes, body };
  }

  /** `seed openapi "<path>"` | `seed traffic` (D435/D436). Two words, and the error names both rather
   * than saying "unexpected": a seed the crawl does not understand is a surface it will not reach, and
   * `TF068` would then report an empty surface without saying which line was ignored. */
  private parseCrawlSeed(): CrawlSeed | null {
    const start = this.peek().span.start;
    this.advance(); // `seed`
    const tok = this.peek();
    if (this.isKw(tok, 'openapi')) {
      this.advance();
      const source = this.expectString('a URL or path for the OpenAPI document, e.g. `seed openapi "/openapi.json"`');
      if (!source) return null;
      this.endLine();
      return { type: 'OpenApiSeed', source, span: this.spanFrom(start) };
    }
    if (this.isKw(tok, 'traffic')) {
      this.advance();
      this.endLine();
      return { type: 'TrafficSeed', span: this.spanFrom(start) };
    }
    if (this.isKw(tok, 'spider')) {
      this.advance();
      const root = this.expectString('a URL or path to start the walk from, e.g. `seed spider "/admin"`');
      if (!root) return null;
      this.endLine();
      const caps = this.parseSpiderCaps();
      return {
        type: 'SpiderSeed',
        root,
        ...(caps.maxPages ? { maxPages: caps.maxPages } : {}),
        ...(caps.maxDepth ? { maxDepth: caps.maxDepth } : {}),
        span: this.spanFrom(start),
      };
    }
    this.error(
      Codes.UNEXPECTED_TOKEN,
      `expected \`openapi\`, \`traffic\` or \`spider\` after \`seed\`, found ${describeToken(tok)}`,
      tok.span,
      'a crawl seeds from the documented surface (`seed openapi "/openapi.json"`), from this run\'s own captured requests (`seed traffic`), or by walking a site\'s links and forms (`seed spider "/admin"`)',
    );
    return null;
  }

  /** The optional indented block under a `seed spider` line — `max pages 200` / `max depth 3`
   * (`M137f`, `D435`/`D442`/`D483`).
   *
   * Sub-clauses indented beneath the declaration, which is `authorized target`'s idiom (SPEC §3.10)
   * rather than a new one, per `D450`. Both are optional and the runtime defaults them, so an absent
   * block and a block declaring neither are the same answer and the caller has one shape to handle —
   * `parseAuthorizedTargetSubClauses`'s rule, for the same reason.
   *
   * The caps exist because the spider is the one place in this arc where volume is genuinely unknown
   * before the work starts (`D435`). Everything else the crawl sends is enumerated from a finite
   * document, and `D435` refuses to cap a quantity it already knows exactly. */
  private parseSpiderCaps(): { maxPages?: NumberLit; maxDepth?: NumberLit } {
    const caps: { maxPages?: NumberLit; maxDepth?: NumberLit } = {};
    if (!this.check('indent')) return caps;
    this.advance(); // indent
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      const tok = this.peek();
      if (!this.isKw(tok, 'max')) {
        this.error(
          Codes.UNEXPECTED_TOKEN,
          `expected \`max pages\` or \`max depth\` under \`seed spider\`, found ${describeToken(tok)}`,
          tok.span,
          'a spider takes two optional bounds, each on its own indented line: `max pages 200` and `max depth 3`',
        );
        this.synchronize();
        if (this.pos === before) this.advance();
        continue;
      }
      this.advance(); // `max`
      const word = this.peek();
      const which = this.isKw(word, 'pages') ? 'maxPages' : this.isKw(word, 'depth') ? 'maxDepth' : undefined;
      if (!which) {
        const near = word.type === 'ident' ? suggest(word.value, ['pages', 'depth']) : undefined;
        this.error(
          Codes.UNEXPECTED_TOKEN,
          `expected \`max pages\` or \`max depth\`, found ${describeToken(word)}`,
          word.span,
          near ? `did you mean \`max ${near}\`?` : 'a spider bounds how many pages it fetches (`max pages 200`) and how far it follows links (`max depth 3`)',
        );
        this.synchronize();
        if (this.pos === before) this.advance();
        continue;
      }
      this.advance(); // `pages` / `depth`
      const numTok = this.peek();
      if (numTok.type !== 'number') {
        this.error(
          Codes.UNEXPECTED_TOKEN,
          `expected a whole number after \`max ${which === 'maxPages' ? 'pages' : 'depth'}\`, found ${describeToken(numTok)}`,
          numTok.span,
          'the bound is a count, e.g. `max pages 200`',
        );
        this.synchronize();
        if (this.pos === before) this.advance();
        continue;
      }
      this.advance();
      caps[which] = { type: 'NumberLit', value: Number(numTok.value), raw: numTok.raw, span: numTok.span };
      this.endLine();
    }
    if (this.check('dedent')) this.advance();
    return caps;
  }

  // -- data tables (P#10, P#24) -------------------------------------------------

  private parseDataTable(): DataTable | null {
    const start = this.peek().span.start;
    this.advance(); // `with`
    if (!this.expectKw('each')) return null;
    if (this.isKw(this.peek(), 'from')) {
      this.advance();
      const path = this.expectString('a data file path, e.g. `with each from "./data/x.csv"`');
      if (!path) return null;
      this.endLine();
      return { type: 'FileDataTable', path, span: this.spanFrom(start) };
    }
    this.endLine();
    if (!this.check('indent')) {
      this.error(Codes.EMPTY_BLOCK, 'this `with each` table has no rows', this.peek().span, 'indent a header row and at least one data row, e.g. `| col | … |`');
      return null;
    }
    this.advance(); // indent
    // `M147c`/`A2-11` — the header's own uniqueness, carried through the row so each name is judged
    // against the ones already read rather than against a list assembled afterwards. A `Set` here
    // and not a scan of `columns` because a duplicate must still be *kept* in `columns` (see
    // `parseTableColumnName`), so `columns` stops being the list of names seen exactly once.
    const seenColumns = new Set<string>();
    const columns = this.parseTableRow('a column name', () => this.parseTableColumnName(seenColumns));
    if (!columns) {
      // Discard the whole table, not just the header line (M83, C11/`A2-05`). The old form only
      // synchronized past the header and then looked for a `dedent` that the *data rows* were still
      // in the way of, so `parseTest` resumed on a `|` — and one quoted header cell cost three
      // errors: the real one, then ``expected `test`, found `|` ``, then a top-level complaint about
      // the dedent, neither of the last two describing anything the user did.
      this.synchronize();
      this.skipBlockBody();
      return null;
    }
    const rows: Value[][] = [];
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      const row = this.parseTableRow('a cell value', () => this.parseValue());
      if (row) {
        if (row.length !== columns.length) {
          this.error(
            Codes.UNEXPECTED_TOKEN,
            `expected ${columns.length} cell(s) in this table row (matching the header), found ${row.length}`,
            this.spanFrom(before < this.tokens.length ? this.tokens[before]!.span.start : start),
          );
        } else {
          rows.push(row);
        }
      } else {
        this.synchronize();
      }
      if (this.pos === before) this.advance(); // guarantee progress
    }
    if (this.check('dedent')) this.advance();
    if (rows.length === 0) {
      this.error(Codes.EMPTY_BLOCK, 'this `with each` table has a header but no data rows', this.spanFrom(start), 'add at least one data row below the header, e.g. `| "value" |`');
    }
    return { type: 'InlineDataTable', columns, rows, span: this.spanFrom(start) };
  }

  private parseTableColumnName(seen: Set<string>): string | null {
    const tok = this.peek();
    if (tok.type === 'string') {
      // A `with each` table quotes its *cells* and not its *column names*, and the likeliest way to
      // get the header wrong is to write it the way every other row in the same table is written
      // (M84, C11/`A2-05`). The generic ``expected a name`` never mentioned that split — which is
      // the entire content of the mistake — so say which half is quoted, and show the correction.
      this.error(
        Codes.UNEXPECTED_TOKEN,
        `expected a column name, found ${describeToken(tok)}`,
        tok.span,
        `column names are bare words — write \`${tok.value}\`, not \`${tok.raw}\`; only the data cells below the header are quoted`,
      );
      return null;
    }
    const name = this.expect('ident', 'a column name');
    if (!name) return null;
    // `M147c`/`A2-11` — judged **here**, inside the loop that reads the header, and not over
    // `columns` once `parseTableRow` has returned. The obvious post-hoc version was written first
    // and measured: M83's panic mode drops any diagnostic raised without the cursor having moved
    // (`this.pos === this.lastErrorPos`), and after the header is read the cursor does not move
    // between one complaint and the next — so `| id | id | id |` reported once instead of twice,
    // and the caret pointed past the whole header rather than at a name. Reading each name first
    // gives both properties for free: a `|` is consumed between any two complaints, and the token
    // whose span is wanted is in hand. `TF071`'s `viewport` pair learnt the same lesson from the
    // other end — there the two numbers are adjacent, so the reading itself had to be interleaved.
    if (seen.has(name.value)) {
      this.error(
        Codes.DUPLICATE_TABLE_COLUMN,
        `duplicate table column \`${name.value}\``,
        name.span,
        `a row binds each column name once, so this \`${name.value}\` wins and every cell under the earlier one is discarded without a word — rename one`,
      );
    }
    seen.add(name.value);
    // Returned anyway, and kept in `columns`. The header's *width* is what every data row below is
    // matched against, so dropping the offending name would turn one mistake into a
    // ``expected N cell(s) in this table row`` for every row in the table — the cascade M83 spent a
    // milestone removing from this very production.
    return name.value;
  }

  /** One `| cell | cell | … |` line, generic over what a cell is (a column-name ident for the
   * header, a full `Value` expression for data rows). */
  private parseTableRow<T>(what: string, parseCell: () => T | null): T[] | null {
    if (!this.expect('pipe', '`|` to start the table row')) return null;
    const cells: T[] = [];
    while (!this.check('newline') && !this.check('dedent') && !this.atEof()) {
      const cell = parseCell();
      if (!cell) return null;
      cells.push(cell);
      if (!this.expect('pipe', `\`|\` after ${what}`)) return null;
    }
    this.endLine();
    return cells;
  }

  private parseBlock(context = 'test'): Step[] {
    if (!this.check('indent')) {
      this.error(Codes.EMPTY_BLOCK, `this \`${context}\` has no steps`, this.peek().span, `indent at least one step under the \`${context}\` line`);
      return [];
    }
    this.advance(); // indent
    const steps: Step[] = [];
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      const step = this.parseStep();
      if (step) steps.push(step);
      else {
        const gap = this.malformedStepAt(before);
        if (gap) steps.push(gap);
        this.synchronize();
      }
      if (this.pos === before) this.advance(); // guarantee progress
    }
    if (this.check('dedent')) this.advance();
    return steps;
  }

  private parseStep(): Step | null {
    if (this.completionMode && this.atCompletionPoint()) {
      this.completionResult = { kind: 'step', prefix: this.completionPrefix() };
      return null;
    }
    const tok = this.peek();
    if (tok.type === 'ident') {
      switch (tok.value) {
        case 'api':
          return this.parseApiStep();
        case 'expect':
          return this.parseExpect(false);
        case 'check':
          return this.parseCheckStep();
        case 'let':
          return this.parseLet();
        case 'capture':
          return this.parseCapture();
        case 'log':
          return this.parseLogStep();
        case 'wait':
          return this.parseWaitUntil();
        case 'give':
          return this.parseGive();
        case 'open':
          return this.parseOpenStep();
        case 'click':
          return this.parseClickStep('single');
        case 'double':
          return this.parseDoubleOrRightClickStep('double');
        case 'right':
          return this.parseDoubleOrRightClickStep('right');
        case 'fill':
          return this.parseFillStep();
        case 'select':
          return this.parseSelectStep();
        case 'tick':
          return this.parseTickStep();
        case 'untick':
          return this.parseUntickStep();
        case 'uncheck':
          this.refuse('uncheck', tok.span);
          return null;
        case 'press':
          return this.parsePressStep();
        case 'hover':
          return this.parseHoverStep();
        case 'scroll':
          return this.parseScrollStep();
        case 'within':
          return this.parseWithinStep();
        case 'accept':
          return this.parseDialogStep('accept');
        case 'dismiss':
          return this.parseDialogStep('dismiss');
        case 'switch':
          return this.parseSwitchStep();
        case 'close':
          return this.parseCloseTabStep();
        case 'download':
          return this.parseDownloadStep();
        case 'drag':
          return this.parseDragStep();
        case 'drop':
          return this.parseDropFileStep();
        case 'screenshot':
          return this.parseScreenshotStep();
        case 'stub':
          return this.parseStubStep();
        case 'pause':
          return this.parsePause();
        case 'think':
          this.refuse('think', tok.span);
          return null;
        default: {
          if (this.looksLikeCallStart()) return this.parseCallStmt(tok);
          const hint = suggest(tok.value, SUGGESTABLE_STATEMENT_KEYWORDS);
          this.error(
            Codes.UNKNOWN_STATEMENT,
            `unknown step \`${tok.value}\``,
            tok.span,
            hint ? `did you mean \`${hint}\`?` : `expected one of: ${SUGGESTABLE_STATEMENT_KEYWORDS.join(', ')}`,
            'not a known step keyword',
          );
          return null;
        }
      }
    }
    this.error(Codes.UNKNOWN_STATEMENT, `expected a step, found ${describeToken(tok)}`, tok.span);
    return null;
  }

  /** Lookahead-only (no tokens consumed): does the step starting here have the shape of a bare
   * call (`name(...)`  or `multi word name(...)`)? Mirrors `parseIdentOrCall`'s own lookahead
   * (M6, P#2) — checked before falling into the "unknown step" error so a call needs no `let`. */
  private looksLikeCallStart(): boolean {
    let k = 0;
    while (this.peek(k).type === 'ident') k++;
    return k > 0 && this.peek(k).type === 'lparen';
  }

  /** `login("alice", "secret1")` — a call statement (M6). Only reached once `looksLikeCallStart`
   * has confirmed the `ident+ lparen` shape, so `parseIdentOrCall` always returns a `CallExpr`
   * here (never a bare `VarRef`). */
  private parseCallStmt(first: Token): Step | null {
    const start = first.span.start;
    const value = this.parseIdentOrCall(first);
    if (!value) return null;
    this.endLine();
    return { type: 'CallStmt', call: value as CallExpr, span: this.spanFrom(start) };
  }

  // -- api step --------------------------------------------------------------

  private parseApiStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `api`
    const spec = this.parseApiRequestLine();
    if (!spec) return null;
    // `as "checkout"` (M43, D67/D68) — trailing on the request line itself, only ever parsed for
    // a plain `api` step (not `wait until api`, which calls `parseApiRequestLine` directly and
    // never reaches here) — mirrors how `retryAfter` is likewise only ever set here.
    let tag: StringLit | null = null;
    if (this.isKw(this.peek(), 'as')) {
      this.advance();
      tag = this.expectString('a label string after `as`, e.g. `api POST /orders as "checkout"`');
      if (!tag) return null;
    }
    this.endLine();
    const { headers, retryAfter } = this.parseApiHeaders();
    return { type: 'ApiStep', ...spec, tag, headers: [...spec.headers, ...headers], retryAfter, span: this.spanFrom(start) };
  }

  /** The shared `[<service>] METHOD PATH [body-form] [timeout <dur>] [without redirects]` line,
   * used by both `api …` steps and `wait until api …` (SPEC §5.1, §5.5). Caller consumes `api`. */
  private parseApiRequestLine(): ApiRequestSpec | null {
    let service: string | null = null;
    let method: HttpMethod | null = null;

    const first = this.peek();
    if (first.type === 'ident' && this.isMethodWord(first)) {
      method = this.advance().value.toUpperCase() as HttpMethod;
    } else if (first.type === 'ident' && this.peek(1).type === 'ident' && this.isMethodWord(this.peek(1))) {
      service = this.advance().value; // service name
      method = this.advance().value.toUpperCase() as HttpMethod;
    } else {
      const hint = first.type === 'ident' ? suggest(first.value, METHODS as unknown as string[]) : undefined;
      this.error(
        Codes.UNKNOWN_METHOD,
        `expected an HTTP method (${METHODS.join(', ')}), found ${describeToken(first)}`,
        first.span,
        hint ? `did you mean \`${hint}\`?` : undefined,
      );
      return null;
    }

    const pathTok = this.peek();
    if (pathTok.type !== 'path') {
      this.error(Codes.UNEXPECTED_TOKEN, `expected a path like \`/orders\`, found ${describeToken(pathTok)}`, pathTok.span);
      return null;
    }
    this.advance();
    const path: PathExpr = { type: 'PathExpr', raw: pathTok.value, span: pathTok.span };

    let body: ApiBody | null = null;
    if (this.isKw(this.peek(), 'body') || this.isKw(this.peek(), 'form') || this.isKw(this.peek(), 'upload')) {
      body = this.parseApiBody();
      if (!body) return null;
    }

    // `!this.atWaitBudget()` is the whole of D640's disambiguation, and it is deliberately read
    // from *this* side rather than only from the clause it protects: the per-request `timeout` must
    // decline precisely what the per-step wait budget takes, and one predicate consulted by both
    // makes that an invariant instead of a coincidence. A plain `api` step has no wait budget, so
    // `api GET /x timeout wait 5m` falls through to `endLine()` — see `trailingHint`.
    let timeoutMs: number | null = null;
    if (this.isKw(this.peek(), 'timeout') && !this.atWaitBudget()) {
      this.advance();
      timeoutMs = this.parseDuration();
      if (timeoutMs === null) return null;
    }

    let followRedirects = true;
    if (this.isKw(this.peek(), 'without')) {
      this.advance();
      if (!this.expectKw('redirects')) return null;
      followRedirects = false;
    }

    return { service, method: method!, path, body, headers: [], timeoutMs, followRedirects, retryAfter: null, tag: null };
  }

  private parseApiBody(): ApiBody | null {
    const tok = this.peek();
    if (this.isKw(tok, 'form')) return this.parseFormBody();
    if (this.isKw(tok, 'upload')) return this.parseUploadBody();
    // `body …` — dispatch on what follows `body`.
    const start = tok.span.start;
    this.advance(); // `body`
    if (this.isKw(this.peek(), 'from')) {
      this.advance();
      const path = this.expectString('a file path string, e.g. `body from "./payloads/order.json"`');
      if (!path) return null;
      return { type: 'FileBody', path, span: this.spanFrom(start) };
    }
    if (this.isKw(this.peek(), 'text')) {
      this.advance();
      const value = this.expectString('a raw payload string, e.g. `body text "plain payload"`');
      if (!value) return null;
      return { type: 'TextBody', value, span: this.spanFrom(start) };
    }
    const value = this.parseJsonDocument('the request body');
    if (!value) return null;
    return { type: 'InlineBody', value, span: this.spanFrom(start) };
  }

  /** **A `body` is a JSON document, not specifically an object** (`M147d`, `A3-12`, D639).
   *
   *  The dispatch is on the opening bracket, because that is the only thing that distinguishes the
   *  two, and both sub-parsers already existed and were already reachable from every other value
   *  position — an array body was refused by one `expect('lbrace', …)` and by nothing else.
   *
   *  **What this deliberately does not widen** is the set of things a `body` may be. A top-level
   *  scalar — `body 5`, `body "text"` — is still refused, because `body text "…"` is the form for a
   *  payload that is not a JSON document and it already exists; accepting a bare string here would
   *  give the language two spellings for one thing, which is the defect `D638` had just finished
   *  removing from the time units one slice earlier.
   *
   *  The refusal is raised here rather than inside `parseObject`. That helper is shared with nested
   *  values, `with each` rows and `stub`'s pre-D639 callers, and every one of those really does want
   *  an object — widening its message would make it lie at five sites to tell the truth at two. */
  private parseJsonDocument(what: string): ObjectLit | ArrayLit | null {
    if (this.check('lbracket')) return this.parseArray();
    if (this.check('lbrace')) return this.parseObject();
    const tok = this.peek();
    this.error(
      Codes.UNEXPECTED_TOKEN,
      `expected \`{\` or \`[\` to start ${what}, found ${describeToken(tok)}`,
      tok.span,
      'a `body` is a JSON object or array — for anything else, use `body text "…"`',
    );
    return null;
  }

  private parseFormBody(): FormBody | null {
    const start = this.peek().span.start;
    this.advance(); // `form`
    const fields = this.parseFormFields();
    if (!fields) return null;
    return { type: 'FormBody', fields, span: this.spanFrom(start) };
  }

  private parseUploadBody(): UploadBody | null {
    const start = this.peek().span.start;
    this.advance(); // `upload`
    const filePath = this.expectString('a file path string, e.g. `upload "./files/img.png" as "avatar"`');
    if (!filePath) return null;
    if (!this.expectKw('as')) return null;
    const fieldName = this.expectString('a field name string after `as`');
    if (!fieldName) return null;
    let contentType: StringLit | null = null;
    if (this.isKw(this.peek(), 'type')) {
      this.advance();
      contentType = this.expectString('a MIME type string after `type`, e.g. `type "image/png"`');
      if (!contentType) return null;
    }
    let extra: FormField[] = [];
    if (this.isKw(this.peek(), 'form')) {
      this.advance();
      const fields = this.parseFormFields();
      if (!fields) return null;
      extra = fields;
    }
    return { type: 'UploadBody', filePath, fieldName, contentType, extra, span: this.spanFrom(start) };
  }

  private parseFormFields(): FormField[] | null {
    const fields: FormField[] = [];
    for (;;) {
      const start = this.peek().span.start;
      const key = this.expect('ident', 'a field name, e.g. `form user=…`');
      if (!key) return null;
      if (!this.expect('equals', '`=` after the field name')) return null;
      const value = this.parseValue();
      if (!value) return null;
      fields.push({ type: 'FormField', key: key.value, value, span: this.spanFrom(start) });
      if (this.check('comma')) {
        this.advance();
        continue;
      }
      break;
    }
    return fields;
  }

  /** An optional indented block beneath an api step: `header "…" is <value>` lines (SPEC §5.1)
   * and/or one `retry honoring "Retry-After" up to N` line (SPEC §5.1, PLAN decision 102b,
   * enterprise arc cluster 3). */
  private parseApiHeaders(): { headers: ApiHeader[]; retryAfter: RetryAfterClause | null } {
    const headers: ApiHeader[] = [];
    let retryAfter: RetryAfterClause | null = null;
    if (!this.check('indent')) return { headers, retryAfter };
    this.advance(); // indent
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      if (this.isKw(this.peek(), 'header')) {
        const header = this.parseHeaderLine();
        if (header) headers.push(header);
      } else if (this.isKw(this.peek(), 'retry')) {
        const clause = this.parseRetryAfterClause();
        if (clause) retryAfter = clause;
      } else {
        this.error(Codes.UNEXPECTED_TOKEN, `only \`header\` or \`retry honoring\` lines may follow an api step, found ${describeToken(this.peek())}`, this.peek().span);
        this.synchronize();
      }
      if (this.pos === before) this.advance();
    }
    if (this.check('dedent')) this.advance();
    return { headers, retryAfter };
  }

  /** `retry honoring "Retry-After" up to N` — a per-`api`-step retry clause (SPEC §5.1, PLAN
   * decision 102b, enterprise arc cluster 3, closes TFLW-GAPS.md gap #5). Caller has already
   * confirmed the `retry` keyword is next. The header-name string is validated against a known
   * list (today just `"Retry-After"`) the same way `evidence <level>` validates its string. */
  private parseRetryAfterClause(): RetryAfterClause | null {
    const start = this.peek().span.start;
    this.advance(); // `retry`
    if (!this.expectKw('honoring')) {
      this.synchronize();
      return null;
    }
    const headerName = this.expectString('the header name to honor, e.g. `retry honoring "Retry-After" up to 3`');
    if (!headerName) {
      this.synchronize();
      return null;
    }
    if (!(RETRY_AFTER_HEADERS as readonly string[]).includes(headerName.value)) {
      const hint = suggest(headerName.value, RETRY_AFTER_HEADERS);
      this.error(
        Codes.UNEXPECTED_TOKEN,
        `\`retry honoring\` doesn't support "${headerName.value}"`,
        headerName.span,
        hint ? `did you mean \`${hint}\`?` : `expected one of: ${RETRY_AFTER_HEADERS.join(', ')}`,
      );
      this.synchronize();
      return null;
    }
    if (!this.expectKw('up')) {
      this.synchronize();
      return null;
    }
    if (!this.expectKw('to')) {
      this.synchronize();
      return null;
    }
    const num = this.expect('number', 'a max retry count, e.g. `up to 3`');
    if (!num) {
      this.synchronize();
      return null;
    }
    // Same rule, same family, one line away — and `up to 0` stays legal for the same reason
    // `retry 0` does: it says "honour the header, then don't re-issue", which is a position, not a
    // mistake. Only the fractional case is new here.
    if (!this.settingValue(Number(num.value), num.span, `up to ${num.value}`, 0, 'a maximum number of re-issues is whole — `up to 3` re-sends this one request at most three times, and `up to 0` never re-sends it')) {
      this.endLine();
      return null;
    }
    this.endLine();
    return { type: 'RetryAfterClause', max: Number(num.value), span: this.spanFrom(start) };
  }

  /** One `header "…" is <value>` line — shared by an api step's header sub-block (`parseApiHeaders`)
   * and `wait until api`'s own header lines (`parseWaitUntilBody`, SPEC §5.5). Caller has already
   * confirmed the `header` keyword is next. */
  private parseHeaderLine(): ApiHeader | null {
    const start = this.peek().span.start;
    this.advance(); // `header`
    const name = this.expectString('a header name string, e.g. `header "Authorization"`');
    if (!name || !this.expectKw('is')) {
      this.synchronize();
      return null;
    }
    const value = this.parseValue();
    if (!value) {
      this.synchronize();
      return null;
    }
    this.endLine();
    return { type: 'ApiHeader', name, value, span: this.spanFrom(start) };
  }

  // -- wait until api / wait until <ui> ---------------------------------------

  /** True at the two-token opener of a per-step wait budget, `timeout wait <duration>` (`M147d`,
   * `A3-10`, D640).
   *
   * Exists as a predicate rather than as an inline test because it is read from **both** sides of
   * the ambiguity it resolves: `parseApiRequestLine` must decline exactly what `parseWaitBudget`
   * takes, or `wait until api GET /jobs timeout wait 5m` loses its first token to the per-request
   * clause and dies on ``expected a duration … found `wait` ``. Two copies of that test would agree
   * until one of them was edited. */
  private atWaitBudget(): boolean {
    return this.isKw(this.peek(), 'timeout') && this.isKw(this.peek(1), 'wait');
  }

  /** `timeout wait <duration>` — how long *this* `wait until` may poll, overriding the active env's
   * `timeout wait` for one step (`M147d`, `A3-10`, D640). Shared by both forms; absent means the
   * config value, exactly as before.
   *
   * **Why this spelling and not the bare `timeout` the row asked for.** `A3-10` observed that `wait
   * until api … timeout 30s` parses while the locator form's `timeout 30s` is `TF010`, and read the
   * difference as a capability. It is not: on the api form `timeout` sets *one poll's request*
   * timeout, which decision 67 then clamps to what remains of the wait deadline — it cannot extend
   * the wait at all. The locator form has no request for that clause to bound, and the budget the
   * row's author actually wanted was un-overridable on **both** forms. So copying the bare spelling
   * across would have made one word mean the request budget on one sibling and the step budget on
   * the other, inside a single statement. Naming the config key it overrides keeps them separable,
   * and lets a poll state both at once:
   *
   *     wait until api GET /jobs timeout 5s timeout wait 5m
   *
   * — no single poll may hang past 5s, and the whole step gives up after five minutes.
   *
   * Returns `{ ok: false }` when the duration itself was malformed; `parseDuration` has already
   * reported, and the caller aborts the step the way every other clause here does. */
  private parseWaitBudget(): { ok: boolean; ms: number | null } {
    if (!this.atWaitBudget()) return { ok: true, ms: null };
    this.advance(); // `timeout`
    this.advance(); // `wait`
    const ms = this.parseDuration();
    if (ms === null) return { ok: false, ms: null };
    return { ok: true, ms };
  }

  /** `wait until …` — dispatches on what follows `until`: `api …` re-issues a request until its
   * nested `expect`s pass or wait times out (SPEC §5.5, P#15); anything else is parsed as a UI
   * locator condition (SPEC §9.5, M3b). Caller has not yet consumed `wait`. */
  private parseWaitUntil(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `wait`
    if (!this.expectKw('until')) return null;
    if (this.isKw(this.peek(), 'api')) return this.parseWaitUntilApiRest(start);
    return this.parseWaitUntilUiRest(start);
  }

  private parseWaitUntilApiRest(start: Position): Step | null {
    this.advance(); // `api`
    const request = this.parseApiRequestLine();
    if (!request) return null;
    const budget = this.parseWaitBudget();
    if (!budget.ok) return null;
    // FS-05 scoped `for <duration>` to the UI form, where the measured gap was ("the error toast
    // never appears"). Someone who learned it there will try it here, so say what it costs rather
    // than letting `endLine()` report a bare unexpected `for`: sustaining an API condition means
    // re-issuing the request for the whole window, which is a different amount of load, not a
    // different amount of waiting. Adding it later stays purely additive.
    if (this.isKw(this.peek(), 'for')) {
      this.error(
        Codes.UNEXPECTED_TOKEN,
        '`for <duration>` is not supported on `wait until api …`',
        this.peek().span,
        'it holds only on the UI form (`wait until text "Error" is hidden for 2s`) — an API condition sustained over a window means re-issuing the request for that whole window, which is load, not waiting; write the repetition as a workload-bearing `test` instead',
      );
      return null;
    }
    this.endLine();
    const { headers, expects } = this.parseWaitUntilBody();
    return {
      type: 'WaitUntilApiStmt',
      request: headers.length ? { ...request, headers } : request,
      expects,
      waitMs: budget.ms,
      span: this.spanFrom(start),
    };
  }

  /** `wait until <pollable subject> [is] [not] <matcher> [for <duration>]` (SPEC §9.5, M3b; `for`
   * added by FS-05, the subject set widened past a locator by `M147d`/`A3-11`, D641) — a single
   * line, the UI sibling of `wait until api`'s block form: no separate request to re-issue, so the
   * whole condition is just an ordinary subject+matcher pair, polled against `timeout wait` instead
   * of `timeout expect`.
   *
   * The optional `for <duration>` asks for the condition to hold *continuously* for that long
   * instead of passing on the first poll that satisfies it — the only way to write a sustained
   * condition ("the error toast never appears", "the button stays disabled"), where the plain form
   * passes instantly because the thing simply has not happened yet. */
  private parseWaitUntilUiRest(start: Position): Step | null {
    const subject = this.parseSubject();
    if (!subject) return null;
    // D641 (`M147d`, `A3-11`). The old test here was `subject.type !== 'LocatorSubject'`, which
    // refused eight distinct subject shapes with one sentence — and the sentence named the one
    // spelling none of the eight was reaching for. Five of them genuinely cannot be polled and now
    // get told which of the two reasons applies to them; the other three are live browser
    // observations that `expect` has always re-read on a retry loop of its own, and were being
    // turned away by a guard that had simply never been widened past the form it was written for.
    if (!pollable(subject)) {
      const isBoundValue = subject.type === 'ValueSubject';
      this.error(
        Codes.UNEXPECTED_TOKEN,
        isBoundValue
          ? '`wait until` needs a condition that can change between polls, and a bound value cannot'
          : '`wait until` needs a condition that can change between polls, and this one reads the last `api` response',
        subject.span,
        isBoundValue
          ? 'a `{value}` holds whatever `let`/`capture` put in it and nothing between two polls rebinds it, so the step would pass on the first attempt or spin to its deadline — the same rule `TF041` states for a value subject inside `wait until api`'
          : 'a response is written once, by the `api` step that fetched it, so re-reading it cannot change the answer. To poll an endpoint until it agrees, re-issue the request — `wait until api GET /orders/1` with this assertion in its block. To poll the browser, the subjects that change on their own are a UI locator, `page`, and `request to "…"` (SPEC §9.5)',
      );
      return null;
    }
    const matcher = this.parseMatcher();
    if (!matcher) return null;
    // The subject half of D641 has a matcher half, and it has exactly one member. `matches
    // snapshot` is the one matcher in the language whose evaluation documents itself as never
    // retrying (`execSnapshotExpect`) — a screenshot is one point-in-time capture compared against
    // a committed baseline, not a condition that becomes true as the page settles. On a locator it
    // therefore parsed, and produced a `wait` that could not wait: the first poll either matched
    // the baseline or the step spent its whole budget re-comparing an image against a file, neither
    // of which the word `until` promises.
    if (matcher.name === 'matchesSnapshot') {
      this.error(
        Codes.UNEXPECTED_TOKEN,
        '`matches snapshot "…"` cannot be polled, so it is not a `wait until` condition',
        matcher.span,
        'a snapshot is compared once against a committed baseline rather than re-read as the page settles, so waiting on it cannot change the outcome — settle the page first (`wait until <locator> is visible`, or a `for <duration>` hold) and then write the comparison as its own `expect` (SPEC §9.9)',
      );
      return null;
    }
    let holdMs: number | null = null;
    if (this.isKw(this.peek(), 'for')) {
      this.advance();
      holdMs = this.parseDuration();
      if (holdMs === null) return null;
    }
    const budget = this.parseWaitBudget();
    if (!budget.ok) return null;
    this.endLine();
    const stmt: WaitUntilUiStmt = { type: 'WaitUntilUiStmt', subject, matcher, holdMs, waitMs: budget.ms, span: this.spanFrom(start) };
    return stmt;
  }

  /** The indented block under `wait until api …`: optional `header "…" is …` lines (SPEC §5.5,
   * gap #4 — mirrors an `api` step's own header sub-block so a poll can carry per-step auth,
   * namespace, or idempotency-key headers) followed by the required `expect` lines. */
  private parseWaitUntilBody(): { headers: ApiHeader[]; expects: ExpectStmt[] } {
    const headers: ApiHeader[] = [];
    const expects: ExpectStmt[] = [];
    if (!this.check('indent')) {
      this.error(Codes.EMPTY_BLOCK, 'this `wait until` has no `expect` lines', this.peek().span, 'indent at least one `expect` under the request line');
      return { headers, expects };
    }
    this.advance(); // indent
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      if (this.isKw(this.peek(), 'header')) {
        const header = this.parseHeaderLine();
        if (header) headers.push(header);
      } else if (this.isKw(this.peek(), 'expect')) {
        const stmt = this.parseExpect(false);
        if (stmt) expects.push(stmt as ExpectStmt);
        else this.synchronize();
      } else {
        this.error(Codes.UNEXPECTED_TOKEN, `only \`header\` or \`expect\` lines may follow \`wait until api\`, found ${describeToken(this.peek())}`, this.peek().span);
        this.synchronize();
      }
      if (this.pos === before) this.advance();
    }
    if (this.check('dedent')) this.advance();
    if (expects.length === 0) {
      this.error(Codes.EMPTY_BLOCK, 'this `wait until` has no `expect` lines', this.peek().span, 'indent at least one `expect` under the request line');
    }
    return { headers, expects };
  }

  private parseEnvRef(): EnvRef | null {
    const start = this.peek().span.start;
    this.advance(); // `env`
    if (!this.expect('lparen', '`(` after `env`')) return null;
    const name = this.expect('ident', 'an environment variable name, e.g. `env(API_KEY)`');
    if (!name) return null;
    if (!this.expect('rparen', '`)` to close `env(…)`')) return null;
    return { type: 'EnvRef', name: name.value, span: this.spanFrom(start) };
  }

  // -- expect ----------------------------------------------------------------

  private parseExpect(soft: boolean): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `expect` or `check`
    let quantifier: 'any' | 'all' | null = null;
    const lead = this.peek();
    if (lead.type === 'ident' && (QUANTIFIERS as readonly string[]).includes(lead.value)) {
      quantifier = this.advance().value as 'any' | 'all';
    }
    const subject = this.parseSubject();
    if (!subject) return null;
    if (quantifier && !quantifiable(subject)) {
      this.badQuantifier(quantifier, subject);
      return null;
    }
    const matcher = this.parseMatcher();
    if (!matcher) return null;
    const masks = this.parseSnapshotMasks();
    this.endLine();
    const stmt: ExpectStmt = { type: 'ExpectStmt', soft, quantifier, subject, matcher, masks, span: this.spanFrom(start) };
    return stmt;
  }

  /** `expect` and `check` each parse their own quantifier, and `check`'s bare-locator branch has a
   * third copy of the rejection — so the rule was spelled out three times and M96 would have had to
   * widen all three by hand. One statement now, one message. */
  private badQuantifier(quantifier: string, subject: Subject): void {
    this.error(
      Codes.UNEXPECTED_TOKEN,
      `\`${quantifier}\` only applies to a \`body.<path>\`, \`body csv\`, or \`{variable}\` subject`,
      subject.span,
      'drop the quantifier, or quantify over a body path or a captured array (SPEC §6.3)',
    );
  }

  private parseSubject(): Subject | null {
    if (this.completionMode && this.atCompletionPoint()) {
      this.completionResult = { kind: 'subject', prefix: this.completionPrefix() };
      return null;
    }
    const tok = this.peek();
    // M96/`FU-11` — a `{ref}` in subject position is the value subject (D129). One token of
    // lookahead is enough: `{` cannot begin any of the keyword subjects below, so this needs no
    // marker word. It is the last position in the grammar that did not honour FS-07's `{` rule.
    if (tok.type === 'lbrace') {
      const start = tok.span.start;
      const interp = this.parseInterp();
      if (!interp) return null;
      return { type: 'ValueSubject', ref: interp.ref, span: this.spanFrom(start) };
    }
    if (tok.type !== 'ident') {
      this.error(Codes.UNKNOWN_SUBJECT, `${SUBJECT_EXPECTATION}, found ${describeToken(tok)}`, tok.span);
      return null;
    }
    const start = tok.span.start;
    switch (tok.value) {
      case 'status': {
        this.advance();
        const of = this.tryParseNetworkRequestOf();
        return { type: 'StatusSubject', of, span: this.spanFrom(start) };
      }
      case 'duration':
        this.advance();
        return { type: 'DurationSubject', span: this.spanFrom(start) };
      case 'header': {
        this.advance();
        const name = this.expectString('a header name string, e.g. `header "content-type"`');
        if (!name) return null;
        const of = this.tryParseNetworkRequestOf();
        return { type: 'HeaderSubject', name, of, span: this.spanFrom(start) };
      }
      case 'body': {
        this.advance();
        if (this.isKw(this.peek(), 'text')) {
          this.advance();
          const of = this.tryParseNetworkRequestOf();
          const subj: BodyTextSubject = { type: 'BodyTextSubject', of, span: this.spanFrom(start) };
          return subj;
        }
        if (this.isKw(this.peek(), 'bytes')) {
          this.advance();
          const subj: BodyBytesSubject = { type: 'BodyBytesSubject', span: this.spanFrom(start) };
          return subj;
        }
        if (this.isKw(this.peek(), 'csv')) {
          this.advance();
          const path = this.parseBodyPath();
          const subj: BodyCsvSubject = { type: 'BodyCsvSubject', path, span: this.spanFrom(start) };
          return subj;
        }
        if (this.isKw(this.peek(), 'pdf')) {
          this.advance();
          if (!this.expectKw('text')) return null; // `body pdf <x>` — only `text` is defined for v1
          const subj: BodyPdfTextSubject = { type: 'BodyPdfTextSubject', span: this.spanFrom(start) };
          return subj;
        }
        const path = this.parseBodyPath();
        const of = this.tryParseNetworkRequestOf();
        const subj: BodySubject = { type: 'BodySubject', path, of, span: this.spanFrom(start) };
        return subj;
      }
      case 'request': {
        this.advance();
        // `request to "<url>"` (M3d) is lexically similar to but semantically distinct from a bare
        // `request` (SPEC §6.2.2, `connects`/`fails`) — disambiguated on whether `to` follows.
        if (this.isKw(this.peek(), 'to')) {
          const ref = this.parseNetworkRequestRef();
          if (!ref) return null;
          return { type: 'NetworkRequestSubject', ref, span: this.spanFrom(start) };
        }
        return { type: 'RequestSubject', span: this.spanFrom(start) };
      }
      case 'button':
      case 'field':
      case 'text':
      case 'list':
      case 'css':
      case 'xpath': {
        const locator = this.parseLocator();
        if (!locator) return null;
        return { type: 'LocatorSubject', locator, span: this.spanFrom(start) };
      }
      case 'page': {
        this.advance();
        return { type: 'PageSubject', span: this.spanFrom(start) };
      }
      case 'response': {
        this.advance();
        return { type: 'ResponseSubject', span: this.spanFrom(start) };
      }
      default: {
        const hint = suggest(tok.value, SUBJECT_KEYWORDS);
        this.error(
          Codes.UNKNOWN_SUBJECT,
          `unknown subject \`${tok.value}\``,
          tok.span,
          // A bare word here is either a misspelled keyword or a value the user bound and expected
          // to assert on (M96/`FU-11`). The did-you-mean wins when it exists — `statuss` is a typo,
          // not a variable — so the brace hint is offered only when nothing was close enough.
          hint
            ? `did you mean \`${hint}\`?`
            : `expected one of: ${SUBJECT_KEYWORDS.join(', ')} — or, if \`${tok.value}\` is a value you bound with \`let\`/\`capture\`, write \`{${tok.value}}\``,
        );
        return null;
      }
    }
  }

  private parseBodyPath(): PathSegment[] {
    const segs: PathSegment[] = [];
    while (this.check('dot') || this.check('lbracket')) {
      if (this.check('dot')) {
        this.advance();
        const name = this.expect('ident', 'a property name after `.`');
        if (!name) break;
        segs.push({ kind: 'prop', name: name.value });
      } else {
        this.advance(); // [
        const idx = this.expect('number', 'an array index');
        let index = 0;
        if (idx) index = Number(idx.value);
        this.expect('rbracket', '`]` to close the index');
        segs.push({ kind: 'index', index });
      }
    }
    return segs;
  }

  /** `to "<url-pattern>" [with method "<M>"]` (M3d) — caller has already peeked `to`. Shared by the
   * bare `request to "…"` subject and the `of request to "…"` clause below. */
  private parseNetworkRequestRef(): NetworkRequestRef | null {
    const start = this.peek().span.start;
    this.advance(); // `to`
    const urlPattern = this.expectString('a URL pattern string, e.g. `request to "/api/orders"`');
    if (!urlPattern) return null;
    let method: StringLit | null = null;
    if (this.isKw(this.peek(), 'with')) {
      this.advance();
      if (!this.expectKw('method')) return null;
      method = this.expectString('an HTTP method string, e.g. `with method "POST"`');
      if (!method) return null;
    }
    return { type: 'NetworkRequestRef', urlPattern, method, span: this.spanFrom(start) };
  }

  /** `of request to "<url>" [with method "<M>"]` (M3d) — optional trailing clause on
   * `status`/`header`/`body`/`body text`; absent (`null`) keeps today's unchanged
   * last-`api`-step-response behavior. */
  private tryParseNetworkRequestOf(): NetworkRequestRef | null {
    if (!this.isKw(this.peek(), 'of')) return null;
    this.advance(); // `of`
    if (!this.expectKw('request')) return null;
    if (!this.isKw(this.peek(), 'to')) {
      const tok = this.peek();
      this.error(Codes.UNEXPECTED_TOKEN, `expected \`to\` after \`of request\`, found ${describeToken(tok)}`, tok.span, 'e.g. `status of request to "/api/orders"`');
      return null;
    }
    return this.parseNetworkRequestRef();
  }

  /** `[is] [not] <matcher>` (FS-08). `is` is an optional copula carrying no meaning, and it may sit
   * on either side of `not`, so all four spellings parse: `is not visible`, `not is visible`,
   * `is visible`, `not visible`. Docs teach `is not visible` — the form SPEC §6.2 already documented
   * before it parsed. Because `is` is consumed and discarded here, `greater`/`less` and the state
   * words dispatch at the top level of the switch below rather than only under an `is` branch. */
  private parseMatcher(): Matcher | null {
    const start = this.peek().span.start;
    let negated = false;
    let sawCopula = false;
    for (;;) {
      const t = this.peek();
      if (!sawCopula && this.isKw(t, 'is')) {
        this.advance();
        sawCopula = true;
        continue;
      }
      if (!negated && this.isKw(t, 'not')) {
        this.advance();
        negated = true;
        continue;
      }
      break;
    }
    if (this.completionMode && this.atCompletionPoint()) {
      this.completionResult = { kind: 'matcher', prefix: this.completionPrefix() };
      return null;
    }
    const tok = this.peek();
    if (tok.type !== 'ident') {
      // `expect status is 200` — the likeliest single mistake in the language, and until M61 it
      // produced this line with no `help` at all (review finding OBS-04, whose pre-FS-08 form was
      // a help line that listed four comparison/state forms and left out `equals`). `is` is a
      // copula, not a comparison, so a bare value in the matcher slot is a *missing matcher*, and
      // the one meant is almost always `equals`. Naming it in place beats naming the vocabulary:
      // the suggested text is insertable as-is, before the value already typed, and composes with
      // whatever prefix was consumed above (`is equals 200`, `not equals 200` both parse).
      const literal = tok.type === 'string' ? `"${tok.value}"` : tok.type === 'number' ? tok.value : undefined;
      this.error(
        Codes.UNKNOWN_MATCHER,
        `expected a matcher, found ${describeToken(tok)}`,
        tok.span,
        literal === undefined ? MATCHER_VOCABULARY_HELP : `a value needs a matcher in front of it — did you mean \`equals ${literal}\`?`,
      );
      return null;
    }
    const mk = (name: MatcherName, value: Value | null): Matcher => ({ type: 'Matcher', name, negated, value, span: this.spanFrom(start) });

    switch (tok.value) {
      case 'connects': {
        this.advance();
        return mk('connects', null);
      }
      case 'fails': {
        this.advance();
        if (this.isKw(this.peek(), 'matching')) {
          this.advance();
          const v = this.expectString('a regex string, e.g. `fails matching "certificate"`');
          return v ? mk('fails', v) : null;
        }
        return mk('fails', null);
      }
      case 'was': {
        this.advance();
        if (!this.expectKw('made')) return null;
        return mk('wasMade', null);
      }
      case 'equals': {
        this.advance();
        const v = this.parseValue();
        return v ? mk('equals', v) : null;
      }
      case 'contains': {
        this.advance();
        const v = this.parseValue();
        return v ? mk('contains', v) : null;
      }
      case 'matches': {
        this.advance();
        if (this.isKw(this.peek(), 'subset')) {
          this.advance();
          const object = this.parseObject();
          return object ? mk('matchesSubset', object) : null;
        }
        if (this.isKw(this.peek(), 'schema')) {
          this.advance();
          const schemaName = this.expectString('a schema name string, e.g. `matches schema "ProductResponseDto"`');
          if (!schemaName) return null;
          if (!this.expectKw('from')) return null;
          const schemaSource = this.expectString('a URL or path to the OpenAPI document, e.g. `from "/openapi.json"`');
          if (!schemaSource) return null;
          return { type: 'Matcher', name: 'matchesSchema', negated, value: null, schemaName, schemaSource, span: this.spanFrom(start) };
        }
        if (this.isKw(this.peek(), 'file')) {
          this.advance();
          const filePath = this.expectString('a file path string, e.g. `matches file "expected.pdf"`');
          if (!filePath) return null;
          return { type: 'Matcher', name: 'matchesFile', negated, value: null, filePath, span: this.spanFrom(start) };
        }
        if (this.isKw(this.peek(), 'snapshot')) {
          this.advance();
          const snapshotName = this.expectString('a snapshot name, e.g. `matches snapshot "checkout-page"`');
          if (!snapshotName) return null;
          return { type: 'Matcher', name: 'matchesSnapshot', negated, value: null, snapshotName, span: this.spanFrom(start) };
        }
        const v = this.expectString('a regex string, e.g. `matches "json"`');
        return v ? mk('matches', v) : null;
      }
      case 'has': {
        this.advance();
        const next = this.peek();
        if (this.isKw(next, 'count')) {
          this.advance();
          // FU-09: `has count greater than 0` is the spelling a user reaches for to say "at least
          // one", and it used to fall straight out of the matcher grammar into `parseValue`'s
          // call-parsing — answering ``\`greater\` looks like the start of a call but never reaches
          // `(` `` with a hint about parens, for a mistake that has nothing to do with calls. Same
          // C11-class mis-blame `M84` fixed elsewhere: the diagnostic named the grammar slot the
          // parser fell into rather than the thing the user got wrong. Caught here, where the
          // parser still knows the user was writing a *count* matcher and can name the two
          // spellings that work.
          const countBound = boundPhrase(this.peek(), this.peek(1));
          if (countBound) {
            this.error(Codes.UNKNOWN_MATCHER, `\`has count\` compares for equality — it cannot be followed by \`${countBound}\``, this.peek().span, COUNT_BOUND_HELP);
            return null;
          }
          // FS-07/A3-06: was `expect('number')`, a literal token — so the only array-length matcher
          // in the closed set could not be data-driven, and a `with each` table could supply a URL
          // but never an expected count. `Matcher.value` was already `Value`; only the parser was
          // narrow.
          const v = this.parseValue();
          return v ? mk('hasCount', v) : null;
        }
        if (this.isKw(next, 'value')) {
          this.advance();
          // The same misfire, one branch over (FU-09). `has value` tests for an exact element, so
          // there is no working spelling to point at the way there is for `count` — but naming the
          // real mistake still beats handing back advice about parens. Fixing one side of this
          // `if/else` and leaving the other is the `M61`→`M82`, `M77`→`B3-11` pattern this ledger
          // keeps re-filing.
          const valueBound = boundPhrase(this.peek(), this.peek(1));
          if (valueBound) {
            this.error(Codes.UNKNOWN_MATCHER, `\`has value\` compares for equality — it cannot be followed by \`${valueBound}\``, this.peek().span);
            return null;
          }
          const v = this.parseValue();
          return v ? mk('hasValue', v) : null;
        }
        if (this.isKw(next, 'no')) {
          this.advance();
          return this.parseScanViolationsMatcher(start, negated);
        }
        // FU-09's second spelling: `has at least 1` / `has more than 1`. The message was already
        // right (`count`, `value` or `no` is genuinely what belongs here) and carried no hint at
        // all, so a user who reached for a size comparison was told the vocabulary and left to
        // work out which member of it expresses what they asked for.
        const sizeWord = ['at', 'more', 'fewer', 'greater', 'less', 'least'].includes(next.value);
        this.error(
          Codes.UNKNOWN_MATCHER,
          `expected \`count\`, \`value\`, or \`no\` after \`has\`, found ${describeToken(next)}`,
          next.span,
          sizeWord ? COUNT_BOUND_HELP : undefined,
        );
        return null;
      }
      case 'greater': {
        this.advance();
        if (!this.expectKw('than')) return null;
        const v = this.parseValue();
        return v ? mk('greaterThan', v) : null;
      }
      case 'less': {
        this.advance();
        if (!this.expectKw('than')) return null;
        const v = this.parseValue();
        return v ? mk('lessThan', v) : null;
      }
      default: {
        if ((STATE_WORDS as readonly string[]).includes(tok.value)) {
          this.advance();
          return mk(tok.value as MatcherName, null);
        }
        // FU-09's first spelling, and the one a user is likeliest to try: `is not empty`. Answered
        // before `suggest` for the same reason `negatedState` is — the vocabulary line below is
        // true but useless here, because the answer isn't a near-miss on any matcher name, it's a
        // different construction. Both directions are named, since `is empty` is the same reach.
        if (tok.value === 'empty') {
          this.error(Codes.UNKNOWN_MATCHER, `unknown matcher \`empty\``, tok.span, `there is no \`empty\` matcher — ${COUNT_BOUND_HELP}`);
          return null;
        }
        // A3-02: answered *before* `suggest`, because for exactly these words edit distance gives a
        // confident, fluent and meaning-inverting answer. `invisible`/`unchecked`/`unhidden` are
        // each one edit from their own positive twin and further from everything else, so the
        // did-you-mean was always the antonym of what the user asked for.
        const negatedState = negatedStateWord(tok.value);
        if (negatedState) {
          this.error(
            Codes.UNKNOWN_MATCHER,
            `unknown matcher \`${tok.value}\``,
            tok.span,
            negated
              ? `\`not ${tok.value}\` is a double negative — write \`${negatedState}\`.`
              : `state words are never negated by spelling — write \`not ${negatedState}\`. (\`${negatedState}\` on its own asserts the opposite.)`,
          );
          return null;
        }
        const hint = suggest(tok.value, MATCHER_VOCABULARY);
        this.error(Codes.UNKNOWN_MATCHER, `unknown matcher \`${tok.value}\``, tok.span, hint ? `did you mean \`${hint}\`?` : MATCHER_VOCABULARY_HELP);
        return null;
      }
    }
  }

  /** `no [<severity>] (a11y|security|authorization) violations` (M3e SPEC §9.8; M128b SPEC §9.10,
   * D290; M130b SPEC §9.11, D304) — caller
   * has already consumed `has no`. `<severity>` is an optional bare word
   * (`minor`/`moderate`/`serious`/`critical`, a *floor*, not an exact-match filter — see
   * `Matcher.severityFloor`'s doc comment in ast.ts); omitted means every severity counts.
   *
   * **One production for every scan, because they are one construct with one word swapped.** D290
   * chose `violations` for the security matcher precisely so the noun would be shared; parsing them
   * separately would then be copies of the same three-token walk, and the A3-15 comment below
   * describes what happens to error quality when a construct's spellings drift apart. D304 kept the
   * spelling for the authorization matcher for the same reason while deliberately *not* folding it
   * into `security` — one production, three names, and the difference lives past the parser. Which
   * scan was asked for is the *only* difference here, and it decides one thing: the `MatcherName`. */
  private parseScanViolationsMatcher(start: Position, negated: boolean): Matcher | null {
    const sevTok = this.peek();
    let severityFloor: FindingSeverity | undefined;
    if (sevTok.type === 'ident' && (SEVERITY_FLOOR_WORDS as readonly string[]).includes(sevTok.value)) {
      severityFloor = this.advance().value as FindingSeverity;
    }
    // A3-15: both keywords were bare `expectKw`s, so all three ways to get this construct wrong
    // reported one keyword of a three-word phrase and never the vocabulary — `expect page has no
    // violations` (the likeliest slip: `a11y` forgotten) said ``expected `a11y`, found
    // `violations` ``, with `SEVERITY_FLOOR_WORDS` and `suggest` both in scope and neither used.
    // The `log … to <dest>` branch below has always done this properly; nothing here is different.
    const kindTok = this.peek();
    // Longest phrase first, so a one-word phrase can never shadow a two-word one that starts with
    // the same token. Nothing today shares a first word; ordering it correctly now is cheaper than
    // discovering the shadow the day something does.
    const kind = [...SCAN_KIND_PHRASES]
      .sort((a, b) => b.split(' ').length - a.split(' ').length)
      .find((phrase) => phrase.split(' ').every((word, i) => this.isKw(this.peek(i), word)));
    if (kind === undefined) {
      // A severity is still legal in front of the scan phrase, so it belongs in the candidate pool —
      // but only until one has been read, after which it is no longer a thing the user may write.
      const candidates = severityFloor === undefined ? [...SCAN_FIRST_WORDS, ...SEVERITY_FLOOR_WORDS] : [...SCAN_FIRST_WORDS];
      const near = kindTok.type === 'ident' ? suggest(kindTok.value, candidates) : undefined;
      // Suggest the whole phrase, not the word that matched. `input` alone is not something a user
      // can write, and a hint that offers it would send them to the next error rather than past it.
      const hint = near === undefined ? undefined : (SCAN_KIND_PHRASES.find((p) => p.startsWith(`${near} `)) ?? near);
      // Listed from the constant rather than spelled out, so a fifth scan phrase cannot leave this
      // message naming three of four — the drift A3-15 was filed about, one scan later.
      const expected = SCAN_KIND_PHRASES.map((k) => `\`${k}\``).join(', ');
      this.error(Codes.UNEXPECTED_TOKEN, `expected one of ${expected}, found ${describeToken(kindTok)}`, kindTok.span, hint ? `did you mean \`${hint}\`?` : SCAN_MATCHER_HELP);
      return null;
    }
    for (let i = 0; i < kind.split(' ').length; i++) this.advance();
    const violationsTok = this.peek();
    if (!this.isKw(violationsTok, 'violations')) {
      const hint = violationsTok.type === 'ident' ? suggest(violationsTok.value, ['violations']) : undefined;
      this.error(Codes.UNEXPECTED_TOKEN, `expected \`violations\`, found ${describeToken(violationsTok)}`, violationsTok.span, hint ? `did you mean \`${hint}\`?` : SCAN_MATCHER_HELP);
      return null;
    }
    this.advance();
    return { type: 'Matcher', name: SCAN_MATCHER_NAMES[kind], negated, value: null, severityFloor, span: this.spanFrom(start) };
  }

  // -- UI / browser steps (SPEC §9, M3a) --------------------------------------

  private parseLocator(): Locator | null {
    const tok = this.peek();
    if (tok.type !== 'ident' || !(LOCATOR_KEYWORDS as readonly string[]).includes(tok.value)) {
      const hint = tok.type === 'ident' ? suggest(tok.value, LOCATOR_KEYWORDS) : undefined;
      this.error(
        Codes.UNEXPECTED_TOKEN,
        `expected a locator, found ${describeToken(tok)}`,
        tok.span,
        hint ? `did you mean \`${hint}\`?` : `expected one of: ${LOCATOR_KEYWORDS.join(', ')}`,
      );
      return null;
    }
    const start = tok.span.start;
    const kind = this.advance().value as LocatorKind;
    // M96/D133 #3 — every locator keyword is also a plausible variable name, and M96 *creates* this
    // trap: before `FU-11` nobody wrote `expect text equals "hi"` meaning a value, because no value
    // was assertable. Now they will, and `text`/`list`/`field`/… silently mean a locator instead. A
    // missing selector string is the only signal that happens, so the reading is named here rather
    // than left to a bare "expected a string".
    if (!this.check('string')) {
      const at = this.peek();
      this.error(
        Codes.UNEXPECTED_TOKEN,
        `expected a ${kind} name/selector, e.g. \`${kind} "…"\`, found ${describeToken(at)}`,
        at.span,
        `\`${kind}\` here is the UI locator (SPEC §9.4) — if you meant a value you bound with \`let\`/\`capture\`, write \`{${kind}}\``,
      );
      return null;
    }
    const value = this.expectString(`a ${kind} name/selector, e.g. \`${kind} "…"\``);
    if (!value) return null;
    return { type: 'Locator', kind, value, span: this.spanFrom(start) };
  }

  /** Zero or more trailing `mask <locator>` clauses (M4b, D15) — dynamic regions to paint over
   * before a `matches snapshot "…"` comparison. Syntactically legal after any matcher (mirrors
   * every other subject/matcher pairing, where mismatch is a runtime rather than parse-time
   * concern) but only meaningful with `matchesSnapshot`; `checkExpect` rejects a stray one. */
  private parseSnapshotMasks(): Locator[] {
    const masks: Locator[] = [];
    while (this.isKw(this.peek(), 'mask')) {
      this.advance(); // `mask`
      const locator = this.parseLocator();
      if (!locator) break;
      masks.push(locator);
    }
    return masks;
  }

  /** True at end-of-statement (newline/dedent/eof) — used to tell `check`'s dual grammar apart
   * (SPEC §9.1): a locator subject with nothing after it is the `check` action, one followed by a
   * matcher is the soft assertion. */
  private atStatementEnd(): boolean {
    return this.check('newline') || this.check('dedent') || this.atEof();
  }

  private parseOpenStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `open`
    const path = this.expectString('a path to open, e.g. `open "/orders/{orderId}"`');
    if (!path) return null;
    this.endLine();
    return { type: 'OpenStmt', path, span: this.spanFrom(start) };
  }

  private parseClickStep(kind: ClickKind): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `click`
    const locator = this.parseLocator();
    if (!locator) return null;
    this.endLine();
    return { type: 'ClickStmt', kind, locator, span: this.spanFrom(start) };
  }

  private parseDoubleOrRightClickStep(kind: ClickKind): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `double`/`right`
    if (!this.expectKw('click')) return null;
    const locator = this.parseLocator();
    if (!locator) return null;
    this.endLine();
    return { type: 'ClickStmt', kind, locator, span: this.spanFrom(start) };
  }

  private parseFillStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `fill`
    if (this.isKw(this.peek(), 'form')) return this.parseFillFormStep(start);
    const locator = this.parseLocator();
    if (!locator) return null;
    if (!this.expectKw('with')) return null;
    const value = this.parseValue();
    if (!value) return null;
    this.endLine();
    return { type: 'FillStmt', locator, value, span: this.spanFrom(start) };
  }

  private parseFillFormStep(start: Position): Step | null {
    this.advance(); // `form`
    this.endLine();
    if (!this.check('indent')) {
      this.error(Codes.EMPTY_BLOCK, 'this `fill form` has no rows', this.peek().span, 'indent at least one `| "Field" | value |` row');
      return null;
    }
    this.advance(); // indent
    const rows = this.parseFillFormRows();
    if (this.check('dedent')) this.advance();
    if (rows.length === 0) {
      this.error(Codes.EMPTY_BLOCK, 'this `fill form` has no rows', this.spanFrom(start), 'add at least one `| "Field" | value |` row');
      return null;
    }
    return { type: 'FillFormStmt', rows, span: this.spanFrom(start) };
  }

  private parseFillFormRows(): FillFormRow[] {
    const rows: FillFormRow[] = [];
    while (!this.check('dedent') && !this.atEof()) {
      if (this.check('newline')) {
        this.advance();
        continue;
      }
      const before = this.pos;
      const row = this.parseFillFormRow();
      if (row) rows.push(row);
      else this.synchronize();
      if (this.pos === before) this.advance(); // guarantee progress
    }
    return rows;
  }

  private parseFillFormRow(): FillFormRow | null {
    const start = this.peek().span.start;
    if (!this.expect('pipe', '`|` to start the form row')) return null;
    const field = this.expectString('a field name, e.g. `| "Email" | … |`');
    if (!field) return null;
    if (!this.expect('pipe', '`|` after the field name')) return null;
    const value = this.parseValue();
    if (!value) return null;
    if (!this.expect('pipe', '`|` to close the form row')) return null;
    this.endLine();
    return { type: 'FillFormRow', field, value, span: this.spanFrom(start) };
  }

  private parseSelectStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `select`
    const value = this.parseValue();
    if (!value) return null;
    if (!this.expectKw('from')) return null;
    const locator = this.parseLocator();
    if (!locator) return null;
    this.endLine();
    return { type: 'SelectStmt', locator, value, span: this.spanFrom(start) };
  }

  /** `check` is the soft-assertion keyword and nothing else (FS-04, SPEC §9.1). It used to be
   * dual-grammar — a locator subject with nothing following it was the checkbox-tick action — which
   * meant a forgotten matcher silently turned an assertion into a mutation that then passed. That
   * branch is now a diagnostic naming both readings, kept here (rather than left to `parseMatcher`'s
   * generic "expected a matcher") because *which* reading the author meant is the whole question. */
  private parseCheckStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `check`
    let quantifier: 'any' | 'all' | null = null;
    const lead = this.peek();
    if (lead.type === 'ident' && (QUANTIFIERS as readonly string[]).includes(lead.value)) {
      quantifier = this.advance().value as 'any' | 'all';
    }
    const subject = this.parseSubject();
    if (!subject) return null;
    if (subject.type === 'LocatorSubject' && this.atStatementEnd()) {
      if (quantifier) {
        this.badQuantifier(quantifier, subject);
        return null;
      }
      this.error(
        Codes.UNKNOWN_MATCHER,
        '`check <locator>` needs a matcher — the bare form used to tick a checkbox and no longer does',
        this.spanFrom(start),
        'to tick the box, write `tick field "…"`; to assert its state, write `check field "…" is checked`. `check` is the soft assertion now and only that, so a forgotten matcher can no longer turn one into a click (SPEC §9.1)',
      );
      return null;
    }
    if (quantifier && !quantifiable(subject)) {
      this.badQuantifier(quantifier, subject);
      return null;
    }
    const matcher = this.parseMatcher();
    if (!matcher) return null;
    const masks = this.parseSnapshotMasks();
    this.endLine();
    return { type: 'ExpectStmt', soft: true, quantifier, subject, matcher, masks, span: this.spanFrom(start) };
  }

  /** `tick <locator>` (FS-04) — the checkbox action, unambiguous by construction: no matcher may
   * follow, and `tick` is not a matcher word, so there is no second reading to resolve silently the
   * way `check <locator>` had to. */
  private parseTickStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `tick`
    const locator = this.parseLocator();
    if (!locator) return null;
    this.endLine();
    return { type: 'TickStmt', locator, span: this.spanFrom(start) };
  }

  /** `untick <locator>` (FS-04) — the sibling of `parseTickStep`; `uncheck` is retired and refused
   * at dispatch. */
  private parseUntickStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `untick`
    const locator = this.parseLocator();
    if (!locator) return null;
    this.endLine();
    return { type: 'UntickStmt', locator, span: this.spanFrom(start) };
  }

  private parsePressStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `press`
    const keys = this.expectString('a key or chord, e.g. `press "Enter"` or `press "Control+A"`');
    if (!keys) return null;
    let locator: Locator | null = null;
    if (this.isKw(this.peek(), 'on')) {
      this.advance();
      locator = this.parseLocator();
      if (!locator) return null;
    }
    this.endLine();
    return { type: 'PressStmt', keys, locator, span: this.spanFrom(start) };
  }

  private parseHoverStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `hover`
    const locator = this.parseLocator();
    if (!locator) return null;
    this.endLine();
    return { type: 'HoverStmt', locator, span: this.spanFrom(start) };
  }

  private parseScrollStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `scroll`
    if (!this.expectKw('to')) return null;
    const locator = this.parseLocator();
    if (!locator) return null;
    this.endLine();
    return { type: 'ScrollStmt', locator, span: this.spanFrom(start) };
  }

  /** `within <locator>` or `within frame <locator>` (SPEC §9.3/§9.5) — `frame` is a contextual
   * keyword recognized only right after `within`, not a reserved word elsewhere. */
  private parseWithinStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `within`
    let frame = false;
    if (this.isKw(this.peek(), 'frame')) {
      this.advance();
      frame = true;
    }
    const locator = this.parseLocator();
    if (!locator) return null;
    this.endLine();
    const body = this.parseBlock(frame ? 'within frame' : 'within');
    return { type: 'WithinBlock', locator, frame, body, span: this.spanFrom(start) };
  }

  private parseDialogStep(which: 'accept' | 'dismiss'): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `accept`/`dismiss`
    if (!this.expectKw('dialog')) return null;
    this.endLine();
    return which === 'accept'
      ? ({ type: 'AcceptDialogStmt', span: this.spanFrom(start) } satisfies AcceptDialogStmt)
      : ({ type: 'DismissDialogStmt', span: this.spanFrom(start) } satisfies DismissDialogStmt);
  }

  // -- UI / browser steps (SPEC §9.5, M3b) ------------------------------------

  /** `switch to new tab` + block, or `switch to tab N` (SPEC §9.5). Caller has not yet consumed
   * `switch`. */
  private parseSwitchStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `switch`
    if (!this.expectKw('to')) return null;
    if (this.isKw(this.peek(), 'new')) {
      this.advance(); // `new`
      if (!this.expectKw('tab')) return null;
      this.endLine();
      const body = this.parseBlock('switch to new tab');
      const stmt: SwitchToNewTabBlock = { type: 'SwitchToNewTabBlock', body, span: this.spanFrom(start) };
      return stmt;
    }
    if (!this.expectKw('tab')) return null;
    const num = this.expect('number', 'a tab number, e.g. `switch to tab 1`');
    if (!num) return null;
    this.endLine();
    const stmt: SwitchToTabStmt = { type: 'SwitchToTabStmt', index: Number(num.value), span: this.spanFrom(start) };
    return stmt;
  }

  private parseCloseTabStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `close`
    if (!this.expectKw('tab')) return null;
    this.endLine();
    const stmt: CloseTabStmt = { type: 'CloseTabStmt', span: this.spanFrom(start) };
    return stmt;
  }

  /** `download as <name>` + block (SPEC §9.5). */
  private parseDownloadStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `download`
    if (!this.expectKw('as')) return null;
    const name = this.expect('ident', 'a variable name after `as`, e.g. `download as file`');
    if (!name) return null;
    this.endLine();
    const body = this.parseBlock('download');
    const stmt: DownloadBlock = { type: 'DownloadBlock', name: name.value, body, span: this.spanFrom(start) };
    return stmt;
  }

  private parseDragStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `drag`
    const from = this.parseLocator();
    if (!from) return null;
    if (!this.expectKw('to')) return null;
    const to = this.parseLocator();
    if (!to) return null;
    this.endLine();
    const stmt: DragStmt = { type: 'DragStmt', from, to, span: this.spanFrom(start) };
    return stmt;
  }

  private parseDropFileStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `drop`
    if (!this.expectKw('file')) return null;
    const filePath = this.expectString('a file path, e.g. `drop file "./f.png" onto css ".dropzone"`');
    if (!filePath) return null;
    if (!this.expectKw('onto')) return null;
    const locator = this.parseLocator();
    if (!locator) return null;
    this.endLine();
    const stmt: DropFileStmt = { type: 'DropFileStmt', filePath, locator, span: this.spanFrom(start) };
    return stmt;
  }

  private parseScreenshotStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `screenshot`
    const name = this.expectString('a screenshot name, e.g. `screenshot "checkout-step-2"`');
    if (!name) return null;
    this.endLine();
    return { type: 'ScreenshotStmt', name, span: this.spanFrom(start) };
  }

  /** `stub <METHOD> "<url-pattern>" respond status <code> [body {...}]` (M3d, SPEC §9.7). Reuses
   * the same method-word recognition `api`'s request line already has (`isMethodWord`/`METHODS`). */
  private parseStubStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `stub`
    const methodTok = this.peek();
    if (methodTok.type !== 'ident' || !this.isMethodWord(methodTok)) {
      const hint = methodTok.type === 'ident' ? suggest(methodTok.value, METHODS as unknown as string[]) : undefined;
      this.error(
        Codes.UNKNOWN_METHOD,
        `expected an HTTP method (${METHODS.join(', ')}), found ${describeToken(methodTok)}`,
        methodTok.span,
        hint ? `did you mean \`${hint}\`?` : undefined,
      );
      return null;
    }
    const method = this.advance().value.toUpperCase() as HttpMethod;
    const urlPattern = this.expectString('a URL pattern, e.g. `stub GET "/api/orders/**"`');
    if (!urlPattern) return null;
    if (!this.expectKw('respond')) return null;
    if (!this.expectKw('status')) return null;
    const statusTok = this.expect('number', 'a status code, e.g. `respond status 200`');
    if (!statusTok) return null;
    const status: NumberLit = { type: 'NumberLit', value: Number(statusTok.value), raw: statusTok.raw, span: statusTok.span };
    // D639 reaches `stub` as well as `api`, and this is the site where the narrowness bit hardest:
    // a list endpoint answers with a top-level array, so `stub GET "/api/orders" respond status 200
    // body [ … ]` is the ordinary case rather than an exotic one, and it was unwritable.
    let body: ObjectLit | ArrayLit | null = null;
    if (this.isKw(this.peek(), 'body')) {
      this.advance();
      body = this.parseJsonDocument('the stubbed response body');
      if (!body) return null;
    }
    this.endLine();
    return { type: 'StubStmt', method, urlPattern, status, body, span: this.spanFrom(start) };
  }

  // -- let / capture ---------------------------------------------------------

  private parseLet(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `let`
    const name = this.expect('ident', 'a variable name after `let`');
    if (!name) return null;
    if (!this.expect('equals', '`=` after the variable name')) return null;
    const value = this.parseValue();
    if (!value) return null;
    this.endLine();
    const stmt: LetStmt = { type: 'LetStmt', name: name.value, value, span: this.spanFrom(start) };
    return stmt;
  }

  private parseCapture(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `capture`
    const subject = this.parseSubject();
    if (!subject) return null;
    // M96/D130 — `capture` shares `parseSubject`, so `capture {orderId} as savedId` would have
    // become legal *for free*. It is rejected: that statement is `let savedId = {orderId}` with a
    // second name, arriving by inheritance rather than by anyone choosing it. `capture` is an API
    // step (SPEC §5.4) whose job is reading a response — and M95's contract (a `capture` fails when
    // its subject resolves to nothing) cannot fire here, since an unbound `{x}` is already `TF030`
    // at check time. An inherited guard that cannot fire is a negative control that cannot fail.
    if (subject.type === 'ValueSubject') {
      this.error(
        Codes.UNKNOWN_SUBJECT,
        '`capture` reads a value out of a response, so its subject cannot be a `{variable}`',
        subject.span,
        'to give an existing value a second name, write `let savedId = {orderId}` — `capture` is for values the system under test hands back (SPEC §5.4)',
      );
      return null;
    }
    if (!this.expectKw('as')) return null;
    const name = this.expect('ident', 'a variable name after `as`');
    if (!name) return null;
    this.endLine();
    const stmt: CaptureStmt = { type: 'CaptureStmt', subject, name: name.value, span: this.spanFrom(start) };
    return stmt;
  }

  /** `log [debug|info|warn|error] "message with {var}" [to console|html|both]` (M27, PLAN_LOG.md
   * decisions 113-121). Level and destination are both optional bare-keyword lookaheads (same
   * shape as `parseScanViolationsMatcher`'s optional severity word) — omitting the level defaults
   * to `info` (decision 114); omitting `to` leaves `destination: null`, resolved against
   * `tflw.config`'s `logDestination` (default `both`) at run time, not here (decision 116) — the
   * parser has no config in scope. */
  private parseLogStep(): Step | null {
    const start = this.peek().span.start;
    this.advance(); // `log`
    let level: LogLevel = 'info';
    const levelTok = this.peek();
    // A3-16: an unrecognised bare word here used to fall straight through to the message-string
    // expectation, so `log trace "x"` reported that a *string* was expected — pointing at the
    // quoted message the user did write correctly and away from the word they got wrong, while
    // `LOG_LEVELS` sat unused three lines up. An optional lookahead is not a licence to stay
    // silent: the only other thing legal in this slot is a quoted string, so a bare identifier
    // here can only be an attempt at a level. `to` is the exception — it means the message itself
    // is missing, and the expectation below already says so better than this branch could.
    if (levelTok.type === 'ident' && !this.isKw(levelTok, 'to')) {
      if (!(LOG_LEVELS as readonly string[]).includes(levelTok.value)) {
        const hint = suggest(levelTok.value, LOG_LEVELS);
        this.error(
          Codes.UNEXPECTED_TOKEN,
          `expected a log level, found ${describeToken(levelTok)}`,
          levelTok.span,
          hint ? `did you mean \`${hint}\`?` : `expected one of: ${LOG_LEVELS.join(', ')} — or omit it, which is \`info\``,
        );
        return null;
      }
      level = this.advance().value as LogLevel;
    }
    const message = this.expectString('a log message, e.g. `log "order {orderId} created"`');
    if (!message) return null;
    let destination: LogDestination | null = null;
    if (this.isKw(this.peek(), 'to')) {
      this.advance();
      const destTok = this.peek();
      if (destTok.type !== 'ident' || !(LOG_DESTINATIONS as readonly string[]).includes(destTok.value)) {
        const hint = destTok.type === 'ident' ? suggest(destTok.value, LOG_DESTINATIONS) : undefined;
        this.error(
          Codes.UNEXPECTED_TOKEN,
          `expected a log destination, found ${describeToken(destTok)}`,
          destTok.span,
          hint ? `did you mean \`${hint}\`?` : `expected one of: ${LOG_DESTINATIONS.join(', ')}`,
        );
        return null;
      }
      destination = this.advance().value as LogDestination;
    }
    this.endLine();
    const stmt: LogStmt = { type: 'LogStmt', level, message, destination, span: this.spanFrom(start) };
    return stmt;
  }

  // -- values: arithmetic + date-math expressions (P#25) ----------------------
  //
  // `parseValue` is the public entry point (kept as the name every call site already uses); it
  // climbs two precedence levels (`+ - ` then `* /`) down to `parseAtom`, the leaf dispatch that
  // used to be all there was in M0/M1. No parens — the closed grammar has none (P#25).

  private parseValue(): Value | null {
    return this.parseAddSub();
  }

  private parseAddSub(): Value | null {
    let left = this.parseMulDiv();
    if (!left) return null;
    for (;;) {
      const tok = this.peek();
      if (tok.type !== 'plus' && tok.type !== 'minus') break;
      this.advance();
      const right = this.parseMulDiv();
      if (!right) return null;
      left = { type: 'BinaryExpr', op: tok.type === 'plus' ? '+' : '-', left, right, span: { start: left.span.start, end: right.span.end } };
    }
    return left;
  }

  private parseMulDiv(): Value | null {
    let left = this.parseAtom();
    if (!left) return null;
    for (;;) {
      const tok = this.peek();
      if (tok.type !== 'star' && tok.type !== 'slash') break;
      this.advance();
      const right = this.parseAtom();
      if (!right) return null;
      left = { type: 'BinaryExpr', op: tok.type === 'star' ? '*' : '/', left, right, span: { start: left.span.start, end: right.span.end } };
    }
    return left;
  }

  /** Leaf value: string, number/duration/date-offset, bool, null, `{interp}`, a bare identifier
   * reference, `env(…)`, `today`/`now`, `format …`, or a `unique`/`random` generator. */
  private parseAtom(): Value | null {
    const tok = this.peek();
    if (tok.type === 'minus') {
      // Unary minus is sugar for `0 - operand` — the operand can be anything that might evaluate
      // to a number at runtime (a literal, `{var}`, a generator, …); whether it actually does is a
      // runtime type check like every other arithmetic mismatch (P#25), not a parse-time one.
      this.advance();
      const operand = this.parseAtom();
      if (!operand) return null;
      const zero: NumberLit = { type: 'NumberLit', value: 0, raw: '0', span: tok.span };
      const expr: BinaryExpr = { type: 'BinaryExpr', op: '-', left: zero, right: operand, span: { start: tok.span.start, end: operand.span.end } };
      return expr;
    }
    switch (tok.type) {
      case 'string':
        this.advance();
        return this.makeStringLit(tok);
      case 'number': {
        this.advance();
        // A number immediately (no whitespace) followed by a short time unit is a duration
        // literal, e.g. `500ms` in `expect duration is less than 500ms` (SPEC §5.3).
        const unitTok = this.peek();
        if (unitTok.type === 'ident' && unitTok.span.start.offset === tok.span.end.offset && (DURATION_UNITS as readonly string[]).includes(unitTok.value)) {
          this.advance();
          const ms = toMs(Number(tok.value), unitTok.value as (typeof DURATION_UNITS)[number]);
          const lit: DurationLit = { type: 'DurationLit', ms, raw: `${tok.raw}${unitTok.value}`, span: { start: tok.span.start, end: unitTok.span.end } };
          return lit;
        }
        // A number followed (whitespace allowed) by a spelled-out unit is a date offset, e.g.
        // `3 days` in `today + 3 days` (P#25) — distinct word set from the duration units above.
        if (unitTok.type === 'ident' && (DATE_OFFSET_UNITS as readonly string[]).includes(unitTok.value)) {
          this.advance();
          const lit: DateOffsetLit = { type: 'DateOffsetLit', amount: Number(tok.value), unit: unitTok.value as DateOffsetUnit, span: { start: tok.span.start, end: unitTok.span.end } };
          return lit;
        }
        // M98c (`A1-07`, D160). Checked *after* both real constructions, so `3days` stays a date
        // offset and only a genuinely broken duration reaches here.
        if (unitTok.type === 'ident') {
          const adjacent = unitTok.span.start.offset === tok.span.end.offset;
          if (this.reportBadDurationUnit(tok, unitTok, adjacent)) {
            // Consume the unit. The alternative — leave it for the caller — hands the same typo to
            // `endLine`, which reports it a second time as ``unexpected `ms` at end of step``: the
            // exact unteaching message this decision exists to remove. Recovery keeps the reading
            // the author meant where it can (a spaced real unit is a duration with a space in it);
            // where the unit is unknown there is no ms value to build, so the number stands alone.
            this.advance();
            const canonical = nearestDurationUnit(unitTok.value);
            const span = { start: tok.span.start, end: unitTok.span.end };
            if (canonical !== null && unitTok.value === canonical) {
              const lit: DurationLit = { type: 'DurationLit', ms: toMs(Number(tok.value), canonical), raw: `${tok.raw}${canonical}`, span };
              return lit;
            }
            return { type: 'NumberLit', value: Number(tok.value), raw: tok.raw, span };
          }
        }
        return { type: 'NumberLit', value: Number(tok.value), raw: tok.raw, span: tok.span };
      }
      case 'lbracket':
        return this.parseArray();
      case 'lbrace':
        // FS-07. `{` in value position used to mean interpolation and nothing else, while
        // `matches subset`/an `api` body reached `parseObject` down a separate path — so
        // `matches subset { id: 1 }` was valid on the line above `equals { id: 1 }`, which failed
        // with "expected `}` to close the interpolation". This is the same two-token rule
        // `parseFieldValue` has always used, moved down here so there is one value parser rather
        // than two that disagree.
        //
        // The rule, now a SPEC promise and not just parser behaviour: `{ IDENT }` is an
        // interpolation — forever — and an object literal always requires `key: value`. So
        // `{ stock }` reads as the variable `stock`, never as a one-field object, and there is no
        // shorthand-key form to collide with it.
        return this.startsObjectLiteral() ? this.parseObject() : this.parseInterp();
      case 'ident': {
        if (tok.value === 'env' && this.peek(1).type === 'lparen') return this.parseEnvRef();
        if (tok.value === 'unique') return this.parseUniqueExpr();
        if (tok.value === 'random') return this.parseRandomExpr();
        if (tok.value === 'format') return this.parseFormatExpr();
        if (tok.value === 'base64' || tok.value === 'hex' || tok.value === 'url') return this.parseTransformExpr(tok.value);
        if (tok.value === 'today' || tok.value === 'now') {
          this.advance();
          const atom: DateAtom = { type: 'DateAtom', which: tok.value, span: tok.span };
          return atom;
        }
        if (tok.value === 'true' || tok.value === 'false') {
          this.advance();
          return { type: 'BoolLit', value: tok.value === 'true', span: tok.span };
        }
        if (tok.value === 'null') {
          this.advance();
          return { type: 'NullLit', span: tok.span };
        }
        return this.parseIdentOrCall(tok);
      }
      default:
        this.error(Codes.UNEXPECTED_TOKEN, `expected a value, found ${describeToken(tok)}`, tok.span);
        return null;
    }
  }

  /** A bare variable reference (`orderId`) or a call to an action/JS-helper (`create order(...)`,
   * `sign payload(...)`) — disambiguated by lookahead: variables are never multi-word in this
   * grammar, so any run of 2+ idents must be heading for `(` (P#11, P#17). Called with the first
   * ident already peeked (not yet consumed). */
  private parseIdentOrCall(first: Token): Value | null {
    let k = 1;
    while (this.peek(k).type === 'ident') k++;
    if (this.peek(k).type === 'lparen') {
      const start = first.span.start;
      const nameParts: string[] = [];
      for (let i = 0; i < k; i++) nameParts.push(this.advance().value);
      this.advance(); // lparen
      const args: Value[] = [];
      if (!this.check('rparen')) {
        for (;;) {
          const arg = this.parseValue();
          if (!arg) return null;
          args.push(arg);
          if (this.check('comma')) {
            this.advance();
            if (this.check('rparen')) break; // trailing comma — D637
            continue;
          }
          break;
        }
      }
      if (!this.expect('rparen', '`)` to close the call')) return null;
      const expr: CallExpr = { type: 'CallExpr', name: nameParts.join(' '), args, span: this.spanFrom(start) };
      return expr;
    }
    // D167 — the third branch. The scan above is a *lookahead*: it consumed nothing, so when the run
    // misses `(` the parser can hand every ident but the first back to the enclosing production
    // instead of declaring the whole run a malformed call. Before this, `random number lo to hi`
    // reported ``TF010: `lo` looks like the start of a call`` — the parser had swallowed `to`, the
    // keyword the enclosing production was waiting for, and then blamed the variable.
    //
    // No terminator vocabulary and no context threading, which is what makes it safe: a stop-word
    // table would permanently forbid its words as the second word of a multi-word action name
    // (`action submit form(…)`, `action upload file(…)` — and the corpus already has
    // `action retry login`), and per-call-site stop words leave every site that forgets to opt in
    // silently carrying today's bug. Both were rejected on that basis, not on taste.
    this.advance();
    // After the advance, not before: the note's lifetime is "the cursor has not moved since", and
    // the cursor's resting place is the leftover ident this back-off just declined to consume.
    if (k > 1) this.noteCallBackOff(first);
    return { type: 'VarRef', name: first.value, span: first.span };
  }

  // -- generators: unique / random (P#19, P#21–23) ----------------------------

  private parseUniqueExpr(): Value | null {
    const start = this.peek().span.start;
    this.advance(); // `unique`
    if (this.completionMode && this.atCompletionPoint()) {
      this.completionResult = { kind: 'unique', prefix: this.completionPrefix() };
      return null;
    }
    if (this.check('lparen')) {
      this.advance();
      const prefix = this.parseValue();
      if (!prefix) return null;
      if (!this.expect('rparen', '`)` to close `unique(…)`')) return null;
      const expr: UniquePrefixExpr = { type: 'UniquePrefixExpr', prefix, span: this.spanFrom(start) };
      return expr;
    }
    if (this.isKw(this.peek(), 'email')) {
      this.advance();
      const expr: UniqueEmailExpr = { type: 'UniqueEmailExpr', span: this.spanFrom(start) };
      return expr;
    }
    if (this.isKw(this.peek(), 'number')) {
      this.advance();
      const expr: UniqueNumberExpr = { type: 'UniqueNumberExpr', span: this.spanFrom(start) };
      return expr;
    }
    if (this.isKw(this.peek(), 'like')) {
      this.advance();
      const pattern = this.expectString('a like-pattern string, e.g. `unique like "ORD-######"`');
      if (!pattern) return null;
      const expr: UniqueLikeExpr = { type: 'UniqueLikeExpr', pattern, span: this.spanFrom(start) };
      return expr;
    }
    if (this.isKw(this.peek(), 'uuid')) {
      this.advance();
      const expr: UniqueUuidExpr = { type: 'UniqueUuidExpr', span: this.spanFrom(start) };
      return expr;
    }
    const tok = this.peek();
    this.error(Codes.UNEXPECTED_TOKEN, `expected \`(…)\`, \`email\`, \`number\`, \`like\`, or \`uuid\` after \`unique\`, found ${describeToken(tok)}`, tok.span);
    return null;
  }

  private parseRandomExpr(): Value | null {
    const start = this.peek().span.start;
    this.advance(); // `random`
    if (this.completionMode && this.atCompletionPoint()) {
      this.completionResult = { kind: 'random', prefix: this.completionPrefix() };
      return null;
    }
    const tok = this.peek();
    if (this.isKw(tok, 'number')) {
      this.advance();
      const from = this.parseValue();
      if (!from) return null;
      if (!this.expectKw('to')) return null;
      const to = this.parseValue();
      if (!to) return null;
      const expr: RandomNumberExpr = { type: 'RandomNumberExpr', from, to, span: this.spanFrom(start) };
      return expr;
    }
    if (this.isKw(tok, 'decimal')) {
      this.advance();
      const from = this.parseValue();
      if (!from) return null;
      if (!this.expectKw('to')) return null;
      const to = this.parseValue();
      if (!to) return null;
      const expr: RandomDecimalExpr = { type: 'RandomDecimalExpr', from, to, span: this.spanFrom(start) };
      return expr;
    }
    if (this.isKw(tok, 'date')) {
      this.advance();
      if (this.isKw(this.peek(), 'in')) {
        this.advance();
        if (this.isKw(this.peek(), 'past')) {
          this.advance();
          const expr: RandomDateInPastExpr = { type: 'RandomDateInPastExpr', span: this.spanFrom(start) };
          return expr;
        }
        if (this.isKw(this.peek(), 'future')) {
          this.advance();
          const expr: RandomDateInFutureExpr = { type: 'RandomDateInFutureExpr', span: this.spanFrom(start) };
          return expr;
        }
        const t = this.peek();
        this.error(Codes.UNEXPECTED_TOKEN, `expected \`past\` or \`future\` after \`random date in\`, found ${describeToken(t)}`, t.span);
        return null;
      }
      if (this.isKw(this.peek(), 'between')) {
        this.advance();
        const from = this.parseValue();
        if (!from) return null;
        if (!this.expectKw('and')) return null;
        const to = this.parseValue();
        if (!to) return null;
        const expr: RandomDateBetweenExpr = { type: 'RandomDateBetweenExpr', from, to, span: this.spanFrom(start) };
        return expr;
      }
      const t = this.peek();
      this.error(Codes.UNEXPECTED_TOKEN, `expected \`in\` or \`between\` after \`random date\`, found ${describeToken(t)}`, t.span);
      return null;
    }
    if (this.isKw(tok, 'of')) {
      this.advance();
      const choices: Value[] = [];
      const first = this.parseValue();
      if (!first) return null;
      choices.push(first);
      while (this.check('comma')) {
        this.advance();
        const v = this.parseValue();
        if (!v) return null;
        choices.push(v);
      }
      const expr: RandomOfExpr = { type: 'RandomOfExpr', choices, span: this.spanFrom(start) };
      return expr;
    }
    if (this.isKw(tok, 'string')) {
      this.advance();
      const length = this.parseValue();
      if (!length) return null;
      const expr: RandomStringExpr = { type: 'RandomStringExpr', length, span: this.spanFrom(start) };
      return expr;
    }
    if (this.isKw(tok, 'like')) {
      this.advance();
      const pattern = this.expectString('a like-pattern string, e.g. `random like "SKU-####-??"`');
      if (!pattern) return null;
      const expr: RandomLikeExpr = { type: 'RandomLikeExpr', pattern, span: this.spanFrom(start) };
      return expr;
    }
    if (this.isKw(tok, 'uuid')) {
      this.advance();
      const expr: RandomUuidExpr = { type: 'RandomUuidExpr', span: this.spanFrom(start) };
      return expr;
    }
    if (this.isKw(tok, 'password')) {
      this.advance();
      // Length is optional (default 12 at eval time) — only consume a following value if one is
      // actually there, so `random password` alone (followed by NEWLINE/`}`/`,`/an operator/…)
      // doesn't misparse the next unrelated token as a length (decision 98).
      let length: Value | undefined;
      if (this.looksLikeValueStart(this.peek())) {
        const lengthVal = this.parseValue();
        if (!lengthVal) return null;
        length = lengthVal;
      } else if (this.peek().type === 'ident') {
        // D169's other half. Narrowing the set above is only half a fix: `let p = random password n`
        // now falls through to the enclosing production, which says ``unexpected `n` at end of
        // step`` and teaches nothing — the exact `M98c` failure mode, a diagnostic that fires and
        // leaves the author no better off. So the *site* leaves advice naming the spellings that
        // work, on the same one-slot, position-keyed terms as D168's note.
        //
        // Conditional on the next token being an `ident` at all: after `select random password from
        // field "pw"` the note is taken and then silently expires, because `select` consumes `from`
        // and the cursor moves. Only the shape that actually fails ever sees it.
        this.noteValueAdvice('a password length must be a number or a `{var}` — write `random password 8`, `random password {n}`, or `random password` for the default');
      }
      const expr: RandomPasswordExpr = { type: 'RandomPasswordExpr', length, span: this.spanFrom(start) };
      return expr;
    }
    this.error(
      Codes.UNEXPECTED_TOKEN,
      `expected \`number\`, \`decimal\`, \`date\`, \`of\`, \`string\`, \`like\`, \`uuid\`, or \`password\` after \`random\`, found ${describeToken(tok)}`,
      tok.span,
    );
    return null;
  }

  /**
   * Whether `tok` could plausibly start a `Value` production — used only where a trailing value
   * is optional (`random password [N]`, decision 98) and we must decide, without committing,
   * whether the next token belongs to this expression or to whatever follows it.
   *
   * **`ident` is deliberately not in this set (M99b, D169, `A3-08`).** `random password` is the
   * grammar's only optional *and unmarked* value position, so an `ident` here is ambiguous with the
   * keyword that ends the enclosing production, and the parser took it as the length:
   *
   * ```
   * select random password from field "pw"
   *                        ^^^^ consumed as the length
   * ```
   *
   * `D167`'s back-off does not reach this. Under back-off the length becomes `VarRef(from)`,
   * `select` then expects `from` and finds `field`, and the blame moves one token without becoming
   * right. Nor does any local rule work: *"an ident starts a value only if the next token is not an
   * ident"* accepts `random password n` at end of line and rejects it in
   * `random password n from field "x"` — the same trap one position over.
   *
   * The ambiguity is unresolvable because the value is optional *and* unmarked, so the value is
   * required to be self-delimiting. `random password`, `random password 8` and `random password {n}`
   * all still work; only the bare `random password n` spelling goes.
   *
   * **Freeze classification: narrowing, blast radius 0.** 26 uses of `random password` in the
   * corpus, all bare at end of line, none with a length in either spelling. Adding an explicit
   * marker instead (`random password of 8`) was rejected: strictly additive and therefore safer, but
   * it adds grammar surface to a form nobody uses while leaving the ambiguous spelling alive beside
   * it — `A3-08` worked around rather than closed.
   */
  private looksLikeValueStart(tok: Token): boolean {
    return tok.type === 'string' || tok.type === 'number' || tok.type === 'lbrace' || tok.type === 'minus';
  }

  // -- transforms: base64 / hex / url encode/decode (decision 98) ------------

  private parseTransformExpr(kind: 'base64' | 'hex' | 'url'): Value | null {
    const start = this.peek().span.start;
    this.advance(); // `base64` / `hex` / `url`
    if (this.completionMode && this.atCompletionPoint()) {
      this.completionResult = { kind: 'transform', prefix: this.completionPrefix() };
      return null;
    }
    const dirTok = this.peek();
    let direction: 'encode' | 'decode';
    if (this.isKw(dirTok, 'encode')) direction = 'encode';
    else if (this.isKw(dirTok, 'decode')) direction = 'decode';
    else {
      this.error(Codes.UNEXPECTED_TOKEN, `expected \`encode\` or \`decode\` after \`${kind}\`, found ${describeToken(dirTok)}`, dirTok.span);
      return null;
    }
    this.advance();
    if (!this.expect('lparen', `\`(\` after \`${kind} ${direction}\``)) return null;
    const value = this.parseValue();
    if (!value) return null;
    if (!this.expect('rparen', `\`)\` to close \`${kind} ${direction}(…)\``)) return null;
    const expr: TransformExpr = { type: 'TransformExpr', kind, direction, value, span: this.spanFrom(start) };
    return expr;
  }

  private parseFormatExpr(): Value | null {
    const start = this.peek().span.start;
    this.advance(); // `format`
    const value = this.parseValue();
    if (!value) return null;
    if (!this.expectKw('as')) return null;
    const pattern = this.expectString('a format pattern string, e.g. `format {d} as "yyyy-MM-dd"`');
    if (!pattern) return null;
    const expr: FormatExpr = { type: 'FormatExpr', value, pattern, span: this.spanFrom(start) };
    return expr;
  }

  /** Field value: any scalar value, plus nested objects and arrays (JSON body shapes). */
  /** Is the `{` at the current position an object literal rather than an interpolation? `{}` is the
   * empty object; `{ key: …` and `{ "key": …` are objects; everything else — critically a bare
   * `{ref}`, and `{price} * 2` — is an interpolation-led expression (P#25). Two tokens, and the rule
   * is stated in SPEC: an object literal always requires `key: value`, so no shorthand-key form
   * exists to make `{ stock }` ambiguous. */
  private startsObjectLiteral(): boolean {
    if (this.peek().type !== 'lbrace') return false;
    if (this.peek(1).type === 'rbrace') return true;
    return (this.peek(1).type === 'ident' || this.peek(1).type === 'string') && this.peek(2).type === 'colon';
  }

  /** Kept as a name because a dozen call sites read better for it, but after FS-07 it is exactly
   * `parseValue` — object and array literals are ordinary atoms now, so field position and matcher
   * position can no longer drift apart. */
  private parseFieldValue(): FieldValue | null {
    return this.parseValue();
  }

  private parseObject(): ObjectLit | null {
    const start = this.peek().span.start;
    if (!this.expect('lbrace', '`{` to start an object')) return null;
    const fields: Field[] = [];
    if (!this.check('rbrace')) {
      for (;;) {
        const keyTok = this.peek();
        let key: string;
        if (keyTok.type === 'ident') key = this.advance().value;
        else if (keyTok.type === 'string') key = this.makeStringLit(this.advance()).value;
        else {
          this.error(Codes.UNEXPECTED_TOKEN, `expected a field name, found ${describeToken(keyTok)}`, keyTok.span);
          return null;
        }
        if (!this.expect('colon', '`:` after the field name')) return null;
        const value = this.parseFieldValue();
        if (!value) return null;
        fields.push({ type: 'Field', key, value, span: { start: keyTok.span.start, end: value.span.end } });
        if (this.check('comma')) {
          this.advance();
          if (this.check('rbrace')) break; // trailing comma
          continue;
        }
        break;
      }
    }
    if (!this.expect('rbrace', '`}` to close the object')) return null;
    return { type: 'ObjectLit', fields, span: this.spanFrom(start) };
  }

  private parseArray(): ArrayLit | null {
    const start = this.peek().span.start;
    if (!this.expect('lbracket', '`[` to start an array')) return null;
    const elements: FieldValue[] = [];
    if (!this.check('rbracket')) {
      for (;;) {
        const el = this.parseFieldValue();
        if (!el) return null;
        elements.push(el);
        if (this.check('comma')) {
          this.advance();
          if (this.check('rbracket')) break;
          continue;
        }
        break;
      }
    }
    if (!this.expect('rbracket', '`]` to close the array')) return null;
    return { type: 'ArrayLit', elements, span: this.spanFrom(start) };
  }

  private parseInterp(): Interp | null {
    const start = this.peek().span.start;
    if (!this.expect('lbrace', '`{` to start an interpolation')) return null;
    const first = this.expect('ident', 'a variable name inside `{…}`');
    if (!first) return null;
    const ref: PathSegment[] = [{ kind: 'prop', name: first.value }];
    while (this.check('dot') || this.check('lbracket')) {
      if (this.check('dot')) {
        this.advance();
        const name = this.expect('ident', 'a property name after `.`');
        if (!name) break;
        ref.push({ kind: 'prop', name: name.value });
      } else {
        this.advance();
        const idx = this.expect('number', 'an array index');
        this.expect('rbracket', '`]` to close the index');
        ref.push({ kind: 'index', index: idx ? Number(idx.value) : 0 });
      }
    }
    if (!this.expect('rbrace', '`}` to close the interpolation')) return null;
    return { type: 'Interp', ref, span: this.spanFrom(start) };
  }

  private makeStringLit(tok: Token): StringLit {
    return { type: 'StringLit', value: tok.value, parts: parseStringParts(tok.value), span: tok.span };
  }

  // -- token helpers ---------------------------------------------------------

  private peek(k = 0): Token {
    const idx = this.pos + k;
    return this.tokens[idx] ?? this.tokens[this.tokens.length - 1]!;
  }

  private previous(): Token {
    return this.tokens[this.pos - 1] ?? this.tokens[0]!;
  }

  private advance(): Token {
    const tok = this.tokens[this.pos]!;
    if (this.pos < this.tokens.length - 1) this.pos++;
    return tok;
  }

  private check(type: Token['type']): boolean {
    return this.peek().type === type;
  }

  private atEof(): boolean {
    return this.check('eof');
  }

  private isKw(tok: Token, word: string): boolean {
    return tok.type === 'ident' && tok.value === word;
  }

  private isMethodWord(tok: Token): boolean {
    return tok.type === 'ident' && (METHODS as readonly string[]).includes(tok.value.toUpperCase());
  }

  private expect(type: Token['type'], what: string): Token | null {
    if (this.check(type)) return this.advance();
    const tok = this.peek();
    this.error(Codes.UNEXPECTED_TOKEN, `expected ${what}, found ${describeToken(tok)}`, tok.span, `expected ${describeTokenType(type)}`);
    return null;
  }

  private expectKw(word: string, hint?: string): boolean {
    if (this.isKw(this.peek(), word)) {
      this.advance();
      return true;
    }
    const tok = this.peek();
    this.error(Codes.UNEXPECTED_TOKEN, `expected \`${word}\`, found ${describeToken(tok)}`, tok.span, hint);
    return false;
  }

  private expectString(what: string): StringLit | null {
    const tok = this.expect('string', what);
    return tok ? this.makeStringLit(tok) : null;
  }

  /** Consume the trailing NEWLINE; if trailing tokens remain, report once and recover to line end. */
  private endLine(): void {
    if (this.check('newline')) {
      this.advance();
      return;
    }
    if (this.atEof() || this.check('dedent')) return;
    const tok = this.peek();
    this.error(Codes.UNEXPECTED_TOKEN, `unexpected ${describeToken(tok)} at end of step`, tok.span, this.trailingHint(tok) ?? 'expected end of line');
    this.synchronize();
  }

  /** What the parser already knows about a token found where a line should have ended
   * (M84, C11/`A3-09`).
   *
   * `endLine()` is the parser's single widest failure surface — every step production ends there, so
   * every "you wrote something this step does not take" arrived with the same ``expected end of
   * line``. That hint restates the grammar slot the parser was in and says nothing about the mistake,
   * which is why one line of code was the whole diagnosis for five unrelated real-user errors: an
   * inline `within`, a tag on the `test` header, a per-step `timeout` on a UI wait, a conjoined
   * `expect`, and a duration unit spaced off its number.
   *
   * But by the time we arrive here the token has been *classified*, and for the shapes people
   * actually write the token alone identifies both the mistake and its fix. Anything unrecognized
   * still falls back to the generic hint — this is a lookup table of known mistakes, not a claim to
   * understand every one. */
  private trailingHint(tok: Token): string | null {
    if (tok.type === 'tag') {
      return `tags go on their own line above \`test\`, not on the header — put \`@${tok.value}\` on the line before it`;
    }
    if (tok.type !== 'ident') return null;
    switch (tok.value) {
      case 'within':
        return '`within` opens a block, it is not an inline suffix — put `within <locator>` on its own line and indent the steps it scopes';
      case 'timeout':
        // Two mistakes share this token since D640, and the second one is only distinguishable by
        // looking at the token after it — which is the same two-token test the grammar itself uses.
        return this.atWaitBudget()
          ? '`timeout wait <duration>` sets the poll budget of one `wait until` step — no other step has one. To bound a single request write `timeout <duration>`; to change the whole run set `timeout wait` in `tflw.config`'
          : 'a per-step `timeout` bounds one HTTP request, so it is only accepted on `api` requests — on a `wait until` write `timeout wait <duration>` to set the poll budget of that one step, or set `timeout step`, `timeout wait`, or `timeout expect` in `tflw.config`';
      case 'and':
        return 'one assertion per `expect` — put the second one on its own `expect` line';
      case 'ms':
      case 's':
      case 'm': {
        // The adjacency rule (`A3-13`): inside an expression a unit must touch its number, though
        // after `think`/`timeout` it need not. `previous()` is that number, so the fix can be shown
        // rather than described.
        const num = this.previous();
        return num.type === 'number'
          ? `a duration unit must touch its number here — write \`${num.value}${tok.value}\`, not \`${num.value} ${tok.value}\``
          : 'a duration unit must touch its number here, e.g. `500ms`';
      }
      default:
        return null;
    }
  }

  private synchronize(): void {
    while (!this.atEof() && !this.check('newline') && !this.check('dedent')) this.advance();
    if (this.check('newline')) this.advance();
  }

  private skipNewlines(): void {
    while (this.check('newline')) this.advance();
  }

  private spanFrom(start: Position): Span {
    return { start, end: this.previous().span.end };
  }

  /**
   * D168 — the one-slot back-off note. `parseIdentOrCall` no longer diagnoses a word run that misses
   * `(`; it backs off and lets the enclosing production speak. That is the right trade in the
   * positions `A3-05` names, because there the enclosing production is *sharper*:
   *
   * | written | back-off produces |
   * |---|---|
   * | `select {size} extra from field "Size"` | ``expected `from`, found `extra` `` — sharper than paren advice |
   * | `give create widget({id} extra)` | ``expected `)` to close the call`` — sharper |
   * | `let a = create order` | ``unexpected `order` at end of step`` — **worse** |
   *
   * Exactly one shape degrades: a genuine missing paren at end of line, where the enclosing
   * production has nothing to say but "expected end of line". So the message is relocated rather
   * than deleted — recorded here, and re-attached by `error()` if the very next diagnostic is raised
   * without the cursor having moved.
   *
   * **`at` is the whole lifetime mechanism.** `this.pos` only ever increases, so a note taken at one
   * position can never match a diagnostic raised later in the file; and it is cleared on use, so it
   * cannot be spent twice. The plan sketched the payload as `{ span, wordCount }` — `wordCount` is
   * not carried because the message names only the first word, exactly as the message it replaces
   * did, and a count nobody reads is a field that can drift.
   */
  private backOffNote: { readonly span: Span; readonly word: string; readonly at: number } | null = null;

  /** See `Program.recoveredSpans` (D168b). Only ever appended to when a note is actually *spent* on
   * a diagnostic — a back-off that the enclosing production went on to consume happily (the common
   * case, `random number lo to hi`) leaves nothing here, because its `VarRef` is a real variable
   * reference that must still be checked. */
  private readonly recoveredSpans: Span[] = [];

  private noteCallBackOff(first: Token): void {
    this.backOffNote = { span: first.span, word: first.value, at: this.pos };
  }

  /** D169's sibling of `backOffNote`: the enclosing production's *message* is fine, its **hint** is
   * not, because only the site that just parsed knows what the author was reaching for. Same one
   * slot, same position key, same expiry — and it never overrides `backOffNote`, which replaces the
   * whole diagnostic rather than decorating it. */
  private valueAdviceNote: { readonly hint: string; readonly at: number } | null = null;

  private noteValueAdvice(hint: string): void {
    this.valueAdviceNote = { hint, at: this.pos };
  }

  private error(
    code: string,
    message: string,
    span: Span,
    hint?: string,
    label?: string,
    deprecation?: { readonly replacement: string },
  ): void {
    const note = this.backOffNote;
    this.backOffNote = null;
    const advice = this.valueAdviceNote;
    this.valueAdviceNote = null;
    if (advice && advice.at === this.pos && code === Codes.UNEXPECTED_TOKEN && !(note && note.at === this.pos)) {
      hint = advice.hint;
    }
    if (note && note.at === this.pos && code === Codes.UNEXPECTED_TOKEN) {
      message = `\`${note.word}\` looks like the start of a call but never reaches \`(\``;
      span = note.span;
      hint = 'multi-word calls need parens, e.g. `create order(...)`';
      // Spending the note is exactly the moment the recovery `VarRef` is known to be junk: the
      // enclosing production could not use the token the back-off left behind, so the word run was
      // a malformed call after all. Recorded here and nowhere else — see `Program.recoveredSpans`.
      this.recoveredSpans.push(note.span);
    }
    // Panic mode (M83, C11/`A3-17`, `A2-07`). Each production diagnoses the token it is looking at,
    // so one bad token gets reported once per production that looks at it — and productions nest.
    // `expect body.items[-1].id equals 1` reported the same `-` three times: as a missing array
    // index, then as the `]` that would have closed it, then as a missing matcher. Three different
    // grammar slots, one mistake, and none of the three messages named it. Likewise a bad `timeout`
    // target was reported by the parser *and* by the config-key production one frame up, whose
    // suggestion contradicted the first message.
    //
    // The test is whether the cursor moved. A diagnostic raised without a single token having been
    // consumed since the last one is not news about a second mistake — it is the same mistake seen
    // from the next production up. Anything that genuinely consumed input reports normally.
    if (this.pos === this.lastErrorPos) return;
    this.lastErrorPos = this.pos;
    this.diagnostics.push({
      code,
      severity: 'error',
      message,
      span,
      ...(hint ? { hint } : {}),
      ...(label ? { label } : {}),
      ...(deprecation ? { deprecation } : {}),
    });
  }

  /** Refuse a word by its row in `REFUSED_WORDS` (`M142-01`, replacing `removedKeyword()`). The
   * whole diagnostic — code, message, hint, and the migrate payload that makes the fix a
   * single-token splice at `span` (M90b, cluster C8) — comes from the table, so a refusal is
   * *declared* in one place and *reached* from several rather than being restated at each.
   *
   * The payload is what makes `tflw migrate` able to act — and, via `renderDiagnostic`'s derived
   * line (D-M90-4), what makes the diagnostic offer the tool at all.
   *
   * Deliberately *not* used by `TF014`'s bare `check <locator>` (D-M90-3): that one has two honest
   * readings — `tick field "…"` (the old click) and `check field "…" is checked` (the assertion) —
   * and guessing wrong writes a mutation into a test that keeps passing. It stays a human decision,
   * and the absence of a payload is the whole mechanism by which migrate declines it. Which is why
   * a row's `replacement` is optional rather than assumed: `tests` has none.
   *
   * `RefusedSpelling` is derived from the table, so the lookup is total — a call naming a word with
   * no row fails to compile rather than silently reporting nothing. A row reached here always owns
   * its diagnostic; `tests` is the one that does not, and it is read directly at its site. */
  private refuse(word: RefusedSpelling, span: Span): void {
    const row = REFUSED_WORDS[word];
    // Every row reached through `refuse()` owns its diagnostic — `stepKeywords.test.ts` asserts it,
    // rather than this `!` asserting it silently.
    const { code, message } = row.diagnostic!;
    this.error(code, message, span, row.hint, undefined, row.replacement ? { replacement: row.replacement } : undefined);
  }
}

function toMs(n: number, unit: string): number {
  return n * (TIME_UNIT_MS[unit] ?? NaN);
}

/** Split a decoded string value into literal text and `{ref}` interpolation holes. */
export function parseStringParts(value: string): StringPart[] {
  const parts: StringPart[] = [];
  let text = '';
  let i = 0;
  while (i < value.length) {
    const ch = value[i]!;
    if (ch === '{') {
      const close = value.indexOf('}', i + 1);
      if (close !== -1) {
        const inner = value.slice(i + 1, close);
        const ref = parseRefText(inner);
        if (ref) {
          if (text) {
            parts.push({ kind: 'text', value: text });
            text = '';
          }
          parts.push({ kind: 'interp', ref });
          i = close + 1;
          continue;
        }
      }
    }
    text += ch;
    i++;
  }
  if (text) parts.push({ kind: 'text', value: text });
  return parts;
}

/** Parse `orderId`, `body.id`, `items[0].price` into path segments, or null if malformed. */
function parseRefText(text: string): PathSegment[] | null {
  const trimmed = text.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\s*\.\s*[A-Za-z_][A-Za-z0-9_]*|\s*\[\s*\d+\s*\])*$/.test(trimmed)) return null;
  const segs: PathSegment[] = [];
  const re = /\.\s*([A-Za-z_][A-Za-z0-9_]*)|\[\s*(\d+)\s*\]|^([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    if (m[3] !== undefined) segs.push({ kind: 'prop', name: m[3] });
    else if (m[1] !== undefined) segs.push({ kind: 'prop', name: m[1] });
    else if (m[2] !== undefined) segs.push({ kind: 'index', index: Number(m[2]) });
  }
  return segs.length > 0 ? segs : null;
}

export function parse(tokens: readonly Token[]): ParseResult {
  return new Parser(tokens).parse();
}

export function parseConfig(tokens: readonly Token[]): ConfigResult {
  return new Parser(tokens).parseConfig();
}

/** Entry point for `completion.ts` — see `Parser#runCompletion`. */
export function parseForCompletion(tokens: readonly Token[]): CompletionContext | null {
  return new Parser(tokens).runCompletion();
}

/** The `tflw.config` half (`M137a`, D444) — see `Parser#runConfigCompletion`. */
export function parseConfigForCompletion(tokens: readonly Token[]): CompletionContext | null {
  return new Parser(tokens).runConfigCompletion();
}
