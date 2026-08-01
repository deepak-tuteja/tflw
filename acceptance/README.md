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

## M41 — isolating the gap to Node's HTTP stack, at the user's direction to reopen D55 (2026-08-01)

The user explicitly reopened M40's D55 tolerance-amendment resolution: "we can not proceed with pen
test arc until we close the gap ... very closely ~1-2 percent to k6." Two rounds of ad hoc
re-investigation before any formal scoping reconfirmed the gap is real and stable (three independent
measurements — M38: 46%, M39: 49.2%, this session's re-run: 48.1% — clustering tightly) and
decisively refuted the leading remaining hypothesis: `--workers 4`/`--workers 8` (M31's existing
real-OS-process VU sharding, zero new code) showed **no p95 improvement** (108ms/111ms vs. 102ms
single-process), ruling out a single-thread-vs-multi-core scheduling mechanism. Scoped via
`/grill-me` (`PLAN_BROWSER_PERF_SECURITY.md` §2.12, D57-D59): one more bounded root-cause pass aimed
at the HTTP-client/protocol layer itself, method = adapt `raw-fetch-bench.mjs` (M35a) into
`raw-fetch-bench-dogfood.mjs` — a bare Node `fetch()` loop with **zero** tflw interpreter, session,
capture, redaction, or `execSteps`/`execApi` machinery — hitting the real dogfood target with the
same hand-rolled per-VU login+retry-on-401 pattern k6's own scripts use, same 60-VU/20s ramp shape,
against both rung D (uncontended) and rung E (contended). If the raw loop's gap matches tflw's own:
isolated to Node's fetch()/undici stack itself. If it collapses toward k6's: isolated to tflw's own
code, and a scoped M42 gets proposed.

**Method.** Reused this session's already-fresh k6 numbers (D58) rather than re-measuring an
unchanged baseline. Ran `raw-fetch-bench-dogfood.mjs` 3× per rung, load target reset before every
run (`POST /v1/admin/load/reset`), 0% error rate on all 6 runs:

| Rung | tflw avg | k6 avg | raw-fetch avg | tflw vs k6 gap | raw-fetch vs k6 gap | raw-fetch vs tflw |
|---|--:|--:|--:|--:|--:|--:|
| D. uncontended (throughput) | 1,520.3/s | 1,806.2/s | 1,529.3/s | k6 leads 18.8% | k6 leads 18.1% | raw leads tflw by 0.6% |
| D. uncontended (p95) | 36.7ms | 30.4ms | 36.9ms | tflw trails 20.5% | raw trails 21.2% | raw is 0.5% higher (noise) |
| E. contended (throughput) | 582.7/s | 636.0/s | 596.7/s | k6 leads 9.1% | k6 leads 6.6% | raw leads tflw by 2.4% |
| E. contended (p95) | 102.0ms | 68.9ms | 100.3ms | tflw trails 48.1% | raw trails 45.7% | raw is 1.6% lower (noise) |

(Per-run JSON in `/tmp/m41-results/` — not committed, regenerable via
`node acceptance/perf/profile/raw-fetch-bench-dogfood.mjs <uncontended|contended> 60 20000` against a
freshly reset target.)

**A bare `fetch()` loop with zero tflw code reproduces tflw's own gap almost exactly, on both
rungs.** On rung E — the rung that actually matters, where M39 localized the residual — the raw
loop's p95 gap vs. k6 (45.7%) lands inside the same 46-49.2% band this arc has now measured four
independent times, and its absolute p95 (100.3ms) and throughput (596.7/s) differ from tflw's own
numbers (102.0ms, 582.7/s) by only 1.6-2.4% — well within this measurement's own run-to-run noise,
and nowhere close to collapsing toward k6's 68.9ms/636.0/s. Rung D shows the identical pattern: the
raw loop's throughput and p95 are statistically indistinguishable from tflw's own (0.5-0.6%
difference), both trailing k6 by essentially the same ~18-21% either way.

**This is a positive isolation, not an elimination-by-exhaustion** — unlike M36/M40's negative
results (ruling candidate mechanisms out one at a time), M41 directly constructs the simplest
possible Node HTTP client, with none of tflw's own machinery in the loop at all, and it exhibits the
same gap. That leaves Node's `fetch()`/undici implementation itself, measured against Go's
`net/http` client (k6), as the standing explanation — consistent with M40's own "inherent
interpreted-Node-vs-compiled-Go" framing, now confirmed by direct construction rather than inferred
by elimination.

**Per D59: isolated to Node's HTTP stack.** D33a's tolerance is re-confirmed as amended in M40: ~10%
for throughput and for p95 on uncontended/light-contention targets, ~50% for p95 specifically on a
real-row-lock-contended target (now covering four independent measurements: 46%, 49.2%, 48.1%,
45.7%). No M42 — an HTTP-client swap (tuning undici's `Pool`/`Client` API directly, or an alternate
library) remains a real but high-effort, uncertain-payoff bet against a runtime-level
characteristic, and per this arc's D51/D52/D55/D59 bounded-effort convention, that bet stays closed
unless a future milestone finds new evidence changing the picture. The pentest arc (v0.4.0) is
unblocked.

## Verdict (M41)

**The gap is isolated to Node's `fetch()`/undici HTTP stack itself, not to any tflw-specific code.**
A bare Node `fetch()` loop with zero interpreter/session/redaction/execSteps machinery, hitting the
same real contended target with the same ramp shape and the same k6-equivalent auth handling,
reproduces tflw's own p95 gap almost exactly (45.7% vs. tflw's 48.1%, both against the same k6
baseline) — this is now four independent measurements (M38, M39, this session's ad hoc re-run, and
this milestone's own tflw/raw-fetch pair) clustering in a tight 46-49% band, plus a fifth
(raw-fetch's own 45.7%) landing in the same band from a completely different, machinery-free client.
D33a's ~50% contended-p95 tolerance (amended M40) is re-confirmed, not loosened further and not
tightened toward the user's original ~1-2% target — that target is not achievable without an
HTTP-client-level change this arc has now decided, twice (D55, D59), not to pursue speculatively.
No M42. The pentest arc (v0.4.0) may now start.

## M42 — testing a pinned-per-VU connection, canonical baseline recorded (2026-08-01)

Reopened M41's own "no M42" close the same day, at the user's explicit direction, to test whether
**pinning one persistent connection per VU** — Artillery's and k6's own default behavior; Node's
`fetch()`/undici's default `Pool` never does this (`connections: null`, a new on-demand `Client` per
concurrent dispatch, confirmed via undici's own docs) — closes the gap M41 isolated to Node's HTTP
stack. Scoped via `/grill-me` (D60-D66, `PLAN_BROWSER_PERF_SECURITY.md` §2.13). Extended
`raw-fetch-bench-dogfood.mjs` with a `pinned` client mode: each VU constructs its own `undici.Client`
once at spawn and reuses it for its full lifetime, instead of calling global `fetch()`.

**First measurement round** (fetch-mode baseline + pinned, 3 runs each, this session): pinned-Client
cut the p95 gap from 48.3% to 32.0% and flipped throughput to lead k6 by 2.4% — the largest, most
repeatable movement of any mechanism tested in this arc (M36, M40, and M41's own unpinned raw-fetch
all moved the number by roughly nothing). Per D62's strict ~1-2% bar this doesn't qualify as
"confirmed," so the user asked for one final, coordinated measurement — **all four variants
(tflw itself, k6, raw-fetch unpinned, raw-fetch pinned) run back-to-back in one quiet-machine sweep**,
3 runs each, load target reset before every run, 0% errors throughout — to serve as the canonical
baseline for all future gap-closing work in this arc, superseding the scattered, session-drifted
numbers M38-M41 accumulated across different days:

| Variant | throughput/s | p95 (ms) | throughput vs k6 | p95 gap vs k6 |
|---|--:|--:|--:|--:|
| **k6 (Go)** — reference | 648.0 | 68.28 | — | — |
| tflw (real interpreter) | 590.8 | 101.67 | k6 leads 8.8% | tflw trails **48.9%** |
| raw-fetch, unpinned | 586.2 | 103.55 | k6 leads 9.5% | trails **51.7%** |
| raw-fetch, pinned-Client | 660.3 | 90.15 | pinned leads **1.9%** | trails **32.0%** |

**This baseline cleanly confirms two things at once.** tflw's real interpreter and unpinned raw-fetch
are statistically indistinguishable (48.9% vs. 51.7% — both inside this arc's established
run-to-run noise band), reproducing M41's isolation-to-Node's-HTTP-stack finding exactly, one more
time, from a fully independent coordinated run. And connection pinning is a real, substantial,
repeatable effect, not noise: throughput flips from trailing k6 to leading it, and the p95 gap drops
by roughly a third in relative terms (48.9% → 32.0%).

**Recorded as data only — the D62 verdict (does 32.0% count as "confirmed" despite missing the
strict ~1-2% bar, triggering a from-scratch M43) is deliberately left open here, pending a separate
decision.** No conclusion drawn yet on whether D33a's tolerance stands as re-confirmed or whether M43
gets scoped; this section exists purely as the canonical reference table for whatever gets decided
next. Per-run JSON/logs in `/tmp/m42-baseline/` — not committed, regenerable via the commands above.

## M44 — unpinned re-test through the corrected reporter, D33a re-scoped (2026-08-01)

M42's own 32.0%/48.9%-scale numbers, and every contended-p95 figure this arc has reported since M38
(46%, 49.2%, 48.1%, 32.0%), turned out to be measuring the wrong thing: tflw's load report summed
the scenario's uncontended `GET /products` lookup and the contended `POST /orders` checkout into one
per-iteration duration, while k6's own `checkout-burst.js` tags and thresholds the checkout leg
alone (`{name: 'checkout'}`). M43 (`PLAN_BROWSER_PERF_SECURITY.md` §2.14, D67-D72) built a real
per-endpoint identity into tflw's reporter — `api ... as "checkout"` plus a `threshold ... for
"checkout"` scope — closing that asymmetry at the source rather than patching around it in a
throwaway script. This milestone re-runs the acceptance scenario through the shipped fix, on today's
real, unpinned `fetch()`-based client, to get the true apples-to-apples number inside tflw's own
report for the first time, and to re-scope D33a's tolerance to match it directly.

**checkout-burst, checkout-scoped p95 (3 runs each side, load target reset before every run):**

| | tflw run 1 | tflw run 2 | tflw run 3 | tflw avg | k6 run 1 | k6 run 2 | k6 run 3 | k6 avg |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| Iterations | 11,516 | 11,839 | 11,881 | — | 12,924 | 12,990 | 13,012 | — |
| Throughput | 575.8/s | 592.0/s | 594.1/s | **587.3/s** | 646.2/s | 649.5/s | 650.6/s | **648.8/s** |
| Checkout p95 (scoped) | 83ms | 79ms | 79ms | **80.3ms** | 68.77ms | 68.31ms | 68.10ms | **68.4ms** |
| Combined p95 (old metric, for reference) | 106ms | 101ms | 103ms | 103.3ms | — | — | — | — |
| Error rate | 0.00% | 0.00% | 0.00% | 0.00% | 0.33% | 0.34% | 0.34% | 0.34% |

**The corrected gap: throughput trails k6 by 9.5%, checkout-scoped p95 trails by 17.5%** — both a
completely different scale from every combined-metric number this arc reported M38-M42 (46-51%
throughput-adjacent, 32-49% p95). tflw's own report shows the old, inflated number directly: the
same three runs' *combined* p95 (106/101/103ms, avg 103.3ms) is 51% above the checkout-scoped number
(80.3ms) — almost entirely the uncontended GET leg's own ~28-29ms p95 riding along inside the old
undifferentiated total. This confirms the throwaway diagnostic script's (`leg-split-diag.mjs`,
not committed) ~18% estimate from the `/grill-me` session that scoped M43, this time from tflw's
real, shipped report rather than a hand-rolled instrumentation pass.

**Regression check — `dogfood-post-uncontended` (single-endpoint scenario, no `as`/`for` tags,
expected to be numerically unaffected by M43 since there's nothing to scope):**

| | tflw avg | k6 avg | gap |
|---|--:|--:|--:|
| Throughput | 1,531.9/s (30,412 / 30,689 / 30,813 iterations) | 1,771.5/s (35,828 / 35,719 / 34,743 iterations) | k6 leads **13.5%** |
| p95 | 36ms (flat across all 3 runs) | 31.9ms (31.16 / 30.96 / 33.64ms) | tflw trails **12.8%** |

Matches M39's own rung D for this exact scenario (11.2% throughput / 14.7% p95) within this arc's
established run-to-run noise band — confirms M43's reporter change is measurement-only and didn't
disturb an already-passing case.

**D73 — D33a's contended-p95 tolerance is re-scoped now, from ~50% down to ~20%.** The ~50% bar M40
set (`PLAN_BROWSER_PERF_SECURITY.md` §2.7) was calibrated against the inflated combined-duration
metric (46-49%); it was never measuring the checkout leg alone. Against the true, checkout-scoped
number (17.5%, this milestone), ~20% keeps the same design intent D33a's original ~10% bar had —
headroom above the measured value, not a bar already failing on day one. Throughput's existing ~10%
tolerance is unaffected (9.5% measured here, consistent with every clean throughput reading this arc
has produced). Full amendment text in `PLAN_BROWSER_PERF_SECURITY.md` §2.7.

**What this means for M45.** The pinned-per-VU connection work is no longer chasing a ~32-49%
gap down toward ~1-2% — it's chasing ~17.5% down toward ~1-2%, roughly a third the distance M42's
own pinned-Client prototype already covered in one isolated measurement (32.0%, on the old inflated
metric; not yet re-measured checkout-scoped). D74 in §2.16 keeps the strict bar, now explicitly
anchored to this milestone's 17.5%/80.3ms figure rather than M42's superseded number.

Per-run JSON/logs in `/tmp/m44-baseline/` — not committed, regenerable via the commands above
(`checkout-burst.tflw` now needs no extra flags; the `as`/`for` tags are already in the fixture).

## M45 — pinned-per-VU connections, real runtime implementation (2026-08-01)

M42 only prototyped a pinned connection in a disposable script (`raw-fetch-bench-dogfood.mjs`,
`undici.Client`, isolation-only). This milestone builds the real thing inside `packages/runtime`:
a new load-only send path (`packages/runtime/src/httpPinned.ts`) on Node's native `node:http`/
`node:https`, one `Agent({keepAlive: true})` pair created per VU (the closed-model, `ramp to N
users` spawn block in `interpreter.ts`'s `runLoadCore`) and reused for that VU's whole lifetime —
never `undici`, per D75, so `sendRequest`'s `fetch()` path for `tflw run` stays completely
untouched (the exact isolation `mtlsWorker.ts` already established for the same reason). Wired
through `TestCtx.pinnedAgents` → `execApi`'s new `sendOnce()` branch, which picks the pinned path
whenever a request's shape supports it (string-or-absent body, no mTLS) and falls back to the
unpinned `fetch()` path — with a one-time console warning — for the two acknowledged gaps
(`FormData`/upload bodies, mTLS-under-load). An open-model (`ramp to N rps`) scenario has no
persistent "VU" to pin a connection to, so it's unaffected, unchanged from before this milestone.

**checkout-burst, checkout-scoped p95 (3 runs pinned tflw, 3 runs k6, load target reset before
every run):**

| | tflw pinned run 1 | run 2 | run 3 | avg | k6 run 1 | run 2 | run 3 | avg |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| Iterations | 12,829 | 13,324 | 13,401 | — | 12,985 | 12,989 | 13,058 | — |
| Throughput | 641.5/s | 666.2/s | 670.1/s | **659.2/s** | 649.3/s | 649.5/s | 652.9/s | **650.5/s** |
| Checkout p95 (scoped) | 75ms | 70ms | 70ms | **71.7ms** | 69.05ms | 67.71ms | 68.23ms | **68.3ms** |
| Error rate | 0.00% | 0.00% | 0.00% | 0.00% | 0.37% | 0.36% | 0.34% | 0.36% |

**Regression check — `dogfood-post-uncontended` (also closed-model, so it now runs pinned too;
same 3-run protocol):**

| | tflw pinned avg | k6 avg | gap |
|---|--:|--:|--:|
| Throughput | **1,803.9/s** (35,645 / 35,838 / 36,754 iterations) | 1,767.7/s (35,348 / 35,073 / 35,641 iterations) | **tflw leads 2.05%** |
| p95 | 32.0ms (33 / 32 / 31ms) | 30.89ms (31.01 / 30.84 / 30.82ms) | tflw trails **3.59%** |

**The result: pinning closed the throughput gap entirely and flipped it — tflw now *leads* k6 by
1.3% (checkout-burst) and 2.1% (dogfood-post-uncontended) — and collapsed the p95 gap from M44's
17.5%/12.8% down to 4.9%/3.6%.** This closely matches the earlier throwaway diagnostic script's own
pinned-mode estimate from the `/grill-me` session that scoped M43-M46 (~4.6-7.4% checkout-scoped,
unpinned-vs-pinned comparison against a proxy target) — real shipped code landed almost exactly
where that informal instrumentation predicted.

**Verdict against D74's strict ~1-2% bar.** Throughput meets and exceeds it in both scenarios (a
lead, not just a shrunk deficit). Checkout-burst's p95 (4.9%) and dogfood's p95 (3.6%) are both
short of the literal "~1-2%" target, so by the letter of D62/D74 this doesn't count as a clean pass
— it's the fourth data point in that ladder (M36 concurrency ceiling, M40 bookkeeping-share, M41
raw-fetch reproduction were the first three refutations at the old scale; this is the first at the
corrected scale, and it's a near-miss rather than a wide one). Unlike those three, though, this is
real, shipped, production code with zero regression risk: every measured number (throughput and
p95, both scenarios) is strictly better than the unpinned baseline, the full existing suite (390
runtime + 107 CLI tests, plus this milestone's own new coverage) stays green, and D33a's own
tolerance (~20%, M44-set) is now met with enormous headroom (4.9%/3.6% actual vs. 20% allowed).
**Recommendation: keep the implementation, treat this as the practical ceiling for a JS/V8 load
generator vs. k6's Go client, and proceed to M46 using these numbers as the arc's final baseline** —
a call left for explicit user confirmation at this milestone's checkpoint, not assumed silently,
given D62/D74's bar was reaffirmed explicitly as recently as this same day's `/grill-me` session.

**New test coverage** (`packages/runtime/test/httpPinned.test.ts`, new; `load.test.ts`, extended):
direct `sendPinnedRequest`/`createPinnedAgents` coverage (connection reuse across requests on one
Agent pair, two VUs get two distinct connections, JSON body + computed `content-length`, redirect
following incl. 301/302/303 downgrade-to-GET and 307/308 preserve-method-and-body, timeout error
shape matching `sendRequest`'s own, multi-`Set-Cookie` header survival) plus two `runLoad`-level
integration tests: a closed-model scenario's iterations land on exactly as many distinct TCP
connections as VUs (proves the real wiring, not just the isolated function), and an `upload`-body
scenario under load still passes cleanly via the documented fallback.

Per-run logs/JSON in `/tmp/m45-pinned/` — not committed, regenerable via the same commands M44's
section documents, run against `dist/cli.cjs` rebuilt from this milestone's source (`npm run
bundle` in `packages/cli`).

## M46 — root-causing the residual p95 gap: Nagle fix + percentile-bias quantification (2026-08-01)

M45 left a 4.9%/3.6% checkout-scoped p95 gap, short of D74's strict ~1-2% bar. Rather than accept
that as a real performance ceiling on the numbers alone, this milestone compared tflw's p95
*measurement logic* against k6's directly (D76-D80, `PLAN_BROWSER_PERF_SECURITY.md` §2.17), found
two candidate mechanisms, fixed the stronger one, quantified the weaker one, and took one bounded
follow-up pass per D79's precommitted stop condition.

**D77 — the fix.** `httpPinned.ts`'s pinned send path never called `req.setNoDelay(true)`; Node's
raw `http`/`https` leaves Nagle's algorithm on unless the caller opts out, while `undici` (`fetch()`,
tflw's own unpinned path) and Go (k6) both disable it by default. Landed as a one-line change right
after `lib.request(...)` is called. Full suite (390 runtime + 107 CLI tests, typecheck, build)
stayed green.

**Remeasured (3 runs per side, load target reset before every run, fresh k6 baseline same window):**

| | tflw run 1 | run 2 | run 3 | avg | k6 run 1 | run 2 | run 3 | avg |
|---|--:|--:|--:|--:|--:|--:|--:|--:|
| **checkout-burst** iterations | 12,611 | 13,450 | 13,229 | — | 12,850 | 12,855 | 12,804 | — |
| Throughput | 630.6/s | 672.5/s | 661.5/s | **654.8/s** | 642.5/s | 642.8/s | 640.2/s | **641.8/s** |
| Checkout p95 (scoped) | 76ms | 70ms | 69ms | **71.7ms** | 68.05ms | 67.56ms | 67.48ms | **67.7ms** |
| **dogfood-post-uncontended** iterations | 36,330 | 36,155 | 36,928 | — | 36,197 | 36,582 | 36,162 | — |
| Throughput | 1,816.5/s | 1,807.8/s | 1,846.4/s | **1,823.6/s** | 1,809.8/s | 1,829.0/s | 1,808.1/s | **1,815.7/s** |
| p95 | 31ms | 31ms | 31ms | **31.0ms** | 30.04ms | 30.16ms | 30.18ms | **30.1ms** |

**Result: mixed, and honestly asymmetric.** `dogfood-post-uncontended`'s p95 gap improved from
M45's 3.6% to **2.90%** — under D79's <3% stop threshold, and its throughput lead shrank from 2.05%
to a noise-level 0.43%. `checkout-burst`'s p95 gap did **not** improve — 4.9% → **5.86%**,
essentially unchanged/within this arc's own established run-to-run noise band (M45's three prior
checkout-burst p95 readings alone spanned 70-75ms); throughput's lead actually grew slightly (1.3%
→ 2.03%). The Nagle fix is real, correct, and zero-downside regardless (it brings the pinned path in
line with `undici`'s and Go's own defaults) — it just isn't the dominant contributor to
checkout-burst's residual, only to dogfood's.

**D78 — percentile-bias quantification.** A throwaway script (`percentile-bias-diag.mjs`, not
committed) expanded a fresh checkout-burst run's own bucketed histogram (`{value, count}` pairs,
already using tflw's shipped 3-sig-fig rounding) into a sorted array and ran both algorithms over
the *identical* underlying values: tflw's nearest-rank vs. k6's linear interpolation. Result on a
12,662-iteration checkout sample: **0.00ms / 0.00% bias.** At this sample size the two algorithms
land on the same bucket almost every time — the bucketing/rounding itself (D19's tradeoff) is not
meaningfully inflating this comparison. Candidate B is confirmed real in principle but negligible in
practice; `LatencyHistogram.percentile()` is unchanged, as planned.

**D79/D80 — stop condition applied.** `dogfood-post-uncontended`'s residual closed (<3%).
`checkout-burst`'s residual (5.86%) remained meaningful, so D79 permitted one further bounded pass
into D80's reserved candidates. Checked the strongest of the three: **server-side Nagle on
testFlow-tests' actual client-facing socket.** Found it doesn't apply to this topology — the load
client never connects to the NestJS/Node process directly; `nginx` (`testflow-tests-nginx-1`) fronts
port 4001 and proxies to the `api` container, and nginx's own `tcp_nodelay` directive defaults to
`on` and is not overridden anywhere in this stack's `nginx/nginx.conf`. The server-side leg was
never contributing a Nagle-related stall. Per D79's precommitted cap ("at most one further bounded
pass"), the two remaining D80 candidates (`AbortSignal.timeout()` allocation overhead, event-loop/GC
jitter) are **not** chased further this milestone — the pass is spent.

**Verdict: checkout-burst's 5.86% checkout-scoped p95 gap is accepted as the practical ceiling**,
per D79's own precommitted rule, and this closes M46's investigation. `dogfood-post-uncontended`'s
gap is closed (2.90% < 3%). The Nagle fix stays shipped regardless of its mixed empirical effect —
it is a correct, zero-downside best practice that measurably helped one of the two scenarios and
regressed neither. D33a's ~20% tolerance (M44-set) remains met with large headroom on both
scenarios. Proceed to M47 using these numbers as the arc's final baseline.

Per-run logs/JSON and the diagnostic script in `/tmp/m46-nagle/` — not committed, regenerable via
the same commands M44's/M45's sections document, run against `dist/cli.cjs` rebuilt from this
milestone's source (`npm run bundle` in `packages/cli`).

**Addendum — D80 reopened at the user's explicit direction (2026-08-01): event-loop/GC jitter
checked, ruled out.** After the verdict above, the user chose to spend a further bounded pass
(explicitly overriding D79's own "accept the ceiling" close) on the second D80 candidate:
event-loop/GC jitter under sustained load. Temporary instrumentation (`node:perf_hooks`'
`monitorEventLoopDelay()` + a `PerformanceObserver({entryTypes: ['gc']})`) was added around the
`workers === 1` `runLoad` call site in `packages/cli/src/cli.ts`, mirroring M40's own
"instrument-then-revert" technique — no code shipped, reverted immediately after the readings below
(`git checkout -- packages/cli/src/cli.ts`; typecheck + full test suite reconfirmed green
post-revert).

Three runs, load target reset before each: two on `checkout-burst` (the scenario with the residual
gap), one on `dogfood-post-uncontended` (the scenario D77 already closed) as a control —

| | checkout-burst run 1 | run 2 | dogfood run 1 (control) |
|---|--:|--:|--:|
| event-loop delay: min/mean/p50 (ms) | 4.02 / 5.03 / 5.03 | 4.03 / 5.03 / 5.03 | 4.05 / 5.01 / 5.02 |
| event-loop delay: p95/p99/max (ms) | 5.74 / 5.93 / 8.4 | 5.71 / 5.89 / 8.72 | 5.55 / 5.79 / 7.21 |
| GC: count / totalMs / maxSingleMs | 152 / 58.17 / 2.76 | 155 / 60.53 / 4.95 | 207 / 77.91 / 6.05 |

The `min`/`mean`/`p50` clustering at ~4-5ms across all three runs regardless of scenario is
`monitorEventLoopDelay`'s own sampling-resolution floor (`resolution: 5` was used), not real
application stalling — the informative numbers are the spread above that floor and the GC
readings. Both are flat: checkout-burst's worst single event-loop delay (8.4-8.72ms) and worst
single GC pause (2.76-4.95ms) are **not larger** than the uncontended control's (7.21ms / 6.05ms)
— if anything the control shows a heavier GC max, since it processes ~2.7x more iterations in the
same 20s window. No mechanism here scales with contention the way the residual gap does, and
nothing in either run comes close to a magnitude (tens of ms, recurring often enough to move a few
hundred iterations' worth of tail) that could plausibly produce a systematic ~4ms p95 shift across
checkout-burst's ~13,000 iterations. **Refuted, cleanly — same shape as M40's own refutation of the
bookkeeping-compounding hypothesis.**

All three named D80 candidates are now checked: server-side Nagle (not applicable, nginx-fronted),
event-loop/GC jitter (refuted, this addendum), leaving only `AbortSignal.timeout()` per-request
allocation overhead untested. D79's cap is now spent twice over by explicit user choice, not by the
plan's own default; the practical-ceiling verdict above stands. `checkout-burst`'s 5.86% residual
checkout-scoped p95 gap remains the accepted ceiling. Proceeding to M47.

## M46d — a third, Node-based comparator: Artillery, to test whether the residual gap is a Node/JS-vs-Go characteristic (2026-08-01)

M46's own investigation exhausted the plausible tflw-specific mechanisms (Nagle, percentile
algorithm, server-side Nagle, event-loop/GC jitter) without closing checkout-burst's residual
5.86% p95 gap vs. k6. The remaining open question — asked explicitly — is whether that residual is
a **Node/JS-vs-Go runtime characteristic** (in which case any Node-based load tool should show a
broadly similar gap against k6) or something specific to tflw's own implementation. k6 alone can't
answer that, since it's the only non-Node point of comparison. This milestone adds a third engine:
**[Artillery](https://www.artillery.io/)**, the most enterprise-adopted Node.js load-testing tool
(YAML/JS scenario DSL, multi-step flows with variable capture, a commercial Artillery Cloud
offering) — already referenced once in this arc (M42's design note: "Artillery's and k6's own
default is one pinned connection per VU").

**Two structural asymmetries, unavoidable and documented up front (not discovered mid-run):**

1. **Open model vs. closed model.** Artillery's core engine is arrival-rate (`phases:
   [{ arrivalRate, rampTo }]`) — every arrival is a fresh, isolated virtual user that runs the flow
   once and exits. There is no built-in Artillery executor for k6's/tflw's closed model (a fixed
   pool of persistent VUs looping continuously). This is not a config oversight; Artillery simply
   doesn't have that executor. A `rampTo` calibrated to *offer* the same throughput tflw/k6 achieve
   is not equivalent — an open model's queue depth grows unboundedly past its true sustainable
   rate, while a closed model's VU-count cap self-limits queueing. Confirmed empirically below: an
   initial calibration attempt offering ~650-850/s (tflw/k6's own achieved throughput) collapsed
   into multi-hundred-ms/multi-second p95s and, on `dogfood-post-uncontended`, outright request
   failures — not because the target got slower, but because the open model has no backpressure
   analogous to a VU cap.
2. **Session/token handling.** k6 and tflw both establish a session once per persistent VU and
   reuse it across thousands of iterations (reactive re-login on a 401). Artillery's open model has
   no persistent VU identity to cache a token on — a naive per-arrival login would hammer apiV2's
   `bcrypt(cost 10)`-backed `/auth/login` hundreds of times per second, turning this into an
   accidental bcrypt-CPU benchmark instead of a checkout-contention one. Fixed via a shared,
   proactively-refreshed token cache (`acceptance/perf/artillery/processor.cjs`) — refreshed every
   3s, safely under this dev stack's deliberately short 5s `JWT_ACCESS_TTL` (see
   `../k6/checkout-burst.js`'s own comment on that TTL), deduped via a shared in-flight promise so
   concurrent arrivals never trigger duplicate logins. This is structurally the same idea as k6's
   per-VU caching / tflw's session model, just process-wide instead of per-VU (Artillery has no
   per-VU identity to hang it on).

**Calibration.** Given the open-model mismatch, offering tflw/k6's own achieved throughput
(`checkout-burst` ~650/s, `dogfood-post-uncontended` ~1820/s) overloads Artillery's open model long
before it approximates their p95. Bisected down to a **flat** (not ramped — a ramp that overshoots
compounds an unrecoverable backlog within a 20s window) arrival rate whose *achieved* p95
approximated tflw/k6's on a first/cold run: **310/s** for checkout-burst (p95≈73ms vs. tflw/k6's
~68-72ms — ~47% of their throughput), **600/s** for dogfood-post-uncontended (p95≈32ms vs.
tflw/k6's ~30-31ms — ~33% of their throughput). Both numbers are real: it took roughly a third to a
half of tflw/k6's own throughput for Artillery's default (non-pinned, per-request-connection) HTTP
client to reach a comparable tail latency.

**The proper 3-run protocol (load target reset before each run) exposed real instability that the
calibration runs — each a single cold run — did not:**

| checkout-burst (310/s flat) | run 1 | run 2 | run 3 |
|---|--:|--:|--:|
| iterations (0 failed all 3 runs) | 6,200 | 6,200 | 6,200 |
| checkout p95 (named) | 106.7ms | 24.8ms | 23.8ms |

| dogfood-post-uncontended (600/s flat) | run 1 | run 2 | run 3 |
|---|--:|--:|--:|
| iterations completed / failed | 12,000 / 0 | 12,000 / 0 | 5,507 / **6,493** |
| cart-add p95 (named) | 106.7ms | 76.0ms | 333.7ms (over the *surviving* 46%) |

Run 3's failures were real errors, not shed load: `ECONNRESET` (2,395) and client-side `fetch
failed` (4,098, inside `processor.cjs`'s own token-refresh call) — both something neither k6 nor
tflw exhibited anywhere in this entire arc's ~30+ measurement runs. A follow-up probe
(`config.http.pool: 500`, more concurrent sockets) traded the errors for even worse queueing
(p95 1652.8ms, 0 failures) — confirming this is genuine sustained-load instability in Artillery's
default HTTP client, not a fluke of one setting.

**Honest interpretation, not a precise gap number.** checkout-burst's 3 runs (0 failures across
all 3) landed p95 24-107ms — noisy (a >4x spread, vs. tflw's/k6's own ~2-8ms spread across every
3-run set this entire arc has measured) but squarely the same *order of magnitude* as k6's ~68ms,
not 10x or 100x off. dogfood's two clean runs (76-107ms) are similarly in-range before run 3's
instability. Two conclusions, held with different confidence:

- **Directionally supportive, not proof:** on the runs that completed cleanly, a real, popular,
  enterprise-adopted Node.js tool's own tail latency against this same target sits in the same
  broad range as k6's — consistent with (not contradicting) tflw's own 5.86%/2.90% residual gaps
  being a real, modest, and plausible Node-vs-Go characteristic, rather than an implausible
  tflw-specific defect. This isn't a controlled apples-to-apples number (the workload-model and
  throughput mismatches above rule that out), so it can't upgrade "consistent with" to "proven."
- **A genuinely new, higher-confidence finding:** Artillery, run with its *default* connection
  handling, is markedly **less stable** under sustained load against this target than either k6 or
  tflw's own pinned-connection implementation — real connection resets and client-side failures at
  throughput levels neither k6 nor tflw ever had trouble with. This directly corroborates why this
  arc's own investment (M45's pinned `node:http` connections, D19's self-diagnosis/backoff
  detection) was worth doing: a well-known, real-world Node load-testing tool run with its
  out-of-the-box defaults hits exactly the class of problem (no connection reuse, no built-in
  saturation self-diagnosis) that tflw specifically engineered around. tflw needing real work to
  get to a tight, reproducible sub-6% gap against k6 is not a sign of being uniquely behind — a
  popular sibling Node tool struggles with the same underlying problem class, more visibly.

No change to M46's own verdict: checkout-burst's 5.86% residual remains the accepted ceiling. This
milestone is corroborating context for that verdict, not a new measurement that supersedes it.
Config in `acceptance/perf/artillery/` (`checkout-burst.yml`, `dogfood-post-uncontended.yml`,
`processor.cjs`, committed — `npx artillery` is used ephemerally, same as `k6`'s standalone
binary, no `package.json` dependency added). Raw run logs/JSON in `/tmp/m46d-artillery/` (not
committed).

## M47 — final acceptance round: the full rung ladder, three ways (tflw / k6 / Artillery) (2026-08-01)

The arc's closing measurement, mirroring M34's own role as its opening one. Re-runs every rung of
M39's own ladder — echo GET-only, echo POST-only, dogfood GET-only, dogfood-post-uncontended,
checkout-burst — fresh (not reusing any prior milestone's numbers), 3 runs per rung per side, load
target reset before every dogfood run. Extended at the user's explicit direction (D81,
`PLAN_BROWSER_PERF_SECURITY.md` §2.18) to a full **three-way comparison**: tflw, k6, and Artillery
on every rung, not just the two contention-relevant rungs M46d covered.

**Rungs A-C (echo GET/POST, dogfood GET-only) keep M39's own exclusion from any tflw-vs-other
conclusion** — tflw's generator self-saturates on these near-zero-latency targets (D19), a
separately-diagnosed phenomenon. Artillery turned out to have its own version of the same problem
on these rungs, for different reasons (see below) — reported for completeness, not used for D33a's
tolerance check. **Rungs D and E are the trustworthy three-way comparison** and are what D33a's
final tolerance is set against.

### Rung-by-rung numbers (3 runs each, averages shown; full per-run numbers below each table)

**A. echo GET-only** (`/products`, zero-latency target, no auth):

| | tflw | k6 | Artillery |
|---|--:|--:|--:|
| Throughput | 32,348/s | 81,300/s | 4,500/s (own ceiling) |
| p95 | 1ms | 0.365ms | 4.7ms |
| Saturated / capped? | yes (D19) | no | yes (own limits, see below) |

Per-run: tflw iterations 253,857 / 262,690 / 259,805 (p95 1/1/1ms). k6 81,541 / 81,246 / 81,112 per
s (p95 0.358/0.370/0.366ms). Artillery locked at its offered 4,500/s all 3 runs, 0 failures (p95
5/5/4ms).

**B. echo POST-only** (`/orders`, static body):

| | tflw | k6 | Artillery |
|---|--:|--:|--:|
| Throughput | 30,073/s | 81,426/s | 4,500/s (own ceiling) |
| p95 | 1ms | 0.367ms | 4.7ms |
| Saturated / capped? | yes (D19) | no | yes (own limits) |

Per-run: tflw iterations 235,523 / 244,105 / 242,124 (p95 1/1/1ms). k6 81,995 / 81,682 / 80,601 per
s (p95 0.360/0.372/0.369ms). Artillery locked at 4,500/s all 3 runs, 0 failures (p95 5/4/5ms).

**C. dogfood GET-only** (`GET /health`, session-authed, real Postgres-backed target):

| | tflw | k6 | Artillery |
|---|--:|--:|--:|
| Throughput | 11,398/s | 10,967/s | 300/s (own ceiling) |
| p95 | 5ms | 5.21ms | 5ms |
| Saturated / capped? | yes (D19) | no | yes (own limits) |

Per-run: tflw iterations 229,058 / 226,996 / 227,802 (p95 5/5/5ms). k6 10,878 / 11,063 / 10,959 per
s (p95 5.24/5.15/5.23ms). Artillery locked at 300/s all 3 runs, 0 failures (p95 4/4/7ms) — closest
Artillery ever tracked k6 in this whole arc, but at ~2.7% of k6's achieved throughput.

**D. dogfood-post-uncontended** (`POST /cart/items`, per-user row, no shared lock) — **authoritative**:

| | tflw | k6 |
|---|--:|--:|
| Throughput | 1,827.7/s | 1,820.1/s |
| p95 | 29.67ms | 30.47ms |

**tflw leads k6 on both metrics this round** — throughput +0.42%, p95 **-2.6%** (tflw faster).
Per-run: tflw iterations 35,547 / 36,707 / 37,406 (p95 30/30/29ms). k6 1,823.7 / 1,819.7 / 1,817.0
per s (p95 29.78/30.92/30.71ms). Sign-flip from M46's 2.90% (tflw trailing) to -2.6% (tflw leading)
this round — both readings are noise around a genuinely-closed gap, not a regression.

Artillery (600/s, same config M46d calibrated): run 1 clean (12,000/12,000, p95=106.7ms), run 2
clean but much worse (12,000/12,000, p95=194.4ms), run 3 collapsed (5,502/12,000 completed, **6,498
failed** — 3,659 `ECONNRESET` + 2,839 client-side `fetch failed`, p95=308ms over survivors). This
is the same failure signature M46d found independently — a fresh, independent reproduction of
Artillery's own instability under sustained load against this exact target, not a fluke of that
milestone's specific run.

**E. checkout-burst / dogfood-post-contended** (real row-lock contention) — **authoritative**:

| | tflw | k6 |
|---|--:|--:|
| Throughput | 661.5/s | 658.7/s |
| Checkout-scoped p95 | 71.0ms | 66.45ms |

**tflw leads k6 on throughput** (+0.44%) **and trails on checkout p95 by 6.85%** — consistent with
M46's own 5.86% (both readings sit inside the same noise band this arc has repeatedly characterized
for this specific rung; this is not a regression, it's the same accepted ceiling measured again).
Per-run: tflw iterations 12,851 / 13,486 / 13,355 (checkout p95 73/70/70ms). k6 iterations 648.2 /
662.1 / 665.7 per s (checkout p95 67.32/65.96/66.08ms).

Artillery (310/s, same config M46d calibrated): all 3 runs completed cleanly (6,200/6,200, 0
failures) — checkout p95 102.5ms / 24.8ms / 26.8ms. Near-identical to M46d's own independent
numbers (106.7 / 24.8 / 23.8ms) — a striking, unprompted reproduction that strengthens M46d's
"directionally supportive" reading of the Node-vs-Go hypothesis: two separate measurement sessions,
same tool, same target, landed on almost the same numbers.

### What A-C add, honestly

Artillery's own numbers on the self-saturating rungs surfaced two mechanisms distinct from tflw's
D19 generator-saturation, but in the same spirit — **a second Node-based tool also cannot get
anywhere near k6's raw throughput/latency ceiling on a near-zero-latency target, just for different
reasons than tflw's**:

- **Whole-millisecond histogram floor.** Even at a offered rate as low as 1,000/s (nowhere close to
  saturated), Artillery's own `p95` read 2-3ms — it cannot resolve k6's sub-millisecond numbers at
  all, an instrumentation-precision ceiling, not a server-side one.
- **`EADDRNOTAVAIL` (local ephemeral port exhaustion)** above ~5,000/s on the echo rungs — the open
  model's per-arrival fresh outbound connection churns through the OS ephemeral port range faster
  than the OS can recycle it. 4,500/s (echo) and 300/s (dogfood GET, where the real network+DB
  round trip makes each connection live longer, hitting the same wall at a far lower rate) are each
  rung's own zero-failure ceiling, not a k6-matched number.

Rung C is the one exception worth flagging: at its own 300/s ceiling, Artillery's p95 (4/4/7ms)
tracked k6's (5.24/5.15/5.23ms) closely — the closest any Artillery reading came to k6 anywhere in
this arc, just at roughly 1/36th of k6's throughput. Not used for D33a's tolerance check (per D81),
but a genuinely interesting three-way data point.

### D33a's final tolerance (set for good)

Both authoritative rungs land comfortably inside D33a's ~20% contended-p95 tolerance (re-scoped in
M44): rung D at -2.6% (tflw ahead), rung E at 6.85% (tflw behind, matching M46's own accepted
ceiling). Throughput leads k6 on both rungs, both rounds. **D33a's tolerance is met, with large
headroom, on the arc's final, real, post-M45-pinning numbers — no further re-scoping.** This closes
the perf arc (v0.3.0).

### Pentest arc (v0.4.0) unblock

**Unblocked, for good.** D33d/D52/D56/D64 pushed this decision six times over the arc's life,
always conditionally ("once M-whatever lands"). M47 is that final condition — D33a's tolerance is
met on real numbers, not provisionally, and the perf arc's own milestone ladder (M34-M47) is
complete. The security/pen-test arc (§3) may start next; no further perf-arc work blocks it.

Config for the 3 new rungs in `acceptance/perf/artillery/` (`echo-get-only.yml`,
`echo-post-only.yml`, `dogfood-get-only.yml`, committed — the existing `checkout-burst.yml` /
`dogfood-post-uncontended.yml` were re-run unchanged). Raw run logs in `/tmp/m47-results/` (not
committed).

## M48 — two new dogfood rungs (search-read, ticket-write) + p50/p99 visibility (2026-08-02)

At the user's request: widens the acceptance ladder past the 5-rung A-E set with two new dogfood
rungs the existing ladder never exercised, and adds p50/p99 alongside every rung's existing p95
metric — tflw already computes the full percentile set for free; k6's default summary needed
`summaryTrendStats` extended to include `p(50)`/`p(99)`. tflw-vs-k6 only (no new Artillery configs,
diverging from M47's three-way default — an explicit user call this round). Report-only: no new
D33a-style tolerance is set on p50/p99 or on the two new rungs. Full scope in
`PLAN_BROWSER_PERF_SECURITY.md` §2.20 (D82-D85).

### Rung F — search-read (`GET /products?q=gadgetronic`, public, real full-text-search cost)

A genuine Postgres `to_tsvector`/`plainto_tsquery` query cost, distinct from rung C's simple
indexed `GET /health` — and the first dogfood rung needing no session at all (the endpoint is
public). 3 runs each, no reset needed (read-only, nothing mutates):

| | tflw | k6 |
|---|--:|--:|
| Throughput | 4,332.4/s | 4,256.4/s |
| p50 | 7ms | 6.77ms |
| p95 | 12.33ms | 12.62ms |
| p99 | 14.33ms | 14.01ms |

**Extremely close on every metric** — throughput +1.8% (tflw ahead), p95 -2.3% (tflw ahead), p99
+2.3% (tflw behind), all within noise. Per-run: tflw iterations 85,936 / 89,306 / 84,704 (p50
7/7/7ms, p95 12/12/13ms, p99 14/14/15ms). k6 4,233.4 / 4,277.8 / 4,258.0 per s (p50 6.79/6.66/6.86ms,
p95 12.57/12.73/12.57ms, p99 13.99/14.24/13.80ms). Both sides 0 failures, all 3 runs. tflw's own
backoff diagnostic fired (~60% "unable to keep pace with the target system") on all 3 runs — a real
signal about the target's own latency drifting up as the 0→60 VU ramp progresses, not client
self-saturation (D19's own signature is wildly divergent tflw-vs-k6 numbers; here they match to
within a few percent, cross-validating that the underlying data is trustworthy despite the warning).

### Rung G — ticket-write (`POST /tickets`, authed, uncontended, two-row write)

Writes a `Ticket` row *and* a companion `TicketEvent` row synchronously
(`TicketsService.create` → `logEvent(CREATED)`) — a second uncontended write shape, distinct from
rung D's single-row cart-add. `POST /products/:id/reviews` was considered and rejected as this
rung's target first: it's both rate-limited (`RateLimitGuard`, 3/window per user+product) *and*
`@Unique(['userId','productId'])` at the DB level, so a fixed load-user/product pool 409s
permanently after each pair's first success — it would measure the uniqueness wall, not throughput.

**Two real bugs found and fixed building this rung, both kept regardless of the numbers below:**

1. **A process-crashing race.** `LoadAdminService.reset()` was extended (this milestone) to delete
   the load user's tickets between runs, same pattern as its existing orders cleanup. The very first
   real run crashed the entire `api` container: `TicketSlaSweepService.sweep()` (a background timer,
   `setInterval(() => { void this.sweep() }, ...)`) scans overdue tickets and stamps a `TicketEvent`
   for each; if `reset()` deletes a ticket the sweep already selected but hasn't reached yet, the
   event insert throws an uncaught `FK_ticket_events_ticket_id` violation — and since `sweep()`'s
   caller never awaits or catches it, that one exception took the whole Node process down. Fixed in
   `ticket-sla-sweep.service.ts`: the per-ticket update+event-insert is now wrapped in a try/catch,
   `isForeignKeyViolation` (already existed in `db-errors.ts`, just never wired in here) skips a
   concurrently-deleted ticket instead of crashing, any other error is logged and the sweep continues
   to the next ticket. A background sweep racing a deletion should never take the whole app down —
   this bug existed before M48 (any future ticket-deleting code would have hit it identically); this
   rung's write volume was just the first thing that ever triggered it.
2. **Missing indexes.** Neither `sweep()`'s own query (`tickets` filtered on
   `status, sla_breached, sla_deadline`) nor the reset's cascade-delete lookup
   (`ticket_events.ticket_id`) had any supporting index beyond each table's primary key — both were
   full sequential scans. Added via migration `1785200200000-AddTicketSlaSweepIndexes`. Real and
   worth keeping at any scale, though — see below — it turned out *not* to be the driver of this
   rung's own run-over-run degradation.

**A genuine, reproducible finding, not smoothed over:** back-to-back 20s runs against this rung
degrade substantially, and — critically — **both tools degrade together, on a freshly-reset stack,
runs interleaved tflw/k6/tflw/k6/tflw/k6 to rule out ordering bias**:

| Run | tflw throughput | tflw p50/p95/p99 | k6 throughput | k6 p50/p95/p99 |
|---|--:|--:|--:|--:|
| 1 (freshest) | 1,038.5/s | 24 / 78 / 110ms | 570.1/s | 49.4 / 88.5 / 106.0ms |
| 2 | 471.6/s | 63 / 100 / 114ms | 362.7/s | 77.8 / 113.6 / 120.5ms |
| 3 | 337.7/s | 89 / 123 / 135ms | 287.1/s | 99.8 / 129.8 / 140.4ms |

0 failures on tflw all 3 runs; k6 shows a small, consistent 0.8-1.6% `http_req_failed` rate each run
(login-path requests, not the checked ticket-create ones — `checks_succeeded` stays 100%) — the same
class of asymmetry `checkout-burst.js`'s own header comment already documents (tflw's session model
re-establishes on a 401 automatically; k6's hand-rolled `authedRequest` retry is thinner). Not chased
further here, consistent with that existing finding.

Root cause investigated one bounded pass (mirroring this arc's own discipline): confirmed via
`pg_stat_user_tables` that `ticket_events` accumulates dead-tuple bloat (35,725 dead vs 146,279 live
rows after just 3 runs) faster than Postgres's default autovacuum cadence (`autovacuum_naptime =
1min`, `autovacuum_vacuum_scale_factor = 0.2`) can reclaim it under this rung's sustained
create+cascade-delete churn (~20k rows/run). The index migration above did **not** fix this (re-run
identically before/after). Forcing a `VACUUM ANALYZE` before every run made it *worse*, not better
(cold cache immediately following a heavy vacuum). **Not chased further** — this is a shared-target,
Postgres-autovacuum-tuning characteristic under sustained write bursts, not a tflw-vs-k6
characteristic (both tools track the same degradation curve in lockstep) and out of this milestone's
scope (D82 was "widen load-test surface," not "tune Postgres"). Reported honestly as a real
environmental finding rather than averaged away or hidden behind a single misleading throughput
number.

### p50/p99 added to the authoritative rungs (D, E)

k6's `summaryTrendStats` extended on `dogfood-post-uncontended.js`/`checkout-burst.js` to include
`p(50)`/`p(99)`; tflw's numbers reused from M47's own raw logs (`/tmp/m47-results/{D,E}-tflw.log`)
since tflw already reported the full percentile set, just not extracted into M47's write-up. k6's
side re-run fresh (3× each, back-to-back on a freshly-reset stack, nothing else run in between to
avoid the cross-rung contamination rung G's own churn caused earlier in this session — see below).

**D. dogfood-post-uncontended:**

| | tflw (M47's runs) | k6 (fresh) |
|---|--:|--:|
| p50 | 16.3ms | 16.6ms |
| p95 | 29.67ms | 30.70ms |
| p99 | 39.67ms | 37.27ms |

p50 nearly tied (-1.6%), p95 tflw slightly ahead (matches M47's -2.6% within noise), **p99 flips to
tflw +6.4% behind** — the tail gap that isn't visible at p95.

**E. checkout-burst (checkout-scoped):**

| | tflw (M47's runs) | k6 (fresh) |
|---|--:|--:|
| p50 | 33.0ms | 32.5ms |
| p95 | 71.0ms | 67.2ms |
| p99 | 103.0ms | 90.4ms |

p50 essentially tied (+1.6%), p95 matches M47's own +6.85% (tflw behind), and **p99 widens further
to +14.0%** — on the contended rung specifically, the tflw-vs-k6 gap grows monotonically with the
percentile: nearly nothing at the median, a modest and already-accepted gap at p95, meaningfully
larger at p99. Consistent with a lock-queueing-tail mechanism (M39-M41's own root-causing) that bites
harder the further out on the tail you look — exactly the kind of signal this milestone's p99
addition was added to surface. **Report-only, per D84**: this does not reopen D33a's already-closed
p95 tolerance (M47's verdict stands), but is worth remembering if a future milestone ever considers
gating p99 specifically.

**A methodology note on why k6's D/E re-run needed a full stack reset partway through:** the first
attempt (run immediately after rung G's ~61k-ticket churn) showed k6's own throughput collapse to
~200/s with a 98% `http_req_failed` rate — not a D-rung finding at all, but rung G's write burst
still settling (WAL/checkpoint pressure) plus a stale hardcoded product id (the load target's UUID
changes on every reseed — the fixture's own header comment already warns of this; a full stack reset
for a clean rung-G baseline regenerated it and the two dogfood-post-uncontended fixtures weren't
updated first). Both `dogfood-post-uncontended.tflw`/`.js` and `artillery/dogfood-post-uncontended.yml`
were updated to the current id and the k6 side re-run cleanly, back-to-back with nothing else run in
between — the numbers above are from that clean pass.

### Files

New: `acceptance/perf/tflw/search-read.tflw`, `ticket-write.tflw`; `acceptance/perf/k6/search-read.js`,
`ticket-write.js` (all committed). Modified: `dogfood-post-uncontended.js`/`checkout-burst.js`
(`summaryTrendStats`), `dogfood-post-uncontended.tflw`/`.js` and `artillery/dogfood-post-uncontended.yml`
(current product id). testFlow-tests: `LoadAdminService`/`.module.ts` (tickets cleanup),
`ticket-sla-sweep.service.ts` (crash fix), migration `1785200200000-AddTicketSlaSweepIndexes`.

## M49 — root-causing the p50/p99 widening: AbortSignal.timeout() tail cost, k6 source verification (2026-08-02)

M48's p99 addendum found the tflw-vs-k6 gap on checkout-burst widens with percentile (p50 tied,
p95 +6.85%, p99 +14.0%). The user asked, reasonably, whether that shape indicates a real bug in
tflw rather than a genuine performance difference — and specifically to check `grafana/k6`'s own
source rather than reason from memory, and to spend D80's last unchecked candidate
(`AbortSignal.timeout()` overhead) on it.

**k6's actual computation, verified against source.** Fetched `metrics/sink.go` from
`github.com/grafana/k6@master`. `TrendSink` stores every raw sample (`values []float64`, appended,
never sampled or dropped); `min`/`max`/`sum` are exact running scalars; `P(pct)` is linear
interpolation over the fully sorted exact array. `DefaultSummaryTrendStats` is
`["avg","min","med","max","p(90)","p(95)"]` — k6 has no built-in `stddev` stat, and neither does
tflw's `LatencyHistogram` (only `sum`/`min`/`max`/`count` are tracked as exact scalars; a true
stddev on either side would need a dedicated instrumentation pass). The decisive check: raw `max`
involves zero percentile math on either side, and it showed the *same* widening pattern as p99 —
proof this isn't a percentile-algorithm artifact. D78 already measured that bias at 0.00%; this
corroborates it independently.

**The isolation diagnostic.** A throwaway script (7 interleaved rounds, 60,000 requests/side/round,
420,000 total per side) reproduced `httpPinned.ts`'s exact request shape — `node:http`, one
`Agent({keepAlive:true})` per VU, `req.setNoDelay(true)` — against a zero-work local server, fully
isolating client-transport overhead from DB/app/network variance:

| | without `AbortSignal.timeout()` | with `AbortSignal.timeout(30000)` |
|---|--:|--:|
| avg (7-round range) | 0.026-0.027ms | 0.030-0.031ms |
| max (7-round range) | 0.78-1.78ms (all 7 rounds) | **7.4-18.1ms (5 of 7 rounds)** |

avg/p50/p95/p99 barely move; `max` spikes 5-10x in most rounds — a rare, single-iteration event,
not a systemic per-request cost, matching the "invisible below p99, dominant at the tail" shape of
the real gap exactly. A manual `setTimeout`/`clearTimeout` hard-deadline reproduced in the same
harness showed none of this (max stayed in the ~1ms no-signal band across 5/5 further rounds) —
`AbortController`/`AbortSignal` wraps `EventTarget` + listener bookkeeping a plain timer skips.

**The fix.** `req.destroy()` on an in-flight request surfaces as a generic `ECONNRESET`/"socket
hang up" on `error` (verified in the same diagnostic, not assumed) — not a distinguishable error
code — so timeout detection uses a closure flag (`timedOut`) rather than inspecting the caught
error's shape. `httpPinned.ts`'s `signal: AbortSignal.timeout(opts.timeoutMs)` was replaced with a
manually-hoisted `setTimeout`/`clearTimeout` spanning both the request and the body-read loop below
it — matching the original's real scope (an earlier draft cleared the timer on the `response` event
alone and was caught before landing: that would have silently stopped enforcing the deadline during
a slow body drip, a behavior regression). Full suite green: 390 runtime + 107 CLI tests, typecheck,
build.

**Remeasured, same session, identical fixtures/targets to M46-M48 (no methodology changes):**

| | tflw (fixed) | k6 (fresh baseline, same session) | gap | (M46/M48 gap) |
|---|--:|--:|--:|--:|
| echo GET-only (rung A) max, avg of 3 runs | 7.3ms | 2.4ms | 3.0x | ~9-10x |
| checkout-burst checkout-scoped p50 | 34.0ms | 33.6ms | +1.2% | +1.6% |
| checkout-burst checkout-scoped p95 | 71.33ms | 68.89ms | **+3.54%** | +6.85%/5.86% |
| checkout-burst checkout-scoped p99 | 97.67ms | 91.76ms | **+6.44%** | +14.0% |
| checkout-burst scenario max, avg of 3 runs | 225.0ms | 220.07ms | **+2.2%** | +41.6% |

**Verdict.** `AbortSignal.timeout()` was a real, if narrow, contributor to exactly the
widening-with-percentile shape M48 surfaced — confirmed via clean isolation fully separated from
DB/app/network variance, not inferred from noisy real-load numbers alone. The fix cuts
checkout-burst's p95 gap from M46's accepted ceiling (5.86%) to 3.54% — still a hair above D79's
original <3% bar, not quite under it — while roughly halving the p99 gap and nearly closing the max
gap outright. `dogfood-post-uncontended` (already closed in M46) and rung A's own trivial-target
tail both improved too, but the mechanism is inherently rare-event and client-side, so it was never
going to zero out any gap on its own. **Not chased further to hit the exact <3% number** — the fix
is shipped and correct regardless; D79's "one bounded pass" discipline applies again rather than
iterating on the threshold. Server-side Nagle and event-loop/GC jitter remain ruled out (M46);
`AbortSignal.timeout()` was D80's last untested candidate and is now checked, fixed, and shipped —
no further D80 candidates remain. D33a's ~20% tolerance is unaffected (already had large headroom).

Isolation scripts were throwaway (not committed), same convention as D78's own
`percentile-bias-diag.mjs`.

**Files.** Modified: `packages/runtime/src/httpPinned.ts` (`AbortSignal.timeout()` → manual
`setTimeout`/`clearTimeout` deadline, D88).
