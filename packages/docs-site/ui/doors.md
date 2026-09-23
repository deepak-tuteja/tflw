---
pageClass: ui-shots
---

# The four doors

A door is a kind of work, not a kind of test. It answers *what am I here to do*, and then it offers
a project. What it decides is where you land and what **+ new test** scaffolds — nothing else.

![The door bar, with what each door counts in this project](/ui/doors-paper.png){.light-only}
![The door bar, with what each door counts in this project](/ui/doors-terminal.png){.dark-only}

| door | the work | what it scaffolds |
|---|---|---|
| **[API](/ui/api)** | call an endpoint, assert what comes back, chain one call into the next | a request and the assertion that reads it |
| **[BROWSER](/ui/browser)** | drive a real page: click, fill, and assert what a person would see | an `open`, and deliberately nothing under it |
| **[LOAD](/ui/load)** | run the work you already wrote at a rate, and hold it to a threshold | the API pair, plus a shape and a threshold |
| **[SCANS](/ui/scans)** | crawl a surface and judge every response against a severity bar | the API pair, plus a severity floor |

Each door has its own page above, with what its Compose surface looks like on a real test.

## A test is not filed under one

Every door a test qualifies for is derived from the constructs the test actually uses, so a test
appears behind each door whose work it does. Measured across this project's own corpus and its
sibling, **231 of 761 tests — 30.4% — appear behind more than one**. That is the whole reason the
doors are not four folders: a login that seeds state over the API and then drives a browser is one
test doing two kinds of work, and filing it under either one would be wrong.

The count beside a door is therefore not a partition. The four counts can sum to more than the
number of tests in the project, and usually do — **the strip in the picture above sums to 43 across
a project holding 36 declarations**, which is the overlap made visible rather than asserted. The
landing surface reports the other end of the same rule: one test there is behind no door at all,
because every construct it carries is one no door is about.

## Compose

Compose is the authoring surface: the request, and the assertions that read it, as a form. The
**Source** tab beside it shows the bytes the write will produce, so nothing is written blind.

It is **one pane, not four**. Every door draws the same surface at the same size; what differs is
which words that door knows and which panels the open file has earned. The four door pages above
show it on a test that belongs behind each.

Two things about it are worth knowing before you use it.

**Send runs a prefix, not a request alone.** Most requests in a real test read a value an earlier
step bound — a token, an id, a created resource. Sending one in isolation would fail for reasons
that have nothing to do with it, so there are two buttons and both send a *run of requests in
order*: **send this** issues the selected request and the ones above it that feed it, and **send
all** issues every request in the test. Each says how many it will fire before you press it.

Neither grades anything. Send shows you what came back; the assertions are checked when the test
runs, from the Run tab. Send also writes a scratch file beside your project, which the page tells
you about if your `.gitignore` does not already list it.

**What is selected is what the editor draws.** One region, four kinds of thing — a request, a
statement, the test, or the file. Picking a row in the sequence changes what the editor beside it is
editing. The sequence is in file order, statements included, because the interleaving is the point:
a `let` between two requests is usually what makes the second one work.

## What each door scaffolds

**+ new test** writes a starting point appropriate to the door you are standing in — the third
column of the table above, and each door's own page says exactly what and why. It is a starting
point and not a template: it is ordinary `.tflw` you then edit, and the Source tab shows you
exactly what it wrote.

The language is the same in every door. A door changes what you are handed, never what is legal.

## A panel is earned by a construct, never granted by a door

This is the one rule worth carrying out of this section, because nothing about the interface
announces it: **the door you arrive through grants no panels at all.**

A file with a workload line shows the plan panel behind every door, including API. A file declaring
an authorized target shows the targets block behind every door, including API. Open the same file
from two different doors and you are looking at the same surface — which is exactly what you should
expect once a door is a kind of work rather than a kind of test.
