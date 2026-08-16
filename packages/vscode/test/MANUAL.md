# Manual verification — what this suite structurally cannot cover

Every test in this directory runs against a **mock** `vscode` module. `tsconfig.test.json`'s `paths`
remap the `vscode` and `vscode-languageclient/node` specifiers to `test/mocks/*.ts`, which is what
makes `activate()` testable at all without an Extension Host (see the header of
`extension.test.ts`). The trade is exact and worth stating plainly: **these tests prove we hand VS
Code the right wiring; they cannot prove VS Code does anything with it.** Nothing in CI has ever
started a real Extension Host.

So the manifest tests assert that a contributed language has an `onLanguage:` activation event, a
grammar, and a `semanticTokenScopes` map — they do not assert that the editor then *activates*,
*tokenizes*, or *colours*. Everything below is the part a human has to look at.

## How to run the extension for real

From the repo root:

```sh
npm run build -w tflw-vscode
code --extensionDevelopmentPath="$PWD/packages/vscode"
```

That opens a second VS Code window ("Extension Development Host") with this working copy of the
extension loaded and any installed release of it disabled. Open a real tflw project in it — one with
a `tflw.config` and at least one `.tflw` file — not a scratch folder, so `import` resolution and
`session` lookup have something to resolve against. `testFlow-tests` is the obvious one; **this repo
is not**, because it has no root `tflw.config`, and `activate()` returns before starting the server
when `resolveWorkspaceRoot()` finds none.

**Build the CLI too, not just the extension.** The client spawns `<root>/node_modules/.bin/tflw lsp`
— i.e. the tflw *installed into the project you open*, not this working copy. In `testFlow-tests`
that is a packed tarball, so run `npm run refresh-tflw` there after any change to the server half,
or the manual pass silently checks a new editor against an old server.

**No theme or font setup is needed, and that is a property of the design rather than luck.** The
extension contributes no `themes` and no `colors`; every scope its grammars emit is standard
TextMate vocabulary with a `.tflw` suffix (`keyword.control.tflw`, `support.type.tflw`, …), and
theme rules match by dot-segment prefix, so a stock theme already has a rule for each. Measured
against the shipped defaults (Dark+, Light+, Dark Modern, 2026 Dark): **15 of the 16 grammar scopes
and all 8 `semanticTokenScopes` fallback targets are coloured by every one of them.** The sixteenth
is `punctuation.separator.pipe.tflw`, and those themes carry no generic `punctuation` rule at all —
separators render at the editor foreground in every language, so that is the norm, not a gap. Worth
knowing while reading check 7: **none of the eight semantic token types has a direct
`semanticTokenColors` rule in any default theme**, so the `semanticTokenScopes` map is not a
nicety — it is the only path by which a semantic token gets a colour there.

## The checklist

Do both dialects. The two are separate language ids (`tflw` and `tflw-config`, `M136b`/D427a) and
almost every wiring site has to be widened for each, so a check that only opens a `.tflw` file
passes on a half-broken extension.

**In a `.tflw` file**

1. Keywords, strings, comments, `env(...)` and `capture` targets are coloured.
2. Introduce an error (`expct status equals 200`) — a squiggle appears, carrying a `TF0xx` code and
   its hint.
3. Completion, hover, signature help and go-to-definition respond.
4. The *Run this test* / *Run all tests in this file* CodeLenses appear above each `test`.

**In `tflw.config`** — this is the one `M136b` is about, and the one no automated gate reaches

5. **The extension activates at all.** Close every other editor tab first, so `tflw.config` is the
   only document open, then reload the window. If the status bar shows no language server and
   nothing below works, the `onLanguage:tflw-config` activation event is missing — the failure is
   silent and total, and it is exactly what `M136b` found `D427` had not counted.
6. The bottom-right language indicator reads **tflw config**, not `tflw` and not `Plain Text`.
7. The config-only vocabulary is coloured: `allow hosts`, `cert`, `key`, `evidence`, `redact`,
   `viewport`, `destination`, `level`, `query`, and the whole `oauth2` block (`token`, `client`,
   `id`, `secret`, `scope`). If the grammar half works but these lose their colour the moment the
   server finishes analysing, the `semanticTokenScopes` map for `tflw-config` is missing — the
   editor is discarding correctly-classified tokens.
8. **Diagnostics, completion and hover still arrive** — the split moved the document selector, and a
   selector that lost this id would leave the file syntax-highlighted and otherwise dead. Write
   `test "x"` into the config: `TF021` should squiggle.
9. Those same words are still *not* coloured as keywords in a `.tflw` file (`let key = ...`,
   `let web = ...`). The point of the split is that the vocabulary does not leak.

**Unsaved buffers.** A new untitled tab set to the `tflw` language gets highlighting, diagnostics,
hover, completion, signature help and in-file rename, and does **not** get anything needing a path
(cross-file go-to-definition, `session` names from `tflw.config`, `import` resolution). Both halves
are the assertion.

## Log it

Record the result — including "did not run" — in the milestone's ledger entry. `M136b` shipped with
this unperformed and said so; that is honest, and a row nobody ever ticks is the failure mode.
