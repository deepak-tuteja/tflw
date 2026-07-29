---
title: What's new
---

# What's new

A short, scannable summary — recent highlights and what's coming next. For the complete,
version-by-version record, see the [Changelog](/changelog).

## Recently shipped

- Browser testing — clicking, filling forms, drag-drop, downloads, tabs, frames, dialogs — in the
  same `.tflw` file and grammar as API steps: one language for a login → seed-via-API → drive-UI →
  assert-backend-state test.
- Network stubbing, request-observation assertions, accessibility checks, and visual-regression
  snapshots.
- `tflw watch` (live headed re-run on save) and `tflw pick` (click an element, get its locator).
- A real Language Server Protocol implementation powering the VS Code extension — diagnostics,
  hover, go-to-definition, autocomplete, rename, signature help, and live semantic highlighting.
- Duplication hints (`tflw check`) plus a one-command refactor (`tflw refactor apply`) to extract
  shared logic, and `tflw migrate` for safe, mechanical upgrades down the line.
- User-defined logging: a `log` statement with levels and a console/HTML destination, so a test can
  narrate what it's doing in its own words.

## Coming next

- Performance and load testing.
- Security-testing features.
- A first public npm release, once both arcs above land alongside one final acceptance pass.
