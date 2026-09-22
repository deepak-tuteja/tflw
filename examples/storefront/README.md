# The Coffee Shelf — a worked example

A small shop, and a tflw suite that exercises **every door the page has** and **every statement
the language can write**. Two commands, no setup:

```
npm run example        # the functional suite + the scan — 32 of 32 pass, ~2.7s
npm run example:load   # the same work, run at a rate
npm run example:pacing # one paced workload, on its own — see below for why it is not in :load
npm run example:ui     # open it in `tflw ui`
```

Both run against `server.mjs` beside this file: one stdlib `node:http` server, no build, started
and stopped for you.

**Every statement is not a boast, it is a gate.** `packages/lang/test/exampleCoverage.test.ts`
asks the printer which statements it can write — 31 of them — and fails if this corpus is missing
one. A construct added to the language owes a test here in the same round, which is the mechanism
by which the documentation stops falling behind.

## What is here

| file | what it is for |
|---|---|
| `tests/catalogue.tflw` | reading the shop over the API, on the page, and one test that does both |
| `tests/checkout.tflw` | requests that are *documents* — nested bodies, and three headers that each decide something |
| `tests/signin.tflw` | signing in, and judging the response that comes back |
| `tests/load.tflw` | the same work under a workload, and the one place `pause` is legal |
| `tests/scan.tflw` | a `crawl` that walks what the suite touched, as a stranger |
| `tests/shelf.tflw` | browsing — typing, pressing, hovering, scrolling, a screenshot |
| `tests/order-form.tflw` | the three shapes a form has, and the one answer that is not instant |
| `tests/basket.tflw` | a confirmation taken both ways, and a line dragged between two lists |
| `tests/receipt.tflw` | the two things that leave the page — a tab of its own, and a file |
| `tests/delivery.tflw` | a stubbed supplier, and a bulk order dropped on the page as a file |
| `tests/fulfilment.tflw` | work that finishes after the answer, and the poll that waits for it |
| `tests/account.tflw` | one `action`, what it `give`s back, and the two ways to call it |

`order.html`, `order.js` and `shelf.css` are the shop's order page, served at `/order`. It is
where the browser half of the language becomes runnable: the rest of this shop is two documents
and a form, which is enough for `open`, `click` and `expect text` and for nothing else. Every
control on it is something a small shop does — none of it is a widget put there to be tested.

### Four things the build of this corpus was corrected by, all of them by running it

- **`pause` is only legal inside a workload-bearing test** (`TF033`). It is per-iteration pacing;
  waiting for something to *become* true is `wait until`.
- **`expect field "Town" equals "Bristol"` is `TF042`** — `equals` reads a value, and a UI locator
  is not one. So the page echoes back what it took, which is what a delivery form does anyway.
- **A dialog is armed before it is raised, not answered after.** `accept dialog` says what to do
  with the *next* one; a native `confirm()` blocks the page, so there is no moment in between.
  tflw says so — `warning[TF079]` — **on a test that still passes**, which is the point of it.
- **`drag` currently needs its source element to survive the drop, and that is a limitation rather
  than a rule.** A handler that removes its own source leaves the closing `dragend` waiting on an
  element that is gone: thirty seconds, then a timeout naming `locator.dispatchEvent` and neither
  the removal nor the source — while the drop itself has already landed. The page moves the node
  instead, which is what a shop means anyway; the defect is recorded and its repair is scoped.

Between them they cover **all nine lens combinations the language admits** — which is what
`tflw ui` uses to decide which door a test appears behind. A test is in every door whose constructs
it carries; nothing labels it. `tests/catalogue.tflw`'s third test carries an `api` step *and* an
`open`, so it shows up under API **and** BROWSER, with no tag involved.

## Where to look for a request worth reading

Most of this example is deliberately small, because the shape of a *test* is easier to learn
against `GET /items` than against a checkout. That leaves the shape of a *request* untaught, which
is what `tests/checkout.tflw` is for: bodies with nested objects and an array of lines, and three
headers that are not decoration —

- **`Authorization`** decides whether the request is answered at all, and is read *before* the body
  is. A shop that validates a stranger's address and then turns them away has told them which
  postcodes it takes.
- **`Idempotency-Key`** decides whether pressing pay twice is one order or two. The second call in
  *"pressing pay twice is one order, not two"* is byte-for-byte the first one; the key is what makes
  the answer `200` and the same `ref` instead of a second charge.
- **`X-Request-Id`** comes back on the answer — including the refusals, because a correlation id
  that survives only the happy path is no use on the day you need it.

**The bodies are written on one line, and that is the canonical form.** A bracketed value may be
typed across several lines and tflw reads it happily, but `print` writes it back on one line — so a
multi-line body here would make this the one file in the repository that does not round-trip whole.
The layout belongs in the view: open the file in `tflw ui`, pick a request, and press **format** in
the Body tab.

## Three things this example is built to teach

**One test runs on its own, and measuring why is the point.** `tests/load.tflw`'s paced test —
the one `pause` in the corpus — is tagged `@pacing`, not `@workload`. A pause is idle time *inside*
the run, and the bottleneck judgement is a property of the run and not of a test, so putting it in
`:load` moves the verdict: **`INCONCLUSIVE 3/3` without it, `PASS 4/4` with it** (generator cpu
74%), same box, same tree, one tag apart. The teaching point below would have quietly become false.
That is worth knowing before you copy this: *bounding or idling one test's workload can change
another test's verdict.*

**`npm run example:load` ends `INCONCLUSIVE`, and that is the correct answer.** The shop is an
in-process server on loopback, so the thing under load is trivial and tflw's own generator is the
bottleneck — which tflw measures and says out loud rather than reporting numbers that describe
itself. Lightening the load makes it *worse*, not better: a shorter run amortises tflw's fixed
start-up cost over less wall time, so the CPU rate goes up. A load verdict against a toy on
loopback is not available at any setting, and a tool that produced one would be lying.

**The scan passes, and it is one line from failing.** Delete `HttpOnly;` from either `set-cookie`
in `server.mjs` and run again: `sec/cookie-not-httponly` fires as a **critical** finding and
`tests/signin.tflw` goes red. Nobody had to know in advance which weakness to look for — that is
what the severity matcher buys over a hand-written header assertion.

**The crawl walks the pages, not the JSON, and it took a failing run to learn why.** All seven
security rules apply only to a response that sets a cookie, is served over `https`, carries a CORS
header, or is a `text/html` document. A JSON response on loopback is none of those, so a crawl
seeded from JSON-only traffic has no applicable rule — and tflw **fails** that assertion rather
than passing it quietly: *this assertion had no power to fail*. Point a crawl at pages.

## Two rules about `seed traffic` worth knowing before you copy this

`crawl … seed traffic` walks the requests **its own file** made, and the crawl runs after every
test in that file rather than where you typed it — so what it finds never depends on where the
declaration sits. Put the crawl beside the requests you want walked; a crawl alone in a file
discovers nothing, and says so.

It makes no `authorization violations` claim, because that oracle is differential: it re-issues
each request under every *other* declared principal and compares. With no `as <session>` there is
no principal to compare against, so the checker refuses the assertion instead of reporting a clean
result it could not have earned. The run prints the coverage either way.
