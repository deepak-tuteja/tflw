# Browser testing: advanced scenarios

Builds on [Browser testing: interacting with a UI](/guide/browser-basics) — frames, tabs,
downloads, drag-drop, evidence capture, network mocking, accessibility, and visual regression.

## Frames, tabs, downloads & drag-drop

```tflw fragment
within frame css "#payment-frame"        # traverses into the iframe's own document — nested
  click button "Pay"                     # steps resolve inside it, not on the main page

switch to new tab                        # arms a listener for the *next* popup before running the
  click text "Open in new tab"           # block, then makes the new tab active for every step
                                          # after this block (persists, unlike `within`'s scoping)
expect text "Second tab" is visible
switch to tab 1                          # 1-based, in the order tabs were opened
close tab                                # closes the active tab, falls back to the previous one

download as file                         # arms a listener for the active page's next download,
  click text "Download report"           # runs the block, then binds the suggested filename
expect field "Filename" has value {file}

drag text "First item" to text "Second item"    # native dragstart/dragenter/dragover/drop/dragend,
                                                 # dispatched directly — not Playwright's own
                                                 # dragTo() mouse simulation, which doesn't
                                                 # reliably fire native DnD listeners
drop file "./receipt.png" onto css "#dropzone"  # reads the file's real bytes and builds a genuine
                                                 # in-page File before dispatching the drop

wait until button "Submit" is enabled    # like `expect`, but polls `timeout wait` (default 30s)
                                          # instead of `timeout expect` (5s) — for a UI condition
                                          # that can legitimately outlast the ordinary UI-expect
                                          # budget. Always hard-fails; no soft/`check` form.
wait until text "Error" is not visible for 2s   # must hold *continuously* for 2s
wait until list "Results" has count 50 timeout wait 5m
                                          # this step polls for five minutes; every other wait
                                          # in the suite keeps the configured `timeout wait`
```

`switch to new tab`'s popup listener starts *before* its block runs, so a fast-opening tab can't
race past it. `drag`/`drop file` only work against a page that actually listens for `dragstart`/
`dragover`/`drop` the way a real drag-and-drop UI does.

## Asserting a negative: `wait until … for <duration>`

`wait until text "Error" is not visible` returns on its **first** poll — which, for a toast that
hasn't rendered yet, is immediately. The step passes precisely because nothing has happened, and it
would have passed just as readily one tick before the error appeared. That is the classic false
green, and it is why "the error never appears" is unassertable with a plain condition.

`for <duration>` fixes it by changing what satisfies the step: the condition must hold
*continuously* for that long, and the hold clock **restarts from zero** every time the condition
breaks. So `wait until text "Error" is not visible for 2s` fails the moment the toast shows up at
any point inside the window.

A failure reports the longest unbroken hold it managed (`longest unbroken hold 1900ms of 2000ms`)
rather than just the state at the deadline — a condition that nearly held and one that was never
true for a single poll are different bugs, and they need different fixes. The whole step is still
bounded by `timeout wait`, so a hold window at or above that budget can never be satisfied and is
rejected outright rather than burning 30s to report a mystery timeout.

`for` is UI-only. Sustaining an *API* condition would mean re-issuing the request for the whole
window, which is load testing rather than waiting — `wait until api … for` is refused by name and
points you at [load testing](/guide/load-testing).

## What a `wait until` can wait for

A `wait until` polls. That is a real constraint on what may follow it, and the rule is one sentence:
**re-reading the condition between two polls has to be able to give a different answer.**

Four things qualify, and they are the four the browser can change while your test is standing still:

```tflw fragment
wait until button "Submit" is enabled                     # a UI locator
wait until page has no critical a11y violations           # the page's own accessibility state
wait until request to "/api/cart" was made                # traffic the page issues on its own
wait until status of request to "/api/cart" equals 200    # …and the response it got back
```

For all four, `wait until <X>` is exactly `expect <X>` on the longer budget, plus the optional `for`
hold — `expect` already retries every one of them, just against `timeout expect`.

What does **not** qualify is anything that reads the last API response:

```tflw
test "polling a job"
  api GET /jobs/1
  expect body.state equals "queued"
```

`wait until body.state equals "done"` looks like the obvious next line, and it is refused. A
response is written once, by the `api` step that fetched it; nothing between two polls of a
`wait until` can change it, so the step could only pass on its first attempt or spin until its
deadline blaming an endpoint it never asked twice. What you want is to **re-issue the request**,
and that is what the block form is for:

```tflw fragment
wait until api GET /jobs/1
  expect body.state equals "done"
```

The same argument rules out a `{variable}` subject — `let`/`capture` bound it, and nothing between
polls rebinds it — and `matches snapshot`, which is compared once against a committed baseline
rather than re-read as the page settles. Settle the page first, then take the snapshot in its own
`expect`.

## One slow wait: `timeout wait <duration>` on the step

Most suites have one wait that is nothing like the others — an import job, a report build, a queue
that drains in its own time. Raising `timeout wait` in config to accommodate it slows down every
*failure* in the suite, because every other wait now takes the same long budget to give up.

Write the budget on the step instead. It is available on both forms of `wait until`, and goes last
on the line:

```tflw fragment
wait until text "Import complete" is visible timeout wait 10m
```

Don't confuse it with the `timeout` an `api` request takes. That one bounds a **single HTTP
request**; on a poll it bounds one poll, and it is clamped to whatever is left of the wait budget
anyway. They are different quantities and a poll may carry both:

```tflw fragment
wait until api GET /jobs/latest timeout 5s timeout wait 5m
  expect body.status equals "done"
```

No single poll may hang past 5s; the whole step gives up after five minutes.

A `for` hold has to fit inside whichever budget applies, and `tflw check` compares them for you —
against the step's own when it wrote one, which means it can now answer without resolving an env at
all.

## Evidence: screenshots & Playwright trace

```tflw fragment
open "/checkout"
screenshot "before payment"       # captures the active page unconditionally
click button "Pay"
expect text "Order confirmed" is visible
```

An **automatic failure screenshot** attaches to whichever step just failed, whenever a browser
page already exists for the attempt — an API-only test never pays for this. A **Playwright
trace** (full time-travel DOM + network + console) is kept on a failing attempt and on every
`retry` attempt, passed or not — open it with `npx playwright show-trace <path>`. Screenshots and
traces land in `report/assets/`; a small screenshot instead stays inlined as a `data:` URI under a
configurable byte budget.

`tflw run --browser chromium|firefox|webkit` (default chromium) switches the whole run's engine —
no in-run matrix, matrix across CI jobs instead. `--headed` shows a real window for local
debugging. `viewport <width> <height>` in `tflw.config`'s `defaults` block sizes every new context.

## Network observation & `stub` mocking

```tflw fragment
open "/checkout"
click button "Pay"
expect request to "/api/orders" was made
expect status of request to "/api/orders" equals 201
expect body.status of request to "/api/orders" equals "created"

stub POST "/api/payments/**" respond status 500 body { error: "gateway down" }
click button "Pay"
expect text "gateway down" is visible
```

`request to "<url-pattern>"` matches a request actually observed on the active page —
`<url-pattern>` is a plain substring match, and when several requests match, **the most recently
completed one wins**; pair it with `with method "<M>"` whenever more than one endpoint could share
a substring (e.g. a checkout `POST` followed by a confirmation-page `GET` to a related path).
`status`/`header`/`body[.path]`/`body text` `of request to "<url>"` reads that request's real
response instead of the last `api` step's.

`stub <METHOD> "<url-pattern>" respond status <code> [body {...} | body [...]]` mocks a route for the rest of
the test — reach for it when the real dependency is unreliable or out of scope (a flaky payment
sandbox, a webhook this suite doesn't own), not as a general substitute for a real fixture: tflw's
own dogfood suites never mock the API they're testing.

## Accessibility

```tflw fragment
open "/checkout"
expect page has no a11y violations              # every severity

open "/admin/legacy-widget"
expect page has no critical a11y violations       # a severity floor, not an exact match
```

A real [axe-core](https://github.com/dequelabs/axe-core) scan of the active page's current DOM.
`<severity>` (`minor`/`moderate`/`serious`/`critical`) is a **floor** — `has no serious a11y
violations` also counts `critical` findings. Omit it to count every severity. Retries to
`timeout expect` like any other UI expect, re-scanning the *current* DOM each poll — a page still
hydrating gets the same grace a not-yet-rendered locator gets. A failing assertion lists up to 5
real violations (rule id, severity, description, target element).

## Visual regression

```tflw fragment
open "/checkout"
expect page matches snapshot "checkout-page" mask css ".timestamp" mask css ".order-id"

click button "Add to cart"
expect list "Cart items" matches snapshot "cart-badge"
```

Captures either the whole page (`page`) or one element's bounding box and compares it, pixel for
pixel, against a baseline PNG committed at `snapshots/<file>/<test>/<name>.png`. `mask <locator>`
paints over a dynamic region (a timestamp, an avatar) *before* comparing — apply the same mask
clause(s) every time a given name is written or compared, since masking affects the baseline too.

Each baseline is **platform-key pinned**: a `<name>.platform.json` sidecar records the OS +
browser engine + build version that produced it, and a mismatched platform fails immediately,
before any pixel is compared — there's no cross-platform tolerance knob, and the pixel compare
itself requires zero differing pixels (no fuzz slider). `tflw run --update-snapshots` writes or
overwrites a baseline instead of comparing — the accept step for a deliberate visual change;
`report.html` shows a before/after/diff triptych for anything that wrote or changed one.

Full reference: [SPEC.md §9](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#9-ui-steps-p89-p26-).
