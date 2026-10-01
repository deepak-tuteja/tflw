# 8. The editor

Everything so far ran from a terminal. Day to day, a suite is written in an editor, and tflw's VS
Code extension gives you the same checks `tflw check` runs, underlined as you type, plus your tests in
VS Code's Test Explorer with a run button beside each.

## Install the extension

<Published :when="false">

Until 1.0 the extension is not on the Marketplace, so it is packaged from the clone chapter 1 made.
`npm run package` writes one `.vsix` file, which VS Code installs as it would a download. The last
line opens the project:

```sh runbook-manual
cd ../tflw
npm run package -w tflw-vscode -- -o tflw.vsix
code --install-extension tflw.vsix
cd ../coffee-shelf
code .
```

This is a declared exception to *every command is run*: the check has no clone, and no VS Code
window to install into.

</Published>

<Published>

```sh runbook-manual
code --install-extension deepak-tuteja.tflw-vscode
code .
```

(or search for **tflw** in the Extensions view, then open the project). This is a declared exception to *every command is
run*: the check has no VS Code window to install into.

</Published>

The extension runs **your project's own tflw**, the one in `node_modules`, so what it underlines is
what `tflw check` reports and what CI runs. Open `tests/my-order.tflw` from chapter 4 and change
`equals` to `equal`: the line is underlined before you save, with the same message `tflw check`
prints, and **Quick Fix** offers the spelling it meant.

## The Test Explorer

The beaker icon lists every `.tflw` file and the tests in it. Run one test, one file or all of them;
each turns green or red as tflw reports it, and a failure opens at the step that failed with tflw's
own message. **▶ Run test** above each `test` line does the same from the file. The repeated steps
`refactor apply` extracted in chapter 4 are offered here too, as a code action on the lines.

## Other editors

The extension is a thin client for `tflw lsp`, a language server, which any editor that speaks the
Language Server Protocol can run: Neovim, Helix, Zed, Sublime Text, Emacs. Point the editor's
language-server setting for `.tflw` files at this command, run from the project's directory:

```sh runbook-manual
npx tflw lsp
```

You do not run it yourself: it talks to the editor over its input and output and waits for one to
connect. It is a declared exception for that reason.

## You now have

The project open in an editor that checks as you type and runs tests from the Test Explorer.
Nothing in the project changed.

## Next, or instead

- **Next:** [9. CI](/runbook/start/ci).
- Everything the extension does, including references, folding and refactors:
  [Working in the editor](/runbook/editor).
- Every diagnostic code and what it means: [Diagnostics](/reference/diagnostics).
