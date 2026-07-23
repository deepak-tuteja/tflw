# testFlow grammar

The formal grammar `packages/lang`'s lexer/parser/checker implement, current through **PLAN
decision 108** (M14, the enterprise-readiness arc's cluster 5.5 — `request connects`/`fails`;
clusters 4/5 in between, M12/M13, added no new grammar, per `PLAN_ENTERPRISE.md`'s decision 16/17
cadence exception). This is a strict subset of the
full language design in [SPEC.md](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md); SPEC.md is the prose reference with rationale
and examples, this file is the grammar shape only. Cross-references to SPEC decisions are `(P#n)`;
cross-references to a SPEC section are `(§n)`.

**Freshening note (PLAN decision 103, enterprise arc cluster 4, decision 16.11):** this file was a
frozen M0-only snapshot from 2026-07-06 through M11 — every milestone after M0 updated SPEC.md but
not this file. This rewrite catches it up through decision 102 and is required going forward:
every milestone that changes the grammar updates this file alongside SPEC.md, the same discipline
`spec-data.ts`'s generated tables (§6.2, §7.3.1) now help enforce for the constructs they cover.

Notation: `UPPER` = terminal token class, `'x'` = literal keyword/punct, `?` optional, `*` zero+,
`+` one+, `|` alternation, `(...)` grouping. Blocks are **indentation-delimited** (offside rule) —
`INDENT`/`DEDENT`/`NEWLINE` are synthetic tokens from the lexer. 🔮 marks a production that parses
but has no callable subject yet (UI steps land in `0.2.0`).

## Lexical

```
NEWLINE     logical end-of-line (collapses blank + comment-only lines)
INDENT      indentation increased vs. the enclosing block
DEDENT      indentation decreased (one per level closed)
STRING      "…"  with \" \\ \n \t escapes; may contain {interpolation}
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
  words) — see each production below for the keyword set it recognises.
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
TestDecl    := TAG* DataTable? 'test' STRING ('as' IDENT (',' IDENT)*)?
               ('retry' NUMBER)? NEWLINE Block

DataTable   := 'with' 'each' ('from' STRING)? NEWLINE
               ( '|' IDENT ('|' IDENT)* '|' NEWLINE          # inline: header row
                 ('|' Cell ('|' Cell)* '|' NEWLINE)+ )?      # inline: one or more data rows
               # `from STRING` (a .csv/.json path) replaces the inline table entirely — mutually
               # exclusive with the `| col |` rows.

Block       := INDENT Step+ DEDENT
Step        := ApiStep | WaitUntilApiStep | ExpectStmt | CheckStmt | LetStmt | CaptureStmt
             | GiveStmt | HeaderStmt
```

- `TAG*` may sit on its own line(s) above `test` (and above its `with each` table, if present).
- `as admin, userA` — independent, unrelated sessions a test opts into together (§3.3).
- `retry N` re-runs the whole test up to `N` more times on failure (§4.4) — distinct from the
  per-step `retry honoring "Retry-After" up to N` clause (§5.1, below).
- `before`/`after` (no `file` keyword) run once per test, sharing its scope; `before file`/
  `after file` run once per file instead. There is no `before each`/`after each` — `each` is
  exclusively the `with each` keyword above.

## API steps (§5)

```
ApiStep         := 'api' ApiRequestLine NEWLINE (INDENT (HeaderLine | RetryAfterClause)* DEDENT)?
WaitUntilApiStep:= 'wait' 'until' 'api' ApiRequestLine NEWLINE
                    INDENT (HeaderLine* ExpectStmt+) DEDENT      # (§5.5) — expect-only body, no
                                                                  # `retry honoring` clause here;
                                                                  # `wait until` has its own
                                                                  # poll-until-passes retry semantics

ApiRequestLine  := IDENT? METHOD PATH BodyForm? ('timeout' Duration)? ('without' 'redirects')?
METHOD          := 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
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
ExpectStmt  := 'expect' Quantifier? Subject 'not'? MatcherCore NEWLINE
CheckStmt   := 'check'  Quantifier? Subject 'not'? MatcherCore NEWLINE      # soft twin of expect

Quantifier  := 'any' | 'all'                                    # only over a body.<path> subject
Subject     := 'status'
             | 'duration'
             | 'header' STRING
             | 'body' BodyPath?                                 # bare `body` = whole-body subject
             | 'request'                                        # (§6.2.2, PLAN decision 18) — the
                                                                  # connection attempt, not a response
BodyPath    := ('.' IDENT | '[' NUMBER ']')+                     # .items[0].price

MatcherCore := 'equals' Value
             | 'contains' Value
             | 'matches' STRING                                  # regex
             | 'matches' 'subset' Object                         # (§6.3.1)
             | 'matches' 'schema' STRING 'from' STRING            # (§6.2.1, PLAN decision 102a, gap #6)
             | 'is' 'greater' 'than' Value
             | 'is' 'less' 'than' Value
             | 'has' 'count' NUMBER
             | 'has' 'value' Value                                # 🔮 UI subjects only
             | 'is' StateWord                                    # 🔮 UI subjects only
             | 'connects'                                        # `request` subject only (§6.2.2)
             | 'fails' ('matching' STRING)?                       # `request` subject only (§6.2.2)
StateWord   := 'visible' | 'hidden' | 'enabled' | 'disabled' | 'checked'
```

A step combining a `request`-subject assertion with a `status`/`header`/`body`/`duration` one on
the same request, or a `request`-subject assertion inside `wait until api`, is a checker error
(`TF031`, §6.2.2) — the grammar above accepts both shapes syntactically; the restriction is
semantic, enforced by `checkRequestAssertions` (`packages/lang/src/checker.ts`), the same layer
`checkServices`/`checkSessions` already live in.

See the generated [matcher table](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#62-matcher-table)
(§6.2, from [`spec-data.ts`](https://github.com/deepak-tuteja/tflw/blob/main/packages/lang/src/spec-data.ts))
for one example per matcher.

## Variables, data & expressions (§7)

```
LetStmt     := 'let' IDENT '=' Value NEWLINE
CaptureStmt := 'capture' Subject 'as' IDENT NEWLINE
              # `request` parses here syntactically (it's the same Subject production) but is a
              # runtime error — it carries no value to capture (§6.2.2, PLAN decision 18).
GiveStmt    := 'give' Value NEWLINE                               # an action's return value (§8)

Value       := AddSub
AddSub      := MulDiv (('+' | '-') MulDiv)*
MulDiv      := Atom (('*' | '/') Atom)*
Atom        := STRING | NUMBER | 'true' | 'false' | 'null'
             | Interp
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
Field       := IDENT ':' FieldValue
FieldValue  := Value | Object | Array
Array       := '[' (FieldValue (',' FieldValue)* ','?)? ']'

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

## The config dialect — `tflw.config` (§3)

Parsed by the same lexer/parser as test files; declaration-only (`test`/`action`/etc. are checker
errors here).

```
ConfigFile      := (NEWLINE | RequireDecl | DefaultsBlock | EnvBlock | SessionDecl)*

RequireDecl     := 'require' 'env' IDENT (',' IDENT)* NEWLINE
DefaultsBlock   := 'defaults' NEWLINE INDENT ConfigEntry* DEDENT
EnvBlock        := 'env' IDENT 'default'? NEWLINE INDENT ConfigEntry* DEDENT

ConfigEntry     := HeaderDecl | TimeoutDecl | WorkersDecl | ReportDecl | WebDecl | ApiServiceDecl
                 | InsecureDecl | CertDecl | KeyDecl | AllowHostsDecl | EvidenceDecl | RedactDecl

HeaderDecl      := 'header' STRING 'is' Value ('for' IDENT)? (',' 'header' STRING 'is' Value ('for' IDENT)?)*
TimeoutDecl     := 'timeout' TimeoutKind Duration (',' TimeoutKind Duration)*
TimeoutKind     := 'step' | 'expect' | 'wait'                    # `expect` parses but is inert
                                                                   # pre-0.2.0 (§3.1)
Duration        := NUMBER ('ms' | 's' | 'm')
WorkersDecl     := 'workers' NUMBER
ReportDecl      := 'report' STRING
WebDecl         := 'web' STRING                                  # 🔮 the browser half's base URL
ApiServiceDecl  := 'api' IDENT? STRING                            # bare = default service (§3.2)
InsecureDecl    := 'insecure' ('true' | 'false')
CertDecl        := 'cert' STRING
KeyDecl         := 'key' STRING
AllowHostsDecl  := 'allow' 'hosts' STRING (',' STRING)*           # accumulates across defaults+env (§3.7)
EvidenceDecl    := 'evidence' STRING                              # "full" | "headers-only" | "none" (§13)
RedactDecl      := 'redact' RedactPattern (',' RedactPattern)*    # accumulates across defaults+env (§3.4)
RedactPattern   := 'body' ('.' IDENT | '.' '*')+

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
