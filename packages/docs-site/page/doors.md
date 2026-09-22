# The four doors

A door is a kind of work, not a kind of test. It answers *what am I here to do*, and then it offers
a project. What it decides is where you land and what **+ new test** scaffolds — nothing else.

![The door bar, with what each door counts in this project](/page/doors-paper.png){.light-only}
![The door bar, with what each door counts in this project](/page/doors-terminal.png){.dark-only}

| door | the work |
|---|---|
| **API** | call an endpoint, assert what comes back, chain one call into the next |
| **BROWSER** | drive a real page: click, fill, and assert what a person would see |
| **LOAD** | run the work you already wrote at a rate, and hold it to a threshold |
| **SCANS** | crawl a surface and judge every response against a severity bar |

## A test is not filed under one

Every door a test qualifies for is derived from the constructs the test actually uses, so a test
appears behind each door whose work it does. Measured across this project's own corpus and its
sibling, **231 of 761 tests — 30.4% — appear behind more than one**. That is the whole reason the
doors are not four folders: a login that seeds state over the API and then drives a browser is one
test doing two kinds of work, and filing it under either one would be wrong.

The count beside a door is therefore not a partition. The four counts can sum to more than the
number of tests in the project, and usually do.

## Compose

Compose is the authoring surface: the request, and the assertions that read it, as a form. The
**Source** tab beside it shows the bytes the write will produce, so nothing is written blind.

![Compose: the request and the assertions that read it](/page/compose-paper.png){.light-only}
![Compose: the request and the assertions that read it](/page/compose-terminal.png){.dark-only}

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

**+ new test** writes a starting point appropriate to the door you are standing in — an API call
with an assertion, a browser flow, a workload with a threshold, or a scan with an authorized target
declaration. It is a starting point and not a template: it is ordinary `.tflw` you then edit, and
the Source tab shows you exactly what it wrote.

The language is the same in every door. A door changes what you are handed, never what is legal.
