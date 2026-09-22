# The page

`tflw ui` reads a project of `.tflw` files back as a page in your browser: the tests you have, what
they are for, what happened when they last ran, and — since the authoring surface landed — a way to
write them without typing the syntax.

It is not a dashboard. Nothing is uploaded, no account is involved, and the page has no state of its
own: it reads the files on disk and writes files back to disk. Close it and the project is exactly
what `tflw run` and `git` see.

![The landing surface: four doors, each counted against the project on disk](/page/landing-paper.png){.light-only}
![The landing surface: four doors, each counted against the project on disk](/page/landing-terminal.png){.dark-only}

## Opening it

```sh
npx tflw ui
```

That serves the directory you are standing in and opens a browser at it. Point it somewhere else by
naming the directory, pick the port yourself, or keep the browser out of it:

```sh
npx tflw ui ./tests
npx tflw ui --port 4144
npx tflw ui --no-open
```

An empty directory is not an error. The page offers to make a project, and which kind it makes
depends on which door you came through — see [The four doors](/page/doors).

## What you are looking at

The landing surface offers four doors — **API**, **BROWSER**, **LOAD** and **SCANS** — and a count
beside each. The count is the tests in this project that door's work describes, so a project with no
load tests shows nothing behind LOAD, and one test can be counted behind more than one door.

Past the landing, every surface is the same three things: a file list, a door, and five tabs over
whichever file you picked. That shape does not change, which is what [the spine](/page/spine) means.

## What it is for

The page answers three questions that a terminal answers badly:

- **What is in this project?** A directory of `.tflw` files tells you their names. The page tells
  you what each one tests, which ones failed, and which ones the checker cannot parse.
- **What happened last run?** `tflw run` writes a `report.html` you open afterwards. The page reads
  the same run in place, beside the source that produced it.
- **What would this test look like?** Composing a request as a form and reading the `.tflw` it
  produces is a faster way to learn the language than writing it and running the checker.

None of that replaces the command line. `tflw run` is what CI executes and what a commit is judged
by; the page is where a person works before that.

## The rest of this section

- **[The spine](/page/spine)** — the file list, the door bar and the five tabs.
- **[The four doors](/page/doors)** — what each one lands you on, and what Compose writes.
- **[Reading a run](/page/a-run)** — verdicts, failures and traces, in place.
- **[What the page will not do](/page/limits)** — stated plainly, because some of it is deliberate.
