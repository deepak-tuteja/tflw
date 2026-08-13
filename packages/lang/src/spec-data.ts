// The canonical structured manifest of matcher/generator/CLI-flag signatures (PLAN decision 103,
// enterprise arc cluster 4, decision 16.4). Hand-authored — there's no `GeneratorName` union or
// CLI-flag type to introspect (generators parse via dedicated `parseUniqueExpr`/`parseRandomExpr`
// functions in parser.ts, not a typed list; `cli.ts`'s arg parsing is hand-rolled). This is the
// single source of truth going forward: `scripts/gen-spec-tables.mjs` renders the matcher and
// generator tables straight into SPEC.md between marker comments (replacing/augmenting what used
// to be hand-maintained prose tables); `packages/docs-site`'s Reference pages and a later LSP's
// hover/signature-help (PLAN_ENTERPRISE.md decision 17.7) import this module directly.

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
  { id: 'has-value', syntax: '`has value`', appliesTo: 'UI fields', example: '`expect field "Email" has value "a@b.c"`', status: 'shipped', subjects: ['locator'], quantifiable: false },
  { id: 'state-word', syntax: '`is visible/hidden/enabled/disabled/checked`', appliesTo: 'UI locators', example: '`expect button "Pay" is enabled`', status: 'shipped', subjects: ['locator'], quantifiable: false },
  { id: 'connects', syntax: '`connects`', appliesTo: '`request`', example: '`expect request connects`', status: 'shipped', subjects: ['request'], quantifiable: false },
  { id: 'fails', syntax: '`fails` / `fails matching "<regex>"`', appliesTo: '`request`', example: '`expect request fails matching "certificate"`', status: 'shipped', subjects: ['request'], quantifiable: false },
  { id: 'was-made', syntax: '`was made`', appliesTo: '`request to "<url>"`', example: '`expect request to "/api/orders" was made`', status: 'shipped', subjects: ['network-request'], quantifiable: false },
  { id: 'has-no-a11y-violations', syntax: '`has no [minor/moderate/serious/critical] a11y violations`', appliesTo: '`page`', example: '`expect page has no critical a11y violations`', status: 'shipped', subjects: ['page'], quantifiable: false },
  { id: 'has-no-security-violations', syntax: '`has no [minor/moderate/serious/critical] security violations`', appliesTo: '`response`', example: '`expect response has no serious security violations`', status: 'shipped', subjects: ['response'], quantifiable: false },
  { id: 'has-no-authorization-violations', syntax: '`has no [minor/moderate/serious/critical] authorization violations`', appliesTo: '`response`', example: '`expect response has no authorization violations`', status: 'shipped', subjects: ['response'], quantifiable: false },
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
  { id: 'unique-prefix', family: 'unique', syntax: '`unique("prefix")`', notes: 'collision-safe across tests/workers/retries', example: '`unique("Widget")`' },
  { id: 'unique-email', family: 'unique', syntax: '`unique email`', notes: 'collision-safe across tests/workers/retries', example: '`unique email`' },
  { id: 'unique-number', family: 'unique', syntax: '`unique number`', notes: 'collision-safe across tests/workers/retries', example: '`unique number`' },
  { id: 'unique-like', family: 'unique', syntax: '`unique like "ORD-######"`', notes: '`#` = digit; pattern fill, collision-safe', example: '`unique like "ORD-######"`' },
  { id: 'unique-uuid', family: 'unique', syntax: '`unique uuid`', notes: 'v4-shaped; trailing digits are the run-wide counter, so distinctness is guaranteed, not probabilistic', example: '`unique uuid`' },
  { id: 'random-number', family: 'random', syntax: '`random number A to B` / `random decimal A to B`', notes: 'seed-reproducible; rejects a reversed range as a runtime error', example: '`random number 1 to 100`' },
  { id: 'random-date', family: 'random', syntax: '`random date in past` / `in future` / `between A and B`', notes: 'seed- and run-clock-reproducible (`--seed`/`--now`)', example: '`random date in past`' },
  { id: 'random-of', family: 'random', syntax: '`random of "a", "b", ...`', notes: 'seed-reproducible pick from an inline list', example: '`random of "red", "blue", "green"`' },
  { id: 'random-string', family: 'random', syntax: '`random string N`', notes: 'seed-reproducible alnum string of length N', example: '`random string 12`' },
  { id: 'random-like', family: 'random', syntax: '`random like "SKU-####-??"`', notes: '`#` = digit, `?` = letter; seed-reproducible pattern fill', example: '`random like "SKU-####-??"`' },
  { id: 'random-uuid', family: 'random', syntax: '`random uuid`', notes: 'v4, collisions allowed (not collision-guaranteed like `unique uuid`)', example: '`random uuid`' },
  { id: 'random-password', family: 'random', syntax: '`random password [N]`', notes: 'default length 12, min 4; satisfies a validation policy, not fake-identity realism', example: '`random password 16`' },
  { id: 'transform-base64', family: 'transform', syntax: '`base64 encode(...)` / `base64 decode(...)`', notes: 'pure deterministic value transform, not a fresh-value generator (decision 98)', example: '`base64 encode("{email}:{password}")`' },
  { id: 'transform-hex', family: 'transform', syntax: '`hex encode(...)` / `hex decode(...)`', notes: 'pure deterministic value transform, not a fresh-value generator (decision 98)', example: '`hex encode("{token}")`' },
  { id: 'transform-url', family: 'transform', syntax: '`url encode(...)` / `url decode(...)`', notes: 'pure deterministic value transform, not a fresh-value generator (decision 98)', example: '`url encode("{query}")`' },
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
export const WORKLOAD_DIRECTIVES = ['ramp', 'hold', 'step', 'spike', 'run', 'threshold', 'cleanup'] as const;

export const STEP_KEYWORDS: readonly StepKeywordEntry[] = [
  { id: 'api', family: 'api', syntax: '`api [<service>] <METHOD> <target> [body …] [timeout <dur>] [without redirects]`', summary: 'issue one HTTP request; `<target>` is a path against the env base URL or an absolute URL', example: '`api POST /orders body { name: "Widget", qty: 1 }`' },
  { id: 'wait', family: 'api', syntax: '`wait until api <METHOD> <target>` + indented expects, or `wait until <locator> [is] <matcher> [for <dur>]`', summary: 're-issue a request, or re-poll a UI condition, until it passes or the wait budget elapses', example: '`wait until button "Submit" is enabled`' },
  { id: 'expect', family: 'assertion', syntax: '`expect <subject> [not] <matcher> [value]`', summary: 'hard assertion — evaluated once against the received response, fails the test immediately', example: '`expect status equals 201`' },
  { id: 'check', family: 'assertion', syntax: '`check <subject> [not] <matcher> [value]`', summary: 'the soft twin of `expect`: records a failure and keeps going. Not the checkbox action — that is `tick` (FS-04)', example: '`check body.total equals 42`' },
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
  { id: 'tick', family: 'browser', syntax: '`tick <locator>`', summary: 'tick a checkbox or radio. Spelled `tick`, not `check` — `check` is the soft assertion and nothing else (FS-04)', example: '`tick field "Accept terms"`' },
  { id: 'untick', family: 'browser', syntax: '`untick <locator>`', summary: 'untick a checkbox', example: '`untick field "Accept terms"`' },
  { id: 'press', family: 'browser', syntax: '`press "<key>" [on <locator>]`', summary: 'send a key press — page-level, or scoped to one locator', example: '`press "Enter" on field "Search"`' },
  { id: 'hover', family: 'browser', syntax: '`hover <locator>`', summary: 'move the pointer over the element a locator resolves to', example: '`hover button "Menu"`' },
  { id: 'scroll', family: 'browser', syntax: '`scroll to <locator>`', summary: 'scroll the element into view', example: '`scroll to button "Load more"`' },
  { id: 'within', family: 'browser', syntax: '`within <locator>` or `within frame <locator>` + an indented block', summary: "scope nested steps to one container — or, with `frame`, into an iframe's own document", example: '`within list "Cart items"`' },
  { id: 'accept', family: 'browser', syntax: '`accept dialog`', summary: 'arm a one-shot handler accepting the *next* native dialog; without it Playwright auto-dismisses silently', example: '`accept dialog`' },
  { id: 'dismiss', family: 'browser', syntax: '`dismiss dialog`', summary: 'arm a one-shot handler dismissing the next native dialog', example: '`dismiss dialog`' },
  { id: 'switch', family: 'browser', syntax: '`switch to new tab` + an indented block, or `switch to tab <N>`', summary: 'make another tab active — the block form arms the popup listener before running, so a fast tab cannot race past it', example: '`switch to tab 1`' },
  { id: 'close', family: 'browser', syntax: '`close tab`', summary: 'close the active tab and fall back to the previous one; closing the last tab is a runtime error', example: '`close tab`' },
  { id: 'download', family: 'browser', syntax: '`download as <name>` + an indented block', summary: "run the block with a download listener armed, then bind the download's suggested filename", example: '`download as file`' },
  { id: 'drag', family: 'browser', syntax: '`drag <locator> to <locator>`', summary: 'dispatch a real native drag-and-drop sequence with a genuine `DataTransfer`', example: '`drag text "First item" to text "Second item"`' },
  { id: 'drop', family: 'browser', syntax: '`drop file "<path>" onto <locator>`', summary: 'drop a real file onto a dropzone that has no `<input type="file">`', example: '`drop file "./receipt.png" onto css "#dropzone"`' },
  { id: 'screenshot', family: 'browser', syntax: '`screenshot "<name>"`', summary: 'capture the active page unconditionally; binary evidence, so only captured at `evidence full`', example: '`screenshot "before payment"`' },
  { id: 'stub', family: 'browser', syntax: '`stub <METHOD> "<url-pattern>" respond status <N> [body …]`', summary: 'intercept a matching network request and answer it, without touching the server', example: '`stub POST "/api/payments/**" respond status 500`' },
  { id: 'pause', family: 'browser', syntax: '`pause <duration>`', summary: 'wait a fixed duration. Renamed from `think` (FS-05); a real wait belongs in `wait until`, not here', example: '`pause 500ms`' },
  { id: 'ramp', family: 'workload', syntax: '`ramp to N users over <dur>` / `ramp to N rps over <dur>`', summary: 'linear ramp from zero to the target — makes the test workload-bearing', example: '`ramp to 50 users over 30s`' },
  { id: 'hold', family: 'workload', syntax: '`hold N users for <dur>` / `hold N rps for <dur>`', summary: 'a flat target for the whole duration, with no ramp-in', example: '`hold 20 rps for 2m`' },
  { id: 'step', family: 'workload', syntax: '`step users` / `step rps` + indented `to N for <dur>` lines', summary: 'a staircase of instant jumps, each held for its own duration', example: '`step users`' },
  { id: 'spike', family: 'workload', syntax: '`spike users` / `spike rps` + indented `hold N for <dur>` / `to N over <dur>` lines', summary: 'a baseline → burst → recovery shape, mixing flat and ramped stages in any order', example: '`spike rps`' },
  { id: 'run', family: 'workload', syntax: '`run N iterations [per user] across M users`', summary: 'count-bounded load with no duration; the count is exact and independent of `--workers`', example: '`run 500 iterations across 10 users`' },
  { id: 'threshold', family: 'workload', syntax: '`threshold <metric> is less than <value>`', summary: "the pass/fail rule for a workload-bearing test — decided once, after the run, against the run's aggregate metrics", example: '`threshold p95 duration is less than 800ms`' },
  { id: 'cleanup', family: 'workload', syntax: '`cleanup` + an indented block', summary: 'steps that run once after a workload finishes, whatever its verdict', example: '`cleanup`' },
] as const;

/** One CLI flag, entered by hand (decision 16.4 — `cli.ts`'s arg parsing has nothing to
 * introspect). Feeds `packages/docs-site`'s `Reference/cli.md` (replacing README's old flag
 * table, decision 16.10) and a later LSP's signature help. */
export interface CliFlagEntry {
  readonly flag: string;
  readonly command: 'run' | 'check' | 'init' | 'install-browsers' | 'pick' | 'watch' | 'migrate' | 'global';
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
export const CONFIG_DIRECTIVES = ['defaults', 'env', 'session', 'require', 'exclude'] as const;

export type ConfigDirective = (typeof CONFIG_DIRECTIVES)[number];

/** `` `a`, `b`, or `c` `` — the directive list as `TF022`'s message and `meaning` both render it. */
export function listConfigDirectives(): string {
  const quoted = CONFIG_DIRECTIVES.map((d) => `\`${d}\``);
  return `${quoted.slice(0, -1).join(', ')}, or ${quoted[quoted.length - 1]}`;
}

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
    readonly missingFiles?: readonly string[];
    readonly importedActions?: readonly { readonly name: string; readonly arity: number; readonly from: string }[];
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
    readonly envAuthorizedTargets?: { readonly envName: string; readonly targets: readonly { readonly target: string; readonly reason: string }[]; readonly apiBaseUrl: string | null };
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
export interface DiagnosticEntry {
  readonly code: string;
  readonly meaning: string;
  readonly example: string;
  readonly probes: readonly DiagnosticProbe[];
}

const DIAGNOSTIC_ROWS: readonly Omit<DiagnosticEntry, 'example'>[] = [
  { code: 'TF001', meaning: 'Lexer: a character that cannot begin any token. Also carries the **numeric-notation** case (M98b, `A1-18`): `1e3`, `0xff`, `0b1010`, `0o17` and `1_000` are not tflw numbers, and each lexes as a number followed by a *name* — `1e3` reads as `1` then `e3`, a 1000× difference between what was written and what was read. Those five shapes now say so at the number, naming the decimal value to write instead, rather than surfacing downstream as ``unexpected `e3` at end of step`` with a help line pointing at the end of the line. Deliberately narrow: "a number directly followed by a name" is exactly how every **duration** lexes (`pause 30s`, `expect duration is less than 500ms`), so only the five unambiguous notations are diagnosed. `.5` is not covered — `dot` + `number` is legal in a path and in a field access, and the lexer has no parser context to tell them apart. Recovery is unchanged: the tokens are still number + name.', probes: [{ wrap: 'step', source: ['let y = $oops'], says: 'unexpected character "$"' }, { wrap: 'step', source: ['let n = 1e3'], says: 'exponent notation is not supported — this reads as `1` followed by the name `e3`' }] },
  { code: 'TF002', meaning: 'Lexer: a string literal has no closing quote before end of line.', probes: [{ wrap: 'file', source: ['test "open string'] }] },
  { code: 'TF003', meaning: 'Lexer: indentation does not line up with any enclosing block. This is now the code\'s *only* meaning: until M98c (`A1-13`) it was also emitted for "tabs are not allowed in indentation", a different condition with a different fix, while this row documented only the alignment case — so SPEC §17, the docs-site Reference page and LSP hover, which are all generated from this row, described the wrong rule for half of the code\'s firings. The tab rule is `TF048`.', probes: [{ wrap: 'file', source: ['test "misaligned"', '    log "a"', '  log "b"'], says: 'indentation does not match any enclosing block', as: 'a line dedented to a column that matches no enclosing block — `4` spaces, then `2`, inside a body opened at `4`' }] },
  { code: 'TF010', meaning: 'Parser: a token appeared where the grammar didn\'t allow it (the catch-all "unexpected token" code — covers many distinct shapes: a missing path after `api GET`, a multi-word call missing its parens, a malformed table row cell count, etc.).', probes: [{ wrap: 'step', source: ['api GET'], says: 'expected a path like `/orders`, found end of line' }] },
  { code: 'TF011', meaning: 'Parser: an unrecognised statement keyword where a step was expected, or a *retired* one — a keyword the parser still recognises solely so it can name its replacement outright (FS-04\'s `uncheck` → `untick`, D103 style). A retired spelling is kept out of both the did-you-mean vocabulary and the "expected one of" fallback: offering it back as valid would be worse than no suggestion.', probes: [{ wrap: 'step', source: ['expct status equals 200'], says: 'did you mean `expect`?' }, { wrap: 'step', source: ['uncheck field "Terms"'], says: '`uncheck` was renamed to `untick`' }] },
  { code: 'TF012', meaning: 'Parser: an unknown HTTP method after `api`.', probes: [{ wrap: 'step', source: ['api FETCH /health'], says: 'did you mean `PATCH`?' }] },
  { code: 'TF013', meaning: 'Parser: an unrecognised `expect`/`capture` subject.', probes: [{ wrap: 'step', source: ['expect statuss equals 200'], says: 'did you mean `status`?' }] },
  // A3-OS-06: the old example was a mashup of the two mutually-exclusive hint branches ("did you
  // mean" *and* an option list) and showed output the tool does not produce — `eq` is two characters
  // from nothing, so it gets the fallback line, not a suggestion. This one is copied from a real
  // run, and names the branch it is showing.
  { code: 'TF014', meaning: 'Parser: an unrecognised matcher after a subject, or none at all — including the one shape that used to be legal, a bare `check <locator>` (FS-04): it ticked a checkbox, so a forgotten matcher silently turned a soft assertion into a mutation that then passed. That case names both readings rather than guessing which was meant.', probes: [{ wrap: 'step', source: ['expect text "x" is vissible'], says: 'did you mean `visible`?' }, { wrap: 'step', source: ['check field "Terms"'], says: '`check <locator>` needs a matcher' }] },
  { code: 'TF015', meaning: 'Parser: a `test`/`action`/hook block has no indented body.', probes: [{ wrap: 'file', source: ['before file'], says: 'this `before file` has no steps', as: 'a `before file` block with no steps under it' }] },
  { code: 'TF016', meaning: 'Parser: top-level content that isn\'t a `test`/`action`/`import`/`use`/`before`/`after`.', probes: [{ wrap: 'file', source: ['expect status equals 200'], says: 'expected a `test`, `action`, `import`, `use`, `before`, or `after`, found `expect`' }] },
  { code: 'TF020', meaning: 'Parser (config): an unrecognised key inside a config block.', probes: [{ wrap: 'config', source: ['defaults', '  headr "Accept" is "application/json"'], says: 'did you mean `header`?' }] },
  { code: 'TF021', meaning: 'Parser (config): a `test` appears in the declaration-only config dialect.', probes: [{ wrap: 'config', source: ['test "not allowed here"'], says: '`test` is not allowed in tflw.config' }] },
  { code: 'TF022', meaning: `Parser (config): top-level config content that isn't one of ${listConfigDirectives()} (M110, \`V4-04\` — this list is \`CONFIG_DIRECTIVES\` above, the same array the parser's own message is built from, so the two cannot drift again).`, probes: [{ wrap: 'config', source: ['workers 3'], says: 'expected `defaults`, `env`, `session`, `require`, or `exclude`, found `workers`' }] },
  { code: 'TF023', meaning: 'Parser: a duration whose unit is missing, mis-spelled, mis-cased, or spaced off its number. M98c (`A1-07`) made it reachable from **value** position — `expect duration is less than 250 ms` and `2sec` used to fall out of the step as ``TF010: unexpected `ms` at end of step`` / `= help: expected end of line`, because `250ms` and `250 ms` lex identically and the value path simply declined to build a duration when its adjacency or unit check failed. The three cases are kept apart because their fixes differ: a real unit written with a space, shown the closed-up spelling, a word that means a unit tflw spells differently (`sec` → `s`, `MS` → `ms`), and a word that was never a unit, which keeps the generic error. The known-spelling table is enumerated, not inferred, so `1e3` and `0xff` stay `TF001`\'s numeric-notation case rather than acquiring a second, wrong explanation.', probes: [{ wrap: 'config', source: ['defaults', '  timeout step 5x'], says: 'unknown time unit `x`' }, { wrap: 'step', source: ['api GET /a', 'expect duration is less than 2sec'], says: 'tflw\'s time units are `ms`, `s` and `m` — write `2s`' }] },
  { code: 'TF024', meaning: 'Checker (config): more than one `env` marked `default`, or a duplicate env name.', probes: [{ wrap: 'config', source: ['env staging default', '  api "https://a"', 'env prod default', '  api "https://b"'], says: 'more than one env is marked `default`', as: 'two `env … default` blocks in one `tflw.config`' }] },
  { code: 'TF025', meaning: 'Checker (config): a key used in the wrong block.', probes: [{ wrap: 'config', source: ['defaults', '  web "https://example.com"'], says: '`web` is not allowed in defaults' }] },
  { code: 'TF026', meaning: 'Checker: an `api <service>`/`wait until api <service>` name not declared in the active env — checked in test/action/hook bodies **and** inside `session` blocks (decision 66).', probes: [{ wrap: 'step', source: ['api billng POST /auth/login'], says: 'did you mean `billing`?', needs: {'services':['billing']} }] },
  { code: 'TF027', meaning: 'Checker: a `{col}` reference **in a test\'s name** that is not among its inline `with each` table\'s declared columns. Deliberately the name and nothing else (M110, `V4-05`): a bad `{col}` in the test *body* is indistinguishable from any other unbound variable at check time and is already `TF030`, which says the same thing with the same "did you mean" — a second code for it would split one mistake across two. **File-backed** tables (`with each from "…"`) are skipped entirely: their columns are not known until the file is read at run time, and `lang` does no I/O (`TF043` covers the file itself going missing).', probes: [{ wrap: 'file', source: ['with each', '  | price |', '  | 10    |', 'test "checkout {prcie}"', '  api GET /health'], says: 'unknown table column "prcie" referenced in the test name', as: '`test "checkout {prcie}"` over a `with each` table whose only column is `price`' }] },
  { code: 'TF028', meaning: 'Checker: a `test … as <session>[, <session>...]` name not declared by any `session` block — one diagnostic per unknown name.', probes: [{ wrap: 'file', source: ['test "x" as ghost', '  api GET /a'], says: 'unknown session "ghost"', needs: {'sessions':[]} }] },
  { code: 'TF029', meaning: 'Checker (config): a session name that is not the session\'s alone — a duplicate, or (M130b, D333) the reserved name `anonymous`. **One code, because it is one repair**: rename the session. `anonymous` is the built-in principal every `has no authorization violations` assertion probes with, present in the probe set without being declared, so a session by that name would either shadow it or be shadowed by it and neither is visible from the config. That is the same failure a duplicate has — one name, two things behind it — which is why this widened the row rather than taking a code of its own.', probes: [{ wrap: 'config', source: ['session admin', '  api POST /login', 'session admin', '  api POST /login'], says: 'duplicate session `admin`', as: 'two `session admin` blocks in one `tflw.config`' }, { wrap: 'config', source: ['session anonymous', '  api POST /login'], says: 'is a reserved principal name' }] },
  { code: 'TF030', meaning: 'Checker: a `{var}`/bare-identifier reference provably never bound anywhere reachable in its scope — conservative (decision 57): only flags a name that\'s *definitely* unreachable, never one that merely might be.', probes: [{ wrap: 'step', source: ['api POST /orders', 'capture body.ok as orderId', 'api GET /orders/{orderid}'], says: 'unknown variable "orderid"' }] },
  { code: 'TF031', meaning: 'Checker: a `request` assertion (`connects`/`fails`) combined with a response-based assertion (`status`/`header`/`body`/`duration`) on the same request, or used at all inside `wait until api` (decision 18).', probes: [{ wrap: 'step', source: ['api GET /a', 'expect request connects', 'expect status equals 200'], says: 'can\'t be combined with `request connects`/`fails` on the same request' }] },
  { code: 'TF032', meaning: 'Checker: an `upload … type "…"` value that is a non-interpolated literal not shaped like `type/subtype` (decision 22/M19) — a light regex, not an IANA vocabulary check, so it only catches an obvious typo before the run.', probes: [{ wrap: 'step', source: ['api POST /u upload "./f.png" as "avatar" type "imagepng"'], says: 'invalid content type "imagepng", expected a "type/subtype" shape like "image/png"' }] },
  { code: 'TF033', meaning: 'Parser/checker (load, M29/M30, M50/D93-D96): a workload-bearing `test`\'s workload/threshold shape is invalid, two such tests in one file share a name (M30, D29 — names key each one\'s own metrics/threshold breakdown under concurrent multi-load-test runs), a `retry`/`with each` clause coexists with a workload (D96), a browser step appears inside a workload-bearing body (D19 — API-only in v1), `pause` appears outside one (D18), a workload-bearing `test` carries no `threshold` at all (M60/A4-01 — its verdict comes only from thresholds, so with none it can never fail), a workload-bearing `test` thresholds `duration` without pairing it with an **unscoped** `error rate` threshold (M89c/B3-14 — a duration threshold reads only the iterations that succeeded, so alone it is satisfied by a target that fails half its requests fast, and a *scoped* error-rate threshold bounds one endpoint while the rest of the scenario fails freely), an `authorization violations` assertion appears inside a workload-bearing body (M130b, D315 — each one sends a probe per declared principal, so under a workload the cross-identity traffic is multiplied by the load factor against a host authorized for a scan, not for a scan times the VU count), or a removed keyword is found — `scenario` (D103 — write `test "…" { ramp to … }` instead) or `think` (FS-05 — renamed to `pause`). The `pause`/browser-step bans follow calls into `action`s (M60/A4-02) and report at the call site, since the same action is legal under a workload and illegal outside one. The `pause` hint names both ways out honestly (FS-05): a *condition* is `wait until …` / `wait until … for <dur>`, while genuinely elapsed time — a cache TTL, a token expiry — has no condition to poll and belongs in the JS escape hatch (§11).', probes: [{ wrap: 'step', source: ['pause 2s'], says: '`pause` is only legal inside a workload-bearing `test`' }, { wrap: 'step', source: ['think 2s'], says: '`think` was renamed to `pause`' }] },
  { code: 'TF034', meaning: 'Checker (load, M43/D70): a `threshold … for "label"` clause references a label that matches no `api` step\'s identity (its explicit `as "label"` tag, or its automatic `METHOD path.raw` identity when untagged) within the same workload-bearing test.', probes: [{ wrap: 'file', source: ['test "t"', '  hold 5 users for 10s', '  api GET /a as "checkout"', '  threshold p95 duration for "checkotu" is less than 250ms'], says: 'threshold `for "checkotu"` matches no step in this test', as: '`threshold p95 duration for "checkotu" is less than 250ms` with only an `as "checkout"`-tagged step in scope' }] },
  { code: 'TF035', meaning: 'Checker (M60/`A2-01`; widened M97b/`B5-02`): a name is declared as an `action` more than once in the namespace a file actually runs in. Two `action`s in one file is the original case — actions are file-scoped, so the second shadows nothing, it is simply ambiguous. As of M97b the same code also covers a name declared locally *and* brought in by an `import`, and a name two `import`s both provide: the runtime (`buildRegistry`) has always refused all three, and `TF035` used to see only the first — so the manifest, the checker and its test agreed with each other while missing what the runtime enforced. The imported halves are reported only when the imports were actually read (the same `undefined`-vs-`[]` rule `TF037` turns on): a name cannot be called a duplicate of something nobody looked at.', probes: [{ wrap: 'file', source: ['action fetch it()', '  api GET /a', 'action fetch it()', '  api GET /b'], says: 'duplicate action "fetch it"', as: '`action fetch it()` declared twice' }, { wrap: 'file', source: ['import "./shared/orders.tflw"', 'action fetch it()', '  api GET /a'], says: 'duplicate action "fetch it" (imported from "./shared/orders.tflw")', as: 'the same name arriving via `import "./shared/orders.tflw"`', needs: {'importedActions':[{'name':'fetch it','arity':0,'from':'./shared/orders.tflw'}]} }] },
  { code: 'TF036', meaning: 'Checker (M85/A4-10): the **active** env\'s own `api`/`api <service>`/`web` base URL has a host that its own `allow hosts` list (accumulated across `defaults` + the env, SPEC §3.7) does not match — a statically decidable contradiction that costs a whole run to discover otherwise, one identical runtime refusal per step for one config line. Env-scoped like every other config check (`checkSessionServices`, `knownServices`): a contradiction in an env you have not selected is not this run\'s problem, and a suite may legitimately keep a deliberately-blocked env as a negative-case fixture. The hint names the consequence *that key* has — only the default `api` base takes the whole suite down; a named service takes its own calls, `web` takes the browser half. Only fully literal URLs are checked: a base URL containing `{…}` names a host this pass cannot decide, and is skipped rather than guessed at (note that `resolveConfig` takes such a URL literally today — the recorded `A2-12` gap — so skipping it neither hides a live behaviour nor pre-commits this check if config interpolation ever lands).', probes: [{ wrap: 'config', source: ['env local', '  api "http://127.0.0.1:9099"', '  allow hosts "example.com"'], says: 'env `local`\'s `api` base URL is "http://127.0.0.1:9099", whose host "127.0.0.1" is not in its own `allow hosts` (example.com)', as: '`api "http://127.0.0.1:9099"` alongside `allow hosts "example.com"`' }] },
  { code: 'TF037', meaning: 'Checker (M87/A4-03, `FU-08`): a call names neither an `action` nor a JS helper, so the run dies at that step with `unknown call`. Being a *negative* claim it is made only where it is sound, which is narrower than it first looks. **The world must be closed**: every `import` resolved, and no `use` at all — a JS helper module\'s exports cannot be enumerated without importing it, and the checker never executes the code it checks (P#2), so one `use` line makes this undecidable for that file. **And the frame\'s registry must be knowable**: a `test` or hook body, never an `action` body. Calls bind late, against the *entry* file\'s registry, so a shared action may legitimately call a name only its importer defines; a `test` is safe because an imported file\'s tests never run (`buildRegistry` takes only its `actions`). `TF038` is unaffected by either condition — it only ever fires on a name that already resolved.', probes: [{ wrap: 'file', source: ['action create order(name)', '  api GET /a', 'test "t"', '  creat order("Widget")'], says: 'did you mean `create order`?', as: '`creat order("Widget")` beside `action create order(name)`' }] },
  { code: 'TF038', meaning: 'Checker (M87/A4-03): a call resolves to a known `action` but passes the wrong number of arguments. Sound regardless of `use`, unlike `TF037` — the runtime resolves actions before helpers (`execCall`), and an action name is unique across the whole registry (`TF035` and `buildRegistry` both refuse a duplicate), so a name that matches a declared action is that action and nothing else.', probes: [{ wrap: 'file', source: ['action create order(name)', '  api GET /a', 'test "t"', '  create order("Widget", "extra")'], says: 'action "create order" expects 1 argument, got 2', as: '`create order("Widget", "extra")` against `action create order(name)`' }] },
  { code: 'TF039', meaning: 'Checker (M87/A4-16, `FU-12`): an `expect`/`check` on a response-backed subject (`status`/`duration`/`header`/`body …`/`request`), or any `capture`, appears before the first `api`/`wait until api` step **in its own response scope**. The scope is exactly one `execSteps` frame in the interpreter, which is narrower than it looks: a `test`/`action`/hook body is one, and so is each nested `within` / `switch to new tab` / `download` body. An `action` gets its own — calling one never publishes its response to the caller (that is `FU-12`) — and a `before` hook\'s response is likewise invisible to the test body. UI subjects (a locator, `page`) and `request to "…"` network observations are excluded: the interpreter routes those away from the response path entirely, so they never needed one. A `{variable}` subject (M96) is excluded for the same reason — it reads a `let`/`capture` binding, and an *unbound* one is already `TF030`.', probes: [{ wrap: 'step', source: ['expect status equals 200'], says: 'no response yet — an `api` step must run before this assertion/capture', as: '`expect status equals 200` as a test\'s first step' }] },
  { code: 'TF040', meaning: 'Checker (M87, found while fixing `A4-03`): a call is written somewhere its value is never computed. The interpreter evaluates a `CallExpr` in exactly two places — a bare call step, and the *whole* right-hand side of a `let` — because running one is asynchronous and `evalValue` (which computes every other value) is synchronous by design. A call anywhere else parses, checks, and then silently yields nothing: `body { id: create thing() }` drops the field and sends `{}`, `[create thing()]` sends `[null]`, and `give create thing()` returns nothing — each at a green `✓`, testing a request nobody wrote. Reported alone for such a call: `TF037`/`TF038` are suppressed there, since the position is the thing to fix first.', probes: [{ wrap: 'step', source: ['api POST /orders body { id: create thing() }'], says: 'bind it first — `let result = create thing(…)` — then use `{result}` here' }] },
  { code: 'TF041', meaning: 'Checker (M96, `FU-11`): a `{variable}` subject stands somewhere a value cannot. Two cases. **A live-handle matcher** — `is visible`/`hidden`/`enabled`/`disabled`/`checked`, `has value`, `matches snapshot`, `has no … a11y violations`, `connects`/`fails`, `was made` — needs a browser element, a page, a connection attempt or an observed request; a bound value has no such state to observe, whatever its type. The *type*-constrained matchers (`equals`, `contains`, `matches "<regex>"`/`subset`/`schema`/`file`, `is greater/less than`, `has count`) are deliberately **not** checked here: a mismatch there is a runtime error for `body.<path>` today, and a captured value must not be stricter than the response it came from. **Inside `wait until api`** — that block re-issues its request and re-evaluates its expects each poll, and a value subject cannot change between polls, so the assertion either passes on the first attempt or times out blaming an endpoint that never controlled it. Distinct from `TF014` (an *unrecognised* matcher): `is visible` is recognised, just misplaced.', probes: [{ wrap: 'step', source: ['api GET /a', 'capture body.id as orderId', 'expect {orderId} is visible'], says: '`is visible` needs a live browser element, page, or request — not a value', as: '`expect {orderId} is visible`' }] },
  { code: 'TF042', meaning: 'Checker (M97b, `A4-11`/`A4-15`): a matcher used where its subject cannot be read, or an `any`/`all` quantifier on a matcher that cannot be applied element by element. The rule is over the subject\'s **kind** — a value, a UI locator, `page`, `request`, `request to "…"` — and is read straight off SPEC \u00a76.2\'s own table, so the checker and the reference are one statement. **Shape is deliberately not checked**: `contains` documents "strings, arrays", but whether `body.msg` is either is not knowable until the response arrives, so that stays a runtime error. The quantifier half covers the two matchers that fetch an external document (`matches schema`, `matches file`); `matches file` in particular used to fail with a message about UI matchers, and under `any` was swallowed into "none of N elements matched". Distinct from `TF041`, which is this same rule for a `{variable}` subject and says so in that case\'s own words. Was a documented gap in \u00a71 until M97b closed it.', probes: [{ wrap: 'step', source: ['api GET /a', 'expect status is visible'], says: '`is visible/hidden/enabled/disabled/checked` can\'t be used on a value' }, { wrap: 'step', source: ['api GET /a', 'expect any body.items matches schema "W" from "/o.json"'], says: '`any` can\'t be combined with `matches schema "Name" from "src"`' }] },
  { code: 'TF043', meaning: 'Checker (M97c, `A4-07`): a path literal names a file that is not there. Covers every syntax that opens one — `import`, `use`, `with each from`, `body from`, `upload`, `matches file`, `drop file` — resolved exactly as the runtime resolves it, against the directory of the file that names it. **Only statically-known paths**: `upload "./fixtures/{name}.png"` names no file until the run picks a `name`, so it is skipped rather than guessed at. **Two severities (M97e, D147).** `import`/`use` are an **error**: `tflw check` opens them itself, so a missing one degrades the check that is running. The other five are a **warning** — the checker only `stat`s them on behalf of a step that has not run yet, and an earlier step, a hook, a `use`d JS action or a fixture build between `check` and `run` may create the file first. As an error that was a D137 clause 1 violation: `matches file "./x.bin"`, where an earlier step writes `x.bin`, is a valid suite that ran for eleven milestones and that M97c made unrunnable with no override. SPEC §4.3 has claimed this check since M2.5 and it did not exist; the row concluded the checker "could not" do it because it does no I/O, which mistook a `@tflw/lang` package invariant for a `tflw check` command one — the CLI has read imported files at check time since M87. The cost of not having it was the whole console output of a failed run being `✗ t.tflw (crashed) (0 ms)`, `--verbose` included. **`cert`/`key` in `tflw.config` are not covered** (config dialect, filed separately), and neither is CSV *column* existence, which needs the file\'s contents rather than a `stat`.', probes: [{ wrap: 'file', source: ['import "./nowhere.tflw"', 'test "t"', '  api GET /a'], says: '`import` names a file that does not exist: "./nowhere.tflw"', needs: {'missingFiles':['./nowhere.tflw']} }] },
  { code: 'TF044', meaning: 'Checker (M97d, `A4-13`): an `action` that can reach itself, directly (`a → a`) or through others (`a → b → a`). Sound to reject because **tflw has no conditionals** — no `IfStmt`, no branching keyword — so a cycle is not *potentially* infinite but unconditionally so, and the only way such a run can end is by failing. **Not gated on a closed world**: a same-file name can never be shadowed (`buildRegistry` throws on a duplicate and `TF035` reports it), so the check still applies to a suite that `use`s a JS helper. **Across `import`s too (M109, `M97d-01`)**: the graph is the one a run would build — this file\'s actions, then each import\'s, first declaration winning as `buildRegistry` has it — which is decidable precisely because calls bind late against the entry file\'s registry. Two limits, both by construction: with the imports unread (`importedActions` `undefined`) only local edges are seen, and a cycle whose every call site sits inside imported files is left to that file\'s own check, there being no span here to underline. The runtime guard stays the backstop for both, naming the same path in the same arrow notation; it used to be a raw V8 `RangeError` plus a 14,505-character single-line error. Only *evaluated* calls are edges: `let x = f() + "y"` never runs `f`. One diagnostic per cycle, not one per member.', probes: [{ wrap: 'file', source: ['action a()', '  b()', 'action b()', '  a()'], says: 'this call completes a cycle: `a → b → a`', as: '`action a()` calling `b()`, `action b()` calling `a()`' }] },
  { code: 'TF045', meaning: 'Lexer (M98b, `A1-10`/`A1-20`): bracket accounting does not balance — a `{`/`[` that is never closed, or a `}`/`]` that closes nothing. Both directions carry this one code because they are the same fact seen from either side. The unclosed case is reported **at the opening bracket**, and only for the innermost one: while a bracket is open the lexer emits no `newline`/`indent`/`dedent` at all, so a single stray `{` absorbs every following line into the same logical line, and the outer entries are consequences of the same typo rather than separate mistakes. Before this the lexer tracked only a *count*, which is enough to decide continuation and leaves nothing to point at, so the failure surfaced as `TF010: expected a field name, found a dedent` — carets on a synthesized dedent at line 3 of a 2-line file, underlining nothing.', probes: [{ wrap: 'step', source: ['api POST /o body {'], says: 'this `{` is never closed' }, { wrap: 'step', source: ['api POST /o body { a: 1 } }'], says: '`}` closes a bracket that was never opened', as: 'a stray `}`' }] },
  { code: 'TF046', meaning: 'Lexer (M98b, `A1-11`): a tag with no usable name — a bare `@`, `@ smoke` with a stray space, or `@123` starting with a digit. The tag token used to be pushed unconditionally, so `@` alone became `tag:""` and `tflw check` reported no problems at all. The cost is specific: a tag that is not a writable identifier can never appear in a `--tag` expression, so the test carrying it can be neither selected nor excluded — the failure class where a filter appears to work and silently runs the wrong set. `@ smoke` gets its own help line, because by the time the parser sees it the `@` is gone and the error reads ``expected `test`, found `smoke```.', probes: [{ wrap: 'file', source: ['@ smoke', 'test "t"', '  api GET /a'], says: 'a tag needs a name after the `@`' }] },
  { code: 'TF047', meaning: 'Lexer (M98b, `A1-05`): a string escape outside the supported set (`\\"`, `\\\\`, `\\n`, `\\r`, `\\t`). `"^\\d+$"` used to decode to `^d+$` — the backslash silently dropped — and the run then matched against a pattern nobody wrote, printing the written form in the step echo and the mangled form in the reason line without connecting them. **An error rather than a preserved backslash**, and this is the permanent choice: preserving it is what a regex author wants, but under that rule the meaning of `"\\q"` depends on membership in a five-entry table, so every escape added to the table later would silently change the value of existing suites. A rejected program becoming legal is additive; the reverse is not, which is the only direction a frozen surface can move. Matches JS, Java and non-raw Python. In a regular expression, write the backslash twice. **M98d (D166) adds `\\u{XXXX}` to the set, and every way of getting it wrong to this code**: no braces (`\\u0041` — what a JS or Java author\'s fingers produce), no code point (`\\u{}`), unclosed, above `\\u{10FFFF}`, or naming a surrogate half. That is one code widened rather than a second one added, and the test is the *fix*, not the number of conditions: all of these are corrected by spelling the escape the way tflw spells it, whereas `TF003`\'s two conditions (M98c) were split precisely because re-indenting a block and changing an editor setting are unrelated repairs. The braced form is the only one, because it is the only one that can write a character above U+FFFF as a single escape rather than as a surrogate pair.', probes: [{ wrap: 'step', source: ['api GET /a', 'expect body.id matches "^\\d+$"'], says: 'unknown escape `\\d` in a string' }] },
  { code: 'TF048', meaning: 'Lexer (M98c, `A1-12`/`A1-13`): a line is indented with tabs. Split out of `TF003`, which was carrying this and "indentation does not line up with any enclosing block" under one code while documenting only the second — and this row is what SPEC §17, the docs-site Reference page and LSP hover are generated from, so one code meaning two things made all four surfaces wrong at once. Reported **once per file**, at the first offending line, with the number of remaining lines in the help: the rule fired once per line before, so one wrong editor setting produced 100 identical errors on a 100-line file, none of which is a separate mistake and all of which have the same one-setting fix. The rule itself is unchanged, and is now written down in `GRAMMAR.md` § Lexical, where it had never appeared.', probes: [{ wrap: 'file', source: ['test "t"', '\tapi GET /a'], says: 'tabs are not allowed in indentation; use spaces', as: 'a file indented with tabs' }] },
  { code: 'TF049', meaning: 'Lexer (M98d, `A1-17`): a Trojan Source character — a bidi control (`U+202A`–`U+202E`, `U+2066`–`U+2069`), a zero-width character (`U+200B`–`U+200D`), or a `U+FEFF` anywhere but the very start of the file. What these share is that they make the source as *rendered* and the source as *parsed* two different texts: a bidi override inside a comment can display as an assertion that is not the one being run, and a zero-width space inside a compared string renders identically to the string without it. **An error, not a warning** (D165): for a general-purpose language a lint is the norm, but here `tflw check` is the gate, exit 0 is the signal, and a warning changes neither — while a reviewer reading a `.tflw` in a pull request has the rendered text as their only evidence of what it asserts. CVE-2021-42574; Rust, Go and the major C++ compilers all added a rule after it. Reported **only from the paths that consume a character without lexing it** — indentation, whitespace between tokens, a comment, the inside of a string — because everywhere else these characters cannot start a token and so already reach the author as `TF001`, and reporting both would be one mistake twice. `U+FEFF` is the case that could not be left to `TF001`: it is deliberately skipped as whitespace (M59, `A1-04`), so away from offset 0 it can sit inside what reads as a single name and split it into two tokens in silence. Every rejection here has a legal alternative — `\\u{…}`, added by the same milestone (D166) — because a rule with no way to comply is a capability removed, not a lint.', probes: [{ wrap: 'file', source: ['# a comment with \u202E in it', 'test "t"', '  api GET /a'], says: 'hidden character U+202E RIGHT-TO-LEFT OVERRIDE in a comment', as: 'a comment containing `U+202E`' }] },
  { code: 'TF050', meaning: 'Lexer (M103, `M98d-02`): the other half of the Trojan Source class — a word **inside a string** that mixes Latin with a script that has Latin lookalikes (Cyrillic, Greek, Cherokee, Armenian). Where `TF049` covers characters with no glyph, these have a glyph and it is somebody else\'s: `"аdmin"` with a Cyrillic `а` renders exactly like `"admin"` and compares unequal to it. **The severity comes from the negative matchers.** In `is`/`equals` a confusable makes the test *fail*, which is loud and self-correcting; in `not equals`/`not contains` — the shape a leak-prevention assertion takes — it makes the test **pass without asserting anything**, with no evidence on screen, in a diff, or in `tflw check`. The unit is one **word**, not one string (D178): a `.tflw` string is prose and prose is legitimately multilingual, so `"Willkommen — добро пожаловать"` is two scripts with no mixed word and stays legal, where a per-string rule would reject it. Only lookalike scripts count (D179): `"東京Tower"` mixes Latin and Han in one word and deceives nobody, because Han has no Latin homoglyphs. Common and Inherited never count — that is where `—`, `§`, `…`, `→` and `×` live. **Strings only** (D180), unlike `TF049`: a comment has no `\\u{…}` to escape into, and a rule with no way to comply is a capability removed rather than a lint. **Not covered:** a word written *entirely* in one non-Latin script that still reads as Latin (`"аԁmіn"` in all Cyrillic) — that needs the UTS #39 confusables table and is indistinguishable by shape from legitimate Russian data. The escape hatch is `\\u{…}`, and it works because the scan reads raw source.', probes: [{ wrap: 'step', source: ['api GET /a', 'expect body.status not equals "оk"'], says: 'the word `оk` mixes Latin with Cyrillic — U+043E', as: '`expect body.status not equals "оk"`' }] },
  { code: 'TF051', meaning: 'Checker (M116, `M97a-04`/`M97a-15`): a step needs a base URL the **active env** does not declare — `open` needs `web`, and an api request line with no `<service>` prefix needs the default `api`. Both halves are one rule with two operands, which is why they share a code: the AST says which kind a step needs, `tflw.config` says which kinds the env declares, and the answer is the same missing line either way. **An error, not a warning**, and the contrast with `TF043` is the point: a path a step opens may be created by an earlier step, so `TF043`\'s run tier is a *prediction*; a base URL cannot appear after the config is resolved, so this is an *observation*. The rule is precise about the service prefix — `api orders GET /health` resolves against a named service and stays silent even when the env declares no default `api`, because a multi-service config with no default is an ordinary shape rather than a mistake. The third site is the one nobody expects: `matches schema "…" from "<relative>"` resolves its source against the default service too (`contract.ts`), so a relative schema path needs `api` exactly as a request does, while an `http(s)://` one needs nothing.', probes: [{ wrap: 'step', source: ['api GET /health'], says: 'needs an `api` base URL', needs: { envBaseUrls: { envName: 'local', api: false, web: true } } }, { wrap: 'step', source: ['open "/login"'], says: 'needs a `web` base URL', needs: { envBaseUrls: { envName: 'local', api: true, web: false } } }] },
  { code: 'TF052', meaning: 'Checker (M116, `M97a-05`): `mask <locator>` written against a matcher other than `matches snapshot "…"`. A mask blanks a region *of a snapshot* before comparing it, so against any other matcher there is nothing for it to blank and the clause is silently doing nothing — which is the failure mode worth a diagnostic, since the author plainly believed it was masking something. The parser accepts a mask after any matcher **by design** (`parseSnapshotMasks`): rejecting it there would produce a parse error pointing at the wrong token, where this points at the mask itself. One diagnostic per mask rather than per statement, because each mask is a separate thing the author wrote and expected to do something.', probes: [{ wrap: 'step', source: ['api GET /a', 'expect status equals 200 mask field "Email"'], says: 'only applies alongside `matches snapshot' }] },
  { code: 'TF053', meaning: 'Checker (M116, `M97a-11`–`M97a-14`): `capture` against a subject that can be *asserted about* but not bound to a name — `page`, `request`, a UI locator, or an observed `request to "…"`. One code for what the runtime throws from five sites, because all five say the same sentence, and the hint names the operation each subject actually supports. **The `of request to "…"` case is the one that is easy to get wrong**: `status`/`header`/`body`/`body text` are ordinary value subjects, and `capture status as n` is perfectly legal — it is the `of` modifier that makes them uncapturable, since an observed network request is read from the browser\'s network log rather than from the last api step\'s response. So the rule tests the modifier before the subject kind; a kind-only rule looks complete and passes `capture status of request to "/x" as n` straight through.', probes: [{ wrap: 'step', source: ['api GET /a', 'capture request as r'], says: 'does not support `request`' }, { wrap: 'step', source: ['api GET /a', 'capture status of request to "/a" as s'], says: 'does not support a `request to' }] },
  { code: 'TF054', meaning: 'Checker (M124, `M97a-02`/`M97a-03`/`M97a-16`): an operand **written in the file** that the step will reject the moment it evaluates — `random number 5 to 1` (an empty range), `random password 2` (no room for the four character classes it guarantees), `hex`/`base64`/`url` `decode("…")` over a literal that will not decode, or a `matches`/`fails matching` pattern that is not a valid regular expression. Seven runtime `throw`s, one sentence, one code. **The rule fires on literals only, and that is the point rather than a limitation**: `random number {lo} to {hi}` is ordinary, legal and unknowable until the run binds those names, so an interpolated operand stays the runtime\'s. The decode tests are *imported* from the same module `eval.ts` uses (`literalValidity.ts`) rather than restated — "valid hex" has a length clause and "valid base64" excludes the URL-safe alphabet, and a second copy that drifted would report an error on a program that runs fine.', probes: [{ wrap: 'step', source: ['let bad = random number 5 to 1'], says: '`to` must be ≥ `from`' }, { wrap: 'step', source: ['let x = hex decode("not-hex!")'], says: 'is not valid hex' }, { wrap: 'step', source: ['api GET /a', 'expect body.name matches "("'], says: 'invalid regex in matcher' }] },
  { code: 'TF055', meaning: 'Checker (M124, `M97a-06`): `wait until <locator> … for <duration>` whose hold window is at least as long as `timeout wait`. The window asks the condition to stay true for longer than the step is allowed to run, so it can never close — the step can only end by timing out, reporting a slow app, which is the one thing that was not wrong. **A warning, not an error, and the tier is the whole decision.** The second operand comes from `tflw.config` and differs per env, so the checker is *predicting* what this run will do rather than observing something settled: a suite whose CI env raises `timeout wait` to 120s is correct, and an error would make it unrunnable with no override. That is D147, filed after `A4-05` shipped exactly this mistake inside the milestone whose thesis forbade it. Skipped entirely when the caller resolved no env — `undefined` means nobody looked, not "the budget is zero".', probes: [{ wrap: 'step', source: ['open "/x"', 'wait until button "Hidden" is hidden for 60s'], says: 'can never be satisfied', needs: { envTimeouts: { envName: 'local', wait: 30_000 } } }] },
  { code: 'TF056', meaning: 'Checker (M124, `M97a-01`): `with each from "…"` naming a file whose extension is neither `.csv` nor `.json`. The loader reads rows from CSV (a header row) or JSON (an array of row objects) and picks between them by extension, so anything else is refused — but only *after* the file is opened, which means the run gets far enough to read a path whose problem was legible in the source all along. **Its own code rather than `TF043`**: `TF043` is `MISSING_FILE`, and here the file is very likely present — being present is what leaves the extension as the only thing wrong. They also sit on opposite sides of D147, since a missing file may be created by an earlier step (a prediction, warning) while an extension cannot change between check and run (an observation, error). Interpolated paths are skipped, like every other M124 rule.', probes: [{ wrap: 'file', source: ['with each from "./rows.txt"', 'test "t"', '  api GET /health'], says: 'must be `.csv` or `.json`' }] },
  { code: 'TF057', meaning: 'Checker (M125b1, `FU-18`, D245): an `api`/`wait until api`/`open` step whose target is written as an absolute URL rather than a path under the active env\'s base. Absolute URLs became legal in M125b1 — before it, `api GET https://x/y` was a parse error and `open "https://x/y"` was *silently concatenated* onto the `web` base, opening `http://localhost:5173/https://x/y`, which loads on any SPA with a catch-all route and fails later on an unrelated assertion. This warning is the cost of making it legal: the step is fixed wherever it points, so `--env staging` moves every other request in the suite and not this one. **Not phrased as a mistake, because it frequently is not one** — a one-off request to a second host is the case the row was filed about, and the warning exists so that "this step ignores the env" is something the file says out loud rather than something a reader has to notice. Emitted when the caller resolved no config at all (nothing can be predicted about a refusal) or when an allowlist exists; when a config *was* resolved and declares none, `TF058` is emitted instead, because a step that is going to be refused does not also need to be told it is unportable.', probes: [{ wrap: 'step', source: ['api GET https://api.example.com/orders'], says: '`--env` will not move it', needs: { envAllowHosts: { envName: 'local', hosts: ['api.example.com'] } } }, { wrap: 'step', source: ['open "https://example.com/checkout"'], says: 'absolute URL', needs: { envAllowHosts: { envName: 'local', hosts: ['example.com'] } } }] },
  { code: 'TF058', meaning: 'Checker (M125b1, `FU-18`, D246): an absolute URL in a suite whose resolved env declares no `allow hosts` — the run will refuse to send it. **This is the one place in the language where the *absence* of an allowlist means enforcement rather than the lack of it**, and that inversion is the rule: `allow hosts` is opt-in and unset means every host is permitted (`allowHosts.ts:30`), which is the right default for a suite written entirely against its env\'s base URL, because that base *is* the declaration of where it talks. An absolute URL is the one form that can reach a host `tflw.config` never mentions, so writing one opts the suite into declaring where it may reach. **A warning here and a refusal at run time, and the split is D147**: `allow hosts` is read from `tflw.config` and differs per env, so the checker is predicting what *this* run would do — a suite whose CI env declares an allowlist is correct, and an error would make it unrunnable with no override — while the runtime has resolved the config and is looking at the URL it is about to fetch, so it observes and may refuse outright. Requires the caller to distinguish "a config was resolved and declares none" from "no config was resolved": the first is this rule, the second is `TF057`.', probes: [{ wrap: 'step', source: ['api GET https://api.example.com/orders'], says: 'the run will refuse to send it', needs: { envAllowHosts: { envName: 'local', hosts: [] } } }] },
  { code: 'TF059', meaning: 'Checker (M125b1, `FU-18`, D266): a named api service and an absolute URL on the same step — `api billing GET https://other.example/x`. A service names the base URL to send to and an absolute URL already is one, so one of the two is dead text the author believes is doing something, and picking a winner silently is the failure class this whole row was filed about. **An error rather than a warning, and the contrast with the two codes above it is the clearest statement of D147 in the manifest**: both of `TF059`\'s operands are written in the file, so no config can make the combination meaningful and there is nothing to predict — exactly `M124`\'s line, one milestone later. The hint names both ways out without preferring one, since which of the two the author meant is genuinely not knowable from the step.', probes: [{ wrap: 'step', source: ['api billing GET https://other.example/x'], says: 'names a service and an absolute URL', needs: { services: ['billing'] } }] },
  { code: 'TF060', meaning: 'Checker (M128b, D291): `expect`/`check response has no … security violations` written against an env whose `api` base URL no `authorized target` declaration names. D21\'s declaration layer, made load-bearing in the milestone that introduces it — the alternative, ship the grammar and enforce it once something actually sends a probe, means shipping a safety control nothing exercises, which is the same criticism relocated. Matching is by **origin** (scheme + host + port), not by the pattern rules `allow hosts` uses: a declaration for `https://x.example.com` does not authorize `https://x.example.com:8443`, which is a different listener that may belong to a different team. **Loopback is not exempt**, deliberately — exempting it would exempt exactly the target this arc is tested against, shipping the requirement untested. Narrow in the same three ways `TF036` is: only the env\'s default `api` base, only a fully literal one, and skipped entirely when no config was resolved.', probes: [{ wrap: 'step', source: ['api GET /orders', 'expect response has no security violations'], says: 'needs an `authorized target` declaration', needs: { envAuthorizedTargets: { envName: 'local', targets: [], apiBaseUrl: 'https://localhost:8443/v1' } } }] },
  { code: 'TF061', meaning: 'Checker (M128b, D291): an `authorized target` that contains a wildcard, or that is not an absolute URL. **Why a wildcard is rejected here when `allow hosts` accepts one**: the two declarations look alike and mean opposite kinds of thing. `allow hosts` bounds where a suite may send ordinary traffic, and a bound expressed as a pattern is still a bound. This one is not a bound — it is an author affirming in writing that they are permitted to point a scanner at a named host, and nobody is authorized to scan `*.com`. A pattern records a claim whose scope its author could not have known when they wrote it. The non-absolute case is the same error one step earlier: `authorized target "staging.example.com"` reads like a declaration and authorizes nothing, because `TF060` compares origins and a bare hostname has none.', probes: [{ wrap: 'config', source: ['defaults', '  authorized target "https://*.example.com" reason "staging"'], says: 'cannot contain a wildcard' }, { wrap: 'config', source: ['defaults', '  authorized target "staging.example.com" reason "staging"'], says: 'must be an absolute URL with a scheme' }] },
  { code: 'TF062', meaning: 'Checker (M130b, D328): the `api` step an `authorization violations` assertion judges names its own `Authorization` or `Cookie` header. Not a style objection — the probe strips the observed identity headers and applies the probing principal\'s own, so a credential written onto the step belongs to *neither* the owner\'s `as <session>` nor any principal in the probe set, and the differential comparison is then between two identities the run cannot name. A finding from that is confidently wrong in either direction. **Closed in two halves, on purpose** (D328): here, for a step in the same body, which is the boundary `checker.ts` already draws for call resolution (`a frame whose registry is knowable: a test or hook body, never an action body`); and again at run time, where the engine compares the observed request\'s identity headers against what the owning sessions actually contributed — both values are known, so that half is a comparison, not a heuristic. An interpolated header *name* is skipped rather than guessed at, since this rule refuses a file. Out of reach either way, and named in the run\'s own blind-spot line: a credential in a query string, in a body, or in an app-specific header the language cannot recognise.', probes: [{ wrap: 'file', source: ['test "t" as shopper', '  api GET /orders/1', '    header "Authorization" is "Bearer x"', '  expect response has no authorization violations'], says: 'names its own `Authorization` header' }] },
  { code: 'TF063', meaning: 'Checker (M130b, D307/D329): an `authorization violations` assertion with no principal behind it. **Two doors, one rule and one repair — declare an identity.** (1) The assertion sits in a `test` that declares no `as <session>`, or in a `before file`/`after file` hook, which runs in its own scope isolated from every test (`ast.ts:57`) and can therefore never have an owner; a bare `before`/`after` hook runs once per test and shares its scope, so it is fine (there is no `before each` keyword — `each` belongs to `with each`). (2) `tflw.config` marks *every* declared `session` as `privileged`, so the probe set holds only the built-in `anonymous` — which tests authentication, not authorization. The oracle is differential: it re-issues the observed request under every declared principal but the owner\'s and compares what comes back, so with no owner, or no non-privileged principal, there is nothing to compare. Silent inside an `action` body, deliberately and symmetrically with `TF062`: calls bind late against the entry file\'s registry, so the executing test is a run-time fact, and the interpreter repeats the judgement with it in hand. That leaves a shared authorization check writable once and reusable, which is the language\'s only unit of reuse.', probes: [{ wrap: 'file', source: ['test "t"', '  api GET /orders/1', '  expect response has no authorization violations'], says: 'needs an owner' }, { wrap: 'file', source: ['before file', '  api GET /orders/1', '  expect response has no authorization violations'], says: 'needs an owner' }] },
  { code: 'TF064', meaning: 'Checker (M130b, D315): an `authorization violations` assertion inside `wait until api`. **The cost is not the wasted traffic, it is what a real finding turns into.** `wait until api` re-issues its request until its nested expects pass, so a genuine BOLA — the assertion failing — would be re-probed under every declared principal on every poll, and then reported as a *wait timeout* rather than as a critical finding: the loudest possible result the tier can produce, converted into the quietest. Its own code rather than `TF063`\'s because the repair is different (move the assertion to a plain `api` step after the block, rather than declare an identity), which is the same rule that split `TF003` and kept `TF047` whole. The sibling case — inside a workload-bearing `test` — is `TF033`, beside `browser steps aren\'t supported inside a workload-bearing test`, because that is the same rule about the same construct with the same fix.', probes: [{ wrap: 'file', source: ['test "t" as shopper', '  wait until api GET /orders/1', '    expect status equals 200', '    expect response has no authorization violations'], says: "can't be asserted inside `wait until api`" }] },
] as const;

/** The rows every consumer reads, with `example` filled in from `probes` — the derivation that
 *  makes the rendered cell unable to disagree with the source underneath it. */
export const DIAGNOSTICS: readonly DiagnosticEntry[] = DIAGNOSTIC_ROWS.map((row) => ({
  ...row,
  example: renderDiagnosticExample(row.probes),
}));

export const CLI_FLAGS: readonly CliFlagEntry[] = [
  { flag: '`--env <name>`', command: 'run', effect: 'selects a named `env` block from `tflw.config` instead of the `default` one — e.g. run the same suite against `staging`' },
  { flag: '`--tag <name>[,<name>...]`', command: 'run', effect: 'only runs tests carrying any of the listed `@name`s (comma-separated OR; combines with `--only` as AND)' },
  { flag: '`--only <name>`', command: 'run', effect: 'runs a single test by its exact declared name (composes with `--tag`\'s OR-list as AND)' },
  { flag: '`--parallel <n>`', command: 'run', effect: 'runs up to `n` *files* concurrently in this process (default: `tflw.config`\'s `workers` key) — distinct from `--workers` below, which scales one workload-bearing test\'s own load generation across processes, not files' },
  { flag: '`--workers <n>`', command: 'run', effect: 'forks `n` generator *processes* to produce one file\'s workload-bearing test(s)\' load (M50/D111) — each an equal striped share of the target population/rate, merged back into one report; a no-op warning on a file with no workload-bearing tests (D113); default 1, no forking' },
  { flag: '`--skip-workload`', command: 'run', effect: 'skips every workload-bearing test (any `test` containing a `ramp`/`hold`/`step`/`spike`/`run … iterations` line), regardless of which `parallel`/`sequential` batch it\'s in — for fast iteration on the functional tests alone (M53/D110, renamed from `--skip-load`)' },
  { flag: '`--seed <n>`', command: 'run', effect: 'fixes every `random`-family value for the run, so a failure is reproducible byte-for-byte' },
  { flag: '`--now <iso>`', command: 'run', effect: 'pins the run\'s notion of "now" to an exact instant (combine with `--seed` to reproduce a run\'s exact absolute generated values)' },
  { flag: '`--no-color`', command: 'run', effect: 'disables ANSI color in CLI output — useful for CI logs or piping to a file' },
  { flag: '`--verbose`', command: 'run', effect: 'additionally prints one line per step (pass or fail); buffered per-file under `--parallel > 1` so concurrent files never interleave (`--workers` is the unrelated load-generation axis and has no effect here)' },
  { flag: '`--forbid-insecure`', command: 'run', effect: 'CI policy gate — fails before any test runs if `insecure true` is active for the env actually running' },
  { flag: '`--evidence <level>`', command: 'run', effect: 'overrides `tflw.config`\'s `evidence` key (`full`/`headers-only`/`none`) for this run only' },
  { flag: '`--failed`', command: 'run', effect: 'replays only the previous run\'s failing tests (state in `report/.last-run.json`); falls back to the full suite with a note if nothing failed last time' },
  { flag: '`--bail`', command: 'run', effect: 'stops after the first failing test\'s final (post-retry) verdict; under `--parallel > 1`, in-flight files still finish (the file pool stops pulling new work, it does not abort a running file)' },
  { flag: '`--format ndjson`', command: 'run', effect: 'streams the event log as one JSON object per line to stdout (plus `report/events.ndjson`) instead of human text; always full detail regardless of `--verbose`' },
  { flag: '`--no-timestamps`', command: 'run', effect: 'omits the `HH:MM:SS.mmm` prefix every console line otherwise gets by default' },
  { flag: '`--log-file <path>`', command: 'run', effect: 'duplicates console output to a file, always plain text (ANSI stripped) regardless of stdout\'s own color state' },
  { flag: '`--browser <engine>`', command: 'run', effect: 'switches every browser step to one engine — chromium/firefox/webkit (default chromium)' },
  { flag: '`--headed`', command: 'run', effect: 'shows the browser window instead of running headless (local debugging only)' },
  { flag: '`--update-snapshots`', command: 'run', effect: 'writes/overwrites `matches snapshot` baselines instead of just comparing against them' },
  { flag: '`--log-output <dest>`', command: 'run', effect: 'overrides `tflw.config`\'s `log destination` key (`console`/`html`/`both`/`none`) for this run\'s bare `log "…"` calls only — a `log … to …` statement\'s own destination always wins' },
  { flag: '`--log-level <level>`', command: 'run', effect: 'overrides `tflw.config`\'s `log level` key (`debug`/`info`/`warn`/`error`) — the minimum level a `log` step must clear to be rendered in console output/`report.html` (never affects whether it\'s recorded in `results.json`/ndjson)' },
  { flag: '`--format json`', command: 'check', effect: 'prints one `{ file, diagnostics }` entry per file checked as JSON instead of text — for editor and CI integrations' },
  // M62 (doc truth): `check`\'s two shared flags, `init --load` and `install-browsers --browser`
  // were accepted by the parser and listed in `tflw --help`, but missing here — so the reference
  // page generated from this list simply didn\'t have them, and `reference/cli.md` carried a
  // hand-written sentence apologising for the gap. Found by the docs guard, which validates every
  // documented invocation against this list. The `--help` test now runs in both directions.
  { flag: '`--env <name>`', command: 'check', effect: 'selects a named `env` block from `tflw.config` instead of the `default` one — decides which env-scoped checks (service names, `insecure`) run' },
  { flag: '`--no-color`', command: 'check', effect: 'disables ANSI color in CLI output' },
  { flag: '`--load`', command: 'init', effect: 'also scaffolds a `load.tflw` — a workload-bearing `test` in the open (`rps`) model, runnable with plain `tflw run` (M29/D30)' },
  { flag: '`--browser <engine>`', command: 'install-browsers', effect: 'downloads chromium/firefox/webkit (default chromium) — runs the `playwright` CLI inside the optional peer dependency, resolved from the consuming project; refuses if that peer is absent rather than fetching one (M92b)' },
  { flag: '`--browser <engine>`', command: 'pick', effect: 'launches chromium/firefox/webkit (default chromium) instead of chromium' },
  { flag: '`--env <name>`', command: 'watch', effect: 'selects a named `env` block from `tflw.config` instead of the `default` one' },
  { flag: '`--seed <n>`', command: 'watch', effect: 'fixes the seed reused by every run for the whole watch session (else one is freshly minted at startup)' },
  { flag: '`--browser <engine>`', command: 'watch', effect: 'switches every browser step to one engine — chromium/firefox/webkit (default chromium)' },
  { flag: '`--no-color`', command: 'watch', effect: 'disables ANSI color in CLI output' },
  { flag: '`--env <name>`', command: 'migrate', effect: 'selects a named `env` block from `tflw.config` instead of the `default` one — deprecations are checker diagnostics, so this only affects which env-scoped checks run' },
  { flag: '`--no-color`', command: 'migrate', effect: 'disables ANSI color in CLI output' },
  { flag: '`--version`, `-v`', command: 'global', effect: 'print the installed version' },
  { flag: '`--help`, `-h`', command: 'global', effect: 'print usage' },
] as const;
