# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Internal milestone labels track the
arc order: `0.1` (API) → `0.2` (browser) → `0.3` (performance) → `0.4` (pen-test) → `1.0.0`. None
of `0.1`–`0.4` is ever actually published — **the first `npm publish` is `1.0.0`**, gated on all
four arcs plus one final integrated acceptance pass against the real dogfood app (`PLAN.md`
decision 112). The shipped API grammar is frozen additive-only from `1.0.0` on: no existing syntax
changes, only new syntax.

## [Unreleased]

Everything below is built and verified but not yet published — it ships as part of `1.0.0`, which
is gated on the pen-test arc plus one final integrated acceptance pass (decision 112). The
performance arc closed 2026-08-02 and is included below.

### Added — enterprise arc (M9–M28)

- Session hardening: refresh-on-`401`, per-session TTL, `session <name> oauth2` client-credentials
  sugar, and per-env `cert`/`key` mTLS client certificates (decisions 99–100).
- Safety and evidence controls: the `allow hosts` allowlist, `--forbid-insecure` as a CI policy
  gate, `evidence full|headers-only|none`, and `redact` (decision 101).
- `matches schema` contract validation against a JSON Schema or OpenAPI document (cached per run),
  and `Retry-After`-aware retry (decision 102).
- The documentation site (VitePress) plus `spec-data.ts` — one structured manifest of matcher,
  generator and CLI-flag signatures that SPEC.md's tables, the Reference pages and the LSP's
  hover/signature help are all generated from, instead of four hand-maintained copies (decision 103).
- **A real Language Server** (`tflw lsp`, `packages/lsp-server`): diagnostics, hover,
  go-to-definition, completion, rename, signature help and semantic tokens, with the VS Code
  extension reduced to a client over it (decisions 104–105).
- Connection-failure assertions — `expect request connects` / `expect request fails` (decision 108).
- CI ergonomics: `--failed` (replay last run's failures), `--bail`, `--format ndjson`,
  `--no-timestamps`, `--log-file` (decision 111).

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
  because the grammar has been additive-only since the first release (decision 45), so every run
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
  `run N iterations across M users` (decisions 97/98/102).
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
  presence of a workload clause (decisions 93–96, 103). `scenario` is now a hard `TF033` error
  naming its replacement.
- `tflw load` was **removed** and folded into `tflw run`, which drives functional and
  workload-bearing tests alike in one pass, in file declaration order (decisions 105–115).
- A `parallel`/`sequential` test-header modifier controls a test's concurrency with its
  file-siblings; `--parallel N` (file concurrency) and `--workers N` (load generation) are separate,
  unrelated axes, and `--skip-workload` drops workload-bearing tests for fast functional iteration.
- Workload results render **inline with the functional ones** in the same `report.html`/`junit.xml`/
  `results.json` — there are no separate `load-*` artifacts (decisions 116–122).
- An `exclude` config directive for file discovery (decision 127).

### Added — pen-test arc, Tier 1 (`0.4` internal milestone, M128)

- **`expect`/`check response has no [<severity>] security violations`** — a built-in pack of twelve
  HTTP hygiene rules (cookie flags, HSTS/CSP/`X-Frame-Options`/nosniff, credentialed CORS
  wildcards, cacheable authenticated responses, version disclosure, TLS protocol version and cipher
  suite) run over the response the last `api` step received, reusing the `Finding`/severity model
  the a11y scan introduced (decisions 283, 289, 290).
- **Applicability is a third state.** Every rule declares a precondition; a rule whose precondition
  is unmet reports *not applicable*, which is neither a violation nor a silent pass. Without it,
  `hsts-missing` and `cookie-not-secure` would fire on every response of every plaintext suite
  (decision 284).
- **An assertion where no rule applied fails**, with a dedicated message naming each precondition
  that went unmet — a scan that could not have failed must not report a pass (decision 285). A
  severity floor narrows which rules run at all, so the printed counts describe the work actually
  done (decision 296).
- **A `session` block's own login response is scanned once, at establishment**, with findings
  attributed to the session by name and folded into that test's security assertions — otherwise a
  suite whose session cookie lacks `HttpOnly` reports clean (decision 287).
- **`authorized target "<url>" reason "<text>"`** in `tflw.config` — the declaration layer of the
  safety model, required before any security assertion (`TF060`) and rejecting wildcards and
  scheme-less targets (`TF061`). The reason is printed in the CLI summary and embedded in
  `report.html`, so every artifact records the claim that permitted the scan (decisions 21, 291).
- **`sec/tls-version-old` and `sec/tls-weak-cipher`**, from a stdlib `tls.connect()` probe to the
  same host — the runtime drives Node's `fetch`, which exposes neither the negotiated protocol nor
  the cipher, and the dependency that would is the one the zero-runtime-dep bundle declined. One
  handshake per `host:port` per **run**, obeying `allow hosts` and re-checking the `authorized
  target` declaration against where the run actually ended up rather than the base URL the checker
  could see (decision 288).
- The probe deliberately offers a **TLS 1.0 floor**, below Node's own `DEFAULT_MIN_VERSION` — a host
  speaking nothing but a deprecated protocol would otherwise refuse the handshake, leaving
  `tls-version-old` unable to fire in the one case it exists for. Measured: offering an old floor
  never drags a healthy server down, because the server still picks the newest version both sides
  speak. Cipher suites are *not* widened the same way, since reaching a legacy-cipher-only peer
  needs OpenSSL's `@SECLEVEL=0`, which also lowers what counts as an acceptable certificate
  (decision 298).
- Both TLS rules answer **"what does this host give a current client?"** — not what the asserted
  request negotiated (the probe is a second connection), and not the server's whole offer (a host
  supporting RC4 alongside AES-GCM negotiates AES-GCM and is correctly silent). Enumerating
  everything a server would accept takes one handshake per suite, and belongs to `tflw scan`
  (decision 299).
- No handshake at all when the severity floor has already excluded both TLS rules — the floor
  narrows the pack before applicability, so a `critical`-floor assertion never consults them, and a
  connection opened for an assertion that cannot use it is one nobody asked for (decision 302).
- A probe that cannot connect makes both rules *not applicable*, never an error — a network failure
  is not a security verdict. But it is **announced** on every result line, passing ones included:
  a rule blocked by a failed instrument is reported differently from one blocked by its
  precondition, because the first means the assertion did less than it was asked to (decision 300).

### Added — pen-test arc, Tier 2 (`0.4` internal milestone, M130)

- **`expect`/`check response has no [<severity>] authorization violations`** — OWASP API #1
  (BOLA/IDOR). The request the last `api` step *actually made* is re-issued under every other
  declared principal and the responses are compared. A **separate matcher** from `security
  violations`, deliberately: folding them would make every already-shipped Tier 1 assertion start
  sending cross-identity traffic the moment its author upgraded (decisions 303, 304).
- **The unit of input is an observed request, not a route.** 79% of `api` paths in a real suite
  carry a `{interpolation}`, so a static endpoint × session cross-product yields addresses nobody
  can dial. The probe is rebuilt from the observed trace rather than re-run through the step, which
  would re-evaluate `unique(…)`/`random(…)`/`{var}` and ask about a resource the owner never
  touched (decisions 303, 323).
- **The oracle is differential on resource identity, not on status codes.** An admin legitimately
  gets a byte-identical `200` on another user's order, and a collection endpoint's correct answer
  for a non-owner is a filtered `200` — both invisible to a status oracle. Extraction is narrow
  (bare root `id` only; an envelope yields *no resource identity found*, a failure rather than a
  pass) and containment is wide (a scalar-leaf walk at any depth, exact equality), because a leak
  returned under a different key is still a leak (decisions 305, 321, 322).
- **Five probe outcomes, and `clean` has to be earned.** `429`, any `5xx`, a non-JSON body and a
  CSRF-shaped `403` are all *inconclusive*, so a suite that trips its own rate limiter can never
  report the throttle as an authorization boundary. `404` sits with the refusals, because returning
  `404` rather than `403` to avoid revealing a resource's existence is the more careful of two
  correct implementations (decisions 324, 325).
- **`session <name> [oauth2] privileged`** — a principal that is *meant* to reach other principals'
  resources is left out of the probe set. A claim about authority, not a speed knob: marking every
  session privileged is refused (decisions 307, 310).
- **`probe mutating`**, an optional indented sub-clause under `authorized target` — permission for
  a probe to re-issue a `POST`/`PUT`/`PATCH`/`DELETE` against *that host*. Without it a mutating
  step reports `not probed` rather than silently sending writes somewhere nobody said it could. The
  one-line declaration is unchanged (decisions 311, 330).
- **`TF062`/`TF063`/`TF064`** — a step naming its own credential, an assertion with no principal to
  judge with, and an assertion inside `wait until api` (which re-polls until its expects pass, so a
  real finding would be re-probed on every poll and reported as a *timeout*). `TF033` covers the
  same rule inside a workload. `TF062`/`TF063` are each a lexical refusal **plus** an exact runtime
  guard, because calls bind late and an `action` body's owner is not statically knowable
  (decisions 315, 328, 329).
- **Every finding emits a runnable `.tflw` repro** under `report/authz-repro/`, with **per-rule
  templates**: a collection leak's correct answer is a filtered `200`, so a single always-`403`
  template would emit a regression that goes red the moment somebody fixes the bug. Names are
  derived from rule + method + path + principal, so duplicates collide into one file instead of
  racing (decisions 314, 332).
- **The run states its own blind spot.** `authz coverage: N of M api steps in the suite sit in a
  test that declares an owner` — a static census over every discovered file, printed beside the
  `authorized target` reason, so "we probed everything we asserted on" cannot be read as "we probed
  everything"; plus this run's own declines, aggregated (decision 331).

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
  active; `evidence full|headers-only|none` config key + `--evidence` CLI override control how
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
