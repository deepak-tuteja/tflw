// The canonical structured manifest of matcher/generator/CLI-flag signatures (PLAN decision 103,
// enterprise arc cluster 4, decision 16.4). Hand-authored — there's no `GeneratorName` union or
// CLI-flag type to introspect (generators parse via dedicated `parseUniqueExpr`/`parseRandomExpr`
// functions in parser.ts, not a typed list; `cli.ts`'s arg parsing is hand-rolled). This is the
// single source of truth going forward: `scripts/gen-spec-tables.mjs` renders the matcher and
// generator tables straight into SPEC.md between marker comments (replacing/augmenting what used
// to be hand-maintained prose tables); `packages/docs-site`'s Reference pages and a later LSP's
// hover/signature-help (PLAN_ENTERPRISE.md decision 17.7) import this module directly.

// `M174`/`D904`. The only import this module has, and it is `import type` — `ast.ts` imports one
// type from `token.ts` and nothing else, so this adds no runtime edge and cannot become the cycle
// `parser.ts` would be. It is what makes `SUBJECTS` below exhaustive by `tsc` rather than by a test.
import type { Subject } from './ast.js';

/**
 * Which *kind* of subject a matcher may stand against (M97b, D140). Five kinds, deliberately
 * coarse — this axis is decidable from the AST alone, and nothing finer is.
 *
 * `body bytes` is **not** a kind of its own, though SPEC's prose names it. The runtime's own test
 * is `!(value instanceof Uint8Array)` — an inspection of a value that does not exist until a
 * response arrives. That is the *shape* axis, and it stays where it can actually be evaluated.
 */
export type SubjectKind =
  /** Anything carrying a value off the response or the variable scope: `status`, `duration`,
   *  `header "…"`, `body`/`body text`/`body bytes`/`body csv`/`body pdf text`, `{variable}`. */
  | 'value'
  /** A UI locator — `button "Pay"`, `field "Email"`, `css "…"`, `text "…"`. */
  | 'locator'
  /** `page`. */
  | 'page'
  /** `request` — the connection attempt itself, carrying no response data (SPEC §6.2.2). */
  | 'request'
  /** `request to "<url>"` — an observed network request (SPEC §9.7). */
  | 'network-request'
  /** `response` — the last `api` step's response scanned as a whole, not addressed part by part
   *  (M128b, SPEC §9.10). Its own kind rather than `'value'` for the reason `'page'` is: it carries
   *  no value to compare against an operand, so every value matcher must reject it. */
  | 'response';

/** One row of SPEC §6.2's matcher table. `syntax`/`appliesTo`/`example` are markdown-ready cell
 * text (inline backticks already embedded where the original hand-written table had them) so the
 * generated table is byte-identical to what it replaces.
 *
 * `subjects`/`quantifiable` (M97b, D140) are the machine-readable half of `appliesTo`. Until now
 * this table stated compatibility only as prose, so the runtime restated it by hand in five places
 * and the checker stated it nowhere — `A4-11` and `A4-15` are both that gap. They are *not* a
 * second copy of the prose: they are the part of it a program can act on, and
 * `matcherSubjects.test.ts` holds the two in step.
 *
 * **Kind, not shape.** `contains` says "strings, arrays"; only the first word of that is knowable
 * before the response exists. So `contains`' row claims `value` — every value-bearing subject —
 * and its string-or-array requirement stays a runtime error, exactly where `body.msg` puts it
 * today. Reading these as a whitelist over both axes would make the checker reject valid programs,
 * which is the `A4-05` failure mode arriving as the fix for `A4-11`. */
export interface MatcherEntry {
  readonly id: string;
  readonly syntax: string;
  readonly appliesTo: string;
  readonly example: string;
  readonly status: 'shipped' | 'planned';
  /** Subject kinds this matcher may stand against. Sound by construction: a kind listed here is
   *  one the runtime genuinely accepts, so rejecting anything else cannot reject a valid program. */
  readonly subjects: readonly SubjectKind[];
  /** May an `any`/`all` quantifier precede it? False for the two matchers that read an external
   *  document (`matches schema`, `matches file`): element-by-element contract validation is not a
   *  thing either one can do, and the runtime's own reports of that are poor — `matches schema`
   *  throws a clear error, but `matches file` falls through to a message about UI matchers, and
   *  under `any` it is swallowed entirely into "none of N elements matched". */
  readonly quantifiable: boolean;
}

export const MATCHERS: readonly MatcherEntry[] = [
  { id: 'equals', syntax: '`equals`', appliesTo: 'any value', example: '`expect status equals 201`', status: 'shipped', subjects: ['value'], quantifiable: true },
  { id: 'contains', syntax: '`contains`', appliesTo: 'strings, arrays', example: '`expect body.msg contains "created"`', status: 'shipped', subjects: ['value'], quantifiable: true },
  { id: 'matches-regex', syntax: '`matches "<regex>"`', appliesTo: 'strings', example: '`expect header "content-type" matches "json"`', status: 'shipped', subjects: ['value'], quantifiable: true },
  { id: 'matches-subset', syntax: '`matches subset {...}`', appliesTo: 'objects', example: '`expect body matches subset { type: "about:blank", status: 422 }`', status: 'shipped', subjects: ['value'], quantifiable: true },
  { id: 'matches-schema', syntax: '`matches schema "Name" from "src"`', appliesTo: 'objects', example: '`expect body matches schema "ProductResponseDto" from "/openapi.json"`', status: 'shipped', subjects: ['value'], quantifiable: false },
  { id: 'matches-file', syntax: '`matches file "<path>"`', appliesTo: '`body bytes`', example: '`expect body bytes matches file "expected-receipt.pdf"`', status: 'shipped', subjects: ['value'], quantifiable: false },
  { id: 'greater-less-than', syntax: '`is greater than` / `is less than`', appliesTo: 'numbers, `duration`', example: '`expect body.total is less than 100`', status: 'shipped', subjects: ['value'], quantifiable: true },
  { id: 'has-count', syntax: '`has count <value>`', appliesTo: 'arrays, UI lists, `body bytes`', example: '`expect body.items has count 3`', status: 'shipped', subjects: ['value', 'locator'], quantifiable: true },
  { id: 'has-count-at-least', syntax: '`has count at least <value>`', appliesTo: 'arrays, UI lists, `body bytes`', example: '`expect body.items has count at least 1`', status: 'shipped', subjects: ['value', 'locator'], quantifiable: true },
  { id: 'has-count-at-most', syntax: '`has count at most <value>`', appliesTo: 'arrays, UI lists, `body bytes`', example: '`expect body.items has count at most 50`', status: 'shipped', subjects: ['value', 'locator'], quantifiable: true },
  { id: 'is-empty', syntax: '`is empty` / `is not empty`', appliesTo: 'strings, arrays, objects', example: '`expect body.errors is empty`', status: 'shipped', subjects: ['value'], quantifiable: true },
  { id: 'has-value', syntax: '`has value`', appliesTo: 'UI fields', example: '`expect field "Email" has value "a@b.c"`', status: 'shipped', subjects: ['locator'], quantifiable: false },
  { id: 'state-word', syntax: '`is visible/hidden/enabled/disabled/checked`', appliesTo: 'UI locators', example: '`expect button "Pay" is enabled`', status: 'shipped', subjects: ['locator'], quantifiable: false },
  { id: 'connects', syntax: '`connects`', appliesTo: '`request`', example: '`expect request connects`', status: 'shipped', subjects: ['request'], quantifiable: false },
  { id: 'fails', syntax: '`fails` / `fails matching "<regex>"`', appliesTo: '`request`', example: '`expect request fails matching "certificate"`', status: 'shipped', subjects: ['request'], quantifiable: false },
  { id: 'was-made', syntax: '`was made`', appliesTo: '`request to "<url>"`', example: '`expect request to "/api/orders" was made`', status: 'shipped', subjects: ['network-request'], quantifiable: false },
  { id: 'has-no-a11y-violations', syntax: '`has no [minor/moderate/serious/critical] a11y violations`', appliesTo: '`page`', example: '`expect page has no critical a11y violations`', status: 'shipped', subjects: ['page'], quantifiable: false },
  { id: 'has-no-security-violations', syntax: '`has no [minor/moderate/serious/critical] security violations`', appliesTo: '`response`', example: '`expect response has no serious security violations`', status: 'shipped', subjects: ['response'], quantifiable: false },
  { id: 'has-no-authorization-violations', syntax: '`has no [minor/moderate/serious/critical] authorization violations`', appliesTo: '`response`', example: '`expect response has no authorization violations`', status: 'shipped', subjects: ['response'], quantifiable: false },
  { id: 'has-no-input-handling-violations', syntax: '`has no [minor/moderate/serious/critical] input handling violations`', appliesTo: '`response`', example: '`expect response has no input handling violations`', status: 'shipped', subjects: ['response'], quantifiable: false },
  { id: 'matches-snapshot', syntax: '`matches snapshot "<name>" [mask <locator>]*`', appliesTo: '`page`, UI locators', example: '`expect page matches snapshot "checkout-page" mask css ".timestamp"`', status: 'shipped', subjects: ['page', 'locator'], quantifiable: false },
] as const;

/**
 * `MatcherName` (the AST's spelling) → the `MATCHERS` row that governs it. `MATCHERS` is keyed by
 * *documentation* id, which is coarser: five state words share one `state-word` row because SPEC
 * §6.2 shows them on one line, and `is greater than`/`is less than` likewise. The checker needs the
 * finer key, so the fan-out is written here once rather than at each consumer.
 *
 * `matcherSubjects.test.ts` asserts this map is total over `MatcherName` and lands only on real
 * `MATCHERS` ids — a new matcher then cannot reach the checker without someone saying which
 * subjects it accepts.
 */
export const MATCHER_ROW_BY_NAME: Readonly<Record<string, string>> = {
  equals: 'equals',
  contains: 'contains',
  matches: 'matches-regex',
  matchesSubset: 'matches-subset',
  matchesSchema: 'matches-schema',
  matchesFile: 'matches-file',
  greaterThan: 'greater-less-than',
  lessThan: 'greater-less-than',
  hasCount: 'has-count',
  hasCountAtLeast: 'has-count-at-least',
  hasCountAtMost: 'has-count-at-most',
  isEmpty: 'is-empty',
  hasValue: 'has-value',
  visible: 'state-word',
  hidden: 'state-word',
  enabled: 'state-word',
  disabled: 'state-word',
  checked: 'state-word',
  connects: 'connects',
  fails: 'fails',
  wasMade: 'was-made',
  hasNoA11yViolations: 'has-no-a11y-violations',
  hasNoSecurityViolations: 'has-no-security-violations',
  hasNoAuthzViolations: 'has-no-authorization-violations',
  hasNoInputHandlingViolations: 'has-no-input-handling-violations',
  matchesSnapshot: 'matches-snapshot',
};

/** One row of SPEC §7's new generators quick-reference table (§7.2/§7.3 previously had no table,
 * prose only). `syntax`/`example` are markdown-ready cell text. */
export interface GeneratorEntry {
  readonly id: string;
  readonly family: 'unique' | 'random' | 'transform';
  readonly syntax: string;
  readonly notes: string;
  readonly example: string;
}

export const GENERATORS: readonly GeneratorEntry[] = [
  { id: 'unique-prefix', family: 'unique', syntax: '`unique("prefix")`', notes: 'collision-safe across tests/workers/retries and across runs — every value carries a run namespace taken from the run clock (`--now` pins it; `--seed` never moves it)', example: '`unique("Widget")`' },
  { id: 'unique-email', family: 'unique', syntax: '`unique email`', notes: 'collision-safe across tests/workers/retries and across runs — every value carries a run namespace taken from the run clock (`--now` pins it; `--seed` never moves it)', example: '`unique email`' },
  { id: 'unique-number', family: 'unique', syntax: '`unique number`', notes: 'collision-safe across tests/workers/retries and across runs — every value carries a run namespace taken from the run clock (`--now` pins it; `--seed` never moves it); 2^23 draws per run, refused rather than wrapped past a safe integer', example: '`unique number`' },
  { id: 'unique-like', family: 'unique', syntax: '`unique like "ORD-######"`', notes: '`#` = digit, `?` = letter; the run-wide counter is rendered into the placeholders through a permutation keyed by the pattern and the run namespace, so distinctness within a run is guaranteed and across runs is probabilistic (bounded by the pattern) — a pattern too narrow to encode the counter is refused rather than allowed to repeat', example: '`unique like "ORD-######"`' },
  { id: 'unique-uuid', family: 'unique', syntax: '`unique uuid`', notes: 'v4-shaped; the trailing digits are the run-wide counter and the four bytes before them are the run namespace, so distinctness within and across runs is guaranteed, not probabilistic', example: '`unique uuid`' },
  { id: 'random-number', family: 'random', syntax: '`random number A to B` / `random decimal A to B`', notes: 'seed-reproducible; a reversed range is refused — at check time when both bounds are literal, at run time otherwise', example: '`random number 1 to 100`' },
  { id: 'random-date', family: 'random', syntax: '`random date in past` / `in future` / `between A and B`', notes: 'seed- and run-clock-reproducible (`--seed`/`--now`); `between` refuses a reversed range, and a bound that is not a date', example: '`random date in past`' },
  { id: 'random-of', family: 'random', syntax: '`random of "a", "b", ...`', notes: 'seed-reproducible pick from an inline list', example: '`random of "red", "blue", "green"`' },
  { id: 'random-string', family: 'random', syntax: '`random string N`', notes: 'seed-reproducible alnum string of length N; `0` is legal and yields `""`, a negative length is refused', example: '`random string 12`' },
  { id: 'random-like', family: 'random', syntax: '`random like "SKU-####-??"`', notes: '`#` = digit, `?` = letter; seed-reproducible pattern fill', example: '`random like "SKU-####-??"`' },
  { id: 'random-uuid', family: 'random', syntax: '`random uuid`', notes: 'v4, collisions allowed (not collision-guaranteed like `unique uuid`)', example: '`random uuid`' },
  { id: 'random-password', family: 'random', syntax: '`random password [N]`', notes: 'default length 12, min 4; satisfies a validation policy, not fake-identity realism', example: '`random password 16`' },
  { id: 'transform-base64', family: 'transform', syntax: '`base64 encode(...)` / `base64 decode(...)`', notes: 'pure deterministic value transform, not a fresh-value generator', example: '`base64 encode("{email}:{password}")`' },
  { id: 'transform-hex', family: 'transform', syntax: '`hex encode(...)` / `hex decode(...)`', notes: 'pure deterministic value transform, not a fresh-value generator', example: '`hex encode("{token}")`' },
  { id: 'transform-length', family: 'transform', syntax: '`length of <value>`', notes: 'the length of a string or a list — what `.length` reads; binds tighter than arithmetic', example: '`let n = length of {items}`' },
  { id: 'transform-join', family: 'transform', syntax: '`<list> joined with <separator>`', notes: 'a list of strings and numbers as one string; binds loosest of all', example: '`let csv = {ids} joined with ","`' },
  { id: 'transform-url', family: 'transform', syntax: '`url encode(...)` / `url decode(...)`', notes: 'pure deterministic value transform, not a fresh-value generator', example: '`url encode("{query}")`' },
] as const;

/**
 * One step keyword — the word a step line starts with (`M125e`, `FU-24`, D251/D277).
 *
 * The row this closes was not "hover has a bug". `completion.ts` held thirty-seven bare strings
 * consumed as `.map((label) => ({ label }))`, and that single fact was underneath both halves of it:
 * completion offered `api` without saying what it does, and hover had nothing to draw on for it. So
 * this is the same manifest shape `MATCHERS`/`GENERATORS` already are, for the same reason — one
 * table, two consumers, no restatement.
 *
 * **Held to `parser.ts`, not to prose (D277).** Unlike matchers and generators, step keywords have
 * a second authority: `STATEMENT_KEYWORDS` is the list the parser actually dispatches on.
 * `stepKeywords.test.ts` asserts two-way parity against it plus `WORKLOAD_DIRECTIVES`, so an entry
 * for a keyword the parser rejects and a keyword the parser accepts with no entry are both test
 * failures rather than a drift nobody notices. The two retired spellings (`think`, `uncheck`) are
 * deliberately absent: they exist only so the parser can reject them by name, and a manifest that
 * documented them would be teaching a spelling that is itself an error.
 *
 * `header "…" is "…"` is knowingly not here. It is a `Step` node, but it is dispatched inside an
 * `api`/`wait until api` block rather than by keyword, so it is in neither parity list — adding it
 * would mean the manifest offers a word completion does not, which is the drift this table exists
 * to prevent. Give it a home in both lists, or leave it in neither.
 */
export interface StepKeywordEntry {
  /** The keyword exactly as it is typed and exactly as completion labels it. */
  readonly id: string;
  readonly family: 'api' | 'assertion' | 'value' | 'browser' | 'workload';
  /** Markdown-ready, and free of `|` — this string is rendered into a SPEC.md table cell, where an
   * unescaped pipe silently becomes a column break. Alternatives use ` / `, the form `GENERATORS`
   * already uses (`random number A to B` / `random decimal A to B`). */
  readonly syntax: string;
  readonly summary: string;
  readonly example: string;
}

/** The five workload words `parseTestBody` dispatches before `parseStep()` is ever reached (§4.5),
 * plus the two clause keywords that share that loop. Not `STATEMENT_KEYWORDS` members — but they
 * are what a user types at the same cursor position, so completion has always offered them, and
 * D277's parity assertion needs them to have a name to be asserted against. FS-06: leading here
 * reserves nothing, so `run checkout("1")` stays a callable action. */
export const WORKLOAD_DIRECTIVES = ['ramp', 'hold', 'step', 'spike', 'run', 'threshold'] as const;

export const STEP_KEYWORDS: readonly StepKeywordEntry[] = [
  { id: 'api', family: 'api', syntax: '`api [<service>] <METHOD> <target> [body …] [timeout <dur>] [without redirects]`', summary: 'issue one HTTP request; `<target>` is a path against the env base URL or an absolute URL', example: '`api POST /orders body { name: "Widget", qty: 1 }`' },
  { id: 'wait', family: 'api', syntax: '`wait until api <METHOD> <target>` + indented expects, or `wait until <pollable subject> [is] <matcher> [for <dur>]`', summary: 're-issue a request, or re-poll a browser condition, until it passes or the wait budget elapses', example: '`wait until button "Submit" is enabled`' },
  { id: 'expect', family: 'assertion', syntax: '`expect <subject> [not] <matcher> [value]`', summary: 'hard assertion — evaluated once against the received response, fails the test immediately', example: '`expect status equals 201`' },
  { id: 'check', family: 'assertion', syntax: '`check <subject> [not] <matcher> [value]`', summary: 'the soft twin of `expect`: records a failure and keeps going. Not the checkbox action — that is `tick`', example: '`check body.total equals 42`' },
  { id: 'let', family: 'value', syntax: '`let <name> = <expr>`', summary: 'bind a value — a literal, a generator, an expression, or a call — for later steps to interpolate as `{name}`', example: '`let email = unique email`' },
  { id: 'capture', family: 'value', syntax: '`capture <subject> as <name>`', summary: 'bind a value off the response; a capture that resolves to nothing fails the step rather than binding `undefined`', example: '`capture body.id as orderId`' },
  { id: 'log', family: 'value', syntax: '`log [<level>] "<message>"`', summary: 'emit one user-authored line into the run log and the report', example: '`log "created order {orderId}"`' },
  { id: 'give', family: 'value', syntax: '`give <expr>`', summary: "an action's return value; ends its step sequence", example: '`give {orderId}`' },
  { id: 'open', family: 'browser', syntax: '`open "<path-or-url>"`', summary: 'navigate the active page — a path resolves against the env `web` base URL, an absolute URL is the address', example: '`open "/checkout"`' },
  { id: 'click', family: 'browser', syntax: '`click <locator>`', summary: 'left-click the element a locator resolves to', example: '`click button "Add to cart"`' },
  { id: 'double', family: 'browser', syntax: '`double click <locator>`', summary: 'double-click the element a locator resolves to', example: '`double click button "Row"`' },
  { id: 'right', family: 'browser', syntax: '`right click <locator>`', summary: 'right-click (context-menu click) the element a locator resolves to', example: '`right click button "Row"`' },
  { id: 'fill', family: 'browser', syntax: '`fill <locator> with <value>`, or `fill form` + an indented table', summary: 'type a value into one field, or fill several from a table where each row reports as its own sub-step', example: '`fill field "Email" with {email}`' },
  { id: 'select', family: 'browser', syntax: '`select "<option>" from <locator>`', summary: 'choose an option in a `<select>`', example: '`select "Widget" from field "Size"`' },
  { id: 'tick', family: 'browser', syntax: '`tick <locator>`', summary: 'tick a checkbox or radio. Spelled `tick`, not `check` — `check` is the soft assertion and nothing else', example: '`tick field "Accept terms"`' },
  { id: 'untick', family: 'browser', syntax: '`untick <locator>`', summary: 'untick a checkbox', example: '`untick field "Accept terms"`' },
  { id: 'press', family: 'browser', syntax: '`press "<key>" [on <locator>]`', summary: 'send a key press — page-level, or scoped to one locator', example: '`press "Enter" on field "Search"`' },
  { id: 'hover', family: 'browser', syntax: '`hover <locator>`', summary: 'move the pointer over the element a locator resolves to', example: '`hover button "Menu"`' },
  { id: 'scroll', family: 'browser', syntax: '`scroll to <locator>`', summary: 'scroll the element into view', example: '`scroll to button "Load more"`' },
  { id: 'within', family: 'browser', syntax: '`within <locator>` or `within frame <locator>` + an indented block', summary: "scope nested steps to one container — or, with `frame`, into an iframe's own document", example: '`within list "Cart items"`' },
  { id: 'accept', family: 'browser', syntax: '`accept dialog` / `accept dialog with <value>`', summary: 'arm a handler accepting the *next* native dialog; armings queue, one dialog each, in order; without one Playwright auto-dismisses silently. `with` types an answer into a `prompt` and interpolates; reaching a kind that takes no answer is `TF080`, and an arming no dialog ever consumes is `TF079` — both runtime warnings', example: '`accept dialog with "Blue"`' },
  { id: 'dismiss', family: 'browser', syntax: '`dismiss dialog`', summary: 'arm a handler dismissing the next native dialog; armings queue, one dialog each, in order; an arming no dialog ever consumes is `TF079`, a runtime warning', example: '`dismiss dialog`' },
  { id: 'switch', family: 'browser', syntax: '`switch to new tab` + an indented block, or `switch to tab <N>`', summary: 'make another tab active — the block form arms the popup listener before running, so a fast tab cannot race past it', example: '`switch to tab 1`' },
  { id: 'close', family: 'browser', syntax: '`close tab`', summary: 'close the active tab and fall back to the previous one; closing the last tab is a runtime error', example: '`close tab`' },
  { id: 'download', family: 'browser', syntax: '`download as <name>` + an indented block', summary: "run the block with a download listener armed, then bind the download's suggested filename", example: '`download as file`' },
  { id: 'drag', family: 'browser', syntax: '`drag <locator> to <locator>`', summary: 'dispatch a real native drag-and-drop sequence with a genuine `DataTransfer`', example: '`drag text "First item" to text "Second item"`' },
  { id: 'drop', family: 'browser', syntax: '`drop file "<path>" onto <locator>`', summary: 'drop a real file onto a dropzone that has no `<input type="file">`', example: '`drop file "./receipt.png" onto css "#dropzone"`' },
  { id: 'screenshot', family: 'browser', syntax: '`screenshot "<name>"`', summary: 'capture the active page unconditionally; binary evidence, so only captured at `evidence full`', example: '`screenshot "before payment"`' },
  { id: 'stub', family: 'browser', syntax: '`stub <METHOD> "<url-pattern>" respond status <N> [body …]`', summary: 'intercept a matching network request and answer it, without touching the server', example: '`stub POST "/api/payments/**" respond status 500`' },
  { id: 'together', family: 'api', syntax: '`together`', summary: 'the rows of a `with each concurrently` test wait here for one another, then go on at once — each row does its own setup first, and the racing step leaves every row at the same moment. Only at the top level of such a test (`TF092`)', example: '`together`' },
  { id: 'pause', family: 'browser', syntax: '`pause <duration>`', summary: 'wait a fixed duration; a real wait belongs in `wait until`, not here', example: '`pause 500ms`' },
  { id: 'ramp', family: 'workload', syntax: '`ramp to N users over <dur>` / `ramp to N rps over <dur>`', summary: 'linear ramp from zero to the target — makes the test workload-bearing', example: '`ramp to 50 users over 30s`' },
  { id: 'hold', family: 'workload', syntax: '`hold N users for <dur>` / `hold N rps for <dur>`', summary: 'a flat target for the whole duration, with no ramp-in', example: '`hold 20 rps for 2m`' },
  { id: 'step', family: 'workload', syntax: '`step users` / `step rps` + indented `to N for <dur>` lines', summary: 'a staircase of instant jumps, each held for its own duration', example: '`step users`' },
  { id: 'spike', family: 'workload', syntax: '`spike users` / `spike rps` + indented `hold N for <dur>` / `to N over <dur>` lines', summary: 'a baseline → burst → recovery shape, mixing flat and ramped stages in any order', example: '`spike rps`' },
  { id: 'run', family: 'workload', syntax: '`run N iterations [per user] across M users`', summary: 'count-bounded load with no duration; the count is exact and independent of `--workers`', example: '`run 500 iterations across 10 users`' },
  { id: 'threshold', family: 'workload', syntax: '`threshold <metric> is less than <value>`', summary: "the pass/fail rule for a workload-bearing test — decided once, after the run, against the run's aggregate metrics", example: '`threshold p95 duration is less than 800ms`' },
] as const;

/** One CLI flag, entered by hand (decision 16.4 — `cli.ts`'s arg parsing has nothing to
 * introspect). Feeds `packages/docs-site`'s `Reference/cli.md` (replacing README's old flag
 * table, decision 16.10) and a later LSP's signature help. */
export interface CliFlagEntry {
  readonly flag: string;
  readonly command: 'run' | 'check' | 'init' | 'install-browsers' | 'pick' | 'record' | 'watch' | 'migrate' | 'fmt' | 'export' | 'merge' | 'doctor' | 'ui' | 'spec' | 'global';
  readonly effect: string;
}

/**
 * Every directive `tflw.config` accepts at its top level, in the order `TF022` should name them
 * (M110, review row `V4-04`).
 *
 * This exists because the list was written down twice — once as the parser's branch chain and its
 * `TF022` message, once as `TF022`'s `meaning` below — and the two disagreed for five days.
 * `exclude` shipped in M58 as a fifth directive; the manifest row kept saying four, so
 * `tflw docs diagnostic-codes`, SPEC §17, the docs-site reference page and LSP hover all told a
 * reader that a directive the tool accepts is not one, while the tool's own error message listed
 * it correctly. One stale string, four surfaces, because all four generate from this file.
 *
 * So neither copy is authored any more: `parser.ts` builds the `TF022` message from this array and
 * carries a compile-time exhaustiveness check that it has a branch for every entry, and the
 * `TF022` row's `meaning` interpolates it. Adding a sixth directive updates all five surfaces or
 * fails the build; it cannot half-land again.
 */
export const CONFIG_DIRECTIVES = ['defaults', 'env', 'session', 'signer', 'require', 'exclude', 'helpers', 'runs'] as const;

export type ConfigDirective = (typeof CONFIG_DIRECTIVES)[number];

/** `` `a`, `b`, or `c` `` — the directive list as `TF022`'s message and `meaning` both render it. */
export function listConfigDirectives(): string {
  const quoted = CONFIG_DIRECTIVES.map((d) => `\`${d}\``);
  return `${quoted.slice(0, -1).join(', ')}, or ${quoted[quoted.length - 1]}`;
}

/** Which position in `tflw.config` a word may be typed at (`M137a`, D444). Three, and they are the
 * three the parser instruments for completion:
 *
 *  - `directive` — column 0, the top level of the file. Exactly `CONFIG_DIRECTIVES`.
 *  - `key` — an entry inside a `defaults` or `env` block. Exactly `parser.ts`'s `CONFIG_KEYS`.
 *  - `probe` — a sub-clause line under `authorized target`. Exactly `PROBE_SUB_CLAUSES`.
 *
 * **Placement is deliberately not recorded here.** Six of the fifteen keys are legal in only one of
 * the two blocks, and that rule already exists twice — `parser.ts`'s `DEFAULTS_ONLY_KEYS`/
 * `ENV_ONLY_KEYS` and the checker's `TF025`, held together by `teaching.test.ts`'s round-trip.
 * A third statement of it, in a file neither of those consults, is the drift this milestone exists
 * to stop. Completion filters through the parser's own `configKeyAllowedIn` instead. */
export type ConfigKeywordSlot = 'directive' | 'key' | 'probe';

export interface ConfigKeywordEntry {
  /** The word exactly as it is typed. Completion labels a `probe` row as `probe <id>` at the start
   * of a sub-clause line and as a bare `<id>` after the word `probe`, which are the two positions a
   * person actually types it from. */
  readonly id: string;
  readonly slot: ConfigKeywordSlot;
  /** One line, rendered inline beside the label by a completion widget. `FU-24`/D251's bar: a
   * candidate list that names a word and says nothing about it is the defect `M125e` closed for the
   * step list, and shipping the config dialect's first-ever candidate list without it would open
   * that defect again one dialect over. */
  readonly summary: string;
}

/**
 * Every word `tflw.config` completion offers, with the line it says about itself (`M137a`, D444).
 *
 * The config dialect had **no completion at all** until this milestone: `CompletionKind` had no
 * config variant, `runCompletion()` only ever entered the test-dialect parser, and `server.ts`'s
 * `onCompletion` returned `[]` for any buffer that was not `kind: 'test'`. Three layers, each of
 * which alone was enough — which is why `probe mutating` had been in the language since `M130b` and
 * had never been completable.
 *
 * Held to the parser's own arrays by `configCompletionDetail.test.ts`, the `stepKeywords.test.ts`
 * shape (D277). A fourth hand-maintained wordlist is precisely what `B5-09` is, and this milestone
 * is fixing the third instance of it; adding one uncontrolled would be an unusually direct way to
 * lose the argument.
 */
export const CONFIG_KEYWORDS: readonly ConfigKeywordEntry[] = [
  { id: 'defaults', slot: 'directive', summary: 'settings shared by every environment; at most one per config' },
  { id: 'env', slot: 'directive', summary: 'one named environment and its own base URLs, selected by `--env` or the `default` marker' },
  { id: 'session', slot: 'directive', summary: 'a reusable identity — steps that authenticate, an `oauth2` block, or an `oauth2 code` sign-in through a browser — attached to a test with `as <name>`, and optionally scoped to named envs with `for env <a>[, <b>...]`' },
  { id: 'signer', slot: 'directive', summary: 'a request signature as a credential — `hmac` over a template you write, or AWS `sigv4` — used by a step\'s `sign with <name>` or a session\'s `signed with <name>`; its secret never appears in a test file' },
  { id: 'require', slot: 'directive', summary: 'environment variables that must be set before a run starts; `tflw check` refuses an undeclared `env()` and names any that are unset, and `tflw run` refuses before its first request' },
  { id: 'exclude', slot: 'directive', summary: 'glob patterns that discovery skips when a run names a folder rather than a file' },
  { id: 'helpers', slot: 'directive', summary: 'the directories a `use` may load a JS/TS module from, relative to `tflw.config`; `./helpers` and `./tests/helpers` when the file declares none, and a `use` resolving outside them is `TF083`' },
  { id: 'runs', slot: 'directive', summary: 'how many runs `tflw ui` lists before it forgets the oldest ended one — `runs keep 20`; 50 when the file says nothing' },

  { id: 'header', slot: 'key', summary: 'a request header sent on every `api` step' },
  { id: 'timeout', slot: 'key', summary: 'the default per-step budget; `timeout api`/`timeout browser` set the two independently' },
  { id: 'workers', slot: 'key', summary: 'how many test files run concurrently' },
  { id: 'report', slot: 'key', summary: 'which report artifacts a run writes, and where' },
  { id: 'web', slot: 'key', summary: 'the base URL a browser `open "/path"` resolves against; `web env NAME default "<url>"` takes it from the environment variable when set, the literal otherwise — a plain value, never redacted' },
  { id: 'api', slot: 'key', summary: 'the base URL an `api <METHOD> /path` step resolves against; named forms declare additional services; `api [<service>] env NAME default "<url>"` takes it from the environment variable when set, the literal otherwise — a plain value, never redacted' },
  { id: 'insecure', slot: 'key', summary: 'accept a TLS certificate that does not verify — for a self-signed local target, never for a shared one' },
  { id: 'cert', slot: 'key', summary: 'a client certificate presented on every request (mTLS)' },
  { id: 'key', slot: 'key', summary: 'the private key belonging to `cert`' },
  { id: 'allow', slot: 'key', summary: '`allow hosts "…"` — the hosts a run may talk to at all; anything else is refused before a request is made' },
  { id: 'authorized', slot: 'key', summary: '`authorized target "<url>" reason "<text>"` — written permission for the security scans to probe that target; `authorized target env NAME default "<url>" reason …` takes the origin from the environment variable when set' },
  { id: 'evidence', slot: 'key', summary: 'how much of each request and response the report keeps: `full`, `headers only` or `none`. `--evidence full|headers-only|none` overrides it for one run' },
  { id: 'teardown', slot: 'key', summary: "when a workload's `after` hooks run after an iteration: `always`, `on success` or `never` — after all of them, only after the ones that passed, or after none. Anything but `always` leaves that run's data in place for investigation and skips those hooks' own assertions with it; `on success` reads the *iteration's* verdict, not the run's thresholds. `--teardown` overrides it for one run" },
  { id: 'redact', slot: 'key', summary: 'body paths, headers and query parameters whose values never reach a report or a log' },
  { id: 'viewport', slot: 'key', summary: 'the browser window size every browser test starts at' },
  { id: 'log', slot: 'key', summary: '`log level`/`log destination` — how much the run says, and where it says it' },
  { id: 'baseline', slot: 'key', summary: '`baseline "<file>"` — the accepted-findings document a security run grades itself against; listed findings still render, marked known/accepted. `--baseline <file>` overrides it for one run' },

  { id: 'mutating', slot: 'probe', summary: 'permit probes that change server state — the authorization scans cannot judge a write without it' },
  { id: 'oversized', slot: 'probe', summary: 'permit oversized-input payloads, which can be expensive for the target to reject' },
  { id: 'traversal', slot: 'probe', summary: 'permit path-traversal payloads, which some proxies answer before the application ever sees them' },
  { id: 'ciphers', slot: 'probe', summary: 'permit one TLS handshake per candidate suite, so the scan judges what this host OFFERS and not only the suite it gave us' },
] as const;

/**
 * One worked example of a diagnostic, as **source rather than prose** (M110b, review row
 * `M110-01`).
 *
 * Until now a row's `example` was a hand-written markdown string, and nothing ever ran it. That is
 * how `V4-05` shipped: `TF027`'s worked example printed `TF030` — a *different code* — under a
 * `TF027` heading, on SPEC §17, the docs-site reference, `tflw docs diagnostic-codes` and LSP hover
 * at once, for the fifty milestones between the V4 pass and M110. `diagnosticsCoverage.test.ts`
 * cannot see that: it checks a row *exists* per code, never that it is right.
 *
 * **There is deliberately no separate `probe` field.** A probe authored beside the prose can be
 * correct while the prose stays wrong, which is this arc's vacuous-control class arriving as its
 * own remedy. So the probe *is* the example: `DiagnosticEntry.example` is **computed** from these
 * by `renderDiagnosticExample` and never typed, which is what makes the rendered cell unable to
 * claim something the probe does not do.
 *
 * Two claims per probe, both machine-checked by `diagnosticExamples.test.ts`:
 *   · `source` must emit the row's own code.
 *   · `says`, when present, must appear verbatim in that diagnostic's `message` or `hint`.
 *
 * `as` is the one unchecked field, and it carries no claim: it is display prose for a probe whose
 * source cannot be read inline — an indentation column, a tab, an invisible character, a five-line
 * `with each` table. The code and the quoted output are still asserted underneath it.
 */
export interface DiagnosticProbe {
  /** How to make `source` a whole file. `step` indents it into a `test` body; `file` is a `.tflw`
   *  file as written; `config` is `tflw.config`, the declaration-only dialect. Examples are
   *  fragments, not programs — without this, `expect statuss equals 200` reports `TF016` (a step
   *  outside any block) and `web "…"` reports `TF022` (a config directive at top level), which is
   *  the harness being wrong rather than the row. */
  readonly wrap: 'step' | 'file' | 'config';
  /** The lines of tflw source, unindented for `step`. */
  readonly source: readonly string[];
  /** A fragment of what the tool says back — asserted to appear in the emitted `message` or
   *  `hint`, and rendered into the cell after `→`. */
  readonly says?: string;
  /** Display prose shown instead of the source. The source still runs and is still asserted. */
  readonly as?: string;
  /** What the *project around the file* would have to hold for this probe to fire — the same
   *  `undefined`-vs-`[]` doctrine `ProgramCheckOptions` documents. Restated structurally rather
   *  than imported, because `checker.ts` imports this module, not the other way round. */
  readonly needs?: {
    readonly services?: readonly string[];
    readonly sessions?: readonly string[];
    /** `TF086` (`M246`) — the signers the active env has. */
    readonly signers?: readonly string[];
    /** `TF088` (`M247`) — every env block the config declares. */
    readonly envs?: readonly string[];
    readonly missingFiles?: readonly string[];
    /** `TF083` — the `helpers` policy: the allowed directories and the checked file's own path, both relative to `tflw.config`'s directory. */
    readonly helpers?: { readonly dirs: readonly string[]; readonly file: string; readonly refuseAll?: boolean };
    readonly importedActions?: readonly { readonly name: string; readonly arity: number; readonly from: string }[];
    /** `M147c`/`M140-03` — which `import` path literals name a file that exists and does not parse,
     *  for `TF073`. Absence is meaningful the way `missingFiles`' is: `checkImportsParse` skips
     *  entirely without it, so a probe that forgets it asserts on silence. */
    readonly importsWithErrors?: readonly string[];
    /** M116/D148 — which base URLs the active env declares, for `TF051`. The only `needs` field
     *  whose *absence* is itself meaningful to assert: `checkBaseUrls` skips entirely without it,
     *  so a probe that forgets it silently emits nothing rather than the wrong thing. */
    readonly envBaseUrls?: { readonly envName: string; readonly api: boolean; readonly web: boolean };
    /** M124/D236 — the active env's `timeout wait` in ms, for `TF055`. Absence is meaningful in the
     *  same way `envBaseUrls`' is: `checkHoldWindows` skips without it, so a probe that forgets it
     *  asserts on silence rather than on the rule. */
    readonly envTimeouts?: { readonly envName: string; readonly wait: number };
    /** M125b1/D263 — the active env's accumulated `allow hosts`, for `TF057`/`TF058`. Unlike the two
     *  above, absence does **not** silence the pass: it selects `TF057` instead of `TF058`, so a
     *  probe that forgets this field asserts on the *other* rule rather than on nothing. That is a
     *  louder failure than a silent one, which is the only reason this field is safe to forget. */
    readonly envAllowHosts?: { readonly envName: string; readonly hosts: readonly string[] };
    /** M128b/D291 — the active env's `authorized target` declarations and its literal `api` base
     *  URL, for `TF060`. Absence is meaningful the way `envBaseUrls`' is: `checkAuthorizedTargets`
     *  skips entirely without it, so a probe that forgets it asserts on silence. */
    readonly envAuthorizedTargets?: {
      readonly envName: string;
      readonly targets: readonly { readonly target: string; readonly reason: string }[];
      readonly apiBaseUrl: string | null;
      /** M131a/D343 — the env's named services, since `TF060` now gates every scannable origin and
       *  not just the default `api` base. Required for the same reason it is required on
       *  `EnvAuthorizedTargets` itself: a gate that widens is a gate somebody can accidentally
       *  un-widen by leaving a field off. */
      readonly services: readonly { readonly name: string; readonly url: string }[];
    };
    /** M131a/D340 — `--allow-public-target` values this invocation carried, for `TF065`/`TF066`.
     *  The only `needs` field that is not a fact about the *project*: it is a fact about the
     *  command line, which is the whole of D21 §3.2(3) — the affirmation this gate wants is
     *  precisely the one no file in the project is allowed to make. */
    readonly allowPublicTargets?: readonly string[];
    /** M156a/D775 — the config's `require env` names, for `TF077`. Absence is meaningful the way
     *  `envBaseUrls`' is: `checkDeclaredEnvRefs` skips entirely without it, so a probe that forgets
     *  it asserts on silence. `[]` is the *most* meaningful value here rather than an empty one —
     *  a suite reading secrets with no `require env` line at all is the shape the rule exists for,
     *  and it is what this row's own probe uses. */
    readonly requiredEnv?: readonly string[];
  };
}

/** Wrap `text` in inline code the way SPEC's tables already do — doubled backticks with padding
 *  when the text contains one of its own, which is the convention every hand-written cell used. */
function fence(text: string): string {
  return text.includes('`') ? `\`\` ${text} \`\`` : `\`${text}\``;
}

/** Render a row's probes into the markdown cell SPEC §17, the docs-site reference and LSP hover all
 *  print. The single reason `example` is derived rather than authored — see `DiagnosticProbe`. */
export function renderDiagnosticExample(probes: readonly DiagnosticProbe[]): string {
  return probes
    .map((p) => {
      // A `.tflw` file is the reader's default assumption, so only `config` needs saying — and only
      // when the probe has no `as`, since an `as` is the author's own framing and several already
      // name the file ("two `session admin` blocks in one `tflw.config`").
      const head = p.as ?? `${p.source.map((line) => fence(line.trim())).join(' then ')}${p.wrap === 'config' ? ' in `tflw.config`' : ''}`;
      return p.says === undefined ? head : `${head} → ${fence(p.says)}`;
    })
    .join('; ');
}

/** One row of SPEC §17's diagnostic codes table (decision 20.3, docs-site polish cluster 9) — the
 * single source of truth for what a `TF0xx` code *means* going forward. `packages/lang/src/
 * diagnostic.ts`'s `Codes` object stays the source of the code constants themselves (and every
 * per-occurrence `message`/`hint` stays call-site-specific, generated at each checker/parser call
 * site — this manifest is only the canonical, code-general explanation, not a replacement for
 * either). `meaning` is markdown-ready cell text; `example` is markdown-ready cell text *derived
 * from `probes`* and never hand-written. */
/** How a **runtime-only** code is evidenced (`M159c`, `D801`). `DiagnosticProbe` compiles source
 * and reads the message back, which decides every code up to `TF076` and cannot decide `TF080` at
 * all: its condition is which dialog kind a live page raised, not what the test says.
 *
 * So the row points at the test that *does* provoke it. This is weaker than a probe on purpose, and
 * the weakness is named rather than hidden: a probe is executed by the manifest's own harness, and
 * this is a reference the harness can only check the *existence* of. What stops it becoming
 * `D722`'s "a gate whose presence is not evidence" is that `diagnosticExamples.test.ts` resolves
 * the reference — a row naming a test file or test name that does not exist is a red suite, so the
 * pointer cannot rot into decoration the way an unexecuted prose example did before `M110b`.
 *
 * It deliberately cannot be used to escape a probe. The gate requires exactly one of `probes` or
 * `runtime`, and a code the checker *can* emit has a probe available to it — so reaching for this
 * field is a claim that no source text provokes the code, which is reviewable. */
export interface RuntimeEvidence {
  /** The test file, relative to the package that owns it, e.g. `packages/runtime/test/browser-steps.test.ts`. */
  readonly test: string;
  /** The exact `test('…')` name inside it, asserted to exist. */
  readonly name: string;
  /** Display prose for the rendered example cell, in place of a probe's source block. */
  readonly as: string;
}

export interface DiagnosticEntry {
  readonly code: string;
  readonly meaning: string;
  readonly example: string;
  /** Exactly one of these two is present. `probes` for a code `tflw check` can be made to emit;
   * `runtime` for one only a run can reach (`D801`). Neither is not allowed — that is the state
   * `M110b` closed, a row whose example nothing executes. */
  readonly probes?: readonly DiagnosticProbe[];
  readonly runtime?: RuntimeEvidence;
}

const DIAGNOSTIC_ROWS: readonly Omit<DiagnosticEntry, 'example'>[] = [
  { code: 'TF001', meaning: 'Lexer: a character that cannot begin any token. Also reported for number notations tflw does not have — `1e3`, `0xff`, `0b1010`, `0o17` and `1_000`. Each would otherwise read as a number followed by a name (`1e3` as `1` then `e3`), so the message names the decimal value to write instead. Durations are unaffected: `30s` and `500ms` are a number followed by a unit, as intended. `.5` is not covered, because a dot followed by a number is legal in a path.', probes: [{ wrap: 'step', source: ['let y = $oops'], says: 'unexpected character "$"' }, { wrap: 'step', source: ['let n = 1e3'], says: 'exponent notation is not supported — this reads as `1` followed by the name `e3`' }] },
  { code: 'TF002', meaning: 'Lexer: a string literal has no closing quote before end of line.', probes: [{ wrap: 'file', source: ['test "open string'] }] },
  { code: 'TF003', meaning: 'Lexer: indentation does not line up with any enclosing block. A line indented with tabs is `TF048`.', probes: [{ wrap: 'file', source: ['test "misaligned"', '    log "a"', '  log "b"'], says: 'indentation does not match any enclosing block', as: 'a line dedented to a column that matches no enclosing block — `4` spaces, then `2`, inside a body opened at `4`' }] },
  { code: 'TF010', meaning: 'Parser: a token appeared where the grammar does not allow one — the catch-all "unexpected token" code, covering many shapes: a missing path after `api GET`, a multi-word call missing its parens, a table row with the wrong number of cells. When something is left over at the end of a line, the message names what just ended: a **step** in a test body, a **directive** in `tflw.config`, a **declaration** at a file\'s top level.', probes: [{ wrap: 'step', source: ['api GET'], says: 'expected a path like `/orders`, found end of line' }] },
  { code: 'TF011', meaning: 'Parser: an unrecognised keyword where a step was expected, with a did-you-mean for a near miss (`expct` → `expect`). A *retired* keyword is named with its replacement — `uncheck` is now `untick` — and is never offered back as a suggestion. A line of two or more words that reaches no `(` is read as a call missing its parens, and told so.', probes: [{ wrap: 'step', source: ['expct status equals 200'], says: 'did you mean `expect`?' }, { wrap: 'step', source: ['uncheck field "Terms"'], says: '`uncheck` was renamed to `untick`' }] },
  { code: 'TF012', meaning: 'Parser: an unknown HTTP method after `api`.', probes: [{ wrap: 'step', source: ['api FETCH /health'], says: 'did you mean `PATCH`?' }] },
  { code: 'TF013', meaning: 'Parser: an unrecognised `expect`/`capture` subject.', probes: [{ wrap: 'step', source: ['expect statuss equals 200'], says: 'did you mean `status`?' }] },
  // A3-OS-06: the old example was a mashup of the two mutually-exclusive hint branches ("did you
  // mean" *and* an option list) and showed output the tool does not produce — `eq` is two characters
  // from nothing, so it gets the fallback line, not a suggestion. This one is copied from a real
  // run, and names the branch it is showing.
  { code: 'TF014', meaning: 'Parser: an unrecognised matcher after a subject, or none at all. A bare `check <locator>` gets its own message naming both readings: `check` is the soft assertion and needs a matcher, and ticking a checkbox is `tick`.', probes: [{ wrap: 'step', source: ['expect text "x" is vissible'], says: 'did you mean `visible`?' }, { wrap: 'step', source: ['check field "Terms"'], says: '`check <locator>` needs a matcher' }] },
  { code: 'TF015', meaning: 'Parser: a block that needs an indented body does not have one — `test`, `action`, the hooks, `session`, `session … oauth2`, `crawl`, `within`, `download`, `switch to new tab`, `fill form`, a `with each` table, and a `defaults`/`env` block in `tflw.config`. Reported on the block\'s own header line.', probes: [{ wrap: 'file', source: ['before file'], says: 'this `before file` has no steps', as: 'a `before file` block with no steps under it' }] },
  { code: 'TF016', meaning: 'Parser: top-level content that isn\'t a `test`/`crawl`/`action`/`element`/`import`/`use`/`before`/`after`.', probes: [{ wrap: 'file', source: ['expect status equals 200'], says: 'expected a `test`, `crawl`, `action`, `element`, `import`, `use`, `before`, or `after`, found `expect`' }] },
  { code: 'TF020', meaning: 'Parser (config): an unrecognised key inside a config block.', probes: [{ wrap: 'config', source: ['defaults', '  headr "Accept" is "application/json"'], says: 'did you mean `header`?' }] },
  { code: 'TF021', meaning: 'Parser (config): a `test` appears in the declaration-only config dialect.', probes: [{ wrap: 'config', source: ['test "not allowed here"'], says: '`test` is not allowed in tflw.config' }] },
  { code: 'TF022', meaning: `Parser (config): top-level config content that isn't one of ${listConfigDirectives()}. Also reported for a \`session … oauth2\` block missing a required line (\`token url\`, \`client id\`, \`client secret\`); the message names only the lines that are missing.`, probes: [{ wrap: 'config', source: ['workers 3'], says: `expected ${listConfigDirectives()}, found \`workers\`` }] },
  { code: 'TF023', meaning: 'Parser: a duration whose unit is missing, misspelled, mis-cased, or spaced off its number. Three cases, because their fixes differ: an abbreviation written with a space (`250 ms` → `250ms`), a unit tflw spells differently (`sec` → `s`, `MS` → `ms`), and a word that is no unit at all. Every duration takes `ms`, `s` and `m`, and the words `seconds`, `minutes`, `hours`, `days` and `weeks`; a word may stand apart from its number, an abbreviation may not.', probes: [{ wrap: 'config', source: ['defaults', '  timeout step 5x'], says: 'unknown time unit `x`' }, { wrap: 'step', source: ['api GET /a', 'expect duration is less than 2sec'], says: 'tflw\'s abbreviated time units are `ms`, `s` and `m` — write `2s`' }] },
  { code: 'TF024', meaning: 'Checker (config): more than one `env` marked `default`, or a duplicate env name.', probes: [{ wrap: 'config', source: ['env staging default', '  api "https://a"', 'env prod default', '  api "https://b"'], says: 'more than one env is marked `default`', as: 'two `env … default` blocks in one `tflw.config`' }] },
  { code: 'TF025', meaning: 'Checker (config): a key used in the wrong block.', probes: [{ wrap: 'config', source: ['defaults', '  web "https://example.com"'], says: '`web` is not allowed in defaults' }] },
  { code: 'TF026', meaning: 'Checker: an `api <service>`/`wait until api <service>` name not declared in the active env — checked in test, action and hook bodies **and** inside `session` blocks.', probes: [{ wrap: 'step', source: ['api billng POST /auth/login'], says: 'did you mean `billing`?', needs: {'services':['billing']} }] },
  { code: 'TF027', meaning: 'Checker: a `{col}` reference **in a test\'s name** that is not among its inline `with each` table\'s columns. Only the name is checked here: a bad `{col}` in the test *body* is an unbound variable, `TF030`. **File-backed** tables (`with each from "…"`) are skipped — their columns are not known until the file is read at run time (`TF043` covers the file itself going missing).', probes: [{ wrap: 'file', source: ['with each', '  | price |', '  | 10    |', 'test "checkout {prcie}"', '  api GET /health'], says: 'unknown table column "prcie" referenced in the test name', as: '`test "checkout {prcie}"` over a `with each` table whose only column is `price`' }] },
  { code: 'TF028', meaning: 'Checker: a `test … as <session>[, <session>...]` name not declared by any `session` block — one diagnostic per unknown name.', probes: [{ wrap: 'file', source: ['test "x" as ghost', '  api GET /a'], says: 'unknown session "ghost"', needs: {'sessions':[]} }] },
  { code: 'TF029', meaning: 'Checker (config): a session name that is not the session\'s alone — a duplicate, or the reserved name `anonymous`. `anonymous` is the built-in principal every `has no authorization violations` assertion probes with, so a session by that name would shadow it or be shadowed by it. The repair is the same either way: rename the session.', probes: [{ wrap: 'config', source: ['session admin', '  api POST /login', 'session admin', '  api POST /login'], says: 'duplicate session `admin`', as: 'two `session admin` blocks in one `tflw.config`' }, { wrap: 'config', source: ['session anonymous', '  api POST /login'], says: 'is a reserved principal name' }] },
  { code: 'TF030', meaning: 'Checker: a `{var}`/bare-identifier reference that is never bound anywhere reachable in its scope. Conservative: it only flags a name that is *definitely* unbound, never one that merely might be.', probes: [{ wrap: 'step', source: ['api POST /orders', 'capture body.ok as orderId', 'api GET /orders/{orderid}'], says: 'unknown variable "orderid"' }] },
  { code: 'TF031', meaning: 'Checker: a `request` assertion (`connects`/`fails`) combined with a response assertion (`status`/`header`/`body`/`duration`) on the same request, or used at all inside `wait until api`. A request judged on whether it connects has no response to judge as well.', probes: [{ wrap: 'step', source: ['api GET /a', 'expect request connects', 'expect status equals 200'], says: 'can\'t be combined with `request connects`/`fails` on the same request' }] },
  { code: 'TF032', meaning: 'Checker: an `upload … type "…"` literal not shaped like `type/subtype`. A light check rather than a list of real media types — it catches an obvious typo before the run.', probes: [{ wrap: 'step', source: ['api POST /u upload "./f.png" as "avatar" type "imagepng"'], says: 'invalid content type "imagepng", expected a "type/subtype" shape like "image/png"' }] },
  { code: 'TF033', meaning: 'Parser/checker (load): a workload-bearing `test` is not a valid shape. The cases: its workload or threshold lines are malformed; two such tests in one file share a name (each name keys its own metrics); `retry` or `with each` sits beside a workload; a browser step sits inside one (load tests are API-only); `pause` sits outside one; it has no `threshold` at all, so it could never fail; it thresholds `duration` without an unscoped `error rate` threshold beside it (a duration threshold reads only the requests that succeeded, so alone it passes a target that fails half its requests fast); or it carries an `authorization violations` assertion, which would multiply that scan\'s probes by the load. Also reported for the removed keywords `scenario` (write `test "…"` with a workload) and `think` (now `pause`). The `pause` and browser-step rules follow calls into `action`s and report at the call site. To wait for a *condition*, use `wait until …`; elapsed time with no condition to poll, such as a cache expiry, belongs in a JS helper.', probes: [{ wrap: 'step', source: ['pause 2s'], says: '`pause` is only legal inside a workload-bearing `test`' }, { wrap: 'step', source: ['think 2s'], says: '`think` was renamed to `pause`' }] },
  { code: 'TF034', meaning: 'Checker (load): a `threshold … for "label"` names no `api` step in the same workload-bearing test — neither an `as "label"` tag nor an untagged step\'s automatic `METHOD path` name.', probes: [{ wrap: 'file', source: ['test "t"', '  hold 5 users for 10s', '  api GET /a as "checkout"', '  threshold p95 duration for "checkotu" is less than 250ms'], says: 'threshold `for "checkotu"` matches no step in this test', as: '`threshold p95 duration for "checkotu" is less than 250ms` with only an `as "checkout"`-tagged step in scope' }] },
  { code: 'TF035', meaning: 'Checker: a name is declared as an `action` more than once in the namespace a file runs in — twice in one file, once here and once through an `import`, or by two `import`s. Imported duplicates are reported only when the imports were read. `element` names follow the same rule.', probes: [{ wrap: 'file', source: ['element cartBadge = css ".badge"', 'element cartBadge = css ".count"'], says: 'duplicate element "cartBadge"', as: '`element cartBadge` declared twice' }, { wrap: 'file', source: ['action fetch it()', '  api GET /a', 'action fetch it()', '  api GET /b'], says: 'duplicate action "fetch it"', as: '`action fetch it()` declared twice' }, { wrap: 'file', source: ['import "./shared/orders.tflw"', 'action fetch it()', '  api GET /a'], says: 'duplicate action "fetch it" (imported from "./shared/orders.tflw")', as: 'the same name arriving via `import "./shared/orders.tflw"`', needs: {'importedActions':[{'name':'fetch it','arity':0,'from':'./shared/orders.tflw'}]} }] },
  { code: 'TF036', meaning: 'Checker: the **active** env\'s own `api`, `api <service>` or `web` base URL has a host that its own `allow hosts` list (from `defaults` plus the env) does not match, so every step against it would be refused at run time. Only the active env is checked — a suite may keep a deliberately blocked env as a negative case. The hint says what that key reaches: the default `api` base takes the whole suite down, a named service only its own calls, `web` the browser steps. A base URL containing `{…}` is skipped.', probes: [{ wrap: 'config', source: ['env local', '  api "http://127.0.0.1:9099"', '  allow hosts "example.com"'], says: 'env `local`\'s `api` base URL is "http://127.0.0.1:9099", whose host "127.0.0.1" is not in its own `allow hosts` (example.com)', as: '`api "http://127.0.0.1:9099"` alongside `allow hosts "example.com"`' }] },
  { code: 'TF037', meaning: 'Checker: a call names neither an `action` nor a JS helper, so the run would stop at that step with `unknown call`. Reported only where that is certain: every `import` was read, the file has no `use` (a JS module\'s exports are not known without running it), and the call is in a `test` or hook body. An `action` body is skipped, because calls bind against the *entry* file, so a shared action may call a name only its importer defines.', probes: [{ wrap: 'file', source: ['action create order(name)', '  api GET /a', 'test "t"', '  creat order("Widget")'], says: 'did you mean `create order`?', as: '`creat order("Widget")` beside `action create order(name)`' }] },
  { code: 'TF038', meaning: 'Checker: a call resolves to a known `action` but passes the wrong number of arguments. Reported whether or not the file has a `use`: an action name is unique, and actions are resolved before helpers.', probes: [{ wrap: 'file', source: ['action create order(name)', '  api GET /a', 'test "t"', '  create order("Widget", "extra")'], says: 'action "create order" expects 1 argument, got 2', as: '`create order("Widget", "extra")` against `action create order(name)`' }] },
  { code: 'TF039', meaning: 'Checker: an `expect`/`check` on a response subject (`status`, `duration`, `header`, `body …`, `request`), or any `capture`, comes before the first `api`/`wait until api` step **in its own response scope**. A `test`, `action` or hook body is one scope, and so is each nested `within`, `switch to new tab` or `download` body. An `action` gets its own, so calling one never hands its response to the caller, and a `before` hook\'s response is not visible to the test. UI subjects (a locator, `page`), `request to "…"` observations and `{variable}` subjects need no response and are not checked.', probes: [{ wrap: 'step', source: ['expect status equals 200'], says: 'no response yet — an `api` step must run before this assertion/capture', as: '`expect status equals 200` as a test\'s first step' }] },
  { code: 'TF040', meaning: 'Checker: a call is written somewhere its value is never computed. A call runs in two places only — as a step of its own, and as the whole right-hand side of a `let`. Anywhere else it would yield nothing: `body { id: create thing() }` would send `{}`, and `[create thing()]` would send `[null]`. Bind it first — `let result = create thing()` — then use `{result}`. `TF037` and `TF038` are not reported for such a call; its position is the thing to fix first.', probes: [{ wrap: 'step', source: ['api POST /orders body { id: create thing() }'], says: 'bind it first — `let result = create thing(…)` — then use `{result}` here' }] },
  { code: 'TF041', meaning: 'Checker: a `{variable}` subject stands where a value cannot. Two cases. **A live-handle matcher** — `is visible`/`hidden`/`enabled`/`disabled`/`checked`, `has value`, `matches snapshot`, `has no … a11y violations`, `connects`/`fails`, `was made` — needs a browser element, a page, a connection or an observed request, and a bound value has none. Type mismatches (`contains` on a number) are left to the run, as they are for `body.<path>`. **Inside `wait until api`**, a value cannot change between polls, so the wait could only pass at once or time out. Distinct from `TF014`: `is visible` is a known matcher, just misplaced.', probes: [{ wrap: 'step', source: ['api GET /a', 'capture body.id as orderId', 'expect {orderId} is visible'], says: '`is visible` needs a live browser element, page, or request — not a value', as: '`expect {orderId} is visible`' }] },
  { code: 'TF042', meaning: 'Checker: a matcher used where its subject cannot be read, or an `any`/`all` quantifier on a matcher that cannot apply element by element. The rule is over the subject\'s **kind** — a value, a UI locator, `page`, `request`, `request to "…"` — and follows the matcher table. Shape is not checked: whether `body.msg` is a string or a list is not known until the response arrives. The quantifier half covers the two matchers that read an outside document, `matches schema` and `matches file`. Also checked in `wait until <subject> <matcher>`. Distinct from `TF041`, the same rule for a `{variable}` subject.', probes: [{ wrap: 'step', source: ['api GET /a', 'expect status is visible'], says: '`is visible/hidden/enabled/disabled/checked` can\'t be used on a value' }, { wrap: 'step', source: ['api GET /a', 'expect any body.items matches schema "W" from "/o.json"'], says: '`any` can\'t be combined with `matches schema "Name" from "src"`' }] },
  { code: 'TF043', meaning: 'Checker: a path names a file that is not there — in `import`, `use`, `with each from`, `body from`, `upload`, `matches file` or `drop file`, resolved against the directory of the file that names it. Only literal paths are checked; `upload "./fixtures/{name}.png"` is skipped. **`import` and `use` are an error**, because `tflw check` opens them itself. **The other five are a warning**: an earlier step, a hook or a helper may create the file before the step that reads it runs. `cert`/`key` in `tflw.config` are not checked, nor are a CSV file\'s columns.', probes: [{ wrap: 'file', source: ['import "./nowhere.tflw"', 'test "t"', '  api GET /a'], says: '`import` names a file that does not exist: "./nowhere.tflw"', needs: {'missingFiles':['./nowhere.tflw']} }] },
  { code: 'TF044', meaning: 'Checker: an `action` that can reach itself, directly (`a → a`) or through others (`a → b → a`). tflw has no conditionals, so such a cycle always runs forever and the run can only fail. Checked across `import`s too, the way a run resolves names; a cycle lying entirely inside imported files is left to those files\' own check. Only calls that run count — `let x = f() + "y"` never calls `f`. One diagnostic per cycle.', probes: [{ wrap: 'file', source: ['action a()', '  b()', 'action b()', '  a()'], says: 'this call completes a cycle: `a → b → a`', as: '`action a()` calling `b()`, `action b()` calling `a()`' }] },
  { code: 'TF045', meaning: 'Lexer: brackets do not balance — a `{`/`[` that is never closed, or a `}`/`]` that closes nothing. An unclosed bracket is reported at the bracket, and only the innermost one: while a bracket is open every following line joins the same logical line, so the outer ones are consequences of the same typo.', probes: [{ wrap: 'step', source: ['api POST /o body {'], says: 'this `{` is never closed' }, { wrap: 'step', source: ['api POST /o body { a: 1 } }'], says: '`}` closes a bracket that was never opened', as: 'a stray `}`' }] },
  { code: 'TF046', meaning: 'Lexer: a tag with no usable name — a bare `@`, `@ smoke` with a space, or `@123` starting with a digit. A tag like that could never be written in a `--tag` expression, so the test could be neither selected nor excluded.', probes: [{ wrap: 'file', source: ['@ smoke', 'test "t"', '  api GET /a'], says: 'a tag needs a name after the `@`' }] },
  { code: 'TF047', meaning: 'Lexer: a string escape outside the supported set — `\\"`, `\\\\`, `\\n`, `\\r`, `\\t` and `\\u{XXXX}`. `"^\\d+$"` is an error rather than a kept backslash, so that adding an escape later can never change what an existing string means. In a regular expression, write the backslash twice: `"^\\\\d+$"`. Unicode escapes take braces only: `\\u0041`, `\\u{}`, an unclosed brace, a value above `\\u{10FFFF}` and a surrogate half are all this code.', probes: [{ wrap: 'step', source: ['api GET /a', 'expect body.id matches "^\\d+$"'], says: 'unknown escape `\\d` in a string' }] },
  { code: 'TF048', meaning: 'Lexer: a line is indented with tabs; use spaces. Reported once per file, at the first such line, with the number of other lines in the help — one editor setting fixes them all.', probes: [{ wrap: 'file', source: ['test "t"', '\tapi GET /a'], says: 'tabs are not allowed in indentation; use spaces', as: 'a file indented with tabs' }] },
  { code: 'TF049', meaning: 'Lexer: a hidden character that makes the source display differently from how it runs — a bidi control (`U+202A`–`U+202E`, `U+2066`–`U+2069`), a zero-width character (`U+200B`–`U+200D`), or a `U+FEFF` anywhere but the very start of the file (the "Trojan Source" attack, CVE-2021-42574). A bidi override in a comment can display as an assertion that is not the one being run, and a zero-width space in a string looks the same as the string without it. **An error**, because a reviewer reading a `.tflw` file has only the rendered text to go on. Reported in comments, strings, indentation and between tokens; anywhere else the character is already `TF001`. Inside a string, write the character as `\\u{…}` if it is really meant.', probes: [{ wrap: 'file', source: ['# a comment with \u202E in it', 'test "t"', '  api GET /a'], says: 'hidden character U+202E RIGHT-TO-LEFT OVERRIDE in a comment', as: 'a comment containing `U+202E`' }] },
  { code: 'TF050', meaning: 'Lexer: a word **inside a string** that mixes Latin letters with a script that has Latin lookalikes (Cyrillic, Greek, Cherokee, Armenian). `"аdmin"` with a Cyrillic `а` looks exactly like `"admin"` and compares unequal to it — so in `not equals` or `not contains`, the shape a leak check takes, the test passes without asserting anything. The unit is one word, not one string: `"Willkommen — добро пожаловать"` mixes no single word and is fine, and `"東京Tower"` is fine because Han has no Latin lookalikes. Not covered: a word written entirely in one non-Latin script. If a mixed word is really meant, write the letter as `\\u{…}`.', probes: [{ wrap: 'step', source: ['api GET /a', 'expect body.status not equals "оk"'], says: 'the word `оk` mixes Latin with Cyrillic — U+043E', as: '`expect body.status not equals "оk"`' }] },
  { code: 'TF051', meaning: 'Checker: a step needs a base URL the **active env** does not declare — `open` needs `web`, and an `api` request with no service name needs the default `api`. A request through a named service (`api orders GET /health`) needs only that service. A relative `matches schema … from "…"` path needs `api` too; an `http(s)://` one needs nothing. **An error**: unlike a missing file, a base URL cannot appear once the run has started.', probes: [{ wrap: 'step', source: ['api GET /health'], says: 'needs an `api` base URL', needs: { envBaseUrls: { envName: 'local', api: false, web: true } } }, { wrap: 'step', source: ['open "/login"'], says: 'needs a `web` base URL', needs: { envBaseUrls: { envName: 'local', api: true, web: false } } }] },
  { code: 'TF052', meaning: 'Checker: `mask <locator>` written after a matcher other than `matches snapshot "…"`. A mask blanks part of a snapshot before comparing it, so with any other matcher it does nothing. One diagnostic per mask.', probes: [{ wrap: 'step', source: ['api GET /a', 'expect status equals 200 mask field "Email"'], says: 'only applies alongside `matches snapshot' }] },
  { code: 'TF053', meaning: 'Checker: `capture` from a subject that can be asserted on but not stored — `page`, `request`, a UI locator, or an observed `request to "…"`. `capture status as n` is fine; `capture status of request to "/x" as n` is not, because an observed request is read from the browser\'s network log, not from the last `api` response. The hint names what the subject does support.', probes: [{ wrap: 'step', source: ['api GET /a', 'capture request as r'], says: 'does not support `request`' }, { wrap: 'step', source: ['api GET /a', 'capture status of request to "/a" as s'], says: 'does not support a `request to' }] },
  { code: 'TF054', meaning: 'Checker: an operand **written in the file** that the step will reject when it runs — `random number 5 to 1` (an empty range), `random password 2` (too short for the four character classes it guarantees), `hex`/`base64`/`url` `decode("…")` of a literal that does not decode, or a `matches`/`fails matching` pattern that is not a valid regular expression. Literals only: `random number {lo} to {hi}` is not known until the run.', probes: [{ wrap: 'step', source: ['let bad = random number 5 to 1'], says: '`to` must be ≥ `from`' }, { wrap: 'step', source: ['let x = hex decode("not-hex!")'], says: 'is not valid hex' }, { wrap: 'step', source: ['api GET /a', 'expect body.name matches "("'], says: 'invalid regex in matcher' }] },
  { code: 'TF055', meaning: 'Checker: `wait until <locator> … for <duration>` whose hold window is at least as long as the wait\'s timeout. The condition is asked to stay true for longer than the step may run, so the step can only time out. **A warning**: the timeout comes from `tflw.config` and may differ per env. A step with its own `timeout wait <duration>` is compared against that; otherwise the active env\'s `timeout wait` is used, and with no env resolved the step is skipped.', probes: [{ wrap: 'step', source: ['open "/x"', 'wait until button "Hidden" is hidden for 60s'], says: 'can never be satisfied', needs: { envTimeouts: { envName: 'local', wait: 30_000 } } }] },
  { code: 'TF056', meaning: 'Checker: `with each from "…"` naming a file that is neither `.csv` nor `.json`. Rows are read from CSV (with a header row) or JSON (an array of row objects), chosen by extension. **An error**, unlike `TF043`\'s warning: an extension cannot change between check and run. Interpolated paths are skipped.', probes: [{ wrap: 'file', source: ['with each from "./rows.txt"', 'test "t"', '  api GET /health'], says: 'must be `.csv` or `.json`' }] },
  { code: 'TF057', meaning: 'Checker: an `api`, `wait until api` or `open` step whose target is an absolute URL rather than a path under the env\'s base. That is allowed, and this warning says what it costs: the step goes to the same place whatever `--env` selects. Reported when the env has an `allow hosts` list, or when no config was resolved; when the resolved env has no `allow hosts`, `TF058` is reported instead.', probes: [{ wrap: 'step', source: ['api GET https://api.example.com/orders'], says: '`--env` will not move it', needs: { envAllowHosts: { envName: 'local', hosts: ['api.example.com'] } } }, { wrap: 'step', source: ['open "https://example.com/checkout"'], says: 'absolute URL', needs: { envAllowHosts: { envName: 'local', hosts: ['example.com'] } } }] },
  { code: 'TF058', meaning: 'Checker: an absolute URL in a suite whose env declares no `allow hosts` — the run will refuse to send it. Normally no `allow hosts` means every host is allowed, because every request goes to the env\'s own base URLs. An absolute URL can reach a host `tflw.config` never mentions, so using one means declaring where the suite may go: add the host to `allow hosts`. **A warning** here, because another env may declare the list; the run itself refuses.', probes: [{ wrap: 'step', source: ['api GET https://api.example.com/orders'], says: 'the run will refuse to send it', needs: { envAllowHosts: { envName: 'local', hosts: [] } } }] },
  { code: 'TF059', meaning: 'Checker: a named service and an absolute URL on the same step — `api billing GET https://other.example/x`. Each one names where to send the request, so one of them would be ignored. **An error**: no config can make the pair mean one thing. Drop the service, or write a path.', probes: [{ wrap: 'step', source: ['api billing GET https://other.example/x'], says: 'names a service and an absolute URL', needs: { services: ['billing'] } }] },
  { code: 'TF060', meaning: 'Checker: `expect`/`check response has no … security violations` against an env whose `api` base URL — or any declared service\'s URL — no `authorized target` declaration names. Matching is by **origin** (scheme, host and port): `https://x.example.com` does not cover `https://x.example.com:8443`, which is a different listener. Loopback is not exempt. Only literal URLs the env declares are checked; `api "https://{API_HOST}/v1"` is skipped, as is a step\'s own absolute URL.', probes: [{ wrap: 'step', source: ['api GET /orders', 'expect response has no security violations'], says: 'needs an `authorized target` declaration', needs: { envAuthorizedTargets: { envName: 'local', targets: [], apiBaseUrl: 'https://localhost:8443/v1', services: [] } } }, { wrap: 'step', source: ['api GET /orders', 'expect response has no security violations'], says: 'service `@billing`', needs: { envAuthorizedTargets: { envName: 'local', targets: [{ target: 'https://localhost:8443', reason: 'self-hosted test fixture' }], apiBaseUrl: 'https://localhost:8443/v1', services: [{ name: 'billing', url: 'https://billing.internal:8443' }] } } }] },
  { code: 'TF061', meaning: 'Checker: an `authorized target` that contains a wildcard, or is not an absolute URL. Unlike `allow hosts`, which bounds where a suite may send, this declaration affirms that you may point a scanner at one named host — and nobody is authorized to scan `*.com`. A bare hostname (`"staging.example.com"`) has no origin, so it would authorize nothing.', probes: [{ wrap: 'config', source: ['defaults', '  authorized target "https://*.example.com" reason "staging"'], says: 'cannot contain a wildcard' }, { wrap: 'config', source: ['defaults', '  authorized target "staging.example.com" reason "staging"'], says: 'must be an absolute URL with a scheme' }] },
  { code: 'TF062', meaning: 'Checker: the `api` step an `authorization violations` assertion judges sets its own `Authorization` or `Cookie` header. The scan replaces the identity headers with each principal\'s own, so a credential written on the step belongs to no principal it can name, and its findings would be wrong either way. Checked again at run time against what the sessions actually sent. Not detectable: a credential in a query string, a body, or an app-specific header — the run\'s summary names these blind spots.', probes: [{ wrap: 'file', source: ['test "t" as shopper', '  api GET /orders/1', '    header "Authorization" is "Bearer x"', '  expect response has no authorization violations'], says: 'names its own `Authorization` header' }] },
  { code: 'TF063', meaning: 'Checker: an `authorization violations` assertion with no principal behind it. Two cases, one repair — declare an identity. (1) The assertion is in a `test` with no `as <session>`, or in a `before file`/`after file` hook, which belongs to no test; a plain `before`/`after` hook runs with each test and is fine. (2) `tflw.config` marks *every* session `privileged`, leaving only the built-in `anonymous` to probe with, which tests authentication rather than authorization. The scan compares responses across principals, so with no owner, or no one to compare against, it has nothing to compare. Inside an `action` body the check waits for the run, which knows the calling test.', probes: [{ wrap: 'file', source: ['test "t"', '  api GET /orders/1', '  expect response has no authorization violations'], says: 'needs an owner' }, { wrap: 'file', source: ['before file', '  api GET /orders/1', '  expect response has no authorization violations'], says: 'needs an owner' }] },
  { code: 'TF064', meaning: 'Checker: an `authorization violations` or `input handling violations` assertion inside `wait until api`. That block re-sends its request until its expects pass, so a real finding would be re-probed on every poll and then reported as a wait timeout instead of a finding. Move the assertion to a plain `api` step after the block. Inside a workload-bearing test the same mistake is `TF033`.', probes: [{ wrap: 'file', source: ['test "t" as shopper', '  wait until api GET /orders/1', '    expect status equals 200', '    expect response has no authorization violations'], says: "can't be asserted inside `wait until api`" }, { wrap: 'file', source: ['test "t"', '  wait until api GET /orders/1', '    expect status equals 200', '    expect response has no input handling violations'], says: "can't be asserted inside `wait until api`" }] },
  { code: 'TF065', meaning: 'Checker and runtime: a scan that **sends its own traffic** (`authorization violations`) would reach an origin outside the private address ranges, and no `--allow-public-target <origin>` on the command line names it. No `tflw.config` key can give this permission, so a committed config cannot make CI scan the internet by itself. `security violations` needs no flag: it only reads responses the suite already asked for. The address class is judged from the URL as written, with no DNS lookup. Private means loopback, RFC 1918, IPv6 unique-local, link-local, CGNAT and `localhost`; **every other hostname counts as public**, including `api.internal.corp`. `0.0.0.0` and `::` are refused outright. The run checks again against the origin each probe is actually sent to.', probes: [{ wrap: 'file', source: ['test "t" as shopper', '  api GET /orders/1', '  expect response has no authorization violations'], says: 'needs `--allow-public-target https://staging.example.com`', needs: { sessions: ['shopper'], envAuthorizedTargets: { envName: 'staging', targets: [{ target: 'https://staging.example.com', reason: 'we own it' }], apiBaseUrl: 'https://staging.example.com/v1', services: [] } } }] },
  { code: 'TF066', meaning: 'Checker: an `--allow-public-target` that matches nothing this run would scan — not an absolute URL, naming an origin no env base URL or service reaches, or naming one no `authorized target` declares. The flag names an origin so that the permission and the target have to agree; a flag left over after the config changed would otherwise permit a host nobody chose. Repeatable, one origin each, no wildcards. Its reason lives in the `authorized target` it matches.', probes: [{ wrap: 'file', source: ['test "t" as shopper', '  api GET /orders/1', '  expect response has no authorization violations'], says: 'matches nothing this run would scan', needs: { sessions: ['shopper'], allowPublicTargets: ['https://typo.example.com'], envAuthorizedTargets: { envName: 'staging', targets: [{ target: 'https://staging.example.com', reason: 'we own it' }], apiBaseUrl: 'https://staging.example.com/v1', services: [] } } }] },
  { code: 'TF067', meaning: 'Checker and runtime: an `input handling violations` assertion on a step whose request has nothing to mutate — no id segment in the path, no query parameter, no JSON body. The scan would send nothing, so the assertion could not fail. The checker reports the case it can be sure of, such as `api GET /health`; a path with a `{var}`, `body from "…"` and raw `body "…"` text are left to the run, which reports the same code. Assert it on a step that takes an id, a query parameter or a JSON body.', probes: [{ wrap: 'file', source: ['test "t"', '  api GET /health', '  expect response has no input handling violations'], says: 'nothing to mutate' }] },
  { code: 'TF068', meaning: 'Checker and runtime: a `crawl` with nothing to crawl. With no `seed` it sends no request, so no assertion in it could fail. The checker reports a crawl with no `seed` line; the run reports the same code when the seeds turn up no routes — an OpenAPI document that answers 404, `seed traffic` when the run captured none, an `exclude` that covers every route — and when every request was turned away before it reached the application. For that last case the hint points at addressing: a document\'s paths resolve against its own `servers`, so an `api` base carrying the same prefix dials it twice. Reported on the `crawl` header.', probes: [{ wrap: 'file', source: ['crawl "the v1 surface"', '  expect response has no critical security violations'], says: 'has nothing to crawl' }] },
  { code: 'TF070', meaning: 'Checker: a step in a `crawl` body that is not one of the three `violations` assertions — `security`, `authorization` or `input handling`. A crawl is a source of requests, one per discovered route per principal, and each assertion in it judges all of their responses; an `api` step, or `expect status equals 200`, has no single response to mean. Put the step in a `test`. The code `TF069` is not used.', probes: [{ wrap: 'file', source: ['crawl "the v1 surface"', '  seed traffic', '  api GET /products', '  expect response has no critical security violations'], says: 'takes only `violations` assertions' }, { wrap: 'file', source: ['crawl "the v1 surface"', '  seed traffic', '  expect status equals 200'], says: 'a crawl has many' }] },
  { code: 'TF071', meaning: 'Parser/checker: **a setting whose value is outside what it can act on.** `workers 0`, `viewport 0 0`, `timeout step 0s` and `retry 2.5` would run something nobody wrote — no workers, a page with no area, an instant abort on every request, a fraction of a retry. Covers `workers`, `viewport`, `timeout <target>`, a test\'s `retry N` and an api step\'s `retry honoring "…" up to N`. Zero is allowed where it means something: `timeout expect 0s` and `timeout wait 0s` evaluate once without polling, and `retry 0` is the default written out. The budget timeouts — `step`, `api` and `browser` — refuse `0`. Also reported for an unknown `tflw://` address (only `tflw://demo` exists), with a nearest-spelling hint.', probes: [{ wrap: 'config', source: ['defaults', '  workers 0'], says: 'below the smallest value' }, { wrap: 'config', source: ['defaults', '  viewport 0 0'], says: 'viewport width 0' }, { wrap: 'file', source: ['test "t" retry 2.5', '  api GET /a', '  expect status equals 200'], says: 'is not a whole number' }] },
  { code: 'TF072', meaning: 'Parser: **the same column name twice in one `with each` header.** A row binds each name once, so the second column would silently replace the first. Reported at the second occurrence, which is the one to rename.', probes: [{ wrap: 'file', source: ['with each', '  | name | name |', '  | "a" | "b" |', 'test "t {name}"', '  api GET /a', '  expect status equals 200'], says: 'duplicate table column' }] },
  { code: 'TF073', meaning: 'Checker: **an `import` naming a file that exists but does not parse.** The run would crash on it. The hint gives the command that shows that file\'s own errors at their own lines; checking the imported file directly, or a whole directory, reports them too. A missing file is `TF043`.', probes: [{ wrap: 'file', source: ['import "./broken.tflw"', 'test "t"', '  api GET /a', '  expect status equals 200'], needs: { importsWithErrors: ['./broken.tflw'] }, says: 'does not parse' }] },
  { code: 'TF074', meaning: 'Checker (config): **a `session … for env <name>` naming an env this config does not declare.** The session would exist in no env, so every `test … as <name>` would fail with `TF028`, and the session would silently drop out of every authorization scan.', probes: [{ wrap: 'config', source: ['env staging default', '  api "https://a"', 'session admin for env stagng', '  api GET /login'], says: 'unknown env "stagng"', as: 'a `for env` clause naming an env this config does not declare' }] },
  { code: 'TF075', meaning: 'Parser: **input nested more deeply than the parser will go** — more than 256 nested unary minus signs. The message names the limit; at this depth the file was almost certainly generated.', probes: [{ wrap: 'step', source: ['let a = ' + '-'.repeat(300) + '1'], says: 'too many nested `-` signs', as: 'a `let` whose value carries 300 unary minuses' }] },
  { code: 'TF076', meaning: 'Checker (config): **a `header "X" is "Y" for <service>` naming a service no `env` declares.** The header would be attached to no request at all, while the config says it is sent. Checked against every service declared anywhere in the file, since a header in `defaults` may scope to a service only one env declares.', probes: [{ wrap: 'config', source: ['env one default', '  api shop "https://a"', '  header "X-Tenant" is "acme" for shp'], says: 'unknown service "shp"', as: 'a header scope clause naming a service this config does not declare' }] },
  { code: 'TF077', meaning: 'Checker: **an `env(NAME)` that no `require env` line declares.** `require env` checks its names before the first request, so a name it does not list would fail mid-suite instead. Checked in `tflw.config` and in every test file. **An error**, even though the suite runs while `NAME` happens to be set; whether it is set is reported by `tflw check` as a note that does not change the exit code.', probes: [{ wrap: 'step', source: ['api GET /health', 'expect body.status equals env(P_ROGUE)'], says: 'no `require env` line declares it', as: 'a secret read by a test that the config never declares', needs: { requiredEnv: [] } }] },
  { code: 'TF078', meaning: 'Checker: **`{env(NAME)}` inside a string**, which tflw does not interpolate — the request would send the text `{env(NAME)}` itself, and the server would answer something like a 401 with nothing naming the cause. Write `env(NAME)` as the value on its own, outside the quotes. **A warning**: what a string contains is the author\'s business, so the check only points it out.', probes: [{ wrap: 'config', source: ['defaults', '  header \"X-Token\" is \"{env(P_TOKEN)}\"'], says: 'is literal text, not a secret', as: 'a header written as a braced interpolation of a secret' }] },
  { code: 'TF079', meaning: 'Runtime (browser): **an `accept dialog` or `dismiss dialog` that no dialog ever answered.** The step waits for the *next* native dialog; if none fires before the test ends, the step did nothing. Reported at that step\'s own line. **A warning, and only when the test otherwise passed**: after a failure, the step that would have raised the dialog may simply never have run. `beforeunload` may honestly never appear in a headless run, since browsers raise it only after a real user gesture.', runtime: { test: 'packages/runtime/test/browser-steps.test.ts', name: 'an arming no dialog ever consumes raises TF079 at its own line', as: 'a `dismiss dialog` in a test where no dialog is ever raised' } },
  { code: 'TF080', meaning: 'Runtime (browser): **an `accept dialog with "<text>"` whose answer went to a dialog that takes none.** Only a `prompt` has a field to fill; an `alert` or `confirm` would silently drop the text. **A warning**, and one `tflw check` cannot give: which kind of dialog a page raises is only known when it runs. The dialog is still accepted.', runtime: { test: 'packages/runtime/test/browser-steps.test.ts', name: '`accept dialog with` on an alert raises TF080 and still accepts', as: '`accept dialog with "Blue"` before a click that raises an `alert`' } },
  { code: 'TF081', meaning: 'Checker (config): **a single-valued config key set twice in the same block.** The second would silently replace the first. `header`, `allow hosts`, `authorized target` and `redact` add up by design and are exempt. Keys with a target are told apart — `timeout step` from `timeout expect`, `api` from `api payments` — and a key set in `defaults` and again in an `env` is how overrides work. Reported at each extra occurrence, the line to delete.', probes: [{ wrap: 'config', source: ['defaults', '  timeout step 10s', '  timeout step 30s'], says: 'duplicate config key `timeout step`', as: 'a `defaults` block setting `timeout step` twice' }] },
  { code: 'TF082', meaning: 'Checker (config): **an `authorized target` whose `reason` is blank** (empty, or only spaces). The reason is printed in the run summary and the report as the record of why the scan is allowed, and a blank one would look like a considered answer. Any non-blank text passes, and an interpolated reason is accepted. A target that is also malformed reports `TF061` too.', probes: [{ wrap: 'config', source: ['defaults', '  authorized target "https://localhost:8443" reason ""'], says: 'has no reason', as: 'an `authorized target` whose reason is the empty string' }] },
  { code: 'TF083', meaning: 'Checker: **a `use` that resolves outside the directories `helpers` allows.** A `use` runs arbitrary code, so `tflw.config`\'s `helpers` names the directories it may come from, relative to the config; with none declared, they are `./helpers` and `./tests/helpers`. The path resolves from the checked file, as the run resolves it: `use "../../helpers/x.ts"` from `tests/api/a.tflw` lands in `helpers/` and passes. `tflw run --no-helpers` reports every `use` under this code. A missing file is `TF043`; here the repair is to move the module or widen `helpers`.', probes: [{ wrap: 'file', source: ['use "../lib/sign.ts"', 'test "signed"', '  api GET /health', '  expect status equals 200'], says: 'outside the directories', as: 'a `use` in `tests/a.tflw` naming `../lib/sign.ts`, in a project whose `tflw.config` declares no `helpers`', needs: { helpers: { dirs: ['./helpers', './tests/helpers'], file: 'tests/a.tflw' } } }] },
  { code: 'TF084', meaning: 'Checker: **a `skip` whose reason is blank.** The reason is the only record of why the test stopped running and when it comes back. Any non-blank text passes, and an interpolated reason is accepted. **An error**, as `TF082` is.', probes: [{ wrap: 'file', source: ['test "t" skip ""', '  api GET /health', '  expect status equals 200'], says: 'gives no reason', as: 'a test header carrying `skip ""`' }] },
  { code: 'TF085', meaning: 'Checker: **a `body graphql` on a `GET`.** This body kind is GraphQL-over-HTTP\'s POST shape — `{"query", "variables", "operationName"}` as JSON — and a `GET` carries its query in the URL instead, so on a `GET` the query is a body most servers ignore and the response answers nothing that was asked. **An error**: the request cannot do what it says. The repair is the method, `api POST …`.', probes: [{ wrap: 'file', source: ['test "t"', '  api GET /graphql body graphql "{ orders { id } }"', '  expect status equals 200'], says: 'this request is a `GET`', as: 'an `api GET` whose body is `body graphql`' }] },
  { code: 'TF086', meaning: 'Checker: **a `sign with <name>` or `session … signed with <name>` naming no signer.** A step\'s name is checked against the signers the active env has, the way `TF028` checks `as <session>`; a session\'s is checked in `tflw.config` against every declaration. A signer declared `for env` other envs only is the same code with a hint naming them. **An error**: the request would go out unsigned, and the server\'s 401 would not say why.', probes: [{ wrap: 'step', source: ['api POST /webhooks/stripe body { id: "evt_1" }', '  sign with strpe'], says: 'did you mean `stripe`?', needs: { signers: ['stripe'] } }] },
  { code: 'TF087', meaning: 'Checker (config): **a signer that cannot sign as written** — a `{placeholder}` the signer does not fill (`signs` fills `{body}`, `{method}`, `{path}`, `{query}`, `{timestamp}` and `{body sha256}`; a `header` fills `{signature}` and `{timestamp}`), `{signature}` inside the string being signed, no `header` line carrying `{signature}`, or two signers of one name. Each is a request signed over the wrong text or not signed at all.', probes: [{ wrap: 'config', source: ['signer stripe hmac sha256 hex secret env(STRIPE_WEBHOOK_SECRET)', '  signs "{timestmp}.{body}"', '  header "Stripe-Signature" is "t={timestamp},v1={signature}"'], says: 'did you mean `{timestamp}`?' }] },
  { code: 'TF088', meaning: 'Checker: **a `skip … on env` naming an env `tflw.config` does not declare.** The skip would hold nowhere, so the test runs in the very env it was written to stay out of, and the run would not say why. Checked against every `env` block, not only the active one — naming another env is the clause\'s purpose. One diagnostic per unknown name. **An error**, matching `TF028`.', probes: [{ wrap: 'file', source: ['test "refunds settle" skip "no sandbox in CI" on env cii', '  api GET /health', '  expect status equals 200'], says: 'did you mean `ci`?', needs: { envs: ['local', 'ci'] } }] },
  { code: 'TF089', meaning: 'Checker: **an `element` reference naming no element.** A bare name in a locator position — `click cartBadge`, `expect cartBadge is visible` — is looked up in the file\'s own `element` declarations and then each imported file\'s, the `action` rule; like an unknown call it is decided only when the imports were read. In a subject position a bare name may also be a value meant as `{name}`, and the hint says so. **An error**: the step would have nothing to find.', probes: [{ wrap: 'file', source: ['element cartBadge = css "[data-test=cart-count]"', '', 'test "t"', '  open "/"', '  click cartBadg'], says: 'did you mean `cartBadge`?', as: 'a file declaring `cartBadge` and clicking `cartBadg`' }] },
  { code: 'TF090', meaning: 'Checker: **`with each concurrently` on an inline table of one row.** One row has nothing to run beside, so the clause promises an overlap the run cannot produce, and a test written to prove a race would pass without one ever happening. File-backed tables are not judged — their rows are read at run time. **A warning**: the test still means something; only the clause does not.', probes: [{ wrap: 'file', source: ['with each concurrently', '  | sku   |', '  | "A-1" |', 'test "reserve {sku}"', '  api POST /reserve body { sku: {sku} }', '  expect status equals 201'], says: 'has one row, so nothing runs beside it', as: 'a one-row table marked `concurrently`' }] },
  { code: 'TF091', meaning: 'Checker: **a test rebinds a name `before file` made.** What `before file` binds is shared, read-only, by every test, each-scope hook, row and `after file` in the file — the coupon a race is run over, the product whose stock it drains. A `let`, a `capture` or an inline table column of the same name would make one name mean two values depending on where it is read, and under `with each concurrently` on which row read it. **An error**: the file runs either reading, and the author meant one.', probes: [{ wrap: 'file', source: ['before file', '  let coupon = "RACE-1"', 'test "t"', '  let coupon = "OTHER"', '  api GET /coupons/{coupon}'], says: 'is made once in `before file` and shared read-only', as: 'a test rebinding a `before file` value' }] },
  { code: 'TF092', meaning: 'Checker: **`together` where no rows can meet.** The barrier holds the rows of a `with each concurrently` test until every row still running has reached it. In a test whose rows run in turn, in a hook or in an action there is nothing to wait for; inside a block (`within`, a tab, a download) some rows could pass it while others never reach it. **An error**: a race written with a barrier that does nothing passes without the race.', probes: [{ wrap: 'file', source: ['test "t"', '  together', '  api GET /a'], says: 'whose rows do not run at once', as: '`together` in a test with no concurrent table' }] },
  { code: 'TF093', meaning: 'Checker (config): **a step in the sign-in of a `session … oauth2 code` that sends or reads a request of its own** — `api`, `wait until api` or `capture`. The body runs in the browser the flow opened, the way a person signs in on the consent page; the token comes from the code exchange tflw makes after the redirect. **An error**: a request there would go out without the session it is part of establishing.', probes: [{ wrap: 'config', source: ['session sso oauth2 code', '  authorize url "http://localhost:4001/oauth/authorize"', '  token url "http://localhost:4001/oauth/token"', '  client id "cli"', '  redirect "http://127.0.0.1:0/callback"', '  api POST /login'], says: 'in the sign-in of', as: 'an `api` step in the sign-in' }] },
  { code: 'TF094', meaning: 'Checker (config): **a `session … oauth2 code` with no `redirect`, or one that is not a loopback `http` URL.** The code comes back to a listener tflw binds on this machine, so the redirect names it — `127.0.0.1`, `localhost` or `[::1]` over plain `http`, port `0` for one the OS chooses. A redirect written through `env(…)` is refused the same way at run time. **An error**: any other host would receive the code where tflw is not listening.', probes: [{ wrap: 'config', source: ['session sso oauth2 code', '  authorize url "http://localhost:4001/oauth/authorize"', '  token url "http://localhost:4001/oauth/token"', '  client id "cli"', '  redirect "https://app.example.com/callback"', '  click button "Allow"'], says: 'a loopback listener speaks plain', as: 'an `https` redirect to another host' }] },
  { code: 'TF095', meaning: 'Checker: **a `rows` block under a test with no `with each` table.** One run has nothing to count across; the judgement belongs in the test body as an ordinary `expect`. **An error.**', probes: [{ wrap: 'file', source: ['test "t"', '  api GET /a', 'rows', '  expect exactly 1 row status equals 201'], says: 'which has no `with each` table', as: 'a `rows` block under a plain test' }] },
  { code: 'TF096', meaning: 'Checker: **a `rows` line whose subject a finished row cannot answer.** A row is judged after it ends, from its last response and its bindings; its page is closed by then, so a locator, `page`, a dialog or a network observation has nothing left to read. **An error.**', probes: [{ wrap: 'file', source: ['with each', '  | n |', '  | 1 |', '  | 2 |', 'test "t {n}"', '  open "/"', 'rows', '  expect every row text "Done" is visible'], says: 'can read a row\'s last response and its bindings', as: 'a `rows` line about a locator' }] },
] as const;

/** The rows every consumer reads, with `example` filled in from whichever evidence the row carries
 *  — the derivation that makes the rendered cell unable to disagree with what runs underneath it.
 *  A `runtime` row renders its `as` prose; a probe row renders its executed source (`M110b`). */
export const DIAGNOSTICS: readonly DiagnosticEntry[] = DIAGNOSTIC_ROWS.map((row) => ({
  ...row,
  example: row.probes ? renderDiagnosticExample(row.probes) : `${row.runtime?.as ?? ''} — raised at run time, not by \`tflw check\``,
}));

export const CLI_FLAGS: readonly CliFlagEntry[] = [
  { flag: '`--env <name>`', command: 'run', effect: 'selects a named `env` block from `tflw.config` instead of the `default` one — e.g. run the same suite against `staging`' },
  { flag: '`--tag <name>[,<name>...]`', command: 'run', effect: 'only runs tests carrying any of the listed `@name`s (comma-separated OR; combines with `--only` as AND); a `!` excludes — `--tag !slow` runs everything not tagged `@slow`, exclusions AND together and beat an inclusion' },
  { flag: '`--only <name>`', command: 'run', effect: 'runs a single test by its exact declared name (composes with `--tag`\'s OR-list as AND)' },
  { flag: '`--kind <kind>[,<kind>...]`', command: 'run', effect: 'only runs the tests and crawls of the listed kinds — `api`, `browser`, `load`, `scan` — as their own statements classify them (comma-separated OR; combines with `--tag`/`--only`/`--failed` as AND). A test is of every kind whose statements it carries, so one with a request and a page is both `api` and `browser`' },
  { flag: '`--parallel <n>`', command: 'run', effect: 'runs up to `n` *files* concurrently in this process (default: `tflw.config`\'s `workers` key) — distinct from `--workers` below, which scales one workload-bearing test\'s own load generation across processes, not files' },
  { flag: '`--workers <n>`', command: 'run', effect: 'forks `n` generator *processes* to produce one file\'s workload-bearing test(s)\' load — each an equal striped share of the target population/rate, merged back into one report; a no-op warning on a file with no workload-bearing tests; default 1, no forking' },
  { flag: '`--skip-workload`', command: 'run', effect: 'skips every workload-bearing test (any `test` containing a `ramp`/`hold`/`step`/`spike`/`run … iterations` line), regardless of which `parallel`/`sequential` batch it\'s in — for fast iteration on the functional tests alone' },
  { flag: '`--seed <n>`', command: 'run', effect: 'fixes every `random`-family value for the run, so a failure is reproducible byte-for-byte' },
  { flag: '`--now <iso>`', command: 'run', effect: 'pins the run\'s notion of "now" to an exact instant (combine with `--seed` to reproduce a run\'s exact absolute generated values)' },
  { flag: '`--no-color`', command: 'run', effect: 'disables ANSI color in CLI output — useful for CI logs or piping to a file' },
  { flag: '`--verbose`', command: 'run', effect: 'additionally prints one line per step (pass or fail); buffered per-file under `--parallel > 1` so concurrent files never interleave (`--workers` is the unrelated load-generation axis and has no effect here)' },
  { flag: '`--forbid-insecure`', command: 'run', effect: 'CI policy gate — fails before any test runs if `insecure true` is active for the env actually running' },
  { flag: '`--evidence <level>`', command: 'run', effect: 'overrides `tflw.config`\'s `evidence` key (`full`/`headers-only`/`none`) for this run only' },
  { flag: '`--teardown <level>`', command: 'run', effect: 'overrides `tflw.config`\'s `teardown` key (`always`/`on-success`/`never`) for this run only — hyphenated here, two bare words in the config' },
  { flag: '`--allow-public-target <origin>`', command: 'run', effect: 'affirms that an **originating** scan (`authorization violations`) may point at a host outside the private address ranges — `TF065`. Repeatable, one origin each (scheme + host + port), and it must match an `authorized target` this env declares. **Has no `tflw.config` key by design**: the declaration layer lives in config, and this is the layer that makes it impossible for a committed config to send CI at the internet on its own. A `security violations` scan needs no flag — it only inspects a response the suite already asked for' },
  { flag: '`--failed`', command: 'run', effect: 'replays the tests that are failing — each test\'s newest verdict in the kept runs (`report/runs/`); falls back to the full suite with a note if none is' },
  { flag: '`--shard i/n`', command: 'run', effect: 'runs every nth file of the sorted discovered suite, starting at the ith — the n shards are disjoint and together the whole suite, so a CI matrix of n jobs runs everything once; `--tag`/`--only`/`--failed` then narrow within the shard, and every shard still validates the whole suite first' },
  { flag: '`--bail`', command: 'run', effect: 'stops after the first failing test\'s final (post-retry) verdict; under `--parallel > 1`, in-flight files still finish (the file pool stops pulling new work, it does not abort a running file)' },
  { flag: '`--no-keep`', command: 'run', effect: 'does not copy this run into `report/runs/<id>/` — every other run is kept there, bounded by `runs keep N` (default 50), for the history the summary and the page read; `report/` itself is written as always'},
  { flag: '`--format ndjson`', command: 'run', effect: 'streams the event log as one JSON object per line to stdout (plus `report/events.ndjson`) instead of human text; always full detail regardless of `--verbose`' },
  { flag: '`--no-timestamps`', command: 'run', effect: 'omits the `HH:MM:SS.mmm` prefix every console line otherwise gets by default' },
  { flag: '`--log-file <path>`', command: 'run', effect: 'duplicates console output to a file, always plain text (ANSI stripped) regardless of stdout\'s own color state' },
  { flag: '`--browser <engine>`', command: 'run', effect: 'switches every browser step to one engine — chromium/firefox/webkit (default chromium)' },
  { flag: '`--headed`', command: 'run', effect: 'shows the browser window instead of running headless (local debugging only)' },
  // `M260`: parsed since `RUN_FLAGS` gained it and described in `run --help`, but never a row here,
  // so every gate that reads this table (the reference page, the docs' flag check) called it absent.
  { flag: '`--trace`', command: 'run', effect: 'keeps the Playwright trace of every browser test, even when everything passed (needs evidence `full`); open it with `npx playwright show-trace`' },
  { flag: '`--update-snapshots`', command: 'run', effect: 'writes/overwrites `matches snapshot` baselines instead of just comparing against them' },
  { flag: '`--no-helpers`', command: 'run', effect: 'refuses every `use` before the first request, whatever `tflw.config`\'s `helpers` allows — for a run that must not execute a JS/TS module (`TF083`)' },
  { flag: '`--log-output <dest>`', command: 'run', effect: 'overrides `tflw.config`\'s `log destination` key (`console`/`html`/`both`/`none`) for this run\'s bare `log "…"` calls only — a `log … to …` statement\'s own destination always wins' },
  { flag: '`--log-level <level>`', command: 'run', effect: 'overrides `tflw.config`\'s `log level` key (`debug`/`info`/`warn`/`error`) — the minimum level a `log` step must clear to be rendered in console output/`report.html` (never affects whether it\'s recorded in `results.json`/ndjson)' },
  { flag: '`--fail-on <severity>`', command: 'run', effect: 'security findings below the given severity (`minor`/`moderate`/`serious`/`critical`) are reported and do not fail the build. **The gate can only relax, never tighten**: a test that wrote its own floor (`has no serious security violations`) keeps it, and where the two disagree the stricter wins — a command-line flag that could turn a green suite red would produce a failure nobody can locate from the source. Never applies to the negated `not has no …` form, where a finding is what makes the assertion succeed. A withheld finding still renders, badged, and the passing line names the count' },
  { flag: '`--baseline <file>`', command: 'run', effect: 'accepted findings, matched on the 16-hex fingerprint alone — the `rule`/`endpoint` beside each entry are for the human reading the file, since matching on a name would let a renamed rule silently un-accept every entry that mentioned it. Listed findings still render, badged *known/accepted*, and do not fail the build; delete a line to un-accept it. A malformed file is refused rather than degraded to "accepted nothing", which would look exactly like a codebase that fixed everything' },
  { flag: '`--baseline-write <file>`', command: 'run', effect: 'writes this run\'s findings out as the accepted set, sorted and deduplicated — it ships with `--baseline` rather than after it because fingerprints are hashes and hand-transcribing forty of them is not an adoption path. Entries the run did not reproduce are **reported and never removed**: a `--tag` run legitimately produces a subset of the suite\'s findings, so pruning on absence would delete acceptances the next full run still needs' },
  { flag: '`--probe-seeded <n>`', command: 'run', effect: 'adds `n` generated mutation payloads per **already-granted** class to the input-handling scan\'s fixed corpus. It cannot widen what `authorized target` permitted — seeding is a capability of the run and a mutation class is a claim in the config. Its findings are reported and **never gate**: a generated payload has no stable fingerprint, appearing under one seed and vanishing under the next, so gating on it would churn a baseline or fail a build on a coin flip. Each renders with its payload and seed under *promote this payload into the corpus*. Capped at 64 per class, because probes are strictly sequential and this is wall-clock one assertion pays' },
  { flag: '`--format json`', command: 'check', effect: 'prints one `{ file, diagnostics }` entry per file checked as JSON instead of text — for editor and CI integrations' },
  { flag: '`--allow-public-target <origin>`', command: 'check', effect: 'the same affirmation `run` takes, accepted here because `check` answers *will this run?*, and the answer depends on it — without it a suite legitimately scanning a public staging host could never get a clean `tflw check`. `check` still sends nothing: the flag only changes which diagnostics it reports' },
  // M62 (doc truth): `check`\'s two shared flags, `init --load` and `install-browsers --browser`
  // were accepted by the parser and listed in `tflw --help`, but missing here — so the reference
  // page generated from this list simply didn\'t have them, and `reference/cli.md` carried a
  // hand-written sentence apologising for the gap. Found by the docs guard, which validates every
  // documented invocation against this list. The `--help` test now runs in both directions.
  { flag: '`--env <name>`', command: 'check', effect: 'selects a named `env` block from `tflw.config` instead of the `default` one — decides which env-scoped checks (service names, `insecure`) run' },
  { flag: '`--no-color`', command: 'check', effect: 'disables ANSI color in CLI output' },
  { flag: '`--load`', command: 'init', effect: 'also scaffolds a `load.tflw` — a workload-bearing `test` in the open (`rps`) model, runnable with plain `tflw run`' },
  { flag: '`--scan`', command: 'init', effect: 'also scaffolds a `scan.tflw` and a `tflw.config` carrying a **commented-out** `authorized target` — the scan refuses (`TF060`) until a person uncomments it and writes the reason, because that declaration is an affirmation only its author can make; the config points at a real host rather than the demo service, whose scheme has no origin to authorize' },
  { flag: '`--example`', command: 'init', effect: 'writes the Coffee Shelf instead of the one-test scaffold: a stdlib `node:http` shop (`npm run shop`), its order page, 37 tests across every kind, and a `tflw.config` whose URLs read `SHOP_URL`' },
  { flag: '`--force`', command: 'init', effect: 'with `--example` only: overwrites files of the same name instead of refusing' },
  { flag: '`--browser <engine>`', command: 'install-browsers', effect: 'downloads chromium/firefox/webkit (default chromium) — runs the `playwright` CLI inside the optional peer dependency, resolved from the consuming project; refuses if that peer is absent rather than fetching one' },
  { flag: '`--browser <engine>`', command: 'pick', effect: 'the engine to launch: chromium (default), firefox or webkit' },
  { flag: '`--cdp-port <n>`', command: 'pick', effect: 'opens the browser\'s DevTools endpoint on `127.0.0.1:<n>`, announced on stderr, so a script can drive the window with Playwright\'s `connectOverCDP`; chromium only, and never on any address but loopback' },
  { flag: '`--browser <engine>`', command: 'record', effect: 'the engine to launch: chromium (default), firefox or webkit' },
  { flag: '`--cdp-port <n>`', command: 'record', effect: 'opens the browser\'s DevTools endpoint on `127.0.0.1:<n>`, announced on stderr, so a script can drive the window with Playwright\'s `connectOverCDP`; chromium only, and never on any address but loopback' },
  { flag: '`--env <name>`', command: 'watch', effect: 'selects a named `env` block from `tflw.config` instead of the `default` one' },
  { flag: '`--seed <n>`', command: 'watch', effect: 'fixes the seed reused by every run for the whole watch session (else one is freshly minted at startup)' },
  { flag: '`--browser <engine>`', command: 'watch', effect: 'switches every browser step to one engine — chromium/firefox/webkit (default chromium)' },
  { flag: '`--no-color`', command: 'watch', effect: 'disables ANSI color in CLI output' },
  { flag: '`--env <name>`', command: 'migrate', effect: 'selects a named `env` block from `tflw.config` instead of the `default` one — deprecations are checker diagnostics, so this only affects which env-scoped checks run' },
  { flag: '`--no-color`', command: 'migrate', effect: 'disables ANSI color in CLI output' },
  { flag: '`--check`', command: 'fmt', effect: 'writes nothing; lists every file that would change and exits 1 if any would — the CI form. Without it, files are rewritten in place and each one that changed is named' },
  { flag: '`--endpoint <url>`', command: 'export', effect: 'where `tflw export otlp` POSTs the trace — a collector\'s OTLP/HTTP traces address, e.g. `http://localhost:4318/v1/traces`; required' },
  { flag: '`--header <name=value>`', command: 'export', effect: 'a header sent with the trace, for a collector\'s auth; repeatable' },
  { flag: '`--out <dir>`', command: 'merge', effect: 'where `tflw merge` writes the merged `report.html`, `junit.xml`, `results.json` and `findings.sarif`; required, and never one of the inputs' },
  { flag: '`--no-color`', command: 'merge', effect: 'plain text for the merged summary, as `run --no-color`' },
  { flag: '`--env <name>`', command: 'doctor', effect: 'which env block `tflw doctor` resolves — default as `run`: `TFLW_ENV`, then the block marked `default`; an undeclared name is a usage error' },
  { flag: '`--json`', command: 'doctor', effect: 'the same facts as one JSON object — `ok`, `node`, `config`, `services`, `proxy`, `tls`, `suite`, `browsers`, `problems` — for a CI step or a support ticket' },
  { flag: '`--port <n>`', command: 'ui', effect: 'the loopback port the page is served on (default 4141); `0` lets the OS pick and the chosen port is printed' },
  { flag: '`--no-open`', command: 'ui', effect: 'do not open the page in a browser after the server starts — the URL is printed either way, which is the form a tunnel (`ssh -L`) or a script wants' },
  { flag: '`--json`', command: 'spec', effect: "emits the construct manifest as JSON instead of the human listing — the form a conformance check reads. Spelled as a boolean rather than `--format json`: `spec` has one machine format and one human one, so there is no open set of renderings to name" },
  { flag: '`--version`, `-v`', command: 'global', effect: 'print the installed version' },
  { flag: '`--help`, `-h`', command: 'global', effect: 'print usage' },
] as const;

// ---- The construct manifest (`M154a`, D736–D738) ---------------------------
//
// One flat list of every construct tflw ships, assembled from the tables above and emitted by
// `tflw spec --json`. It exists because `testFlow-tests` had no way to ask what tflw's surface *is*
// — the dogfood is the conformance target for this language, and until `M154` nothing joined the
// set of constructs to the set of constructs it exercises. `PLAN_M154_DOGFOOD_CONFORMANCE.md` §2
// measured the cost of that: seven step keywords with literally zero occurrences across 126 `.tflw`
// files, four of the six workload shapes never executed by anything.
//
// **D736 — the manifest lists what the parser dispatches, and nothing else.** A `🔮 planned`
// construct is *absent*, not listed with a `planned` status. Two reasons, and the second is the one
// that matters. First, every table here is already held to the parser two-way (D277 for
// `STEP_KEYWORDS`, D444 for `CONFIG_KEYWORDS`, and `LOCATORS` below joins them), so "what the
// parser accepts" is the only set that can be derived rather than remembered. Second, a `planned`
// list would be a hand-maintained wordlist of things that do not exist — `D659`'s exact
// prohibition — and it buys nothing: a construct that gets built simply *appears* here, and the
// consumer's `no construct without a row` rule (D724) goes red on its own the same day. Nobody has
// to remember to flip a badge. `MATCHERS` is the one table carrying its own `status` field, from
// `M97b`; it is emitted verbatim rather than overridden, so if a `planned` matcher is ever added
// the manifest says so instead of quietly claiming it works.
//
// **What is deliberately not here.** `DIAGNOSTICS` contributes its *codes* and neither `meaning`
// nor `example`: both are multi-kilobyte markdown written for SPEC §17, the whole table is ~78 KB
// of prose, and a coverage gate needs the code. `RUNTIME_RULES` (`conformance.ts`) is a different
// manifest answering a different question — which rules the runtime enforces — and belongs to the
// checker contract, not to the surface a test file can exercise.

/** The word that may open a locator, with the line it says about itself. Hand-authored and held to
 * `parser.ts`'s own `LOCATOR_KEYWORDS` by `specManifest.test.ts`, the `STEP_KEYWORDS`/D277 shape —
 * `spec-data.ts` cannot import `parser.ts` (the dependency runs the other way, and a cycle here
 * would be a real one), so the two are held in step by a test rather than derived.
 *
 * `element` is absent on purpose: SPEC §9.3 lists it as `🔮 planned`, `parseLocator` refuses it, and
 * per D736 a manifest that named it would promise a spelling that does not work. */
export interface LocatorEntry {
  readonly id: string;
  readonly syntax: string;
  readonly summary: string;
  readonly example: string;
}

export const LOCATORS: readonly LocatorEntry[] = [
  { id: 'button', syntax: '`button "<name>"`', summary: 'a button, link or any element with a button role, by its accessible name', example: '`click button "Add to cart"`' },
  { id: 'field', syntax: '`field "<label>"`', summary: 'a form control by its label, placeholder or accessible name', example: '`fill field "Email" with {email}`' },
  { id: 'text', syntax: '`text "<content>"`', summary: 'an element by the text it renders', example: '`expect text "Order placed" is visible`' },
  { id: 'list', syntax: '`list "<name>"`', summary: 'a list or table region by its accessible name — the container form `within` scopes into', example: '`within list "Cart items"`' },
  { id: 'css', syntax: '`css "<selector>"`', summary: 'a raw CSS selector, for what no semantic locator reaches', example: '`click css "#dropzone"`' },
  { id: 'xpath', syntax: '`xpath "<expr>"`', summary: 'a raw XPath expression, the last resort when neither semantics nor CSS reach it', example: '`click xpath "//tr[2]/td[1]"`' },
] as const;

export interface SubjectEntry {
  readonly id: string;
  /** The word(s) `parseSubject` may dispatch on to reach this row — `body` for all five body
   * forms, `dialog` for both dialog forms, the six locator words for `locator`, and **nothing** for
   * `value`, which is reached by one token of `{` lookahead and no keyword at all (`D129`).
   * `SUBJECT_OPENING_WORDS` is the deduplicated union, and it is what the did-you-mean corrects
   * against: a typo is one token, so `dialogue` must be able to reach `dialog`. */
  readonly opens: readonly string[];
  /** The labels an editor may insert verbatim in subject position, and the forms `TF013` names when
   * it tells a user what a subject is. Not the same list as `opens`, and the difference is the
   * whole of `M174-02`: bare `dialog` is a **dispatch** word and an **error** to write (`D798`), so
   * it opens two rows and completes neither; `body text` completes but opens nothing; and
   * `network-request` and `value` complete nothing at all, because what follows `request to` and
   * what stands inside `{…}` are a string and a bound name, neither of which a fixed label can
   * carry. */
  readonly completes: readonly string[];
  /** `api` for what an api step's response carries, `browser` for what a page or a network request
   * does, `value` for the one subject that comes from the variable scope. The same three words
   * `STEP_KEYWORDS` already uses, so a consumer grouping by `group` across families gets one
   * vocabulary rather than two. */
  readonly group: 'api' | 'browser' | 'value';
  readonly syntax: string;
  readonly summary: string;
  readonly example: string;
}

/**
 * What may stand in subject position — the left-hand side of every assertion in the language
 * (`M174`, `D903`-`D907`). Closes `M159-01`, which is the row for this table not existing: until it
 * did, `D724`'s *no construct without a row* had no row to demand, and three subjects entered the
 * language with nothing noticing.
 *
 * WHY THE KEY IS AN AST NODE TYPE (`D903`, `D904`). One subject construct is one `Subject` union
 * member, and `Record<Subject['type'], SubjectEntry>` is what holds the two together: a seventeenth
 * member is a **compile error here**, and a row for a member that was retired is one too. Every
 * other table in this file is held to the parser by a test, because `spec-data.ts` cannot import
 * `parser.ts`; this one can do better, because the thing it must not drift from is a *type*.
 *
 * That mechanism is three commits old. It needs `tsconfig.test.json` to reach `test/`, which is
 * `M173b` — before that, `specManifest.test.ts` was type-stripped and never checked, so a claim
 * made in the type system would have been enforced over `src` only.
 *
 * The behavioural half stays regardless (`D736`): `specManifest.test.ts` parses one source per row
 * and asserts the parser produces exactly that node type. A table and a type agreeing proves only
 * that someone edited both.
 *
 * WHY `locator` IS ONE ROW AND NOT SIX (`D903`), AND WHY IT IS ROSTERED AT ALL (`D906`). Six
 * spellings open a locator and all six are already rostered as `locator:*`. A locator in *subject*
 * position is a different admission from the same locator in action position — `pollable()` and the
 * matcher-compatibility check judge the first and never see the second — so it is one construct
 * here, not six, and not zero.
 *
 * WHY TWO ROWS SPELL OUT `expect` AND FOURTEEN DO NOT (`D907`). A `syntax` cell is compiled into
 * the regex `packages/docs-site` uses to decide whether a construct is documented. Fourteen of these
 * spellings are legal nowhere else in the grammar, so the bare form identifies them. `locator` and
 * `value` are not: `click button "Add to cart"` and `open "/orders/{orderId}"` are both legal and
 * neither is a subject, so a bare cell would let an action-position use stand as documentation of
 * the subject-position construct — a rule that is always green and checks nothing, which is `D792`'s
 * own failure class and the reason this family exists.
 */
export const SUBJECTS: Readonly<Record<Subject['type'], SubjectEntry>> = {
  StatusSubject: { id: 'status', opens: ['status'], completes: ['status'], group: 'api', syntax: '`status [of request to "<url>"]`', summary: 'the response status code — the api step\'s, or a named browser network request\'s (`M3d`)', example: '`expect status equals 201`' },
  DurationSubject: { id: 'duration', opens: ['duration'], completes: ['duration'], group: 'api', syntax: '`duration`', summary: 'wall time of the request in milliseconds, compared unrounded (`D807`/`D810`) — a regression tripwire, not perf testing', example: '`expect duration is less than 500ms`' },
  HeaderSubject: { id: 'header', opens: ['header'], completes: ['header'], group: 'api', syntax: '`header "<name>" [of request to "<url>"]`', summary: 'one response header, by name', example: '`expect header "content-type" contains "json"`' },
  BodySubject: { id: 'body', opens: ['body'], completes: ['body'], group: 'api', syntax: '`body[.<path>]`', summary: 'the JSON response body, whole or addressed by a dot/index path whose segments may be quoted when a key is not a bare word (`body."content-type"`)', example: '`expect body.items[0].price equals 42`' },
  BodyTextSubject: { id: 'body-text', opens: ['body'], completes: ['body text'], group: 'api', syntax: '`body text`', summary: 'the raw response body as a string, for the non-JSON responses a JSON path cannot address', example: '`expect body text contains "healthy"`' },
  BodyBytesSubject: { id: 'body-bytes', opens: ['body'], completes: ['body bytes'], group: 'api', syntax: '`body bytes`', summary: 'the untouched response body, for binary responses `body text` would irreversibly UTF-8-corrupt; `matches file` is its one dedicated matcher', example: '`expect body bytes matches file "./fixtures/report.pdf"`' },
  BodyCsvSubject: { id: 'body-csv', opens: ['body'], completes: ['body csv'], group: 'api', syntax: '`body csv[.<path>]`', summary: 'the response body parsed as RFC 4180 CSV, addressed through the same path machinery as `body`', example: '`expect any body csv.status equals "delivered"`' },
  BodyPdfTextSubject: { id: 'body-pdf-text', opens: ['body'], completes: ['body pdf text'], group: 'api', syntax: '`body pdf text`', summary: 'text extracted from a PDF response body — a flat string, every page, no path', example: '`expect body pdf text contains "Invoice"`' },
  RequestSubject: { id: 'request', opens: ['request'], completes: ['request'], group: 'api', syntax: '`request`', summary: 'the connection attempt itself rather than any response; only `connects`/`fails` apply, and it is not capturable', example: '`expect request fails`' },
  NetworkRequestSubject: { id: 'network-request', opens: ['request'], completes: [], group: 'browser', syntax: '`request to "<url>"`', summary: 'a browser network request addressed by URL — lexically similar to `request` and semantically distinct (`M3d`)', example: '`expect request to "/api/orders" was made`' },
  LocatorSubject: { id: 'locator', opens: ['button', 'field', 'text', 'list', 'css', 'xpath'], completes: ['button', 'field', 'text', 'list', 'css', 'xpath'], group: 'browser', syntax: '`expect button "<name>" …` / `expect field "<label>" …` / `expect text "<content>" …` / `expect list "<name>" …` / `expect css "<selector>" …` / `expect xpath "<expr>" …`', summary: 'a page element in subject position — the admission `pollable()` and the matcher-compatibility check judge, which the same locator in action position never reaches (`D906`)', example: '`expect button "Submit" is enabled`' },
  PageSubject: { id: 'page', opens: ['page'], completes: ['page'], group: 'browser', syntax: '`page`', summary: 'the active browser page as a whole rather than one element; its meaning comes entirely from the matcher after it', example: '`expect page has no critical a11y violations`' },
  ResponseSubject: { id: 'response', opens: ['response'], completes: ['response'], group: 'api', syntax: '`response`', summary: "the last api step's response scanned whole rather than addressed — what a hygiene scan takes; not capturable (`TF053`)", example: '`expect response has no serious security violations`' },
  DialogMessageSubject: { id: 'dialog-message', opens: ['dialog'], completes: ['dialog message'], group: 'browser', syntax: '`dialog message`', summary: 'the text the last native dialog showed', example: '`expect dialog message equals "Really delete?"`' },
  DialogTypeSubject: { id: 'dialog-type', opens: ['dialog'], completes: ['dialog type'], group: 'browser', syntax: '`dialog type`', summary: 'which kind the last native dialog was — a closed set: `alert`, `confirm`, `prompt`, `beforeunload`', example: '`expect dialog type equals "confirm"`' },
  ValueSubject: { id: 'value', opens: [], completes: [], group: 'value', syntax: '`expect {<name>} …` / `check {<name>} …`', summary: 'a value bound by `let`, `capture` or an action parameter, asserted on directly (`M96`/`D129`); braces are required, and `capture` refuses it', example: '`expect {orderId} matches "^ord_"`' },
};

/**
 * The words `parseSubject` dispatches on, deduplicated, in manifest order (`M174`, `D905`).
 *
 * `parser.ts` held its own copy of this list until `M174` and it was **13 of the 14** — `dialog`
 * was missing, so from `M159` until 2026-09-06 `TF013` told a user, by name, that `dialog` was not
 * a subject while `parseSubject` accepted `dialog message` and `dialog type` (`M174-01`). The list
 * is derived rather than asserted because it can be: `parser.ts` already imports this module for
 * `listConfigDirectives`, so the dependency runs the right way and there is no second list left to
 * drift. `STEP_KEYWORDS`/`LOCATOR_KEYWORDS` stay held-by-test because for those the parser's copy
 * is the *ground truth* and this file's table is the derived one; here it is the other way round.
 */
export const SUBJECT_OPENING_WORDS: readonly string[] =
  [...new Set(Object.values(SUBJECTS).flatMap((s) => s.opens))];

/**
 * What a user may write in subject position, spelled out — nineteen forms (`M174`, `D905`).
 *
 * Used for two different jobs that were one list before `M174`: the *"expected a subject (…)"* half
 * of every `TF013`, and the editor's completion candidates. Both are answers to "what do I write
 * here", which is why they are the same list; the did-you-mean is not, and uses
 * `SUBJECT_OPENING_WORDS` instead, because it corrects a single mistyped token.
 *
 * The LSP held its own copy and it was **12 of the 19**, missing `response` outright and every
 * dialog and body sub-form (`M174-02`); its own comment called the list *"load-bearing, not
 * polish"*, which it is — `FU-11`'s finding was that a subject a user cannot discover is a subject
 * they route around permanently.
 */
export const SUBJECT_FORMS: readonly string[] =
  [...new Set(Object.values(SUBJECTS).flatMap((s) => s.completes))];

export interface DeclarationEntry {
  readonly id: string;
  /** `declaration` — a word `parseProgram` dispatches on at the top level. `header` — a clause
   * `parseTest` accepts on (or just above) a `test` line. */
  readonly group: 'declaration' | 'header';
  readonly syntax: string;
  readonly summary: string;
  readonly example: string;
}

/**
 * The declaration dialect — **the family `M154a` missed** (`D742`).
 *
 * `M154a` shipped six families and recorded three deliberate departures; this was not among them,
 * and the reason it matters is the reason it gave for *adding* `GENERATORS`: a construct `M154c`
 * plants "cannot be demanded by a gate that cannot see it". `M154c` plants `retry` and `after`
 * hooks. Both are things the parser dispatches, neither was a construct, so `D724`'s
 * `no construct without a row` could not reach either — and the dogfood corpus, measured at the
 * time, ran `after file` **once**, a bare `after` **twice** and `retry` **five times**. Thin, and
 * structurally invisible.
 *
 * Held to `parser.ts`'s `DECLARATION_KEYWORDS`/`TEST_HEADER_CLAUSES` behaviourally rather than by
 * comparison — `specManifest.test.ts` parses a minimal file per row and asserts the parser accepts
 * it. Two lists agreeing proves only that someone edited both.
 */
export const DECLARATIONS: readonly DeclarationEntry[] = [
  { id: 'test', group: 'declaration', syntax: '`test "<name>" [as <session>[, …]] [retry <N>] [parallel|sequential]` + an indented body', summary: 'the unit of execution and of reporting; every step runs inside one', example: '`test "adds a widget to the cart"`' },
  { id: 'crawl', group: 'declaration', syntax: '`crawl "<name>"` + an indented body of `violations` assertions', summary: 'a source of requests rather than a kind of judgement — one request per discovered route per declared principal, each judged by every assertion in the body (`TF070`)', example: '`crawl "the v1 surface"`' },
  { id: 'action', group: 'declaration', syntax: '`action <name>(<param>, …)` + an indented body, ending in `give`', summary: "the language's only unit of reuse; gets its own response scope, so a call never publishes its response to the caller", example: '`action create order(name, qty)`' },
  { id: 'element', group: 'declaration', syntax: '`element <name> = <locator>`', summary: 'name a locator once and use the bare name wherever a locator goes — `click cartBadge`, `expect cartBadge is visible`; importable like an `action`, an unknown name is `TF089` and a repeated one `TF035`', example: '`element cartBadge = css "[data-test=cart-count]"`' },
  { id: 'import', group: 'declaration', syntax: '`import "<path.tflw>"`', summary: "pull in another suite's `action`s; its tests never run (`buildRegistry` takes only actions)", example: '`import "./shared/orders.tflw"`' },
  { id: 'use', group: 'declaration', syntax: '`use "<path.ts|.js>"`', summary: 'the JS escape hatch — a helper module whose exports become callable; one `use` makes `TF037` undecidable for the file, because exports cannot be enumerated without importing', example: '`use "./helpers/sign.ts"`' },
  { id: 'before', group: 'declaration', syntax: '`before` or `before file` + an indented body', summary: 'setup — bare runs once per test and shares its scope, `file` runs once per file in a scope isolated from every test', example: '`before file`' },
  { id: 'after', group: 'declaration', syntax: '`after` or `after file` + an indented body', summary: 'teardown, with the same two scopes as `before`; runs whether the test passed or failed', example: '`after file`' },
  { id: 'tags', group: 'header', syntax: '`@<tag>` on its own line(s) above a `test` or `crawl`', summary: 'label a declaration for `--tag` selection — includes OR across a comma-separated list, and a `!`-prefixed tag excludes (`--tag !slow`); a tag line is shared prefix, so which construct it introduces is only knowable past the tags', example: '`@smoke @checkout`' },
  { id: 'with-each', group: 'header', syntax: '`with each [concurrently]` + an indented table, or `with each from "<file.csv>" [concurrently]`, above a `test`', summary: 'run one copy of the test per row, each reporting as its own test; refused alongside a workload. `concurrently` runs the rows at once instead of in turn — a race asserted as the state afterwards (one row is `TF090`)', example: '`with each from "./fixtures/users.csv"`' },
  { id: 'rows', group: 'header', syntax: '`rows` + indented `expect <count> row(s) <subject> <matcher>` lines, directly under a `with each` test', summary: 'judge every row at once, after the last one ends: each line counts the rows whose last response (or bindings) satisfy it — `exactly N`, `N`, `at least N`, `at most N`, `no`, `every` — and reports as its own entry. For a race whose outcome lives only in the responses; no table is `TF095`, a page subject `TF096`', example: '`expect exactly 1 row status equals 201`' },
  { id: 'as', group: 'header', syntax: '`as <session>[, <session>…]`', summary: 'bind the test to one or more declared sessions — the owner identity every authorization probe compares against (`TF063`)', example: '`test "sees only its own orders" as shopper`' },
  { id: 'skip', group: 'header', syntax: '`skip "<reason>" [on env <name>, …]`', summary: 'keep the test in the file and run none of it — reported as its own outcome with the reason; a blank reason is `TF084`. With `on env` the skip holds only in those envs and the test runs everywhere else; an undeclared env is `TF088`', example: '`test "refunds settle" skip "no payments sandbox in CI" on env ci`' },
  { id: 'retry', group: 'header', syntax: '`retry <N>`', summary: 're-run the whole test up to N times before its final verdict; `retry 0` is the default spelled out loud, and a fraction is `TF071`', example: '`test "settles eventually" retry 2`' },
  { id: 'concurrency', group: 'header', syntax: '`parallel` or `sequential`', summary: "override the file's default worker behaviour for one test; contradicting both on one header is an error by name, not by position", example: '`test "mutates shared stock" sequential`' },
] as const;

/** Which table a construct came from. Not a synonym for the `group` beneath it: `step` covers all
 * five step families including `workload`, because `WORKLOAD_DIRECTIVES` and `STEP_KEYWORDS`'
 * `workload` family are the same seven words (asserted, not assumed — `specManifest.test.ts`), and
 * emitting both would put two ids on one construct. */
export type SpecConstructFamily = 'declaration' | 'step' | 'subject' | 'matcher' | 'generator' | 'locator' | 'config' | 'diagnostic';

export interface SpecConstruct {
  /** The key a coverage manifest keys on. **Opaque**: the only thing promised about it is that it
   * is unique across the manifest and stable across builds (`specManifest.test.ts` asserts the
   * first; `SPEC_MANIFEST_VERSION` covers a deliberate change to the second). It is spelled
   * `<family>:<name>` today, and `config` qualifies by slot as well, so nothing has to guess what a
   * future `probe` sharing a name with a key would do. Parse `family`/`name` from their own fields,
   * never out of this string. */
  readonly id: string;
  readonly family: SpecConstructFamily;
  /** The sub-grouping inside the family, where the source table has one: a step's
   * `api|assertion|value|browser|workload`, a generator's `unique|random|transform`, a config
   * word's `directive|key|probe`. Equal to `family` where the table has no finer axis. */
  readonly group: string;
  /** The construct as it is typed — or, for a diagnostic, its `TF0xx` code. */
  readonly name: string;
  /** `planned` can only come from `MATCHERS`' own field; everything else here is, by D736,
   * something the parser dispatches today. */
  readonly status: 'shipped' | 'planned';
  /** **Diagnostics only** (`M159g`, `D806d`): which phase decides this code — `check` for the
   * sixty-six a `tflw check` can emit, `run` for one that is only reachable by running (`TF079`,
   * `TF080`). Derived from whether the row carries `runtime` evidence instead of `probes`, which
   * the manifest already forces to be exactly one of the two, so the two answers cannot disagree.
   *
   * It exists because a consumer outside this repository has to grade the two kinds differently and
   * cannot see the difference: `testFlow-tests`' `verify-check-diagnostics.mjs` demands a fixture
   * per code that a real `tflw check` provokes, and for a `run` code no such fixture can exist. The
   * alternative — that gate accepting a proof of *either* kind for *any* code — was rejected: it
   * would let a check-time code be proved by a runtime witness alone and never notice, and the
   * whole value of that gate is that it knows what it is owed. Absent on every non-diagnostic
   * construct, where the question does not arise. */
  readonly phase?: 'check' | 'run';
  /** Markdown-ready cell text, carried through verbatim from the source table. Absent on
   * diagnostics, whose prose is deliberately not emitted (see the note above). */
  readonly syntax?: string;
  readonly summary?: string;
  readonly example?: string;
}

/** The manifest's own version, bumped when the *shape* changes — not when a construct is added or
 * removed, which is the whole point of the thing. A consumer pins this so a shape change is a loud
 * failure rather than a silently-empty gate (the `M141`/`D538` class).
 *
 * **2 since `M174`**: the `subject` family. Adding a family is the shape change this number was
 * reserved for — a consumer that buckets by `family` and has never heard of `subject` silently
 * drops sixteen constructs, which is the exact failure `D538` exists to make loud. `M174` §3 lists
 * what moved on this side; the sibling pins nothing and so breaks on its next `refresh-tflw`
 * instead, which is `D511`'s accepted red window. */
export const SPEC_MANIFEST_VERSION = 2;

/** Assembled fresh on each call rather than frozen at module scope: this runs once per
 * `tflw spec` invocation, and a shared frozen array is a thing a consumer can mutate. */
export function specConstructs(): readonly SpecConstruct[] {
  return [
    // First, because a declaration is what a step lives inside — the manifest reads outside-in, and
    // the human rendering of `tflw spec` groups in this order too.
    ...DECLARATIONS.map((d): SpecConstruct => ({
      id: `declaration:${d.id}`, family: 'declaration', group: d.group, name: d.id, status: 'shipped',
      syntax: d.syntax, summary: d.summary, example: d.example,
    })),
    ...STEP_KEYWORDS.map((k): SpecConstruct => ({
      id: `step:${k.id}`, family: 'step', group: k.family, name: k.id, status: 'shipped',
      syntax: k.syntax, summary: k.summary, example: k.example,
    })),
    // `M174`. Between `step` and `matcher` because that is the order an assertion is read in —
    // `expect <subject> <matcher>` — and the fold's own comment says it reads outside-in.
    ...Object.values(SUBJECTS).map((s): SpecConstruct => ({
      id: `subject:${s.id}`, family: 'subject', group: s.group, name: s.id, status: 'shipped',
      syntax: s.syntax, summary: s.summary, example: s.example,
    })),
    ...MATCHERS.map((m): SpecConstruct => ({
      id: `matcher:${m.id}`, family: 'matcher', group: 'matcher', name: m.id, status: m.status,
      syntax: m.syntax, summary: m.appliesTo, example: m.example,
    })),
    ...GENERATORS.map((g): SpecConstruct => ({
      id: `generator:${g.id}`, family: 'generator', group: g.family, name: g.id, status: 'shipped',
      syntax: g.syntax, summary: g.notes, example: g.example,
    })),
    ...LOCATORS.map((l): SpecConstruct => ({
      id: `locator:${l.id}`, family: 'locator', group: 'locator', name: l.id, status: 'shipped',
      syntax: l.syntax, summary: l.summary, example: l.example,
    })),
    ...CONFIG_KEYWORDS.map((c): SpecConstruct => ({
      id: `config:${c.slot}:${c.id}`, family: 'config', group: c.slot, name: c.id, status: 'shipped',
      summary: c.summary,
    })),
    ...DIAGNOSTICS.map((d): SpecConstruct => ({
      id: `diagnostic:${d.code}`, family: 'diagnostic', group: 'diagnostic', name: d.code, status: 'shipped',
      // `D806d`. Read off the evidence the row carries rather than stored beside it, for the same
      // reason `example` is: a second field saying which phase a code belongs to is a field that can
      // disagree with the proof underneath it.
      phase: d.runtime ? 'run' : 'check',
    })),
  ];
}
