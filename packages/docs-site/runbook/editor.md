# Working in the editor

The VS Code extension is how a suite is worked on day to day: the checker underlines as you
type, your tests are in the Test Explorer, and a repeated step window is one code action away
from being an `action`.

## Install

Until 1.0 the extension is a `.vsix` attached to a
[GitHub release](https://github.com/deepak-tuteja/tflw/releases): download it, then

```sh
code --install-extension tflw-vscode-0.1.0.vsix
```

or **Extensions: Install from VSIX…** in the command palette. On 1.0 day it is listed on the
Visual Studio Marketplace and Open VSX, and this becomes one `ext install` line.

The extension starts your project's own `tflw lsp` — `node_modules/.bin/tflw` under the nearest
`tflw.config` — so the version that underlines a file is the one CI runs. Install tflw in the
project first ([Installing tflw](/runbook/install)).

## The Test Explorer

The beaker icon lists every `.tflw` file in the workspace and the tests in it. **Run** on a file
runs `tflw run <file>`; on a test, `tflw run <file> --only "<name>"`. A test turns green, red or
grey (skipped, with its reason) as tflw reports it; a failure opens at the step that failed with
tflw's own message, `expected status to equal 201, but got 500`. The run's output names its
`report.html`.

**tflw: Re-run the previous run's failed tests** is `tflw run --failed`. The **▶ Run test** and
**▶ Run file** lenses above each `test` line run through the same explorer, so a lens run and an
explorer run are one result.

## Outline, references and folding

The Outline view and the breadcrumbs list a file's tests, actions, elements and hooks — a
`tflw.config`'s envs and sessions. **Find All References** on an action finds every file that
imports and calls it; on a session, every test that runs `as` it and its declaration in
`tflw.config`. Every block folds, and so does a run of comment lines.

## Code actions

Each reuse hint `tflw check` prints is a code action on the lines it covers: **Extract into action
`post orders` (RF001)** or **Extract into element `cartBadge` (RF002)**. It makes the same edit
`tflw refactor apply RF001` makes, byte for byte, as one undoable change across every file it
touches. A diagnostic whose help line says *did you mean `expect`?* offers **Change to `expect`**.

## Other editors

`tflw lsp` is a language server over stdio, so any editor with an LSP client gets the same
diagnostics, completion, hover, outline, references, folding and code actions: start
`npx tflw lsp` with the directory holding `tflw.config` as its working directory, for files named
`*.tflw` and `tflw.config`. The Test Explorer is the VS Code extension's own; elsewhere, run tests
from a terminal.
