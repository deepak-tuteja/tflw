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
`session` lookup have something to resolve against.

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
