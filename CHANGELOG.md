# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Internal milestone labels track the
arc order: `0.1` (API) → `0.2` (browser) → `0.3` (performance) → `0.4` (pen-test) → `1.0.0`. The
`P#n`/`D<n>`/`M<n>` citations below name blocks in design records this repository does not publish;
each one resolves in [DECISIONS.md](https://github.com/deepak-tuteja/tflw/blob/main/DECISIONS.md),
which lifts the block verbatim. None
of `0.1`–`0.4` is ever actually published — **the first `npm publish` is `1.0.0`**, gated on all
four arcs plus one final integrated acceptance pass against the real dogfood app (`PLAN.md`
P#112). The shipped API grammar is frozen additive-only from `1.0.0` on: no existing syntax
changes, only new syntax.

## [Unreleased]

Everything below is built and verified but not yet published — it ships as part of `1.0.0`, which
is gated on the pen-test arc plus one final integrated acceptance pass (P#112). The
performance arc closed 2026-08-02 and is included below.

### Added — enterprise arc (M9–M28)

- Session hardening: refresh-on-`401`, per-session TTL, `session <name> oauth2` client-credentials
  sugar, and per-env `cert`/`key` mTLS client certificates (P#99–P#100).
- Safety and evidence controls: the `allow hosts` allowlist, `--forbid-insecure` as a CI policy
  gate, `evidence full|headers only|none`, and `redact` (P#101).
- `matches schema` contract validation against a JSON Schema or OpenAPI document (cached per run),
  and `Retry-After`-aware retry (P#102).
- The documentation site (VitePress) plus `spec-data.ts` — one structured manifest of matcher,
  generator and CLI-flag signatures that SPEC.md's tables, the Reference pages and the LSP's
  hover/signature help are all generated from, instead of four hand-maintained copies (P#103).
- **A real Language Server** (`tflw lsp`, `packages/lsp-server`): diagnostics, hover,
  go-to-definition, completion, rename, signature help and semantic tokens, with the VS Code
  extension reduced to a client over it (P#104–P#105).
- Connection-failure assertions — `expect request connects` / `expect request fails` (P#108).
- CI ergonomics: `--failed` (replay last run's failures), `--bail`, `--format ndjson`,
  `--no-timestamps`, `--log-file` (P#111).

### Added — browser arc (`0.2` internal milestone)

- Browser interaction steps (`open`/`click`/`fill`/`fill form`/`select`/`tick`/`untick`/`hover`/
  `press`/`scroll`), a tiered locator model (`button`/`text`/`list`/`field` cascade, `css`/`xpath`
  escapes, `within` scoping, strict-ambiguity errors), auto-retrying UI expects, and dialog
  handling (`accept`/`dismiss`).
- Frames (`within frame`), tabs, downloads, drag-drop, and `wait until <ui-locator>`.
- The `report/` directory: failure-first screenshots + Playwright trace, `--browser`/`--headed`/
  viewport flags.
- Network observation (`expect request to "<url>" was made`) and `stub` route mocking.
- Accessibility assertions (`expect page has no [<severity>] a11y violations`, axe-core).
- Visual regression (`expect page matches snapshot "<name>" [mask <locator>]*`,
  `--update-snapshots`).
- `tflw watch` (headed re-run on every save, one shared browser, same seed) and `tflw pick`
  (opens a real browser, prints a verified locator per click).

### Added — user-defined logging

- The `log` statement: `log [debug|info|warn|error] "message with {var}" [to console|html|both]` —
  narrates what a test is doing, in the author's own words; always succeeds, never an assertion.
- Two `tflw.config` keys (`log destination`, `log level`, override semantics like `evidence`) plus
  `--log-output`/`--log-level` CLI overrides for a single run — an explicit per-statement `to …`
  clause always wins over both. Every log step is always recorded in `results.json`/`--format
  ndjson` regardless of level/destination; only console text and `report.html` filter what renders.
- Full LSP/VS Code support: hover, completion, and semantic highlighting for `log`.

### Added — reuse pass & acceptance

- `tflw check` now surfaces advisory duplication hints (`RF0xx`) and `tflw refactor apply <id>`
  mechanically extracts a flagged window into a shared `action`, rewriting every call site.
- `tflw migrate`: the rewrite machinery (`Diagnostic.deprecation` + `collectMigrations`/
  `applyMigrations`) for checker-flagged deprecations, wired end to end and proven via synthetic
  diagnostics. **It has nothing to migrate and cannot have:** no checker rule emits a deprecation,
  because the grammar has been additive-only since the first release (P#45), so every run
  reports `no deprecated syntax found` and touches no files. Shipped ahead of the first real
  deprecation, not as a working migration path.
- A 10-test mixed UI/API acceptance suite against a purpose-built dogfood target (webV2:
  React/Vite SPA storefront + SSR admin console) plus a side-by-side comparison vs. raw
  Playwright + `node:test` — found and fixed 4 real, previously-shipped bugs in the process.

### Added — performance arc (`0.3` internal milestone, M29–M49)

- **Load testing with no second language and no second command.** A `test` becomes
  workload-bearing the moment it contains a workload line; the body is ordinary steps, so an
  `action` written for the functional suite is reusable unchanged.
- Five workload shapes: `ramp to N users over D`, `hold N users for D`, `step …`, `spike …`, and
  `run N iterations across M users` (D97/D98/D102).
- `threshold` assertions (`p50`/`p90`/`p95`/`p99` duration, and error rate; optionally scoped to
  one step via `for "label"`) — a workload-bearing test's verdict comes from its thresholds, and a
  workload-bearing test with none is a checker error, since it could never fail.
- `pause <duration>` (VU think-time; legal only inside a workload-bearing test).
- Multi-process load generation — `--workers N` forks generator processes, each taking an equal
  striped share of the target population/rate, merged back into one report — plus a generator
  self-diagnosis that warns when tflw itself, not the target, was the bottleneck.
- A live ~1Hz console line (iterations/rps/error rate), Ctrl-C flushing a **partial** report rather
  than losing the run, and exit code `3` for an **inconclusive** result.
- **Validated against k6 and Artillery** on a real contended target across a rung ladder — the
  investigation closed a genuine ~3.2× gap (a per-iteration session-refresh storm, M37), added
  pinned-per-VU connections and a Nagle fix, and replaced `AbortSignal.timeout()` with a manual
  deadline timer after it was found to distort tail latency. Two real bugs in the dogfood app were
  found by the acceptance rungs themselves.

### Added — one `test` keyword, one report (M50–M58)

- `scenario` blocks were **removed** and collapsed into `test`, with the kind inferred from the
  presence of a workload clause (D93–D96, D103). `scenario` is now a hard `TF033` error
  naming its replacement.
- `tflw load` was **removed** and folded into `tflw run`, which drives functional and
  workload-bearing tests alike in one pass, in file declaration order (D105–D115).
- A `parallel`/`sequential` test-header modifier controls a test's concurrency with its
  file-siblings; `--parallel N` (file concurrency) and `--workers N` (load generation) are separate,
  unrelated axes, and `--skip-workload` drops workload-bearing tests for fast functional iteration.
- Workload results render **inline with the functional ones** in the same `report.html`/`junit.xml`/
  `results.json` — there are no separate `load-*` artifacts (D116–D122).
- An `exclude` config directive for file discovery (D127).

### Added — pen-test arc, Tier 1 (`0.4` internal milestone, M128)

- **`expect`/`check response has no [<severity>] security violations`** — a built-in pack of twelve
  HTTP hygiene rules (cookie flags, HSTS/CSP/`X-Frame-Options`/nosniff, credentialed CORS
  wildcards, cacheable authenticated responses, version disclosure, TLS protocol version and cipher
  suite) run over the response the last `api` step received, reusing the `Finding`/severity model
  the a11y scan introduced (D283, D289, D290).
- **Applicability is a third state.** Every rule declares a precondition; a rule whose precondition
  is unmet reports *not applicable*, which is neither a violation nor a silent pass. Without it,
  `hsts-missing` and `cookie-not-secure` would fire on every response of every plaintext suite
  (D284).
- **An assertion where no rule applied fails**, with a dedicated message naming each precondition
  that went unmet — a scan that could not have failed must not report a pass (D285). A
  severity floor narrows which rules run at all, so the printed counts describe the work actually
  done (D296).
- **A `session` block's own login response is scanned once, at establishment**, with findings
  attributed to the session by name and folded into that test's security assertions — otherwise a
  suite whose session cookie lacks `HttpOnly` reports clean (D287).
- **`authorized target "<url>" reason "<text>"`** in `tflw.config` — the declaration layer of the
  safety model, required before any security assertion (`TF060`) and rejecting wildcards and
  scheme-less targets (`TF061`). The reason is printed in the CLI summary and embedded in
  `report.html`, so every artifact records the claim that permitted the scan (D21, D291).
- **`sec/tls-version-old` and `sec/tls-weak-cipher`**, from a stdlib `tls.connect()` probe to the
  same host — the runtime drives Node's `fetch`, which exposes neither the negotiated protocol nor
  the cipher, and the dependency that would is the one the zero-runtime-dep bundle declined. One
  handshake per `host:port` per **run**, obeying `allow hosts` and re-checking the `authorized
  target` declaration against where the run actually ended up rather than the base URL the checker
  could see (D288).
- The probe deliberately offers a **TLS 1.0 floor**, below Node's own `DEFAULT_MIN_VERSION` — a host
  speaking nothing but a deprecated protocol would otherwise refuse the handshake, leaving
  `tls-version-old` unable to fire in the one case it exists for. Measured: offering an old floor
  never drags a healthy server down, because the server still picks the newest version both sides
  speak. Cipher suites are *not* widened the same way, since reaching a legacy-cipher-only peer
  needs OpenSSL's `@SECLEVEL=0`, which also lowers what counts as an acceptable certificate
  (D298).
- Both TLS rules answer **"what does this host give a current client?"** — not what the asserted
  request negotiated (the probe is a second connection), and not the server's whole offer (a host
  supporting RC4 alongside AES-GCM negotiates AES-GCM and is correctly silent). Enumerating
  everything a server would accept takes one handshake per suite, and belongs to `tflw scan`
  (D299).
- No handshake at all when the severity floor has already excluded both TLS rules — the floor
  narrows the pack before applicability, so a `critical`-floor assertion never consults them, and a
  connection opened for an assertion that cannot use it is one nobody asked for (D302).
- A probe that cannot connect makes both rules *not applicable*, never an error — a network failure
  is not a security verdict. But it is **announced** on every result line, passing ones included:
  a rule blocked by a failed instrument is reported differently from one blocked by its
  precondition, because the first means the assertion did less than it was asked to (D300).

### Added — pen-test arc, Tier 2 (`0.4` internal milestone, M130)

- **`expect`/`check response has no [<severity>] authorization violations`** — OWASP API #1
  (BOLA/IDOR). The request the last `api` step *actually made* is re-issued under every other
  declared principal and the responses are compared. A **separate matcher** from `security
  violations`, deliberately: folding them would make every already-shipped Tier 1 assertion start
  sending cross-identity traffic the moment its author upgraded (D303, D304).
- **The unit of input is an observed request, not a route.** 79% of `api` paths in a real suite
  carry a `{interpolation}`, so a static endpoint × session cross-product yields addresses nobody
  can dial. The probe is rebuilt from the observed trace rather than re-run through the step, which
  would re-evaluate `unique(…)`/`random(…)`/`{var}` and ask about a resource the owner never
  touched (D303, D323).
- **The oracle is differential on resource identity, not on status codes.** An admin legitimately
  gets a byte-identical `200` on another user's order, and a collection endpoint's correct answer
  for a non-owner is a filtered `200` — both invisible to a status oracle. Extraction is narrow
  (bare root `id` only; an envelope yields *no resource identity found*, a failure rather than a
  pass) and containment is wide (a scalar-leaf walk at any depth, exact equality), because a leak
  returned under a different key is still a leak (D305, D321, D322).
- **Five probe outcomes, and `clean` has to be earned.** `429`, any `5xx`, a non-JSON body and a
  CSRF-shaped `403` are all *inconclusive*, so a suite that trips its own rate limiter can never
  report the throttle as an authorization boundary. `404` sits with the refusals, because returning
  `404` rather than `403` to avoid revealing a resource's existence is the more careful of two
  correct implementations (D324, D325).
- **`session <name> [oauth2] privileged`** — a principal that is *meant* to reach other principals'
  resources is left out of the probe set. A claim about authority, not a speed knob: marking every
  session privileged is refused (D307, D310).
- **`probe mutating`**, an optional indented sub-clause under `authorized target` — permission for
  a probe to re-issue a `POST`/`PUT`/`PATCH`/`DELETE` against *that host*. Without it a mutating
  step reports `not probed` rather than silently sending writes somewhere nobody said it could. The
  one-line declaration is unchanged (D311, D330).
- **`TF062`/`TF063`/`TF064`** — a step naming its own credential, an assertion with no principal to
  judge with, and an assertion inside `wait until api` (which re-polls until its expects pass, so a
  real finding would be re-probed on every poll and reported as a *timeout*). `TF033` covers the
  same rule inside a workload. `TF062`/`TF063` are each a lexical refusal **plus** an exact runtime
  guard, because calls bind late and an `action` body's owner is not statically knowable
  (D315, D328, D329).
- **Every finding emits a runnable `.tflw` repro** under `report/authz-repro/`, with **per-rule
  templates**: a collection leak's correct answer is a filtered `200`, so a single always-`403`
  template would emit a regression that goes red the moment somebody fixes the bug. Names are
  derived from rule + method + path + principal, so duplicates collide into one file instead of
  racing (D314, D332).
- **The run states its own blind spot.** `authz coverage: N of M api steps in the suite sit in a
  test that declares an owner` — a static census over every discovered file, printed beside the
  `authorized target` reason, so "we probed everything we asserted on" cannot be read as "we probed
  everything"; plus this run's own declines, aggregated (D331).

### Added — pen-test arc, Tier 3 (`0.4` internal milestone, M134)

- **`expect`/`check response has no [<severity>] input handling violations`** — the request the last
  `api` step actually made, re-sent once per (mutable input × payload) with **exactly one** input
  replaced. Two bare words, not `input-handling`: the lexer's identifier rule is `[A-Za-z0-9_]` and
  `-` is the minus operator, so a hyphen cannot appear in a tflw keyword, and the hyphenated spelling
  the plan proposed is a parse error (D366, as corrected in build).
- **It changes no identity, and that is the whole difference from Tier 2.** Tier 2 strips
  `Authorization`/`Cookie` and applies a different principal; this scan moves only the payload, so
  the observed request's own `X-CSRF-Token` travels with every probe and the probe reaches the code
  it was sent to test. Consequently there is deliberately **no `TF062`/`TF063` analogue** — no owner
  is required, and a step carrying its own credential is fine (D370, D375).
- **A fixed, enumerable corpus — no sampling, no seed.** 15 payloads in four classes, applied to
  every mutable input in a fixed order, so a run's request count is a number you can put in a report
  and it is the same number tomorrow. A seeded random fuzzer would need a corpus-coverage story tflw
  has no machinery for, and would produce findings whose fingerprints moved with the seed
  (D367).
- **Three kinds of mutable input** read off the observed request: an identifier path segment (UUID,
  all-digits, or 24+ hex), a query parameter, and a JSON body leaf. Type-confusion payloads apply to
  body leaves only — a path segment and a query value are strings by construction, so there is no
  type there to confuse. Path and query payloads are percent-encoded, or `../` would be normalised
  away by the URL parser before the request left the process (D371).
- **The bar is disclosure, not status.** A bare `5xx` is **not** a finding — plenty of correct
  applications answer `500` to a type they never expected, and Tier 1's zero-false-positive bar is
  not renegotiated. Four rules read for evidence instead: `sec/error-detail-disclosure` (serious),
  `sec/reflected-input-unescaped` (moderate), `sec/path-traversal-read` (critical),
  `sec/oversized-input-accepted` (minor). Each **subtracts the control response's own hits**, so a
  finding means this payload caused it rather than that the string was always there (D373).
- **Three outcomes, not Tier 2's five** — `answered` (any status the host produced, `5xx` included),
  `inconclusive` (`429` only), `not probed`. A `5xx` is a first-class answer here because the app
  demonstrably *did* process the payload, which is the thing being asked about.
- **`probe oversized` and `probe traversal`**, two new indented sub-clauses under `authorized
  target`, siblings of `probe mutating` and each granting only itself. Off by default because one
  class is exhaustion-shaped and the other's positive finding *is* the act of reading the file. This
  is where D21 safety layer 4's "per class" language first has literal classes to apply to; Tier 2's
  single boolean discharged the layer for a tier that had one class, and the layer was re-opened
  rather than assumed discharged (D372).
- **`TF067`** — an assertion on a request with nothing to mutate (no id segment, no query, no JSON
  body leaf) had no power to fail, and fails. A checker code with a runtime twin that reuses it, so
  the interpolated cases the checker deliberately stays silent about are still caught. The checker
  answers *false* on every uncertainty: a `{var}` in the path may bind to an id, a `body from` file
  is not the checker's to read, and raw text may well be JSON (D382).
- **`TF064` widened, not duplicated.** The `wait until api` refusal now covers both pentest scans
  under one code, renamed `SCAN_ASSERTION_REPEATED_REQUEST`, because the repair is one identical
  sentence for both — what makes the construct wrong is a property of `wait until api` that does not
  know which scan is asking. `TF033` covers the workload case with a blunter hint: the multiplication
  here is one probe *per payload per mutable input*.
- **Probes stay strictly sequential, one in flight**, so safety layer 5's deferral condition ("the
  first change that permits two probes in flight") is still not met and `probe rate` does not come
  due. Every result line, pass or fail, states what it cost (`3 sites, 30 requests sent, 10.0 per
  site`) and what it declined to send, because a green run that skipped two classes and a green run
  that ran them are otherwise indistinguishable (D381, D291).

### Added — pen-test arc, findings & the gate (`0.4` internal milestone, M134b)

One contract for all three scans, not three — a per-tier answer is how `--fail-on` would come to mean
a different thing depending on which matcher a file happened to use.

- **Every finding reaches the report.** `results.json` grows a `findings` array and `report.html`
  grows a **Security findings** block carrying, per finding, a stable 16-hex-character
  **fingerprint** computed from the scan, the rule, the endpoint, the location within it and the
  invariant violated — and deliberately *not* from the payload that triggered it or the response text
  proving it, so rewording an error message does not invalidate an acceptance for a change that fixed
  nothing (D376, D385).
- **`--fail-on <severity>`, `--baseline <file>` and `--baseline-write <file>`.** A scanner that goes
  red on its first run against an existing codebase gets turned off; these are what make "adopt now,
  fix on a schedule" possible. Both gates are applied *inside* the assertion, before its pass/fail
  decision, and both obey one rule: **the gate can only relax, never tighten, and never silently.**
  A test that wrote its own severity floor keeps it — the stricter of test and flag wins — because a
  command-line flag that could turn a green suite red produces a failure nobody can locate from the
  source. A withheld finding still renders, badged with which relaxation withheld it, and the passing
  line names the count: a report that agreed with the gate would describe the gate rather than the
  run (D377, D386, D387).
- **Neither gate applies to the negated form** (`not has no … violations`), where a finding is what
  makes the assertion succeed — suppressing findings there would fail an assertion for having found
  something, which is not a relaxation in any sense (D386).
- **Baselines match on the fingerprint alone.** The `rule` and `endpoint` beside each entry are for
  the human reading the file; matching on the name would let a rule renamed in a tflw release
  silently un-accept every entry that mentioned it. A malformed baseline is refused rather than
  degraded to "accepted nothing", because every failure mode of the file makes a build *greener* and
  an empty acceptance set looks exactly like a codebase that fixed everything. Stale entries are
  **reported and never removed** — a `--tag` run legitimately produces a subset of the suite's
  findings, so pruning on absence would delete acceptances the next full run still needs
  (D387).
- **`--probe-seeded <n>`** adds `n` generated mutation payloads per **already-granted** class on top
  of Tier 3's fixed corpus. It cannot widen what `authorized target` permitted — seeding is a
  capability of the run and a mutation class is a claim in the config, so no number reaches
  `traversal` on a target that never granted it. Its findings are **reported and never gate**: a
  generated payload has no stable fingerprint, appearing under one seed and vanishing under the next,
  so gating on it would either churn a baseline every run or fail a build on a coin flip. Each
  renders with the payload and the seed that drew it under the call to action *promote this payload
  into the corpus*, which makes the layer self-liquidating. Accepted consequence, stated rather than
  hidden: a real weakness found only this way does not fail CI until somebody promotes it — a finding
  you must read beats a gate you cannot trust (D369, D388).
- **Which rules ran, on passing runs too.** Every report carries a per-scan census of the rules that
  applied and the rules that stood down *with the reason*. A rule that stands down produces no
  finding, so before this the only run in which that information existed was one where something else
  had already failed — and the run where it disappeared was the ordinary green one. Closes the
  long-open row about a report that could not name its not-applicable rules (D389).

### Added — pen-test arc, remediation (`0.4` internal milestone, M135a)

- **Every finding now carries how to fix it.** All eighteen rules across the three scans have an
  authored knowledge-base entry — what the weakness is, why it is worth repairing, the repair in
  framework-neutral terms and again concretely in NestJS, a CWE id and the OWASP document the fix is
  traceable to — rendered as a collapsed *possible fixes* disclosure inside each row of the report's
  findings block. An alert that names a weakness and says nothing about repairing it is a task
  handed to somebody with the research still to do (D402).
- **A rule cannot ship without one.** Each pack exports its ids as a closed tuple and the KB is
  typed over their union, so a nineteenth rule fails the build until an entry exists for it. The
  failure this prevents is quiet — remediation missing because nobody wrote it looks exactly like
  remediation omitted because the fix was thought obvious, and it surfaces to whoever is triaging
  (D409).
- **Severity stays in the rule modules**, against the original report design putting it in the KB. It
  is already stated twice per input-handling rule; a third home is how the rule that fails a build
  and the rule shown in a dashboard come to disagree with nothing to say which is right
  (D408).
- Groundwork, not yet user-visible: the SARIF severity mapping that `M135b`'s exporter will publish —
  four tflw levels onto SARIF's three, each with the numeric GitHub actually ranks on (D406).

### Added — pen-test arc, `findings.sarif` (`0.4` internal milestone, M135b)

- **`report/findings.sarif`** — SARIF 2.1.0, ingested directly by GitHub code scanning. Each alert
  anchors to the `.tflw` line that made the assertion, carries the endpoint as a logical location
  (the endpoint is the finding's subject, but its source is usually not in the repository being
  scanned), and arrives with the remediation, the CWE tag and the references from the knowledge base
  above (D403, D405, D407). Paths are relative to the **repository root** — found by walking
  up for `.git` — rather than to the directory tflw was invoked from, because GitHub anchors an alert
  by matching the path against the checked-out tree and an unanchored alert uploads without an error.
- **Written only when the run actually scanned** — not written empty. An empty SARIF document is not
  neutral: `upload-sarif` reads an empty results array as *everything previously reported is fixed*
  and resolves the matching alerts, so a functional-only CI job emitting one would silently close the
  security job's whole backlog. Absence is a signal a workflow can test; emptiness is a signal that
  reads as good news (D404).
- **A baselined finding uploads suppressed; one below `--fail-on` uploads as an ordinary alert.**
  Accepted and unranked are different states, and a team that later lowers the floor should not watch
  a pile of alerts un-dismiss themselves with no change in the application (D410).
- **`rules[]` declares what applied**; rules that stood down are listed with their reasons under
  `runs[].properties["tflw/notApplicable"]`, so the three-state coverage model survives into the
  machine-readable artifact instead of collapsing into one empty state (D412). Seeded
  payloads are absent entirely — they have no stable identity, and a tracking system keyed on
  identity would mint a new permanent alert on every reseed (D411).
- Authorization alerts link the runnable `.tflw` repro the run already wrote (D413).
- The document is validated against the real SARIF schema in the test suite, because this format's
  failure mode is silence: an invalid document uploads successfully and produces no alerts, with no
  error to read (D414).

### Added — the declaration family in `tflw spec` (M154c)

- **`tflw spec` now emits a seventh family, `declaration`** — the seven words a file can open a
  top-level block with (`test`, `crawl`, `action`, `import`, `use`, `before`, `after`) and the five
  clauses a `test` header takes (`tags`, `with each`, `as`, `retry`, `parallel`/`sequential`). The
  manifest goes from 166 constructs to 178.
- **This was a gap in M154a, not a widening of scope.** M154a recorded three deliberate departures
  and this was not among them; its stated reason for *adding* generators applies unchanged here — a
  construct a conformance gate plants "cannot be demanded by a gate that cannot see it", and `retry`
  and `after` hooks are exactly that. Measured in the dogfood corpus when the gap was found:
  `after file` used **once**, a bare `after` **twice**, `retry` **five times**. Thin, and
  structurally invisible to any coverage gate keyed on the manifest.
- **Held to the parser behaviourally, not by comparison.** The other two-way tables assert that a
  manifest array equals a parser array, which proves the arrays agree and nothing more. Each
  declaration and header clause is instead parsed as a minimal file and the parser asked what it
  did, with a control asserting a non-declaration is still refused.
- A hook's two scopes are **one construct with two forms**, matching how `switch to new tab` and
  `switch to tab N` are one `switch`.
- The list of declarations the top-level error message names is now rendered from that same array.
  It was spelled out twice, three lines below the dispatch chain it describes — so a new
  declaration could ship with an error message denying it exists.
- **`SPEC_MANIFEST_VERSION` is unchanged at 1.** The document's shape did not change, and adding
  constructs is explicitly not a version bump. The one consumer that exists reads ids flat rather
  than filtering by family, so the twelve new ids reach it as an unaccounted-construct failure
  naming each one — a louder and more precise red than a version mismatch would have produced.

### Added — `tflw spec`, the construct manifest (M154a)

- **New subcommand `tflw spec [--json]`** — prints the construct manifest of *this build*: every
  step keyword, matcher, generator, locator, `tflw.config` word and diagnostic code the parser
  dispatches (166 today), plus a build stamp naming version, commit, dirty state and build time.
- It exists for conformance testing. A suite that wants to prove it exercises the whole language
  has to be able to ask what the whole language is, and a consumer of the published package cannot
  read that out of `@tflw/lang` — the tarball is one self-contained bundle with no `@tflw/*`
  packages to import. `--json` is the form such a gate reads.
- **A 🔮 planned construct is absent, not listed as planned.** Building one therefore makes it
  *appear* in the manifest, which turns a downstream coverage gate red on its own the day it ships
  — no badge to remember to flip, and no hand-maintained list of things that do not exist.
  `MATCHERS` is the one table carrying its own status field and is emitted verbatim, so a planned
  matcher would say so rather than quietly claiming to work.
- `LOCATORS` joins `STEP_KEYWORDS` and `CONFIG_KEYWORDS` as a manifest held **two-way** to the
  parser's own dispatch list, so `tflw spec` cannot offer a locator the parser rejects nor omit one
  it accepts. `element` (SPEC §9.3, planned) is in neither, which is the rule's worked case.
- Diagnostics contribute their **codes** and none of SPEC §17's prose — that table is ~78 KB of
  markdown written for a rendered spec section, and the code is the construct.
- The **build stamp** answers *which tflw produced this output*. `commit` is a short sha, or `null`
  where there was no git to ask (a published tarball, a vendored checkout) — never invented,
  because an invented one would be believed. `dirty` is `null` when there is no commit for it to be
  relative to. `source` is `dev` under the unbundled `npm run dev`, where the bundle-time values do
  not exist, so a consumer can refuse a build with no provenance to check.

### Added — editor support for `tflw.config` as its own dialect (M136b)

- **`tflw.config` files now have their own VS Code language id** (`tflw-config`) and their own
  TextMate grammar (`source.tflw.config`). The config dialect's declaration-only vocabulary is
  highlighted for the first time: `allow`, `hosts`, `insecure`, `cert`, `key`, `evidence`, `web`,
  `redact`, `viewport`, `oauth2`, `token`, `client`, `id`, `secret`, `scope`, `destination`,
  `level` and `query` — **eighteen words**, in both the grammar and the language server's semantic
  tokens.
- The split is what made this possible rather than an implementation detail: `key`, `web` and
  `destination` are ordinary identifiers in a `.tflw` test file, and a single shared wordlist could
  never colour them in one dialect without colouring them in the other. The config grammar is a
  delta that includes the shared one, so the two dialects cannot drift apart.
- No change to `.tflw` files, by construction and by test.

### Fixed — roadmap truth (M135b)

- The README described security testing as unbuilt and named a `tflw scan` mode that will never
  exist — the three scans ship inside `tflw run`, and the roadmap line said otherwise for two
  milestones after they landed.

### Added — pen-test arc, the un-asked subject (`0.4` internal milestone, M136a)

- **A scan now reports what it could not put a question to, not only what its rules declined.** The
  two are different facts and were reported as one: a rule that stood down looked at an observation
  and declined it; an un-asked subject means no observation ever arrived. Tier 2 has carried this
  since `M130b` for principals; Tier 3 announced it on the console and carried it nowhere, so a run
  whose entire mutation matrix was refused before it left the process wrote a `results.json`
  indistinguishable from one that probed everything.
- Both halves now reach `findings.sarif`, in the `run.properties["tflw/notApplicable"]` bucket the
  three-state model already used, with a `kind` discriminator (`"rule"` / `"subject"`) and
  namespaced ids (`principal:shopper`, `endpoint:POST /notes`) so a consumer grouping by `id` never
  compares a principal against a rule.
- The built `dist/cli.cjs` now runs **all three** scans in its own end-to-end suite. Only Tier 3 did;
  Tier 1 read as covered because its scan also runs at session establishment, where nothing asserts
  on it.
- `report.html`'s security findings block and rule census are styled. They had shipped with a full
  set of class names and no matching stylesheet rule, so the one section a reader scans by severity
  rendered as an unstyled browser table.

### Added — pen-test arc, Tier 4: the crawl (`0.4` internal milestone, M137)

The first three tiers judge a response the suite asked for. Tier 4 is the other half — it finds the
requests itself.

- **`crawl "<name>" [as <principals>]`, a top-level declaration, sibling to `test` and run by plain
  `tflw run`.** Not a sixth workload kind (a workload kind is a scheduling policy over an unchanged
  body; here the body is not what repeats — the surface is), and not a `tflw scan` subcommand, which
  stays deleted. `--tag`, `--only` and `--failed` select a crawl the way they select a test.
- **It adds a source of requests, not a kind of judgement.** A crawl body takes only the same three
  `violations` assertions Tiers 1–3 define, applied per response the crawl issues. No fourth matcher
  family and no new subject keyword — anything else in the body is `TF070`, because an `api` step
  there would be a request nobody will send under a principal nobody chose, and `expect status
  equals 200` names one response where a crawl has many.
- **Three seeds, which find different things.** `seed openapi "<source>"` reads the documented
  surface and invents path parameters, required query values and bodies for it; `seed traffic`
  re-issues every distinct route the run's own tests touched and invents nothing; `seed spider
  "<path>"` walks a page's links and forms, with `max pages` and `max depth` as optional indented
  bounds. Findings carry **`via`** — `openapi`, `traffic` or `spider` — as provenance, not identity:
  the same weakness reached by two seeds is one finding with one fingerprint, so adding a seed never
  churns a baseline.
- **`seed spider` fetches and parses; it does not render.** No browser engine, and that is a safety
  statement before it is a scope one — `allow hosts`, the blocked-port list, `authorized target`,
  the public-target refusal and the sequential pacing all live on the request path, so a spider
  issuing ordinary requests inherits every one of them. A page's links are joined against the URL it
  **finally** resolved to, so a console answering `/admin` with a redirect does not have its
  relative links read against the wrong base. Same-origin: a link off-site is reported as a skip.
- **It is the only seed whose enumeration is itself traffic**, so the walk is a phase of its own and
  discloses its cap *before* it walks — two lines rather than one. `walked` and `walkCapped` are
  reported **beside** `discovered = withheld + sent`, never inside it: a fetched page is not an
  operation, and folding it in would break the identity. A walk stopped by a bound sets
  `walkCapped`, so a truncated surface can never read as a complete one.
- **Everything discovered is accounted for.** `discovered = withheld + sent` and `reached ≤ sent`
  hold always, and every route in `discovered - reached` reaches `results.json`'s
  `scanBlindSpot.declines` and `report.html`'s blind-spot block with the reason it is there. A
  crawler that quietly dropped the routes it could not build would report a smaller denominator and
  *look* like better coverage.
- **A response that did not reach your code is not scored.** `2xx`/`3xx`/`5xx` are judged; `400`,
  `422`, `404`, `405`, `410`, `401`, `403`, `415` and `429` are not. The `400` row is the important
  one — a validator's refusal is indistinguishable from a hardened endpoint. The `401`/`403` row is
  the subtle one: if the owner was turned away at the door there is nothing to compare against, and
  reading that refusal as *clean* is the most common false negative this kind of tool produces.
- **`TF068`** — a crawl with nothing to crawl. Refused at check time when no `seed` is declared, and
  at run time when a seed came back empty *or* when a crawl sent requests and reached none of them.
  One code with a branching hint rather than two rows, because a runtime-only diagnostic has no
  check-time door for a gate to verify.
- **`TF069` is withdrawn, not renumbered, and the number is skipped permanently.** It was allocated
  and then withdrawn; by the time `TF070` was minted, six comments across three packages already
  used `TF069` as a pointer to that withdrawal, so the number was spent without ever being
  allocated. A shipped code is never reused.
- **A third `ReportEntry` kind, declared loudly.** The union had exactly two members since `M56`, so
  13 dispatch sites across 8 files could test it as a binary and be right by accident — `junit.ts`
  alone had four, where a crawl entry would have been counted as one test case, timed as a
  functional test and rendered as `<testcase>` with no consumer able to notice. `exhaustiveEntry`
  now turns each of those into a type error at the moment a member is added.
- **`session … csrf from <subject> send as header "<name>"`** — the token a credential is issued at
  login, attached to every *mutating* request that credential later makes, probes and ordinary `api`
  steps alike. It deliberately does **not** live in the session's ordinary header map: the token has
  to stay distinguishable for `sec/csrf-not-enforced` (critical) to probe a principal defined as
  *this credential minus its CSRF headers*. Merged into the header map it would be
  indistinguishable from the `Authorization` header beside it, and withholding both would measure
  authentication rather than CSRF.
- **`probe ciphers`** — a fourth `authorized target` sub-clause, and the one whose purpose is many
  connections to one host. `sec/tls-weak-cipher` has shipped since `M128a` but could only judge the
  suite tflw's own client negotiated, so a server offering TLS 1.0 and RC4 while happily negotiating
  1.3 with us read **clean**. It now enumerates the host's *offer*. One rule id, not two: what tflw's
  client happened to negotiate is a fact about tflw's client, and the offered reading is the more
  accurate measure with the negotiated one as its special case. Withheld, the rule says so rather
  than passing quietly; absent is never rendered as an empty offer.
- **A repro per originating scan.** Tier 3 input-handling findings now ship a runnable `.tflw` the
  way Tier 2 authorization findings have since `M130b` — `report/input-repro/` beside
  `report/authz-repro/`, and SARIF's `tflw/repro` join reaches both.

### Fixed — pen-test arc, five defects that shipped green (M137c1, M137c2, M137d, M137f)

Four of these predate Tier 4 and had shipped. The transferable lesson, and the reason they lasted:
**this arc checked its artifacts for shape everywhere and for effect nowhere.** Twelve rendered
repro files passing `tflw check` proves they parse. It does not prove any of them reaches the
endpoint its finding names. All were found by *running* a repro or a crawl, not by reading one.

- **A crawl resolved documented paths against the wrong base, and reported green.** Every synthesized
  URL was built as the `api` base plus the document's path, so an app behind a global prefix was
  dialled twice — `/v1/v1/health`. Measured against the live dogfood stack: `81 discovered · 50
  withheld · 31 sent · 0 reached`, **exit 0, passed**. 31 requests, none of which touched the
  application, reported green. This is spec-incorrect and not merely unlucky: under OpenAPI 3.0 an
  absent `servers`, `[]` and `[{"url": "/"}]` all mean a server of url `/`, so a document's paths are
  host-root-relative. A crawl now reads `servers[0]`, keeps the **origin** the `api` names and joins
  the document's declared prefix — the path, never the host.
- **A repro dialled a path that did not exist, and passed because of it.** The emitter wrote
  `new URL(finding.url).pathname`, which against a base carrying `/v1` emits a path tflw then
  resolves against that base a *second* time. The repro took a 404, found no leak in the body and
  passed. Latent since `M130b` — seven milestones, in the one artifact whose entire purpose is to
  fail until the bug is fixed, and SARIF's `tflw/repro` links pointed at those files. Nothing in the
  suite could have caught it: every fixture server here is `http://127.0.0.1:<port>` with no path
  prefix, where the buggy and the correct answer are byte-identical.
- **A repro was green under an env that cannot reproduce its finding.** A base-relative path with no
  way to pin an env is a silent false green by construction. Every repro now carries
  `# re-run: tflw run --env <env> <file>`, and the env is a required field rather than an optional
  one.
- **tflw discovered tests inside its own output directory.** `discoverTests` walked `report/`, so
  emitted repros were collected and run as part of the suite that emitted them. Also latent since
  `M130b`; it surfaced only when the number of emitted files doubled.
- **A resource the anonymous principal also receives is public, not leaked.** A route that hands the
  built-in `anonymous` principal the same collection it hands everyone else has no owner and
  therefore no boundary to cross, so neither leak rule has anything to say about it. Before this both
  fired: a crawl of a public API produced **20 critical findings that were all false**.
- **A followed redirect now carries the cookies the chain itself set** — a login answered with a
  redirect was throwing away the session it had just been granted.

### Changed — config directive spelling (M147b)

The rule the language never had, and the last breaking change before `1.0.0`: **a directive whose
value comes from a closed set the language defines is written as a bare keyword; a directive whose
value is a boolean or an open string is written as a literal.** Three of the four closed-set
directives were on the wrong side of it — `timeout step 10s` and `insecure true` were already right.

- `evidence "full"` → **`evidence full`**, and `evidence "headers-only"` → **`evidence headers
  only`**. Two words rather than a hyphen: tflw identifiers have no `-`, and every multi-word
  construct in the language is space-separated (the answer `input handling` already got in M134a).
  The AST value, `report.html` and `--evidence headers-only` are unchanged — a CLI argument is typed
  into a shell, not into this lexer.
- `log destination "console"` → **`log destination console`**, `log level "warn"` → **`log level
  warn`**. `LOG_LEVELS` was previously spelled *both* ways in one language: bare in the statement
  dialect (`log warn "…"`), quoted in the config dialect.

Each retired spelling is a `TF010` naming the bare form and carrying a `tflw migrate` payload, so
`tflw migrate` rewrites an existing config in place. These are the first three real deprecations
`migrate` has had; it had been proven against synthetic diagnostics for four arcs.

The enumerated values are now `ident` tokens in a config buffer, which is what finally makes the
editor able to colour them — a reversal M142 recorded as unreachable *against the grammar of the
day*, and it was right then.

### Changed — `results.json` (M136a)

- **`authzBlindSpot` → `scanBlindSpot`, and `declines[].principal` → `declines[].subject` with a new
  `scan` field.** Breaking for anything reading that field. Taken now rather than after Tier 4
  doubles the number of producers: the field is named for one tier and carries two, and a name that
  lies about its contents is how a report comes to describe the same state in two vocabularies.
  `coverage` is unchanged and stays authorization-only — it counts `api` steps in a test declaring an
  owner, which is a fact about the suite that no other tier has an equivalent of.

### Changed — grammar freeze (M66–M69)

The shipped grammar is frozen additive-only from `1.0.0` on, so every incompatible change had to
land before it. Each of these is a hard parse/check error naming its replacement, not a silent
behavior change:

- `check <locator>` / `uncheck <locator>` (the browser checkbox actions) → **`tick` / `untick`**,
  freeing `check` to mean only "soft assertion". Bare `check <locator>` is now `TF014` and
  `uncheck` is `TF011`.
- `think <duration>` → **`pause <duration>`**, avoiding a collision with the existing `wait until`
  construct; `wait until … for <duration>` was added alongside it.
- The test-header modifiers became order-independent, `ReportDecl.dir` keeps its string literal,
  and three further grammar-surface fixes landed in the same sweep.

### Fixed — launch review (M59–M77)

A systematic pre-`1.0.0` review of the whole surface. Highlights:

- Three lexer defects, and the checker's pass list unified so a file is checked once by one
  ordered pipeline rather than by several ad-hoc traversals.
- Redaction reached every sink: the ndjson stream had bypassed the final redaction pass, and
  file-based log sinks were not redacted at all.
- `junit.xml` gained `<testsuites>`, per-file `<testsuite>` elements and `classname` attributes, so
  CI servers attribute a failure to the right file.
- An empty `--tag`/`--only` value ran the entire suite instead of erroring.
- `check --format json` attributes every diagnostic to its own file instead of flattening several
  files into one array with colliding spans.
- `exclude` stopped silently ignoring file paths, and `--verbose`/`--bail`'s per-file behavior is
  now documented against `--parallel`, the flag that actually controls it.
- The ndjson event stream became a documented contract (every `test:start` has a matching
  `test:end`, on every path), with a regression test per guarantee.
- Documentation gained a mechanical guard: every fenced block in the docs site is classified, and
  every `tflw` sample is executed through the shipped `dist/cli.cjs` rather than trusted.

### Fixed — launch review, checker & lexer contracts (M89–M98, M97e, M100)

- `body pdf text` no longer fails on roughly 1 PDF in 300. A content stream's extent now comes from
  its dict's `/Length` (including the indirect `/Length N 0 R` spelling) instead of from a scan of
  its own binary bytes; the old code dropped a byte whenever the compressed data happened to end in
  CR, and `expect body pdf text …` failed with `could not decompress content stream` (M100).


- The checker's relationship to the runtime became a stated contract rather than an aspiration:
  every rule the runtime enforces is either decided statically first or carries a written reason it
  cannot be, checked by a source scan that fails when the two lists drift.
- `tflw check` now reports a path literal that names a file which is not there (`TF043`) — covering
  `import`, `use`, `with each from`, `body from`, `upload`, `matches file` and `drop file`. Before
  this, a suite with a mistyped import checked clean and then printed `✗ t.tflw (crashed) (0 ms)`
  as its *entire* run output, `--verbose` included.
- **`TF043` reports at two severities.** `import`/`use` are an error — `tflw check` opens those
  files itself. The five a *step* opens are a warning, because a file that is not there at check
  time may be created by an earlier step, a hook or a fixture build before the step that reads it
  runs. Reported at error severity for one release, this made a valid suite unrunnable with no
  override; `tflw check`'s summary line counts warnings instead of claiming `no problems found`.
- Lexer diagnostics report the fact they already had: an unclosed bracket points at the bracket
  rather than at a synthesized dedent past end-of-file, an empty `@` tag is an error instead of an
  unusable tag name, an unsupported string escape is refused rather than silently dropped, and tab
  indentation and invisible/confusable characters are named for what they are.
- Diagnostic carets are placed in terminal cells rather than UTF-16 code units, so a line
  containing wide or combining characters underlines the span the reader can see.

### Fixed — the open model's client (M121)

- **An open (`rps`) workload no longer reports the inter-arrival gap as request latency.** Both load
  models now send over the same `node:http` keep-alive client; the open model previously used
  `fetch`, and on Node 26 a `fetch` issued from a timer callback that its own loop does not await —
  exactly how an open arrival is dispatched — has its completion deferred to roughly the next timer
  tick. The reported duration therefore tracked the arrival gap rather than the service time: on one
  0.2 ms endpoint, in one process, `hold 10 rps` reported p50 36 ms while `hold 1 users` reported
  0 ms. The error was largest precisely where it misleads most — a fast target at a low rate, i.e. a
  healthy service. Every arrival in a scenario shares one connection pool, and that pool is
  deliberately unbounded: a bounded one would queue arrivals inside the generator, where the wait
  *would* be counted as service time.

  Node 22 and 24 are unaffected, as is every non-workload `tflw run` and the closed (`users`) model
  on all versions. No previously published measurement changes — every performance corpus tflw
  ships uses the closed model. Full chain, version bisect and a standalone reproduction:
  `tflw-acceptance/perf/profile/FINDINGS_M121_OPEN_MODEL_FETCH.md` in the dogfood repo.

### Fixed — locator suggestions on assertions, not just actions (M119)

- **A misspelled locator now gets the same "nearest matches on the page" suggestions in
  `expect`/`check`/`wait until` that it already got in `click`/`fill`.** `click button "Add to Crat"`
  named the real `button "Add to Cart"`; `expect button "Add to Crat" is visible` said only *"but got
  no matching element"* and stopped — the same typo answered two ways depending on the verb, in the
  half of a suite where most failures actually happen. The suggestions are appended only on a step's
  final failure and only when nothing matched at all: with an element resolved the failure is about
  its state, not its name, so a list of similar names would point away from the cause. Absence that
  the matcher is happy with — `is hidden`, `has count 0` — still passes, and a passing step is never
  annotated.
- **The generator's saturation verdict is tested at its real thresholds instead of raced for.** The
  self-diagnosis test that proves a blocked event loop reports itself as saturated used to also
  assert the process had held more than 50% of a core — a number that measures the machine's
  scheduler rather than tflw, and that a busy loop cannot guarantee on a contended box. It went red
  twice on that assertion alone while the behaviour it was named for passed both times. The verdict
  is now a pure `isSaturated`, with the lag arm, the CPU arm (at its actual 90% threshold, which no
  test had ever covered) and the short-window floor each pinned deterministically.
- **A failing `text` locator no longer suggests the document `head`.** Because the `text` scan looks
  at every element and only leaves carry a name, every container fell into the "no usable name"
  arm and was offered as a ready-to-paste `css` path — `css "html"`, `css "html > head"`,
  `css "html > body"` — ranked by position in the document rather than by any relationship to what
  was typed, and one of them can never be visible. An element with no text is not a misspelling of
  a text locator, so when nothing on the page is similar enough the message is now left unchanged.
  Icon-only buttons and unlabelled fields keep their generated `css` suggestion, which is the case
  that arm was written for.

### Fixed — the first two minutes (M118)

- **`tflw init` then `tflw run` is green in an empty directory.** The scaffolded config points `api`
  at `tflw://demo`, tflw's own bundled demo service — a real HTTP server started for the run on an
  ephemeral loopback port and stopped on every exit path, answering `GET /health` and nothing else.
  The README has annotated that second command "green in seconds" since `tflw init` existed, and it
  was `FAIL 0/1 passed`: the scaffold pointed at `http://localhost:3001`, where nothing listens in a
  fresh directory. Swapping that one line for your own service is the intended first edit, and the
  scaffold says so. A demo run is labelled in the CLI summary and in `report.html` — a green run that
  proves nothing about your system must not look like one that does. `tflw check` never starts it.
- **`tflw install-browsers` says what happened.** On success it names the engine and the
  `playwright` version that now has the binary — previously it printed *nothing at all*, on either
  stream, which is indistinguishable from a no-op or a silent hang. On failure Playwright's own
  output still passes through, now with a tflw summary naming the three things that actually cause
  it (a proxy, no route, no disk), and exit 2 rather than the exit code that means "a test failed".

### Changed — what ends a value (M99)

tflw has no reserved words, so a bare variable followed by a keyword was indistinguishable from a
multi-word call name. The parser always guessed "call", and reported the variable as a missing paren.

- **A bare name followed by a keyword is now a variable.** `let x = random number lo to hi`,
  `random date between a and b`, `format d as "yyyy-MM-dd"` and `select size from field "Size"` all
  parse; a word run that really was reaching for a call still says so. Braced `{x}` was always
  accepted in these positions and is unchanged. SPEC §7.1.1 documents the bare form for the first
  time — it has existed since `0.1` and was never written down.
- **`random password`'s optional length must be a number or a `{var}`.** It is the only value in the
  grammar that is both optional and unmarked, so a bare word there was taken as the length:
  `select random password from field "pw"` consumed `from`. `random password n` is now an error
  naming the three working spellings. No corpus program used it.
- **A duration unit must touch its number in every position.** `pause 250 ms` was accepted while
  `expect duration is less than 250 ms` was already an error; the check now lives in the shared
  duration parser, so both positions and both dialects agree. No corpus program used the spaced
  form.

## [0.1.0] — 2026-07-06

First public draft. API-only — the browser half lands in `0.2.0`.

### Added

- `.tflw` DSL: a `tflw.config` dialect (`env`/`defaults`/`session`/`require env`), `test`/`action`/
  `before`/`after` blocks, `import`/`use` for shared actions and a JS/TS escape hatch.
- `api` steps for GET/POST/PUT/DELETE/PATCH; all four request-body forms (`body { … }`, `body from
  "file"`, `form k=v`, `upload`) plus raw `body text`; named services; per-step `timeout`; `without
  redirects`.
- A closed assertion grammar: `expect` (hard) and `check` (soft) over status/header/`body.<path>`/
  `body text`/`duration`, with `any`/`all` quantifiers and a `not` negation.
- `capture` + chaining (create → use → verify across steps), `let`, and value expressions
  (arithmetic, string interpolation, `today`/`now` date math).
- `unique(...)`/`unique email`/`unique like "…"`/`unique uuid` (collision-safe) and `random number`/
  `random date`/`random of`/`random like "…"`/`random uuid`/`random password [N]` (value-shaped)
  generators; a run seed with `--seed`/`--now` replay. `base64`/`hex`/`url` `encode(...)`/
  `decode(...)` value transforms.
- `session <name>` blocks: run once per run, auto-apply captured headers to every test running
  `as <name>` — no repeated login boilerplate. A session now auto-refreshes on a `401` (bounded to
  one retry) and honors its own TTL if it has one; `session <name> oauth2` sugar runs a
  client-credentials grant and sets that TTL from `expires_in`. Per-env `cert`/`key` config keys
  add mTLS client-certificate support.
- Orchestration: `@tags` + `--tag a,b,c` (comma-separated OR — a test runs if it carries any
  listed tag; combines with `--only` as AND), `retry N` with `flaky` marking, inline (`with each`) and
  file-backed (`.csv`/`.json`) data tables, `--workers N` (in-process, per-file, default 1,
  deterministic under `--seed` at any concurrency).
- Teaching-quality diagnostics: source line + caret + "did you mean", stable `TF0xx` codes, a
  conservative unknown-variable/unknown-service checker pass.
- Reporting: a self-contained, theme-aware `report.html` (step timeline, full request/response
  detail, screenshots-ready layout for `0.2.0`) plus `junit.xml` for CI; secrets (`env(NAME)`) are
  redacted from every report, trace, and CLI line automatically.
- Safety/redaction: `allow hosts "…"` config allowlist — a request to a host outside the list is
  refused before any network I/O; `--forbid-insecure` fails a run up front if `insecure true` is
  active; `evidence full|headers only|none` config key + `--evidence` CLI override control how
  much of the request/response trace lands in the report (never affects what `expect`/`capture`
  can see); `redact body.email, body.*.address` masks matching JSON fields with `[redacted]` in
  the report, a declarative mechanism distinct from the existing `env(...)` secret redaction — now
  also masking a plain `body.<path>` `capture`/`expect`/`check` step's own detail text when its
  subject is redact-covered (closes TFLW-GAPS.md gap #15), not just the request/response trace;
  quantified `any`/`all` assertions are a documented exception, left unmasked.
- Contract validation: `expect body matches schema "Name" from "source"` runs real ajv JSON-Schema
  validation against a schema in an API's own generated OpenAPI document (`components.schemas`),
  including cross-`$ref` resolution — the assertion itself fetches and caches the document.
- `retry honoring "Retry-After" up to N` — a per-step `api` clause that re-issues just that one
  request when its response carries a `Retry-After` header (seconds or HTTP-date), sleeping the
  indicated duration before each re-attempt; distinct from `retry N`, which retries a whole test.
- `tflw run` and `tflw init` (scaffolds `tflw.config` + `example.tflw`); `tflw --version`/`-v`.
- Packaged as a single self-contained `dist/cli.cjs` (esbuild bundle). Bundles two real runtime
  dependencies, `undici` (mTLS client-cert request path) and `ajv` (contract/schema validation) —
  both build-time only, never installed by a consumer; every other request still uses Node's plain
  global `fetch`.
- Documentation site (VitePress, `packages/docs-site`, deployed to GitHub Pages): a hand-adapted
  Guide, a generated Reference (matchers/generators/CLI flags, from a new canonical
  `packages/lang/src/spec-data.ts` manifest that also regenerates SPEC.md's own matcher/generator
  tables), the Grammar reference, an Editor page (install, plus live in-page demos of diagnostics,
  hover, autocomplete, go-to-definition, rename, signature help, and semantic highlighting — each
  one runs the real `@tflw/lang`/`@tflw/lsp-server` classifier and resolver code client-side against
  an editable or fixed sample, not a screenshot or recording), and an in-browser parse+check
  playground. `GRAMMAR.md` was refreshed to cover the full grammar through this release (it had
  been a frozen M0-only snapshot).
- `tflw lsp` — a real Language Server Protocol implementation (`packages/lsp-server`), replacing
  the VS Code extension's old child-process `tflw check --format json` diagnostics. Diagnostics,
  hover, go-to-definition, autocomplete, rename, and signature help, all live over debounced
  in-process reparsing, for both `.tflw` test files and `tflw.config`; a `tflw.env` VS Code setting
  controls which environment diagnostics resolve services/sessions against. `tflw lsp` itself
  speaks LSP over stdio, so any LSP-capable editor (not just VS Code) can use it. It also serves
  `textDocument/semanticTokens/full`, coloring matcher/operator words, numbers, variable/parameter
  names, and object-literal field keys using the editor's own built-in default semantic palette —
  richer and theme-independent, closing a gap the static TextMate grammar structurally can't (it
  has no way to color arbitrary user-chosen names, and some of its scopes go unstyled under
  themes that don't define rules for them).
- `expect`/`check request connects`/`fails` — asserts on the connection attempt itself rather than
  a response: a request that fails before any HTTP response exists (a TLS handshake rejection, DNS
  failure, `ECONNREFUSED`, an `allow hosts` block) can now be the expected, passing outcome of a
  test instead of always crashing the run. `fails matching "<regex>"` asserts on the failure reason
  too, reusing the same teaching-error text already unwrapped for connection failures. Opt-in per
  request (only an `api` step immediately followed by a `request` assertion catches the error;
  every other request keeps today's unconditional fail-fast); a `request` assertion can't be
  combined with a response-based one on the same request, and isn't supported inside `wait until
  api` (both checker errors, `TF031`).
- CI ergonomics + console/log output: `report/results.json` (always written, the same redacted
  run report as JSON, no flag) and `report/.last-run.json` (always overwritten, feeds `--failed`).
  `tflw run --failed` re-runs only the previous run's failing tests; `--bail` stops after the
  first failing test (in-flight files still finish under `--workers > 1`). `--format ndjson`
  streams the event log as one JSON line per event (always file-tagged, full detail regardless of
  `--verbose`) instead of human text, also written to `report/events.ndjson`. Console output now
  gets an `HH:MM:SS.mmm` timestamp prefix by default (`--no-timestamps` opts out); on GitHub
  Actions, `--verbose` output folds into a collapsible `::group::`/`::endgroup::` block per test
  (auto-detected, no flag). `--log-file <path>` duplicates console output to a file, always plain
  text regardless of stdout's own color state.

### Fixed

- `tflw.config`'s `require env` list would hang the parser (and, on a second attempt, crash Node
  with an out-of-heap error) if a trailing comma preceded the newline — a malformed multi-line
  continuation left the parser's config recovery loop stuck reprocessing the same token forever.
  Now reports bounded diagnostics and recovers normally; `require env` itself still needs to stay
  on one line (no continuation support).
