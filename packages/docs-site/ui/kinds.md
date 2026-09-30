---
pageClass: ui-shots
---

# The four kinds

A kind is a kind of work — calling an API, driving a page, applying load, scanning — and a test is of
every kind whose statements it carries. On the page the kinds are chips at the head of the file list,
and a chip does two things and nothing else: it **filters** what the list shows and what ▶ runs, and
it is where **+ new test** starts when it asks what to scaffold.

![The kind chips at the head of the file list, with what each counts in this project](/ui/kinds-paper.png){.light-only}
![The kind chips at the head of the file list, with what each counts in this project](/ui/kinds-terminal.png){.dark-only}

| kind | the work | what **+ new test** scaffolds |
|---|---|---|
| **[API](/ui/api)** | call an endpoint, assert what comes back, chain one call into the next | a request and the assertion that reads it |
| **[BROWSER](/ui/browser)** | drive a real page: click, fill, and assert what a person would see | an `open`, and deliberately nothing under it |
| **[LOAD](/ui/load)** | run the work you already wrote at a rate, and hold it to a threshold | the API pair, plus a shape and a threshold |
| **[SCANS](/ui/scans)** | crawl a surface and judge every response against a severity bar | the API pair, plus a severity floor |

Each kind has its own page above, with what Compose looks like on a real test of that kind.

## A test is not filed under one

The kinds a test is of are derived from the statements it actually uses, so a test is counted under
every chip whose work it does. Measured across this project's own corpus and its sibling, **231 of
761 tests — 30.4% — are of more than one kind**. That is the whole reason the kinds are not four
folders: a login that seeds state over the API and then drives a browser is one test doing two kinds
of work, and filing it under either one would be wrong.

The count on a chip is therefore not a partition. The four counts can sum to more than `all`, and
usually do — **in the picture above they sum to 45 across a project of 38 tests and crawls**, which
is the overlap made visible rather than asserted. The other end of the same rule: a test whose every
statement is one no kind is about — a call, a binding, an assertion — is under no chip, and `all`
still counts it.

The same chip narrows a run from a terminal: `tflw run --kind api` runs the tests the API chip
shows, by the same derivation.

## A chip filters; it grants nothing

This is the one rule worth carrying out of this section, because nothing on the page announces it:
**the chip you have on changes what the list shows and what ▶ runs, and nothing about the file you
are looking at.**

What Compose can do with a file is read off the file: a file with a page in it can be played and
recorded, a file with a request can be sent, a file with a workload line shows the plan panel, a file
declaring an authorized target shows the targets block — under every chip, `all` included. Switch
chips with a file open and the pane does not change; switch files and it does.

## Compose

Compose is the authoring surface: the test's steps in file order, and the one you pick as a form.
The **Source** tab beside it shows the bytes the write will produce, so nothing is written blind.

It is **one pane, not four**. Every file draws the same surface at the same size; what differs is
which words the file's own kinds know and which panels it has earned. The four pages above show it on
a test of each kind.

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
statement, the test, or the file. Picking a row changes what the editor beside it is editing. The
steps are in file order, statements included, because the interleaving is the point: a `let`
between two requests is usually what makes the second one work.

## What **+ new test** scaffolds

**+ new test** and **+ new file** ask which kind to start with — four chips in the dialog, starting
on the chip you have on — and write the third column of the table above; each kind's own page says
exactly what and why. It is a starting point and not a template: it is ordinary `.tflw` you then
edit, and the Source tab shows you exactly what it wrote.

The language is the same for every kind. A kind changes what you are handed, never what is legal.

A directory with no project yet asks the same question before anything else, and the answer is
`tflw init`'s own flag: `--load` for LOAD, `--scan` for SCANS, nothing for the other two.
