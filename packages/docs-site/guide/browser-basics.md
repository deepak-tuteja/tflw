# Browser testing: interacting with a UI

Browser steps live in the same `.tflw` file as API steps — a login → seed-via-API → drive-UI →
assert-backend-state test stays one readable file. `playwright` is an optional peer, dynamically
imported only once a suite actually runs a browser step — install it yourself, then let tflw
download the browser binaries for it:

```sh
npm install -D playwright
npx tflw install-browsers
```

## Interaction steps

```tflw fragment binds=orderId,email
open "/orders/{orderId}"                 # relative to the active env's `web` base URL
click button "Add to cart"
double click button "Row"
right click button "Row"
fill field "Email" with {email}
select "Widget" from field "Size"
tick field "Accept terms"                # ticks a checkbox/radio
untick field "Accept terms"
hover button "Menu"
press "Enter"                            # page-level
press "Enter" on field "Search"          # scoped to one locator
scroll to button "Load more"             # scrolls the locator into view

accept dialog                            # arms a handler for the *next* native dialog
click button "Delete"                    # (the browser otherwise auto-dismisses silently — a real
                                          #  no-op trap for a confirm()-guarded action)
dismiss dialog
```

Every interaction step polls up to `timeout step` (default 30s) for its locator to resolve —
`sleep` doesn't exist, only auto-waiting/auto-retrying.

## Native dialogs

An arming is consumed by exactly one dialog, in the order you wrote them. So an action that raises
two dialogs takes two armings:

```tflw fragment
accept dialog
accept dialog
click button "Delete all"
```

That matters because there is nowhere else to put the second one — both dialogs come from a single
click, so no step can sit between them.

Assert what the dialog actually was:

```tflw fragment
accept dialog
click button "Delete"
expect dialog message equals "Really delete?"
expect dialog type equals "confirm"
```

`dialog type` is one of `alert`, `confirm`, `prompt`, `beforeunload`. Both subjects read the last
dialog of the current test, and reading either before any dialog has appeared fails the test saying
so.

::: warning On an `alert`, arming proves nothing by itself.
An alert has one button, so accepting and dismissing it do exactly the same thing to the page. A
test that arms one and then asserts the page would pass just as well with the arming line deleted.
Assert the dialog itself — its `message` and its `type` — and the test says something.

The same trap is why `dialog type` is worth asserting at all on a `confirm`: if someone replaces a
guarded `confirm()` with a plain `alert()`, the destructive action stops being guarded, and every
assertion about the page still passes.
:::

::: tip Coming from Playwright or Cypress? The tick action is `tick`, not `check`.
Both of those spell it `check()`, so `check field "Accept terms"` is the natural thing to type. In
tflw `check` is the **soft assertion** — the forgiving twin of `expect`, see
[Assertions in depth](/guide/assertions) — and nothing else.

It used to be both, told apart by whether a matcher followed. That reads fine until you forget the
matcher: `check field "Accept terms"` meaning *"assert this box is ticked"* would instead **tick the
box** and report a passing step, so the assertion you thought you wrote never ran. Now it's an
error that names both readings — `tick field "…"` if you meant to tick it, `check field "…" is
checked` if you meant to assert it — because which one you meant is exactly what a guess would get
wrong. `uncheck` is an error too, naming `untick`.
:::

## `fill form`

```tflw fragment
fill form
  | "Name"  | unique("user")         |
  | "Email" | unique email           |
  | "Age"   | random number 18 to 99 |
```

Each row's left cell is a quoted field name — same resolution as a bare `fill field` — and each
row executes and reports as its own sub-step. No auto-verify; audit with an explicit `check`/
`expect` line if you need one.

## The locator model

The **noun picks the resolution strategy** — cascading isn't the problem, cascading *invisibly*
would be:

- `button "…"` / `text "…"` / `list "…"` — single strategy (role+name / visible text /
  role="list"+name).
- `field "…"` — a closed 3-step cascade: label → placeholder → role (textbox). A below-tier-1
  resolution is annotated right in the CLI/report line (`field "Search" (resolved via
  placeholder)`), never silently accepted.
- Escapes: `css "…"`, `xpath "…"` — greppable when nothing else fits.

**Ambiguity is always a hard error** — more than one match never silently picks the first. The
error lists up to 5 matched candidates' visible text and suggests `within <container>` or a more
specific name:

```tflw fragment
within list "Cart items"                 # scopes every nested step's locator resolution to inside
  click button "Remove"                  # this container, block form, same indentation as any
                                          # other construct — no brace syntax
```

**Cold-start diagnosis.** A persistently-unresolved semantic locator (`button`/`field`/`text`/
`list` — `css`/`xpath` are skipped, nothing semantic to fuzzy-match) scans the live DOM for
elements of the right shape and appends up to 5 ranked, ready-to-paste suggestions to the "no
element found" error — a typo like `click button "Add to Crat"` surfaces `button "Add to Cart"`.
This only changes what the failure message *suggests*, never which element a step acts on.

For a *verified* (not best-guess) locator while you're still writing a test, point `tflw pick` at
a real running page and click the element you want — see
[Running & debugging tests](/guide/debugging).

## Waiting & UI-state assertions

Locators (`button "…"`, `field "…"`, `text "…"`, `list "…"`, `css "…"`, `xpath "…"`) are
assertion subjects too, using the state/value/count matchers from the
[Matchers reference](/reference/matchers):

```tflw fragment
expect button "Pay" is enabled
expect field "Email" has value "a@b.c"
expect list "Cart items" has count 3
expect button "Loading spinner" is not visible
```

`is` is an optional copula that carries no meaning — `is not visible`, `not is visible`,
`is visible` and `not visible` all parse, and the docs use `is not visible` because it reads as
English. Negation is `not` in front of any matcher, exactly as it is for API subjects.

These auto-retry to `timeout expect` (default 5s) — a UI expect is tflw's own retry loop, not a
thin Playwright wrapper. `has count` is the one matcher meaningful against more than one element;
every other matcher still hard-errors on ambiguity. "Zero elements" is itself a legitimate,
non-erroring state for `is hidden`, `is not visible` and `has count 0`.

Full reference: [SPEC.md §9](https://github.com/deepak-tuteja/tflw/blob/main/SPEC.md#9-ui-steps-p89-p26-).
