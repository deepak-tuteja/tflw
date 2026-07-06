# Acceptance: tflw vs. raw fetch + node:test

PLAN.md decision 41's publish gate: ~10 scenarios implemented twice — once as `.tflw` tests, once
as the honest "no tool" baseline (`node:test` + the global `fetch`, Node's own built-ins, zero
dependencies) — judged on line count, readability, and report quality. Both sides run against the
same real API: automationTestPOC's sample app (`http://localhost:3001`, `npm run launch-apps`
equivalent — see the repo root `CLAUDE.md`).

Run both sides yourself:

```sh
# tflw side
cd acceptance/tflw && node ../../packages/cli/dist/cli.js run --no-color

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
cd acceptance/restful-booker && node ../../packages/cli/dist/cli.js run --no-color
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
