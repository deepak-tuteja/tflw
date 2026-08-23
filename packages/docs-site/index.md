---
layout: home

hero:
  name: tflw
  text: Test <span class="hero-accent">APIs and browsers</span> in one language.
  tagline: Reports first, syntax second — a self-contained report.html, junit.xml, and teaching-quality diagnostics fall out of every run, no glue code between tools. Four pillars share one grammar — API, browser, load (validated against k6 on real contended workloads) and security scanning. Pre-1.0, not yet published.
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
    link: /guide/ci-and-reporting
    linkText: Reporting & CI
  - title: Teaching-quality diagnostics
    details: Source line + caret + "did you mean", stable TF0xx codes, a conservative unknown-variable checker pass — errors read like a compiler's, not a stack trace.
    link: /guide/debugging
    linkText: Running & debugging tests
  - title: One language for API, browser, load & security testing
    details: UI steps share the same grammar as API steps, so a login → seed-via-API → drive-UI → assert-backend-state test stays one readable file instead of gluing two tools together. <a href="/tflw/guide/performance">Load testing</a> (ramp/hold/step/spike, thresholds) is validated within a few percent of k6 on real contended workloads — <a href="/tflw/guide/load-results#validated-against-k6-and-artillery">see the numbers</a>. <a href="/tflw/guide/security">Security scanning</a> runs inside the same test — hygiene, authorization, input handling and an active crawl — each behind a written authorized target declaration.
    link: /guide/functional
    linkText: Start with functional testing
  - title: Real editor support
    details: A real Language Server Protocol implementation (tflw lsp) powers the VS Code extension — diagnostics, hover, go-to-definition, autocomplete, rename, signature help, and semantic highlighting, live as you type.
    link: /editor
    linkText: Editor support
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

On the browser side, **Playwright** and **Cypress** remain the right choice if browser automation
is the whole job — tflw's browser steps run on Playwright under the hood, not instead of it. What
tflw replaces is the glue: seeding state over the API, driving the UI, and asserting backend state
afterward, without switching tools or writing a client by hand partway through a test.
