# tflw for VS Code

Language support for **testFlow** — an external DSL for API, browser and load testing, written in
`.tflw` files and run by the [`tflw`](https://www.npmjs.com/package/tflw) CLI.

```tflw
test "a customer can check out"
  api POST /login { "email": "{email}", "password": env(PASSWORD) }
  expect status equals 200
  capture token from body.accessToken

  open "/cart"
  click button "Checkout"
  expect text "Order confirmed" is visible
```

## What it does

- **Syntax highlighting** for `.tflw` files and `tflw.config`, including semantic token scopes so
  captures, env references and matchers stay distinguishable from ordinary strings.
- **Inline diagnostics** from a real Language Server — the same checker the CLI runs, so an editor
  squiggle and a `tflw check` failure are never two different opinions. Every diagnostic carries its
  `TF0xx` code and the same teaching hint the terminal prints.
- **Completion, hover, signature help and rename**, plus **go-to-definition** that follows a
  `capture`/`let`/parameter binding to where it came from, a `session` reference into `tflw.config`,
  and an `action` call into the file that `import`s or `use`s it.
- **Unsaved buffers work too.** A new, never-saved tab gets highlighting, diagnostics, hover,
  completion, signature help and in-file rename. What it cannot get is anything that needs a
  location on disk — the `session` and service names declared in your `tflw.config`, `import`
  resolution, and go-to-definition or rename *across* files — because a file with no path has
  nothing to resolve `./shared/orders.tflw` against. Save it into your project and those light up.
- **Rename checks the name.** A replacement has to be a name the language accepts — starting with a
  letter or `_`, continuing with letters, digits or `_` — and you get told why if it isn't, instead
  of a rename that silently leaves the file unparseable. tflw's keywords are contextual, so
  `status`, `let` and `expect` are all legal variable names and are not refused.
- **Run CodeLenses** above every `test` and at the top of every file: *Run this test* and *Run all
  tests in this file*, which shell out to your project's own `tflw` binary.
- **Snippets** for the shapes worth not retyping: a `test` skeleton, an `expect`, a `session`, the
  four hook forms (`before`, `before file`, `after`, `after file`), and a data-driven `with each`
  table.

## Requirements

The extension drives your project's own CLI, so a `.tflw` file needs one installed:

```sh
npm install -D tflw
```

It resolves `node_modules/.bin/tflw` from the nearest directory containing a `tflw.config`, falling
back to `tflw` on your `PATH`. Nothing is bundled or downloaded — the version that lints your file
is the version your project pinned, and the version CI will run.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `tflw.env` | *(unset)* | The `env` block from `tflw.config` to check and run against. Unset uses the `default` env. |

## Documentation

- [README](https://github.com/deepak-tuteja/tflw#readme) — install, quickstart, the CLI surface
- [SPEC.md](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md) — the language reference
- Issues and questions: [github.com/deepak-tuteja/tflw/issues](https://github.com/deepak-tuteja/tflw/issues)

## License

MIT — see `LICENSE`. Bundled third-party code and its licenses are listed in
`THIRD-PARTY-NOTICES.md`, shipped inside the extension.
