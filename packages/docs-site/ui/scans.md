---
pageClass: ui-shots
---

# The SCANS door

> `#/scan` — *crawl a surface and judge every response against a severity bar.*

A scan is a test whose assertion grades the response as a whole rather than one field of it, against
a bar you set.

![Compose on the SCANS door: a scan test, its targets and the severity bar it is judged against](/ui/compose-scan-paper.png){.light-only}
![Compose on the SCANS door: a scan test, its targets and the severity bar it is judged against](/ui/compose-scan-terminal.png){.dark-only}

## The targets block

The block above the body is the one thing on this surface a scan cannot run without: **what this
project has declared it is allowed to reach**. It is read from `tflw.config`'s
`authorized target` lines, it is not editable here, and it links to the Config tab where it is.

Like the LOAD door's plan panel, it is earned by a construct and not granted by the door — a file
that declares an authorized target shows it behind the API door too.

## What `+ new test` writes here

A request, its status assertion, and the severity line:

```tflw
test "the catalog answers with safe headers"
  api GET /items
  expect status equals 200
  expect response has no critical security violations
```

**Both assertions, and the first one is not decoration.** A scan matcher grades the *last* response,
so a test carrying only the severity line is a test that never says whether the request it is
grading worked at all. The two lines together are exactly what `tflw init --scan` writes, which is
why this is one answer to *what does a scan start from* rather than two.

`critical` is the floor the button writes because a first scan reporting every `minor` finding on a
real host is a wall of text with nothing actionable in it. It is also the commonest answer in the
corpus — 31 of 112 severity matchers, the largest of the five.

## What this door cannot scaffold

A `crawl` declaration. A crawl is a different shape from a test and there is no builder for it, so
the button writes the test form above and a crawl is written by hand or by `tflw init --scan`. That
limit is stated here rather than discovered: the button offers what it can construct.

Next: [Hygiene scanning](/guide/security-scanning), and
[Findings, baselines & the gate](/guide/findings-and-baselines) for what happens to what it finds.
