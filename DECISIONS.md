# Decisions and milestones

tflw is built against a design record — plan documents, a progress log and a review ledger — that is
not in this repository. That is deliberate: the records carry working notes, host names and a
personal address, and none of that belongs in a public commit. But the code, `SPEC.md`,
`GRAMMAR.md`, `CHANGELOG.md` and the READMEs cite them constantly, in a notation that was only
ever addressed to someone who had them open.

This file is the resolution target for that notation. Every identifier cited anywhere in tracked
prose has an entry below, **lifted verbatim** from the record that defines it. Nothing here is a
summary: if a block reads oddly out of context the fix is written into the record and this file is
regenerated, so the two can never say different things.

**Tracked prose means both repositories.** [`tflw-tests`](https://github.com/deepak-tuteja/tflw-tests)
is tflw's dogfood target — a deliberately realistic API and the `.tflw` suites that exercise it —
and it cites the same notation, out of the same records, to the same readers. Its citations are
indexed here too; a provenance line naming `tflw-tests/VULNS.md` is a file in that repository, not
this one.

## The notation

| spelling | means |
| --- | --- |
| `P#43` | item 43 of the original plan's numbered list — the language's founding decisions |
| `D318` | `decision 318` of the later sequence, which runs past 665 |
| `M137d` | a milestone: a slice of work that shipped as one pull request |

**`P#n` and `D<n>` are different sequences that collide on the number.** `P#16` is soft
assertions; `D16` is the load-execution model. The prefix reads as *principle* over a list that is
mostly decisions, which is a wart — it is kept because it was already the spelling in tracked prose,
183 times as of 2026-08-24, and churning those to fix a letter would have been the larger change.

A milestone entry is a one-line statement of what it shipped. A decision entry is the decision
itself, at whatever length it was taken.

## Citations inside an entry

Entries are lifted verbatim, so they cite each other in whatever spelling the record used at the
time. Two of those spellings are not the ones above, and neither names a sequence this file indexes.

| in an entry | means |
| --- | --- |
| `enterprise decision 3a` | item 3a of the enterprise arc's own list, which has no entries here |
| `gap #9` | item 9 of `TFLW-GAPS.md`, a nineteen-item expressiveness backlog — a `testFlow-tests` record, not published |

A third spelling used to be here and is gone: a bare `decision 43` or `#43`, the two forms that
predate `P#n`. All 171 were read in place and rewritten — one sentence at a time, because no rule
on the digits could do it — and `npm run verify:citations` now fails on a new one. They survive only in comments in tracked *source*, which
this index does not answer — see below.

**Why they were read rather than converted.** The founding list runs to 114 and the enterprise list
to 22, so a bare `decision n` at or below 22 does not say which one it means. Eleven citations sat
in that band and four meant the enterprise list — `M12`'s was the docs-site cluster while `P#16` is
soft assertions, and `P#111`'s was CI ergonomics while `P#7` is API vocabulary. Nine more above the
band would also have resolved to the wrong sequence on magnitude alone: `CHANGELOG.md`'s
`decisions 97/98/102` are workload shapes, and `P#102` is an enterprise cluster. A rule keyed on
the digits would have sent each of those to a published entry about something else, which is worse
than the dead pointer it replaced. The survivors say `enterprise decision n`, which names its list.

Not every `#n` is a citation at all: `D147`, `M92` and `M148` number pull requests with it, and
`M130` numbers an OWASP category.

An entry may also name a **file**. Most of those are in this repository — `SPEC.md`, `CHANGELOG.md`,
a docs-site page named by its basename. Eight name a file that is tracked in the **`testFlow-tests`**
repository and so is public: `VULNS.md` and `FINDINGS_M35B_ROOT_CAUSE.md`. The rest name a design
record, which is not published, for the reason at the top of this page — and three of those
(`TFLW-GAPS.md`, `PLAN_CI.md`, `plan_v2.md`) are `testFlow-tests`' **own** records, gitignored
there under the same policy. Being one repository away does not make a file public; being tracked
does.

A bare **`§n`** is a section of `SPEC.md` in fifty of the eighty-six places it appears. Where it is
not, it is a section of whichever record the sentence names — or, if it names none, of the record on
that entry's own `lifted from` line.

This index answers **tracked prose**. The same notation appears about 9,300 more times in comments
in tracked *source*, naming 671 identifiers — most of which have no entry here, because a comment
addresses a maintainer who has the working tree. That exclusion is deliberate and it is large: if
you arrived from a citation in a `.ts` file and find nothing below, this is why.

**`A4-05`, `FU-11`, `M130-01`** and the like are rows of the review ledger: a working queue of
open defects, kept out of this repository for a different reason than the plans, and not resolved
here.

<sub>Generated by `scripts/gen-decisions.mjs`. Do not edit between the markers.</sub>

<!-- GENERATED:decisions:start -->

### P#1

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

1. **Language depth** — external DSL on a runtime. Own grammar/parser/checker/semantics; browser
   automation is Playwright-as-a-library, HTTP is fetch. Not an embedded TS DSL, not a
   general-purpose language.

### P#2

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

2. **Reuse as a compiler pass** — the compiler detects similar step sequences across tests and
   reports them as diagnostics with a fully prepared extraction (proposed `action` name, params,
   call-site diff). Applied only explicitly: `tflw refactor apply <id>` or an IDE code action.
   **Builds never mutate source.**

### P#3

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

3. **v1 scope** — browser E2E + HTTP API, freely interleaved in one test (seed via API → drive UI →
   assert backend state). Out of v1: mobile, unit, perf, DB assertions, OpenAPI/contract.

### P#4

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

4. **Execution model** — interpreter walking the AST. Every step emits events (`step:start`/`step:end`
   with timing, screenshot, HTTP trace); the report is the primary consumer of the runtime by
   construction. No transpile-to-Playwright path (no dual-semantics risk).

### P#5

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

5. **Reporting (the centerpiece)** — one self-contained `report.html` per run: step timeline
   mirroring the source, screenshot per browser step, full req/res per API step, failures as
   source line + expected/actual + before/after artifacts. Readable by manual QA, attachable to a
   ticket. Plus CLI summary, `junit.xml`, and exit codes for CI. History/trends/flakiness dashboard
   is v2, layered on the same event stream.

### P#6

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN.md`</sub>

6. **Coding UX v1** — three pillars: (a) teaching-quality compiler errors (source line, caret,
   "did you mean", like Rust/Elm); (b) `tflw watch` — save → affected test re-runs headed, browser
   stays open at failure; (c) thin VS Code extension: syntax highlighting + squiggles from the
   checker. Checker/parser built as a pure library so a real LSP can wrap it later. No LSP, REPL,
   or recorder in v1.

### P#7

<sub>cited from SPEC.md, tflw-tests/tflw-acceptance/README.md · lifted from `PLAN.md`</sub>

7. **API vocabulary** — full request spec (method, path relative to per-env base URL, headers,
   query, JSON body, auth presets); response assertions on status, headers, and path-addressed
   body values (`body.items[0].price`); `capture body.id as orderId` binds response values to
   variables usable in later API *and* browser steps (create → use → verify chaining).

### P#8

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

8. **Selectors & waiting** — semantic-first: role + visible text (`click button "Add to cart"`,
   `fill field "Email"`) via Playwright getByRole/getByLabel. Documented resolution tier:
   role+name → label → placeholder → visible text. Explicit `css "…"` and `xpath "…"` escape
   syntax (greppable in review). Every step auto-waits; every `expect` auto-retries to timeout;
   `sleep` does not exist — only `wait until <condition>`.

### P#10

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

10. **Orchestration (the TestNG absorption)** — v1: `@tags` + `tflw run --tag`, inline data tables
    (`with each <table>`, each row a reported case), `before/after` hooks at file and test level,
    declarative `retry N` with flaky-marking in the report, parallel workers across files.
    **Rejected:** inter-test `dependsOn` — serializes execution, poisons parallelism; compose
    shared `action`s instead.

### P#11

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

11. **Escape hatch** — plain JS/TS files exporting async functions, imported via
    `use "./helpers/sign.ts"` and called like native actions (test context in, values out).
    No inline JS blocks inside `.tflw` files — they stay pure, checkable, QA-readable.

### P#12

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

12. **Stack** — TypeScript/Node monorepo; hand-rolled lexer + recursive-descent parser (full
    ownership of diagnostics and error recovery — a pillar, so no parser generator, no tree-sitter).

### P#13

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

13. **Assertion vocabulary (closed matcher grammar)** — one uniform form:
    `expect <subject> <matcher> [value]`. Fixed, checker-known matcher set: `equals`, `contains`,
    `matches` (regex), `is greater/less than`, `has count`, `has value`, `is
    visible/hidden/enabled/disabled/checked`; `not` negates any matcher. Subjects: locators
    (button/field/text/list/element), `status`, `header "…"`, `body.<path>`. New matchers require
    a language release; exotic cases go through the JS escape hatch. **Rejected:** pluggable
    matcher registry (checker can't validate statically, errors degrade).

### P#14

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

14. **JSON body assertions** — path-addressed values plus two array quantifiers:
    `expect any body.items.name equals "Widget"` / `expect all body.items.status equals "active"`,
    and `has count`. **No** partial-object literal matching in v1 — multi-field checks are
    multiple expect lines (one failure per line reports better than a blob diff).

### P#15

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

15. **Retry semantics split by subject** — UI expects auto-retry to timeout (web-first). API
    expects on a received response evaluate **once** and fail fast (retrying frozen JSON is a slow
    lie). Eventual consistency is explicit and greppable: `wait until api GET … / expect …`
    re-issues the request until its expect block passes or times out.

### P#16

<sub>cited from SPEC.md, tflw-tests/CONSTRUCTS.md · lifted from `PLAN.md`</sub>

16. **Soft assertions** — `expect` hard-fails the test immediately (trustworthy artifacts).
    `check` is its soft twin: identical grammar/matchers, records pass/fail in the report and
    continues; any failed check fails the test at the end. House style: `expect` = flow gates,
    `check` = final-state audits (multi-field verification pages).

### P#17

<sub>cited from SPEC.md, tflw-tests/CONSTRUCTS.md · lifted from `PLAN.md`</sub>

17. **Actions (the reuse unit, fully specified)** — `action name(param, …)` containing ordinary
    steps; `give <expr>` returns values so actions compose with chaining
    (`let orderId = create order("Widget")`). File-scoped; shared across files via
    `import "./shared/x.tflw"`; the reuse pass extracts into a conventional `shared/` dir. Actions
    returning the IDs they create is what makes them a real `dependsOn` replacement.
    **Rejected:** project-global action namespace (collisions, unscoped diagnostics).

### P#18

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

18. **Element aliases (selector centralization)** — `element <name> = <locator>`, file-scoped and
    importable exactly like actions. House rule + checker lint: `css`/`xpath` escapes SHOULD live
    behind an element alias (warn when an inline escape is duplicated across files); semantic
    locators stay inline where they read best. **Rejected:** page-object blocks (reintroduces the
    indirection/discipline layer the plan rejects).

### P#19

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

19. **Test data** — builtin `unique(…)` generator family (`unique("prefix")`, `unique email`,
    `unique number`), seeded per run/worker so parallel tests never collide, usable anywhere a
    value goes. Cleanup is explicit but conventional: tests delete what they create in `after`
    hooks via shared actions — "create your own data, remove it after" is the house style.
    **Rejected:** runtime auto-tracked cleanup (guesses DELETE routes, noisy failures).

### P#20

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

20. **Isolation & sessions** — every test gets a fresh browser context (no leakage,
    parallel-safe by construction). Auth cost solved declaratively: named `session` blocks in
    config (login steps or an API token flow) executed once per run per worker with cached
    storage state; `test "…" as admin` starts pre-authenticated. Login itself still gets
    dedicated tests. **Rejected:** context-per-file (ordering coupling — dependsOn's poison
    through the back door).

### P#21

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

21. **`random` vs `unique` — two keywords, distinct contracts.** `unique` = collision-safe
    identity data (run/worker-seeded, guaranteed distinct — for fields/bodies with uniqueness
    constraints). `random` = value-shaped data with ranges and choices, collisions allowed. The
    checker teaches the distinction. **Rejected:** `unique` as a `random` modifier (the safety
    contract becomes a forgettable adjective; `random unique number 1 to 100` self-contradicts
    under range exhaustion).

### P#22

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

22. **Generator breadth — lean core + pattern templates.** `random number A to B` (+ `decimal`),
    `random date in past / in future / between A and B`, `random of <list>`, `random string N`,
    and the power tool `random like "ORD-####-??"` (`#` digit, `?` letter). `unique` keeps
    `unique("prefix")` / `unique email` / `unique number` and gains `unique like "…"`.
    **Rejected:** built-in faker realism (names/addresses/lorem) — locale data blob, endless
    surface; `random of` + own lists covers it readably, JS escape hatch for true faker needs.

### P#23

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

23. **Reproducibility — run seed + `--seed` replay.** All `random` values derive from one seed
    per run (per-test sub-seeds so parallel order doesn't shift values). Seed stamped in CLI
    summary, report.html header, and junit properties; `tflw run --seed <s>` reproduces exact
    values; watch mode auto-reuses the last failing seed. Every generated value is also shown
    inline at its step in the report (`qty = 100 (random)`) so manual QA never needs the seed.

### P#24

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

24. **Tables: generator cells + file-backed rows.** Table cells accept any expression including
    generators (evaluated per row at case start — "same shape, fresh identity").
    `with each from "./data/x.csv"` (also `.json`) loads external rows, columns bound by header
    name; checker verifies the file exists and columns match usage. Inline for illustrative rows,
    files for volume; identical report rendering. **Deferred:** a first-class `dataset` construct
    (third reuse mechanism; revisit if dogfooding shows cross-file dataset sharing).

### P#25

<sub>cited from SPEC.md, tflw-tests/tflw-acceptance/README.md · lifted from `PLAN.md`</sub>

25. **Value expressions — arithmetic + keyword date math, hard fence.** Closed grammar: `+ - * /`
    on numbers, string interpolation, and `today` / `now` with `today + 3 days`-style offsets
    (formattable via `format … as "yyyy-MM-dd"` or a config default). Usable in `let`, fills, api
    bodies, and expect values. The fence stays: **no if/else, no loops, no boolean logic** in
    tests — branching goes to JS helpers (conditional tests make unreadable reports).

### P#26

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

26. **`fill form` block (UI-side data sugar).** Reuses table syntax for label → value pairs
    (values may be generators/expressions); each row executes and reports as its own sub-step
    with the same tiered locator resolution as `fill field`. **Rejected:** fill-and-remember
    auto-verify (`expect form matches filled`) — hidden state, breaks on server-side
    normalization; explicit `check` lines already express the audit.

### P#27

<sub>cited from CONTRIBUTING.md, SPEC.md · lifted from `PLAN.md`</sub>

27. **Config is a tflw dialect.** `tflw.config` is parsed by the same lexer/parser as tests — a
    declaration-only dialect (`env`/`defaults`/`session`/`require` blocks; `test` not allowed).
    Forced by P#20: sessions contain real steps, and steps-in-strings would lose the
    parser/checker/squiggles. Config errors get the same teaching-quality diagnostics as tests.
    **Rejected:** YAML/TOML (steps degrade to strings), JS/TS config (Node semantics in the first
    file manual QA edits).

### P#28

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

28. **Env model — `defaults` + env override, 3-tier selection.** A top-level `defaults` block
    holds shareables (headers, timeouts for step/expect/wait-until, workers, report dir); each
    `env` block overrides only what differs. Checker errors on unknown keys. Active env:
    `--env` flag > `TFLW_ENV` env var > the block marked `default`. **Rejected:** flat
    self-contained envs (copy-paste drift), env-extends-env chains (where-does-this-value-come-from
    debugging).

### P#29

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

29. **Named API services.** An env may declare extra baseUrls: `api billing "https://…"`.
    Steps address them by name (`api billing GET /invoices/{id}`); bare `api` hits the default
    service. Headers/auth scoped per service in config; checker validates service names against
    the active env. Adopted in v1 grammar even though the dogfood has one service — retrofitting
    a service name into step syntax later would be a breaking change.

### P#30

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

30. **Secrets — `require env` + `.env` + taint redaction.** Config declares
    `require env ADMIN_USER, ADMIN_PW`; validated at startup with one error listing *all* missing
    vars. A gitignored `.env` is auto-loaded for local dev (real env vars win). Every value that
    entered via `env(…)` is taint-tracked by the runtime and rendered `•••(NAME)` in report.html,
    traces, and CLI output wherever it flows (header, body, URL) — reports stay ticket-attachable
    by construction. **Rejected:** use-site-only resolution (mid-suite failures, credential leaks
    in reports), header-blocklist redaction (misses login bodies and tokens in URLs).

### P#31

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

31. **Sessions are the auth presets.** No second auth concept: a `session` block's captured
    headers apply to api steps of tests running `as <session>`; its storage state applies to
    their browser contexts. P#7's "auth presets" resolves to this.

### P#32

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

32. **Request bodies — four forms.** Inline `body { … }` (interpolation + generators inside, for
    small payloads); `body from "./payloads/x.json"` for big ones (file is a template — `{vars}`
    interpolate; checker verifies the file exists); `form k=v, …` urlencoded; `upload "./f" as
    "field"` multipart. Raw text via `body text "…"`. **Out of v1:** binary bodies, GraphQL,
    XML helpers.

### P#33

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

33. **Response-side breadth.** `expect duration is less than 500ms` (regression tripwire, not
    perf testing); `body text` subject for non-JSON responses (JSON-path expects on non-JSON give
    a teaching error); per-step `timeout 5s` override; redirects followed by default with
    `without redirects` to assert on the 3xx itself (`header "location"`). **v2:** cookie
    subjects, response-to-file downloads.

### P#34

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

34. **SPEC.md + API-first build order.** [SPEC.md](SPEC.md) is the comprehensive language/
    implementation reference, organized by surface **API before UI** (config → api steps →
    assertions → data → UI → CLI/report/architecture); every construct gets syntax + example +
    checker/runtime notes, cross-referenced to its decision number here (PLAN = why, SPEC = what).
    Milestones flipped and renumbered M0–M7: the API vertical slice (no Playwright dependency)
    builds before the browser half. **Rejected:** formal EBNF/spec-suite before the parser exists
    (two grammars would drift; extract EBNF from the parser later).

### P#35

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

35. **Ambition — build public-grade, publish when proven.** Public GitHub repo and
    npm-publishable layout from day one (README/docs written for a stranger, semver discipline),
    but no npm publish/announce until the M7 dogfood verdict shows a clear win vs raw Playwright.
    **Rejected:** workspace-only (too much rigor for one consumer, retrofit costs more), publish
    early (pre-dogfood grammar churn would break exactly the stability-valuing QA audience).

### P#36

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

36. **Install — per-project npm dep + lazy browsers.** `npm i -D tflw`, run via `npx tflw`;
    `tflw init` scaffolds config/sample test/`.env.example`/`.gitignore`. Playwright **browsers**
    are never downloaded at install: the first browser step (or `tflw init --ui`) points to
    `tflw install-browsers`. API-only projects stay small forever — packaging mirrors the
    API-first architecture. Node ≥ 20. **Parking lot:** standalone binary (right idea for manual
    QA, wrong milestone — 3-OS release engineering before M1 exists).

### P#37

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

37. **Package shape — one `tflw` on npm + separate Marketplace extension.** cli bundles
    lang/runtime/reporter; internal workspace packages stay `private: true` (refactor freely,
    no cross-package release train). `playwright` is a regular dependency (the npm part is
    small; browsers are the lazy step). VS Code extension ships to the Marketplace on its own
    cadence, embedding `lang/`. **Rejected:** scoped @tflw/* family — publish `lang/` separately
    only the day a third party (LSP, apiTestForge codegen) actually asks.

### P#38

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

38. **Language versioning — deprecate → migrate → remove, freeze at 1.0.** One semver for the
    tool. Pre-1.0 grammar changes are allowed at minors but never silent: removed/renamed syntax
    spends ≥1 release as a checker deprecation warning, and `tflw migrate` (reusing the
    refactor-apply source-rewriting machinery) upgrades suites mechanically. After the M7
    verdict, 1.0 freezes the grammar — additive-only. **Rejected:** Rust-style edition pins
    (N grammars in one hand-rolled parser for an ecosystem that doesn't exist), 0.x-no-promises
    (the dogfood suite itself would be the first casualty).

### P#39

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

39. **CI & onboarding — npx + README/SPEC/examples.** CI is plain `npx tflw run` in any runner
    (exit codes + junit.xml already decided); README carries a copy-paste GitHub Actions snippet
    (browser caching, report.html as artifact). Onboarding funnel: README quickstart reaching a
    green **API** test in <5 min (no browser download in the funnel — API-first pays off here),
    SPEC.md as the reference, `examples/` lifted from the always-passing dogfood suite.
    **Parking lot:** Docker image, official GitHub Action, docs site — until someone asks.

### P#41

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

41. **Publish gate re-scoped to an API-only acceptance (amends P#35).** The M7 verdict
    (side-by-side vs raw *Playwright*) is inherently a browser-era comparison and now gates
    **1.0**, not the first publish. New gate for publishing (M2.7): ~10 scenarios side-by-side
    vs **raw `fetch` + `node:test`** (the honest "no tool" baseline) judged on line count,
    readability, and report quality; an **external dogfood against restful-booker** (a public
    QA-practice API with real auth/CRUD/token flows — an API we can't fix when it's awkward);
    and the publish-readiness checklist (`npm pack` clean install elsewhere, README funnel,
    LICENSE, CI). **Rejected:** publish-now-no-gate (only dogfood so far is our own API),
    keeping P#35 as-is (API work would get zero external feedback before the grammar freezes),
    Hurl/newman as the comparison target (benchmarks another tool's philosophy, not value over
    the default).

### P#42

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN.md`</sub>

42. **API-half `session` blocks pulled into the published draft (amends `PLAN.md`'s item 40, the
    M3 attachment).**
    A public API tool lives on auth ergonomics; without sessions every published example repeats
    the login boilerplate the DSL exists to kill. Ship the pure-API half now: a `session` block
    executes once per run, its captured headers auto-apply to the api steps of tests running
    `as <session>`. The browser/storage-state half stays M3. **Rejected:** document-the-hook-
    pattern (flagship examples would look worse than a Postman collection), grammar-reserved-
    but-dead keyword.

### P#43

<sub>cited from CONTRIBUTING.md, README.md, SPEC.md · lifted from `PLAN.md`</sub>

43. **Packaging mechanism + runtime slimming.** `tflw` becomes one publishable package via an
    **esbuild bundle at prepack** (cli+lang+runtime+reporter into `dist/`; `@tflw/*` stay
    private/refactorable — implements P#37's "cli bundles" line, which was never actually built:
    today's package.json depends on private workspace packages and would publish broken).
    **Node ≥ 22** (20 went EOL 2026-04) and **drop the `tsx` runtime dependency**: native
    type-stripping loads `.ts` helpers via plain dynamic `import()`; a teaching error covers the
    unsupported corner (enums/namespaces/parameter properties in helpers). Published tflw has
    essentially zero runtime deps. **Amended by P#99/enterprise decision 13:** `undici` is
    now a real, narrowly-scoped `dependencies` entry of `@tflw/runtime` (mTLS's client-cert path
    only — every other request still uses the plain global `fetch`, untouched); this doesn't
    reverse the promise here since only the bundled CLI artifact is ever published, never
    `@tflw/runtime` standalone. **Rejected:** pack-time dependency rewriting (hand-rolled
    fragility), publishing `@tflw/*` scoped (release train, re-rejected), keeping tsx (~10MB+
    of esbuild binaries in every API-only install), tsx-as-optional-peer (two-tier escape hatch).

### P#44

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

44. **Playwright arrives in the browser release as an optional peer (amends P#37's "regular
    dependency").** v0.2 loads `playwright` via dynamic import at the first browser step;
    missing → teaching error pointing at `tflw install-browsers`, which then does **both** the
    `npm i -D playwright` and the browser download. API-only projects stay small forever — the
    actual P#36 promise — and upgrading API-only users never pull the Playwright npm payload.
    **Rejected:** regular dep (every API-only upgrade downloads it), separate `tflw-browser`
    package (multi-package release train in public).

### P#45

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN.md`</sub>

45. **Stability promise at publish (amends P#38).** The shipped API grammar is declared
    **frozen additive-only** from the first npm release — the browser half adds statement
    keywords (provably additive; old files keep parsing) but never changes existing syntax.
    Escape clause in the README: any breaking change before 1.0 requires a checker deprecation
    warning **one full release** ahead. `tflw migrate` is re-scoped from a 0.x promise to a
    **1.0-gate deliverable** (it reuses M6 machinery that doesn't exist yet). **Rejected:**
    building migrate pre-publish (weeks of work, zero migrations to run), 0.x-no-promises
    (re-rejected — now external suites would be the casualties).

### P#46

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

46. **Publish-gating correctness fixes (from this session's code review).** Must-fix before
    publish: `--tag` matching zero tests anywhere exits 0 with a green CI (make it a hard
    error); `--seed abc` silently coerces NaN→0 (usage error); a parse error in one file lets
    *other* files execute (real side effects) yet exits without writing report.html/junit.xml
    (validate **all** files before running **any**; always write the report for tests that ran);
    the docs claim that retry replays generated values identically (true for `random`, not
    `unique` — the counter deliberately advances so retried attempts can't collide with data the
    failed attempt created; fix the claim, keep the behavior). Documented-not-gating (fix if
    trivial): report.html keeps only the last retry attempt's steps (the flaky badge has no
    evidence trail); JSON-escaped secrets dodge value-based redaction; `equals` on objects is
    key-order-sensitive; header override merging is case-sensitive; an `any` quantifier throws
    if one element lacks the remaining path.

### P#48

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

48. **Repo & license.** `git init` in `testFlow/`, push to a new **public GitHub repo** named
    after the npm package, **MIT** license, GitHub Actions CI (build+typecheck+tests on Node
    22/24 — which also verifies the README CI-snippet claim), `repository`/`license`/`author`
    fields in package.json. (P#35 said "public-grade from day one"; there was no git
    repo at all — this closes that.) The npm name **`tflw` is free** (verified 2026-07-06;
    `testflow` is taken). **Rejected:** Apache-2.0 (ceremony without benefit at this scale),
    publishing from a private repo (kills issues/source-reading, no provenance).

### P#49

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

49. **Published docs split.** README documents **exclusively what the installed package does**
    (API surface) plus one roadmap line; SPEC.md stays the single full design doc with a
    **per-section status badge** (✅ shipped / 🔮 planned), the §12 CLI table split
    shipped/planned. **Rejected:** SPEC/ROADMAP split (shared concepts would duplicate and
    drift), status-paragraph-only (nobody reads it before clicking a §9 anchor).

### P#51

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN.md`</sub>

51. **`body text` response subject — implement it (it's promised, not optional).** SPEC §5.3 marks
    `body text` a ✅ shipped response subject and two runtime errors (`interpreter.ts` :695/:750)
    tell users to "use `body text` for non-JSON" — but the parser never recognised it
    (`SUBJECT_KEYWORDS` is `status/duration/header/body`; no `BodyTextSubject` AST node; no
    `resolveSubject` case), so asserting on a non-JSON (text/HTML/XML) response is impossible and the
    tool's own error messages point at a dead end. Fix: add `BodyTextSubject` end-to-end (lexer/
    parser accept `body text` as a subject, AST node, interpreter resolves it to `response.bodyText`).
    **Rejected:** downgrading SPEC to 🔮 + rewording the two errors — the messages are correct and the
    feature is small; the bug is the missing implementation, not the promise.

### P#52

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

52. **Date generators must honor `--seed` (or the guarantee is narrowed honestly).** `random date in
    past`/`in future` anchor on wall-clock `Date.now()` (`eval.ts` :101–104), so the same `--seed`
    yields different absolute dates every run — a direct contradiction of §7.4 ("reproduces exact
    values"). Fix: capture **one run-clock** at run start, thread it through `EvalCtx`, and derive
    `today`/`now`/`date in past`/`date in future` from it (not `new Date()`); stamp the run-clock in
    the report/CLI/junit next to the seed and accept a `--now <iso>` replay flag so `--seed` +
    `--now` reproduces absolute dates exactly. SPEC §7.4 reworded to state precisely what `--seed`
    alone reproduces vs. what also needs `--now`. Add the date generators to the reproducibility
    test (they're currently untested). **Rejected:** leaving `Date.now()` and quietly keeping the
    "exact values" claim.

### P#53

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

53. **Session generators + splice point must be worker-deterministic.** `SessionCache.ensure`
    (`interpreter.ts` :238) runs a session's steps with the `TestCtx` of *whichever test first opts
    in*, and splices its steps into that test. Under `--workers N>1` that's a race, so a session body
    using `random`/`unique` produces values that depend on scheduling, and the login steps land in a
    non-deterministic test — breaking P#47's own "byte-identical at any worker count" promise.
    Fix: seed a session's generator stream from a **stable** sub-seed derived from the session name +
    run seed (independent of the race), and choose the splice-target test deterministically
    (first opting-in case in sorted order, computed up front). **Rejected:** relying on `workers 1`
    being the default to hide it.

### P#54

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

54. **A failed session must not permanently poison `retry` and the whole authenticated suite.**
    `SessionCache` memoizes the session *promise*, so a single transient auth blip caches
    failure forever: every test running `as <session>` fails, and because the cache is shared across
    a test's retry attempts, `retry N` on those tests can never re-establish — the flagship
    flaky-recovery feature is nullified for exactly the tests most likely to flake. Fix: cache only
    **successful** outcomes; a failed establishment is not cached, so a retry (or a later test) may
    re-attempt it. **Rejected:** the current permanent-failure memoization.

### P#55

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

55. **A soft `check` inside an `action` must stay soft.** `execCall` (`interpreter.ts` :507) throws a
    hard `RuntimeError` whenever an action's steps report `ok:false`, but `execSteps` returns
    `ok:false` for accumulated soft-`check` failures too — so a `check` that fails inside an imported
    action aborts the caller immediately, silently converting `check`→`expect` and violating §6.4's
    closed soft-assertion semantics. Fix: propagate an action's soft failures back to the caller as
    soft (accumulate, don't throw). **Rejected:** documenting actions as hard-only (a surprising
    carve-out in a uniform grammar).

### P#56

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

56. **Close the redaction ordering window.** Traces are redacted per-step as steps run, but a secret
    is registered only when its `env(NAME)` is first *evaluated* (`eval.ts` :57) — so a secret first
    read late in a run won't retroactively mask an earlier step whose trace already contained that
    value. "Ticket-attachable by construction" (§3.4) has an unstated, untested ordering assumption.
    Fix: (a) pre-register every `require env` variable at run start, and (b) run a **final
    full-report redaction pass** at write time with the fully-populated redactor, so a late-registered
    secret still masks earlier steps. **Rejected:** per-step eager redaction alone.

### P#57

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

57. **Honest static-checker scope, plus a conservative unknown-variable pass.** `checker.ts` defers
    "matcher↔subject compatibility, unknown captures" to "later milestones", so the single most
    common authoring mistake — a typo'd `{var}` — surfaces only as a *runtime* error when the request
    fires, not as a checker squiggle, undercutting §1's "diagnostics are a feature" pillar for the
    manual-QA audience the README courts. Fix: add a **conservative** checker pass that flags a
    `{var}`/subject reference provably never bound in its reachable scope (`let`/`capture`/action
    param/table column) with a did-you-mean; matcher↔subject stays runtime for now but §1 gets an
    honest "static scope" note. (Gate: the SPEC note is a must; the conservative pass is a strong
    should — ship it if it lands cleanly, don't hold the push on edge cases.) **Rejected:** claiming
    full teaching-diagnostics coverage while the commonest mistake is runtime-only.

### P#59

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

59. **M2.65 exit = clean tree + green suite as the push gate.** Every fix above lands with a
    regression test, and the reproducibility test is backfilled to cover `unique`, session-internal
    generators, and the date generators (all currently untested); a sessions-under-`--workers` test
    asserts identical output across concurrency. M2.65 is `done` only when `npm run build &&
    typecheck && test` is green **and** `git status` is clean on a single reviewed initial commit —
    that is the gate the first `git push` (and then `npm publish`) waits behind. The
    already-documented last-attempt-only retry-report limitation (SPEC §4.4) stays a known gap, not a
    push blocker.

### P#60

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN.md`</sub>

60. **Lexer: identifiers named after an HTTP verb break arithmetic division (critical, novel bug).**
    `canStartPath()` (`lexer.ts` :272–275) decides a `/` starts a PATH token purely from the
    *previous token's text* — `t.type === 'ident' && METHOD_WORDS.has(t.value.toUpperCase())` —
    with no check that the ident is actually in "HTTP method" position (i.e. right after `api`/
    `wait until api`). A variable named `get`, `post`, `put`, `delete`, or `patch` (any case)
    immediately followed by `/` for division is lexed as a path instead: `let ratio = get / 2`
    tokenizes as `ident "get"`, `path "/"`, `number "2"` — a token stream the parser cannot make
    sense of, producing a confusing parse error that points nowhere near the real cause. Reproduced
    directly against the built lexer. **Not caught by any test:** `lexer.test.ts`'s two contextual-
    `/` tests only exercise `/` after a real HTTP-method step and after a named service — never a
    bare variable whose name collides with a method word. Fix: gate `canStartPath()` on the actual
    grammatical position (immediately after the `api [<service>]` keyword sequence, not just "the
    previous token happens to read GET/POST/…"), and add a regression test lexing `get`/`post`/
    `delete`/`patch` as ordinary variable names next to `/`.

### P#61

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

61. **Duplicate response headers silently collapse to the last value (high, novel bug).**
    `http.ts` :35–37 builds the response header map with
    `res.headers.forEach((value, key) => { headers[key] = value; })` — a same-named repeated header
    (most commonly multiple `Set-Cookie`s, e.g. a session cookie *and* a CSRF cookie on one login
    response) silently overwrites down to whichever value the Fetch API iterates last. `capture
    header "set-cookie" as token` then captures the wrong cookie with no error and no sign anything
    was dropped — invisible in the report because only one value was ever recorded. No test in
    `request-shapes.test.ts` or `sessions.test.ts` exercises a multi-value header. Fix: preserve
    repeated headers (e.g. join with `, ` per HTTP semantics, or expose a list), and add a
    regression test asserting on a response with two `Set-Cookie` headers.

### P#62

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

62. **Interpolated path/URL segments are never percent-encoded (high, novel bug).** `execApi`
    (`interpreter.ts`) builds the request URL from `interpolatePath(spec.path.raw, ctx)`
    (`eval.ts`), which string-concatenates evaluated `{var}` values with no
    `encodeURIComponent`. A captured or generated value containing `&`, `#`, `?`, a space, or
    non-ASCII characters (e.g. a real API's name/email field round-tripped into a later path, or a
    `unique("prefix")` value composed with such data) silently corrupts the request — wrong query
    params, a truncated path, or a request to the wrong resource — instead of erroring or encoding
    correctly. No test covers a path variable containing a URL-special character. Fix:
    percent-encode each interpolated path segment (not the whole path, so intentional `/`s in a
    multi-segment `{var}` — if ever needed — stay a deliberate choice) and add a regression test
    with a captured value containing `&`/space/`#`.

### P#63

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

63. **Nested object/array literals with a quoted string key fail to parse (high, novel bug).**
    `parser.ts`'s `parseFieldValue()` (:1438) only recognises a nested object shape when the first
    key is a bare `ident` immediately followed by `:` (or an empty `{}`); anything else falls
    through to `parseValue()` → `parseAtom()`'s `lbrace` case → `parseInterp()`, which unconditionally
    expects an `ident` token and errors (`TF010`) on a leading string token. A field value shaped
    like `{ "name": "Widget" }` — valid JSON, and something `parseObject()` itself explicitly
    supports at the top level (string keys, :1452) — cannot be nested inside another object/array:
    `body { user: { "name": "Widget" } }` spuriously parse-errors even though the equivalent
    top-level `body { "name": "Widget" }` works fine. No golden fixture or unit test exercises a
    nested object/array element with a string-literal key; the restful-booker dogfood didn't catch
    this because its nested objects (`bookingdates: { checkin: …, checkout: … }`) happen to use bare
    idents. Fix: make the object-vs-interpolation disambiguation in `parseFieldValue()` also
    recognise a leading string-or-ident key followed by `:`, and add a nested-object-with-
    string-key fixture/test.

### P#64

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

64. **Redactor over-redaction: no minimum-length guard on registered secrets (high, novel bug).**
    `Redactor.register()` (`redact.ts` :16–21) registers *any* non-empty `env(NAME)` value for
    substring replacement, with no length floor. A short or common secret value — a numeric ID, a
    port number (`env(PORT)` = `"3001"`), a single-character flag — causes `redact()` to replace
    *every* occurrence of that substring anywhere in the rendered report, including in completely
    unrelated response fields, silently corrupting report content (e.g. an unrelated
    `body.orderId` that happens to also be `3001` renders as `•••(PORT)`) or masking an assertion's
    real actual/expected values. This is the inverse failure mode of the already-tracked ordering
    gap (P#56) and needs its own fix. Not covered by `redact.test.ts` (all its fixtures use
    long, realistically-unique secret values). Fix: require a minimum length (e.g. ≥ 6 chars,
    configurable) before a value is eligible for substring redaction, and add a regression test
    with a short `require env` value asserting it does *not* redact an unrelated matching
    substring elsewhere in the report.

### P#65

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

65. **CSV data tables silently mis-type, mis-align, and mis-count data (medium-high, novel bug).**
    `parseCsvRows` (`runtime/src/dataTable.ts` :56–64) binds every cell as a raw string with a
    naive `line.split(',')` — no quoted-field support, and no row-length validation. Three distinct
    problems, none documented beyond the "deliberately simple" comment nor tested with a case that
    would expose them: (a) **type loss** — a numeric CSV column (e.g. `qty`) is always bound as a
    string, while a JSON-backed table (`.json`) preserves real types via `JSON.parse`; `expect
    body.qty equals {qty}` against a real JSON response then always fails (`deepEqual(3, "3")` is
    `false`) even when the data genuinely matches, because the matcher's `equals` is type-strict.
    (b) **silent misalignment** — any field containing a comma (a quoted address or name, e.g.
    `"Smith, John",30`) desyncs every subsequent column with no error at all — cells shift into the
    wrong named column silently. (c) **silent row-length mismatch** — a row with fewer cells than
    the header fills the missing ones with `''` instead of erroring, and a row with extra cells
    silently drops them; a single mis-aligned row in a large CSV (the exact "for volume" use case
    SPEC §7.5 describes, less likely to be hand-reviewed than inline rows) produces silently-wrong
    test data rather than a clear "row N has M cells, expected K" error. Fix: either document CSV
    as "unquoted, comma-only, strings-only, exact column count" loudly in SPEC §4.3 with a
    checker/runtime warning on suspicious rows, or support minimal RFC-4180 quoting plus row-length
    validation; regardless, coerce numeric-looking CSV cells so `equals` against a real JSON number
    doesn't silently fail. Add tests for a comma-in-quotes row, a numeric-column-vs-JSON-number
    `equals` case, and a short/long row.

### P#66

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

66. **The checker never validates `api <service>` steps declared inside `session` blocks (medium,
    novel gap).** `checkServices(program, knownServices)` (`checker.ts` :100–112) only walks
    `program.tests`, `program.actions`, and `program.hooks` — `SessionDecl`s live on
    `ConfigFile.sessions`, a separate tree, and neither `cli.ts` nor any checker pass runs a service
    check against a session's step bodies. A typo'd/unknown service name inside `session admin`
    (e.g. `api billng POST /auth/login`) produces zero checker diagnostics and is invisible until
    the session actually executes at runtime — the same class of gap P#57 is fixing for
    `{var}` typos, just for a different reference kind. `checker.test.ts` has dedicated tests for
    services-in-actions and services-in-hooks but none for services-in-sessions — a confirmed,
    demonstrable omission, not a hypothetical. Fix: extend `checkServices` (or add a sibling pass)
    to also walk `ConfigFile.sessions`' step bodies; add a regression test.

### P#67

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN.md`</sub>

67. **`wait until api`'s configured timeout only bounds the polling loop, not any individual poll
    (medium, novel bug).** `execWaitUntilApi` (`interpreter.ts` :643–677) checks its `deadline` only
    *after* each `execApi` call returns — a single slow/hanging endpoint can take up to
    `config.timeouts.step` (default 30s) before the loop even re-checks the deadline, so `wait until
    api` configured with `timeouts.wait: 500` can still block for tens of seconds if one poll hangs,
    silently violating the documented timeout. `wait-until-api.test.ts` only covers the
    "condition never true, all polls fast" path, never a slow/hanging individual poll. Fix: race
    each poll against the remaining time-to-deadline (not just `timeouts.step`), and add a
    regression test with an artificially slow single poll.

### P#68

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

68. **A retried, session-authenticated test's final report shows no evidence the session ever ran
    (medium, novel bug, compounds with P#54's fix).** `SessionCache.shown` (`interpreter.ts`
    :236, :244–247) is a set keyed only by session name, marked the *first* time `ensure()` is
    called for that name — regardless of which retry attempt that call happens on. Because
    `report.html` already only keeps the *last* retry attempt's steps (documented gap, SPEC §4.4),
    a test declared `test "…" as admin retry N` that fails on attempt 1 and passes on attempt 2
    calls `ensure()` twice: attempt 1 consumes `shown` and gets the real steps (then attempt 1's
    entire result is discarded since only the last attempt is kept), and attempt 2 — the one whose
    steps actually survive into the report — gets `steps: []` back. The surviving report shows the
    session's headers took effect but zero step evidence that a login ever happened. Not exercised
    by any test (no test combines `retry` with `as <session>`). Fix belongs alongside P#54's
    remediation: `shown` should track "has this *specific attempt's* report already gotten the
    steps" rather than a permanent per-session-name flag, or the interpreter should splice session
    steps into whichever attempt is the one actually kept. Add a retry+session combination test.

### P#70

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

70. **Minor: `random number`/`random decimal` never validate `from <= to`.** Neither the parser,
    checker, nor `eval.ts` reject `random number 10 to 5`; the reversed range silently produces
    values outside the range a reader would expect rather than a clear authoring error. Low
    priority — add a runtime check ("`to` must be ≥ `from`") next time this area is touched.

### P#72

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

72. **Minor: the redactor mislabels a secret when two `require env` vars share the same value**
    (`redact.ts` :16–21, `register()`'s `if (!this.secrets.has(value)) …` guard). If two different
    vars (or a `require env` var and a coincidentally-equal generated/test value) hold the same
    string, every occurrence renders under whichever name registered first — not a leak, but can
    mislead someone reading the report about which credential is actually in play. Fix: track all
    names registered for a given value (or warn on collision) rather than silently keeping only the
    first.

### P#73

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

73. **Minor: `junit.xml`'s `esc()` doesn't strip XML-invalid control characters** (`reporter/src/
    junit.ts` :33–35 escapes `& < > "` but not C0 control characters other than tab/LF/CR, which
    XML 1.0 forbids outright). A test name or error message that happens to contain one — e.g.
    echoed from a garbled/binary response body in an error — produces a `junit.xml` that is not
    well-formed XML, which some CI JUnit parsers will reject outright rather than degrade
    gracefully. Fix: strip (or `&#xFFFD;`-substitute) disallowed control characters in `esc()`; add
    a regression test with a control character in a test name/error.

### P#74

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

74. **Mechanical publish blockers (all found in-repo, all M2.8).** (a) `packages/cli/package.json`
    still has `"private": true` — `npm publish` refuses outright; the publish tail as currently
    handed off is broken. (b) No `tflw --version`/`-v` — table stakes for a public CLI and the
    first thing a bug report needs; version injected from package.json at bundle time (esbuild
    `--define`). (c) The usage banner leaks internal jargon ("testFlow runner (M2.6: …)") —
    rewrite in user language, no milestone numbering. (d) No `CHANGELOG.md` — P#38/P#45 make
    versioning *promises* (deprecation windows, additive-only freeze) with no artifact to live in;
    create one (Keep-a-Changelog style) with a `0.1.0` entry. (e) **The published tarball ships no
    README and no LICENSE** — the verified `npm pack` result is 2 files (`dist/cli.js` +
    `package.json`); npm only auto-includes README/LICENSE from the *package's own directory*, and
    `packages/cli/` has neither, so the npm package page would render essentially blank. Fix: a
    consumer-facing `packages/cli/README.md` (installed-package view, per P#49) + LICENSE
    copied into the package.

### P#75

<sub>cited from CONTRIBUTING.md, SPEC.md, tflw-tests/CONSTRUCTS.md · lifted from `PLAN.md`</sub>

75. **`tflw check` ships in 0.1, text-only.** Validate-only command: parse + the full checker
    pipeline (exactly what `run` already executes before running) over given or discovered files,
    teaching diagnostics, exit 0 clean / 2 diagnostics, no execution. The standard DSL contract —
    lint in CI/pre-commit without touching a live API — for ~20 lines of exposure. **Rejected:**
    `--format json` now (a frozen diagnostic JSON schema with zero consumers is a liability;
    additive later when the LSP (M5) is a real consumer), defer-to-0.2 (cheapest item on the list
    for the most standard expectation).

### P#76

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

76. **Editor support at launch: highlight-only VS Code extension.** TextMate grammar + language
    registration for `.tflw`/`tflw.config`, published to the Marketplace on its own cadence
    (P#37 already reserved that lane). No checker integration — squiggles/LSP stay M5.
    A brand-new DSL rendering as plain white text is a real adoption barrier; highlighting alone
    removes most of it for ~a day of work. **Rejected:** grammar-file-in-repo-only (nobody finds
    it), defer-entirely-to-M5 (concedes first impressions for months).
    **Superseded 2026-07-07 — see P#94.** The "squiggles/LSP stay M5" deferral turned out to
    be more conservative than needed: child-process-driven diagnostics (`tflw check --format
    json`, no real LSP) is a well-worn, low-effort pattern, not the heavier LSP-wrapping work M5
    was reserved for — P#94 ships it without waiting for a real LSP consumer to exist.

### P#77

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

77. **TF0xx diagnostic codes are public API: index + stability rule.** The codes print on every
    error but appear **zero** times in SPEC.md. Once published they leak into CI grep filters,
    blog posts, and search queries — impossible to renumber after the fact. SPEC gains a
    diagnostics appendix (code → one-line meaning → tiny example) and the stability promise gains
    a rule: a shipped code is never renumbered or reused; new diagnostics get new codes.
    **Rejected:** stability-rule-only (the index is cheap and is what search lands on), codes-stay-
    informal (retroactively breaking by construction).

### P#78

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

78. **Proxy & TLS, zero-dep (the corporate-QA reality).** Node's fetch ignores
    `HTTP_PROXY`/`HTTPS_PROXY` and hard-fails self-signed staging certs — today both die as an
    opaque `fetch failed`, and corporate QA (the exact target audience) lives behind proxies
    against self-signed staging APIs. Ship three zero-dependency pieces: (1) a per-env config key
    `insecure true` — disables TLS cert verification for the run, explicit and greppable in
    review, with a visible warning in the CLI summary and report header; (2) a "corporate
    networks" README/SPEC section — `NODE_EXTRA_CA_CERTS` for private CAs, `NODE_USE_ENV_PROXY=1`
    on Node ≥ 24, and the Node 22 no-proxy limitation stated honestly; (3) unwrap fetch's error
    `cause` chain into teaching errors (CERT_* → "self-signed/private CA? see `insecure` /
    NODE_EXTRA_CA_CERTS"; ENOTFOUND/ECONNREFUSED → named hints). **Rejected:** undici as a real
    dependency (full per-service proxy/CA support, but reverses P#43's zero-runtime-dep win
    for a need nobody has voiced), docs-only (leaves the self-signed case on a global env var with
    a Node warning).

### P#79

<sub>cited from README.md, SPEC.md · lifted from `PLAN.md`</sub>

79. **Platform bar: Linux/macOS, documented; no Windows CI for 0.1.** README states "tested on
    Linux/macOS; Windows via WSL". Deliberately chosen over the recommended
    ubuntu/windows/macos matrix — accepted trade-off: a slice of the QA audience is conceded
    until demand shows up, and nothing has ever executed tflw on Windows (paths, `.env`, ANSI,
    subprocess e2e tests are all unverified there). The free part lands anyway: `prepack`'s
    `rm -rf` becomes a portable `node -e` removal so future Windows work isn't blocked on line
    one. **Rejected (for now):** 3-OS CI matrix, windows-only addition.

### P#80

<sub>cited from CONTRIBUTING.md, README.md, SPEC.md · lifted from `PLAN.md`</sub>

80. **Repo posture: public, contributions closed initially.** No CONTRIBUTING.md / SECURITY.md /
    issue templates at 0.1 — public source is an npm-trust requirement, a community is not. One
    README line states the posture plainly (source public, issues welcome, PRs not accepted yet)
    so strangers aren't left guessing. npm provenance attestation deferred until publishing ever
    moves to a GitHub Actions workflow — the user runs `npm publish` by hand (Round 7 decision,
    unchanged). **Rejected:** full community-file set + provenance workflow (ceremony ahead of a
    community; reverses the manual-publish decision), skip-even-the-posture-line (ambiguity reads
    as abandonment).

### P#82

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

82. **`tflw init` scaffolds secrets hygiene (restores P#36's original promise).** P#36 promised `.env.example` + `.gitignore` in the scaffold; M2.7 fixed the *docs* to match the
    lesser reality instead of building it. For a tool whose flagship feature is "secrets never
    leak into reports", leaving `.env` committable in its own quickstart is off-message: init now
    also writes `.env.example` (matching the scaffold config's `require env`) and creates/appends
    `.gitignore` with `.env` and `report/`. **Rejected:** keep-init-minimal.

### P#83

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

83. **`tflw fmt` explicitly parked.** A canonical formatter is standard modern-DSL kit
    (gofmt/rustfmt precedent), but the offside-rule grammar already constrains layout and there
    are no external users to drift. Parked in the v2 lot — revisit at M5/M6, where
    source-rewriting machinery lands anyway — recorded so it's a decision, not an oversight.
    **Rejected:** minimal-fmt-in-0.1.

### P#84

<sub>cited from README.md · lifted from `PLAN.md`</sub>

84. **Checkout usability: a plain `npm run build` must produce the same portable artifact `npm
    publish` would ship (found 2026-07-06, ahead of M2.8 work, via a direct user question).** The
    repo can go public (P#48) before `npm publish` ever happens — M2.7's push and publish are
    two separate, user-triggered steps with nothing sequencing them. Checked whether a stranger
    cloning the public repo *before* an npm release existed would have any working path to run
    `tflw`: they would not have. `packages/cli`'s own `"build"` script was a plain `tsc` compile
    (thin, per-file output, importing `@tflw/lang`/`runtime`/`reporter` as bare specifiers) while the
    real, portable, zero-runtime-dependency artifact (P#43's esbuild bundle) was only ever
    produced by `prepack`, which nothing but `npm pack`/`npm publish` invokes. The `tsc` output
    happened to run at all only because of incidental npm-workspace symlink hoisting into the
    monorepo's own root `node_modules` — it would not survive being copied or installed outside the
    workspace, and nothing documented or tested this path either way. Fix: `packages/cli`'s
    `"build"` script now runs the same esbuild bundle `prepack` uses (`"build": "npm run bundle"`,
    and `"bundle"` itself now cleans `dist/` first so there's never a stale mixed tsc+bundle output
    directory); `prepack` reuses `"build"` instead of duplicating the bundle command. So
    `git clone` → `npm install` → `npm run build` now always produces the exact self-contained
    `dist/cli.js` a registry install would give — runnable by direct path
    (`node packages/cli/dist/cli.js run`) or pulled into another project with zero registry
    involvement via `npm install --no-save file:<path-to>/packages/cli` (verified working end-to-end;
    plain `npm link` was tried first and rejected — it needs global install permissions this
    environment doesn't have, `file:` doesn't). No new CLI surface, no new milestone: this closes
    drift between "build for development" and "build for distribution" that had no reason to exist,
    and `packages/cli/test/e2e.test.ts` (already builds the workspace, then spawns `dist/cli.js` from
    a separate scratch directory) now exercises exactly this checkout-and-run path as its regression
    test, no new test needed. README's "Contributing" section gained a "using this checkout without
    npm" subsection with both invocation forms. **Rejected:** docs-only fix (leaves an accidental,
    workspace-symlink-dependent mechanism as the public story — untested and liable to silently break
    the moment workspace hoisting changes); a separate dev-only bin shape (two artifacts to keep in
    sync for zero benefit — P#43's entire point is that there's only one shape of the tool);
    documenting `npm link` as the primary path (works in principle but depends on global npm
    write permissions / a Node version manager that not every machine has — `file:` has no such
    dependency and was the one actually verified here).

### P#86

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

86. **`report.html` now shows every `retry` attempt's evidence, not just the final one (closes
    P#46's documented-not-gating gap / SPEC §4.4's known gap); plus two SPEC-only
    clarifications found in the same pass.** `TestResult` gains an optional `attempts:
    AttemptResult[]` (present only when more than one attempt actually ran — a non-retried test's
    shape is untouched); `runTest`'s retry loop now accumulates each attempt's `{attempt, ok,
    durationMs, steps, error?}` instead of overwriting a single `result` variable. `report.html`
    renders every failed prior attempt as a collapsed native `<details>` block (no JS) above the
    final attempt's already-visible steps, each carrying its own fail/pass badge, so a flaky pass
    reads as "attempt 1 failed, attempt 2 failed, attempt 3 passed" rather than a bare badge with
    no trail. `junit.xml`'s existing `flaky` `<system-out>` line gains the attempt count when the
    data is available, falling back to its old fixed text otherwise — kept summary-only by design;
    JUnit's schema has no natural home for step-level evidence, and report.html is already that
    artifact. Also documented (no behavior change): `before file`/`after file` hooks execute in
    their own isolated scope, never shared with any test's scope (SPEC §4.2) — a `let` bound there
    can never be read by a test, only a same-scope `before`/`after` hook can share bindings; and
    `unique(...)`'s run-wide counter keeps advancing across a test's own retry attempts while
    `random`-family values replay identically per attempt (SPEC §7.2) — anything a retry needs to
    reuse identically (an idempotency key, a namespace) must be `random`, never `unique`, or a
    "successful" retry will silently target different data than the attempt it's supposedly
    retrying. **Rejected:** changing junit.xml's `<testcase>` shape to carry per-attempt detail
    (CI JUnit parsers assume the standard schema; report.html is the narrative-evidence artifact,
    junit.xml stays the CI-summary artifact); mining the existing `step:end` event stream instead
    of changing `TestResult` (nothing persists that stream today — the report is built from
    `TestResult[]` alone, so the fix has to live in the data model those types describe, not bolt
    a second read path onto events that already exist for a different purpose).

### P#91

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

91. **`--verbose` step-level console logging + always-on live failure diff — first two of the
    four `/grill-me` UX/tooling tracks (2026-07-07), scoped alongside report.html tabs and the
    VS Code extension.** `packages/cli/src/cli.ts`'s live ticker (`liveEmit`, formerly built only
    when `color` was true) previously showed nothing but a bare `✓/✗ name` line per test, and only
    in an interactive TTY — a piped/CI run showed *nothing* live at all, and even interactively a
    failure gave zero detail without opening `report.html`. Two independent, additive changes:
    - **Always-on failure diff (no flag):** `formatEvent`'s `test:end` branch now always prints a
      failing test's `✗ name` line plus each failing step's already-capped/subset-aware `detail`
      (gap #8's `truncate()`/`subsetMismatches()`, already baked into `StepResult.detail` — no new
      diff logic needed), regardless of `--verbose` or TTY color. A *passing* test's tick stays
      gated on `color`/`--verbose` exactly as before, so a plain CI/piped green run stays exactly
      as terse as it always was (verified: `renderCliSummary`'s own end-of-run recap already
      showed this same per-failing-step detail — that part wasn't a real gap, only the *live*
      mid-run ticker was silent on it).
    - **`--verbose`:** consumes the `step:end` event (`StepResult.kind`/`detail`/`durationMs`, no
      new computation) to print a `test:start` header line plus one indented line per step, pass
      or fail. No `-v` short form — `-v` is already `--version`. Under `--workers > 1`, per-step
      lines from concurrently-running files would interleave illegibly (no file id on any
      `RunEvent`, and `runWithConcurrency` is a real in-process concurrent pool) — so in that
      combination only, each file's worker gets its own `bufferedEmit` sink that collects lines and
      flushes them as one contiguous block once that file's `runProgram` resolves; the shared live
      `liveEmit` is used for everything else (single worker, or non-verbose at any worker count).
      Both sinks share one `formatEvent(ev, color, verbose)` pure mapper so live and buffered output
      stay in lockstep.
    4 new tests in `packages/cli/test/e2e.test.ts` (all spawning the real built `dist/cli.js`):
    live diff visible with `--no-color`+no `--verbose`; a passing test still produces exactly one
    mention of its name (proving no live-tick duplicate was added on the terse path); `--verbose`'s
    per-step line format against a 4-step test; `--verbose --workers 2` against a deliberately
    slow vs. fast file pair, asserting the two files' line ranges never interleave. All 28
    pre-existing cli tests + 133 runtime + 146 lang + 7 reporter tests stayed green (32 cli tests
    total after the 4 new ones).

### P#92

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

92. **report.html: a collapsible per-file sidebar tree + per-test tabs — third of the four
    `/grill-me` UX/tooling tracks (2026-07-07).** Every test used to render as one flat vertical
    `<section>` in document order — fine at a handful of tests, unwieldy once a suite has 77+ tests
    across 23 files (as testFlow-tests' own report already does). `packages/reporter/src/html.ts`
    gains a `TestSlot` (id + file + the `TestResult`) computed once and shared by both a new
    sidebar (`renderSidebar`/`renderFileGroup`/`renderTestLink`) and `<main>`'s existing per-test
    panels (`renderTest`, now also carrying `id`/`data-file` and an `active` class). Grouping key is
    the new optional `TestResult.file` field (`types.ts`) — optional, not required, so every
    existing fixture/report built directly against `TestResult` across `runtime`/`reporter`'s own
    unit tests keeps compiling and rendering unchanged (groups under a `"(no file)"` fallback); the
    real value is stamped once, in `cli.ts`'s worker callback, by mapping each file's `report.tests`
    with `file: relative(cwd, file)` after `runProgram` returns — deliberately not threaded through
    `RunOptions`/the interpreter, since it's a display concern only, not something the interpreter
    itself needs to know.
    - Considered a pure-CSS `:checked`-hack tab UI (keeps report.html JS-free) but rejected it —
      can't do "default-select the first failing test" or a live filter box, which are the two
      things that actually matter once a suite is this size. Went with a small inline `<script>`
      instead (`SCRIPT` in `html.ts`): still one self-contained file (no external requests, opens
      via `file://` unchanged), just no longer JS-free.
    - Default state: a file group with any failing test starts expanded (`<details open>`) and
      shows a red dot + failure count; an all-passing group stays collapsed with a green dot. The
      first failing test's panel is active on load; an all-green run defaults to the first file's
      first test. A text filter + an All/Failed/Passed status toggle narrow the sidebar tree live.
    - `@media print` forces every `.test` panel visible and hides the sidebar, so printing/PDF
      export isn't affected by which tab happened to be open.
    8 new tests: 5 in `packages/reporter/test/html.test.ts` (file-group order/membership, open/
    collapsed + ok/fail state, default-active-section for both a-failure and all-green reports, the
    `"(no file)"` fallback, sidebar/script markup presence) plus fixing 1 pre-existing exact-markup
    test (new `id`/`data-file` attributes on `<section>`) and 1 pre-existing `cli/test/e2e.test.ts`
    regex (`<section class="test[^"]*">` → `[^"]*"[^>]*>`, to tolerate the new attributes). All
    146 lang + 133 runtime + 12 reporter (7→12) + 32 cli tests stayed green. Manually verified in a
    real Chromium tab (Playwright MCP) against testFlow-tests' actual 77-test/23-file report:
    default expand/collapse, click-to-switch between tests (including across file groups),
    text-filter narrowing, and the Failed/Passed status toggle all worked as designed — zero
    console errors beyond an unrelated browser-requested `favicon.ico` 404.

### P#93

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

93. **`tflw docs [topic]` — fourth of the four `/grill-me` UX/tooling tracks (2026-07-07).** A
    static cheatsheet generated from SPEC.md at build time, not hand-maintained separately and not
    parsed live at runtime (SPEC.md isn't shipped in the npm package). New
    `packages/cli/scripts/gen-docs.mjs` exports a pure `parseSpecToTopics(text, aliases?)`
    (no file I/O) that walks SPEC.md's `##`/`###` headings, strips trailing status emoji
    (✅/🔧/🔮) and `(P#...)`/`(TFLW-GAPS.md ...)` parentheticals and leading `N`/`N.M` numbering
    from the title, and collects each heading's own body text (up to the next heading of either
    level — a `##` parent with `###` children only gets its own intro paragraph as a topic, the
    children become their own separate topics). Topic slugs auto-derive from the heading text
    (kebab-cased, backticks stripped, only the part before an em-dash used for slugging so e.g.
    "Partial-object matching — `matches subset {...}`" slugs from just "Partial-object matching");
    a small `ALIASES` table (5 entries: `config`, `subset`, `quantifiers`, `matchers`, `events`)
    covers the handful of headings whose literal-text slug wouldn't be what a user actually types —
    everything else (mostly single backticked keywords like `retry`/`capture`/`let`) needed no
    help. The script's top-level file-read/write only runs when invoked directly
    (`process.argv[1] === fileURLToPath(import.meta.url)` guard), so a test can import
    `parseSpecToTopics` and exercise it against a small fixture string instead of the real
    ~800-line SPEC.md. Output is `packages/cli/src/docs-data.generated.ts` (gitignored, not
    source-committed) — wired into `pretest`/`predev`/`bundle` (which `prepack` already runs) so it
    regenerates automatically and can never drift from the SPEC.md that produced it.
    `docsCommand` in `cli.ts`: no topic lists every slug; a valid topic prints its title (underlined
    with `=`) + body; an unknown topic is a usage error (exit 2) reusing `@tflw/lang`'s existing
    `suggest()` (already public via `export *` from `diagnostic.ts` — no lang API change needed) for
    a "did you mean" hint, same mechanism the checker already uses for typo'd variables/sessions.
    6 new unit tests in `packages/cli/test/gen-docs.test.ts` (fixture-based: topic extraction,
    alias application, parent/child body-splitting, custom-alias-table support, no-topic-for-
    childless-empty-parent, `slugify`); 3 new e2e tests in `e2e.test.ts` against the real built
    `dist/cli.js` (topic listing, a real topic's content, the did-you-mean usage error). All 146
    lang + 133 runtime + 12 reporter + 41 cli tests (32→41) stayed green; `tsc --noEmit` clean.

### P#94

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

94. **VS Code extension: diagnostics + snippets + run — the last of the four `/grill-me`
    UX/tooling tracks (2026-07-07), explicitly supersedes P#76's "highlight-only in v0.1,
    squiggles/LSP wait for a real LSP consumer" deferral.** Not a real LSP (no hover/completion/
    go-to-def) — child-process-driven diagnostics + snippets + a run CodeLens, the same low-effort
    pattern most non-LSP editor extensions use. Two prerequisite CLI additions in `packages/cli/
    src/cli.ts`, both additive (no change to either command's existing default output):
    - `tflw check --format json <file>`: `loadAndValidate` gained an optional `onFileDiagnostics`
      callback parameter — when given, a per-file diagnostic batch (the common case: a syntax/
      checker error in the `.tflw` file itself) is handed to the callback instead of
      `renderDiagnostics`+stderr. `checkCommand`'s new json branch collects into an array and
      prints it as JSON, still returning the same exit code (0/2) as the text mode. Deliberately
      scoped: a broken `tflw.config` or unknown session service (config-level, not this-file's
      problem) still prints text to stderr and returns exit 2 with an empty JSON array on stdout —
      out of scope for a per-file editor check, not worth the complexity of representing every
      failure mode structurally for a v1.
    - `tflw run <file> --only "<exact test name>"`: `--tag` alone can't target one test (tags
      aren't required/unique). Filters `program.tests` by `t.name.value === args.only`, composing
      with `--tag` as AND (both must match) rather than treating them as mutually exclusive — no
      real reason to forbid combining them. A match-count-zero `--only` is a hard usage error
      (P#46), same posture as an unmatched `--tag`.

    Extension itself (`packages/vscode`), previously grammar-only with zero runtime code:
    - `src/lib.ts` (new): every piece of vscode-*independent* logic — `findProjectRoot` (walks up
      for the nearest `tflw.config`, the project's cwd for `tflw check`/`tflw run`),
      `resolveTflwBin` (prefers `node_modules/.bin/tflw`, falls back to a bare `tflw` on PATH),
      `spanToZeroBasedRange` (SPEC.md's 1-based line/column → VS Code's 0-based `Position`),
      `parseTestDeclarationLine` (regex-based `test "..."` matching + `\"`/`\\` unescaping, for
      CodeLens positioning — deliberately not a real parse, since this is editor-only positioning,
      not a correctness-sensitive check). Factored out specifically so it's unit-testable: `vscode`
      isn't a real installable npm package (only its *types* are, via `@types/vscode`) — the real
      module only exists inside a running extension host, so anything importing it can't run under
      a headless `node --test`.
    - `src/extension.ts` (new): thin glue over `lib.ts` — `activate()` wires
      `onDidSaveTextDocument`/`onDidOpenTextDocument` to spawn `tflw check --format json` and
      publish a `vscode.DiagnosticCollection`; a `TflwCodeLensProvider` places "▶ Run test"/
      "▶ Run file" above every `test "..."` line, both sending a command to a shared "tflw"
      integrated terminal (`--only` for the former, plain `tflw run <file>` for the latter).
      `tflw.config` is excluded from the diagnostics path (`doc.fileName.endsWith('.tflw')`) since
      `check --format json` expects a *test* file, not the declaration-only config dialect.
    - `snippets/tflw.json` (new): 7 snippets (`test`, `expect`, `session`, `before`/`after`
      each-scope and file-scope hooks, `with each`), contributed declaratively — no code.
    - Bundling: `scripts/bundle.mjs` (new) — esbuild, forced to CommonJS via a `.cjs` extension
      (`dist/extension.cjs`) regardless of the package's own `"type": "module"` (used for the
      tsx-run test suite), since VS Code's classic extension-host loader expects a `require()`-able
      module; `vscode` marked `external` (supplied by the host at runtime, never a real dependency
      to bundle). `main`/`activationEvents: ["onLanguage:tflw"]` added to `package.json`.
    - Packaging gotcha hit and fixed: `vsce package`'s default dependency-bundling walk followed
      this monorepo's hoisted `node_modules` workspace symlinks and pulled in **the entire
      repository** (671 files, 27MB, including a stray `.env` vsce correctly refused to ship) —
      irrelevant for a package with zero runtime npm dependencies (everything is esbuild-bundled
      into one file). Fixed with `vsce package --no-dependencies` (new `npm run package` script) +
      an explicit `"files"` allowlist in `package.json` (`dist`, `syntaxes`, `snippets`,
      `language-configuration.json`, `LICENSE`) replacing the old `.vscodeignore` (vsce refuses to
      combine both strategies) — the correct, not just expedient, fix for a fully-bundled extension.
    12 new unit tests in `packages/vscode/test/lib.test.ts` (project-root walking, binary
    resolution incl. the win32 `.cmd` filename case, span math incl. a floor-at-zero edge case,
    test-name parsing incl. escape decoding) — the 2 pre-existing grammar tests stayed green
    alongside them (14 total). 5 new e2e tests for the two CLI flags in `packages/cli/test/
    e2e.test.ts` (structured diagnostics on a real error, empty array on a clean file, unsupported
    `--format` value rejected, `--only` runs exactly one test, `--only` matching nothing is a usage
    error). Manually verified beyond unit tests, on the actual installed VS Code on this machine
    (`code --install-extension`, real `vsce package --no-dependencies` .vsix): the extension
    activates in the real extension host with zero errors (confirmed via `~/.config/Code/logs/*/
    windowN/exthost/exthost.log`, twice, in two independent sessions), and `tflw check --format
    json` against a fixture file with a deliberate typo returns the exact diagnostic the extension
    would consume. Screen-capture verification (squiggles/CodeLens actually rendering) was
    attempted but blocked by this machine's ImageMagick policy (`coder rights="none" pattern="*"`)
    — a system security policy, not touched — so the final visual link (does VS Code actually
    *render* the diagnostic/CodeLens once handed valid data) is unverified by this session and
    flagged for the user to spot-check themselves; the extension is already installed on this
    machine for that purpose.

### P#96

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

96. **Multi-session opt-in per test — `test "..." as admin, userA` — closes `TFLW-GAPS.md` gap
    #7.** Sourced from testFlow-tests' gap-hunting backlog (M5, 2026-07-07): only one identity
    could be opted into via session sugar, so every scenario needing two-plus identities in one
    test (a cross-user authz check, an admin acting alongside a shopper) fell back to an inline ad
    hoc login for every identity but one. Comma-separated list, same grammar shape as `require env
    A, B, C` (`parseRequire`) — `parseTest` now loops on `comma` tokens after the first `ident`
    following `as`. `TestDecl.session: string | null` → `TestDecl.sessions: readonly string[]`
    (empty array = anonymous); every AST golden fixture's `TestDecl` node changed shape as a
    result (mechanical rename, regenerated via `UPDATE_GOLDEN=1`, diffed to confirm nothing else
    moved).

    **Semantics — "independent, unrelated sessions," not a merge/compose model:** each opted-into
    session's headers and cookie jar fold into the test's starting state in declared order, a
    **later-listed session winning any header/cookie-name conflict against an earlier one** — the
    same "later source replaces" rule the existing config→session→jar→per-step precedence chain
    (§3.3) already followed, just extended one level. In the overwhelmingly common case this never
    actually collides (different sessions are normally different auth transports — a bearer header
    vs. a cookie), so the rule mostly exists for completeness, not because conflicts are expected.
    `checkSessions` (TF028) now loops per name, emitting one diagnostic per unknown name rather
    than aborting the whole `as` list on the first bad one. `CookieJar` gained `mergeFrom(other)`
    (last-call-wins per cookie name) since `clone()` alone only ever handled one source jar.

    **Splice-owner resolution (P#53) extended to per-session-*name*, not per-test:**
    `findSessionUsages` now emits one `{session, localIndex}` entry per name a case opts into
    (previously one entry per case); the CLI's existing up-front, sorted-file-order
    smallest-global-index-wins precompute (`sessionSpliceOwners: Map<string, number>`) needed no
    structural change at all — it was already generic over "however many usages a case
    contributes." `runProgramInner` now builds a `ReadonlyMap<string, boolean>` of per-name
    ownership per case (`kase.test.sessions.map(name => [name, owners.get(name) === globalIndex])`)
    instead of one boolean; `runTest`/`runTestAttempt` thread that map through instead of a single
    `isSessionOwner`, falling back to `SessionCache.claimShown(name)` per name when ownership
    wasn't precomputed (single-`runProgram`-call callers, e.g. test helpers). A test can therefore
    own one opted-in session's step-splice without owning another's, if some other test already
    claimed that other name first — proven directly by a new CLI e2e test extending P#53's
    own concurrency-determinism fixture to three files with *overlapping* session opt-ins
    (`a` as `auth1`; `b` as `auth1, auth2`; `c` as `auth2`), asserting each name's owner stays
    identical at `--workers 1` vs. `--workers 3`.

    23 new/updated tests: 1 new parser golden fixture (`multi-session`) + 1 new invalid-syntax
    fixture (`trailing-comma-session-list`, exercising the same dangling-comma error `parseRequire`
    already had) + 4 new `checkSessions` unit tests (accepts several known names; flags only the
    bad name(s) among several, one diagnostic each) + 4 new runtime tests in `sessions.test.ts`
    (both sessions' headers/cookies land on one request; later-listed wins a header conflict, and
    reversing the `as` order flips the winner too — confirms it's genuinely opt-in order, not
    config declaration order; each session in a multi-opt-in still shown exactly once,
    independently per name; an unknown name among several valid ones still fails clearly) + 1 new
    CLI e2e test (above). All existing suites stayed green throughout: 157/157 lang, 138/138
    runtime (was 134, +4), 12/12 reporter, 47/47 cli (was 46, +1), 12/12 vscode — 366 total, 0
    regressions. SPEC §3.3 and §4.1 updated with the multi-session prose; `GRAMMAR.md`'s (already
    stale/unmaintained — missing `retry`/`with each` too) `TestDecl` line updated for consistency
    regardless.

### P#99

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN.md`</sub>

99. **M9 — Auth: session refresh-on-401 + TTL, `oauth2` session sugar, mTLS client certs** —
    cluster 1 of the enterprise-readiness arc (`PLAN_ENTERPRISE.md`, a `/grill-me` session,
    2026-07-18, enterprise decisions 1–3/13/14). The arc **displaces M3 (browser half)** as tflw's next work
    (enterprise decision 2) and proceeds in a fixed 6-cluster ping-pong cadence against
    testFlow-tests (enterprise decision 14); this is cluster 1 of 6. Three sub-features, all
    additive grammar/runtime, no breaking change:

    **(a) Session refresh-on-401 + TTL (enterprise decision 3a).** The real pain this closes:
    M14's session cache ran a session's steps *at most once per run* (P#42) and cached
    forever on success — correct for a login that never expires mid-run, wrong the moment a
    session's credential has a real TTL (an OAuth2 access token, a short-lived JWT). `EvalCtx`
    gains `sessionNames: readonly string[]` (the test's own `as <session>` list, `[]` for an
    anonymous test/action call) so an `ApiStep` that comes back `401` knows which session(s) are
    even eligible to refresh — a `401` on an anonymous test, or one whose opted-in sessions are
    already exhausted, is never treated as refreshable. `SessionOutcome` gains an optional
    `expiresAt: number`; `SessionCache.ensure()` now checks `Date.now() >= cached.expiresAt` before
    returning a memoized promise, treating expiry exactly like a cache miss (a plain header-block
    session with no TTL concept never sets `expiresAt`, so its old cache-forever behavior is
    unchanged). A new `SessionCache.invalidate(name)` clears one session's memo on demand. On a
    `401`, `execSteps` now calls a new `refreshSessions(ctx, ctx.sessionNames, …)`: invalidates and
    re-establishes each opted-in session in declared order, mutates the test's live
    `sessionHeaders`/`cookieJar` in place, records synthetic `header`-kind evidence steps in the
    report (so a manual QA sees "session re-established" in the timeline, not just a mysteriously
    passing retry), and retries the failed request **exactly once** — bounded, no infinite
    refresh↔401 loop even if the credential is permanently bad. If the re-establish attempt itself
    fails, the original `401` stands and fails the test with the refresh attempt's own evidence
    attached, never a silent swallow.

    **(b) mTLS client certs (enterprise decision 3b).** Per-`env` `cert "…"` / `key "…"` config
    keys (new `CertDecl`/`KeyDecl` AST nodes, mirroring `WebDecl`'s `parseString`-based shape) —
    `ResolvedConfig.mtls: { certPath, keyPath } | null`, rejected at config-resolve time if only
    one of the pair is set (checked once both `defaults` and `env` blocks are merged, since the
    pair may legally be split across them — a `cert` in `defaults` shared by every env, `key` only
    in one `env`, resolves fine). Node's global `fetch` has no per-request client-cert hook, so the
    mTLS path alone routes through a real, narrowly-scoped **`undici`** dependency (`Agent` +
    `fetch` with a `dispatcher`) — every other request in the codebase is completely untouched,
    still the plain global `fetch`. Cert/key file contents are read once per run and cached by
    resolved path pair (`loadMtlsCreds`), not re-read per request. Reusing §3.5's
    `NODE_EXTRA_CA_CERTS`/`NODE_TLS_REJECT_UNAUTHORIZED` story for the mTLS path surfaced a real
    Node/undici gotcha along the way: both env vars are read only once, at first TLS-context
    creation, by Node's global `fetch` and by a naively-configured `undici.Agent` — a value set or
    changed mid-process (exactly `insecure`'s own reference-counted toggle, §3.5) would silently
    have no effect on an mTLS connection. Fixed proactively via a `mtlsConnectOptions()` helper
    that re-reads both env vars fresh on every connection — the mTLS path is now arguably more
    robust on this specific axis than the pre-existing plain-fetch path, not just at parity with
    it. Proven end-to-end against a real local CA + SAN-bearing server cert + client cert, all
    `openssl`-generated in the test's own `before()` hook (no fixtures committed) — modern Node TLS
    rejects a CN-only cert with `ERR_TLS_CERT_ALTNAME_INVALID`, so the server cert needs a real
    `subjectAltName` extension, not just a `CN`.

    **(c) `oauth2` session sugar (enterprise decision 3c), built on top of (a).** `session <name>
    oauth2` (new `Oauth2SessionConfig` on `SessionDecl`, mutually exclusive with a hand-written
    body — the parser branches on an `oauth2` keyword right after the session name) — `token url`,
    `client id`, `client secret`, optional `scope`, every field a `Value` so `env(...)` works.
    `runOauth2Session` POSTs a standard form-urlencoded client-credentials grant
    (`grant_type=client_credentials&client_id=…&client_secret=…&scope=…`), reads `access_token`
    (required, fails clearly if absent) and `expires_in` (optional — no `expires_in` means no TTL,
    the token is cached exactly like a hand-written session), and sets `expiresAt` with a safety
    margin (`min(2s, 50% of expires_in)` shaved off the end) so a request that lands right at the
    boundary refreshes proactively rather than racing a real `401`. Zero new redaction code needed:
    `client secret`'s `env(...)` value is auto-registered by the existing eager
    `config.requiredEnv` pre-registration (P#56), so it's masked in the token-request
    evidence from the very first step, same as any other secret.

    **Bundling fallout (undici, enterprise decision 13):** esbuild's ESM bundle output couldn't absorb
    undici's CJS internals — undici's own source has `require()` calls inside function bodies
    (lazy/conditional), which esbuild can't hoist into static ESM `import`s; bundled into ESM
    output they became a shim that throws `Dynamic require of "node:assert" is not supported` at
    runtime, breaking the CLI outright. Fixed by switching `packages/cli`'s bundle to CJS output
    (`dist/cli.cjs`, not `dist/cli.js` — the `.cjs` extension is required because the package
    itself is `"type": "module"`) — CJS has no such restriction, `require` is native and
    synchronous there. `package.json`'s `bin` field and every hardcoded `dist/cli.js` reference
    across tests/docs/comments updated to `dist/cli.cjs`; `package-lock.json` regenerated to match.
    `packages/runtime/package.json` gains `undici` as a real `dependencies` entry — this does not
    reverse P#43's zero-runtime-dependency promise for the *published* `tflw` package,
    since only the bundled CLI artifact is ever published (never `@tflw/runtime` standalone); §15
    updated to say so explicitly rather than leave the older "essentially zero runtime deps"
    phrasing overclaiming again.

    75 new/updated tests, all suites green throughout: **169/169 lang** (+12 — grammar/golden/
    checker fixtures for `oauth2`/`cert`/`key`), **162/162 runtime** (+24 — 4 refresh-on-401 cases
    in `sessions.test.ts`, 7 in the new `oauth2-session.test.ts`, 6 in the new `mtls.test.ts`, plus
    supporting fixture/support-file updates), **12/12 reporter** (unchanged), **52/52 cli** (+1 —
    the esbuild-format regression surfaced and fixed the CLI's own `dist/cli.cjs` rename), **12/12
    vscode** (unchanged) — 407 total, 0 regressions.

### P#99a

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

    **(a) Session refresh-on-401 + TTL (enterprise decision 3a).** The real pain this closes:
    M14's session cache ran a session's steps *at most once per run* (P#42) and cached
    forever on success — correct for a login that never expires mid-run, wrong the moment a
    session's credential has a real TTL (an OAuth2 access token, a short-lived JWT). `EvalCtx`
    gains `sessionNames: readonly string[]` (the test's own `as <session>` list, `[]` for an
    anonymous test/action call) so an `ApiStep` that comes back `401` knows which session(s) are
    even eligible to refresh — a `401` on an anonymous test, or one whose opted-in sessions are
    already exhausted, is never treated as refreshable. `SessionOutcome` gains an optional
    `expiresAt: number`; `SessionCache.ensure()` now checks `Date.now() >= cached.expiresAt` before
    returning a memoized promise, treating expiry exactly like a cache miss (a plain header-block
    session with no TTL concept never sets `expiresAt`, so its old cache-forever behavior is
    unchanged). A new `SessionCache.invalidate(name)` clears one session's memo on demand. On a
    `401`, `execSteps` now calls a new `refreshSessions(ctx, ctx.sessionNames, …)`: invalidates and
    re-establishes each opted-in session in declared order, mutates the test's live
    `sessionHeaders`/`cookieJar` in place, records synthetic `header`-kind evidence steps in the
    report (so a manual QA sees "session re-established" in the timeline, not just a mysteriously
    passing retry), and retries the failed request **exactly once** — bounded, no infinite
    refresh↔401 loop even if the credential is permanently bad. If the re-establish attempt itself
    fails, the original `401` stands and fails the test with the refresh attempt's own evidence
    attached, never a silent swallow.

### P#99b

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

    **(b) mTLS client certs (enterprise decision 3b).** Per-`env` `cert "…"` / `key "…"` config
    keys (new `CertDecl`/`KeyDecl` AST nodes, mirroring `WebDecl`'s `parseString`-based shape) —
    `ResolvedConfig.mtls: { certPath, keyPath } | null`, rejected at config-resolve time if only
    one of the pair is set (checked once both `defaults` and `env` blocks are merged, since the
    pair may legally be split across them — a `cert` in `defaults` shared by every env, `key` only
    in one `env`, resolves fine). Node's global `fetch` has no per-request client-cert hook, so the
    mTLS path alone routes through a real, narrowly-scoped **`undici`** dependency (`Agent` +
    `fetch` with a `dispatcher`) — every other request in the codebase is completely untouched,
    still the plain global `fetch`. Cert/key file contents are read once per run and cached by
    resolved path pair (`loadMtlsCreds`), not re-read per request. Reusing §3.5's
    `NODE_EXTRA_CA_CERTS`/`NODE_TLS_REJECT_UNAUTHORIZED` story for the mTLS path surfaced a real
    Node/undici gotcha along the way: both env vars are read only once, at first TLS-context
    creation, by Node's global `fetch` and by a naively-configured `undici.Agent` — a value set or
    changed mid-process (exactly `insecure`'s own reference-counted toggle, §3.5) would silently
    have no effect on an mTLS connection. Fixed proactively via a `mtlsConnectOptions()` helper
    that re-reads both env vars fresh on every connection — the mTLS path is now arguably more
    robust on this specific axis than the pre-existing plain-fetch path, not just at parity with
    it. Proven end-to-end against a real local CA + SAN-bearing server cert + client cert, all
    `openssl`-generated in the test's own `before()` hook (no fixtures committed) — modern Node TLS
    rejects a CN-only cert with `ERR_TLS_CERT_ALTNAME_INVALID`, so the server cert needs a real
    `subjectAltName` extension, not just a `CN`.

### P#99c

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

    **(c) `oauth2` session sugar (enterprise decision 3c), built on top of (a).** `session <name>
    oauth2` (new `Oauth2SessionConfig` on `SessionDecl`, mutually exclusive with a hand-written
    body — the parser branches on an `oauth2` keyword right after the session name) — `token url`,
    `client id`, `client secret`, optional `scope`, every field a `Value` so `env(...)` works.
    `runOauth2Session` POSTs a standard form-urlencoded client-credentials grant
    (`grant_type=client_credentials&client_id=…&client_secret=…&scope=…`), reads `access_token`
    (required, fails clearly if absent) and `expires_in` (optional — no `expires_in` means no TTL,
    the token is cached exactly like a hand-written session), and sets `expiresAt` with a safety
    margin (`min(2s, 50% of expires_in)` shaved off the end) so a request that lands right at the
    boundary refreshes proactively rather than racing a real `401`. Zero new redaction code needed:
    `client secret`'s `env(...)` value is auto-registered by the existing eager
    `config.requiredEnv` pre-registration (P#56), so it's masked in the token-request
    evidence from the very first step, same as any other secret.

### P#100

<sub>cited from CHANGELOG.md · lifted from `PLAN.md`</sub>

100. **Fix: `parseConfig()` hang/OOM on a malformed `require env` continuation** — found dogfooding
    M22 in testFlow-tests: `require env A, B,\n  C, D` (a trailing comma before the newline —
    `require env` has no line-continuation support) hung the CLI, and on a second attempt drove
    Node to `FATAL ERROR: Reached heap limit`. Root cause: `parseRequire()`'s comma loop fails
    cleanly on the dangling continuation (an `expect('ident', …)` diagnostic, no crash there), but
    the orphaned indented continuation line (`  C, D`) leaves a stray `dedent` token that
    `parseConfig()`'s own top-level recovery loop then gets stuck on forever. `synchronize()`
    deliberately never consumes a `dedent` it's already sitting on (nested blocks consume their
    own — by design, per `parse()`'s own comment on this exact hazard), so every other top-level/
    block-level recovery loop in `parser.ts` (`parse()`, `parseBlock()`, `parseConfigEntries()`,
    `parseSessionBlock()`, `parseOauth2SessionConfig()`, `parseApiHeaders()`, `parseWaitUntilBody()`,
    `parseDataTable()`) independently guarantees forward progress with `if (this.pos === before)
    this.advance();` after calling `synchronize()`. `parseConfig()` alone was missing this guard —
    a plain oversight, not a deliberate asymmetry between the two grammar entry points (`parse()`
    for `.tflw` files, `parseConfig()` for `tflw.config`). Fixed by adding the identical guard.
    Deliberately did **not** add line-continuation support to `require env` itself — that's a
    feature question (unclear if worth the grammar complexity vs. just documenting one-line-only),
    out of scope for a crash fix; the parser now reports three bounded diagnostics (TF010 + two
    TF022s) and recovers to keep parsing the rest of the file, instead of hanging. New golden
    fixture `config-errors/require-env-trailing-comma-continuation` (`packages/lang/test/
    fixtures.ts`) pins this down — its second `env` block only parses if recovery genuinely resumes
    normal parsing, not just that the loop exits. 409/409 lang+runtime+reporter+cli+vscode tests
    green (+2 over P#99's 407, both from this fixture).

### P#101

<sub>cited from CHANGELOG.md · lifted from `PLAN.md`</sub>

101. **M10 — Safety/redaction: `allow hosts`, `--forbid-insecure`, `evidence` levels, `redact`
    fields** — cluster 2 of the enterprise-readiness arc (`PLAN_ENTERPRISE.md`, decisions 5/9/14),
    immediately following cluster 1 (P#99). Four sub-features, all additive grammar/
    runtime, no breaking change:

    **(a) `allow hosts "…"` host allowlist (enterprise decision 9).** New `AllowHostsDecl` AST
    node (`allow` added to `CONFIG_KEYS`, dispatches to `parseAllowHostsDecl` — `allow`, a
    required `hosts` keyword, then a comma-separated list of host strings, mirroring
    `parseTimeoutDecls`'s comma-loop shape). Unlike `insecure`/`workers` (override — env wins),
    `allow hosts` **accumulates** across `defaults` + `env`, the same push semantics `header`
    already uses — a baseline allowlist in `defaults`, extended per env.
    `ResolvedConfig.allowHosts: string[] | null` (`null` = never declared, no enforcement,
    backward compatible). Enforced in `execApi()` (`interpreter.ts`) right after the final `url`
    is computed, **before** `sendRequest` — a violation throws `RuntimeError` with zero network
    I/O attempted, not just a failed request; the `oauth2` token request (`runOauth2Session`) gets
    the identical check before its own `sendRequest` call, since it's a real network request the
    allowlist must cover too, not just ordinary `api` steps. A pattern starting with `*.` matches
    that suffix or the bare domain; anything else must match the hostname exactly
    (`hostMatchesAllowPattern`).

    **(b) `--forbid-insecure` (enterprise decision 9).** A pure CLI boolean, `run` only, no config
    representation — the "anti-pointed-at-prod" CI policy gate the arc named directly. Checked in
    `runCommand()` right after `loadAndValidate()` resolves the active env's config:
    `resolved.insecure` active + the flag set is a usage error (`EXIT_USAGE`), before any test
    runs, before the `missingRequiredEnv` gate. Deliberately reads only the *active* env's resolved
    `insecure` (the config actually in effect for this run), not a scan of every `env` block in
    the file — "active" is the plan's own wording, and an unrelated env's `insecure true` was
    never going to run anyway.

    **(c) `evidence full|headers-only|none` + `--evidence` override (enterprise decision 5a).** New
    scalar `EvidenceDecl` (override semantics, like `insecure`), default `full` — today's
    unchanged behavior. The value is a string literal (`evidence "headers-only"`), not a bare
    word: the lexer has no hyphen in `isIdentCont`, so `headers-only` can't lex as a single ident.
    `--evidence <level>` on the CLI overrides it for that run only, validated the same way
    `--seed`/`--workers` are (a usage error on an unrecognized value, never silently ignored).
    Enforced exactly where the **report-only** trace is already built — `redactRequest`/
    `redactResponse` (`interpreter.ts`), which every step already routes through separately from
    the raw `trace` that `expect`/`capture` read — so trimming a level never affects what an
    assertion can see, only what lands in the report. `headers-only` drops `body`/`bodyText`
    (replaced with a `[omitted by evidence level]` marker so it reads as intentional, never
    confused with a genuinely empty 204 body); `none` drops headers too, keeping only
    method/url/status/statusText/durationMs.

    **(d) `redact body.email, body.*.address` declarative field redaction (enterprise decision
    5b).** New `RedactDecl`/`RedactPattern`/`RedactPathSegment` — deliberately a *separate*,
    minimal path type from the `PathSegment` `expect`/`capture` already use, not an extension of
    it (those never need wildcards and shouldn't silently gain them). `body.*.address` lexes for
    free off the lexer's existing `star` token (already used for arithmetic `*`) — no new lexer
    work. Accumulates across `defaults` + `env`, same as `allow hosts`. New sibling module
    `packages/runtime/src/fieldRedact.ts` (`redactFields`): best-effort JSON parse → mask every
    leaf a pattern's segments reach with `[redacted]` → re-stringify; a non-JSON body, or a
    pattern matching nothing in this particular body, passes through byte-for-byte unchanged (no
    gratuitous reformatting). Applied at the same `redactRequest`/`redactResponse` boundary as
    (c), in order: secret `Redactor.redact()` (existing, P#30) → field redaction → evidence-level
    trim. Distinct mechanism from the existing taint-based secret redaction (`redact.ts`): this one
    masks a field by *path*, regardless of whether its value ever came from `env(...)`.

    29 new/updated tests, all suites green throughout: **183/183 lang** (+12 — golden AST/error
    fixtures for `allow`/`evidence`/`redact`), **175/175 runtime** (+13 — `allow-hosts.test.ts`,
    `evidence-level.test.ts`, `field-redaction.test.ts`), **12/12 reporter** (unchanged), **56/56
    cli** (+4 — `--forbid-insecure`/`--evidence` e2e coverage in `e2e.test.ts`, against the real
    built `dist/cli.cjs`), **12/12 vscode** (unchanged) — 438 total, 0 regressions. SPEC.md
    updated: new §3.7 (host allowlist), §3.4 extended (declarative field redaction alongside the
    existing taint-based secret redaction), §12 (the two new CLI flags), §13 (evidence-level
    vocabulary). `PLAN_ENTERPRISE.md` cluster 2 is done on the tflw side; testFlow-tests' M23
    consumption milestone (new PII profile/export fixture + real `.tflw` coverage) follows next,
    per this workspace's standing git-push/commit confirmation rule commits are created but not
    pushed without asking first.

### P#101a

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

    **(a) `allow hosts "…"` host allowlist (enterprise decision 9).** New `AllowHostsDecl` AST
    node (`allow` added to `CONFIG_KEYS`, dispatches to `parseAllowHostsDecl` — `allow`, a
    required `hosts` keyword, then a comma-separated list of host strings, mirroring
    `parseTimeoutDecls`'s comma-loop shape). Unlike `insecure`/`workers` (override — env wins),
    `allow hosts` **accumulates** across `defaults` + `env`, the same push semantics `header`
    already uses — a baseline allowlist in `defaults`, extended per env.
    `ResolvedConfig.allowHosts: string[] | null` (`null` = never declared, no enforcement,
    backward compatible). Enforced in `execApi()` (`interpreter.ts`) right after the final `url`
    is computed, **before** `sendRequest` — a violation throws `RuntimeError` with zero network
    I/O attempted, not just a failed request; the `oauth2` token request (`runOauth2Session`) gets
    the identical check before its own `sendRequest` call, since it's a real network request the
    allowlist must cover too, not just ordinary `api` steps. A pattern starting with `*.` matches
    that suffix or the bare domain; anything else must match the hostname exactly
    (`hostMatchesAllowPattern`).

### P#101b

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

    **(b) `--forbid-insecure` (enterprise decision 9).** A pure CLI boolean, `run` only, no config
    representation — the "anti-pointed-at-prod" CI policy gate the arc named directly. Checked in
    `runCommand()` right after `loadAndValidate()` resolves the active env's config:
    `resolved.insecure` active + the flag set is a usage error (`EXIT_USAGE`), before any test
    runs, before the `missingRequiredEnv` gate. Deliberately reads only the *active* env's resolved
    `insecure` (the config actually in effect for this run), not a scan of every `env` block in
    the file — "active" is the plan's own wording, and an unrelated env's `insecure true` was
    never going to run anyway.

### P#101c

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

    **(c) `evidence full|headers-only|none` + `--evidence` override (enterprise decision 5a).** New
    scalar `EvidenceDecl` (override semantics, like `insecure`), default `full` — today's
    unchanged behavior. The value is a string literal (`evidence "headers-only"`), not a bare
    word: the lexer has no hyphen in `isIdentCont`, so `headers-only` can't lex as a single ident.
    `--evidence <level>` on the CLI overrides it for that run only, validated the same way
    `--seed`/`--workers` are (a usage error on an unrecognized value, never silently ignored).
    Enforced exactly where the **report-only** trace is already built — `redactRequest`/
    `redactResponse` (`interpreter.ts`), which every step already routes through separately from
    the raw `trace` that `expect`/`capture` read — so trimming a level never affects what an
    assertion can see, only what lands in the report. `headers-only` drops `body`/`bodyText`
    (replaced with a `[omitted by evidence level]` marker so it reads as intentional, never
    confused with a genuinely empty 204 body); `none` drops headers too, keeping only
    method/url/status/statusText/durationMs.

### P#101d

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

    **(d) `redact body.email, body.*.address` declarative field redaction (enterprise decision
    5b).** New `RedactDecl`/`RedactPattern`/`RedactPathSegment` — deliberately a *separate*,
    minimal path type from the `PathSegment` `expect`/`capture` already use, not an extension of
    it (those never need wildcards and shouldn't silently gain them). `body.*.address` lexes for
    free off the lexer's existing `star` token (already used for arithmetic `*`) — no new lexer
    work. Accumulates across `defaults` + `env`, same as `allow hosts`. New sibling module
    `packages/runtime/src/fieldRedact.ts` (`redactFields`): best-effort JSON parse → mask every
    leaf a pattern's segments reach with `[redacted]` → re-stringify; a non-JSON body, or a
    pattern matching nothing in this particular body, passes through byte-for-byte unchanged (no
    gratuitous reformatting). Applied at the same `redactRequest`/`redactResponse` boundary as
    (c), in order: secret `Redactor.redact()` (existing, P#30) → field redaction → evidence-level
    trim. Distinct mechanism from the existing taint-based secret redaction (`redact.ts`): this one
    masks a field by *path*, regardless of whether its value ever came from `env(...)`.

### P#102

<sub>cited from CHANGELOG.md, packages/lang/GRAMMAR.md · lifted from `PLAN.md`</sub>

102. **M11 — Contract + Retry-After: `matches schema ... from ...`, `retry honoring
    "Retry-After" up to N`** — cluster 3 of the enterprise-readiness arc (`PLAN_ENTERPRISE.md`
    decisions 5/6/14), immediately following cluster 2 (P#101). Closes TFLW-GAPS.md gaps
    #6 and #5 — enterprise decision 14's fixed cadence puts gap #12 (assert on a computed local value) in
    cluster 6's "gap tail" instead, despite enterprise decision 6's looser "entire open gap backlog" phrasing.
    Two sub-features, both additive grammar/runtime, no breaking change:

    **(a) `expect body matches schema "Name" from "source"` contract validation (enterprise
    decision 6, gap #6).** A third branch under the existing `matches` matcher keyword
    (`parseMatcher`), alongside `matches subset {...}`/`matches "regex"` — `matches schema`,
    a string schema name, `from`, a string URL/path. New `'matchesSchema'` `MatcherName` +
    optional `schemaName`/`schemaSource` on `Matcher` (`value` stays null, like the state
    matchers). Real **ajv** validation (enterprise decision 13's second bundled dependency,
    alongside `undici`) against an API's own `/openapi.json` — not the hand-rolled minimal
    validator testFlow-tests' `schema-check.ts` JS-escape-hatch used as a workaround; ajv gets
    real `$ref` resolution across `components.schemas` for free. Deliberately **not** evaluated
    inside `evalMatcher`/`matcher.ts` (pure and synchronous by design, P#13) — fetching an
    external document is I/O, so `evaluateExpect`/`execExpect` (`interpreter.ts`) become `async`
    instead (both their call sites: `execSteps`'s `ExpectStmt` case, and `wait until api`'s own
    nested-expects `.map` → `Promise.all`), dispatching `matchesSchema` straight to a new sibling
    module `packages/runtime/src/contract.ts` and bypassing `evalMatcher` entirely for this one
    matcher. `evaluateQuantified` (`any`/`all`) gets a guard throwing `RuntimeError` on
    `matchesSchema` — a per-element quantifier combined with a whole-document async fetch is out
    of scope, same "loud, not silent" philosophy as its existing body-path-subject guard.
    `contract.ts`: a module-level `Map<string, Promise<Ajv>>` cache keyed by resolved URL (same
    precedent as `interpreter.ts`'s existing `mtlsCredCache`, not threaded through
    `RunOptions`/`TestCtx` — dedupes concurrent `--workers N` fetches of the same doc for free); a
    relative source resolves against the **default service's** base URL (`resolveBaseUrl(null,
    …)`, now exported for this reuse, alongside `ensureLeadingSlash`/`checkHostAllowed` — the
    `allow hosts` policy gates this real network fetch too, not just `api` steps); each
    `components.schemas` entry is registered via `ajv.addSchema(schema, '#/components/schemas/' +
    name)`, the standard recipe that makes ajv resolve a DTO's own `$ref` against a sibling
    registration; a `normalizeOpenApiSchema()` pass folds OpenAPI 3.0's `nullable: true` (a
    keyword plain ajv doesn't understand) into `type: [..., 'null']` before registering. `ajv`
    needed no esbuild config to get bundled into `dist/cli.cjs` — it's a transitive dependency of
    `@tflw/runtime` now, and `bundle: true` already picks up every dependency the same way it
    already did for `undici`.

    **(b) `retry honoring "Retry-After" up to N` (enterprise decision 6, gap #5).** Deliberately
    **not** a reuse of `test … retry N` (SPEC §4.4) — that retries the *entire test* immediately,
    which is wrong here: the real workaround it replaces (testFlow-tests'
    `sleep-and-retry.ts` JS helper) re-issues only *one specific request*, not a test's earlier
    setup calls. A new per-`api`-step sub-clause instead, parsed in the same indented block as a
    step's `header "…" is …` lines (`parseApiHeaders`, now also returning `retryAfter`): `retry`
    `honoring` a string (validated against a fixed one-item list, `["Retry-After"]`, the same
    string-literal-validation trick `evidence "headers-only"` used for the lexer's no-hyphen-in-
    identifiers limitation) `up` `to` a number. New `RetryAfterClause` AST node; `ApiRequestSpec`
    gains `retryAfter: RetryAfterClause | null` (always null for `wait until api`, which keeps its
    own poll-until-expect-passes retry mechanism and never parses this clause). `execApi`
    (`interpreter.ts`): after the first `sendRequest`, if set, loops reading
    `response.headers['retry-after']` — absent or unparseable stops immediately (today's
    unchanged single-attempt behavior); otherwise a new `parseRetryAfterMs()` helper (all-digits →
    seconds; else `Date.parse` → clamped `max(0, date - now)`; neither → stop) → `sleep()` (the
    existing helper `wait until api`'s own polling already uses) → re-`sendRequest` the identical
    request, up to `max` extra attempts (same "up to N *extra* attempts" semantics `test … retry
    N` already uses). `ApiExec` gains `retryAfterAttempts`/`retryAfterWaitedMs`; `execSteps`'s
    `ApiStep` case (both its initial and 401-refresh-retry `execApi` call sites) appends a visible
    report-line suffix when attempts > 0 — retry evidence stays visible in the report, the same
    stated principle (P#5/P#16) the 401-refresh-retry code right next to it already follows.

    No config-key, no CLI-flag surface for either feature — pure DSL grammar + runtime behavior;
    `checker.ts` needed no changes (neither touches its `ConfigEntry`-only `keyName()`
    exhaustiveness switch). `GRAMMAR.md` deliberately not touched — confirmed via `git log` that
    P#99/P#101 never touched it either despite their own writeups saying they would; it's a
    frozen M0 snapshot in practice, SPEC.md is the actual living grammar reference.

    20 new/updated tests, all suites green throughout: **193/193 lang** (+10 — golden AST/error
    fixtures for the schema matcher + `retry honoring`), **185/185 runtime** (+10 —
    `retry-after.test.ts` (4: seconds format, HTTP-date format, max-attempts-exhausted, unchanged
    no-clause behavior), `contract-schema.test.ts` (6: positive match with cross-`$ref`
    resolution, missing-required-field mismatch, `not matches schema` polarity, unknown-schema-
    name error, malformed-document error, single-fetch caching across two assertions)), **12/12
    reporter** (unchanged), **56/56 cli** (unchanged — no new CLI surface this cluster), **12/12
    vscode** (unchanged) — 458 total, 0 regressions. SPEC.md updated: §5.1 (the `retry honoring`
    clause), the matcher section (`matches schema … from …`), and the existing "`ajv` … is
    planned for arc cluster 3 but not yet built" sentence corrected to say it's now actually
    bundled. `PLAN_ENTERPRISE.md` cluster 3 is done on the tflw side; testFlow-tests' M24
    consumption milestone (new `retry-demo`/`contract-demo` apiV2 fixtures + real `.tflw`
    coverage + closing TFLW-GAPS.md gaps #5/#6) follows next, per this workspace's standing
    git-push/commit confirmation rule commits are created but not pushed without asking first.

### P#102a

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN.md`</sub>

    **(a) `expect body matches schema "Name" from "source"` contract validation (enterprise
    decision 6, gap #6).** A third branch under the existing `matches` matcher keyword
    (`parseMatcher`), alongside `matches subset {...}`/`matches "regex"` — `matches schema`,
    a string schema name, `from`, a string URL/path. New `'matchesSchema'` `MatcherName` +
    optional `schemaName`/`schemaSource` on `Matcher` (`value` stays null, like the state
    matchers). Real **ajv** validation (enterprise decision 13's second bundled dependency,
    alongside `undici`) against an API's own `/openapi.json` — not the hand-rolled minimal
    validator testFlow-tests' `schema-check.ts` JS-escape-hatch used as a workaround; ajv gets
    real `$ref` resolution across `components.schemas` for free. Deliberately **not** evaluated
    inside `evalMatcher`/`matcher.ts` (pure and synchronous by design, P#13) — fetching an
    external document is I/O, so `evaluateExpect`/`execExpect` (`interpreter.ts`) become `async`
    instead (both their call sites: `execSteps`'s `ExpectStmt` case, and `wait until api`'s own
    nested-expects `.map` → `Promise.all`), dispatching `matchesSchema` straight to a new sibling
    module `packages/runtime/src/contract.ts` and bypassing `evalMatcher` entirely for this one
    matcher. `evaluateQuantified` (`any`/`all`) gets a guard throwing `RuntimeError` on
    `matchesSchema` — a per-element quantifier combined with a whole-document async fetch is out
    of scope, same "loud, not silent" philosophy as its existing body-path-subject guard.
    `contract.ts`: a module-level `Map<string, Promise<Ajv>>` cache keyed by resolved URL (same
    precedent as `interpreter.ts`'s existing `mtlsCredCache`, not threaded through
    `RunOptions`/`TestCtx` — dedupes concurrent `--workers N` fetches of the same doc for free); a
    relative source resolves against the **default service's** base URL (`resolveBaseUrl(null,
    …)`, now exported for this reuse, alongside `ensureLeadingSlash`/`checkHostAllowed` — the
    `allow hosts` policy gates this real network fetch too, not just `api` steps); each
    `components.schemas` entry is registered via `ajv.addSchema(schema, '#/components/schemas/' +
    name)`, the standard recipe that makes ajv resolve a DTO's own `$ref` against a sibling
    registration; a `normalizeOpenApiSchema()` pass folds OpenAPI 3.0's `nullable: true` (a
    keyword plain ajv doesn't understand) into `type: [..., 'null']` before registering. `ajv`
    needed no esbuild config to get bundled into `dist/cli.cjs` — it's a transitive dependency of
    `@tflw/runtime` now, and `bundle: true` already picks up every dependency the same way it
    already did for `undici`.

### P#102b

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN.md`</sub>

    **(b) `retry honoring "Retry-After" up to N` (enterprise decision 6, gap #5).** Deliberately
    **not** a reuse of `test … retry N` (SPEC §4.4) — that retries the *entire test* immediately,
    which is wrong here: the real workaround it replaces (testFlow-tests'
    `sleep-and-retry.ts` JS helper) re-issues only *one specific request*, not a test's earlier
    setup calls. A new per-`api`-step sub-clause instead, parsed in the same indented block as a
    step's `header "…" is …` lines (`parseApiHeaders`, now also returning `retryAfter`): `retry`
    `honoring` a string (validated against a fixed one-item list, `["Retry-After"]`, the same
    string-literal-validation trick `evidence "headers-only"` used for the lexer's no-hyphen-in-
    identifiers limitation) `up` `to` a number. New `RetryAfterClause` AST node; `ApiRequestSpec`
    gains `retryAfter: RetryAfterClause | null` (always null for `wait until api`, which keeps its
    own poll-until-expect-passes retry mechanism and never parses this clause). `execApi`
    (`interpreter.ts`): after the first `sendRequest`, if set, loops reading
    `response.headers['retry-after']` — absent or unparseable stops immediately (today's
    unchanged single-attempt behavior); otherwise a new `parseRetryAfterMs()` helper (all-digits →
    seconds; else `Date.parse` → clamped `max(0, date - now)`; neither → stop) → `sleep()` (the
    existing helper `wait until api`'s own polling already uses) → re-`sendRequest` the identical
    request, up to `max` extra attempts (same "up to N *extra* attempts" semantics `test … retry
    N` already uses). `ApiExec` gains `retryAfterAttempts`/`retryAfterWaitedMs`; `execSteps`'s
    `ApiStep` case (both its initial and 401-refresh-retry `execApi` call sites) appends a visible
    report-line suffix when attempts > 0 — retry evidence stays visible in the report, the same
    stated principle (P#5/P#16) the 401-refresh-retry code right next to it already follows.

### P#103

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN.md`</sub>

103. **M12 — Documentation site** — cluster 4 of the (now 8-cluster) enterprise-readiness arc
    (`PLAN_ENTERPRISE.md` decision 16, a `/grill-me` session 2026-07-19), immediately following
    cluster 3 (P#102). Unlike clusters 1–3, this cluster adds no DSL grammar or runtime
    behavior, so it has **no testFlow-tests consumption milestone** — the cadence exception
    enterprise decision 16 documents. Six lettered sub-parts, from a canonical `spec-data.ts` manifest
    through a new VitePress `docs-site` workspace, a parse-and-check playground, a `GRAMMAR.md`
    rewrite and a README trimmed to a landing page, to the workflow that publishes the site.

    **(a) `packages/lang/src/spec-data.ts` — a canonical structured manifest** (enterprise decision 16.4).
    Hand-authored `MATCHERS`/`GENERATORS`/`CLI_FLAGS` arrays (there's no `GeneratorName` union or
    CLI-flag type to introspect — generators parse via dedicated functions, `cli.ts`'s arg parsing
    is hand-rolled). New `packages/lang/scripts/gen-spec-tables.mjs` (`renderMatcherTable`/
    `renderGeneratorTable`, pure and tested, mirroring `gen-docs.mjs`'s own split) regenerates
    SPEC.md's §6.2 matcher table in place (byte-identical to the hand-written version it replaced —
    verified via diff) and a new §7.3.1 generators quick-reference table, both between
    `<!-- GENERATED:name:start/end -->` markers. Wired as `@tflw/lang`'s `docs:gen`
    (`pretest`/`predev` hook), and `packages/cli`'s own `docs:gen` now runs it first
    (`npm run docs:gen --prefix ../lang && node scripts/gen-docs.mjs`) so `tflw docs
    matchers`/`generators`'s SPEC.md-prose-parse always sees fresh table content. The `CLI_FLAGS`
    array (13 entries — the 8 that were in README's old table plus 5 real flags that table had
    silently drifted out of sync on: `--only`, `--verbose`, `--forbid-insecure`, `--evidence`,
    `--format json`) doesn't regenerate anything in SPEC.md — it feeds only `docs-site`'s
    `Reference/cli.md`, replacing README's table (enterprise decision 16.10). All three arrays, plus
    `spec-data.ts` itself, are consumed directly (plain TS, no build step) by `docs-site`'s
    Reference pages now and a later LSP's hover/signature-help then (`PLAN_ENTERPRISE.md` enterprise decision
    17.7).

    **(b) `packages/docs-site` — a new workspace member (VitePress)** (enterprise decisions 16.1, 16.3, 16.6,
    16.7, 16.9, 16.12). Nav/sidebar IA: Home · Getting Started · Guide (9 hand-adapted sub-topics,
    enterprise decision 16.2) · Reference (Matchers/Generators/CLI, generated) · Grammar (`@include`s
    `packages/lang/GRAMMAR.md` verbatim) · Changelog (`@include`s root `CHANGELOG.md`) · Playground.
    `appearance` left at VitePress's default (`true`) rather than overridden — the toggle already
    respects the reader's OS/browser preference, satisfying enterprise decision 16.12 with zero extra config.
    Single unversioned site tracking `main`, local search (VitePress built-in), no version switcher
    until first npm publish.

    **(c) Playground — parse+check only** (enterprise decision 16.5). A Vue component importing `@tflw/lang`
    directly (zero runtime deps, confirmed browser-safe — no `node:` imports anywhere in
    `packages/lang/src`), running `parseSource` + `checkUnknownVariables` live against a textarea.
    `checkServices`/`checkSessions`/`checkDataTables` are deliberately skipped — they validate
    against a real `tflw.config`'s declared services/sessions, which a standalone playground
    snippet doesn't have. No execution, no network calls, no backend.

    **(d) `GRAMMAR.md` freshening** (enterprise decision 16.11). Full rewrite, not a patch — the file was a
    frozen M0-only snapshot (confirmed via `git log`: never touched by P#99/P#101/P#102 despite
    their own writeups saying they would). Rewritten to mirror SPEC.md §3–§13's structure in the
    same EBNF-ish notation, covering the config dialect, sessions (`oauth2` sugar, mTLS, cookie
    jar), hooks, `with each`, `retry N` + `retry honoring`, all matcher forms including `matches
    schema`, generators, `allow hosts`/`evidence`/`redact`, and actions/imports/the JS escape
    hatch — everything shipped through this decision. Required going forward per enterprise decision 16.11.
    Cross-links to SPEC.md/`spec-data.ts` use absolute GitHub URLs rather than repo-relative ones,
    since the file is read both directly on GitHub and `@include`-embedded into `docs-site`'s
    `grammar.md` (a relative link correct in one context 404s in the other).

    **(e) README.md trimmed to a landing page** (enterprise decision 16.10). Kept: Why, Project layout,
    Install & quickstart, a short CI pointer, Status & roadmap, Platform support, Contributing.
    Removed: the full walkthrough sections (actions/imports/hooks/polling/data-driven/generators/
    retry code blocks), Corporate networks prose, and the CLI reference table — all now live on
    the docs site, replaced here with pointer links.

    **(f) `.github/workflows/docs.yml`** (enterprise decision 16.8) — a second workflow alongside the existing
    `ci.yml`, push-to-`main` triggered: builds `@tflw/lang` then `packages/docs-site`, deploys via
    `actions/configure-pages` + `actions/upload-pages-artifact` + `actions/deploy-pages` (standard
    two-job build/deploy recipe, `github-pages` environment). Not verifiable end-to-end without
    pushing; YAML confirmed well-formed. **Manual one-time step outside this milestone's scope:**
    the repo's GitHub Pages source must be switched to "GitHub Actions" in repo Settings before
    this workflow's first run can actually publish anything.

    3 new tests (`gen-spec-tables.test.ts`), all suites green: **196/196 lang** (+3), **185/185
    runtime** (unchanged), **12/12 reporter** (unchanged), **56/56 cli** (unchanged), **12/12
    vscode** (unchanged), **`docs-site` builds clean** (VitePress's own dead-link check passing) —
    461 total across the 5 tested packages, 0 regressions from a 458 baseline. `PLAN_ENTERPRISE.md`
    cluster 4 is done — no testFlow-tests consumption milestone follows (cadence exception, enterprise decision
    16.9); cluster 5 (LSP) is next, per this workspace's standing git-push/commit confirmation rule
    commits are created but not pushed without asking first.

### P#104

<sub>cited from CHANGELOG.md · lifted from `PLAN.md`</sub>

104. **M13 — LSP** — cluster 5 of the enterprise-readiness arc (`PLAN_ENTERPRISE.md` decision 17, a
    `/grill-me` session 2026-07-19), immediately following cluster 4 (P#103). Like cluster 4,
    **no testFlow-tests consumption milestone** (cadence exception, enterprise decision 17's own note). Built
    and tracked phase-by-phase in a dedicated `PLAN_M13_LSP.md` rather than inline here, per that
    file's own stated reason (too large a build to track any other way) — this entry is the summary
    written once all 5 phases landed, mirroring the M9–M12 precedent. Five lettered sub-parts:

    **(a) `packages/lang` — symbol table + prefix-based completion** (enterprise decision 17.6, 17.8).
    `collectSymbols`/`collectConfigSymbols` (`packages/lang/src/symbols.ts:126,219`) build a
    def/ref `SymbolTable` for both dialects; a real parser completion mode
    (`getCompletionContext`, `packages/lang/src/completion.ts:27`) parses up to the cursor and
    captures the legal-next-token set on end-of-input-mid-production, rejecting the lower-risk
    line-context/regex heuristic `lib.ts`'s `parseTestDeclarationLine` already uses elsewhere in
    favor of true grammar-awareness, per enterprise decision 17.6. Known v1 limitation, not fixed: a cursor on
    an otherwise-blank line (zero characters typed yet) resolves to `null`, since the lexer emits no
    token for a whitespace-only line — the dominant real-world case (typing, not an empty new line)
    still resolves normally.

    **(b) `packages/lsp-server` — pure resolution functions** (enterprise decision 17.8): a new workspace
    member. `findNodeAtOffset` (offset → AST node walk) backs five pure functions —
    `findDefinition` (`resolution/definition.ts:25`), `getHover` (`resolution/hover.ts:73`),
    `getCompletions` (`resolution/completion.ts:80`), `findRenameTargets`
    (`resolution/rename.ts:32`), `getSignatureHelp` (`resolution/signatureHelp.ts:24`) — over
    `Program`/`SymbolTable`/`spec-data.ts` (enterprise decision 16.4's manifest, consumed here per enterprise decision
    17.7 for hover text and signature-help parameter shapes). Zero `vscode-languageserver` import
    anywhere in this directory, the pure/impure split enterprise decision 17.8 called for.

    **(c) `packages/lsp-server` — I/O layer + protocol wiring** (enterprise decision 17.2–17.4, 17.9): project
    root discovery, `tflw.config`/env resolution (`loadProjectConfig`,
    `workspace/configResolution.ts:42` — `PLAN_M13_LSP.md` decision B slots `tflw.env` into
    `selectEnv`'s existing `--env`/`TFLW_ENV` precedence chain, no changes to `resolve.ts` itself),
    a debounced (~150–300ms) full-reparse `DocumentStore` (`workspace/documentStore.ts:62`)
    branching on `tflw.config` vs. `*.tflw` per `PLAN_M13_LSP.md` decision A (config buffers get
    real diagnostics too — no exclusion filter anywhere in this stack), an mtime-cached
    `CrossFileResolver`
    (`workspace/crossFile.ts:31`) mirroring `buildRegistry`'s import resolution for a long-lived
    server, and a lazy project-wide index backing cross-file rename. `startServer()`
    (`server.ts:76`) wires every handler over `createConnection`, real stdio by default or an
    in-memory stream pair for tests (enterprise decision 17.8's protocol-test idiom).

    **(d) `packages/cli`'s `lsp` subcommand ships** (enterprise decision 17.4): `case 'lsp'`
    (`packages/cli/src/cli.ts:78`) dispatches to `lspCommand` (`cli.ts:585`), which calls
    `startServer()` and returns a promise that deliberately never resolves —
    `vscode-languageserver`'s own `createConnection()` already registers `end`/`close` listeners on
    the input stream and calls `process.exit()` itself (0 after a proper LSP `shutdown`+`exit`
    handshake, 1 on an abrupt disconnect), discovered by trial rather than reimplemented. This is
    the mechanism that actually delivers editor-agnosticism enterprise decision 17.4 names (Neovim/Helix/
    coc.nvim, not just VS Code) — the VS Code extension's own launch reuses this exact entry point.

    **(e) `packages/vscode` rewrite** (enterprise decision 17.3): the old save-triggered `tflw check --format
    json` spawn-and-parse diagnostics path deleted entirely. `activate()`
    (`packages/vscode/src/extension.ts:25`) constructs a real `LanguageClient`
    (`extension.ts:42`), `ServerOptions` spawning `tflw lsp`, `documentSelector: [{ language:
    'tflw' }]` covering both dialects (one selector, no per-dialect branching needed client-side).
    `resolveWorkspaceRoot()` (`extension.ts:57`, not in the original plan sketch — a practical
    necessity once actually wired up) picks the client's single project root from whichever
    `tflw`-language document is already open at `activate()` time, falling back to each open
    workspace folder. `tflw.env` (`PLAN_M13_LSP.md` decision B) reaches the server via
    `initializationOptions.env` + `synchronize.configurationSection` pushing
    `workspace/didChangeConfiguration` on change. CodeLens/`runInTerminal`/`resolveTargetUri` stay
    client-side, untouched, per enterprise decision 17.3.

    546 tests total across the 6 tested packages (218 lang +22, 185 runtime unchanged, 12 reporter
    unchanged, 62 lsp-server new, 59 cli +3, 10 vscode net −2 — two dead `spanToZeroBasedRange`
    cases removed, no new tests possible for `vscode`-host-only code), 0 regressions from the 461
    M12 baseline, verified via a genuine from-scratch build (every package's `dist/` deleted
    first). Two real bugs caught mid-build: a root `package.json` workspaces-array ordering bug
    (`npm run build --workspaces` has no topological sort — `lsp-server` had to move before its
    first dependent, `cli`) that only a from-scratch build ever exercised, and a wrong-exit-code
    design in `lspCommand` corrected once `vscode-languageserver`'s own exit semantics were found.
    Full detail, including every phase's own status note and deviations from the original sketch,
    lives in `PLAN_M13_LSP.md`. **Not yet done:** the manual Extension Development Host walkthrough
    (`PLAN_M13_LSP.md`'s Verification section) — a human-in-the-editor proof this automated pass
    can't cover, left as a follow-up. `PLAN_ENTERPRISE.md` cluster 5 is done — cluster 6 (CI
    ergonomics) resumes the normal ping-pong cadence, per this workspace's standing git-push/commit
    confirmation rule commits are created but not pushed without asking first.

### P#105

<sub>cited from CHANGELOG.md · lifted from `PLAN.md`</sub>

105. **M13 post-ship: manual walkthrough fixes** — P#104 flagged the Extension Development
    Host walkthrough as not-yet-done; this is what surfaced doing it. Three sub-parts, found and
    fixed same-session, 2026-07-20:

    **(a) Interpolation-hole span bug (rename/hover/go-to-def).** `symbols.ts`'s
    `walkStringParts`/`walkRefPath` used a string literal's *entire* span (quotes included, or any
    surrounding literal text like `"Bearer {token}"`) as a `{name}` interpolation hole's ref span,
    because `StringPart.interp` (`ast.ts`) carries no span of its own — `parseStringParts`
    (`parser.ts:2088`) works purely on the already-decoded string value with zero position
    tracking. Renaming `csrf` inside `header "X-CSRF-Token" is "{csrf}"` therefore replaced the
    whole quoted literal, stripping the quotes/braces. Fixed via escape-aware raw-offset mapping
    (`buildRawOffsetMap`/`resolveInterpRefs`, `symbols.ts`) that locates each hole's real `{`/`}`
    bounds in the raw source, then reuses the existing `findIdentifierSpans` windowed re-lex to
    land on just the identifier — the same technique already established elsewhere in this file.
    Fixes rename, hover, and go-to-def uniformly (all three shared the same over-broad span), for
    both quoted-string and unquoted-path interpolation.

    **(b) Diagnostic hint formatting.** `lsp-server/src/server.ts`'s `toLspDiagnostic` appended a
    diagnostic's `hint` as a trailing `(hint)` parenthetical onto `message` — combined with VS
    Code's own hover suffix (`message source(code)`), a `TF011` "unknown step" diagnostic rendered
    as two parentheticals glued together on one line. Changed to a `\n`-separated second line,
    matching the CLI reporter's own `= help:` line convention for the same `hint` field
    (`diagnostic.ts`'s doc comment) rather than inventing a second, LSP-only rendering.

    **(c) Semantic tokens** (this entry's namesake): `packages/lang/src/semanticTokens.ts`
    (`collectSemanticTokens(source, symbols)`) + `lsp-server`'s new
    `connection.languages.semanticTokens.on(...)` handler (`server.ts` — this one LSP feature is
    namespaced differently from every other handler in the file). Closes a coloring gap the static
    `syntaxes/tflw.tmLanguage.json` grammar structurally can't: matcher/operator words and numbers
    *are* correctly grammar-tagged but VS Code's own default theme defines no color rule for
    `keyword.operator`/`constant.numeric` (confirmed by dumping its `tokenColors`), so they render
    unstyled; object-literal field keys and variable/parameter names can never be grammar-colored
    at all since they're arbitrary user text, not fixed vocabulary. Two passes merged and sorted by
    offset: an AST-derived pass reusing the already-computed `SymbolTable` as-is (zero new AST
    walking — variable/parameter/action spans, including inside string/path interpolation holes,
    come free from (a)'s fix), and a lexer-driven pass over a single flat `lex()` of the document,
    classifying `ident`/`number` tokens by wordlist membership (four hand-maintained arrays
    mirroring `tflw.tmLanguage.json`'s own keyword lists — same already-accepted independent-copy
    tradeoff as that file vs. `parser.ts`, which doesn't centralize most keywords into exported
    arrays) plus an exact colon-lookahead for object-literal keys (`colon` has no other role in
    this grammar, confirmed against `parser.ts`'s own object-field parsing — not a heuristic guess).
    A ref's true kind (`variable` vs. `parameter`) is resolved via its `defSpan` against the def
    list rather than trusted directly, since `symbols.ts` tags every *ref* `kind: 'variable'`
    regardless of what it points at (only defs distinguish the two). No `packages/vscode` changes
    needed — `vscode-languageclient` auto-registers the provider from the server's advertised
    `legend`, the same zero-client-code pattern already relied on for every other LSP feature.

    555 tests total (226 lang +8, 185/12 unchanged, 63 lsp-server +1, 59/10 unchanged), 0
    regressions from the 546 M13 baseline, verified via a from-scratch build. Manually verified
    against the real spawned `tflw lsp` binary (not just the automated suite) for all three:
    rename tested live in the Extension Development Host and confirmed correct; the diagnostic
    message format and a full semantic-tokens response both confirmed via hand-rolled raw LSP
    requests piped to the refreshed binary, then semantic tokens additionally confirmed live via
    VS Code's own "Inspect Editor Tokens and Scopes" panel. `testFlow-tests`' vendored `tflw`
    tarball re-packed via `refresh-tflw` after each fix.

    **(c) addendum — theme-fallback gap, found live.** The first Dev Host reload after (c) still
    showed no color for `operator`/`number`/`variable`/`parameter`/`property`. The token inspector
    proved the data itself was correct (`semantic token type: operator`) — VS Code's own built-in
    default tries a scope-based fallback (`keyword.operator` for our `operator` type) when a theme
    has no direct `semanticTokenColors` rule for a type, but the active default theme (Dark Modern/
    Dark+, no theme extension installed) has no rule for that fallback scope either, so it resolves
    to the plain editor foreground — indistinguishable from unstyled. Not a provider bug; a gap in
    this one (very sparse) theme's own coverage. Closed two ways in `packages/vscode/package.json`:
    `contributes.semanticTokenScopes` (idiomatic — gives every theme, including ones with real
    `keyword.operator`/`constant.numeric` rules, a scope-based fallback path) plus
    `contributes.configurationDefaults` → `editor.semanticTokenColorCustomizations` shipping
    explicit colors for the 6 types actually observed falling back to plain foreground (not
    `keyword`/`type`, which already render correctly via the pre-existing static grammar either
    way) — guarantees a correct look in this exact sparse-theme environment too, not just richer
    themes. First attempt scoped these via a `"[tflw]"` settings-override wrapper around the whole
    `editor.semanticTokenColorCustomizations` value — silently inert (a live re-check afterward
    still showed `number`/`property` unstyled while `operator`/`variable` happened to already work,
    the latter purely via the theme's own pre-existing `variable`-scope rule, not this setting).
    The setting is scoped per-rule instead, via the documented `"type:language"` selector suffix on
    each rule key (`"number:tflw"`, `"property:tflw"`, …) directly under the top-level (unwrapped)
    `editor.semanticTokenColorCustomizations.rules` — confirmed working live via the token
    inspector (`semantic token type: number`, `foreground: User settings: number:tflw - #b5cea8`).

    **Reverted the `configurationDefaults` half on request.** It's a global default-value
    override — it wins over *any* theme's own `keyword.operator`/`constant.numeric`/etc. rules, not
    just VS Code's sparse bundled default theme, which is wrong for a publicly distributed
    extension (forces tflw's own palette onto users who picked a theme specifically for its
    colors). Removed; `contributes.semanticTokenScopes` alone remains — the theme-respecting
    fallback mechanism, giving every richer theme (anything with real `keyword.operator`/
    `constant.numeric`/`variable.other.property` coverage) a correct scope-based match
    automatically, at the cost of VS Code's own sparse bundled default theme keeping this one gap
    (a known, accepted limitation of that specific theme, not of the extension). 10/10 vscode tests
    still pass throughout; no automated test possible for theme-resolution behavior itself (needs a
    running editor) — verified live against both the sparse default theme (gap confirmed, as
    accepted) and a richer-theme spot check: installed One Dark Pro (`code --install-extension
    zhuangtongfa.material-theme`), confirmed live that operators/numbers/property keys/variables all
    render distinctly colored purely via the theme's own coverage, with zero tflw-specific overrides
    in play — the generic design works as intended.

### P#108

<sub>cited from CHANGELOG.md · lifted from `PLAN.md`</sub>

108. **M14 — Connection-failure assertions: `request connects`/`fails`** — cluster 5.5 of the
    enterprise-readiness arc (`PLAN_ENTERPRISE.md` decisions 18–19, a third `/grill-me` session
    2026-07-20, prompted by planning `testFlow-tests` CI). Closes the gap enterprise decision 18 identified:
    a request that fails *before* any HTTP response exists (a TLS handshake rejection, DNS
    failure, `ECONNREFUSED`, an `allow hosts` block) always crashed the whole test fail-fast, with
    no way to write a genuinely passing regression test proving a guardrail actually triggers.
    Full fidelity across every package — grammar, checker, runtime, language server, docs and
    tests — the same bar as clusters 1–3.

    **`packages/lang`**: new `RequestSubject` AST node + `connects`/`fails` `MatcherName`s
    (`ast.ts`); parser accepts `request` as a subject (`parseSubject`) and `connects`/`fails` as
    top-level matcher keywords, `fails` with an optional `matching "<regex>"` clause reusing the
    existing string-operand machinery (`parseMatcher`) — deliberately *not* nested under `is`
    like the UI state words, per the user's own correction mid-interview: keep `expect`/`not`/
    `equals`/`not equals` as the general mechanism, but `connects`/`fails` read as natural-
    language opposites for the connection-specific case, the DSL's founding design philosophy.
    `not` composes for free (`expect request not connects` ≡ a bare `expect request fails`,
    P#15's existing negation rule already covers it — no special-cased logic). New checker rule
    `checkRequestAssertions` (`checker.ts`, new code `TF031`): rejects a `request` assertion
    combined with a response-based one (`status`/`header`/`body`/`duration`) in the contiguous
    run of `expect`/`check` steps following one `api` call, and rejects a `request` assertion
    inside `wait until api` outright (structurally meaningless there — polling never opts into
    catching a connection failure). `spec-data.ts` gains `connects`/`fails` matcher rows, feeding
    SPEC.md §6.2's generated table, the docs-site Reference page, and `tflw docs` (a new
    `connection-failure-assertions` topic, auto-generated from the new SPEC.md §6.2.2 prose — 49
    topics now, up from 48).

    **`packages/runtime`**: `execSteps` precomputes which `ApiStep` indices are immediately
    followed by a `request`-subject assertion (`findRequestAssertionApiIndices`) — only those
    opt into catching a connection-level error in a local try/catch instead of letting it
    propagate to the function's own outer catch-all (P#16's unconditional fail-fast, unchanged
    for every other request). A new `lastConnectionError` alongside the existing `lastResponse`
    carries the caught (redacted) error message to `evaluateExpect`, which bypasses
    `resolveSubject`/`evalMatcher` entirely for a `RequestSubject` — the same pattern
    `matchesSchema` already uses for its own different reason — dispatching to a new
    `evalRequestMatcher` (`matcher.ts`) instead. The `api` step's own report line still reports
    `ok: true` when it caught a connection failure (like any other request, whatever it got
    back) — only the following `expect`/`check request connects`/`fails` step judges the
    outcome. `resolveSubject` and `rawMatch`'s default branch both gained a `RequestSubject`/
    `connects`|`fails` case with a clear runtime error for the two structurally-impossible
    misuses the checker doesn't (yet) statically forbid: `capture request as x` (no value to
    capture) and `expect status connects` (wrong subject for this matcher).

    **`packages/lsp-server`**: `request` added to `completion.ts`'s subject candidates,
    `connects`/`fails` added to its matcher candidates and `hover.ts`'s `MATCHER_SPEC_ID` map —
    both sourced from the same `spec-data.ts` rows as every other matcher, no new plumbing.

    **Docs**: SPEC.md gained §6.2.2 (full semantics: opt-in scope, `matching`, negation,
    not-capturable, the two checker rejections, and an explicit note that report-artifact
    verification — e.g. proving `report.html` masks a redacted field — is a separate, unrelated
    concern this feature doesn't and shouldn't cover); §5.3's subject list updated. GRAMMAR.md's
    `Subject`/`MatcherCore` productions updated, plus a note that the mix/`wait until api`
    restriction is checker-enforced, not a grammar restriction. `packages/docs-site/guide/
    assertions.md` gained a matching narrative section (mirroring the existing contract-
    validation one). `packages/vscode/syntaxes/tflw.tmLanguage.json` and `packages/lang/src/
    semanticTokens.ts` both gained `request`/`connects`/`fails`/`matching` to their keyword
    wordlists, so the new grammar highlights correctly both statically (VS Code's TextMate
    grammar) and semantically (the LSP's `textDocument/semanticTokens/full`, P#105's
    addendum). CHANGELOG.md gained an `### Added` bullet under the still-frozen `[0.1.0]`
    heading (enterprise decision 12 — version doesn't bump mid-arc).

    **Testing**: 32 new tests, 0 regressions — 587/587 across all 6 tested packages (238 lang
    +20, 202 runtime +17, 12 reporter unchanged, 66 lsp-server +4, 59 cli unchanged, 10 vscode
    unchanged), up from the 555 M13 baseline. `packages/lang`: a new golden AST fixture +
    error-snapshot fixture (`request-connects-fails`, `fails-matching-missing-string`) plus 9
    `checkRequestAssertions` unit tests. `packages/runtime`: `mtls.test.ts` gained 6 tests reusing
    its own real-TLS-rejection server fixture — most notably one proving the *exact* scenario the
    file's pre-existing "without cert/key... rejects the connection" test shows crashing the run
    today now passes green with `expect request fails`, the headline proof this feature exists
    for. A new `request-connects-fails.test.ts` (12 tests) covers ECONNREFUSED, an `allow hosts`
    block, `matching`/negation/soft-form combinations, the unconditional-crash-when-not-opted-in
    regression proof, `capture request` rejection, an invalid-regex error, and two independent
    `api` calls in one test each tracking their own connection error. `matchers.test.ts` gained
    one test for the wrong-subject error message. `packages/lsp-server`: hover + 2 completion
    tests. No `packages/cli`-level e2e test was added specifically for this feature — the
    runtime-level tests already exercise the real `runProgram` path the CLI itself calls
    unchanged, and the full CLI suite (dist/cli.cjs-driven e2e included) stayed green throughout,
    the same bar M9–M11 held before LSP/docs-site added their own dedicated test layers.

    Not yet done: `testFlow-tests`' consumption (`PLAN_ENTERPRISE.md` decision 19 — the
    `mtlsSidecarNoCert` env, `tests/mtls-rejection.tflw`, `scripts/verify-redaction.mjs`, the two
    new `regression.mjs` phases, and `.github/workflows/ci.yml` itself) — hard-blocked on this
    decision until now, unblocked as of this entry; see `testFlow-tests/PLAN_CI.md` for that
    milestone's own breakdown.

### P#111

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN.md`</sub>

111. **M17 — CI ergonomics + console/log output** — enterprise arc cluster 6
    (`PLAN_ENTERPRISE.md` decision 21, a fifth `/grill-me` session 2026-07-20). Enterprise decision 7's
    original scope (`--format json`/`results.json`, `--failed`, `--bail`) plus a second topic
    folded in at the user's request: console/log output (NDJSON event stream, timestamps, GitHub
    Actions log grouping, `--log-file`). Not cadence-exempted (unlike clusters 4/5/9) — this is a
    real CLI/runtime behavior change, so it gets a normal `testFlow-tests` consumption milestone,
    merged into enterprise decision 19/`PLAN_CI.md` rather than a separate one (see that decision's amended
    note, 2026-07-20).

    **`report/results.json`** — always written, no flag, same footing as `report.html`/
    `junit.xml`. `packages/reporter/src/index.ts` gained `writeResultsJson`: `JSON.stringify` of
    the exact redacted `RunReport` `report.html` already renders from — no second serialization
    to keep in sync, secrets-redaction guarantee inherited for free. Deliberately not the same
    feature as `tflw check --format json` (stdout-replacing) — a file, matching how `junit.xml`
    already solves "read a run's outcome without scraping stdout."

    **`tflw run --failed`** — new `packages/reporter/src/last-run.ts`: `renderLastRun` (pure,
    filters `report.tests` to `!t.ok` — a `flaky`-flagged test that ultimately passed is never in
    the list, since `TestResult.ok` is already the final post-retry verdict) plus `writeLastRun`/
    `readLastRun` I/O against `report/.last-run.json` (already gitignored via `report/`, no new
    entry needed). `writeLastRun` runs unconditionally after every run, including one already
    filtered by `--failed` itself, so repeated `--failed` invocations narrow further as tests get
    fixed — confirmed with a dedicated test that fixes a failing test between two `--failed` runs
    and asserts the state file ends up `{ failed: [] }`. No state file, or a prior run with zero
    failures: `cli.ts` prints "no failed tests from the last run — running the full suite" and
    proceeds as a normal full run, matching pytest's `--lf` default (enterprise decision 21.2) rather than
    erroring or silently running nothing. Composes with `--tag`/`--only` as one combined AND
    filter chain in `runCommand`'s `runnable` computation (a test must pass every active filter);
    a `--failed` filter that matches zero current tests (files changed since the last run) is a
    hard usage error, same treatment as an unmatched `--tag`/`--only`.

    **`--bail`** — `runWithConcurrency` (the existing pull-based worker pool) gained an optional
    `shouldBail` predicate, checked after every result; once true, the pool stops calling
    `runNext()`'s claim step but never touches an in-flight worker — no hard-abort/cancellation-
    token plumbing into `runProgram`/the interpreter, exactly the scoped-down semantics enterprise decision
    21.3 called for. `args.bail ? (r: RunReport) => !r.ok : undefined` as the predicate — since
    `TestResult.ok`/file-level `RunReport.ok` are already post-retry final verdicts, a mid-retry
    failing attempt never trips it. Files never claimed are simply absent from the returned
    reports array (changed `runWithConcurrency`'s internal array from `R[]` to `(R | undefined)[]`
    then filtered nulls out at the end) — `mergeReports`/`results.json`/`report.html` all already
    tolerate a partial run correctly (same code path a mid-run crash already exercised).

    **`--format ndjson`** — a genuinely separate feature from `results.json` (item 1), confirmed
    explicitly with the user mid-interview after an initial ambiguity: a *live*, line-per-event
    stream (`JSON.stringify` of the same `RunEvent`s `--verbose`'s human renderer already
    consumes), not an end-of-run summary. New `ndjsonEmit` sink in `cli.ts`; when active, replaces
    the human ticker entirely (no buffering distinction needed for `--workers > 1` — unlike human
    text, JSON lines are self-contained and safe to interleave). Amended mid-interview: also
    always written to `report/events.ndjson` (new `packages/reporter/src/events-ndjson.ts`) — not
    stdout-only — so the stream survives even when the invoking process didn't capture it.
    `RunEvent` (`packages/runtime/src/types.ts`) gained an optional `file` field on every variant
    to disambiguate concurrent files' events — set by a new `withFileTag` wrapper in `cli.ts`
    around whichever sink actually runs, **not** threaded through `runProgram`/the interpreter
    itself, deliberately mirroring the exact "file is a display concern, stamped by the CLI"
    precedent `TestResult.file` already established (P#92) — `packages/runtime` stays
    unaware `file` exists as a concept.

    **Verbosity ladder: no change, considered and dropped.** A `--quiet` flag (suppress today's
    one-line-per-test default down to failures + a tally, for CI log volume on large green suites)
    and a `--log-level` replacement for the boolean `--verbose` were both raised and dropped
    mid-interview after the user pushed back on `--quiet`'s value — no concrete near-term
    large-suite CI-noise pain point exists, and replacing `--verbose` would break scripts using a
    flag stable since M2.15 for no compensating benefit. Recorded in `PLAN_ENTERPRISE.md` decision
    enterprise decision 21.6 as "considered and rejected," the same pattern enterprise decision 20 used for its own dropped ideas
    — a real design decision, not a silent omission.

    **Timestamps, on by default.** New `timestamp()`/`withTimestamps()` helpers in `cli.ts` —
    `HH:MM:SS.mmm` wall-clock, one instant captured per printed block (not recomputed per physical
    line within a multi-line block), blank spacer lines left bare (no timestamp on nothing — a
    refinement made while implementing, not part of the original interview). `--no-timestamps`
    opts out, symmetric to `--no-color`. This changes the CLI's default output shape: one existing
    e2e test (`--verbose prints one indented line per step under a test-name header`) asserted an
    exact bare-string line match and needed `--no-timestamps` added to keep testing verbose's
    *structure*, not coupling to this unrelated feature — exactly the golden-fixture update
    enterprise decision 21.7 anticipated, not worked around.

    **GitHub Actions log grouping.** Auto-detected via `GITHUB_ACTIONS` env var, no new flag.
    `formatEvent` gained a `githubActions` parameter — `::group::<name>` replaces the plain
    `test:start` header line and `::endgroup::` is appended to the `test:end` block, only when
    `verbose` is also true (normal mode is already one line per test). Not a GitHub annotation —
    pure log folding, enterprise decision 7's "no GitHub annotations" scope boundary unaffected (same
    distinction enterprise decision 21.8 drew).

    **`--log-file <path>`.** New `makeConsole()` in `cli.ts` — every piece of `run`'s console
    output (human or NDJSON) now flows through one `out.write()` call instead of scattered direct
    `process.stdout.write()`s, so `--log-file` can mirror it; buffers the whole run's output in
    memory rather than opening a real file stream (a run's console output is never large enough to
    justify one), written once via `out.save()` at the end. Always plain text — a new `stripAnsi()`
    regex strips ANSI codes on the way into the buffer, independent of whatever `--no-color`/
    `isTTY` decided for stdout itself.

    **testFlow-tests consumption**: merges into enterprise decision 19/`PLAN_CI.md` (enterprise decision 21.12) — not
    built as part of this milestone. `PLAN_CI.md`'s CI workflow will be built using `results.json`
    artifact upload, `--bail`, and GH Actions log grouping from the start once that milestone is
    picked up.

    **Testing**: 21 new tests, 0 regressions — `packages/reporter` (+7: `renderLastRun`/
    `writeLastRun`/`readLastRun` round-trip + overwrite-narrows semantics, `writeEventsNdjson`
    ordering + empty-list edge case) and `packages/cli` e2e (+13: `results.json` content +
    redaction, `--failed` replay/empty-fallback/narrowing, `--bail` stops a later file/unchanged
    without it, `--format ndjson` line-parseability + file-tagging + `report/events.ndjson` parity
    + full detail without `--verbose` + an unsupported-value usage error, default timestamps +
    `--no-timestamps`, GH Actions grouping's three-way verbose×env-var matrix, `--log-file`
    content parity) plus 1 existing test updated (`--no-timestamps` added to keep an unrelated
    verbose-structure assertion exact). 611/611 across all 6 tested packages (240 lang unchanged,
    202 runtime unchanged, 19 reporter [+7], 68 lsp-server unchanged, 72 cli [+13, 1 modified],
    10 vscode unchanged), up from the 591 M16 baseline.
    `tsc --noEmit` clean on all 6 packages, `npm run build` clean workspace-wide. Two real testing
    gotchas hit and fixed, not initial-implementation bugs: (a) a first draft of the timestamp e2e
    test asserted `{2}` (two) leading spaces after the prefix on a verbose step line, but the
    actual line has three (the timestamp helper's own trailing space plus the step line's existing
    two-space indent) — fixed to `\s+`; (b) a first draft of the `--no-timestamps` opt-out test
    used an unanchored regex that false-matched the summary line's own `now 2026-...T20:15:49.955Z`
    ISO field (which legitimately contains an `HH:MM:SS.mmm`-shaped substring) — fixed to anchor
    on line-start (`^`). SPEC.md §12's `tflw run` row and a new §13 "CI ergonomics + console/log
    output" subsection cover the full feature set; `packages/lang/src/spec-data.ts`'s `CLI_FLAGS`
    gained the 5 new flags (feeds `reference/cli.md` and `tflw docs` for free); `docs-site/guide/
    ci-and-reporting.md` gained 3 new sections and `guide/debugging.md`'s "Isolate a test" section
    gained `--failed`/`--bail`. Verified live: `vitepress build` clean, `vitepress dev` + Playwright
    confirmed `reference/cli.md` renders all 5 new flags and both guide pages render their new
    content.

    **Amended same day: doc-completeness audit, user-requested ("does the doc-site clearly depict
    this update in all relevant places").** The above verification confirmed the *new* pages/
    sections rendered — it didn't check whether *pre-existing* "what does `tflw run` write"
    statements elsewhere had gone stale. They had: `getting-started.md`'s quickstart paragraph,
    `index.md`'s feature card + "Why tflw" bullet, root `README.md` (3 spots: "Why tflw" bullet,
    quickstart paragraph, project-layout table row), `packages/cli/README.md` (2 spots, same
    pattern), and SPEC.md (3 spots: project-layout ASCII comment, §14 architecture diagram, §13's
    top capability summary) all still said only "`report.html` and `junit.xml`," silently missing
    `results.json`. Fixed all of them to name `results.json` too. `packages/cli/README.md`'s own
    `## CLI` usage block turned out stale beyond just this milestone — missing `--only`/
    `--forbid-insecure`/`--evidence`/`--verbose`/`tflw docs`/`tflw lsp`, gaps that predate M17
    entirely — brought fully in sync with `cli.ts`'s actual flag set rather than patched to add
    only the M17 flags, since leaving it half-fixed would still be inaccurate. Three internal
    SPEC.md mentions of "`report.html`/`junit.xml`" as informal shorthand in redaction-mechanism
    prose (not artifact inventories) were deliberately left alone — adding `results.json` to every
    such phrase would be diminishing-returns pedantry, not a real gap. Verified: `vitepress build`
    clean, `vitepress dev` + Playwright confirmed `results.json` renders on both the home page and
    `getting-started.md`; full suite re-run, still 611/611.

### P#112

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN.md`</sub>

112. **Version-line revision: perf and pentest now gate `1.0.0`, not the browser-era M7 verdict
     alone.** Supersedes P#50's mapping (`0.1.0` API-only → `0.2.0` browser → `1.0.0` "final,
     after the browser-era acceptance verdict, P#41/P#38"). By the time M7 actually shipped
     (2026-07-27/28), `PLAN_BROWSER_PERF_SECURITY.md` had already committed two more arcs — perf
     and pentest — as in-scope, pre-1.0 work, so P#50's placement of `1.0.0` right after the
     browser verdict stranded it mid-roadmap instead of at the actual finish line. New mapping:
     `0.1` (API) → `0.2` (+ browser, done) → `0.3` (+ perf) → `0.4` (+ pentest) → `1.0.0` = the
     **actual first npm publish**, gated on all four arcs plus one final integrated acceptance pass
     (API + browser + perf + pentest together, against the real dogfood app) — not before.
     Reaffirms `PLAN_ENTERPRISE.md` decision 12 ("stays `0.1.0` throughout the arc — tflw isn't on
     npm yet"): `package.json`'s literal `version`/`private` fields don't move for any of these
     internal arcs, only at the real publish. The `0.2`/`0.3`/`0.4` labels are bookkeeping in
     planning docs and `CHANGELOG.md`'s `[Unreleased]` section — never a real git tag or npm
     version. M7's "1.0 gate" framing (this file's own milestone bullet below, PROGRESS.md, SPEC.md
     §15, README.md, docs-site, and already-written git commit messages) is retroactively
     understood as **the browser arc's own acceptance gate** (`0.2.0`-equivalent) — P#41/P#45's
     substance (the acceptance methodology, `tflw migrate` shipping as that arc's deliverable)
     doesn't change, only the version label attached to what M7 actually unlocked. **Rejected:**
     keeping `1.0.0` tied to the browser verdict alone and relabeling perf/pentest `1.1.0`/`1.2.0`
     (the scheme `PLAN_BROWSER_PERF_SECURITY.md` D3 originally used) — that leaves no clean home for
     "everything's actually done," which is precisely the gate the user wants before ever
     publishing.

### D1

<sub>cited from SPEC.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D1 — One language, three execution modes.** tflw grows `tflw load` and `tflw scan`
  alongside `tflw run`. Browser steps, a load `scenario` construct, and a security `scan`
  construct all share the existing request model, `session`/auth, env config, redaction, checker,
  reporter and LSP. Single npm package, single SPEC, additive-only versioning (P#13/P#45
  take real pressure — each mode must justify its vocabulary).

### D5

<sub>cited from SPEC.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Driver boundary (D5)**

- Peer stays **`playwright` core** (not `@playwright/test`), optional, dynamic-imported at first
  browser step, installed via `tflw install-browsers` (P#44 unchanged).
- **Delegate actionability, own assertions.** `locator.click()/fill()` inherit Playwright's
  battle-tested action-level waiting (visible/stable/enabled/receives-events). The **assertion
  retry loop, timeout policy, and 100% of failure text are tflw's own**, polling
  `count()/isVisible()/textContent()` on tflw's clock. Reason: P#9 (a UI failure *is* a
  diagnosis) is structurally impossible on top of Playwright's assertion errors; and API-side
  subject-split retry (P#15) must not live in a vendored dep.

### D6

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md, tflw-tests/CONSTRUCTS.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Selector model (D6) — resolves the SPEC §11 contradiction**

SPEC currently promises both a global cascade (§11:1032) and "never silent fallback" (P#9)
— incompatible. Resolution: **the noun picks the strategy; only `field` cascades; any non-tier-1
resolution is reported.**

### D7

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md, tflw-tests/CONSTRUCTS.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Ambiguity & scoping (D7)**

- **Strict: N>1 matches is an error**, never "take the first". The error renders as a diagnosis:
  all N candidates, enclosing context, paste-ready disambiguation.
- **`within <locator> { ... }`** block scopes a group of steps (block form only — a one-step scope
  is a one-line block; grammar is frozen additive-only so an inline `in` suffix stays legal to add
  later).
- **No positional selection** (`nth`/`first`/`last`) — rejected outright; `within` covers the
  legitimate cases.

### D9

<sub>cited from SPEC.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Escape hatch (D9)**

- **No browser access in JS helpers.** Helpers stay context-in/values-out (P#11). Keeps the
  peer genuinely optional, avoids a permanent Playwright-`Page` compat obligation, and forces
  grammar gaps to surface as language feedback. A narrow tflw-owned facade (evaluate-in-page /
  storage / wait-for-predicate — never raw `page`) is held in reserve **only** if dogfooding
  proves a real gap.

### D10

<sub>cited from SPEC.md, tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Sessions & identity (D10) — no bridge**

- SPEC §3.3 already allows browser steps in a `session` (produce storage state) and api steps
  (produce a cookie jar). **The two representations are never converted into each other.**
- A mixed UI+API test's session contains **two logins in its body** (an API token call *and* a UI
  form login). Establishment cost doubles but is cached once per run per worker.
- Consequence to document loudly: a test that logs in *through the UI form* and then issues an
  `api` step finds that step unauthenticated. This will surprise people once; the teaching error
  points at "use a session for shared identity."

### D11

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Browser matrix (D11)**

- **Chromium default; `--browser firefox|webkit` switches the whole run; no in-run matrix.** Engine
  is a run-level property in the report header → the one-result-per-test model (report.html,
  junit.xml, retry, flaky-marking) is **completely untouched**. CI matrixes three jobs.
- `tflw install-browsers` takes the same flag. Headless default, `--headed` local. Viewport in
  `tflw.config`. **Device/mobile emulation: out** (additive later).

### D12

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Artifacts & report (D12) — report becomes a directory**

- Today `report.html` is a single self-contained file (`packages/reporter/src/html.ts` inlines
  style+script). Browser runs break this.
- **Failure-first capture:** screenshot on failure · explicit `screenshot "<name>"` step ·
  **Playwright trace on failure and on every retry attempt** (time-travel DOM + network + console;
  the single best answer to "passed locally, failed in CI").
- **Output moves to `report/`** = `report.html` + `assets/`. Base64 inlining retained **only**
  under a configurable byte budget, so API-only runs stay single-file (where that UX is loved).
- **Rejected:** screenshot-per-step by default (the setting everyone enables and nobody reads; the
  road to CI-storage-is-our-top-complaint).

### D13

<sub>cited from SPEC.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Concurrency (D13)**

- **One browser process per run · one fresh context per test · existing in-process file-level
  concurrency unchanged.** Contexts are cheap (~tens of MB, ~ms); the browser process is the
  expensive thing and is shared. Keeps `redactor`/`seed`/`uniqueSeq` as in-process singletons —
  the invasive message-passing rework never happens.
- Accepted+measured risk: one event loop polling many contexts could bottleneck. Empirical; M7
  acceptance against a real webV2 suite is where it's decided. "In-process until measured
  otherwise," not forever.

### D14

<sub>cited from CONTRIBUTING.md, SPEC.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Extended UI capabilities — all four in scope (D14)**

Materially larger than the old M3/M4. Slotted so as not to inflate the core:

- **Network observation** (M3d) — `expect request to "/api/orders" was made` / assert its
  status/body. Reuses the existing request model + redaction; catches optimistic-UI-lies bugs.
- **Network mocking / route stubbing** (M3d) — `intercept`/`stub` grammar. **Requires a documented
  house-style position** on when stubbing is legitimate (default: real fixtures; stub only
  third-party/unavailable deps) or it silently becomes the way people avoid fixtures.
- **Accessibility** (M3e) — axe-core as an assertable subject (`expect page has no critical a11y
  violations`). **Must be built so the scan arc reuses it** (scan-and-assert machinery), not twice.
- **Visual regression** (M4b) — its own milestone (baseline store + update/approval flow +
  tolerance + diff viewer). Precondition already met by D12's `report/` directory. See D15.

### D15

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Visual-regression baselines (D15)**

- **Committed to repo** at `snapshots/<file>/<test>/<name>.png` (diffable in code review).
- **Platform-key pinned** (OS + browser + engine version in a sidecar). Comparing across a
  different platform key is a **hard teaching error**, not a tolerance knob — font hinting / subpixel
  AA between a dev's GNOME session and a CI container never reconcile, and every fuzz threshold that
  tried ended up too loose to catch anything. Docs prescribe generate+verify in the CI image
  (testFlow-tests has compose → free there).
- **`mask <locator>`** clause on the assertion (dynamic regions — timestamps, avatars, order IDs).
- **`tflw run --update-snapshots`** writes baselines with a before/after/diff triptych in the
  report.

### D16

<sub>cited from SPEC.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Execution model (D16) — dedicated `scenario` blocks (k6-style)**

- A **new top-level `scenario` construct** with a per-VU lifecycle (think time, pacing) — *not*
  riding on `run`. This is a genuinely second execution model.
- `action`s remain the reuse unit — a scenario body composes existing actions, so the functional
  suite's building blocks are reusable without rewriting (the leverage over k6, where the load
  script is a second drifting implementation).
- **Data strategy:** each VU needs its own identity — `unique`/`session` machinery (already
  parallel-safe: `seed.ts` sub-seeds, shared `uniqueSeq`, per-test jar clones) is the foundation.
- `tflw load --scenario <name>`.

### D17

<sub>cited from SPEC.md, tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Workload model (D17) — both, arrival-rate taught as default**

- `ramp to N users over 30s` (**closed** — VUs loop; back off when the system slows → coordinated
  omission → optimistic latency).
- `ramp to N rps over 30s` (**open** — arrival-rate; queues build; honest saturation; the only
  model that validates an SLA).
- `tflw init --load` scaffolds the **open** form; docs lead with it and explain why.
- **Novel diagnostic:** report warns when a closed run's VUs spent >X% of wall time waiting
  ("your load backed off; results understate latency"). No other tool emits this.

### D18

<sub>cited from SPEC.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Language semantics under load (D18)**

- **`think 2s` / `think 1s to 3s`** legal **only inside `scenario`**; the checker rejects it inside
  `test`. Named `think` (not `sleep`) so P#8's `sleep` ban survives where it was aimed
  (functional sync hacks) — under load, think time is a modeling primitive, not a hack.
- **`expect` inside a scenario aborts the *iteration*** and counts it toward the error rate; never
  aborts the run. Definition unchanged ("hard-fail the unit of execution"), scope changes (test
  under `run` → iteration under `load`). Keeps every existing `expect`-laden action portable into a
  scenario.
- **`check`** keeps its exact meaning (record, continue within the iteration). Both feed the
  error-rate metric that `threshold` reads.

### D19

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md, tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Generator architecture (D19)**

- **Multi-process load generator; API-only scenarios.** Load generation is CPU-bound (TLS / JSON
  parse / ajv / redaction scanning) → one Node process caps at one core; k6 is Go for this reason.
  Processes stripe `uniqueSeq` by index (id ≡ i mod n) — a few lines, **no message passing** (the
  Q13 objection doesn't apply here).
- **Browser steps rejected inside `scenario`** in v1.1 (a browser VU is ~50–100 MB; 500 is
  infeasible) — checker teaching error; revisit additively.
- **Generator self-diagnosis (diagnostics pillar):** track per-process event-loop lag + CPU
  saturation; when tflw *itself* is the bottleneck the report says so and **invalidates its own
  results** — "the load generator saturated at 4,200 rps; measured latency reflects tflw, not your
  system." Almost no load tool tells you this.

### D20

<sub>cited inside a range only · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Scope (D20) — full active scanner**

tflw crawls and actively probes for OWASP Top 10 including exploitation attempts. Acknowledged as
the largest and most speculative build of the three; the guardrail + oracle design below is what
keeps it honest and safe. Reuses existing assets: `allow hosts` (§3.7), bundled `ajv` + OpenAPI
`$ref` resolution (§6.2.1), `--forbid-insecure`/`--evidence`, the request model, redaction.

### D21

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md +1 more · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Safety / authorization (D21) — layered default-deny**

1. **`allow hosts` mandatory for scans** — an un-allowlisted host is a hard error (existing
   machinery/tests/docs).
2. **Named non-wildcard affirmation in config** — `authorized target "https://localhost:4001"
   reason "self-hosted test fixture"`. Not a boolean; wildcards rejected by the checker; the reason
   is printed in the CLI summary and embedded in the report → every scan artifact records what was
   claimed.
3. **Public targets require a CLI flag that cannot live in config** — so a committed config can
   never make CI scan the internet by itself. Loopback / RFC1918 targets don't need it.
   **✅ M131a** — `--allow-public-target <origin>`, origin-valued and repeatable, `TF065`/`TF066`,
   two doors (checker + probe engine), address class read from the URL with no DNS lookup ever.
4. **Destructive probe classes opt-in per class, default off** (resource exhaustion, data
   destruction, mass enumeration). Default corpus is detection-oriented — reveal a flaw without
   exercising it. **✅ M130b2** — `probe mutating`, an opt-in sub-clause of `authorized target`.
   Shipped as a Tier 2 requirement without anyone noticing it discharged this layer; recorded by
   M131a/D337.
5. **Throttled by default** — a scan never accidentally becomes a DoS. **✅ M131a, as an asserted
   bound rather than a declared pace**: probes are strictly sequential, one in flight per assertion,
   and a test holds that property. A declared pace (`probe rate`) is deferred until the first change
   that permits two probes to be in flight simultaneously — a condition, per D336, not a milestone.

### D22

<sub>cited from SPEC.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Attack surface + oracle (D22)**

- **Surface = OpenAPI seed + captured-traffic seed.** Consume apiV2's `/openapi.json` for the
  endpoint/param/type surface; *also* seed from requests the functional suite actually made (real
  auth, real valid bodies to mutate from) → attacks land on realistic requests that reach real code,
  not synthetic ones that 400 first. Sidesteps building a blind crawler for Tiers 1-3; Tier 4 adds
  the crawl.
- **Oracle = differential + invariant, not a signature DB.** A finding = a mutated request violates
  an invariant the baseline held: differential response vs. a control payload · 5xx / stack trace in
  body · an authz boundary flipping 403→200 · unredacted PII in a body. No CVE/signature corpus to
  maintain and rot (Tier 4's active corpus is the one exception and is versioned deliberately).
- **Every finding emits a runnable `.tflw` repro** — a finding is a failing test you re-run, never a
  mystery flag. Diagnostics pillar applied to security.

### D24a

<sub>cited from SPEC.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**Thresholds & output (D24a)**

- `threshold p95 duration < 800ms` / `threshold error rate < 1%` — aggregate assertions over the
  run.
- **Output:** a **metrics JSON** (percentiles, rps, error rate, timeline) + **each threshold mapped
  to one junit test-case** so existing CI gating works unchanged. HTML report gains a load view
  (timeline, percentile bands, the back-off/saturation warnings). **Full report-generation design:
  `PLAN_REPORTS_PERF_SECURITY.md` R1–R6, R11** (independent `LoadReport` type, `load-report.html`,
  inline-SVG charts, per-second-buckets + HDR histogram, live console + partial-on-SIGINT,
  thresholds+inconclusive gating).

### D25

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D25 — Version-line revision (2026-07-28, amends D3 and the version map above).** The
  browser-era M7 verdict (side-by-side vs. raw Playwright, `tflw migrate`, 266/266 real acceptance
  tests) landed and passed, but the user does not intend to publish until performance and pen-test
  are *also* in and dogfooded against the real app — so `1.0.0` can't sit right after M7 the way the
  original D3 had it. Full detail + rationale in `PLAN.md` decision 112 (the canonical record — D3/
  the version map here were edited in place to match rather than duplicating the reasoning twice).
  One new terminal milestone — an integrated full-scope acceptance pass across API + browser + perf
  + pentest together — is the actual `1.0.0` gate, not yet named/scheduled since perf/pentest
  haven't started. **Rejected:** the original `1.1.0`/`1.2.0` labels for perf/pentest (stranded
  `1.0.0` mid-roadmap instead of at the finish line, same rejection PLAN.md decision 112 records).

### D26

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md +1 more · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D26 — Perf: after-hook-under-load policy (2026-07-30, resolves §5's flagged open item).**
  A scenario's `after` hook is **skipped by default per iteration** under `tflw load` — running it
  every iteration would double request volume and pollute the very metrics the run is trying to
  measure with cleanup-request latency, undermining D19's honest-saturation goal. A scenario that
  genuinely needs teardown (releasing a held resource/seat lock) opts back in with an explicit
  `cleanup` clause. **Rejected:** always running it (same reasoning, inverted) and never running it
  with no override (some scenarios do need teardown to avoid leaving load-test junk data behind).
  **Superseded 2026-08-29 by `D781`/`D782` (`M157`), and left standing rather than amended
  (`D787`).** The text above is unedited on purpose: `D781` adopts *"always running it"* — the first
  of the two alternatives this entry names and refuses — and an entry cannot be edited into adopting
  the option it rejects without erasing the record that the option was considered in 2026-07-30 and
  why it lost, which is the log's whole purpose. The evidence is `PLAN_M157` §2.4's three arms: the
  pollution this policy exists to prevent already happened on the **`before`** side, unconditionally
  and with no keyword, at the same 96 ms p95 against a 37 ms control — so the gate protected the
  rare side (4 bare `after` blocks in the dogfood suite) and left the common one open (61 bare
  `before`). `D782` removes hook time from the reported duration entirely, which is the defect this
  entry observed; `D783` keeps the behaviour reachable as `teardown never` / `teardown on success`.

### D29

<sub>cited from SPEC.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D29 — Perf: multi-scenario concurrency is in v1 scope (2026-07-30, amends D16/D17).** A
  single `tflw load` invocation can run multiple `scenario` blocks concurrently (mixed workload
  shape, matching k6's `scenarios` map) — not deferred additively as originally assumed. Scheduled
  as its own milestone (D28) after single-scenario correctness is proven, not built into the first
  milestone directly, so the smallest-possible-unit milestone stays smallest. R6's per-scenario
  metric breakdown (`PLAN_REPORTS_PERF_SECURITY.md`) was already designed for this.

### D30

<sub>cited from SPEC.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D30 — Perf: `tflw init --load` scaffold placement (2026-07-30).** Bundled into the first
  grammar milestone rather than deferred — it only needs the `scenario`/`threshold` grammar that
  milestone already builds, and landing it early lets that same milestone's docs-site examples
  point at real scaffold output instead of hand-written prose.

### D31

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D31 — Perf: acceptance bar (2026-07-30).** Mirrors M7's actual method (not a conversion tool —
  `tflw migrate` is unrelated, it rewrites deprecated *tflw* syntax, not raw Playwright/k6 scripts):
  the same load scenario against the contended endpoint is hand-written in both tflw and k6,
  measured numbers compared within tolerance, and the two novel diagnostics (D17's back-off
  warning, D19's self-saturation invalidation) are demonstrated firing — things k6 doesn't surface.
  No k6-to-tflw conversion tooling is in scope; nothing in this plan asked for one.

### D32

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M35B_INVESTIGATION.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D32 — Perf: load-engine hardening scoped as M35, a fast-follow to M34, not a reopening of it
  (2026-07-31).** M34 shipped and passed its own diagnostics/thresholds bar, but was honest that
  D31's numeric half did not hold: tflw trailed k6 by ~3x on the contended checkout scenario, root-
  caused (not just observed) to a ~2x tflw-vs-raw-fetch per-POST-request overhead that compounds
  under real contention. Rather than reopen M34 (already committed, its own write-up already states
  the mixed verdict accurately), the fix is a new milestone, M35, scoped below — same reasoning as
  M4a deferring worker hardening pending real measurement: the measurement now exists, so the work
  is justified, but it's additive to the perf arc, not a correction of M34's own scope.

### D33a

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M35B_INVESTIGATION.md +1 more · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D33a — acceptance tolerance: within ~10% of k6 (revised 2026-07-31 — user tightened from an
  initial ~25-30% recommendation).** Not 1:1 parity — tflw's interpreted single-process Node
  generator vs. k6's compiled Go one still makes exact parity unrealistic, and D31 itself says
  "agree within tolerance," not "match exactly" — but 10% is a materially tighter bar than the
  original proposal. Closes M34's ~3x gap to something small and explainable rather than zero.
  Practical consequence: D33e's ≥5%-of-overhead cutoff for secondary hot spots is now load-bearing,
  not just opportunistic — a single fix (the redaction hypothesis alone) closing a ~3x gap to
  within 10% is optimistic, so M35b likely needs to actually address multiple hot spots the
  flamegraph surfaces, not just the dominant one, to hit this bar.
  **Amended 2026-08-01 (M40, D55's fallback):** the ~10% bar remains as-is for throughput and for
  p95 on uncontended/light-contention targets (both were met or within noise on every clean
  measurement this arc produced — M38's throughput, M39's rung D). A separate, explicit tolerance
  now applies to **p95 specifically on a real-row-lock-contended target: ~50%** — after M36 (D40,
  D42) and M40 systematically refuted every concrete client-side mechanism candidate (connection
  ceiling, VU-dispatch overhead, per-iteration bookkeeping compounding), the remaining ~46-49% p95
  gap under contention (M38: 46%, M39: 49.2%) is treated as the honest, measured baseline for this
  specific scenario shape — an inherent interpreted-Node-vs-compiled-Go scheduling difference under
  real lock contention, not a fixable bug this arc found evidence for. See §2.11/`acceptance/
  README.md`'s "M40" section for the full elimination trail.
  **Amended again 2026-08-01 (M44, D73) — the ~50% figure is superseded; it was measuring the wrong
  thing.** M43 (§2.14) found that every combined-duration p95 this arc reported since M38 (46%,
  49.2%, 48.1%, and M42's pinned-Client 32.0%) summed the scenario's uncontended `GET /products`
  lookup together with the contended `POST /orders` checkout into one number, while k6's own
  `checkout-burst.js` tags and thresholds the checkout leg alone. With M43's per-endpoint reporter
  fix shipped and `checkout-burst.tflw` retagged (`as "checkout"` / `for "checkout"`), M44 re-ran the
  scenario checkout-scoped and found the true contended-p95 gap is **~17.5%** (80.3ms vs. k6's
  68.4ms, 3 runs each side) — not 46-50%. **The contended-p95 tolerance is now ~20%**, keeping the
  same headroom-above-measured design intent as the original ~10% throughput bar, rather than the
  ~50% figure that was calibrated against an inflated metric. Throughput's ~10% tolerance is
  unaffected (9.5% measured checkout-scoped, unchanged in kind from every prior clean throughput
  reading). See §2.15/`acceptance/README.md`'s "M44" section for the full re-measurement and the old
  metric's own inflation shown side-by-side (combined p95 103.3ms avg vs. checkout-scoped 80.3ms avg,
  same three runs). D74 (§2.16, M45's pinned-connection bar) is anchored to this 17.5%/80.3ms figure
  going forward, not M42's superseded number.
  **Confirmed for good 2026-08-01 (M47, §2.18) — the arc's final closing measurement.** Re-running
  the full ladder fresh (checkout-scoped, 3 runs each side, post-M45-pinning): rung D
  (dogfood-post-uncontended) landed at **-2.6%** (tflw *ahead* of k6 on p95 this round — a sign-flip
  from M46's own +2.90%, both readings noise around a closed gap); rung E (checkout-burst) landed at
  **+6.85%** (tflw behind, same accepted-ceiling story as M46's 5.86%, still comfortably inside the
  ~20% bar). Throughput leads k6 on both rungs. **No further re-scoping — the ~20% contended-p95 /
  ~10% throughput tolerance stands as this arc's final acceptance bar**, met with large headroom on
  real, final numbers. See `acceptance/README.md`'s "M47" section for the full three-way (tflw/k6/
  Artillery) ladder and the pentest-arc (D33d/D52/D56/D64) unblock decision made alongside it.

### D33c

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M35B_INVESTIGATION.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D33c — investigation time-box: one more hypothesis pass, then ship + document.** If M35a's
  flamegraph refutes or only partially explains the gap via the redaction hypothesis, chase the
  next-highest hot function it actually shows, fix that, then close the milestone — ship whatever
  improvement was found and document the residual gap honestly (same standard M34 already set),
  rather than an open-ended chase for a fully-explained 0% gap.

### D33d

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D33d — arc ordering: M35 finishes before the pentest arc starts.** Keeps the established
  one-arc-at-a-time discipline (D3/`PLAN.md` decision 112) instead of splitting attention across
  two open arcs. M35 is small and already bounded (three sub-milestones), so this is a short delay
  before pentest begins, and it leaves the perf arc in a clean, fully-passing state first.

### D33e

<sub>cited from tflw-tests/tflw-acceptance/perf/profile/FINDINGS.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M35B_INVESTIGATION.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D33e — secondary hot spots: fix anything ≥ ~5% of measured overhead.** If M35a's flamegraph
  shows other non-trivial costs beyond the primary redaction hypothesis (candidates already flagged
  below: `setHeader`/`buildHeaderMap` per-header allocation, `mkStep`'s spread-object allocation,
  `cookieJar.clone()` per iteration), M35b fixes anything crossing that cutoff, not just the single
  dominant cause and not everything down to noise — the same data-driven boundary D33c's time-box
  already established for the investigation itself.

### D34

<sub>cited from tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M35B_ROOT_CAUSE.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D34 — resolved: invest one more bounded pass (M35b), via direct instrumentation rather than
  another synthetic rebuild.** M35a-2's deeper pass exhausted the checkable-hypothesis list (D32's
  original redaction candidate, every D33e secondary hot spot, and three new ones that pass added —
  chain depth, `sendRequest` shape, full trace/`StepResult` allocation) without confirming a fixable
  mechanism, and found the gap reproduces at 1 VU with zero concurrency (a ~15x per-iteration
  latency gap, 78.9% vs 13.8% idle) — ruling out D33c's original "concurrency/scheduling-density"
  framing too. Eight separate synthetic reimplementations of tflw's request pipeline all failed to
  reproduce the gap, which is itself informative: the cause lives in the real interpreter code, not
  in anything isolable and rebuildable standalone. Resolved via `/grill-me` on 2026-07-31 (D35-D38
  below) — invest in one more bounded, direct-instrumentation pass (M35b) before falling back to
  re-scoping D33a's tolerance.

### D35

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M35B_ROOT_CAUSE.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D35 — M35b time-box: one tick-log pass + one instrumentation pass, then ship + document
  regardless of outcome.** Same bounded-effort convention D33c already established for M35a — one
  `node --prof`/`--prof-process` tick-log pass first (free, no source changes), one
  `performance.now()`-checkpoint instrumentation pass of the real call chain if the tick-log doesn't
  resolve it, then stop and write up whatever was found either way. Not open-ended, and not a fixed
  hypothesis count — a fixed *tool budget* (two distinct diagnostic passes), since the point of this
  round is to escalate to better tools, not to keep guessing candidates the way M35a-2 did.

### D36

<sub>cited inside a range only · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D36 — M35b target: the isolated echo-server harness only, not the real acceptance target.**
  Keeps this measurement directly comparable to M35a/M35a-2's own numbers (`acceptance/perf/
  profile/`) and free of the real target's own DB row-lock contention, which would confound
  fine-grained timing checkpoints. Validating that whatever's found also explains the real ~3x gap
  is M35c's (re-measure's) job, not this one's.

### D37

<sub>cited from tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M35B_ROOT_CAUSE.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D37 — if M35b confirms a fixable mechanism: stop, write up, check in before any fix code.**
  This is an investigative milestone, not a fix milestone. A fix would touch real interpreter
  internals on a hot path — deserves its own scoped go-ahead once the mechanism is actually known,
  the same pattern M35a already used (stopped for direction rather than auto-proceeding into a fix).

### D38

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D38 — if M35b is still inconclusive after its time-box: re-scope D33a's tolerance, not another
  investigation round.** Avoids indefinite sunk-cost investigation on top of what M35a/M35a-2/M35b
  will have already spent. If this triggers, the next conversation is "what tolerance is realistic
  given a genuinely unexplained ~3x gap," not "what else can we try."

### D39

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M36_CONCURRENCY.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D39 — reopening.** M35 (a-d) is treated as complete and its own write-ups stand unchanged;
  M36 is a new, separately-scoped milestone continuing the same investigation thread, not a
  reopening of M35 itself. The pentest arc (D33d) is further delayed until M36 also reaches a
  stop condition (fix shipped and re-measured, or refuted and reported) — same one-arc-at-a-time
  discipline (D3), just with perf's own end pushed later than D33d originally assumed.

### D40

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M36_CONCURRENCY.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M36_SESSION_REFRESH.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D40 — hypothesis.** Node's global `fetch()` (backed by undici) may cap concurrent connections
  per origin below tflw's configured VU count — so tflw's 60 "VUs" may not actually hold 60
  simultaneous in-flight requests against the server the way k6's Go-native client does. Grounded
  in the shape of M35d's own evidence: VUs measured 84-86% blocked/back-off time on a target whose
  contention is a real, serialized Postgres row lock, and the gap to k6 is a roughly stable
  multiplier (not diffuse) across both M34's and M35d's measurements — exactly what an
  under-utilized client-side concurrency budget would produce, independent of the per-call `fetch()`
  cost M35b/M35c already fixed. Distinct in kind from M35b's finding: that was a process-wide
  per-call CPU/latency tax; this is a request-dispatch/concurrency-management question — how many
  requests tflw actually keeps in flight at once, not how expensive each one is.

### D41

<sub>cited from tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M36_CONCURRENCY.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M36_SESSION_REFRESH.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D41 — investigation plan, one bounded pass (same convention as D33c/D35/D38).** Instrument the
  actual concurrent in-flight request / open-socket count during a run — a counter around dispatch
  in `packages/runtime/src/http.ts`, or hooking undici's `diagnostics_channel` events — and compare
  it against the configured VU count, on two targets: the isolated echo-server harness
  (`acceptance/perf/profile/`, control, already re-baselined post-M35c at 4,470 iter/s) and the
  real `checkout-burst.tflw` acceptance target, with k6's equivalent concurrency as the reference
  point on the same targets. One measurement pass: confirm or refute the ceiling exists and, if it
  does, whether it's close enough to the VU count to explain the ~3x gap's *magnitude* (not just
  its existence) — then stop and report either way, before writing any fix code (mirrors D37's
  "stop and check in" pattern from M35b).

### D42

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M36_CONCURRENCY.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M36_SESSION_REFRESH.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D42 — fallback if refuted.** If in-flight concurrency tracks the configured VU count closely
  (no meaningful ceiling), the next real candidate is scheduling/dispatch overhead inside the
  `RampUsersWorkload` spawn model itself — specifically, how much wall-clock time elapses inside
  one VU's own loop between a request resolving and the next one being issued, which under a
  contended endpoint could look identical to a concurrency ceiling from the outside (fewer
  effective requests reaching the server per second) without actually being a connection-pool
  limit. That would be a second, separately-scoped pass, not automatic. If that pass is also
  inconclusive, D38's original fallback applies: re-scope D33a's tolerance rather than open a third
  investigation round.

### D43

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D43 — the real root cause, found 2026-08-01.** While running D42's own pass against the real
target (above), an instrumentation artifact (impossible negative "dispatch gap" values, real-target
only) led to discovering a genuine bug: `runLoadCore` establishes each scenario's session **once**
(`baseSessionHeaders`, `interpreter.ts:430-438`) before the VU loop starts, and every iteration
clones that same frozen snapshot (`interpreter.ts:453`). `refreshSessions` (`interpreter.ts:1105-1132`)
correctly re-authenticates on a 401 and updates the shared `sessionCache` — but only ever writes
the fresh headers into *that one iteration's own* `ctx.sessionHeaders`, never back into
`baseSessionHeaders`. With `testFlow-tests`' dev-environment `JWT_ACCESS_TTL=5s` (already known and
documented — `acceptance/README.md`'s "session resilience" section, `checkout-burst.js`'s own
comment header — but never measured for cost), this means: once the shared token first expires
(~5s into `checkout-burst.tflw`'s 20s ramp), **every single subsequent iteration** re-authenticates
— not periodically, continuously — because the stale snapshot is never updated. Measured across
three real-target runs: 40-42% of all iterations pay for a full extra `POST /auth/login` round
trip; from the 5s mark to the end of the 20s scenario (75% of its own window), the reauth rate is
100%. **Causally confirmed via an environment-only A/B** (no source touched): temporarily raising
`testFlow-tests/.env`'s `JWT_ACCESS_TTL` from `5s` to `10m` (so the bug structurally can't fire),
then restoring it — throughput went from ~172-219/s to **528.4/s** (vs. k6's 620/s, ~1.17x — down
from ~3.2-3.4x), and the p95 threshold, which had failed on every single prior run in this entire
arc (M34, M35d, every M36 re-check), **passed outright** (105ms vs. the 250ms bar). Full write-up:
`acceptance/perf/profile/FINDINGS_M36_SESSION_REFRESH.md`. **This — not D40's concurrency ceiling
(refuted) and not D42's dispatch overhead (refuted) — is the real, dominant, fixable driver of the
whole M34→M35→M36 gap.** No fix code written; all temporary instrumentation reverted (confirmed
via a clean debug-marker grep + full 372/372 runtime + 106/106 CLI test pass), `testFlow-tests/.env`
restored to `JWT_ACCESS_TTL=5s`. Per this arc's own established stop-and-check-in convention
(D37/M35b→M35c): **stopping here, awaiting explicit direction before scoping or writing the actual
fix** (`runLoadCore`'s session setup needs to stay in sync with `sessionCache` instead of freezing a
one-time snapshot — exact approach not yet decided).

### D44

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D44 — fix strategy: re-derive session state from `sessionCache` every iteration, not a frozen
  snapshot.** `runLoadCore`'s scenario setup keeps its existing upfront `sessionCache.ensure(name,
  ..., true)` calls (`interpreter.ts:432-439`) for their fail-fast value (a broken `session` block
  still errors the whole run immediately, before any VU spawns, rather than 60 VUs independently
  discovering it) — but `runIteration` (`interpreter.ts:441-497`) stops cloning the frozen
  `baseSessionHeaders`/`baseCookieJar` snapshot (`interpreter.ts:453/455`) and instead calls
  `sessionCache.ensure(name, decl, config, tc, false)` fresh, per session, at the top of every
  iteration. On a cache hit (the overwhelmingly common case — no expiry in play) this is a `Map.get`
  plus awaiting an already-resolved promise: negligible, and `load.test.ts`'s existing "a session
  opted into via `as <name>` establishes once before the loop, not once per iteration" test should
  keep passing unchanged (a healthy session never triggers a second `runSession()` call). The
  win: reads always come from the one place `refreshSessions` already correctly updates
  (`sessionCache`), so a reactive 401-triggered refresh from *any* VU is immediately visible to
  *every* VU's next iteration — not just the one VU that happened to hit the 401 — and `oauth2`
  sessions get `ensure()`'s existing proactive TTL re-check for free, which the current snapshot
  design never benefited from either. Rejected alternative: patching `baseSessionHeaders` in place
  only when a reactive refresh fires — achieves the same end state but needs new plumbing from deep
  inside `execSteps`/`refreshSessions` back up to `runIteration`, and (being purely reactive) never
  helps `oauth2`'s proactive path. Chosen for being simpler *and* more complete, not just simpler.

### D45

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D45 — also close the relogin-storm race, in the same pass.** `refreshSessions`
  (`interpreter.ts:1105-1132`) currently calls `sessionCache.invalidate(name)` unconditionally
  before re-establishing — if several VUs hit 401 on the same stale token near-simultaneously (the
  expiry-boundary moment this whole bug was found from), each one discards whatever the *previous*
  one just installed and pays for its own redundant `POST /auth/login`, even though the first
  refresh already made the cache current. Bounded and self-limiting (at most one extra login per VU
  genuinely in flight at that exact instant, not proportional to iteration count) — but the user
  chose to close it now rather than leave it, since D44 already touches this exact code path.
  Design: `SessionCache` gains a cheap synchronous accessor exposing the *current* cached promise
  for a name as an opaque handle (e.g. `currentRef(name): SessionRef | undefined`, `SessionRef` a
  type alias for `Promise<SessionOutcome>` — opaque to callers, compared only by `===` identity,
  same guarded-by-identity pattern `ensure()`'s own TTL-eviction already uses at
  `interpreter.ts:926-931`), plus a guarded re-establish method (e.g. `reestablish(name, staleRef,
  decl, config, tc)`) that only actually invalidates + re-logs-in if the cache's live entry is still
  exactly `staleRef` — otherwise it's already been refreshed by someone else, so it just returns the
  current (already-fresh) `ensure()` result with no redundant network call. `EvalCtx` (`eval.ts`)
  gains a new optional field, `readonly sessionRefs?: ReadonlyMap<string, SessionRef>`, populated
  wherever `sessionHeaders`/`cookieJar` are captured from `sessionCache.ensure()` — for this fix,
  scoped to `runLoadCore`'s per-iteration read only (D44's own new call site); the regular `tflw
  run` ctx-building path is left populating nothing (`sessionRefs` stays `undefined` there), so
  `refreshSessions` degrades to today's unconditional-invalidate behavior for that path — zero
  behavior change, zero regression risk outside the load engine, where the 60-VU-scale storm
  scenario doesn't realistically arise the same way. `refreshSessions` itself calls
  `sessionCache.reestablish(name, ctx.sessionRefs?.get(name), ...)` instead of
  `invalidate()`+`ensure()` directly.

### D46

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D46 — milestone scope: fix + tests only; re-measurement is a follow-up milestone (M38).**
  Mirrors this arc's own M35b (root cause) → M35c (fix + unit tests) → M35d (re-measure) precedent.
  M37 stops once the fix is implemented, verified by unit tests, and the full suite is green — it
  does **not** re-run `checkout-burst.tflw` against the real testFlow-tests target or update
  `acceptance/README.md`'s verdict. That's M38, scoped separately once M37 lands.

### D47

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D47 — pursue the residual gap now, not defer to the pentest arc.** Both of
  `checkout-burst.tflw`'s own thresholds already pass (p95 < 250ms, error rate < 1%) — the
  remaining ~11.3%/~46% gap is only visible against D33a's stricter tflw-vs-k6 comparison, not a
  functional problem with the scenario. Pursued anyway, at the user's explicit direction, as one
  more bounded pass before accepting it as a permanent open item.

### D48

<sub>cited inside a range only · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D48 — targets: the two existing local harnesses only, no new target.** Considered adding a
  self-hosted `httpbin`-style container for a dialable-latency dimension neither existing harness
  has; rejected — `echo-server.mjs` (zero-latency, no contention) and testFlow-tests' real dogfood
  app (real DB contention) have both been proven reliable and reproducible across M35a-M38, and a
  third target would duplicate most of what they already cover. Public shared instances
  (httpbin.org, reqres.in, etc.) are out of consideration entirely — repeated automated load-test
  traffic against a shared public service the user doesn't control is exactly the kind of usage
  those services ask you not to send, independent of whether it would even give reproducible
  numbers (shared rate limits, noisy neighbors, no control over their infra).

### D49

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D49 — method: rebuild M34's isolation ladder with k6 counterparts at every rung, not just
  repeat checkout-burst for confidence.** M34's own root-cause table (`acceptance/README.md`)
  isolated tflw's per-request overhead by escalating workload shape (GET-only → POST-uncontended →
  POST-contended) but only ever compared tflw against a raw `fetch` script at each rung — never k6,
  which is the actual comparison D33a's tolerance is about. Rebuilding the same ladder with k6
  scripts at each rung answers a question M34 never could: does the tflw-vs-k6 gap already exist on
  a plain GET, only appear once a `POST` body enters the picture, or only widen once real
  contention (the Postgres row lock) is added? Concretely, five rungs (echo-server has no
  contention mechanism, so its ladder is two rungs, not three):
  - **echo-server** (zero-latency, no shared state): (a) GET-only, (b) POST with body — both
    already have tflw-side scripts (`bench.tflw`'s GET/POST pair); new k6 counterparts needed,
    none exist yet for this harness.
  - **dogfood** (real Postgres): (c) GET-only (session auth), (d) POST uncontended
    (`POST /cart/items`, static body, no shared row), (e) POST contended (the acceptance scenario
    itself, already built as `checkout-burst.tflw`/`checkout-burst.js`). (c) and (d) need new
    `.tflw` scenario files (M34's own numbers for these rows came from ad-hoc runs, never saved as
    fixtures) and new k6 scripts (none exist for anything but the full contended scenario).

### D50

<sub>cited inside a range only · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D50 — sample size: 3 tflw runs + 2 k6 runs per rung**, a step up from M35d/M38's 2+1
  baseline since this series exists specifically to separate real signal from noise across more
  configurations (5 rungs) than any prior single-scenario re-measure. Echo-server rungs are cheap
  (~8-20s each) so the extra runs cost little; dogfood rungs need a load-target reset
  (`POST /admin/load/reset`) before every run, so cost is higher there but still bounded.

### D51

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D51 — scope: investigation + write-up only, no fix.** Same precedent D37 already set for
  M35b ("if M35b confirms a fixable mechanism: stop, write up, check in before any fix code") —
  whatever the ladder finds, a fix on this hot path (`execApi`/`prepareBody`/`sendRequest` in
  `packages/runtime/src/interpreter.ts`, the same code M34's original table already implicated but
  never pinned to a line) gets its own scoped go-ahead once the actual mechanism is known, not an
  auto-proceed within the same milestone.

### D52

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D52 — arc ordering + stop condition.** M39 finishes before the pentest arc (v0.4.0) starts —
  same one-arc-at-a-time discipline (D3) as every prior milestone in this thread, and M39 is
  bounded (15 tflw runs + 10 k6 runs total across 5 rungs), so this is a short delay, not another
  reopening of the whole perf arc. **If the ladder is inconclusive** (doesn't clearly localize
  where the tflw-vs-k6 gap opens or widens): re-scope D33a's tolerance and close the thread, the
  same fallback D38 already used for M35b, rather than open an M40. An inconclusive result after
  one well-instrumented, multi-rung pass is itself informative — it would suggest the residual gap
  is an inherent interpreted-Node-vs-compiled-Go architecture difference, not a fixable bug, and
  the tolerance should be loosened to match reality rather than chased indefinitely.

### D53

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D53 — root-cause first, fix separate (a new M41).** M39 localized *where* the gap lives (p95
  tail, specifically under real row-lock contention) but not *why* at a code level — the
  compounding-overhead mechanism is still a hypothesis. Explored `runLoadCore`'s VU-iteration loop
  directly (`packages/runtime/src/interpreter.ts`) before asking: `runIteration` calls the exact
  same `execSteps`/`execApi`/`sendRequest` chain `tflw run` uses for every ordinary test (not a
  load-isolated code path) — so a blind fix attempt on this hot path risks regressing every
  functional test in the suite, not just load runs. Given that blast radius, M40 stays
  investigation-only; mirrors M35a/M35b→M35c's own precedent of stopping to check in once the
  mechanism is known, before any fix code (D37/D51's convention, applied a third time).

### D54

<sub>cited inside a range only · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D54 — method: instrument the real call chain at 1 VU vs. 60 VU on `checkout-burst`, not
  echo-server.** Same direct `performance.now()`-checkpoint technique as M35b's decisive step
  (temporary checkpoints added to the real `interpreter.ts`/`http.ts` source, rebuilt into
  `dist/cli.cjs`, run for real, then reverted — never shipped as permanent code, matching M35b's own
  convention). Echo-server has no contention mechanism at all, so it structurally cannot reproduce a
  p95-under-contention effect — the instrumented target has to be the real dogfood endpoint.
  Concretely: checkpoint every boundary in `runIteration`→`execSteps`→`execApi`→`sendRequest`, run
  `checkout-burst.tflw` once at 1 VU (no contention — an intra-process baseline for tflw's own
  bookkeeping cost) and once at the full 60-VU ramp (real contention), and compare what share of
  each iteration's wall time is *not* spent waiting inside `sendRequest`'s `fetch()` call (i.e.
  session-cache reads, header building, `execSteps` dispatch, trace/redact construction, VU-loop
  continuation) between the two runs. If tflw's own bookkeeping share grows disproportionately at 60
  VU relative to 1 VU, that's direct, real-code evidence for the compounding hypothesis — the same
  kind of decisive, non-speculative finding M35b's own instrumentation step produced (which, notably,
  found a *different* root cause than the candidates first suspected — direct instrumentation reveals
  whatever's actually eating the time, not just confirms one named hypothesis going in).

### D55

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D55 — stop condition: bookkeeping share meaningfully larger at 60 VU confirms the mechanism and
  proposes M41; flat/noise-level refutes it.** If confirmed, M40 writes up the specific mechanism
  (which boundary in the chain, and roughly how much of the tail it accounts for) and proposes a
  separate M41 fix milestone scoped around that mechanism — not an auto-proceed within M40 itself,
  since the fix would touch shared hot-path code and needs its own explicit go-ahead plus the full
  regression suite (currently 374 runtime + 106 CLI tests) green before anything else builds on top
  of it. If the bookkeeping share doesn't move (within noise), that refutes the compounding
  hypothesis — same fallback D38/D52 already used once each: re-scope D33a's tolerance specifically
  for contended-tail-latency scenarios (exact number to be set from what M40 actually measures, not
  pre-committed here) and close the thread, no M41.

### D56

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D56 — arc ordering: M40 (and M41, if it happens) still finish before the pentest arc (v0.4.0)
  starts.** Third time this line gets pushed out (M36 first pushed it, M39 reaffirmed it, now M40/M41
  again) — same one-arc-at-a-time discipline (D3) as every milestone in this thread. Justified by
  M40 being a single bounded investigation pass (not iterative if inconclusive, per D55's stop
  condition), and by the shared-code blast radius identified in D53: starting the pentest arc's own
  work on top of a not-yet-understood hot-path performance characteristic would make any future fix
  here harder to land cleanly against a moving codebase.

### D57

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D57 — one more bounded root-cause pass, aimed at the HTTP-client/protocol layer, not another
  architecture redesign.** Given real OS-level parallelism (just tested) showed zero improvement, a
  parallel-VU-execution-model redesign (worker_threads or multi-process VU sharding) would almost
  certainly not close the gap either — that whole design axis is now off the table. What's left after
  eliminating five separate client-side mechanisms across M36/M40/this session is something at the
  level of how Node's `fetch()`/undici issues and completes an individual HTTP request differently
  from Go's `net/http` client — mirrors this arc's own M35a→b→c and M39→M40 precedent (confirm a
  specific mechanism before committing to any fix) rather than jumping straight to an uncertain fix.

### D58

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D58 — method: adapt `raw-fetch-bench.mjs` (M35a) to the real contended target, compare its p95
  directly against k6.** `raw-fetch-bench.mjs` already exists as a bare Node `fetch()`-loop script
  with zero tflw interpreter/session/redaction machinery, built for M35a's CPU-profiling comparison
  against echo-server. M41 adapts it (or a sibling script) to hit the real dogfood `checkout-burst`
  target with bearer auth, the same 60-VU/20s ramp shape, against **both** rung D (uncontended) and
  rung E (contended) for a proper apples-to-apples read against the existing ladder — not just the
  contended target alone. If the raw loop's p95 gap vs. k6 matches tflw's own (~48% on the contended
  rung): the cause is isolated to Node's fetch()/undici stack itself, not any tflw code. If the raw
  loop's gap collapses toward k6's: something specific in tflw's own `execSteps`/session/redact call
  chain is still responsible despite M40's bookkeeping-share finding, and needs one more targeted
  look. Same sample size as the ladder's own convention (D50): 3 raw-loop runs; k6's side reuses this
  session's already-fresh runs (629.5/s p95=68.13ms, 642.5/s p95=69.62ms on the contended rung) rather
  than re-measuring an unchanged baseline, mirroring M40's own reuse of M36's D40 finding instead of
  redundant re-testing.

### D59

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D59 — stop condition, per outcome.** *Isolated to Node's HTTP stack* (raw loop's gap matches
  tflw's own): confirms by elimination — now a sixth angle, across M36/M40/this session's `--workers`
  test/M41 — that the gap is inherent to Node's runtime HTTP implementation versus Go's, not a bug in
  tflw's own code. An HTTP-client swap (undici's `Pool`/`Client` API tuned directly, or an alternate
  library) is a real but high-effort, uncertain-payoff bet with no guarantee it moves a runtime-level
  characteristic. Per this arc's D51/D52/D55 bounded-effort convention: don't open that bet
  speculatively — re-confirm D33a's ~50% contended-p95 tolerance (already covering 46%/49.2%/48.1%,
  three independent measurements) and let the pentest arc start. No M42. *Isolated to tflw's own code*
  (raw loop's gap collapses toward k6's): the good outcome — a real, fixable target exists. M41 stays
  investigation + write-up only regardless of outcome (same discipline as M39/M40); a fix gets its own
  explicit-go-ahead milestone (M42) scoped around whatever the raw-loop comparison specifically
  isolates, not an auto-proceed inside M41 itself.

### D60

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D60 — scope: isolation test first, in the existing raw harness, zero tflw code touched.**
`raw-fetch-bench-dogfood.mjs` (M41) is a standalone one-off Node process, so importing `undici` there
carries none of M35b's fetch()-poisoning risk — sidesteps that problem entirely for this milestone.
Mirrors this arc's own investigate-before-fix precedent (M35a→b→c, M39→M40, M41 itself): confirm the
hypothesis cleanly in a disposable harness before any real runtime design work.

### D61

<sub>cited inside a range only · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D61 — one clean pinned-Client variant only, no capped-Pool variant in the same pass.** A
pinned-per-VU `undici.Client` (one `Client` per VU, HTTP/1.1, created once at worker spawn, reused
for the VU's full lifetime) is the direct Artillery/k6 mirror and the only variant this milestone
tests. A `Pool` with `connections` capped to exactly `users` is a different hypothesis (bounded
sharing vs. true 1:1 pinning) — deliberately left out to keep this milestone's verdict attributable
to one specific mechanism, not blurred across two.

### D62

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D62 — success bar: must approach ~1-2% to count.** Only a pinned-Client result landing near the
user's original ~1-2% target counts as confirming the hypothesis and justifying a follow-on
milestone. Anything short of that — including a real but partial improvement, e.g. into the 15-20%
range — is treated the same as a refutation: a fourth negative result (after M36's concurrency
ceiling, M40's bookkeeping-share, M41's raw-fetch reproduction), and D33a's ~50% contended-p95
tolerance stands for good, with no further HTTP-client-layer chase after this.

### D63

<sub>cited inside a range only · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D63 — the poisoning-avoidance design question is deferred to a from-scratch M43.** M42 does not
design how tflw's real `sendRequest`/`runLoadCore` could use pinned connections without re-triggering
M35b's ~18.6x fetch()-poisoning landmine for the non-load `run` path that shares the same interpreter
process — that's real implementation design work, and only matters if D62's bar is met. If M43 gets
triggered, it scopes that question itself, from scratch, via its own grill-me round.

### D64

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D64 — arc ordering: re-blocks the pentest arc.** Unlike M41 (which delivered a legitimate close
and left the pentest arc unblocked), M42 is a real, live investigation the user explicitly reopened
knowing that — per this arc's own one-arc-at-a-time discipline (D3, D33d/D52/D56), the pentest arc
(v0.4.0) waits for M42's result. Sixth time this ordering line gets pushed out.

### D65

<sub>cited inside a range only · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D65 — one M42, isolation-test only, no tflw runtime changes.** Same shape as M41/M35a: extend the
script, run 3× on rung E (the rung that matters — rung D's uncontended gap is already small and near
D33a's ~10% tolerance), write up the verdict. No split into sub-milestones; the change is small
enough (one new function in an existing script) not to warrant one.

### D66

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D66 — research grounding: one bounded, inline websearch pass, not delegated.** Run directly by the
main session (not handed to a background agent, per the incident above) before the write-up above —
confirmed the undici/Artillery primary-source claims and surfaced the open undici#1203 issue as
honest supporting (not conclusive) context. No further research pass planned; the isolation test
itself is the actual source of truth from here.

### D67

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D67 — endpoint identity ships as automatic AND explicit, together, this milestone.** Every `api`
step gets an identity of `(service, method, path.raw)` for free, zero grammar changes, works
retroactively on every existing fixture. On top of that, a new optional trailing clause —
`api POST /orders as "checkout"` — lets an author assign an explicit label, shipped in this same
milestone rather than deferred (R6 called this "per-tag," a separate axis from "per-endpoint";
D67 reunifies them into one milestone since the explicit form is what this arc's own comparison
actually needs).

### D68

<sub>cited inside a range only · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D68 — an explicit tag replaces the identity, k6-style.** When present, `as "label"` alone
determines the bucket — matching k6's `{name: 'checkout'}` exactly, not merely relabeling a
still-path-keyed bucket. Untagged steps fall back to the automatic `(service, method, path.raw)`
identity. This is what lets `checkout-burst.tflw`'s POST step share an identity with k6's own
`checkout`-tagged request for a true apples-to-apples read.

### D69

<sub>cited inside a range only · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D69 — all three report surfaces, this milestone.** `load-results.json` gets the per-endpoint
breakdown for free (`LoadReport`/`LoadScenarioReport` grow an additive `endpoints` field, no separate
serialization code). `load-report.html` reuses the *already generic* `renderMetricsSection()`
(`packages/reporter/src/load-html.ts:55-74` takes a heading + `LoadMetrics` + thresholds already —
confirmed by reading the file before asking) once per endpoint inside each scenario's section — a
small addition, not a rewrite. Live console gets a compact one-line-per-endpoint table. `junit.xml`
needs no *new* mechanism (it's already threshold-driven, one `<testcase>` per threshold —
`packages/reporter/src/load-junit.ts:25-26`), it just also walks each endpoint's own scoped
thresholds (D70) the same way it already walks a scenario's whole-iteration ones.

### D70

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D70 — scoped thresholds ship this milestone.** New grammar: `threshold p95 duration for "checkout"
is less than 250ms` — the `for "label"` clause matches either an explicit tag or an automatically-
derived `METHOD path.raw` string. Without it, `threshold` keeps meaning exactly what it means today
(whole-iteration-scoped). This directly replaces `checkout-burst.tflw`'s existing threshold with the
true equivalent of k6's own scoped one (D72).

### D71

<sub>cited inside a range only · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D71 — all four milestones (M43-M46) scoped in full today**, not one-at-a-time. Front-loads M45's
design (the pinned-connection mechanism, D75) and M46's shape before M43/M44 have run — accepted
risk that M44's real numbers could still shift M45/M46's assumptions; scoped anyway per explicit
instruction.

### D72

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D72 — fixtures and checker gain real coverage.** `checkout-burst.tflw`/`.js` retag the POST step
`as "checkout"` (already matches k6's own `name: 'checkout'` tag verbatim — no k6-side change
needed) and swap the whole-iteration threshold for the new `for "checkout"`-scoped one. Untagged
fixtures (`bench.tflw`, `echo-*`, `dogfood-get-only`, `dogfood-post-uncontended`) are untouched —
automatic identity covers them with zero edits. New checker diagnostic **TF034** ("threshold `for`
clause references a label no step in this scenario declares or derives") — the next free code after
TF033, catching a typo'd `for "checkotu"` at check-time instead of it silently evaluating against an
empty/missing bucket at runtime.

### D73

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D73 — D33a's contended-p95 tolerance is re-scoped immediately after this milestone**, not deferred
to M46. `leg-split-diag.mjs`'s own diagnostic put the true unpinned gap at ~18% (17.75%, 18.1%);
M44's job is to confirm that number lands the same way inside tflw's real, shipped report (not the
throwaway script) and set D33a's tolerance to match it directly — a real number from a real report,
not a placeholder pending M45.

### D74

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D74 — the strict ~1-2% bar still applies**, now measured against M44's corrected baseline rather
than the original 48-52% numbers it was set against. Re-affirmed explicitly (not assumed) given the
starting gap shrank by roughly an order of magnitude between when D62 set the bar and now — the bar
is about reaching parity with k6, not about how large the gap being closed happens to be.

### D75

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D75 — the mechanism is Node's native `node:http`/`node:https` `Agent({keepAlive: true})`, not
`undici`.** M35b's own root-cause finding is specific to the userland `undici` package; `node:http`
is a structurally separate implementation Node has shipped natively for years, never touched by that
bug. A new load-only send path — `sendRequest`/`fetch()` stays completely untouched for `tflw run` —
uses `http.request()`/`https.request()` with a per-VU `Agent({keepAlive: true})`, created once in the
existing per-VU closure (`interpreter.ts`, the `(async () => { ...while (performance.now() < runEnd)
await runIteration(); })()` block around line 533-541) and reused for that VU's full lifetime, mirroring
Artillery's/k6's own default and M42's own finding that this is what closes most of the gap. Stays in
the main process — no IPC, no child-process complexity, unlike extending `mtlsWorker`'s pattern to
all load traffic (the rejected alternative — would add per-request IPC serialization overhead that
could itself erode a meaningful share of the latency win pinning is meant to deliver).

### D76

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D76 — Candidate A: TCP_NODELAY/Nagle asymmetry (primary suspect).** `httpPinned.ts`'s pinned send
path calls `lib.request(url, {...}, resolve)` then `req.end(bodyBuffer)` and never calls
`req.setNoDelay(true)`. Node's raw `http`/`https` module does not disable Nagle's algorithm on its
own — the caller must opt in explicitly. Confirmed via source reading + web research that every
other client in this comparison already does: `undici`'s own `connect.js` calls
`socket.setNoDelay(true)` unconditionally on every connection (so `fetch()` — tflw's pre-M45
unpinned path, and every non-load `tflw run` — has always had this), and Go (k6's implementation
language) disables `TCP_NODELAY` by default for every `net.Dial`-established TCP connection. tflw's
brand-new pinned path is the one client in this whole arc that leaves Nagle on. Nagle interacting
with a peer's delayed-ACK timer (~40ms) is a well-documented cause of intermittent head-of-line
stalls specifically when a small request body is written in a separate `socket.write()` from its
headers — exactly the checkout POST's shape, and exactly a tail-latency (p95) symptom rather than a
throughput one, consistent with M45's own finding that throughput already leads k6 while only p95
lags (a systemic per-request cost would show in both; an intermittent stall shows in the tail
alone).

### D77

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D77 — fix directly, no isolation diagnostic.** Unlike M41/M42's mechanisms (speculative,
required a throwaway harness to confirm before touching real code), this one already has an
external, citable root cause and a single well-precedented, zero-downside fix
(`req.setNoDelay(true)` right after `lib.request(...)`, trivially revertible). Apply it directly to
`httpPinned.ts` and remeasure with this arc's own standard 3-runs-per-side protocol (load target
reset before every run, both `checkout-burst` and `dogfood-post-uncontended`, fresh k6 baseline in
the same window) rather than building another isolation script first.

### D78

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D78 — Candidate B: percentile algorithm mismatch (documented, not changed — investigated second).**
`LatencyHistogram.percentile()` (`histogram.ts:84-94`) uses nearest-rank over a bucketed histogram
(3-sig-fig rounding at record time, D19's deliberate HDR-histogram-style tradeoff for constant-size,
mergeable IPC payloads regardless of sample count). k6's `TrendSink.P()` (`metrics/sink.go`) uses
linear interpolation over exact, unbucketed raw sample values. Nearest-rank-on-real-samples is
known to bias slightly high vs. interpolation on right-skewed distributions, plus up to ~0.1-0.5%
relative rounding from the bucketing itself. This is real but architectural — D19's tradeoff still
serves every other load report every tflw user sees, so `percentile()`'s algorithm is **not**
changed globally. Instead, after D77's remeasure, a throwaway script (not shipped code) computes
k6-style linear interpolation over that same run's raw per-iteration samples and reports it
alongside the shipped nearest-rank number, so the bias is a measured quantity in the write-up, not
just an asserted direction.

### D79

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D79 — stop condition.** After D77 (Nagle fix, remeasured) and D78 (percentile bias quantified):
if the residual checkout-scoped p95 gap lands clearly small (**<3%**, roughly M45's own
dogfood-side result) once the quantified percentile bias is accounted for, declare this chase
closed and proceed to M47 — this is the practical JS/V8-vs-Go ceiling. If a meaningful residual
remains, allow **at most one further bounded root-cause pass** (D80, mirroring M41's own "one
pass" discipline) before accepting whatever's left as the ceiling regardless of the literal D74
number — no open-ended chase, consistent with this arc's own repeated precedent (D35/D38/D51).

### D80

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D80 — secondary mechanisms, sequential only.** Server-side Nagle on testFlow-tests' NestJS/Node
HTTP server, per-request `AbortSignal.timeout()` allocation overhead in the pinned hot path, and
Node event-loop/GC jitter under sustained load are plausible but weaker candidates. They are **not**
investigated in this pass; they're the reserve for D79's "one further pass" only if the gap is
still ≥3% after D77/D78.

### D81

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D81 — extended at the user's explicit direction to a three-way ladder (tflw + k6 + Artillery),
2026-08-01.** M46d added Artillery as a corroborating comparator on two rungs only (D, E). The user
asked for the *final* acceptance round itself to compare all three tools across the whole ladder,
not just the two rungs M46d happened to need. Scope call, made directly (no full grill-me — the
shape is a mechanical extension of M46d's already-proven method, not a new design question):

- **All five rungs get an Artillery counterpart**, including echo-server A/B and dogfood GET-only
  C — cheap to build (echo-server has no auth; C reuses M46d's `processor.cjs`) and the user asked
  for all three tools compared "in this acceptance," not just the two contention-relevant rungs.
- **Rungs A-C keep M39's own exclusion from the D33a tolerance check and from any tflw-vs-other
  conclusion** — tflw's generator self-saturates on these near-zero-latency targets (D19), a
  separately-diagnosed phenomenon unrelated to client-protocol overhead. Artillery's numbers on A-C
  are reported for completeness (a real three-way reading, and a bonus k6-vs-Artillery data point
  neither tool self-saturates on) but, like tflw's own A-C numbers since M39, are not used to draw
  conclusions about the residual gap or D33a's tolerance — same framing M39 already established for
  these rungs, just extended to the third tool.
- **Rungs D and E are the trustworthy three-way comparison**, same as M39/M44/M45/M46d. Artillery's
  configs for these two already exist (`acceptance/perf/artillery/checkout-burst.yml`,
  `dogfood-post-uncontended.yml`) — M47 re-runs them fresh under the same 3×-per-rung protocol as
  the other two rungs, not reusing M46d's own numbers (mirrors M39's "re-measured fresh" precedent
  for checkout-burst rather than reusing M38's numbers).
- **Calibration for the three new Artillery rungs (A/B/C) targets k6's p95**, not tflw's — tflw's
  own numbers on these rungs are the self-saturated, unreliable side per M39, so bisecting against
  them would just be calibrating against noise.

### D82

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D82 — "improve the app" means widen load-test surface, not general fixes.** Two new endpoint
  dimensions, both already implemented in apiV2, neither needing new business logic:
  - **Rung F — search-read** (`GET /products?q=<term>&sort=...`): real Postgres full-text search
    (`to_tsvector`/`plainto_tsquery`), not just an indexed lookup like rung C's `GET /health` —
    genuine query cost on an uncontended, public, read-only path. 120 seeded bulk products
    (`seed.ts`'s `BULK_COUNT`) give it a real result set to search over.
  - **Rung G — ticket-write** (`POST /tickets`): a second uncontended write shape, distinct from
    rung D's single-row `POST /cart/items` — `TicketsService.create` writes a `Ticket` row *and* a
    companion `TicketEvent` row (`logEvent(..., CREATED, ...)`) synchronously, so it's a genuinely
    different write cost, not a repeat of D. No uniqueness constraint on tickets (unlike
    `POST /products/:id/reviews`, which is both rate-limited *and* `@Unique(['userId','productId'])`
    — checked and rejected as a rung candidate: a fixed load user/product pool 409s permanently
    after each pair's first success, which tests the uniqueness wall, not throughput).
  - **One real app change**: `LoadAdminService.reset()` currently deletes the load user's orders
    but not tickets — extend it to also delete the load user's tickets (cascades to `ticket_events`
    at the DB level, mirroring the existing orders-cascade comment), adding `ticketsDeleted` to
    `LoadResetResult`, so repeated `tflw load`/k6 runs against rung G stay repeatable instead of
    accumulating debris between runs.

### D83

<sub>cited inside a range only · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D83 — rungs F/G are tflw-vs-k6 only, not three-way.** Explicit user call this session, diverging
  from M47's own three-way default — no Artillery configs for the new rungs.

### D84

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D84 — p50/p99 are reported, not gated.** tflw already computes `p50`/`p90`/`p95`/`p99` per
  scenario for free (`interpreter.ts:619`, `timeline.ts`) — no runtime change needed, just extraction
  into the write-up. k6's default `summaryTrendStats` only includes `p(90)`/`p(95)` — every new (F/G)
  and existing authoritative (D/E) k6 script gets `summaryTrendStats` extended to include `p(50)` and
  `p(99)` explicitly. D/E's tflw-side p50/p99 can be read from M47's own already-captured histogram
  output (no tflw re-run needed there); D/E's k6-side needs one fresh 3-run pass per rung since the
  option change only takes effect on a new run. No new D33a-style tolerance is set on p50/p99 this
  milestone — see the real numbers first, especially whether the contended rung (E) shows a
  materially wider gap at p99 than at p95 (lock-queueing tails plausibly bite harder there); that's
  a finding to report, not a bar to pre-commit to.

### D85

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

- **D85 — rung lettering stays contiguous.** F = search-read, G = ticket-write, keeping the A-E
  convention rather than a separate namespace.

### D88

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**D88 — landed the fix.** `req.destroy()` on an in-flight request surfaces as a generic
`ECONNRESET`/"socket hang up" on `error` — not a distinguishable code — so the isolation script's
timeout detection (and the shipped fix) uses a closure flag, not the caught error's shape (verified,
not assumed). `httpPinned.ts`'s `signal: AbortSignal.timeout(opts.timeoutMs)` replaced with a
manually-hoisted `setTimeout`/`clearTimeout` spanning both the request and the body-read loop below
it (matching the original's actual scope — `AbortSignal.timeout()` stayed attached to `req` through
body streaming too, not just time-to-first-byte; an earlier draft of this fix cleared the timer on
the `response` event alone and was caught and corrected before landing, since that would have
silently stopped enforcing the timeout during a slow body drip). Full suite green (390 runtime + 107
CLI, typecheck, build).

### D93

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D93 — single DSL keyword.** `scenario` and its mandatory `as load` clause are removed entirely.
  Every top-level block is `test "name" { ... }`. Breaking change, no deprecation period (project is
  pre-1.0/unpublished, consistent with prior breaking-change precedent in the decision log).

### D94

<sub>cited inside a range only · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D94 — kind inferred from workload presence.** A `test` block containing a workload clause (any
  of D97's new keywords) is a performance test; one without is a functional test, exactly like
  today's `test` blocks. No explicit marker keyword survives.

### D95

<sub>cited inside a range only · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D95 — one AST node type.** `TestDecl`/`ScenarioDecl` collapse into a single `TestDecl` with
  nullable `workload`/`thresholds`/`cleanup` fields. `Program.scenarios` is removed; `Program.tests:
  TestDecl[]` is the only array, in file declaration order (required by D97's execution model).

### D96

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D96 — field exclusivity, checker-enforced.** `retry N` or `with each` together with a workload
  clause in the same block is a hard checker error (extends the existing D19 pattern — browser
  steps inside a workload-bearing test stays rejected the same way).

### D97

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D97 — distinct named keywords per workload shape**, not a generalized stage-sequence construct.
  Five workload kinds total, each its own top-level keyword inside a `test` body:
  - `ramp to N users/rps over <dur>` — existing, unchanged.
  - `hold N users/rps for <dur>` — new: constant/steady-state load (mirrors k6 `constant-vus`/
    `constant-arrival-rate`).
  - `step users` / `step rps` — new: a block header followed by `to N for <dur>` lines, one per
    level (mirrors k6 `ramping-vus`/`ramping-arrival-rate` fed a staircase-shaped stage list, but
    surfaced here as its own keyword rather than a generic stage list per D97's framing).
  - `spike users` / `spike rps` — new: a block header followed by a mix of `hold N for <dur>` and
    `to N over <dur>` lines (baseline → ramp up → hold peak → ramp down → baseline).
  - `run N iterations across M users` (shared-iterations) / `run N iterations per user across M
    users` (per-vu-iterations) — new: count-bounded, no duration at all (mirrors k6
    `shared-iterations`/`per-vu-iterations`).
  Exact token wording may still be refined at implementation time; the forms above are working
  drafts, approved in this session, following house spelled-out style and reusing `ramp to ... /
  over ...` phrasing where it already fits.

### D98

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D98 — every new shape supports both closed (users) and open (rps) variants**, matching `ramp`'s
  existing dual support. Same closed-model back-off diagnostic (D17) applies uniformly to every
  closed (users) kind except the two count-based kinds (D101).

### D99

<sub>cited from packages/runtime/README.md · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D99 — `tflw load` is dropped entirely.** Since kind is inferred per-block rather than
  per-file/per-array, a dedicated load-only command loses its rationale. Its power-user tuning
  flags (`--workers`, duration/ramp overrides) move onto `tflw run` itself, scoped to apply only to
  whichever blocks in the file are workload-bearing.

### D100

<sub>cited inside a range only · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D100 — `tflw run` executes every block in strict file declaration order**, interleaved across
  kinds, single process — not batched by kind. A workload-bearing block's full duration/iteration
  count blocks the next declared block regardless of its kind. `--skip-load` skips every
  workload-bearing block for fast iteration (necessary precisely because of this strict-order
  choice — without it, a functional test declared after a long workload always pays its full cost).

### D101

<sub>cited inside a range only · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D101 — unified single-file reporting.** One `report.html` (no `load-report.html`, no linking
  `index.html`) and one `junit.xml`, each with one entry per block in strict execution order,
  reading top-to-bottom exactly like the file's declaration order. `step`/`spike` blocks require a
  per-stage/per-phase metrics breakdown within their own report entry (separate percentile/
  threshold numbers per level/phase) — an aggregate-only number would hide the exact thing these
  shapes exist to reveal.

### D102

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D102 — count-based workloads keep `think` pacing, drop the D17 diagnostic.** `think`
  (pending the separate rename, see `PLAN_THINK_TO_PAUSE.md`) remains legal inside a count-based
  workload body — it's per-VU-iteration pacing, orthogonal to the outer termination condition. The
  D17 back-off diagnostic is skipped for these two kinds specifically because it has no duration to
  divide by (structurally undefined, not a withheld feature).

### D103

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D103 — migration diagnostic for leftover `scenario`.** A `scenario` keyword found post-removal
  produces a specific, named error pointing at the new syntax (e.g. "`scenario` was removed — write
  `test \"name\" { ramp to ... }` instead"), consistent with this codebase's teaching-diagnostics
  philosophy (the TLS/proxy hint system, TF031/TF034 messages) rather than a bare parse failure.

### D104

<sub>cited inside a range only · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D104 — fixture migration order.** `testFlow/acceptance/perf/`'s 12 `scenario` files move to
  `testflow-tests/tflw-acceptance/` (per `PLAN_UNIFIED_RUN_DOGFOOD_REORG.md` Phase 2) BEFORE being
  migrated to the new unified `test` syntax — the move carries old-syntax files (still valid under
  today's unchanged grammar at move time), and migration happens once, in place, at the new
  location, after this plan's language changes ship.

### D105

<sub>cited from CHANGELOG.md, CONTRIBUTING.md, SPEC.md +2 more · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D105 — generic scope, not workload-only.** `parallel`/`sequential` applies to *every* `test`,
  functional (API/UI) or workload-bearing alike — not just load tests. Confirmed feasible by reading
  `packages/runtime/src/browser.ts`: one shared `PWBrowser` process per run, but a fresh, isolated
  browser **context** per test (and per retry attempt), so concurrent functional/UI tests don't
  require a deeper rearchitecture. `SessionCache` (already built to dedupe concurrent session
  establishment for load scenarios) extends to functional sessions for free.

### D106

<sub>cited inside a range only · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D106 — syntax: a bare header modifier**, same slot as today's `retry N`/`as <session>`:
  `test "name" parallel` / `test "name" sequential`. Fixed position in the existing header sequence
  — after `as <session>`, after `retry N`, before end-of-line — matching `parseTest`'s existing
  fixed-order convention (`packages/lang/src/parser.ts`) rather than free-form placement.

### D107

<sub>cited from packages/lang/GRAMMAR.md · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D107 — both keywords are real, writable keywords.** `sequential` is legal and explicit (a no-op
  vs. omitting it), so an author can self-document intent next to a `parallel` neighbor. Confirmed
  no collision: `grep -n "'parallel'\|'sequential'" packages/lang/src/*.ts` matches nothing today.

### D108

<sub>cited inside a range only · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D108 — default is sequential, for every test kind, amending D100.** No keyword means sequential
  — this already matches `tflw run`'s existing functional-test loop (`runProgramInner`'s plain `for`
  over `cases`, `packages/runtime/src/interpreter.ts`), so functional-only files are unaffected. It
  **is** a behavior change for workload-bearing tests: today's `tflw load` runs every scenario in a
  file concurrently by default (`load-testing.md`'s "Multiple scenarios in one run"); going forward
  that becomes an explicit `parallel` opt-in. Migration cost confirmed near-zero: every real fixture
  under `acceptance/perf/` has exactly one `test` per file (`grep -c "^test "`), so only a handful of
  synthetic multi-scenario tests in `packages/cli/test/e2e.test.ts` need `parallel` added to keep
  demonstrating today's concurrent case.

### D109

<sub>cited from SPEC.md, packages/runtime/README.md · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D109 — grouping rule: consecutive-run batching.** Walking `program.tests` in file order, a
  maximal run of consecutive `parallel`-marked tests forms one batch that executes concurrently; a
  `sequential`/default test always runs alone, blocking before and after. Worked example: tests `A,
  B(parallel), C(parallel), D` execute as `A -> (B || C) -> D`. This supersedes D100's "single global
  order, never batched" wording — declaration order still anchors everything, but consecutive
  `parallel` runs collapse into one concurrent batch instead of forcing every test to fully complete
  before the next starts.

### D110

<sub>cited from SPEC.md · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D110 — `--skip-load` renamed `--skip-workload`.** Matches the new generic vocabulary now that
  `tflw load` no longer exists as a command; identical behavior otherwise (skip every workload-bearing
  test, regardless of which batch it belongs to).

### D111

<sub>cited from SPEC.md · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D111 — execution mechanism: reuse `runLoadCore`'s existing `Promise.all(scenarioTasks)` pattern,
  not the `--workers` fork/IPC mechanism.** Confirmed via code research
  (`packages/runtime/src/interpreter.ts:597-835`) that these are two unrelated axes already living in
  today's codebase:
  - **In-process concurrency between tests** (what `parallel`/`sequential` needs) is exactly
    `runLoadCore`'s existing shape: independent async tasks per scenario, launched together via
    `.map(async (acc) => { ... })`, awaited together via `await Promise.all(scenarioTasks)`. The
    unified engine generalizes this: a batch (D109) becomes one `Promise.all` group over that batch's
    members, each member internally picking functional-single-shot or VU-loop-until-duration
    execution per its own `workload` field; a singleton batch is just `await`ed directly, preserving
    today's plain sequential `for`-loop behavior as the degenerate case.
  - **`--workers N`** (`packages/cli/src/cli.ts`'s `fork(process.argv[1], ['--internal-load-worker'],
    ...)`) is process-level horizontal scaling of *one workload-bearing test's own target
    population/rate* across CPU cores (`shareOfWorkloadTarget` stripes `users`/`rps` across shard
    index/count) — it has no notion of, and needs no change for, which batch a test lives in. Each
    forked worker already only runs the workload-bearing subset of the file (`runLoadShard`/
    `loadWorkerCommand` never touch functional tests today) — that scoping, restated in D99, composes
    unchanged: the main process runs the *entire* unified program (functional tests once, plus its
    own striped shard-0 share of every workload-bearing test, batched per D109); additional forked
    workers each run only the workload-bearing subset as shards 1..N-1; `mergeLoadShardReports`
    pools every shard's contribution to a given test by name, exactly as today, regardless of which
    parallel batch that test was declared in.

### D112

<sub>cited from SPEC.md, packages/runtime/README.md · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D112 — report/console display order is declaration order, independent of completion order.**
  Extends D101's "one entry per block in strict execution order, reading top-to-bottom exactly like
  the file's declaration order" — now that "execution order" and "display order" can genuinely
  diverge (two tests in a `parallel` batch may finish in either order), results are collected keyed
  by each test's original declaration index and rendered/reported in that order, never in
  completion order. A `with each` (data-table) test's own per-row cases are unaffected by
  `parallel`/`sequential` either way — that keyword governs only this test's relation to *other*
  tests in the file; its own row-cases keep iterating sequentially internally, exactly as today.

### D113

<sub>cited from SPEC.md · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D113 — `--workers` is explicitly scoped to workload-bearing tests only, enforced by a CLI check,
  not just a documentation note.** There's no legitimate use case for forking processes over a
  purely functional test — running "the same functional test as different processes" buys nothing
  (no population/rate to stripe, no percentile aggregate to merge; a functional test is a single
  pass/fail, not a target you can divide). D111 already established that forked workers never
  execute functional tests by construction (`runLoadShard`/`loadWorkerCommand` only ever handle the
  workload-bearing subset) — D113 makes the *user-facing* boundary explicit instead of leaving
  `--workers N` on an all-functional file as a silent no-op: `tflw run --workers N` (`N > 1`) on a
  file with zero workload-bearing tests emits a non-fatal warning ("`--workers` has no effect — this
  file has no workload-bearing tests") and proceeds on a single process, matching this codebase's
  existing non-fatal-warning style (the coordinated-omission back-off warning, the
  generator-saturation warning) rather than a hard error — a file mixing functional and workload
  tests is a legitimate, unaffected case, so only the *fully*-functional file triggers it.
  `parallel`/`sequential` themselves stay exactly as decided in D105-D109 — global, generic keywords
  with no kind restriction; this decision narrows `--workers` only, not the new keywords.

### D114

<sub>cited from packages/runtime/README.md · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D114 — live console output for a `parallel` batch buffers per test, flushing atomically on
  completion.** D112 only settled the *final* report/summary order (declaration order); it left open
  how the *live* event stream behaves while a batch is actually in flight. Today's console
  (`formatEvent`, `packages/cli/src/cli.ts`) prints each `RunEvent` (`test:start`/`step:end`/
  `test:end`) the instant it fires — safe today only because functional execution is strictly
  sequential, so the stream can never interleave. Once two tests in the same `parallel` batch run
  concurrently, their events can genuinely interleave in wall-clock time (e.g. two `--verbose` tests'
  indented step lines landing mixed together, no way to tell which line belongs to which test).
  Resolution: each test's events are buffered as they occur; the *whole* block for one test
  (`test:start` line, every step line, the closing `test:end` line) is flushed to the console as one
  atomic write the instant that test finishes — never split mid-block. Two tests' blocks can still
  appear in either order live (whichever finishes first prints first), unlike the final report which
  always reorders to declaration order — this decision fixes live-stream readability only, it doesn't
  change D112. Rejected: prefixing every line with a test name/index (extra noise on the common
  non-parallel path, bigger formatting change) and withholding all output until the whole batch
  completes (simplest, but delays feedback for the whole group behind its slowest member — worse for
  `--verbose`'s actual purpose of watching progress). Implementation: `runProgramInner`'s unified
  dispatch collects each batch member's `RunEvent`s into a local array instead of calling the CLI's
  event callback directly; the callback fires with the full sequence once that member's `test:end`
  event is produced. A singleton (non-batched) test is unaffected — one member, nothing to buffer
  against, same effective behavior as today.

### D115

<sub>cited from CHANGELOG.md, packages/runtime/README.md · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D115 — report.html marks a test that ran in a `parallel` batch with a small inline badge, next
  to its name.** D101/D112 settled *ordering* (one entry per test, declaration order) but not
  whether a batch's concurrency is visible at all. Today's report (`renderTest`,
  `packages/reporter/src/html.ts:111`) renders each test as a flat, independent `<section>` — name,
  status dot, `durationMs` — with no start-time field and no grouping, so two batch members' entries
  look identical to two ordinary sequential tests even though their wall-clock windows overlapped
  (e.g. two 10s tests contributing only ~10s to the run's total, not 20s, otherwise looks
  unexplained). Resolution: reuse the existing `test.flaky` inline-badge mechanism
  (`${test.flaky ? ' <span class="flaky">flaky</span>' : ''}`) — a test whose `concurrency` was
  `'parallel'` (i.e. was a member of a multi-member batch, not a `sequential` singleton) renders a
  `<span class="parallel">parallel</span>` badge the same way, no new report structure, no grouping
  container, no start-time field added. Deliberately minimal, consistent with D101's "reads
  top-to-bottom exactly like declaration order" — the badge only answers "did this overlap with
  something else," not "with which other test specifically" (a reader who needs that can already
  see it in the `.tflw` source, since `parallel` is a consecutive-run batch by construction, D109).

### D116

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D116 — discriminated `ReportEntry` union.** `TestResult` gains a required `readonly kind:
  'functional'` (breaking, pre-1.0 precedent per D99's `tflw load` removal). New
  `WorkloadTestResult extends LoadScenarioReport` adds `kind: 'workload'`, `file?`, `concurrency?`
  — `LoadScenarioReport`'s existing fields (`name`/`workload`/`metrics`/`thresholds`/`ok`/
  `backOff?`/`endpoints`) are reused verbatim, not duplicated. `RunReport.tests` widens to
  `readonly ReportEntry[]` (`ReportEntry = TestResult | WorkloadTestResult`).

### D117

<sub>cited inside a range only · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D117 — `RunReport` absorbs the load envelope, no more standalone `LoadReport` artifact.**
  `selfDiagnosis?`/`inconclusive?`/`aborted?`/`abortedMessage?` become optional top-level
  `RunReport` fields (mirroring `LoadReport`'s own). `LoadReport`/`LoadScenarioReport`/
  `buildLoadReport`/`mergeLoadShardReports` stay as-is *internally* (still what `--workers N>1`
  shard-merging produces before its scenarios get spliced into the real `RunReport`) — only the
  outward-facing artifact changes. `LoadReport.combined` (pooled cross-scenario metrics) is
  dropped from the unified report entirely: D101 renders each test standalone, like a functional
  one: no cross-test pooling. A user wanting a combined number sums the per-test tables themselves.

### D118

<sub>cited inside a range only · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D118 — multi-file merge falls out for free.** `RunReport.tests` already merges across files
  (functional case, `cli.ts`'s `mergeReports`) — once workload entries just live in that same
  array, the CLI's old "only the first file's `LoadReport` is kept, others warn" limitation
  (`cli.ts` comment near the `loadReports.length > 1` branch) disappears with no special-casing.
  `selfDiagnosis` merges via the existing N-way `mergeSelfDiagnosis` (already handles shard
  merging; reused verbatim for merging N *files*); `inconclusive`/`aborted` become "true if any
  contributing file's was."

### D119

<sub>cited inside a range only · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D119 — junit.xml.** One `<testsuite>`, one `<testcase>` per `ReportEntry`. Functional: today's
  `renderTestCase` unchanged. Workload: one `<testcase>` per declared `threshold` (today's
  `load-junit.ts` naming, `${test.name} — ${label} ${op} ${target}`), or one bare
  `<testcase name="${test.name}"/>` when it declared zero thresholds — so a threshold-less workload
  test still shows up in CI output instead of vanishing. `inconclusive` still marks every threshold
  `<skipped>`, unchanged from `load-junit.ts`'s R11 behavior, now keyed off `RunReport.inconclusive`.

### D120

<sub>cited inside a range only · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D120 — report.html.** `renderTest` dispatches on `entry.kind`. Workload path reuses
  `load-html.ts`'s existing `renderMetricsSection`/`renderThresholdsTable`/`renderEndpointsSection`
  (folded into `html.ts`, `load-html.ts` deleted) plus `load-charts.ts`'s chart functions verbatim
  (already pure, already per-block — no changes needed there). A `parallel` badge (D115) renders
  next to the name, same inline-badge pattern as the existing `flaky` badge, for any entry whose
  `concurrency === 'parallel'` (D116 threads this onto both `TestResult` and `WorkloadTestResult`
  at construction time in the interpreter, not derived later in the reporter).

### D121

<sub>cited inside a range only · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D121 — removed.** `load-html.ts`, `load-junit.ts`, `writeLoadReport`/`writeLoadJunitXml`/
  `writeLoadResultsJson` (reporter/index.ts), `cli.ts`'s separate `renderLoadSummary` console block
  and the "only first file" warning. `results.json` (already the redacted `RunReport` verbatim)
  now carries workload entries inline — no separate `load-results.json` file at all.

### D122

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_UNIFIED_TEST_WORKLOAD.md`</sub>

- **D122 — console summary.** `renderCliSummary` (reporter package) gains a workload-entry branch
  — name, ok/fail mark, then its threshold lines (`renderLoadSummary`'s old tick-mark format) —
  folded into the one function/one summary block, in file/declaration order alongside functional
  lines. The *live*, mid-run ticker (`renderLoadProgressLine`/`renderLoadMetricsLine` in `cli.ts`)
  is unchanged — those render *during* a still-in-flight run, before there's a finished report to
  unify; only the *final* summary and on-disk artifacts unify.

### D127

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md +1 more · lifted from `PLAN_DISCOVERY_EXCLUDE.md`</sub>

**`D127` — bare discovery gets an `exclude` list, and a path that matches nothing is a no-op.**
`tflw.config` gains a top-level `exclude "<path>"[, "<path>"…]` directive, relative to the config's
own directory, that bare discovery never descends into. It is a *default-scope* knob, not a deny:
an explicit file path on the command line always runs, even inside an excluded directory. An
`exclude` path that does not exist emits no diagnostic — the same tolerance a `.gitignore` line has
for a pattern matching nothing. Shipped at `M58`. The six clauses below are this decision's detail.

### D137

<sub>cited from SPEC.md · lifted from `PLAN_M97_CHECKER_CONTRACT.md`</sub>

**D137 — the checker's contract is two-way conformance with the runtime**

Not an absolute promise ("everything statically knowable"), which has no boundary and no
completion condition. Three clauses:

1. **Soundness.** If `tflw check` reports an error, `tflw run` would have failed on that rule.
   `A4-05` is the sole violation and the most severe row here: `loadAndValidate` returns
   `EXIT_USAGE` on any error-severity diagnostic, so a false positive does not merely mislint — it
   makes a valid suite **unrunnable, with no override**.
2. **Completeness where decidable.** If the runtime enforces a rule and it is decidable from the
   AST, the checker decides it first.
3. **The carve-out.** Rules needing I/O are excluded from the **`lang` package** — *not* from
   `tflw check`. See D144; this clause was corrected mid-grill.

### D147

<sub>cited from SPEC.md · lifted from `PLAN_M97_CHECKER_CONTRACT.md`</sub>

**D147 — `TF043` has two severities, and the split is D137 clause 1**

**What happened.** `0fea867` merged PRs #12–#18. The next testFlow-tests CI run went red: four of
four regression groups, 21 of 30 phases, one root cause.

### D165

<sub>cited from SPEC.md · lifted from `PLAN_M98_LEXER_POSITIONS.md`</sub>

**D165. Flag them as errors, not warnings.** For a general-purpose language a lint is the norm; for a
testing DSL it is not. A reviewed `.tflw` in a pull request can render as asserting one thing and
assert another, and the reviewer's only evidence *is* the rendered source text. `tflw check` is the
gate, exit 0 is the signal, and a warning does not change either. Rust, Go and the major C++
compilers all shipped this after CVE-2021-42574, and `PLAN_LAUNCH_REVIEW.md` §A.1 axis 5 puts the
tool's own security in scope; the `0.4.0` pentest arc will make `.tflw` a security artifact outright.

### D166

<sub>cited from SPEC.md · lifted from `PLAN_M98_LEXER_POSITIONS.md`</sub>

**D166. `TF049` is not implementable without an escape hatch, and the hatch is `\u{…}`.** This is the
dependency worth not re-deriving: after **D157** an unknown escape is an error, and tflw has no
`\u` escape today, so once `TF049` rejects a literal zero-width character there is **no way at all**
to write one in a `.tflw` string. A rule with no legal alternative is not a lint, it is a removed
capability.

### D168

<sub>cited from SPEC.md · lifted from `PLAN_M99_VALUE_TERMINATION.md`</sub>

**D168. `TF010`'s teaching moves to where the mistake is actually visible**

Backing off costs something, and the cost was measured rather than argued. What the enclosing
production says today when handed a token it cannot use:

| written | error today | error after back-off |
|---|---|---|
| `select {size} extra from field "Size"` | ``TF010: expected `from`, found `extra` `` | same — **sharper than `TF010`'s paren advice** |
| `give create widget({id} extra)` | ``TF010: expected `)` to close the call`` | same — **sharper** |
| `let a = {foo} order` | ``TF010: unexpected `order` at end of step`` / ``help: expected end of line`` | same — **worse than today's `TF010`** |

### D174

<sub>cited from SPEC.md · lifted from `PLAN_M101_MATCHES_FILE_INTERPOLATION.md`</sub>

**D174 — `matches file`'s path goes through `evalValue`, and SPEC changes rather than being corrected**

**Decision.** `matches file` interpolates `{var}` in its path, by the same `String(evalValue(…))`
call its three siblings make. SPEC §6.2.3's bullet asserting the opposite is rewritten, not
footnoted.

### D176

<sub>cited from SPEC.md · lifted from `PLAN_M102_INTERPOLATION_CONFORMANCE.md`</sub>

**D176 — a header name is a value**

Four sites, all reading `.value`, all on a `StringLit` the checker passes to `checkStringLit`:

| site | statement | what it did |
|---|---|---|
| `interpreter.ts` `applyHeaders` | `api … header "X-{t}" is "v"` | sent a header literally named `X-{t}` |
| `interpreter.ts` `HeaderStmt` | a `header` line in a `session` block | same |
| `interpreter.ts` `resolveSubject` | `expect header "X-{t}"` | looked up `x-{t}`, always `null` |
| `interpreter.ts` `resolveNetworkSubjectValue` | `… of request to "…"` | same, on the network log |

### D177

<sub>cited from SPEC.md · lifted from `PLAN_M102_INTERPOLATION_CONFORMANCE.md`</sub>

**D177 — a generator pattern is a value, and interpolating it is additive**

`FormatExpr.pattern`, `UniqueLikeExpr.pattern` and `RandomLikeExpr.pattern` — checked at
`checker.ts`, read with `.value` at `eval.ts`.

### D178

<sub>cited from SPEC.md · lifted from `PLAN_M103_CONFUSABLE_WORDS.md`</sub>

**D178 — the unit is one word, not one string**

The decision the whole rule stands on. A `.tflw` string is not an identifier; it is prose, and prose
is legitimately multilingual.

### D179

<sub>cited from SPEC.md · lifted from `PLAN_M103_CONFUSABLE_WORDS.md`</sub>

**D179 — only scripts that have Latin lookalikes**

A word is suspect when it contains **at least one Latin letter** *and* at least one letter from
Cyrillic, Greek, Cherokee or Armenian.

### D180

<sub>cited from SPEC.md · lifted from `PLAN_M103_CONFUSABLE_WORDS.md`</sub>

**D180 — strings only; comments are out of scope**

`TF049` fires in comments. `TF050` does not, and the reason is D166's own principle: **a rule with
no way to comply is a capability removed, not a lint.**

### D183

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M104_CONFIG_RELATIVE_PATHS.md`</sub>

**D183 — the mTLS half is a separate row, not a silent ride-along**

`loadMtlsCreds(config, baseDir)` was found while threading `configDir` through `execApi`. It is the
same defect but not the same finding, so it is filed as `M104-01` rather than folded into
`M97c-03`'s scope note:

- **Wider blast radius.** It affects every request on an mTLS env, not only sessions.
- **Not a race.** It is deterministically wrong for any test file not beside `tflw.config` — which
  is the ordinary layout (`tests/*.tflw`).
- **SPEC documents the broken form.** §3.6's own example is `cert "./certs/client.pem"`.

### D198

<sub>cited from SPEC.md · lifted from `PLAN_M118_FIRST_RUN.md`</sub>

**D198 — the quickstart gets a real target: tflw ships a demo service**

`tflw init` scaffolds a config pointing at tflw's own bundled demo HTTP service, so `init` → `run` is
genuinely green with no network, no third party, and no second terminal. One line in `tflw.config`
swaps it for the user's own API — which is the actual first step of adoption, and is now a *diff*
rather than a blank.

### D199

<sub>cited inside a range only · lifted from `PLAN_M118_FIRST_RUN.md`</sub>

**D199 — spelled `api "tflw://demo"`**

A real URL with a reserved scheme, so **the config grammar does not change**: `api` still takes a
string (`parser.ts:1737`), `new URL("tflw://demo").hostname` still answers (`demo`), and the
`allow hosts` checker at `checker.ts:315` keeps working. A bare `api demo` keyword would have meant
lexer, parser, checker, LSP, completion and docs changes for a scaffold default.

### D200

<sub>cited inside a range only · lifted from `PLAN_M118_FIRST_RUN.md`</sub>

**D200 — the demo runs as a child process, not in-process**

Forced by `--workers N` (D111/D113): it forks N generator **processes**, and an in-process server
lives in none of them. A child process is also the only version where a load run measures the
service instead of measuring the generator and the service contending for one event loop.

### D201

<sub>cited inside a range only · lifted from `PLAN_M118_FIRST_RUN.md`</sub>

**D201 — one endpoint, `GET /health`**

The demo answers `200 {"status":"ok"}` at `/health` and `404` everywhere else. It is deliberately not
a teaching API: the moment a user wants capture-chaining they should be pointed at their own service,
because a second fake endpoint would start to imply tflw ships a mock server, which is a different
product and a real maintenance surface.

### D202

<sub>cited inside a range only · lifted from `PLAN_M118_FIRST_RUN.md`</sub>

**D202 — a demo run says so, everywhere a run says anything**

The CLI summary and the report header both carry it, following `insecure true`'s precedent (P#78): a run with an unusual footing is never silently normal-looking. A green `PASS 1/1`
screenshot must not be mistakable for evidence about a real service — the demo's whole job is to be
obviously itself.

### D203

<sub>cited from SPEC.md · lifted from `PLAN_M118_FIRST_RUN.md`</sub>

**D203 — only `run` starts it; `check` never does**

`tflw check` does no I/O by contract (P#75), and that contract is the reason it can run in CI without
secrets or a live API. Starting a server for it would break the one property it sells. `tflw watch`
gets it for free — it calls `runCommand` (`cli.ts:651`).

### D204

<sub>cited from SPEC.md · lifted from `PLAN_M118_FIRST_RUN.md`</sub>

**D204 — `install-browsers` brackets Playwright rather than replacing it**

Playwright's progress output stays (it is the download bar people expect on a 150 MB fetch), but tflw
opens and closes. Success gets a confirmation naming the engine and the next command; failure gets a
tflw-voice summary — what failed, and the three things that actually cause it (a proxy, an offline
mirror, disk space).

### D206

<sub>cited from SPEC.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M121_OPEN_MODEL_FETCH.md · lifted from `PLAN_M121_OPEN_MODEL_CLIENT.md`</sub>

**D206 — the open model sends over `node:http`, not `fetch`**

`httpPinned.ts` already exists and already is the answer. It was built in `M45` (D75) for exactly
this genus of problem — its header records that it "never imports `undici`" because of the `M35b`
root-cause finding, and that `node:http`'s own `Agent` "was never implicated". `M118-02` is the
same lesson arriving a second time, at a path `M45` explicitly declined to cover.

### D207

<sub>cited from tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M121_OPEN_MODEL_FETCH.md · lifted from `PLAN_M121_OPEN_MODEL_CLIENT.md`</sub>

**D207 — a shared agent pair per open scenario, not per arrival, and explicitly not "pinning"**

`M45`'s comment (`interpreter.ts:916-920`) is right that pinning has no meaning here: an open
arrival is not a VU and has no loop to pin a connection to. But that argument rules out
*per-VU pinning*, not *pooling*. What the open model needs is one `keepAlive` agent pair for the
whole scenario, shared by every arrival, created before the arrival loop and destroyed in its
`finally`.

### D211

<sub>cited from tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M121_OPEN_MODEL_FETCH.md · lifted from `PLAN_M121_OPEN_MODEL_CLIENT.md`</sub>

**D211 — record it internally, and report it nowhere**

**Reversed 2026-08-10, by the user, and this is the standing form.** The original decision was to
file the finding against `nodejs/undici` with the §1.3 table. It will not be filed — not there, not
`nodejs/node`, not anywhere outside tflw and testFlow-tests. Nothing external gets touched on the
strength of this work.

### D245

<sub>cited from SPEC.md · lifted from `PLAN_M125_FIRST_USE.md`</sub>

**D245 — an absolute URL is legal in `api` and `open`, and `allow hosts` governs it**

`api GET https://x/y` and `open "https://x/y"` both resolve to that URL. The base URL becomes a
convenience; the allowlist becomes the boundary, which is what M85 built it to be.

### D246

<sub>cited from SPEC.md · lifted from `PLAN_M125_FIRST_USE.md`</sub>

**D246 — no allowlist plus an absolute URL: the runtime refuses, the checker warns**

Writing an absolute URL opts the suite into declaring where it may reach. With no `allow hosts`
configured the runtime refuses the step; the checker warns.

### D266

<sub>cited from SPEC.md · lifted from `PLAN_M125_FIRST_USE.md`</sub>

**D266 — `FU-21`: one query, and the caller's count is kept only to name the race**

D253's "query once" lands as a single in-page `evaluateAll` that returns text *and* discriminator
per element — strictly cheaper than what it replaced (a `.count()`, an `.all()`, and N
`innerText()` round-trips) and, more to the point, self-consistent: the reported count, the shown
list and the `… and N more` arithmetic are all read off one array, so "matched 2 … 1 shown … and 1
more" is unconstructible rather than merely unobserved.

### D277

<sub>cited from SPEC.md · lifted from `PLAN_M125_FIRST_USE.md`</sub>

**D277 — the manifest is held to `parser.ts`, not to SPEC prose**

D251 says `spec-data.ts` "is held against `SPEC.md` by the spec-sync check", and takes that as the
reason a copy inside `lsp-server` would be worse. True but weaker than what is available here.
`MATCHERS`/`GENERATORS` have no other authority to answer to — there is no runtime list of matchers
to compare against. Step keywords do: `parser.ts` exports `STATEMENT_KEYWORDS`, and it is the list
the parser actually dispatches on.

### D283

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D283 — Tier 1 is a scan-and-assert over a rule pack, not a set of discrete subjects**

One new subject/matcher pair — `response has no [<severity>] security violations` — evaluated
against a **built-in rule pack**, producing `Finding[]` through `finding.ts` and filtered by the
existing `filterBySeverity` floor.

### D284

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/VULNS.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D284 — a rule declares a precondition; "not applicable" is a third state**

Every rule carries an applicability predicate. A rule whose precondition is unmet is **not
applicable** — never a violation, and never a silent pass. The result carries all three counts.

### D285

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md +1 more · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D285 — zero applicable rules is a failure, not a pass**

If no rule in the pack applied, `expect response has no security violations` fails with a dedicated
diagnostic: *the assertion had no power to fail.*

### D286

<sub>cited from SPEC.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D286 — asserted explicitly per step; the hook is a documented idiom, not a mechanism**

The assertion is an ordinary `expect`/`check` after an api step, like every other assertion in the
language. Whole-file coverage is taught in the docs as an `after each` hook — **existing machinery,
no new config surface**.

### D287

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D287 — cookie rules see this response's `Set-Cookie`, plus session establishment**

Rules run over the `Set-Cookie` headers of the observed response, **and** the `session` block's own
login response is scanned once when the session is established, with findings attributed to the
session by name.

### D288

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D288 — TLS facts come from an out-of-band stdlib `tls.connect()` probe**

Node's `tls` module, no new dependency, P#43 intact: connect to the same `host:port`, read
`getProtocol()` and `getCipher()`, close. Cached **once per `host:port` per run** — a rule that
fires per response must not open a handshake per response.

### D289

<sub>cited from CHANGELOG.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D289 — the v1 pack is ten rules: six browser-shaped, four API-shaped**

The §3 sketch listed six browser-oriented header rules. Against apiV2 — a JSON API — `csp-missing`
and `x-frame-options` are never applicable, so the sketched pack would run three or four live rules
against the actual dogfood target. Four API-shaped rules are added so the pack is meaningful where
this tool is actually pointed:

| rule | severity | class |
| --- | --- | --- |
| `sec/cookie-not-httponly` | critical | browser |
| `sec/cookie-not-secure` | critical | browser |
| `sec/cors-wildcard-with-credentials` | critical | **api** |
| `sec/hsts-missing` | serious | browser |
| `sec/csp-missing` | serious | browser |
| `sec/x-frame-options` | moderate | browser |
| `sec/cookie-samesite-none` | moderate | browser |
| `sec/nosniff-missing` | moderate | **api** |
| `sec/authenticated-response-cacheable` | moderate | **api** |
| `sec/server-version-disclosure` | minor | **api** |

### D290

<sub>cited from CHANGELOG.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D290 — `response has no [<severity>] security violations`**

`response` becomes a subject, parallel to §9.8's `page`. `violations` matches the existing noun so
one word covers both scan kinds.

### D291

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md +1 more · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D291 — D21's declaration half lands now, and Tier 1 requires it**

In scope for `M128b`:

```
authorized target "https://localhost:8443" reason "self-hosted test fixture"
```

### D292

<sub>cited inside a range only · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D292 — output is the run report; no SARIF and no `ScanReport` in this milestone**

A Tier 1 finding is an **assertion failure**. It surfaces in the console and the existing HTML run
report, listing rule id / severity / description / detail, the way §9.8's a11y failures already do.
`PLAN_REPORTS_PERF_SECURITY.md`'s independent `ScanReport` type, `scan-report.html`, R7's
remediation KB and R8's SARIF mapping all land with `tflw scan` — the mode that actually produces a
standalone scan artifact, at Tier 3/4.

### D293

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D293 — target: reuse `M22`'s 8443 sidecar, add `env secureLocal` and a hygiene-only `vuln/` slice**

D2 and D27 both established *the dogfood target lands first, as its own testFlow-tests milestone*.
That applies here, but §0(a) makes it cheap — the listener exists. `M128a` is therefore:

1. **`env secureLocal`** in `testFlow-tests/tflw.config` → `https://localhost:8443/v1`,
   `insecure true` (self-signed, SPEC §3.5), `allow hosts "localhost"`. Its own dedicated env, the
   same blast-radius convention `mtlsSidecar`, `allowHostsBlocked` and `safetyRedaction` already
   follow.
2. **A hygiene-only `vuln/` slice**, env-gated behind `VULN_MODE=1`, off in every other run —
   supplying only the five positives the clean app cannot produce (§0's table):

   ```
   GET  /vuln/cors-wildcard      Access-Control-Allow-Origin: *  +  Allow-Credentials: true
   POST /vuln/weak-cookie        Set-Cookie: sid=…   (no HttpOnly, SameSite=None)
   GET  /vuln/document           text/html, no CSP, no X-Frame-Options
   ```

   Mostly an nginx `location` block plus two small NestJS routes — **no application-logic
   vulnerabilities**, which is what makes the full `vuln/` module expensive at Tier 2/3.
3. **`VULNS.md`**, one row per planted flaw, from day one. This is the known-answer ledger the
   acceptance bar reads; a planted flaw with no ledger row is how a target drifts out of sync with
   the acceptance that depends on it.

### D294

<sub>cited inside a range only · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D294 — three milestones**

| | scope |
| --- | --- |
| **`M128a`** | testFlow-tests: `env secureLocal`, the hygiene `vuln/` slice + `VULNS.md`, the `secure`-cookie fix. Target lands first, with nothing yet consuming it (D2/D27). |
| **`M128b`** | tflw: `response has no [<sev>] security violations` end-to-end — lexer/parser/AST, the applicability model, the eight non-TLS rules, `authorized target … reason …` + wildcard rejection, and D24b's full bar (checker + docs-site + reporter). |
| **`M128c`** | tflw: the `tls.connect()` probe and its rules (`sec/tls-version-old`, `sec/tls-weak-cipher`), plus the acceptance pass over the whole pack. |

### D295

<sub>cited from tflw-tests/VULNS.md, tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D295 — acceptance: a positive, a negative, and a not-applicable case for every rule**

Each rule in the pack must be demonstrated three ways against the real target:

- **fires** against a response that genuinely violates it (clean apiV2 for five of ten; the `vuln/`
  slice for the rest);
- **stays silent** against a response that does not;
- **reports not-applicable** where its precondition is unmet, for every rule that has one.

### D296

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D296 — the severity floor narrows the pack *before* applicability, not the findings after**

Decided during `M128b`, because D283/D284 left it open and `runSecurityScan` had to do one or the
other. `expect response has no critical security violations` considers the three critical rules —
not all ten, filtered down afterwards.

### D297

<sub>cited from SPEC.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D297 — the TLS rules are response-scoped; the session channel stays cookie-shaped**

*Decided during `M128c`.* D287 carries a session's login-response findings forward into every
assertion in a test that uses it. The two TLS rules are deliberately **excluded** from that channel:
`scanSessionObservations` leaves `o.tls` absent, so they report not-applicable for every session
observation.

### D298

<sub>cited from CHANGELOG.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D298 — the probe offers a TLS 1.0 floor, and does not widen ciphers**

*Decided during `M128c`, from measurement rather than argument.* `tls.DEFAULT_MIN_VERSION` is
`TLSv1.2`. With Node's default client parameters, a host speaking nothing but TLS 1.0 simply refuses
the handshake — so the probe reports `ok: false`, and `sec/tls-version-old` reports **not
applicable** in precisely the case it exists for. The rule would be structurally unfireable. The
probe therefore sets `minVersion: 'TLSv1'`.

### D299

<sub>cited from CHANGELOG.md, tflw-tests/VULNS.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D299 — both TLS rules answer "what does this host give a current client?", not "what does it offer?"**

*Decided during `M128c`.* The probe speaks with this run's own client parameters. Two consequences,
both of which the rules state in their own failure text rather than leaving to the docs:

1. **Not the asserted request.** D288 already said this; it is repeated in the message because a
   reader who does not know it will read a finding as being about the request they wrote.
2. **Not the server's whole offer.** A host supporting RC4 *alongside* AES-GCM negotiates AES-GCM
   with a current client and is correctly silent — that is what its callers actually get.

### D300

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D300 — a rule blocked by a failed instrument is announced; one blocked by its precondition is not**

*Decided during `M128c`, from a test that failed.* The `because` reason for a failed probe was
reaching only D285's not-applicable listing — which prints when *nothing* applied. On an ordinary
pass or failure, a probe that could not connect was completely invisible: `expect response has no
security violations` printed a clean green line whose TLS rules had never run.

### D302

<sub>cited from CHANGELOG.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**D302 — no handshake when the floor has already discarded both TLS rules**

*Decided during `M128c`.* D296 narrows the pack **before** applicability, so
`expect response has no critical security violations` never consults a TLS rule. The probe was
nonetheless opening its second connection and throwing the answer away.

### D303

<sub>cited from CHANGELOG.md · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**D303 — the input is an observed request, not a static cross-product**

Tier 2 judges **the request the step just made**, re-issued under other principals. It does not
enumerate the suite's endpoints and it does not build a table.

### D304

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**D304 — the surface is a per-step assertion: `response has no [<severity>] authorization violations`**

A second matcher on the existing `response` subject, in the exact shape D290 chose for Tier 1.

### D305

<sub>cited from CHANGELOG.md, tflw-tests/VULNS.md · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**D305 — the oracle is differential on resource identity**

A violation is: **a resource id from the owner's response appears in a probe's response.**

### D306

<sub>cited from SPEC.md · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**D306 — `anonymous` is a built-in principal, always probed**

The no-credentials probe needs no declaration and is in every probe set.

### D307

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md +1 more · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**D307 — `privileged` marks a session exempt from probing**

```
session admin privileged
  api POST /auth/login body { email: env(ADMIN_EMAIL), password: env(ADMIN_PW) }
  …
```

One word, declared once, beside the credential it describes. `SessionDecl` grows one boolean;
the grammar is `session <name> [oauth2] [privileged]`.

### D308

<sub>cited from SPEC.md · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**D308 — a step that names its own credential is a checker error (`TF062`)**

```
test "…" as shopper
  api GET /orders/{orderId}
    header "Authorization" is "Bearer {userAToken}"
  expect response has no authorization violations
  ^ error[TF062]: this step names its own credential, so the probe cannot substitute another
                  principal's
    ‖ move the identity into a `session` block and opt in with `as`
```

§0(b) is the reason: the probe would send the owner's own token and report its own `200` as a leak.
The header literal is right there in the AST, so this is decidable at check time — and refusing is
strictly better than answering wrongly, which is the same argument D291 made for an undeclared host.

### D309

<sub>cited inside a range only · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**D309 — the assertion requires an owner, so its test must declare one (`TF063`)**

`expect response has no authorization violations` in a test with no `as <session>` is a checker
error. There is no owner to be non-owning *of*.

### D310

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**D310 — the probes fire inline, at the assertion**

Where the assertion sits, against the resource the owning request just touched, inside the same
test's lifetime.

### D311

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/VULNS.md · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**D311 — safe methods by default; `probe mutating` opts in, per authorized target**

```
authorized target "http://localhost:4001" reason "self-hosted test fixture"
  probe mutating
```

`GET`/`HEAD`/`OPTIONS` are probed by default. `POST`/`PUT`/`PATCH`/`DELETE` are probed only under
this opt-in, and unprobed mutating endpoints are **named in the counts**, never silently skipped.

### D312

<sub>cited inside a range only · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**D312 — probe principals establish lazily, and a failed establishment is announced**

A session no test opts into has never been established. The first probe that needs one establishes
it, cached from then on like any other (SPEC §3.3: once per run per worker).

### D313

<sub>cited inside a range only · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**D313 — a probe served *different* content is clean, and counted**

A probe that returns `200` carrying none of the owner's resource ids — a correctly-filtered
collection, or a shared public resource — is **not** a finding. The invariant held.

### D314

<sub>cited from CHANGELOG.md · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**D314 — every finding emits a runnable `.tflw` repro**

```
report/authz-repro-orders-id-peer.tflw

# emitted by tflw M130 — sec/authz-object-leak
# GET /orders/{id} served `shopper`'s order to `peer`
test "peer must not read shopper's order" as peer
  api GET /orders/a1e3…
  expect status equals 403
```

D22's *"every finding emits a runnable `.tflw` repro — a finding is a failing test you re-run, never
a mystery flag"*, landing in the tier where it is cheapest rather than the tier where it is hardest.
A BOLA repro is one test with `as <principal>` and an expected `403`; a fuzzer's repro is a mutated
body and an invariant, which is why D292 deferred the artifact machinery to Tier 3 without deferring
this.

### D315

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/VULNS.md · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**D315 — applicability, and what "not applicable" means here**

Both rules are **not applicable** when the owning response is not `2xx`. There is nothing to leak
about a response the owner did not receive.

### D316

<sub>cited inside a range only · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**D316 — the counts name the principals, and the blind spot is one of the counts**

The pass line carries the three rule counts D292 established **plus** the principal counts, and the
report names what it could not judge:

```
2 rules — 2 applicable, 0 not applicable, 0 violations
3 principals probed — 2 refused, 1 served filtered content · 1 privileged (admin) · 1 anonymous
```

### D317

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**D317 — the target: one peer session, three planted routes, and the control stays**

**`M130a`, testFlow-tests, no tflw changes** (D2/D27: the dogfood target lands first, with nothing
yet consuming it):

1. **`session peer`** — `USER_B_EMAIL`/`USER_B_PW`, already in `.env` and already in `require env`,
   declared nowhere. Cookie transport, mirroring `shopper`. Plain existing grammar, so it is safe
   to land alone.
2. **Three `vuln/` routes**, behind the existing `VULN_MODE=1` flag, matching the two leak shapes
   and the mutating opt-in:

   ```
   GET    /v1/vuln/orders/:id   → any order, no ownership check   (byte-identical to the owner's)
   GET    /v1/vuln/orders       → every user's orders, unfiltered (contains the owner's ids)
   DELETE /v1/vuln/orders/:id   → deletes any order               (D311's opt-in has something to do)
   ```

3. **`VULNS.md` rows `V6`/`V7`/`V8`**, and `scripts/verify-security-target.mjs` extended to assert
   them against the running stack, both halves of the no-route-without-a-row rule preserved.
4. **`authz.tflw` is kept unchanged, as the control.** The generated matrix and the hand-written one
   must agree; a disagreement means one of them is wrong, and *that* is the finding. Two instruments
   that fail differently, which is the argument `M128c` already made for the corpus plus the grader.
   It also keeps a live example of the inline-identity idiom D308 deliberately cannot reach.

### D318

<sub>cited from CONTRIBUTING.md, SPEC.md · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**D318 — three milestones, and the config lines land on the far side of the tflw merge**

| | scope |
| --- | --- |
| **`M130a`** | testFlow-tests: `session peer`, the three `vuln/` routes, `VULNS.md` `V6`–`V8`, the target verifier. **Existing grammar only** — safe to merge alone. |
| **`M130b`** | tflw: the `authorization violations` matcher end-to-end — lexer/parser/AST, `authzRules.ts`, the probe engine, `privileged`, `probe mutating`, `TF062`/`TF063`, `TF060`'s extension, the repro emitter, and D24b's full bar (checker + docs-site + reporter). |
| **`M130c`** | testFlow-tests: `session admin privileged` + `probe mutating` in config, `tflw-acceptance/security/`'s authz corpus, `authz-generated.tflw`, and the D319 acceptance measurement. |

### D319

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**D319 — acceptance: precision, recall, and agreement with the hand-written control**

Three instruments, failing differently:

1. **`tflw-acceptance/security/` grows an authz corpus** — each rule demonstrated **firing** (against
   the plant), **staying silent** (against clean apiV2), and **reporting not applicable** (a `4xx`
   owning response, which also demonstrates D285 through the applicability path). Plus the two
   halves of D311: the default declines the mutating endpoint and *says so*; the opt-in probes it
   and finds the leak.
2. **`scripts/verify-security-acceptance.mjs` grows the authz rules**, comparing the exact set of
   rule ids per response against its ledger copy, printing every gap on every run rather than
   rounding it away — the `M128c` format, unchanged.
3. **`authz-generated.tflw` must agree with `authz.tflw`.** The same four claims, one hand-written
   with inline identities and one produced by the matrix. Agreement is the invariant; disagreement
   is a finding about the generator.

### D320

<sub>cited inside a range only · lifted from `PLAN_M130B_AUTHZ_ENGINE.md`</sub>

**D320 — a rule evaluates one bundle, and its applicability is gated on the owner's body shape**

`authzRules.ts` mirrors `securityRules.ts`'s relationship to `finding.ts` exactly — *this is the only
file that knows what an authorization rule is*, it imports nothing but `finding.ts`, and it performs
no I/O. What changes is the input: Tier 1's `Observation` was one flattened response, and this one is
a bundle.

### D321

<sub>cited from CHANGELOG.md · lifted from `PLAN_M130B_AUTHZ_ENGINE.md`</sub>

**D321 — resource-id extraction reaches the bare shapes only, and says so out loud**

From the owner's response body:

- an **object** → its root `id`, if present;
- an **array** → each element's root `id`;
- **nothing else**. Nothing nested, no key aliases, no envelope unwrapping.

### D322

<sub>cited from CHANGELOG.md · lifted from `PLAN_M130B_AUTHZ_ENGINE.md`</sub>

**D322 — containment is a scalar-leaf walk with exact equality, at any depth**

D305 says an owner id counts if it *"appears anywhere"* in a probe's response, and the asymmetry with
D321's narrow extraction is deliberate: a leak returned under a different key, or wrapped in an
envelope the owner's own response did not use, is still a leak.

### D323

<sub>cited from CHANGELOG.md · lifted from `PLAN_M130B_AUTHZ_ENGINE.md`</sub>

**D323 — `authzProbe.ts` is the only file that sends a probe, and it rebuilds rather than re-runs**

New module, the seam `tlsProbe.ts` established: one file opens the socket, it takes an injected
sender so every branch is unit-testable without a network, and `interpreter.ts` does not grow a
fifth request path.

### D324

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/VULNS.md · lifted from `PLAN_M130B_AUTHZ_ENGINE.md`</sub>

**D324 — five probe outcomes, and `clean` has to be earned**

| outcome | when | counts as |
| --- | --- | --- |
| `leaked` | an owner id came back | **violation** |
| `refused` | `401`/`403`/`404`, carrying no owner id | boundary confirmed |
| `served different content` | `2xx`, carrying no owner id | boundary confirmed |
| `inconclusive` | the CSRF case (D325), `429`, any `5xx`, a non-JSON body | **not clean** |
| `not probed` | mutating method with no `probe mutating`, failed session establishment, transport failure | **not clean** |

### D325

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/VULNS.md · lifted from `PLAN_M130B_AUTHZ_ENGINE.md`</sub>

**D325 — a cookie-borne principal refused on a mutating method is `inconclusive` (`M130-01`)**

`M130a` found this in the target and it is a constraint on the engine, not a target bug: apiV2's
`AnyAuthGuard` requires an `X-CSRF-Token` matching the session token's own claim on every mutating
request made with a cookie, and a `session` block does not expose that token to the test. So a
cookie-transport principal is refused **before** authorization is consulted, and a differential
oracle scores that refusal clean.

### D326

<sub>cited from SPEC.md · lifted from `PLAN_M130B_AUTHZ_ENGINE.md`</sub>

**D326 — probes are sequential, in a fixed order**

Declared-session order from `tflw.config`, then `anonymous` last.

### D327

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M130B_AUTHZ_ENGINE.md`</sub>

**D327 — every session a test names is an owner**

`test "…" as admin, shopper` is legal, and live in the dogfood suite twice
(`tests/examples/sessions-explained.tflw:31`, `tests/api/identity/interleaved-sessions.tflw:53` —
the latter titled *"admin (bearer) and shopper (cookie) alternate within one test"*). The observed
request then carries admin's `Authorization` **and** shopper's `Cookie` simultaneously.

### D328

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M130B_AUTHZ_ENGINE.md`</sub>

**D328 — `TF062` is a lexical refusal plus an exact runtime guard**

D308 wants a step that names its own credential refused before the run. The AST shows that plainly —
for a step in the same body. It does **not** show it for a step inside an `action`/`use` body, because
calls in this language bind late against the entry file's registry, and `checker.ts` already draws
that boundary deliberately (*"a frame whose registry is knowable: a `test` or hook body, never an
`action` body"*, `checker.ts:885`).

### D329

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M130B_AUTHZ_ENGINE.md`</sub>

**D329 — `TF063` uses the same split, and `before file` hooks are refused**

- **check time** — `TF063` fires on a `test` that declares no `as <session>`, and on a
  `before file`/`after file` hook, which runs in its own scope isolated from every test
  (`ast.ts:57`) and can therefore never have an owner.
- **`before each`/`after each` are fine** — they share the wrapped test's scope, so the test's `as`
  is the hook's owner.
- **inside an `action`/`use` body the checker stays silent**, and the runtime fails the assertion with
  `TF063`'s wording if the executing test declared no owner.

### D330

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M130B_AUTHZ_ENGINE.md`</sub>

**D330 — `probe mutating` is an optional indented sub-clause**

```
authorized target "http://localhost:4001" reason "self-hosted test fixture"
  probe mutating

authorized target "https://staging.example.com" reason "contracted pentest window, ticket SEC-441"
  # no `probe mutating` — safe methods only against staging
```

The config dialect already nests this way for `session`, `defaults` and `env`, so this is an existing
shape applied to one more node rather than a new one. It reads as a property of *that host*, which is
D311's whole argument for attaching it there, and Tier 3's further per-class opt-ins land as sibling
lines instead of needing a second grammar.

### D331

<sub>cited from CHANGELOG.md · lifted from `PLAN_M130B_AUTHZ_ENGINE.md`</sub>

**D331 — the blind spot is two numbers, and one of them is a checker census**

D316 asks the run to count `api` steps it could not attribute to a principal, and names the
`TF062`/`TF063` sites. Those are **errors**, so no run containing one ever executes; the count as
specified would always be zero. The intent survives the correction in two parts — a suite
identity census the checker computes and the run summary prints once, and the run's own
declines aggregated beside it.

### D332

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M130B_AUTHZ_ENGINE.md`</sub>

**D332 — repro templates are per-rule, and mirror the hand-written control**

D314's sketch asserts `expect status equals 403`. That is right for an object leak and **wrong for a
collection leak**, where the correct behaviour is a filtered `200` — so a single template emits a
regression test that goes red once the bug is fixed, handing whoever fixes it an artifact that fails
after they succeed.

### D333

<sub>cited from SPEC.md · lifted from `PLAN_M130B_AUTHZ_ENGINE.md`</sub>

**D333 — `anonymous` is a reserved principal name**

`session anonymous` is a checker error (`TF063`'s sibling case, reusing `TF020`'s unknown-key
machinery is not appropriate — this is a name collision, and it gets `TF062`'s severity and its own
sentence). D306 makes `anonymous` a built-in principal in every probe set; a declared session by that
name would either shadow it or be shadowed by it, and both are silent.

### D338

<sub>cited from SPEC.md · lifted from `PLAN_M131_SAFETY_COMPLETION.md`</sub>

**D338 — address classification is literal; `getaddrinfo` is never called**

A target's address class is judged from the URL's host **as written**. No DNS resolution, ever,
in either the checker or the runtime.

### D340

<sub>cited from SPEC.md · lifted from `PLAN_M131_SAFETY_COMPLETION.md`</sub>

**D340 — the flag is origin-valued, must match a declaration, and repeats**

```
tflw run --allow-public-target https://staging.example.com
```

- **Origin-valued, not boolean.** A bare boolean affirms a *category*, so it survives any later
  change of target: CI's existing flag would silently authorize whatever new host someone edits into
  the config, leaving config with sole say over *which* public host gets scanned — most of what
  §3.2(3) was trying to take away from it. Naming the origin makes the two halves have to agree.
  This is `TF061`'s argument, reused: nobody can affirm the scope of a target they have not named.
- **Must match an `authorized target` this run would use**, compared by origin (scheme + host + port),
  the same comparison `TF060` already performs. A flag naming an origin the run does not scan is an
  error, not a no-op — see D344's `TF066`.
- **Repeatable.** D343 widens the gate to service origins, so a run can legitimately scan more than
  one public origin. Each occurrence names exactly one origin; there is no comma-separated form and
  no wildcard, for `TF061`'s reason.
- **No `--reason` on the CLI.** D291 already puts the reason in config, where it travels with the
  report artifact. A second reason on the command line either duplicates it or contradicts it, and
  a contradiction has no defined winner.

### D341

<sub>cited from SPEC.md · lifted from `PLAN_M131_SAFETY_COMPLETION.md`</sub>

**D341 — the flag follows the packet, not the matcher**

`--allow-public-target` gates only scans that **originate** traffic. Today that is
`authorization violations`. Tier 3's fuzzer and Tier 4's crawler will inherit it.

### D342

<sub>cited from SPEC.md · lifted from `PLAN_M131_SAFETY_COMPLETION.md`</sub>

**D342 — two doors: the checker refuses what it can prove, the runtime refuses what is true**

Exactly the `TF062`/`TF063` pattern `M130b2` established, and for the reason `checker.ts:885` already
records — calls bind late, so a static pass and a runtime guard answer the same question at
different resolutions.

### D343

<sub>cited from SPEC.md · lifted from `PLAN_M131_SAFETY_COMPLETION.md`</sub>

**D343 — `TF060` widens from "the default `api` base" to every scannable origin**

Today `checkAuthorizedTargets` looks only at the env's default `api` base. A step naming a service
(`api @billing GET /invoices`) reaches a different origin, and a scan there is **completely
ungated** — no `authorized target` required, and under a naive reading of D340 no flag either.

### D344

<sub>cited from SPEC.md · lifted from `PLAN_M131_SAFETY_COMPLETION.md`</sub>

**D344 — two new codes, one repair each; the runtime twin reuses the checker's code**

Following `M130b2`'s rule that **a diagnostic code is a repair, not a topic**:

| code | fires when | the repair |
| --- | --- | --- |
| `TF065` | an originating scan would reach a public origin and no `--allow-public-target` names it | add the flag |
| `TF066` | `--allow-public-target` names an origin this run does not scan, or one no `authorized target` declares | fix the flag's value |

### D356

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M132_TIER2_DEBT.md`</sub>

**D356 — `M130-05`: plant a vulnerable idempotent `PUT`. One polarity.**

Verified: `apiV2/src/vuln/vuln-orders.controller.ts` carries `@Get()` (`:67`), `@Get(':id')`
(`:91`) and `@Delete(':id')` (`:120`) — **no `PUT`, no `PATCH`** — while nine sibling controllers
have one.

### D363

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M132_TIER2_DEBT.md`</sub>

**D363 — Added during the `M132b` build, 2026-08-14: the corpus needed a bearer non-owner before D356's plant could be judged at all.**

**D356 was buildable but not sufficient as scoped, and the run is what said so.** The plan measured
that a `PUT` would "leak normally" and stopped there. It did not check whether the acceptance
corpus contained *anybody able to make a mutating probe*, and it did not.

### D364

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D364 — Tier 3 is an assertion inside `tflw run`. D1's "three execution modes" is corrected to one.**

**This is the load-bearing decision and it corrects the arc's trunk.**

### D365

<sub>cited from SPEC.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D365 — `tflw scan` is deferred, not cancelled, and D299's orphan is its first named tenant**

D364 removes the mode; it does not remove the *need* the mode was invented for. D299 says
enumerating a server's whole cipher offer takes **one handshake per suite** and is *"a scanner's job,
not an assertion that runs after a response."* That reasoning is still correct, and D364 has just
orphaned it.

### D366

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D366 — the matcher is `has no input-handling violations`**

```
expect response has no input-handling violations
expect response has no serious input-handling violations
```

Spec id `has-no-input-handling-violations`, the third scan subject alongside
`has-no-security-violations` (Tier 1) and `has-no-authorization-violations` (Tier 2). Severity floors
compose exactly as the other two do — `FindingSeverity` is unchanged (`minor` | `moderate` |
`serious` | `critical`), and the floor is a floor, not an exact match.

### D367

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D367 — rule ids stay in the `sec/` namespace**

Measured: every rule this arc has shipped is `sec/*`, *including* Tier 2's — `sec/authz-object-leak`,
`sec/authz-collection-leak` sit in the same namespace as `sec/csp-missing`. The matcher separates the
tiers; the namespace does not. Tier 3 follows: `sec/error-detail-disclosure`,
`sec/reflected-input-unescaped`, `sec/path-traversal-read`, `sec/oversized-input-accepted`.

### D368

<sub>cited from SPEC.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D368 — the corpus is fixed and enumerable; "fuzzing" is the wrong word for what ships**

Tier 3's default engine applies **every payload in a curated corpus to every mutable input**, in a
defined order, with no sampling and no RNG. The same suite against the same target produces
byte-identical findings.

### D369

<sub>cited from CHANGELOG.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D369 — a seeded extension exists, is opt-in, and never gates**

`packages/runtime/src/seed.ts` already ships `mulberry32`/`subSeed`/`resolveRunSeed`, so generated
payloads are cheap to add and genuinely find things nobody wrote a payload for. It is available as an
opt-in layer on top of the corpus.

### D370

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D370 — the surface is the observed request only. No OpenAPI seed.**

D22 says the surface is *"OpenAPI seed **+** captured-traffic seed."* The OpenAPI half is dropped
here and left to Tier 4's crawler.

### D371

<sub>cited from CHANGELOG.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D371 — the mutable inputs are path params, query params and body leaf scalars. Headers are deferred.**

| input | mutated | why |
|---|---|---|
| path parameters | ✅ | traversal and type confusion live here; a `:id` is the classic site |
| query parameters | ✅ | the least-validated surface on most stacks |
| JSON body **leaf scalars** | ✅ | where injection strings and oversized values land |
| request headers | ❌ **deferred** | mutating `Content-Type` breaks the request rather than testing the app, and most header mutation is answered by the reverse proxy, not the code under test |
| the body's **shape** (adding/removing keys) | ❌ **deferred** | that is mass-assignment, a different weakness with a different oracle |

### D372

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D372 — the four classes, and their per-class safety opt-in as sibling lines**

D311 already designed this and said so: *"Tier 3's further per-class opt-ins land as sibling lines
instead of needing a second grammar."* D21 layer 4 is therefore **discharged and stays discharged** —
`probe mutating` is layer 4's first tenant (D337), and Tier 3 adds tenants to a working mechanism
rather than reopening the layer.

### D373

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D373 — the invariants, and the 5xx bar: disclosure, not status**

Tier 1 shipped at zero false positives and that bar is **not renegotiated here.**

### D374

<sub>cited inside a range only · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D374 — module layout follows the seam `tlsProbe.ts`/`authzProbe.ts` established**

`inputCorpus.ts` (the payload matrix, pure data + construction-time vacuity check) ·
`inputProbe.ts` (the **only** file that sends a mutation probe; injected sender, so every branch is
unit-testable with no network) · `inputRules.ts` (the judge; pure functions over an observed response
and a probe response).

### D375

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D375 — `M130-01` is not promoted by this milestone, and this is why**

`M130-01` (S4, open) is the CSRF false-negative: a cookie-borne probe of a mutating endpoint is
refused for CSRF *before* authorization is consulted, and a differential oracle reads the refusal as
a pass. Its S4 severity rests on *"no shipped tflw has this defect… it can bite only under
`probe mutating` with a cookie session declared"* — which reads like a description of Tier 3.

### D376

<sub>cited from CHANGELOG.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D376 — R8's fingerprints, re-attached to `RunReport`**

D364 removed `ScanReport`; R8's content survives intact. `partialFingerprints` = a hash of
**`ruleId` + normalized endpoint (method + templated path) + the mutated input's location + the
violated invariant** — excluding timestamps, generated ids, the concrete payload and the seed, so the
same weakness fingerprints identically across runs while two weaknesses on one endpoint stay
distinct.

### D377

<sub>cited from CHANGELOG.md, tflw-tests/VULNS.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D377 — the gate: `--fail-on` and `--baseline`**

`--fail-on <severity>` (default: any finding fails) and `--baseline <file>` (a committed JSON list of
accepted fingerprints). Baselined findings **still render**, marked "known/accepted", and do not fail
the build.

### D378

<sub>cited inside a range only · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D378 — D332's repro emitter generalises without changing shape**

`PLAN_M130B_AUTHZ_ENGINE.md:722` predicted this: the emitter *"generalises from a principal and an
expected 403 to a mutated body and an invariant without changing shape."* Verified against the code —
the emitter already builds a runnable `.tflw` from a `ProbeResult`.

### D379

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D379 — the plants: `V10`–`V13`, and the D363 trap checked before designing them**

**D363's trap, checked first, as it instructs.** `M132b` discovered at build time that the acceptance
corpus had **zero principals able to make a mutating probe** — three correct exclusions composing
until nobody could answer — so planting a positive would have "passed" on nothing. Tier 3's analogue
is *what*, not *who*, and the measurement is worse:

| route | mutable input |
|---|---|
| `V1`,`V2`,`V4`,`V5`,`V7` | none — bare `@Get` |
| `V3` | none — bare `@Post` |
| `V6`,`V8`,`V9` | `:id` behind **`ParseUUIDPipe`** |
| `V9` | `@Body() { status?: string }` — added by `M132b`, 2026-08-14 |

### D380

<sub>cited from tflw-tests/CONSTRUCTS.md, tflw-tests/VULNS.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D380 — the negatives are the real app, untouched**

`plan_v2.md` §4.2's rule stands: real endpoints stay clean. The ~45 real test files' observed requests
are Tier 3's **negative** corpus and its volume measurement — mutating them proves the oracle is
quiet against a correct application, and tells us whether D377's gate is urgent or merely prudent.

### D381

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D381 — the pace bound holds; `probe rate` does not come due**

D21 layer 5 shipped as an **asserted bound rather than a declared pace**: probes are strictly
sequential, one in flight per assertion, and a test holds that property. `probe rate` was deferred on
the condition *"the first change that permits two probes to be in flight simultaneously."*

### D382

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D382 — diagnostic codes, and the coupling**

`M134a` assigns **`TF067`+** (highest currently assigned: `TF066`). At minimum:

- `probe oversized` / `probe traversal` named on a target with no `authorized target` — reuses the
  existing unaffirmed-target codes rather than adding new ones.
- **new:** the input-handling assertion on a step whose request had **no mutable input** — the
  no-power-to-fail shape, which D285 and D373 both say must be speakable.

### D383

<sub>cited from SPEC.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D383 — three milestones, and Tier 4 is not scoped here**

| milestone | repo | contents | codes | coupled |
|---|---|---|---|---|
| **`M134a`** | tflw | `inputCorpus.ts` + `inputProbe.ts` + `inputRules.ts`, the `has no input-handling violations` matcher, the two `probe` sibling lines, checker + docs-site + reporter (D24b's non-negotiable three) | **yes** | **yes** — back-to-back with its fixture companion |
| **`M134b`** | tflw | R8 fingerprints, `--baseline`, `--fail-on`, findings in `RunReport` + `report.html`, the seeded layer as non-gating (D369) | no | no |
| **`M134c`** | testFlow-tests | `V10`–`V13` + `VULNS.md` rows + `verify-input-acceptance.mjs` grader + the real-suite sweep (D380) | n/a | no |

### D385

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D385 — findings ride the report for all three scans, not only Tier 3**

D376 says findings ride `RunReport` as a `findings[]` array. It does not say *whose*. Measured: Tier 1
(`securityRules.ts`), Tier 2 (`authzRules.ts`) and Tier 3 (`inputRules.ts`) all already produce
`finding.ts`'s generic `Finding[]` — the reuse SPEC §9.8 predicted — and all three then **discard it
into the assertion's own prose**. `AuthzFinding` is the single exception and it exists only because
D332's repro emitter needed facts rather than a rendered sentence.

### D386

<sub>cited from CHANGELOG.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D386 — the gate can only relax, never tighten, and relaxation is never silent**

The obvious-looking design is a run-level gate that decides `ok` from findings. It is wrong here, and
the reason is structural: `run-verdict.ts` is emphatic that `finalizeVerdict` is **the one derivation
of `RunReport.ok` in the tool**, and a scan finding *already* fails its build — through the assertion
that produced it. A second gate axis would mean two sources of truth for the same question.

### D387

<sub>cited from CHANGELOG.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D387 — `--baseline` reads, `--baseline-write` produces, and stale entries are named**

- **`--baseline <file>`** — a committed JSON document, `{ "version": 1, "accepted": [{ fingerprint,
  rule, endpoint, note? }] }`. A finding whose fingerprint is listed still renders, marked
  `known/accepted`, and is withheld from the verdict.
- **`--baseline-write <file>`** ships in the same milestone and is not optional polish. R8
  fingerprints are hashes; a feature whose adoption step is *hand-transcribe forty hashes* is not
  adoptable, and R11's whole argument for shipping the gate with the tier is adoption on day one.
- **Stale entries are reported** — fingerprints in the baseline that this run did not produce. A
  suppression file that only grows is permanent, and the thing that makes it shrink is a report that
  names what no longer applies. Same self-liquidating instinct as D369's *promote this payload*.
  Reported, never auto-removed: a run with `--tags` naturally produces fewer findings, so silent
  pruning would delete acceptances the next full run needs.
- Seeded findings are excluded **structurally, not by a rule anybody has to remember**: they have no
  fingerprint (D369), and the baseline is keyed on fingerprints.

### D388

<sub>cited from CHANGELOG.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D388 — the seeded layer is a run flag, and it grants nothing**

**`--probe-seeded <n>`** draws `n` extra payloads per *already-granted* class from `resolveRunSeed`'s
stream. It **cannot widen what `authorized target` permitted** — seeding is a capability of the run,
safety classes are a claim in the config, and a command-line flag that could reach `traversal`
because it asked for more payloads would undo D372 by the back door. That is layer 4's rule restated,
not a new one.

### D389

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/VULNS.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D389 — `M128-01` is fixed here, and this is the milestone that can**

D384 declined to commit in advance and left it as *"a scope call for `M134b`'s own planning"*. The
call is **fix it**, on three measurements rather than on the row's age:

1. `inputRules.ts` already carries `because` and `disabledClasses` **for this exact purpose** — its
   own comment says the distinction is *"the one `M128-01` is filed about, and the one place this
   milestone can afford to answer it."* The facts exist and are thrown away at the report boundary.
2. The row's own stated fix is *"the rule ids in the JSON report regardless of what the terminal
   prints — the grader reads the report, so the JSON half alone closes the acceptance gap."*
   `M134b`'s entire subject is putting scan facts into the JSON report. The fix is a field on a
   structure this milestone is already building.
3. Deferring again makes it worse on a schedule: Tier 3 added four rules to the instrument, and risk
   4 of §3 says so in advance.

### D395

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D395 — each plant is specified against its rule's detector, not against its rule's name**

| plant | what D379 said | what the shipped rule requires | consequence for the route |
|---|---|---|---|
| `V10` | "reflected input unescaped" | `reflectedInputUnescaped` **refuses a JSON echo**: the response content type must be `text/html`, `application/xhtml` or any `text/*`, and the payload must come back with its angle brackets intact | the route must serve **`text/html`**. A NestJS handler returning an object serves `application/json` and the rule stands down — the plant would be invisible |
| `V11` | "path used in a file read" | `pathTraversalRead` matches a **filesystem signature** (`root:…:0:0:`, a private-key header, a Windows ini section), never a path echo | the route must return the **file's contents**. A route that echoes the rejected path, or 404s with the attempted path in the message, produces nothing |
| `V12` | "`body.text` into a raw query" | `errorDetailDisclosure` matches a stack frame, a SQL error fragment, an **ORM exception class name**, or an absolute source path with a line number | the handler must **catch and serialize** the driver error. Letting it propagate cannot work — see D396 |
| `V13` | "`body.title`, unbounded" | `oversizedInputAccepted` fires **only on a 2xx**; a `400` or `413` is the application behaving correctly | the DTO must carry validation decorators **and no length bound** — see D397 |

### D396

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**D396 — the app cannot leak by accident, so `V12` must leak on purpose**

`ProblemDetailsFilter` catches everything, and for anything that is not an `HttpException` it
answers `{"type":"about:blank","title":"Internal Server Error","status":500,"detail":"an unexpected
error occurred"}`, sending the stack to the **logger** and never to the body.

### D402

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M135_SARIF.md`</sub>

**D402 — `M135` is R7 + R8 + R9. R10's `--unsafe-evidence` is deferred.**

The scope is *what R8 cannot be emitted without*: the 18-entry remediation KB, the corrected
severity mapping, and the exporter. R10's evidence-redaction *default* already shipped — it has a
live consumer at `authzRules.ts:309` and D376 reused it unchanged — so what is missing is only the
`--unsafe-evidence` escape hatch, and SARIF carries whatever `detail` already holds either way.

### D403

<sub>cited from CHANGELOG.md · lifted from `PLAN_M135_SARIF.md`</sub>

**D403 — SARIF re-attaches to `RunReport`, and R1/R2's `ScanReport` container is formally dead**

D364 removed the mode; D376 moved the fingerprints; D377 moved the gate. This decision moves the
last piece and states the consequence plainly, since D360 forbids editing the closed plan in place:

| `PLAN_REPORTS_PERF_SECURITY.md` says | what is true after this milestone |
|---|---|
| R1 — "three fully independent report types" | **two**: `RunReport` and `LoadReport`. `ScanReport` never existed and never will |
| R2 — `scan` writes `scan-report.html`, `scan-results.json`, `findings.sarif` | `run` writes `report.html`, `results.json`, `junit.xml` and — new here — `findings.sarif`. The scan HTML is the findings block `M134b` already added |
| R8 — SARIF built by the `scan` writer | built by `@tflw/reporter` from `RunReport.findings[]` |
| R11 — scan's own exit-code contract | shipped as `--fail-on`/`--baseline` inside `run`'s ladder (D386: the gate can only ever turn a red assertion green) |

### D404

<sub>cited from CHANGELOG.md · lifted from `PLAN_M135_SARIF.md`</sub>

**D404 — `findings.sarif` is written only when the run scanned**

Written to `report/findings.sarif` when the run evaluated at least one `security` /
`authorization` / `input-handling` assertion — that is, when D389's census is non-empty. Otherwise no
file is written at all.

### D405

<sub>cited from CHANGELOG.md · lifted from `PLAN_M135_SARIF.md`</sub>

**D405 — a result points at the `.tflw` assertion, and names the endpoint logically**

```
result.locations[0].physicalLocation.artifactLocation.uri  = the .tflw file, repo-relative
result.locations[0].physicalLocation.region.startLine      = the assertion's line
result.locations[0].logicalLocations[0].fullyQualifiedName = "GET /orders/{orderId}"
result.locations[0].logicalLocations[0].kind               = "resource"
```

SARIF is a static-analysis format and a `result` is anchored to a file and a line. A tflw finding is
about a **running application's endpoint**, whose source is usually not in the repository being
scanned and may not be in any repository at all. The `.tflw` file is the one artifact that genuinely
exists in the scanned tree, `ScanFinding` already carries `file` and `line`, and `endpoint` is
already normalized to `METHOD /templated/path` for the fingerprint.

### D406

<sub>cited from CHANGELOG.md · lifted from `PLAN_M135_SARIF.md`</sub>

**D406 — four levels into three, plus the numeric GitHub actually ranks on**

| tflw severity | SARIF `level` | `security-severity` |
|---|---|---|
| `critical` | `error` | `"9.5"` |
| `serious` | `error` | `"7.5"` |
| `moderate` | `warning` | `"5.0"` |
| `minor` | `note` | `"2.0"` |

### D407

<sub>cited from CHANGELOG.md · lifted from `PLAN_M135_SARIF.md`</sub>

**D407 — CWE rides in `rule.properties.tags`**

```
"properties": { "tags": ["security", "external/cwe/cwe-79"], "security-severity": "5.0" }
```

The convention CodeQL emits and the one GitHub's UI filters and groups on, so a tflw finding sits
beside native alerts instead of in a bucket of its own. The KB's OWASP and CWE URLs also render as
links inside `help.markdown`, so a human reading one alert has them without a taxonomy walk.

### D408

<sub>cited from CHANGELOG.md · lifted from `PLAN_M135_SARIF.md`</sub>

**D408 — the KB carries remediation and references. It does not carry severity.**

R9 says severity is KB-authored. **That clause is corrected here**, on `M134b`'s precedent that an
overclaim found in the file you are already reading gets rewritten rather than stepped over.

### D409

<sub>cited from CHANGELOG.md · lifted from `PLAN_M135_SARIF.md`</sub>

**D409 — a rule with no KB entry is a compile error**

Each rule module exports its ids as a `const` tuple; their union types the KB as
`Record<RuleId, KbEntry>`. A nineteenth rule that ships without an entry fails `tsc`.

### D410

<sub>cited from CHANGELOG.md · lifted from `PLAN_M135_SARIF.md`</sub>

**D410 — `baseline` suppresses; `--fail-on` does not**

- `withheld: 'baseline'` → `result.suppressions: [{ kind: "external", justification: "accepted in
  <baseline file>" }]`. An exact semantic match: a decision a human recorded outside the tool.
  GitHub renders it as a dismissed alert, which is what R11's "still render, marked known/accepted"
  asks for.
- `withheld: 'fail-on'` → an **ordinary result** at its own `level`.

### D411

<sub>cited from CHANGELOG.md · lifted from `PLAN_M135_SARIF.md`</sub>

**D411 — seeded findings are excluded from the SARIF entirely**

D369's seeded layer carries **no fingerprint by construction**, and that absence is the mechanism
that makes it un-baselinable and non-gating: a rule can be forgotten, a missing field cannot.

### D412

<sub>cited from CHANGELOG.md · lifted from `PLAN_M135_SARIF.md`</sub>

**D412 — `rules[]` declares what applied; what stood down goes in `run.properties`**

```
tool.driver.rules[]                       = every rule this run applied (D389's census)
run.properties["tflw/notApplicable"][]    = { rule, because } for every rule that stood down
```

This is the three-state coverage model expressed in SARIF's own vocabulary:

| state | how it reads in the document |
|---|---|
| **fires** | in `rules[]`, with results |
| **silent** | in `rules[]`, **zero** results — a measured silence |
| **not applicable** | absent from `rules[]`, present in `tflw/notApplicable` with its reason |

### D413

<sub>cited from CHANGELOG.md · lifted from `PLAN_M135_SARIF.md`</sub>

**D413 — repros: wire what exists, defer the generalization behind a condition**

`result.properties["tflw/repro"]` and `report/repros/*.tflw` are both wired to
`reporter/authz-repro.ts`, the emitter that shipped in `M130b`. Authorization findings get R8 in
full; on the other 16 rules the property is simply absent.

### D414

<sub>cited from CHANGELOG.md · lifted from `PLAN_M135_SARIF.md`</sub>

**D414 — `@types/sarif` + `ajv`, validated against the bundled 2.1.0 schema**

A reporter unit test builds a document from a realistic `RunReport` — findings from all three scans,
one baselined, one below the floor, one seeded, at least one rule stood down — and validates it
against the schema. Root `devDependencies` go **4 → 6**; neither dependency reaches a published
artifact, and `@types/sarif` has no runtime at all.

### D415

<sub>cited inside a range only · lifted from `PLAN_M135_SARIF.md`</sub>

**D415 — the dogfood asserts the document; it does not upload it**

`M135c` runs the acceptance corpus, then asserts over the emitted `findings.sarif`: every planted
`V1`–`V14` present with the expected `ruleId`, `level` and `security-severity`; the fingerprint
stable across two consecutive runs; seeded findings absent; the baselined one carrying
`suppressions`; `tflw/notApplicable` naming the rules that stood down. The file is archived as a
plain CI artifact.

### D416

<sub>cited inside a range only · lifted from `PLAN_M135_SARIF.md`</sub>

**D416 — R10's `--unsafe-evidence` revives on a failed triage, not on a milestone**

**Condition:** *the first finding whose detector-match metadata and shape-preserving partial are not
enough for a maintainer to confirm it is real.*

### D417

<sub>cited from SPEC.md · lifted from `PLAN_M135_SARIF.md`</sub>

**D417 — three milestones, all decoupled**

| | repo | contents | new codes | coupled |
|---|---|---|---|---|
| **`M135a`** | tflw | R7's 18-entry KB (D408) + the `Record<RuleId, KbEntry>` union (D409) + D406's severity table; wired into the `report.html` findings block as "possible fixes" | no | no |
| **`M135b`** | tflw | the SARIF exporter (D403–D407, D410–D413), `report/findings.sarif` write condition (D404), `report/repros/`, `@types/sarif` + `ajv` + schema test (D414), docs-site + SPEC corrections | no | no |
| **`M135c`** | tflw-tests | acceptance over the emitted document (D415) | no | no |

### D427

<sub>cited from packages/vscode/test/MANUAL.md · lifted from `PLAN_M136_ARC_DEBT.md`</sub>

**D427 — the config dialect gets its own language id, and the selector moves with it**

> **CORRECTION (`M136b`, 2026-08-16) — read `D427a` first.** Two of this decision's load-bearing
> numbers are wrong, both found by measuring rather than by reading, which is `M136a-01`'s whole
> point applied to the row `M136b` is built on. **The row's nine words are eighteen**, and **the
> three wiring sites are six** — one of the three missed sites is `activationEvents`, where the
> failure mode is the extension never starting at all. `D427a` has the measurement; the design
> below is otherwise unchanged and still correct.

### D427a

<sub>cited from packages/vscode/test/MANUAL.md · lifted from `PLAN_M136_ARC_DEBT.md`</sub>

**D427a — the row's nine words are eighteen, and its three wiring sites are five**

`M133-01` prescribes its own fix as *"measure which of the nine the parser actually treats as
keywords"*. Doing that literally — asking `collectSemanticTokens` and the grammar's own wordlists
about every word `parser.ts` passes to `isKw`/`expectKw`/`matchKw`, rather than about the nine the
row happened to enumerate — answers a wider question than the row asked, in both directions.

### D432

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D432` — the crawl is a top-level `crawl` declaration. `D365` is closed by a different shape, not by reviving the mode**

`D365` deferred `tflw scan` and named "a crawler (Tier 4)" as its **second tenant**. The condition
fires. The remedy does not follow.

### D433

<sub>cited from packages/lang/GRAMMAR.md, tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D433` — CSRF token capture lives on `session`. It is a session feature the scanner needs, not a scanner feature**

`D423` establishes that capturing a token the app itself issued is not synthesis — *"it is what a
browser does"* — and that `tests/api/identity/sessions.tflw:54` already captures `body.csrfToken` by
hand for exactly this reason, and has since `M22`.

### D434

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D434` — one new rule, `sec/csrf-not-enforced`, expressed as a derived credential**

Once tflw can capture the token, it can **withhold** it — and whether a mutating route still succeeds
is a finding rather than a blind spot. This inverts `M130-01`: the thing that has obstructed the
cookie principal all arc becomes the thing being measured.

### D435

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D435` — the API surface is enumerated and disclosed; only the spider is capped**

`M134` risk 1 already fixed half of this: *"If it comes back untenable the answer is a cap or a
narrowing (`D381`), **never concurrency**."* This plan does not overturn it. The crawl stays strictly
sequential, `authz-probe-pacing.test.ts:101`'s `maxInFlight() === 1` stays green, and **`probe rate`
stays deferred with its condition unmet** (`D448`).

### D437

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D437` — every finding carries its seed, and every seed gets a plant only it can reach**

Without this the enumerator — the single largest new component — is **unfalsifiable**. It could
regress to returning nothing and every acceptance gate would stay green on the captured-traffic seed
alone, because the plants are all reachable that way.

### D438

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D438` — a documented plant is possible under `VULN_MODE=1`, and the exclusion's own reason permits it**

`VULNS.md:11-13`'s standing rule is *"no route in `apiV2/src/vuln/` without a row, and no row without
a route"*, and the whole slice is `@ApiExcludeController()`. Taken together those say no plant can
ever be OpenAPI-documented — which would leave `D437`'s enumeration plant unbuildable.

### D441

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D441` — `D299`'s TLS cipher enumeration rides in, last and cuttable**

`D365` named TLS enumeration its **first** tenant. This plan builds the home the second tenant was
waiting for, so the first must be decided now — and deferring it a third time is not honestly
available. Its condition has already fired, and `D416` names the alternative shape ("the first
external request for it") as unmeetable by construction on an unpublished tool: *"a cancellation
wearing a deferral's clothes."*

### D442

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md, tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D442` — the browser spider fetches and parses. It does not render**

Both halves ship, browser last and separable. The spider is HTML-fetching and link/form extraction —
**no browser engine**.

### D443

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D443` — two new codes: `TF068` and `TF069`**

Allocated from `TF068` (see §1.4). The bar is `D419`'s — it rejected a code specifically to avoid
*"two rows in the generated codes reference with one repair"* — so each must earn a **distinct**
repair.

### D444

<sub>cited from SPEC.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D444` — config-dialect completion is built, in `M137a`**

Per §1.3 it does not exist: no config `CompletionKind`, and `runCompletion` only ever enters the
test-dialect parser. `probe mutating` has never been completable.

### D445

<sub>cited from tflw-tests/CONSTRUCTS.md, tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D445` — what the `vuln/` acceptance is owed: a versioned baseline of the real app's true findings**

§4.2's *"zero findings elsewhere"* is already false (§1.2). `M137` replaces it with something
measurable rather than leaving the arc's final gate resting on a contradiction.

### D450

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D450` — the `crawl` declaration's shape is derived from existing idioms, and it adds no fourth matcher family**

`D432` settled that a crawl is a top-level declaration. It did not say what one looks like, and a
construct's syntax is the half users actually meet. Every element below is taken from something the
language already does; nothing here is invented where a precedent existed.

### D454

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D454` — `sessions.tflw` keeps its hand-capture. `D433`'s "goes away as a side effect" is wrong**

`D433` reasons from `tests/api/identity/sessions.tflw:54` and concludes the hand-wiring *"goes away as a
side effect, which is the tell that this is the right home"*; §5 carries it as an `M137b` item,
*"`sessions.tflw:54`'s hand-capture removed"*. The diagnosis is right and the conclusion does not
follow from it.

### D455

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D455` — a token-less cookie principal is declared, so the blind-spot control keeps a live positive**

`D431` sells `M137b` as unblocking `shopper` across every existing Tier 2 and Tier 3 probe. It does.
What no decision here noticed is that the corpus has built four assertions on `shopper` being
*blocked*, and they do not survive it.

### D456

<sub>cited from SPEC.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D456` — `TF069` is withdrawn. `csrf from` inherits `TF039`, and the path-miss carries no code**

**`M137b` mints no diagnostic code.** `TF068` stays next-free for `D432`'s `crawl`, and §1.4's
statement about it stays true.

### D457

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D457` — the derived probe travels in its own field, because the existing rules would call it a leak**

`D434` says the engine *"derives a 'same cookie session, token withheld' principal and probes it like
any other"*. Building it exposed a false positive that phrase walks straight into, and the fix is
structural rather than a filter.

### D463

<sub>cited from SPEC.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D463` — `TF069` is skipped permanently, and the crawl-body rule is `TF070`**

`M137c` was scoped to mint one code. Building `TF068` surfaced a second rule that needs one: the crawl
body restriction, which `ast.ts` already documents as the checker's job rather than the grammar's.
It earns a code on `D419`'s bar — one repair, *put the step in a `test`*, shared by nothing else in the
table.

### D465

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D465` — the crawl's own writes are gated by `probe mutating`, the opt-in that already exists**

The gap this closes was not in the plan, and nothing in §5's item list would have led to it. `D435`
says Tier 4 *"multiplies the request count again while adding no new gate"* and `D439` explains why
that is acceptable — but both are about **findings** and about **volume**. Neither notices that a
synthesized request is a *new kind of request*: every prober built in this arc re-issues a request the
author wrote, and the crawl invents one nobody wrote. A synthesized `DELETE /products/{id}` is
categorically further from authored intent than any Tier 2 probe of an authored `DELETE`.

### D480

<sub>cited from SPEC.md, tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D480` — a crawl resolves the document's paths against the document's own server, never against the `api` base's path**

Found by `M137e`'s scoping, before a line of `M137e` was written, and it is `D478` again one layer up —
in the sibling component, hidden by the same blind spot, with the same failure direction.

### D481

<sub>cited from SPEC.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D481` — a crawl that sent requests and reached none fails, and it is `TF068`, not a new code**

`D480`'s defect was green. That is the part worth fixing permanently: the engine had every number it
needed to know it had judged nothing — `sent 31`, `reached 0` — printed them, and returned success.

### D482

<sub>cited from SPEC.md, tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D482` — a resource the public receives has no owner, so it has no boundary to cross**

The second defect the crawler found by existing, and the first one that changes *shape* under it
rather than merely appearing more often.

### D483

<sub>cited from SPEC.md, tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D483` — a spider walks before it probes, so disclosure bounds two phases rather than one**

`M137f`'s first real design question, and it is not about HTML parsing. It is that **the browser seed
is the first seed whose enumeration is itself traffic**, and two properties this arc has already paid
for are written against the assumption that it never is.

### D485

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md, tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D485` — enumeration is gated by `probe ciphers`, a fourth `authorized target` sub-clause, and `sec/tls-weak-cipher` is genuinely widened rather than forked**

The item line for `M137g` says *"widened from negotiated-suite to offered-suite"*, and the first
reading of that is impossible. `sec/tls-weak-cipher` is evaluated **per response** by the matcher, so
a literal widening would open one handshake per suite per assertion — contradicting `D435` (the crawl
is the one place volume is deliberately unbounded) and destroying `D288`'s one-handshake-per-host
property, which exists because *"a suite with 400 assertions against one host would otherwise pay 400
handshakes for one unchanging answer."*

### D486

<sub>cited from SPEC.md, tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**`D486` — the enumeration handshake reads one bit and is forbidden the rest, which is what answers `D298`'s refusal**

`D298` declined to widen the probe's cipher list, and its reasoning is still correct as written:
reaching a legacy-cipher peer needs `@SECLEVEL=0`, *"and OpenSSL's security level is not a cipher
knob — it also lowers what counts as an acceptable certificate, so a strict run would quietly start
trusting keys and signatures it currently rejects."*

### D489

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M139_LEDGER_ACCEPTANCE.md`</sub>

**D489 — The manifest is the source; `VULNS.md`'s table is checked against it. Direction matters.**

If `VULNS.md` prose were parsed to build the manifest, a typo in prose would silently retune the
oracle. If the manifest is generated from tflw output, §2.2's "agree by construction" problem returns.
So: **`plants.mjs` is hand-authored and authoritative; a check asserts `VULNS.md`'s ledger table lists
exactly the manifest's ids, and nothing more.** `VULNS.md` stays prose a human reads, and gains one
machine-checked invariant: its id set.

### D493

<sub>cited from tflw-tests/CONSTRUCTS.md, tflw-tests/VULNS.md · lifted from `PLAN_M139_LEDGER_ACCEPTANCE.md`</sub>

**D493 — Closing `M137e-01` is M139's first item, not a prerequisite.**

`M137e-01` (S3, open) is the blocker and it already carries its own fix design: *"the coverage tables
stay a human-read report run by hand, and `D445`'s precision + staleness assertions become a regression
phase of their own."* `M137g` raised its stakes — `V18` and both `probe ciphers` notes are graded by
that ungated script and by nothing else.

### D504

<sub>cited from tflw-tests/CONTRIBUTING.md · lifted from `PLAN_M138_CONTRIBUTING.md`</sub>

**D504 — the document names the commands CI runs, not the phases inside them**

M139's `security-acceptance-gate` is a `regression.mjs` phase in the `core` group; CI's line is
`npm run regression -- --group core`. A contributor who runs the four group commands has run it.

### D537

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M141_VACUOUS_CHECKS.md`</sub>

**D537 — every assertion this milestone writes ships with a demonstrated break**

The cluster is *checks that read the wrong answer*, and the repair is more checks. So, non-negotiable
and itemised — this is the `M140-5` discipline (whose staleness tests built throwaway git repos
precisely because a same-commit branch made all 70 citations vacuous):

| new check | its demonstrated break |
|---|---|
| `tflw-bin.mjs` resolution + refusal | unit tests in `test:scripts`: `branch` against a vendored path must throw; a sha mismatch must throw; `released` must not |
| the printed stamp | a test asserting the line is present and names a path that exists |
| the migrated `D285` census read | a mutated report fixture with `notApplicable` emptied → the grader must `fail()`, run and recorded |
| the `results` contract section | `sarif.test.ts`'s two-way walk (contract promises a key the emitter dropped, and vice versa) |
| `verify-watch --expect-no-display` | it *is* the break; record the observed failure text |

### D538

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M141_VACUOUS_CHECKS.md`</sub>

**D538 — `M138b-01`: ANSWERED by the user 2026-08-19 — option A**

Put to the user as three options (A drop `npm test` + drop `--fix`; B write the unit tests; C document
both). **The answer is A**, with a reason that is not in the row and changes how the fix is written:

### D623

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

**D623 — config directives take one spelling each, and two of them move.** Closed set → bare
keyword; boolean or open string → literal. `evidence` and `log level` are backwards today and both
change, each earning a retirement diagnostic and `tflw migrate` support per `SPEC.md:3289`. This is
the milestone's only genuinely breaking change (see D627's rider), and it is the reason the refusal
vocabulary has to be one thing first.

### D628

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

**D628 — a closed-set value that cannot be spelled as one bare keyword is spelled as two, and the
CLI keeps the hyphen.** Taken during `M147b`, because `D623` is unbuildable without it: `evidence`'s
closed set contains `headers-only`, `isIdentCont` is `/[A-Za-z0-9_]/`, and `-` lexes as `minus`, so
the rule *"closed set ⇒ bare keyword"* has no spelling for one of its own members. The answer was
already in the repo. `M134a`/`D366` met the identical problem naming the fourth scan `input-handling`,
**measured that this language has zero hyphenated bare keywords** — every multi-word construct it has
is space-separated — and shipped `input handling`. So: `evidence headers only`. The AST value stays
`headers-only` (an internal enum reaching `report.html` and `ResolvedConfig`), and `--evidence
headers-only` stays hyphenated, because a CLI argument is typed into a shell where a space needs
quoting and where this lexer never runs. **One value, three surfaces, and the surface decides the
spelling.**

### D629

<sub>cited from SPEC.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

- **D629 — `random string 0` is legal and returns the empty string.** `M124-02` asked which of two
  behaviours was deliberate and the answer is *both*, for different reasons: the empty string **is**
  a string of length 0, so §4.1's promise is kept, while `random password 2` refuses because a
  password bound exists to make a value usable as a password. The asymmetry the row filed is not a
  defect; it is two generators promising two things. `RUNTIME_GAPS` carries it as
  `ruling: 'D629'` — the field that exists for an absence that is an answer, rather than a
  `filedRow` implying somebody still owes a fix.

### D630

<sub>cited from SPEC.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

- **D630 — a reversed `random date between` is refused where the ordering is decidable without a
  clock, and only there.** Two bounds measured from the same anchor are ordered at check time; `now`
  against `today` differs by however far into the day the run started and is left to the run. The
  bound-**type** test is the one exception to every other `static-if-literal` site's silence on
  interpolation: those inspect a literal's *content*, this one inspects its *kind*, and no
  interpolation turns a string into a date.

### D631

<sub>cited from SPEC.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

- **D631 — the setting-value rule lives in the parser for the five numeric slots.** The range of a
  number is a fact about its shape and the production reading it already holds everything needed.

### D632

<sub>cited from SPEC.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

- **D632 — `M118-01` reuses `TF071` and is decided in the checker.** What a scheme reserves is a
  fact about the language's semantics, not about a token's shape. The row predicted a new code and
  was right against `TF054` and wrong against a code that did not exist when it was written.

### D633

<sub>cited from SPEC.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

- **D633 — a duplicate `with each` column is `TF072`, refused in the production that reads the
  header, and the duplicated name is kept.** New code because `TF027` means *a `{col}` the table
  does not declare* and here it declares it twice. Parser rather than checker for a reason `D631`
  does not supply: `InlineDataTable.columns` is `readonly string[]` with no per-column spans, so the
  checker could only point at the whole multi-line table. And **kept in the header**, because the
  header's width is what every data row is matched against — de-duplicating it answers one repeated
  word with a ragged-row complaint per row, and dropping the name discards the table outright. Both
  alternatives were built and measured before this one.

### D634

<sub>cited from SPEC.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

- **D634 — the imported-file rules: `TF073` for an import that does not parse, `TF037` reused for a
  call inside an imported body, and `import` does not recurse.** Three answers, one boundary.
  `TF073` is new because `MISSING_FILE` would be false about a file that is present — `M97a-01`
  →`TF056`'s argument a second time — and it is raised in `@tflw/lang` from an answer the resolver
  hands over, the `missingFiles` shape, because a diagnostic built inside `@tflw/runtime` cannot
  carry a probe SPEC §17 executes. `TF037` is **reused** for `A4-21` under §6's rule: the call
  really is unknown in the registry that will resolve it, so only the location differs, and
  location is what the message and the caret are for. And recursion was **built far enough to be
  rejected**: `import` shares one flat namespace where a collision is a hard refusal, so following
  an imported file's own imports would make the most reusable library in a suite the one that
  cannot be imported twice — and it would make the checker more permissive than the runtime, which
  the resolver's own docstring has forbidden since M87.

  The ruling's **reopen condition was measured rather than imagined**, per `M131`: an importer that
  already declares the missing name is told by `TF037` to add an import that `TF035` then refuses.
  Both diagnostics are correct and the program genuinely cannot run flat. That fixture is two files
  wide and reproduces today; if the shape turns up in real use rather than in a fixture, flat
  non-recursive imports are the thing to revisit.

### D637

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

- **D637** — *a comma list closed by a bracket takes a trailing comma; one terminated by the end of
  the line does not.* The joint is what closes the list, not whether it is a literal.

### D638

<sub>cited from SPEC.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

- **D638** — *one time vocabulary across every construct that takes a duration, as the union.* An
  abbreviation must touch its number; a spelled-out word need not.

### D639

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

- **D639** — *a `body` is a JSON document — object or top-level array — at both `body` positions.*
  A top-level scalar is still refused: a document, not any value.

### D640

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

- **D640** — *a `wait until` step may set its own poll budget, spelled `timeout wait <duration>`, on
  both forms.* It is the only per-step override of `timeout wait` in the language, and it is
  deliberately **not** spelled as a bare `timeout`, because that word already means the per-request
  budget on the api form and the two are different quantities that may appear on one line. No other
  step has a poll budget, so no other step takes the clause.

### D641

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

- **D641** — *a subject may follow `wait until` exactly when re-reading it between two polls can
  produce a different answer.* A property, not a list, and it selects the four the runtime already
  re-observes on a retry loop: a UI locator, `page`, `request to "…"`, and any value subject with an
  `of request to "…"` clause. Everything else in subject position reads the response scope, which one
  `api` step writes and nothing between polls can change. `matches snapshot` is the matcher half of
  the same rule and its only member.

### D642

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

- **D642** — *a `session` may be scoped to named envs, spelled `for env <a>[, <b>...]`, and a session
  written without the clause belongs to every env.* The clause only ever narrows, which is what makes
  it additive. Under an env a session is not scoped to, the session does not exist: its body is not
  checked against that env's services, it joins no authorization probe set, and a `test … as <name>`
  there is `TF028` naming the envs it does live in. An env name the config does not declare is
  `TF074`. Read before `oauth2`/`privileged`, so `oauth2 privileged` stays the adjacent pair D310
  settled.

### D643

<sub>cited from SPEC.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

- **D643** — *the parser bounds its own recursion, and refuses past the bound with a diagnostic
  rather than a stack overflow.* `parseSource` is documented as never throwing for a syntax error and
  a file of 30 000 unary minuses broke that outright. Unary minus is the only production in this
  grammar that recurses per token, so one guard closes it; the limit is **256**, set two orders of
  magnitude below anything written by hand and an order below the measured cliff, because the stack
  that binds is the smallest the parser might run on and not the machine it was measured on. Its own
  code, `TF075`, because the `-` is legal exactly where it is written and `TF010` would put a false
  word in the only sentence the reader gets. This is the milestone's one code, spent under §6's rule
  on the only row whose message could not be told the truth with an existing one.

### D647

<sub>cited from SPEC.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

**Decisions taken:** `D647` — a `header … for <service>` is checked against the union of every service
the file declares rather than the active env, `TF076`, with the under-approximation named and
conditioned. `D648` — `D537` requires a registry entry for a *product* assertion; a scratch sweep is a
weaker grade of evidence, the eleven-milestone backlog (`M138`–`M147b`) is deliberately not
reconstructed, and the rule stands going forward.

### D659

<sub>cited from CONTRIBUTING.md, tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M149_DOCS_CURRENT_STATE.md`</sub>

**D659 — a completeness gate beside the denylist: a shipped construct must be mentioned somewhere**

D657 is a denylist. A denylist catches the sentence that goes wrong; it has nothing to say about the
sentence that was never written — and that is the larger half of §1.1's class. The truth pass
demonstrated it: three shipped constructs (`probe ciphers`, `session … csrf from … send as header`
with its critical `sec/csrf-not-enforced`, and `seed spider`) appear **nowhere** on the site, all
three fully specified in `SPEC.md`. No phrase list could ever have found them, because an absent page
matches no grep.

### D673

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M152_DECISION_PROVENANCE.md`</sub>

**`D673` — the docs site gets a prohibition, not a declaration.** A reader of `/guide/load-testing`
is a tflw *user*, with no relationship to `M60`. Explaining the notation on a user-facing website
justifies an artifact that should not be there. The four prose citations are reworded to say the
thing without the number, and `verify-docs.mjs` gains the rule — one more property beside `D657`'s
roadmap denylist and `D659`'s completeness gate, not a new instrument. **Fence contents are
excluded**: `# emitted by tflw M137d — sec/error-detail-disclosure` is tflw's own output, reproduced
verbatim, and is not a citation at all.

### D677

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M152_DECISION_PROVENANCE.md`</sub>

**`D677` — a new gate resolving every `SPEC.md#<anchor>` referenced from tracked files.** 23 exist,
one points into a heading this milestone edits, and nothing watches any of them because they are
absolute GitHub URLs. The gate parses `SPEC.md`'s headings, computes their slugs, and fails on a
fragment that resolves to nothing. It closes the hole `M149` left open rather than merely avoiding
it this once.

### D686

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M152_DECISION_PROVENANCE.md`</sub>

**`D686` — the provenance line names files; the line numbers move to a report**

`D682` had the generator print the record and **line** each block was lifted from, and `renderEntry`
printed the citing sites the same way. Both were line numbers in a **tracked** file pointing into
files that mostly are not.

### D709

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M152_DECISION_PROVENANCE.md`</sub>

**`D709` — the sibling's citations do not resolve today, and the repair is the index's input set**

*Taken 2026-08-24, on `M152e`'s scoping measurement.* `§3`'s part reads "**739 citations across the
11 tracked `.md`** repointed", on the assumption that `M152b`'s repair transfers across the repo
boundary: give each tracked prose file a sentence naming `DECISIONS.md`, and its notation becomes
resolvable. Measured against the published index, **that sentence would be false for half of them.**

### D722

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D722` — the dogfood's job is defect yield, and coverage is the gate.**
A construct counts as covered when it is exercised in a way that *could fail* — a known-answer
plant, not a happy path. Presence is necessary and not sufficient. This is the bar under which
§2.2's fourteen constructs are gaps; under a presence-only bar they are all already green, and the
milestone would be a formality. Rejected alternatives: presence-only (recreates today's state
exactly), scenario-realism-first (leaves `spike`/`step`/`cleanup` uncovered because no realistic
flow demands them), and a spec-conformance fixture suite decoupled from the app (abandons
dogfooding, which `plan_v2.md` §4.2 deliberately protects).

### D723

<sub>cited from tflw-tests/CONSTRUCTS.md, tflw-tests/CONTRIBUTING.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D723` — ground truth is `tflw spec --json`, emitted by the binary under test.**
tflw grows one new subcommand emitting its own surface: statement keywords (from
`STATEMENT_KEYWORDS`), the `directive`/`key`/`probe` slots from `spec-data.ts`, matchers,
diagnostic codes, and each entry's `SPEC.md` status badge. The sibling's gate obtains it by running
**the vendored binary**, so the checklist and the program under test are the same artifact and
cannot disagree. Rejected: a hand-maintained list (`D659` — this repo's guards do not maintain
wordlists, and a stale one reports green forever, which is the exact failure being closed); reading
`SPEC.md` §4.6's generated table (step keywords only — no probes, matchers, directives or
diagnostics, so ~half the surface has no entry); the gate living in tflw and walking the sibling's
corpus (inverts CI's checkout direction and makes tflw red for a corpus it does not control,
which makes `D511`'s merge order harder rather than easier).

### D724

<sub>cited from SPEC.md, tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D724` — the manifest is known-answer and repo-wide: `CONSTRUCTS.md`.**
Generalize `VULNS.md` past security. One row per shipped construct: the planted defect in
apiV2/webV2 it must catch, the test that catches it, the expected verdict. Graded by precision and
recall the way `M139` grades the security plants. `VULNS.md` is not merged into it — it stays the
specialist ledger for the `VULN_MODE` slice and `CONSTRUCTS.md` cites it rather than duplicating
it. The `no route without a row, no row without a route` discipline carries over verbatim.

### D725

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D725` — plants are always-present fixture modules; `vuln/` keeps its gate.**
New plants follow the `flaky-widget` / `retry-demo` / `contract-demo` / `safety-demo` /
`load-admin` precedent: named modules, unconditionally mounted, each owning the behaviour one
construct family must catch. `vuln/` keeps `VULN_MODE=1` because a live vulnerability is
categorically different from a deliberate 404 or a slow route, and `M137e` already pays the
two-stack cost for it alone. Rejected: a global `PLANT_MODE` (doubles every CI leg and forces the
five existing demo modules to move, breaking ~45 files' targets); data-only plants (most
zero-coverage constructs need *behaviour* the data layer cannot express); a request-scoped fault
injector (a bug in it is indistinguishable from a tflw defect — the instrument becomes the thing
you cannot trust).

### D726

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D726` — workload shapes are graded against a server-observed arrival curve.**
`tflw-acceptance/perf/profile/concurrency-groundtruth-{instant,ramped}.mjs` already prove the
idiom: the *server* records arrivals and the run is graded against what landed. Generalize it into
apiV2's `load-admin`. A `spike` must actually spike; `run 500 iterations` must issue exactly 500.
**The generator is graded against physics, not against its own report** — the only formulation that
could catch tflw mis-pacing a shape it still reports green. Calibrated-latency percentile grading
is a *complement*, deferred to `M154e`'s stretch; threshold-breach plants alone grade the verdict
only, and a completely wrong shape still breaches a threshold.

### D727

<sub>cited from tflw-tests/CONSTRUCTS.md, tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D727` — static gate in CI, perf on a scheduled box run.**
The coverage gate is static (parse the corpus, compare against `tflw spec --json`) so it costs
seconds and runs on every PR. Functional/UI/security plants join the existing four regression legs.
Arrival-curve grading runs box-only on a schedule. GitHub's shared runners cannot produce a
trustworthy arrival curve; the box can.

### D729

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D729` — UI plants prefer a real flow; a harness page is the fallback.**
Most of the uncovered browser surface has a believable home: an invoice PDF download on
`OrderConfirmationPage`, a native `confirm` on admin delete, an iframe payment widget at checkout,
drag-to-reorder in admin categories, a `track shipment` link opening a tab. Build them as product
features and plant the defect in the feature. Fall back to a `RenderFixturePage`-style harness only
where no honest flow exists (viewport matrices, deliberate visual-baseline drift). A construct
proven only on a purpose-built page is proven against the easiest possible case.

### D730

<sub>cited from tflw-tests/CONTRIBUTING.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D730` — the ratchet: an uncovered list that may only shrink.**
The gate ships in `M154b` with an explicit uncovered list and **fails if the list grows**, or if a
listed construct silently disappears from `tflw spec --json`. Each later milestone deletes entries.
This buys the anti-regression property on day one — *a new tflw keyword can never again ship
uncovered* — which is the property that actually decayed, while coverage catches up over
milestones. Precedent: `verify-test-counts.mjs`'s `EXPECTED` is exactly this shape. The list is a
wordlist, but a monotonically shrinking one whose growth is a failure, which is not the thing
`D659` forbids.

### D732

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D732` — walking skeleton first, then scale by tier.**
`M154a` + `M154b` prove manifest → plant → test → precision/recall end to end on **exactly three
constructs** (one API, one UI, one workload) before any tier is scaled. Aimed squarely at this
project's documented cost-model error class (`D514`, `D543`, `M142` §11, `M143` §10, `M152` §10.1,
`M153` §10.1 — **six consecutive milestones**, always *the parts not yet scoped are construction*).
The expensive unknowns — arrival-curve grading, plant-manifest discipline, gate ergonomics — get
met at n=3 where being wrong is cheap, and every later estimate is anchored on a measured slice.

### D733

<sub>cited from tflw-tests/CONTRIBUTING.md, tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D733` — the scheduled perf run is a registered box tenant.**
A systemd timer on the shared build box under a new `tflw:perf` lease class, **registered with the
dashboard's `M20` tenant registry** so `statsctl check` and `statsctl conflict --for` can see it
and a forge render is never surprised by it. `~/Documents/CLAUDE.md` is explicit that the mutex's
value is entirely in every heavy job calling it and that *a new tenant belongs on the list*.
Rejected: a GitHub Actions **self-hosted runner** on the box — both repos are public, and a
self-hosted runner on a public repository lets a fork pull request execute arbitrary code on the
machine the forges render on. That is not a trade-off, it is a defect. Also rejected: a Mac-side
`launchd` job, which fires only while the laptop is awake and on the LAN, so *scheduled* would
quietly mean *scheduled when the laptop happens to be open*.

### D734

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D734` — a plant that fails because tflw is broken must be distinguishable from a plant that is
wrong.**
The point of defect yield is that plants *will* catch real tflw defects. When one does, the finding
is filed as a row in tflw's ledger and the plant is marked `blocked-on:<row>` in `CONSTRUCTS.md` —
counted as *covered but currently failing for a known reason*, never quietly deleted or moved to
the ratchet. A plant that turns red with no row is a plant that is wrong. Without this the
milestone's own successes look identical to its bugs.

### D736

<sub>cited from SPEC.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D736` — the manifest lists what the parser dispatches, and nothing else.**
A `🔮 planned` construct is **absent** from `tflw spec --json`, not listed with a `planned` status.
This is the operational form of `D731`, and it came out the opposite way to how `D731` reads. Two
reasons, the second being the one that decided it. First, every table feeding the manifest is
already held two-way to the parser — `STEP_KEYWORDS`/`D277`, `CONFIG_KEYWORDS`/`D444`, and now
`LOCATORS` — so *what the parser accepts* is the only set that can be derived rather than
remembered. Second, a `planned` list would be a hand-maintained wordlist of things that **do not
exist**, which is `D659`'s prohibition exactly, and it buys nothing: a construct that gets built
simply *appears* in the manifest, and `D724`'s `no construct without a row` rule turns the sibling
repo's gate red the same day, with nobody having to flip a badge. `MATCHERS` is the one table
carrying its own `status` field (`M97b`) and is emitted verbatim, so a `planned` matcher would say
so rather than quietly claim to work. The worked case is `element` (SPEC §9.3): absent from the
parser, absent from `LOCATORS`, absent from the manifest, and asserted absent by a test that will
fail the day it ships.

### D737

<sub>cited inside a range only · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D737` — the build stamp is never invented.**
`commit` is a short sha or `null`; there is no third answer. Outside a git checkout — a published
tarball, a vendored tree, the Fedora offload's rsynced copy, a Docker context without `.git` — the
bundler learns nothing and the stamp says nothing, because a fabricated sha is strictly worse than
an absent one: it would be *believed*, which is the failure `M153b-01` already cost a PR body once.
`dirty` follows it and is three-valued for the same reason — `null` when there is no commit for it
to be relative to, since `false` there is a claim that the working tree was clean when in fact
nobody looked. That distinction was written as a two-valued `false` first and caught within the
hour by the `e2e` suite running on the box, whose tree genuinely has no `.git`. `source: 'dev'`
marks the unbundled `npm run dev` path, so a consumer can refuse a build with no provenance instead
of grading one.

### D738

<sub>cited from SPEC.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D738` — `--json`, not `--format json`.**
`tflw run --format ndjson` and `tflw check --format json` name a member of an open set of
renderings, and each owes a `--format text` counterpart it already has. `spec` has exactly one
machine form and one human one, so the flag is the boolean it looks like. `--format json` is
deliberately **not** accepted as a second spelling: two ways to say one thing is the drift this
repository keeps paying for elsewhere, and the cost of a reader typing the wrong one is a usage
error naming the right one.

### D739

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D739` — "uncovered" on the ratchet means *unrostered*, not *unexercised*.**
`M154b`'s ratchet ships with 163 of the 166 constructs on it, and `step:api` is one of them — with
1139 occurrences behind it, `step:expect` with 1692, `step:capture` with 523. Read as "constructs
this suite never exercises" that list is false of a good third of itself, and a list nobody believes
is a list nobody defends. So the entry means exactly one thing: *no row in `CONSTRUCTS.md` states
its known answer.* For the well-covered constructs of §2.4 that will usually be a cheap row, because
the evidence exists and only the claim is missing; for the seven at zero it is a plant that does not
exist yet. Both are unrostered, they cost very different amounts, and the gate deliberately does not
pretend to know which is which — that is what `M154c`–`M154f` are for. The alternative considered
and rejected was two lists, `unrostered` and `unexercised`, which would have required someone to
classify all 163 up front and would have made the *cheap* half of the gate depend on the *expensive*
half being right.

### D740

<sub>cited from tflw-tests/CONTRIBUTING.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D740` — the ratchet's ceiling is a second, pinned integer.**
`D730` says the uncovered list may only shrink. The list is tracked, so growing it is a visible
diff — but that is social, and this pair of repositories has a documented history of properties that
held only because nobody got round to breaking them (`M141`/`D538`, `M149f-01`, `M115-03`).
`RATCHET_CEILING` is a pinned number the list's length must not exceed, on
`scripts/verify-test-counts.mjs`'s `EXPECTED` model — the precedent `D730` itself names. Adding an
entry therefore takes two edits in two places, the second being a number going *up* in a file whose
entire purpose is that it goes down. Lowering it is the ordinary business of every later milestone
and needs no ceremony.

### D741

<sub>cited from tflw-tests/CONTRIBUTING.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D741` — the coverage gate refuses a stale build; `check-acceptance` only annotates one.**
Both scripts grade the vendored tflw and `M153b-01` is about both, but the same staleness does two
different things to them. `check-acceptance.mjs` answers *does this corpus parse against the
released build* — against a stale one that is an **old** answer about a real program, and its own
docblock argues at length that grading the released build is the correct question there. So it
prints its provenance up front and, when it reports failures on a build that is not current, a
banner after them. `verify-construct-coverage.mjs` cannot do the same, because its ground truth
**is** the manifest that build emits: a vendored copy packed before a new keyword shipped emits a
manifest without it, the ratchet matches, and the gate goes green on precisely the day it was built
to go red. That is not an old answer, it is a confident wrong one, so provenance is a precondition
and a build outside `current`/`dirty`/`unknowable` exits 2 before anything is compared.
`unknowable` is in that set deliberately and is not a synonym for `current`: it is the ordinary
state on the remote build host, whose rsynced trees carry no `.git`, and treating it as a failure
would make the offload path unusable while treating it as a pass would make the check decorative. It
is its own state and it is printed.
---

### D742

<sub>cited from SPEC.md, tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D742` — the manifest has a seventh family, and `M154a` missing it was structural.**
`tflw spec --json` shipped six families; the parser also dispatches seven **declarations** (`test`,
`crawl`, `action`, `import`, `use`, `before`, `after`) and five `test`-header clauses (`tags`,
`with each`, `as`, `retry`, `parallel`/`sequential`), and none of them were constructs. That is not
a cosmetic omission: `D723` makes the manifest the ground truth and `D724` says *no construct
without a row*, so together they made a whole dialect **unrosterable** — the coverage gate could
not have gone red for it on any day, in any state. Found by scoping `M154c`, whose own list names
`retry` and `after` hooks. The argument for fixing it is the one `M154a` already recorded for
*adding* generators: a construct `M154c` plants "cannot be demanded by a gate that cannot see it".
Measured at the time: `after file` used **once** in the corpus, a bare `after` **twice**, `retry`
**five times**.

### D743

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D743` — a pure value transform is graded against a literal, with no target at all.**
A deliberate departure from `D725`, which says plants are always-present fixture modules. `base64`,
`hex` and `url` consume a value and return a value (`SPEC` §7.6); routing one through an apiV2 echo
endpoint would prove the HTTP client works and nothing whatever about the transform, while adding a
module, a route and a serialization layer between the claim and the thing claimed. So `C8`–`C10`
have `target: none` and assert against hand-written literals.

### D744

<sub>cited from tflw-tests/CONTRIBUTING.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D744` — the ladder's shared fixture values stay literal, and a gate proves they match the
constant.** `B6-15` asks to "single-source the fixture id", and the obvious reading is an import.
Refused, on a measurement ground rather than a convenience one: `dogfood-post-uncontended` is the
rung that isolates *POST with a static body and zero capture or interpolation overhead*, so
resolving the id at run time would change what that rung measures — and it would change it by a
**different amount in each of the three runners**, which is exactly the comparison the ladder
exists to make. A lookup on the tflw side, `open()` on the k6 side and a `processor.cjs` hook on the
Artillery side are three different costs; Artillery's YAML cannot import at all, so one of the three
needed a different mechanism regardless. Single-sourcing here therefore means *one source of truth
plus a gate proving the copies match it* — `D489`'s shape ("the file is the source and the markdown
is checked against it") applied to a value instead of a document.

### D745

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D745` — the workload-shape plants are graded against a standalone counter, not against apiV2.
This inverts `D726`'s placement in order to keep `D726`'s principle.**
`D726` says *generalize it into apiV2's `load-admin`*, on the principle that **the generator is
graded against physics, not against its own report**. The principle is kept in full; the placement
cannot be, because of what the target does to the measurement:

- In tflw's **closed** model (`N users`), a VU issues its next request when its previous one
  returns, so arrival rate is a function of *target latency*. Grade `ramp to 60 users over 20s`
  against apiV2 and the curve measured is Postgres's row-lock queue — the instrument reads the
  target and reports it as the generator.
- In the **open** model (`N rps`) the requirement arrives from the other side: the generator paces
  on its own clock, so the target must never be the constraint. A target that saturates makes a
  correct generator look broken.

### D746

<sub>cited from tflw-tests/tflw-acceptance/perf/README.md, tflw-tests/tflw-acceptance/perf/founding-runs/README.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D746` — the scheduled run leases as `tflw:load:conformance`, class `tflw:load`. `D733`'s new
`tflw:perf` class would have been a silent downgrade.**
`D733` says *"a new `tflw:perf` lease class"*. Measured against the dashboard's real table before
writing anything:

```
classify('tflw:perf')             -> load-run    requires=()          <-- the trap
classify('tflw:load')             -> tflw:load   requires=('quiet',)
classify('tflw:load:conformance') -> tflw:load   requires=('quiet',)
```

### D747

<sub>cited from tflw-tests/tflw-acceptance/perf/README.md, tflw-tests/tflw-acceptance/perf/founding-runs/README.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D747` — the run acquires through `boxlock.sh acquire`, never through plain `flock`.**
The dashboard decides who holds the box by walking /proc for processes running `boxlock.sh acquire`
and matching the holder file's pid against that walk (`collect/lock.py`). A job that takes the same
flock directly and writes the same holder file itself is reported as
`stale_holder: claim_without_process` with `holder: null` — a live, correctly-labelled holder
advertised as debris — and `statsctl check` then tells a forge render *"an unnamed job has held the
box"*, the least actionable answer it can give. Observed live 2026-08-25 against boxMoeLab's
`moebench.sh`, which re-implements the protocol that way; recorded as dashboard finding 196 and
deliberately **not fixed there**, because the two candidate fixes are not equivalent and choosing
between them needs the box quiet and that script's owner in the room. What this milestone owes is
that the tenant *it* adds does not have the problem. `~/Documents/CLAUDE.md` already says the mutex's
value is entirely in every heavy job calling it; this sharpens it to **calling it is not enough, the
call has to go through `boxlock.sh`** — two jobs can both participate correctly by the mutex's own
semantics and only one of them be visible to the instrument that reports on it.

### D748

<sub>cited from tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D748` — the scheduled run measures `origin/main` in its own checkout.**
`~/tflw-exec/testFlow-tests` is the rsync target `scripts/exec.mjs` maintains from the Mac. A
scheduled gate pointed at it grades whatever a Mac session last pushed there — arbitrarily stale,
possibly mid-rsync, attributable to no commit. The unit keeps its own checkout, fetches `origin/main`
into it, and the artifact records the sha. That is also the shape `M154f`'s functional leg needs,
with a second checkout of tflw.

### D749

<sub>cited from tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D749` — the runners are compared on matched populations, and every extractor fails loudly rather
than defaulting.**
tflw's `threshold … duration` reads *only the iterations that succeeded* (`SPEC` §12, `M89a`); k6's
bare `http_req_duration` reads every request. The sibling's `tflw-acceptance/README.md` §M89 records
that this exact mismatch made `M49`'s published 3.54% p95 gap a comparison of two different
populations for months, and that it held only *"because this scenario runs at a near-zero error
rate, where the populations coincide; that was luck, not design."* So the comparison reads
`http_req_duration{name:<k6Tag>,expected_response:true}`, and `k6Tag` is **declared per rung and
proved to exist** by `verify-perf-parity.mjs` — it is never the rung's own name (`checkout-burst`
measures `checkout`), so an extractor that guessed would have been wrong on all seven. Every reader
throws when its key is absent instead of yielding `undefined`, because a comparison gate whose inputs
quietly became `null` reports "no regression" forever, which is `M141`'s vacuity with extra steps.

### D750

<sub>cited from tflw-tests/CONTRIBUTING.md, tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D750` — the regression gate compares tflw against its co-runners in the same run, not against
last month's absolute numbers — and two of its rules need no calibration.**
Absolute throughput on the shared build box moves with thermal state, whatever else holds the lease, the
2.4 GHz link and the kernel. A gate on absolutes is either a flake generator or, once widened enough
to stop flaking, vacuous. The ladder already exists to answer a *comparative* question, and a ratio
between two runners measured in the same window cancels most of that variance; the absolutes ride
along in the artifact as history rather than as the gate.

### D751

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D751` — a construct whose known answer is already enforced by a dedicated gate is rostered by
*reference* to that gate, not by a hand-written row restating it.**
Taken 2026-08-25 while amending acceptance clause 5, and spent by `M154g`. The diagnostic family is
66 of the manifest's 178 and `scripts/verify-check-diagnostics.mjs` already grades every one of
them — against the assigned-code list read out of the **installed bundle's own §17 manifest**, so
the completeness claim is enforced by the binary under test rather than by a list somebody
maintains. Sixty-six hand-written rows would restate that as sixty-six claims *nothing* enforces,
and the roster would get longer while the evidence got weaker.

### D752

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D752` — a roster row that cites another gate is checked against that gate, in both directions, on
what the run actually did.**
`M154f` rosters five security constructs by pointing `CONSTRUCTS.md` at
`verify-security-acceptance.mjs` instead of writing five new plants, because that script's `LEDGER`,
`DECLINES` and `APPLICABILITY_PROBES` tables already state their known answers — and state them more
exactly than a plant row can. A `LEDGER` row names the rules that must fire **and** the rules that
are in play at that floor and must stay silent, which is a claim about a rule that produced nothing;
no plant row in this ledger has ever managed to say that. Writing the plants anyway would have
produced a second, weaker copy of an assertion that already runs on every sweep.

### D754

<sub>cited from tflw-tests/CONTRIBUTING.md, tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D754` — the schedule is disarmed; the gate is manual on demand until publish.**
`systemctl --user disable --now tflw-perf.timer` (2026-08-26). Timer and service both `disabled` and
`inactive`, no tflw entry in `list-timers`, lock free. **The units, the two checkouts and the
`tflwperf` tenant registry row stay installed and inert** — the deployment work was not wasted and
the eventual shape amends it rather than rebuilding it. Runs happen by asking, which is what has
actually been happening: today's ladder PASS was a manual invocation, not the timer's. `D733` is
**not reversed** — a scheduled run as a registered box tenant is still the right end state, and
`D747`'s lease ownership and `D748`'s reset-to-`origin/main` discipline are both vindicated and
retained. What is reversed is the claim that it can be scheduled *now*, on *this* box, against a
*clock*.

### D755

<sub>cited from tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D755` — the approval-gated daytime trigger is scoped and rejected before any code.**
The replacement considered was: auto-trigger during the day, notify through the dashboard, run only
on explicit approval, show the kill list at approval time, offer delay 1h/2h. It was taken far
enough to price and then stopped, and the reasons are recorded so it is not re-proposed from
scratch. (1) **Selectivity, not notification, is the hard part** — the run needs a quiet box
(`tflw:load` declares `requires: quiet`, kept as-is by decision), and a quiet box during working
hours is one nobody is using, so the prompt would mostly be *"may I kill what you are doing, in
order to measure something?"*. An approval prompt that is usually declined stops being read.
(2) **The kill list is the eviction clause wearing consent** — `M20`'s registry decided conflicts
are **refused, not auto-evicted**, and the neighbour is often a parallel session's forge render or a
17 GiB MoE server mid-task. (3) It is a lot of machinery whose own trigger is unattended code, so
the consent problem is relocated rather than solved.

### D756

<sub>cited from tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D756` — the box's dashboard project is not reopened; `D-CO-15` stands unamended.**
The dashboard was briefly taken back into scope to carry the notification, and then taken back out.
Its freeze names exactly one reopening trigger — *"the box surprised you in a way the instrument
could not explain"* — and that is not what happened: the instrument explains this fine, nobody had
asked it. A fourth reopening on *"a capability that would be useful"* is the precedent that
dissolves the rule, and `tflwperfctl.sh`'s own header already names the endpoint — *"a mutating verb
that kicked off a 20-minute load run because someone clicked a button in a dashboard would be the
worst possible reading of `D20`"*. That sentence stays true only while no such button exists.
`PLAN_M14_WAKE.md`'s W3 (RTC scheduled wake) was re-read and stays won't-do under `D-CO-9`: it
cannot wake the box from the power-off state observed on 26 Aug, and *"a box that wakes at 08:00 to
a sleeping Mac has woken to nobody"*.

### D757

<sub>cited from tflw-tests/CONTRIBUTING.md, tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D757` — `M124-03` is re-deferred against publish, and the closure is retracted rather than
edited away.**
Status `✅ closed` → `⏸ deferred against a condition`, ledger `354 closed / 14 deferred` →
`353 closed / 15 deferred`, total unchanged at 387, `verify:ledger` green. The retracted text is
kept in the cell under *"Superseded, kept for the record"* because the wrong sentence is the
instructive one. **The new condition is publish**: the two shapes this row has named since `M85` —
a scheduled sibling run that catches it late, or a `BREAKING:` convention that catches only what
someone labelled — are still both bad, and nothing since has told us which. Once there is a
published artifact for a sibling to break against, the choice is informed rather than guessed.

### D758

<sub>cited from tflw-tests/CONTRIBUTING.md, tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D758` — the measured perf gate is a phase of the regression sweep, and the sweep is where it
lives now.** `scripts/regression.mjs` gains `perf-ladder`, running
`node scripts/perf-conformance.mjs --profile sweep --in-sweep`. `D733` is still not reversed: a
registered box tenant remains the right end state and the units, both `~/tflw-perf/` checkouts and
the `tflwperf` registry row stay installed and inert. What changed is that the gate no longer waits
for that end state to arrive before it guards anything.

### D759

<sub>cited from tflw-tests/CONTRIBUTING.md, tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D759` — inside the sweep the lease is inherited, verified, and neither re-taken nor waived.**
This is the finding that made the whole shape work, and it was not visible from the design.
`scripts/exec.mjs` already holds the whole-box lock as `tflw:<label>` for the entire sweep, by the
same mechanism this file uses (`D747`): an open stdin that dies with the driver. `boxlock.sh` is a
whole-box mutex and is **not reentrant**, so a phase calling `acquire` inside that would have waited
out its own parent and failed `EX_TEMPFAIL` after the timeout. Worth being precise about: that
deadlock is the *correct* behaviour of a correct mutex. There was nothing to fix in the lock, only
something to stop asking of it.

### D760

<sub>cited from tflw-tests/CONTRIBUTING.md, tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D760` — the sweep phase runs a new `sweep` profile (`ladder` + `functional`), not `full`.** The
omission is `curve`. `full` is right for a run whose entire purpose is the measurement; as a *phase*
the arithmetic differs. The sweep already costs 30 phases each paying a Docker restart, and `curve`
is the breaking-point search: the longest leg, the most sensitive to a neighbour, and the one whose
answer moves least between two commits on a branch. `ladder` is the leg that catches a regression
(7 rungs, ratio bands, ~4 min measured) and `functional` is 55 s. Those two are a cost a developer
keeps paying; adding the breaking-point search is one they start skipping, and **a gate that gets
skipped is worth less than a smaller gate that does not.** `--profile full` is exactly as available
as it was.

### D761

<sub>cited from tflw-tests/CONSTRUCTS.md, tflw-tests/CONTRIBUTING.md, tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D761` — the phase is `localOnly` by declaration, and "not this machine" is a third verdict.**
`perf-ladder` carries `localOnly: true` in a field `regression.mjs`'s partition guard reads: an
ungrouped phase still fails the build, and a `localOnly` phase found *inside* a `PHASE_GROUPS` entry
now fails it too, because that would put a four-minute box measurement onto a GitHub runner where it
can only fail in a way that reads as a perf regression. Off the box `perf-conformance` exits **3**,
which the sweep renders `⊘ skipped (skipped — not the box)`, counts separately, and never totals as
a pass. Two separate refusals to be silent, both of them this pair of repositories' oldest failure
shape.

### D763

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D763` — a roster row may state a *rule* instead of a list, and the anti-regression duty moves to
the gate it cites.**
Taken 2026-08-27, spending `D751` on the diagnostic family. `D751` settled that a construct already
enforced by a dedicated gate is rostered by citing that gate; it did not settle how **sixty-six of
them at once** are rostered, and the obvious answer is the wrong one. A `coveredBy: [...]` list of
sixty-six ids would be a hand-maintained wordlist inside the very gate whose header refuses hand-
maintained wordlists (`D659`), and it would go stale in the one direction nobody checks — silently
reading as evidence. So `REFERENCE_ROSTERS` names a **family and a grader**, and
`verify-construct-coverage.mjs` expands it against `tflw spec --json` on the day it runs. The ids
exist in exactly one place, which is tflw.

### D764

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D764` — a ratchet condition is audited against the decision it cites, never read as provenance.**
Taken 2026-08-28 while judging acceptance clause 5. `D739` settled what a `RATCHET` entry *asserts*
— no known-answer row, never *never exercised* — and nothing settled what its stated **condition**
has to be. It has to name a requirement, and any decision it cites has to actually state that
requirement. Three entries here read *"a Tier 3 assertion costs an order of magnitude more requests
than a Tier 2 one (`D380`) and the cost was judged too high for every-PR"*, and `D380` decides
something else entirely: that the ~45 real test files are Tier 3's **negative corpus and its volume
measurement**, which is `sweep-input-volume.mjs` and its 240 observed requests. A different script,
a different corpus, a different question.

### D765

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D765` — the Tier 3 grader becomes a `regression.mjs` phase, and the cost claim is retracted as
measured rather than argued.**
Taken 2026-08-28, built the same day. `verify-input-acceptance.mjs` states its known answers in
full, asserts them, exits non-zero, and ran in **no automated pass at all** — which is `M137e-01`
for the third time, and `D493` already settled that remedy in `M139-5` for the Tier 1/2 grader
sitting one phase above it. So this needs no new mechanism: `input-acceptance`, `VULN_MODE=1`, group
`core`, an ordinary gated phase.

### D767

<sub>cited from tflw-tests/CONSTRUCTS.md, tflw-tests/CONTRIBUTING.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`D767` — a count in prose is a copy with no guard, so `D504` deletes the number as well as the
list.**
Taken 2026-08-28, from a defect found by touching the sentence rather than by looking for it.
`D504` keeps the sweep's phase *list* out of `CONTRIBUTING.md` because a copy of it in prose would
be a copy with no guard, and `PHASE_GROUPS` is already held to `PHASES` by a partition guard. It
left the **count** in, and the count said `30` while `PHASES` held `38` — eight phases arriving
across six milestones with nothing anywhere able to notice. Seven occurrences across four files.

### D781

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M157_TEARDOWN.md`</sub>

**D781 — teardown runs by default under load; the `cleanup` gate is deleted**

`after` hooks run after **every** iteration, passing or failing, exactly as `before` hooks already
do. The `cleanup` keyword is removed from the language.

### D782

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M157_TEARDOWN.md`</sub>

**D782 — hook time leaves `durationMs`; this is the defect `D26` actually found**

`iterStart`/`iterEnd` narrow to `scenario.body` only. Hook steps stop contributing time to
`durationMs`, and therefore to `successHistogram` and every `threshold pNN duration` clause.

### D783

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M157_TEARDOWN.md`</sub>

**D783 — `teardown` is a three-valued level, and every value answers the same question**

```
teardown always      # default — after every iteration
teardown on success  # only after iterations that passed
teardown never       # after none of them
```

A `CONFIG_KEYS` entry (`parser.ts:537`) with a `--teardown LEVEL` flag overriding it for one run,
which is `evidence`'s shape verbatim — a config key plus a run-only flag override (`SPEC:3236`),
serving the same forensic purpose. A level rather than a boolean for `evidence`'s reason;
`insecure <bool>` is the only closed-set directive shaped otherwise.

### D784

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M157_TEARDOWN.md`</sub>

**D784 — workload-only, matching what `cleanup` gated**

`teardown` governs `after` hooks under `run … iterations` and nothing else. Functional `after` hooks
run unconditionally, as they do today (`:2754`).

### D785

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M157_TEARDOWN.md`</sub>

**D785 — any level other than `always` announces itself on every run**

Unconditional, on the existing advisory channel (`cli.ts:2382`'s reuse-hint block, `ℹ demo:`,
`ℹ authz coverage:` — *"advisory only, never affects the exit code"*):

```
ℹ teardown: disabled (`teardown never`) — 8000 iterations left their data in place
ℹ teardown: on success — 400 of 8000 iterations failed and left their data in place
```

### D786

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M157_TEARDOWN.md`</sub>

**D786 — `teardown never` skips the hook, assertions included; documented, not detected**

tflw cannot distinguish teardown from verification inside an `after` block, and
`tests/examples/hooks-explained.tflw` shows why the distinction is not academic:

```tflw
after
  api DELETE /products/{productId}
    header "Authorization" is "Bearer {adminToken}"
  expect status equals 204
```

### D787

<sub>cited from CHANGELOG.md · lifted from `PLAN_M157_TEARDOWN.md`</sub>

**D787 — `D26` is superseded and left standing, not amended and not deleted**

`D26` keeps its text; `D781` opens by superseding it, and `D26` gains one pointer line naming the
successor and §2.4's three arms as the evidence.

### D788

<sub>cited from SPEC.md · lifted from `PLAN_M157_TEARDOWN.md`</sub>

**D788 — the manifest loses a row and gains one**

- **Deleted:** `spec-data.ts:230`, the `cleanup` row (family `step`, tier `workload`).
- **Added:** a `teardown` row in `config`, `slot: 'key'`, following `evidence`'s shape.

### D789

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M157_TEARDOWN.md`</sub>

**D789 — plant `C48` is rewritten, not deleted**

`constructs.mjs` `C48` (`step:cleanup`) grades the contrast this milestone removes: *"exactly 8
requests — one per iteration of the test that carries `cleanup`, and none from the sibling test that
omits it."* Under `D781` the correct answer becomes 16.

### D790

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M158_GATE_MANIFEST.md`</sub>

**D790 — the completeness gate derives its construct set from `specConstructs()`**

`scanConstructCoverage` stops building a set and reads one. The four ad-hoc sources go away,
`grammarPhrases` included.

### D791

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M158_GATE_MANIFEST.md`</sub>

**D791 — diagnostics are excluded by name, and the exclusion is the only one**

`specConstructs()` returns 178; 66 are diagnostics, already held to the docs by
`diagnosticsCoverage.test.ts` since `M86`. The gate excludes family `diagnostic` **explicitly**, in
one line, with that citation beside it — not by omitting a manifest and letting the number come out
right by accident, which is exactly how 111 happened.

### D792

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M158_GATE_MANIFEST.md`</sub>

**D792 — every construct is matched on its syntax shape, never on its bare id**

This is the decision the milestone turns on, and it is not in the row.

### D794

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M158_GATE_MANIFEST.md`</sub>

**D794 — `NOTATION` is deleted and `doc-blocks.mjs` calls the citation classifier it does not own**

The half of `M153a-01` that `specConstructs()` cannot serve is served by *the other classifier*.
`verify-citations.mjs`'s `JSON_RULES` is the strictly better of the two — it resolves shapes
`NOTATION` provably cannot (`E4` with no pattern for `E4`) because it reads context, not shape.

### D795

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M158_GATE_MANIFEST.md`</sub>

**D795 — a cross-package import needs a stated direction, and it is scripts -> docs-site**

`packages/docs-site/scripts/doc-blocks.mjs` importing from the repo-root `scripts/` is a new edge.
It is taken in that direction (docs-site depends on the root guard, never the reverse) because
`verify-citations.mjs` already reads **both repositories** and has no docs-site knowledge, while
`doc-blocks.mjs` is scoped to one package. The dependency follows the breadth.

### D797

<sub>cited from SPEC.md · lifted from `PLAN_M159_DIALOGS.md`</sub>

**D797 — `armedDialog` becomes a queue**

A `readonly armedDialogs: DialogArming[]`, pushed by the step, shifted by the handler. An empty
queue keeps today's behaviour exactly: dismiss, which is what an unarmed page already does.

### D798

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M159_DIALOGS.md`</sub>

**D798 — `dialog message` becomes a value subject**

    click button "Delete"
    expect dialog message is "Delete this product? This cannot be undone."

### D799

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M159_DIALOGS.md`</sub>

**D799 — `dialog type` becomes a value subject**

    expect dialog type is "confirm"

### D800

<sub>cited from SPEC.md · lifted from `PLAN_M159_DIALOGS.md`</sub>

**D800 — `accept dialog with "<text>"` answers a prompt**

    accept dialog with "Blue"
    click button "Set favourite colour"
    expect dialog type is "prompt"

### D801

<sub>cited from SPEC.md · lifted from `PLAN_M159_DIALOGS.md`</sub>

**D801 — `accept dialog with` on a non-prompt is `TF080`, at runtime**

Playwright **silently ignores** `promptText` when the dialog is not a prompt. That is precisely the
silent-no-op class this milestone exists to remove, so tflw does not inherit it:

### D802

<sub>cited from SPEC.md · lifted from `PLAN_M159_DIALOGS.md`</sub>

**D802 — an unconsumed arming at the end of a test is `TF079`, a warning**

A `dismiss dialog` that no dialog ever answers is a test asserting something that did not happen.
Under a single slot this was invisible; under a queue it is a leftover entry, which is free to
detect.

### D804

<sub>cited from SPEC.md · lifted from `PLAN_M159_DIALOGS.md`</sub>

**D804 — `SPEC` §9.1 states, per kind, what can and cannot be asserted**

The table in §2.2 goes into `SPEC`, and with it the sentence the corpus has never needed:

### D806b

<sub>cited from SPEC.md · lifted from `PLAN_M159_DIALOGS.md`</sub>

**D806b — `TF079` reports per arming, at its line, and only on a test that passed**

*(`M159d`, taken during the build. An amendment to `D802`, numbered beside `D806a` for the same
reason: `D807` is `M160`'s and already spent.)*

### D807

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M160_LATENCY_PRECISION.md`</sub>

**D807 — the five precision-critical sites carry a float; the sixteen wall-clock sites do not**

`durationMs` becomes an unrounded `number` at those five sites only. The remaining sixteen keep
`Math.round`, and the reason is stated at each: they measure a span no consumer resolves below a
millisecond, and a `durationMs: 4823.917261` in a test result is noise wearing precision.

### D808

<sub>cited from CHANGELOG.md · lifted from `PLAN_M160_LATENCY_PRECISION.md`</sub>

**D808 — the type does not change; the contract in the comment does**

`durationMs` is already `number`. TypeScript will not notice this milestone, which means nothing
mechanical will catch a consumer that assumed an integer. So the invariant moves into the two places
that state contracts: `types.ts`'s field doc, and `histogram.ts`'s header, which stops claiming
exactness it does not have and starts claiming the one it will.

### D809

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/tflw-acceptance/perf/founding-runs/README.md · lifted from `PLAN_M160_LATENCY_PRECISION.md`</sub>

**D809 — rendering rounds, and every renderer rounds the same way**

One helper, one rule, applied at every point a duration becomes text or JSON:

- **`>= 10 ms` -> integer.** Nothing below the first decimal matters at that scale.
- **`< 10 ms` -> two significant digits** (`0.37`, `3.3`).

### D810

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M160_LATENCY_PRECISION.md`</sub>

**D810 — `expect duration is less than N` compares the float**

The comparison uses the unrounded value. A 0.6 ms request currently passes `is less than 1`
(rounds to 1, and 1 < 1 is false — it currently **fails**) — that inversion is exactly the class of
surprise this milestone removes.

### D813

<sub>cited from SPEC.md · lifted from `PLAN_M161_VALUE_FORM.md`</sub>

**D813 — `stringify()` is the language's stated string form, promoted out of `eval.ts`**

It is currently an implementation helper that happens to be right. It becomes the named rule, stated
in `SPEC` §7 as a table — date -> ISO-8601 UTC, null -> `null`, number/boolean -> JS default,
object/array -> JSON, string -> itself — and every consumer is checked against it.

### D814

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M161_VALUE_FORM.md`</sub>

**D814 — `hex encode` emits lowercase, in `SPEC`**

The sentence `M154c-02` was filed for. Lowercase is what ships, what `Buffer` produces and what
every consumer has, so the content is not in doubt — the row was filed because *choosing* it is a
decision and a plant quietly promoting an implementation detail to a contract is how a spec gap
becomes invisible.

### D815

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M161_VALUE_FORM.md`</sub>

**D815 — the `unique` family is keyed correctly across every boundary it crosses**

Two defects, one rule: an index only means something inside the space it was minted for, and
`unique` currently crosses two boundaries without saying so.

### D834

<sub>cited from CHANGELOG.md · lifted from `PLAN_M160_LATENCY_PRECISION.md`</sub>

**D834 — tflw publishes its own rounding rule in the artifact contract; the sibling reads it**

`ARTIFACT_CONTRACT` gains a `durations` block naming `D809`'s rule as data, and
`derive-perf-bands.mjs` computes its quantum from that instead of from a local literal. This is the
seam's existing job: the registry exists for exactly "a shape this project can rename out from under
a consumer's gate", and a rounding rule the sibling's band derivation depends on is that, in the
only sense that matters — `M160a` changed it and the sibling had no way to know.

### D835

<sub>cited from tflw-tests/tflw-acceptance/perf/founding-runs/README.md · lifted from `PLAN_M160_LATENCY_PRECISION.md`</sub>

**D835 — the reporting bound belongs to the run, not to the checkout**

`D834` published the bound and had `derive-perf-bands.mjs` read it from the **installed** tflw. That
is the same category error `D834` had just fixed, pointed the other way. A bound describes the build
that *produced* a reading; the artifacts on disk were produced by builds that are no longer
installed, and nothing about having a current tflw in `node_modules/` makes a two-month-old
measurement newly precise.

### D836

<sub>cited from tflw-tests/tflw-acceptance/perf/founding-runs/README.md · lifted from `PLAN_M160_LATENCY_PRECISION.md`</sub>

**D836 — contribution is per-metric, not just per-rung**

`derive-perf-bands.mjs` suppressed a rung's whole `p95Ratio` when **any** contributing run reported
too coarsely. Correct as far as it went, and one axis short: coarse reporting disqualifies a run's
**p95**, not its **rps**. A count of completed iterations does not become less true because the
percentile printed beside it was rendered to a whole millisecond.

### D837

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M158_GATE_MANIFEST.md`</sub>

**D837 — the config family carries no `syntax`, so its matcher comes from `slot` + `id`**

**Minted during the build, not at scoping.** `D792` says the match is the construct's syntax,
*"which every manifest row already carries"*. Measured at HEAD that sentence is false for **25 of the
112** non-diagnostic constructs, and they are exactly the config family: `ConfigKeywordEntry` carries
`id`, `slot` and `summary`, and no shape at all.

### M0

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN.md`</sub>

- **M0 — skeleton + parser.** npm workspace, `lang/` with lexer + recursive-descent parser +
  diagnostics for a minimal **API-flavored** grammar (`test`, `api GET/POST`, `expect
  status/body.path`, `let`/`capture`). Golden tests on AST and on error-message output (errors
  are a feature: snapshot them).

### M1

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

- **M1 — API vertical slice.** Interpreter executes an API-only test via fetch; config dialect
  (envs, `defaults`, 3-tier selection, `require env` + `.env`); core matcher set on
  status/header/body paths; `capture`/chaining; event stream → minimal `report.html` with
  secret redaction from day one; `tflw run` + `tflw init` (API-only scaffold). One real test
  passes against the POC api.

### M2

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

- **M2 — API breadth.** `any`/`all` quantifiers, fail-fast semantics + `wait until api`, named
  services, all four body forms (+ `body text`), `duration`/per-step `timeout`/`without
  redirects`, the `unique`/`random` generator family (incl. `like` templates), seeded runs +
  `--seed` replay, value expressions (arithmetic + date math), actions with `give` returns +
  `import`, JS escape hatch (`use`). An API-only dogfood mini-suite runs green.

### M3

<sub>cited from SPEC.md, tflw-tests/README.md · lifted from `PLAN.md`</sub>

- **M3 — browser half (v0.2.0 public).** Playwright binding: `open/click/fill` + `fill form`,
  tiered selector resolution + `css`/`xpath` escapes + `element` aliases, auto-retrying UI
  expects, the browser half of `session` blocks (cached storage state; the API half shipped in
  M2.6) + fresh context per test, screenshots in the report, lazy `tflw install-browsers`
  (+ `init --ui`) which now also npm-installs the optional `playwright` peer (P#44).
  A mixed UI+API test passes against testFlow-tests' frontend (already built, waiting for this
  milestone — see its own PLAN.md's M2).

### M3a

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md, tflw-tests/README.md · lifted from `PROGRESS.md`</sub>

**M3a — browser core: Playwright peer, interaction steps, selector model, UI expects, dialogs**

**Was displaced by the enterprise-readiness arc (`PLAN_ENTERPRISE.md`, decision 2, 2026-07-18);
resumed 2026-07-26 once that arc (M9–M26) finished, re-scoped into M3a–M3e per a same-day
`/grill-me` (`PLAN_BROWSER_PERF_SECURITY.md` §1.12).** M3a is the first slice — the core
vocabulary + selector model + UI-expect retry loop; frames/tabs/downloads/drag-drop (M3b), the
`report/` directory + screenshots (M3c), network observe/mock (M3d), the a11y subject (M3e), LSP
catch-up (M4a), and visual regression (M4b) all follow separately.

### M3b

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md, tflw-tests/README.md · lifted from `PROGRESS.md`</sub>

**M3b — frames/tabs/windows/downloads, drag-drop, `wait until <ui>`**

Second browser-arc slice, same day as M3a (both under the `PLAN_BROWSER_PERF_SECURITY.md` §1.12
re-scope). Builds directly on M3a's selector model/D6/D7 machinery and `BrowserPageState` — no
architecture changes, only additions.

### M3c

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PROGRESS.md`</sub>

**M3c — `report/` directory, failure screenshots + trace, `--browser`/`--headed`/viewport**

Third browser-arc slice, same day as M3a/M3b's own kickoff (`PLAN_BROWSER_PERF_SECURITY.md`
§1.12). Builds on M3a's `BrowserManager`/`BrowserPageState` — no architecture changes, only
additions: `report/` was already a directory in practice (`report.html`/`junit.xml`/`results.json`/
`.last-run.json` all already lived there, P#111) — what M3c actually adds is the
`assets/` subdirectory plus everything that fills it.

### M3d

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PROGRESS.md`</sub>

**M3d — network observation + `intercept`/`stub`**

Fourth browser-arc slice, same day as M3a/M3b/M3c (`PLAN_BROWSER_PERF_SECURITY.md` §1.12). No
architecture changes — reuses M3a's `BrowserManager`/`BrowserPageState` and (per §5.3's existing
response-subject shape) `status`/`header`/`body`/`body text` rather than inventing parallel
subjects. Decided against a second `intercept` keyword: the plan's "`intercept`/`stub` grammar"
reads as shorthand for one feature area, not two overlapping constructs — `stub` alone covers it.

### M3e

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PROGRESS.md`</sub>

**M3e — accessibility subject (axe-core)**

- [x] `page` subject (ast.ts/parser.ts) — a bare subject like `RequestSubject`, meaningful only
      with the new `hasNoA11yViolations` matcher; `expect`/`check page has no [<severity>] a11y
      violations`, `<severity>` one of `minor`/`moderate`/`serious`/`critical` (axe-core's own
      impact scale), optional
- [x] Severity is a **floor, not an exact match** — `has no serious a11y violations` also counts
      `critical` findings (`filterBySeverity`, `finding.ts`), so a worse violation can't quietly
      slip under a lower bar; deliberate house-style decision, documented in SPEC §9.8
- [x] Real axe-core integration (`a11y.ts`): `axe-core` is a second optional peer dependency
      alongside `playwright` (D5's exact dynamic-import-on-first-use pattern — `import.meta.resolve`
      resolves `axe-core/axe.min.js`, read once and injected via `page.addScriptTag`, cached per
      page via a `window.axe` presence check so a retry-poll doesn't re-inject on every iteration);
      `page.evaluate(() => axe.run())` maps real violations onto the generic `Finding` model
- [x] **Scan-and-assert machinery built for reuse** (D14's explicit requirement): `finding.ts` is
      scanner-agnostic (`Severity`/`SEVERITY_RANK`/`Finding`/`filterBySeverity`) with zero
      axe-core/Playwright imports — `a11y.ts` is the only file that knows axe-core exists. The
      pentest scan arc (v1.2.0) is meant to map its own findings onto this same `Finding` shape
      instead of inventing a second severity vocabulary and filter/count implementation
- [x] `execA11yExpect` (interpreter.ts) retries to `timeout expect` like `execUiExpect`/
      `execNetworkExpect` — re-runs a full scan on *every* poll (not cached once), so a page still
      hydrating (a label attached once data loads) gets the same "not yet, not never" grace a
      not-yet-rendered locator already has; verified with a real page that fixes its own violation
      400ms after load and a test with no explicit wait
- [x] A failing assertion lists up to 5 real violations (rule id/severity/description/target
      pointer) in the failure message, not just a count — the diagnostics pillar applied here too
- [x] `checkRequestAssertions` (checker.ts) updated so `page` is exempt from the connects/fails
      "can't combine with a response-based assertion" restriction (TF031), same reasoning as M3d's
      `NetworkRequestSubject` exemption — it reads the page's DOM, not the `api` step's response
- [ ] Dogfood against testFlow-tests' `webV2` frontend — still waits on the eventual `.tflw` UI
      suite itself (M7's acceptance corpus, not this milestone) and its planned
      deliberately-inaccessible dogfood corner (PLAN_BROWSER_PERF_SECURITY.md §4.1); M3e is
      verified via this repo's own real-browser suite (below), same as M3a–M3d were

### M4

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

- **M4 — browser-era polish.** Trimmed twice (P#40, P#47): tags/hooks/retry/check/tables/
  junit went to M2.5, parallel workers to M2.6. What remains: full report polish once M3 lands
  (screenshots per browser step alongside the API panels/timeline), and hardening workers for
  browser-sized suites (worker_threads/processes behind the same `workers` setting if in-process
  concurrency proves insufficient).

### M4a

<sub>cited from SPEC.md, tflw-tests/tflw-acceptance/README.md · lifted from `PROGRESS.md`</sub>

**M4a — browser-arc LSP + VS Code catch-up**

Batched at the end of the arc rather than per-construct (D24b) — editor support degrades
gracefully mid-arc, and the per-construct multiplier isn't worth paying three times over M3a–M3e.

### M4b

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PROGRESS.md`</sub>

**M4b — visual regression**

PLAN_BROWSER_PERF_SECURITY.md §1.10/§1.11/D15's design, built end to end: a new `matchesSnapshot`
matcher (`expect page|<locator> matches snapshot "<name>" [mask <locator>]*`) plus a runtime-owned
compare/update pipeline — no existing infrastructure to lean on beyond D12's `report/` directory
(already in place) and Playwright's own `screenshot({ mask })` option, which turned out to be the
exact mechanism D15 was asking for.

### M5

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

- **M5 — coding UX.** `tflw watch` (headed re-run, browser stays open, reuses the last failing
  seed), tiered-resolution failure diagnosis with near-match suggestions, `tflw pick`, VS Code
  extension.

### M6

<sub>cited from SPEC.md · lifted from `PLAN.md`</sub>

- **M6 — reuse pass.** Similarity detection across the suite → diagnostics with prepared
  extraction → `tflw refactor apply`. Tested on deliberately duplicated tests in testFlow-tests
  (its own PLAN.md's M4).

### M7

<sub>cited from SPEC.md, tflw-tests/tflw-acceptance/README.md · lifted from `PLAN.md`</sub>

- **M7 — acceptance (the browser arc's own gate, `0.2.0`-equivalent — P#112 amends the
  original "1.0 gate" framing below).** Build out the 10-test dogfood suite (testFlow-tests) + its
  own feature extensions; run the side-by-side vs raw Playwright; write FINDINGS in PROGRESS.md.
  This verdict gates the **browser arc** (P#41, P#50 as originally written; P#112
  clarifies it isn't the literal `1.0.0` publish gate — that now waits on perf + pentest + a final
  integrated acceptance pass too), not the first publish (that happened at M2.7): on a win, ship
  `tflw migrate` (P#45's deliverable) and freeze the grammar additive-only (P#38) —
  both done, unaffected by the version-label correction.

### M9

<sub>cited from CHANGELOG.md · lifted from `PLAN.md`</sub>

- **M9 — Auth (enterprise arc cluster 1 of 6).** Added by `PLAN_ENTERPRISE.md` (decisions 1–3, 13,
  14; see decision 99 for the full writeup) — the first cluster of the enterprise-readiness arc,
  which **displaces M3 (browser half)** as tflw's next work. Session refresh-on-401 + TTL expiry
  (general — works for any session, not just oauth2); `oauth2` session sugar (client-credentials
  grant, built on top of refresh); mTLS client certs (`cert`/`key` config, a narrowly-scoped bundled
  `undici` dependency, `dist/cli.cjs` bundle-format fix). Immediately followed by testFlow-tests'
  M22 consumption milestone (nginx TLS sidecar + `/oauth/token` fixture + real `.tflw` coverage)
  before cluster 2 (Safety/redaction) starts.

### M10

<sub>cited inside a range only · lifted from `PLAN.md`</sub>

- **M10 — Safety/redaction (enterprise arc cluster 2 of 6).** Added by `PLAN_ENTERPRISE.md`
  (decisions 5/9/14; see decision 101 for the full writeup) — immediately follows cluster 1 (M9).
  `allow hosts` config allowlist (accumulates like `header`; enforced before any network I/O, both
  for `api` steps and the `oauth2` token request); `--forbid-insecure` CI policy gate; `evidence
  full|headers-only|none` + `--evidence` override (trims the report-only trace, never what
  `expect`/`capture` see); `redact body.email, body.*.address` declarative field masking (a
  separate path type from `expect`/`capture`'s, distinct mechanism from the existing taint-based
  secret redaction). Immediately followed by testFlow-tests' M23 consumption milestone (a new
  PII-rich profile/export apiV2 fixture + real `.tflw` coverage) before cluster 3 (Contract +
  Retry-After) starts.

### M11

<sub>cited from packages/lang/GRAMMAR.md · lifted from `PLAN.md`</sub>

- **M11 — Contract + Retry-After (enterprise arc cluster 3 of 6).** Added by `PLAN_ENTERPRISE.md`
  (decisions 5/6/14; see decision 102 for the full writeup) — immediately follows cluster 2 (M10),
  closes TFLW-GAPS.md gaps #5 and #6. `expect body matches schema "Name" from "source"` contract
  validation (real ajv against an API's own `/openapi.json`, a second bundled dependency alongside
  `undici`, `evaluateExpect`/`execExpect` now async to fetch it); `retry honoring "Retry-After" up
  to N`, a per-`api`-step retry clause (not a reuse of `test … retry N`, which retries the whole
  test) that re-issues just one request, honoring both seconds- and HTTP-date-format headers.
  Immediately followed by testFlow-tests' M24 consumption milestone (new `retry-demo`/
  `contract-demo` apiV2 fixtures + real `.tflw` coverage) before cluster 4 (CI ergonomics) starts.

### M12

<sub>cited inside a range only · lifted from `PLAN.md`</sub>

103. **M12 — Documentation site** — cluster 4 of the (now 8-cluster) enterprise-readiness arc
    (`PLAN_ENTERPRISE.md` decision 16, a `/grill-me` session 2026-07-19), immediately following
    cluster 3 (P#102). Unlike clusters 1–3, this cluster adds no DSL grammar or runtime
    behavior, so it has **no testFlow-tests consumption milestone** — the cadence exception
    enterprise decision 16 documents. Six lettered sub-parts, from a canonical `spec-data.ts` manifest
    through a new VitePress `docs-site` workspace, a parse-and-check playground, a `GRAMMAR.md`
    rewrite and a README trimmed to a landing page, to the workflow that publishes the site.

### M13

<sub>cited from SPEC.md · lifted from `PLAN_M13_LSP.md`</sub>

**M13 — LSP (enterprise arc cluster 5 of 8)**

The full v1 language-server feature set — diagnostics, hover, go-to-definition, autocomplete,
rename, signature help — in one milestone, behind a new `tflw lsp` subcommand serving a new
`packages/lsp-server`. `packages/vscode` is rewritten as a thin `vscode-languageclient` shell over
it, which is what turns a VS Code feature set into an editor-independent one.

### M14

<sub>cited inside a range only · lifted from `PLAN.md`</sub>

108. **M14 — Connection-failure assertions: `request connects`/`fails`** — cluster 5.5 of the
    enterprise-readiness arc (`PLAN_ENTERPRISE.md` decisions 18–19, a third `/grill-me` session
    2026-07-20, prompted by planning `testFlow-tests` CI). Closes the gap enterprise decision 18 identified:
    a request that fails *before* any HTTP response exists (a TLS handshake rejection, DNS
    failure, `ECONNREFUSED`, an `allow hosts` block) always crashed the whole test fail-fast, with
    no way to write a genuinely passing regression test proving a guardrail actually triggers.
    Full fidelity across every package — grammar, checker, runtime, language server, docs and
    tests — the same bar as clusters 1–3.

### M15

<sub>cited inside a range only · lifted from `PLAN.md`</sub>

109. **M15 — Docs site polish: diagnostic codes reference + home page "Why tflw"** — cluster 9 of
    the enterprise-readiness arc (`PLAN_ENTERPRISE.md` decision 20, a fourth `/grill-me` session
    2026-07-20, a proactive readability/guidance audit of the live docs site — not a reaction to a
    specific complaint). Cadence exception like clusters 4/5: no new DSL grammar or runtime
    behavior, so no `testFlow-tests` consumption milestone.

### M16

<sub>cited inside a range only · lifted from `PLAN.md`</sub>

110. **M16 — Docs site: running & debugging tests guide + getting-started prerequisites** — a
    direct follow-up to M15/P#109 (cluster 9), user-reported this session (not a `/grill-me`
    interview — a scoped, self-contained content gap, same weight as the `.gitignore` fix folded
    into M15). The user pointed out the doc site had almost no material on actually *running* a
    test (what the CLI prints), *debugging* a failure, or the pre-conditions needed before `tflw
    run` works at all — `getting-started.md`/`first-test.md` showed the `.tflw` snippet and the
    `npx tflw run` command but never what success or failure actually look like in a terminal, and
    nothing walked through `--verbose`/`--only`/`--seed`/`tflw check`/`report.html` as a debugging
    workflow (those flags existed only as a bare table in `reference/cli.md`).

### M17

<sub>cited inside a range only · lifted from `PLAN.md`</sub>

111. **M17 — CI ergonomics + console/log output** — enterprise arc cluster 6
    (`PLAN_ENTERPRISE.md` decision 21, a fifth `/grill-me` session 2026-07-20). Enterprise decision 7's
    original scope (`--format json`/`results.json`, `--failed`, `--bail`) plus a second topic
    folded in at the user's request: console/log output (NDJSON event stream, timestamps, GitHub
    Actions log grouping, `--log-file`). Not cadence-exempted (unlike clusters 4/5/9) — this is a
    real CLI/runtime behavior change, so it gets a normal `testFlow-tests` consumption milestone,
    merged into enterprise decision 19/`PLAN_CI.md` rather than a separate one (see that decision's amended
    note, 2026-07-20).

### M18

<sub>cited from SPEC.md · lifted from `PROGRESS.md`</sub>

| Milestone | Status | Started | Finished |
|---|---|---|---|
| M18 — gap #9 backfill: spec-data/LSP/docs-site/VS Code for `base64`/`hex`/`url` (enterprise arc cluster 8 kickoff) | ✅ | 2026-07-23 | 2026-07-23 |

### M19

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PROGRESS.md`</sub>

| Milestone | Status | Started | Finished |
|---|---|---|---|
| M19 — gap #10: `upload ... type "..."` Content-Type (enterprise arc cluster 8) | ✅ | 2026-07-23 | 2026-07-23 |

### M20

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

| Milestone | Status | Started | Finished |
|---|---|---|---|
| M20 — test-coverage audit follow-up: VS Code extension activation test | ✅ | 2026-07-23 | 2026-07-23 |

### M21

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

| Milestone | Status | Started | Finished |
|---|---|---|---|
| M21 — test-coverage audit follow-up: root `c8` coverage tooling | ✅ | 2026-07-23 | 2026-07-23 |

### M22

<sub>cited from tflw-tests/CONTRIBUTING.md · lifted from `PROGRESS.md`</sub>

| Milestone | Status | Started | Finished |
|---|---|---|---|
| M22 — test-coverage audit follow-up: docs-site `.tflw` sample verification | ✅ | 2026-07-23 | 2026-07-23 |

### M23

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

| Milestone | Status | Started | Finished |
|---|---|---|---|
| M23 — gap #16: `HEAD`/`OPTIONS` HTTP methods | ✅ | 2026-07-25 | 2026-07-25 |

### M24

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

| Milestone | Status | Started | Finished |
|---|---|---|---|
| M24 — gap #17: binary-safe body assertion (`body bytes` + `matches file`) | ✅ | 2026-07-25 | 2026-07-25 |

### M25

<sub>cited from tflw-tests/README.md · lifted from `PROGRESS.md`</sub>

| Milestone | Status | Started | Finished |
|---|---|---|---|
| M25 — gap #19: content-aware body parsing (`body csv` + `body pdf text`) | ✅ | 2026-07-25 | 2026-07-25 |

### M26

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

| Milestone | Status | Started | Finished |
|---|---|---|---|
| M26 — gap #15: `redact` now masks `capture`/`expect` step-detail text, not just the trace | ✅ | 2026-07-26 | 2026-07-26 |

### M27

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN.md`</sub>

113. **M27 — User-defined logging: the `log` statement.** A `/grill-me` session (2026-07-29,
     `PLAN_LOG.md`) found tflw had no `log`/`print`/`note` statement anywhere — the closest
     precedent was `capture`'s fixed-format one-line `detail`, not a freeform user message. New
     first-class DSL statement: `log [debug|info|warn|error] "message with {var}" [to
     console|html|both]` — level defaults `info`, destination defaults to `tflw.config`'s new `log
     destination` key (itself defaulting `both`). A `log` step is unconditional author signal, not
     step-execution plumbing: it always succeeds (never fails a test), and its console line prints
     regardless of `--verbose`/the enclosing test's pass-fail — the one console-output rule in tflw
     that isn't `--verbose`-gated. Structured output stays complete regardless of destination/level
     (`results.json`/`--format ndjson` always carry every `log` step); only the two human-facing
     renderers (console text, `report.html`) filter by the resolved `log destination`/`log level`
     (new `tflw.config` keys, `--log-output`/`--log-level` CLI overrides — same config-default/
     CLI-override precedence `evidence` already established, P#101c). `--log-output` only
     ever reaches a bare `log "…"` call; an explicit per-statement `to …` always wins. Full grammar/
     data-model/precedence design lives in `PLAN_LOG.md` (decisions 113–124 there, folded into this
     single entry here rather than 12 separate PLAN.md entries, mirroring decision 104's LSP
     precedent). A genuine, incidental consequence: `log` joining `STATEMENT_KEYWORDS` means the
     reuse pass's existing keyword-collision guard (`reuse.ts:615-634`, already defending
     `open`/`close`-shaped names) now also fires for a generated action name starting with "log"
     (e.g. a "Log In" button) — two pre-existing tests' fixtures happened to trigger this and were
     updated to expect the "the "-prefixed name, not a product bug. No testFlow-tests consumption
     milestone was scoped as part of this implementation session — see `PLAN_LOG.md`'s own
     "downstream, not part of this milestone" note.

### M28

<sub>cited from CHANGELOG.md · lifted from `PLAN.md`</sub>

114. **M28 — `log` catches up to editor tooling (LSP + VS Code).** M27 added `log` to
     `STATEMENT_KEYWORDS` but never touched `packages/lsp-server`/`packages/vscode`, per
     `PLAN_LOG.md`'s own flagged follow-on (same pattern M9-M11 each got a dedicated LSP catch-up
     later, at M13/P#104). Full design + direct-read evidence in `PLAN_LOG_LSP.md`. Four
     independently-maintained keyword lists that `STATEMENT_KEYWORDS` additions don't propagate to
     for free each needed `'log'` added by hand: `tflw.tmLanguage.json`'s static TextMate grammar
     (`keywords-statement`, line 58 — `log` rendered fully unstyled before this), `semanticTokens.ts`'s
     `KEYWORDS` set (the richer, theme-independent VS Code coloring path wired through
     `lsp-server/server.ts`'s live `semanticTokens.on` handler, P#105), `lsp-server`'s
     `completion.ts`'s `STEP_KEYWORDS` (autocomplete at a step position never offered `log`), and
     `symbols.ts`'s `walkSteps()` switch (a `{var}` referenced only inside a `log` message was
     invisible to hover/go-to-def/rename — silently, since a checker-clean file just produced an
     empty ref list for that span, no error). `findNodeAtOffset.ts`'s `children()` dispatch also
     gained a `LogStmt` case for consistency with its own stated exhaustiveness invariant, though
     traced-and-confirmed inert (a `log` message is a plain `StringLit`, never nesting a
     `Matcher`/generator/`CallExpr`, so nothing downstream currently needs to walk into it).
     Deliberately left alone: `log`'s own sub-vocabulary (level/destination words) gets no grammar/
     semantic-token treatment, matching `evidence`'s un-colored level words; no VS Code snippet,
     matching every other single-line statement's lack of one; `reuse.ts`'s `ELIGIBLE_STEP_TYPES`
     (unrelated `tflw check`/`refactor` feature, not LSP). No `testFlow-tests` consumption milestone
     — this is editor-only behavior the `.tflw` suite has no way to exercise, same exception M13
     itself carried.

### M29

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md +2 more · lifted from `PROGRESS.md`</sub>

**M29 — perf arc: `scenario`/`threshold` grammar + single-scenario load engine**

`PLAN_BROWSER_PERF_SECURITY.md` §2 (D16-D19, D24a) + the milestone-scoping decisions D26-D31
(`/grill-me`, 2026-07-30). First real milestone of the performance arc (v0.3.0) — a second,
dedicated execution model alongside `test`, following perf-0 (testFlow-tests' contended checkout
target, landed first per D27). Scope, per the §2.6 table: `scenario`/`threshold` grammar + checker;
both workload models; `think`/iteration-scoped-`expect` semantics + D26's after-hook-skip-by-
default; single scenario only (M30 lifts this); `tflw init --load` scaffold; docs-site + reporter
stub.

### M30

<sub>cited from SPEC.md · lifted from `PROGRESS.md`</sub>

**M30 — perf arc: concurrent multi-scenario runs**

`PLAN_BROWSER_PERF_SECURITY.md` §2.6 (D29), amending D16/D17 — lifts M29's "at most one `scenario`
per file" restriction: `tflw load` now runs every `scenario` in a file **concurrently**, still
single-process (M31 is where multi-process scaling lands). R6's combined-vs-per-scenario metric
split (`PLAN_REPORTS_PERF_SECURITY.md`) is built now rather than deferred to M32's full reporter,
since a multi-scenario report is meaningless without it.

### M31

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PROGRESS.md`</sub>

**M31 — perf arc: multi-process generator + self-diagnosis**

`PLAN_BROWSER_PERF_SECURITY.md` §2.6 (D19, folded per D28): `tflw load --workers N` (N>1) forks N
OS processes instead of scaling in one — load generation is CPU-bound (TLS, JSON parse, ajv,
redaction scanning) and Node caps at one core per process, the same reason k6 is written in Go.
Each process runs an equal (±1) striped share of every scenario's `users`/`rps` target and reports
back through a compact histogram, not raw samples (R4); every run — 1 process or many — now also
self-diagnoses its own event-loop lag/CPU and warns when tflw's own generator was the bottleneck
(D28, "the same per-process worker loop already being instrumented for the histogram merge").

### M32

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PROGRESS.md`</sub>

**M32 — perf arc: full `LoadReport` design**

`PLAN_BROWSER_PERF_SECURITY.md` §2.6's M32 row: "Thresholds + output: metrics JSON, junit mapping,
`load-report.html` inline-SVG charts, live console + partial-on-SIGINT, inconclusive exit code" —
the reporter half of D24b's completion bar, spec'd in full by `PLAN_REPORTS_PERF_SECURITY.md`
R1-R6/R11. M29-M31 built a correct engine with a deliberate "reporter stub"; this milestone builds
the actual report the plan designed on top of it, without touching the engine's VU/threshold logic.

### M33

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PROGRESS.md`</sub>

**M33 — perf-arc LSP + VS Code catch-up**

`PLAN_BROWSER_PERF_SECURITY.md` §2.6's M33 row / D24b's completion bar: "LSP + VS Code support is
*batched at the end of each arc* rather than per-construct." No new grammar/SPEC surface this
milestone — the actual work was the same kind of audit M4a ran for the browser arc, applied to the
M29-M32 load-testing constructs (`scenario`, `ramp to … users|rps over …`, `threshold`, `cleanup`,
`think`): walk every AST-consuming tooling layer in `packages/lang`/`packages/lsp-server`/
`packages/vscode` and check it against what M29-M32 actually shipped. Unlike M4a — which found a
mix of stale-but-present coverage and a few genuine gaps — this audit found **zero** coverage of
the load-testing grammar in *any* of the five tooling layers, confirmed by grep before touching
anything: `program.scenarios` was never even iterated by `symbols.ts`, and `ScenarioDecl` had no
case at all in `findNodeAtOffset.ts`'s dispatch (silently falling into `default: return []`) — a
`scenario` file wasn't just under-colored the way a browser-arc file was pre-M4a, it was entirely
inert to the LSP: no hover, no go-to-definition, no rename, no semantic coloring, no autocomplete,
and no VS Code syntax highlighting past the bare `expect`/`api` vocabulary a scenario body happens
to share with a `test`.

### M34

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/README.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS.md +2 more · lifted from `PROGRESS.md`</sub>

**M34 — perf arc acceptance**

D31's gate — the perf arc's own dogfood acceptance, `0.3.0`-equivalent (D25: not a publish). Full
write-up lives in `acceptance/README.md`'s new "perf leg" section (numbers table, root-cause
isolation table, both bugs found, both diagnostics' real output) — this entry summarizes it and
records what building it actually required, since this milestone turned out to be far more than a
pure acceptance-testing pass.

### M35

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M36_SESSION_REFRESH.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

| ID | Scope |
|---|---|
| **M35** | Load-engine hardening (D32) — close the tflw-vs-k6 gap M34 found and root-caused but did not fix; re-run M34's own acceptance comparison unchanged once fixed, to see whether D31's numeric half now holds. **M35a/M35a-2/M35b done 2026-07-31 (root cause found: an unconditional `undici` npm import in `http.ts` cripples Node's built-in global `fetch()` — see §2.7/FINDINGS_M35B_ROOT_CAUSE.md). M35c done 2026-07-31 (mTLS dispatch isolated into a dedicated child process; ~12.8x throughput improvement on the isolated 1-VU harness, all 372 runtime + 106 CLI tests green). M35d done 2026-07-31 — real, mixed result: the fix is verified and worth keeping, but does NOT close the gap on M34's real contended acceptance target (tflw still ~173-191/s vs k6's 620/s, same ~3.2-3.4x as before); back-off-dominated real latency swamps the ~1.4ms/call the fix saves. D33a's ~10% tolerance is not met — see acceptance/README.md's "M35d — re-measured" section. M35 complete; residual gap left open, not chased further per D33c/D35/D38.** |

### M35a

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M35B_INVESTIGATION.md +1 more · lifted from `PROGRESS.md`</sub>

**M35a — load-engine hardening: CPU-profile the tflw-vs-k6 gap**

Scoped via `/grill-me` as D32/D33 (`PLAN_BROWSER_PERF_SECURITY.md` §2.7) directly off M34's own
"not built this milestone" line above. D33's starting hypothesis — that `execApi` unconditionally
building a fully-redacted request/response trace on every load iteration, then discarding the
whole thing (`runLoad`'s `runIteration` only ever reads `.ok`/`.error`/a `think`-duration filter,
never the trace) — was grounded in reading the code, not a guess, and predicted the right shape of
symptom (POST costs more than GET, doesn't scale with `--workers`). **M35a's own job was to check
that hypothesis against a real CPU profile before anyone wrote a line of fix code — and the profile
refuted it.**

### M35b

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M35B_INVESTIGATION.md +3 more · lifted from `PROGRESS.md`</sub>

**M35b — root-cause via direct instrumentation**

Two bounded diagnostic passes per D35's time-box, against the isolated echo-server harness only
(D36). Full write-up: `acceptance/perf/profile/FINDINGS_M35B_ROOT_CAUSE.md`. (1) A `node --prof`
V8 tick-log pass resolved `--cpu-prof`'s bare `(idle)` bucket to `__syscall_cancel_arch_end` —
79.1% of ticks, confirming genuinely-blocked-in-syscall but with no resolvable JS caller;
inconclusive alone, as anticipated. (2) Temporary `performance.now()` checkpoints inside the real
`execSteps`/`execApi`/`sendRequest` call chain (not a reimplementation, reverted after use) found
it: interpreter-side overhead is only ~8% of iteration time, but `fetch()` itself averages
~1.4ms/call against a *zero-latency* server — ~20x `raw-fetch-bench.mjs`'s own steady-state
`fetch()` calls, the identical global `fetch()` function. **Root cause: `http.ts` unconditionally
imports the standalone `undici` npm package at module scope** (for the mTLS `Agent` path, SPEC
§3.5) — a decisive isolated test showed merely importing `undici` (any export, never called) is an
**18.6x** slowdown to Node's separate built-in global `fetch()`, independent of whether mTLS is
ever exercised in the run. Per D37, stopped here and checked in with the user before writing any
fix code — no runtime/CLI/reporter code changed this sub-milestone.

### M35c

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M35B_ROOT_CAUSE.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M36_SESSION_REFRESH.md · lifted from `PROGRESS.md`</sub>

**M35c — fix: isolate mTLS dispatch into a dedicated child process**

The entire mTLS dispatch path moved into a dedicated, lazily-spawned child process
(`packages/runtime/src/mtlsWorker.ts` + `mtlsWorkerEntry.ts`) so `undici` is never imported on the
main thread at all, regardless of whether/when mTLS requests happen in the run — a deferred import
alone wouldn't have covered mixed mTLS/non-mTLS runs, since the poisoning is process-global, not
per-call. `bundle.mjs` gains a second `esbuild.build()` call emitting `dist/mtls-worker.cjs`
alongside `dist/cli.cjs`; `http.ts` loses its top-level `undici` import entirely; `cli.ts`'s
`main()` teardown gains `shutdownMtlsWorker()` so the worker child doesn't outlive the run.
**Verified**: all 372 runtime tests + 106 CLI tests pass unchanged, including the real-TLS
`mtls.test.ts` suite both in dev/tsx and end-to-end through the bundled CLI against a real
client-cert-requiring HTTPS server, plus a new `pack.test.ts` assertion confirming
`dist/mtls-worker.cjs` ships alongside `dist/cli.cjs` with zero added runtime dependencies.
Isolated 1-VU harness: 349 → 4,470 iter/s (**~12.8x**). Full write-up:
`acceptance/perf/profile/FINDINGS_M35B_ROOT_CAUSE.md`.

### M35d

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M35B_ROOT_CAUSE.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M36_CONCURRENCY.md +1 more · lifted from `PROGRESS.md`</sub>

**M35d — re-measure against the real acceptance target/k6**

Re-ran M34's own acceptance artifacts unchanged (`acceptance/perf/tflw/checkout-burst.tflw` vs.
`acceptance/perf/k6/checkout-burst.js`) against a fresh testFlow-tests stack + load-target reset —
twice for tflw (noise check), once for k6. k6 reproduced its own M34 baseline almost exactly
(620/s vs. 624/s), confirming a fair, non-noisy re-run. **tflw: 172.6/s and 191.1/s (avg ~182/s)
vs. M34's original 195/s — unchanged within noise, not improved.** Gap to k6 stayed ~3.2-3.4x,
statistically the same as M34's ~3.2x. Mechanism: M35b's own instrumentation found the poisoned
`fetch()` cost ~1.4ms/call more than it should — against a zero-latency echo server that *is* the
whole per-call cost (hence the 12.8-26x isolated win), but against this real target both runs'
back-off diagnostics show VUs 84-86% blocked on genuine network/Postgres row-lock wait — a ~1.4ms
tax is noise against that. A re-check of M34's two GET-only isolation rows (no writes, no
contention confound) did show a small, real gain (+3-11%), consistent with the mechanism, since
those rows were unknowingly running under the same poisoned `fetch()` throughout M34's original
run too. The two POST-uncontended isolation rows were **not** re-measured as a clean comparison —
this environment's single shared `LOAD_USER_EMAIL` for all 60 VUs makes any user-scoped POST land
on one shared DB row regardless of client speed (94% measured back-off); flagged as an environment
limitation rather than chased, per D33c/D35/D38. **Verdict: the M35b/M35c fix is real, verified,
and worth keeping — a genuine process-wide bug that silently taxed every `tflw run`/`tflw load`
invocation, mTLS or not — but it is not the dominant driver of M34's ~3x real-target gap.** That
gap's true cause was left open at the end of this sub-milestone. Full write-up:
`acceptance/README.md`'s "M35d — re-measured after the M35b/M35c fix" section;
`PLAN_BROWSER_PERF_SECURITY.md` §2.7's Acceptance bar marked "Not met." M35 (all of a-d) complete
as of this sub-milestone.

### M36

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M36_CONCURRENCY.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M36_SESSION_REFRESH.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

**M36 — continued investigation: client-side concurrency ceiling**

Scoped 2026-08-01, directly at the user's request immediately following M35d — the user chose to
keep investigating the residual ~3.2-3.4x gap rather than accept it as closed. This explicitly
reopens work past D33d's "M35 completes before the pentest arc starts" ordering; recorded as an
intentional user override, not a process lapse.

### M37

<sub>cited from CHANGELOG.md, tflw-tests/tflw-acceptance/README.md · lifted from `PROGRESS.md`</sub>

**M37 — fix D43's bug (scoped 2026-08-01)**

Scoped 2026-08-01 via a `/grill-me`-style round (D44-D46, `PLAN_BROWSER_PERF_SECURITY.md` §2.8) —
three open branches resolved with the user before any code was written:

- **D44 (fix strategy):** `runLoadCore`'s per-iteration session state stops cloning a frozen
  `baseSessionHeaders`/`baseCookieJar` snapshot and instead calls `sessionCache.ensure(name, ...)`
  fresh every iteration — cheap on a cache hit (the normal case), and it means any VU's reactive
  401-triggered refresh becomes immediately visible to every other VU's next iteration, not just
  its own. The upfront fail-fast session-establishment call before the VU loop starts is unchanged.
- **D45 (relogin-storm guard, user opted to include it in this pass):** `refreshSessions` currently
  invalidates the session cache unconditionally on a 401, even if another VU already refreshed it
  moments earlier — `SessionCache` gains an opaque `currentRef`/guarded `reestablish` pair (same
  identity-guard pattern its own TTL-eviction logic already uses) so a stale-triggered refresh never
  clobbers a fresher one; `EvalCtx` gains an optional `sessionRefs` map, populated only at D44's new
  load-path call site (the regular `tflw run` path is untouched, zero regression risk there).
- **D46 (milestone scope):** fix + unit tests only. Re-measuring `checkout-burst.tflw` against k6
  and updating `acceptance/README.md`'s verdict is a separate follow-up milestone (M38, reserved,
  not yet scoped) — mirrors this arc's own M35b→M35c→M35d split.

### M38

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PROGRESS.md`</sub>

**M38 — re-measured (2026-08-01)**

Picked up immediately after M37 in the same session. Mirrors M35d's own procedure after M35c:

- Brought up testFlow-tests' Docker stack fresh (`node cli.mjs start` in that repo).
- **Rebuilt tflw's CLI bundle first** (`npm run build`) — the checked-in `dist/cli.cjs` predated
  the M37 commit by a couple hours, so the first sanity check would have silently re-measured the
  *pre-fix* code. Caught by comparing the bundle's mtime against `git log -1`'s commit time before
  running anything, not after getting a suspicious number.
- Reset the load target (`POST /admin/load/reset`, bearer admin auth via `admin@example.com`) once
  before each of three runs: tflw twice (noise check), k6 once — same methodology M35d used.

### M39

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/README.md · lifted from `PROGRESS.md`</sub>

**M39 — confirm the residual gap is real (scoped 2026-08-01)**

Scoped 2026-08-01 via `/grill-me`, at the user's explicit request following M38 ("plan out a
series of tests with tflw and k6 to confirm this gap is real"). Rebuilds M34's original
GET-only → POST-uncontended → POST-contended isolation ladder, but with **k6 counterparts at every
rung** — M34's own table only ever compared tflw against a raw `fetch` script, never k6, so it's
never actually shown where along that ladder the tflw-vs-k6 gap (the one D33a's tolerance is about)
opens or widens. Five rungs total: echo-server GET-only + POST (2, new k6 scripts needed, no
contention mechanism on this harness) and dogfood GET-only + POST-uncontended + POST-contended (3
— the contended rung already exists as `checkout-burst.tflw`/`.js`; the other two need new `.tflw`
scenarios and new k6 scripts, since M34's original numbers for them came from ad-hoc runs never
saved as fixtures). 3 tflw runs + 2 k6 runs per rung (15 + 10 total), load target reset before
every dogfood run. Investigation + write-up only, no fix this milestone — mirrors M35a→M35b→M35c's
precedent of stopping to check in before touching the hot-path interpreter code a fix would need.
If the ladder is inconclusive, the fallback is to re-scope D33a's tolerance and close the thread
(same as D38's fallback for M35b), not open an M40. Full design: `PLAN_BROWSER_PERF_SECURITY.md`
§2.10 (decisions D47-D52). This block is the scoping, written before any of it ran; M39 was
implemented the same day and its results are recorded separately, as *M39 — findings*.

### M40

<sub>cited from tflw-tests/CONSTRUCTS.md, tflw-tests/tflw-acceptance/README.md · lifted from `PROGRESS.md`</sub>

**M40 — root-cause the p95-under-contention mechanism (scoped 2026-08-01)**

Scoped 2026-08-01 via `/grill-me`, at the user's explicit request following M39 ("lets scope out a
plan for a dedicated hardening milestone") — pursuing the fix, not the re-scope-and-stop fallback.
Explored `runLoadCore`'s VU-iteration loop (`packages/runtime/src/interpreter.ts`) before grilling:
confirmed `runIteration` calls the exact same `execSteps`/`execApi`/`sendRequest` chain `tflw run`
uses for every ordinary test — not load-isolated code — so a blind fix attempt would carry real
regression risk across the whole suite. M40 stays investigation-only (D53): direct
`performance.now()` instrumentation of the real call chain (same technique as M35b's decisive step,
temporary checkpoints, reverted after — never shipped), run on `checkout-burst.tflw` once at 1 VU
(no contention baseline) and once at the full 60-VU ramp (real contention), comparing what share of
iteration time is tflw's own bookkeeping (session cache, header build, execSteps dispatch) vs. real
`fetch()` wait (D54). If tflw's own bookkeeping share grows disproportionately under contention,
that confirms the compounding hypothesis and M40 proposes a separate M41 fix milestone (shared
hot-path code needs its own scoped go-ahead plus the full regression suite green, not an
auto-proceed); if it stays flat, that refutes the hypothesis and falls back to re-scoping D33a's
tolerance for contended-tail-latency specifically and closing the thread — same fallback D38/D52
already used once each (D55). M40 (and M41, if it happens) still finish before the pentest arc
starts — the third time that ordering line gets pushed out (D56). Full design:
`PLAN_BROWSER_PERF_SECURITY.md` §2.11 (decisions D53-D56). This block is the scoping, written
before any of it ran; M40 was implemented the same day and its results are recorded separately,
as *M40 — findings*.

### M41

<sub>cited from tflw-tests/CONSTRUCTS.md, tflw-tests/tflw-acceptance/README.md · lifted from `PROGRESS.md`</sub>

**M41 — reopening the tolerance amendment, closed (2026-08-01)**

M40's tolerance amendment lasted exactly one turn. The user overrode D55's re-scope-and-stop
resolution outright, before any `/grill-me` round: re-run the isolated tests and keep hunting for a
cause, because the pentest arc does not start until the gap closes and tflw's load numbers sit
within ~1-2% of k6's.

### M42

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PROGRESS.md`</sub>

**M42 — pinned-per-VU connections, scoped and measured (2026-08-01)**

M41's "no M42" close lasted the same day. The user reopened M41's own investigation-complete
stopping point and asked for a comprehensive plan for an HTTP-client-level change, scoped through
`/grill-me` — this time with an explicit ask to ground the scoping in web research.

### M43

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md, tflw-tests/CONSTRUCTS.md +1 more · lifted from `PROGRESS.md`</sub>

**M43-M46 — the reporter bug, and a corrected close to the arc (scoped 2026-08-01; M43 shipped 2026-08-01)**

The user held the ~1-2% bar and refused "Node is simply slower than Go" as the answer: dig into
Node's HTTP client against the Go implementation k6 uses, search wider, and keep going, because
something was being missed. A real investigation, not a repeat of M42's own websearch pass — this
one found the actual missing thing, and it wasn't in Node's HTTP stack at all.

### M44

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PROGRESS.md`</sub>

**M44 shipped (2026-08-01)**

Pure measurement + decision, no source changes beyond M43's own fixture retagging, exactly as scoped.

### M45

<sub>cited from tflw-tests/CONSTRUCTS.md, tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M121_OPEN_MODEL_FETCH.md · lifted from `PROGRESS.md`</sub>

**M45 shipped (2026-08-01)**

Real implementation this time, not a script — `packages/runtime/src/httpPinned.ts` (new):
`createPinnedAgents`/`destroyPinnedAgents` (one `http.Agent`/`https.Agent` pair, `keepAlive: true`)
and `sendPinnedRequest` (manual redirect loop standing in for `fetch`'s `redirect: 'follow'`, sharing
one `start` timestamp across hops so a redirected request's measured duration matches what a single
`await fetch()` would report; 301/302/303 downgrade a POST to a bodyless GET, 307/308 preserve
method+body, matching `fetch`'s own rules). Never imports `undici` (D75) — `node:http`/`node:https`
only, so `sendRequest`'s `fetch()` path for `tflw run` is provably untouched, mirroring
`mtlsWorker.ts`'s own isolation reasoning.

### M46

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

| ID | Scope |
|---|---|
| **M46** | Depends on M45 (shipped, kept). Root-caused M45's residual checkout-scoped p95 gap (4.9%/3.6%) by comparing tflw's actual measurement *logic* against k6's, not just its numbers (D76-D80). Landed the Nagle fix (`req.setNoDelay(true)` in `httpPinned.ts`) and quantified the percentile-algorithm bias (0.00% at this sample size, `percentile()` left unchanged). Effect was asymmetric: closed `dogfood-post-uncontended`'s gap (3.6% → 2.90%, under the <3% bar) but did not move `checkout-burst`'s (4.9% → 5.86%, within noise); a bounded D80 follow-up ruled out server-side Nagle (nginx fronts the client connection and already defaults `tcp_nodelay on`); a second, user-requested pass ruled out event-loop/GC jitter too (checkout-burst's readings were indistinguishable from an uncontended control). **Shipped 2026-08-01 — checkout-burst's 5.86% residual accepted as the practical ceiling per D79.** Full design + result in §2.17. |

### M46d

<sub>cited from tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

| ID | Scope |
|---|---|
| **M46d** | Depends on M46 (shipped). At the user's request: adds a third comparator, Artillery (the most enterprise-adopted Node.js load-testing tool), to test whether checkout-burst's residual 5.86% gap is a Node/JS-vs-Go runtime characteristic or tflw-specific. **Shipped 2026-08-01.** Calibrated (bisection) a flat open-model arrival rate whose achieved p95 approximated tflw/k6's on both scenarios — required ~33-47% of tflw/k6's own throughput to get there. The proper 3-run protocol exposed real instability (checkout p95 spread 24-107ms across 3 clean runs; dogfood's 3rd run hit a 54% request-failure rate — `ECONNRESET`/client-side fetch failures, something neither k6 nor tflw ever showed in this arc). Conclusion: directionally supportive (clean-run p95s land in the same order of magnitude as k6's, consistent with tflw's gap being a real, modest, plausible characteristic) but not a controlled proof, given the open-vs-closed workload mismatch; more confidently, Artillery's own default (non-pinned) connection handling is markedly less stable under this load than tflw's M45 pinned-connection implementation — corroborating that this arc's engineering (pinned connections, self-diagnosis) addresses a real class of problem, not a tflw-specific gap. No change to M46's own verdict. Full design + result in §2.19. |

### M47

<sub>cited from tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/README.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M121_OPEN_MODEL_FETCH.md · lifted from `PROGRESS.md`</sub>

**M47 shipped 2026-08-01, extended to a three-way (tflw/k6/Artillery) ladder at the user's request**

Continuing "into the final acceptance round systematically," the user asked to also plan Artillery
tests so all three tools get compared in this acceptance, not just the two rungs M46d covered.
Scoped directly as D81 (`PLAN_BROWSER_PERF_SECURITY.md` §2.18) — mechanical extension of M46d's
already-proven method, no full grill-me needed: all 5 rungs get an Artillery counterpart; rungs A-C
(echo GET/POST, dogfood GET-only) keep M39's own exclusion from any tflw-vs-other conclusion (D19
self-saturation), reported for completeness only; rungs D/E are the authoritative three-way
comparison, re-run fresh (not reusing M46d's numbers) under the same 3×-per-rung protocol as the
rest of the ladder.

### M48

<sub>cited from tflw-tests/CONSTRUCTS.md, tflw-tests/CONTRIBUTING.md, tflw-tests/tflw-acceptance/README.md +1 more · lifted from `PROGRESS.md`</sub>

**M48 shipped 2026-08-02 — acceptance-suite breadth (two new rungs) + p50/p99**

At the user's request: widened the acceptance ladder with two new dogfood rungs the existing A-E set
didn't cover, and added p50/p99 visibility (report-only, no new gate) alongside the existing p95
metric. Full design + results in `PLAN_BROWSER_PERF_SECURITY.md` §2.20 (D82-D85) +
`acceptance/README.md`'s "M48" section.

### M49

<sub>cited from CHANGELOG.md, tflw-tests/CONSTRUCTS.md, tflw-tests/tflw-acceptance/README.md +2 more · lifted from `PROGRESS.md`</sub>

**M49 shipped 2026-08-02 — root-caused M48's p50/p99 widening: AbortSignal.timeout() tail cost**

At the user's request: checked k6's percentile/avg/max computation directly against
`grafana/k6`'s actual source (`metrics/sink.go`, fetched via `gh api`) before treating M48's
widening-with-percentile finding as real rather than a calculation bug, and spent D80's one
remaining untested candidate (`AbortSignal.timeout()` per-request overhead in `httpPinned.ts`).

### M50

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md · lifted from `PROGRESS.md`</sub>

**M50 shipped 2026-08-02 — collapse `scenario` into `test`, kind inferred from a workload clause**

Same day as M49, at the user's request to unify DSL naming: an extended grill-me session found a
cheaper path to `PLAN_UNIFIED_RUN_DOGFOOD_REORG.md`'s Phase 1 goal ("one `tflw run` command handles
both block kinds") than that phase's original `--tests-only`-flag-over-two-arrays design — collapse
`test`/`scenario` into a single `test` keyword, kind inferred from whether a workload clause
(`ramp to …`) is present, since that field was already mandatory on the old `ScenarioDecl` and
nothing else in the grammar ever distinguished the two. The session's scope grew considerably
further (5 total workload kinds matching k6's executor coverage, a unified `report.html`/
`junit.xml`, `tflw load` dropped entirely) — captured as `PLAN_UNIFIED_TEST_WORKLOAD.md`'s D93-D104.
**This milestone ships only that plan's Phase 1**, and a deliberately narrower Phase 1 than
originally written there: the keyword/AST collapse itself (D93-D96, D103), against the *existing*
single `ramp` workload — D97's 4 new workload keywords need their own interpreter-loop and reporter
work regardless of the AST shape, so they're re-scoped as that plan's own "Phase 1b," not bundled
in here. `tflw run`/`tflw load` remain two separate commands after this milestone (D99/D100
untouched); `report.html`/`load-report.html` remain two separate pairs (D101 untouched).

### M51

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

**M51 shipped 2026-08-02 — 4 new workload keywords: `hold`/`step`/`spike`/`run … iterations …`**

`PLAN_UNIFIED_TEST_WORKLOAD.md`'s Phase 1b (D97/D98/D102), the piece M50 split off same-day because
it needed more than a mechanical AST rename. Grammar/AST/checker only — no interpreter-loop
semantics (that's Phase 2, still fully ahead, untouched by this milestone). `tflw load` still only
*executes* `ramp`; the other 4 kinds now parse and check cleanly but get a clear, named "not
implemented yet" usage error instead of a crash if someone points `tflw load` at one today.

### M52

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

**M52 shipped 2026-08-02 — `hold`/`step`/`spike`/`run … iterations …` actually execute now**

`PLAN_UNIFIED_TEST_WORKLOAD.md`'s Phase 2 (interpreter loop semantics), split from its own D99/D100
command-unification half same-day for the reason M50→M51 already established: this is real,
independently shippable value (Phase 1b's 4 new keywords going from "parses" to "runs"), while
D99/D100 removes a documented public command and replaces `tflw load`'s "every scenario runs
concurrently" behavior with strict sequential execution — a genuine behavior change worth its own
checkpoint before starting, re-scoped as "Phase 2b," not bundled in here. `tflw load` remains
today's command, still running its scenarios concurrently with each other exactly as before this
milestone — only *which kinds* it can execute changed.

### M53

<sub>cited from SPEC.md, packages/cli/README.md, packages/lang/GRAMMAR.md · lifted from `PROGRESS.md`</sub>

**M53 shipped 2026-08-02 — `parallel`/`sequential` keyword + `tflw load` folded into `tflw run`**

`PLAN_UNIFIED_TEST_WORKLOAD.md`'s Phase 2b, the checkpoint M52 deliberately left unstarted: D99/D100
originally proposed dropping `tflw load` and making `tflw run` execute every block (functional or
workload-bearing) in strict single-file order — a real behavior change from today's "every
workload-bearing test in a file runs concurrently." A grill-me session the same day produced D105-
D115 instead: a per-test `parallel`/`sequential` header keyword (default `sequential`, matching
`retry N`'s slot), with a "maximal consecutive run of `parallel` tests forms one batch" grouping
rule (D109) that degenerates to today's plain sequential loop when nothing is tagged. This milestone
implements that full redesign, not the original D100.

### M54

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

**M54 shipped 2026-08-02 — fix a real 0-iteration bug found while documenting M53's concurrency model**

Asked to write a README enumerating every functional/performance × `parallel`/`sequential` × `--tag`
× `--workers`/`--parallel` combination and confirm each one "works as expected" — not just read the
code, but build throwaway fixtures against a real build and watch them run. Two combinations that
unit tests hadn't covered (no test exercised two *sequential* workload tests in one file, nor a
`sequential` pair under `--workers N>1`) turned out to be genuinely broken — a stale `runStart`
reused across batches on the main-process path, and `runLoadCore` ignoring the DSL keyword entirely
inside a forked `--workers` shard. Both are fixed here, with three new unit tests and the
concurrency model itself finally written down in `packages/runtime/README.md`.

### M55

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

**M55 shipped 2026-08-02 — regression test for `with each` × `parallel`/`sequential`**

Follow-up to M54: asked how data-driven (`with each`) tests interact with the `parallel`/
`sequential` keyword. Verified from source (no bug this time): `table` and `concurrency` are
independent fields on one `TestDecl`; `partitionIntoBatches` batches at the whole-test level (a
`with each` test with N rows is one item in the batch array); a test's own rows always run via a
plain sequential `for` + `await runTest(...)` loop regardless of its `concurrency` value — there is
no way to make one test's own rows race each other today. The keyword only ever governs the whole
(still internally sequential) row sequence's relation to its neighbors.

### M56

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PROGRESS.md`</sub>

**M56 shipped 2026-08-02 — reporter unification (`PLAN_UNIFIED_TEST_WORKLOAD.md` Phase 3, D116-D122)**

Collapsed `packages/reporter`'s functional/load split into one report: a workload-bearing `test`'s
result now lives inline in `RunReport.tests` as a `WorkloadTestResult` (`kind: 'workload'`,
`file?`, `concurrency?`, otherwise `LoadScenarioReport`'s existing shape reused verbatim), in file
declaration order alongside functional `TestResult`s (`kind: 'functional'`, now required — a
breaking type change, pre-1.0 precedent per D99's `tflw load` removal). `RunReport` itself absorbs
the old standalone `LoadReport`'s run-level envelope (`selfDiagnosis?`/`inconclusive?`/`aborted?`/
`abortedMessage?`); `LoadReport`/`buildLoadReport`/`mergeLoadShardReports` stay as internal
machinery for the `--workers N>1` shard-merge path (a new `spliceLoadReportIntoRunReport` splices
the merged result into the placeholder workload entries `runProgramInner` stamps in for that path)
but are no longer an outward-facing artifact.

### M57

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

**M57 shipped 2026-08-03 — docs (`PLAN_UNIFIED_TEST_WORKLOAD.md` Phase 4, D123-D126)**

Scope turned out narrower than originally planned: `packages/docs-site/guide/load-testing.md`
already documented all 5 workload kinds with worked examples and `parallel`/`sequential` (written
during Phase 2b/M53) — the "existing `ramp` docs carry over with updated framing" premise was
already satisfied. The real gaps were (1) SPEC.md had **zero** prose coverage of the workload
grammar anywhere (only §17's `TF033`/`TF034` diagnostic rows mentioned it) and (2)
`load-testing.md` had 6 spots still describing the pre-M56 separate `load-report.html`/
`load-junit.xml`/`load-results.json` artifacts and a pooled "combined" view D117 dropped.

### M58

<sub>cited from CHANGELOG.md, tflw-tests/README.md · lifted from `PROGRESS.md`</sub>

**M58 shipped 2026-08-03 — `exclude` config directive (D127, PLAN_DISCOVERY_EXCLUDE.md)**

Found while dogfooding `PLAN_UNIFIED_TEST_WORKLOAD.md` Phase 5's verification step: running
`testFlow-tests`' full `npm run regression` for the first time since its 2026-08-02 reorg
(`PLAN_UNIFIED_RUN_DOGFOOD_REORG.md` Phase 2 moved in `tflw-acceptance/`, a second independent
suite with its own per-subdirectory `tflw.config`s) showed every bare, no-file-args invocation now
also sweeping that suite's files against the *root* config's sessions — `TF028: unknown session`.
Three of the four affected call sites in `testFlow-tests` could work around this with an explicit
file list; the fourth (`scripts/verify-cli-flags.mjs`'s `--failed` proof) couldn't without quietly
narrowing what it proves, which is what justified a real language/CLI feature instead of a fourth
workaround.

### M59

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md · lifted from `PROGRESS.md`</sub>

**M59 shipped 2026-08-03 — 3 lexer S1s from the launch review's A1 pass (`REVIEW_FINDINGS_A1.md`)**

First fixes off Track A of the 1.0 launch review. A1 audited `packages/lang/src/lexer.ts` against
real-world input rather than the fixtures the suite already had, and found three S1s plus one
adjacent defect; all four are here, the rest of batch 1's 132 rows are recorded but not fixed.

### M60

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md, tflw-tests/tflw-acceptance/perf/README.md · lifted from `PROGRESS.md`</sub>

**M60 shipped 2026-08-03 — checker parity + the A4/A2 checker findings (`REVIEW_FINDINGS_A4.md`, `REVIEW_FINDINGS_A2.md`)**

Four findings that share one root: rules that exist but aren't reached. Three consumers each
assembled their own list of checker passes and had drifted apart, and two bans stopped at a call
boundary they had no reason to stop at.

### M61

<sub>cited from SPEC.md · lifted from `REVIEW_FINDINGS.md`</sub>

| milestone | commit | closes |
|---|---|---|
| **M61** | `c0c7f81` | **cluster C7 closed** — `A3-02` S2, `A3-20` S2, `A4-08` S2, `A3-15` S3, `A3-16` S3, `OBS-04` S3, plus `B6-04` S2 and `B6-11`'s flag half (C5) |

### M62

<sub>cited inside a range only · lifted from `PLAN_DOC_TRUTH.md`</sub>

**M62 — doc truth**

Closes `OBS-01` (`REVIEW_FINDINGS_OBS.md`, S2) and lands the permanent anchor-link guard M65
deferred here. Review baseline `c6409d1`; this milestone's own baseline is `9324427` (M65).

### M63

<sub>cited from SPEC.md · lifted from `PROGRESS.md`</sub>

**M63 shipped 2026-08-03 — the four batch-2 findings that needed no decision (`REVIEW_FINDINGS_B2.md`)**

Batch 2 of the launch review (A12 security-adjacent runtime, A13 reporter, V2 the redaction/evidence
vertical) landed 12 findings. Eight of them wait on the freeze-surface session because they change
grammar or artifact identity. These four don't: each is additive or strictly narrowing, and three of
the four are one edit.

### M64

<sub>cited from packages/lang/GRAMMAR.md · lifted from `PROGRESS.md`</sub>

**M64 shipped 2026-08-03 — milestone A, the artifact security model (`PLAN_FREEZE_SURFACE.md` FS-01/FS-02/FS-03)**

The first of the three verticals `FS-10` scheduled, and the one holding the S1s. Closes `FU-01`,
`V2-01`, `V2-03`, `V2-04`, `V2-06` and `V2-05`'s file sinks. **The pentest arc (`0.4.0`) is
unblocked** — `V2-01` and `redact`'s inability to name a header were its two blockers.

### M65

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

**M65 shipped 2026-08-03 — milestone C, `junit.xml`'s document shape (`PLAN_FREEZE_SURFACE.md` FS-09)**

The second of the three verticals `FS-10` scheduled ("A + C now, B after batches 3–6"). Closes
`A13-01`.

### M66

<sub>cited from CHANGELOG.md · lifted from `PROGRESS.md`</sub>

| commit | what |
|---|---|
| `04b3143` | **M66** — `FS-08` optional copula, `FS-06` keyword lookahead, `FS-07` one value parser, `FS-04` additive half |

### M67

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

| commit | what |
|---|---|
| `601f0ff` | **M67** — `FS-05`: `think` → `pause`, `wait until … for <dur>`, honest `TF033` |

### M68

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

| commit | what |
|---|---|
| `12e90ed` | **M68** — the doc sweep: SPEC + `GRAMMAR.md` + docs-site, once, per D24b |

### M69

<sub>cited from CHANGELOG.md · lifted from `PROGRESS.md`</sub>

| commit | what |
|---|---|
| `7d996ad` | **M69** — `FS-04` strict half. **On branch `b1-step3-check-strict`, deliberately not on `main`** |

### M70

<sub>cited from SPEC.md · lifted from `PROGRESS.md`</sub>

| commit | row | what |
|---|---|---|
| `56d7cc3` | **M70** — `B6-01` (**S1**) | an empty `--tag`/`--only` was indistinguishable from omitting the flag, so a *narrowing* flag ran the whole suite at exit 0. Refused now, in both spellings, for every value-taking flag — same rule shape as M63's `flagValue` |

### M71

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

| commit | row | what |
|---|---|---|
| `b017c9b` | **M71** — `A4-12` ≡ `B6-07` | `check --format json` was a flat `Diagnostic[]` with no file attribution. Now one `{ file, diagnostics }` entry per file checked, clean files included |

### M72

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

| commit | row | what |
|---|---|---|
| `deb7b1c` | **M72** — `A2-06` | the `as`/`retry`/`parallel` header modifiers had a fixed, undocumented order; they are order-independent now, each at most once |

### M73

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

| commit | row | what |
|---|---|---|
| `64b0981` | **M73** — `B6-10` | `exclude "b.tflw"` was a silent no-op — the equality test lived inside the `isDirectory()` branch. Files match now, and paths are separator-normalised |

### M74

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

| commit | row | what |
|---|---|---|
| `9bb73f0` | **M74** — `A2-12` | `ReportDecl.dir` discarded its `StringLit`, freezing `dir: string` into exported public API. It keeps the literal now, at parity with every sibling path directive |

### M75

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

| commit | row | what |
|---|---|---|
| `4821fdc` | **M75** — `B4-07` | SPEC §3.3 claimed a `session` applies browser storage state; §10 says D10 never bridges them. §3.3 and the sessions guide now say what actually happens |

### M76

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

| commit | row | what |
|---|---|---|
| `e00c6c2` | **M76** — `B5-05` | `tflw migrate` cannot act (no rule emits a deprecation) and `--help`/`CLI_FLAGS` presented a working tool. Documented, not demoted |

### M77

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PROGRESS.md`</sub>

| commit | row | what |
|---|---|---|
| `b82a5b4` | **M77** — cluster `C4` | the ndjson stream had no contract: unpaired `test:start`, a `run:start.total` that disagreed with `run:end`, and a crashed file emitting **nothing**. SPEC §13 states three guarantees, each with a test |

### M78

<sub>cited from packages/lang/GRAMMAR.md · lifted from `REVIEW_FINDINGS.md`</sub>

**C13 · Doc/artifact drift about what is shipped — `FU-05`, `FU-26`, `V4-07`, `V4-08`, `V4-09`, `V4-13`, `B6-12`, `A2-OS-01` → ✅ CLOSED (`M78`)**

Swept 2026-08-06: this heading and `V4-13`'s row still read `open` while §4 has recorded the whole
cluster closed by `M78` since it shipped — the same stale-`open` bookkeeping this file warns about
three separate times. `FU-26` and `B6-12` were re-verified and back-annotated 2026-08-05; `V4-13`
was the last one left. No code was owed, and none was written.
Both READMEs and the shipped npm README say performance and security testing "are next" — the perf
arc shipped as `0.3.0` (`V4-13`, `B6-12`); `README.md:104` still names `tflw load` and `scenario`
blocks, both removed (`V4-07`); `GRAMMAR.md` claims currency "through M3e" and is ~7 milestones
stale, documenting a production the parser rejects (`V4-08`, `A2-OS-01`); the npm `description`
undersells by two whole arcs (`FU-26`). One sweep, mechanically checkable now that M62's guard
exists.

### M80

<sub>cited from SPEC.md · lifted from `REVIEW_FINDINGS.md`</sub>

| milestone | commit | closes |
|---|---|---|
| **M80** | `4dcd98e` | `B4-01` **S1** — the pinned client stops leaking credentials across an origin change (C2's S1); `B4-13` S3, found while fixing it |

### M81

<sub>cited from SPEC.md · lifted from `REVIEW_FINDINGS.md`</sub>

| milestone | commit | closes |
|---|---|---|
| **M81** | `3e6bbc7` | `B5-01` **S1** — `tflw refactor apply` stops proposing extractions the checker rejects. **The last open S1** |

### M85

<sub>cited from SPEC.md · lifted from `PROGRESS.md`</sub>

**M85 — `allow hosts` covers what it claims (cluster C1: `B4-02`, `B4-03`, `A4-10`)**

**Commit `f4a546a`.** Closes cluster `C1`. Landed together with `M84`, which was held back for the
same push.

### M87

<sub>cited from SPEC.md · lifted from `PROGRESS.md`</sub>

**M87 — the checker resolves names (cluster C6: `A4-03`, `FU-08`, `A4-16`, `FU-12`)**

Four `tflw check` "no problems found"s over files that cannot run. The root cause is three lines in
`checkValue`:

```ts
case 'CallExpr':
  for (const arg of value.args) checkValue(arg, bound, diags);
  break;
```

### M88a

<sub>cited from SPEC.md · lifted from `PLAN_M88_CLIENT_CONTRACT.md`</sub>

**M88a — the redirect cap (`B4-09`, `B4-10`, `B4-14`). ✅ shipped 2026-08-05** (see `PROGRESS.md`;
1,520 tests, negative control fails 4/5 with the defect verbatim, end-to-end parity confirmed
against `dist/cli.cjs`). One decision, three loops
(`http.ts:66`, `httpPinned.ts:179`, `mtlsWorker.ts:106`), and it is the only step that changes an
*outcome* users may have built on — a currently-green loop test starts failing, correctly. Do it
first and alone so the blast radius is legible. `B4-14`'s test is the guarded-vs-unguarded
equality shape `M85` already established.

### M88d

<sub>cited from SPEC.md · lifted from `PLAN_M88_CLIENT_CONTRACT.md`</sub>

**M88d — the stream and the hint (`B3-11`, `FU-09`).** ✅ **Shipped 2026-08-05.** Unrelated to C2 and
to each other; grouped because both are small and neither is worth its own milestone. `B3-11` also
gets `SPEC` ~~§16.1~~ **§13** restated, which means `docs-data.generated.ts` regenerates.

### M89

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/tflw-acceptance/README.md +1 more · lifted from `PLAN_M89_WORKLOAD_TRUTH.md`</sub>

**`M89` — workload results are made to describe the run that actually happened.** Cluster C3: a
workload's reported population included iterations that never completed, so percentiles, error
rates and the per-endpoint breakdown all described a run nobody had. Two filed rows survived
re-measurement (`B3-02`, `B3-03`); probing them found three more defects in one 18-line function
and one consequence for the perf arc's own acceptance benchmark. Shipped as `M89a`–`M89d`.

### M89a

<sub>cited from SPEC.md, tflw-tests/tflw-acceptance/README.md, tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_M89_WORKLOAD_TRUTH.md`</sub>

**M89a — the truthful population (`B3-02`, §3.2, §3.3) · single-repo**

The trap here is that **`errorRate` is derived from the histogram's own count**
(`interpreter.ts:1220`, `errorRate: failures / histogram.count`). Split the histogram naively and
that expression silently becomes `failures / successes` — 960/40 = **2400 %**. Every use of
`histogram.count` as a proxy for *iterations* must be found before anything is split.

### M89b

<sub>cited from SPEC.md · lifted from `PLAN_M89_WORKLOAD_TRUTH.md`</sub>

**M89b — the workload describes itself (`B3-03`) · single-repo, breaking to `results.json`**

```ts
type LoadWorkloadReport =
  | { shape: 'ramp';       model: 'closed' | 'open'; target: number; overMs: number }
  | { shape: 'hold';       model: 'closed' | 'open'; target: number; forMs: number }
  | { shape: 'step';       model: 'closed' | 'open'; stages: readonly { target: number; durationMs: number }[] }
  | { shape: 'spike';      model: 'closed' | 'open'; stages: readonly { target: number; durationMs: number; ramped: boolean }[] }
  | { shape: 'iterations'; iterations: number; vus: number; perVu: boolean }
```

Report-side blast radius is exactly two files — `cli-summary.ts:84-85` and `html.ts:203/220`.
Everything else that greps as `.workload` is the **AST** `test.workload`, untouched.
`LoadShardScenarioResult.workload` is typed as `LoadScenarioReport['workload']`, so the IPC payload
follows for free. `junit.ts` mentions `workload.overMs` only in prose.

### M89c

<sub>cited from SPEC.md, tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_M89_WORKLOAD_TRUTH.md`</sub>

**M89c — `TF033` requires a meaningful threshold · two-repo**

One new arm in `checkWorkloadTests`. **Breaks exactly one dogfood file**:
`tflw-acceptance/perf/tflw/generator-saturation-demo.tflw`, which declares `ramp to 8 users over 3s`
and only `threshold p95 duration is less than 100000ms`. One line to add.

### M90

<sub>cited from SPEC.md · lifted from `PROGRESS.md`</sub>

**M90 — `tflw migrate` becomes a tool that does something · 2026-08-05**

**Status: ✅ done.** Cluster **C8 closed** — `PLAN_M90_MIGRATION.md` complete as scoped. Shipped as
three commits in a load-bearing order: **M90a** (CLI) → **M90b** (`lang`) → **M90c** (surfaces).
Reversing it would have made every deprecation diagnostic print *"run `tflw migrate`"* while migrate
still emitted nothing.

### M91

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

**M91 — the tests that counted without proving · 2026-08-05**

**Status: ✅ done.** Cluster **C14 closed** — `PLAN_M91_TEST_TRUTH.md` complete as scoped, plus two
of its own decisions corrected by probing. Shipped as three commits: **M91a** (`075eee4`) →
**M91b** (`60441a5`) → **M91c** (`cf3513b`), branch `m91-test-truth`.

### M92

<sub>cited from SPEC.md · lifted from `PLAN_M92_SHIP_SURFACE.md`</sub>

**M92 — the ship surface tells the truth about what it ships (cluster C15)**

**Status:** ✅ **SHIPPED 2026-08-06** — M92a/M92b/M92c, cluster C15 CLOSED, 1,614 tests,
`104 open / 97 closed`. Two of this plan's own statements were wrong and are corrected inline:
§7's projected counts, and `D-M92-6`'s guard design (§3), which was vacuous as specified.
**Cluster:** C15 · Ship-surface metadata — `B6-06` S2, `B6-09` S3, `B6-12` S3, `FU-17` S3,
`FU-27` S4, `FU-28` S4.
**Predecessor:** M91 (cluster C14), which was still in review when this was written — PR #5, merged
2026-08-05. M92 was branched off it rather than off `main`.

### M92b

<sub>cited from SPEC.md · lifted from `PLAN_M92_SHIP_SURFACE.md`</sub>

| milestone | closes | shape |
|---|---|---|
| **M92b** | `B6-09` S3 | `install-browsers` resolves playwright from the consumer's project via its manifest `bin`, no `npx`, no download on failure; optional peers ship on `tflw`; e2e guard + negative control |

### M93

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

**M93 — two security decisions the tool made silently · 2026-08-06**

**Status: ✅ done.** Cluster **C12 closed**, and with it every cluster C1–C15 in
`REVIEW_FINDINGS.md`. Shipped as two commits: **M93a** (`A12-01`) → **M93b** (`A12-03`).

### M94

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

**M94 — the ledger was lying about how much work was left · 2026-08-06**

No code. A reconciliation of `REVIEW_FINDINGS.md`'s §6 status column against §4's milestone record,
prompted by a question that should have had an easy answer — *what comes after `B5-03`?* — and
didn't.

### M95

<sub>cited inside a range only · lifted from `PROGRESS.md`</sub>

**M95 — `capture` was the one statement whose subject nothing checked · 2026-08-06**

Closes `A4-06` (S2), the first row of the **checker contract** cluster and the sharpest: a false
pass, in the same family as the S1s.

### M96

<sub>cited from SPEC.md · lifted from `PLAN_M96_VALUE_SUBJECT.md`</sub>

**PLAN — M96: the value subject (`FU-11`)**

Closes review row **`FU-11`** (S2, cluster C9's last open member): *nothing can be asserted on
except the last response and UI locators — a `let`/`capture` value is legal as an operand but
never as a subject.*

### M97

<sub>cited inside a range only · lifted from `PLAN_M97_CHECKER_CONTRACT.md`</sub>

**M97 — the checker contract**

**Status:** scoped 2026-08-06 via `grill-me`. **`M97a` shipped 2026-08-06** — see §8. `M97b`–`M97d`
not started.
**Closes:** review rows `A4-04`, `A4-05`, `A4-07` (split), `A4-11`, `A4-13`, `A4-15`, `B5-02`,
`A4-14` (rider), plus the unfiled rule-2 rows the triage below found.
**Decisions:** D137–D146. **Milestones:** `M97a`–`M97d`. **First free code:** `TF042`
(`TF041` is claimed by `PLAN_M96_VALUE_SUBJECT.md`).
**Hard prerequisite:** M96 ships first — see §6.

### M97a

<sub>cited from SPEC.md · lifted from `PLAN_M97_CHECKER_CONTRACT.md`</sub>

**`M97a` — shipped 2026-08-06**

`packages/lang/src/conformance.ts` (`RUNTIME_RULES`, 90 rows) + `packages/lang/test/conformance.test.ts`
(7 assertions). No behaviour change, exactly as D145 specified. `lang` suite 738/738, typecheck clean.

### M97b

<sub>cited from SPEC.md · lifted from `PLAN_M97_CHECKER_CONTRACT.md`</sub>

**`M97b` — shipped 2026-08-06**

`lang` only, as D145 scoped it: D140's compatibility pass, D139's hook split, D142's
`checkSessionBody`, D143 half 1, and the `A4-14` rider. **`TF042`** is the one new code.

### M97c

<sub>cited from SPEC.md · lifted from `PLAN_M97_CHECKER_CONTRACT.md`</sub>

**`M97c` — shipped 2026-08-06**

D144 and D143 halves 2–3. One new code, **`TF043`**. Closes `B5-02` (all three halves) and splits
`A4-07`; ledger 93 → 95 open, which is the right direction: the rise is `M97c-01`, `M97c-02` and
`M97c-03`, three rows this milestone's own drift guard and coverage test found and filed where
they were found.

### M97d

<sub>cited from SPEC.md · lifted from `PLAN_M97_CHECKER_CONTRACT.md`</sub>

**`M97d` — shipped 2026-08-06 · the cluster is closed**

D141, review row `A4-13`. New code **`TF044`**. Branch `m97d-cycles-and-depth`.

### M97e

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M97_CHECKER_CONTRACT.md`</sub>

**M97e — the severity of a prediction (D147, 2026-08-07)**

A follow-on milestone, opened after the stack landed on `main`, because the gate above is wrong.

### M98

<sub>cited from CHANGELOG.md · lifted from `PLAN_M98_LEXER_POSITIONS.md`</sub>

**M98 — the lexer's coordinate model and the diagnostics it withholds**

Scoped 2026-08-06. Closes the **lexer positions** cluster named in `REVIEW_FINDINGS.md` §"What this
means for picking the next milestone" — `A1-05`, `A1-07`, `A1-08`, `A1-09`, `A1-10` — plus every
open `A1` rider that shares the same three files, and the seven `A1-OS-*` overselling rows that are
statements *about* those files.

### M98b

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M98_LEXER_POSITIONS.md`</sub>

**M98b — the facts the lexer withholds**

**Rows:** `A1-05` (S2), `A1-10` (S2), `A1-11` (S3), `A1-18` (S3), `A1-20` (S4). **Package:** `lang`.
**New codes:** `TF045`, `TF046`, `TF047`. Built on M98a, not on `main`.

### M98c

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M98_LEXER_POSITIONS.md`</sub>

**M98c — the diagnostics that fire and teach nothing**

The third of §2's three kinds: a diagnostic that exists and fires, and then teaches the reader
nothing — or teaches them about the lexer instead of about their source. Eleven rows (`A1-07`,
`A1-09`, `A1-12`, `A1-13`, `A1-15`, `A1-16`, `A1-OS-01/02/05/06/07`), all in `lang`, plus one new
code: `TF048` splits *tabs in indentation* out of `TF003`, which had been carrying two different
conditions with two different fixes under one code while documenting only the other one.

### M98d

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M98_LEXER_POSITIONS.md`</sub>

**M98d — Trojan Source, and the escape hatch it requires**

> **M98d — shipped, and what measuring first changed about it.**
> `TF049` + `\u{…}`, closing `A1-17` and leaving the A1 pass with exactly one open row (`A1-19`, by
> D164). Suite **832** lang / **1,796** workspace, no golden churn at all. Dogfood inside the
> milestone: 83 files clean, 177 swept → 0 `TF049` **and** 0 `TF047` (the widened one), `verify-docs`
> exit 0.
>
> **1. The scan does not go where the plan implied, because four of six positions were already
> covered.** D165 says "anywhere in the source". Probing first — a hidden character in code, a
> string, a comment, a path, a tag — showed that only *string* and *comment* check clean; the other
> four already reach the author as `TF001`, since none of these characters can start a token and
> `isUnlexable` sends them to recovery. A whole-source pre-pass would therefore have reported four
> of them twice, which is the rule M98c had just spent D161 and D163 establishing. So `TF049` is
> called from exactly the paths that **consume a character without lexing it** — indentation,
> inter-token whitespace, a comment, a string. `U+FEFF` is the one that could not have been left to
> the other half: it is *deliberately* not unlexable, being skipped as whitespace since M59.
>
> **2. That makes the guarantee a split invariant, which is how holes reopen.** Pinned as a property
> — no file containing one of these characters checks clean, in any of eight positions — rather than
> against either mechanism. Two of the eight positions exist only because a mutation survived without
> them.
>
> **3. Two of fifteen mutations survived, and both were vacuous tests of mine — again.** `bomCol`
> and the `\u` recovery both survived because the tests asserted `diags()`, which is **lexer-only**,
> against `TF016` (a *parser* code) and `TF030` (a *checker* code). Neither assertion could ever have
> failed. This is M98c's lesson recurring one milestone later in a new disguise: there, a control
> asserted something unfalsifiable; here, it asserted the right thing through a pipeline that never
> produces it. **Check that a test's harness can observe the code it names.** A third survivor (`M2`)
> was a genuine coverage gap: every "comment" case written was a *comment-only line*, so the
> trailing-comment call site — the more dangerous one, sitting beside real code — was untested.
>
> **4. `TF047` was widened rather than split, and the test is the fix, not the count.** Five new ways
> to get `\u{…}` wrong all report `TF047`. That looks like the thing M98c refused when it split
> `TF003` — the difference is that `TF003`'s two conditions had *unrelated* repairs (re-indent a
> block vs. change an editor setting), while every `\u` case is corrected by spelling the escape the
> way tflw spells it. One row states the whole rule and stays true.
>
> **5. `A1-04` was closed in M59 for the diagnostic and not for the bug** (`M98d-01`, S2, fixed
> here). A `U+FEFF` at offset 0 was skipped as whitespace but still *counted* as an indent column, so
> the first line of every UTF-8-with-BOM file measured one level of indentation and the file failed
> to parse at all — `TF016: … found an indented block` on a file whose first line starts at column 1.
> Windows editors and PowerShell redirection write that BOM by default. Found by the six-position
> probe, and **measured failing identically on the M98c build before being attributed to this
> milestone**.
>
> Also filed: `M98d-02` (S3, open) — `TF049` covers characters that are invisible, not ones that are
> visible and lie (Cyrillic `а` in `"аdmin"`). Deliberately not folded in: the invisible set can be
> rejected outright because nothing legitimate needs it inline, whereas string *data* in a testing
> DSL is legitimately multilingual, so that rule has to be mixed-script-within-a-token and carries a
> different false-positive profile.
>
> The A1 pass ledger's `**disposition:**` lines were stale for **13** rows — every numbered `A1-NN`
> closed by M59, M98a and M98b still said `open`, because M98c's sweep caught the `A1-OS-*` rows and
> not these. Third instance of this lag in three milestones. All 13 reconciled against §6.

### M99

<sub>cited from CHANGELOG.md · lifted from `PLAN_M99_VALUE_TERMINATION.md`</sub>

**M99 — what ends a value**

Closes `REVIEW_FINDINGS.md`'s last open **grammar-decision** row, `A3-05`, together with its
sibling `A3-08` and the `M98c-03` asymmetry filed one milestone ago. Decisions **D167–D172**,
milestones **M99a–b**. **No new diagnostic codes** — next free code stays `TF050`.

### M99a

<sub>cited from SPEC.md · lifted from `PLAN_M99_VALUE_TERMINATION.md`</sub>

**M99a — the widening**

`A3-05`. `packages/lang/src/parser.ts`, `parseIdentOrCall` at `:3588` and the parser's `error()`.

### M99b

<sub>cited from SPEC.md · lifted from `PLAN_M99_VALUE_TERMINATION.md`</sub>

**M99b — the two narrowings**

`A3-08` and `M98c-03`. Both reject a spelling that is accepted today, both with a measured blast
radius of **0 across 169 files**, and both therefore stand or fall on the same evidence standard
`D157`/`TF047` was settled by.

### M100

<sub>cited from CHANGELOG.md · lifted from `PLAN_M100_PDF_STREAM_LENGTH.md`</sub>

**M100 — a PDF stream's extent is its `/Length`**

**Status:** SHIPPED 2026-08-07, branch `m100-pdf-stream-length` off `main` @ `a4a09b6`.
**Decision:** D173.
**Found by:** testFlow-tests CI, run `31176634985`, job `regression (tooling)`.

### M101

<sub>cited from SPEC.md · lifted from `PLAN_M101_MATCHES_FILE_INTERPOLATION.md`</sub>

**M101 — `matches file` interpolates its path (`A4-OS-09`)**

One decision, one line of production code, three tests. Filed on 2026-08-07 during M97e and
deliberately kept out of that milestone's hotfix, which was repairing red CI; picked up here as the
head of the unscoped queue.

### M102

<sub>cited from SPEC.md · lifted from `PLAN_M102_INTERPOLATION_CONFORMANCE.md`</sub>

**M102 — the checker and the runtime agree on which strings interpolate**

Closes `A4-OS-11` (S2) and `A4-OS-13` (S4), the two rows the M101 audit turned up where
`tflw check` binds `{var}`s in a `StringLit` that the runtime then reads with `.value`.

### M103

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M103_CONFUSABLE_WORDS.md`</sub>

**M103 — the characters that are visible and lie**

Closes `M98d-02` (S3 as filed; **re-graded S2 here**, see "What raised the severity").

### M104

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M104_CONFIG_RELATIVE_PATHS.md`</sub>

**M104 — a config-declared path means one file**

Closes `M97c-03` (S2). Files and closes `M104-01` (S2), found while fixing it.

### M106

<sub>cited from CONTRIBUTING.md, SPEC.md · lifted from `PLAN_M106_ZERO_EXTENT_CARET.md`</sub>

**M106 — a caret with nothing under it**

Closes `M98c-01` (S3). D162 fixed the *wording* of `found a dedent` and deliberately left the
renderer question open — what a caret should underline when its token has no extent — because
folding a layout decision into a wording change would have buried it.

### M107

<sub>cited from SPEC.md · lifted from `PROGRESS.md`</sub>

**M107 — the flaky control that was telling the truth (2026-08-08)**

`M106` merged and left `main` **red**. Node 24 green, Node 22 green through every test step, and the
job failing only at `Coverage` — one assertion out of 1,853:

```
not ok 334 - a uniformly fast server does not trigger a backOff warning
  packages/runtime/test/load.test.ts:965
  unexpected back-off warning against a healthy server, ratio 0.25492465234067296
```

### M109

<sub>cited from SPEC.md · lifted from `PROGRESS.md`</sub>

**M109 — the cycle that left the file (`M97d-01`), 2026-08-08**

**Closes `M97d-01`** (S3), the half `A4-13` was split around: `TF044` rejected a cycle whose every
action is declared in one file, and a cycle that leaves through an `import` and comes back was left
to the runtime guard. D141's stated reason was true and narrow — `KnownAction` carried a name, an
arity and a source path, but not a body — and the row filed it as a *when*, not a *whether*.

### M110

<sub>cited from SPEC.md · lifted from `PROGRESS.md`</sub>

**M110 — doc truth, part 2 (`V4-02`…`V4-06`), 2026-08-08**

**Closes the four remaining doc-truth rows and one that was already closed.** `M109` merged as PR
`#32` (`a5916c6`), green on both Node versions; this branched off it.

### M110b

<sub>cited from SPEC.md, packages/docs-site/reference/cli.md, packages/docs-site/reference/diagnostics.md +2 more · lifted from `PROGRESS.md`</sub>

**`M110b` — every example in `SPEC.md`'s diagnostics table is executed.** The `Example` cell stopped being prose: it is generated from source that `packages/lang/test/diagnosticExamples.test.ts` runs through the same checker pass list `tflw check` runs, asserting both the code it emits and any output quoted after `→`. Four rows were wrong before it, `TF003` among them. `M110b-02` — the four docs-site CLI tables collapsing into one shared module — was filed here and closed later.

### M114

<sub>cited from SPEC.md · lifted from `REVIEW_FINDINGS.md`</sub>

**Filed by `M114` (2026-08-09)**

One row, and **it exists because the observation that prompted it was wrong.** `M114`'s merge run
showed Node 22 at 31m04s against Node 24's 4m43s and that was read, out loud, as a six-fold
Node-version gap on the same work. It is not the same work: `ci.yml:95,122` gate **Mutation
controls** and **Coverage** to `matrix.node-version == 22`. The shared steps are within 11 seconds of
each other (`npm test` 3m46s vs 3m35s). There is no Node 22 anomaly — the row below is about what
those two exclusive steps cost, which is the real finding and a different one.

### M115

<sub>cited from tflw-tests/CONTRIBUTING.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M121_OPEN_MODEL_FETCH.md · lifted from `REVIEW_FINDINGS.md`</sub>

**Filed by `M115` (2026-08-09)**

Three rows, all about the **instruments** rather than the subject — the pattern this arc keeps
reproducing. Neither was the thing `M115` set out to look at; both were found by watching the tools
work rather than by reading them. The mutation sweep's own output is the evidence for the first:
**49 of 49 kills** are labelled with a reason that cannot be true of all of them, and the label was
read past for four milestones because the verdict beside it was right.

### M116

<sub>cited from SPEC.md · lifted from `PLAN_M97_CHECKER_CONTRACT.md`</sub>

**M116 — the five open rows this cluster left behind (D148–D152, 2026-08-09)**

`M97a`–`M97e` closed the cluster's *milestones*. They did not close the cluster's *rows*: the
`RUNTIME_RULES` enumeration filed 21, and 8 of them are still open — 5 `S2` and 3 `S3`. This
milestone takes all 8, because they collapse into **three new rules and one extension**, not eight.

### M118

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M121_OPEN_MODEL_FETCH.md · lifted from `PLAN_M118_FIRST_RUN.md`</sub>

**M118 — the first two minutes**

Closes `REVIEW_FINDINGS.md`'s two remaining **first-use** S2 rows, `FU-03` and `FU-04` — the pair a
stranger hits before anything else in the product has a chance to be good. Decisions **D198–D205**,
milestones **M118a** (`FU-03`) and **M118b** (`FU-04`). **No new diagnostic codes** — next free code
stays `TF054`.

### M119

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M121_OPEN_MODEL_FETCH.md · lifted from `REVIEW_FINDINGS.md`</sub>

**Filed by `M119` (2026-08-09)**

Two rows from closing `B4-08`, and neither is about where the diagnosis fires. The first is what
the diagnosis *says* once it gets there — surfaced only because `B4-08` pointed the same code at a
new set of failures and the output was read rather than assumed. The second is about the instrument:
a sweep that prints how many tests caught a mutation, on a suite that does not always agree with
itself.

### M121

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/tflw-acceptance/perf/profile/FINDINGS_M121_OPEN_MODEL_FETCH.md · lifted from `PLAN_M121_OPEN_MODEL_CLIENT.md`</sub>

**M121 — the open model's client**

Closes `M118-02` (S2). Scoped 2026-08-10, not started.

### M124

<sub>cited from SPEC.md, tflw-tests/CONTRIBUTING.md, tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_M124_LITERAL_DECIDABILITY.md`</sub>

**`M124` — a literal the run will reject is a checker sentence**

Closes `M97a-01`, `M97a-02`, `M97a-03`, `M97a-06`, `M97a-16`. **Withdraws `M97a-20`.** Nothing in
`packages/runtime` changes behaviour; one stale comment there is corrected.

### M125b1

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M125_FIRST_USE.md`</sub>

**`M125b1` — reach ✅ DONE 2026-08-10**

`FU-18`, alone, because it is the only grammar change in the arc (D264). All six steps below shipped
as written. Three things the plan did not predict, each recorded where it was found:

- **`TF051` would have blocked programs that run.** Making absolute URLs legal turned an existing
  *error* into a false positive — an absolute step resolves no base URL, and `TF051` demands one.
  Not in any decision here, found by reading the passes that fire on *absence* after changing what
  is legal. The general form is worth keeping: **a change that makes a new input legal changes the
  meaning of every rule that already ran on the old ones.**
- **`TF059` was not in the plan.** `api billing GET https://x/y` names a service *and* an absolute
  URL; one of the two is dead text. Silently picking a winner is the exact failure class `FU-18` was
  filed about, so it could not be left. D266.
- **The first decision-60 control was a control of nothing** — `let ratio = get / 2` contains no
  `://`, so the mutation that strips `canStartPath()` from the *new* branch sailed past it. The
  scoped sweep caught it (1 survived, then 0). **A control has to exercise the branch it controls,
  not the decision that branch is named after.**

### M125b2

<sub>cited from SPEC.md · lifted from `PLAN_M125_FIRST_USE.md`</sub>

**`M125b2` — guardrails & message quality**

`FU-20a` · `FU-20c` · `FU-15`. No grammar.

### M125c

<sub>cited from SPEC.md · lifted from `PLAN_M125_FIRST_USE.md`</sub>

**`M125c` — browser diagnosis**

`FU-14` · `FU-21`≡`B4-11`. Single-query candidates, the discriminator cascade, the ~3 s speculative
line. Both live in `browser.ts`; neither changes what passes.

### M125d

<sub>cited from SPEC.md · lifted from `PLAN_M125_FIRST_USE.md`</sub>

**`M125d` — report & console**

`FU-16` · `FU-25` · `FU-23` · `FU-19` (or its withdrawal). Failure-first report, attempt counts in
the CLI summary, the `.last-run.json` filter field. **Companion `testFlow-tests` push chained in the
same command**, because four of its scripts assert on `report.html`.

### M125e

<sub>cited from SPEC.md · lifted from `PLAN_M125_FIRST_USE.md`</sub>

**`M125e` — learning surfaces**

`FU-24` · `FU-29` · `FU-30`. The `STEP_KEYWORDS` manifest and its two consumers, the grouped
`tflw docs` listing, the sidebar key.

### M126

<sub>cited from SPEC.md · lifted from `REVIEW_FINDINGS.md`</sub>

**Filed by `M126` (2026-08-11)**

One row, and it is a number going stale rather than a defect — found by reading the gate output of
the milestone this one was merging, which is where the last two rows of this kind also came from.

### M127

<sub>cited from SPEC.md · lifted from `PROGRESS.md`</sub>

**`M127` — a shard that produces no coverage fails the run instead of shrinking the denominator.** CI's coverage reassembly job checks that every shard's artifact arrived. A missing one used to reassemble quietly into a smaller total, so a shard that died reported as better coverage; it now goes red for the true reason. With `upload-artifact`'s `if-no-files-found: error` this is the only reason a lost shard is visible at all (`M143`). `ci.yml:175`'s shard-count value dates from here.

### M128

<sub>cited from CHANGELOG.md, tflw-tests/CONTRIBUTING.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**`M128` — pentest arc Tier 1: hygiene findings, and the safety declaration that gates them**

Opens the **security / pen-test arc (`v0.4.0`)**, the last arc before `1.0.0` and the largest
unclaimed thing on the board. Scopes `PLAN_BROWSER_PERF_SECURITY.md` §3's **Tier 1** (hygiene
assertions) together with the declaration half of **D21** (the layered default-deny safety model).

### M128a

<sub>cited from CHANGELOG.md, tflw-tests/CONTRIBUTING.md, tflw-tests/README.md +1 more · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**`M128a` — testFlow-tests** *(no tflw changes; nothing consumes this yet)*
1. `env secureLocal` → 8443, `insecure true`, `allow hosts "localhost"`.
2. Scheme-conditional `secure: true` in `auth.service.ts`'s `setCookie`; regression-check the
   plaintext suite.
3. `vuln/` module behind `VULN_MODE=1`: `/vuln/cors-wildcard`, `/vuln/weak-cookie`,
   `/vuln/document`. Compose passes the flag; default `docker compose up` leaves it off.
4. `VULNS.md` — id, route, rule it plants, expected severity.
5. Gate: `curl` each planted route and each clean counterpart, confirming the header/cookie facts
   the ledger claims. Nothing asserts them yet — this is the target, not the test.

### M128b

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md, tflw-tests/VULNS.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**`M128b` — tflw** *(the grammar milestone)*
6. `securityRules.ts` — the eight non-TLS rules as pure `(response, request) → applicability +
   Finding[]`, with no knowledge of the interpreter. `a11y.ts`'s relationship to `finding.ts`,
   repeated: this file is the only one that knows what a hygiene rule is.
7. Lexer/parser/AST for the `response` subject and the `has no [<sev>] security violations` matcher.
8. Checker: `TF0xx` for a missing/wildcard `authorized target`; `TF041`'s live-handle list; the
   soft/`check` form; rejection inside `wait until api`.
9. `authorized target "<url>" reason "<text>"` in config — parse, checker, CLI summary line, report
   embedding.
10. Interpreter: evaluate after api steps, plus D287's session-establishment scan.
11. Reporter + docs-site (D24b's bar) — the three-count line, the failure listing, and the `after
    each` idiom written up.
12. Gates: `npm test`, `verify:ledger`, and **`verify:mutations` unscoped** (M114's rule).

### M128c

<sub>cited from SPEC.md, tflw-tests/VULNS.md, tflw-tests/tflw-acceptance/README.md · lifted from `PLAN_M128_PENTEST_TIER1.md`</sub>

**`M128c` — tflw** *(the probe, and the arc's first acceptance)*
13. `tlsProbe.ts` — `tls.connect()`, per-`host:port` cache, `allow hosts` + D291 enforced, timeout
    and connect-failure paths mapped to real diagnostics.
14. `sec/tls-version-old`, `sec/tls-weak-cipher` into the pack.
15. D295's acceptance pass across all ten rules, written as `tflw-acceptance/security/`.

### M130

<sub>cited from CHANGELOG.md, tflw-tests/VULNS.md · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**`M130` — pentest arc Tier 2: the generated authorization matrix**

Scopes `PLAN_BROWSER_PERF_SECURITY.md` §3's **Tier 2** — the generated authorization matrix, the
arc's stated differentiator and its answer to **OWASP API #1 (BOLA/IDOR)**. Second of the two tiers
`PLAN_LAUNCH_REVIEW.md` R3 committed to (*"DECIDED 2026-08-03 (user) — build Tiers 1–2, defer the
Tiers 3–4 call"*).

### M130a

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**`M130a` — testFlow-tests** *(no tflw changes; nothing consumes this yet)*

1. `session peer` in `tflw.config` (`USER_B_*`, cookie transport, mirroring `shopper`).
2. `apiV2/src/vuln/`: `GET /vuln/orders/:id`, `GET /vuln/orders`, `DELETE /vuln/orders/:id`, all
   behind `VULN_MODE=1`, all with a header comment saying they are deliberate and why.
3. `VULNS.md` rows `V6`–`V8`, and the "Not planted, on purpose" BOLA paragraph rewritten now that it
   is planted.
4. `scripts/verify-security-target.mjs` extended: curl each planted route as a non-owner and assert
   the leak is present, and each clean counterpart and assert it is not.
5. File the stale `authz.tflw` comment (`SPEC §3.3: one session per test`, contradicted by
   `P#96`) as a ledger row rather than fixing it inside this milestone.
6. Gate: the full suite still green under `env local`; `VULN_MODE` off by default in
   `docker compose up`.

### M130b

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md +1 more · lifted from `PLAN_M130B_AUTHZ_ENGINE.md`</sub>

**`M130b` — the authorization-violations engine**

The tflw half of the pentest arc's Tier 2. Scoped 2026-08-13, by grilling, against
`PLAN_M130_PENTEST_TIER2.md` §2 items 7–14 — eight one-line bullets turned into an implementable
milestone.

### M130c

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M130_PENTEST_TIER2.md`</sub>

**`M130c` — testFlow-tests** *(the config that needs new grammar, and the measurement)*

15. `session admin privileged`; `probe mutating` under the `authorized target` in the acceptance
    corpus's config only, never in the root config.
16. `tflw-acceptance/security/` authz corpus — the three states per rule, plus D311's two halves.
17. `authz-generated.tflw` beside the untouched `authz.tflw`.
18. `scripts/verify-security-acceptance.mjs` extended to the authz rules; `VULNS.md`'s measurement
    table grows the two rules and prints its gaps.
19. Merge **after** `M130b` is on tflw `main`, then re-run and read which revision the log built.

### M131

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M131_SAFETY_COMPLETION.md`</sub>

**`M131` — the D21 safety completion**

**Status:** scoped 2026-08-13, not started.
**Numbering confirmed before writing:** the ledger's highest milestone is `M130c`, so `M131` is
free. The highest decision in `PLAN_M130B_AUTHZ_ENGINE.md` is `D335`, so this plan opens at **D336**.
**Answers:** `M130-09` (open, S3).
**Predecessors, both closed as scoped:** `PLAN_M130_PENTEST_TIER2.md` (D303–D319),
`PLAN_M130B_AUTHZ_ENGINE.md` (D320–D335).
**Repos:** `tflw` (`M131a`) and `tflw-tests` (`M131b`), merged back-to-back.

### M131a

<sub>cited from SPEC.md · lifted from `PLAN_M131_SAFETY_COMPLETION.md`</sub>

**`M131a` — tflw**

1. **`addressClass.ts`** (or equivalent in `@tflw/lang`, since both packages need it): pure
   `(url: string) => 'exempt' | 'public' | 'invalid'`, implementing D339's table. No I/O, no DNS.
   Unit tests over the full table including IPv4-mapped IPv6 and the `0.0.0.0`/`::` rejection.
2. **Widen `checkAuthorizedTargets`** to every scannable origin — default `api` base plus declared
   services (D343). `EnvAuthorizedTargets` grows a service-origin list; `cli.ts:1087` populates it
   from `resolved.services`, which `resolve.ts` already accumulates.
3. **`TF065`/`TF066`** in `diagnostic.ts`'s code table, `spec-data.ts`'s SPEC §17 manifest (with
   `probes` entries, so the golden-fixture mechanism covers them), and the checker pass.
4. **CLI**: `--allow-public-target <origin>`, repeatable, on `run` **and** `check` (D345). Both the
   spaced and `--flag=value` forms, matching every other valued flag in `cli.ts`. Threaded into
   `ProgramCheckOptions` for the static door and into the runtime config for the live one.
5. **Runtime gate** in `authzProbe`: before the first probe of an assertion, classify
   `originOf(observed.url)`; refuse under `TF065` if public and unaffirmed. Refusal is an assertion
   failure carrying the code, not a thrown `RuntimeError` — consistent with `probeAll`'s existing
   rule that a probe which could not run is an outcome, not a crash.
6. **Sequentiality test** (D346), with the reviving condition written into its header comment.
7. **Docs-site** (D24b's bar): the flag, the exemption table, D341's asymmetry, and an explicit
   statement that `tflw check`'s verdict is machine-dependent while the runtime's is not (D342).
8. **Rewrite the record**: `PLAN_M128_PENTEST_TIER1.md` D291's deferral paragraph (mark
   `probe mutating` as the item that closed, restate the remaining deferral as a condition), and
   `PLAN_BROWSER_PERF_SECURITY.md` §3.5's ordering.

### M132

<sub>cited from tflw-tests/CONTRIBUTING.md · lifted from `PLAN_M132_TIER2_DEBT.md`</sub>

**`M132` — Tier 2's debt: the cross-repo coupling, and two plan claims measurement falsified**

**Scoped 2026-08-14 by grilling. Decisions D350–D362. Not started.**

### M132b

<sub>cited from SPEC.md, tflw-tests/VULNS.md · lifted from `PLAN_M132_TIER2_DEBT.md`</sub>

**`M132b` — testFlow-tests**

1. **`apiV2/src/vuln/vuln-orders.controller.ts`** — vulnerable `PUT /v1/vuln/orders/:id` returning
   the updated order, behind `VULN_MODE` like its siblings (D356). No service change: the fixture
   controller talks to the repository directly, as `V6`–`V8` do, so no authorization bypass is ever
   written into authorization code. Also **corrects this file's own `DELETE` comment**, which still
   claimed the opt-in "probes it and finds the leak" — the overclaim `M130-05` is about, sitting in
   the file being edited.
2. **`VULNS.md`** — row `V9`, the `V8` bound rewritten as a measured contrast, and the cost figures.
   The grader-derives-counts claim was **confirmed before the plant was written** and held.
3. **`scripts/verify-security-target.mjs`** — the `V9` exploitability claim in the `V6`–`V8` shape
   that reads the body as data, plus its clean counterpart
   (`PATCH /v1/orders/:id/items/:itemId`, which routes through the same `findOneScoped` as
   `GET /v1/orders/:id`).
4. **`tflw-acceptance/security/tflw.config`** — `session shopperBearer` (D363), without which the
   plant cannot be judged by anyone.
5. **`tflw-acceptance/security/authz.tflw`** — the `V9` test, placed beside `V8` so the two form a
   controlled comparison.
6. **`scripts/verify-security-acceptance.mjs`** — the `V9` ledger row, and every `probes` row
   re-read off the run after D363 moved the probe set 2 → 3.
7. **`scripts/verify-check-diagnostics.mjs`** — both message rewrites (D352, D354) and the
   discipline comment block (D351).
8. **`README.md`** — the definition-of-done passage beside `npm run refresh-tflw` at `:102` (D351).

### M133

<sub>cited from SPEC.md · lifted from `PLAN_BROWSER_PERF_SECURITY.md`</sub>

| | milestone | what |
|---|---|---|
| editors | `M133` | D24b's LSP/VS Code catch-up, batched across Tier 1 **and** Tier 2 grammar, plus `SPEC.md` §9.11 for the authorization scan (`M131-02`) |

### M134

<sub>cited from CHANGELOG.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**tflw — `M134`, pentest arc Tier 3: request mutation + the input-handling oracle — plan**

**Parent plan.** `PLAN_BROWSER_PERF_SECURITY.md` §3 (D20–D24b) — the pentest arc. This plan decides
what Tier 3 *is*, after Tier 1 (`M128a`–`M128c`), Tier 2 (`M130a`–`M130c`), the safety model
(`M131a`/`M131b`), Tier 2's debt (`M132a`/`M132b`) and the D24b editor catch-up (`M133`).

### M134a

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**`M134a`'s coverage repair (2026-08-14 addendum, D392)**

`M134a` was pushed with every gate its author knew about green, and CI went red on the coverage
floor. The uncovered functions were not an instrumentation artifact: the shipped binary's copy of
the Tier 3 engine had never been executed by any test in this repo, because Tiers 2 and 3 run only
from an explicit assertion and no CLI test wrote one. One test through `dist/cli.cjs` closes it.
The lesson is `M130-04`'s in a new costume — the question before pushing is not *did my gates pass*
but *is my gate set the one CI runs*.

### M134b

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/VULNS.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**`M134b` — the gate contract (2026-08-14 addendum, D385–D391)**

D383 gave the gate its own milestone because *"`--fail-on` and `--baseline` change what a green build
means for every mode, and deciding that under build pressure inside the engine milestone is how a
contract acquires a design by accident."* Reading the code with the engine built, D377 leaves four
questions genuinely open and one of them has a wrong-looking obvious answer. These are the decisions,
made before any of `M134b` was written.

### M134c

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M134_PENTEST_TIER3.md`</sub>

**`M134c` — the plants, re-derived from the shipped rules (2026-08-15 addendum, D395–D400)**

D379 named four plants and one invariant each, three weeks before the rule pack existed. Read back
against `inputRules.ts` as it merged, **three of the four would have been planted and reported
nothing** — not because the plan was careless but because a one-line invariant name is not a
detector, and every one of these rules ships with a narrowing that exists to hold Tier 1's
zero-false-positive bar.

### M135

<sub>cited from SPEC.md · lifted from `PLAN_M135_SARIF.md`</sub>

**tflw — `M135`, pentest arc: the SARIF reporter + the remediation KB — plan**

Exports what tflw already finds as **SARIF**, so a run's security findings arrive in GitHub code
scanning as alerts, and builds R7's remediation knowledge base behind `rule.help.markdown` so each
alert carries the fix. It widens nothing: not one new rule, payload or probe, and the set of
things reported is exactly the set `M134b` already computes.

### M135a

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M135_SARIF.md`</sub>

| | repo | contents | new codes | coupled |
|---|---|---|---|---|
| **`M135a`** | tflw | R7's 18-entry KB (D408) + the `Record<RuleId, KbEntry>` union (D409) + D406's severity table; wired into the `report.html` findings block as "possible fixes" | no | no |

### M135b

<sub>cited from CHANGELOG.md, SPEC.md · lifted from `PLAN_M135_SARIF.md`</sub>

| | repo | contents | new codes | coupled |
|---|---|---|---|---|
| **`M135b`** | tflw | the SARIF exporter (D403–D407, D410–D413), `report/findings.sarif` write condition (D404), `report/repros/`, `@types/sarif` + `ajv` + schema test (D414), docs-site + SPEC corrections | no | no |

### M135c

<sub>cited from tflw-tests/VULNS.md · lifted from `PLAN_M135_SARIF.md`</sub>

| | repo | contents | new codes | coupled |
|---|---|---|---|---|
| **`M135c`** | tflw-tests | acceptance over the emitted document (D415) | no | no |

### M136a

<sub>cited from CHANGELOG.md, tflw-tests/VULNS.md · lifted from `PLAN_M136_ARC_DEBT.md`</sub>

| milestone | repo | contents | codes | coupled |
|---|---|---|---|---|
| **`M136a`** | tflw | `D418a`, `D421`, `D424`, `D425a`, `D429` — the input tier's blind spot reaching the report, both tiers' reaching SARIF, `authzBlindSpot` → `scanBlindSpot`, two bundle e2e scans, `ci.yml`'s re-measurement (the narrowing measured away), the stylesheet | no | no |

### M136b

<sub>cited from CHANGELOG.md, CONTRIBUTING.md, packages/vscode/test/MANUAL.md · lifted from `PLAN_M136_ARC_DEBT.md`</sub>

| milestone | repo | contents | codes | coupled |
|---|---|---|---|---|
| **`M136b`** | tflw | `D427`, `D428` — the `tflw-config` language id, both wordlists, the three wiring sites, the config-buffer diagnostic test | no | no |

### M136c

<sub>cited from tflw-tests/CONTRIBUTING.md, tflw-tests/VULNS.md · lifted from `PLAN_M136_ARC_DEBT.md`</sub>

| milestone | repo | contents | codes | coupled |
|---|---|---|---|---|
| **`M136c`** | testFlow-tests | `D422`'s second proof, which survives its row's closure — the un-probed principal named against `apiV2`'s **real** `AnyAuthGuard` rather than against a fixture tflw wrote, plus whatever the `scanBlindSpot` rename touches in the corpus | n/a | **sequenced** |

### M137

<sub>cited from CHANGELOG.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

**tflw `M137` — Tier 4: active crawl + probe**

**Scoped by grilling, 2026-08-16.** The highest decision anywhere in the repo is `D430`
(`PLAN_M136_ARC_DEBT.md`), so this plan opens at **`D431`**.

### M137b

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md, tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

| milestone | repo | contents | codes | coupled |
|---|---|---|---|---|
| **`M137b`** | tflw | `D433` session CSRF capture, `D434` derived credential + `sec/csrf-not-enforced`, `TF069` | **yes** | **yes** — back-to-back with its fixture companion |

### M137c

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

| milestone | repo | contents | codes | coupled |
|---|---|---|---|---|
| **`M137c`** | tflw | `D432` the `crawl` declaration, `D435` enumerate-and-disclose, `D436` synthesis + reachability, `D437` seed discriminator, `TF068` | **yes** | **yes** |

### M137c1

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

| milestone | repo | contents | codes | coupled |
|---|---|---|---|---|
| **`M137c1`** | tflw | `D480` path resolution against the document's `servers`, `D481` `TF068`'s fourth runtime cause, a base-path-bearing fixture server | no | **blocks `M137e`** |

### M137c2

<sub>cited from CHANGELOG.md, tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

| milestone | repo | contents | codes | coupled |
|---|---|---|---|---|
| **`M137c2`** | tflw | `D482` a public resource has no owner, so no leak rule fires against it; the repro emitter follows the rule's findings instead of the raw probe outcomes | no | **blocks `M137e`'s grading** |

### M137d

<sub>cited from CHANGELOG.md, CONTRIBUTING.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

| milestone | repo | contents | codes | coupled |
|---|---|---|---|---|
| **`M137d`** | tflw | `D440` repro generalization to Tiers 2/3/4 | no | no |

### M137e

<sub>cited from tflw-tests/CONSTRUCTS.md, tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

| milestone | repo | contents | codes | coupled |
|---|---|---|---|---|
| **`M137e`** | testFlow-tests | `D438`'s documented plant, `D437`'s exclusive plants, `VULNS.md` rows, grader updates, `D445`'s baseline | n/a | **sequenced** |

### M137f

<sub>cited from CHANGELOG.md, SPEC.md, packages/lang/GRAMMAR.md +2 more · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

| milestone | repo | contents | codes | coupled |
|---|---|---|---|---|
| **`M137f`** | both | `D442` the browser spider, the SPA blind-spot entry, a client-side plant | no | **sequenced** |

### M137g

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md, tflw-tests/VULNS.md · lifted from `PLAN_M137_PENTEST_TIER4.md`</sub>

| milestone | repo | contents | codes | coupled |
|---|---|---|---|---|
| **`M137g`** | tflw | `D441` TLS cipher enumeration | no | no |

### M138

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M138_CONTRIBUTING.md`</sub>

**M138 — `CONTRIBUTING.md`: giving the gate set a home**

**Status: PLAN, grilled 2026-08-18.** Supersedes the 2026-08-16 SEED that occupied this path. The
seed's own §5 said its seven open questions *"must be settled before any file is written"* — they are
settled below, in §5, each with the measurement that decided it. The seed's §2 measurement has been
**re-taken against both repos' current `ci.yml`, and it had gone stale in five days** (§2.4). That is
not an aside; it is the milestone's central evidence, and it changed the answer to §5's first
question.

### M138b

<sub>cited from tflw-tests/CONTRIBUTING.md · lifted from `PLAN_M138_CONTRIBUTING.md`</sub>

**`M138b` — testFlow-tests**

5. `scripts/verify-contributing.mjs` — the same classification for §2.3's 11 sites, plus the
   pointer-resolves check against the sibling checkout (D502).
6. `CONTRIBUTING.md` — including the cross-repo section moved from README (D509).
7. `README.md` — pointer replaces the moved section; §Setup untouched.
8. `package.json` `verify:contributing`; `ci.yml` step #21 in `acceptance-check`; classify that step in
   its own table.

### M139

<sub>cited from tflw-tests/CONSTRUCTS.md, tflw-tests/VULNS.md · lifted from `PLAN_M139_LEDGER_ACCEPTANCE.md`</sub>

**M139 — acceptance vs the `vuln/` ledger: recall per *plant*, and a gate that runs**

**Merged 2026-08-18 as `testFlow-tests` PR #25.** The pentest arc's terminal milestone: one plant
manifest that both the target and the acceptance read, and precision/recall measured **per plant**
rather than per run, gated inside the regression sweep. Closes `M137e-01`.

### M140

<sub>cited from SPEC.md · lifted from `PLAN_M140_REVERIFICATION.md`</sub>

**M140 — the re-verification sweep, and the guard that keeps it true**

**Grilled 2026-08-18.** Decisions **D514–D527**. Closes **`M136a-01` (S3)** and **`M113-01` (S3)**,
which this scoping establishes are the same defect filed twice, ten milestones apart.

### M141

<sub>cited from tflw-tests/CONSTRUCTS.md, tflw-tests/CONTRIBUTING.md · lifted from `PLAN_M141_VACUOUS_CHECKS.md`</sub>

**M141 — two answers to one question (Order 1 of the ledger drawdown)**

**Status: GRILLED 2026-08-19.** Supersedes the same-day seed, which is preserved only where it was
right. Decisions **D531–D546**. Highest existing before this file was `D530`
(`PLAN_M140_REVERIFICATION.md`).

### M142

<sub>cited from CHANGELOG.md · lifted from `PLAN_M142_VOCABULARY_GUARD.md`</sub>

**M142 — one parser-derived vocabulary guard (Order 3)**

**Status: GRILLED 2026-08-19.** Decisions `D550`–`D559`. Supersedes the seed of the same name.
Order 3 of the ledger drawdown.

### M143a

<sub>cited from CONTRIBUTING.md, tflw-tests/CONTRIBUTING.md · lifted from `PLAN_M143_SWEEP_RELIABILITY.md`</sub>

**Amendments made while building `M143a` (2026-08-19)**

Two decisions the build forced, both widening what was scoped. `D581` puts the mirror removal on
**both** call sites rather than the `mutations` job alone, because the job that was supposed to
serve as the control stalled 45.9 minutes in the identical step. `D582` sets the soft budget at 20
minutes rather than `M137g-03`'s ~22, so that the instrument's number and `D574`'s re-shard
condition are the same number rather than two to be correlated.

### M143c

<sub>cited from tflw-tests/CONTRIBUTING.md · lifted from `PLAN_M143_SWEEP_RELIABILITY.md`</sub>

**`M143c` — the half this milestone did not know it had**

`M143a` shipped with prediction #4: *tflw-only, no `testFlow-tests` commit*. It was falsified the
same day, by the sibling repo's own CI, on the PR that was waiting to merge behind it.

### M144

<sub>cited from SPEC.md · lifted from `PLAN_M144_DOC_HONESTY.md`</sub>

**M144 — documentation that asserts false things (Order 4)**

Order 4 of the ledger drawdown: six rows where tracked prose asserts something that is not true.
Four of them are one defect — documentation naming a thing that no longer exists — and the guard
for that class comes out a **denylist** rather than a derivation, because the authority it would
have derived from is gitignored.

### M144b

<sub>cited from SPEC.md · lifted from `PLAN_M144_DOC_HONESTY.md`</sub>

**`M144b` — corrections and bookkeeping**

| row | what |
|---|---|
| `V4-12` | narrow `SPEC.md:48` and `:70`; **file the runtime-diagnostics gap** as a successor |
| `V4-15` | correct `SPEC.md:2975` **and `:2929`** — the second site the row never named |
| `V4-16` | narrow the page's claim; add the `RF0xx`-is-a-handle sentence |
| `A2-16` | `ast.ts:306`, `:427`, `:568-569` — four instances, one already self-resolved by `M67` |
| `A4-19` | `diagnostic.ts:52` ("M0 lexer/parser" over 57 codes), `checker.ts:1-5` (M2.65 over ~20 passes) |
| `M110b-02` | extract the `.vitepress/` helper, 4 call sites; **file the renderer test** as a successor |
| `A4-07` | close; correct the citation of a group that closed with `M111` |

### M147

<sub>cited from CONTRIBUTING.md, SPEC.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

**Plan: M147 — the last order**

**GRILLED 2026-08-20.** Supersedes the seed of the same date. Baseline `main` `eb894fb`.
Ledger at grill time: **341 rows — 45 open (S2 0 · S3 21 · S4 24), 286 closed, 3 deferred,
7 withdrawn**. Decisions open at **D622**.

### M147b

<sub>cited from CHANGELOG.md, CONTRIBUTING.md, SPEC.md +1 more · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

| part | subject | rows |
|---|---|---|
| `M147b` | the vocabulary of refusal: one table the three parser sites read from, plus D623's **three** directive moves (see §9's D628 correction) | `A2-14` `M142-01` `M142-02` |

### M147c

<sub>cited from SPEC.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

| part | subject | rows |
|---|---|---|
| `M147c` | the checker↔runtime contract — largest, entirely additive | `A2-09` `A2-11` `A4-18` `A4-21` `M118-01` `M124-01` `M124-02` `M140-01` `M140-03` `M140-05` |

### M147d

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

**9.2b The six decisions `M147d` has taken, stated**

Their findings are §9.3; these are the rulings themselves, in one line each, so a reader grepping a
number lands on a statement rather than on a story.

### M147e

<sub>cited from CONTRIBUTING.md, SPEC.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

**9.2c The two decisions `M147e` has taken, stated**

- **D643** — *the parser bounds its own recursion, and refuses past the bound with a diagnostic
  rather than a stack overflow.* `parseSource` is documented as never throwing for a syntax error and
  a file of 30 000 unary minuses broke that outright. Unary minus is the only production in this
  grammar that recurses per token, so one guard closes it; the limit is **256**, set two orders of
  magnitude below anything written by hand and an order below the measured cliff, because the stack
  that binds is the smallest the parser might run on and not the machine it was measured on. Its own
  code, `TF075`, because the `-` is legal exactly where it is written and `TF010` would put a false
  word in the only sentence the reader gets. This is the milestone's one code, spent under §6's rule
  on the only row whose message could not be told the truth with an existing one.

### M147f

<sub>cited from CONTRIBUTING.md, SPEC.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

**9.2f `M147f` — the last part, and what the finish line actually cost**

Order 6's terminal part. Its subject was the twenty rows still open, and `D622` allowed most of them
to be closed by ruling. Five closed by build instead, three of the five because the row's own
disposition turned out to be cheaper than it read.

### M148

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M147_LAST_ORDER.md`</sub>

**9.2e `M148` — the excursion between `M147e` and `M147f`, and why it is not Order 6**

`M147e` pushed as tflw PR #97 and went red on `mutation controls`. It had not caused it: `main` at
`dab23f2` — `M147e`'s own base, i.e. Order 6 with four parts merged — was already red the same way.
So the work between the two parts is a CI repair, filed as `M147-11` and built as **`M148`**, off
`main`, merged before #97. It is deliberately **not** lettered into this milestone: `D626` gives
Order 6 six parts each closing ledger rows about the language, and this closes one about the
instrument that measures the language. Order 6's row set is unchanged.

### M149c

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M149_DOCS_CURRENT_STATE.md`</sub>

**M149c — the three pillar overviews**

Per `D654`. Three new pages, each ~80–120 lines, each carrying exactly one worked end-to-end
example that runs. Homepage feature cards repointed at them, so the front page's four claims each
have a destination that elaborates rather than a chapter chosen arbitrarily.

### M149e

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M149_DOCS_CURRENT_STATE.md`</sub>

**M149e — performance and security rounding**

1. The `D655` split, and the homepage's deep link repointed.
2. The three constructs the truth pass found documented nowhere. `probe ciphers` lands in the
   hygiene chapter, `seed spider` is already in `crawling.md` from `M149a` and needs only the depth
   the other seeds get — and **`session … csrf from … send as header` belongs in `sessions.md`**,
   which sits in *Start here* and is in no other part's scope. This item is widened to reach it
   rather than leaving a construct with no home; the alternative was a seventh part for one page.
3. A pass over the five security chapters for the one thing §1.4's numbers do *not* show: whether
   they say what each scan **does not** claim. The zero-false-positive bar, the three-state coverage
   model and the "a 5xx is not a finding" rule are the tool's strongest properties and are currently
   stated inside individual chapters rather than anywhere a reader meets them.
4. The security overview from `M149c` is where that consolidates — one statement of the bar, linked
   from each chapter, rather than three restatements.

### M149f

<sub>cited from CONTRIBUTING.md, tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M149_DOCS_CURRENT_STATE.md`</sub>

**M149f — the guard, the gates and the PR**

1. `D659`'s completeness gate — the construct-manifest set difference, its `DECLARED_UNDOCUMENTED`
   map, and the decision the plan owes on the clause families that have no manifest. The demonstrated
   break is free: the three constructs `M149a` found are the fixture. (`D657`'s roadmap guard is no
   longer here — `D660` moved it to `M149b`.)
2. `CONTRIBUTING.md`'s gate list grows by **two**; `ci.yml` is authoritative and the prose is held to it
   (`M138`).

### M152b

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M152_DECISION_PROVENANCE.md`</sub>

**`M152b` — normalisation and declarations (tflw)**

**BUILT 2026-08-24 — green on its own gate (`D692`), `D695`–`D699` filed.** Scoped `D691`/`D692`;
what the build actually found is `D695` (171 citations, not 90–104 + 47) and `D697` (five more
exemptions than `D691` named, one of which was `D691` clause 2 being wrong).

### M153b

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M153_PUBLISHED_METADATA.md`</sub>

**`M153b` — the sibling's two descriptions (testFlow-tests)**

1. Repair `inventory-service/package.json` and `webV2/admin/package.json` per `D714`.
2. **No gate here.** `testFlow-tests` has no `verify:citations`; porting one is a new script, not a
   corpus widening, and it is a separate row (`M153b-01`).
3. Refresh `scripts/sibling-citations.json` in tflw if the repair moves any pinned line.

### M154a

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`M154a` — tflw: `tflw spec --json` and the build stamp**

**Repo: tflw. Closes `M153b-01`.**

### M154b

<sub>cited from tflw-tests/CONSTRUCTS.md, tflw-tests/CONTRIBUTING.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`M154b` — the walking skeleton**

**Repo: testFlow-tests (+ tflw if `spec --json` needs amending).**

### M154c

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`M154c` — the functional/API tier**

Plants for the API-side remainder: `check` at scale, `retry`, `after` hooks, `request fails`,
`base64`/`hex`/`url`, `give`, `matches file`, `HEAD`/`OPTIONS` corners. New fixture modules under
`apiV2/src/` per `D725`. Ratchet entries deleted.

### M154d

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`M154d` — the UI/browser tier**

`download as`, `pause`, `accept`/`dismiss dialog`, `switch`/`close tab`, `within frame`, `drag`/
`drop`, `double`/`right click`, `press`, `hover`, `scroll to`, `screenshot`, `viewport`, visual
baseline, `stub`, `select`, `tick`/`untick`. Real flows first, harness page as fallback (`D729`).
Joins the `security-ui` regression leg.

### M154e

<sub>cited from tflw-tests/CONSTRUCTS.md, tflw-tests/tflw-acceptance/perf/README.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`M154e` — the perf tier**

**Closes `B6-15` — and see the build note below, because it does not, yet.**

### M154f

<sub>cited from tflw-tests/CONSTRUCTS.md, tflw-tests/CONTRIBUTING.md, tflw-tests/tflw-acceptance/perf/founding-runs/README.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`M154f` — the security tier and the cross-repo seam**

~~**Closes `M124-03`.**~~ — **retracted 2026-08-26 under `D757`; the row is re-deferred against
publish.** `M154f` shipped the code and the deploy armed a timer that then fired 0 of 3 nights, so
*deployed* was never the condition — *ran* was. Struck rather than deleted for a mechanical reason
as well as an honest one: `DECISIONS.md` is **generated** from this heading (`D735`), so a claim
edited away here would simply disappear from the published index, having been asserted there for a
day and never visibly withdrawn.

### M154g

<sub>cited from SPEC.md, tflw-tests/CONSTRUCTS.md, tflw-tests/CONTRIBUTING.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**`M154g` — the roster completion**

**The terminal milestone, and acceptance clause 5's real home.** Added 2026-08-25 when clause 5 was
re-read against `M154f`'s actual scope; see §8.5 for why it is a rename rather than a widening.

### M154h

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M154_DOGFOOD_CONFORMANCE.md`</sub>

**Build note — 2026-08-26, the measured gate moves into the sweep (`M154h`)**

**The question.** With the timer disarmed (`D754`), the gate's coverage depends on someone asking
for it — stated plainly in the note above, and not a good place to leave it. The question put next
was the right narrowing of the whole scheduling problem: *keep the full/ladder run in the local box
regression execution, and keep GitHub CI without it, so it is not missed during development.* That
is not a smaller version of the rejected daytime-trigger design (`D755`); it is a different design
with none of its parts. There is no notification, no approval, no eviction and no unattended code,
because there is **no trigger at all** — the run rides something a developer already invokes on
purpose.

### M157

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M157_TEARDOWN.md`</sub>

**PLAN_M157 — teardown under load: delete the `cleanup` gate, fix the metric it was protecting**

**Status:** **`M157a`–`M157f` all built 2026-08-29.** tflw: `M157a` in PR 138 (merged, isolated as
§4 requires), `M157b`–`M157e` in PR 139. `testFlow-tests`: `M157f` in its own PR, merging second
under `D511`. Suite green on the box at **3766 tests**; sibling gate green at **102 plants**,
roster 178/178, ratchet 0/0. One follow-up remains and is named in §4b: a third tflw commit
re-pinning `sibling-citations.json`, which is what publishes `D789`.
Closes `M154e-01`; files `M157-01`. **Breaking** (removes a keyword, changes reported percentiles).
**Ledger row:** `M154e-01` (S3), reframed. **Decisions:** `D781`–`D789`. **No new diagnostic** —
`TF079` was scoped and dropped, see `M157c`. Gitignored by `.gitignore:35`.

### M157a

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M157_TEARDOWN.md`</sub>

**`M157a` — `D782` first, alone**

Narrow the timing window to `scenario.body`. No language change,
no gate change. Land it and observe the reported percentiles move on the existing conformance
workloads. This is the only step that changes numbers for suites that never touched `cleanup`, so it
ships isolated and is verified isolated.

### M157d

<sub>cited from SPEC.md · lifted from `PLAN_M157_TEARDOWN.md`</sub>

**`M157d` — the `teardown` key (`D783`/`D784`/`D785`/`D786`)**

`CONFIG_KEYS` entry, a `TEARDOWN_PHRASES` list beside
`EVIDENCE_PHRASES` (`parser.ts:2350`), `--teardown` flag, the resolve path, and the advisory line
with its count. The `on success` predicate goes exactly where `D781` removed the gate, so those are
one edit rather than two. Bad values reuse the existing machinery — `TF020` for the key,
`parseClosedSetDirective` for the value — and no further codes are minted.

### M157f

<sub>cited from tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M157_TEARDOWN.md`</sub>

**`M157f` — `D789`, in `testFlow-tests`**

Rewrite `C48`, update `verdict.tflw:58-68`, re-run the
roster and ratchet. **`D511` merge order: tflw first, then testFlow-tests.**

### M158

<sub>cited from CONTRIBUTING.md · lifted from `PLAN_M158_GATE_MANIFEST.md`</sub>

**`M158` — the docs-site guard learns what the language is**

**Status:** **BUILT 2026-08-30** — `M158a`–`M158d` complete, suite 3771 green on the build box,
all six record gates green. Build log in §4b. Two of this plan's own decisions were corrected by
measuring them (`D792`, `D794`); one number was minted outside the reserved block (`D837`).
Originally scoped 2026-08-29. **Not breaking** — no grammar, no runtime, no
diagnostic. Guard and comment changes only.
**Closes:** `M154-01` (S3), `M153a-01` (S4). **Disposes without closing:** `M149f-01` (S4),
`M153a-02` (S4) — both are `D622` conditions awaiting evidence that has not arrived (§5).
**Numbering:** takes `D790`–`D796`, **and `D837`**. Mints no `TF` code (`TF079` stays free).

### M159

<sub>cited from SPEC.md, packages/lang/GRAMMAR.md · lifted from `PLAN_M159_DIALOGS.md`</sub>

**`M159` — native dialogs: the whole surface, and something to assert about each kind**

**Status:** **`M159a`–`M159d` built 2026-08-30**; `M159e` absorbed into `M159b`, `M159f` open. **Additive** — three
constructs, no removals. Changes the behaviour of a program that arms two dialogs, which today is
silently wrong. `M159e`'s per-kind table was written inside `M159b`, because `D799`'s prose needs it
to make sense; it is not a separate step any more.

### M159c

<sub>cited from SPEC.md · lifted from `PLAN_M159_DIALOGS.md`</sub>

**`M159c` — `D800`/`D801`.** `accept dialog with`, `TF080`.

### M159d

<sub>cited from SPEC.md · lifted from `PLAN_M159_DIALOGS.md`</sub>

**`M159d` — `D802`.** `TF079` and the end-of-test check.

### M160

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/tflw-acceptance/perf/founding-runs/README.md · lifted from `PLAN_M160_LATENCY_PRECISION.md`</sub>

**`M160` — latency carries a float; rounding happens at render**

**Status:** **`M160a`-`M160d` built 2026-08-29**, both repositories, `D511` order kept throughout
(tflw PR 135 -> tflw PR 136 -> tflw-tests PR 61 -> this pair). Suite green on the box at 3752 tests.
The sibling's perf baseline is re-founded from five run artifacts and now carries **all seven
`p95Ratio` bands**, against four before — `dogfood-get-only`, `echo-get-only` and `echo-post-only`
were suppressed on a quantum tflw no longer has. **Not breaking** to any `.tflw` program.
**Changes every reported number** at low latency, and changes what `histogram.ts`'s own header is
allowed to claim.

### M161

<sub>cited from CHANGELOG.md, SPEC.md, tflw-tests/CONSTRUCTS.md · lifted from `PLAN_M161_VALUE_FORM.md`</sub>

**`M161` — one string form for a value, stated once**

**Status:** **COMPLETE 2026-08-29** — tflw half (`M161a`–`M161e`) merged as tflw#132 (`54cd00a`),
`D814`/`D815` published and the sibling re-pinned as tflw#133, and `M161f` merged as
tflw-tests#60. All nine acceptance clauses met.
**Behaviour change** — `matches` against a date now passes where it used to fail. No grammar change.
**Closes:** `M154g-08` (S4, re-stamped **S3** per §2.1), `M154c-02` (S4), `M154g-15` (S4).
**Filed three rows on the way out**, none of them about the code this plan changed:
`M161-02` (S4, `ci.yml` justifies `M114`'s unscoped-sweep rule with a case `M122-01`'s own row says
it could not have caught), `M161f-01` (S4, `CONSTRUCTS.md` said `generator:unique-like` "stays on the
ratchet" five hundred lines above the section saying the ratchet is empty — fixed in `M161f`, the
`D767` class it belongs to is not), and `M161f-02` (S3, the retraction of `M154g-07`'s retry claim
reached the plant header and neither of the two records that carry it). Ledger 403 -> 406, 14 -> 17
open.
**Filed and closed one new row**, `M161-01` (**S2**) — `unique` collides across forked load workers,
contradicting a stated `SPEC` guarantee (§2.4); reproduced at 167 draws / 84 distinct before the fix.
**Numbering:** takes `D812`–`D817`. Next free after this plan: **`D818`**. Mints no `TF` code.
Sibling work gated on `D511` (tflw merges first).
Gitignored by `.gitignore:35`.

<!-- GENERATED:decisions:end -->
