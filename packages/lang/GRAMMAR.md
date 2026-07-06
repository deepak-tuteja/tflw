# testFlow grammar — M0 surface

The **minimal, API-flavored** subset the M0 lexer + parser implement. This is the *v0* grammar,
written before the lexer (per PLAN.md M0). It is a strict subset of the full language in
[SPEC.md](../../SPEC.md); later milestones widen it (UI steps M3, generators/expressions/actions
M2, config dialect M1, quantifiers M2, `check` M4). Cross-references to SPEC decisions are `(P#n)`.

Notation: `UPPER` = terminal token class, `'x'` = literal keyword/punct, `?` optional, `*` zero+,
`+` one+, `|` alternation. Blocks are **indentation-delimited** (offside rule) — `INDENT` /
`DEDENT` / `NEWLINE` are synthetic tokens from the lexer.

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
- While a `{`/`[` is open (bracket depth > 0, tracked across `{`/`}`/`[`/`]` tokens), a physical
  line is a *continuation*: no `INDENT`/`DEDENT`/`NEWLINE` for it, regardless of its own leading
  whitespace. This is what lets an object/array literal (e.g. `body { … }`) span several
  hand-indented lines (M2.6 — found missing dogfooding an external API, SPEC §5.2).
- Keywords are `IDENT` lexemes recognised by the parser in position (soft keywords): `test`, `as`,
  `api`, `expect`, `let`, `capture`, `body`, `status`, `header`, `duration`, `not`, `equals`,
  `contains`, `matches`, `is`, `greater`, `less`, `than`, `has`, `count`, `value`, `visible`,
  `hidden`, `enabled`, `disabled`, `checked`, `true`, `false`, `null`.
- **M0 PATH simplification:** a `/`-initiated run is lexed greedily as one `PATH` token. M0 has no
  arithmetic `/` operator, so this is unambiguous. **Updated at M2:** now that `/` is also the
  arithmetic divide operator (P#25), the lexer disambiguates contextually — `/` starts a `PATH`
  token only when the immediately preceding token is an HTTP method word (`GET`/`POST`/`PUT`/
  `DELETE`/`PATCH`, case-insensitive); everywhere else `/` is a `slash` token. Still internal to
  the lexer — no grammar-level PATH-vs-expression ambiguity for the parser to resolve.

## Syntactic

```
Program     := (NEWLINE | TestDecl)*

TestDecl    := TAG* 'test' STRING ('as' IDENT)? NEWLINE Block
Block       := INDENT Step+ DEDENT
Step        := ApiStep | ExpectStmt | LetStmt | CaptureStmt

ApiStep     := 'api' IDENT? METHOD PATH BodyForm? NEWLINE
METHOD      := 'GET' | 'POST'                          # M0 subset (P#3); more verbs at M2
BodyForm    := 'body' Object                           # inline JSON only in M0 (P#32)

ExpectStmt  := 'expect' Subject Matcher NEWLINE
Subject     := 'status'
             | 'duration'
             | 'header' STRING
             | 'body' BodyPath
             | 'body'                                  # bare body (whole-body subject)
BodyPath    := ('.' IDENT | '[' NUMBER ']')+           # .items[0].price

Matcher     := 'not'? MatcherCore
MatcherCore := 'equals' Value
             | 'contains' Value
             | 'matches' STRING
             | 'is' 'greater' 'than' Value
             | 'is' 'less' 'than' Value
             | 'has' 'count' NUMBER
             | 'has' 'value' Value
             | 'is' StateWord                          # visible|hidden|enabled|disabled|checked
StateWord   := 'visible' | 'hidden' | 'enabled' | 'disabled' | 'checked'

LetStmt     := 'let' IDENT '=' Value NEWLINE
CaptureStmt := 'capture' Subject 'as' IDENT NEWLINE

Value       := STRING | NUMBER | 'true' | 'false' | 'null' | Interp | IDENT
Interp      := '{' IDENT ('.' IDENT | '[' NUMBER ']')* '}'
Object      := '{' (Field (',' Field)* ','?)? '}'
Field       := IDENT ':' FieldValue
FieldValue  := Value | Object | Array
Array       := '[' (FieldValue (',' FieldValue)* ','?)? ']'
```

### Notes / M0 boundaries

- `expect` only (not `check`, its M4 soft twin) — same production, one keyword branch, added later.
- State matchers (`is visible` …) and `has value` parse syntactically for the closed matcher set
  (P#13) but are UI-oriented; the semantic checker (M1+) is what rejects them on an API subject.
  M0 is **syntactic only** — no type/subject-compatibility checking yet.
- `Value` includes bare `IDENT` (a variable/capture reference) and `Interp`; arithmetic, date math,
  `env(…)`, generators (`unique`/`random`) and action calls are M2 (P#21–25) and out of M0.
- `PATH` keeps its query string and `{interpolation}` as raw text; resolution is a runtime concern.

## Diagnostics (errors are a feature — P#6)

Every parse error is a structured `Diagnostic` (code + message + source span + optional
`did you mean` hint), rendered Rust/Elm-style with the source line and a caret underline. The parser
recovers in panic mode (skip to the next `NEWLINE`/`DEDENT`) so one file can surface many errors.
Error-message output is snapshot-tested (golden files) — it is a stable, reviewed artifact.
