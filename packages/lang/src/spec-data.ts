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
  | 'network-request';

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

/** One row of SPEC §17's diagnostic codes table (decision 20.3, docs-site polish cluster 9) — the
 * single source of truth for what a `TF0xx` code *means* going forward. `packages/lang/src/
 * diagnostic.ts`'s `Codes` object stays the source of the code constants themselves (and every
 * per-occurrence `message`/`hint` stays call-site-specific, generated at each checker/parser call
 * site — this manifest is only the canonical, code-general explanation, not a replacement for
 * either). `meaning`/`example` are markdown-ready cell text. */
export interface DiagnosticEntry {
  readonly code: string;
  readonly meaning: string;
  readonly example: string;
}

export const DIAGNOSTICS: readonly DiagnosticEntry[] = [
  { code: 'TF001', meaning: 'Lexer: a character that cannot begin any token. Also carries the **numeric-notation** case (M98b, `A1-18`): `1e3`, `0xff`, `0b1010`, `0o17` and `1_000` are not tflw numbers, and each lexes as a number followed by a *name* — `1e3` reads as `1` then `e3`, a 1000× difference between what was written and what was read. Those five shapes now say so at the number, naming the decimal value to write instead, rather than surfacing downstream as ``unexpected `e3` at end of step`` with a help line pointing at the end of the line. Deliberately narrow: "a number directly followed by a name" is exactly how every **duration** lexes (`pause 30s`, `expect duration is less than 500ms`), so only the five unambiguous notations are diagnosed. `.5` is not covered — `dot` + `number` is legal in a path and in a field access, and the lexer has no parser context to tell them apart. Recovery is unchanged: the tokens are still number + name.', example: '`let y = $oops` → `unexpected character "$"`; `let n = 1e3` → `exponent notation is not supported — this reads as `1` followed by the name `e3``' },
  { code: 'TF002', meaning: 'Lexer: a string literal has no closing quote before end of line.', example: '`test "open string`' },
  { code: 'TF003', meaning: 'Lexer: indentation does not line up with any enclosing block. This is now the code\'s *only* meaning: until M98c (`A1-13`) it was also emitted for "tabs are not allowed in indentation", a different condition with a different fix, while this row documented only the alignment case — so SPEC §17, the docs-site Reference page and LSP hover, which are all generated from this row, described the wrong rule for half of the code\'s firings. The tab rule is `TF048`.', example: 'a block indented 3 spaces inside one indented 2, closing to neither level' },
  { code: 'TF010', meaning: 'Parser: a token appeared where the grammar didn\'t allow it (the catch-all "unexpected token" code — covers many distinct shapes: a missing path after `api GET`, a multi-word call missing its parens, a malformed table row cell count, etc.).', example: '`api GET` (no path) → `expected a path like `/orders`, found end of line`' },
  { code: 'TF011', meaning: 'Parser: an unrecognised statement keyword where a step was expected, or a *retired* one — a keyword the parser still recognises solely so it can name its replacement outright (FS-04\'s `uncheck` → `untick`, D103 style). A retired spelling is kept out of both the did-you-mean vocabulary and the "expected one of" fallback: offering it back as valid would be worse than no suggestion.', example: '`expct status equals 200` → `did you mean `expect`?`; `uncheck field "Terms"` → `` `uncheck` was renamed to `untick` ``' },
  { code: 'TF012', meaning: 'Parser: an unknown HTTP method after `api`.', example: '`api FETCH /health` → `did you mean `PATCH`?`' },
  { code: 'TF013', meaning: 'Parser: an unrecognised `expect`/`capture` subject.', example: '`expect statuss equals 200` → `did you mean `status`?`' },
  // A3-OS-06: the old example was a mashup of the two mutually-exclusive hint branches ("did you
  // mean" *and* an option list) and showed output the tool does not produce — `eq` is two characters
  // from nothing, so it gets the fallback line, not a suggestion. This one is copied from a real
  // run, and names the branch it is showing.
  { code: 'TF014', meaning: 'Parser: an unrecognised matcher after a subject, or none at all — including the one shape that used to be legal, a bare `check <locator>` (FS-04): it ticked a checkbox, so a forgotten matcher silently turned a soft assertion into a mutation that then passed. That case names both readings rather than guessing which was meant.', example: '`expect text "x" is vissible` → `did you mean `visible`?`; a word with no near match gets the full vocabulary instead; `check field "Terms"` → ``check <locator>` needs a matcher` with `tick`/`is checked` both offered' },
  { code: 'TF015', meaning: 'Parser: a `test`/`action`/hook block has no indented body.', example: 'a `before file` block with no steps under it' },
  { code: 'TF016', meaning: 'Parser: top-level content that isn\'t a `test`/`action`/`import`/`use`/`before`/`after`.', example: 'a bare `expect …` line outside any block' },
  { code: 'TF020', meaning: 'Parser (config): an unrecognised key inside a config block.', example: '`headr "Accept" is "…"` → `did you mean `header`?`' },
  { code: 'TF021', meaning: 'Parser (config): a `test` appears in the declaration-only config dialect.', example: '`test "not allowed here"` inside `tflw.config`' },
  { code: 'TF022', meaning: `Parser (config): top-level config content that isn't one of ${listConfigDirectives()} (M110, \`V4-04\` — this list is \`CONFIG_DIRECTIVES\` above, the same array the parser's own message is built from, so the two cannot drift again).`, example: '`workers 3` at the top level of `tflw.config` (belongs inside a block)' },
  { code: 'TF023', meaning: 'Parser: a duration whose unit is missing, mis-spelled, mis-cased, or spaced off its number. M98c (`A1-07`) made it reachable from **value** position — `expect duration is less than 250 ms` and `2sec` used to fall out of the step as ``TF010: unexpected `ms` at end of step`` / `= help: expected end of line`, because `250ms` and `250 ms` lex identically and the value path simply declined to build a duration when its adjacency or unit check failed. The three cases are kept apart because their fixes differ: a real unit written with a space, shown the closed-up spelling, a word that means a unit tflw spells differently (`sec` → `s`, `MS` → `ms`), and a word that was never a unit, which keeps the generic error. The known-spelling table is enumerated, not inferred, so `1e3` and `0xff` stay `TF001`\'s numeric-notation case rather than acquiring a second, wrong explanation.', example: '`timeout step 5x` → `unknown time unit `5x``; `expect duration is less than 2sec` → ``tflw\'s time units are `ms`, `s` and `m` — write `2s```' },
  { code: 'TF024', meaning: 'Checker (config): more than one `env` marked `default`, or a duplicate env name.', example: 'two `env … default` blocks in one `tflw.config`' },
  { code: 'TF025', meaning: 'Checker (config): a key used in the wrong block.', example: '`web "…"` inside `defaults` (belongs in an `env` block)' },
  { code: 'TF026', meaning: 'Checker: an `api <service>`/`wait until api <service>` name not declared in the active env — checked in test/action/hook bodies **and** inside `session` blocks (decision 66).', example: '`api billng POST /auth/login` → `did you mean `billing`?`' },
  { code: 'TF027', meaning: 'Checker: a `{col}` reference **in a test\'s name** that is not among its inline `with each` table\'s declared columns. Deliberately the name and nothing else (M110, `V4-05`): a bad `{col}` in the test *body* is indistinguishable from any other unbound variable at check time and is already `TF030`, which says the same thing with the same "did you mean" — a second code for it would split one mistake across two. **File-backed** tables (`with each from "…"`) are skipped entirely: their columns are not known until the file is read at run time, and `lang` does no I/O (`TF043` covers the file itself going missing).', example: '`test "checkout {prcie}"` over a table whose only column is `price` → ``unknown table column "prcie" referenced in the test name`` / `= help: did you mean `price`?`. The same typo in the body — `api GET /p/{prcie}` — is `TF030`, not this' },
  { code: 'TF028', meaning: 'Checker: a `test … as <session>[, <session>...]` name not declared by any `session` block — one diagnostic per unknown name.', example: '`test "…" as ghost` with no `session ghost` declared' },
  { code: 'TF029', meaning: 'Checker (config): a duplicate `session` name.', example: 'two `session admin` blocks in one `tflw.config`' },
  { code: 'TF030', meaning: 'Checker: a `{var}`/bare-identifier reference provably never bound anywhere reachable in its scope — conservative (decision 57): only flags a name that\'s *definitely* unreachable, never one that merely might be.', example: '`capture body.ok as orderId` then `api GET /orders/{orderid}` → `unknown variable "orderid"`, did-you-mean `orderId`' },
  { code: 'TF031', meaning: 'Checker: a `request` assertion (`connects`/`fails`) combined with a response-based assertion (`status`/`header`/`body`/`duration`) on the same request, or used at all inside `wait until api` (decision 18).', example: '`expect request connects` followed by `expect status equals 200` on the same `api` step → `can\'t be combined with `request connects`/`fails` on the same request`' },
  { code: 'TF032', meaning: 'Checker: an `upload … type "…"` value that is a non-interpolated literal not shaped like `type/subtype` (decision 22/M19) — a light regex, not an IANA vocabulary check, so it only catches an obvious typo before the run.', example: '`upload "./f.png" as "avatar" type "imagepng"` → `invalid content type "imagepng", expected a "type/subtype" shape like "image/png"`' },
  { code: 'TF033', meaning: 'Parser/checker (load, M29/M30, M50/D93-D96): a workload-bearing `test`\'s workload/threshold shape is invalid, two such tests in one file share a name (M30, D29 — names key each one\'s own metrics/threshold breakdown under concurrent multi-load-test runs), a `retry`/`with each` clause coexists with a workload (D96), a browser step appears inside a workload-bearing body (D19 — API-only in v1), `pause` appears outside one (D18), a workload-bearing `test` carries no `threshold` at all (M60/A4-01 — its verdict comes only from thresholds, so with none it can never fail), a workload-bearing `test` thresholds `duration` without pairing it with an **unscoped** `error rate` threshold (M89c/B3-14 — a duration threshold reads only the iterations that succeeded, so alone it is satisfied by a target that fails half its requests fast, and a *scoped* error-rate threshold bounds one endpoint while the rest of the scenario fails freely), or a removed keyword is found — `scenario` (D103 — write `test "…" { ramp to … }` instead) or `think` (FS-05 — renamed to `pause`). The `pause`/browser-step bans follow calls into `action`s (M60/A4-02) and report at the call site, since the same action is legal under a workload and illegal outside one. The `pause` hint names both ways out honestly (FS-05): a *condition* is `wait until …` / `wait until … for <dur>`, while genuinely elapsed time — a cache TTL, a token expiry — has no condition to poll and belongs in the JS escape hatch (§11).', example: '`pause 2s` inside a plain `test` → `\`pause\` is only legal inside a workload-bearing \`test\`` — or `think 2s` → `` `think` was renamed to `pause` ``' },
  { code: 'TF034', meaning: 'Checker (load, M43/D70): a `threshold … for "label"` clause references a label that matches no `api` step\'s identity (its explicit `as "label"` tag, or its automatic `METHOD path.raw` identity when untagged) within the same workload-bearing test.', example: '`threshold p95 duration for "checkotu" is less than 250ms` with only an `as "checkout"`-tagged step in scope → `threshold for "checkotu" matches no step in this test`' },
  { code: 'TF035', meaning: 'Checker (M60/`A2-01`; widened M97b/`B5-02`): a name is declared as an `action` more than once in the namespace a file actually runs in. Two `action`s in one file is the original case — actions are file-scoped, so the second shadows nothing, it is simply ambiguous. As of M97b the same code also covers a name declared locally *and* brought in by an `import`, and a name two `import`s both provide: the runtime (`buildRegistry`) has always refused all three, and `TF035` used to see only the first — so the manifest, the checker and its test agreed with each other while missing what the runtime enforced. The imported halves are reported only when the imports were actually read (the same `undefined`-vs-`[]` rule `TF037` turns on): a name cannot be called a duplicate of something nobody looked at.', example: '`action fetch it()` declared twice → `duplicate action "fetch it"` with `already declared at line 3`; the same name also arriving via `import "./shared/orders.tflw"` → `duplicate action "fetch it" (imported from "./shared/orders.tflw")`' },
  { code: 'TF036', meaning: 'Checker (M85/A4-10): the **active** env\'s own `api`/`api <service>`/`web` base URL has a host that its own `allow hosts` list (accumulated across `defaults` + the env, SPEC §3.7) does not match — a statically decidable contradiction that costs a whole run to discover otherwise, one identical runtime refusal per step for one config line. Env-scoped like every other config check (`checkSessionServices`, `knownServices`): a contradiction in an env you have not selected is not this run\'s problem, and a suite may legitimately keep a deliberately-blocked env as a negative-case fixture. The hint names the consequence *that key* has — only the default `api` base takes the whole suite down; a named service takes its own calls, `web` takes the browser half. Only fully literal URLs are checked: a base URL containing `{…}` names a host this pass cannot decide, and is skipped rather than guessed at (note that `resolveConfig` takes such a URL literally today — the recorded `A2-12` gap — so skipping it neither hides a live behaviour nor pre-commits this check if config interpolation ever lands).', example: '`api "http://127.0.0.1:9099"` alongside `allow hosts "example.com"` → ``env `local`\'s `api` base URL is "http://127.0.0.1:9099", whose host "127.0.0.1" is not in its own `allow hosts` (example.com)``' },
  { code: 'TF037', meaning: 'Checker (M87/A4-03, `FU-08`): a call names neither an `action` nor a JS helper, so the run dies at that step with `unknown call`. Being a *negative* claim it is made only where it is sound, which is narrower than it first looks. **The world must be closed**: every `import` resolved, and no `use` at all — a JS helper module\'s exports cannot be enumerated without importing it, and the checker never executes the code it checks (P#2), so one `use` line makes this undecidable for that file. **And the frame\'s registry must be knowable**: a `test` or hook body, never an `action` body. Calls bind late, against the *entry* file\'s registry, so a shared action may legitimately call a name only its importer defines; a `test` is safe because an imported file\'s tests never run (`buildRegistry` takes only its `actions`). `TF038` is unaffected by either condition — it only ever fires on a name that already resolved.', example: '`creat order("Widget")` beside `action create order(name)` → ``unknown call `creat order(...)` — no `action` or JS helper (`use`) defines it`` with `did you mean `create order`?`' },
  { code: 'TF038', meaning: 'Checker (M87/A4-03): a call resolves to a known `action` but passes the wrong number of arguments. Sound regardless of `use`, unlike `TF037` — the runtime resolves actions before helpers (`execCall`), and an action name is unique across the whole registry (`TF035` and `buildRegistry` both refuse a duplicate), so a name that matches a declared action is that action and nothing else.', example: '`create order("Widget", "extra")` against `action create order(name)` → `action "create order" expects 1 argument, got 2`' },
  { code: 'TF039', meaning: 'Checker (M87/A4-16, `FU-12`): an `expect`/`check` on a response-backed subject (`status`/`duration`/`header`/`body …`/`request`), or any `capture`, appears before the first `api`/`wait until api` step **in its own response scope**. The scope is exactly one `execSteps` frame in the interpreter, which is narrower than it looks: a `test`/`action`/hook body is one, and so is each nested `within` / `switch to new tab` / `download` body. An `action` gets its own — calling one never publishes its response to the caller (that is `FU-12`) — and a `before` hook\'s response is likewise invisible to the test body. UI subjects (a locator, `page`) and `request to "…"` network observations are excluded: the interpreter routes those away from the response path entirely, so they never needed one. A `{variable}` subject (M96) is excluded for the same reason — it reads a `let`/`capture` binding, and an *unbound* one is already `TF030`.', example: '`expect status equals 200` as a test\'s first step → ``no response yet — an `api` step must run before this assertion``' },
  { code: 'TF040', meaning: 'Checker (M87, found while fixing `A4-03`): a call is written somewhere its value is never computed. The interpreter evaluates a `CallExpr` in exactly two places — a bare call step, and the *whole* right-hand side of a `let` — because running one is asynchronous and `evalValue` (which computes every other value) is synchronous by design. A call anywhere else parses, checks, and then silently yields nothing: `body { id: create thing() }` drops the field and sends `{}`, `[create thing()]` sends `[null]`, and `give create thing()` returns nothing — each at a green `✓`, testing a request nobody wrote. Reported alone for such a call: `TF037`/`TF038` are suppressed there, since the position is the thing to fix first.', example: '`api POST /orders body { id: create thing() }` → ``a call in this position is never evaluated`` with `` bind it first — `let id = create thing()` — then use `{id}` here ``' },
  { code: 'TF041', meaning: 'Checker (M96, `FU-11`): a `{variable}` subject stands somewhere a value cannot. Two cases. **A live-handle matcher** — `is visible`/`hidden`/`enabled`/`disabled`/`checked`, `has value`, `matches snapshot`, `has no … a11y violations`, `connects`/`fails`, `was made` — needs a browser element, a page, a connection attempt or an observed request; a bound value has no such state to observe, whatever its type. The *type*-constrained matchers (`equals`, `contains`, `matches "<regex>"`/`subset`/`schema`/`file`, `is greater/less than`, `has count`) are deliberately **not** checked here: a mismatch there is a runtime error for `body.<path>` today, and a captured value must not be stricter than the response it came from. **Inside `wait until api`** — that block re-issues its request and re-evaluates its expects each poll, and a value subject cannot change between polls, so the assertion either passes on the first attempt or times out blaming an endpoint that never controlled it. Distinct from `TF014` (an *unrecognised* matcher): `is visible` is recognised, just misplaced.', example: '`expect {orderId} is visible` → ``is visible` needs a live browser element, page, or request — not a value`' },
  { code: 'TF042', meaning: 'Checker (M97b, `A4-11`/`A4-15`): a matcher used where its subject cannot be read, or an `any`/`all` quantifier on a matcher that cannot be applied element by element. The rule is over the subject\'s **kind** — a value, a UI locator, `page`, `request`, `request to "…"` — and is read straight off SPEC \u00a76.2\'s own table, so the checker and the reference are one statement. **Shape is deliberately not checked**: `contains` documents "strings, arrays", but whether `body.msg` is either is not knowable until the response arrives, so that stays a runtime error. The quantifier half covers the two matchers that fetch an external document (`matches schema`, `matches file`); `matches file` in particular used to fail with a message about UI matchers, and under `any` was swallowed into "none of N elements matched". Distinct from `TF041`, which is this same rule for a `{variable}` subject and says so in that case\'s own words. Was a documented gap in \u00a71 until M97b closed it.', example: '`expect status is visible` \u2192 ``is visible/hidden/enabled/disabled/checked` can\'t be used on a value`; `expect any body.items matches schema "W" from "/o.json"` \u2192 ``any` can\'t be combined with `matches schema "Name" from "src"``' },
  { code: 'TF043', meaning: 'Checker (M97c, `A4-07`): a path literal names a file that is not there. Covers every syntax that opens one — `import`, `use`, `with each from`, `body from`, `upload`, `matches file`, `drop file` — resolved exactly as the runtime resolves it, against the directory of the file that names it. **Only statically-known paths**: `upload "./fixtures/{name}.png"` names no file until the run picks a `name`, so it is skipped rather than guessed at. **Two severities (M97e, D147).** `import`/`use` are an **error**: `tflw check` opens them itself, so a missing one degrades the check that is running. The other five are a **warning** — the checker only `stat`s them on behalf of a step that has not run yet, and an earlier step, a hook, a `use`d JS action or a fixture build between `check` and `run` may create the file first. As an error that was a D137 clause 1 violation: `matches file "./x.bin"`, where an earlier step writes `x.bin`, is a valid suite that ran for eleven milestones and that M97c made unrunnable with no override. SPEC §4.3 has claimed this check since M2.5 and it did not exist; the row concluded the checker "could not" do it because it does no I/O, which mistook a `@tflw/lang` package invariant for a `tflw check` command one — the CLI has read imported files at check time since M87. The cost of not having it was the whole console output of a failed run being `✗ t.tflw (crashed) (0 ms)`, `--verbose` included. **`cert`/`key` in `tflw.config` are not covered** (config dialect, filed separately), and neither is CSV *column* existence, which needs the file\'s contents rather than a `stat`.', example: '`import "./nowhere.tflw"` → ``\\`import\\` names a file that does not exist: "./nowhere.tflw"``' },
  { code: 'TF044', meaning: 'Checker (M97d, `A4-13`): an `action` that can reach itself, directly (`a → a`) or through others (`a → b → a`). Sound to reject because **tflw has no conditionals** — no `IfStmt`, no branching keyword — so a cycle is not *potentially* infinite but unconditionally so, and the only way such a run can end is by failing. **Not gated on a closed world**: a same-file name can never be shadowed (`buildRegistry` throws on a duplicate and `TF035` reports it), so the check still applies to a suite that `use`s a JS helper. **Across `import`s too (M109, `M97d-01`)**: the graph is the one a run would build — this file\'s actions, then each import\'s, first declaration winning as `buildRegistry` has it — which is decidable precisely because calls bind late against the entry file\'s registry. Two limits, both by construction: with the imports unread (`importedActions` `undefined`) only local edges are seen, and a cycle whose every call site sits inside imported files is left to that file\'s own check, there being no span here to underline. The runtime guard stays the backstop for both, naming the same path in the same arrow notation; it used to be a raw V8 `RangeError` plus a 14,505-character single-line error. Only *evaluated* calls are edges: `let x = f() + "y"` never runs `f`. One diagnostic per cycle, not one per member.', example: '`action a()` calling `b()`, `action b()` calling `a()` → `this call completes a cycle: `a → b → a``' },
  { code: 'TF045', meaning: 'Lexer (M98b, `A1-10`/`A1-20`): bracket accounting does not balance — a `{`/`[` that is never closed, or a `}`/`]` that closes nothing. Both directions carry this one code because they are the same fact seen from either side. The unclosed case is reported **at the opening bracket**, and only for the innermost one: while a bracket is open the lexer emits no `newline`/`indent`/`dedent` at all, so a single stray `{` absorbs every following line into the same logical line, and the outer entries are consequences of the same typo rather than separate mistakes. Before this the lexer tracked only a *count*, which is enough to decide continuation and leaves nothing to point at, so the failure surfaced as `TF010: expected a field name, found a dedent` — carets on a synthesized dedent at line 3 of a 2-line file, underlining nothing.', example: '`api POST /o body {` with no `}` → ``this `{` is never closed``; a stray `}` → ``` `}` closes a bracket that was never opened```' },
  { code: 'TF046', meaning: 'Lexer (M98b, `A1-11`): a tag with no usable name — a bare `@`, `@ smoke` with a stray space, or `@123` starting with a digit. The tag token used to be pushed unconditionally, so `@` alone became `tag:""` and `tflw check` reported no problems at all. The cost is specific: a tag that is not a writable identifier can never appear in a `--tag` expression, so the test carrying it can be neither selected nor excluded — the failure class where a filter appears to work and silently runs the wrong set. `@ smoke` gets its own help line, because by the time the parser sees it the `@` is gone and the error reads ``expected `test`, found `smoke```.', example: '`@ smoke` → ``a tag needs a name after the `@``` / `= help: delete the space`' },
  { code: 'TF047', meaning: 'Lexer (M98b, `A1-05`): a string escape outside the supported set (`\\"`, `\\\\`, `\\n`, `\\r`, `\\t`). `"^\\d+$"` used to decode to `^d+$` — the backslash silently dropped — and the run then matched against a pattern nobody wrote, printing the written form in the step echo and the mangled form in the reason line without connecting them. **An error rather than a preserved backslash**, and this is the permanent choice: preserving it is what a regex author wants, but under that rule the meaning of `"\\q"` depends on membership in a five-entry table, so every escape added to the table later would silently change the value of existing suites. A rejected program becoming legal is additive; the reverse is not, which is the only direction a frozen surface can move. Matches JS, Java and non-raw Python. In a regular expression, write the backslash twice. **M98d (D166) adds `\\u{XXXX}` to the set, and every way of getting it wrong to this code**: no braces (`\\u0041` — what a JS or Java author\'s fingers produce), no code point (`\\u{}`), unclosed, above `\\u{10FFFF}`, or naming a surrogate half. That is one code widened rather than a second one added, and the test is the *fix*, not the number of conditions: all of these are corrected by spelling the escape the way tflw spells it, whereas `TF003`\'s two conditions (M98c) were split precisely because re-indenting a block and changing an editor setting are unrelated repairs. The braced form is the only one, because it is the only one that can write a character above U+FFFF as a single escape rather than as a surrogate pair.', example: '`expect body.id matches "^\\d+$"` → ``unknown escape `\\d` in a string`` / `= help: … write it twice: `matches "^\\\\d+$"``' },
  { code: 'TF048', meaning: 'Lexer (M98c, `A1-12`/`A1-13`): a line is indented with tabs. Split out of `TF003`, which was carrying this and "indentation does not line up with any enclosing block" under one code while documenting only the second — and this row is what SPEC §17, the docs-site Reference page and LSP hover are generated from, so one code meaning two things made all four surfaces wrong at once. Reported **once per file**, at the first offending line, with the number of remaining lines in the help: the rule fired once per line before, so one wrong editor setting produced 100 identical errors on a 100-line file, none of which is a separate mistake and all of which have the same one-setting fix. The rule itself is unchanged, and is now written down in `GRAMMAR.md` § Lexical, where it had never appeared.', example: 'a file indented with tabs → ``tabs are not allowed in indentation; use spaces`` / `= help: set your editor to insert spaces … 99 more lines in this file are indented with tabs`' },
  { code: 'TF049', meaning: 'Lexer (M98d, `A1-17`): a Trojan Source character — a bidi control (`U+202A`–`U+202E`, `U+2066`–`U+2069`), a zero-width character (`U+200B`–`U+200D`), or a `U+FEFF` anywhere but the very start of the file. What these share is that they make the source as *rendered* and the source as *parsed* two different texts: a bidi override inside a comment can display as an assertion that is not the one being run, and a zero-width space inside a compared string renders identically to the string without it. **An error, not a warning** (D165): for a general-purpose language a lint is the norm, but here `tflw check` is the gate, exit 0 is the signal, and a warning changes neither — while a reviewer reading a `.tflw` in a pull request has the rendered text as their only evidence of what it asserts. CVE-2021-42574; Rust, Go and the major C++ compilers all added a rule after it. Reported **only from the paths that consume a character without lexing it** — indentation, whitespace between tokens, a comment, the inside of a string — because everywhere else these characters cannot start a token and so already reach the author as `TF001`, and reporting both would be one mistake twice. `U+FEFF` is the case that could not be left to `TF001`: it is deliberately skipped as whitespace (M59, `A1-04`), so away from offset 0 it can sit inside what reads as a single name and split it into two tokens in silence. Every rejection here has a legal alternative — `\\u{…}`, added by the same milestone (D166) — because a rule with no way to comply is a capability removed, not a lint.', example: 'a comment containing `U+202E` → ``hidden character U+202E RIGHT-TO-LEFT OVERRIDE in a comment`` / `= help: … write it inside a string as `\\u{202E}``' },
  { code: 'TF050', meaning: 'Lexer (M103, `M98d-02`): the other half of the Trojan Source class — a word **inside a string** that mixes Latin with a script that has Latin lookalikes (Cyrillic, Greek, Cherokee, Armenian). Where `TF049` covers characters with no glyph, these have a glyph and it is somebody else\'s: `"аdmin"` with a Cyrillic `а` renders exactly like `"admin"` and compares unequal to it. **The severity comes from the negative matchers.** In `is`/`equals` a confusable makes the test *fail*, which is loud and self-correcting; in `not equals`/`not contains` — the shape a leak-prevention assertion takes — it makes the test **pass without asserting anything**, with no evidence on screen, in a diff, or in `tflw check`. The unit is one **word**, not one string (D178): a `.tflw` string is prose and prose is legitimately multilingual, so `"Willkommen — добро пожаловать"` is two scripts with no mixed word and stays legal, where a per-string rule would reject it. Only lookalike scripts count (D179): `"東京Tower"` mixes Latin and Han in one word and deceives nobody, because Han has no Latin homoglyphs. Common and Inherited never count — that is where `—`, `§`, `…`, `→` and `×` live. **Strings only** (D180), unlike `TF049`: a comment has no `\\u{…}` to escape into, and a rule with no way to comply is a capability removed rather than a lint. **Not covered:** a word written *entirely* in one non-Latin script that still reads as Latin (`"аԁmіn"` in all Cyrillic) — that needs the UTS #39 confusables table and is indistinguishable by shape from legitimate Russian data. The escape hatch is `\\u{…}`, and it works because the scan reads raw source.', example: '`expect body.status not equals "оk"` → ``the word `оk` mixes Latin with Cyrillic — U+043E`` / `= help: … write it as `\\u{043E}``' },
] as const;

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
