# testFlow grammar

The formal grammar `packages/lang`'s lexer/parser/checker implement — **current through M78**: the
API dialect, the browser dialect through M3e (`PLAN_BROWSER_PERF_SECURITY.md` §1.12 — M3d's network
observation (`request to "…"`/`of request to "…"`) and `stub`, plus M3e's `page` a11y subject), the
load-testing/workload dialect (M29–M53), and the grammar-freeze changes of milestone B1
(`FS-04` … `FS-08`). This is a strict subset of the
full language design in [SPEC.md](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md); SPEC.md is the prose reference with rationale
and examples, this file is the grammar shape only. Cross-references to SPEC decisions are `(P#n)`;
cross-references to a SPEC section are `(§n)`.

**Freshening note (PLAN decision 103, enterprise arc cluster 4, decision 16.11):** this file was a
frozen M0-only snapshot from 2026-07-06 through M11 — every milestone after M0 updated SPEC.md but
not this file. That rewrite caught it up through decision 102, and the rule is that every milestone
changing the grammar updates this file alongside SPEC.md — the same discipline `spec-data.ts`'s
generated tables (§6.2, §7.3.1) enforce for the constructs they cover.

**The load-testing catch-up landed (M78).** For seven milestones the rule above was not kept: the
whole workload grammar (M29–M53) shipped without a production here, and this file said so only by
being silent about it. Those productions now exist — see the **Load testing** section below — and
`grammarCoverage.test.ts` now asserts that every keyword the parser recognizes appears somewhere in
this file, so the next construct that ships without a production fails CI instead of drifting for
seven milestones. Writing the productions also surfaced three gaps nobody had filed: `redact header`/
`redact query` (FS-03, M64), the `log destination`/`log level` config keys (M27), and
`matches snapshot … mask` (M4b).

Notation: `UPPER` = terminal token class, `'x'` = literal keyword/punct, `?` optional, `*` zero+,
`+` one+, `|` alternation, `(...)` grouping. Blocks are **indentation-delimited** (offside rule) —
`INDENT`/`DEDENT`/`NEWLINE` are synthetic tokens from the lexer. 🔮 marks a production that parses
but has no callable subject yet (e.g. `has value`/`is StateWord` outside a UI context).

## Lexical

```
NEWLINE     logical end-of-line (collapses blank + comment-only lines)
INDENT      indentation increased vs. the enclosing block
DEDENT      indentation decreased (one per level closed)
STRING      "…"  with \" \\ \n \r \t escapes; may contain {interpolation}
                 any other escape is an error (TF047, M98b) — write \\ for a literal backslash
NUMBER      digits, optional fraction: 200, 12.5
IDENT       [A-Za-z_][A-Za-z0-9_]*        (also the keyword lexeme before classification)
PATH        a run beginning with '/' over [A-Za-z0-9_\-./{}?=&:%~], ends at whitespace
TAG         '@' IDENT
```

- Comments: `#` to end of line. Blank and comment-only lines never emit `INDENT`/`DEDENT`.
- While a `{`/`[` is open (bracket depth > 0), a physical line is a *continuation*: no
  `INDENT`/`DEDENT`/`NEWLINE` for it, regardless of its own leading whitespace — this is what lets
  an object/array literal (`body { … }`) span several hand-indented lines.
- Keywords are `IDENT` lexemes recognised by the parser in position (soft keywords, not reserved
  words) — see each production below for the keyword set it recognises. **A leading keyword never
  reserves that word for user-defined action names; disambiguation is always by what follows**
  (FS-06, §8) — `run 200 iterations across 10 users` is a workload clause and `run checkout("1")` is
  a call to `action run checkout(id)`, told apart by the scan to `(`, so a keyword added in a later
  release can never make an existing action name uncallable.
- `/` starts a `PATH` token only when the immediately preceding token is an HTTP method word
  (`GET`/`POST`/`PUT`/`DELETE`/`PATCH`, case-insensitive) sitting in HTTP-method grammatical
  position; everywhere else `/` is the arithmetic divide operator. A variable literally named
  `get`/`post`/`put`/`delete`/`patch` still divides fine (`let ratio = get / 2`) since the check is
  positional, not lexical (P#60).
- The lexer has no hyphen in identifiers — a few config values that read naturally with one
  (`evidence "headers-only"`, `retry honoring "Retry-After"`) are string literals instead of bare
  words, validated against a fixed vocabulary by the parser/checker rather than the lexer.

## Program structure

```
Program     := (NEWLINE | ImportDecl | UseDecl | ActionDecl | HookDecl | TestDecl)*

ImportDecl  := 'import' STRING NEWLINE                     # a sibling .tflw file's actions (§8)
UseDecl     := 'use' STRING NEWLINE                         # a .ts/.js JS-escape-hatch module (§11)
HookDecl    := ('before' | 'after') 'file'? NEWLINE Block   # no `file` = per-test hook;
                                                             # `file` = once-per-file hook (§4.2)
ActionDecl  := 'action' CallName '(' (IDENT (',' IDENT)*)? ')' NEWLINE Block   # (§8)
```

## Tests & structure (§4)

```
TestDecl    := TAG* DataTable? 'test' STRING TestModifier* NEWLINE Block
TestModifier := 'as' IDENT (',' IDENT)*      # sessions this test opts into (§3.3)
              | 'retry' NUMBER               # §4.4
              | 'parallel' | 'sequential'    # D105-D107, §4.5
              # Order-independent, each at most once (A2-06). `test "x" retry 2 as admin` and
              # `test "x" as admin retry 2` are the same test. A repeat is an error rather than
              # last-one-wins — list several sessions in one `as` clause, comma-separated.

DataTable   := 'with' 'each' ('from' STRING)? NEWLINE
               ( '|' IDENT ('|' IDENT)* '|' NEWLINE          # inline: header row
                 ('|' Cell ('|' Cell)* '|' NEWLINE)+ )?      # inline: one or more data rows
               # `from STRING` (a .csv/.json path) replaces the inline table entirely — mutually
               # exclusive with the `| col |` rows.

Block       := INDENT Step+ DEDENT
Step        := ApiStep | WaitUntilApiStep | ExpectStmt | CheckStmt | LetStmt | CaptureStmt
             | GiveStmt | HeaderStmt | LogStmt | PauseStmt | UiStep   # UiStep: see §9, below

# A `test`'s block additionally admits the workload clauses, in any order among the steps:
TestBlock   := INDENT (Step | Workload | ThresholdDecl | CleanupDecl)+ DEDENT
CleanupDecl := 'cleanup' NEWLINE          # D26 — opts a workload-bearing test back into running
                                          # the file's per-test `after` hook on *every* iteration
                                          # (skipped by default: teardown thousands of times would
                                          # double request volume and pollute the latency numbers)
```

- `TAG*` may sit on its own line(s) above `test` (and above its `with each` table, if present).
- `as admin, userA` — independent, unrelated sessions a test opts into together (§3.3).
- `retry N` re-runs the whole test up to `N` more times on failure (§4.4) — distinct from the
  per-step `retry honoring "Retry-After" up to N` clause (§5.1, below).
- `before`/`after` (no `file` keyword) run once per test, sharing its scope; `before file`/
  `after file` run once per file instead. There is no `before each`/`after each` — `each` is
  exclusively the `with each` keyword above.

## Load testing — workload-bearing tests (§4.5)

There is no `load`/`scenario` keyword: a `test` **becomes** workload-bearing the moment its block
contains a `Workload` line (M50/D93–D96 collapsed `scenario` into `test`; `scenario` is now a hard
`TF033` naming its replacement). At most one `Workload` per test.

```
Workload    := RampWorkload | HoldWorkload | StepWorkload | SpikeWorkload | IterationsWorkload

RampWorkload := 'ramp' 'to' NUMBER Unit 'over' Duration NEWLINE     # linear ramp to a target
HoldWorkload := 'hold' NUMBER Unit 'for' Duration NEWLINE           # constant target, no ramp (D97)
Unit         := 'users' | 'rps'                                     # closed-model VUs | open-model rate

StepWorkload  := 'step' Unit NEWLINE INDENT StepStage+ DEDENT       # D97/D98
StepStage     := 'to' NUMBER 'for' Duration NEWLINE                 # instant jump, then hold

SpikeWorkload := 'spike' Unit NEWLINE INDENT SpikeStage+ DEDENT     # D97/D98
SpikeStage    := 'hold' NUMBER 'for' Duration NEWLINE               # flat
               | 'to' NUMBER 'over' Duration NEWLINE                # ramped

IterationsWorkload := 'run' NUMBER 'iterations' ('per' 'user')? 'across' NUMBER 'users' NEWLINE
                      # count-bounded, no duration at all (D102). Bare = one shared pool of NUMBER
                      # iterations; `per user` = each VU runs its own NUMBER.

ThresholdDecl := 'threshold' ThresholdMetric ('for' STRING)? 'is' ThresholdOp ThresholdValue NEWLINE
ThresholdMetric := PERCENTILE 'duration'      # PERCENTILE is an ident matching /^p([1-9][0-9]?)$/
                 | 'error' 'rate'             #   — p50/p90/p95/p99 are the documented ones
ThresholdOp     := 'less' 'than' | 'greater' 'than'
ThresholdValue  := Duration                   # for a `duration` metric
                 | NUMBER '%'                 # for `error rate`
                 # `for "label"` scopes the threshold to one `api` step's identity — its `as "label"`
                 # tag, or its automatic `METHOD path.raw` identity when untagged (M43/D70).

PauseStmt   := 'pause' Duration ('to' Duration)? NEWLINE
               # VU think-time; the range form picks uniformly per iteration. Parses anywhere a
               # step does, but the checker rejects it outside a workload-bearing body (`TF033`) —
               # `wait until …` is the construct for a *condition*. Renamed from `think` in FS-05.
```

- **Workload keywords are not reserved words.** `ramp`/`hold`/`step`/`spike`/`run` leading a line
  never blocks an action call of the same name — disambiguation is by what follows (an ident-run
  then `(` is a call; otherwise a workload clause), so `run checkout("1")` and
  `action step users(n)` both work (FS-06/A2-02).
- A workload cannot coexist with `retry` or `with each` on the same test (D96), and a
  workload-bearing test with **no** `threshold` at all is a checker error — its verdict comes only
  from thresholds, so with none it could never fail (M60/A4-01).
- Browser steps and UI/network expect subjects are rejected inside a workload-bearing body (D19 —
  API-only in v1). The ban follows `action` calls and reports at the **call site**, since the same
  action is legal in a functional test (M60/A4-02).

## API steps (§5)

```
ApiStep         := 'api' ApiRequestLine NEWLINE (INDENT (HeaderLine | RetryAfterClause)* DEDENT)?
WaitUntilApiStep:= 'wait' 'until' 'api' ApiRequestLine NEWLINE
                    INDENT (HeaderLine* ExpectStmt+) DEDENT      # (§5.5) — expect-only body, no
                                                                  # `retry honoring` clause here;
                                                                  # `wait until` has its own
                                                                  # poll-until-passes retry semantics

ApiRequestLine  := IDENT? METHOD PATH BodyForm? ('timeout' Duration)? ('without' 'redirects')?
METHOD          := 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'
IDENT?                                                           # an optional named service prefix (§3.2)

BodyForm        := 'body' Object                                 # inline JSON
                 | 'body' 'from' STRING                          # file-backed JSON
                 | 'body' 'text' STRING                          # raw payload, any content-type
                 | 'form' FormField (',' FormField)*              # application/x-www-form-urlencoded
                 | 'upload' STRING 'as' STRING ('type' STRING)?   # multipart file upload; `type`
                    ('form' FormField (',' FormField)*)?          # overrides extension-based MIME
                                                                    # inference (decision 22/M19)
FormField       := IDENT '=' Value

HeaderLine      := 'header' STRING 'is' Value NEWLINE
RetryAfterClause:= 'retry' 'honoring' STRING 'up' 'to' NUMBER NEWLINE
                   # STRING must equal "Retry-After" — the only value this clause's vocabulary
                   # currently accepts (PLAN decision 102b, gap #5). One per api step, after any
                   # header lines in the step's indented sub-block.
```

## Assertions (§6)

```
ExpectStmt  := 'expect' Quantifier? Subject Matcher NEWLINE
CheckStmt   := 'check'  Quantifier? Subject Matcher NEWLINE                 # soft twin of expect

Matcher     := ('is' 'not'? | 'not' 'is'?)? MatcherCore    # (FS-08) `is` is an optional copula
                                                            # carrying no meaning, and it may sit on
                                                            # either side of `not` — so `is not
                                                            # visible` (canonical), `not is visible`,
                                                            # `is visible` and `not visible` are four
                                                            # spellings of two assertions

Quantifier  := 'any' | 'all'                                    # only over a body.<path> or body csv subject
Subject     := 'status' NetworkRef?
             | 'duration'
             | 'header' STRING NetworkRef?
             | 'body' 'text' NetworkRef?                          # raw response body as a string (§5.3, decision 51)
             | 'body' 'bytes'                                    # raw response body bytes (§6.2.1, gap #17)
             | 'body' 'csv' BodyPath?                            # body parsed as RFC 4180 CSV (gap #19)
             | 'body' 'pdf' 'text'                               # text extracted from a PDF body (gap #19)
             | 'body' BodyPath? NetworkRef?                      # bare `body` = whole-body subject
             | 'request'                                        # (§6.2.2, PLAN decision 18) — the
                                                                  # connection attempt, not a response
             | 'request' NetworkRef                              # (§9.7, M3d) — an *observed* network
                                                                  # request; disambiguated from the bare
                                                                  # form above by whether `to` follows
             | 'page'                                            # (§9.8, M3e) — the active browser page;
                                                                  # only `has no … a11y violations` reads it
BodyPath    := ('.' IDENT | '[' NUMBER ']')+                     # .items[0].price
NetworkRef  := 'to' STRING ('with' 'method' STRING)?              # (§9.7, M3d)
             | 'of' 'request' 'to' STRING ('with' 'method' STRING)?  # trailing clause on status/header/body/body text

MatcherCore := 'equals' Value
             | 'contains' Value
             | 'matches' STRING                                  # regex
             | 'matches' 'subset' Object                         # (§6.3.1)
             | 'matches' 'schema' STRING 'from' STRING            # (§6.2.1, PLAN decision 102a, gap #6)
             | 'matches' 'file' STRING                            # (§6.2.1, gap #17) — `body bytes` only
             | 'matches' 'snapshot' STRING SnapshotMask*          # visual regression (§9.9, M4b/D15);
                                                                  #   `page`/UI subjects only
             | 'greater' 'than' Value                             # canonically written `is greater
             | 'less' 'than' Value                                #   than` / `is less than` — the
                                                                  #   `is` comes from `Matcher`, above
             | 'has' 'count' Value                                # (FS-07) any value, not just a
                                                                  #   NUMBER literal: `has count {n}`
             | 'has' 'value' Value                                # 🔮 UI subjects only
             | StateWord                                          # 🔮 UI subjects only; canonically
                                                                  #   `is visible`/`is not visible`
             | 'connects'                                        # `request` subject only (§6.2.2)
             | 'fails' ('matching' STRING)?                       # `request` subject only (§6.2.2)
             | 'was' 'made'                                       # `request to "…"` subject only (§9.7, M3d)

SnapshotMask := 'mask' Locator                                    # dynamic regions painted over
                                                                  #   before the comparison. Parses
                                                                  #   after any matcher; the checker
                                                                  #   rejects a stray one.
             | 'has' 'no' A11ySeverity? 'a11y' 'violations'       # `page` subject only (§9.8, M3e) —
                                                                   # severity is a *floor*, not an exact
                                                                   # match: `serious` also counts `critical`
StateWord   := 'visible' | 'hidden' | 'enabled' | 'disabled' | 'checked'
A11ySeverity := 'minor' | 'moderate' | 'serious' | 'critical'      # axe-core's own impact scale (§9.8)
```

A step combining a `request`-subject assertion with a `status`/`header`/`body`/`duration` one on
the same request, or a `request`-subject assertion inside `wait until api`, is a checker error
(`TF031`, §6.2.2) — the grammar above accepts both shapes syntactically; the restriction is
semantic, enforced by `checkRequestAssertions` (`packages/lang/src/checker.ts`), the same layer
`checkServices`/`checkSessions` already live in. `request to "…"` (the M3d network-observation
form) and `page` (the M3e a11y subject) are both exempt from this restriction —
`checkRequestAssertions` recognizes each as an unrelated subject (the browser's own network log,
and the page's DOM, respectively), not this `api` step's response/connection state.

See the generated [matcher table](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#62-matcher-table)
(§6.2, from [`spec-data.ts`](https://github.com/deepak-tuteja/tflw/blob/main/packages/lang/src/spec-data.ts))
for one example per matcher.

## Variables, data & expressions (§7)

```
LetStmt     := 'let' IDENT '=' Value NEWLINE
CaptureStmt := 'capture' Subject 'as' IDENT NEWLINE
              # `request` parses here syntactically (it's the same Subject production) but is a
              # runtime error — it carries no value to capture (§6.2.2, PLAN decision 18).
              # `request to "…"` and any `of request to "…"` clause parse here too (same Subject
              # production) but are likewise runtime errors — no `capture` form exists for a
              # network-observation subject, only `expect`/`check` (§9.7, M3d). Same for `page`
              # (§9.8, M3e) — a page's a11y findings are asserted, never captured as a value.
GiveStmt    := 'give' Value NEWLINE                               # an action's return value (§8)
LogStmt     := 'log' LogLevel? STRING ('to' LogDestination)? NEWLINE
              # (§7.7, M27) — narrates what a test is doing, in the author's own words; always
              # succeeds, never an assertion. STRING is an ordinary StringLit — `{var}` interpolation
              # and unknown-variable checking come from the same `checkStringLit` every other string
              # uses. An explicit `to …` clause always wins over `tflw.config`'s `log destination`
              # key and any `--log-output` override (§12).
LogLevel       := 'debug' | 'info' | 'warn' | 'error'              # default 'info' when omitted
LogDestination := 'console' | 'html' | 'both'                      # default: `tflw.config`'s
                                                                     # `log destination` key

Value       := AddSub
AddSub      := MulDiv (('+' | '-') MulDiv)*
MulDiv      := Atom (('*' | '/') Atom)*
Atom        := STRING | NUMBER | 'true' | 'false' | 'null'
             | Interp | Object | Array                            # (FS-07) — one value parser for
                                                                  # every position; see the `{` rule
                                                                  # below
             | 'today' | 'now' | Atom ('+' | '-') NUMBER ('days' | 'hours' | 'minutes')
             | 'format' Atom 'as' STRING
             | 'env' '(' IDENT ')'
             | 'base64' ('encode' | 'decode') '(' Value ')'
             | 'hex' ('encode' | 'decode') '(' Value ')'
             | 'url' ('encode' | 'decode') '(' Value ')'
             | UniqueExpr | RandomExpr
             | CallName '(' (Value (',' Value)*)? ')'             # action/JS-helper call (§8)
             | IDENT                                              # variable/capture reference

Interp      := '{' IDENT ('.' IDENT | '[' NUMBER ']')* '}'
Object      := '{' (Field (',' Field)* ','?)? '}'
Field       := (IDENT | STRING) ':' Value
Array       := '[' (Value (',' Value)* ','?)? ']'

UniqueExpr  := 'unique' '(' STRING ')'
             | 'unique' 'email' | 'unique' 'number' | 'unique' 'uuid'
             | 'unique' 'like' STRING
RandomExpr  := 'random' 'number' Value 'to' Value
             | 'random' 'decimal' Value 'to' Value
             | 'random' 'date' ('in' 'past' | 'in' 'future' | 'between' Value 'and' Value)
             | 'random' 'of' Value (',' Value)*
             | 'random' 'string' NUMBER
             | 'random' 'like' STRING
             | 'random' 'uuid'
             | 'random' 'password' NUMBER?
```

- **The `{` rule (FS-07, §7.5).** `Interp` and `Object` both start with `{`, and `Atom` admits both,
  so the choice is made on **two tokens**: `{` `IDENT`/`STRING` `:` (or `{}`) is an `Object`;
  anything else — critically a bare `{ref}`, and `{price} * 2` — is an `Interp`. The rule this rests
  on is a language promise, not parser convenience: **an object literal always requires
  `key: value`**, so no JavaScript-style shorthand-key form will ever exist to make `{stock}`
  ambiguous. One consequence worth stating: `Value` is now the *only* value production — matcher
  operands, field values, array elements and call arguments all parse through it, which is why
  `has count {n}` works and why `equals {id: 1}` and `matches subset {id: 1}` agree.

See the generated [generators quick reference](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#731-generators-quick-reference-plan-decision-103-enterprise-arc-cluster-4)
(§7.3.1, from [`spec-data.ts`](https://github.com/deepak-tuteja/tflw/blob/main/packages/lang/src/spec-data.ts))
for one example per form.

## Actions, imports, the JS escape hatch (§8, §11)

```
CallName    := IDENT (' ' IDENT)*        # space-separated call names resolve to camelCase under
                                          # the hood: `create widget` → `createWidget`
```

`ActionDecl` (Program structure, above) declares a reusable step sequence; `ImportDecl` brings
another file's actions into scope; `UseDecl` brings a `.ts`/`.js` module's exports into scope as
callable values (via the `CallName '(' ... ')'` production in `Atom`, above). Neither `action`/
`use` calls nor `import`/`use` declarations are available inside a `session` block's body (§3.3)
— a session runs with an empty call registry.

## UI / browser steps (§9, M3a/M3b/M3c/M3d)

```
UiStep      := OpenStmt | ClickStmt | FillStmt | FillFormStmt | SelectStmt
             | TickStmt | UntickStmt | PressStmt | HoverStmt | ScrollStmt
             | WithinBlock | DialogStmt | TabStmt | DownloadBlock
             | DragStmt | DropFileStmt | WaitUntilUiStmt | ScreenshotStmt
             | StubStmt

OpenStmt        := 'open' STRING                                   # relative to env's `web` (§3.1)
ClickStmt       := ('double' | 'right')? 'click' Locator
FillStmt        := 'fill' Locator 'with' Value
FillFormStmt    := 'fill' 'form' NEWLINE INDENT ('|' STRING '|' Value '|' NEWLINE)+ DEDENT
SelectStmt      := 'select' Value 'from' Locator
TickStmt        := 'tick' Locator                                   # the checkbox action (AST type
                                                                      # `TickStmt`) — its own keyword
                                                                      # since FS-04, so `check` is
                                                                      # only ever the soft assertion
                                                                      # (Assertions §6, above)
UntickStmt      := 'untick' Locator
PressStmt       := 'press' STRING ('on' Locator)?
HoverStmt       := 'hover' Locator
ScrollStmt      := 'scroll' 'to' Locator
WithinBlock     := 'within' 'frame'? Locator NEWLINE Block           # `frame` traverses into an
                                                                      # <iframe>'s own document (M3b)

Locator         := LocatorKind (STRING | Interp)
LocatorKind     := 'button' | 'field' | 'text' | 'list' | 'css' | 'xpath'   # (§9.3, D6)

DialogStmt      := ('accept' | 'dismiss') 'dialog'
TabStmt         := 'switch' 'to' 'new' 'tab' NEWLINE Block           # M3b
                 | 'switch' 'to' 'tab' NUMBER                        # 1-based
                 | 'close' 'tab'
DownloadBlock   := 'download' 'as' IDENT NEWLINE Block                # M3b — binds the suggested
                                                                       # filename to IDENT
DragStmt        := 'drag' Locator 'to' Locator                        # M3b
DropFileStmt    := 'drop' 'file' STRING 'onto' Locator                 # M3b

WaitUntilUiStmt := 'wait' 'until' Subject Matcher ('for' Duration)?    # M3b — the UI sibling of
                                                                       # WaitUntilApiStep (§5.5);
                                                                       # polls `timeout wait`, not
                                                                       # `timeout expect`; always
                                                                       # hard-fails, no soft form.
                                                                       # `for <dur>` (FS-05) requires
                                                                       # the condition to hold
                                                                       # *continuously* for that long
                                                                       # instead of passing on the
                                                                       # first poll that satisfies it
                                                                       # — the only way to assert a
                                                                       # negative (§9.5). UI-only:
                                                                       # `wait until api … for` is
                                                                       # refused by name

ScreenshotStmt  := 'screenshot' STRING                                 # M3c — captures the active
                                                                        # page unconditionally

StubStmt        := 'stub' Method STRING 'respond' 'status' NUMBER Object?   # M3d, §9.7 — route-level
                                                                              # response mocking; Object
                                                                              # is the same {...} literal
                                                                              # `body {...}` (§5.2) uses
Method          := 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'   # same method-
                                                                                        # word recognition
                                                                                        # as ApiStep (§5.1)
```

- **Selector model (D6, §9.3):** the locator noun picks the resolution strategy —
  `button`/`text`/`list`/`css`/`xpath` are single-strategy; `field` is a closed 3-step cascade
  (label → placeholder → role). A below-tier-1 hit is annotated in the report, never silently
  accepted (`element` aliases are not yet implemented — no milestone owns them yet).
- **Ambiguity (D7):** more than one match for a locator is always a hard error listing candidates —
  never "take the first". No positional selection (`nth`/`first`/`last`); `within` is the only
  scoping mechanism.
- **`tick`, not `check` (FS-04, §9.1):** `check` had a dual grammar — a locator *with* a matcher
  after it was the soft assertion, a bare locator with nothing after it was the checkbox action, so
  a forgotten matcher turned an assertion into a mutation that then passed. The action is its own
  keyword now: `check <locator>` with no matcher is `TF014` naming both readings, and `uncheck` is
  `TF011` naming `untick`. Playwright and Cypress both spell it `check()`, so those diagnostics are
  the teaching surface.
- **UI subjects** (`Subject` in §6, above) additionally accept a `Locator` — `has value`/`is
  StateWord`/`has count` — for `expect`/`check`/`wait until` against UI state.
- **M3c (D12):** an automatic screenshot is attached to whichever step just failed whenever a
  browser page already exists for the attempt (best-effort, never a grammar concern) — `screenshot`
  is only the *explicit*, unconditional form. A Playwright trace is captured on a failing attempt
  and on every `retry` attempt (passed or not); `report/` gains an `assets/` directory only when a
  run actually produced one of these. `--browser chromium|firefox|webkit` (`tflw run`, default
  chromium, D11) and `--headed` are CLI-only, not grammar. `viewport` is config-only (below).

## The config dialect — `tflw.config` (§3)

Parsed by the same lexer/parser as test files; declaration-only (`test`/`action`/etc. are checker
errors here).

```
ConfigFile      := (NEWLINE | RequireDecl | ExcludeDecl | DefaultsBlock | EnvBlock | SessionDecl)*

RequireDecl     := 'require' 'env' IDENT (',' IDENT)* NEWLINE
ExcludeDecl     := 'exclude' STRING (',' STRING)* NEWLINE         # file-discovery exclusions (§3.9,
                                                                   # D127) — top-level, not a
                                                                   # ConfigEntry; string paths, not
                                                                   # bare idents like `require env`
DefaultsBlock   := 'defaults' NEWLINE INDENT ConfigEntry* DEDENT
EnvBlock        := 'env' IDENT 'default'? NEWLINE INDENT ConfigEntry* DEDENT

ConfigEntry     := HeaderDecl | TimeoutDecl | WorkersDecl | ReportDecl | WebDecl | ApiServiceDecl
                 | InsecureDecl | CertDecl | KeyDecl | AllowHostsDecl | EvidenceDecl | RedactDecl
                 | ViewportDecl | LogDestinationDecl | LogLevelDecl

HeaderDecl      := 'header' STRING 'is' Value ('for' IDENT)? (',' 'header' STRING 'is' Value ('for' IDENT)?)*
TimeoutDecl     := 'timeout' TimeoutKind Duration (',' TimeoutKind Duration)*
TimeoutKind     := 'step' | 'expect' | 'wait'                    # `expect` parses but is inert
                                                                   # pre-0.2.0 (§3.1)
Duration        := NUMBER ('ms' | 's' | 'm')
WorkersDecl     := 'workers' NUMBER
ReportDecl      := 'report' STRING
WebDecl         := 'web' STRING                                  # the browser half's base URL (§9)
ApiServiceDecl  := 'api' IDENT? STRING                            # bare = default service (§3.2)
InsecureDecl    := 'insecure' ('true' | 'false')
CertDecl        := 'cert' STRING
KeyDecl         := 'key' STRING
AllowHostsDecl  := 'allow' 'hosts' STRING (',' STRING)*           # accumulates across defaults+env (§3.7)
EvidenceDecl    := 'evidence' STRING                              # "full" | "headers-only" | "none" (§13)
RedactDecl      := 'redact' RedactPattern (',' RedactPattern)*    # accumulates across defaults+env (§3.4)
RedactPattern   := 'body' ('.' IDENT | '.' '*')+
                 | 'header' STRING                                # FS-03/M64 — quoted, not dotted:
                 | 'query' STRING                                 #   an ident can't hold the hyphen
                                                                   #   `X-Api-Key`/`Set-Cookie` need
LogDestinationDecl := 'log' 'destination' STRING                  # "console" | "html" | "both" (§3.8,
                                                                   # M27) — `--log-output` overrides
LogLevelDecl    := 'log' 'level' STRING                           # "debug"|"info"|"warn"|"error"
                                                                   # (§3.8) — `--log-level` overrides
ViewportDecl    := 'viewport' NUMBER NUMBER                       # width height, px (§9, M3c, D11);
                                                                   # `defaults`-only, like `workers`/
                                                                   # `report`; omitted = Playwright's
                                                                   # own default (1280×720)

SessionDecl     := 'session' IDENT ('oauth2' NEWLINE INDENT Oauth2Config DEDENT | NEWLINE Block)
Oauth2Config    := 'token' 'url' Value NEWLINE
                    'client' 'id' Value NEWLINE
                    'client' 'secret' Value NEWLINE
                    ('scope' Value NEWLINE)?
```

- `SessionDecl`'s plain-body form (`NEWLINE Block`) reuses the ordinary `Step` grammar (API steps,
  above) — a session is just a named, once-per-run step sequence whose captured headers a test can
  opt into (§3.3).
- `HeaderStmt` (a bare `header "…" is …` step, no `for <service>`) is also valid directly inside a
  `Block` — not just a config entry — for setting a header mid-test (e.g. right after `capture
  body.token as token`, SPEC's own worked example).

## Diagnostics (errors are a feature — P#6)

Every parse error is a structured `Diagnostic` (code + message + source span + optional
`did you mean` hint), rendered Rust/Elm-style with the source line and a caret underline. The
parser recovers in panic mode (skip to the next `NEWLINE`/`DEDENT`) so one file can surface many
errors. Error-message output is snapshot-tested (golden files) — it is a stable, reviewed
artifact. See [SPEC.md §17](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#17-diagnostic-codes-tf0xx-)
for the full `TF0xx` code list.
