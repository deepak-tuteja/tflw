# Changelog

The extension's own changes. tflw's are in the repository's
[`CHANGELOG.md`](https://github.com/deepak-tuteja/tflw/blob/main/CHANGELOG.md); the extension
starts the `tflw lsp` your project installs, so most of what it can do arrives there.

## 0.1.0 — unreleased

Installed from a `.vsix` attached to a GitHub release until 1.0 day, when it is listed on the
Visual Studio Marketplace and Open VSX.

- **The Test Explorer.** Every `.tflw` file in the workspace and its tests. Run a file, a test or
  the previous run's failures; each test's verdict shows where it is written, a failure at the
  step that failed, and the run's `report.html` is linked from its output. The ▶ lenses above a
  test run through it.
- **An outline, references and folding.** Tests, actions, elements and hooks in the Outline view
  and the breadcrumbs, `tflw.config`'s envs and sessions likewise; *Find All References* over the
  file and, for an action, session or element, every file that uses it; every block folds.
- **Code actions.** *Extract into action* and *Extract into element* for each reuse hint
  `tflw check` prints, writing exactly what `tflw refactor apply` writes; a quick fix for every
  diagnostic that says *did you mean*.
- Highlighting, diagnostics, hover, go to definition, completion, rename, signature help,
  semantic colours and format-on-save, for `.tflw` files and `tflw.config`.
