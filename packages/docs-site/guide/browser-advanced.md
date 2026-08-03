# 8. Browser testing: advanced scenarios

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
```

`switch to new tab`'s popup listener starts *before* its block runs, so a fast-opening tab can't
race past it. `drag`/`drop file` only work against a page that actually listens for `dragstart`/
`dragover`/`drop` the way a real drag-and-drop UI does.

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

`stub <METHOD> "<url-pattern>" respond status <code> [body {...}]` mocks a route for the rest of
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

Full reference: [SPEC.md §9](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#9-ui-steps-p8-9-p26-).
