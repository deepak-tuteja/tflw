---
layout: home

hero:
  name: tflw
  text: A testing-only DSL for API tests
  tagline: Reports first, syntax second. v0.1.0 is API-only — the browser half lands in 0.2.0.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Guide
      link: /guide/first-test
    - theme: alt
      text: Try it in your browser
      link: /playground

features:
  - title: Reporting-first runtime
    details: Every step is an event by construction — a self-contained report.html (full request/response detail), junit.xml, and results.json all fall out of the same event stream tflw run already emits, secrets redacted everywhere automatically.
  - title: Teaching-quality diagnostics
    details: Source line + caret + "did you mean", stable TF0xx codes, a conservative unknown-variable checker pass — errors read like a compiler's, not a stack trace.
  - title: One language, API today, browser next
    details: 0.2.0 adds UI steps to the same grammar, so a login → seed-via-API → drive-UI → assert-backend-state test stays one readable file instead of gluing two tools together.
  - title: Real editor support
    details: A real Language Server Protocol implementation (tflw lsp) powers the VS Code extension — diagnostics, hover, go-to-definition, autocomplete, rename, signature help, and semantic highlighting, live as you type.
---

## Why tflw

Compared to writing API tests by hand with `fetch` + a general-purpose test runner:

- **Reporting is built in, not bolted on.** Every step is an event by construction — `report.html`,
  `junit.xml`, and `results.json` all fall out of the same run, with secrets redacted everywhere
  automatically. No logging or capture code to write yourself.
- **Errors read like a compiler's, not a stack trace.** Source line + caret + "did you mean",
  stable `TF0xx` codes you can look up, a conservative unknown-variable checker pass.
- **One language, not several tools glued together.** Sessions, retries, generated test data, and
  data-driven tables are grammar, not helper functions you maintain per project.

Compared to other dedicated tools: if you already have **Karate** working for your team, its
Java/Gherkin ecosystem and maturity are a real reason to stay. **Hurl**'s single-file, no-runtime
`.hurl` scripts are a better fit for simple curl-replacement smoke checks than a full DSL.
