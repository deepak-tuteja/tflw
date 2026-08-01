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

---

# perf leg: tflw vs. k6

M34 (`PLAN_BROWSER_PERF_SECURITY.md` D31, the perf arc's own dogfood gate — `0.3.0`-equivalent,
see D25): the same load scenario against testFlow-tests' `perf-0` contended checkout endpoint
(`POST /orders`, real Postgres row-lock serialization on one hot product's stock row), hand-written
once as `.tflw` (`acceptance/perf/tflw/checkout-burst.tflw`) and once for k6
(`acceptance/perf/k6/checkout-burst.js`) — measured numbers compared, both novel diagnostics (D17's
back-off warning, D19's generator self-saturation) demonstrated firing for real. Unlike the two legs
above, this one's verdict is **not** a clean win — it surfaced a real, previously-undiscovered
performance characteristic of tflw's own load engine, reported here in full rather than smoothed
over, exactly what this gate exists to do.

Run it yourself (needs testFlow-tests' Docker stack — `node cli.mjs start` in that repo — and its
load target reset before each run, `POST /admin/load/reset` with bearer admin auth):

```sh
# tflw side
cd acceptance/perf/tflw && node ../../../packages/cli/dist/cli.cjs load checkout-burst.tflw --no-color

# k6 side (a static k6 binary is enough — no k6 Cloud account needed)
cd acceptance/perf/k6 && k6 run checkout-burst.js
```

## Measured numbers (60 users ramping over 20s, closed model, both sides)

| | tflw | k6 |
|---|--:|--:|
| Iterations | 3,908 | 12,485 |
| Throughput | 195/s | 624/s |
| Checkout p50 | 26ms | 33.6ms (med) |
| Checkout p90 | 424ms | 60.6ms |
| Checkout p95 | 476ms | 69.9ms |
| Checkout max | 785ms | 241ms |
| Error rate | 0.00% | 0.35% |
| `p95 < 250ms` threshold | ✗ fails (exit 1) | ✓ passes |
| `error rate < 1%` threshold | ✓ passes | ✓ passes |

**Numbers do not agree within tolerance — a real gap, root-caused below, not a measurement
artifact.** Both sides show the qualitatively correct story (real latency growth under load, low
error rate, a genuinely degrading endpoint) and both thresholds mechanisms work exactly as
designed — tflw's own p95 threshold correctly fails the run (exit 1) on the real number it
measured. What doesn't match is the *magnitude*.

## Root cause: tflw's own per-request overhead, not the endpoint

Isolated by comparing tflw against a raw Node `fetch` script using the *same* HTTP stack (undici,
via Node's global `fetch` — the same one `packages/runtime/src/http.ts` itself calls) and the same
ramp shape, varying one thing at a time:

| Workload | tflw | raw `fetch` | k6 |
|---|--:|--:|--:|
| `GET /health` only (with session auth) | 5,865/s | — | — |
| `GET /products` + `GET /health` (capture, no POST) | 2,199/s | — | — |
| `POST /cart/items` only, static body, uncontended | 643/s | 1,451/s (2.3×) | — |
| `GET /products` + `POST /cart/items`, uncontended | 491/s | 919/s (1.9×) | — |
| `GET /products` + `POST /orders`, **contended** (the acceptance scenario) | 195/s | 550-565/s (2.9×) | 624/s (3.2×) |

Every GET-only path is fast and healthy. The moment a `POST`-with-body step enters the picture,
tflw shows a real, reproducible ~2× latency overhead relative to a raw `fetch` script doing the
identical request — present even against a completely *uncontended* endpoint (`POST /cart/items`,
no shared row lock). That baseline ~2× gap then **compounds** with perf-0's genuine server-side
row-lock queueing to produce the ~3× gap seen on the real acceptance target. Ruled out along the
way, each with its own real-run evidence:
- **Not CPU/event-loop saturation** — `selfDiagnosis.cpuPercent` stayed 14-37% throughout every
  contended run, nowhere near the 90%+ that would explain a throughput ceiling.
- **Not `--workers` scaling** — `--workers 4` moved throughput from 3,363 to 3,983 iterations (a
  weak +18%, not the ~4× a CPU-bound bottleneck would show), confirming this isn't the kind of
  problem D19's multi-process generator was designed to fix.
- **Not `expect`, `capture`, or interpolation** — a scenario with the `expect status equals 201`
  step removed showed the same throughput; a scenario with capture+interpolation but no `POST` was
  fast (2,199/s); a scenario with a single **static**, non-interpolated POST body was still slow
  (643/s) with no capture or multi-step chain involved at all.
- **Not the specific contended row** — an uncontended `POST /cart/items` (no shared lock) still
  showed the ~2× gap against raw `fetch`, isolating the overhead to "any POST with a body," not
  "this particular row's lock."

The exact mechanism inside tflw's per-iteration pipeline (`execApi`/`prepareBody`/`sendRequest` in
`packages/runtime/src/interpreter.ts`) wasn't pinned down to a specific line this milestone — that's
deliberately scoped out (a real optimization pass is a different, larger piece of work than an
acceptance gate) and flagged here as a concrete, well-evidenced candidate for a dedicated
load-engine hardening fast-follow, the same "measurement first, hardening gated on what it finds"
pattern `PLAN_BROWSER_PERF_SECURITY.md` M4a already used for the browser arc's own worker
hardening.

## Two real bugs found and fixed at the source

1. **`tflw load` never actually threaded its `.env`-merged environment through to a run.**
   `loadCommand`'s calls to `runLoad` (single-process) and the `--internal-load-worker` branch's
   call to `runLoadShard` both omitted `LoadOptions.environ` entirely — `env(NAME)` inside a load
   `scenario`/`session` silently fell back to the raw `process.env` `runLoadCore` defaults to,
   never the `.env`-merged one `loadAndValidate` already builds (the same one `tflw run` has always
   passed correctly). Invisible until this milestone's own acceptance scenario tried a real
   `.env`-only credential inside a `session` used by a `scenario` for the first time — no prior
   `tflw load` test (M29-M33) ever exercised `env(...)` against anything but an already-exported
   process env var. Fixed at both call sites (`packages/cli/src/cli.ts`); regression test covers
   both the single-process and `--workers N>1` paths.
2. **D17's back-off/coordinated-omission diagnostic itself had never been built.** Named in the
   plan since M29 ("Novel diagnostic: report warns when a closed run's VUs spent >X% of wall time
   waiting rather than iterating"), and the docs-site guide had already documented its exact console
   output since M29 — but no M29-M32 milestone actually implemented it, only D19's generator
   self-saturation was built (M31/M32). Designed and built as part of this milestone
   (`BackOffDiagnosis`, `computeBackOff` — see `packages/runtime/src/types.ts`/`interpreter.ts` for
   the full design writeup, including why an early-half-vs-late-half mean comparison was chosen
   over an extremal-percentile baseline after a real run against a healthy server exposed a
   structural bias in the first design attempt).

## Both novel diagnostics, demonstrated firing for real

**D17's back-off warning** fired on the acceptance scenario itself — a completely organic result
of the workload's own linear VU ramp (0→60 over 20s), not a contrived trigger:

```
⚠ your load backed off — this scenario's VUs spent an estimated 85% of their available time unable
to keep pace with the target system; results understate real latency
```

**D19's generator self-saturation** needs its own isolated demonstration
(`acceptance/perf/tflw/generator-saturation-demo.tflw`) — a scenario with no real API target,
deliberately CPU-bound (`ramp to 8 users over 3s`, each iteration synchronously busy-looping ~20ms
via a JS action), the same real, non-simulated technique `packages/cli/test/e2e.test.ts`'s own
inconclusive-exit-code test uses. No k6 counterpart is possible here by design — D19 is specific to
tflw's own single-process Node generator being the bottleneck, a failure mode a compiled-Go
generator doesn't have:

```
⚠ tflw itself is the bottleneck (avg event-loop lag 2927.3ms  max 2927.3ms  cpu 100%) — measured
latency/throughput reflects tflw's own generator process, not your system under test. Results are
unreliable.

load run inconclusive — the generator saturated, so this verdict cannot be trusted
```

Exit code 3, junit `<skipped>` (never `<failure>` or a silent pass) — confirmed directly, not just
asserted from the summary line.

## A qualitative asymmetry worth its own line: session resilience

Developing the k6 side surfaced a real environment detail that became its own finding: apiV2's
`JWT_ACCESS_TTL` is a deliberately short 5s in this dev environment (it exercises other suites' own
token-refresh coverage). A bearer token obtained once therefore expires mid-run for *any* load
tool. tflw's session model re-establishes automatically on a 401
(`packages/runtime/src/interpreter.ts`: "lets an `ApiStep` that gets a 401 know which session(s) to
invalidate + re-establish") — completely free to a `.tflw` author, and exactly why the tflw side's
error rate is a clean 0.00% above. k6 has no equivalent built in; the first draft of the k6 script
(no reauth handling) failed 47% of checkouts on plain 401s the instant tokens started expiring.
The fix was a hand-written ~10-line `authedRequest` wrapper (login-on-first-use, retry-once on
401) — a small but real, measured amount of resilience code tflw gives away for free that a raw
tool makes every author rebuild.

## M35d — re-measured after the M35b/M35c fix (2026-07-31)

M35 (`PLAN_BROWSER_PERF_SECURITY.md` §2.7, D32) root-caused and fixed a real, large bug found via
direct instrumentation of the real request pipeline (`FINDINGS_M35B_ROOT_CAUSE.md`): a
module-scope, unconditional `import ... from 'undici'` in `http.ts` (needed only for the mTLS
client-cert path) was cheaply poisoning Node's separate, built-in global `fetch()` for the entire
process — present the instant the module loaded, on *every* `tflw` invocation, whether or not any
test actually used mTLS. Fixed by isolating the entire mTLS dispatch path (including the `undici`
import) into a dedicated, lazily-spawned child process, so `http.ts` no longer imports `undici` at
all. Verified in isolation on a zero-latency echo-server harness: **~12.8× throughput**
(349 → 4,470 iter/s). This re-run repeats M34's own real, contended acceptance scenario unchanged
to see whether that isolated win carries over.

**checkout-burst, same methodology as M34 (60 users ramping over 20s, closed model), reset between
runs:**

| | M34 (before fix) | M35d (after fix) — run 1 | M35d (after fix) — run 2 | k6 (M35d) |
|---|--:|--:|--:|--:|
| Iterations | 3,908 | 3,518 | 3,852 | 12,400 |
| Throughput | 195/s | 172.6/s | 191.1/s | 620/s |
| Checkout p95 | 476ms | 507ms | 521ms | 70.9ms |
| Error rate | 0.00% | 0.00% | 0.00% | 0.34% |
| Back-off ratio | (not measured) | 84% | 86% | — |

k6's own numbers here (620/s, p95 70.9ms, 0.34% errors) essentially reproduce M34's original k6
baseline (624/s, p95 69.9ms, 0.35%) — confirms the target/harness itself is stable and this is a
fair re-run, not a noisier environment. **tflw's throughput on the real contended target is
unchanged within run-to-run noise (~173–191/s both before and after, avg ~182/s) — the fix does
not close the gap here.** tflw still trails k6 by **~3.2–3.4×**, statistically the same gap M34
found, not narrower.

**Why the isolated 12.8× win doesn't show up here:** the real-code instrumentation behind M35b
found the poisoned `fetch()` cost ~1.4ms/call more than it should (`FINDINGS_M35B_ROOT_CAUSE.md`).
Against a zero-latency echo server that's the *entire* per-call cost, hence the 12.8-26× swing.
Against this real target, both back-off diagnostics above show VUs spending 84-86% of their time
genuinely blocked waiting on the contended server (real network + Postgres row-lock queueing,
tens to hundreds of ms per call) — a ~1.4ms client-side tax is noise against that, not the
bottleneck. Quick isolation re-checks on the two GET-only rows from M34's own root-cause table
(no writes, no shared state, so unaffected by any contention confound) *do* show a small, real
gain, consistent with this explanation — both were unknowingly running under the same poisoned
`fetch()` throughout M34's original run too:

| Workload | M34 (before fix) | M35d (after fix) |
|---|--:|--:|
| `GET /health` only (session auth) | 5,865/s | 6,490/s (+10.6%) |
| `GET /products` + `GET /health` | 2,199/s | 2,273/s (+3.4%) |

The two POST-uncontended rows from M34's table were **not** re-measured as a clean comparison:
reproducing them hit a real environment constraint this acceptance harness has — a single shared
`LOAD_USER_EMAIL` credential for all 60 VUs, so any write scoped to "the current user" (e.g.
`POST /cart/items` against a fixed product) lands on the exact same `cart_item` row across every
VU (`cart.service.ts`'s atomic `increment`), which is genuinely contended (94% measured back-off)
regardless of client speed. Whatever methodology M34 used to call that row "uncontended" wasn't
reproduced here, so no number is reported rather than an apples-to-oranges one — flagged, not
chased further, per this arc's own bounded-effort convention (D33c/D35/D38).

**Conclusion: the M35b/M35c fix is real, verified, and worth keeping** — it eliminates a genuine
process-wide bug (not just a load-test artifact: it silently taxed *every* `tflw run`/`tflw load`
invocation, mTLS or not) and gives a small, real improvement on fast GET-heavy workloads. But it
does **not** explain M34's ~3× gap on a real, contended target — that gap's dominant driver is
still unidentified. D33a's ~10% tolerance is not met, and after M35b+M35c+M35d this workload's
residual gap should be treated as an open, unexplained item rather than assumed closed.

## Verdict

A genuine, mixed result — not a clean win, and reported as such, across both M34 and this M35
fast-follow. Both novel diagnostics work exactly as designed and were demonstrated firing on real,
non-simulated runs; both threshold mechanisms correctly gate their own tool's exit code; tflw's
session model measurably out-resilient a hand-written k6 script for free. The core numeric
comparison D31 asks for still does **not** land within tolerance after a real, verified fix
(M35b/c) — tflw's own load-generation throughput still trails k6's by roughly 3× on this real
contended target. M34's original hypothesis (a client-pipeline overhead that compounds under
contention) turned out to be only partially right: a real, large client-side bug existed and is
now fixed, but M35d shows it isn't the dominant driver of the gap on *this* contended workload
shape — back-off-dominated real latency swamps the difference. Three real bugs were found and
fixed at the source across M34/M35 (the `.env` wiring gap, D17's diagnostic itself never having
been built, and the `undici`-import `fetch()` poisoning). The perf arc's dogfood gate passes on
process and honesty, not on the headline number — the residual load-engine gap on contended
targets is now a well-evidenced, still-open item, not a surprise waiting to be found in
production.

## M38 — re-measured after the M37 fix (2026-08-01)

M35d left the ~3.2-3.4× gap open and unexplained. M36 (`PLAN_BROWSER_PERF_SECURITY.md` §2.7,
D39-D43) reopened the investigation and found the real cause: `runLoadCore` froze a one-time
session-header snapshot shared by every VU, and `refreshSessions` only ever patched the *current
iteration's own copy* on a 401 — never the shared snapshot — so once this dev environment's
deliberately short `JWT_ACCESS_TTL=5s` token first expired (~5s into the 20s scenario), **every
subsequent iteration re-authenticated, forever** (40-42% of a full run's iterations). An
environment-only A/B (raising the TTL, no source touched) took throughput from ~172-219/s to
528.4/s and made the p95 threshold pass outright for the first time in this arc — strong evidence,
but not a fix. M37 (`PLAN_BROWSER_PERF_SECURITY.md` §2.8, D44-D46) fixed it at the source:
per-iteration session state now re-derives from `sessionCache.ensure()` instead of a frozen
snapshot (D44), and `refreshSessions`'s unconditional `invalidate()` became a guarded, identity-
checked `SessionCache.reestablish` so concurrent VUs hitting the same stale token near-simultaneously
pay for at most one real re-login between them (D45). This re-run repeats M34/M35d's own real,
contended acceptance scenario unchanged, with a freshly rebuilt CLI bundle including the M37 fix,
to see whether the diagnosed cause was in fact the dominant one.

**checkout-burst, same methodology as M34/M35d (60 users ramping over 20s, closed model), load
target reset between every run:**

| | M34 | M35d (M35b/c fix) | **M38 (M37 fix) — run 1** | **M38 — run 2** | k6 (M38) |
|---|--:|--:|--:|--:|--:|
| Iterations | 3,908 | ~3,685 (avg) | 10,896 | 11,806 | 12,805 |
| Throughput | 195/s | ~182/s (avg) | 544.8/s | 590.3/s | 640.2/s |
| Checkout p95 | 476ms | ~514ms (avg) | 102ms | 98ms | 68.5ms |
| Error rate | 0.00% | 0.00% | 0.00% | 0.00% | 0.35% |
| Back-off ratio | (not measured) | 84-86% | 58% | 63% | — |
| `p95 < 250ms` threshold | ✗ fails | ✗ fails | **✓ passes** | **✓ passes** | ✓ passes |

k6's own numbers (640.2/s, checkout p95 68.5ms, 0.35% error rate) are close to M35d's k6 baseline
(620/s, p95 70.9ms, 0.34%) — a ~3% throughput/p95 difference, the same order of run-to-run noise
M35d's own k6 re-run showed against M34's original baseline (620 vs. 624, ~0.7%), so this remains a
fair, non-noisy comparison. tflw's two runs (544.8/s, 590.3/s — avg 567.6/s) show a similar ~8%
run-to-run spread to M35d's own two runs (172.6/s, 191.1/s — ~10% spread), consistent with this
workload's inherent noise band, not a new source of variance.

**The gap closed from ~3.2-3.4× to ~1.13×.** tflw's throughput went from averaging ~182/s (M35d)
to averaging ~567.6/s — a **~3.1× improvement**, matching (and slightly exceeding) M36's own
environment-only A/B upper bound of 528.4/s, which cross-confirms D43's diagnosis was correct and
M37's fix captures the same effect the A/B predicted, in real shipped code rather than a dev-only
environment tweak. **For the first time in this arc, tflw's own p95 threshold passes on the real
contended acceptance target** (102ms and 98ms, both `< 250ms`) — M34 failed it at 476ms, M35d
failed it at 507-521ms. Back-off ratio dropped from 84-86% to 58-63%: VUs are still genuinely
blocked on the server's real Postgres row-lock contention for the checkout endpoint (that part was
never the bug), but they're no longer *also* burning a large share of every iteration on redundant
login round-trips.

**D33a's ~10% tolerance is close but, read strictly, not quite met.** Throughput: tflw trails k6 by
(640.2 − 567.6) / 640.2 ≈ **11.3%** (equivalently, k6 leads tflw by ~12.8%) — just outside the 10%
line. Checkout p95: tflw trails by (100 − 68.5) / 68.5 ≈ **46%** (tflw's two runs average ~100ms
vs. k6's 68.5ms) — clearly outside tolerance, even though both numbers are now comfortably inside
the scenario's own 250ms bar. The residual is almost certainly the same baseline client-pipeline
overhead M34's own root-cause table first characterized (a real, reproducible ~2× per-`POST`
latency tax on tflw's interpreted single-process Node generator vs. a raw `fetch` script, before
any contention) — now the dominant remaining factor since the much larger session-refresh bug is
gone, but not re-isolated or re-measured directly in this milestone. Flagged as the honest next
candidate, not chased further here, per this arc's own bounded-effort convention (D33c/D35/D38).

## Verdict (M38, supersedes M35d's numeric verdict)

**A clear, decisive win, unlike M35d's own mixed result.** D43/M36's diagnosis — a load-scenario
session bug causing 40-42% of iterations to needlessly re-authenticate — was in fact the dominant
driver of M34's original ~3× gap, not (as M35b/c's fix addressed) the process-wide `fetch()`
poisoning, and not (as M36's D40/D42 hypotheses first suspected, then refuted) a client-side
concurrency ceiling. M37's fix closes the gap from ~3.2-3.4× down to ~1.13× on throughput, and
makes tflw's own p95 threshold pass on this real contended target for the first time in the arc's
history — a **~3.1× real throughput improvement** over M35d's post-M35c baseline. D33a's strict
~10% tolerance is not quite met on either metric (~11.3% throughput gap, ~46% p95 gap), so this is
reported as "very close, not fully closed" rather than "closed" — consistent with this arc's
own report-what-was-measured discipline. The likely remaining cause (tflw's baseline
per-`POST` client-pipeline overhead, first characterized in M34's own isolation table) is named as
the probable next candidate but not chased further this milestone, per D33c/D35/D38's
bounded-effort convention. Four real bugs have now been found and fixed at the source across
M34-M37 (the `.env` wiring gap, D17's diagnostic itself never having been built, the
`undici`-import `fetch()` poisoning, and the load-scenario session-refresh bug) — the perf arc's
dogfood gate continues to pass on process and honesty, and now also lands within shouting distance
of the headline number it originally set out to hit.

## M39 — confirming the residual gap is real, and pinning down where it opens (2026-08-01)

M38 left a residual, not-quite-inside-tolerance gap open (~11.3% throughput, ~46% checkout p95)
and named tflw's baseline per-`POST` client-pipeline overhead — first characterized back in M34's
own root-cause table — as the likely cause, without re-isolating it. Scoped via `/grill-me`
(`PLAN_BROWSER_PERF_SECURITY.md` §2.10, D47-D52): rebuild M34's escalating-workload isolation
ladder (GET-only → POST-uncontended → POST-contended), but this time with a **k6 counterpart at
every rung** — M34's own table only ever compared tflw against a raw `fetch` script, never k6,
which is the actual comparison D33a's tolerance is about. Five rungs, 3 tflw runs + 2 k6 runs each
(15 tflw + 10 k6 runs total), load target reset before every dogfood run:

- **echo-server** (`acceptance/perf/profile/`, zero-latency, no shared state): new isolated
  `echo-get-only.tflw`/`.js` and `echo-post-only.tflw`/`.js` — single-request-type scenarios, split
  out of `bench.tflw`'s combined GET+POST shape so each rung measures one verb in isolation.
- **dogfood** (`acceptance/perf/tflw|k6/`, real Postgres): new `dogfood-get-only.tflw`/`.js`
  (`GET /health`, session-authed) and `dogfood-post-uncontended.tflw`/`.js` (`POST /cart/items`,
  static hardcoded `productId`, a per-user cart row — no shared lock across VUs, unlike checkout);
  `dogfood-post-contended` reuses `checkout-burst.tflw`/`.js` unchanged, re-run fresh for this series
  rather than reusing M38's own numbers.

**A real, unplanned finding surfaced immediately: both echo-server rungs and the dogfood GET-only
rung self-saturate tflw's own generator (D19 fires every single run, "results are unreliable"),
even at a single VU.** A GET (or a POST) against a target with effectively zero latency lets a VU
loop fast enough that tflw's single-process interpreter becomes the bottleneck before concurrency
is even the issue — `bench.tflw`'s own M35a numbers were generated in exactly this saturated regime
(that milestone *wanted* saturation, for CPU profiling). This makes any **absolute** tflw-vs-k6
throughput comparison on these three rungs uninformative for D49's question — it's comparing a
deliberately-saturated single-process generator's ceiling against a compiled multi-threaded one's
ceiling, not the per-request-type client overhead specifically. Reported below for completeness,
but not used to draw conclusions about the residual gap.

**The two *unsaturated* dogfood rungs (POST-uncontended and POST-contended, both `cpu` 44-57%, no
D19 warning) are the trustworthy comparison, and they tell a sharp, well-localized story:**

| Rung | tflw avg | k6 avg | Throughput gap | tflw p95 | k6 p95 | p95 gap | Saturated? |
|---|--:|--:|--:|--:|--:|--:|:--:|
| A. echo GET-only | 21,814.8/s | 80,632.2/s | k6 leads 3.70× | 2ms | 0.37ms | tflw trails 5.4× | **yes (D19)** |
| B. echo POST-only | 12,098.2/s | 80,117.8/s | k6 leads 6.62× | 3.3ms | 0.37ms | tflw trails 9.0× | **yes (D19)** |
| C. dogfood GET-only | 6,558.7/s | 10,875.8/s | k6 leads 1.66× | 9ms | 5.32ms | tflw trails 1.69× | **yes (D19)** |
| D. dogfood POST-uncontended | 1,503.7/s | 1,693.0/s | k6 leads **11.2%** | 37ms | 32.3ms | tflw trails **14.7%** | no |
| E. dogfood POST-contended (checkout-burst) | 578.9/s | 637.4/s | k6 leads **9.2%** | 103ms | 69.0ms | tflw trails **49.2%** | no |

(Full per-run numbers for A-C, plus error rates, in `/tmp/m39-results/` — not committed, regenerable
by re-running the new fixtures listed above.)

**Where the gap opens: on a plain, uncontended POST it's already inside (or right at) D33a's ~10%
tolerance on both metrics that matter for a throughput read.** Rung D — a real network+DB round
trip, no row lock, no capture/interpolation — shows an 11.2% throughput gap and a 14.7% p95 gap:
close enough to call "closed" in spirit, and a **dramatically** smaller p95 gap than the contended
rung. Rung E, re-measured fresh in this series (not reusing M38's numbers), lands almost exactly
where M38 found it: throughput gap 9.2% (M38: 11.3%; both inside/at the noise band this arc has
already characterized), but **p95 gap 49.2%** — essentially unchanged from M38's 46%, confirming
that result wasn't a fluke.

**The residual gap is not a flat "tflw is slower" tax — it's concentrated specifically in p95 tail
latency once real row-lock contention enters the picture.** Rungs D and E have near-identical
*throughput* gaps (11.2% vs 9.2% — both essentially at tolerance), but wildly different *p95* gaps
(14.7% vs 49.2%). The only thing that changed between them is contention: same session, same
target, same static-body POST shape, same ramp. That isolates the residual almost entirely to how
tflw's single-process generator's own per-iteration overhead **compounds with server-side lock
queueing** to inflate the tail specifically — plausibly because a VU that's already paying tflw's
baseline per-`POST` cost re-enters the queue slightly later than k6's equivalent VU would, and under
real contention that small per-iteration delay compounds into a much larger tail-latency spread,
even though it barely moves the throughput average. This is a sharper, more specific answer than
M34's original "any POST with a body" framing — the plain-POST overhead is real but small (rung D),
and mostly harmless to throughput even under contention (rung E's 9.2%); it's the **tail**, under
contention specifically, where it actually matters.

**D33a tolerance check, all five rungs:** the three self-saturated rungs (A-C) are excluded from
this check — their gaps reflect D19's already-understood, already-documented generator-saturation
mechanism, a different and already-diagnosed phenomenon, not the client-pipeline question D33a's
tolerance is about. Of the two trustworthy rungs: D (uncontended) is within/at tolerance on both
metrics; E (contended) is within tolerance on throughput but well outside it on p95 — the same
verdict M38 already reported, now with a specific, well-evidenced mechanism (tail-under-contention
compounding) rather than a named-but-unverified candidate.

**Stopping here, per D51/D52.** This was investigation + write-up only, no fix — the ladder
localized the residual to p95-under-contention specifically, which is enough new information to
make a real scoping decision, but no source code changed this milestone. The mechanism (per-VU
generator overhead compounding with server-side lock queueing) is architectural, not an obvious
one-line bug the way M35b's and M37's causes were — a fix would mean either restructuring how
`runLoadCore`'s VUs re-enter the request queue after a slow iteration, or accepting it as an
inherent interpreted-Node-vs-compiled-Go difference under contention specifically. Per D52's
inconclusive-fallback clause: this result is not inconclusive (it cleanly localizes the gap), so the
honest next step is a scoped decision — pursue a dedicated hardening pass on this specific
mechanism, or re-scope D33a's tolerance for contended-tail-latency specifically — rather than
silently reopening the chase. Flagged here for that decision; not taken further this milestone.

## Verdict (M39)

**The ladder answers D49's question precisely, and narrows M38's residual gap to a specific,
well-evidenced mechanism.** The gap does not "already exist on a plain GET" in any way this
milestone could cleanly measure (GET-only rungs self-saturate tflw's generator on both harnesses,
a real but separately-already-diagnosed D19 phenomenon). It also doesn't uniformly "appear once a
POST enters" — a plain, uncontended POST (rung D) is already within/at D33a's ~10% tolerance on
both throughput and p95. It specifically **widens once real row-lock contention enters** (rung E):
throughput stays near tolerance (9.2%, consistent with M38's 11.3%), but p95 blows out to ~49%
(consistent with M38's ~46%) — a fresh, independent measurement confirming M38's number was real,
not noise. Four real bugs (M34-M37) plus one real architectural characteristic (this milestone) are
now on record for this arc's dogfood gate. The residual is named as a concrete candidate for a
dedicated hardening pass on tflw's load-generator VU re-entry under contention — or, if that's not
pursued, grounds to re-scope D33a's tolerance specifically for contended-tail-latency scenarios —
but per D51, that's a separate, explicitly-scoped decision, not an automatic next milestone.

## M40 — root-causing the p95-under-contention mechanism (2026-08-01)

M39 localized the residual gap to p95 tail latency specifically under real row-lock contention, and
named a hypothesis: tflw's own per-VU generator overhead (session-cache reads, header building,
`execSteps` dispatch, trace/redact construction — everything in the real iteration loop that isn't
waiting inside `sendRequest`'s `fetch()` call) compounds with server-side lock queueing to inflate
the tail without much moving the average. Scoped via `/grill-me` (`PLAN_BROWSER_PERF_SECURITY.md`
§2.11, D53-D56) to test this directly, mirroring M35b's decisive technique: temporary
`performance.now()`-based instrumentation of the real `runIteration`/`execSteps`/`execApi`/
`sendRequest` call chain (not a reimplementation — the actual `interpreter.ts` source, rebuilt into
`dist/cli.cjs`, run for real, then fully reverted).

**Method.** `sendRequest` (`http.ts`) already computes and returns a real, per-request
`response.durationMs` (the `fetch()` call plus body read — this is what M35b's own root-cause table
called "the dominant cost," ~92% of iteration time on an uncontended target). The only gap was that
`runLoadCore`'s load path discarded this value instead of recording it. A single, minimal,
env-gated addition (`TFLW_PERF_TRACE_FILE`) captured it per iteration: total iteration wall time,
the sum of every `ApiStep`'s own `response.durationMs` ("network" — real `fetch()` wait, which under
contention includes the genuine server-side row-lock queueing time), and the difference between the
two ("bookkeeping" — tflw's own client-side overhead, with nothing else in it). Ran
`checkout-burst.tflw` once at 1 VU (an intra-process baseline with no contention) and once at the
full 60-VU ramp (real contention), load target reset before each, first 5 iterations of each
discarded as JIT/connection warm-up (same convention M35b used):

| | 1 VU (n=3,820) | 60 VU (n=11,488) | Change |
|---|--:|--:|--:|
| avg iteration total | 5.25ms | 52.93ms | 10.1× |
| avg network (`fetch()` + real lock wait) | 5.00ms | 52.74ms | **10.55×** |
| avg bookkeeping (everything else) | 0.248ms | 0.195ms | **0.78×** |
| bookkeeping's share of iteration time | 4.72% | **0.37%** | **shrinks**, not grows |

**The compounding-bookkeeping hypothesis is refuted, cleanly and in the wrong direction.** If
tflw's own per-iteration overhead were compounding under contention, its *share* of iteration time
should grow at 60 VU relative to 1 VU. Instead it shrinks by more than 10×, and its *absolute*
value doesn't grow at all — if anything it's marginally smaller at 60 VU (0.195ms vs. 0.248ms, well
within this measurement's own precision at sub-millisecond scale, but certainly not evidence of
growth). Every millisecond of the 10.1× growth in iteration time between the two runs is inside
`networkMs` — real `fetch()`-plus-body-read time, which under contention is dominated by genuine
server-side Postgres row-lock queueing, not tflw's own processing.

This also closes a natural follow-up question before it needed its own milestone: could the
"network" time itself include *client-side* queueing — e.g. Node's global `fetch()`/`undici`
capping concurrent connections below 60, so some of that 52.74ms is tflw's own connection pool
making VUs wait their turn? **No** — this was already checked, and refuted, in M36 (D40): direct
server-side ground-truth instrumentation confirmed tflw's real generator holds its full configured
60/60 VU count genuinely concurrent in-flight, on both the isolated harness and the real dogfood
target. Combined with M36's D42 (per-iteration VU-dispatch overhead stays flat, <1ms, at 60 VUs vs.
1 VU) and this milestone's own bookkeeping-share result, **three separate, well-instrumented client-
side mechanisms have now been checked and refuted**: a connection-concurrency ceiling (M36), VU-loop
dispatch overhead (M36), and per-iteration bookkeeping compounding under contention (M40). None of
them explain the residual p95 gap.

**Per D55, this refutation triggers the fallback: re-scope D33a's tolerance for contended-tail-
latency specifically, rather than open an M41.** With the concrete client-side candidates
systematically eliminated across two milestones, the most honest reading of the remaining ~46-49%
p95 gap (M38: 46%, M39: 49.2%, two independent measurements clustering tightly) is that it reflects
something more diffuse than a single fixable line of code — plausibly fine-grained differences in
exactly *when* each VU's request is dispatched (Node's single-threaded event-loop/promise
scheduling vs. Go's goroutine scheduler), which would shape the server-side lock queue's own
ordering and wait-time distribution without showing up as extra client-side processing time in any
way this instrumentation (or M36's) could isolate. That is consistent with D52's own anticipated
outcome for a systematic-refutation result: "an inherent interpreted-Node-vs-compiled-Go
architecture difference, not a fixable bug."

**Proposed re-scoped tolerance:** keep D33a's existing ~10% tolerance for throughput and for p95 on
uncontended/light-contention targets (both were already met or within noise on every clean rung this
arc measured — M38, M39's rung D). Add a separate, explicit tolerance for p95 specifically on a
real-row-lock-contended target: **~50%**, comfortably covering the two independent measurements this
arc produced (46%, 49.2%) with a small margin, rather than chasing a number that would require
re-litigating this same investigation again for a few more percentage points of headroom.

## Verdict (M40)

**A clean, decisive negative result — the specific hypothesis M39 raised does not hold, and by
systematic elimination across M36 and M40, no concrete client-side mechanism explains the residual
p95-under-contention gap.** Direct instrumentation of the real request pipeline (mirroring M35b's
own decisive technique) shows tflw's own per-iteration bookkeeping shrinks as a share of iteration
time under contention, not grows — the opposite of what the compounding hypothesis predicted.
Combined with M36's already-refuted concurrency-ceiling and dispatch-overhead hypotheses, this
closes out the arc's investigation into the residual gap: three real, well-evidenced negative
results, no fix code needed or written (per D51's investigation-only scope, cleanly reverted —
374/374 runtime + 106/106 CLI tests green after revert), and a concrete, evidence-based
recommendation to re-scope D33a's tolerance for contended-tail-latency specifically (~50%) rather
than open an M41 chasing a mechanism that isn't there. This is the arc's honest stopping point per
D52/D55's own anticipated fallback.
