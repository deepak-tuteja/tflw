# Functional testing

A functional test runs its body **once** and comes out pass or fail. That is the whole execution
model, and every chapter in this pillar is a way of writing that body — the requests, the
assertions that judge them, the values that travel between them, the setup and teardown around
them, and, when the subject is a page rather than an endpoint, the steps that drive a browser.

The other two pillars are the same block seen differently. [Performance
testing](/guide/performance) keeps the body and changes how many times it runs;
[security testing](/guide/security) keeps the body and adds assertions that judge the responses it
already produced. Neither is a second language, which is why this pillar comes first.

If you have not written a test yet, start at [Writing your first test](/guide/first-test) — it is
the entrance, and this page is the map.

## What each chapter answers

| chapter | the question it answers |
| --- | --- |
| [Assertions in depth](/guide/assertions) | how do I say what "correct" means, and what happens when it isn't? |
| [Variables, generators & expressions](/guide/variables) | where does a value come from, and how does it travel between steps? |
| [Data-driven tests & hooks](/guide/data-and-hooks) | how do I run one test over many rows, and set up and tear down around it? |
| [Retry, polling & flaky handling](/guide/retry-and-polling) | what do I do about something that is not true *yet*? |
| [Actions, imports & the JS/TS escape hatch](/guide/actions) | how do I stop repeating myself, and what if the language cannot express it? |
| [Browser testing: interacting with a UI](/guide/browser-basics) | how do I drive a page, and how does a step find the thing it acts on? |
| [Browser testing: advanced scenarios](/guide/browser-advanced) | frames, tabs, downloads, network stubbing, accessibility, visual regression |

Two chapters that belong to no pillar sit under *Start here* and are worth reading before any of
these: [Config & environments](/guide/config) for where services, environments and secrets are
declared, and [Sessions & auth](/guide/sessions) for the single auth concept the whole language
has.

## One file, both halves

Each chapter shows its own construct on its own. This is what they look like joined — the shape
the front page claims and the reason the browser steps live in this language rather than beside
it. Seed over the API, drive the UI, then assert against the backend that the UI actually changed
something:

```tflw
import "./shared/create.tflw"

before
  let widgetId = create widget(unique("Widget"), 9.99)

test "the restock form on a catalog page reaches the API" as admin
  open "/catalog/{widgetId}"
  expect text "Notify me when back in stock" is visible

  fill form
    | "Email" | unique email |

  click button "Notify me"
  expect text "We will email you" is visible

  api GET /widgets/{widgetId}/watchers
  expect status equals 200
  expect body.items has count 1

after
  api DELETE /widgets/{widgetId}
```

Four things in that file are worth naming, each with a chapter behind it.

- **The setup is a call, not a copy.** `create widget(...)` is an [action](/guide/actions)
  imported from another file; `before` and `after` are [hooks](/guide/data-and-hooks).
- **`unique("Widget")` and `unique email` are generators, not fixtures** — see
  [variables](/guide/variables) for what that buys and what it costs on a retry.
- **`as admin` reaches the `api` steps and not the browser.** A session is the api steps' headers
  and cookie jar; the browser context it does not touch. This test asks the browser to do
  something a signed-out visitor can do, which is why it never logs the page in. A test that needs
  an authenticated *page* establishes identity twice, on purpose — see [Sessions &
  auth](/guide/sessions).
- **The last assertion is the point.** Everything before it proves the page did something;
  `api GET …/watchers` proves the something reached the backend. That crossing is what stays
  awkward when the UI and the API are two tools.

## Where to go next

- **New to the language:** [Writing your first test](/guide/first-test), then
  [Assertions in depth](/guide/assertions).
- **Porting an existing suite:** [Config & environments](/guide/config) and
  [Sessions & auth](/guide/sessions) first — most of the work of a port is declaring the surface,
  not rewriting the tests.
- **Already running tests and want them in CI:** [CI, reporting &
  safety](/guide/ci-and-reporting), and [Running & debugging tests](/guide/debugging) for what to
  do when one goes red.
- **Ready for the other pillars:** [Performance testing](/guide/performance) and [Security
  testing](/guide/security).
