# 5. A browser test

A browser test opens a page in a real browser and uses it the way a person does: it fills fields,
clicks buttons and reads what the page shows. tflw names each thing on the page the way a person
would see it (`field "Town"`, `button "Save for later"`), so the hard part is knowing what a
control is called. Three commands help with that: `pick` names one thing, `record` writes a first
draft, and `watch` re-runs a file each time you save it.

The shop's order page is at `/order`. Every command below takes that path and opens it against the
`web` address in `tflw.config`, the same way a test's `open "/order"` does.

## `pick`: what is this called?

```sh runbook background
npx tflw pick /order &
```

```text runbook-output
opening http://127.0.0.1:4720/order — press Ctrl+C to stop.
…
ready — click any element to print its locator. Close the window or press Ctrl+C to stop.
```

A browser window opens. Click anything and `pick` prints the locator a test would use for it,
checked to name that one element and nothing else. Click the **Town** field and it prints
`field "Town"`. Clicking does nothing else: links do not follow and buttons do not submit, so you can
click anything. Close the window when you have what you need. The `&` gives you your prompt back
while it runs.

## `record`: a first draft

`record` is `pick`'s opposite: the page works as normal, and each thing you do is printed as one
step. Send the steps to a file:

```sh runbook background
npx tflw record /order > tests/draft.tflw &
```

```text runbook-output
recording http://127.0.0.1:4720/order — press Ctrl+C to stop.
…
ready — use the page as a user would. Close the window or press Ctrl+C to stop.
```

Type a town, pick a grind, tick **Gift wrap this order**, then close the window. `tests/draft.tflw`
holds a `fill`, a `select` and a `tick`: what you did, not what should be true afterwards. A
recording never contains an `expect`, because the recorder cannot know which change on the page was
the one that mattered. Adding those is your half. The draft is not a test yet (it has no `test`
line), so it is set aside here:

```sh runbook
rm -f tests/draft.tflw
```

## The test

Here is the test the draft becomes, with its `expect` lines added:

```sh runbook
cat > tests/my-delivery.tflw <<'EOF'
@functional
test "the town I type is the town the order goes to"
  open "/order"
  fill field "Town" with "Bristol"
  select "Filter" from field "Grind"
  tick field "Gift wrap this order"
  expect text "Delivering to Bristol" is visible
  expect text "Ground for Filter" is visible
  expect field "Gift wrap this order" is checked
EOF
npx tflw run tests/my-delivery.tflw
```

```text runbook-output
09:36:20.114   ✓ the town I type is the town the order goes to (742 ms)

09:36:20.114 PASS 1/1 passed · env local · seed 81302 · now 2026-10-01T09:36:19.000Z · 748 ms
…
```

## When a browser test fails

A failing browser step puts a screenshot of the page at that moment in `report.html`, next to the
step. For more than one picture, `--trace` keeps Playwright's trace of the whole test: every step,
the page before and after it, and the network:

```sh runbook
npx tflw run tests/my-delivery.tflw --trace
```

```text runbook-output
09:36:41.502   ✓ the town I type is the town the order goes to (803 ms)
…
```

`npx playwright show-trace` opens it, and the report links to it from the test.

## `watch`: re-run on every save

While you edit a browser test, `watch` keeps one browser window open and re-runs a file each time you
save it, so you see the page do what the test says:

```sh runbook background
npx tflw watch tests/my-delivery.tflw &
```

```text runbook-output
tflw watch — seed 22917 (pass `--seed 22917` to `tflw run` to reproduce outside watch)
…
09:37:02.844   ✓ the town I type is the town the order goes to (690 ms)
…
[watch] watching for changes — save a .tflw file to re-run, Ctrl+C to stop
```

Change `"Bristol"` to another town in both places and save: the test runs again in the same window.
Leave it red for a moment to see the window stay on the failure.

Stop watching before you move on: Ctrl+C in a terminal where it runs in front, or, since it is in
the background here, this:

```sh runbook
pkill -f "tflw watch"
```

## You now have

Two test files of your own, one API and one browser, both passing. You have named a control with
`pick`, drafted steps with `record` and watched a test re-run on save.

## Next, or instead

- **Next:** [6. Load and scan](/runbook/start/load-and-scan).
- Every browser statement, with examples: [Browser basics](/guide/browser-basics) and
  [Advanced browser](/guide/browser-advanced).
- How tflw finds `field "Town"` when the page has five fields: [The locator model](/guide/browser-basics#the-locator-model).
- The page's BROWSER door, with playback: [Browser tests](/ui/browser).
