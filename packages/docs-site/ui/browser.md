---
pageClass: ui-shots
---

# BROWSER tests

> `#/?kind=browser` — *drive a real page: click, fill, and assert what a person would see.*

The same pane as an API test's, knowing a different set of words. A browser test opens a page and
then does what a person would do to it. Each step is a row that opens in place when you pick it,
exactly as a request does, and a locator field carries **⌖ pick**: it opens the page, and the element
you click is written into the field.

![A BROWSER test in Compose: its gestures, and the page the last run saw](/ui/compose-browser-paper.png){.light-only}
![A BROWSER test in Compose: its gestures, and the page the last run saw](/ui/compose-browser-terminal.png){.dark-only}

The right-hand column shows **the page as the last run saw it** at the picked step. A step records a
picture when it fails or when a `screenshot` statement takes one, so a clean step says it has none
rather than showing an empty frame.

## What `+ new test` writes here

One line:

```tflw
test "the shop page greets and the button answers"
  open "/"
```

**And deliberately nothing under it.** The other three kinds scaffold an assertion because they can
derive one; this one cannot. The language has no url or title matcher to assert against, and what
text is actually on the page is the one thing the author has not seen yet. Measured on the two
corpora, **58.3%** of visible `open`s are followed by a gesture rather than by an assertion — so
the honest scaffold stops where the author's knowledge starts.

## What the pane offers

**`+ open`**, **`+ click`**, **`+ fill`**, **`+ let`**, and then two that only a file with a page has:

- **`+ step…`** — the rest of the language behind one press. `click` (874), `fill` (493) and
  `open` (378) are **73%** of the corpus's 2,395 browser statements; the other eighteen kinds are
  217 occurrences between them, so they sit one press away rather than in a column of buttons that
  wraps to three rows.
- **`+ record`** — drive the page yourself and keep what you did as steps. Each gesture arrives as
  a row under the step you had picked, with **keep** and **drop** on it. **▶ try** runs the test
  with the rows in it without keeping any. **stop** (or closing the browser) keeps what you kept and
  drops the rest. Nothing reaches the file until you **write**.

There is no Send here. A browser step is not a request you can re-issue for a look; **▶** beside
the test runs it against a real page instead, and the run draws itself in the rows as it goes (see
[Running from the page](/ui/a-run#running-from-the-page)).

## Every browser construct is editable here

All twenty-two kinds the language has. That sentence is worth stating because until recently it was
**three**: the other nineteen drew as plain, uneditable code lines with no disabled control and no
reason given — **650 statements, 27% of all browser steps in the two corpora**. Five of the
nineteen already had working builders that nothing could reach.

Two surfaces reach them, and it is worth knowing which is which. `+ open`, `+ click` and `+ fill`
sit in the pane's foot as gestures of their own. **`+ step…` holds the rest** — a filterable list
of **24** entries: the eighteen browser kinds without their own button, plus `call`, `capture`,
`give`, `log`, `pause` and `together`, which are not browser words at all and which every kind
offers.

![`+ step…` in a BROWSER test: the rest of the browser vocabulary as a filterable list of 24](/ui/browser-menu-paper.png){.light-only}
![`+ step…` in a BROWSER test: the rest of the browser vocabulary as a filterable list of 24](/ui/browser-menu-terminal.png){.dark-only}

That is eighteen and three of the twenty-two. The twenty-second is `within`, which is a block with
a body rather than a step, and no `+` gesture writes one — you edit a `within` the language already
put there.

Next: [Browser testing: interacting with a UI](/guide/browser-basics).
