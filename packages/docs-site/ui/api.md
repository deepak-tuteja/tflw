---
pageClass: ui-shots
---

# The API door

> `#/api` — *call an endpoint, assert what comes back, chain one call into the next.*

The door tflw started as, and the one the Compose pane was built for. It opens on a request: a
method, a path, the headers and body it carries, and the assertions that read what came back.

![Compose on the API door: an API test, its requests and the assertions that read them](/ui/compose-api-paper.png){.light-only}
![Compose on the API door: an API test, its requests and the assertions that read them](/ui/compose-api-terminal.png){.dark-only}

## What `+ new test` writes here

A request and one assertion:

```tflw
test "creates an order and reads its total back"
  api POST /orders body { itemId: 1, qty: 2 }
  expect status equals 200
```

**The assertion is not a preference and is not optional.** An `api` step with nothing reading it
can never fail, so a guided start that produced one would be teaching the shape the checker warns
about. `expect status equals 200` is the assertion 1,112 of the two corpora's requests already
carry, which is why it is the one the button writes.

## What the pane offers

Three `+` gestures at the foot of the body — **`+ request`**, **`+ let`** and **`+ wait until`** —
and one control the other three doors do not have: **Send**.

Send issues this request *and the ones above it that feed it*, because 734 of the sibling corpus's
1,031 requests read a binding an earlier call captured. It shows you what came back. **Nothing is
graded and nothing is kept** — that is `tflw run`'s job, and the Run tab's.

`+ wait until` is the one worth knowing about early: `wait until api …` re-issues a request until
the assertions under it pass, instead of sleeping for a guessed number of seconds and hoping.

## What it will not edit

A `header` or `csrf` line. Not an omission and not a missing builder — both are dispatched by the
parser from a `session` block in `tflw.config` only, and the printer has no case for either, so
there is no file this pane edits that could hold one. Sessions are edited on the **Auth** and
**Config** tabs, which is where they live.

Next: [Assertions in depth](/guide/assertions) teaches the language this door writes.
