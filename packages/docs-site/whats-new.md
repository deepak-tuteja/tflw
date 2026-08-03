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
- Load and performance testing — `ramp`/`hold`/`step`/`spike` workloads, latency/error-rate
  thresholds, `--workers N` for multi-process load generation, and a generator self-diagnosis so a
  saturated tflw process never masquerades as a real bottleneck. Validated against k6 and Artillery
  on a real application — see [Load testing](/guide/load-testing#validated-against-k6-and-artillery).

## Coming next

- Security-testing features.
- A first public npm release, once the security arc above lands alongside one final acceptance pass.
