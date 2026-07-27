# Acceptance: tflw vs. raw fetch + node:test

PLAN.md decision 41's publish gate: ~10 scenarios implemented twice — once as `.tflw` tests, once
as the honest "no tool" baseline (`node:test` + the global `fetch`, Node's own built-ins, zero
dependencies) — judged on line count, readability, and report quality. Both sides run against the
same real API: automationTestPOC's sample app (`http://localhost:3001`, `npm run launch-apps`
equivalent — see the repo root `CLAUDE.md`).

Run both sides yourself:

```sh
# tflw side
cd acceptance/tflw && node ../../packages/cli/dist/cli.cjs run --no-color

# raw side
cd acceptance/raw && node --env-file=.env --test *.test.mjs
```

Both passed 11/11 (10 scenario files; `04-data-table` expands to 2 cases) when this was last run.

## Line count

`wc -l`, one scenario file per row; shared one-time infrastructure (tflw's `session` block in
`tflw.config`, raw's `_helpers.mjs`) broken out separately since it's paid once, not per scenario.

| # | Scenario | tflw | raw | raw ÷ tflw |
|---|---|--:|--:|--:|
| 1 | Health check | 4 | 10 | 2.5× |
| 2 | Login + capture-chained create | 8 | 22 | 2.8× |
| 3 | Full CRUD lifecycle | 18 | 33 | 1.8× |
| 4 | Data-driven table (`with each`) | 8 | 15 | 1.9× |
| 5 | `retry` on a flaky-prone create | 3 | 25 | 8.3× |
| 6 | Soft assertions (`check`) auditing 4 fields | 7 | 23 | 3.3× |
| 7 | `any`/`all` quantifiers over a list | 5 | 11 | 2.2× |
| 8 | `wait until api` polling for eventual consistency | 8 | 33 | 4.1× |
| 9 | Generated/unique test data | 5 | 21 | 4.2× |
| 10 | Validation + not-found error paths | 8 | 16 | 2.0× |
| — | **Shared one-time infra** (`tflw.config` session / `_helpers.mjs`) | 13 | 32 | 2.5× |
| | **Total** | **87** | **241** | **2.8×** |

## Readability & report quality (qualitative)

- **Auth is structural, not repeated.** tflw's `session admin` block is declared once and applied
  via `as admin`; every scenario after #2 has zero login code. The raw side needs a hand-written
  `login()` + a manual memo cache to even approximate this — and it still doesn't fully get there:
  `node:test` runs **each file in its own process by default**, so the "cached" token is
  re-fetched once per *file* anyway. Measured on an actual run: every raw scenario file's first
  test takes ~400–440ms (a real `/auth/login` round trip); only the *second* test inside the one
  file that has two (`04-data-table`) reuses the cache, at 5ms. tflw's run pays that cost exactly
  **once** across the whole 11-case suite (the first `as admin` test, 58ms; every later one, 1–3ms)
  — the whole run finishes in 186ms vs. raw's 561ms, roughly 3× faster, purely from not
  re-authenticating 9 extra times.
- **Soft assertions (#6) are the widest gap in code shape.** `check` reads as a flat list of
  independent field audits; the raw equivalent needs a manual `failures` accumulator and a
  hand-joined error message — more code, and the *shape* no longer mirrors "these are four
  independent things I'm checking."
- **`retry` (#5) is short in tflw and structurally safer.** tflw's `retry 2` is one word;
  hand-rolling it in raw means a `for` loop around the whole test body. Worse than the line count
  shows: the raw version can't distinguish "failed once then passed" from "just passed" (no
  `flaky` concept), and blindly retries *any* thrown error — including a real assertion bug, not
  just a transient one.
- **`wait until api` (#8) collapses a deadline-poll loop into a nested block.** The raw version is
  a hand-written `for (;;)` with its own `sleep` and timeout-tracking; easy to get subtly wrong
  (off-by-one on the deadline check, forgetting to re-fetch inside the loop) in a way the language
  construct can't be.
- **Generated data (#9): tflw's is reproducible, raw's isn't.** `unique("Batch Widget")` is
  run/worker-seeded and replays identically under `--seed`; the raw fallback
  (`Date.now()-Math.random()`) is the standard hand-rolled pattern and is *not* reproducible — a
  flaky failure tied to a specific generated value can't be replayed later.
- **Report quality is the largest gap, and it's invisible in a line-count table.** tflw's
  `report/report.html` (written after every run — see `acceptance/tflw/report/`) gives, per
  scenario: the exact request URL/headers/body and response status/headers/body, a pass/fail mark
  per step (not per test — a CRUD lifecycle's 5 `expect`s each get their own row), the run seed,
  and `•••(ADMIN_PW)`-style redaction of every secret automatically. `node:test`'s default TAP
  output gives a pass/fail per **test** and a stack trace on failure; anything about *what the
  request/response actually looked like* only exists if the raw test author remembers to
  `console.log` it — and if they do, the password used to log in prints in plaintext to stdout
  (and whatever CI log aggregator captures it), since raw fetch has no redaction concept at all.
  A manual QA can open tflw's `report.html` and understand a failure; `node:test`'s TAP output
  assumes a terminal and a stack trace reader.
- **Where raw wins:** zero install, zero DSL to learn, and full JS expressiveness (conditionals,
  loops, arbitrary libraries) with no escape-hatch indirection. For a one-off script or a test
  needing heavy custom logic, that's a real advantage tflw's closed grammar (P#25) deliberately
  gives up.

## Verdict

Line count favors tflw by **2.8×** overall, growing to 4–8× on exactly the features this milestone
built (retry, wait-until, generated data) — the orchestration surface pays off precisely where a
hand-rolled raw test needs the most incidental machinery. Report quality is a categorical
difference, not a matter of degree: raw has none of taint redaction, per-step timelines, or
request/response capture without the author building it by hand. This is a clear win over the
"no tool" baseline for the scenarios in scope for `v0.1.0` (API-only).

---

# External dogfood: restful-booker

PLAN.md decision 41's second acceptance leg: a suite against
[restful-booker](https://restful-booker.herokuapp.com), a public QA-practice API we don't control
— a more honest test of the language than our own automationTestPOC sample app, which we can (and
did) shape around tflw's own feature set. Lives in `acceptance/restful-booker/` (its own
`tflw.config` + `.env` with the API's own publicly-documented test credentials, not a real
secret). Run it:

```sh
cd acceptance/restful-booker && node ../../packages/cli/dist/cli.cjs run --no-color
```

**4/4 PASS** against the live API when this was last run (`booking-lifecycle`,
`hooks-and-cleanup`, `search-and-list`, `auth-error`), exercising:

- **Sessions (P#42) over cookie-based auth**, not a bearer header — `session admin` POSTs
  `/auth`, captures `body.token`, and sets `header "Cookie" is "token={token}"`; every `as admin`
  test gets it automatically. Proves sessions aren't bearer-token-shaped only.
- **Capture-chaining (P#7)** across a full create → read → update → delete lifecycle, each step's
  `{id}` flowing from the previous response.
- **`before`/`after` sharing scope with a session-authenticated test** — the hook's own api step
  gets the test's `as admin` headers too (they share one evaluation scope), confirmed by the
  `before` hook's authenticated `POST /booking` succeeding.
- **`any`/`all` quantifiers over a bare top-level array** — `GET /booking` returns
  `[{"bookingid": N}, …]` as the *whole* body (no wrapping object key, unlike automationTestPOC's
  `{"products": […]}`); quantifier path-walking handles an already-array body with zero special
  casing.
- **A real "API we don't control" surprise**: bad credentials return `200` with
  `{"reason":"Bad credentials"}`, not `401`/`403`. Exactly the kind of quirk this leg of the
  acceptance gate exists to surface — and `expect status equals 200` / `expect body.reason
  equals …` express it exactly as written, no special-casing needed.
- **Secrets redacted end-to-end against a real external API too** — confirmed `report.html`
  contains `•••(BOOKER_USER)` / `•••(BOOKER_PASS)`, never the plaintext credentials.

**One real gap found — and fixed the same session (SPEC §5.2, GRAMMAR.md).** A hand-formatted
multi-line `body { … }` object literal (spanning several indented lines, the way a human would
naturally write a payload with many fields) failed to parse: the lexer's offside rule read every
physical line inside the braces as its own indent/dedent signal. Every `.tflw` file in this repo
already kept object literals on one line, so this wasn't caught until writing a payload
(`firstname`/`lastname`/`totalprice`/`depositpaid`/`bookingdates`/`additionalneeds`) long enough
that a human would naturally want to wrap it. Fixed by having the lexer track `{}`/`[]` bracket
depth and suppress `NEWLINE`/`INDENT`/`DEDENT` for any line that continues an already-open
bracket — `booking-lifecycle.tflw`'s create-booking step is now deliberately written across
several lines as the regression check, and passes live against restful-booker.

---

# webV2 UI leg: tflw vs. raw Playwright + node:test

PLAN.md's M7 acceptance gate (decisions 41/50, the **1.0 publish gate** — see PLAN.md line ~2175
and PLAN_BROWSER_PERF_SECURITY.md's "Acceptance" section): 5 representative scenarios out of the
~10-test mixed UI/API dogfood corpus (`testFlow-tests/tests/webv2-storefront.tflw` and
`tests/.env-specific/webv2-admin.tflw`, that repo's own dedicated `PROGRESS.md` entry), each
implemented twice — once as `.tflw`, once against raw `playwright` (the library tflw's own
browser layer sits on, not the `@playwright/test` runner — that runner is itself a tool with
auto-wait web-first assertions and fixtures, which would unfairly narrow the gap this comparison
exists to measure) + `node:test`. Both sides run against the same live webV2 storefront
(`testFlow-tests`' Docker stack — `node cli.mjs start` in that repo — `http://localhost:8090`).

Run both sides yourself:

```sh
# tflw side
cd acceptance/webv2/tflw && node ../../../packages/cli/dist/cli.cjs run --no-color

# raw side
cd acceptance/webv2/raw && node --env-file=.env --test *.test.mjs
```

Both passed 5/5 when this was last run — tflw in 5449ms, raw in 1188ms. The gap is **not** a tflw
regression against the API-only leg's 3×-faster finding above: `node:test` runs test *files*
concurrently by default (raw's 5 browsers launch in parallel, across processes), while `tflw run`
defaults to sequential file execution. Handing tflw `--workers 5` closed the wall-clock gap
(6555ms → 1823ms) but surfaced a real finding of its own: the drag-drop scenario's cart-item-count
assumption isn't safe under concurrent workers sharing the same seeded user account — a session's
cookie jar isolates *auth* per test (SPEC §10, D10) but never isolates *server-side resource
state* like a cart, so two tests mutating the same account's cart in parallel can race. Reported
here rather than tuned away — this is exactly the kind of gap live acceptance testing exists to
surface, and it's a property of the *scenario* (a shared-account cart), not of any of the 5 tests
run by default above.

## Line count

`wc -l`, one scenario file per row; shared one-time infrastructure (tflw's `tflw.config`, raw's
`_helpers.mjs`) broken out separately since it's paid once, not per scenario.

| # | Scenario | tflw | raw | raw ÷ tflw |
|---|---|--:|--:|--:|
| 1 | Row-scoped add-to-cart + async toast | 11 | 18 | 1.6× |
| 2 | Full checkout — product→cart→iframe payment→network assertion | 26 | 54 | 2.1× |
| 3 | Native HTML5 drag-drop cart reorder | 38 | 50 | 1.3× |
| 4 | Real-file drop onto a non-`<input>` drop-zone, dynamic field id | 10 | 43 | 4.3× |
| 5 | Accessibility scan (axe-core) across 2 pages | 13 | 33 | 2.5× |
| — | **Shared one-time infra** (`tflw.config` / `_helpers.mjs`) | 11 | 55 | 5.0× |
| | **Total** | **109** | **253** | **2.3×** |

## Readability & report quality (qualitative)

- **The iframe + network-observation scenario (#2) is the widest gap.** tflw's `within frame
  css "…"`, `wait until … is enabled`, and `expect request to "…" with method "…" was made` each
  collapse a whole raw idiom: `page.frameLocator(…)` needs no extra code (fine), but "wait for a
  button to become enabled" has no raw primitive at all (hand-rolled poll loop), and network
  observation needs a `page.on('requestfinished', …)` listener attached *before* navigation even
  starts, plus manual filtering by URL substring and method afterward — miss the early attach and
  the assertion has nothing to check against. tflw's version reads as what the tester actually
  wants to know; raw's reads as instrumentation plumbing with the actual assertion buried at the
  bottom.
- **The file-drop scenario (#4) is the largest single-file ratio (4.3×).** Playwright has no
  "drop a real file onto an arbitrary element" primitive — `setInputFiles()` only targets a real
  `<input type=file>`, and this app's drop-zone is a plain `<div onDrop=…>`. The raw version reads
  the file from disk, base64-encodes it, and reconstructs a real `File` + `DataTransfer` inside
  `page.evaluate()` to dispatch the native `dragenter`/`dragover`/`drop` sequence by hand. tflw's
  `drop file "<path>" onto <locator>` (SPEC §9.5) is this exact machinery, one line.
- **The drag-drop scenario (#3) turned out to be closer than expected — a finding worth being
  honest about.** The obvious guess going in was that Playwright's own `locator.dragTo()` (a
  mouse-based simulation) wouldn't fire the native `dragstart`/`dragover`/`drop` events this app's
  `CartPage.tsx` actually listens for, the same reason tflw's own `drag … to …` step doesn't use
  that API internally (SPEC §9.5). Verified empirically rather than assumed: `dragTo()` **does**
  work here. The raw file still needs its own row-identity lookup (`GET /cart`, since apiV2's
  `products.service.ts`/`cart.service.ts` don't guarantee row order) duplicated from the tflw
  side's own comment on the same lesson — the line-count gap here is smaller (1.3×) and entirely
  from that shared setup, not from the drag mechanics themselves.
- **The accessibility scan (#5) needs its own dependency and result-shape knowledge in raw.**
  `axe-core` isn't bundled with `playwright` — the raw version reads `axe.min.js` off disk,
  injects it via `page.addScriptTag`, runs `axe.run()`, and knows to read `violations[].id`/
  `.impact` itself. tflw's `expect page has no … a11y violations` (SPEC §9.8) is this same
  sequence with a severity floor built in — and neither side can express "assert violations
  *exist*" (a real, documented DSL gap — see FINDINGS in `testFlow-tests/PROGRESS.md`).
- **Report quality is the largest gap, and it's invisible in a line-count table** — same
  conclusion as the API-only leg above, now for a browser suite specifically. tflw's
  `report/report.html` gives a step-by-step timeline per test including which locator resolved
  each UI step, request/response capture for the network-observation step, and a real screenshot
  on failure. `node:test`'s TAP output gives pass/fail + a stack trace; anything about what the
  *page actually looked like* when a UI assertion failed only exists if the raw test author
  remembers to call `page.screenshot()` themselves.
- **Where raw wins:** the drag-drop scenario shows it plainly — when Playwright's own high-level
  API already covers the corner, raw needs no extra code at all past the API call itself, and full
  JS expressiveness (the `if (!stillRow1)` fallback branch pattern this file *didn't* end up
  needing) stays available with no DSL boundary to work around.

## Verdict

Line count favors tflw by **2.3×** overall on this UI leg, growing to 4–5× on the corners with no
raw Playwright primitive at all (file-drop onto a non-`<input>` target, a11y scanning) — narrower
than the API-only leg's 2.8–8.3× range, since Playwright's own locator API already absorbs a good
share of the UI-specific complexity tflw would otherwise need to add value on top of. Report
quality remains a categorical difference, not a matter of degree, exactly as on the API-only leg.
Combined with the two real, previously-latent runtime bugs this same acceptance pass found and
fixed at the source (see `testFlow-tests/PROGRESS.md`'s M7 entry — an action's own browser steps
silently losing the caller's browser context, and `import.meta.resolve` breaking inside the
packaged CJS CLI bundle), this is a clear win for the browser-arc scenarios in scope for `1.0.0`.
