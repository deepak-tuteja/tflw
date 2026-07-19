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
    details: Every step is an event by construction — a self-contained report.html (full request/response detail) and junit.xml fall out of the same event stream tflw run already emits, secrets redacted everywhere automatically.
  - title: Teaching-quality diagnostics
    details: Source line + caret + "did you mean", stable TF0xx codes, a conservative unknown-variable checker pass — errors read like a compiler's, not a stack trace.
  - title: One language, API today, browser next
    details: 0.2.0 adds UI steps to the same grammar, so a login → seed-via-API → drive-UI → assert-backend-state test stays one readable file instead of gluing two tools together.
---
