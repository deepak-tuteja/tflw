# M13 — LSP (enterprise arc cluster 5 of 8)

## Context

`PLAN_ENTERPRISE.md` decision 17 (lines 136-186) already settled the *what* for this cluster: a
full v1 LSP feature set (diagnostics, hover, go-to-definition, autocomplete, rename, signature
help) in one milestone, architected around a new `packages/lsp-server` consumed by `packages/vscode`
(rewritten as a thin `vscode-languageclient` shell spawning a new `tflw lsp` CLI subcommand) and,
for free, any other LSP-capable editor. This plan is the *how* — it lands as **PLAN.md decision
104** / **PROGRESS.md milestone M13**, following the exact M9-M12 structural precedent.

Two scope decisions made this session extend decision 17 and must be folded into its eventual
addendum:
- **(A) `tflw.config` is in scope for LSP features in v1** (diagnostics via `validateConfig` +
  `checkSessionServices`, plus hover/go-to-def) — widens beyond today's spawn-based diagnostics,
  which explicitly exclude it (`packages/vscode/src/extension.ts:47-50`'s `isTflwTestFile` filters
  out anything not ending `.tflw`).
- **(B) Env resolution gets a `tflw.env` VS Code setting** (mirrors `--env`/`TFLW_ENV`) for
  `checkServices`/`checkSessions`/`checkSessionServices` parity with `tflw check` — there is no
  in-editor equivalent of a CLI flag, and always resolving only the default env would risk spurious
  diagnostics for any multi-env project. `packages/vscode/package.json` has no
  `contributes.configuration` block today — this adds the first one.

Researched directly (two Explore passes + a Plan pass, all read full files, not just grepped):
`packages/lang/src/ast.ts` (every node carries a `Span`; `TestDecl.sessions`/`ActionDecl.params`/
`InlineDataTable.columns` are plain `string[]` with **no per-element span**), `packages/lang/src/
parser.ts` (confirmed exact line numbers: `parseStep`:923, `parseSubject`:1278, `parseMatcher`:1342,
`parseValue`:1479, `parseUniqueExpr`:1624, `parseRandomExpr`:1662; `as` sessions loop in
`parseTest()`:797-806; `STATEMENT_KEYWORDS`/`SUBJECT_KEYWORDS` consts at 110-111), `packages/lang/
src/lexer.ts` (always emits a trailing `eof` token at end-of-stream, line 73 — confirms a truncated-
and-relexed prefix naturally produces `eof` at the cursor with no special-casing needed),
`packages/lang/src/checker.ts` (463 lines — **no symbol table exists today**; `checkUnknownVariables`
tracks a `bound: Set<string>` of names only, no defining span, and only records a span at failing
use-sites; the scope model at checker.ts:206-215 — before/after-file hooks isolated, before/after-
each hooks share the wrapped test's scope, each action isolated seeded by its own params, inline
table columns bound per-test, file-backed tables skipped statically — is the exact reusable
traversal shape), `packages/lang/src/index.ts` ("no I/O" pure front end, `parseSource`/
`parseConfigSource` signatures), `packages/lang/src/spec-data.ts` (`MatcherEntry`/`GeneratorEntry`/
`CliFlagEntry` shapes, already built in M12 — the intended hover/signature-help source per decision
17.7), `packages/runtime/src/resolve.ts` (publicly exported from `index.ts:7`; `selectEnv`/
`resolveConfig` are **pure, zero I/O**, safe to call repeatedly in a long-lived server; `.env`/
`process.env` reads happen only in `packages/cli/src/env.ts` and `cli.ts:218`, not needed here since
diagnostics parity never needs `missingRequiredEnv`), `packages/runtime/src/interpreter.ts`'s
`buildRegistry` (239-277 — the only existing cross-file resolution logic, today CLI/run-only, no
caching), `packages/vscode/src/{lib,extension}.ts` (today: spawns `tflw check --format json` on
save/open, no in-process parse/check at all; `lib.ts`'s `findProjectRoot`/`resolveTflwBin` are
`vscode`-independent and reusable), `packages/vscode/scripts/bundle.mjs` and `packages/cli/scripts/
bundle.mjs` (esbuild; CLI's has **no `external` list** and already bundles `undici`+`ajv` — bundling
`vscode-languageserver` follows the identical precedent), `packages/cli/src/cli.ts` (plain `switch`
dispatch in `main()`, `docsCommand` (547-567) is the simplest subcommand to mirror; `discoverTests`
glob-walk ~686-701 is the pattern for a project-wide `*.tflw` index), root `package.json` (current
`workspaces`: lang/runtime/reporter/cli/vscode/docs-site — `packages/lsp-server` joins the same
way `docs-site` did in M12). Current `PLAN.md` decision count tops out at **103** (M12) →
this is **104**; `PROGRESS.md`'s latest milestone is **M12** → this is **M13**.

## Architecture

```
packages/lang        (extended) — pure, no I/O, unchanged invariant
  + symbols.ts           NEW: collectSymbols(Program), collectConfigSymbols(ConfigFile),
                          findIdentifierSpans(source, parentSpan, names)
  + completion.ts         NEW: getCompletionContext(source, cursorOffset)
  ~ parser.ts             MODIFIED: completion-mode guards at 6 production entry points
  ~ index.ts              MODIFIED: re-exports the above

packages/runtime      (unmodified) — lsp-server depends on resolve.ts only (selectEnv/resolveConfig)

packages/lsp-server    NEW workspace member (@tflw/lsp-server)
  deps: @tflw/lang (*), @tflw/runtime (*), vscode-languageserver, vscode-languageserver-textdocument
  src/resolution/        pure position-based fns: definition, hover, completion, rename,
                          signatureHelp, + shared findNodeAtOffset — zero vscode-languageserver
                          imports, unit-tested directly (decision 17.8)
  src/workspace/         I/O layer: project.ts (own findProjectRoot copy), configResolution.ts
                          (selectEnv/resolveConfig + tflw.env setting), documentStore.ts (debounced
                          reparse, ~150-300ms per decision 17.9), crossFile.ts (read-only
                          buildRegistry-style import resolution + cache), workspaceIndex.ts
                          (project-wide *.tflw glob, lazy, for cross-file rename)
  src/server.ts           startServer() — vscode-languageserver protocol wiring

packages/cli           (extended)
  ~ cli.ts                MODIFIED: `case 'lsp'` mirrors docsCommand's shape, imports
                          @tflw/lsp-server's startServer() directly (bundled, not spawned)
  + @tflw/lsp-server devDependency (bundled by esbuild, same as lang/runtime/reporter today)

packages/vscode         (rewritten)
  deps: + vscode-languageclient (devDependency); does NOT depend on @tflw/lsp-server
  ~ extension.ts          MODIFIED: delete spawn-based diagnostics entirely; spawn `tflw lsp`
                          (resolveTflwBin + ['lsp']) as a child process, talk to it via
                          vscode-languageclient over stdio
  ~ package.json           MODIFIED: new contributes.configuration block (tflw.env)
```

`packages/vscode` never imports `@tflw/lsp-server`'s TypeScript — it spawns the `tflw` **binary**
as a separate OS process and speaks JSON-RPC over stdio, per decision 17.2/17.4 (this is *the*
mechanism that makes the server editor-agnostic). `packages/lsp-server` therefore needs its own
independent per-document project-root walk (duplicating `vscode/src/lib.ts`'s ~10-line
`findProjectRoot`, not sharing a package for one function — consistent with this project's
anti-premature-abstraction stance) since it runs in a wholly separate process.

## Key design decisions (flagged, not yet challenged by anyone — proceed unless redirected)

1. **Symbol collection lives in `packages/lang/src/symbols.ts`**, not `lsp-server` — keeps
   `@tflw/lang` the single source of truth for language-level facts (mirrors `spec-data.ts`/
   `checker.ts`), reuses `checkStepSequence`'s scope rules, testable with the same
   `parseSource`-driven idiom as `checker.test.ts`.
2. **The missing per-element spans** (`TestDecl.sessions`/`ActionDecl.params`/
   `InlineDataTable.columns`) are closed with a pure re-lexing helper, `findIdentifierSpans` —
   re-lexes the parent node's source substring and matches identifier tokens in order — **not** an
   AST/parser schema change (smaller blast radius, no consumer of these fields elsewhere needs to
   change).
3. **Autocomplete has two independent sources**: grammar-shape completion (needs the new parser
   prefix-mode) vs. symbol-name completion (served entirely from `collectSymbols`, no parser
   involvement). The parser prefix-mode is scoped to 6 named production entry points — `parseStep`,
   `parseSubject`, `parseMatcher`, `parseUniqueExpr`, `parseRandomExpr`, and the `as` sessions loop
   in `parseTest` — each guarded by a one-line `if (this.completionMode && this.peek().type ===
   'eof')` check, firing only when a source string truncated at the cursor and re-lexed hits `eof`
   exactly at that production. `parseValue`'s broad atom dispatch (1479) is explicitly **not**
   instrumented in v1 (too large a candidate set for the value, low marginal payoff). Matcher/
   generator candidate lists are sourced from `spec-data.ts`'s `MATCHERS`/`GENERATORS` (already
   built for hover — same data, not new work), not the parser's own local keyword lists.
4. **Signature help is `CallExpr`-shaped only** — generator calls (`unique(...)`) and user action
   calls (`myAction(...)`); matchers aren't call-syntax and don't need it. When the cursor is inside
   an *unclosed* call (still typing), signature help falls back to the same completion-prefix
   machinery as autocomplete, since a normal AST walk can't see into an as-yet-unparseable call.
5. **Cross-file go-to-def**: imported `.tflw` action names resolve to the real `ActionDecl` span in
   the target file (read-only mirror of `interpreter.ts`'s `buildRegistry`, minus execution, plus a
   path+mtime cache the runtime doesn't have but a long-lived server needs). `use`d JS/TS helpers
   resolve only to line 1 of the target file — `packages/lang` doesn't parse TypeScript, and real
   JS/TS symbol resolution is explicit scope creep beyond this cluster.
6. **Cross-file rename** (decision 17.5 explicitly includes imported action names) needs a
   project-wide `*.tflw` index, not just open buffers — mirrors `cli.ts`'s `discoverTests(cwd)`
   glob-walk, built lazily only when a rename actually targets a cross-file symbol (not eagerly on
   server start, to avoid cold-start cost on large workspaces for the diagnostics/hover/def path
   that doesn't need it).
7. **Dependency graph** — see Architecture above; this list is decision material for decision 17's
   eventual addendum, not just an implementation note.

## Phased build order

**Phase 1 — `packages/lang` additions** (novel logic, zero I/O, easiest to isolate and test first)
- `packages/lang/src/symbols.ts`: `SymbolDef`/`SymbolRef`/`SymbolTable` types (`{name, span,
  scopeId, kind: 'variable'|'session'|'action'|'param'|'importedAction'}`); `collectSymbols(program)`
  mirroring `checkUnknownVariables`'s traversal but recording every def/ref (not deduping — rename
  needs every occurrence, tagged by `scopeId`); `collectConfigSymbols(config)` for session/service
  defs living in `tflw.config` (a `ConfigFile`, not a `Program`); `findIdentifierSpans(source,
  parentSpan, names)` — re-lex the substring, match `'ident'` tokens in order, offset spans back.
  Called lazily by `lsp-server` only when a request lands on one of the three no-span fields.
- `packages/lang/src/parser.ts`: `completionMode`/`completionResult` fields on `Parser`, a
  `parseForCompletion(tokens)` sibling to `parse()`, and the 6 one-line guards described in design
  decision 3 above, at the exact line anchors confirmed by direct read. Zero behavior change when
  `completionMode` is off (default) — existing parser tests must pass unmodified.
- `packages/lang/src/completion.ts`: `getCompletionContext(source, cursorOffset)` — truncates,
  re-lexes, parses in completion mode, returns the result.
- Tests: `packages/lang/test/symbols.test.ts`, `packages/lang/test/completion.test.ts` — both
  `parseSource`-driven on literal strings (never hand-built AST), matching `checker.test.ts`'s
  idiom. Cover: let/capture def+ref, action-param def+ref, session ref resolving against a
  separately-parsed config, file-backed table's deliberate column-def skip, a shared `before each`
  binding visible across two tests as two distinct refs, `findIdentifierSpans` round-tripped against
  `as admin, userA`/a 3-param action header/a 4-column table header (asserting line+column, not just
  offset), and one `CompletionContext` case per `kind` plus a negative case (cursor mid-line inside
  an already-complete production → `null`).

**Phase 1 status: done (2026-07-19).** Built `packages/lang/src/symbols.ts` (`SymbolDef`/
`SymbolRef`/`SymbolTable`, `collectSymbols`, `collectConfigSymbols`, `findIdentifierSpans`),
`packages/lang/src/completion.ts` (`getCompletionContext`), the 6 parser guards + `runCompletion()`/
`parseForCompletion` in `parser.ts`, and re-exports in `index.ts`. Tests: `test/symbols.test.ts`
(10 cases), `test/completion.test.ts` (12 cases) — both `parseSource`-driven per the existing idiom.
Full workspace (`lang`/`runtime`/`reporter`/`cli`/`vscode`) builds, typechecks, and tests clean:
218/185/12/56/12 tests pass respectively, 0 regressions (`@tflw/lang` was 196 before this phase).

Three implementation refinements versus this doc's original sketch, made during the build (judgment
calls, not re-litigating anything already decided):
1. **`findIdentifierSpans` gained tight, deliberately-chosen windows per call site** (e.g.
   `{test.name.span.end → body[0]?.span.start}` for sessions, `{lparen.end → body[0]?.span.start}`
   for params, `{stmt.span.start → value.span.start}` for a `LetStmt` name) instead of re-lexing an
   entire node's span — a naive whole-node window risks a false match against an unrelated later
   occurrence of the same identifier text (e.g. a param named the same as one of a multi-word
   action's own name words). Still the one general-purpose greedy value-match function this doc
   specified; only the *windows* passed to it got smarter.
2. **Extended the same technique to `LetStmt.name`/`CaptureStmt.name`/`SessionDecl.name`**, not just
   the three documented no-span fields (`TestDecl.sessions`/`ActionDecl.params`/
   `InlineDataTable.columns`) — these three have the identical missing-span gap and decision 17.5
   (rename of captured variables) needs a precise `LetStmt`/`CaptureStmt` name span to produce a
   correct text edit, not just an approximate one. Same helper, no new AST/parser surface.
3. **`Parser#atCompletionPoint()` needed a rescan, not a direct `peek(1).type === 'eof'` check** —
   `lexer.ts`'s `lex()` always closes out whatever's on the truncated source's last physical line as
   if it were complete (a synthetic trailing `newline`, then one `dedent` per still-open indentation
   level, then `eof`), so the token right after a mid-word identifier is never literally `eof`.
   Fixed by scanning forward from the identifier, skipping only `newline`/`dedent`, until hitting
   either `eof` (a real completion point) or anything else (not one).

**Known Phase 1 limitation** (documented in `completion.ts`, not fixed — accepted for v1): a cursor
on an otherwise-blank line (pure indentation, zero characters typed yet — e.g. right after pressing
Enter for a brand-new first step in a block) resolves to `null`, because the lexer treats a
whitespace-only line as blank and emits no `indent`/`newline` for it, so no guarded production is
ever reached. Once at least one character is typed — the dominant real-world trigger, since most
editors invoke completion per keystroke — resolution works normally. Worth revisiting only if
Phase 5's manual VS Code walkthrough shows it matters in practice.

**Phase 2 — `packages/lsp-server`'s pure resolution functions**
- New workspace member: `package.json` (mirrors `docs-site`'s pattern), `tsconfig.json` extending
  the shared base.
- `src/resolution/findNodeAtOffset.ts` — shared "which AST node contains this offset" walker used by
  every capability below.
- `src/resolution/definition.ts`, `hover.ts`, `completion.ts`, `rename.ts`, `signatureHelp.ts` — pure
  functions over `Program`/`SymbolTable`/`spec-data.ts`, per design decisions 3-5 above. No
  `vscode-languageserver` import anywhere in this directory.
- Tests: `packages/lsp-server/test/{definition,hover,completion,rename,signatureHelp}.test.ts`,
  literal-source-driven through `parseSource`/`parseConfigSource` + `collectSymbols`.

**Phase 2 status: done (2026-07-19).** New workspace member `packages/lsp-server` (registered in
root `package.json`'s `workspaces` — the plan originally listed this under Phase 3, but it's a
practical prerequisite for building/testing the package at all, so it landed now instead; Phase 3's
own checklist item is a no-op when reached). Built `src/resolution/findNodeAtOffset.ts`
(`spanContains` + an exhaustive `children()` dispatch over every `ast.ts` node type, ~70 cases),
`definition.ts`, `hover.ts`, `completion.ts`, `rename.ts`, `signatureHelp.ts`, and `src/index.ts`.
No `vscode-languageserver` import anywhere in `src/`. Tests: one file per module (32 cases total),
literal-source-driven through `parseSource`/`collectSymbols` per the plan's stated idiom — all
passed on the first run. Full workspace (`lang`/`runtime`/`reporter`/`cli`/`vscode`/`lsp-server`)
builds, typechecks, and tests clean: 218/185/12/56/12/32 tests pass respectively, 0 regressions.

Two scoping notes for Phase 3 to pick up (not gaps, just where the pure/impure boundary was drawn):
1. **Cross-file cases come back as markers, not resolved spans.** `findDefinition` returns
   `{kind:'config-session', name}` for a session ref and `{kind:'imported-call', name, importPaths,
   usePaths}` for an unresolved call — Phase 3's `crossFile.ts`/`configResolution.ts` do the actual
   file reads and turn these into real spans. `findRenameTargets` similarly returns same-file spans
   plus a `crossFile: boolean` flag; the project-wide index (design decision 6) that finds the rest
   is Phase 3's `workspaceIndex.ts`.
2. **`signatureHelp`/`completions`'s "session"/imported-call cases degrade gracefully with no
   extra data**: an action call not defined in this file gets positional `arg1, arg2, …` parameter
   labels (real names need the imported file parsed — Phase 3); a `session` completion with no
   `knownSessions` supplied returns `[]` rather than erroring — Phase 3's `configResolution.ts`
   is expected to always supply that list in practice, but the pure function stays safe without it.

**Phase 3 — `packages/lsp-server`'s I/O layer + protocol wiring**
- `src/workspace/project.ts` — own `findProjectRoot` copy (per-document root walk).
- `src/workspace/configResolution.ts` — loads/parses the owning `tflw.config`, resolves env via
  `@tflw/runtime`'s `selectEnv`/`resolveConfig` with precedence `{ flag: undefined, envVar:
  workspaceSetting['tflw.env'] ?? process.env.TFLW_ENV }` (decision B slots the new setting into
  `selectEnv`'s existing flag/envVar/isDefault/sole-env fallback chain, zero changes to `resolve.ts`
  itself needed).
- `src/workspace/documentStore.ts` — open-document map, debounced full reparse (~150-300ms),
  branches on `tflw.config` vs `*.tflw` to call the right checker functions (decision A folds in
  here: `validateConfig`+`checkSessionServices` for config files, the existing test-file checker set
  otherwise) plus `collectSymbols`/`collectConfigSymbols`.
- `src/workspace/crossFile.ts` — read-only mirror of `buildRegistry`'s import resolution, with a
  path+mtime cache (the runtime has none; a long-lived server re-resolving on every keystroke needs
  one).
- `src/workspace/workspaceIndex.ts` — lazy project-wide `*.tflw` glob mirroring `discoverTests`, for
  cross-file rename only.
- `src/server.ts` — `startServer()`: `createConnection` over stdio, `TextDocuments` sync, registers
  `onDidChangeContent`/`onHover`/`onDefinition`/`onCompletion`/`onRenameRequest`/`onSignatureHelp`,
  each a thin adapter from protocol position params to Phase 2's pure functions.
- Tests: `packages/lsp-server/test/protocol.test.ts` — real in-memory JSON-RPC smoke tests (one per
  capability) over a cross-wired `stream.PassThrough` pair, per decision 17.8.
- Root `package.json`: add `"packages/lsp-server"` to `workspaces`.

**Phase 3 status: done (2026-07-20).** Added `vscode-languageserver`/`vscode-languageserver-
textdocument` dependencies and `@tflw/runtime` to `packages/lsp-server/package.json` (root
`package.json`'s `workspaces` entry already existed, landed early during Phase 2). Built
`src/workspace/{project,configResolution,documentStore,crossFile,workspaceIndex}.ts` and
`src/server.ts`; `src/index.ts` re-exports all of it. Tests: 23 new workspace unit tests
(`test/{project,configResolution,crossFile,workspaceIndex,documentStore}.test.ts`, mkdtemp-fixture-
driven, same pattern as `packages/cli/test/e2e.test.ts`) + 7 `test/protocol.test.ts` cases (one per
capability, a real `vscode-jsonrpc` client talking to `startServer()` over a cross-wired
`stream.PassThrough` pair — genuine LSP wire-protocol round trips, not internal function calls).
`@tflw/lsp-server` is now 62 tests (32 Phase 2 + 30 Phase 3), all passing on first run. Full
workspace (`lang`/`runtime`/`reporter`/`cli`/`vscode`/`lsp-server`) builds, typechecks, and tests
clean: 218/185/12/56/12/62, 0 regressions.

Position conversion turned out simpler than the doc's `TextDocuments`/protocol-position sketch
implied: AST `Span`s already carry 1-based `line`/`column` (the lexer computes them once at parse
time), so **AST → LSP** (`Span` → `Range`) is pure `line - 1`/`column - 1` arithmetic — the exact
approach `packages/vscode/src/lib.ts`'s `spanToZeroBasedRange` already uses for the old spawn-based
diagnostics path, reused here rather than reinvented. Only the reverse direction, **LSP → AST**
(an incoming request `Position` → an absolute offset), genuinely needs `vscode-languageserver-
textdocument`'s `TextDocument#offsetAt` — line/column arithmetic isn't safe there because of
UTF-16 code-unit handling around multi-byte characters — and only for the *currently open* document
`TextDocuments` is already tracking; other project files touched only during cross-file resolution
(an imported action's def, another test file's rename edits) never need this direction, since their
already-line/column-tagged AST spans only ever flow the AST → LSP way.

Two small, deliberately-scoped touch-ups to Phase 2 files, made once their Phase-3 need became
concrete (not new work, and neither changes existing behavior for a caller that doesn't use the new
surface):
1. **`hover.ts`'s `getHover` now takes `Node` instead of `Program`.** Decision A means hover has to
   work on `tflw.config` buffers too, but `getHover`'s body never reads a `Program`-specific field —
   it only threads its first argument through to `findNodeAtOffset`'s already-generic `Node` walk.
   Widening the parameter type is the whole change; the matcher/generator lookup loop still only
   ever matches on config-dialect-absent node types, so config hover falls straight through to the
   (dialect-agnostic) symbol ref/def lookup, unchanged.
2. **`signatureHelp.ts`'s `SignatureHelpResult` gained an optional `unresolvedCallName`.** Set only
   when a call's real parameters aren't resolvable in-file (the positional `arg1, arg2, …` fallback
   case) — Phase 2's own status notes flagged this as "real names need the imported file parsed —
   Phase 3", so Phase 3's `server.ts` uses it to look the call up via `CrossFileResolver` and swap
   in real parameter names when an import resolves it.

`tflw.config`'s own go-to-definition (decision A) turned out to need neither `findDefinition` (which
is `Program`-shaped — `imports`/`uses` don't exist on `ConfigFile`) nor a new resolution function: a
config buffer's only cross-references are same-file (a session body's `capture ... as token` /
`header ... "{token}"` pattern, already resolved by `collectConfigSymbols`'s own `ref.defSpan`), so
`server.ts`'s `onDefinition` handles the config-dialect branch with a direct symbol-table lookup,
no `Program` needed at all.

`CrossFileResolver`'s cache is per-server-instance (one `new CrossFileResolver()` in `startServer()`,
living for the process's lifetime) — matches decision 5/6's stated reason for the cache existing at
all (a long-lived server re-resolving the same import on every keystroke, unlike the CLI's one-shot
`buildRegistry`), and needs no invalidation policy beyond the mtime check already built in, since a
new server process starts per editor session.

**Phase 4 — `packages/cli`'s `lsp` subcommand**
- `cli.ts`: `case 'lsp': return lspCommand(rest);` alongside the existing `docs` case; `lspCommand`
  mirrors `docsCommand`'s minimal shape, calls `startServer()`, resolves only when the connection
  closes; usage-string/error-message updates to mention `lsp` alongside `run`/`check`/`init`/`docs`.
- `package.json`: `@tflw/lsp-server` as a `devDependency` (bundled by esbuild, same pattern as
  `@tflw/lang`/`@tflw/runtime`/`@tflw/reporter` today — no `external` list change needed, follows
  the `undici`/`ajv` precedent exactly).
- New `packages/cli/test/lsp.test.ts` — spawn the *built* `dist/cli.cjs lsp` (same e2e pattern as
  the existing `e2e.test.ts`), send a raw `Content-Length`-framed `initialize` JSON-RPC request over
  stdin, assert a well-formed response on stdout before killing the process.

**Phase 4 status: done (2026-07-20).** Added `@tflw/lsp-server` as a `packages/cli` devDependency
and to its `prepack` script's explicit pre-build list. Also reordered root `package.json`'s
`workspaces` array (`lsp-server` now sits before `cli`, was listed after it) — `npm run build
--workspaces` runs packages strictly in that array's order with no automatic topological sort, so a
genuine from-scratch build failed with esbuild's `Could not resolve "@tflw/lsp-server"` until this
was caught by deliberately deleting both packages' `dist/` and re-running (never previously
exercised, since `packages/lsp-server` had no dependent before this phase — Phase 2/3 only ever
built it standalone).

Wired `case 'lsp'` into `cli.ts`'s dispatch and the usage string. `lspCommand` turned out simpler
than the plan sketch above ("resolves only when the connection closes") once tried against the
real built binary: `startServer()`'s underlying `vscode-languageserver` `createConnection()` already
registers `end`/`close` listeners directly on the input stream and calls `process.exit()` itself —
0 after a proper LSP `shutdown` request + `exit` notification handshake, 1 on an abrupt pipe close
(the spec-correct behavior, not something this command needs to reimplement). So `lspCommand` just
calls `startServer()` and returns a promise that never resolves, keeping `main()`'s own
`.then((code) => process.exit(code))` from firing right after setup instead of once the connection
actually ends. Confirmed by trial that any exit-handling attempted inside `lspCommand` itself would
only race the library's own listeners and lose: a `process.stdin.once('close', ...)` handler
registered *before* calling `startServer()` still never fired — the library's own `end` listener
(registered synchronously inside `startServer()`) always calls `process.exit()` first.

New `packages/cli/test/lsp.test.ts` (3 tests; hand-rolled `Content-Length` framing rather than a
jsonrpc client library, matching `e2e.test.ts`'s "run the real built binary" black-box pattern): the
`initialize` response advertises every Phase 3 capability; a full `initialize`/`initialized`/
`shutdown`/`exit` handshake exits 0; stdin closing with no `shutdown` request exits 1 — the second
and third cases went beyond the plan's original single-assertion sketch once the real exit-code
behavior above was discovered, since a silently wrong exit code here is exactly the kind of thing
that reads fine in-process but breaks a real editor's shutdown flow.

`packages/cli` is now 59 tests (was 56). Full workspace
(`lang`/`runtime`/`reporter`/`lsp-server`/`cli`/`vscode`) builds, typechecks, and tests clean from a
genuine from-scratch build (both new dist/ dirs deleted first): 218/185/12/62/59/12 tests, 0
regressions.

**Phase 5 — `packages/vscode` rewrite**
- `package.json`: `vscode-languageclient` devDependency; new `contributes.configuration` block
  (`tflw.env`, first one this extension has ever had).
- `extension.ts`: delete `runCheckJson`, the spawn-based body of `updateDiagnostics`,
  `toVscodeDiagnostic`, the diagnostics-driving `onDidSave/onDidOpen/onDidClose` listeners, and
  `isTflwTestFile`'s `.tflw`-only exclusion (decision A means config files get real diagnostics now
  — no filter wanted). Add a `LanguageClient` construction (`ServerOptions = { command:
  resolveTflwBin(root), args: ['lsp'] }`, `documentSelector: [{ language: 'tflw' }]` — covers both
  dialects), started in `activate()`. Keep `TflwCodeLensProvider`, `runInTerminal`,
  `resolveTargetUri`, the run commands — all client-side, untouched per decision 17.3.
- `lib.ts`: remove `spanToZeroBasedRange`/`RawDiagnostic` (dead after the spawn-path deletion —
  confirm via grep nothing else references them first); keep `findProjectRoot`/`resolveTflwBin`/
  `parseTestDeclarationLine` (still needed for CodeLens run-in-terminal + the client's own launch).
- `test/lib.test.ts`: drop the now-dead test cases for the two removed exports.
- `test/grammar.test.ts`: unrelated, confirm untouched.

**Phase 5 status: done (2026-07-20).** Added `vscode-languageclient` (`^10.1.0`, paired with
`@tflw/lsp-server`'s own `vscode-languageserver` version) as a `packages/vscode` devDependency —
bundled by `scripts/bundle.mjs` same as everything else in `src/`, since only `vscode` itself is on
esbuild's `external` list. Added a `contributes.configuration` block for `tflw.env` (first setting
this extension has ever had).

`extension.ts` rewrite: deleted `runCheckJson`, `toVscodeDiagnostic`, the `onDidSave`/`onDidOpen`/
`onDidClose` diagnostics listeners, the `diagnostics` `DiagnosticCollection`, `warnedMissingBinary`,
and `isTflwTestFile` (no exclusion filter needed now — decision A means `tflw.config` wants
diagnostics too). Added a `LanguageClient` construction, `documentSelector: [{ language: 'tflw' }]`
(covers both dialects, same selector `TflwCodeLensProvider` already used), `ServerOptions = {
command: resolveTflwBin(root), args: ['lsp'], transport: TransportKind.stdio, options: { cwd: root
} }`, started in `activate()` and stopped via `deactivate()` + a `context.subscriptions` disposer.
Kept `TflwCodeLensProvider`, `runInTerminal`, `resolveTargetUri` untouched (client-side only, per
decision 17.3).

One addition beyond the plan's sketch, needed once actually wired up: **`resolveWorkspaceRoot()`**.
The old per-document `updateDiagnostics(doc)` could call `findProjectRoot(dirname(doc.fileName))`
fresh for whichever document just changed; a `LanguageClient` has to pick *one* root at `activate()`
time, before that's necessarily known. Since `onLanguage:tflw` is this extension's activation event,
an already-open `tflw`-language document is the common case — `resolveWorkspaceRoot()` tries that
first (`findProjectRoot` from its directory), then falls back to walking up from each open workspace
folder. A single client for the common single-tflw-project-per-window case, matching every other
root-resolving call site in this codebase (none of which support multi-root either); if no root
resolves at all, `activate()` still registers CodeLens/run commands and simply skips starting a
client, rather than erroring.

Decision B (`tflw.env`) wiring: `clientOptions.initializationOptions = { env:
vscode.workspace.getConfiguration('tflw').get<string>('env') }` supplies the setting on the
`initialize` request (`server.ts`'s `onInitialize` reads `params.initializationOptions.env`), and
`clientOptions.synchronize = { configurationSection: 'tflw' }` makes `vscode-languageclient` push a
`workspace/didChangeConfiguration` notification shaped `{ settings: { tflw: { env } } }` whenever the
setting changes afterward — exactly the shape `server.ts`'s `onDidChangeConfiguration` already
expects. No server-side change needed; Phase 3 had already built the receiving end.

`lib.ts`: removed `RawDiagnostic` and `spanToZeroBasedRange` (dead — grepped first, only remaining
reference is a historical comment in `lsp-server/src/server.ts` explaining where its own `toLspRange`
took the 1-based→0-based math idea from, left as prose). Kept `findProjectRoot`/`resolveTflwBin`/
`parseTestDeclarationLine` — still needed for CodeLens run-in-terminal and the client's own launch.
`test/lib.test.ts` dropped the two now-dead `spanToZeroBasedRange` cases; `test/grammar.test.ts`
confirmed untouched (unrelated, tokenizer-only).

No new automated test suite for the `LanguageClient` wiring itself, unlike Phase 4's 3 new e2e
tests — `extension.ts` can only run inside a real extension host (`vscode` isn't a real installable
module, only its types are), which is exactly why `lib.ts` exists as the vscode-independent split in
the first place, and was already true of the diagnostics/CodeLens code this phase replaced. The
manual Extension Development Host walkthrough already specified in this plan's Verification section
is the actual proof for this phase; not re-run as part of this automated pass. `packages/vscode` is
now 10 tests (was 12 — net effect of −2 dead cases removed, 0 added, since the new code is
untestable outside a live host). Full workspace
(`lang`/`runtime`/`reporter`/`lsp-server`/`cli`/`vscode`) builds, typechecks, and tests clean from a
genuine from-scratch build (all six packages' `dist/` deleted first): 218/185/12/62/59/10 tests, 0
regressions.

**`tflw.config` scope (decision A) is not a separate phase** — folded into Phase 3
(`documentStore.ts`'s dialect branch) and Phase 5 (`documentSelector` covering both, no exclusion
filter).

## PLAN.md decision 104 / PROGRESS.md M13 — written last

Only after all 5 phases are implemented and verified, following the exact M9-M12 precedent:
1. `PLAN.md` decision **104** — lettered sub-parts mirroring decision 103's structure, each citing
   real file:line evidence, folding in the two session-scoped additions (A/B) as their own sub-parts
   or notes on the relevant existing one.
2. `PROGRESS.md` milestone **M13** — checklist + "Verified by" with real before/after test counts
   across all 6 now-tested packages, one-line cadence-exception note (no testFlow-tests consumption,
   per decision 17's exception) instead of a consumption section.
3. `CHANGELOG.md` — one bullet.
4. `PLAN_ENTERPRISE.md` — decision 17's status line flipped to shipped, referencing decision 104
   (mirroring how decision 16's line already points at 103).

## Verification

- **Per phase**: `npm test`/`npm run typecheck`/`npm run build` (scoped to the touched package)
  green after each phase, before moving to the next — Phase 1's lang suite (existing + new
  symbols/completion tests) must stay green with zero changes to existing parser test expectations.
- **Phase 4's stdio check**: manual `node packages/cli/dist/cli.cjs lsp` run, a raw
  `Content-Length`-framed `initialize` request piped to stdin, confirming a valid response on
  stdout — the concrete "reachable outside VS Code" proof decision 17.2/17.4 implies, without
  requiring a Neovim/other-editor install.
- **End of arc**: full workspace `npm run build && npm run typecheck && npm test` clean across all 6
  packages (lang/runtime/reporter/cli/vscode/lsp-server), 0 regressions from the pre-M13 baseline.
- **Manual VS Code session** against `testFlow-tests`' real `.tflw` suite (Extension Development
  Host): all six capabilities exercised by hand — live diagnostics on an introduced typo/unknown
  session without saving (proves debounced in-process reparse replaced the old save-triggered
  spawn); hover on a matcher and a generator; go-to-def on a `let`-bound variable, a session name
  (jumps into `tflw.config`), and an imported action name (jumps into the imported file);
  autocomplete at each of the 6 instrumented positions; rename of a captured variable (all in-file
  refs update) and of an imported action (cross-file edit lands in the importing file too);
  signature help on `unique(` and a user action call. Also: set `tflw.env` to a non-default env and
  confirm `checkServices`/`checkSessions` diagnostics shift accordingly (decision B proof); open
  `tflw.config` directly and confirm it now gets diagnostics where the old extension gave none
  (decision A proof).
- **Standing rule**: this plan is implementation only — no commit or push happens as part of
  executing it. A commit only happens on an explicit follow-up request, matching this session's
  established pattern (confirmed again for M12's docs-site fix commit).
