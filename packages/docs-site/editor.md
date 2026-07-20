# Editor support

<script setup>
// `ClientOnly` is a default-theme global component — no import needed (same as playground/index.md).
// Every widget below runs the *real* @tflw/lang / @tflw/lsp-server/pure logic client-side — the
// same functions the LSP itself calls — against an editable or fixed .tflw sample. Not screenshots,
// not staged: genuinely live (decision 107).
import HighlightingDemo from './editor/HighlightingDemo.vue';
import DiagnosticsHoverDemo from './editor/DiagnosticsHoverDemo.vue';
import AutocompleteDemo from './editor/AutocompleteDemo.vue';
import GoToDefinitionDemo from './editor/GoToDefinitionDemo.vue';
import RenameDemo from './editor/RenameDemo.vue';
import SignatureHelpDemo from './editor/SignatureHelpDemo.vue';
</script>

`tflw lsp` is a real [Language Server Protocol](https://microsoft.github.io/language-server-protocol/)
implementation — diagnostics, hover, go-to-definition, autocomplete, rename, signature help, and
rich semantic highlighting, all live over debounced in-process reparsing. It speaks standard LSP
over stdio, so any LSP-capable editor can use it; VS Code is the first-class client shipped today,
via the `tflw` extension (`packages/vscode` in the repo).

Everything below works for both `.tflw` test files and `tflw.config` — one server, one grammar,
two dialects. Every demo on this page runs the exact same resolver code the language server
does, client-side — not a screenshot or a recording.

## Install

The extension isn't on the VS Code Marketplace yet (a listing is planned for later — this section
will shrink to one `ext install` line once it ships). For now, install it from a checkout:

```sh
git clone https://github.com/deepak-tuteja/tflw.git
cd tflw && npm ci && npm run build
cd packages/vscode && npx @vscode/vsce package --no-dependencies
code --install-extension tflw-vscode-0.1.0.vsix
```

Reload VS Code, open a `.tflw` file or a `tflw.config`, and the extension activates automatically.

## Syntax highlighting + semantic coloring

Coloring comes from two layers. A static TextMate grammar handles tflw's fixed vocabulary
(keywords, strings, `api` methods, matcher words). On top of that, the language server also serves
`textDocument/semanticTokens/full` — it colors things the grammar structurally can't (variable/
parameter names, object-literal field keys — arbitrary user-chosen text, not fixed vocabulary) and
fills in matcher/operator words and numeric literals using your editor's own semantic color
palette, independent of whichever theme is active.

Below is the real classifier's output on a representative snippet, colored by category (the
palette here is illustrative, not a specific VS Code theme — how rich this looks in your own editor
depends on how much semantic-token coverage your theme defines; VS Code's own bundled default theme
is sparser here than a fuller theme like One Dark Pro, but the extension never overrides your
theme's colors, it only supplies the tokens for your theme to color):

<ClientOnly>
  <HighlightingDemo />
</ClientOnly>

## Diagnostics + hover

Diagnostics update live as you type — the same teaching-quality errors the CLI prints (source line
+ caret + "did you mean", stable `TF0xx` codes; see [Getting started](/getting-started) and
[CI, reporting & safety](/guide/ci-and-reporting)), surfaced as inline squiggles. Hover over one for
the full message and hint without leaving the line:

<ClientOnly>
  <DiagnosticsHoverDemo />
</ClientOnly>

## Autocomplete

Context-aware completion for keywords, matcher/generator words, and in-scope variable, parameter,
and action names — narrowed to what's actually valid at the cursor:

<ClientOnly>
  <AutocompleteDemo />
</ClientOnly>

## Go to definition

Jump from a variable, parameter, or action reference straight to where it's defined — across
`import`ed files too:

<ClientOnly>
  <GoToDefinitionDemo />
</ClientOnly>

## Rename

Rename a variable, parameter, or action everywhere it's used — including inside string and path
interpolation holes (`"{name}"`, `/orders/{orderId}`) — in one edit:

<ClientOnly>
  <RenameDemo />
</ClientOnly>

## Signature help

A parameter hint while calling an action, so you don't have to jump to its definition to remember
its shape:

<ClientOnly>
  <SignatureHelpDemo />
</ClientOnly>

## Run from the editor

Every `test "..."` line gets two CodeLenses: **▶ Run test** (runs just that test, via `--only`) and
**▶ Run file** (runs every test in the file). Both shell out to the same `tflw` binary the
[CLI reference](/reference/cli) covers, in a shared integrated terminal.

## Settings

- **`tflw.env`** — which `tflw.config` environment diagnostics resolve services/sessions against
  (the same precedence slot as `tflw run --env`/`TFLW_ENV`). Leave unset to use the config's
  default or sole environment.
