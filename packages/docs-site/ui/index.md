---
pageClass: ui-shots
---

# The UI

`tflw ui` reads a project of `.tflw` files back as a page in your browser: the tests you have, what
they are for, what happened when they last ran, and — since the authoring surface landed — a way to
write them without typing the syntax.

It is not a dashboard. Nothing is uploaded, no account is involved, and the page has no state of its
own: it reads the files on disk and writes files back to disk. Close it and the project is exactly
what `tflw run` and `git` see.

![The landing surface: four doors, each counted against the project on disk](/ui/landing-paper.png){.light-only}
![The landing surface: four doors, each counted against the project on disk](/ui/landing-terminal.png){.dark-only}

## Opening it

```sh
npx tflw ui
```

That serves the directory you are standing in and opens a browser at it. The line it prints is the
address, and the address carries a token minted for this start:

```console
tflw ui — . at http://127.0.0.1:4141/?token=Kq8…Zw (loopback only, this URL carries the session token; Ctrl-C to stop)
```

Open that URL — or let the command open it — and the page is yours; a bare `http://127.0.0.1:4141/`
in a browser that has never opened it says so and stops. Point it somewhere else by naming the
directory, pick the port yourself, or keep the browser out of it:

```sh
npx tflw ui ./tests
npx tflw ui --port 4144
npx tflw ui --no-open
```

**Every picture on these pages is of one project**, and it is a real one you can run:
[`examples/storefront`](https://github.com/deepak-tuteja/tflw/tree/main/examples/storefront) in this
repository — a shop with a catalogue, a basket, a delivery form, an order page and a crawl. From a
clone, `npm run example` starts it and runs the suite against it; `npx tflw ui examples/storefront`
opens the page these shots were taken of. Nothing here is a mock-up.

An empty directory is not an error. The page offers to make a project, and which kind it makes
depends on which door you came through — see [The four doors](/ui/doors).

## What you are looking at

The landing surface offers four doors — **API**, **BROWSER**, **LOAD** and **SCANS** — and a count
beside each. The count is the tests in this project that door's work describes, so a project with no
load tests shows nothing behind LOAD, and one test can be counted behind more than one door.

The line under the doors is the other half of that rule, and the project above is showing it: **one
test behind no door**. A door is earned by the constructs a test carries, so a test built only out
of constructs no door is about — a call, a binding, an assertion on its result — is behind none of
them, and the page says so rather than filing it somewhere plausible:

```tflw
action signIn(email, password)
  api POST /login body { email: "{email}", password: "{password}" }
  expect status equals 200
  capture body.ok as signedIn
  give signedIn

test "signing in is one line, because the shop does it in every other test"
  let ok = signIn("sam@example.com", "hunter2")
  expect {ok} equals true
```

The `action` carries the `api` step, so the API door counts *it* — and the test below, which is a
call, a binding and an assertion, is behind nothing. It still runs, and it is still in the file
list. It is just not what any of the four doors are for.

Past the landing, every surface is the same three things: a file list, a door, and five tabs over
whichever file you picked. That shape does not change, which is what [the spine](/ui/spine) means.

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

- **[The spine](/ui/spine)** — the file list, the door bar and the five tabs: the shape every
  surface here shares.
- **[The four doors](/ui/doors)** — what a door decides, what it does not, and why a test can sit
  behind more than one.

Then one page per door, each on a real test:

- **[The API door](/ui/api)** — a request, the assertions that read it, and Send.
- **[The BROWSER door](/ui/browser)** — gestures against a real page, and why its scaffold stops
  after one line.
- **[The LOAD door](/ui/load)** — a workload, the plan panel it earns, and the threshold the
  checker insists on.
- **[The SCANS door](/ui/scans)** — the targets block, the severity floor, and what it cannot
  scaffold.

And then:

- **[Reading a run](/ui/a-run)** — verdicts, failures and traces, in place.
- **[What the page will not do](/ui/limits)** — stated plainly, because some of it is deliberate.
