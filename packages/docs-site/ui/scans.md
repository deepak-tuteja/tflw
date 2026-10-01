---
pageClass: ui-shots
---

# SCANS

> `#/?kind=scan` — *crawl a surface and judge every response against a severity bar.*

A scan is a test whose assertion grades the response as a whole rather than one field of it, against
a bar you set.

![A scan test in Compose: its targets and the severity bar it is judged against](/ui/compose-scan-paper.png){.light-only}
![A scan test in Compose: its targets and the severity bar it is judged against](/ui/compose-scan-terminal.png){.dark-only}

## The targets

The **scan** tab in the right-hand column is the one thing on this surface a scan cannot run
without: **what this project has declared it is allowed to reach**. It is read from `tflw.config`'s
`authorized target` lines, it is not editable here, and it links to the Config panel where it is.

Like a load test's plan, it is earned by a statement and not granted by a chip — a test asserting a
scan matcher shows it under the API chip too.

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

## A crawl is its own button

A `crawl` walks a whole surface and asserts on every response it reaches, so it is a different
shape from a test and **+ new test** does not write one. **+ new crawl**, at the foot of the steps
in a file that carries a scan (or under the SCANS chip), writes the smallest crawl that runs: a walk
from `/` asserting `has no serious security violations`. Its seeds and excludes are edited in the
card under its row.

Next: [Hygiene scanning](/guide/security-scanning), and
[Findings, baselines & the gate](/guide/findings-and-baselines) for what happens to what it finds.
