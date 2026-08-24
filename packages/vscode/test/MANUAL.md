# Manual verification — what this suite structurally cannot cover

Every test in this directory runs against a **mock** `vscode` module. `tsconfig.test.json`'s `paths`
remap the `vscode` and `vscode-languageclient/node` specifiers to `test/mocks/*.ts`, which is what
makes `activate()` testable at all without an Extension Host (see the header of
`extension.test.ts`). The trade is exact and worth stating plainly: **these tests prove we hand VS
Code the right wiring; they cannot prove VS Code does anything with it.** Nothing in CI has ever
started a real Extension Host.

The `P#n`/`D<n>`/`M<n>` citations below name blocks in design records this repository does not
publish; each resolves in [DECISIONS.md](https://github.com/deepak-tuteja/tflw/blob/main/DECISIONS.md).

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
   `id`, `secret`, `scope`).

   **Colour alone cannot check this half, and an earlier draft of this line said it could.** The
   claim was that a missing `semanticTokenScopes` map shows up as these words "losing their colour
   once the server finishes analysing". They do not: the semantic token is discarded and the
   *grammar's* colour stays exactly as it was, so the file looks untouched. Worse, the two layers
   are painted from the same palette by construction — no default theme has a
   `semanticTokenColors` rule for any of the eight types, so a semantic token can only reach a
   colour through this map, and the map's targets (`keyword.control.tflw`, `support.type.tflw`, …)
   are the scopes the grammar already uses. An applied semantic token and a discarded one are
   pixel-identical in every shipped theme. Following the old wording, a human sees no colour loss
   and records a pass on a check that never ran.

   Use the editor's own instrument instead: **`Cmd/Ctrl+Shift+P` → "Developer: Inspect Editor
   Tokens and Scopes"**, then click a config-delta word — `oauth2` or `scope` are the good ones,
   being in the delta *and* in the server's vocabulary. Read three rows:
   - **`language`** must be `tflw-config` (this is also check 6, told to you by the editor rather
     than by the status bar);
   - **`semantic token type`** must be present — `keyword` for these — which is the server having
     classified the token *and* the editor having accepted it;
   - the **foreground** under it must resolve through **`keyword.control.tflw`**. That string is
     the proof: it is what *our* map sends `keyword` to, whereas VS Code's built-in fallback for a
     standard type would land on plain `keyword`. Seeing our scope name means the `tflw-config`
     entry is live.

   The `textmate scopes` row at the bottom should independently read `keyword.control.tflw` +
   `source.tflw.config`, which is the delta grammar. Both layers agreeing on one word is the
   strongest single observation available here.
8. **Diagnostics, completion and hover still arrive** — the split moved the document selector, and a
   selector that lost this id would leave the file syntax-highlighted and otherwise dead. Write
   `test "x"` into the config: `TF021` should squiggle.
9. Those same words are still *not* coloured as keywords in a `.tflw` file (`let key = ...`,
   `let web = ...`). The point of the split is that the vocabulary does not leak. Inspect `key`
   the same way: `language` `tflw`, `semantic token type` **`variable`**, and `textmate scopes`
   reading `source.tflw` *alone* — no keyword scope at all. Both layers have to agree here too;
   a leak in either one is a leak.

**Unsaved buffers.** A new untitled tab set to the `tflw` language gets highlighting, diagnostics,
hover, completion, signature help and in-file rename, and does **not** get anything needing a path
(cross-file go-to-definition, `session` names from `tflw.config`, `import` resolution). Both halves
are the assertion.

## Log it

Record the result — including "did not run" — in the milestone's ledger entry. `M136b` shipped with
this unperformed and said so; that is honest, and a row nobody ever ticks is the failure mode.
